(function () {
  'use strict';

  const SLOTS_COST = 10;
  const SYMBOL_HEIGHT = 4;
  const SPIN_CYCLES = 8;
  const SPIN_DURATION_MS = 1800;
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
  let slotsSpinning = false;

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
    renderAll();
  }

  function hide() {
    const screen = el('slots-screen');
    if (screen) screen.classList.add('hidden');
  }

  function renderReel(reelIdx, symbolId, spinning) {
    const reelEl = el('slots-reel-' + reelIdx);
    if (!reelEl) return;
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

  function animateReelToSymbol(reelIdx, symbolId, delayMs) {
    const reelEl = el('slots-reel-' + reelIdx);
    if (!reelEl) return;
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
      strip.style.transition = `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.12, 0.9, 0.28, 1)`;
      strip.style.transform = `translateY(-${endOffset}rem)`;
    }, delayMs);
  }

  function renderAll() {
    const chipsEl = el('slots-chips-display');
    if (chipsEl) chipsEl.textContent = '$' + (slotsChips ?? 0);

    const spinBtn = el('slots-spin-btn');
    if (spinBtn) {
      spinBtn.disabled = slotsSpinning || (slotsChips || 0) < SLOTS_COST;
      spinBtn.textContent = 'Spin $' + SLOTS_COST;
    }
  }

  function spin() {
    if (slotsSpinning || (slotsChips || 0) < SLOTS_COST) return;
    slotsSpinning = true;
    for (let i = 0; i < 3; i++) {
      renderReel(i, null, true);
      const reelEl = el('slots-reel-' + i);
      if (reelEl) {
        const strip = reelEl.querySelector('.slots-reel-strip');
        if (strip) {
          strip.style.transition = `transform 80ms linear`;
          strip.style.transform = `translateY(-${SYMBOL_HEIGHT * SYMBOLS.length * 3}rem)`;
        }
      }
    }
    const resultEl = el('slots-result');
    if (resultEl) resultEl.textContent = 'Spinning...';
    renderAll();
    send({ type: 'slotSpin' });
  }

  function handleMessage(msg) {
    if (msg.type === 'slotResult') {
      const reels = msg.reels || [];
      const payout = msg.payout ?? 0;
      const chips = msg.chips ?? slotsChips;

      for (let i = 0; i < 3; i++) {
        const symbolId = reels[i] || '';
        animateReelToSymbol(i, symbolId, i * REEL_STAGGER_MS);
      }

      slotsChips = chips;
      const resultEl = el('slots-result');
      if (resultEl) {
        resultEl.textContent = 'Spinning...';
        resultEl.style.color = '#c9b896';
      }
      renderAll();

      const totalDuration = 2 * REEL_STAGGER_MS + SPIN_DURATION_MS;
      setTimeout(() => {
        slotsSpinning = false;
        for (let i = 0; i < 3; i++) {
          renderReel(i, reels[i] || '', false);
        }
        if (resultEl) {
          if (payout > 0) {
            resultEl.textContent = 'You won $' + payout + '!';
            resultEl.style.color = '#52b788';
          } else {
            resultEl.textContent = 'No win';
            resultEl.style.color = '#c9b896';
          }
        }
        renderAll();
        if (typeof window !== 'undefined') {
          if (payout > 0 && window.playWinner) window.playWinner();
          else if (payout === 0 && window.playYouLose) window.playYouLose();
        }
      }, totalDuration);
    }
  }

  function init(ws, myId, chips) {
    slotsWs = ws;
    slotsMyId = myId;
    slotsChips = chips ?? 0;
    for (let i = 0; i < 3; i++) {
      const reelEl = el('slots-reel-' + i);
      if (reelEl && !reelEl.querySelector('.slots-reel-strip')) {
        buildReelStrip(reelEl);
      }
      renderReel(i, '', false);
    }
    const resultEl = el('slots-result');
    if (resultEl) {
      resultEl.textContent = '';
      resultEl.style.color = '#c9b896';
    }
    renderAll();
  }

  function setChips(chips) {
    slotsChips = chips ?? 0;
    renderAll();
  }

  function bindEvents() {
    const spinBtn = el('slots-spin-btn');
    if (spinBtn) spinBtn.addEventListener('click', spin);
  }

  bindEvents();

  window.slots = {
    init,
    show,
    hide,
    handleMessage,
    setChips,
  };
})();
