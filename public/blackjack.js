(function () {
  'use strict';

  const CARDS_BASE = '/cards';
  const CHIPS_BASE = '/chips';
  const MIN_BET = 10;

  let bjWs = null;
  let bjMyId = null;
  let bjPlayers = [];
  let bjGameState = 'lobby';
  let bjDealerHand = [];
  let bjDealerTotal = 0;
  let bjRoomKey = '';
  let bjCurrentTurnId = null;
  let bjResultsData = null;

  function bjHandTotal(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
      if (c.rank === 'A') { aces++; total += 11; }
      else if (['K', 'Q', 'J'].includes(c.rank)) total += 10;
      else total += parseInt(c.rank, 10);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  }

  function cardImagePath(card) {
    if (!card) return `${CARDS_BASE}/empty.png`;
    if (card.hidden || card.suit === 'back') return `${CARDS_BASE}/backs/blue.png`;
    return `${CARDS_BASE}/${card.suit}/${card.rank}.png`;
  }

  function createCardEl(card) {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.backgroundImage = `url('${cardImagePath(card)}')`;
    div.style.backgroundSize = 'contain';
    div.style.backgroundRepeat = 'no-repeat';
    div.style.backgroundPosition = 'center';
    return div;
  }

  const CHIP_DENOMS = [
    { value: 1000, color: 'gold' },
    { value: 500, color: 'black' },
    { value: 100, color: 'green' },
    { value: 50, color: 'blue' },
    { value: 25, color: 'red' },
    { value: 10, color: 'white' },
    { value: 5, color: 'purple' },
  ];

  function chipBreakdown(amount) {
    const chips = [];
    let remaining = Math.abs(Math.floor(amount));
    for (const { value, color } of CHIP_DENOMS) {
      const count = Math.floor(remaining / value);
      if (count > 0) {
        chips.push({ color, count, value });
        remaining -= count * value;
      }
    }
    return chips;
  }

  function renderChipIcons(amount, maxIcons) {
    maxIcons = maxIcons || 6;
    const breakdown = chipBreakdown(amount);
    const frag = document.createDocumentFragment();
    let total = 0;
    for (const { color, count } of breakdown) {
      if (total >= maxIcons) break;
      if (count >= 3 && total + 1 <= maxIcons) {
        const img = document.createElement('img');
        img.className = 'chip-icon chip-stack';
        img.src = `${CHIPS_BASE}/${color}4.png`;
        img.alt = `${color} stack`;
        frag.appendChild(img);
        total++;
      } else {
        const show = Math.min(count, maxIcons - total);
        for (let i = 0; i < show; i++) {
          const img = document.createElement('img');
          img.className = 'chip-icon';
          img.src = `${CHIPS_BASE}/${color}.png`;
          img.alt = color;
          frag.appendChild(img);
          total++;
        }
      }
    }
    return frag;
  }

  function send(obj) {
    if (bjWs && bjWs.readyState === WebSocket.OPEN) {
      bjWs.send(JSON.stringify(obj));
    }
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setStatus(text) {
    const s = el('bj-status');
    if (s) s.textContent = text;
  }

  function me() {
    return bjPlayers.find(p => p.id === bjMyId);
  }

  // ── Rendering ──

  function renderDealer() {
    const container = el('bj-dealer-cards');
    const totalEl = el('bj-dealer-total');
    if (!container) return;
    container.innerHTML = '';

    for (const card of bjDealerHand) {
      container.appendChild(createCardEl(card));
    }

    if (totalEl) {
      const visibleCards = bjDealerHand.filter(c => !c.hidden);
      if (visibleCards.length > 0) {
        const t = bjHandTotal(visibleCards);
        totalEl.textContent = bjDealerHand.some(c => c.hidden) ? t + '' : t + '';
        totalEl.textContent = t;
      } else {
        totalEl.textContent = '';
      }
    }
  }

  function renderPlayers() {
    const area = el('bj-players-area');
    if (!area) return;
    area.innerHTML = '';

    for (const p of bjPlayers) {
      const row = document.createElement('div');
      row.className = 'bj-player-row';
      if (p.id === bjCurrentTurnId) row.classList.add('bj-active-turn');
      if (p.id === bjMyId) row.classList.add('bj-is-me');

      const nameEl = document.createElement('div');
      nameEl.className = 'bj-player-name';
      nameEl.textContent = p.nickname || p.id;
      row.appendChild(nameEl);

      const cardsEl = document.createElement('div');
      cardsEl.className = 'bj-player-cards';
      if (p.hand && p.hand.length) {
        for (const card of p.hand) {
          cardsEl.appendChild(createCardEl(card));
        }
      }
      row.appendChild(cardsEl);

      const infoEl = document.createElement('div');
      infoEl.className = 'bj-player-info';

      const totalSpan = document.createElement('span');
      totalSpan.className = 'bj-player-total';
      if (p.hand && p.hand.length) {
        totalSpan.textContent = bjHandTotal(p.hand);
      }
      infoEl.appendChild(totalSpan);

      if (p.bet) {
        const betSpan = document.createElement('span');
        betSpan.className = 'bj-player-bet';
        betSpan.textContent = `Bet: $${p.bet}`;
        const chipsFrag = renderChipIcons(p.bet, 4);
        betSpan.appendChild(chipsFrag);
        infoEl.appendChild(betSpan);
      }

      const chipsSpan = document.createElement('span');
      chipsSpan.className = 'bj-player-chips';
      chipsSpan.textContent = `$${p.chips}`;
      infoEl.appendChild(chipsSpan);

      if (p.status && p.status !== 'playing') {
        const statusSpan = document.createElement('span');
        statusSpan.className = 'bj-player-status bj-status-' + p.status;
        statusSpan.textContent = formatStatus(p.status);
        infoEl.appendChild(statusSpan);
      }

      row.appendChild(infoEl);
      area.appendChild(row);
    }
  }

  function formatStatus(status) {
    const labels = {
      busted: 'BUST',
      blackjack: 'BLACKJACK!',
      stood: 'STAND',
      won: 'WON',
      lost: 'LOST',
      push: 'PUSH',
    };
    return labels[status] || status.toUpperCase();
  }

  function renderAll() {
    renderDealer();
    renderPlayers();
    updateControls();
  }

  // ── Controls ──

  function updateControls() {
    const betControls = el('bj-bet-controls');
    const actionControls = el('bj-controls');
    const startBtn = el('bj-start-btn');
    const nextBtn = el('bj-next-btn');

    if (betControls) betControls.classList.add('hidden');
    if (actionControls) actionControls.classList.add('hidden');
    if (startBtn) startBtn.classList.add('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');

    if (bjGameState === 'lobby') {
      if (startBtn) startBtn.classList.remove('hidden');
    }

    if (bjGameState === 'results') {
      if (nextBtn) nextBtn.classList.remove('hidden');
    }

    if (bjGameState === 'betting') {
      const player = me();
      if (player && !player.bet) {
        if (betControls) betControls.classList.remove('hidden');
        const input = el('bj-bet-amount');
        if (input) {
          input.min = MIN_BET;
          input.max = player.chips;
          if (!input.value || parseInt(input.value, 10) < MIN_BET) {
            input.value = MIN_BET;
          }
        }
      }
    }

    if (bjGameState === 'playing' && bjCurrentTurnId === bjMyId) {
      if (actionControls) actionControls.classList.remove('hidden');
      const player = me();
      const doubleBtn = el('btn-bj-double');
      if (doubleBtn && player) {
        const canDouble = player.hand && player.hand.length === 2 && player.chips >= player.bet;
        doubleBtn.disabled = !canDouble;
      }
    }
  }

  function placeBet() {
    const input = el('bj-bet-amount');
    if (!input) return;
    const player = me();
    if (!player) return;
    let amount = parseInt(input.value, 10);
    if (isNaN(amount) || amount < MIN_BET) {
      setStatus(`Minimum bet is $${MIN_BET}`);
      return;
    }
    if (amount > player.chips) {
      amount = player.chips;
    }
    send({ type: 'bjBet', amount });
  }

  function doHit() {
    send({ type: 'bjAction', action: 'hit' });
  }

  function doStand() {
    send({ type: 'bjAction', action: 'stand' });
  }

  function doDouble() {
    send({ type: 'bjAction', action: 'double' });
  }

  // ── Message handling ──

  function handleMessage(msg) {
    switch (msg.type) {
      case 'bjJoined':
        bjMyId = msg.id || bjMyId;
        bjPlayers = (msg.players || []).map(normalizePlayer);
        bjGameState = 'lobby';
        bjDealerHand = [];
        bjDealerTotal = 0;
        bjCurrentTurnId = null;
        bjResultsData = null;
        if (msg.roomKey) bjRoomKey = msg.roomKey;
        const roomLabel = el('bj-room-label');
        if (roomLabel) roomLabel.textContent = `Blackjack - ${bjRoomKey}`;
        setStatus('Waiting for game to start...');
        renderAll();
        break;

      case 'bjGameStarted':
        bjGameState = 'betting';
        bjDealerHand = [];
        bjDealerTotal = 0;
        bjCurrentTurnId = null;
        bjResultsData = null;
        bjPlayers.forEach(p => {
          p.hand = [];
          p.bet = 0;
          p.total = 0;
          p.status = 'playing';
        });
        setStatus('Place your bets!');
        renderAll();
        break;

      case 'bjBetPlaced': {
        const bp = bjPlayers.find(p => p.id === msg.playerId);
        if (bp) {
          bp.bet = msg.bet;
          bp.chips = msg.chips;
        }
        renderAll();
        break;
      }

      case 'bjBetsPlaced':
        bjGameState = 'dealing';
        if (msg.players) {
          msg.players.forEach(mp => {
            const p = bjPlayers.find(x => x.id === mp.id);
            if (p) {
              p.bet = mp.bet;
              p.chips = mp.chips;
            }
          });
        }
        setStatus('Dealing cards...');
        renderAll();
        break;

      case 'bjDealt':
        bjGameState = 'playing';
        if (msg.players) {
          msg.players.forEach(mp => {
            const p = bjPlayers.find(x => x.id === mp.id);
            if (p) {
              p.hand = mp.hand || [];
              p.total = bjHandTotal(p.hand);
              if (mp.status) p.status = mp.status;
            }
          });
        }
        bjDealerHand = msg.dealerHand || [];
        bjDealerTotal = bjHandTotal(bjDealerHand.filter(c => !c.hidden));
        setStatus('Cards dealt!');
        renderAll();
        break;

      case 'bjYourTurn':
        bjCurrentTurnId = msg.playerId || bjMyId;
        bjGameState = 'playing';
        if (bjCurrentTurnId === bjMyId) {
          setStatus('Your turn - Hit, Stand, or Double?');
        } else {
          const turnPlayer = bjPlayers.find(p => p.id === bjCurrentTurnId);
          const name = turnPlayer ? turnPlayer.nickname : 'Opponent';
          setStatus(`${name}'s turn...`);
        }
        renderAll();
        break;

      case 'bjCardDealt': {
        const target = bjPlayers.find(p => p.id === msg.playerId);
        if (target) {
          if (msg.card) {
            target.hand = target.hand || [];
            target.hand.push(msg.card);
            target.total = bjHandTotal(target.hand);
          }
          if (msg.total !== undefined) target.total = msg.total;
          if (msg.status) target.status = msg.status;
          if (msg.bet !== undefined) target.bet = msg.bet;
          if (msg.chips !== undefined) target.chips = msg.chips;
        }
        if (msg.status === 'busted' && target) {
          const name = msg.playerId === bjMyId ? 'You' : (target.nickname || 'Player');
          setStatus(msg.playerId === bjMyId ? 'You busted!' : `${name} busted!`);
        }
        renderAll();
        break;
      }

      case 'bjPlayerResult': {
        const pr = bjPlayers.find(p => p.id === msg.playerId);
        if (pr) {
          pr.status = msg.status;
          if (msg.hand) pr.hand = msg.hand;
          pr.total = msg.total ?? bjHandTotal(pr.hand || []);
        }
        if (msg.status === 'busted') {
          const name = pr ? pr.nickname : 'Player';
          if (msg.playerId === bjMyId) {
            setStatus('You busted!');
          } else {
            setStatus(`${name} busted!`);
          }
        } else if (msg.status === 'blackjack') {
          const name = pr ? pr.nickname : 'Player';
          if (msg.playerId === bjMyId) {
            setStatus('Blackjack!');
          } else {
            setStatus(`${name} has Blackjack!`);
          }
        }
        renderAll();
        break;
      }

      case 'bjDealerTurn':
        bjGameState = 'dealerTurn';
        bjCurrentTurnId = null;
        if (msg.dealerHand) {
          bjDealerHand = msg.dealerHand;
          bjDealerTotal = bjHandTotal(bjDealerHand);
        }
        setStatus("Dealer's turn...");
        renderAll();
        break;

      case 'bjDealerCard':
        if (msg.card) {
          bjDealerHand.push(msg.card);
          bjDealerTotal = bjHandTotal(bjDealerHand);
        }
        if (msg.dealerHand) {
          bjDealerHand = msg.dealerHand;
          bjDealerTotal = bjHandTotal(bjDealerHand);
        }
        renderAll();
        break;

      case 'bjResults':
        bjGameState = 'results';
        bjCurrentTurnId = null;
        bjResultsData = msg;
        if (msg.dealerHand) {
          bjDealerHand = msg.dealerHand;
          bjDealerTotal = msg.dealerTotal ?? bjHandTotal(bjDealerHand);
        }
        if (msg.players) {
          msg.players.forEach(mp => {
            const p = bjPlayers.find(x => x.id === mp.id);
            if (p) {
              p.status = mp.status;
              p.chips = mp.chips;
              p.payout = mp.payout;
              if (mp.hand) p.hand = mp.hand;
              p.total = mp.total ?? bjHandTotal(p.hand || []);
            }
          });
        }
        buildResultsSummary();
        renderAll();
        break;

      case 'bjRoundOver':
        bjGameState = 'lobby';
        bjDealerHand = [];
        bjDealerTotal = 0;
        bjCurrentTurnId = null;
        bjResultsData = null;
        if (msg.players) {
          msg.players.forEach(mp => {
            const p = bjPlayers.find(x => x.id === mp.id);
            if (p) {
              p.chips = mp.chips;
              p.hand = [];
              p.bet = 0;
              p.status = 'playing';
              p.total = 0;
            }
          });
        }
        setStatus('Round over. Waiting for next game...');
        renderAll();
        break;

      case 'bjUserJoined': {
        const exists = bjPlayers.find(p => p.id === msg.id);
        if (!exists) {
          bjPlayers.push(normalizePlayer({ id: msg.id, nickname: msg.nickname, chips: msg.chips }));
        }
        renderAll();
        break;
      }

      case 'bjUserLeft':
        bjPlayers = bjPlayers.filter(p => p.id !== msg.id);
        renderAll();
        break;

      default:
        break;
    }
  }

  function normalizePlayer(p) {
    return {
      id: p.id,
      nickname: p.nickname || p.id,
      chips: p.chips ?? 1000,
      hand: p.hand || [],
      bet: p.bet || 0,
      total: p.total || 0,
      status: p.status || 'playing',
      payout: 0,
    };
  }

  function buildResultsSummary() {
    const player = me();
    if (!player) {
      setStatus('Round over!');
      return;
    }
    switch (player.status) {
      case 'won':
        setStatus(`You won $${player.payout || 0}!`);
        break;
      case 'blackjack':
        setStatus(`Blackjack! You won $${player.payout || 0}!`);
        break;
      case 'lost':
        setStatus('You lost.');
        break;
      case 'busted':
        setStatus('You busted!');
        break;
      case 'push':
        setStatus('Push - bet returned.');
        break;
      default:
        setStatus('Round over!');
    }
  }

  // ── Lifecycle ──

  function init(ws, myId, players, roomKey) {
    bjWs = ws;
    bjMyId = myId;
    bjPlayers = (players || []).map(normalizePlayer);
    bjRoomKey = roomKey || '';
    bjGameState = 'lobby';
    bjDealerHand = [];
    bjDealerTotal = 0;
    bjCurrentTurnId = null;
    bjResultsData = null;

    const roomLabelEl = el('bj-room-label');
    if (roomLabelEl) roomLabelEl.textContent = `Blackjack - ${bjRoomKey}`;

    bindEvents();
    setStatus('Waiting for game to start...');
    renderAll();
  }

  let eventsBound = false;

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    const betBtn = el('btn-bj-place-bet');
    if (betBtn) betBtn.addEventListener('click', placeBet);

    const hitBtn = el('btn-bj-hit');
    if (hitBtn) hitBtn.addEventListener('click', doHit);

    const standBtn = el('btn-bj-stand');
    if (standBtn) standBtn.addEventListener('click', doStand);

    const doubleBtn = el('btn-bj-double');
    if (doubleBtn) doubleBtn.addEventListener('click', doDouble);

    const betInput = el('bj-bet-amount');
    if (betInput) {
      betInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); placeBet(); }
      });
    }

    const startBtn = el('bj-start-btn');
    if (startBtn) startBtn.addEventListener('click', function () {
      send({ type: 'startGame', gameType: 'blackjack' });
    });

    const nextBtn = el('bj-next-btn');
    if (nextBtn) nextBtn.addEventListener('click', function () {
      send({ type: 'startGame', gameType: 'blackjack' });
    });
  }

  function show() {
    const screen = el('bj-screen');
    if (screen) screen.classList.remove('hidden');
  }

  function hide() {
    const screen = el('bj-screen');
    if (screen) screen.classList.add('hidden');
  }

  window.bjSetWs = function (ws) {
    bjWs = ws;
  };

  window.blackjack = { init, handleMessage, show, hide };
})();
