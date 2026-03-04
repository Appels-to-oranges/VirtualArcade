const express = require('express');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Hand = require('pokersolver').Hand;
const { decideAction, getPosition } = require('./bot_decide');

const PORT = process.env.PORT || 3000;
const app = express();

// Serve static files from public
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.send('ok'));

// Serve card assets - use ./public/cards if bundled, else ../cards (Desktop)
const cardsPath = path.join(__dirname, 'public', 'cards');
const cardsPathAlt = path.join(__dirname, '..', 'cards');
if (fs.existsSync(cardsPath)) {
  app.use('/cards', express.static(cardsPath));
} else if (fs.existsSync(cardsPathAlt)) {
  app.use('/cards', express.static(cardsPathAlt));
}

const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`Poker running at http://${HOST}:${PORT}`);
});

const wss = new WebSocketServer({ server });

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

const MAX_PLAYERS = { holdem: 6, blackjack: 6, checkers: 2 };

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

function broadcastToRoom(roomKey, message, excludeWs = null) {
  const room = getRoom(roomKey);
  const payload = JSON.stringify(message);
  room.players.forEach((p) => {
    if (p.ws && p.ws !== excludeWs && p.ws.readyState === 1) {
      p.ws.send(payload);
    }
  });
}

function startGame(roomKey, resetStreaks = false, resetChips = false) {
  const room = getRoom(roomKey);
  const holdemPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'holdem');
  if (holdemPlayers.length < 2 || holdemPlayers.length > 6) return;
  room.holdemPlayers = holdemPlayers;

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
    p.chips = p.chips ?? 100;
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
  }

  room.phase = 'lobby';
  room.gameState = null;
  room.holdemPlayers = null;
  clearTurnTimer(room);

  removeBrokeBots(roomKey);

  broadcastToRoom(roomKey, {
    type: 'roundOver',
    players: room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      chips: p.chips,
      winStreak: p.winStreak ?? 0,
      maxWinStreak: p.maxWinStreak ?? 0,
    })),
  });
}

function canAct(player) {
  return !player.folded && !player.allIn && player.chips > 0;
}

function removeBrokeBots(roomKey) {
  const room = getRoom(roomKey);
  const brokeBots = room.players.filter((p) => p.isBot && p.chips <= 0);
  brokeBots.forEach((bot) => {
    room.players = room.players.filter((p) => p.id !== bot.id);
    broadcastToRoom(roomKey, { type: 'userLeft', id: bot.id });
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

function ckGetValidMoves(board, row, col, color) {
  const piece = board[row][col];
  if (!piece || piece.color !== color) return [];

  const dirs = piece.king
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : color === 'red' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];

  const results = [];

  for (const [dr, dc] of dirs) {
    const mr = row + dr, mc = col + dc;
    const jr = row + 2 * dr, jc = col + 2 * dc;

    if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8 &&
        board[mr]?.[mc] && board[mr][mc].color !== color && !board[jr][jc]) {
      results.push({ row: jr, col: jc, captured: { row: mr, col: mc } });
    }

    if (mr >= 0 && mr < 8 && mc >= 0 && mc < 8 && !board[mr][mc]) {
      results.push({ row: mr, col: mc });
    }
  }

  return results;
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

function ckStartTurnTimer(roomKey) {
  const room = getRoom(roomKey);
  ckClearTurnTimer(room);
  if (!room.ckTimerMs || room.ckTimerMs <= 0) return;
  room.ckTurnDeadline = Date.now() + room.ckTimerMs;
  room.ckTurnTimeout = setTimeout(() => {
    room.ckTurnTimeout = null;
    const r = getRoom(roomKey);
    if (r.ckPhase !== 'playing') return;
    const losingColor = r.ckTurn;
    const winnerColor = losingColor === 'red' ? 'white' : 'red';
    r.ckPhase = 'over';
    broadcastToRoom(roomKey, {
      type: 'ckGameOver',
      winner: winnerColor,
      reason: 'timeout',
    });
  }, room.ckTimerMs);
}

function ckStartGame(roomKey, timerSeconds) {
  const room = getRoom(roomKey);
  const ckPlayers = room.players.filter((p) => (p.currentView ?? 'lobby') === 'checkers');
  if (ckPlayers.length !== 2) return;
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
    turnDeadline: room.ckTurnDeadline || 0,
  });

  ckPlayers.forEach((p) => {
    if (p.ws && p.ws.readyState === 1) {
      const color = room.ckPlayers.red === p.id ? 'red' : 'white';
      p.ws.send(JSON.stringify({ type: 'ckYourColor', color }));
    }
  });
}

function ckMakeMove(roomKey, playerId, from, to) {
  const room = getRoom(roomKey);
  if (room.ckPhase !== 'playing') return;

  const currentColor = room.ckTurn;
  if (room.ckPlayers[currentColor] !== playerId) return;

  const board = room.ckBoard;
  const piece = board[from.row]?.[from.col];
  if (!piece || piece.color !== currentColor) return;

  const validMoves = ckGetValidMoves(board, from.row, from.col, currentColor);
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

  room.ckMustContinue = null;
  room.ckTurn = currentColor === 'red' ? 'white' : 'red';
  ckStartTurnTimer(roomKey);

  broadcastToRoom(roomKey, {
    type: 'ckBoardUpdate',
    board: room.ckBoard,
    turn: room.ckTurn,
    lastMove: { from, to, captured: capturedInfo },
    mustContinue: null,
    promoted,
    turnDeadline: room.ckTurnDeadline || 0,
  });

  {
    const winner = ckCheckWin(board, room.ckTurn);
    if (winner) {
      room.ckPhase = 'over';
      ckClearTurnTimer(room);
      const hasPieces = (() => {
        for (let r = 0; r < 8; r++)
          for (let c = 0; c < 8; c++)
            if (board[r][c] && board[r][c].color === room.ckTurn) return true;
        return false;
      })();
      broadcastToRoom(roomKey, {
        type: 'ckGameOver',
        winner,
        reason: hasPieces ? 'noMoves' : 'capture',
      });
    }
  }
}

wss.on('connection', (ws) => {
  ws.id = crypto.randomUUID();

  ws.on('message', (raw) => {
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

        let targetGameType = msg.gameType === 'lobby' ? 'lobby' : (msg.gameType || 'lobby');
        let gameFull = false;
        if (targetGameType !== 'lobby' && isGameFull(room, targetGameType)) {
          targetGameType = 'lobby';
          gameFull = true;
        }

        const existing = room.players.find((p) => p.ws === ws);
        if (existing) {
          existing.nickname = safeNick;
        } else {
          room.players.push({
            id: ws.id,
            ws,
            nickname: safeNick,
            chips: 100,
            hand: null,
            betThisRound: 0,
            totalBet: 0,
            folded: false,
            allIn: false,
            winStreak: 0,
            maxWinStreak: 0,
            currentView: targetGameType,
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
          players: room.players.map((p) => ({
            id: p.id,
            nickname: p.nickname,
            chips: p.chips,
            winStreak: p.winStreak ?? 0,
            maxWinStreak: p.maxWinStreak ?? 0,
            currentView: p.currentView ?? 'lobby',
          })),
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

        broadcastToRoom(safeRoom, {
          type: 'userJoined',
          id: ws.id,
          nickname: safeNick,
          chips: 100,
          winStreak: 0,
          maxWinStreak: 0,
          currentView: targetGameType,
        }, ws);
      } else if (type === 'backToLobby') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const pIdx = room.players.findIndex((p) => p.ws === ws);
        if (pIdx < 0) return;
        room.players[pIdx].currentView = 'lobby';
        clients.set(ws, { ...data, gameType: 'lobby' });

        const humansInHoldem = room.players.some((p) => !p.isBot && (p.currentView ?? 'lobby') === 'holdem');
        if (!humansInHoldem) {
          removeAllBots(data.roomKey);
        }

        broadcastToRoom(data.roomKey, {
          type: 'playerViewChanged',
          players: room.players.map((p) => ({ id: p.id, nickname: p.nickname, currentView: p.currentView ?? 'lobby' })),
        });
        ws.send(JSON.stringify({
          type: 'backToLobby',
          id: ws.id,
          roomKey: data.roomKey,
          players: room.players.map((p) => ({
            id: p.id,
            nickname: p.nickname,
            chips: p.chips,
            winStreak: p.winStreak ?? 0,
            maxWinStreak: p.maxWinStreak ?? 0,
            currentView: p.currentView ?? 'lobby',
          })),
          chatHistory: (room.chatHistory || []).slice(-LOBBY_CHAT_MAX),
        }));
      } else if (type === 'switchGame') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const pIdx = room.players.findIndex((p) => p.ws === ws);
        if (pIdx < 0) return;
        const newType = msg.gameType || 'holdem';
        if (newType !== 'holdem' && newType !== 'blackjack' && newType !== 'checkers') return;
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
          players: room.players.map((p) => ({ id: p.id, nickname: p.nickname, currentView: p.currentView ?? 'lobby' })),
        });
        ws.send(JSON.stringify({
          type: 'gameSwitched',
          id: ws.id,
          roomKey: data.roomKey,
          gameType: newType,
          players: room.players.map((p) => ({
            id: p.id,
            nickname: p.nickname,
            chips: p.chips,
            winStreak: p.winStreak ?? 0,
            maxWinStreak: p.maxWinStreak ?? 0,
            currentView: p.currentView ?? 'lobby',
          })),
          gameState: room.phase === 'lobby' ? null : {
            phase: room.phase,
            communityCards: room.communityCards,
            pot: room.pot,
            currentBet: room.currentBet,
            turnIdx: room.turnIdx,
            dealerIdx: room.dealerIdx,
          },
          radio: room.radio,
        }));
      } else if (type === 'startGame') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        if (room.players.findIndex((p) => p.ws === ws) < 0) return;
        const gameType = msg.gameType || data.gameType || 'holdem';
        if (gameType === 'blackjack') {
          bjStartGame(data.roomKey);
        } else if (gameType === 'checkers') {
          ckStartGame(data.roomKey, msg.timerSeconds);
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
        });
        broadcastToRoom(data.roomKey, {
          type: 'userJoined',
          id: botId,
          nickname: botName,
          chips: 100,
          currentView: 'holdem',
          winStreak: 0,
          maxWinStreak: 0,
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
      } else if (type === 'rebuy') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const idx = room.players.findIndex((p) => p.ws === ws);
        if (idx < 0) return;
        const player = room.players[idx];
        if (player.chips > 0) return;
        if (room.phase !== 'lobby') return;
        player.chips = 100;
        ws.send(JSON.stringify({ type: 'rebuySuccess', chips: 100 }));
        broadcastToRoom(data.roomKey, {
          type: 'userRebuy',
          id: ws.id,
          nickname: player.nickname,
          chips: 100,
          players: room.players.map((p) => ({ id: p.id, nickname: p.nickname, chips: p.chips })),
        });
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
            const remainingColor = room.ckPlayers?.red === ws.id ? 'white' : 'red';
            room.ckPhase = 'over';
            broadcastToRoom(data.roomKey, { type: 'ckGameOver', winner: remainingColor, reason: 'disconnect' });
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
