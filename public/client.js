const CARDS_BASE = '/cards';

function cardImagePath(card) {
  if (!card) return `${CARDS_BASE}/empty.png`;
  return `${CARDS_BASE}/${card.suit}/${card.rank}.png`;
}

function cardImagePathBack() {
  return `${CARDS_BASE}/backs/blue.png`;
}

const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const joinForm = document.getElementById('join-form');
const roomKeyInput = document.getElementById('room-key');
const nicknameInput = document.getElementById('nickname');
const playersContainer = document.getElementById('players-container');
const communityCardsEl = document.getElementById('community-cards');
const myCardsEl = document.getElementById('my-cards');
const potLabel = document.getElementById('pot-label');
const phaseLabel = document.getElementById('phase-label');
const roomLabel = document.getElementById('room-label');
const startBtn = document.getElementById('start-btn');
const messageToast = document.getElementById('message-toast');

const btnFold = document.getElementById('btn-fold');
const btnCheck = document.getElementById('btn-check');
const btnCall = document.getElementById('btn-call');
const betAmountInput = document.getElementById('bet-amount');
const btnBet = document.getElementById('btn-bet');
const btnRaise = document.getElementById('btn-raise');

let ws = null;
let myId = null;
let roomKey = null;
let nickname = '';
let players = [];
let myHand = [];
let gameState = null;

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
      const msg = JSON.parse(ev.data);
      handleMessage(msg);
    } catch (err) {
      console.error('Parse error:', err);
    }
  };

  ws.onclose = () => {
    showJoinScreen();
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'joined':
      myId = msg.id;
      players = msg.players || [];
      gameState = msg.gameState;
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
      gameState = {
        phase: msg.phase,
        communityCards: msg.communityCards || [],
        pot: msg.pot,
        currentBet: msg.currentBet,
        minRaise: msg.minRaise ?? 20,
        turnIdx: msg.turnIdx,
        dealerIdx: msg.dealerIdx,
      };
      players = msg.players || players;
      myHand = [];
      renderTable();
      updateControls();
      break;

    case 'yourHand':
      myHand = msg.hand || [];
      renderTable();
      break;

    case 'phaseChange':
      gameState = gameState || {};
      gameState.phase = msg.phase;
      gameState.communityCards = msg.communityCards || [];
      gameState.pot = msg.pot;
      gameState.currentBet = msg.currentBet;
      gameState.minRaise = msg.minRaise ?? 20;
      gameState.turnIdx = msg.turnIdx;
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
      gameState = null;
      if (msg.players) {
        msg.players.forEach((p) => {
          const pl = players.find((x) => x.id === p.id);
          if (pl) pl.chips = p.chips;
        });
      }
      const winnerText = msg.winnerNicknames
        ? msg.winnerNicknames.join(', ')
        : msg.winnerNickname || 'Unknown';
      showToast(`${winnerText} wins $${msg.winAmount || msg.pot}${msg.handName ? ` with ${msg.handName}` : ''}!`);
      renderTable();
      updateControls();
      break;

    case 'roundOver':
      gameState = null;
      myHand = [];
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
  setTimeout(() => messageToast.classList.remove('show'), 3000);
}

function renderTable() {
  potLabel.textContent = `Pot: $${(gameState?.pot || 0)}`;
  phaseLabel.textContent = gameState?.phase ? gameState.phase.charAt(0).toUpperCase() + gameState.phase.slice(1) : '';

  communityCardsEl.innerHTML = '';
  (gameState?.communityCards || []).forEach((card) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.backgroundImage = `url(${cardImagePath(card)})`;
    communityCardsEl.appendChild(div);
  });

  myCardsEl.innerHTML = '';
  myHand.forEach((card) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.backgroundImage = `url(${cardImagePath(card)})`;
    myCardsEl.appendChild(div);
  });

  playersContainer.innerHTML = '';
  const count = players.length;
  if (count === 0) return;

  const cx = 50;
  const cy = 50;
  const rx = 42;
  const ry = 38;
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

    const hand = p.hand || [];
    hand.forEach((card) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card' + (p.folded ? ' folded' : '');
      if (isMe || !p.folded) {
        cardEl.style.backgroundImage = `url(${cardImagePath(card)})`;
      } else {
        cardEl.style.backgroundImage = `url(${cardImagePathBack()})`;
      }
      cardsDiv.appendChild(cardEl);
    });

    if (hand.length === 0 && gameState && gameState.phase !== 'lobby') {
      [1, 2].forEach(() => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card back';
        cardsDiv.appendChild(cardEl);
      });
    }

    const info = document.createElement('div');
    info.className = 'player-info';
    info.innerHTML = `
      <span>${p.nickname || 'Player'}</span>
      <span class="chips">$${p.chips ?? 0}</span>
      ${p.betThisRound ? `<span>Bet: $${p.betThisRound}</span>` : ''}
      ${p.folded ? '<span style="color:#888">Folded</span>' : ''}
    `;

    seat.appendChild(cardsDiv);
    seat.appendChild(info);
    playersContainer.appendChild(seat);
  });

  const canStart = players.length >= 2 && (!gameState || gameState.phase === 'lobby');
  startBtn.disabled = !canStart;
}

function updateControls() {
  const myIdx = players.findIndex((p) => p.id === myId);
  const isMyTurn = gameState && gameState.turnIdx === myIdx;
  const me = players[myIdx];
  const folded = me?.folded;
  const currentBet = gameState?.currentBet || 0;
  const myBet = me?.betThisRound || 0;
  const toCall = currentBet - myBet;
  const canCheck = currentBet === 0 || myBet >= currentBet;

  btnFold.disabled = !isMyTurn || folded;
  btnCheck.disabled = !isMyTurn || folded || !canCheck;
  btnCall.disabled = !isMyTurn || folded || toCall <= 0;
  btnBet.disabled = !isMyTurn || folded;
  btnRaise.disabled = !isMyTurn || folded;

  if (toCall > 0) {
    btnCall.textContent = `Call $${toCall}`;
  } else {
    btnCall.textContent = 'Call';
  }

  const minRaise = gameState?.minRaise || 20;
  betAmountInput.placeholder = `Min $${minRaise}`;
  betAmountInput.min = minRaise;
}

startBtn.addEventListener('click', () => {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'startGame' }));
  }
});

btnFold.addEventListener('click', () => {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'action', action: 'fold' }));
  }
});

btnCheck.addEventListener('click', () => {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'action', action: 'check' }));
  }
});

btnCall.addEventListener('click', () => {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'action', action: 'call' }));
  }
});

btnBet.addEventListener('click', () => {
  if (ws && ws.readyState === 1) {
    const amt = parseInt(betAmountInput.value, 10) || 0;
    ws.send(JSON.stringify({ type: 'action', action: 'bet', amount: amt }));
  }
});

btnRaise.addEventListener('click', () => {
  if (ws && ws.readyState === 1) {
    const amt = parseInt(betAmountInput.value, 10) || 0;
    ws.send(JSON.stringify({ type: 'action', action: 'raise', amount: amt }));
  }
});

// URL params for room
const params = new URLSearchParams(window.location.search);
const roomParam = params.get('room');
if (roomParam) {
  roomKeyInput.value = roomParam;
  nicknameInput.focus();
}
