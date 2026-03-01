const CARDS_BASE = '/cards';
const CHIPS_BASE = '/chips';
const SOUNDS_BASE = '/sounds';
const TURN_TIMEOUT_MS = 60 * 1000;

const SOUND_FILES = {
  shuffle: ['shuffle.wav', 'shuffle.mp3'],
  cardPutDown: ['card_put_down.wav', 'card put down.wav', 'card_put_down.mp3'],
  ambience: ['BACKGROUND_CASINO_AMBIENCE.wav', 'BACKGROUND_CASINO_AMBIENCE.mp3'],
  winner: ['winner.wav', 'winner together.wav', 'winner sound.wav', 'winner.mp3'],
  yourTurn: ['your_turn.wav', 'your turn.wav', 'your_turn.mp3'],
  betting: ['chips_betting.wav', 'chips_betting.mp3'],
  allIn: ['all_in.wav', 'all in.wav', 'all_in.mp3'],
  youLose: ['you_lose.wav', 'you lose.wav', 'you_lose.mp3'],
  check: ['check.wav', 'check.mp3'],
  smallClap: ['small clap.wav', 'small_clap.wav', 'small clap.mp3', 'small_clap.mp3'],
  mediumReaction: ['medium reaction.wav', 'medium_reaction.wav', 'medium reaction.mp3', 'medium_reaction.mp3'],
  bigReaction: ['big reaction.wav', 'big_reaction.wav', 'big reaction.mp3', 'big_reaction.mp3'],
};

function createSoundAudio(keys) {
  const a = new Audio();
  a.preload = 'auto';
  let idx = 0;
  const tryNext = () => {
    if (idx >= keys.length) return;
    a.src = SOUNDS_BASE + '/' + encodeURIComponent(keys[idx]);
    a.load();
    idx++;
  };
  a.addEventListener('error', tryNext);
  a.addEventListener('canplaythrough', () => { a._ready = true; });
  tryNext(); // start loading first file
  return a;
}

const soundShuffle = createSoundAudio(SOUND_FILES.shuffle);
const soundCardPutDown = createSoundAudio(SOUND_FILES.cardPutDown);
const soundAmbience = createSoundAudio(SOUND_FILES.ambience);
const soundWinner = createSoundAudio(SOUND_FILES.winner);
const soundYourTurn = createSoundAudio(SOUND_FILES.yourTurn);
const soundBetting = createSoundAudio(SOUND_FILES.betting);
const soundAllIn = createSoundAudio(SOUND_FILES.allIn);
const soundYouLose = createSoundAudio(SOUND_FILES.youLose);
const soundCheck = createSoundAudio(SOUND_FILES.check);
const soundSmallClap = createSoundAudio(SOUND_FILES.smallClap);
const soundMediumReaction = createSoundAudio(SOUND_FILES.mediumReaction);
const soundBigReaction = createSoundAudio(SOUND_FILES.bigReaction);

let audioCtx = null;
function playFallbackClick(vol = 0.3) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.05);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.1);
  } catch (_) {}
}

function playSound(audio, volumeKey) {
  let vol = 0.25;
  if (volumeKey) {
    const raw = parseInt(localStorage.getItem(volumeKey), 10);
    vol = (isNaN(raw) ? 80 : Math.max(0, Math.min(100, raw))) / 100;
  }
  audio.volume = Math.max(0, Math.min(1, vol));
  audio.currentTime = 0;
  audio.play().catch(() => playFallbackClick(vol));
}

function playShuffle() {
  playSound(soundShuffle, CARD_FX_VOLUME_KEY);
}

function playCardPutDown(delayMs = 0) {
  if (delayMs > 0) {
    setTimeout(() => playSound(soundCardPutDown, CARD_FX_VOLUME_KEY), delayMs);
  } else {
    playSound(soundCardPutDown, CARD_FX_VOLUME_KEY);
  }
}

function playWinner() {
  playSound(soundWinner, CARD_FX_VOLUME_KEY);
}

function playYourTurn() {
  playSound(soundYourTurn, CARD_FX_VOLUME_KEY);
}

function playBetting() {
  playSound(soundBetting, CARD_FX_VOLUME_KEY);
}

function playAllIn() {
  playSound(soundAllIn, CARD_FX_VOLUME_KEY);
}

function playYouLose() {
  playSound(soundYouLose, CARD_FX_VOLUME_KEY);
}

function playCheck() {
  playSound(soundCheck, CARD_FX_VOLUME_KEY);
}

function playSmallClap() {
  playSound(soundSmallClap, CARD_FX_VOLUME_KEY);
}

function playMediumReaction() {
  playSound(soundMediumReaction, CARD_FX_VOLUME_KEY);
}

function playBigReaction() {
  playSound(soundBigReaction, CARD_FX_VOLUME_KEY);
}

function startAmbience() {
  soundAmbience.loop = true;
  playSound(soundAmbience, AMBIENCE_VOLUME_KEY);
}

function stopAmbience() {
  soundAmbience.pause();
  soundAmbience.currentTime = 0;
}

const CHIP_DENOMS = [
  { value: 1000, color: 'gold' },
  { value: 500,  color: 'black' },
  { value: 100,  color: 'green' },
  { value: 50,   color: 'blue' },
  { value: 25,   color: 'red' },
  { value: 10,   color: 'white' },
  { value: 5,    color: 'purple' },
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

function renderChipIcons(amount, maxIcons = 8) {
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

function renderChipStack(amount, maxIcons = 4) {
  const breakdown = chipBreakdown(amount);
  const frag = document.createDocumentFragment();
  let total = 0;
  for (const { color, count } of breakdown) {
    if (total >= maxIcons) break;
    const img = document.createElement('img');
    img.className = 'chip-icon chip-stack';
    img.src = count >= 2 ? `${CHIPS_BASE}/${color}4.png` : `${CHIPS_BASE}/${color}.png`;
    img.alt = color;
    frag.appendChild(img);
    total++;
  }
  return frag;
}

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
const roomKeyInput = document.getElementById('room-key');
const nicknameInput = document.getElementById('nickname');
const playersContainer = document.getElementById('players-container');
const communityAreaEl = document.getElementById('community-area');
const boardCardsEl = document.getElementById('board-cards');
const winningHandRowEl = document.getElementById('winning-hand-row');
const winningHandCardsEl = document.getElementById('winning-hand-cards');
const tablePotEl = document.getElementById('table-pot');
const tablePotAmountEl = document.getElementById('table-pot-amount');
const tablePotChipsEl = document.getElementById('table-pot-chips');
const potInControls = document.getElementById('pot-in-controls');
const phaseLabel = document.getElementById('phase-label');
const handRankLabel = document.getElementById('hand-rank-label');
const turnTimerEl = document.getElementById('turn-timer');
const roomLabel = document.getElementById('room-label');
const startBtn = document.getElementById('start-btn');
const messageToast = document.getElementById('message-toast');
const showdownOverlay = document.getElementById('showdown-overlay');
const showdownTitle = document.getElementById('showdown-title');
const showdownBoardCards = document.getElementById('showdown-board-cards');
const showdownWinningCards = document.getElementById('showdown-winning-cards');
const showdownHands = document.getElementById('showdown-hands');
const showdownDismiss = document.getElementById('showdown-dismiss');

const btnFold = document.getElementById('btn-fold');
const btnCheck = document.getElementById('btn-check');
const btnCall = document.getElementById('btn-call');
const betAmountInput = document.getElementById('bet-amount');
const btnBet = document.getElementById('btn-bet');
const btnAllin = document.getElementById('btn-allin');

const radioBtn = document.getElementById('radio-btn');
const radioOverlay = document.getElementById('radio-overlay');
const radioCloseBtn = document.getElementById('radio-close');
const radioSearchInput = document.getElementById('radio-search');
const radioSearchBtn = document.getElementById('radio-search-btn');
const radioResults = document.getElementById('radio-results');
const radioStopBtn = document.getElementById('radio-stop');
const radioVolumeSlider = document.getElementById('radio-volume');
const radioVolumeValue = document.getElementById('radio-volume-value');
const cardFxVolumeSlider = document.getElementById('card-fx-volume');
const cardFxVolumeValue = document.getElementById('card-fx-volume-value');
const ambienceVolumeSlider = document.getElementById('ambience-volume');
const ambienceVolumeValue = document.getElementById('ambience-volume-value');
const nowPlayingRadio = document.getElementById('now-playing-radio');
const nowPlayingRadioLabel = document.getElementById('now-playing-radio-label');

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
let lastCommunityCards = null;
let lastHandName = null;
let lastWinningHoleIndices = [];
let lastPot = 0;
let lastWinnerNames = '';
let lastNetWon = 0;
let lastDidIFold = false;
let turnTimerInterval = null;
let prevTurnIdx = -1;
const CHAT_DURATION_MS = 8000;
const playerChatMessages = {};
const playerChatTimeouts = {};

const RADIO_API = 'https://de1.api.radio-browser.info/json/stations/search';
const radioAudio = new Audio();
let currentRadioName = '';
const RADIO_VOLUME_KEY = 'poker_radio_volume';
const CARD_FX_VOLUME_KEY = 'poker_card_fx_volume';
const AMBIENCE_VOLUME_KEY = 'poker_ambience_volume';

function doJoin() {
  const key = (roomKeyInput && roomKeyInput.value || '').trim();
  const nick = (nicknameInput && nicknameInput.value || '').trim();
  if (!key || !nick) {
    if (messageToast) { messageToast.textContent = 'Enter room key and nickname'; messageToast.classList.add('show'); setTimeout(() => messageToast.classList.remove('show'), 3000); }
    return;
  }
  join(key, nick);
}

const joinBtn = document.getElementById('join-btn');
if (joinBtn) joinBtn.addEventListener('click', (e) => { e.preventDefault(); doJoin(); });

if (roomKeyInput) roomKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doJoin(); } });
if (nicknameInput) nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doJoin(); } });

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

  ws.onclose = () => {
    showJoinScreen();
    showToast('Disconnected from server');
  };

  ws.onerror = () => {
    showToast('Connection failed - is the server running?');
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'joined':
      myId = msg.id;
      players = msg.players || [];
      gameState = msg.gameState;
      prevCommunityCount = 0;
      if (roomLabel) roomLabel.textContent = `Room: ${msg.roomKey}`;
      showGameScreen();
      try {
        renderTable();
        updateControls();
      } catch (err) {
        console.error('Render error:', err);
      }
      if (msg.radio) playRadio(msg.radio);
      initRadioVolume();
      break;

    case 'radioChanged':
      playRadio(msg.station);
      showToast(`${msg.nickname} tuned the radio to ${msg.station.name}`);
      break;

    case 'radioStopped':
      stopRadio();
      showToast(`${msg.nickname} stopped the radio`);
      break;

    case 'userJoined':
      players.push({
        id: msg.id,
        nickname: msg.nickname,
        chips: msg.chips ?? 1000,
        winStreak: msg.winStreak ?? 0,
        maxWinStreak: msg.maxWinStreak ?? 0,
      });
      renderTable();
      break;

    case 'userLeft':
      players = players.filter((p) => p.id !== msg.id);
      renderTable();
      break;

    case 'userRebuy':
      if (msg.players) {
        msg.players.forEach((p) => {
          const pl = players.find((x) => x.id === p.id);
          if (pl) pl.chips = p.chips;
        });
      }
      renderTable();
      updateControls();
      break;

    case 'gameStarted':
      playShuffle();
      lastWinningCards = null;
      lastWinnerNames = '';
      lastNetWon = 0;
      lastDidIFold = false;
      prevTurnIdx = -1;
      lastCommunityCards = null;
      lastHandName = null;
      lastWinningHoleIndices = [];
      lastPot = 0;
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
      gameState.facingAllIn = false;
      prevCommunityCount = oldCount;
      if (msg.turnIdx === -1) stopTurnTimer();
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
      if (msg.action === 'allin') playAllIn();
      else if (msg.action === 'check') playCheck();
      else if (['call', 'bet', 'raise'].includes(msg.action)) playBetting();
      if (msg.minRaise !== undefined && gameState) gameState.minRaise = msg.minRaise;
      if (msg.facingAllIn !== undefined && gameState) gameState.facingAllIn = msg.facingAllIn;
      if (msg.players) {
        msg.players.forEach((p) => {
          const pl = players.find((x) => x.id === p.id);
          if (pl) {
            pl.chips = p.chips;
            pl.betThisRound = p.betThisRound;
            pl.folded = p.folded;
            if (p.winStreak !== undefined) pl.winStreak = p.winStreak;
            if (p.maxWinStreak !== undefined) pl.maxWinStreak = p.maxWinStreak;
          }
        });
      }
      if (msg.pot !== undefined && gameState) gameState.pot = msg.pot;
      if (msg.currentBet !== undefined && gameState) gameState.currentBet = msg.currentBet;
      renderTable();
      updateControls();
      break;

    case 'turn':
      if (gameState) {
        gameState.turnIdx = msg.turnIdx;
        gameState.facingAllIn = msg.facingAllIn === true;
      }
      renderTable();
      updateControls();
      break;

    case 'gameOver': {
      stopTurnTimer();
      if (gameState) gameState.facingAllIn = false;
      const winByFold = msg.reason === 'fold';
      lastWinningCards = winByFold ? [] : (msg.winningCards || []);
      lastCommunityCards = msg.communityCards || [];
      lastHandName = winByFold ? null : (msg.handName || null);
      lastWinningHoleIndices = winByFold ? [] : (msg.winningHoleIndices || []);
      lastPot = msg.pot || 0;
      const goWinnerIds = msg.winners || (msg.winner ? [msg.winner] : []);
      const goWinnerNames = msg.winnerNicknames || (msg.winnerNickname ? [msg.winnerNickname] : []);
      const goWinAmount = msg.winAmount ?? msg.pot ?? 0;
      const goPot = msg.pot ?? 0;
      const goWinnerTotalBets = (msg.players || [])
        .filter((p) => goWinnerIds.includes(p.id))
        .reduce((sum, p) => sum + (p.totalBet ?? 0), 0);
      const goNetWon = Math.max(0, (goWinnerIds.length === 1 ? goWinAmount : goPot) - goWinnerTotalBets);
      if (msg.players) {
        msg.players.forEach((p) => {
          const pl = players.find((x) => x.id === p.id);
          if (pl) {
            pl.chips = p.chips;
            if (p.hand) pl.hand = p.hand;
            if (p.winStreak !== undefined) pl.winStreak = p.winStreak;
            if (p.maxWinStreak !== undefined) pl.maxWinStreak = p.maxWinStreak;
          }
        });
      }
      const goWinnerText = goWinnerNames.length ? goWinnerNames.join(', ') : 'Unknown';
      lastWinnerNames = goWinnerText;
      lastNetWon = goNetWon;
      const amIWinner = goWinnerIds.includes(myId);
      if (amIWinner) {
        playWinner();
        const me = players.find((p) => p.id === myId);
        const streak = me?.winStreak ?? 0;
        const playStreakSound = () => {
          if (streak >= 6) playBigReaction();
          else if (streak === 5) playMediumReaction();
          else if (streak === 3) playSmallClap();
        };
        if (streak >= 3) setTimeout(playStreakSound, 400);
      } else {
        playYouLose();
      }
      showShowdown(msg);
      gameState = null;
      renderTable();
      updateControls();
      break;
    }

    case 'rebuySuccess':
      if (msg.chips !== undefined) {
        const pl = players.find((p) => p.id === myId);
        if (pl) pl.chips = msg.chips;
      }
      renderTable();
      updateControls();
      break;

    case 'roundOver':
      stopTurnTimer();
      lastDidIFold = false;
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
            if (p.winStreak !== undefined) pl.winStreak = p.winStreak;
            if (p.maxWinStreak !== undefined) pl.maxWinStreak = p.maxWinStreak;
          }
        });
      }
      renderTable();
      updateControls();
      break;

    case 'chat':
      playerChatMessages[msg.playerId] = { text: msg.text, expiresAt: Date.now() + CHAT_DURATION_MS };
      if (playerChatTimeouts[msg.playerId]) clearTimeout(playerChatTimeouts[msg.playerId]);
      playerChatTimeouts[msg.playerId] = setTimeout(() => {
        delete playerChatMessages[msg.playerId];
        delete playerChatTimeouts[msg.playerId];
        renderTable();
      }, CHAT_DURATION_MS);
      renderTable();
      break;

    case 'error':
      showToast(msg.message || 'Error');
      break;
  }
}

function showJoinScreen() {
  if (joinScreen) joinScreen.classList.remove('hidden');
  if (gameScreen) gameScreen.classList.add('hidden');
  stopAmbience();
  Object.keys(playerChatTimeouts).forEach((id) => {
    clearTimeout(playerChatTimeouts[id]);
  });
  Object.keys(playerChatTimeouts).forEach((k) => delete playerChatTimeouts[k]);
  Object.keys(playerChatMessages).forEach((k) => delete playerChatMessages[k]);
  if (ws) ws.close();
  ws = null;
}

function showGameScreen() {
  if (joinScreen) joinScreen.classList.add('hidden');
  if (gameScreen) gameScreen.classList.remove('hidden');
  try { startAmbience(); } catch (_) {}
}

function showToast(text) {
  if (!messageToast) return;
  messageToast.textContent = text;
  messageToast.classList.add('show');
  setTimeout(() => { if (messageToast) messageToast.classList.remove('show'); }, 4000);
}

function showShowdown(msg) {
  const winText = msg.winnerNicknames?.join(', ') || msg.winnerNickname || 'Unknown';
  const handName = msg.handName || '';
  const winnerIds = msg.winners || (msg.winner ? [msg.winner] : []);
  const pot = msg.pot ?? 0;
  const winAmount = msg.winAmount ?? pot;
  const winnerTotalBets = (msg.players || [])
    .filter((p) => winnerIds.includes(p.id))
    .reduce((sum, p) => sum + (p.totalBet ?? 0), 0);
  const netWon = Math.max(0, (winnerIds.length === 1 ? winAmount : pot) - winnerTotalBets);

  const bannerEl = document.getElementById('showdown-winner-banner');
  if (bannerEl) bannerEl.textContent = `Winner: ${winText} (won $${netWon})`;

  let title = `${winText} won $${netWon}`;
  if (handName && msg.reason !== 'fold') title += ` with ${handName}`;
  if (msg.reason === 'fold') title += ' (all others folded)';
  showdownTitle.textContent = title;

  /* Board: all 5 community cards (hide section if preflop fold) */
  const communityCards = msg.communityCards || [];
  const boardSection = showdownBoardCards?.closest('.showdown-board-section');
  if (boardSection) boardSection.style.display = communityCards.length ? 'block' : 'none';
  const winningSection = document.querySelector('.showdown-winning-section');
  const showWinningSection = msg.reason !== 'fold' && !didIFold;
  if (winningSection) winningSection.style.display = showWinningSection ? 'block' : 'none';
  if (showdownBoardCards) {
    showdownBoardCards.innerHTML = '';
    communityCards.forEach((card) => {
      const div = document.createElement('div');
      div.className = 'card showdown-card';
      div.style.backgroundImage = `url(${cardImagePath(card)})`;
      showdownBoardCards.appendChild(div);
    });
  }

  /* Winning hand: 5 (or 2) cards, highlight hole cards - hidden when win by fold (cards mucked) */
  const winningCards = msg.reason === 'fold' ? [] : (msg.winningCards || []);
  const holeIndices = new Set(msg.winningHoleIndices || []);
  if (showdownWinningCards) {
    showdownWinningCards.innerHTML = '';
    winningCards.forEach((card, idx) => {
      const div = document.createElement('div');
      div.className = 'card showdown-card showdown-winning-card' + (holeIndices.has(idx) ? ' from-hole' : '');
      div.style.backgroundImage = `url(${cardImagePath(card)})`;
      div.title = holeIndices.has(idx) ? 'From player\'s hand' : 'From board';
      showdownWinningCards.appendChild(div);
    });
  }

  /* All hands: every player including folded. Hide winner's cards when viewer folded or when win by fold (mucked). */
  const winnerIdSet = new Set(winnerIds);
  if (showdownHands) {
    showdownHands.innerHTML = '';
    (msg.players || []).forEach((p) => {
      if (!p.hand?.length) return;
      const isWinner = winnerIdSet.has(p.id);
      if (isWinner && (didIFold || msg.reason === 'fold')) return;
      const badges = [];
      if (isWinner) badges.push('Winner');
      if (p.folded) badges.push('Folded');
      const badgeStr = badges.length ? ` (${badges.join(', ')})` : '';
      const row = document.createElement('div');
      row.className = 'showdown-hand-row' + (isWinner ? ' winner' : '') + (p.folded ? ' folded' : '');
      row.innerHTML = `<span class="showdown-player-name">${p.nickname || 'Player'}${badgeStr}</span>`;
      const cardsDiv = document.createElement('div');
      cardsDiv.className = 'showdown-hand-cards';
      p.hand.forEach((card) => {
        const div = document.createElement('div');
        div.className = 'card showdown-card' + (p.folded ? ' folded' : '');
        div.style.backgroundImage = `url(${cardImagePath(card)})`;
        cardsDiv.appendChild(div);
      });
      row.appendChild(cardsDiv);
      showdownHands.appendChild(row);
    });
  }

  showdownOverlay.classList.remove('hidden');
}

function hideShowdown() {
  showdownOverlay.classList.add('hidden');
}

function renderTable() {
  const pot = gameState?.pot ?? lastPot ?? 0;
  if (potInControls) {
    potInControls.innerHTML = '';
    const potText = document.createElement('span');
    potText.textContent = `Pot: $${pot}`;
    potInControls.appendChild(potText);
    if (pot > 0) {
      const potChips = document.createElement('span');
      potChips.className = 'pot-chips';
      potChips.appendChild(renderChipStack(pot, 4));
      potInControls.appendChild(potChips);
    }
  }
  if (tablePotAmountEl) tablePotAmountEl.textContent = `$${pot}`;
  if (tablePotChipsEl) {
    tablePotChipsEl.innerHTML = '';
    if (pot > 0) tablePotChipsEl.appendChild(renderChipStack(pot, 5));
  }
  phaseLabel.textContent = gameState?.phase ? gameState.phase.toUpperCase() : '';

  /* Board: all 5 community cards (or winning hand replaces during play) */
  boardCardsEl.innerHTML = '';
  const boardCards = lastWinningCards?.length
    ? (lastCommunityCards || [])
    : (gameState?.communityCards || []);
  boardCards.forEach((card, idx) => {
    const div = document.createElement('div');
    div.className = 'card';
    if (!lastWinningCards && idx >= prevCommunityCount) {
      div.classList.add('dealing');
      const delay = (idx - prevCommunityCount) * 0.12;
      div.style.animationDelay = `${delay}s`;
      playCardPutDown(delay * 1000);
    }
    div.style.backgroundImage = `url(${cardImagePath(card)})`;
    boardCardsEl.appendChild(div);
  });
  if (!lastWinningCards) prevCommunityCount = boardCards.length;

  const showWinningHand = lastWinningCards?.length && !lastDidIFold;

  /* Winner notification (persistent, above winning hand) - folded players see who won but not the cards */
  const winnerNotifEl = document.getElementById('winner-notification');
  if (winnerNotifEl) {
    if (lastWinnerNames) {
      const handPart = lastHandName ? ` with ${lastHandName}` : '';
      winnerNotifEl.textContent = `${lastWinnerNames} won $${lastNetWon}${handPart}`;
      winnerNotifEl.classList.remove('hidden');
    } else {
      winnerNotifEl.textContent = '';
      winnerNotifEl.classList.add('hidden');
    }
  }

  /* Winning hand row: only show to players who didn't fold */
  if (winningHandRowEl && winningHandCardsEl) {
    const labelEl = winningHandRowEl.querySelector('.winning-hand-label');
    const holeSet = new Set(lastWinningHoleIndices || []);
    if (showWinningHand) {
      winningHandRowEl.classList.remove('hidden');
      if (labelEl) labelEl.textContent = lastHandName ? `Winning hand: ${lastHandName}` : 'Winning hand';
      winningHandCardsEl.innerHTML = '';
      lastWinningCards.forEach((card, idx) => {
        const div = document.createElement('div');
        div.className = 'card winning-card' + (holeSet.has(idx) ? ' from-hole' : '');
        div.style.backgroundImage = `url(${cardImagePath(card)})`;
        div.title = holeSet.has(idx) ? 'From player\'s hand' : 'From board';
        winningHandCardsEl.appendChild(div);
      });
    } else {
      winningHandRowEl.classList.add('hidden');
    }
  }

  prevMyHandCount = myHand.length;

  playersContainer.innerHTML = '';
  const count = players.length;
  if (count === 0) return;

  const cx = 50;
  const cy = 50;
  const rx = 38;
  const ry = 30;
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
    const isPreflop = gameState?.phase === 'preflop';
    const dealerPos = gameState?.dealerIdx ?? 0;
    const sbIdx = count === 2 ? dealerPos : (count > 0 ? (dealerPos + 1) % count : -1);
    const bbIdx = count === 2 ? (dealerPos + 1) % count : (count > 0 ? (dealerPos + 2) % count : -1);
    const isSB = isPreflop && i === sbIdx;
    const isBB = isPreflop && i === bbIdx;
    const badge = isDealer ? ' (D)' : isBB ? ' (BB)' : isSB ? ' (SB)' : '';

    if (isTurn) seat.classList.add('is-turn');
    if (isDealer) seat.classList.add('is-dealer');

    const chatData = playerChatMessages[p.id];
    if (chatData && chatData.expiresAt > Date.now()) {
      const chatBubble = document.createElement('div');
      chatBubble.className = 'seat-chat-bubble';
      chatBubble.textContent = chatData.text;
      seat.appendChild(chatBubble);
    }

    const seatInfo = document.createElement('div');
    seatInfo.className = 'seat-info';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'seat-name';
    nameSpan.textContent = `${p.nickname || 'Player'}${badge}`;
    seatInfo.appendChild(nameSpan);
    const chipsSpan = document.createElement('span');
    chipsSpan.className = 'seat-chips';
    chipsSpan.textContent = `$${p.chips ?? 0}`;
    seatInfo.appendChild(chipsSpan);
    const winStreak = p.winStreak ?? 0;
    const maxWinStreak = p.maxWinStreak ?? 0;
    if (winStreak > 0 || maxWinStreak > 0) {
      const streakSpan = document.createElement('span');
      streakSpan.className = 'seat-streak';
      const parts = [];
      if (winStreak > 0) parts.push(`${winStreak}W`);
      if (maxWinStreak > 0) parts.push(`Best ${maxWinStreak}`);
      streakSpan.textContent = parts.join(' · ');
      seatInfo.appendChild(streakSpan);
    }
    if (p.folded) {
      const foldedSpan = document.createElement('span');
      foldedSpan.className = 'seat-folded';
      foldedSpan.textContent = 'Folded';
      seatInfo.appendChild(foldedSpan);
    }
    seat.appendChild(seatInfo);

    const chipStackDiv = document.createElement('div');
    chipStackDiv.className = 'seat-chip-stack';
    chipStackDiv.appendChild(renderChipIcons(p.chips ?? 0, 6));
    seat.appendChild(chipStackDiv);

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'player-cards';

    if (isMe && myHand.length > 0) {
      const seatDealing = myHand.length > (p._prevHandCount || 0);
      myHand.forEach((card, idx) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card' + (p.folded ? ' folded' : '');
        if (seatDealing && idx >= (p._prevHandCount || 0)) {
          cardEl.classList.add('dealing');
          const delay = idx * 0.15;
          cardEl.style.animationDelay = `${delay}s`;
          playCardPutDown(delay * 1000);
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
            const delay = idx * 0.15;
            cardEl.style.animationDelay = `${delay}s`;
            playCardPutDown(delay * 1000);
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

    if (p.betThisRound && p.betThisRound > 0) {
      const betChipsDiv = document.createElement('div');
      betChipsDiv.className = 'seat-bet';
      const betAmount = document.createElement('span');
      betAmount.className = 'seat-bet-amount';
      betAmount.textContent = `$${p.betThisRound}`;
      betChipsDiv.appendChild(betAmount);
      const chipsSpan = document.createElement('span');
      chipsSpan.className = 'seat-bet-chips';
      chipsSpan.appendChild(renderChipStack(p.betThisRound, 3));
      betChipsDiv.appendChild(chipsSpan);
      seat.appendChild(betChipsDiv);
    }

    playersContainer.appendChild(seat);
  });

  const canStart = players.length >= 2 && (!gameState || gameState.phase === 'lobby');
  startBtn.disabled = !canStart;
  startBtn.title = players.length < 2 ? 'Need 2 players to start' : '';
  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) {
    restartBtn.classList.toggle('hidden', !canStart);
    restartBtn.disabled = !canStart;
  }
  const waitingEl = document.getElementById('waiting-for-players');
  const addBotBtn = document.getElementById('add-bot-btn');
  if (waitingEl) {
    waitingEl.classList.toggle('hidden', players.length >= 2 || !!gameState);
    waitingEl.textContent = players.length === 1 ? 'Waiting for another player...' : 'Need 2 players to start';
  }
  if (addBotBtn) {
    const showAddBot = !gameState && players.length === 1;
    addBotBtn.classList.toggle('hidden', !showAddBot);
    addBotBtn.disabled = !showAddBot;
  }

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
  const turnIdx = gameState?.turnIdx ?? -1;
  const isMyTurn = gameState && turnIdx === myIdx;
  const me = players[myIdx];
  const folded = me?.folded;

  if (isMyTurn && turnIdx !== prevTurnIdx && !folded) {
    playYourTurn();
  }
  prevTurnIdx = turnIdx;

  if (isMyTurn && !folded && gameState?.phase && gameState.phase !== 'lobby') {
    startTurnTimer();
  } else {
    stopTurnTimer();
  }
  const myChips = me?.chips ?? 0;
  const currentBet = gameState?.currentBet || 0;
  const myBet = me?.betThisRound || 0;
  const toCall = currentBet - myBet;
  const pot = gameState?.pot ?? 0;
  const facingAllIn = gameState?.facingAllIn === true;
  const canCheck = !facingAllIn && (currentBet === 0 || myBet >= currentBet) && toCall <= 0;

  if (!gameState) {
    stopTurnTimer();
    prevTurnIdx = -1;
  }

  const canRebuy = !gameState && myChips <= 0;
  if (btnRebuy) {
    btnRebuy.classList.toggle('hidden', !canRebuy);
    btnRebuy.disabled = !canRebuy;
  }

  btnFold.disabled = !isMyTurn || folded;
  btnCheck.disabled = !isMyTurn || folded || !canCheck;
  btnCall.disabled = !isMyTurn || folded || toCall <= 0;
  const minRaise = gameState?.minRaise || 20;
  const minBetTo = currentBet > 0 ? currentBet + minRaise : minRaise;
  const canRaise = isMyTurn && !folded && myChips > 0;
  btnBet.disabled = !canRaise;
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

  betAmountInput.placeholder = `$${minRaise}`;
  betAmountInput.min = minRaise;
}

startBtn.addEventListener('click', () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'startGame', resetStreaks: true }));
});

const restartBtnEl = document.getElementById('restart-btn');
if (restartBtnEl) {
  restartBtnEl.addEventListener('click', () => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'startGame', resetStreaks: false }));
  });
}

const addBotBtnEl = document.getElementById('add-bot-btn');
if (addBotBtnEl) {
  addBotBtnEl.addEventListener('click', () => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'addBot' }));
  });
}

const btnRebuy = document.getElementById('btn-rebuy');
if (btnRebuy) {
  btnRebuy.addEventListener('click', () => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'rebuy' }));
  });
}

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
    const amt = Math.max(0, parseInt(betAmountInput.value, 10) || 0);
    const currentBet = gameState?.currentBet || 0;
    const action = currentBet > 0 ? 'raise' : 'bet';
    ws.send(JSON.stringify({ type: 'action', action, amount: amt }));
  }
});

const btnHalfPot = document.getElementById('btn-half-pot');
const btnFullPot = document.getElementById('btn-full-pot');
if (btnHalfPot) {
  btnHalfPot.addEventListener('click', () => {
    const pot = gameState?.pot ?? 0;
    const currentBet = gameState?.currentBet || 0;
    const minRaise = gameState?.minRaise || 20;
    const minBetTo = currentBet > 0 ? currentBet + minRaise : minRaise;
    const myChips = players.find((p) => p.id === myId)?.chips ?? 0;
    const halfPot = Math.floor(pot / 2);
    const amt = Math.min(myChips, Math.max(minBetTo, halfPot));
    betAmountInput.value = amt;
  });
}
if (btnFullPot) {
  btnFullPot.addEventListener('click', () => {
    const pot = gameState?.pot ?? 0;
    const currentBet = gameState?.currentBet || 0;
    const minRaise = gameState?.minRaise || 20;
    const minBetTo = currentBet > 0 ? currentBet + minRaise : minRaise;
    const myChips = players.find((p) => p.id === myId)?.chips ?? 0;
    const amt = Math.min(myChips, Math.max(minBetTo, pot));
    betAmountInput.value = amt;
  });
}

btnAllin.addEventListener('click', () => {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'action', action: 'allin' }));
  }
});

if (showdownDismiss) {
  showdownDismiss.addEventListener('click', hideShowdown);
}

/* ---------- Radio ---------- */
function playRadio(station) {
  if (!station?.url) return;
  radioAudio.src = station.url;
  radioAudio.play().catch(() => {});
  currentRadioName = station.name || 'Radio';
  if (nowPlayingRadio) nowPlayingRadio.classList.remove('hidden');
  if (nowPlayingRadioLabel) nowPlayingRadioLabel.textContent = '\u{1F4FB} ' + currentRadioName;
}

function stopRadio() {
  radioAudio.pause();
  radioAudio.src = '';
  currentRadioName = '';
  if (nowPlayingRadio) nowPlayingRadio.classList.add('hidden');
}

function initRadioVolume() {
  const saved = parseInt(localStorage.getItem(RADIO_VOLUME_KEY), 10);
  const vol = isNaN(saved) ? 80 : Math.max(0, Math.min(100, saved));
  radioAudio.volume = vol / 100;
  if (radioVolumeSlider) radioVolumeSlider.value = vol;
  if (radioVolumeValue) radioVolumeValue.textContent = vol + '%';

  const cardFx = parseInt(localStorage.getItem(CARD_FX_VOLUME_KEY), 10);
  const cardFxVol = isNaN(cardFx) ? 80 : Math.max(0, Math.min(100, cardFx));
  if (cardFxVolumeSlider) cardFxVolumeSlider.value = cardFxVol;
  if (cardFxVolumeValue) cardFxVolumeValue.textContent = cardFxVol + '%';

  const amb = parseInt(localStorage.getItem(AMBIENCE_VOLUME_KEY), 10);
  const ambVol = isNaN(amb) ? 25 : Math.max(0, Math.min(100, amb));
  if (ambienceVolumeSlider) ambienceVolumeSlider.value = ambVol;
  if (ambienceVolumeValue) ambienceVolumeValue.textContent = ambVol + '%';
}

function searchRadioStations(query) {
  if (!radioResults) return;
  radioResults.innerHTML = '<div class="radio-empty">Searching...</div>';
  const params = '?name=' + encodeURIComponent(query) + '&limit=25&order=votes&reverse=true&hidebroken=true';
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 10000);
  fetch(RADIO_API + params, { signal: ctrl.signal })
    .then((r) => r.json())
    .then((stations) => {
      radioResults.innerHTML = '';
      const secure = (stations || []).filter((st) => {
        const u = st.url_resolved || st.url;
        return u && u.startsWith('https');
      });
      if (!secure.length) {
        radioResults.innerHTML = '<div class="radio-empty">No stations found</div>';
        return;
      }
      secure.forEach((st) => {
        const url = st.url_resolved || st.url;
        const row = document.createElement('div');
        row.className = 'radio-station';
        const icon = document.createElement('img');
        icon.className = 'radio-station-icon';
        icon.src = st.favicon || '';
        icon.alt = '';
        icon.onerror = () => { icon.style.display = 'none'; };
        const info = document.createElement('div');
        info.className = 'radio-station-info';
        const name = document.createElement('div');
        name.className = 'radio-station-name';
        name.textContent = st.name;
        const meta = document.createElement('div');
        meta.className = 'radio-station-meta';
        meta.textContent = [st.country, st.tags].filter(Boolean).join(' \u00B7 ');
        info.appendChild(name);
        info.appendChild(meta);
        row.appendChild(icon);
        row.appendChild(info);
        row.addEventListener('click', () => {
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'changeRadio', station: { name: st.name, url } }));
          }
          radioOverlay?.classList.add('hidden');
        });
        radioResults.appendChild(row);
      });
    })
    .catch(() => {
      radioResults.innerHTML = '<div class="radio-empty">Search failed — try again</div>';
    });
}

if (radioBtn) radioBtn.addEventListener('click', () => {
  initRadioVolume();
  radioOverlay?.classList.remove('hidden');
  radioSearchInput?.focus();
});

if (radioCloseBtn) radioCloseBtn.addEventListener('click', () => radioOverlay?.classList.add('hidden'));

if (radioOverlay) radioOverlay.addEventListener('click', (e) => {
  if (e.target === radioOverlay) radioOverlay.classList.add('hidden');
});

if (radioSearchBtn) radioSearchBtn.addEventListener('click', () => {
  const q = radioSearchInput?.value?.trim();
  if (q) searchRadioStations(q);
});

if (radioSearchInput) radioSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const q = radioSearchInput.value.trim();
    if (q) searchRadioStations(q);
  }
});

if (radioStopBtn) radioStopBtn.addEventListener('click', () => {
  if (currentRadioName && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'stopRadio' }));
  }
});

if (radioVolumeSlider) radioVolumeSlider.addEventListener('input', () => {
  const v = parseInt(radioVolumeSlider.value, 10);
  radioAudio.volume = v / 100;
  localStorage.setItem(RADIO_VOLUME_KEY, v);
  if (radioVolumeValue) radioVolumeValue.textContent = v + '%';
});

if (cardFxVolumeSlider) cardFxVolumeSlider.addEventListener('input', () => {
  const v = parseInt(cardFxVolumeSlider.value, 10);
  localStorage.setItem(CARD_FX_VOLUME_KEY, v);
  if (cardFxVolumeValue) cardFxVolumeValue.textContent = v + '%';
});

if (ambienceVolumeSlider) ambienceVolumeSlider.addEventListener('input', () => {
  const v = parseInt(ambienceVolumeSlider.value, 10);
  soundAmbience.volume = v / 100;
  localStorage.setItem(AMBIENCE_VOLUME_KEY, v);
  if (ambienceVolumeValue) ambienceVolumeValue.textContent = v + '%';
});

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input?.value?.trim();
  if (!text || !ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type: 'chat', text }));
    input.value = '';
  } catch (e) {
    showToast('Failed to send message');
  }
}

const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
if (chatInput) {
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  });
}
if (chatSend) chatSend.addEventListener('click', sendChat);

const params = new URLSearchParams(window.location.search);
const roomParam = params.get('room');
if (roomParam) {
  roomKeyInput.value = roomParam;
  nicknameInput.focus();
}

initRadioVolume();
