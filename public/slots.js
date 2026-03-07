(function () {
  'use strict';

  const DENOMINATIONS = [5, 10, 20, 100];
  const DEFAULT_BET = 5;
  const SYMBOL_HEIGHT = 2.5;
  const SPIN_CYCLES = 8;
  const SPIN_DURATION_MS = 10000;
  const REEL_STAGGER_MS = 200;
  const CYCLE_OFFSET = 2;

  const SYMBOLS = [
    { id: 'crayfish', label: '', img: '/slot-assets/blue-crayfish.png' },
    { id: 'alligator', label: '', img: '/slot-assets/Copy of american-alligator.png' },
    { id: 'catfish', label: '', img: '/slot-assets/Copy of catfish-image.png' },
    { id: 'worm', label: '', img: '/slot-assets/Copy of worm-bait.png' },
    { id: 'hook', label: '', img: '/slot-assets/fishing-hook-1.png' },
  ];

  const SYMBOL_MAP = Object.fromEntries(SYMBOLS.map((s, i) => [s.id, s]));

  let slotsWs = null;
  let slotsMyId = null;
  let slotsChips = 0;
  let slotsBet = DEFAULT_BET;
  let slotsPlayers = [];
  let slotsSpinning = {};
  let slotsPendingResults = {};
  let slotsLastBet = {};

  function el(id) {
    return document.getElementById(id);
  }

  function send(msg) {
    if (slotsWs && slotsWs.readyState === 1) {
      slotsWs.send(JSON.stringify(msg));
    }
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function createSymbolEl(sym) {
    const span = document.createElement('span');
    span.className = 'slots-symbol';
    if (sym.img) {
      const img = document.createElement('img');
      img.src = sym.img;
      img.alt = sym.id;
      img.className = 'slots-symbol-img';
      span.appendChild(img);
    } else {
      span.textContent = sym.label;
      span.className = 'slots-symbol slots-symbol-text';
    }
    return span;
  }

  function buildReelStrip(reelEl, symbolOrder) {
    reelEl.innerHTML = '';
    const order = symbolOrder || shuffle(SYMBOLS.map((s) => s.id));
    reelEl.dataset.symbolOrder = JSON.stringify(order);
    const strip = document.createElement('div');
    strip.className = 'slots-reel-strip';
    for (let cycle = 0; cycle < SPIN_CYCLES + 2; cycle++) {
      for (let i = 0; i < order.length; i++) {
        strip.appendChild(createSymbolEl(SYMBOL_MAP[order[i]] || SYMBOLS[i]));
      }
    }
    reelEl.appendChild(strip);
    return strip;
  }

  function getSymbolIndexInReel(reelEl, symbolId) {
    try {
      const order = JSON.parse(reelEl.dataset.symbolOrder || '[]');
      return order.indexOf(symbolId);
    } catch (_) {
      return SYMBOLS.findIndex((s) => s.id === symbolId);
    }
  }

  function show() {
    const screen = el('slots-screen');
    if (screen) screen.classList.remove('hidden');
    renderMachines();
  }

  function hide() {
    const screen = el('slots-screen');
    if (screen) screen.classList.add('hidden');
  }

  function renderReel(reelEl, reelIdx, symbolId, spinning) {
    let strip = reelEl.querySelector('.slots-reel-strip');
    if (!strip) strip = buildReelStrip(reelEl);
    strip.style.transition = 'none';
    reelEl.classList.toggle('slots-reel-spinning', !!spinning);
    if (!spinning && symbolId) {
      const idx = getSymbolIndexInReel(reelEl, symbolId);
      const len = 5;
      if (idx >= 0) {
        const offset = SYMBOL_HEIGHT * (idx + CYCLE_OFFSET * len);
        strip.style.transform = `translateY(-${offset}rem)`;
      }
    }
  }

  function animateReelToSymbol(reelEl, symbolId, delayMs) {
    const strip = reelEl.querySelector('.slots-reel-strip');
    if (!strip) return;
    const idx = getSymbolIndexInReel(reelEl, symbolId);
    const len = 5;
    if (idx < 0) return;

    const endOffset = SYMBOL_HEIGHT * (idx + CYCLE_OFFSET * len);
    const startOffset = SYMBOL_HEIGHT * (idx + (CYCLE_OFFSET + 6) * len);

    strip.style.transition = 'none';
    strip.style.transform = `translateY(-${startOffset}rem)`;
    strip.offsetHeight;

    setTimeout(() => {
      strip.style.transition = `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.1, 0.8, 0.2, 1)`;
      strip.style.transform = `translateY(-${endOffset}rem)`;
    }, delayMs);
  }

  function renderMachines() {
    const grid = el('slots-machines-grid');
    if (!grid) return;

    const playersInSlots = slotsPlayers.filter((p) => (p.currentView ?? 'lobby') === 'slots').slice(0, 4);
    grid.innerHTML = '';

    playersInSlots.forEach((p) => {
      const machine = document.createElement('div');
      machine.className = 'slots-machine';
      machine.dataset.playerId = p.id;

      const label = document.createElement('div');
      label.className = 'slots-machine-label';
      label.textContent = (p.id === slotsMyId ? 'You' : (p.nickname || 'Player')) + (p.id === slotsMyId ? '' : ` ($${p.chips ?? 0})`);
      machine.appendChild(label);

      const reels = document.createElement('div');
      reels.className = 'slots-reels';
      for (let i = 0; i < 3; i++) {
        const reel = document.createElement('div');
        reel.className = 'slots-reel';
        reel.dataset.reelIdx = String(i);
        if (!reel.querySelector('.slots-reel-strip')) buildReelStrip(reel);
        reels.appendChild(reel);
      }
      machine.appendChild(reels);

      const payline = document.createElement('div');
      payline.className = 'slots-payline';
      machine.appendChild(payline);

      const result = document.createElement('div');
      result.className = 'slots-result';
      result.id = `slots-result-${p.id}`;
      machine.appendChild(result);

      const ctrls = document.createElement('div');
      ctrls.className = 'slots-machine-controls';
      if (p.id === slotsMyId) {
        const denomWrap = document.createElement('div');
        denomWrap.className = 'slots-denom-buttons';
        DENOMINATIONS.forEach((d) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'slots-denom-btn' + (d === slotsBet ? ' active' : '');
          btn.textContent = '$' + d;
          btn.dataset.bet = String(d);
          btn.addEventListener('click', () => setBet(d));
          denomWrap.appendChild(btn);
        });
        ctrls.appendChild(denomWrap);

        const spinRow = document.createElement('div');
        spinRow.className = 'slots-spin-row';
        const spinBtn = document.createElement('button');
        spinBtn.type = 'button';
        spinBtn.className = 'btn btn-bet slots-spin-btn';
        spinBtn.textContent = `Spin $${slotsBet}`;
        spinBtn.disabled = slotsSpinning[slotsMyId] || (slotsChips || 0) < slotsBet;
        spinBtn.addEventListener('click', spin);
        spinRow.appendChild(spinBtn);

        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'slots-info-btn';
        infoBtn.innerHTML = '&#8505;';
        infoBtn.title = 'Payout table';
        infoBtn.setAttribute('aria-label', 'Payout table');
        infoBtn.addEventListener('click', openPayoutOverlay);
        spinRow.appendChild(infoBtn);
        ctrls.appendChild(spinRow);
      }
      machine.appendChild(ctrls);

      grid.appendChild(machine);
    });

    updateChipsDisplay();
  }

  function updateChipsDisplay() {
    const chipsEl = el('slots-chips-display');
    if (chipsEl) chipsEl.textContent = '$' + (slotsChips ?? 0);

    const spinBtn = document.querySelector('.slots-spin-btn');
    if (spinBtn) {
      spinBtn.disabled = slotsSpinning[slotsMyId] || (slotsChips || 0) < slotsBet;
      spinBtn.textContent = `Spin $${slotsBet}`;
    }
  }

  function getMachineEl(playerId) {
    return document.querySelector(`.slots-machine[data-player-id="${playerId}"]`);
  }

  function openPayoutOverlay() {
    const overlay = el('slots-payout-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  function closePayoutOverlay() {
    const overlay = el('slots-payout-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function spin() {
    if (slotsSpinning[slotsMyId] || (slotsChips || 0) < slotsBet) return;
    slotsSpinning[slotsMyId] = true;
    const machine = getMachineEl(slotsMyId);
    if (machine) {
      const reels = machine.querySelectorAll('.slots-reel');
      reels.forEach((reel, i) => {
        renderReel(reel, i, null, true);
        const strip = reel.querySelector('.slots-reel-strip');
        if (strip) {
          strip.style.transition = 'transform 80ms linear';
          strip.style.transform = `translateY(-${SYMBOL_HEIGHT * SYMBOLS.length * 3}rem)`;
        }
      });
      const resultEl = machine.querySelector('.slots-result');
      if (resultEl) resultEl.textContent = 'Spinning...';
    }
    updateChipsDisplay();
    const betVal = parseInt(slotsBet, 10);
    const validBet = [5, 10, 20, 100].includes(betVal) ? betVal : 5;
    slotsLastBet[slotsMyId] = validBet;
    send({ type: 'slotSpin', bet: validBet });
  }

  function handleMessage(msg) {
    if (msg.type === 'slotSpinStarted') {
      const pid = msg.playerId;
      const bet = parseInt(msg.bet, 10) || 5;
      slotsLastBet[pid] = [5, 10, 20, 100].includes(bet) ? bet : 5;
      slotsSpinning[pid] = true;
      const machine = getMachineEl(pid);
      if (machine) {
        const reels = machine.querySelectorAll('.slots-reel');
        reels.forEach((reel, i) => {
          renderReel(reel, i, null, true);
          const strip = reel.querySelector('.slots-reel-strip');
          if (strip) {
            strip.style.transition = 'transform 80ms linear';
            strip.style.transform = `translateY(-${SYMBOL_HEIGHT * SYMBOLS.length * 3}rem)`;
          }
        });
        const resultEl = machine.querySelector('.slots-result');
        if (resultEl) resultEl.textContent = 'Spinning...';
        const betLabel = machine.querySelector('.slots-machine-bet-display');
        if (betLabel) betLabel.textContent = 'Bet: $' + slotsLastBet[pid];
      }
    } else if (msg.type === 'slotResult') {
      const pid = msg.playerId;
      const reels = msg.reels || [];
      const payout = msg.payout ?? 0;
      const chips = msg.chips ?? 0;

      if (pid === slotsMyId) slotsChips = chips;
      const p = slotsPlayers.find((x) => x.id === pid);
      if (p) p.chips = chips;

      const machine = getMachineEl(pid);
      if (machine) {
        const reelEls = machine.querySelectorAll('.slots-reel');
        for (let i = 0; i < 3; i++) {
          const symbolId = reels[i] || '';
          animateReelToSymbol(reelEls[i], symbolId, i * REEL_STAGGER_MS);
        }
        const resultEl = machine.querySelector('.slots-result');
        if (resultEl) {
          resultEl.textContent = 'Spinning...';
          resultEl.classList.remove('slots-result-win');
        }
      }

      const totalDuration = 2 * REEL_STAGGER_MS + SPIN_DURATION_MS;
      slotsPendingResults[pid] = { reels, payout, totalDuration };
      setTimeout(() => {
        slotsSpinning[pid] = false;
        delete slotsPendingResults[pid];
        const m = getMachineEl(pid);
        if (m) {
          const reelEls = m.querySelectorAll('.slots-reel');
          for (let i = 0; i < 3; i++) {
            renderReel(reelEls[i], i, reels[i] || '', false);
          }
          const resultEl = m.querySelector('.slots-result');
          if (resultEl) {
            if (payout > 0) {
              resultEl.textContent = pid === slotsMyId ? `You won $${payout}!` : `Won $${payout}!`;
              resultEl.classList.add('slots-result-win');
            } else {
              resultEl.textContent = 'No win';
              resultEl.classList.remove('slots-result-win');
            }
          }
        }
        updateChipsDisplay();
        if (pid === slotsMyId && typeof window !== 'undefined') {
          if (payout > 0 && window.playWinner) window.playWinner();
        }
      }, totalDuration);
    }
  }

  function init(ws, myId, chips, players) {
    slotsWs = ws;
    slotsMyId = myId;
    slotsChips = chips ?? 0;
    slotsBet = DEFAULT_BET;
    slotsPlayers = players || [];
    slotsSpinning = {};
    slotsPendingResults = {};
    slotsLastBet = {};
    renderMachines();

    const overlay = el('slots-payout-overlay');
    const closeBtn = el('slots-payout-close');
    if (closeBtn && !closeBtn.dataset.slotsBound) {
      closeBtn.dataset.slotsBound = '1';
      closeBtn.addEventListener('click', closePayoutOverlay);
    }
    if (overlay && !overlay.dataset.slotsBound) {
      overlay.dataset.slotsBound = '1';
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closePayoutOverlay(); });
    }
  }

  function setChips(chips) {
    slotsChips = chips ?? 0;
    updateChipsDisplay();
  }

  function setPlayers(players) {
    slotsPlayers = players || [];
    if (document.querySelector('.slots-machine')) {
      renderMachines();
    }
  }

  window.slots = {
    init,
    show,
    hide,
    handleMessage,
    setChips,
    setPlayers,
  };
})();
