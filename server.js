const express = require('express');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Hand = require('pokersolver').Hand;

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

function getRoom(roomKey) {
  if (!rooms.has(roomKey)) {
    rooms.set(roomKey, {
      players: [],
      gameState: null,
      deck: null,
      communityCards: [],
      pot: 0,
      currentBet: 0,
      dealerIdx: 0,
      smallBlind: 10,
      bigBlind: 20,
      phase: 'lobby',
      turnIdx: 0,
      lastRaiserIdx: -1,
      minRaise: 20,
      sidePots: [],
      turnTimeout: null,
      radio: null,
    });
  }
  return rooms.get(roomKey);
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
    if (room.phase === 'lobby') return;
    const idx = room.turnIdx;
    const player = room.players[idx];
    if (!player || player.folded || player.allIn) return;

    const canCheck = player.betThisRound >= room.currentBet;
    const toCall = room.currentBet - player.betThisRound;

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
        players: room.players.map((p, i) => ({
          id: p.id,
          chips: p.chips,
          betThisRound: p.betThisRound,
          isTurn: i === room.turnIdx,
        })),
      });
    } else {
      player.folded = true;
      const activeCount = room.players.filter((p) => !p.folded).length;
      broadcastToRoom(roomKey, {
        type: 'action',
        playerId: player.id,
        action: 'fold',
        reason: 'timeout',
        pot: room.pot,
        players: room.players.map((p, i) => ({
          id: p.id,
          folded: p.folded,
          chips: p.chips,
          betThisRound: p.betThisRound,
          isTurn: i === room.turnIdx,
        })),
      });
      if (activeCount <= 1) {
        showdown(roomKey);
        return;
      }
    }

    room.turnIdx = advanceTurn(room, room.turnIdx);
    if (room.turnIdx === room.lastRaiserIdx || !canAct(room.players[room.lastRaiserIdx])) {
      checkBettingComplete(roomKey);
    } else {
      broadcastToRoom(roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: room.players[room.turnIdx].id });
      startTurnTimer(roomKey);
    }
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

function startGame(roomKey) {
  const room = getRoom(roomKey);
  if (room.players.length < 2) return;
  const playersWithChips = room.players.filter((p) => (p.chips ?? 1000) > 0);
  if (playersWithChips.length < 2) return;

  room.deck = shuffle(createDeck());
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 0;
  room.phase = 'preflop';
  room.turnIdx = 0;
  room.lastRaiserIdx = -1;
  room.minRaise = room.bigBlind;
  room.sidePots = [];

  room.dealerIdx = (room.dealerIdx + 1) % room.players.length;
  const sbIdx = (room.dealerIdx + 1) % room.players.length;
  const bbIdx = (room.dealerIdx + 2) % room.players.length;

  room.players.forEach((p, i) => {
    p.hand = [room.deck.pop(), room.deck.pop()];
    p.betThisRound = 0;
    p.totalBet = 0;
    p.folded = false;
    p.allIn = false;
    p.chips = p.chips ?? 1000;
  });

  const sbPay = Math.min(room.smallBlind, Math.max(0, room.players[sbIdx].chips));
  const bbPay = Math.min(room.bigBlind, Math.max(0, room.players[bbIdx].chips));
  room.players[sbIdx].chips -= sbPay;
  room.players[sbIdx].betThisRound = sbPay;
  room.players[sbIdx].totalBet += sbPay;
  if (room.players[sbIdx].chips === 0) room.players[sbIdx].allIn = true;
  room.players[bbIdx].chips -= bbPay;
  room.players[bbIdx].betThisRound = bbPay;
  room.players[bbIdx].totalBet += bbPay;
  if (room.players[bbIdx].chips === 0) room.players[bbIdx].allIn = true;
  room.pot = sbPay + bbPay;
  room.currentBet = room.bigBlind;

  room.turnIdx = advanceTurn(room, (room.dealerIdx + 2) % room.players.length);
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
    players: room.players.map((p, i) => ({
      id: p.id,
      nickname: p.nickname,
      chips: p.chips,
      betThisRound: p.betThisRound,
      folded: p.folded,
      isDealer: i === room.dealerIdx,
      isSB: i === sbIdx,
      isBB: i === bbIdx,
      isTurn: i === room.turnIdx,
    })),
  });

  room.players.forEach((p, i) => {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({
        type: 'yourHand',
        hand: p.hand,
      }));
    }
  });
  startTurnTimer(roomKey);
}

function nextPhase(roomKey) {
  const room = getRoom(roomKey);
  const activeCount = room.players.filter((p) => !p.folded).length;

  if (activeCount <= 1) {
    showdown(roomKey);
    return;
  }

  const allAllIn = room.players.filter((p) => !p.folded).every((p) => p.allIn || p.chips === 0);

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
  room.players.forEach((p) => (p.betThisRound = 0));
  room.minRaise = room.bigBlind;

  if (allAllIn) {
    broadcastToRoom(roomKey, {
      type: 'phaseChange',
      phase: room.phase,
      communityCards: room.communityCards,
      pot: room.pot,
      currentBet: 0,
      minRaise: room.minRaise,
      turnIdx: -1,
      players: room.players.map((p, i) => ({
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
    players: room.players.map((p, i) => ({
      id: p.id,
      chips: p.chips,
      betThisRound: p.betThisRound,
      folded: p.folded,
      isTurn: i === room.turnIdx,
    })),
  });
  startTurnTimer(roomKey);
}

function showdown(roomKey) {
  const room = getRoom(roomKey);
  const active = room.players.filter((p) => !p.folded);

  clearTurnTimer(room);

  if (active.length === 1) {
    active[0].chips += room.pot;
    const holeCards = active[0].hand;
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
      players: room.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        chips: p.chips,
        hand: p.hand,
        folded: p.folded,
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
      players: room.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        chips: p.chips,
        hand: p.hand,
        folded: p.folded,
      })),
    });
  }

  room.phase = 'lobby';
  room.gameState = null;
  broadcastToRoom(roomKey, {
    type: 'roundOver',
    players: room.players.map((p) => ({ id: p.id, nickname: p.nickname, chips: p.chips })),
  });
}

function canAct(player) {
  return !player.folded && !player.allIn && player.chips > 0;
}

function advanceTurn(room, fromIdx) {
  let next = (fromIdx + 1) % room.players.length;
  let loops = 0;
  while (!canAct(room.players[next]) && loops < room.players.length) {
    next = (next + 1) % room.players.length;
    loops++;
  }
  return next;
}

function checkBettingComplete(roomKey) {
  const room = getRoom(roomKey);
  const active = room.players.filter((p) => canAct(p));
  if (active.length <= 1) {
    nextPhase(roomKey);
    return;
  }
  const allMatched = active.every((p) => p.betThisRound >= room.currentBet);
  if (allMatched && room.turnIdx === room.lastRaiserIdx) {
    nextPhase(roomKey);
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
        if (room.phase !== 'lobby' && room.phase !== null) {
          ws.send(JSON.stringify({ type: 'error', message: 'Game in progress, wait for round to end' }));
          return;
        }

        const existing = room.players.find((p) => p.ws === ws);
        if (existing) {
          existing.nickname = safeNick;
        } else {
          room.players.push({
            id: ws.id,
            ws,
            nickname: safeNick,
            chips: 1000,
            hand: null,
            betThisRound: 0,
            totalBet: 0,
            folded: false,
            allIn: false,
          });
        }

        clients.set(ws, { roomKey: safeRoom, nickname: safeNick });

        ws.send(JSON.stringify({
          type: 'joined',
          id: ws.id,
          roomKey: safeRoom,
          players: room.players.map((p) => ({
            id: p.id,
            nickname: p.nickname,
            chips: p.chips,
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

        broadcastToRoom(safeRoom, { type: 'userJoined', id: ws.id, nickname: safeNick }, ws);
      } else if (type === 'startGame') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const idx = room.players.findIndex((p) => p.ws === ws);
        if (idx < 0) return;
        startGame(data.roomKey);
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
      } else if (type === 'rebuy') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const idx = room.players.findIndex((p) => p.ws === ws);
        if (idx < 0) return;
        const player = room.players[idx];
        if (player.chips > 0) return;
        if (room.phase !== 'lobby') return;
        player.chips = 1000;
        ws.send(JSON.stringify({ type: 'rebuySuccess', chips: 1000 }));
        broadcastToRoom(data.roomKey, {
          type: 'userRebuy',
          id: ws.id,
          nickname: player.nickname,
          chips: 1000,
          players: room.players.map((p) => ({ id: p.id, nickname: p.nickname, chips: p.chips })),
        });
      } else if (type === 'action') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const idx = room.players.findIndex((p) => p.ws === ws);
        if (idx < 0 || room.phase === 'lobby') return;
        if (room.turnIdx !== idx) return;

        const { action, amount } = msg;
        const player = room.players[idx];

        if (action === 'fold') {
          clearTurnTimer(room);
          player.folded = true;
          const activeCount = room.players.filter((p) => !p.folded).length;
          broadcastToRoom(data.roomKey, {
            type: 'action',
            playerId: ws.id,
            action: 'fold',
            pot: room.pot,
            players: room.players.map((p, i) => ({
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
          if (room.turnIdx === room.lastRaiserIdx || !canAct(room.players[room.lastRaiserIdx])) {
            checkBettingComplete(data.roomKey);
          } else {
            broadcastToRoom(data.roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: room.players[room.turnIdx].id });
            startTurnTimer(data.roomKey);
          }
        } else if (action === 'check') {
          clearTurnTimer(room);
          if (player.betThisRound < room.currentBet) return;
          broadcastToRoom(data.roomKey, {
            type: 'action',
            playerId: ws.id,
            action: 'check',
          });
          room.turnIdx = advanceTurn(room, room.turnIdx);
          if (room.turnIdx === room.lastRaiserIdx || !canAct(room.players[room.lastRaiserIdx])) {
            checkBettingComplete(data.roomKey);
          } else {
            broadcastToRoom(data.roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: room.players[room.turnIdx].id });
            startTurnTimer(data.roomKey);
          }
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
            players: room.players.map((p, i) => ({
              id: p.id,
              chips: p.chips,
              betThisRound: p.betThisRound,
              isTurn: i === room.turnIdx,
            })),
          });

          room.turnIdx = advanceTurn(room, room.turnIdx);
          if (room.turnIdx === room.lastRaiserIdx || !canAct(room.players[room.lastRaiserIdx])) {
            checkBettingComplete(data.roomKey);
          } else {
            broadcastToRoom(data.roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: room.players[room.turnIdx].id });
            startTurnTimer(data.roomKey);
          }
        } else if (action === 'bet' || action === 'raise') {
          clearTurnTimer(room);
          const raiseTo = Math.max(0, Math.floor(Number(amount) || 0));
          const minRaiseTo = room.currentBet + (action === 'raise' ? room.minRaise : room.bigBlind);
          if (raiseTo < minRaiseTo) return;
          const toAdd = raiseTo - player.betThisRound;
          if (toAdd > player.chips || toAdd < 0) return;

          const prevBet = room.currentBet;
          player.chips -= toAdd;
          player.betThisRound = raiseTo;
          player.totalBet += toAdd;
          room.pot += toAdd;
          room.currentBet = raiseTo;
          room.lastRaiserIdx = idx;
          room.minRaise = Math.max(room.bigBlind, raiseTo - prevBet);
          if (player.chips === 0) player.allIn = true;

          broadcastToRoom(data.roomKey, {
            type: 'action',
            playerId: ws.id,
            action: action,
            amount: toAdd,
            currentBet: room.currentBet,
            minRaise: room.minRaise,
            pot: room.pot,
            players: room.players.map((p, i) => ({
              id: p.id,
              chips: p.chips,
              betThisRound: p.betThisRound,
              isTurn: i === room.turnIdx,
            })),
          });

          room.turnIdx = advanceTurn(room, room.turnIdx);
          broadcastToRoom(data.roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: room.players[room.turnIdx].id });
          startTurnTimer(data.roomKey);
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

          broadcastToRoom(data.roomKey, {
            type: 'action',
            playerId: ws.id,
            action: 'allin',
            amount: allInAmount,
            currentBet: room.currentBet,
            minRaise: room.minRaise,
            pot: room.pot,
            players: room.players.map((p, i) => ({
              id: p.id,
              chips: p.chips,
              betThisRound: p.betThisRound,
              isTurn: i === room.turnIdx,
            })),
          });

          room.turnIdx = advanceTurn(room, room.turnIdx);
          if (room.turnIdx === room.lastRaiserIdx || !canAct(room.players[room.lastRaiserIdx])) {
            checkBettingComplete(data.roomKey);
          } else {
            broadcastToRoom(data.roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: room.players[room.turnIdx].id });
            startTurnTimer(data.roomKey);
          }
        }
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
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          rooms.delete(data.roomKey);
        } else {
          broadcastToRoom(data.roomKey, { type: 'userLeft', id: ws.id });
          if (room.phase !== 'lobby' && room.players.length < 2) {
            room.phase = 'lobby';
            broadcastToRoom(data.roomKey, { type: 'roundOver', players: room.players.map((p) => ({ id: p.id, nickname: p.nickname, chips: p.chips })) });
          }
        }
      }
      clients.delete(ws);
    }
  });
});
