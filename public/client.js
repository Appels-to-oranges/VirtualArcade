const CARDS_BASE = '/cards';
const TURN_TIMEOUT_MS = 60 * 1000;

function cardImagePath(card) {
  if (!card) return `${CARDS_BASE}/empty.png`;
  return `${CARDS_BASE}/${card.suit}/${card.rank}.png`;
}

function cardImagePathBack() {
  return `${CARDS_BASE}/backs/blue.png`;
}

function toSolverFormat(card) {
  const rankMap = { '10': 'T', 'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A' };
  const suitMap = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' };
  const r = rankMap[card.rank] || card.rank;
  const s = suitMap[card.suit] || 'h';
  return r + s;
}

function evaluateHand(holeCards, communityCards) {
  if (!holeCards?.length || !window.Hand) return null;
  const all = [...holeCards, ...(communityCards || [])];
  if (all.length < 5) return null;
  try {
    const cards = all.map(toSolverFormat);
    return window.Hand.solve(cards);
  } catch (e) {
    return null;
  }
}

const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const joinForm = document.getElementById('join-form');
const roomKeyInput = document.getElementById('room-key');
const nicknameInput = document.getElementById('nickname');
const playersContainer = document.getElementById('players-container');
const playersBarEl = document.getElementById('players-bar');
const communityCardsEl = document.getElementById('community-cards');
const myCardsEl = document.getElementById('my-cards');
const potInControls = document.getElementById('pot-in-controls');
const phaseLabel = document.getElementById('phase-label');
const handRankLabel = document.getElementById('hand-rank-label');
const turnTimerEl = document.getElementById('turn-timer');
const roomLabel = document.getElementById('room-label');
const startBtn = document.getElementById('start-btn');
const messageToast = document.getElementById('message-toast');
const showdownOverlay = document.getElementById('showdown-overlay');
const showdownTitle = document.getElementById('showdown-title');
const showdownWinningCards = document.getElementById('showdown-winning-cards');
const showdownCommunity = document.getElementById('showdown-community');
const showdownHands = document.getElementById('showdown-hands');
const showdownDismiss = document.getElementById('showdown-dismiss');

const btnFold = document.getElementById('btn-fold');
const btnCheck = document.getElementById('btn-check');
const btnCall = document.getElementById('btn-call');
const betAmountInput = document.getElementById('bet-amount');
const btnBet = document.getElementById('btn-bet');
const btnAllin = document.getElementById('btn-allin');

let ws = null;
let myId = null;
let roomKey = null;
let nickname = '';
let players = [];
let myHand = [];
let gameState = null;
let prevCommunityCount = 0;
let prevMyHandCount = 0;
let lastWinningCards = null;
let turnTimerInterval = null;

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const key = roomKeyInput.value.trim();
  const nick = nicknameInput.value.trim();
  if (!key || !nick) return;
  join(key, nick);
});

function join(key, nick) {
  roomKey = key;
  nickname = nick;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', roomKey, nickname }));
  };

  ws.onmessage = (ev) => {
    try {
      handleMessage(JSON.parse(ev.data));
    } catch (err) {
      console.error('Parse error:', err);
    }
  };

  ws.onclose = () => showJoinScreen();
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'joined':
      myId = msg.id;
      players = msg.players || [];
      gameState = msg.gameState;
      prevCommunityCount = 0;
      roomLabel.textContent = `Room: ${msg.roomKey}`;
      showGameScreen();
      renderTable();
      break;

    case 'userJoined':
      players.push({ id: msg.id, nickname: msg.nickname, chips: 1000 });
      renderTable();
      break;

    case 'userLeft':
      players = players.filter((p) => p.id !== msg.id);
      renderTable();
      break;

    case 'gameStarted':
      lastWinningCards = null;
      gameState = {
        phase: msg.phase,
        communityCards: [],
        pot: msg.pot,
        currentBet: msg.currentBet,
        minRaise: msg.minRaise ?? 20,
        turnIdx: msg.turnIdx,
        dealerIdx: msg.dealerIdx,
      };
      players = msg.players || players;
      players.forEach((p) => { p._prevHandCount = 0; });
      myHand = [];
      prevCommunityCount = 0;
      prevMyHandCount = 0;
      renderTable();
      updateControls();
      break;

    case 'yourHand':
      myHand = msg.hand || [];
      renderTable();
      break;

    case 'phaseChange': {
      gameState = gameState || {};
      const oldCount = (gameState.communityCards || []).length;
      gameState.phase = msg.phase;
      gameState.communityCards = msg.communityCards || [];
      gameState.pot = msg.pot;
      gameState.currentBet = msg.currentBet;
      gameState.minRaise = msg.minRaise ?? 20;
      gameState.turnIdx = msg.turnIdx;
      prevCommunityCount = oldCount;
      if (msg.players) {
        msg.players.forEach((p) => {
          const pl = players.find((x) => x.id === p.id);
          if (pl) {
            pl.chips = p.chips;
            pl.betThisRound = p.betThisRound;
            pl.folded = p.folded;
          }
        });
      }
      renderTable();
      updateControls();
      break;
    }

    case 'action':
      if (msg.minRaise !== undefined && gameState) gameState.minRaise = msg.minRaise;
      if (msg.players) {
        msg.players.forEach((p) => {
          const pl = players.find((x) => x.id === p.id);
          if (pl) {
            pl.chips = p.chips;
            pl.betThisRound = p.betThisRound;
            pl.folded = p.folded;
          }
        });
      }
      if (msg.pot !== undefined) gameState.pot = msg.pot;
      if (msg.currentBet !== undefined) gameState.currentBet = msg.currentBet;
      renderTable();
      updateControls();
      break;

    case 'turn':
      if (gameState) gameState.turnIdx = msg.turnIdx;
      renderTable();
      updateControls();
      break;

    case 'gameOver':
      lastWinningCards = msg.winningCards || [];
      if (msg.players) {
        msg.players.forEach((p) => {
          const pl = players.find((x) => x.id === p.id);
          if (pl) {
            pl.chips = p.chips;
            if (p.hand) pl.hand = p.hand;
          }
        });
      }
      const winnerText = msg.winnerNicknames
        ? msg.winnerNicknames.join(', ')
        : msg.winnerNickname || 'Unknown';
      showToast(`${winnerText} wins $${msg.winAmount || msg.pot}${msg.handName ? ` with ${msg.handName}` : ''}!`);
      showShowdown(msg);
      gameState = null;
      renderTable();
      updateControls();
      break;

    case 'roundOver':
      hideShowdown();
      gameState = null;
      myHand = [];
      prevCommunityCount = 0;
      if (msg.players) {
        msg.players.forEach((p) => {
          const pl = players.find((x) => x.id === p.id);
          if (pl) {
            pl.chips = p.chips;
            pl.hand = null;
            pl.folded = false;
            pl.betThisRound = 0;
          }
        });
      }
      renderTable();
      updateControls();
      break;

    case 'error':
      showToast(msg.message || 'Error');
      break;
  }
}

function showJoinScreen() {
  joinScreen.classList.remove('hidden');
  gameScreen.classList.add('hidden');
  if (ws) ws.close();
  ws = null;
}

function showGameScreen() {
  joinScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
}

function showToast(text) {
  messageToast.textContent = text;
  messageToast.classList.add('show');
  setTimeout(() => messageToast.classList.remove('show'), 4000);
}

function showShowdown(msg) {
  const winText = msg.winnerNicknames?.join(', ') || msg.winnerNickname || 'Unknown';
  const handName = msg.handName || '';
  const winAmount = msg.winAmount ?? msg.pot ?? 0;

  let title = `${winText} wins $${winAmount}`;
  if (handName) title += ` with ${handName}`;
  if (msg.reason === 'fold') title += ' (all others folded)';
  showdownTitle.textContent = title;

  const winningCards = msg.winningCards || [];
  const winningLabel = document.querySelector('.showdown-winning-label');
  if (winningLabel) {
    winningLabel.textContent = winningCards.length === 5 ? 'Winning hand (5 cards)' : winningCards.length > 0 ? 'Winner\'s cards' : '';
    winningLabel.style.display = winningCards.length ? 'block' : 'none';
  }
  showdownWinningCards.innerHTML = '';
  winningCards.forEach((card) => {
    const div = document.createElement('div');
    div.className = 'card showdown-card showdown-winning-card';
    div.style.backgroundImage = `url(${cardImagePath(card)})`;
    showdownWinningCards.appendChild(div);
  });

  showdownCommunity.innerHTML = '';
  (msg.communityCards || []).forEach((card) => {
    const div = document.createElement('div');
    div.className = 'card showdown-card';
    div.style.backgroundImage = `url(${cardImagePath(card)})`;
    showdownCommunity.appendChild(div);
  });

  const winnerIds = new Set(msg.winners || (msg.winner ? [msg.winner] : []));
  showdownHands.innerHTML = '';
  (msg.players || []).forEach((p) => {
    if (!p.hand?.length) return;
    const isWinner = winnerIds.has(p.id);
    const row = document.createElement('div');
    row.className = 'showdown-hand-row' + (isWinner ? ' winner' : '');
    row.innerHTML = `<span class="showdown-player-name">${p.nickname || 'Player'}${isWinner ? ' (Winner)' : ''}</span>`;
    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'showdown-hand-cards';
    p.hand.forEach((card) => {
      const div = document.createElement('div');
      div.className = 'card showdown-card';
      div.style.backgroundImage = `url(${cardImagePath(card)})`;
      cardsDiv.appendChild(div);
    });
    row.appendChild(cardsDiv);
    showdownHands.appendChild(row);
  });

  showdownOverlay.classList.remove('hidden');
}

function hideShowdown() {
  showdownOverlay.classList.add('hidden');
}

function renderTable() {
  const pot = gameState?.pot || 0;
  if (potInControls) potInControls.textContent = `Pot: $${pot}`;
  phaseLabel.textContent = gameState?.phase ? gameState.phase.toUpperCase() : '';

  communityCardsEl.innerHTML = '';
  const cards = lastWinningCards?.length
    ? lastWinningCards
    : (gameState?.communityCards || []);
  cards.forEach((card, idx) => {
    const div = document.createElement('div');
    div.className = 'card';
    if (!lastWinningCards && idx >= prevCommunityCount) {
      div.classList.add('dealing');
      div.style.animationDelay = `${(idx - prevCommunityCount) * 0.12}s`;
    }
    div.style.backgroundImage = `url(${cardImagePath(card)})`;
    communityCardsEl.appendChild(div);
  });
  if (!lastWinningCards) prevCommunityCount = cards.length;

  myCardsEl.innerHTML = '';
  const myHandDealing = myHand.length > prevMyHandCount;
  myHand.forEach((card, idx) => {
    const div = document.createElement('div');
    div.className = 'card';
    if (myHandDealing && idx >= prevMyHandCount) {
      div.classList.add('dealing');
      div.style.animationDelay = `${idx * 0.15}s`;
    }
    div.style.backgroundImage = `url(${cardImagePath(card)})`;
    myCardsEl.appendChild(div);
  });
  prevMyHandCount = myHand.length;

  playersContainer.innerHTML = '';
  const count = players.length;
  if (count === 0) return;

  const cx = 50;
  const cy = 50;
  const rx = 42;
  const ry = 34;
  const myPosIdx = players.findIndex((p) => p.id === myId);
  const offset = myPosIdx >= 0 ? Math.PI / 2 - (myPosIdx / count) * Math.PI * 2 : 0;

  players.forEach((p, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2 + offset;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);

    const seat = document.createElement('div');
    seat.className = 'player-seat';
    seat.style.left = `${x}%`;
    seat.style.top = `${y}%`;
    seat.style.transform = 'translate(-50%, -50%)';

    const isMe = p.id === myId;
    const isTurn = gameState && gameState.turnIdx === i;
    const isDealer = gameState && gameState.dealerIdx === i;

    if (isTurn) seat.classList.add('is-turn');
    if (isDealer) seat.classList.add('is-dealer');

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'player-cards';

    if (isMe && myHand.length > 0) {
      const seatDealing = myHand.length > (p._prevHandCount || 0);
      myHand.forEach((card, idx) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card' + (p.folded ? ' folded' : '');
        if (seatDealing && idx >= (p._prevHandCount || 0)) {
          cardEl.classList.add('dealing');
          cardEl.style.animationDelay = `${idx * 0.15}s`;
        }
        cardEl.style.backgroundImage = `url(${cardImagePath(card)})`;
        cardsDiv.appendChild(cardEl);
      });
      p._prevHandCount = myHand.length;
    } else {
      const hand = p.hand || [];
      const seatDealing = hand.length > (p._prevHandCount || 0);
      if (hand.length > 0) {
        hand.forEach((card, idx) => {
          const cardEl = document.createElement('div');
          cardEl.className = 'card' + (p.folded ? ' folded' : '');
          if (seatDealing && idx >= (p._prevHandCount || 0)) {
            cardEl.classList.add('dealing');
            cardEl.style.animationDelay = `${idx * 0.15}s`;
          }
          cardEl.style.backgroundImage = `url(${cardImagePath(card)})`;
          cardsDiv.appendChild(cardEl);
        });
        p._prevHandCount = hand.length;
      } else if (gameState && gameState.phase !== 'lobby' && !p.folded) {
        [1, 2].forEach(() => {
          const cardEl = document.createElement('div');
          cardEl.className = 'card back';
          cardsDiv.appendChild(cardEl);
        });
      }
    }

    seat.appendChild(cardsDiv);
    playersContainer.appendChild(seat);
  });

  /* Players bar (names/chips off table) */
  if (playersBarEl) {
    playersBarEl.innerHTML = '';
    players.forEach((p, i) => {
      const chip = document.createElement('div');
      chip.className = 'player-chip';
      const isTurn = gameState && gameState.turnIdx === i;
      const isDealer = gameState && gameState.dealerIdx === i;
      if (isTurn) chip.classList.add('is-turn');
      let html = `<span class="player-name">${p.nickname || 'Player'}${isDealer ? ' (D)' : ''}</span>`;
      html += `<span class="chips">$${p.chips ?? 0}</span>`;
      if (p.betThisRound) html += `<span class="bet-label">Bet: $${p.betThisRound}</span>`;
      if (p.folded) html += `<span class="folded-label">Folded</span>`;
      chip.innerHTML = html;
      playersBarEl.appendChild(chip);
    });
  }

  const canStart = players.length >= 2 && (!gameState || gameState.phase === 'lobby');
  startBtn.disabled = !canStart;

  const handRank = evaluateHand(myHand, gameState?.communityCards);
  if (handRankLabel) {
    const text = handRank ? (handRank.descr || handRank.name) : '';
    handRankLabel.textContent = text;
    handRankLabel.style.display = text ? 'block' : 'none';
  }
}

function startTurnTimer() {
  stopTurnTimer();
  let remaining = TURN_TIMEOUT_MS / 1000;
  if (turnTimerEl) {
    turnTimerEl.classList.remove('hidden');
    turnTimerEl.textContent = `${remaining}s`;
  }
  turnTimerInterval = setInterval(() => {
    remaining--;
    if (turnTimerEl) turnTimerEl.textContent = `${remaining}s`;
    if (remaining <= 0) stopTurnTimer();
  }, 1000);
}

function stopTurnTimer() {
  if (turnTimerInterval) {
    clearInterval(turnTimerInterval);
    turnTimerInterval = null;
  }
  if (turnTimerEl) turnTimerEl.classList.add('hidden');
}

function updateControls() {
  const myIdx = players.findIndex((p) => p.id === myId);
  const isMyTurn = gameState && gameState.turnIdx === myIdx;
  const me = players[myIdx];
  const folded = me?.folded;

  if (isMyTurn && !folded) {
    startTurnTimer();
  } else {
    stopTurnTimer();
  }
  const myChips = me?.chips ?? 0;
  const currentBet = gameState?.currentBet || 0;
  const myBet = me?.betThisRound || 0;
  const toCall = currentBet - myBet;
  const canCheck = currentBet === 0 || myBet >= currentBet;

  if (!gameState) stopTurnTimer();

  btnFold.disabled = !isMyTurn || folded;
  btnCheck.disabled = !isMyTurn || folded || !canCheck;
  btnCall.disabled = !isMyTurn || folded || toCall <= 0;
  btnBet.disabled = !isMyTurn || folded || myChips <= 0;
  btnAllin.disabled = !isMyTurn || folded || myChips <= 0;

  if (toCall > 0) {
    btnCall.textContent = `Call $${toCall}`;
  } else {
    btnCall.textContent = 'Call';
  }

  if (currentBet > 0) {
    btnBet.textContent = 'Raise';
  } else {
    btnBet.textContent = 'Bet';
  }

  btnAllin.textContent = `All In $${myChips}`;

  const minRaise = gameState?.minRaise || 20;
  betAmountInput.placeholder = `$${minRaise}`;
  betAmountInput.min = minRaise;
}

startBtn.addEventListener('click', () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'startGame' }));
});

btnFold.addEventListener('click', () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'action', action: 'fold' }));
});

btnCheck.addEventListener('click', () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'action', action: 'check' }));
});

btnCall.addEventListener('click', () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'action', action: 'call' }));
});

btnBet.addEventListener('click', () => {
  if (ws && ws.readyState === 1) {
    const amt = parseInt(betAmountInput.value, 10) || 0;
    const currentBet = gameState?.currentBet || 0;
    const action = currentBet > 0 ? 'raise' : 'bet';
    ws.send(JSON.stringify({ type: 'action', action, amount: amt }));
  }
});

btnAllin.addEventListener('click', () => {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'action', action: 'allin' }));
  }
});

if (showdownDismiss) {
  showdownDismiss.addEventListener('click', hideShowdown);
}

const params = new URLSearchParams(window.location.search);
const roomParam = params.get('room');
if (roomParam) {
  roomKeyInput.value = roomParam;
  nicknameInput.focus();
}
