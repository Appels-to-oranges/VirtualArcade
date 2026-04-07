(function () {
  'use strict';

  const DENOMINATIONS = [5, 10, 20, 100];
  const DEFAULT_BET = 5;
  const SYMBOL_HEIGHT = 4;
  const SPIN_CYCLES = 8;
  const REEL_STAGGER_MS = 200;
  const CYCLE_OFFSET = 2;
  const ROW_COST_MULTIPLIER = { 1: 1, 2: 2, 3: 5 };

  let slotsRows = parseInt(localStorage.getItem('slots_rows'), 10) || 1;
  let slotsSpinDuration = parseInt(localStorage.getItem('slots_spin_time'), 10) || 10;
  let slotsConfigured = false;

  function getSpinDurationMs() { return slotsSpinDuration * 1000; }
  function getCostMultiplier() { return ROW_COST_MULTIPLIER[slotsRows] || 1; }

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

  /**
   * Build a reel strip. If gridColumn is provided (array of symbol ids for this
   * reel's rows), the strip is arranged so those symbols sit consecutively at
   * a known landing position (CYCLE_OFFSET cycles in).
   */
  function buildReelStrip(reelEl, symbolOrder, gridColumn) {
    reelEl.innerHTML = '';
    const order = symbolOrder || shuffle(SYMBOLS.map((s) => s.id));
    reelEl.dataset.symbolOrder = JSON.stringify(order);
    if (gridColumn) reelEl.dataset.gridColumn = JSON.stringify(gridColumn);
    else delete reelEl.dataset.gridColumn;
    const strip = document.createElement('div');
    strip.className = 'slots-reel-strip';
    const totalSymbols = order.length * (SPIN_CYCLES + 2);
    // Landing index: where the top visible row should start
    const landingStart = CYCLE_OFFSET * order.length;
    for (let i = 0; i < totalSymbols; i++) {
      // At the landing position, insert grid column symbols if available
      if (gridColumn && i >= landingStart && i < landingStart + gridColumn.length) {
        const gIdx = i - landingStart;
        strip.appendChild(createSymbolEl(SYMBOL_MAP[gridColumn[gIdx]] || SYMBOLS[0]));
      } else {
        const symIdx = i % order.length;
        strip.appendChild(createSymbolEl(SYMBOL_MAP[order[symIdx]] || SYMBOLS[symIdx]));
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

  function renderReel(reelEl, reelIdx, symbolId, spinning, gridColumn) {
    let strip = reelEl.querySelector('.slots-reel-strip');
    if (!strip || gridColumn) strip = buildReelStrip(reelEl, null, gridColumn);
    reelEl.style.height = (SYMBOL_HEIGHT * slotsRows) + 'rem';
    strip.style.transition = 'none';
    reelEl.classList.toggle('slots-reel-spinning', !!spinning);
    if (!spinning && symbolId) {
      // Landing position: top of the grid column block
      const len = 5;
      const landingStart = CYCLE_OFFSET * len;
      const offset = SYMBOL_HEIGHT * landingStart;
      strip.style.transform = `translateY(-${offset}rem)`;
    }
  }

  function animateReelToSymbol(reelEl, symbolId, delayMs, gridColumn) {
    // Rebuild strip with grid column so the correct symbols appear at landing
    const strip = buildReelStrip(reelEl, null, gridColumn);
    const len = 5;
    const landingStart = CYCLE_OFFSET * len;
    const endOffset = SYMBOL_HEIGHT * landingStart;
    const startOffset = SYMBOL_HEIGHT * ((CYCLE_OFFSET + 6) * len);
    const duration = getSpinDurationMs();

    strip.style.transition = 'none';
    strip.style.transform = `translateY(-${startOffset}rem)`;
    strip.offsetHeight;

    setTimeout(() => {
      strip.style.transition = `transform ${duration}ms cubic-bezier(0.1, 0.8, 0.2, 1)`;
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
        reel.style.height = (SYMBOL_HEIGHT * slotsRows) + 'rem';
        reel.dataset.reelIdx = String(i);
        buildReelStrip(reel);
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
        const mult = getCostMultiplier();
        DENOMINATIONS.forEach((d) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'slots-denom-btn' + (d === slotsBet ? ' active' : '');
          btn.textContent = '$' + (d * mult);
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
        spinBtn.textContent = `Spin $${totalSpinCost()}`;
        spinBtn.disabled = slotsSpinning[slotsMyId] || (slotsChips || 0) < totalSpinCost();
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

  function setBet(amount) {
    if (slotsSpinning[slotsMyId]) return;
    const val = parseInt(amount, 10);
    if (![5, 10, 20, 100].includes(val)) return;
    slotsBet = val;
    renderMachines();
  }

  function updateChipsDisplay() {
    const playerInfoEl = el('slots-player-info');
    if (playerInfoEl) {
      const me = slotsPlayers.find(p => p.id === slotsMyId);
      playerInfoEl.textContent = (me?.nickname || '') + ': $' + (slotsChips ?? 0);
    }

    const spinBtn = document.querySelector('.slots-spin-btn');
    if (spinBtn) {
      const cost = totalSpinCost();
      spinBtn.disabled = slotsSpinning[slotsMyId] || (slotsChips || 0) < cost;
      spinBtn.textContent = `Spin $${cost}`;
    }

    const isSpinning = slotsSpinning[slotsMyId];
    const mult = getCostMultiplier();
    document.querySelectorAll('.slots-denom-btn').forEach((btn) => {
      btn.disabled = isSpinning;
      const base = parseInt(btn.dataset.bet, 10);
      if (base) btn.textContent = '$' + (base * mult);
    });
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

  function totalSpinCost() {
    return slotsBet * getCostMultiplier();
  }

  function spin() {
    if (slotsSpinning[slotsMyId] || (slotsChips || 0) < totalSpinCost()) return;
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
    send({ type: 'slotSpin', bet: validBet, rows: slotsRows });
  }

  function handleMessage(msg) {
    if (msg.type === 'slotSpinStarted') {
      if (typeof window !== 'undefined' && window.playSlotsSpin) window.playSlotsSpin();
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
      const grid = msg.grid || [reels];
      const rows = msg.rows || 1;
      const payout = msg.payout ?? 0;
      const multiplier = msg.multiplier ?? 0;
      const chips = msg.chips ?? 0;

      if (pid === slotsMyId) slotsChips = chips;
      const p = slotsPlayers.find((x) => x.id === pid);
      if (p) p.chips = chips;

      // Build grid columns: for each reel, collect symbols top-to-bottom
      const gridColumns = [];
      for (let c = 0; c < 3; c++) {
        const col = [];
        for (let r = 0; r < grid.length; r++) {
          col.push(grid[r][c]);
        }
        gridColumns.push(col);
      }

      const machine = getMachineEl(pid);
      if (machine) {
        const reelEls = machine.querySelectorAll('.slots-reel');
        for (let i = 0; i < 3; i++) {
          animateReelToSymbol(reelEls[i], reels[i] || '', i * REEL_STAGGER_MS, gridColumns[i]);
        }
        const resultEl = machine.querySelector('.slots-result');
        if (resultEl) {
          resultEl.textContent = 'Spinning...';
          resultEl.classList.remove('slots-result-win');
        }
      }

      const totalDuration = 2 * REEL_STAGGER_MS + getSpinDurationMs();
      slotsPendingResults[pid] = { reels, grid, gridColumns, payout, multiplier, totalDuration };
      setTimeout(() => {
        slotsSpinning[pid] = false;
        delete slotsPendingResults[pid];
        const m = getMachineEl(pid);
        if (m) {
          const reelEls = m.querySelectorAll('.slots-reel');
          for (let i = 0; i < 3; i++) {
            renderReel(reelEls[i], i, reels[i] || '', false, gridColumns[i]);
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
        if (multiplier === 50 && typeof window !== 'undefined' && window.playSwampJackpot) {
          window.playSwampJackpot();
        } else if (pid === slotsMyId && typeof window !== 'undefined') {
          if (payout > 0 && window.playWinner) window.playWinner();
          else if (window.playSlotsLose) window.playSlotsLose();
        }
        if (multiplier === 50 && typeof window !== 'undefined' && window.onSlotsJackpotReelsStopped) {
          window.onSlotsJackpotReelsStopped(pid);
        }
      }, totalDuration);
    }
  }

  function showConfigPopup(onDone) {
    const overlay = el('slots-config-overlay');
    if (!overlay) { onDone(); return; }
    overlay.classList.remove('hidden');

    const rowsGroup = el('slots-config-rows');
    const spinSlider = el('slots-config-spin-time');
    const spinValue = el('slots-config-spin-value');
    const startBtn = el('slots-config-start');
    const backBtn = el('slots-config-back');

    if (spinSlider) {
      spinSlider.value = slotsSpinDuration;
      if (spinValue) spinValue.textContent = slotsSpinDuration + 's';
    }
    if (rowsGroup) {
      rowsGroup.querySelectorAll('.slots-config-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.rows, 10) === slotsRows);
      });
    }

    function onRowClick(e) {
      const btn = e.target.closest('[data-rows]');
      if (!btn) return;
      slotsRows = parseInt(btn.dataset.rows, 10);
      localStorage.setItem('slots_rows', slotsRows);
      rowsGroup.querySelectorAll('.slots-config-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }

    function onSliderInput() {
      slotsSpinDuration = parseInt(spinSlider.value, 10);
      localStorage.setItem('slots_spin_time', slotsSpinDuration);
      if (spinValue) spinValue.textContent = slotsSpinDuration + 's';
    }

    function onStart() {
      cleanup();
      overlay.classList.add('hidden');
      slotsConfigured = true;
      onDone();
    }

    function onBack() {
      cleanup();
      overlay.classList.add('hidden');
      if (slotsWs && slotsWs.readyState === 1) {
        slotsWs.send(JSON.stringify({ type: 'backToLobby' }));
      }
    }

    function cleanup() {
      if (rowsGroup) rowsGroup.removeEventListener('click', onRowClick);
      if (spinSlider) spinSlider.removeEventListener('input', onSliderInput);
      if (startBtn) startBtn.removeEventListener('click', onStart);
      if (backBtn) backBtn.removeEventListener('click', onBack);
    }

    if (rowsGroup) rowsGroup.addEventListener('click', onRowClick);
    if (spinSlider) spinSlider.addEventListener('input', onSliderInput);
    if (startBtn) startBtn.addEventListener('click', onStart);
    if (backBtn) backBtn.addEventListener('click', onBack);
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

    showConfigPopup(() => {
      renderMachines();
    });
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
