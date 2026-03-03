'use strict';

const Hand = require('pokersolver').Hand;

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function toSolverFormat(card) {
  const rankMap = { '10': 'T', J: 'J', Q: 'Q', K: 'K', A: 'A' };
  const suitMap = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' };
  return (rankMap[card.rank] || card.rank) + (suitMap[card.suit] || 'h');
}

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function cardKey(c) {
  return c.rank + '|' + c.suit;
}

function removeKnown(deck, knownCards) {
  const known = new Set(knownCards.map(cardKey));
  return deck.filter((c) => !known.has(cardKey(c)));
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Monte Carlo equity estimation for NLH.
 *
 * heroHole:  [{suit,rank},{suit,rank}]
 * board:     [] up to 5 cards in {suit,rank} format
 * opponents: number of opponents still in hand
 * iters:     simulation count
 *
 * Returns { equity, wins, ties, iters }
 */
function estimateEquity({ heroHole, board = [], opponents = 1, iters = 3000 }) {
  const known = heroHole.concat(board);
  const deckBase = removeKnown(makeDeck(), known);

  let wins = 0;
  let ties = 0;

  for (let t = 0; t < iters; t++) {
    const deck = deckBase.slice();
    shuffleInPlace(deck);

    let idx = 0;
    const oppHoles = [];
    for (let p = 0; p < opponents; p++) {
      oppHoles.push([deck[idx++], deck[idx++]]);
    }

    const needed = 5 - board.length;
    const runout = board.slice();
    for (let i = 0; i < needed; i++) {
      runout.push(deck[idx++]);
    }

    const heroCards = heroHole.concat(runout).map(toSolverFormat);
    const heroHand = Hand.solve(heroCards);

    const hands = [heroHand];
    for (let p = 0; p < opponents; p++) {
      const oppCards = oppHoles[p].concat(runout).map(toSolverFormat);
      hands.push(Hand.solve(oppCards));
    }

    const winners = Hand.winners(hands);
    if (winners.includes(heroHand)) {
      if (winners.length === 1) wins++;
      else ties++;
    }
  }

  const equity = (wins + ties / (opponents + 1)) / iters;
  return { equity, wins, ties, iters };
}

module.exports = { estimateEquity };
