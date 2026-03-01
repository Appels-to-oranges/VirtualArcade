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
    });
  }
  return rooms.get(roomKey);
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

  room.players[sbIdx].chips -= room.smallBlind;
  room.players[sbIdx].betThisRound = room.smallBlind;
  room.players[sbIdx].totalBet += room.smallBlind;
  room.players[bbIdx].chips -= room.bigBlind;
  room.players[bbIdx].betThisRound = room.bigBlind;
  room.players[bbIdx].totalBet += room.bigBlind;
  room.pot = room.smallBlind + room.bigBlind;
  room.currentBet = room.bigBlind;

  room.turnIdx = (room.dealerIdx + 3) % room.players.length;
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
}

function nextPhase(roomKey) {
  const room = getRoom(roomKey);
  const activeCount = room.players.filter((p) => !p.folded).length;

  if (activeCount <= 1) {
    showdown(roomKey);
    return;
  }

  if (room.phase === 'preflop') {
    room.phase = 'flop';
    room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    room.currentBet = 0;
    room.players.forEach((p) => (p.betThisRound = 0));
    room.turnIdx = (room.dealerIdx + 1) % room.players.length;
    while (room.players[room.turnIdx].folded) {
      room.turnIdx = (room.turnIdx + 1) % room.players.length;
    }
    room.lastRaiserIdx = room.turnIdx;
  } else if (room.phase === 'flop') {
    room.phase = 'turn';
    room.communityCards.push(room.deck.pop());
    room.currentBet = 0;
    room.players.forEach((p) => (p.betThisRound = 0));
    room.turnIdx = (room.dealerIdx + 1) % room.players.length;
    while (room.players[room.turnIdx].folded) {
      room.turnIdx = (room.turnIdx + 1) % room.players.length;
    }
    room.lastRaiserIdx = room.turnIdx;
  } else if (room.phase === 'turn') {
    room.phase = 'river';
    room.communityCards.push(room.deck.pop());
    room.currentBet = 0;
    room.players.forEach((p) => (p.betThisRound = 0));
    room.turnIdx = (room.dealerIdx + 1) % room.players.length;
    while (room.players[room.turnIdx].folded) {
      room.turnIdx = (room.turnIdx + 1) % room.players.length;
    }
    room.lastRaiserIdx = room.turnIdx;
  } else {
    showdown(roomKey);
    return;
  }

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
}

function showdown(roomKey) {
  const room = getRoom(roomKey);
  const active = room.players.filter((p) => !p.folded);

  if (active.length === 1) {
    active[0].chips += room.pot;
    broadcastToRoom(roomKey, {
      type: 'gameOver',
      winner: active[0].id,
      winnerNickname: active[0].nickname,
      reason: 'fold',
      pot: room.pot,
      players: room.players.map((p) => ({ id: p.id, chips: p.chips })),
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

    broadcastToRoom(roomKey, {
      type: 'gameOver',
      winners: winnerIds,
      winnerNicknames: winnerHands.map((h) => h.player.nickname),
      handName: winners[0]?.name || '',
      pot: room.pot,
      winAmount,
      communityCards: room.communityCards,
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

function checkBettingComplete(roomKey) {
  const room = getRoom(roomKey);
  const active = room.players.filter((p) => !p.folded && !p.allIn);
  const allMatched = active.every((p) => p.betThisRound >= room.currentBet);
  const allActed = active.every((p) => p.betThisRound > 0 || room.currentBet === 0);
  if (allMatched && (room.turnIdx === room.lastRaiserIdx || active.length <= 1)) {
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
        }));

        broadcastToRoom(safeRoom, { type: 'userJoined', id: ws.id, nickname: safeNick }, ws);
      } else if (type === 'startGame') {
        const data = clients.get(ws);
        if (!data) return;
        const room = getRoom(data.roomKey);
        const idx = room.players.findIndex((p) => p.ws === ws);
        if (idx < 0) return;
        startGame(data.roomKey);
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
          room.turnIdx = (room.turnIdx + 1) % room.players.length;
          while (room.players[room.turnIdx].folded && room.turnIdx !== room.lastRaiserIdx) {
            room.turnIdx = (room.turnIdx + 1) % room.players.length;
          }
          if (room.turnIdx === room.lastRaiserIdx || room.players[room.lastRaiserIdx].folded) {
            checkBettingComplete(data.roomKey);
          } else {
            broadcastToRoom(data.roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: room.players[room.turnIdx].id });
          }
        } else if (action === 'check') {
          if (player.betThisRound < room.currentBet) return;
          broadcastToRoom(data.roomKey, {
            type: 'action',
            playerId: ws.id,
            action: 'check',
          });
          room.turnIdx = (room.turnIdx + 1) % room.players.length;
          while (room.players[room.turnIdx].folded && room.turnIdx !== room.lastRaiserIdx) {
            room.turnIdx = (room.turnIdx + 1) % room.players.length;
          }
          if (room.turnIdx === room.lastRaiserIdx || room.players[room.lastRaiserIdx].folded) {
            checkBettingComplete(data.roomKey);
          } else {
            broadcastToRoom(data.roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: room.players[room.turnIdx].id });
          }
        } else if (action === 'call') {
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

          room.turnIdx = (room.turnIdx + 1) % room.players.length;
          while (room.players[room.turnIdx].folded && room.turnIdx !== room.lastRaiserIdx) {
            room.turnIdx = (room.turnIdx + 1) % room.players.length;
          }
          if (room.turnIdx === room.lastRaiserIdx || room.players[room.lastRaiserIdx].folded) {
            checkBettingComplete(data.roomKey);
          } else {
            broadcastToRoom(data.roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: room.players[room.turnIdx].id });
          }
        } else if (action === 'bet' || action === 'raise') {
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

          room.turnIdx = (room.turnIdx + 1) % room.players.length;
          while (room.players[room.turnIdx].folded && room.turnIdx !== idx) {
            room.turnIdx = (room.turnIdx + 1) % room.players.length;
          }
          broadcastToRoom(data.roomKey, { type: 'turn', turnIdx: room.turnIdx, playerId: room.players[room.turnIdx].id });
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
