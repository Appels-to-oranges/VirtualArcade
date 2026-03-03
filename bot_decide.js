'use strict';

const { estimateEquity } = require('./bot_equity');

// ── Tuning knobs ──────────────────────────────────────────────────────

const EQUITY_ITERS = 3000;
const FOLD_MARGIN = -0.05;
const RAISE_MARGIN = 0.12;
const BLUFF_FREQ = { preflop: 0.0, flop: 0.12, turn: 0.08, river: 0.05 };
const CHECK_RAISE_FREQ = 0.15;

// ── Preflop hand ranges by position ───────────────────────────────────
// Tiers: 1=premium, 2=strong, 3=playable, 4=marginal, 5=speculative
// Position opens: UTG tiers 1-2, MP 1-3, CO 1-4, BTN 1-5, SB 1-4, BB defends wider

const HAND_TIERS = {};

function handKey(r1, r2, suited) {
  const RANK_ORDER = 'AKQJT98765432';
  const i1 = RANK_ORDER.indexOf(r1);
  const i2 = RANK_ORDER.indexOf(r2);
  if (i1 <= i2) return r1 + r2 + (r1 === r2 ? '' : suited ? 's' : 'o');
  return r2 + r1 + (r1 === r2 ? '' : suited ? 's' : 'o');
}

function initTiers() {
  const t1 = ['AA', 'KK', 'QQ', 'AKs'];
  const t2 = ['JJ', 'TT', 'AKo', 'AQs', 'AQo', 'KQs'];
  const t3 = ['99', '88', '77', 'AJs', 'ATs', 'KQo', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs'];
  const t4 = ['66', '55', '44', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
              'KJo', 'K9s', 'QJo', 'Q9s', 'J9s', 'T9s', 'T8s', '98s', '87s', '76s', '65s'];
  const t5 = ['33', '22', 'ATo', 'A9o', 'K8s', 'K7s', 'K6s', 'K5s',
              'Q8s', 'J8s', 'T7s', '97s', '86s', '75s', '64s', '54s',
              'KTo', 'QTo', 'JTo', 'T9o', '98o', '87o'];

  [t1, t2, t3, t4, t5].forEach((arr, idx) => {
    arr.forEach((h) => { HAND_TIERS[h] = idx + 1; });
  });
}
initTiers();

// Position -> max tier allowed for open-raising
const OPEN_TIER = { UTG: 2, MP: 3, CO: 4, BTN: 5, SB: 4, BB: 5 };
// Position -> max tier for calling a raise
const CALL_TIER = { UTG: 2, MP: 2, CO: 3, BTN: 4, SB: 3, BB: 4 };
// Position -> max tier for 3-betting
const THREEBET_TIER = { UTG: 1, MP: 1, CO: 2, BTN: 2, SB: 2, BB: 2 };

function normalizeRank(rank) {
  if (rank === '10') return 'T';
  return rank;
}

function getHandTier(heroHole) {
  const r1 = normalizeRank(heroHole[0].rank);
  const r2 = normalizeRank(heroHole[1].rank);
  const suited = heroHole[0].suit === heroHole[1].suit;
  const key = handKey(r1, r2, suited);
  return HAND_TIERS[key] || 6;
}

/**
 * Determine position label based on seat index, dealer index, and player count.
 * Standard 6-max positions.
 */
function getPosition(seatIdx, dealerIdx, numPlayers) {
  const offset = (seatIdx - dealerIdx - 1 + numPlayers) % numPlayers;
  if (numPlayers <= 2) return seatIdx === dealerIdx ? 'BTN' : 'BB';
  if (numPlayers === 3) {
    if (offset === 0) return 'SB';
    if (offset === 1) return 'BB';
    return 'BTN';
  }
  // 4-6 players
  const positions6 = ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN'];
  const available = positions6.slice(0, numPlayers);
  return available[offset % available.length] || 'MP';
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function potOddsThreshold(pot, toCall) {
  if (toCall <= 0) return 0;
  return toCall / (pot + toCall);
}

/**
 * Decide a preflop action based on hand tier, position, and action history.
 */
function preflopDecision({ tier, position, toCall, pot, stack, bigBlind, minRaise, currentBet, facingRaise }) {
  const openMax = OPEN_TIER[position] || 3;
  const callMax = CALL_TIER[position] || 3;
  const threebetMax = THREEBET_TIER[position] || 1;

  if (!facingRaise) {
    // Unopened or limped pot — open raise or fold
    if (tier <= openMax) {
      // Premium/strong: sometimes 3x, sometimes 2.5x
      const raiseSize = Math.floor(bigBlind * (tier <= 2 ? 3 : 2.5));
      const amount = Math.max(raiseSize, minRaise + currentBet);
      if (amount >= stack) return { action: 'allin' };
      return { action: 'raise', amount };
    }
    // Marginal hands in late position: limp sometimes
    if (tier <= openMax + 1 && (position === 'BTN' || position === 'SB') && Math.random() < 0.3) {
      if (toCall > 0 && toCall <= bigBlind) return { action: 'call' };
      return { action: 'check' };
    }
    if (toCall <= 0) return { action: 'check' };
    return { action: 'fold' };
  }

  // Facing a raise
  if (tier <= threebetMax) {
    // 3-bet with premiums
    const threebet = Math.floor(currentBet * 3);
    const amount = Math.max(threebet, minRaise + currentBet);
    if (amount >= stack) return { action: 'allin' };
    // Randomize between 3-bet and call for deception
    if (Math.random() < 0.7) return { action: 'raise', amount };
    return { action: 'call' };
  }

  if (tier <= callMax) {
    // Call with decent hands
    const potOdds = potOddsThreshold(pot, toCall);
    if (potOdds > 0.35 && tier > 3) return { action: 'fold' };
    return { action: 'call' };
  }

  // Occasionally defend BB with wider range
  if (position === 'BB' && tier <= 5 && toCall <= bigBlind * 2.5 && Math.random() < 0.4) {
    return { action: 'call' };
  }

  return { action: 'fold' };
}

/**
 * Choose a bet size as a fraction of the pot, influenced by equity and street.
 */
function chooseBetSize(equity, pot, stack, street) {
  let fraction;
  if (equity > 0.75) {
    // Very strong: larger bets
    fraction = street === 'river' ? 0.85 : 0.75;
  } else if (equity > 0.60) {
    fraction = 0.6 + Math.random() * 0.15;
  } else if (equity > 0.45) {
    fraction = 0.33 + Math.random() * 0.17;
  } else {
    // Bluff sizing: small on flop, bigger on later streets
    fraction = street === 'flop' ? 0.33 : 0.5;
  }
  const size = Math.max(1, Math.floor(pot * fraction));
  return Math.min(size, stack);
}

/**
 * Main decision function.
 *
 * ctx: {
 *   heroHole:        [{suit,rank},{suit,rank}]
 *   board:           [{suit,rank}, ...]
 *   pot:             number
 *   toCall:          number (0 if can check)
 *   stack:           number (bot's remaining chips)
 *   opponentsInHand: number (non-folded opponents)
 *   street:          'preflop'|'flop'|'turn'|'river'
 *   bigBlind:        number
 *   minRaise:        number
 *   currentBet:      number
 *   position:        'UTG'|'MP'|'CO'|'BTN'|'SB'|'BB'
 *   seatIdx:         number
 *   dealerIdx:       number
 *   numPlayers:      number
 *   facingRaise:     boolean (whether someone has raised preflop)
 * }
 */
function decideAction(ctx) {
  const {
    heroHole, board, pot, toCall, stack, opponentsInHand,
    street, bigBlind, minRaise, currentBet, facingRaise,
  } = ctx;

  const position = ctx.position || getPosition(ctx.seatIdx, ctx.dealerIdx, ctx.numPlayers);
  const tier = getHandTier(heroHole);

  // ── Preflop: use ranges ─────────────────────────────────────────
  if (street === 'preflop') {
    const decision = preflopDecision({
      tier, position, toCall, pot, stack, bigBlind, minRaise, currentBet,
      facingRaise: facingRaise || (currentBet > bigBlind),
    });
    return sanitize(decision, toCall, stack, minRaise, currentBet, bigBlind);
  }

  // ── Postflop: Monte Carlo equity ────────────────────────────────
  const { equity } = estimateEquity({
    heroHole,
    board,
    opponents: opponentsInHand,
    iters: EQUITY_ITERS,
  });

  const callThresh = potOddsThreshold(pot, toCall);
  const margin = equity - callThresh;
  const bluffChance = BLUFF_FREQ[street] || 0.05;

  // ── Facing a bet ────────────────────────────────────────────────
  if (toCall > 0) {
    if (margin < FOLD_MARGIN) {
      // Below threshold: maybe bluff-raise
      if (Math.random() < bluffChance && stack > toCall * 3) {
        const bluffSize = chooseBetSize(0.35, pot, stack, street);
        const raiseAmount = Math.max(currentBet + minRaise, currentBet + bluffSize);
        if (raiseAmount >= stack) return { action: 'allin' };
        return sanitize({ action: 'raise', amount: raiseAmount }, toCall, stack, minRaise, currentBet, bigBlind);
      }
      return { action: 'fold' };
    }

    if (margin > RAISE_MARGIN) {
      // Strong equity: value raise
      const betSize = chooseBetSize(equity, pot, stack, street);
      const raiseAmount = Math.max(currentBet + minRaise, currentBet + betSize);
      if (raiseAmount >= stack || stack <= toCall * 1.5) return { action: 'allin' };
      return sanitize({ action: 'raise', amount: raiseAmount }, toCall, stack, minRaise, currentBet, bigBlind);
    }

    // Marginal: mostly call
    if (toCall >= stack) return { action: 'allin' };
    return { action: 'call' };
  }

  // ── No bet to us: check or lead ─────────────────────────────────
  if (equity > 0.60) {
    // Strong: value bet, sometimes check-raise
    if (Math.random() < CHECK_RAISE_FREQ) {
      return { action: 'check' };
    }
    const betSize = chooseBetSize(equity, pot, stack, street);
    if (betSize >= stack) return { action: 'allin' };
    const betAmount = currentBet + betSize;
    return sanitize({ action: 'bet', amount: betAmount }, 0, stack, minRaise, currentBet, bigBlind);
  }

  if (equity > 0.42) {
    // Medium: bet sometimes for value/protection
    if (Math.random() < 0.45) {
      const betSize = chooseBetSize(equity, pot, stack, street);
      if (betSize >= stack) return { action: 'allin' };
      return sanitize({ action: 'bet', amount: currentBet + betSize }, 0, stack, minRaise, currentBet, bigBlind);
    }
    return { action: 'check' };
  }

  // Weak: check, occasionally bluff
  if (Math.random() < bluffChance) {
    const bluffSize = chooseBetSize(0.3, pot, stack, street);
    if (bluffSize >= stack) return { action: 'check' };
    return sanitize({ action: 'bet', amount: currentBet + bluffSize }, 0, stack, minRaise, currentBet, bigBlind);
  }

  return { action: 'check' };
}

/**
 * Ensure the action and amount are legal given the game constraints.
 */
function sanitize(decision, toCall, stack, minRaise, currentBet, bigBlind) {
  const { action, amount } = decision;

  if (action === 'fold' || action === 'check' || action === 'call' || action === 'allin') {
    if (action === 'check' && toCall > 0) return { action: 'fold' };
    if (action === 'call' && toCall <= 0) return { action: 'check' };
    return decision;
  }

  if (action === 'bet' || action === 'raise') {
    const minBet = currentBet + (action === 'raise' ? minRaise : bigBlind);
    const target = Math.max(minBet, Math.floor(amount || minBet));
    const toAdd = target - (action === 'raise' ? 0 : 0);
    if (target >= stack + currentBet) return { action: 'allin' };
    if (target < minBet) return { action: toCall > 0 ? 'call' : 'check' };
    return { action: action === 'bet' ? 'raise' : 'raise', amount: target };
  }

  return decision;
}

module.exports = { decideAction, getPosition, getHandTier };
