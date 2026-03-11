const CARDS_BASE = '/cards';
const CHIPS_BASE = '/chips';
const SOUNDS_BASE = '/sounds';
const TURN_TIMEOUT_MS = 60 * 1000;

const SOUND_FILES = {
  shuffle: ['shuffle.wav', 'shuffle.mp3'],
  cardPutDown: ['card_put_down.wav', 'card put down.wav', 'card_put_down.mp3'],
  ambience: ['BACKGROUND_CASINO_AMBIENCE.wav', 'BACKGROUND_CASINO_AMBIENCE.mp3'],
  ambienceFireplace: ['fireplace.wav'],
  ambienceRain: ['RAIN_AMBIENCE.wav'],
  ambienceSwamp: ['SWAMP_AMBIENCE.wav', 'SWAMP_AMBIENCE.mp3'],
  swampJackpot: ['swamp_jackpot.wav', 'swamp_jackpot.mp3'],
  slotsLose: ['slots_lose.wav', 'slots_lose.mp3'],
  winner: ['winner.wav', 'winner together.wav', 'winner sound.wav', 'winner.mp3'],
  yourTurn: ['your_turn.wav', 'your turn.wav', 'your_turn.mp3'],
  betting: ['chips_betting.wav', 'chips_betting.mp3'],
  allIn: ['all_in.wav', 'all in.wav', 'all_in.mp3'],
  youLose: ['you_lose.wav', 'you lose.wav', 'you_lose.mp3'],
  check: ['check.wav', 'check.mp3'],
  smallClap: ['small clap.wav', 'small_clap.wav', 'small clap.mp3', 'small_clap.mp3'],
  mediumReaction: ['medium reaction.wav', 'medium_reaction.wav', 'medium reaction.mp3', 'medium_reaction.mp3'],
  bigReaction: ['big reaction.wav', 'big_reaction.wav', 'big reaction.mp3', 'big_reaction.mp3'],
  winCheckersChess: ['win_checkers or chess.wav'],
  loseCheckersChess: ['lose_checkers or chess.wav'],
  botEliminated: ['Bot_eliminated.wav'],
  selectPiece: ['checkers or chess select piece.mp3'],
  chessPiecePlace: ['chess_piece_place.wav'],
  piecePlaceCheckers: ['piece_place checkers.wav'],
  chooseGame: ['choose game coin sound.wav'],
  messageNotification: ['message notification.wav'],
  playerJoinRoom: ['player join room.wav'],
  playerJoinsGame: ['player or bot joins game.wav'],
  rebuy: ['re-buy.wav'],
  sendMessage: ['send message.wav'],
  timeLowAlert: ['time_low_alert.wav'],
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
const soundAmbienceFireplace = createSoundAudio(SOUND_FILES.ambienceFireplace);
const soundAmbienceRain = createSoundAudio(SOUND_FILES.ambienceRain);
const soundAmbienceSwamp = createSoundAudio(SOUND_FILES.ambienceSwamp);
const soundSwampJackpot = createSoundAudio(SOUND_FILES.swampJackpot);
const soundSlotsLose = createSoundAudio(SOUND_FILES.slotsLose);
const soundWinner = createSoundAudio(SOUND_FILES.winner);
const soundYourTurn = createSoundAudio(SOUND_FILES.yourTurn);
const soundBetting = createSoundAudio(SOUND_FILES.betting);
const soundAllIn = createSoundAudio(SOUND_FILES.allIn);
const soundYouLose = createSoundAudio(SOUND_FILES.youLose);
const soundCheck = createSoundAudio(SOUND_FILES.check);
const soundSmallClap = createSoundAudio(SOUND_FILES.smallClap);
const soundMediumReaction = createSoundAudio(SOUND_FILES.mediumReaction);
const soundBigReaction = createSoundAudio(SOUND_FILES.bigReaction);
const soundWinCheckersChess = createSoundAudio(SOUND_FILES.winCheckersChess);
const soundLoseCheckersChess = createSoundAudio(SOUND_FILES.loseCheckersChess);
const soundBotEliminated = createSoundAudio(SOUND_FILES.botEliminated);
const soundSelectPiece = createSoundAudio(SOUND_FILES.selectPiece);
const soundChessPiecePlace = createSoundAudio(SOUND_FILES.chessPiecePlace);
const soundPiecePlaceCheckers = createSoundAudio(SOUND_FILES.piecePlaceCheckers);
const soundChooseGame = createSoundAudio(SOUND_FILES.chooseGame);
const soundMessageNotification = createSoundAudio(SOUND_FILES.messageNotification);
const soundPlayerJoinRoom = createSoundAudio(SOUND_FILES.playerJoinRoom);
const soundPlayerJoinsGame = createSoundAudio(SOUND_FILES.playerJoinsGame);
const soundRebuy = createSoundAudio(SOUND_FILES.rebuy);
const soundSendMessage = createSoundAudio(SOUND_FILES.sendMessage);
const soundTimeLowAlert = createSoundAudio(SOUND_FILES.timeLowAlert);

let audioCtx = null;
const SFX_BITDEPTH_KEY = 'arcade_sfx_bitdepth';

function getSfxBitDepth() {
  const raw = localStorage.getItem(SFX_BITDEPTH_KEY);
  if (raw === '8' || raw === '12' || raw === '16') return parseInt(raw, 10);
  return 0;
}

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function ensureAudioBuffer(audio) {
  if (audio._decodedBuffer) return Promise.resolve(audio._decodedBuffer);
  if (audio._bufferLoading) return audio._bufferLoading;
  const url = audio.src;
  if (!url) return Promise.resolve(null);
  audio._bufferLoading = fetch(url)
    .then(r => r.arrayBuffer())
    .then(buf => getAudioCtx().decodeAudioData(buf))
    .then(decoded => { audio._decodedBuffer = decoded; return decoded; })
    .catch(() => { audio._bufferLoading = null; return null; });
  return audio._bufferLoading;
}

function bitCrushBuffer(buffer, bitDepth) {
  const ctx = getAudioCtx();
  const crushed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const levels = Math.pow(2, bitDepth - 1);
  const hold = bitDepth <= 8 ? 6 : bitDepth <= 12 ? 3 : 1;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const output = crushed.getChannelData(ch);
    let held = 0;
    for (let i = 0; i < input.length; i++) {
      if (i % hold === 0) held = Math.round(input[i] * levels) / levels;
      output[i] = held;
    }
  }
  return crushed;
}

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

function playSoundBitCrushed(audio, vol, bitDepth) {
  ensureAudioBuffer(audio).then(buffer => {
    if (!buffer) {
      audio.volume = vol;
      audio.currentTime = 0;
      audio.play().catch(() => playFallbackClick(vol));
      return;
    }
    const ctx = getAudioCtx();
    const crushed = bitCrushBuffer(buffer, bitDepth);
    const source = ctx.createBufferSource();
    source.buffer = crushed;
    const gainNode = ctx.createGain();
    gainNode.gain.value = vol;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(0);
  });
}

function playSfx(audio, vol) {
  vol = Math.max(0, Math.min(1, vol));
  const bitDepth = getSfxBitDepth();
  if (bitDepth > 0) {
    playSoundBitCrushed(audio, vol, bitDepth);
    return;
  }
  audio.volume = vol;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function playSound(audio, volumeKey) {
  let vol = 0.25;
  if (volumeKey) {
    const raw = parseInt(localStorage.getItem(volumeKey), 10);
    vol = (isNaN(raw) ? 80 : Math.max(0, Math.min(100, raw))) / 100;
  }
  vol = Math.max(0, Math.min(1, vol));
  const bitDepth = getSfxBitDepth();
  if (bitDepth > 0 && volumeKey !== AMBIENCE_VOLUME_KEY && volumeKey !== RADIO_VOLUME_KEY) {
    playSoundBitCrushed(audio, vol, bitDepth);
    return;
  }
  audio.volume = vol;
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

function playWinCheckersChess() {
  playSound(soundWinCheckersChess, CARD_FX_VOLUME_KEY);
}

function playSwampJackpot() {
  playSound(soundSwampJackpot, CARD_FX_VOLUME_KEY);
}

function playSlotsLose() {
  playSound(soundSlotsLose, CARD_FX_VOLUME_KEY);
}

function playLoseCheckersChess() {
  playSound(soundLoseCheckersChess, CARD_FX_VOLUME_KEY);
}

function playBotEliminated() {
  playSound(soundBotEliminated, CARD_FX_VOLUME_KEY);
}

function playSelectPiece() {
  playSound(soundSelectPiece, CARD_FX_VOLUME_KEY);
}

function playChessPiecePlace() {
  playSound(soundChessPiecePlace, CARD_FX_VOLUME_KEY);
}

function playPiecePlaceCheckers() {
  playSound(soundPiecePlaceCheckers, CARD_FX_VOLUME_KEY);
}

function playChooseGame() {
  playSound(soundChooseGame, CARD_FX_VOLUME_KEY);
}

function playMessageNotification() {
  playSound(soundMessageNotification, CARD_FX_VOLUME_KEY);
}

function playPlayerJoinRoom() {
  playSound(soundPlayerJoinRoom, CARD_FX_VOLUME_KEY);
}

function playPlayerJoinsGame() {
  playSound(soundPlayerJoinsGame, CARD_FX_VOLUME_KEY);
}

function playRebuy() {
  playSound(soundRebuy, CARD_FX_VOLUME_KEY);
}

function playSendMessage() {
  playSound(soundSendMessage, CARD_FX_VOLUME_KEY);
}

function playTimeLowAlert() {
  playSound(soundTimeLowAlert, CARD_FX_VOLUME_KEY);
}

const AMBIENCE_FX_KEY = 'arcade_ambience_fx';

function getAmbienceAudio() {
  if (currentGameType === 'slots') return soundAmbienceSwamp;
  const fx = localStorage.getItem(AMBIENCE_FX_KEY) || 'casino';
  if (fx === 'fireplace') return soundAmbienceFireplace;
  if (fx === 'rain') return soundAmbienceRain;
  return soundAmbience;
}

function startAmbience() {
  const audio = getAmbienceAudio();
  audio.loop = true;
  playSound(audio, AMBIENCE_VOLUME_KEY);
}

function stopAmbience() {
  [soundAmbience, soundAmbienceFireplace, soundAmbienceRain, soundAmbienceSwamp].forEach(a => {
    a.pause();
    a.currentTime = 0;
  });
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

const authScreen = document.getElementById('auth-screen');
const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const roomKeyInput = document.getElementById('room-key');

let authUser = null;
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
const betSlider = document.getElementById('bet-slider');
const sliderLabel = document.getElementById('slider-label');
const sliderRow = document.getElementById('slider-row');
const btnBet = document.getElementById('btn-bet');
const btnHalfPot = document.getElementById('btn-half-pot');
const btnFullPot = document.getElementById('btn-full-pot');
const btnAllin = document.getElementById('btn-allin');
const btnPresetX3 = document.getElementById('btn-preset-x3');
const btnPresetX5 = document.getElementById('btn-preset-x5');

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
const ambienceFxSelect = document.getElementById('ambience-fx');
const ambienceVolumeSlider = document.getElementById('ambience-volume');
const ambienceVolumeValue = document.getElementById('ambience-volume-value');
const lobbyBgOpacitySlider = document.getElementById('lobby-bg-opacity');
const lobbyBgOpacityValue = document.getElementById('lobby-bg-opacity-value');
const sfxBitDepthSelect = document.getElementById('sfx-bitdepth');
const chatDurationSelect = document.getElementById('chat-duration');
const nowPlayingRadio = document.getElementById('now-playing-radio');
const nowPlayingRadioLabel = document.getElementById('now-playing-radio-label');
const bjRadioBtn = document.getElementById('bj-radio-btn');
const bjNowPlayingRadio = document.getElementById('bj-now-playing-radio');
const bjNowPlayingRadioLabel = document.getElementById('bj-now-playing-radio-label');
const bjRadioStopBtn = document.getElementById('bj-radio-stop');
const lobbyRadioBtn = document.getElementById('lobby-radio-btn');
const lobbyNowPlayingRadio = document.getElementById('lobby-now-playing-radio');
const lobbyNowPlayingRadioLabel = document.getElementById('lobby-now-playing-radio-label');
const lobbyRadioStopBtn = document.getElementById('lobby-radio-stop');

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
let turnStartedAt = 0;
let prevTurnIdx = -1;
let currentGameType = 'holdem';
let hasPlayedGame = false;
let nextHandInterval = null;
const NEXT_HAND_DELAY_S = 30;
const CHAT_DURATION_KEY = 'arcade_chat_duration';

function getChatDurationMs() {
  const v = localStorage.getItem(CHAT_DURATION_KEY);
  if (v === '0' || v === 'infinite') return Infinity;
  const n = parseInt(v, 10);
  if (n >= 5 && n <= 300) return n * 1000;
  return 45000;
}
const playerChatMessages = {};
const playerChatTimeouts = {};
if (typeof window !== 'undefined') window.playerChatMessages = playerChatMessages;

window.onSlotsJackpotReelsStopped = (playerId) => {
  const pending = window.slotsPendingJackpotChat && window.slotsPendingJackpotChat[playerId];
  if (pending) {
    const slotsChat = document.getElementById('slots-chat-messages');
    if (slotsChat) appendConfigChat(slotsChat, pending.playerId, pending.nickname, pending.text, myId);
    if (playerId !== myId) playMessageNotification();
    delete window.slotsPendingJackpotChat[playerId];
  }
};

const RADIO_API = 'https://de1.api.radio-browser.info/json/stations/search';
const radioAudio = new Audio();
let currentRadioName = '';
const RADIO_VOLUME_KEY = 'poker_radio_volume';
const CARD_FX_VOLUME_KEY = 'poker_card_fx_volume';
const AMBIENCE_VOLUME_KEY = 'poker_ambience_volume';
const LOBBY_BG_OPACITY_KEY = 'arcade_lobby_bg_opacity';

const gameSelectScreen = document.getElementById('game-select-screen');
const gameSelectRoom = document.getElementById('game-select-room');
const gameSelectBack = document.getElementById('game-select-back');
const participantsList = document.getElementById('participants-list');
const lobbyChatMessages = document.getElementById('lobby-chat-messages');
const lobbyChatInput = document.getElementById('lobby-chat-input');

const IMAGE_THEMES = ['waterfront', 'buildings', 'apartments', 'fireflies', 'snowy-lot', 'rolling-fog'];
const ALL_THEMES = ['default', 'amber', 'slate', 'gray', 'blue', ...IMAGE_THEMES];
const THEME_STORAGE_KEY = 'arcade_theme';
let currentTheme = 'default';

function applyTheme(theme) {
  if (!gameSelectScreen) return;
  ALL_THEMES.forEach((t) => {
    gameSelectScreen.classList.remove('theme-' + t);
    document.body.classList.remove('theme-' + t);
  });
  if (theme && theme !== 'default') {
    gameSelectScreen.classList.add('theme-' + theme);
    document.body.classList.add('theme-' + theme);
  }
  currentTheme = theme || 'default';
  if (IMAGE_THEMES.includes(theme)) {
    const ext = '.gif';
    const url = '/images/themes/' + theme + ext;
    gameSelectScreen.style.backgroundImage = 'url(' + url + ')';
    gameSelectScreen.classList.add('has-bg-image');
  } else {
    gameSelectScreen.style.backgroundImage = '';
    gameSelectScreen.classList.remove('has-bg-image');
  }
  document.querySelectorAll('.theme-opt').forEach((el) => {
    el.classList.toggle('active', el.dataset.theme === currentTheme);
  });
  localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
}

let lobbyPlayers = [];

// ── Auth system ──

function showAuthError(text) {
  const el = document.getElementById('auth-status');
  if (el) { el.textContent = text; el.className = 'auth-status error'; }
}

function clearAuthError() {
  const el = document.getElementById('auth-status');
  if (el) { el.textContent = ''; el.className = 'auth-status'; }
}

function showAuthScreen() {
  if (authScreen) authScreen.classList.remove('hidden');
  if (joinScreen) joinScreen.classList.add('hidden');
  hideAllGameScreens();
}

function showJoinScreenAuth() {
  if (authScreen) authScreen.classList.add('hidden');
  if (joinScreen) joinScreen.classList.remove('hidden');
  hideAllGameScreens();
  const welcomeName = document.getElementById('join-welcome-name');
  if (welcomeName && authUser) welcomeName.textContent = authUser.username;
}

async function checkAuth() {
  try {
    const res = await fetch('/auth/me');
    if (res.ok) {
      authUser = await res.json();
      nickname = authUser.username;
      showJoinScreenAuth();
    } else {
      authUser = null;
      showAuthScreen();
    }
  } catch {
    authUser = null;
    showAuthScreen();
  }
}

async function doLogin() {
  clearAuthError();
  const email = document.getElementById('auth-email')?.value?.trim();
  const password = document.getElementById('auth-password')?.value;
  if (!email || !password) { showAuthError('Email and password are required'); return; }
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) { showAuthError(data.error || 'Login failed'); return; }
    authUser = data;
    nickname = authUser.username;
    showJoinScreenAuth();
  } catch {
    showAuthError('Connection failed');
  }
}

async function doRegister() {
  clearAuthError();
  const username = document.getElementById('auth-reg-username')?.value?.trim();
  const email = document.getElementById('auth-reg-email')?.value?.trim();
  const password = document.getElementById('auth-reg-password')?.value;
  if (!username || !email || !password) { showAuthError('All fields are required'); return; }
  try {
    const res = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) { showAuthError(data.error || 'Registration failed'); return; }
    authUser = data;
    nickname = authUser.username;
    showJoinScreenAuth();
  } catch {
    showAuthError('Connection failed');
  }
}

async function doLogout() {
  try { await fetch('/auth/logout', { method: 'POST' }); } catch {}
  authUser = null;
  nickname = '';
  if (ws) { ws.close(); ws = null; }
  showAuthScreen();
}

const authLoginBtn = document.getElementById('auth-login-btn');
const authRegisterBtn = document.getElementById('auth-register-btn');
const authShowRegister = document.getElementById('auth-show-register');
const authShowLogin = document.getElementById('auth-show-login');
const authLogoutBtn = document.getElementById('auth-logout-btn');

if (authLoginBtn) authLoginBtn.addEventListener('click', doLogin);
if (authRegisterBtn) authRegisterBtn.addEventListener('click', doRegister);
if (authLogoutBtn) authLogoutBtn.addEventListener('click', doLogout);

if (authShowRegister) authShowRegister.addEventListener('click', (e) => {
  e.preventDefault();
  clearAuthError();
  document.getElementById('auth-login-form')?.classList.add('hidden');
  document.getElementById('auth-register-form')?.classList.remove('hidden');
});

if (authShowLogin) authShowLogin.addEventListener('click', (e) => {
  e.preventDefault();
  clearAuthError();
  document.getElementById('auth-register-form')?.classList.add('hidden');
  document.getElementById('auth-login-form')?.classList.remove('hidden');
});

document.getElementById('auth-email')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
document.getElementById('auth-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
document.getElementById('auth-reg-username')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRegister(); });
document.getElementById('auth-reg-email')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRegister(); });
document.getElementById('auth-reg-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRegister(); });

// ── Join flow ──

function doJoin() {
  if (!authUser) { showAuthScreen(); return; }
  const key = (roomKeyInput && roomKeyInput.value || '').trim();
  if (!key) {
    if (messageToast) { messageToast.textContent = 'Enter a room key'; messageToast.classList.add('show'); setTimeout(() => messageToast.classList.remove('show'), 3000); }
    return;
  }
  roomKey = key;
  nickname = authUser.username;
  connectLobby();
}

function connectLobby() {
  if (authScreen) authScreen.classList.add('hidden');
  if (joinScreen) joinScreen.classList.add('hidden');
  if (gameScreen) gameScreen.classList.add('hidden');
  const bjScreen = document.getElementById('bj-screen');
  if (bjScreen) bjScreen.classList.add('hidden');
  const slotsScreen = document.getElementById('slots-screen');
  if (slotsScreen) slotsScreen.classList.add('hidden');
  if (window.checkers) window.checkers.hide();
  if (window.chess) window.chess.hide();
  if (window.slots) window.slots.hide();
  if (gameSelectScreen) gameSelectScreen.classList.remove('hidden');
  if (gameSelectRoom) gameSelectRoom.textContent = `Room: ${roomKey} \u2022 Connecting...`;
  if (participantsList) participantsList.innerHTML = '';
  lobbyPlayers = [];
  if (lobbyChatMessages) lobbyChatMessages.innerHTML = '';
  if (ws) { ws.close(); ws = null; }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', roomKey, nickname, gameType: 'lobby', _dbChips: authUser?.chips ?? 100 }));
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

const lobbyChipsDisplay = document.getElementById('lobby-chips-display');
const lobbyRebuyBtn = document.getElementById('lobby-rebuy-btn');

function updateLobbyChipDisplay() {
  const me = lobbyPlayers.find((p) => p.id === myId);
  const chips = me?.chips ?? 100;
  if (lobbyChipsDisplay) lobbyChipsDisplay.textContent = '$' + chips;
  if (lobbyRebuyBtn) {
    lobbyRebuyBtn.classList.toggle('hidden', chips > 0);
  }
}

function showGameSelectScreen(players, chatHistory) {
  const opacity = parseInt(localStorage.getItem(LOBBY_BG_OPACITY_KEY), 10);
  const opacityVal = isNaN(opacity) ? 70 : Math.max(0, Math.min(100, opacity));
  if (gameSelectScreen) gameSelectScreen.style.setProperty('--lobby-card-bg-opacity', (opacityVal / 100).toFixed(2));
  if (authScreen) authScreen.classList.add('hidden');
  if (joinScreen) joinScreen.classList.add('hidden');
  if (gameScreen) gameScreen.classList.add('hidden');
  const bjScreen = document.getElementById('bj-screen');
  if (bjScreen) bjScreen.classList.add('hidden');
  const slotsScreen = document.getElementById('slots-screen');
  if (slotsScreen) slotsScreen.classList.add('hidden');
  if (window.checkers) window.checkers.hide();
  if (window.chess) window.chess.hide();
  if (window.slots) window.slots.hide();
  stopAmbience();
  if (gameSelectScreen) gameSelectScreen.classList.remove('hidden');
  if (gameSelectRoom) gameSelectRoom.textContent = `Room: ${roomKey} \u2022 ${nickname}`;
  lobbyPlayers = (players || lobbyPlayers).map((p) => ({ ...p, currentView: p.currentView ?? 'lobby' }));
  updateLobbyChipDisplay();
  renderParticipants();
  updateGameCounts();
  if (chatHistory && lobbyChatMessages) {
    lobbyChatMessages.innerHTML = '';
    chatHistory.forEach((m) => appendLobbyChat(m.playerId, m.nickname, m.text, false));
    lobbyChatMessages.scrollTop = lobbyChatMessages.scrollHeight;
  }
  if (currentRadioName && lobbyNowPlayingRadio) {
    const label = '\u{1F4FB} ' + currentRadioName;
    lobbyNowPlayingRadio.classList.remove('hidden');
    if (lobbyNowPlayingRadioLabel) lobbyNowPlayingRadioLabel.textContent = label;
  }
}

const GAME_NAMES = { holdem: "Texas Hold'em", blackjack: 'Blackjack', checkers: 'Checkers', chess: 'Chess', slots: 'Swamp Slots', lobby: 'Lobby' };

function renderParticipants() {
  if (!participantsList) return;
  participantsList.innerHTML = '';
  lobbyPlayers.forEach((p) => {
    const chip = document.createElement('span');
    chip.className = 'participant-chip' + (p.id === myId ? ' you' : '');
    const view = p.currentView || 'lobby';
    const name = p.nickname || 'Player';
    chip.textContent = view !== 'lobby' ? `${name} (${GAME_NAMES[view] || view})` : name;
    participantsList.appendChild(chip);
  });
}

function updateGameCounts() {
  const counts = {};
  lobbyPlayers.forEach((p) => {
    const v = p.currentView || 'lobby';
    if (v !== 'lobby') counts[v] = (counts[v] || 0) + 1;
  });
  document.querySelectorAll('.game-count-badge[data-game]').forEach((badge) => {
    const game = badge.dataset.game;
    const max = badge.dataset.max || '?';
    badge.textContent = `${counts[game] || 0}/${max}`;
  });
}

function appendLobbyChat(playerId, nick, text, applyDuration) {
  if (!lobbyChatMessages) return;
  const el = document.createElement('div');
  el.className = 'chat-message';
  const nickSpan = document.createElement('span');
  nickSpan.className = 'nick' + (playerId === myId ? ' you' : '');
  nickSpan.textContent = (nick || 'Player') + ':';
  el.appendChild(nickSpan);
  el.appendChild(document.createTextNode(' ' + text));
  lobbyChatMessages.appendChild(el);
  lobbyChatMessages.scrollTop = lobbyChatMessages.scrollHeight;
  if (applyDuration) {
    const chatDur = getChatDurationMs();
    if (chatDur !== Infinity) {
      setTimeout(() => {
        if (el.parentNode) el.remove();
      }, chatDur);
    }
  }
}

function appendLobbyChatSystem(text) {
  if (!lobbyChatMessages) return;
  const el = document.createElement('div');
  el.className = 'chat-message system';
  el.dataset.chatAt = String(Date.now());
  el.textContent = text;
  lobbyChatMessages.appendChild(el);
  lobbyChatMessages.scrollTop = lobbyChatMessages.scrollHeight;
  const chatDur = getChatDurationMs();
  if (chatDur !== Infinity) {
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, chatDur);
  }
}

function appendConfigChat(container, playerId, nick, text, myId) {
  if (!container) return;
  const isChess = container.id === 'ch-config-chat-messages';
  const msgClass = isChess ? 'ch-chat-msg' : 'ck-chat-msg';
  const nickClass = isChess ? 'ch-chat-nick' : 'ck-chat-nick';
  const el = document.createElement('div');
  el.className = msgClass + (playerId === myId ? ' you' : '');
  const nickSpan = document.createElement('span');
  nickSpan.className = nickClass;
  nickSpan.textContent = (nick || 'Player') + ': ';
  el.appendChild(nickSpan);
  el.appendChild(document.createTextNode(text));
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

const joinBtn = document.getElementById('join-btn');
if (joinBtn) joinBtn.addEventListener('click', (e) => { e.preventDefault(); doJoin(); });

if (roomKeyInput) roomKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doJoin(); } });

if (gameSelectBack) gameSelectBack.addEventListener('click', () => {
  if (ws) { ws.close(); ws = null; }
  showJoinScreen();
});

let brokeKickTimer = null;
const BROKE_KICK_DELAY_MS = 5000;

function cancelBrokeKickTimer() {
  if (brokeKickTimer) {
    clearTimeout(brokeKickTimer);
    brokeKickTimer = null;
  }
}

function scheduleBrokeKickToLobby() {
  if (currentGameType === 'lobby') return;
  if (brokeKickTimer) return;
  showToast('Out of chips — returning to lobby in 5 seconds');
  brokeKickTimer = setTimeout(() => {
    brokeKickTimer = null;
    goBackToLobby();
  }, BROKE_KICK_DELAY_MS);
}

function checkBrokeAndKick() {
  if (currentGameType === 'lobby') return;
  const me = players.find((p) => p.id === myId);
  const chips = me?.chips ?? 0;
  if (chips === 0) scheduleBrokeKickToLobby();
  else cancelBrokeKickTimer();
}

if (typeof window !== 'undefined') {
  window.scheduleBrokeKickToLobby = scheduleBrokeKickToLobby;
  window.cancelBrokeKickTimer = cancelBrokeKickTimer;
}

function goBackToLobby() {
  if (!ws || ws.readyState !== 1) return;
  cancelBrokeKickTimer();
  ws.send(JSON.stringify({ type: 'backToLobby' }));
}

const holdemBackBtn = document.getElementById('holdem-back-btn');
const bjBackBtn = document.getElementById('bj-back-btn');
const slotsBackBtn = document.getElementById('slots-back-btn');
if (holdemBackBtn) holdemBackBtn.addEventListener('click', goBackToLobby);
if (bjBackBtn) bjBackBtn.addEventListener('click', goBackToLobby);
if (slotsBackBtn) slotsBackBtn.addEventListener('click', goBackToLobby);

document.querySelectorAll('.game-option-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    playChooseGame();
    currentGameType = btn.dataset.game || 'holdem';
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'switchGame', gameType: currentGameType }));
    } else {
      joinWithGameType(currentGameType);
    }
  });
});

function joinWithGameType(gameType) {
  if (gameSelectScreen) gameSelectScreen.classList.add('hidden');
  if (ws) { ws.close(); ws = null; }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', roomKey, nickname, gameType, _dbChips: authUser?.chips ?? 100 }));
    if (window.bjSetWs) window.bjSetWs(ws);
    if (window.ckSetWs) window.ckSetWs(ws);
    if (window.chSetWs) window.chSetWs(ws);
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

function hideAllGameScreens(exceptGameType) {
  if (gameScreen && exceptGameType !== 'holdem') gameScreen.classList.add('hidden');
  const bjScreen = document.getElementById('bj-screen');
  if (bjScreen && exceptGameType !== 'blackjack') bjScreen.classList.add('hidden');
  const slotsScreen = document.getElementById('slots-screen');
  if (slotsScreen && exceptGameType !== 'slots') slotsScreen.classList.add('hidden');
  if (window.checkers && exceptGameType !== 'checkers') window.checkers.hide();
  if (window.chess && exceptGameType !== 'chess') window.chess.hide();
  if (gameSelectScreen && exceptGameType !== 'lobby') gameSelectScreen.classList.add('hidden');
}

function handleMessage(msg) {
  if (currentGameType === 'lobby') {
    const t = msg.type;
    if (t && t.startsWith('bj')) return;
    if (t && t.startsWith('ck')) return;
    if (t && t.startsWith('ch') && t[2] >= 'A' && t[2] <= 'Z') return;
    if (['action', 'turn', 'gameStarted', 'phaseChange', 'gameOver', 'roundOver'].includes(t)) return;
  }
  if (msg.type && msg.type.startsWith('bj')) {
    if (window.blackjack) window.blackjack.handleMessage(msg);
    return;
  }
  if (msg.type && msg.type.startsWith('ck')) {
    if (window.checkers) window.checkers.handleMessage(msg);
    return;
  }
  if (msg.type && msg.type.startsWith('ch') && msg.type[2] >= 'A' && msg.type[2] <= 'Z') {
    if (window.chess) window.chess.handleMessage(msg);
    return;
  }
  if (msg.type === 'slotSpinStarted') {
    if (window.slots) window.slots.handleMessage(msg);
    return;
  }
  if (msg.type === 'slotResult') {
    if (msg.chips !== undefined && msg.playerId) {
      const pl = players.find((p) => p.id === msg.playerId);
      if (pl) pl.chips = msg.chips;
      if (msg.playerId === myId) {
        const lp = lobbyPlayers.find((p) => p.id === myId);
        if (lp) lp.chips = msg.chips;
      }
    }
    if (window.slots) window.slots.handleMessage(msg);
    return;
  }
  switch (msg.type) {
    case 'joined':
      myId = msg.id;
      players = msg.players || [];
      gameState = msg.gameState;
      prevCommunityCount = 0;
      currentGameType = msg.gameType || 'holdem';
      if (joinScreen) joinScreen.classList.add('hidden');
      hideAllGameScreens(currentGameType);
      if (currentGameType === 'lobby') {
        lobbyPlayers = (players || []).map((p) => ({ ...p, currentView: p.currentView ?? 'lobby' }));
        showGameSelectScreen(players, msg.chatHistory);
        if (msg.radio) playRadio(msg.radio);
        initRadioVolume();
        if (msg.theme) applyTheme(msg.theme);
        else applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'default');
        if (msg.gameFull) {
          const name = GAME_NAMES[msg.gameFull] || msg.gameFull;
          showToast(`${name} is full. You've been placed in the lobby.`);
        }
        return;
      }
      {
        const gamePlayers = players.filter((p) => (p.currentView ?? 'lobby') === currentGameType);
        if (currentGameType === 'blackjack') {
          if (window.blackjack) {
            window.blackjack.init(ws, myId, gamePlayers, msg.roomKey);
            window.blackjack.show();
          }
          try { startAmbience(); } catch (_) {}
          initRadioVolume();
        } else if (currentGameType === 'checkers') {
          if (window.checkers) {
            window.checkers.init(ws, myId, gamePlayers, msg.roomKey);
            window.checkers.show();
          }
          try { startAmbience(); } catch (_) {}
          initRadioVolume();
        } else if (currentGameType === 'chess') {
          if (window.chess) {
            window.chess.init(ws, myId, gamePlayers, msg.roomKey);
            window.chess.show();
          }
          try { startAmbience(); } catch (_) {}
          initRadioVolume();
        } else if (currentGameType === 'slots') {
          const me = players.find((p) => p.id === myId);
          const slotsPlayersList = players.filter((p) => (p.currentView ?? 'lobby') === 'slots');
          if (window.slots) {
            window.slots.init(ws, myId, me?.chips ?? 0, slotsPlayersList);
            window.slots.show();
          }
          const slotsChat = document.getElementById('slots-chat-messages');
          if (slotsChat && msg.chatHistory) {
            slotsChat.innerHTML = '';
            msg.chatHistory.forEach((m) => appendConfigChat(slotsChat, m.playerId, m.nickname, m.text, myId));
          }
          try { startAmbience(); } catch (_) {}
          initRadioVolume();
        } else {
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
        }
      }
      break;

    case 'gameFull': {
      const name = GAME_NAMES[msg.gameType] || msg.gameType;
      showToast(`${name} is full (max players reached).`);
      if (gameSelectScreen) gameSelectScreen.classList.remove('hidden');
      break;
    }

    case 'radioChanged':
      playRadio(msg.station);
      showToast(`${msg.nickname} tuned the radio to ${msg.station.name}`);
      break;

    case 'radioStopped':
      stopRadio();
      showToast(`${msg.nickname} stopped the radio`);
      break;

    case 'gameSwitched':
      cancelBrokeKickTimer();
      myId = msg.id;
      players = msg.players || [];
      gameState = msg.gameState;
      prevCommunityCount = 0;
      currentGameType = msg.gameType || 'holdem';
      {
        const gamePlayers = players.filter((p) => (p.currentView ?? 'lobby') === currentGameType);
        if (currentGameType === 'slots') {
          const me = players.find((p) => p.id === myId);
          const slotsPlayersList = players.filter((p) => (p.currentView ?? 'lobby') === 'slots');
          if (window.slots) {
            window.slots.init(ws, myId, me?.chips ?? 0, slotsPlayersList);
            window.slots.show();
          }
        }
      }
      hideAllGameScreens(currentGameType);
      {
        const gamePlayers = players.filter((p) => (p.currentView ?? 'lobby') === currentGameType);
        if (currentGameType === 'blackjack') {
          if (window.blackjack) {
            window.blackjack.init(ws, myId, gamePlayers, msg.roomKey);
            window.blackjack.show();
          }
          try { startAmbience(); } catch (_) {}
          initRadioVolume();
        } else if (currentGameType === 'checkers') {
          if (window.checkers) {
            window.checkers.init(ws, myId, gamePlayers, msg.roomKey);
            window.checkers.show();
          }
          try { startAmbience(); } catch (_) {}
          initRadioVolume();
        } else if (currentGameType === 'chess') {
          if (window.chess) {
            window.chess.init(ws, myId, gamePlayers, msg.roomKey);
            window.chess.show();
          }
          try { startAmbience(); } catch (_) {}
          initRadioVolume();
        } else if (currentGameType === 'slots') {
          const slotsChat = document.getElementById('slots-chat-messages');
          if (slotsChat && msg.chatHistory) {
            slotsChat.innerHTML = '';
            msg.chatHistory.forEach((m) => appendConfigChat(slotsChat, m.playerId, m.nickname, m.text, myId));
          }
          try { startAmbience(); } catch (_) {}
          initRadioVolume();
        } else {
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
        }
      }
      break;

    case 'userJoined':
      if (currentGameType === 'lobby' && msg.id !== myId) playPlayerJoinRoom();
      if ((msg.currentView || 'lobby') !== 'lobby') playPlayerJoinsGame();
      players.push({
        id: msg.id,
        nickname: msg.nickname,
        chips: msg.chips ?? 100,
      winStreak: msg.winStreak ?? 0,
      maxWinStreak: msg.maxWinStreak ?? 0,
      currentView: msg.currentView ?? 'lobby',
      });
      if (currentGameType === 'lobby') {
        lobbyPlayers = players.map((p) => ({ ...p, currentView: p.currentView ?? 'lobby' }));
        renderParticipants();
        updateGameCounts();
        return;
      }
      if (currentGameType === 'blackjack' && window.blackjack && (msg.currentView ?? 'lobby') === 'blackjack') {
        window.blackjack.handleMessage({ type: 'bjUserJoined', id: msg.id, nickname: msg.nickname, chips: msg.chips ?? 100 });
      }
      renderTable();
      break;

    case 'userLeft':
      if (msg.botEliminated) playBotEliminated();
      players = players.filter((p) => p.id !== msg.id);
      if (currentGameType === 'lobby') {
        lobbyPlayers = players.map((p) => ({ ...p, currentView: p.currentView ?? 'lobby' }));
        renderParticipants();
        updateGameCounts();
        return;
      }
      if (currentGameType === 'blackjack' && window.blackjack) {
        window.blackjack.handleMessage({ type: 'bjUserLeft', id: msg.id });
      }
      renderTable();
      break;

    case 'userRebuy':
      cancelBrokeKickTimer();
      if (msg.players) {
        msg.players.forEach((p) => {
          const pl = players.find((x) => x.id === p.id);
          if (pl) pl.chips = p.chips;
          const lp = lobbyPlayers.find((x) => x.id === p.id);
          if (lp) lp.chips = p.chips;
        });
      }
      if (currentGameType === 'lobby') updateLobbyChipDisplay();
      renderTable();
      updateControls();
      break;

    case 'gameStarted':
      stopNextHandTimer();
      hasPlayedGame = true;
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
        minRaise: msg.minRaise ?? 10,
        turnIdx: msg.turnIdx,
        dealerIdx: msg.dealerIdx,
      };
      players = msg.players || players;
      players.forEach((p) => { p._prevHandCount = 0; });
      myHand = [];
      prevCommunityCount = 0;
      prevMyHandCount = 0;
      turnStartedAt = Date.now();
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
      if (msg.turnIdx === -1) { stopTurnTimer(); turnStartedAt = 0; }
      else turnStartedAt = Date.now();
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
            if (p.chips !== undefined) pl.chips = p.chips;
            if (p.betThisRound !== undefined) pl.betThisRound = p.betThisRound;
            if (p.folded !== undefined) pl.folded = p.folded;
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
      turnStartedAt = Date.now();
      renderTable();
      updateControls();
      break;

    case 'gameOver': {
      stopTurnTimer();
      turnStartedAt = 0;
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
      checkBrokeAndKick();
      break;
    }

    case 'rebuySuccess':
      playRebuy();
      if (msg.chips !== undefined) {
        const pl = players.find((p) => p.id === myId);
        if (pl) pl.chips = msg.chips;
        const lp = lobbyPlayers.find((p) => p.id === myId);
        if (lp) lp.chips = msg.chips;
      }
      if (currentGameType === 'lobby') updateLobbyChipDisplay();
      renderTable();
      updateControls();
      break;

    case 'roundOver':
      stopTurnTimer();
      turnStartedAt = 0;
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
      checkBrokeAndKick();
      if (players.length >= 2) startNextHandTimer();
      break;

    case 'playerViewChanged':
      if (msg.players) {
        const prevCheckersCount = players.filter((p) => (p.currentView ?? 'lobby') === 'checkers').length;
        const prevChessCount = players.filter((p) => (p.currentView ?? 'lobby') === 'chess').length;
        msg.players.forEach((up) => {
          const ex = players.find((p) => p.id === up.id);
          const prevView = ex ? (ex.currentView ?? 'lobby') : 'lobby';
          const newView = up.currentView ?? 'lobby';
          if (prevView !== newView && up.id !== myId && newView !== 'lobby') {
            const gameName = GAME_NAMES[newView] || newView;
            appendLobbyChatSystem((up.nickname || 'Player') + ' joined ' + gameName);
          }
          if (ex) {
            ex.currentView = newView;
            if (up.chips !== undefined) ex.chips = up.chips;
          } else {
            players.push({ id: up.id, nickname: up.nickname, currentView: newView, chips: up.chips ?? 100 });
          }
        });
        if (currentGameType === 'lobby') {
          lobbyPlayers = msg.players.map((up) => {
            const ex = lobbyPlayers.find((p) => p.id === up.id);
            return { id: up.id, nickname: up.nickname, currentView: up.currentView ?? 'lobby', chips: up.chips ?? ex?.chips ?? 100 };
          });
          renderParticipants();
          updateGameCounts();
        } else if (currentGameType === 'blackjack' && window.blackjack) {
          const bjNow = msg.players.filter((p) => (p.currentView ?? 'lobby') === 'blackjack');
          const bjIds = new Set(bjNow.map((p) => p.id));
          const existingIds = new Set(window.blackjack.getPlayerIds());
          bjNow.forEach((p) => {
            if (!existingIds.has(p.id)) {
              window.blackjack.handleMessage({ type: 'bjUserJoined', id: p.id, nickname: p.nickname, chips: p.chips ?? 100 });
            }
          });
          existingIds.forEach((id) => {
            if (!bjIds.has(id)) {
              window.blackjack.handleMessage({ type: 'bjUserLeft', id });
            }
          });
        } else if (currentGameType === 'checkers' && window.checkers) {
          const ckNow = players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
          const count = ckNow.length;
          if (count > prevCheckersCount && typeof playPlayerJoinsGame === 'function') playPlayerJoinsGame();
          window.checkers.handleMessage({ type: 'ckPlayersUpdated', players: ckNow });
        } else if (currentGameType === 'chess' && window.chess) {
          const chNow = players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
          const count = chNow.length;
          if (count > prevChessCount && typeof playPlayerJoinsGame === 'function') playPlayerJoinsGame();
          window.chess.handleMessage({ type: 'chPlayersUpdated', players: chNow });
        } else if (currentGameType === 'slots' && window.slots) {
          const slotsNow = players.filter((p) => (p.currentView ?? 'lobby') === 'slots');
          window.slots.setPlayers(slotsNow);
        }
      }
      break;

    case 'backToLobby':
      currentGameType = 'lobby';
      cancelBrokeKickTimer();
      stopTurnTimer();
      stopNextHandTimer();
      turnStartedAt = 0;
      gameState = null;
      lobbyPlayers = (msg.players || []).map((p) => ({ ...p, currentView: p.currentView ?? 'lobby' }));
      showGameSelectScreen(msg.players, msg.chatHistory);
      if (msg.theme) applyTheme(msg.theme);
      else applyTheme(currentTheme);
      break;

    case 'themeChanged':
      applyTheme(msg.theme);
      if (lobbyChatMessages && gameSelectScreen && !gameSelectScreen.classList.contains('hidden')) {
        const nick = msg.nickname || 'Someone';
        const themeName = (msg.theme || 'default').replace(/-/g, ' ');
        const display = themeName.charAt(0).toUpperCase() + themeName.slice(1);
        appendLobbyChatSystem(nick + ' changed the theme to ' + display, true);
      }
      break;

    case 'chat': {
      const isJackpotChat = currentGameType === 'slots' && msg.text && msg.text.includes('won the jackpot');
      if (isJackpotChat) {
        if (!window.slotsPendingJackpotChat) window.slotsPendingJackpotChat = {};
        window.slotsPendingJackpotChat[msg.playerId] = { playerId: msg.playerId, nickname: msg.nickname, text: msg.text };
        break;
      }
      if (msg.playerId !== myId) playMessageNotification();
      if (currentGameType === 'lobby' && gameSelectScreen && !gameSelectScreen.classList.contains('hidden')) {
        appendLobbyChat(msg.playerId, msg.nickname, msg.text, true);
        return;
      }
      if (currentGameType === 'checkers') {
        const ckChat = document.getElementById('ck-config-chat-messages');
        if (ckChat) appendConfigChat(ckChat, msg.playerId, msg.nickname, msg.text, myId);
        return;
      }
      if (currentGameType === 'chess') {
        const chChat = document.getElementById('ch-config-chat-messages');
        if (chChat) appendConfigChat(chChat, msg.playerId, msg.nickname, msg.text, myId);
        return;
      }
      if (currentGameType === 'slots') {
        const slotsChat = document.getElementById('slots-chat-messages');
        if (slotsChat) appendConfigChat(slotsChat, msg.playerId, msg.nickname, msg.text, myId);
        return;
      }
      const BUBBLE_DURATION_MS = 5000;
      playerChatMessages[msg.playerId] = { text: msg.text, expiresAt: Date.now() + BUBBLE_DURATION_MS };
      if (playerChatTimeouts[msg.playerId]) clearTimeout(playerChatTimeouts[msg.playerId]);
      playerChatTimeouts[msg.playerId] = setTimeout(() => {
        delete playerChatMessages[msg.playerId];
        delete playerChatTimeouts[msg.playerId];
        renderTable();
        if (currentGameType === 'blackjack' && window.blackjack?.renderAll) window.blackjack.renderAll();
      }, BUBBLE_DURATION_MS);
      renderTable();
      if (currentGameType === 'blackjack' && window.blackjack?.renderAll) window.blackjack.renderAll();
      break;
    }

    case 'error':
      if (msg.message && msg.message.includes('Game in progress') && ws) {
        ws.close();
        ws = null;
      }
      showToast(msg.message || 'Error');
      break;
  }
}

function showJoinScreen() {
  cancelBrokeKickTimer();
  hideAllGameScreens();
  if (window.blackjack) window.blackjack.hide();
  if (window.checkers) window.checkers.hide();
  if (window.chess) window.chess.hide();
  if (window.slots) window.slots.hide();
  stopAmbience();
  stopNextHandTimer();
  hasPlayedGame = false;
  Object.keys(playerChatTimeouts).forEach((id) => {
    clearTimeout(playerChatTimeouts[id]);
  });
  Object.keys(playerChatTimeouts).forEach((k) => delete playerChatTimeouts[k]);
  Object.keys(playerChatMessages).forEach((k) => delete playerChatMessages[k]);
  if (ws) ws.close();
  ws = null;
  if (authUser) {
    showJoinScreenAuth();
  } else {
    showAuthScreen();
  }
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
      potChips.appendChild(renderChipStack(pot, 2));
      potInControls.appendChild(potChips);
    }
  }
  if (tablePotAmountEl) tablePotAmountEl.textContent = `$${pot}`;
  if (tablePotChipsEl) {
    tablePotChipsEl.innerHTML = '';
    if (pot > 0) tablePotChipsEl.appendChild(renderChipStack(pot, 3));
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

  if (winningHandRowEl && winningHandCardsEl) {
    if (showWinningHand) {
      winningHandRowEl.classList.remove('hidden');
      const labelEl = winningHandRowEl.querySelector('.winning-hand-label');
      if (labelEl) labelEl.style.display = 'none';
      winningHandCardsEl.innerHTML = '';
      const holeSet = new Set(lastWinningHoleIndices || []);
      lastWinningCards.forEach((card, idx) => {
        const div = document.createElement('div');
        div.className = 'card winning-card' + (holeSet.has(idx) ? ' from-hole' : '');
        div.style.backgroundImage = `url(${cardImagePath(card)})`;
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

  const CX = 50, CY = 36;
  const BET_LERP = 0.55;

  function sidePositions(n) {
    const out = [];
    out.push({ seat: [50, 78], bet: [50, 62] });
    const others = n - 1;
    const leftCount = Math.ceil(others / 2);
    const rightCount = others - leftCount;
    const leftX = 14, rightX = 86;
    const yMin = 42, yMax = 72;
    for (let i = 0; i < leftCount; i++) {
      const t = leftCount === 1 ? 0.5 : i / (leftCount - 1);
      const sy = yMin + (yMax - yMin) * t;
      const bx = leftX + (CX - leftX) * BET_LERP;
      const by = sy + (CY - sy) * BET_LERP;
      out.push({ seat: [leftX, sy], bet: [bx, by] });
    }
    for (let i = 0; i < rightCount; i++) {
      const t = rightCount === 1 ? 0.5 : i / (rightCount - 1);
      const sy = yMin + (yMax - yMin) * t;
      const bx = rightX + (CX - rightX) * BET_LERP;
      const by = sy + (CY - sy) * BET_LERP;
      out.push({ seat: [rightX, sy], bet: [bx, by] });
    }
    return out;
  }

  const positions = sidePositions(count);
  const myPosIdx = players.findIndex((p) => p.id === myId);
  const rotateBy = myPosIdx > 0 ? myPosIdx : 0;

  document.querySelectorAll('.seat-chat-bubble').forEach((el) => {
    const pid = el.dataset.chatFor;
    const inGame = pid && players.some((p) => p.id === pid);
    const chatData = pid && playerChatMessages[pid];
    const valid = chatData && chatData.expiresAt > Date.now() && chatData.text === el.textContent;
    if (!inGame || !valid) el.remove();
  });

  players.forEach((p, i) => {
    const seatSlot = (i - rotateBy + count) % count;
    const pos = positions[seatSlot];
    const [x, y] = pos.seat;
    const [betPosX, betPosY] = pos.bet;

    const seat = document.createElement('div');
    seat.className = 'player-seat seats-' + count;
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
    if (isMe) seat.classList.add('is-me');

    const chatData = playerChatMessages[p.id];
    if (chatData && chatData.expiresAt > Date.now()) {
      const existingBubble = document.querySelector(`.seat-chat-bubble[data-chat-for="${p.id}"]`);
      let chatBubble;
      if (existingBubble && existingBubble.textContent === chatData.text) {
        chatBubble = existingBubble;
      } else {
        if (existingBubble) existingBubble.remove();
        chatBubble = document.createElement('div');
        chatBubble.className = 'seat-chat-bubble';
        chatBubble.textContent = chatData.text;
        chatBubble.dataset.chatFor = p.id;
        document.body.appendChild(chatBubble);
      }
      requestAnimationFrame(() => {
        const seatRect = seat.getBoundingClientRect();
        const bubbleRect = chatBubble.getBoundingClientRect();
        chatBubble.style.left = `${seatRect.left + seatRect.width / 2}px`;
        chatBubble.style.top = `${Math.max(0, seatRect.top - bubbleRect.height - 4)}px`;
      });
    }

    // Cards first (above name)
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

    if (isMe && myHand.length > 0 && !p.folded) {
      const handRank = evaluateHand(myHand, gameState?.communityCards);
      if (handRank) {
        const rankEl = document.createElement('div');
        rankEl.className = 'hand-rank-label';
        rankEl.textContent = handRank.descr || handRank.name;
        seat.appendChild(rankEl);
      }
    }

    // Name, chips, streak below cards
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
      const streakWrap = document.createElement('span');
      streakWrap.className = 'seat-streak';
      if (winStreak > 0) {
        const currentWrap = document.createElement('span');
        currentWrap.className = 'seat-streak-current-wrap' + (winStreak >= 3 ? ' seat-streak-current-fire' : '');
        if (winStreak >= 3) {
          const streakFire = document.createElement('span');
          streakFire.className = 'seat-streak-fire';
          currentWrap.appendChild(streakFire);
        }
        const streakCurrent = document.createElement('span');
        streakCurrent.className = 'seat-streak-current';
        streakCurrent.textContent = `${winStreak}W`;
        currentWrap.appendChild(streakCurrent);
        streakWrap.appendChild(currentWrap);
      }
      if (maxWinStreak > 0) {
        const streakBest = document.createElement('span');
        streakBest.className = 'seat-streak-best';
        streakBest.textContent = (winStreak > 0 ? ' · ' : '') + `Best ${maxWinStreak}`;
        streakWrap.appendChild(streakBest);
      }
      seatInfo.appendChild(streakWrap);
    }
    if (p.folded) {
      const foldedSpan = document.createElement('span');
      foldedSpan.className = 'seat-folded';
      foldedSpan.textContent = 'Folded';
      seatInfo.appendChild(foldedSpan);
    }
    seat.appendChild(seatInfo);

    if (isTurn && turnStartedAt > 0) {
      const timerTrack = document.createElement('div');
      timerTrack.className = 'seat-timer-track';
      const timerBar = document.createElement('div');
      timerBar.className = 'seat-timer-bar';
      const elapsed = Date.now() - turnStartedAt;
      timerBar.style.animationDuration = `${TURN_TIMEOUT_MS}ms`;
      timerBar.style.animationDelay = `-${elapsed}ms`;
      timerTrack.appendChild(timerBar);
      seat.appendChild(timerTrack);
    }

    const chipStackDiv = document.createElement('div');
    chipStackDiv.className = 'seat-chip-stack';
    chipStackDiv.appendChild(renderChipIcons(p.chips ?? 0, 4));
    seat.appendChild(chipStackDiv);

    playersContainer.appendChild(seat);

    if (p.betThisRound && p.betThisRound > 0) {
      const betChipsDiv = document.createElement('div');
      betChipsDiv.className = 'seat-bet';
      betChipsDiv.style.left = `${betPosX}%`;
      betChipsDiv.style.top = `${betPosY}%`;
      betChipsDiv.style.transform = 'translate(-50%, -50%)';
      const betAmount = document.createElement('span');
      betAmount.className = 'seat-bet-amount';
      betAmount.textContent = `$${p.betThisRound}`;
      betChipsDiv.appendChild(betAmount);
      const chipsSpan = document.createElement('span');
      chipsSpan.className = 'seat-bet-chips';
      chipsSpan.appendChild(renderChipStack(p.betThisRound, 1));
      betChipsDiv.appendChild(chipsSpan);
      playersContainer.appendChild(betChipsDiv);
    }
  });

  const canStart = players.length >= 2 && (!gameState || gameState.phase === 'lobby');
  startBtn.disabled = !canStart;
  startBtn.title = players.length < 2 ? 'Need 2 players to start' : '';
  startBtn.textContent = hasPlayedGame ? 'Restart' : 'Start Game';
  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) {
    restartBtn.classList.toggle('hidden', !canStart || !hasPlayedGame);
    restartBtn.disabled = !canStart;
  }
  const waitingEl = document.getElementById('waiting-for-players');
  const addBotBtn = document.getElementById('add-bot-btn');
  if (waitingEl) {
    waitingEl.classList.toggle('hidden', players.length >= 2 || !!gameState);
    waitingEl.textContent = players.length === 1 ? 'Waiting for another player...' : 'Need 2 players to start';
  }
  if (addBotBtn) {
    const showAddBot = !gameState && players.length < 6;
    addBotBtn.classList.toggle('hidden', !showAddBot);
    addBotBtn.disabled = !showAddBot;
  }

}

function startTurnTimer() {
  stopTurnTimer();
  turnStartedAt = Date.now();
  let remaining = TURN_TIMEOUT_MS / 1000;
  if (turnTimerEl) {
    turnTimerEl.classList.remove('hidden');
    turnTimerEl.textContent = `${remaining}s`;
  }
  turnTimerInterval = setInterval(() => {
    remaining--;
    if (remaining === 5) playTimeLowAlert();
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

function startNextHandTimer() {
  stopNextHandTimer();
  const timerEl = document.getElementById('next-hand-timer');
  let remaining = NEXT_HAND_DELAY_S;
  if (timerEl) {
    timerEl.classList.remove('hidden');
    timerEl.textContent = `(${remaining}s)`;
  }
  nextHandInterval = setInterval(() => {
    remaining--;
    if (timerEl) timerEl.textContent = `(${remaining}s)`;
    if (remaining <= 0) {
      stopNextHandTimer();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'startGame', resetStreaks: false }));
      }
    }
  }, 1000);
}

function stopNextHandTimer() {
  if (nextHandInterval) {
    clearInterval(nextHandInterval);
    nextHandInterval = null;
  }
  const timerEl = document.getElementById('next-hand-timer');
  if (timerEl) timerEl.classList.add('hidden');
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
  const anyOpponentAllIn = !!gameState && players.some(p =>
    p.id !== myId && !p.folded && (p.chips ?? 0) === 0 && (p.betThisRound || 0) > 0
  );
  const canCheck = toCall <= 0 && !facingAllIn && !anyOpponentAllIn;

  if (!gameState) {
    stopTurnTimer();
    turnStartedAt = 0;
    prevTurnIdx = -1;
  }

  const holdemChipsEl = document.getElementById('holdem-chips-display');
  if (holdemChipsEl) holdemChipsEl.textContent = '$' + (me?.chips ?? 0);

  btnFold.disabled = !isMyTurn || folded;
  btnCheck.disabled = !isMyTurn || folded || !canCheck;
  btnCall.disabled = !isMyTurn || folded || toCall <= 0;
  const minRaise = gameState?.minRaise || 10;
  const minBetTo = currentBet > 0 ? currentBet + minRaise : minRaise;
  const canRaise = isMyTurn && !folded && myChips > 0 && !facingAllIn;
  btnBet.disabled = !canRaise;
  btnAllin.disabled = !isMyTurn || folded || myChips <= 0;
  if (btnHalfPot) btnHalfPot.disabled = !canRaise;
  if (btnFullPot) btnFullPot.disabled = !canRaise;
  if (btnPresetX3) btnPresetX3.disabled = !canRaise;
  if (btnPresetX5) btnPresetX5.disabled = !canRaise;

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

  if (sliderRow) {
    sliderRow.classList.toggle('slider-inactive', !canRaise);
  }
  if (betSlider) {
    const sliderMin = Math.min(minBetTo, myChips);
    betSlider.min = sliderMin;
    betSlider.max = myChips;
    const curVal = parseInt(betAmountInput.value, 10) || 0;
    if (curVal < sliderMin) {
      betSlider.value = sliderMin;
      betAmountInput.value = sliderMin;
      if (sliderLabel) sliderLabel.textContent = `$${sliderMin}`;
    }
  }

  betAmountInput.min = minRaise;
}

startBtn.addEventListener('click', () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'startGame', resetStreaks: true, resetChips: true }));
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

function setSliderValue(amt) {
  const clampedAmt = Math.max(parseInt(betSlider?.min || 0, 10), Math.min(parseInt(betSlider?.max || 100, 10), amt));
  if (betSlider) betSlider.value = clampedAmt;
  if (betAmountInput) betAmountInput.value = clampedAmt;
  if (sliderLabel) sliderLabel.textContent = `$${clampedAmt}`;
}

if (betSlider) {
  betSlider.addEventListener('input', () => {
    const val = parseInt(betSlider.value, 10);
    if (betAmountInput) betAmountInput.value = val;
    if (sliderLabel) sliderLabel.textContent = `$${val}`;
  });
}

if (btnHalfPot) {
  btnHalfPot.addEventListener('click', () => {
    const pot = gameState?.pot ?? 0;
    const currentBet = gameState?.currentBet || 0;
    const minRaise = gameState?.minRaise || 10;
    const minBetTo = currentBet > 0 ? currentBet + minRaise : minRaise;
    const myChips = players.find((p) => p.id === myId)?.chips ?? 0;
    const halfPot = Math.floor(pot / 2);
    setSliderValue(Math.min(myChips, Math.max(minBetTo, halfPot)));
  });
}
if (btnFullPot) {
  btnFullPot.addEventListener('click', () => {
    const pot = gameState?.pot ?? 0;
    const currentBet = gameState?.currentBet || 0;
    const minRaise = gameState?.minRaise || 10;
    const minBetTo = currentBet > 0 ? currentBet + minRaise : minRaise;
    const myChips = players.find((p) => p.id === myId)?.chips ?? 0;
    setSliderValue(Math.min(myChips, Math.max(minBetTo, pot)));
  });
}
if (btnPresetX3) {
  btnPresetX3.addEventListener('click', () => {
    const currentBet = gameState?.currentBet || 0;
    const minRaise = gameState?.minRaise || 10;
    const minBetTo = currentBet > 0 ? currentBet + minRaise : minRaise;
    const myChips = players.find((p) => p.id === myId)?.chips ?? 0;
    const target = currentBet > 0 ? currentBet * 3 : minBetTo * 3;
    setSliderValue(Math.min(myChips, Math.max(minBetTo, target)));
  });
}
if (btnPresetX5) {
  btnPresetX5.addEventListener('click', () => {
    const currentBet = gameState?.currentBet || 0;
    const minRaise = gameState?.minRaise || 10;
    const minBetTo = currentBet > 0 ? currentBet + minRaise : minRaise;
    const myChips = players.find((p) => p.id === myId)?.chips ?? 0;
    const target = currentBet > 0 ? currentBet * 5 : minBetTo * 5;
    setSliderValue(Math.min(myChips, Math.max(minBetTo, target)));
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
  const label = '\u{1F4FB} ' + currentRadioName;
  if (nowPlayingRadio) nowPlayingRadio.classList.remove('hidden');
  if (nowPlayingRadioLabel) nowPlayingRadioLabel.textContent = label;
  if (bjNowPlayingRadio) bjNowPlayingRadio.classList.remove('hidden');
  if (bjNowPlayingRadioLabel) bjNowPlayingRadioLabel.textContent = label;
  const slotsNowPlaying = document.getElementById('slots-now-playing-radio');
  const slotsNowPlayingLabel = document.getElementById('slots-now-playing-radio-label');
  if (slotsNowPlaying) slotsNowPlaying.classList.remove('hidden');
  if (slotsNowPlayingLabel) slotsNowPlayingLabel.textContent = label;
  if (lobbyNowPlayingRadio) lobbyNowPlayingRadio.classList.remove('hidden');
  if (lobbyNowPlayingRadioLabel) lobbyNowPlayingRadioLabel.textContent = label;
  const ckNowPlaying = document.getElementById('ck-now-playing-radio');
  const ckNowPlayingLabel = document.getElementById('ck-now-playing-radio-label');
  if (ckNowPlaying) ckNowPlaying.classList.remove('hidden');
  if (ckNowPlayingLabel) ckNowPlayingLabel.textContent = label;
}

function stopRadio() {
  radioAudio.pause();
  radioAudio.src = '';
  currentRadioName = '';
  if (nowPlayingRadio) nowPlayingRadio.classList.add('hidden');
  if (bjNowPlayingRadio) bjNowPlayingRadio.classList.add('hidden');
  if (lobbyNowPlayingRadio) lobbyNowPlayingRadio.classList.add('hidden');
  const ckNowPlaying = document.getElementById('ck-now-playing-radio');
  if (ckNowPlaying) ckNowPlaying.classList.add('hidden');
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

  const bd = localStorage.getItem(SFX_BITDEPTH_KEY) || '0';
  if (sfxBitDepthSelect) sfxBitDepthSelect.value = bd;

  const ambFx = localStorage.getItem(AMBIENCE_FX_KEY) || 'casino';
  if (ambienceFxSelect) ambienceFxSelect.value = ambFx;

  const lobOpacity = parseInt(localStorage.getItem(LOBBY_BG_OPACITY_KEY), 10);
  const lobVal = isNaN(lobOpacity) ? 70 : Math.max(0, Math.min(100, lobOpacity));
  if (lobbyBgOpacitySlider) lobbyBgOpacitySlider.value = lobVal;
  if (lobbyBgOpacityValue) lobbyBgOpacityValue.textContent = lobVal + '%';

  const chatDur = localStorage.getItem(CHAT_DURATION_KEY);
  if (chatDurationSelect) chatDurationSelect.value = (chatDur === '0' || chatDur === 'infinite') ? '0' : (chatDur || '45');
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

if (bjRadioBtn) bjRadioBtn.addEventListener('click', () => {
  initRadioVolume();
  radioOverlay?.classList.remove('hidden');
  radioSearchInput?.focus();
});

const slotsRadioBtn = document.getElementById('slots-radio-btn');
const slotsRadioStopBtn = document.getElementById('slots-radio-stop');
if (slotsRadioBtn) slotsRadioBtn.addEventListener('click', () => {
  initRadioVolume();
  radioOverlay?.classList.remove('hidden');
  radioSearchInput?.focus();
});
if (slotsRadioStopBtn) slotsRadioStopBtn.addEventListener('click', () => {
  if (currentRadioName && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'stopRadio' }));
  }
});

if (bjRadioStopBtn) bjRadioStopBtn.addEventListener('click', () => {
  if (currentRadioName && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'stopRadio' }));
  }
});

if (lobbyRadioBtn) lobbyRadioBtn.addEventListener('click', () => {
  initRadioVolume();
  radioOverlay?.classList.remove('hidden');
  radioSearchInput?.focus();
});

if (lobbyRadioStopBtn) lobbyRadioStopBtn.addEventListener('click', () => {
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

if (ambienceFxSelect) ambienceFxSelect.addEventListener('change', () => {
  const fx = ambienceFxSelect.value;
  localStorage.setItem(AMBIENCE_FX_KEY, fx);
  stopAmbience();
  try { startAmbience(); } catch (_) {}
});

if (ambienceVolumeSlider) ambienceVolumeSlider.addEventListener('input', () => {
  const v = parseInt(ambienceVolumeSlider.value, 10);
  const audio = getAmbienceAudio();
  audio.volume = v / 100;
  localStorage.setItem(AMBIENCE_VOLUME_KEY, v);
  if (ambienceVolumeValue) ambienceVolumeValue.textContent = v + '%';
});

if (lobbyBgOpacitySlider) lobbyBgOpacitySlider.addEventListener('input', () => {
  const v = parseInt(lobbyBgOpacitySlider.value, 10);
  localStorage.setItem(LOBBY_BG_OPACITY_KEY, v);
  if (lobbyBgOpacityValue) lobbyBgOpacityValue.textContent = v + '%';
  if (gameSelectScreen) gameSelectScreen.style.setProperty('--lobby-card-bg-opacity', (v / 100).toFixed(2));
});

if (sfxBitDepthSelect) sfxBitDepthSelect.addEventListener('change', () => {
  localStorage.setItem(SFX_BITDEPTH_KEY, sfxBitDepthSelect.value);
});

if (chatDurationSelect) chatDurationSelect.addEventListener('change', () => {
  const v = chatDurationSelect.value;
  localStorage.setItem(CHAT_DURATION_KEY, v === '0' ? '0' : v);
});

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input?.value?.trim();
  if (!text || !ws || ws.readyState !== 1) return;
  try {
    playSendMessage();
    ws.send(JSON.stringify({ type: 'chat', text }));
    input.value = '';
  } catch (e) {
    showToast('Failed to send message');
  }
}

const chatInput = document.getElementById('chat-input');
if (chatInput) {
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  });
}

function sendBjChat() {
  const input = document.getElementById('bj-chat-input');
  const text = input?.value?.trim();
  if (!text || !ws || ws.readyState !== 1) return;
  try {
    playSendMessage();
    ws.send(JSON.stringify({ type: 'chat', text }));
    input.value = '';
  } catch (e) {
    showToast('Failed to send message');
  }
}

function sendLobbyChat() {
  const text = lobbyChatInput?.value?.trim();
  if (!text || !ws || ws.readyState !== 1) return;
  try {
    playSendMessage();
    ws.send(JSON.stringify({ type: 'chat', text }));
    if (lobbyChatInput) lobbyChatInput.value = '';
  } catch (e) {
    showToast('Failed to send message');
  }
}

if (lobbyChatInput) {
  lobbyChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendLobbyChat(); }
  });
}

// ── Lobby overlays & buttons ──
const themesOverlay = document.getElementById('themes-overlay');
const settingsOverlay = document.getElementById('settings-overlay');
const themesBtn = document.getElementById('lobby-themes-btn');
const settingsBtn = document.getElementById('lobby-settings-btn');
const themesClose = document.getElementById('themes-close');
const settingsClose = document.getElementById('settings-close');
const inviteBtn = document.getElementById('lobby-invite-btn');

function toggleOverlay(overlay) {
  if (!overlay) return;
  overlay.classList.toggle('hidden');
}

function openSettingsOverlay() {
  initRadioVolume();
  if (settingsOverlay) settingsOverlay.classList.remove('hidden');
}

if (themesBtn) themesBtn.addEventListener('click', () => toggleOverlay(themesOverlay));
if (themesClose) themesClose.addEventListener('click', () => themesOverlay.classList.add('hidden'));
if (settingsBtn) settingsBtn.addEventListener('click', () => toggleOverlay(settingsOverlay));
if (settingsClose) settingsClose.addEventListener('click', () => settingsOverlay.classList.add('hidden'));

const holdemSettingsBtn = document.getElementById('holdem-settings-btn');
const bjSettingsBtn = document.getElementById('bj-settings-btn');
const slotsSettingsBtn = document.getElementById('slots-settings-btn');
if (holdemSettingsBtn) holdemSettingsBtn.addEventListener('click', openSettingsOverlay);
if (bjSettingsBtn) bjSettingsBtn.addEventListener('click', openSettingsOverlay);
if (slotsSettingsBtn) slotsSettingsBtn.addEventListener('click', openSettingsOverlay);

if (themesOverlay) {
  themesOverlay.addEventListener('click', (e) => {
    if (e.target === themesOverlay) themesOverlay.classList.add('hidden');
  });
}
if (settingsOverlay) {
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
  });
}

document.querySelectorAll('.theme-opt').forEach((btn) => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    applyTheme(theme);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'changeTheme', theme }));
    }
  });
});

if (lobbyRebuyBtn) {
  lobbyRebuyBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'rebuy' }));
      if (typeof soundRebuy !== 'undefined' && soundRebuy?._ready) {
        soundRebuy.volume = 0.5;
        soundRebuy.currentTime = 0;
        soundRebuy.play().catch(() => {});
      }
    }
  });
}

if (inviteBtn) {
  inviteBtn.addEventListener('click', () => {
    const url = window.location.origin + '?room=' + encodeURIComponent(roomKey);
    navigator.clipboard.writeText(url).then(() => {
      showToast('Invite link copied!');
    }).catch(() => {
      showToast('Could not copy link');
    });
  });
}

// ── Lobby style toggle (Modern / Retro) ──
const LOBBY_STYLE_KEY = 'arcade_lobby_style';

function applyLobbyStyle(style) {
  if (style === 'retro') {
    document.body.classList.add('lobby-retro');
  } else {
    document.body.classList.remove('lobby-retro');
  }
  document.querySelectorAll('.lobby-style-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.style === style);
  });
  localStorage.setItem(LOBBY_STYLE_KEY, style);
}

document.querySelectorAll('.lobby-style-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    applyLobbyStyle(btn.dataset.style);
  });
});

applyLobbyStyle(localStorage.getItem(LOBBY_STYLE_KEY) || 'modern');

const bjChatInput = document.getElementById('bj-chat-input');
if (bjChatInput) {
  bjChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendBjChat(); }
  });
}

function sendSlotsChat() {
  const input = document.getElementById('slots-chat-input');
  const text = input?.value?.trim();
  if (!text || !ws || ws.readyState !== 1) return;
  try {
    playSendMessage();
    ws.send(JSON.stringify({ type: 'chat', text }));
    input.value = '';
  } catch (e) {
    showToast('Failed to send message');
  }
}

const slotsChatInput = document.getElementById('slots-chat-input');
if (slotsChatInput) {
  slotsChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendSlotsChat(); }
  });
}

const params = new URLSearchParams(window.location.search);
const roomParam = params.get('room');
if (roomParam && roomKeyInput) {
  roomKeyInput.value = roomParam;
}

checkAuth();
initRadioVolume();
