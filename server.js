const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { WebSocketServer } = require('ws');
const Hand = require('pokersolver').Hand;
const { decideAction, getPosition } = require('./bot_decide');
const pool = require('./db');
const authRouter = require('./auth');
const STOCKFISH_CLI_PATH = path.join(__dirname, 'node_modules', 'stockfish', 'scripts', 'cli.js');

const PORT = process.env.PORT || 3000;
const app = express();

// Trust proxy so req.protocol is correct behind Railway/nginx (fixes OAuth redirect_uri using http instead of https)
app.set('trust proxy', 1);

const sessionMiddleware = session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'virtual-arcade-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/auth', authRouter);

app.get('/health', (req, res) => res.send('ok'));

const cardsPath = path.join(__dirname, 'public', 'cards');
const cardsPathAlt = path.join(__dirname, '..', 'cards');
if (fs.existsSync(cardsPath)) {
  app.use('/cards', express.static(cardsPath));
} else if (fs.existsSync(cardsPathAlt)) {
  app.use('/cards', express.static(cardsPathAlt));
}

const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`Virtual Arcade running at http://${HOST}:${PORT}`);
});

const wss = new WebSocketServer({ server });

async function saveUserChips(userId, chips) {
  if (!userId) return;
  try {
    await pool.query('UPDATE users SET chips = $1 WHERE id = $2', [chips, userId]);
  } catch (err) {
    console.error('Failed to save chips:', err.message);
  }
}

pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS chess_best_computer_level INTEGER NOT NULL DEFAULT 0')
  .catch((err) => console.error('Failed to ensure chess leaderboard column:', err.message));

async function saveUserCosmetics(userId, purchasedOutfits, equippedOutfit, purchasedCharacters, equippedCharacter) {
  if (!userId) return;
  try {
    await pool.query(
      'UPDATE users SET purchased_outfits = $1, equipped_outfit = $2, purchased_characters = $3, equipped_character = $4 WHERE id = $5',
      [purchasedOutfits, equippedOutfit || null, purchasedCharacters, equippedCharacter || null, userId]
    );
  } catch (err) {
    console.error('Failed to save cosmetics:', err.message);
  }
}

async function saveChessComputerBestLevel(userId, elo) {
  if (!userId) return;
  const clamped = Math.max(200, Math.min(3000, Math.floor(Number(elo) || 200)));
  try {
    await pool.query(
      'UPDATE users SET chess_best_computer_level = GREATEST(COALESCE(chess_best_computer_level, 0), $1) WHERE id = $2',
      [clamped, userId]
    );
  } catch (err) {
    console.error('Failed to save chess computer best level:', err.message);
  }
}

async function getChessComputerLeaderboard(limit = 10) {
  try {
    const n = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
    const result = await pool.query(
      `SELECT username, chess_best_computer_level
       FROM users
       WHERE COALESCE(chess_best_computer_level, 0) > 0
       ORDER BY chess_best_computer_level DESC, username ASC
       LIMIT $1`,
      [n]
    );
    return result.rows.map((r) => ({
      username: r.username,
      level: Number(r.chess_best_computer_level) || 0,
    }));
  } catch (err) {
    console.error('Failed to fetch chess leaderboard:', err.message);
    return [];
  }
}

async function sendChessComputerLeaderboard(ws) {
  if (!ws || ws.readyState !== 1) return;
  const entries = await getChessComputerLeaderboard(10);
  try {
    ws.send(JSON.stringify({ type: 'chComputerLeaderboard', entries }));
  } catch (_) {}
}

async function broadcastChessComputerLeaderboard(roomKey) {
  const room = getRoom(roomKey);
  const viewers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess' && p.ws?.readyState === 1);
  if (!viewers.length) return;
  const entries = await getChessComputerLeaderboard(10);
  viewers.forEach((p) => {
    try {
      p.ws.send(JSON.stringify({ type: 'chComputerLeaderboard', entries }));
    } catch (_) {}
  });
}

async function broadcastChessComputerLeaderboardAllChessViewers() {
  const entries = await getChessComputerLeaderboard(10);
  rooms.forEach((room) => {
    room.players.forEach((p) => {
      if ((p.currentView ?? 'lobby') !== 'chess' || p.ws?.readyState !== 1) return;
      try {
        p.ws.send(JSON.stringify({ type: 'chComputerLeaderboard', entries }));
      } catch (_) {}
    });
  });
}

function parseSessionFromWs(ws, req) {
  return new Promise((resolve) => {
    sessionMiddleware(req, {}, () => {
      ws._userId = req.session?.userId || null;
      resolve(ws._userId);
    });
  });
}

const rooms = new Map();
const clients = new Map();

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Card to pokersolver format: Ad, Kh, etc.
function toSolverFormat(card) {
  const rankMap = { '10': 'T', 'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A' };
  const suitMap = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' };
  const r = rankMap[card.rank] || card.rank;
  const s = suitMap[card.suit] || 'h';
  return r + s;
}

// Pokersolver card back to our format
function fromSolverCard(sc) {
  const rankMap = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
  const suitMap = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };
  return { rank: rankMap[sc.value] || sc.value, suit: suitMap[sc.suit] || 'hearts' };
}

function cardInHole(card, holeCards) {
  if (!card || !holeCards?.length) return false;
  return holeCards.some((h) => h.rank === card.rank && h.suit === card.suit);
}

function winningHoleIndices(winningCards, holeCards) {
  const indices = [];
  winningCards.forEach((card, i) => {
    if (cardInHole(card, holeCards)) indices.push(i);
  });
  return indices;
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const TURN_TIMEOUT_MS = 60 * 1000;

const LOBBY_CHAT_MAX = 100;

const MAX_PLAYERS = { holdem: 6, blackjack: 6, checkers: 2, chess: 2, slots: 999 };
const OUTFIT_PRICES = {};
const CHARACTER_PRICES = {
  agent: 150,
  alt_girl: 100,
  army: 150,
  default_boy_1: 0,
  default_boy_2: 0,
  default_boy_3: 0,
  default_boy_4: 0,
  default_girl_1: 0,
  default_girl_2: 0,
  default_girl_3: 0,
  default_girl_4: 0,
  default_girl_5: 0,
  default_girl_6: 0,
  default_girl_7: 0,
  football_1: 150,
  football_2: 150,
  football_3: 150,
  football_4: 150,
  gator: 200,
  ghost: 150,
  king: 300,
  knight: 250,
  monopoly_man: 300,
  queen: 250,
  robot: 1000,
  sheriff: 1000,
  skeleton: 200,
  skeleton_2: 200,
  swimsuit_girl: 150,
  vampire: 250,
};
const DEFAULT_CHARACTER_IDS = Object.keys(CHARACTER_PRICES).filter((id) => id.includes('default'));

function normalizePurchasedOutfits(list) {
  return [];
}

function normalizePurchasedCharacters(list) {
  if (!Array.isArray(list)) return [];
  const allowed = new Set(Object.keys(CHARACTER_PRICES));
  return [...new Set(list
    .filter((id) => allowed.has(id)))];
}

function normalizeCharacterId(id) {
  return Object.prototype.hasOwnProperty.call(CHARACTER_PRICES, id) ? id : null;
}

function getRandomDefaultCharacterId() {
  if (!DEFAULT_CHARACTER_IDS.length) return null;
  const idx = Math.floor(Math.random() * DEFAULT_CHARACTER_IDS.length);
  return DEFAULT_CHARACTER_IDS[idx];
}

function serializePlayer(p) {
  const purchasedOutfits = normalizePurchasedOutfits(p.purchasedOutfits);
  const equippedOutfit = purchasedOutfits.includes(p.outfit) ? p.outfit : null;
  const purchasedCharacters = normalizePurchasedCharacters(p.purchasedCharacters);
  const normalizedCharacter = normalizeCharacterId(p.character);
  const equippedCharacter = normalizedCharacter && purchasedCharacters.includes(normalizedCharacter) ? normalizedCharacter : null;
  p.purchasedOutfits = purchasedOutfits;
  p.outfit = equippedOutfit;
  p.purchasedCharacters = purchasedCharacters;
  p.character = equippedCharacter;
  return {
    id: p.id,
    nickname: p.nickname,
    chips: p.chips,
    winStreak: p.winStreak ?? 0,
    maxWinStreak: p.maxWinStreak ?? 0,
    currentView: p.currentView ?? 'lobby',
    outfit: equippedOutfit,
    purchasedOutfits,
    character: equippedCharacter,
    purchasedCharacters,
  };
}

function getPlayersInGame(room, gameType) {
  return room.players.filter((p) => (p.currentView ?? 'lobby') === gameType);
}

function isGameFull(room, gameType) {
  const max = MAX_PLAYERS[gameType];
  if (!max) return false;
  return getPlayersInGame(room, gameType).length >= max;
}

function getRoom(roomKey) {
  if (!rooms.has(roomKey)) {
    rooms.set(roomKey, {
      players: [],
      chatHistory: [],
      gameState: null,
      deck: null,
      communityCards: [],
      pot: 0,
      currentBet: 0,
      dealerIdx: -1,
      smallBlind: 5,
      bigBlind: 10,
      phase: 'lobby',
      turnIdx: 0,
      lastRaiserIdx: -1,
      minRaise: 10,
      sidePots: [],
      turnTimeout: null,
      radio: null,
      gameType: 'holdem',
      bjDeck: null,
      bjDealerHand: [],
      bjPlayerHands: {},
      bjTurnIdx: 0,
      bjPhase: 'lobby',
      theme: null,
      ckMode: 'player',
      ckDifficulty: 1,
      ckVsComputer: false,
      ckBotMoveTimer: null,
      chMode: 'player',
      chDifficulty: 1200,
      chVsComputer: false,
      chBotMoveTimer: null,
    });
  }
  return rooms.get(roomKey);
}

function getHoldemPlayers(room) {
  return room.holdemPlayers || room.players.filter((p) => (p.currentView ?? 'lobby') === 'holdem');
}

function clearTurnTimer(room) {
  if (room.turnTimeout) {
    clearTimeout(room.turnTimeout);
    room.turnTimeout = null;
  }
}

function startTurnTimer(roomKey) {
  const room = getRoom(roomKey);
  clearTurnTimer(room);
  room.turnTimeout = setTimeout(() => {
    room.turnTimeout = null;
    const roomNow = getRoom(roomKey);
    const activePhases = ['preflop', 'flop', 'turn', 'river'];
    if (!activePhases.includes(roomNow.phase)) return;
    const players = getHoldemPlayers(roomNow);
    const idx = roomNow.turnIdx;
    const player = players[idx];
    if (!player || player.folded || player.allIn) return;

    const anyAllIn = players.some((p) => !p.folded && p.allIn && p.betThisRound > 0);
    const toCall = roomNow.currentBet - player.betThisRound;
    const canCheck = toCall <= 0 && !anyAllIn;

    if (canCheck) {
      broadcastToRoom(roomKey, {
        type: 'action',
        playerId: player.id,
        action: 'check',
        reason: 'timeout',
      });
    } else if (toCall > 0 && player.chips >= toCall) {
      const actual = toCall;
      player.chips -= actual;
      player.betThisRound += actual;
      player.totalBet += actual;
      room.pot += actual;
      if (player.chips === 0) player.allIn = true;
      broadcastToRoom(roomKey, {
        type: 'action',
        playerId: player.id,
        action: 'call',
        amount: actual,
        reason: 'timeout',
        pot: room.pot,
        players: players.map((p, i) => ({
          id: p.id,
          chips: p.chips,
          betThisRound: p.betThisRound,
          isTurn: i === roomNow.turnIdx,
        })),
      });
    } else {
      player.folded = true;
      const activeCount = players.filter((p) => !p.folded).length;
      broadcastToRoom(roomKey, {
        type: 'action',
        playerId: player.id,
        action: 'fold',
        reason: 'timeout',
        pot: roomNow.pot,
        players: players.map((p, i) => ({
          id: p.id,
          folded: p.folded,
          chips: p.chips,
          betThisRound: p.betThisRound,
          isTurn: i === roomNow.turnIdx,
        })),
      });
      if (activeCount <= 1) {
        showdown(roomKey);
        return;
      }
    }

    roomNow.turnIdx = advanceTurn(roomNow, idx);
    checkBettingComplete(roomKey);
  }, TURN_TIMEOUT_MS);
}

function broadcastToRoom(roomKey, message, excludeWs = null, filter = null) {
  const room = getRoom(roomKey);
  const payload = JSON.stringify(message);
  room.players.forEach((p) => {
    if (p.ws && p.ws !== excludeWs && p.ws.readyState === 1) {
      if (!filter || filter(p)) p.ws.send(payload);
    }
  });
}

function startGame(roomKey, resetStreaks = false, resetChips = false) {
  const room = getRoom(roomKey);
  let holdemPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'holdem');

  // Kick out anyone with $0 before starting
  holdemPlayers.forEach((p) => {
    if (p.chips <= 0) {
      if (p.isBot) {
        room.players = room.players.filter((x) => x.id !== p.id);
        broadcastToRoom(roomKey, { type: 'userLeft', id: p.id, botEliminated: true });
      } else {
        p.currentView = 'lobby';
        if (p.ws) {
          const data = clients.get(p.ws);
          if (data) clients.set(p.ws, { ...data, gameType: 'lobby' });
        }
        if (p.ws && p.ws.readyState === 1) {
          p.ws.send(JSON.stringify({ type: 'holdemBusted', reason: 'No chips' }));
        }
      }
    }
  });
  holdemPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'holdem' && p.chips > 0);

  if (holdemPlayers.length < 2 || holdemPlayers.length > 6) return;
  room.holdemPlayers = holdemPlayers;

  broadcastToRoom(roomKey, {
    type: 'playerViewChanged',
    players: room.players.map(serializePlayer),
  });

  if (resetChips) {
    holdemPlayers.forEach((p) => { p.chips = 100; });
  }
  if (resetStreaks) {
    holdemPlayers.forEach((p) => {
      p.winStreak = 0;
      p.maxWinStreak = 0;
    });
  }

  const count = holdemPlayers.length;
  room.deck = shuffle(createDeck());
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 0;
  room.phase = 'preflop';
  room.turnIdx = 0;
  room.lastRaiserIdx = -1;
  room.minRaise = room.bigBlind;
  room.sidePots = [];

  room.dealerIdx = (room.dealerIdx + 1) % count;

  let sbIdx, bbIdx;
  if (count === 2) {
    sbIdx = room.dealerIdx;
    bbIdx = (room.dealerIdx + 1) % count;
  } else {
    sbIdx = (room.dealerIdx + 1) % count;
    bbIdx = (room.dealerIdx + 2) % count;
  }

  holdemPlayers.forEach((p) => {
    p.hand = [room.deck.pop(), room.deck.pop()];
    p.betThisRound = 0;
    p.totalBet = 0;
    p.folded = false;
    p.allIn = false;
    p.chips = p.chips ?? 10;
  });

  const sbPay = Math.min(room.smallBlind, Math.max(0, holdemPlayers[sbIdx].chips));
  const bbPay = Math.min(room.bigBlind, Math.max(0, holdemPlayers[bbIdx].chips));
  holdemPlayers[sbIdx].chips -= sbPay;
  holdemPlayers[sbIdx].betThisRound = sbPay;
  holdemPlayers[sbIdx].totalBet += sbPay;
  if (holdemPlayers[sbIdx].chips === 0) holdemPlayers[sbIdx].allIn = true;
  holdemPlayers[bbIdx].chips -= bbPay;
  holdemPlayers[bbIdx].betThisRound = bbPay;
  holdemPlayers[bbIdx].totalBet += bbPay;
  if (holdemPlayers[bbIdx].chips === 0) holdemPlayers[bbIdx].allIn = true;
  room.pot = sbPay + bbPay;
  room.currentBet = room.bigBlind;

  room.turnIdx = advanceTurn(room, bbIdx);
  room.lastRaiserIdx = bbIdx;

  broadcastToRoom(roomKey, {
    type: 'gameStarted',
    dealerIdx: room.dealerIdx,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    pot: room.pot,
    currentBet: room.currentBet,
    turnIdx: room.turnIdx,
    phase: room.phase,
    minRaise: room.bigBlind,
    players: holdemPlayers.map((p, i) => ({
      id: p.id,
      nickname: p.nickname,
      chips: p.chips,
      betThisRound: p.betThisRound,
      folded: p.folded,
      isDealer: i === room.dealerIdx,
      isSB: i === sbIdx,
      isBB: i === bbIdx,
      isTurn: i === room.turnIdx,
      winStreak: p.winStreak ?? 0,
      maxWinStreak: p.maxWinStreak ?? 0,
    })),
  });

  holdemPlayers.forEach((p, i) => {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({
        type: 'yourHand',
        hand: p.hand,
      }));
    }
  });
  const turnPlayer = holdemPlayers[room.turnIdx];
  if (turnPlayer?.isBot) {
    scheduleBotAction(roomKey);
  } else {
    startTurnTimer(roomKey);
  }
}

function nextPhase(roomKey) {
  const room = getRoom(roomKey);
  const players = getHoldemPlayers(room);
  const activeCount = players.filter((p) => !p.folded).length;

  if (activeCount <= 1) {
    showdown(roomKey);
    return;
  }

  const allAllIn = players.filter((p) => !p.folded).every((p) => p.allIn || p.chips === 0);

  if (room.phase === 'preflop') {
    room.phase = 'flop';
    room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
  } else if (room.phase === 'flop') {
    room.phase = 'turn';
    room.communityCards.push(room.deck.pop());
  } else if (room.phase === 'turn') {
    room.phase = 'river';
    room.communityCards.push(room.deck.pop());
  } else {
    showdown(roomKey);
    return;
  }

  room.currentBet = 0;
  players.forEach((p) => (p.betThisRound = 0));
  room.minRaise = room.bigBlind;

  const onlyOneCanAct = players.filter((p) => canAct(p)).length <= 1;
  if (allAllIn || onlyOneCanAct) {
    broadcastToRoom(roomKey, {
      type: 'phaseChange',
      phase: room.phase,
      communityCards: room.communityCards,
      pot: room.pot,
      currentBet: 0,
      minRaise: room.minRaise,
      turnIdx: -1,
      players: players.map((p, i) => ({
        id: p.id,
        chips: p.chips,
        betThisRound: 0,
        folded: p.folded,
        isTurn: false,
      })),
    });
    setTimeout(() => nextPhase(roomKey), 1200);
    return;
  }

  room.turnIdx = advanceTurn(room, room.dealerIdx);
  room.lastRaiserIdx = room.turnIdx;

  broadcastToRoom(roomKey, {
    type: 'phaseChange',
    phase: room.phase,
    communityCards: room.communityCards,
    pot: room.pot,
    currentBet: room.currentBet,
    minRaise: room.minRaise,
    turnIdx: room.turnIdx,
    players: players.map((p, i) => ({
      id: p.id,
      chips: p.chips,
      betThisRound: p.betThisRound,
      folded: p.folded,
      isTurn: i === room.turnIdx,
    })),
  });
  const turnPlayer = players[room.turnIdx];
  if (turnPlayer?.isBot) {
    scheduleBotAction(roomKey);
  } else {
    startTurnTimer(roomKey);
  }
}

function showdown(roomKey) {
  const room = getRoom(roomKey);
  const players = getHoldemPlayers(room);
  const active = players.filter((p) => !p.folded);

  clearTurnTimer(room);

  if (active.length === 1) {
    active[0].chips += room.pot;
    const holeCards = active[0].hand;
    const winnerIds = [active[0].id];
    players.forEach((p) => {
      if (winnerIds.includes(p.id)) {
        p.winStreak = (p.winStreak || 0) + 1;
        p.maxWinStreak = Math.max(p.maxWinStreak || 0, p.winStreak);
      } else {
        p.winStreak = 0;
      }
    });
    broadcastToRoom(roomKey, {
      type: 'gameOver',
      winner: active[0].id,
      winners: [active[0].id],
      winnerNickname: active[0].nickname,
      winnerNicknames: [active[0].nickname],
      reason: 'fold',
      pot: room.pot,
      winAmount: room.pot,
      communityCards: room.communityCards,
      winningCards: holeCards,
      winningHoleIndices: [0, 1],
      handName: '',
      players: players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        chips: p.chips,
        hand: p.hand,
        folded: p.folded,
        totalBet: p.totalBet ?? 0,
        winStreak: p.winStreak ?? 0,
        maxWinStreak: p.maxWinStreak ?? 0,
      })),
    });
    if (active[0].isBot) {
      maybeBotChat(roomKey, active[0].id, active[0].nickname, BOT_PHRASES.win, 800);
    }
  } else {
    const allCards = room.communityCards;
    const hands = active.map((p) => {
      const cards = [...p.hand, ...allCards].map(toSolverFormat);
      return { player: p, hand: Hand.solve(cards) };
    });
    const winners = Hand.winners(hands.map((h) => h.hand));
    const winnerHands = hands.filter((h) => winners.includes(h.hand));
    const winnerIds = winnerHands.map((h) => h.player.id);
    const winAmount = Math.floor(room.pot / winnerIds.length);
    winnerHands.forEach((h) => (h.player.chips += winAmount));

    players.forEach((p) => {
      if (winnerIds.includes(p.id)) {
        p.winStreak = (p.winStreak || 0) + 1;
        p.maxWinStreak = Math.max(p.maxWinStreak || 0, p.winStreak);
      } else {
        p.winStreak = 0;
      }
    });

    const winningCards = winners[0]?.cards
      ? winners[0].cards.map(fromSolverCard)
      : [];
    const firstWinner = winnerHands[0]?.player;
    const winningHoleInds = firstWinner
      ? winningHoleIndices(winningCards, firstWinner.hand)
      : [];

    broadcastToRoom(roomKey, {
      type: 'gameOver',
      winners: winnerIds,
      winnerNicknames: winnerHands.map((h) => h.player.nickname),
      handName: winners[0]?.name || '',
      pot: room.pot,
      winAmount,
      communityCards: room.communityCards,
      winningCards,
      winningHoleIndices: winningHoleInds,
      players: players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        chips: p.chips,
        hand: p.hand,
        folded: p.folded,
        totalBet: p.totalBet ?? 0,
        winStreak: p.winStreak ?? 0,
        maxWinStreak: p.maxWinStreak ?? 0,
      })),
    });
    const winnerSet = new Set(winnerIds);
    players.forEach((p) => {
      if (!p.isBot) return;
      if (winnerSet.has(p.id)) {
        maybeBotChat(roomKey, p.id, p.nickname, BOT_PHRASES.win, 800);
      } else if (!p.folded) {
        maybeBotChat(roomKey, p.id, p.nickname, BOT_PHRASES.lose, 800);
      }
    });
  }

  room.phase = 'lobby';
  room.gameState = null;
  room.holdemPlayers = null;
  clearTurnTimer(room);

  players.forEach((p) => {
    if (p.dbUserId) saveUserChips(p.dbUserId, p.chips);
  });

  const hasBrokeBots = room.players.some((p) => p.isBot && p.chips <= 0);

  broadcastToRoom(roomKey, {
    type: 'roundOver',
    players: room.players.map(serializePlayer),
  });

  if (hasBrokeBots) {
    setTimeout(() => removeBrokeBots(roomKey), 4000);
  } else {
    removeBrokeBots(roomKey);
  }
}

function canAct(player) {
  return !player.folded && !player.allIn && player.chips > 0;
}

function removeBrokeBots(roomKey) {
  const room = getRoom(roomKey);
  const brokeBots = room.players.filter((p) => p.isBot && p.chips <= 0);
  brokeBots.forEach((bot) => {
    room.players = room.players.filter((p) => p.id !== bot.id);
    broadcastToRoom(roomKey, { type: 'userLeft', id: bot.id, botEliminated: true });
  });
}

function removeAllBots(roomKey) {
  const room = getRoom(roomKey);
  const bots = room.players.filter((p) => p.isBot);
  bots.forEach((bot) => {
    room.players = room.players.filter((p) => p.id !== bot.id);
    broadcastToRoom(roomKey, { type: 'userLeft', id: bot.id });
  });
}

function hasHumanPlayers(room) {
  return room.players.some((p) => !p.isBot);
}

const BOT_NAMES = ['Ace', 'Blaze', 'Cobra', 'Duke', 'Echo', 'Frost', 'Ghost', 'Hawk', 'Iron', 'Jinx'];
let botNameIdx = 0;

const BOT_PHRASES = {
  win: [
    'Thats what I thought', 'Get good', 'Easy.', 'Nice try.', 'Are you mad?',
    'booyah!', 'ez', 'gg', 'thanks for the chips lol', "that's rent",
    "that's how you do it", "don't cry", 'im rich',
  ],
  raiseCall: [
    'You dont have it', 'Lets make this interesting', 'Time to test your resolve',
    "let's make this interesting", 'locking in', "It's time…",
    'Show me the money!!!', "Don't be shy", 'You should just fold',
    'the path to victory is clear',
  ],
  raise: [
    'yolo', 'chicken', 'u wont', "How's this?", 'not a bluff',
    'lemme sprinkle a lil more on', 'Big money moves', 'Watch and learn',
  ],
  fold: [
    'Signs say, fold', "Don't take this as weakness", 'luck not on my side here',
    'I hate this game', 'Run it back',
  ],
  lose: [
    'Thats BS', 'Grrr', 'Luck.', 'dang', 'what?! nooooo',
    "that stings :'(", 'shoot!', 'how bout you dont tho',
    'so close…', 'good play', 'not bad', 'teach me', 'well done',
  ],
};

function maybeBotChat(roomKey, botId, botNickname, phrases, delayMs = 0) {
  if (Math.random() > 0.33) return;
  const text = phrases[Math.floor(Math.random() * phrases.length)];
  const send = () => broadcastToRoom(roomKey, { type: 'chat', playerId: botId, nickname: botNickname, text });
  if (delayMs > 0) setTimeout(send, delayMs);
  else send();
}

function scheduleBotAction(roomKey) {
  const room = getRoom(roomKey);
  const players = getHoldemPlayers(room);
  if (room.phase === 'lobby') return;
  const idx = room.turnIdx;
  const player = players[idx];
  if (!player?.isBot || player.folded || player.allIn) return;

  const delay = 500 + Math.floor(Math.random() * 1200);
  setTimeout(() => {
    if (room.phase === 'lobby') return;
    clearTurnTimer(room);

    const opponentsInHand = players.filter((p) => !p.folded && p.id !== player.id).length;
    const toCall = Math.max(0, room.currentBet - player.betThisRound);
    const facingRaise = room.currentBet > room.bigBlind;
    const position = getPosition(idx, room.dealerIdx, players.length);

    let decision;
    try {
      decision = decideAction({
        heroHole: player.hand,
        board: room.communityCards,
        pot: room.pot,
        toCall,
        stack: player.chips,
        opponentsInHand,
        street: room.phase,
        bigBlind: room.bigBlind,
        minRaise: room.minRaise,
        currentBet: room.currentBet,
        position,
        seatIdx: idx,
        dealerIdx: room.dealerIdx,
        numPlayers: players.length,
        facingRaise,
      });
    } catch (e) {
      decision = toCall > 0 ? { action: 'call' } : { action: 'check' };
    }

    executeBotAction(roomKey, room, players, idx, player, decision);
  }, delay);
}

function executeBotAction(roomKey, room, players, idx, player, decision) {
  const { action, amount } = decision;

  if (action === 'fold') {
    player.folded = true;
    const activeCount = players.filter((p) => !p.folded).length;
    broadcastToRoom(roomKey, {
      type: 'action', playerId: player.id, action: 'fold', reason: 'bot',
      pot: room.pot,
      players: players.map((p, i) => ({ id: p.id, folded: p.folded, chips: p.chips, betThisRound: p.betThisRound, isTurn: i === room.turnIdx })),
    });
    maybeBotChat(roomKey, player.id, player.nickname, BOT_PHRASES.fold, 300);
    if (activeCount <= 1) {
      setTimeout(() => { if (room.phase !== 'lobby') showdown(roomKey); }, 1200);
      return;
    }
    room.turnIdx = advanceTurn(room, room.turnIdx);
    checkBettingComplete(roomKey);

  } else if (action === 'check') {
    broadcastToRoom(roomKey, { type: 'action', playerId: player.id, action: 'check', reason: 'bot' });
    room.turnIdx = advanceTurn(room, room.turnIdx);
    checkBettingComplete(roomKey);

  } else if (action === 'call') {
    const toCall = Math.max(0, room.currentBet - player.betThisRound);
    const actual = Math.min(toCall, player.chips);
    player.chips -= actual;
    player.betThisRound += actual;
    player.totalBet += actual;
    room.pot += actual;
    if (player.chips === 0) player.allIn = true;
    broadcastToRoom(roomKey, {
      type: 'action', playerId: player.id, action: 'call', amount: actual, reason: 'bot',
      pot: room.pot,
      players: players.map((p, i) => ({ id: p.id, chips: p.chips, betThisRound: p.betThisRound, isTurn: i === room.turnIdx })),
    });
    maybeBotChat(roomKey, player.id, player.nickname, BOT_PHRASES.raiseCall, 300);
    room.turnIdx = advanceTurn(room, room.turnIdx);
    checkBettingComplete(roomKey);

  } else if (action === 'raise' || action === 'bet') {
    const facingAllIn = room.currentBet > 0 && room.lastRaiserIdx >= 0 && players[room.lastRaiserIdx]?.allIn === true;
    if (facingAllIn) {
      const toCall = Math.max(0, room.currentBet - player.betThisRound);
      const actual = Math.min(toCall, player.chips);
      player.chips -= actual;
      player.betThisRound += actual;
      player.totalBet += actual;
      room.pot += actual;
      if (player.chips === 0) player.allIn = true;
      broadcastToRoom(roomKey, {
        type: 'action', playerId: player.id, action: 'call', amount: actual, reason: 'bot',
        pot: room.pot,
        players: players.map((p, i) => ({ id: p.id, chips: p.chips, betThisRound: p.betThisRound, isTurn: i === room.turnIdx })),
      });
      maybeBotChat(roomKey, player.id, player.nickname, BOT_PHRASES.raiseCall, 300);
    } else {
      const raiseTo = Math.max(room.currentBet + room.minRaise, Math.floor(amount || room.currentBet + room.bigBlind));
      const toAdd = raiseTo - player.betThisRound;
      if (toAdd > player.chips || toAdd <= 0) {
        return executeBotAction(roomKey, room, players, idx, player, { action: 'allin' });
      }
      const prevBet = room.currentBet;
      player.chips -= toAdd;
      player.betThisRound = raiseTo;
      player.totalBet += toAdd;
      room.pot += toAdd;
      room.currentBet = raiseTo;
      room.lastRaiserIdx = idx;
      room.minRaise = Math.max(room.bigBlind, raiseTo - prevBet);
      if (player.chips === 0) player.allIn = true;
      broadcastToRoom(roomKey, {
        type: 'action', playerId: player.id, action: 'raise', amount: toAdd, reason: 'bot',
        currentBet: room.currentBet, minRaise: room.minRaise, pot: room.pot,
        players: players.map((p, i) => ({ id: p.id, chips: p.chips, betThisRound: p.betThisRound, isTurn: i === room.turnIdx })),
      });
      maybeBotChat(roomKey, player.id, player.nickname, BOT_PHRASES.raise, 300);
    }
    room.turnIdx = advanceTurn(room, room.turnIdx);
    checkBettingComplete(roomKey);

  } else if (action === 'allin') {
    const allInAmount = player.chips;
    if (allInAmount <= 0) {
      player.folded = true;
      broadcastToRoom(roomKey, {
        type: 'action', playerId: player.id, action: 'fold', reason: 'bot',
        pot: room.pot,
        players: players.map((p, i) => ({ id: p.id, folded: p.folded, chips: p.chips, betThisRound: p.betThisRound, isTurn: i === room.turnIdx })),
      });
      const activeCount = players.filter((p) => !p.folded).length;
      if (activeCount <= 1) { showdown(roomKey); return; }
      room.turnIdx = advanceTurn(room, room.turnIdx);
      checkBettingComplete(roomKey);
      return;
    }
    player.betThisRound += allInAmount;
    player.totalBet += allInAmount;
    room.pot += allInAmount;
    player.chips = 0;
    player.allIn = true;
    if (player.betThisRound > room.currentBet) {
      const prevBet = room.currentBet;
      room.currentBet = player.betThisRound;
      room.lastRaiserIdx = idx;
      room.minRaise = Math.max(room.bigBlind, player.betThisRound - prevBet);
    }
    const facingAllIn = room.currentBet > 0 && room.lastRaiserIdx >= 0 && players[room.lastRaiserIdx]?.allIn === true;
    broadcastToRoom(roomKey, {
      type: 'action', playerId: player.id, action: 'allin', amount: allInAmount, reason: 'bot',
      currentBet: room.currentBet, minRaise: room.minRaise, pot: room.pot, facingAllIn,
      players: players.map((p, i) => ({ id: p.id, chips: p.chips, betThisRound: p.betThisRound, isTurn: i === room.turnIdx })),
    });
    maybeBotChat(roomKey, player.id, player.nickname, BOT_PHRASES.raise, 300);
    room.turnIdx = advanceTurn(room, room.turnIdx);
    checkBettingComplete(roomKey);

  } else {
    const toCall = Math.max(0, room.currentBet - player.betThisRound);
    executeBotAction(roomKey, room, players, idx, player, toCall > 0 ? { action: 'call' } : { action: 'check' });
  }
}

function advanceTurn(room, fromIdx) {
  const players = getHoldemPlayers(room);
  const len = players.length;
  if (len === 0) return 0;
  let next = (fromIdx + 1) % len;
  for (let i = 0; i < len; i++) {
    if (canAct(players[next])) return next;
    next = (next + 1) % len;
  }
  return (fromIdx + 1) % len;
}

function checkBettingComplete(roomKey) {
  const room = getRoom(roomKey);
  const players = getHoldemPlayers(room);
  const active = players.filter((p) => canAct(p));
  if (active.length === 0) {
    nextPhase(roomKey);
    return;
  }
  if (active.length === 1) {
    if (active[0].betThisRound >= room.currentBet) {
      nextPhase(roomKey);
      return;
    }
  } else {
    const allMatched = active.every((p) => p.betThisRound >= room.currentBet);
    const raiserGone = room.lastRaiserIdx < 0 || !canAct(players[room.lastRaiserIdx]);
    if (allMatched && (room.turnIdx === room.lastRaiserIdx || raiserGone)) {
      nextPhase(roomKey);
      return;
    }
  }
  const turnPlayer = players[room.turnIdx];
  const facingAllIn = room.currentBet > 0 && room.lastRaiserIdx >= 0 && players[room.lastRaiserIdx]?.allIn === true;
  broadcastToRoom(roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: turnPlayer?.id, facingAllIn });
  if (turnPlayer?.isBot) {
    scheduleBotAction(roomKey);
  } else {
    startTurnTimer(roomKey);
  }
}

// ── Blackjack logic ──────────────────────────────────────────────────

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

function bjCreateShoe() {
  const shoe = [];
  for (let d = 0; d < 6; d++) shoe.push(...createDeck());
  return shuffle(shoe);
}

function bjStartGame(roomKey) {
  const room = getRoom(roomKey);
  const bjPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'blackjack');
  if (bjPlayers.length < 1 || bjPlayers.length > 6) return;
  room.bjPlayers = bjPlayers;
  room.bjPhase = 'betting';
  room.bjDeck = bjCreateShoe();
  room.bjDealerHand = [];
  room.bjPlayerHands = {};
  room.bjTurnIdx = 0;

  broadcastToRoom(roomKey, {
    type: 'bjGameStarted',
    players: bjPlayers.map((p) => ({ id: p.id, nickname: p.nickname, chips: p.chips })),
  });
}

function bjPlaceBet(roomKey, playerId, amount) {
  const room = getRoom(roomKey);
  if (room.bjPhase !== 'betting') return;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return;
  if (room.bjPlayerHands[playerId]?.bet > 0) return;

  const bet = Math.floor(Number(amount) || 0);
  if (bet < 10 || bet > player.chips) return;

  player.chips -= bet;
  room.bjPlayerHands[playerId] = { hand: [], bet, total: 0, status: 'playing' };

  broadcastToRoom(roomKey, {
    type: 'bjBetPlaced',
    playerId,
    bet,
    chips: player.chips,
  });

  const bjPl = room.bjPlayers || room.players;
  const allBet = bjPl.every((p) => room.bjPlayerHands[p.id]?.bet > 0);
  if (allBet) bjDeal(roomKey);
}

function bjDeal(roomKey) {
  const room = getRoom(roomKey);
  room.bjPhase = 'playing';
  const deck = room.bjDeck;

  const bjPl = room.bjPlayers || room.players;
  for (const p of bjPl) {
    const ph = room.bjPlayerHands[p.id];
    ph.hand = [deck.pop(), deck.pop()];
    ph.total = bjHandTotal(ph.hand);
  }
  room.bjDealerHand = [deck.pop(), deck.pop()];

  const dealerUpCard = room.bjDealerHand[0];
  const dealerTotal = bjHandTotal(room.bjDealerHand);

  const dealerHasBlackjack = dealerTotal === 21 && room.bjDealerHand.length === 2;
  const dealerUpIs10orA = ['A', 'K', 'Q', 'J', '10'].includes(dealerUpCard.rank);

  const playersPayload = bjPl.map((op) => {
    const oph = room.bjPlayerHands[op.id];
    return { id: op.id, nickname: op.nickname, hand: oph.hand, total: oph.total, bet: oph.bet, status: oph.status };
  });
  broadcastToRoom(roomKey, {
    type: 'bjDealt',
    dealerUpCard,
    dealerHand: [dealerUpCard, { hidden: true }],
    players: playersPayload,
  });

  if (dealerUpIs10orA && dealerHasBlackjack) {
    bjPl.forEach((p) => {
      const ph = room.bjPlayerHands[p.id];
      if (ph.total === 21 && ph.hand.length === 2) {
        ph.status = 'push';
        p.chips += ph.bet;
      } else {
        ph.status = 'lost';
      }
    });
    broadcastToRoom(roomKey, {
      type: 'bjDealerTurn',
      holeCard: room.bjDealerHand[1],
      dealerTotal,
    });
    bjCalculateResults(roomKey);
    return;
  }

  for (const p of bjPl) {
    const ph = room.bjPlayerHands[p.id];
    if (ph.total === 21 && ph.hand.length === 2) {
      ph.status = 'blackjack';
    }
  }

  room.bjTurnIdx = 0;
  bjStartPlayerTurn(roomKey);
}

function bjStartPlayerTurn(roomKey) {
  const room = getRoom(roomKey);
  const bjPl = room.bjPlayers || room.players;
  while (room.bjTurnIdx < bjPl.length) {
    const p = bjPl[room.bjTurnIdx];
    const ph = room.bjPlayerHands[p.id];
    if (ph.status === 'playing') {
      broadcastToRoom(roomKey, { type: 'bjYourTurn', playerId: p.id });
      return;
    }
    room.bjTurnIdx++;
  }
  bjDealerPlay(roomKey);
}

function bjAdvanceTurn(roomKey) {
  const room = getRoom(roomKey);
  room.bjTurnIdx++;
  bjStartPlayerTurn(roomKey);
}

function bjPlayerAction(roomKey, playerId, action) {
  const room = getRoom(roomKey);
  const bjPl = room.bjPlayers || room.players;
  if (room.bjPhase !== 'playing') return;
  const pIdx = bjPl.findIndex((p) => p.id === playerId);
  if (pIdx < 0 || pIdx !== room.bjTurnIdx) return;
  const player = bjPl[pIdx];
  const ph = room.bjPlayerHands[playerId];
  if (ph.status !== 'playing') return;

  if (action === 'hit') {
    const card = room.bjDeck.pop();
    ph.hand.push(card);
    ph.total = bjHandTotal(ph.hand);
    if (ph.total > 21) {
      ph.status = 'busted';
      broadcastToRoom(roomKey, {
        type: 'bjCardDealt',
        playerId,
        card,
        total: ph.total,
        status: 'busted',
      });
      bjAdvanceTurn(roomKey);
    } else {
      broadcastToRoom(roomKey, {
        type: 'bjCardDealt',
        playerId,
        card,
        total: ph.total,
        status: 'playing',
      });
    }
  } else if (action === 'stand') {
    ph.status = 'stood';
    broadcastToRoom(roomKey, {
      type: 'bjCardDealt',
      playerId,
      card: null,
      total: ph.total,
      status: 'stood',
    });
    bjAdvanceTurn(roomKey);
  } else if (action === 'double') {
    if (player.chips < ph.bet) return;
    player.chips -= ph.bet;
    ph.bet *= 2;
    const card = room.bjDeck.pop();
    ph.hand.push(card);
    ph.total = bjHandTotal(ph.hand);
    if (ph.total > 21) {
      ph.status = 'busted';
    } else {
      ph.status = 'stood';
    }
    broadcastToRoom(roomKey, {
      type: 'bjCardDealt',
      playerId,
      card,
      total: ph.total,
      status: ph.status,
      doubled: true,
      bet: ph.bet,
      chips: player.chips,
    });
    bjAdvanceTurn(roomKey);
  }
}

function bjDealerPlay(roomKey) {
  const room = getRoom(roomKey);
  const bjPl = room.bjPlayers || room.players;
  room.bjPhase = 'dealerTurn';

  const allBustedOrBJ = bjPl.every((p) => {
    const s = room.bjPlayerHands[p.id].status;
    return s === 'busted' || s === 'blackjack';
  });

  broadcastToRoom(roomKey, {
    type: 'bjDealerTurn',
    holeCard: room.bjDealerHand[1],
    dealerHand: room.bjDealerHand,
    dealerTotal: bjHandTotal(room.bjDealerHand),
  });

  if (allBustedOrBJ) {
    bjCalculateResults(roomKey);
    return;
  }

  bjDealerHitLoop(roomKey);
}

function bjDealerHitLoop(roomKey) {
  const room = getRoom(roomKey);
  const total = bjHandTotal(room.bjDealerHand);
  if (total >= 17) {
    bjCalculateResults(roomKey);
    return;
  }
  const card = room.bjDeck.pop();
  room.bjDealerHand.push(card);
  const newTotal = bjHandTotal(room.bjDealerHand);
  broadcastToRoom(roomKey, {
    type: 'bjDealerCard',
    card,
    dealerTotal: newTotal,
  });
  if (newTotal >= 17) {
    setTimeout(() => bjCalculateResults(roomKey), 800);
  } else {
    setTimeout(() => bjDealerHitLoop(roomKey), 800);
  }
}

function bjCalculateResults(roomKey) {
  const room = getRoom(roomKey);
  const bjPl = room.bjPlayers || room.players;
  room.bjPhase = 'results';
  const dealerTotal = bjHandTotal(room.bjDealerHand);
  const dealerBusted = dealerTotal > 21;

  const results = bjPl.map((p) => {
    const ph = room.bjPlayerHands[p.id];
    let status, payout = 0;

    if (ph.status === 'blackjack') {
      if (dealerTotal === 21 && room.bjDealerHand.length === 2) {
        status = 'push';
        payout = ph.bet;
      } else {
        status = 'blackjack';
        payout = ph.bet + Math.floor(ph.bet * 1.5);
      }
    } else if (ph.status === 'busted') {
      status = 'lost';
      payout = 0;
    } else if (dealerBusted) {
      status = 'won';
      payout = ph.bet * 2;
    } else if (ph.total > dealerTotal) {
      status = 'won';
      payout = ph.bet * 2;
    } else if (ph.total === dealerTotal) {
      status = 'push';
      payout = ph.bet;
    } else {
      status = 'lost';
      payout = 0;
    }

    p.chips += payout;
    return {
      id: p.id,
      nickname: p.nickname,
      hand: ph.hand,
      total: ph.total,
      bet: ph.bet,
      status,
      payout,
      chips: p.chips,
    };
  });

  broadcastToRoom(roomKey, {
    type: 'bjResults',
    dealerTotal,
    dealerBusted,
    dealerHand: room.bjDealerHand,
    players: results,
  });

  bjPl.forEach((p) => {
    if (p.dbUserId) saveUserChips(p.dbUserId, p.chips);
  });

  room.bjPhase = 'lobby';
  room.phase = 'lobby';
}

// ── Checkers logic ───────────────────────────────────────────────────

function ckCreateBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) {
        if (r < 3) board[r][c] = { color: 'white', king: false };
        else if (r > 4) board[r][c] = { color: 'red', king: false };
      }
    }
  }
  return board;
}

function ckGetValidMoves(board, row, col, color, capturesOnly = false) {
  const piece = board[row][col];
  if (!piece || piece.color !== color) return [];

  const dirs = piece.king
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : color === 'red' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];

  const jumps = [];
  const steps = [];

  for (const [dr, dc] of dirs) {
    const mr = row + dr, mc = col + dc;
    const jr = row + 2 * dr, jc = col + 2 * dc;

    if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8 &&
        board[mr]?.[mc] && board[mr][mc].color !== color && !board[jr][jc]) {
      jumps.push({ row: jr, col: jc, captured: { row: mr, col: mc } });
    }

    if (!capturesOnly && mr >= 0 && mr < 8 && mc >= 0 && mc < 8 && !board[mr][mc]) {
      steps.push({ row: mr, col: mc });
    }
  }

  if (capturesOnly || jumps.length > 0) return jumps;
  return steps;
}

function ckHasAnyCapture(board, color, fromRow = null, fromCol = null) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (fromRow != null && (r !== fromRow || c !== fromCol)) continue;
      const moves = ckGetValidMoves(board, r, c, color, true);
      if (moves.length > 0) return true;
    }
  }
  return false;
}

function ckCheckWin(board, nextTurnColor) {
  let hasPieces = false;
  let hasLegalMoves = false;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] && board[r][c].color === nextTurnColor) {
        hasPieces = true;
        if (ckGetValidMoves(board, r, c, nextTurnColor).length > 0) {
          hasLegalMoves = true;
        }
      }
    }
  }
  if (!hasPieces || !hasLegalMoves) {
    return nextTurnColor === 'red' ? 'white' : 'red';
  }
  return null;
}

function ckClearTurnTimer(room) {
  if (room.ckTurnTimeout) {
    clearTimeout(room.ckTurnTimeout);
    room.ckTurnTimeout = null;
  }
}

const CHECKERS_COMPUTER_ID = 'checkers-computer';

function ckClearBotMoveTimer(room) {
  if (room.ckBotMoveTimer) {
    clearTimeout(room.ckBotMoveTimer);
    room.ckBotMoveTimer = null;
  }
}

function ckBroadcastModeState(roomKey, room) {
  const mode = room.ckMode === 'computer' ? 'computer' : 'player';
  const difficulty = Math.max(1, Math.min(3, Number(room.ckDifficulty) || 1));
  broadcastToRoom(roomKey, { type: 'ckModeState', mode, difficulty }, null, (p) => (p.currentView ?? 'lobby') === 'checkers');
}

function ckCloneBoard(board) {
  return board.map((row) => row.map((cell) => (cell ? { color: cell.color, king: !!cell.king } : null)));
}

function ckGetLegalMovesForState(board, color, mustContinue = null) {
  const moves = [];
  if (mustContinue) {
    const list = ckGetValidMoves(board, mustContinue.row, mustContinue.col, color, true);
    list.forEach((m) => moves.push({
      from: { row: mustContinue.row, col: mustContinue.col },
      to: { row: m.row, col: m.col },
      captured: m.captured || null,
    }));
    return moves;
  }
  const forceCapture = ckHasAnyCapture(board, color);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      let pieceMoves = ckGetValidMoves(board, r, c, color, false);
      if (forceCapture) pieceMoves = pieceMoves.filter((m) => m.captured);
      pieceMoves.forEach((m) => moves.push({
        from: { row: r, col: c },
        to: { row: m.row, col: m.col },
        captured: m.captured || null,
      }));
    }
  }
  return moves;
}

function ckApplyMoveState(board, color, move) {
  const nextBoard = ckCloneBoard(board);
  const piece = nextBoard[move.from.row][move.from.col];
  if (!piece || piece.color !== color) return null;
  nextBoard[move.to.row][move.to.col] = { ...piece };
  nextBoard[move.from.row][move.from.col] = null;
  if (move.captured) {
    nextBoard[move.captured.row][move.captured.col] = null;
  }
  let promoted = false;
  if (color === 'red' && move.to.row === 0 && !nextBoard[move.to.row][move.to.col].king) {
    nextBoard[move.to.row][move.to.col].king = true;
    promoted = true;
  } else if (color === 'white' && move.to.row === 7 && !nextBoard[move.to.row][move.to.col].king) {
    nextBoard[move.to.row][move.to.col].king = true;
    promoted = true;
  }
  let mustContinue = null;
  if (move.captured) {
    const more = ckGetValidMoves(nextBoard, move.to.row, move.to.col, color, true);
    if (more.length > 0) mustContinue = { row: move.to.row, col: move.to.col };
  }
  const nextTurn = mustContinue ? color : (color === 'red' ? 'white' : 'red');
  return { board: nextBoard, mustContinue, nextTurn, promoted };
}

function ckEvaluateBoard(board, botColor) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const value = piece.king ? 170 : 100;
      score += piece.color === botColor ? value : -value;
    }
  }
  return score;
}

function ckNegamax(board, turnColor, botColor, mustContinue, depth) {
  const moves = ckGetLegalMovesForState(board, turnColor, mustContinue);
  if (depth <= 0 || moves.length === 0) {
    if (moves.length === 0) {
      return turnColor === botColor ? -100000 : 100000;
    }
    return ckEvaluateBoard(board, botColor);
  }
  let best = -Infinity;
  for (const mv of moves) {
    const applied = ckApplyMoveState(board, turnColor, mv);
    if (!applied) continue;
    const score = -ckNegamax(applied.board, applied.nextTurn, botColor, applied.mustContinue, depth - 1);
    if (score > best) best = score;
  }
  return best === -Infinity ? ckEvaluateBoard(board, botColor) : best;
}

function ckPickComputerMove(room) {
  const botColor = room.ckPlayers?.red === CHECKERS_COMPUTER_ID ? 'red' : 'white';
  const board = room.ckBoard;
  const mustContinue = room.ckMustContinue || null;
  const moves = ckGetLegalMovesForState(board, botColor, mustContinue);
  if (!moves.length) return null;
  const difficulty = Math.max(1, Math.min(3, Number(room.ckDifficulty) || 1));
  if (difficulty === 1) {
    return moves[Math.floor(Math.random() * moves.length)];
  }
  if (difficulty === 2) {
    let best = null;
    let bestScore = -Infinity;
    for (const mv of moves) {
      const applied = ckApplyMoveState(board, botColor, mv);
      if (!applied) continue;
      let score = ckEvaluateBoard(applied.board, botColor);
      if (mv.captured) score += 40;
      if (applied.promoted) score += 60;
      if (score > bestScore) {
        bestScore = score;
        best = mv;
      }
    }
    return best || moves[0];
  }
  let best = null;
  let bestScore = -Infinity;
  for (const mv of moves) {
    const applied = ckApplyMoveState(board, botColor, mv);
    if (!applied) continue;
    const score = -ckNegamax(applied.board, applied.nextTurn, botColor, applied.mustContinue, 5);
    if (score > bestScore) {
      bestScore = score;
      best = mv;
    }
  }
  return best || moves[0];
}

function ckAwardWinner(room, winnerColor) {
  if (!winnerColor || !room.ckPlayers || !room.ckPlayersList) return;
  const winnerId = room.ckPlayers[winnerColor];
  const winnerP = room.ckPlayersList.find((p) => p.id === winnerId);
  if (!winnerP) return;
  const wager = room.ckWager || 0;
  if (wager <= 0) return;
  if (room.ckVsComputer) {
    if (winnerP.id !== CHECKERS_COMPUTER_ID) {
      winnerP.chips = (winnerP.chips || 0) + wager;
    }
  } else {
    winnerP.chips = (winnerP.chips || 0) + wager * 2;
  }
}

function ckScheduleBotMove(roomKey, delayMs = 450) {
  const room = getRoom(roomKey);
  if (!room.ckVsComputer || room.ckPhase !== 'playing') return;
  const botColor = room.ckPlayers?.red === CHECKERS_COMPUTER_ID ? 'red' : 'white';
  if (room.ckTurn !== botColor) return;
  ckClearTurnTimer(room);
  ckClearBotMoveTimer(room);
  room.ckBotMoveTimer = setTimeout(() => {
    room.ckBotMoveTimer = null;
    const current = getRoom(roomKey);
    if (!current.ckVsComputer || current.ckPhase !== 'playing') return;
    const currentBotColor = current.ckPlayers?.red === CHECKERS_COMPUTER_ID ? 'red' : 'white';
    if (current.ckTurn !== currentBotColor) return;
    const move = ckPickComputerMove(current);
    if (!move) return;
    ckMakeMove(roomKey, CHECKERS_COMPUTER_ID, move.from, move.to);
  }, Math.max(120, delayMs));
}

function ckStartTurnTimer(roomKey) {
  const room = getRoom(roomKey);
  ckClearTurnTimer(room);
  if (room.ckVsComputer && room.ckPlayers?.[room.ckTurn] === CHECKERS_COMPUTER_ID) {
    ckScheduleBotMove(roomKey);
    return;
  }
  if (!room.ckTimerMs || room.ckTimerMs <= 0) return;
  room.ckTurnDeadline = Date.now() + room.ckTimerMs;
  room.ckTurnTimeout = setTimeout(() => {
    room.ckTurnTimeout = null;
    const r = getRoom(roomKey);
    if (r.ckPhase !== 'playing') return;
    const losingColor = r.ckTurn;
    const winnerColor = losingColor === 'red' ? 'white' : 'red';
    r.ckPhase = 'over';
    ckClearBotMoveTimer(r);
    const wager = r.ckWager || 0;
    ckAwardWinner(r, winnerColor);
    const winnerP = r.ckPlayersList?.find((p) => p.id === r.ckPlayers[winnerColor]);
    const loserP = r.ckPlayersList?.find((p) => p.id === r.ckPlayers[losingColor]);
    broadcastToRoom(roomKey, {
      type: 'ckGameOver',
      winner: winnerColor,
      reason: 'timeout',
      wager,
      players: r.ckPlayersList?.map((p) => ({ id: p.id, chips: p.chips, nickname: p.nickname })) || [],
      winnerNickname: winnerP?.nickname || 'Winner',
      loserNickname: loserP?.nickname || 'Opponent',
    });
  }, room.ckTimerMs);
}

function broadcastCkWagerState(roomKey, room) {
  const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
  if (ckPlayers.length !== 2) return;
  const proposals = room.ckWagerProposals || {};
  const ready = room.ckWagerReady || {};
  const locked = room.ckWagerLocked || {};
  const chips = {};
  const nicknames = {};
  ckPlayers.forEach((p) => {
    chips[p.id] = p.chips || 0;
    nicknames[p.id] = p.nickname || 'Player';
  });
  broadcastToRoom(roomKey, {
    type: 'ckWagerState',
    proposals,
    ready,
    locked,
    chips,
    nicknames,
  });
}

function broadcastChWagerState(roomKey, room) {
  const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
  if (chPlayers.length !== 2) return;
  const proposals = room.chWagerProposals || {};
  const ready = room.chWagerReady || {};
  const locked = room.chWagerLocked || {};
  const chips = {};
  const nicknames = {};
  chPlayers.forEach((p) => {
    chips[p.id] = p.chips || 0;
    nicknames[p.id] = p.nickname || 'Player';
  });
  broadcastToRoom(roomKey, {
    type: 'chWagerState',
    proposals,
    ready,
    locked,
    chips,
    nicknames,
  });
}

function broadcastChModeState(roomKey, room) {
  const mode = room.chMode === 'computer' ? 'computer' : 'player';
  const difficulty = Math.max(200, Math.min(3000, Number(room.chDifficulty) || 1200));
  broadcastToRoom(roomKey, { type: 'chModeState', mode, difficulty }, null, (p) => (p.currentView ?? 'lobby') === 'chess');
}

function ckStartGame(roomKey, timerSeconds) {
  const room = getRoom(roomKey);
  const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
  if (ckPlayers.length !== 2) return;
  room.ckVsComputer = false;
  ckClearBotMoveTimer(room);

  let wager = 0;
  const locked = room.ckWagerLocked || {};
  const lock1 = locked[ckPlayers[0].id];
  const lock2 = locked[ckPlayers[1].id];
  const bothLocked = lock1 !== undefined && lock2 !== undefined;
  const match = bothLocked && lock1 === lock2;
  if (bothLocked && match && lock1 > 0) {
    const p1 = ckPlayers[0];
    const p2 = ckPlayers[1];
    const maxWager = Math.min(p1.chips || 0, p2.chips || 0);
    wager = Math.min(lock1, maxWager);
    if (wager > 0) {
      p1.chips = (p1.chips || 0) - wager;
      p2.chips = (p2.chips || 0) - wager;
    }
  }
  room.ckWager = wager;
  room.ckWagerProposals = {};
  room.ckWagerReady = {};
  room.ckWagerLocked = {};

  room.ckPlayersList = ckPlayers;

  room.ckBoard = ckCreateBoard();
  room.ckTurn = 'red';
  room.ckPhase = 'playing';
  room.ckMustContinue = null;
  room.ckTimerMs = (timerSeconds && timerSeconds > 0) ? timerSeconds * 1000 : 0;
  room.ckTurnDeadline = 0;

  room.ckPlayers = {
    red: ckPlayers[0].id,
    white: ckPlayers[1].id,
  };

  const playersInfo = ckPlayers.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    color: room.ckPlayers.red === p.id ? 'red' : 'white',
  }));

  ckStartTurnTimer(roomKey);

  broadcastToRoom(roomKey, {
    type: 'ckGameStarted',
    board: room.ckBoard,
    turn: 'red',
    players: playersInfo,
    timerSeconds: room.ckTimerMs > 0 ? room.ckTimerMs / 1000 : 0,
    timerMs: room.ckTimerMs || 0,
    wager: room.ckWager || 0,
    playersChips: ckPlayers.reduce((o, p) => { o[p.id] = p.chips; return o; }, {}),
  });

  ckPlayers.forEach((p) => {
    if (p.ws && p.ws.readyState === 1) {
      const color = room.ckPlayers.red === p.id ? 'red' : 'white';
      p.ws.send(JSON.stringify({ type: 'ckYourColor', color }));
    }
  });
}

function ckStartGameVsComputer(roomKey, humanId, timerSeconds, difficulty) {
  const room = getRoom(roomKey);
  const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
  const human = ckPlayers.find((p) => p.id === humanId);
  if (!human) return;
  const level = Math.max(1, Math.min(3, Math.floor(Number(difficulty) || 1)));
  room.ckMode = 'computer';
  room.ckDifficulty = level;
  room.ckVsComputer = true;
  ckClearBotMoveTimer(room);
  room.ckWager = level * 100;
  room.ckWagerProposals = {};
  room.ckWagerReady = {};
  room.ckWagerLocked = {};
  const botLabel = level === 1 ? 'Easy' : (level === 2 ? 'Medium' : 'Hard');
  const botPlayer = {
    id: CHECKERS_COMPUTER_ID,
    nickname: `Computer ${botLabel}`,
    chips: 0,
    isBot: true,
  };
  room.ckPlayersList = [human, botPlayer];
  room.ckBoard = ckCreateBoard();
  room.ckTurn = 'red';
  room.ckPhase = 'playing';
  room.ckMustContinue = null;
  room.ckTimerMs = (timerSeconds && timerSeconds > 0) ? timerSeconds * 1000 : 0;
  room.ckTurnDeadline = 0;
  room.ckPlayers = { red: human.id, white: CHECKERS_COMPUTER_ID };
  const playersInfo = [
    { id: human.id, nickname: human.nickname, color: 'red' },
    { id: CHECKERS_COMPUTER_ID, nickname: botPlayer.nickname, color: 'white' },
  ];
  ckStartTurnTimer(roomKey);
  broadcastToRoom(roomKey, {
    type: 'ckGameStarted',
    board: room.ckBoard,
    turn: 'red',
    players: playersInfo,
    timerSeconds: room.ckTimerMs > 0 ? room.ckTimerMs / 1000 : 0,
    timerMs: room.ckTimerMs || 0,
    wager: room.ckWager || 0,
    playersChips: { [human.id]: human.chips || 0, [CHECKERS_COMPUTER_ID]: 0 },
  });
  if (human.ws?.readyState === 1) {
    human.ws.send(JSON.stringify({ type: 'ckYourColor', color: 'red' }));
  }
}

function ckMakeMove(roomKey, playerId, from, to) {
  const room = getRoom(roomKey);
  if (room.ckPhase !== 'playing') return;

  const currentColor = room.ckTurn;
  if (room.ckPlayers[currentColor] !== playerId) return;

  const board = room.ckBoard;
  const piece = board[from.row]?.[from.col];
  if (!piece || piece.color !== currentColor) return;

  if (room.ckMustContinue && (room.ckMustContinue.row !== from.row || room.ckMustContinue.col !== from.col)) return;

  let validMoves = ckGetValidMoves(board, from.row, from.col, currentColor);
  if (room.ckMustContinue) validMoves = validMoves.filter((m) => m.captured);
  else if (ckHasAnyCapture(board, currentColor)) validMoves = validMoves.filter((m) => m.captured);

  const move = validMoves.find((m) => m.row === to.row && m.col === to.col);
  if (!move) return;

  board[to.row][to.col] = { ...piece };
  board[from.row][from.col] = null;

  let capturedInfo = null;
  if (move.captured) {
    capturedInfo = move.captured;
    board[move.captured.row][move.captured.col] = null;
  }

  let promoted = false;
  if (currentColor === 'red' && to.row === 0 && !board[to.row][to.col].king) {
    board[to.row][to.col].king = true;
    promoted = true;
  } else if (currentColor === 'white' && to.row === 7 && !board[to.row][to.col].king) {
    board[to.row][to.col].king = true;
    promoted = true;
  }

  let mustContinue = null;
  if (move.captured) {
    const moreJumps = ckGetValidMoves(board, to.row, to.col, currentColor, true);
    if (moreJumps.length > 0) mustContinue = { row: to.row, col: to.col };
  }

  room.ckMustContinue = mustContinue;
  if (!mustContinue) room.ckTurn = currentColor === 'red' ? 'white' : 'red';
  ckStartTurnTimer(roomKey);

  broadcastToRoom(roomKey, {
    type: 'ckBoardUpdate',
    board: room.ckBoard,
    turn: room.ckTurn,
    lastMove: { from, to, captured: capturedInfo },
    mustContinue,
    promoted,
    timerMs: room.ckTimerMs || 0,
  });

  {
    const winner = ckCheckWin(board, room.ckTurn);
    if (winner) {
      room.ckPhase = 'over';
      ckClearTurnTimer(room);
      ckClearBotMoveTimer(room);
      const wager = room.ckWager || 0;
      ckAwardWinner(room, winner);
      const hasPieces = (() => {
        for (let r = 0; r < 8; r++)
          for (let c = 0; c < 8; c++)
            if (board[r][c] && board[r][c].color === room.ckTurn) return true;
        return false;
      })();
      const winnerP = room.ckPlayersList?.find((p) => p.id === room.ckPlayers[winner]);
      const loserP = room.ckPlayersList?.find((p) => p.id === room.ckPlayers[room.ckTurn]);
      broadcastToRoom(roomKey, {
        type: 'ckGameOver',
        winner,
        reason: hasPieces ? 'noMoves' : 'capture',
        wager,
        players: room.ckPlayersList?.map((p) => ({ id: p.id, chips: p.chips, nickname: p.nickname })) || [],
        winnerNickname: winnerP?.nickname || 'Winner',
        loserNickname: loserP?.nickname || 'Opponent',
      });
      room.ckPlayersList?.forEach((p) => { if (p.dbUserId) saveUserChips(p.dbUserId, p.chips); });
    }
  }
}

// ── Chess logic ──────────────────────────────────────────────────────

function chCreateBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
  for (let c = 0; c < 8; c++) {
    board[0][c] = { type: back[c], color: 'black' };
    board[1][c] = { type: 'pawn', color: 'black' };
    board[6][c] = { type: 'pawn', color: 'white' };
    board[7][c] = { type: back[c], color: 'white' };
  }
  return board;
}

function chIsSquareAttacked(board, row, col, byColor) {
  const pawnDir = byColor === 'white' ? -1 : 1;
  const pr = row - pawnDir;
  for (const dc of [-1, 1]) {
    const pc = col + dc;
    if (pr >= 0 && pr < 8 && pc >= 0 && pc < 8) {
      const p = board[pr][pc];
      if (p && p.type === 'pawn' && p.color === byColor) return true;
    }
  }
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const nr = row + dr, nc = col + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[nr][nc];
      if (p && p.type === 'knight' && p.color === byColor) return true;
    }
  }
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    for (let i = 1; i < 8; i++) {
      const nr = row + dr * i, nc = col + dc * i;
      if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
      const p = board[nr][nc];
      if (p) {
        if (p.color === byColor && (p.type === 'bishop' || p.type === 'queen')) return true;
        break;
      }
    }
  }
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    for (let i = 1; i < 8; i++) {
      const nr = row + dr * i, nc = col + dc * i;
      if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
      const p = board[nr][nc];
      if (p) {
        if (p.color === byColor && (p.type === 'rook' || p.type === 'queen')) return true;
        break;
      }
    }
  }
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const nr = row + dr, nc = col + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[nr][nc];
      if (p && p.type === 'king' && p.color === byColor) return true;
    }
  }
  return false;
}

function chIsInCheck(board, color) {
  const opp = color === 'white' ? 'black' : 'white';
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c]?.type === 'king' && board[r][c].color === color)
        return chIsSquareAttacked(board, r, c, opp);
  return true;
}

function chCloneBoard(b) {
  return b.map((row) => row.map((c) => (c ? { ...c } : null)));
}

function chGetPseudoMoves(board, row, col) {
  const piece = board[row][col];
  if (!piece) return [];
  const moves = [];
  const { color, type } = piece;

  if (type === 'pawn') {
    const dir = color === 'white' ? -1 : 1;
    const startRow = color === 'white' ? 6 : 1;
    const nr = row + dir;
    if (nr >= 0 && nr < 8 && !board[nr][col]) {
      moves.push({ row: nr, col });
      const nr2 = row + 2 * dir;
      if (row === startRow && nr2 >= 0 && nr2 < 8 && !board[nr2][col]) {
        moves.push({ row: nr2, col });
      }
    }
    for (const dc of [-1, 1]) {
      const nc = col + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] && board[nr][nc].color !== color) {
        moves.push({ row: nr, col: nc, captured: true });
      }
    }
  } else if (type === 'knight') {
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      const nr = row + dr, nc = col + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && (!board[nr][nc] || board[nr][nc].color !== color)) {
        moves.push({ row: nr, col: nc, captured: !!board[nr][nc] });
      }
    }
  } else {
    let dirs = [];
    if (type !== 'rook') dirs = dirs.concat([[-1,-1],[-1,1],[1,-1],[1,1]]);
    if (type !== 'bishop') dirs = dirs.concat([[-1,0],[1,0],[0,-1],[0,1]]);
    const limit = type === 'king' ? 1 : 7;
    for (const [dr, dc] of dirs) {
      for (let i = 1; i <= limit; i++) {
        const nr = row + dr * i, nc = col + dc * i;
        if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
        if (board[nr][nc]) {
          if (board[nr][nc].color !== color) moves.push({ row: nr, col: nc, captured: true });
          break;
        }
        moves.push({ row: nr, col: nc });
      }
    }
  }
  return moves;
}

function chGetLegalMoves(board, row, col, color, castling, enPassant) {
  const piece = board[row][col];
  if (!piece || piece.color !== color) return [];
  const pseudo = chGetPseudoMoves(board, row, col);
  const opp = color === 'white' ? 'black' : 'white';
  const kingRow = color === 'white' ? 7 : 0;

  if (piece.type === 'pawn' && enPassant) {
    const epDir = color === 'white' ? -1 : 1;
    if (row + epDir === enPassant.row && Math.abs(col - enPassant.col) === 1) {
      pseudo.push({ row: enPassant.row, col: enPassant.col, captured: true, enPassant: true });
    }
  }

  if (piece.type === 'king' && castling) {
    const rights = castling[color];
    if (rights && row === kingRow && col === 4 && !chIsInCheck(board, color)) {
      if (rights.kingSide && !board[kingRow][5] && !board[kingRow][6] &&
          board[kingRow][7]?.type === 'rook' && board[kingRow][7]?.color === color &&
          !chIsSquareAttacked(board, kingRow, 5, opp) && !chIsSquareAttacked(board, kingRow, 6, opp)) {
        pseudo.push({ row: kingRow, col: 6, castle: 'kingside' });
      }
      if (rights.queenSide && !board[kingRow][3] && !board[kingRow][2] && !board[kingRow][1] &&
          board[kingRow][0]?.type === 'rook' && board[kingRow][0]?.color === color &&
          !chIsSquareAttacked(board, kingRow, 3, opp) && !chIsSquareAttacked(board, kingRow, 2, opp)) {
        pseudo.push({ row: kingRow, col: 2, castle: 'queenside' });
      }
    }
  }

  const legal = [];
  for (const m of pseudo) {
    const test = chCloneBoard(board);
    test[m.row][m.col] = { ...piece };
    test[row][col] = null;
    if (m.enPassant) test[row][m.col] = null;
    if (m.castle) {
      if (m.castle === 'kingside') { test[kingRow][5] = test[kingRow][7]; test[kingRow][7] = null; }
      else { test[kingRow][3] = test[kingRow][0]; test[kingRow][0] = null; }
    }
    if (piece.type === 'pawn' && m.row === (color === 'white' ? 0 : 7)) {
      test[m.row][m.col] = { type: 'queen', color };
    }
    if (!chIsInCheck(test, color)) legal.push(m);
  }
  return legal;
}

function chCheckGameEnd(board, color, castling, enPassant) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c]?.color === color && chGetLegalMoves(board, r, c, color, castling, enPassant).length > 0)
        return null;
  return chIsInCheck(board, color) ? 'checkmate' : 'stalemate';
}

const CHESS_STOCKFISH_ID = 'chess-stockfish';

function chClearBotMoveTimer(room) {
  if (room.chBotMoveTimer) {
    clearTimeout(room.chBotMoveTimer);
    room.chBotMoveTimer = null;
  }
}

function chSquareToAlg(row, col) {
  return String.fromCharCode(97 + col) + String(8 - row);
}

function chUciToSquare(sq) {
  if (!sq || sq.length !== 2) return null;
  const col = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]);
  const row = 8 - rank;
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return { row, col };
}

function chBoardToFen(room) {
  const board = room.chBoard || [];
  const pieceMap = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let fenRow = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const piece = board[r]?.[c];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty > 0) {
        fenRow += String(empty);
        empty = 0;
      }
      const code = pieceMap[piece.type] || 'p';
      fenRow += piece.color === 'white' ? code.toUpperCase() : code;
    }
    if (empty > 0) fenRow += String(empty);
    rows.push(fenRow);
  }
  const side = room.chTurn === 'black' ? 'b' : 'w';
  const rights = [];
  if (room.chCastling?.white?.kingSide) rights.push('K');
  if (room.chCastling?.white?.queenSide) rights.push('Q');
  if (room.chCastling?.black?.kingSide) rights.push('k');
  if (room.chCastling?.black?.queenSide) rights.push('q');
  const castling = rights.length ? rights.join('') : '-';
  const ep = room.chEnPassant ? chSquareToAlg(room.chEnPassant.row, room.chEnPassant.col) : '-';
  return `${rows.join('/')} ${side} ${castling} ${ep} 0 1`;
}

function chGetStockfishMove(fen, difficulty) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(STOCKFISH_CLI_PATH)) {
      reject(new Error('Stockfish engine is unavailable'));
      return;
    }
    const elo = Math.max(200, Math.min(3000, Number(difficulty) || 1200));
    const useNativeElo = elo >= 1320;
    const engine = spawn(process.execPath, [STOCKFISH_CLI_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    let done = false;
    let outBuffer = '';
    const sendCmd = (cmd) => {
      try { engine.stdin.write(`${cmd}\n`); } catch (_) {}
    };
    const cleanup = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try { engine.stdin.end(); } catch (_) {}
      try { engine.kill(); } catch (_) {}
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Stockfish move timeout'));
    }, 6000);
    const handleLine = (lineRaw) => {
      const line = String(lineRaw || '').trim();
      if (!line || done) return;
      if (line === 'uciok') {
        if (useNativeElo) {
          sendCmd('setoption name UCI_LimitStrength value true');
          sendCmd(`setoption name UCI_Elo value ${Math.min(elo, 3190)}`);
        } else {
          const skill = Math.max(0, Math.round((elo - 200) / 1120 * 5));
          sendCmd(`setoption name Skill Level value ${skill}`);
        }
        sendCmd('isready');
      } else if (line === 'readyok') {
        sendCmd(`position fen ${fen}`);
        if (useNativeElo) {
          const movetime = 200 + Math.round((elo - 1320) / 1680 * 800);
          sendCmd(`go movetime ${movetime}`);
        } else {
          const depth = Math.max(1, Math.round(1 + (elo - 200) / 1120 * 4));
          const movetime = Math.max(10, Math.round(10 + (elo - 200) / 1120 * 150));
          sendCmd(`go depth ${depth} movetime ${movetime}`);
        }
      } else if (line.startsWith('bestmove ')) {
        const move = line.split(' ')[1];
        cleanup();
        if (!move || move === '(none)') return reject(new Error('Stockfish returned no move'));
        resolve(move);
      }
    };
    engine.stdout.on('data', (chunk) => {
      outBuffer += chunk.toString();
      const lines = outBuffer.split(/\r?\n/);
      outBuffer = lines.pop() || '';
      lines.forEach(handleLine);
    });
    engine.on('error', (err) => {
      if (done) return;
      cleanup();
      reject(err);
    });
    engine.on('exit', (code) => {
      if (!done && code !== 0) {
        cleanup();
        reject(new Error(`Stockfish exited with code ${code}`));
      }
    });
    sendCmd('uci');
  });
}

function chAwardWinner(room, winnerColor) {
  if (!winnerColor || !room.chPlayers || !room.chPlayersList) return;
  const winnerId = room.chPlayers[winnerColor];
  const winnerP = room.chPlayersList.find((p) => p.id === winnerId);
  if (!winnerP) return;
  const wager = room.chWager || 0;
  if (wager <= 0) return;
  if (room.chVsComputer) {
    if (winnerP.id !== CHESS_STOCKFISH_ID) {
      winnerP.chips = (winnerP.chips || 0) + wager;
    }
  } else {
    winnerP.chips = (winnerP.chips || 0) + wager * 2;
  }
}

function chRecordComputerWinIfEligible(roomKey, room, winnerColor) {
  if (!room?.chVsComputer || !winnerColor) return;
  const winnerId = room.chPlayers?.[winnerColor];
  if (!winnerId || winnerId === CHESS_STOCKFISH_ID) return;
  const winnerP = room.chPlayersList?.find((p) => p.id === winnerId);
  if (!winnerP?.dbUserId) return;
  const elo = Math.max(200, Math.min(3000, Number(room.chDifficulty) || 1200));
  saveChessComputerBestLevel(winnerP.dbUserId, elo)
    .then(() => broadcastChessComputerLeaderboard(roomKey))
    .catch(() => {});
}

function chScheduleBotMove(roomKey, delayMs = 350) {
  const room = getRoom(roomKey);
  if (!room.chVsComputer || room.chPhase !== 'playing') return;
  const botColor = room.chPlayers?.white === CHESS_STOCKFISH_ID ? 'white' : 'black';
  if (room.chTurn !== botColor) return;
  chClearTurnTimer(room);
  chClearBotMoveTimer(room);
  room.chBotMoveTimer = setTimeout(async () => {
    room.chBotMoveTimer = null;
    const current = getRoom(roomKey);
    if (!current.chVsComputer || current.chPhase !== 'playing') return;
    const currentBotColor = current.chPlayers?.white === CHESS_STOCKFISH_ID ? 'white' : 'black';
    if (current.chTurn !== currentBotColor) return;
    const fen = chBoardToFen(current);
    try {
      const bestMove = await chGetStockfishMove(fen, current.chDifficulty || 10);
      const from = chUciToSquare(bestMove.slice(0, 2));
      const to = chUciToSquare(bestMove.slice(2, 4));
      if (!from || !to) return;
      chMakeMove(roomKey, CHESS_STOCKFISH_ID, from, to);
    } catch (err) {
      console.error('Stockfish move error:', err.message || err);
    }
  }, Math.max(100, delayMs));
}

function chClearTurnTimer(room) {
  if (room.chTurnTimeout) {
    clearTimeout(room.chTurnTimeout);
    room.chTurnTimeout = null;
  }
}

function chStartTurnTimer(roomKey) {
  const room = getRoom(roomKey);
  chClearTurnTimer(room);
  if (room.chVsComputer && room.chPlayers?.[room.chTurn] === CHESS_STOCKFISH_ID) {
    chScheduleBotMove(roomKey);
    return;
  }
  if (!room.chTimerMs || room.chTimerMs <= 0) return;
  room.chTurnDeadline = Date.now() + room.chTimerMs;
  room.chTurnTimeout = setTimeout(() => {
    room.chTurnTimeout = null;
    const r = getRoom(roomKey);
    if (r.chPhase !== 'playing') return;
    const losingColor = r.chTurn;
    const winnerColor = losingColor === 'white' ? 'black' : 'white';
    r.chPhase = 'over';
    chClearBotMoveTimer(r);
    const wager = r.chWager || 0;
    chAwardWinner(r, winnerColor);
    chRecordComputerWinIfEligible(roomKey, r, winnerColor);
    const winnerP = r.chPlayersList?.find((p) => p.id === r.chPlayers[winnerColor]);
    const loserP = r.chPlayersList?.find((p) => p.id === r.chPlayers[losingColor]);
    broadcastToRoom(roomKey, {
      type: 'chGameOver',
      winner: winnerColor,
      reason: 'timeout',
      wager,
      players: r.chPlayersList?.map((p) => ({ id: p.id, chips: p.chips, nickname: p.nickname })) || [],
      winnerNickname: winnerP?.nickname || 'Winner',
      loserNickname: loserP?.nickname || 'Opponent',
    });
  }, room.chTimerMs);
}

function chStartGame(roomKey, timerSeconds) {
  const room = getRoom(roomKey);
  const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
  if (chPlayers.length !== 2) return;
  room.chVsComputer = false;
  chClearBotMoveTimer(room);

  let wager = 0;
  const locked = room.chWagerLocked || {};
  const lock1 = locked[chPlayers[0].id];
  const lock2 = locked[chPlayers[1].id];
  const bothLocked = lock1 !== undefined && lock2 !== undefined;
  const match = bothLocked && lock1 === lock2;
  if (bothLocked && match && lock1 > 0) {
    const p1 = chPlayers[0];
    const p2 = chPlayers[1];
    const maxWager = Math.min(p1.chips || 0, p2.chips || 0);
    wager = Math.min(lock1, maxWager);
    if (wager > 0) {
      p1.chips = (p1.chips || 0) - wager;
      p2.chips = (p2.chips || 0) - wager;
    }
  }
  room.chWager = wager;
  room.chWagerProposals = {};
  room.chWagerReady = {};
  room.chWagerLocked = {};

  room.chPlayersList = chPlayers;

  room.chBoard = chCreateBoard();
  room.chTurn = 'white';
  room.chPhase = 'playing';
  room.chCastling = {
    white: { kingSide: true, queenSide: true },
    black: { kingSide: true, queenSide: true },
  };
  room.chEnPassant = null;
  room.chTimerMs = (timerSeconds && timerSeconds > 0) ? timerSeconds * 1000 : 0;
  room.chTurnDeadline = 0;

  room.chPlayers = { white: chPlayers[0].id, black: chPlayers[1].id };

  const playersInfo = chPlayers.map((p) => ({
    id: p.id, nickname: p.nickname,
    color: room.chPlayers.white === p.id ? 'white' : 'black',
  }));

  chStartTurnTimer(roomKey);

  broadcastToRoom(roomKey, {
    type: 'chGameStarted',
    board: room.chBoard, turn: 'white', players: playersInfo,
    castling: room.chCastling, enPassant: null,
    timerSeconds: room.chTimerMs > 0 ? room.chTimerMs / 1000 : 0,
    timerMs: room.chTimerMs || 0,
    wager: room.chWager || 0,
    playersChips: chPlayers.reduce((o, p) => { o[p.id] = p.chips; return o; }, {}),
  });

  chPlayers.forEach((p) => {
    if (p.ws?.readyState === 1) {
      const color = room.chPlayers.white === p.id ? 'white' : 'black';
      p.ws.send(JSON.stringify({ type: 'chYourColor', color }));
    }
  });
}

function chStartGameVsComputer(roomKey, humanId, timerSeconds, difficulty) {
  const room = getRoom(roomKey);
  const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
  const human = chPlayers.find((p) => p.id === humanId);
  if (!human) return;
  const elo = Math.max(200, Math.min(3000, Math.floor(Number(difficulty) || 1200)));
  room.chMode = 'computer';
  room.chDifficulty = elo;
  room.chVsComputer = true;
  chClearBotMoveTimer(room);
  room.chWager = elo;
  room.chWagerProposals = {};
  room.chWagerReady = {};
  room.chWagerLocked = {};
  const botPlayer = {
    id: CHESS_STOCKFISH_ID,
    nickname: `Computer ${elo} ELO`,
    chips: 0,
    isBot: true,
  };
  room.chPlayersList = [human, botPlayer];
  room.chBoard = chCreateBoard();
  room.chTurn = 'white';
  room.chPhase = 'playing';
  room.chCastling = {
    white: { kingSide: true, queenSide: true },
    black: { kingSide: true, queenSide: true },
  };
  room.chEnPassant = null;
  room.chTimerMs = (timerSeconds && timerSeconds > 0) ? timerSeconds * 1000 : 0;
  room.chTurnDeadline = 0;
  room.chPlayers = { white: human.id, black: CHESS_STOCKFISH_ID };
  const playersInfo = [
    { id: human.id, nickname: human.nickname, color: 'white' },
    { id: CHESS_STOCKFISH_ID, nickname: botPlayer.nickname, color: 'black' },
  ];
  chStartTurnTimer(roomKey);
  broadcastToRoom(roomKey, {
    type: 'chGameStarted',
    board: room.chBoard,
    turn: 'white',
    players: playersInfo,
    castling: room.chCastling,
    enPassant: null,
    timerSeconds: room.chTimerMs > 0 ? room.chTimerMs / 1000 : 0,
    timerMs: room.chTimerMs || 0,
    wager: room.chWager || 0,
    playersChips: { [human.id]: human.chips || 0, [CHESS_STOCKFISH_ID]: 0 },
  });
  if (human.ws?.readyState === 1) {
    human.ws.send(JSON.stringify({ type: 'chYourColor', color: 'white' }));
  }
}

function chMakeMove(roomKey, playerId, from, to) {
  const room = getRoom(roomKey);
  if (room.chPhase !== 'playing') return;

  const currentColor = room.chTurn;
  if (room.chPlayers[currentColor] !== playerId) return;

  const board = room.chBoard;
  const piece = board[from.row]?.[from.col];
  if (!piece || piece.color !== currentColor) return;

  const validMoves = chGetLegalMoves(board, from.row, from.col, currentColor, room.chCastling, room.chEnPassant);
  const move = validMoves.find((m) => m.row === to.row && m.col === to.col);
  if (!move) return;

  const capturedPiece = board[to.row][to.col];
  const capturedColor = capturedPiece ? capturedPiece.color : null;
  let epCapture = false;

  board[to.row][to.col] = { ...piece };
  board[from.row][from.col] = null;

  if (move.enPassant) {
    board[from.row][to.col] = null;
    epCapture = true;
  }

  if (move.castle) {
    const cr = currentColor === 'white' ? 7 : 0;
    if (move.castle === 'kingside') {
      board[cr][5] = board[cr][7]; board[cr][7] = null;
    } else {
      board[cr][3] = board[cr][0]; board[cr][0] = null;
    }
  }

  let promoted = false;
  if (piece.type === 'pawn' && to.row === (currentColor === 'white' ? 0 : 7)) {
    board[to.row][to.col] = { type: 'queen', color: currentColor };
    promoted = true;
  }

  // Update castling rights
  if (piece.type === 'king') {
    room.chCastling[currentColor] = { kingSide: false, queenSide: false };
  }
  if (piece.type === 'rook') {
    const rookRow = currentColor === 'white' ? 7 : 0;
    if (from.row === rookRow && from.col === 0) room.chCastling[currentColor].queenSide = false;
    if (from.row === rookRow && from.col === 7) room.chCastling[currentColor].kingSide = false;
  }
  if (capturedPiece?.type === 'rook') {
    const opp = currentColor === 'white' ? 'black' : 'white';
    const oppRow = opp === 'white' ? 7 : 0;
    if (to.row === oppRow && to.col === 0) room.chCastling[opp].queenSide = false;
    if (to.row === oppRow && to.col === 7) room.chCastling[opp].kingSide = false;
  }

  // Update en passant
  room.chEnPassant = null;
  if (piece.type === 'pawn' && Math.abs(to.row - from.row) === 2) {
    room.chEnPassant = { row: (from.row + to.row) / 2, col: from.col };
  }

  room.chTurn = currentColor === 'white' ? 'black' : 'white';
  chStartTurnTimer(roomKey);

  const inCheck = chIsInCheck(board, room.chTurn);

  broadcastToRoom(roomKey, {
    type: 'chBoardUpdate',
    board: room.chBoard, turn: room.chTurn,
    lastMove: {
      from, to,
      captured: !!(capturedPiece || epCapture),
      capturedColor: epCapture ? (currentColor === 'white' ? 'black' : 'white') : capturedColor,
      promoted, castle: move.castle || null,
    },
    castling: room.chCastling, enPassant: room.chEnPassant,
    inCheck,
    timerMs: room.chTimerMs || 0,
  });

  const result = chCheckGameEnd(board, room.chTurn, room.chCastling, room.chEnPassant);
  if (result) {
    room.chPhase = 'over';
    chClearTurnTimer(room);
    chClearBotMoveTimer(room);
    const winner = result === 'checkmate' ? currentColor : null;
    const wager = room.chWager || 0;
    chAwardWinner(room, winner);
    chRecordComputerWinIfEligible(roomKey, room, winner);
    const winnerP = room.chPlayersList?.find((p) => p.id === room.chPlayers[winner]);
    const loserColor = winner === 'white' ? 'black' : 'white';
    const loserP = room.chPlayersList?.find((p) => p.id === room.chPlayers[loserColor]);
    broadcastToRoom(roomKey, {
      type: 'chGameOver',
      winner,
      reason: result,
      wager,
      players: room.chPlayersList?.map((p) => ({ id: p.id, chips: p.chips, nickname: p.nickname })) || [],
      winnerNickname: winnerP?.nickname || 'Winner',
      loserNickname: loserP?.nickname || 'Opponent',
    });
    room.chPlayersList?.forEach((p) => { if (p.dbUserId) saveUserChips(p.dbUserId, p.chips); });
  }
}

wss.on('connection', async (ws, req) => {
  ws.id = crypto.randomUUID();
  await parseSessionFromWs(ws, req);

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const { type } = msg;

      if (type === 'join') {
        const { roomKey, nickname } = msg;
        if (!roomKey?.trim() || !nickname?.trim()) return;

        const safeRoom = String(roomKey).trim().toLowerCase() || 'default';
        const safeNick = String(nickname).trim().slice(0, 20) || 'Player';

        const room = getRoom(safeRoom);

        if (msg.gameType === 'lobby') room.gameType = 'lobby';
        else if (msg.gameType === 'blackjack') room.gameType = 'blackjack';
        else if (msg.gameType === 'checkers') room.gameType = 'checkers';
        else if (msg.gameType === 'chess') room.gameType = 'chess';
        else if (msg.gameType === 'slots') room.gameType = 'slots';

        let targetGameType = msg.gameType === 'lobby' ? 'lobby' : (msg.gameType || 'lobby');
        let gameFull = false;
        if (targetGameType !== 'lobby' && isGameFull(room, targetGameType)) {
          targetGameType = 'lobby';
          gameFull = true;
        }

        let startingChips = 10;
        let startingPurchasedOutfits = [];
        let startingOutfit = null;
        let startingPurchasedCharacters = [];
        let startingCharacter = null;
        if (ws._userId) {
          try {
            const dbResult = await pool.query(
              'SELECT chips, purchased_outfits, equipped_outfit, purchased_characters, equipped_character FROM users WHERE id = $1',
              [ws._userId]
            );
            if (dbResult.rows.length > 0) {
              startingChips = dbResult.rows[0].chips;
              startingPurchasedOutfits = normalizePurchasedOutfits(dbResult.rows[0].purchased_outfits);
              startingOutfit = startingPurchasedOutfits.includes(dbResult.rows[0].equipped_outfit)
                ? dbResult.rows[0].equipped_outfit
                : null;
              startingPurchasedCharacters = normalizePurchasedCharacters(dbResult.rows[0].purchased_characters);
              const normalizedDbCharacter = normalizeCharacterId(dbResult.rows[0].equipped_character);
              startingCharacter = normalizedDbCharacter && startingPurchasedCharacters.includes(normalizedDbCharacter)
                ? normalizedDbCharacter
                : null;
            }
          } catch (e) {
            console.error('Failed to load user profile:', e.message);
          }
        } else {
          const randomDefault = getRandomDefaultCharacterId();
          if (randomDefault) {
            startingPurchasedCharacters = [randomDefault];
            startingCharacter = randomDefault;
          }
        }

        const existing = room.players.find((p) => p.ws === ws);
        if (existing) {
          existing.nickname = safeNick;
          existing.purchasedOutfits = normalizePurchasedOutfits(existing.purchasedOutfits);
          existing.outfit = existing.purchasedOutfits.includes(existing.outfit) ? existing.outfit : null;
          existing.purchasedCharacters = normalizePurchasedCharacters(existing.purchasedCharacters);
          existing.character = existing.purchasedCharacters.includes(existing.character) ? existing.character : null;
          if (!ws._userId && !existing.character) {
            const randomDefault = getRandomDefaultCharacterId();
            if (randomDefault) {
              if (!existing.purchasedCharacters.includes(randomDefault)) existing.purchasedCharacters.push(randomDefault);
              existing.character = randomDefault;
            }
          }
        } else {
          room.players.push({
            id: ws.id,
            ws,
            nickname: safeNick,
            chips: startingChips,
            hand: null,
            betThisRound: 0,
            totalBet: 0,
            folded: false,
            allIn: false,
            winStreak: 0,
            maxWinStreak: 0,
            currentView: targetGameType,
            dbUserId: ws._userId || null,
            purchasedOutfits: startingPurchasedOutfits,
            outfit: startingOutfit,
            purchasedCharacters: startingPurchasedCharacters,
            character: startingCharacter,
          });
        }
        if (existing) existing.currentView = targetGameType;

        clients.set(ws, { roomKey: safeRoom, nickname: safeNick, gameType: targetGameType });

        ws.send(JSON.stringify({
          type: 'joined',
          id: ws.id,
          roomKey: safeRoom,
          gameType: targetGameType === 'lobby' ? 'lobby' : (targetGameType || 'holdem'),
          ...(gameFull && { gameFull: msg.gameType }),
          players: room.players.map(serializePlayer),
          gameState: room.phase === 'lobby' ? null : {
            phase: room.phase,
            communityCards: room.communityCards,
            pot: room.pot,
            currentBet: room.currentBet,
            turnIdx: room.turnIdx,
            dealerIdx: room.dealerIdx,
          },
          radio: room.radio,
          chatHistory: (room.chatHistory || []).slice(-LOBBY_CHAT_MAX),
          theme: room.theme || null,
        }));
        if (targetGameType === 'checkers') {
          ws.send(JSON.stringify({
            type: 'ckModeState',
            mode: room.ckMode === 'computer' ? 'computer' : 'player',
            difficulty: Math.max(1, Math.min(3, Number(room.ckDifficulty) || 1)),
          }));
        }
        if (targetGameType === 'chess') {
          ws.send(JSON.stringify({
            type: 'chModeState',
            mode: room.chMode === 'computer' ? 'computer' : 'player',
            difficulty: Math.max(200, Math.min(3000, Number(room.chDifficulty) || 1200)),
          }));
          sendChessComputerLeaderboard(ws);
        }

        broadcastToRoom(safeRoom, {
          type: 'userJoined',
          id: ws.id,
          nickname: safeNick,
          chips: startingChips,
          winStreak: 0,
          maxWinStreak: 0,
          currentView: targetGameType,
          outfit: existing?.outfit || null,
          purchasedOutfits: existing?.purchasedOutfits || [],
          character: existing?.character || null,
          purchasedCharacters: existing?.purchasedCharacters || [],
        }, ws);
      } else if (type === 'backToLobby') {
        const data = clients.get(ws);
        if (!data) return;
        const prevGameType = data.gameType;
        const room = getRoom(data.roomKey);
        const pIdx = room.players.findIndex((p) => p.ws === ws);
        if (pIdx < 0) return;
        room.players[pIdx].currentView = 'lobby';
        clients.set(ws, { ...data, gameType: 'lobby' });

        if (prevGameType === 'holdem' && room.phase !== 'lobby' && room.holdemPlayers) {
          const hpIdx = room.holdemPlayers.findIndex(p => p.ws === ws);
          if (hpIdx >= 0 && !room.holdemPlayers[hpIdx].folded) {
            room.holdemPlayers[hpIdx].folded = true;
            const activeCount = room.holdemPlayers.filter(p => !p.folded).length;
            if (activeCount <= 1) {
              clearTurnTimer(room);
              showdown(data.roomKey);
            } else if (room.turnIdx === hpIdx) {
              clearTurnTimer(room);
              room.turnIdx = advanceTurn(room, hpIdx);
              checkBettingComplete(data.roomKey);
            }
          }
        }

        if (prevGameType === 'checkers' && room.ckPhase === 'playing') {
          ckClearTurnTimer(room);
          ckClearBotMoveTimer(room);
          const remainingColor = room.ckPlayers?.red === ws.id ? 'white' : 'red';
          const losingColor = remainingColor === 'red' ? 'white' : 'red';
          room.ckPhase = 'over';
          const wager = room.ckWager || 0;
          const winnerP = room.ckPlayersList?.find((p) => p.id === room.ckPlayers[remainingColor]);
          const loserP = room.ckPlayersList?.find((p) => p.id === room.ckPlayers[losingColor]);
          broadcastToRoom(data.roomKey, {
            type: 'ckGameOver',
            winner: remainingColor,
            reason: 'disconnect',
            wager,
            players: room.ckPlayersList?.map((p) => ({ id: p.id, chips: p.chips, nickname: p.nickname })) || [],
            winnerNickname: winnerP?.nickname || 'Winner',
            loserNickname: loserP?.nickname || 'Opponent',
          });
        }

        if (prevGameType === 'chess' && room.chPhase === 'playing') {
          chClearTurnTimer(room);
          chClearBotMoveTimer(room);
          const chRemainingColor = room.chPlayers?.white === ws.id ? 'black' : 'white';
          const chLosingColor = chRemainingColor === 'white' ? 'black' : 'white';
          room.chPhase = 'over';
          const wager = room.chWager || 0;
          const winnerP = room.chPlayersList?.find((p) => p.id === room.chPlayers[chRemainingColor]);
          const loserP = room.chPlayersList?.find((p) => p.id === room.chPlayers[chLosingColor]);
          broadcastToRoom(data.roomKey, {
            type: 'chGameOver',
            winner: chRemainingColor,
            reason: 'disconnect',
            wager,
            players: room.chPlayersList?.map((p) => ({ id: p.id, chips: p.chips, nickname: p.nickname })) || [],
            winnerNickname: winnerP?.nickname || 'Winner',
            loserNickname: loserP?.nickname || 'Opponent',
          });
        }

        const humansInHoldem = room.players.some((p) => !p.isBot && (p.currentView ?? 'lobby') === 'holdem');
        if (!humansInHoldem) {
          removeAllBots(data.roomKey);
        }

        broadcastToRoom(data.roomKey, {
          type: 'playerViewChanged',
          players: room.players.map(serializePlayer),
        });
        ws.send(JSON.stringify({
          type: 'backToLobby',
          id: ws.id,
          roomKey: data.roomKey,
          players: room.players.map(serializePlayer),
          chatHistory: (room.chatHistory || []).slice(-LOBBY_CHAT_MAX),
          theme: room.theme || null,
        }));
      } else if (type === 'switchGame') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const pIdx = room.players.findIndex((p) => p.ws === ws);
        if (pIdx < 0) return;
        const newType = msg.gameType || 'holdem';
        if (newType !== 'holdem' && newType !== 'blackjack' && newType !== 'checkers' && newType !== 'chess' && newType !== 'slots') return;
        const currentView = room.players[pIdx].currentView ?? 'lobby';
        if (currentView !== newType && isGameFull(room, newType)) {
          ws.send(JSON.stringify({ type: 'gameFull', gameType: newType }));
          return;
        }
        const wasHoldem = currentView === 'holdem';
        room.players[pIdx].currentView = newType;
        clients.set(ws, { ...data, gameType: newType });

        if (wasHoldem && newType !== 'holdem') {
          const humansInHoldem = room.players.some((p) => !p.isBot && (p.currentView ?? 'lobby') === 'holdem');
          if (!humansInHoldem) removeAllBots(data.roomKey);
        }

        broadcastToRoom(data.roomKey, {
          type: 'playerViewChanged',
          players: room.players.map(serializePlayer),
        });
        const ckCount = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers').length;
        const chCount = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess').length;
        if (newType === 'checkers') {
          if (ckCount >= 2) room.ckMode = 'player';
          ckBroadcastModeState(data.roomKey, room);
          if (ckCount === 2) broadcastCkWagerState(data.roomKey, room);
        }
        if (newType === 'chess') {
          if (chCount >= 2) room.chMode = 'player';
          broadcastChModeState(data.roomKey, room);
          if (chCount === 2) broadcastChWagerState(data.roomKey, room);
        }
        ws.send(JSON.stringify({
          type: 'gameSwitched',
          id: ws.id,
          roomKey: data.roomKey,
          gameType: newType,
          players: room.players.map(serializePlayer),
          gameState: room.phase === 'lobby' ? null : {
            phase: room.phase,
            communityCards: room.communityCards,
            pot: room.pot,
            currentBet: room.currentBet,
            turnIdx: room.turnIdx,
            dealerIdx: room.dealerIdx,
          },
          radio: room.radio,
          chatHistory: (room.chatHistory || []).slice(-LOBBY_CHAT_MAX),
        }));
      } else if (type === 'ckWagerProposal') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        if (room.ckMode === 'computer') return;
        const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
        if (ckPlayers.length !== 2) return;
        const p = ckPlayers.find((x) => x.ws === ws);
        if (!p) return;
        const amount = Math.max(0, Math.floor(Number(msg.amount) || 0));
        const other = ckPlayers.find((x) => x.id !== p.id);
        const maxWager = Math.min(p.chips || 0, other?.chips || 0);
        const capped = Math.min(amount, maxWager);
        room.ckWagerProposals = room.ckWagerProposals || {};
        room.ckWagerProposals[p.id] = capped;
        broadcastCkWagerState(data.roomKey, room);
      } else if (type === 'ckWagerReady') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        if (room.ckMode === 'computer') return;
        const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
        if (ckPlayers.length !== 2) return;
        const p = ckPlayers.find((x) => x.ws === ws);
        if (!p) return;
        room.ckWagerReady = room.ckWagerReady || {};
        room.ckWagerReady[ws.id] = msg.ready !== false;
        broadcastCkWagerState(data.roomKey, room);
      } else if (type === 'ckWagerLock') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        if (room.ckMode === 'computer') return;
        const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
        if (ckPlayers.length !== 2) return;
        const p = ckPlayers.find((x) => x.ws === ws);
        if (!p) return;
        const amount = Math.max(0, Math.floor(Number(msg.amount) || 0));
        const other = ckPlayers.find((x) => x.id !== p.id);
        const maxWager = Math.min(p.chips || 0, other?.chips || 0);
        const capped = Math.min(amount, maxWager);
        room.ckWagerLocked = room.ckWagerLocked || {};
        room.ckWagerLocked[p.id] = capped;
        broadcastCkWagerState(data.roomKey, room);
      } else if (type === 'ckWagerUnlock') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        if (room.ckMode === 'computer') return;
        const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
        if (ckPlayers.length !== 2) return;
        if (ckPlayers.findIndex((x) => x.ws === ws) < 0) return;
        room.ckWagerLocked = room.ckWagerLocked || {};
        delete room.ckWagerLocked[ws.id];
        broadcastCkWagerState(data.roomKey, room);
      } else if (type === 'ckTimerChange') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
        if (ckPlayers.findIndex((x) => x.ws === ws) < 0) return;
        const sec = Math.max(0, Math.min(300, Math.floor(Number(msg.timerSeconds) || 0)));
        room.ckTimerProposal = sec;
        broadcastToRoom(data.roomKey, { type: 'ckTimerChanged', timerSeconds: sec });
      } else if (type === 'ckSetMode') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
        if (ckPlayers.findIndex((x) => x.ws === ws) < 0) return;
        const mode = msg.mode === 'computer' ? 'computer' : 'player';
        if (mode === 'computer' && ckPlayers.length > 1) {
          ws.send(JSON.stringify({ type: 'error', message: 'Computer mode needs only one human in Checkers' }));
          return;
        }
        room.ckMode = mode;
        if (mode === 'computer') {
          room.ckWagerProposals = {};
          room.ckWagerReady = {};
          room.ckWagerLocked = {};
        }
        ckBroadcastModeState(data.roomKey, room);
      } else if (type === 'ckSetDifficulty') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
        if (ckPlayers.findIndex((x) => x.ws === ws) < 0) return;
        room.ckDifficulty = Math.max(1, Math.min(3, Math.floor(Number(msg.difficulty) || 1)));
        ckBroadcastModeState(data.roomKey, room);
      } else if (type === 'chWagerProposal') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        if (room.chMode === 'computer') return;
        const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
        if (chPlayers.length !== 2) return;
        const p = chPlayers.find((x) => x.ws === ws);
        if (!p) return;
        const amount = Math.max(0, Math.floor(Number(msg.amount) || 0));
        const other = chPlayers.find((x) => x.id !== p.id);
        const maxWager = Math.min(p.chips || 0, other?.chips || 0);
        const capped = Math.min(amount, maxWager);
        room.chWagerProposals = room.chWagerProposals || {};
        room.chWagerProposals[p.id] = capped;
        broadcastChWagerState(data.roomKey, room);
      } else if (type === 'chWagerReady') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        if (room.chMode === 'computer') return;
        const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
        if (chPlayers.length !== 2) return;
        if (chPlayers.findIndex((x) => x.ws === ws) < 0) return;
        room.chWagerReady = room.chWagerReady || {};
        room.chWagerReady[ws.id] = msg.ready !== false;
        broadcastChWagerState(data.roomKey, room);
      } else if (type === 'chWagerLock') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        if (room.chMode === 'computer') return;
        const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
        if (chPlayers.length !== 2) return;
        const p = chPlayers.find((x) => x.ws === ws);
        if (!p) return;
        const amount = Math.max(0, Math.floor(Number(msg.amount) || 0));
        const other = chPlayers.find((x) => x.id !== p.id);
        const maxWager = Math.min(p.chips || 0, other?.chips || 0);
        const capped = Math.min(amount, maxWager);
        room.chWagerLocked = room.chWagerLocked || {};
        room.chWagerLocked[p.id] = capped;
        broadcastChWagerState(data.roomKey, room);
      } else if (type === 'chWagerUnlock') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        if (room.chMode === 'computer') return;
        const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
        if (chPlayers.length !== 2) return;
        if (chPlayers.findIndex((x) => x.ws === ws) < 0) return;
        room.chWagerLocked = room.chWagerLocked || {};
        delete room.chWagerLocked[ws.id];
        broadcastChWagerState(data.roomKey, room);
      } else if (type === 'chTimerChange') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
        if (chPlayers.findIndex((x) => x.ws === ws) < 0) return;
        const sec = Math.max(0, Math.min(300, Math.floor(Number(msg.timerSeconds) || 0)));
        room.chTimerProposal = sec;
        broadcastToRoom(data.roomKey, { type: 'chTimerChanged', timerSeconds: sec });
      } else if (type === 'chSetMode') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
        if (chPlayers.findIndex((x) => x.ws === ws) < 0) return;
        const mode = msg.mode === 'computer' ? 'computer' : 'player';
        if (mode === 'computer' && chPlayers.length > 1) {
          ws.send(JSON.stringify({ type: 'error', message: 'Computer mode needs only one human in Chess' }));
          return;
        }
        room.chMode = mode;
        if (mode === 'computer') {
          room.chWagerProposals = {};
          room.chWagerReady = {};
          room.chWagerLocked = {};
        }
        broadcastChModeState(data.roomKey, room);
        if (mode === 'computer') sendChessComputerLeaderboard(ws);
      } else if (type === 'chSetDifficulty') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
        if (chPlayers.findIndex((x) => x.ws === ws) < 0) return;
        room.chDifficulty = Math.max(200, Math.min(3000, Math.floor(Number(msg.difficulty) || 1200)));
        broadcastChModeState(data.roomKey, room);
      } else if (type === 'chRequestComputerLeaderboard') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const viewer = room.players.find((p) => p.ws === ws);
        if (!viewer || (viewer.currentView ?? 'lobby') !== 'chess') return;
        sendChessComputerLeaderboard(ws);
      } else if (type === 'ckRematch') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
        if (room.ckMode === 'computer') {
          if (ckPlayers.length < 1) return;
        } else if (ckPlayers.length !== 2) {
          return;
        }
        if (ckPlayers.findIndex((x) => x.ws === ws) < 0) return;
        room.ckPhase = 'waiting';
        room.ckWagerLocked = {};
        room.ckWagerReady = {};
        ckClearBotMoveTimer(room);
        broadcastToRoom(data.roomKey, { type: 'ckWaiting' });
        ckBroadcastModeState(data.roomKey, room);
        if (room.ckMode !== 'computer') broadcastCkWagerState(data.roomKey, room);
      } else if (type === 'chRematch') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
        if (room.chMode === 'computer') {
          if (chPlayers.length < 1) return;
        } else if (chPlayers.length !== 2) {
          return;
        }
        if (chPlayers.findIndex((x) => x.ws === ws) < 0) return;
        room.chPhase = 'waiting';
        room.chWagerLocked = {};
        room.chWagerReady = {};
        chClearBotMoveTimer(room);
        broadcastToRoom(data.roomKey, { type: 'chWaiting' });
        broadcastChModeState(data.roomKey, room);
        if (room.chMode !== 'computer') broadcastChWagerState(data.roomKey, room);
      } else if (type === 'startGame') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        if (room.players.findIndex((p) => p.ws === ws) < 0) return;
        const gameType = msg.gameType || data.gameType || 'holdem';
        if (gameType === 'blackjack') {
          bjStartGame(data.roomKey);
        } else if (gameType === 'checkers') {
          const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
          if (room.ckMode === 'computer') {
            if (ckPlayers.length !== 1) {
              ws.send(JSON.stringify({ type: 'error', message: 'Computer mode needs exactly one player in Checkers' }));
              return;
            }
            const starter = ckPlayers.find((p) => p.ws === ws) || ckPlayers[0];
            ckStartGameVsComputer(data.roomKey, starter.id, room.ckTimerProposal ?? msg.timerSeconds, room.ckDifficulty);
            return;
          }
          if (ckPlayers.length === 2) {
            const locked = room.ckWagerLocked || {};
            const l1 = locked[ckPlayers[0].id];
            const l2 = locked[ckPlayers[1].id];
            if (l1 === undefined || l2 === undefined) {
              ws.send(JSON.stringify({ type: 'ckWagerMismatch', message: 'Both players must lock in their wager' }));
              return;
            }
            if (l1 !== l2) {
              ws.send(JSON.stringify({ type: 'ckWagerMismatch', message: 'Wagers must match' }));
              return;
            }
          }
          ckStartGame(data.roomKey, room.ckTimerProposal ?? msg.timerSeconds);
        } else if (gameType === 'chess') {
          const chPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'chess');
          if (room.chMode === 'computer') {
            if (chPlayers.length !== 1) {
              ws.send(JSON.stringify({ type: 'error', message: 'Computer mode needs exactly one player in Chess' }));
              return;
            }
            const starter = chPlayers.find((p) => p.ws === ws) || chPlayers[0];
            chStartGameVsComputer(data.roomKey, starter.id, room.chTimerProposal ?? msg.timerSeconds, room.chDifficulty);
            return;
          }
          if (chPlayers.length === 2) {
            const locked = room.chWagerLocked || {};
            const l1 = locked[chPlayers[0].id];
            const l2 = locked[chPlayers[1].id];
            if (l1 === undefined || l2 === undefined) {
              ws.send(JSON.stringify({ type: 'chWagerMismatch', message: 'Both players must lock in their wager' }));
              return;
            }
            if (l1 !== l2) {
              ws.send(JSON.stringify({ type: 'chWagerMismatch', message: 'Wagers must match' }));
              return;
            }
          }
          chStartGame(data.roomKey, room.chTimerProposal ?? msg.timerSeconds);
        } else {
          const resetStreaks = msg.resetStreaks === true;
          const resetChips = msg.resetChips === true;
          startGame(data.roomKey, resetStreaks, resetChips);
        }
      } else if (type === 'changeRadio') {
        const data = clients.get(ws);
        if (!data) return;
        const station = msg.station;
        if (!station || typeof station.name !== 'string' || typeof station.url !== 'string') return;
        const s = { name: String(station.name).slice(0, 200), url: String(station.url) };
        if (!s.url.startsWith('https://')) return;
        const room = getRoom(data.roomKey);
        room.radio = s;
        broadcastToRoom(data.roomKey, {
          type: 'radioChanged',
          nickname: data.nickname,
          station: s,
        });
      } else if (type === 'stopRadio') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        room.radio = null;
        broadcastToRoom(data.roomKey, {
          type: 'radioStopped',
          nickname: data.nickname,
        });
      } else if (type === 'addBot') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        if (room.phase !== 'lobby') return;
        const holdemPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'holdem');
        if (holdemPlayers.length >= 6) return;
        const botId = 'bot-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const botName = BOT_NAMES[botNameIdx % BOT_NAMES.length];
        botNameIdx++;
        const botDefaultCharacter = getRandomDefaultCharacterId();
        room.players.push({
          id: botId,
          ws: null,
          nickname: botName,
          chips: 100,
          hand: null,
          betThisRound: 0,
          totalBet: 0,
          folded: false,
          allIn: false,
          isBot: true,
          winStreak: 0,
          maxWinStreak: 0,
          currentView: 'holdem',
          purchasedOutfits: [],
          outfit: null,
          purchasedCharacters: botDefaultCharacter ? [botDefaultCharacter] : [],
          character: botDefaultCharacter,
        });
        broadcastToRoom(data.roomKey, {
          type: 'userJoined',
          id: botId,
          nickname: botName,
          chips: 100,
          currentView: 'holdem',
          winStreak: 0,
          maxWinStreak: 0,
          outfit: null,
          purchasedOutfits: [],
          character: botDefaultCharacter,
          purchasedCharacters: botDefaultCharacter ? [botDefaultCharacter] : [],
        });
      } else if (type === 'buyOutfit') {
        ws.send(JSON.stringify({ type: 'outfitError', message: 'Outfits are currently unavailable.' }));
        return;
      } else if (type === 'equipOutfit') {
        ws.send(JSON.stringify({ type: 'outfitError', message: 'Outfits are currently unavailable.' }));
        return;
      } else if (type === 'buyCharacter') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const player = room.players.find((p) => p.ws === ws);
        if (!player) return;
        const characterId = normalizeCharacterId(String(msg.characterId || ''));
        const price = CHARACTER_PRICES[characterId];
        if (characterId == null || price == null) {
          ws.send(JSON.stringify({ type: 'characterError', message: 'Invalid character.' }));
          return;
        }
        player.purchasedCharacters = normalizePurchasedCharacters(player.purchasedCharacters);
        if (player.purchasedCharacters.includes(characterId)) {
          ws.send(JSON.stringify({ type: 'characterError', message: 'Character already purchased.' }));
          return;
        }
        if ((player.chips || 0) < price) {
          ws.send(JSON.stringify({ type: 'characterError', message: 'Not enough currency.' }));
          return;
        }
        player.chips -= price;
        player.purchasedCharacters.push(characterId);
        player.purchasedCharacters = normalizePurchasedCharacters(player.purchasedCharacters);
        player.character = characterId;
        player.purchasedOutfits = normalizePurchasedOutfits(player.purchasedOutfits);
        if (player.dbUserId) {
          saveUserChips(player.dbUserId, player.chips);
          saveUserCosmetics(
            player.dbUserId,
            player.purchasedOutfits,
            player.outfit,
            player.purchasedCharacters,
            player.character
          );
        }
        broadcastToRoom(data.roomKey, {
          type: 'characterUpdated',
          playerId: player.id,
          character: player.character,
          chips: player.chips,
          purchasedCharacters: player.purchasedCharacters,
          outfit: player.outfit || null,
          purchasedOutfits: player.purchasedOutfits,
        });
      } else if (type === 'equipCharacter') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const player = room.players.find((p) => p.ws === ws);
        if (!player) return;
        const characterId = normalizeCharacterId(String(msg.characterId || '')) || '';
        player.purchasedCharacters = normalizePurchasedCharacters(player.purchasedCharacters);
        if (characterId && !player.purchasedCharacters.includes(characterId)) {
          ws.send(JSON.stringify({ type: 'characterError', message: 'Purchase this character first.' }));
          return;
        }
        player.character = characterId || null;
        player.purchasedOutfits = normalizePurchasedOutfits(player.purchasedOutfits);
        if (player.dbUserId) {
          saveUserCosmetics(
            player.dbUserId,
            player.purchasedOutfits,
            player.outfit,
            player.purchasedCharacters,
            player.character
          );
        }
        broadcastToRoom(data.roomKey, {
          type: 'characterUpdated',
          playerId: player.id,
          character: player.character || null,
          chips: player.chips,
          purchasedCharacters: player.purchasedCharacters,
          outfit: player.outfit || null,
          purchasedOutfits: player.purchasedOutfits,
        });
      } else if (type === 'changeNick') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const player = room.players.find((p) => p.ws === ws);
        if (!player) return;
        const safeNick = String(msg.nickname || '').trim().slice(0, 20) || 'Player';

        if (player.dbUserId) {
          try {
            const conflict = await pool.query(
              'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2 LIMIT 1',
              [safeNick, player.dbUserId]
            );
            if (conflict.rows.length > 0) {
              ws.send(JSON.stringify({ type: 'error', message: 'That username is already taken' }));
              return;
            }
            await pool.query('UPDATE users SET username = $1 WHERE id = $2', [safeNick, player.dbUserId]);
            broadcastChessComputerLeaderboardAllChessViewers().catch(() => {});
          } catch (err) {
            console.error('Failed to update username:', err.message);
            ws.send(JSON.stringify({ type: 'error', message: 'Could not update username right now' }));
            return;
          }
        }

        player.nickname = safeNick;
        data.nickname = safeNick;
        broadcastToRoom(data.roomKey, {
          type: 'nicknameChanged',
          playerId: ws.id,
          nickname: safeNick,
          players: room.players.map(serializePlayer),
        });
      } else if (type === 'chat') {
        const data = clients.get(ws);
        if (!data) {
          ws.send(JSON.stringify({ type: 'error', message: 'Join a room first' }));
          return;
        }
        const room = getRoom(data.roomKey);
        if (room.players.findIndex((p) => p.ws === ws) < 0) return;
        const text = String(msg.text || '').trim().slice(0, 100);
        if (!text) return;
        const chatMsg = { playerId: ws.id, nickname: data.nickname, text };
        if (!room.chatHistory) room.chatHistory = [];
        room.chatHistory.push(chatMsg);
        if (room.chatHistory.length > LOBBY_CHAT_MAX) room.chatHistory.shift();
        broadcastToRoom(data.roomKey, {
          type: 'chat',
          ...chatMsg,
        });
      } else if (type === 'changeTheme') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const theme = String(msg.theme || 'default').slice(0, 30);
        room.theme = theme === 'default' ? null : theme;
        broadcastToRoom(data.roomKey, { type: 'themeChanged', theme, nickname: data.nickname });
      } else if (type === 'rebuy') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const idx = room.players.findIndex((p) => p.ws === ws);
        if (idx < 0) return;
        const player = room.players[idx];
        if (player.chips > 0) return;
        if (room.phase !== 'lobby') return;
        player.chips = 10;
        if (player.dbUserId) saveUserChips(player.dbUserId, 10);
        ws.send(JSON.stringify({ type: 'rebuySuccess', chips: 10 }));
        broadcastToRoom(data.roomKey, {
          type: 'userRebuy',
          id: ws.id,
          nickname: player.nickname,
          chips: 10,
          players: room.players.map((p) => ({ id: p.id, nickname: p.nickname, chips: p.chips })),
        });
      } else if (type === 'slotSpin') {
        const SLOTS_DENOMS = [5, 10, 20, 100];
        const rawBet = typeof msg.bet === 'number' ? msg.bet : parseInt(String(msg.bet || 5), 10);
        const validBet = Number.isFinite(rawBet) && SLOTS_DENOMS.includes(rawBet) ? rawBet : 5;
        const SLOTS_SYMBOLS = ['crayfish', 'alligator', 'catfish', 'worm', 'hook'];
        const SLOTS_MULTIPLIERS = { crayfish: 10, alligator: 8, catfish: 50, worm: 4, hook: 3 };
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const pIdx = room.players.findIndex((p) => p.ws === ws);
        if (pIdx < 0) return;
        const player = room.players[pIdx];
        if ((player.currentView ?? 'lobby') !== 'slots') return;
        if ((player.chips || 0) < validBet) return;
        player.chips = (player.chips || 0) - validBet;
        broadcastToRoom(data.roomKey, {
          type: 'slotSpinStarted',
          playerId: ws.id,
          nickname: player.nickname,
          bet: validBet,
        }, null, (p) => (p.currentView ?? 'lobby') === 'slots');
        const reels = [
          SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)],
          SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)],
          SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)],
        ];
        let multiplier = 0;
        if (reels[0] === reels[1] && reels[1] === reels[2]) {
          multiplier = SLOTS_MULTIPLIERS[reels[0]] || 0;
        } else if ((reels[0] === 'worm' && reels[1] === 'worm') || (reels[1] === 'worm' && reels[2] === 'worm') || (reels[0] === 'worm' && reels[2] === 'worm')) {
          multiplier = 1;
        }
        const payout = validBet * multiplier;
        player.chips = (player.chips || 0) + payout;
        if (player.dbUserId) saveUserChips(player.dbUserId, player.chips);
        const isJackpot = multiplier === 50;
        if (isJackpot) {
          const chatMsg = { playerId: ws.id, nickname: player.nickname, text: (player.nickname || 'Someone') + ' won the jackpot!' };
          if (!room.chatHistory) room.chatHistory = [];
          room.chatHistory.push(chatMsg);
          if (room.chatHistory.length > LOBBY_CHAT_MAX) room.chatHistory.shift();
          broadcastToRoom(data.roomKey, { type: 'chat', ...chatMsg });
        }
        broadcastToRoom(data.roomKey, {
          type: 'slotResult',
          playerId: ws.id,
          nickname: player.nickname,
          reels,
          payout,
          bet: validBet,
          multiplier,
          chips: player.chips,
        }, null, (p) => (p.currentView ?? 'lobby') === 'slots');
      } else if (type === 'action') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const players = getHoldemPlayers(room);
        const idx = players.findIndex((p) => p.ws === ws);
        if (idx < 0 || room.phase === 'lobby') return;
        if (room.turnIdx !== idx) return;

        const { action, amount } = msg;
        const player = players[idx];

        if (action === 'fold') {
          clearTurnTimer(room);
          player.folded = true;
          const activeCount = players.filter((p) => !p.folded).length;
          broadcastToRoom(data.roomKey, {
            type: 'action',
            playerId: ws.id,
            action: 'fold',
            pot: room.pot,
            players: players.map((p, i) => ({
              id: p.id,
              folded: p.folded,
              chips: p.chips,
              betThisRound: p.betThisRound,
              isTurn: i === room.turnIdx,
            })),
          });
          if (activeCount <= 1) {
            showdown(data.roomKey);
            return;
          }
          room.turnIdx = advanceTurn(room, room.turnIdx);
          checkBettingComplete(data.roomKey);
        } else if (action === 'check') {
          const anyAllIn = players.some((p) => !p.folded && p.allIn && p.betThisRound > 0);
          if (player.betThisRound < room.currentBet || anyAllIn) {
            ws.send(JSON.stringify({ type: 'error', message: 'Cannot check — you must call or fold' }));
            return;
          }
          clearTurnTimer(room);
          broadcastToRoom(data.roomKey, {
            type: 'action',
            playerId: ws.id,
            action: 'check',
          });
          room.turnIdx = advanceTurn(room, room.turnIdx);
          checkBettingComplete(data.roomKey);
        } else if (action === 'call') {
          clearTurnTimer(room);
          const toCall = room.currentBet - player.betThisRound;
          const actual = Math.min(toCall, player.chips);
          player.chips -= actual;
          player.betThisRound += actual;
          player.totalBet += actual;
          room.pot += actual;
          if (player.chips === 0) player.allIn = true;

          broadcastToRoom(data.roomKey, {
            type: 'action',
            playerId: ws.id,
            action: 'call',
            amount: actual,
            pot: room.pot,
            players: players.map((p, i) => ({
              id: p.id,
              chips: p.chips,
              betThisRound: p.betThisRound,
              isTurn: i === room.turnIdx,
            })),
          });

          room.turnIdx = advanceTurn(room, room.turnIdx);
          checkBettingComplete(data.roomKey);
        } else if (action === 'bet' || action === 'raise') {
          const facingAllIn = room.currentBet > 0 && room.lastRaiserIdx >= 0 && players[room.lastRaiserIdx]?.allIn === true;
          if (facingAllIn) return;
          const raiseTo = Math.max(0, Math.floor(Number(amount) || 0));
          const minRaiseTo = room.currentBet + (action === 'raise' ? room.minRaise : room.bigBlind);
          if (raiseTo < minRaiseTo) return;
          const toAdd = raiseTo - player.betThisRound;
          if (toAdd > player.chips || toAdd < 0) return;
          clearTurnTimer(room);

          const prevBet = room.currentBet;
          player.chips -= toAdd;
          player.betThisRound = raiseTo;
          player.totalBet += toAdd;
          room.pot += toAdd;
          room.currentBet = raiseTo;
          room.lastRaiserIdx = idx;
          room.minRaise = Math.max(room.bigBlind, raiseTo - prevBet);
          if (player.chips === 0) player.allIn = true;

          const facingAllInNow = room.currentBet > 0 && room.lastRaiserIdx >= 0 && players[room.lastRaiserIdx]?.allIn === true;
          broadcastToRoom(data.roomKey, {
            type: 'action',
            playerId: ws.id,
            action: action,
            amount: toAdd,
            currentBet: room.currentBet,
            minRaise: room.minRaise,
            pot: room.pot,
            facingAllIn: facingAllInNow,
            players: players.map((p, i) => ({
              id: p.id,
              chips: p.chips,
              betThisRound: p.betThisRound,
              isTurn: i === room.turnIdx,
            })),
          });

          room.turnIdx = advanceTurn(room, room.turnIdx);
          checkBettingComplete(data.roomKey);
        } else if (action === 'allin') {
          clearTurnTimer(room);
          const allInAmount = player.chips;
          if (allInAmount <= 0) return;
          player.betThisRound += allInAmount;
          player.totalBet += allInAmount;
          room.pot += allInAmount;
          player.chips = 0;
          player.allIn = true;

          if (player.betThisRound > room.currentBet) {
            const prevBet = room.currentBet;
            room.currentBet = player.betThisRound;
            room.lastRaiserIdx = idx;
            room.minRaise = Math.max(room.bigBlind, player.betThisRound - prevBet);
          }

          const facingAllIn = room.currentBet > 0 && room.lastRaiserIdx >= 0 && players[room.lastRaiserIdx]?.allIn === true;
          broadcastToRoom(data.roomKey, {
            type: 'action',
            playerId: ws.id,
            action: 'allin',
            amount: allInAmount,
            currentBet: room.currentBet,
            minRaise: room.minRaise,
            pot: room.pot,
            facingAllIn,
            players: players.map((p, i) => ({
              id: p.id,
              chips: p.chips,
              betThisRound: p.betThisRound,
              isTurn: i === room.turnIdx,
            })),
          });

          room.turnIdx = advanceTurn(room, room.turnIdx);
          checkBettingComplete(data.roomKey);
        }
      } else if (type === 'bjBet') {
        const data = clients.get(ws);
        if (!data) return;
        bjPlaceBet(data.roomKey, ws.id, msg.amount);
      } else if (type === 'bjAction') {
        const data = clients.get(ws);
        if (!data) return;
        bjPlayerAction(data.roomKey, ws.id, msg.action);
      } else if (type === 'ckMove') {
        const data = clients.get(ws);
        if (!data) return;
        ckMakeMove(data.roomKey, ws.id, msg.from, msg.to);
      } else if (type === 'chMove') {
        const data = clients.get(ws);
        if (!data) return;
        chMakeMove(data.roomKey, ws.id, msg.from, msg.to);
      }
    } catch (err) {
      console.error('Message error:', err);
    }
  });

  ws.on('close', () => {
    const data = clients.get(ws);
    if (data) {
      const room = getRoom(data.roomKey);
      const idx = room.players.findIndex((p) => p.ws === ws);
      if (idx >= 0) {
        const wasInGame = room.phase !== 'lobby';
        const wasTurn = wasInGame && room.turnIdx === idx;

        room.players.splice(idx, 1);

        if (wasInGame && room.players.length > 0) {
          if (room.dealerIdx >= room.players.length) room.dealerIdx = room.players.length - 1;
          else if (idx < room.dealerIdx) room.dealerIdx--;

          if (room.lastRaiserIdx >= 0) {
            if (idx === room.lastRaiserIdx) room.lastRaiserIdx = -1;
            else if (idx < room.lastRaiserIdx) room.lastRaiserIdx--;
            if (room.lastRaiserIdx >= room.players.length) room.lastRaiserIdx = room.players.length - 1;
          }

          if (room.turnIdx >= room.players.length) room.turnIdx = 0;
          else if (idx < room.turnIdx) room.turnIdx--;
          if (room.turnIdx < 0) room.turnIdx = 0;
        }

        if (room.players.length === 0) {
          clearTurnTimer(room);
          rooms.delete(data.roomKey);
        } else if (!hasHumanPlayers(room)) {
          clearTurnTimer(room);
          removeAllBots(data.roomKey);
          if (room.players.length === 0) rooms.delete(data.roomKey);
        } else {
          broadcastToRoom(data.roomKey, { type: 'userLeft', id: ws.id });

          if (room.ckPhase === 'playing') {
            ckClearTurnTimer(room);
            ckClearBotMoveTimer(room);
            const remainingColor = room.ckPlayers?.red === ws.id ? 'white' : 'red';
            const losingColor = remainingColor === 'red' ? 'white' : 'red';
            room.ckPhase = 'over';
            const wager = room.ckWager || 0;
            const winnerP = room.ckPlayersList?.find((p) => p.id === room.ckPlayers[remainingColor]);
            const loserP = room.ckPlayersList?.find((p) => p.id === room.ckPlayers[losingColor]);
            broadcastToRoom(data.roomKey, {
              type: 'ckGameOver',
              winner: remainingColor,
              reason: 'disconnect',
              wager,
              players: room.ckPlayersList?.map((p) => ({ id: p.id, chips: p.chips, nickname: p.nickname })) || [],
              winnerNickname: winnerP?.nickname || 'Winner',
              loserNickname: loserP?.nickname || 'Opponent',
            });
          }

          if (room.chPhase === 'playing') {
            chClearTurnTimer(room);
            chClearBotMoveTimer(room);
            const chRemainingColor = room.chPlayers?.white === ws.id ? 'black' : 'white';
            const chLosingColor = chRemainingColor === 'white' ? 'black' : 'white';
            room.chPhase = 'over';
            const wager = room.chWager || 0;
            const winnerP = room.chPlayersList?.find((p) => p.id === room.chPlayers[chRemainingColor]);
            const loserP = room.chPlayersList?.find((p) => p.id === room.chPlayers[chLosingColor]);
            broadcastToRoom(data.roomKey, {
              type: 'chGameOver',
              winner: chRemainingColor,
              reason: 'disconnect',
              wager,
              players: room.chPlayersList?.map((p) => ({ id: p.id, chips: p.chips, nickname: p.nickname })) || [],
              winnerNickname: winnerP?.nickname || 'Winner',
              loserNickname: loserP?.nickname || 'Opponent',
            });
          }

          const activeCount = room.players.filter((p) => !p.folded).length;
          if (wasInGame && (room.players.length < 2 || activeCount <= 1)) {
            clearTurnTimer(room);
            if (activeCount >= 1 && room.players.length >= 1) {
              showdown(data.roomKey);
            } else {
              room.phase = 'lobby';
              broadcastToRoom(data.roomKey, { type: 'roundOver', players: room.players.map((p) => ({ id: p.id, nickname: p.nickname, chips: p.chips })) });
            }
          } else if (wasInGame && wasTurn) {
            clearTurnTimer(room);
            const nextPlayer = room.players[room.turnIdx];
            const facingAllIn = room.currentBet > 0 && room.lastRaiserIdx >= 0 && room.players[room.lastRaiserIdx]?.allIn === true;
            broadcastToRoom(data.roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: nextPlayer?.id, facingAllIn });
            if (nextPlayer?.isBot) scheduleBotAction(data.roomKey);
            else startTurnTimer(data.roomKey);
          }
        }
      }
      clients.delete(ws);
    }
  });
});
