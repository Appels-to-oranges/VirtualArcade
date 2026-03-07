(function () {
  'use strict';

  const SLOTS_COST = 10;
  const SYMBOL_HEIGHT = 4;
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

  let slotsWs = null;
  let slotsMyId = null;
  let slotsChips = 0;
  let slotsPlayers = [];
  let slotsSpinning = {};
  let slotsPendingResults = {};

  function el(id) {
    return document.getElementById(id);
  }

  function send(msg) {
    if (slotsWs && slotsWs.readyState === 1) {
      slotsWs.send(JSON.stringify(msg));
    }
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

  function buildReelStrip(reelEl) {
    reelEl.innerHTML = '';
    const strip = document.createElement('div');
    strip.className = 'slots-reel-strip';
    for (let cycle = 0; cycle < SPIN_CYCLES + 2; cycle++) {
      for (let i = 0; i < SYMBOLS.length; i++) {
        strip.appendChild(createSymbolEl(SYMBOLS[i]));
      }
    }
    reelEl.appendChild(strip);
    return strip;
  }

  function getSymbolIndex(symbolId) {
    return SYMBOLS.findIndex((s) => s.id === symbolId);
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
      const idx = getSymbolIndex(symbolId);
      if (idx >= 0) {
        const offset = SYMBOL_HEIGHT * (idx + CYCLE_OFFSET * SYMBOLS.length);
        strip.style.transform = `translateY(-${offset}rem)`;
      }
    }
  }

  function animateReelToSymbol(reelEl, symbolId, delayMs) {
    const strip = reelEl.querySelector('.slots-reel-strip');
    if (!strip) return;
    const idx = getSymbolIndex(symbolId);
    if (idx < 0) return;

    const endOffset = SYMBOL_HEIGHT * (idx + CYCLE_OFFSET * SYMBOLS.length);
    const startOffset = SYMBOL_HEIGHT * (idx + (CYCLE_OFFSET + 6) * SYMBOLS.length);

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
        const spinBtn = document.createElement('button');
        spinBtn.type = 'button';
        spinBtn.className = 'btn btn-bet slots-spin-btn';
        spinBtn.textContent = `Spin $${SLOTS_COST}`;
        spinBtn.disabled = slotsSpinning[slotsMyId] || (slotsChips || 0) < SLOTS_COST;
        spinBtn.addEventListener('click', spin);
        ctrls.appendChild(spinBtn);

        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'slots-info-btn';
        infoBtn.innerHTML = '&#8505;';
        infoBtn.title = 'Payout table';
        infoBtn.setAttribute('aria-label', 'Payout table');
        infoBtn.addEventListener('click', openPayoutOverlay);
        ctrls.appendChild(infoBtn);
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
      spinBtn.disabled = slotsSpinning[slotsMyId] || (slotsChips || 0) < SLOTS_COST;
      spinBtn.textContent = `Spin $${SLOTS_COST}`;
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
    if (slotsSpinning[slotsMyId] || (slotsChips || 0) < SLOTS_COST) return;
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
    send({ type: 'slotSpin' });
  }

  function handleMessage(msg) {
    if (msg.type === 'slotSpinStarted') {
      const pid = msg.playerId;
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
          resultEl.style.color = '#c9b896';
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
              resultEl.style.color = '#52b788';
            } else {
              resultEl.textContent = 'No win';
              resultEl.style.color = '#c9b896';
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
    slotsPlayers = players || [];
    slotsSpinning = {};
    slotsPendingResults = {};
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
