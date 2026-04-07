'use strict';

const { estimateEquity } = require('./bot_equity');

// ── Default tuning knobs (overridden by personality) ─────────────────

const EQUITY_ITERS = 3000;

const DEFAULT_PERSONALITY = { aggression: 0.5, tightness: 0.5, bluffFreq: 0.15 };

// ── Preflop hand ranges by position ───────────────────────────────────
// Tiers: 1=premium, 2=strong, 3=playable, 4=marginal, 5=speculative

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

// Position -> max tier allowed (base values, personality adjusts)
const BASE_OPEN_TIER = { UTG: 3, MP: 4, CO: 5, BTN: 6, SB: 5, BB: 6 };
const BASE_CALL_TIER = { UTG: 3, MP: 3, CO: 4, BTN: 5, SB: 4, BB: 5 };
const BASE_THREEBET_TIER = { UTG: 2, MP: 2, CO: 3, BTN: 3, SB: 3, BB: 3 };

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

function getPosition(seatIdx, dealerIdx, numPlayers) {
  const offset = (seatIdx - dealerIdx - 1 + numPlayers) % numPlayers;
  if (numPlayers <= 2) return seatIdx === dealerIdx ? 'BTN' : 'BB';
  if (numPlayers === 3) {
    if (offset === 0) return 'SB';
    if (offset === 1) return 'BB';
    return 'BTN';
  }
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
 * Adjust tier thresholds based on personality.
 * Loose players (low tightness) widen ranges; tight players narrow them.
 */
function adjustedTiers(personality) {
  const { tightness } = personality;
  // tightness 0.0 = very loose (+2 to all tiers), 1.0 = very tight (-1)
  const adj = Math.round((0.5 - tightness) * 3);
  const adjust = (base) => {
    const result = {};
    for (const pos in base) result[pos] = clamp(base[pos] + adj, 1, 7);
    return result;
  };
  return {
    open: adjust(BASE_OPEN_TIER),
    call: adjust(BASE_CALL_TIER),
    threebet: adjust(BASE_THREEBET_TIER),
  };
}

/**
 * Get bluff frequencies scaled by personality.
 */
function bluffFreqs(personality) {
  const scale = personality.bluffFreq / 0.15; // normalized around default 0.15
  return {
    preflop: clamp(0.05 * scale, 0, 0.4),
    flop:    clamp(0.20 * scale, 0, 0.6),
    turn:    clamp(0.15 * scale, 0, 0.5),
    river:   clamp(0.10 * scale, 0, 0.4),
  };
}

/**
 * Preflop decision influenced by personality.
 */
function preflopDecision({ tier, position, toCall, pot, stack, bigBlind, minRaise, currentBet, facingRaise, personality }) {
  const tiers = adjustedTiers(personality);
  const { aggression } = personality;

  const openMax = tiers.open[position] || 3;
  const callMax = tiers.call[position] || 3;
  const threebetMax = tiers.threebet[position] || 1;

  if (!facingRaise) {
    if (tier <= openMax) {
      // Aggressive players size bigger; passive players limp more
      const sizeMultiplier = 2 + aggression * 2; // 2x (passive) to 4x (maniac)
      const raiseSize = Math.floor(bigBlind * sizeMultiplier);
      const amount = Math.max(raiseSize, minRaise + currentBet);
      // Passive players sometimes just limp premium-ish hands
      if (aggression < 0.3 && tier >= 3 && Math.random() < 0.4) {
        if (toCall > 0 && toCall <= bigBlind) return { action: 'call' };
        return { action: 'check' };
      }
      if (amount >= stack) return { action: 'allin' };
      return { action: 'raise', amount };
    }
    // Marginal hands: loose/aggressive players limp or raise more
    if (tier <= openMax + 1 && (position === 'BTN' || position === 'SB')) {
      const limpChance = 0.15 + (1 - personality.tightness) * 0.35;
      if (Math.random() < limpChance) {
        if (aggression > 0.6 && Math.random() < 0.4) {
          const raiseSize = Math.floor(bigBlind * (2 + aggression));
          const amount = Math.max(raiseSize, minRaise + currentBet);
          if (amount >= stack) return { action: 'allin' };
          return { action: 'raise', amount };
        }
        if (toCall > 0 && toCall <= bigBlind) return { action: 'call' };
        return { action: 'check' };
      }
    }
    if (toCall <= 0) return { action: 'check' };
    return { action: 'fold' };
  }

  // Facing a raise
  if (tier <= threebetMax) {
    const threebet = Math.floor(currentBet * (2.5 + aggression));
    const amount = Math.max(threebet, minRaise + currentBet);
    if (amount >= stack) return { action: 'allin' };
    // Aggressive players 3-bet more; passive trap with calls
    const threebetChance = 0.4 + aggression * 0.4;
    if (Math.random() < threebetChance) return { action: 'raise', amount };
    return { action: 'call' };
  }

  if (tier <= callMax) {
    const potOdds = potOddsThreshold(pot, toCall);
    if (potOdds > 0.45 && tier > 4) return { action: 'fold' };
    return { action: 'call' };
  }

  // Defend BB
  if (position === 'BB' && tier <= 6 && toCall <= bigBlind * 3) {
    const defendChance = 0.4 + (1 - personality.tightness) * 0.4;
    if (Math.random() < defendChance) return { action: 'call' };
  }

  // Speculative calls with loose players
  if (tier <= 6 && toCall <= bigBlind * 2) {
    const specCallChance = 0.1 + (1 - personality.tightness) * 0.35;
    if (Math.random() < specCallChance) return { action: 'call' };
  }

  return { action: 'fold' };
}

/**
 * Choose bet size influenced by aggression.
 * Aggressive players bet bigger; passive players bet smaller.
 */
function chooseBetSize(equity, pot, stack, street, aggression) {
  let fraction;
  if (equity > 0.75) {
    fraction = (street === 'river' ? 0.65 : 0.55) + aggression * 0.4;
  } else if (equity > 0.60) {
    fraction = 0.4 + aggression * 0.35 + Math.random() * 0.15;
  } else if (equity > 0.45) {
    fraction = 0.2 + aggression * 0.25 + Math.random() * 0.15;
  } else {
    // Bluff sizing: maniacs overbet, passive players make small stabs
    fraction = 0.2 + aggression * 0.4;
  }
  const size = Math.max(1, Math.floor(pot * fraction));
  return Math.min(size, stack);
}

/**
 * Main decision function.
 */
function decideAction(ctx) {
  const {
    heroHole, board, pot, toCall, stack, opponentsInHand,
    street, bigBlind, minRaise, currentBet, facingRaise,
  } = ctx;

  const personality = ctx.personality || DEFAULT_PERSONALITY;
  const { aggression } = personality;
  const position = ctx.position || getPosition(ctx.seatIdx, ctx.dealerIdx, ctx.numPlayers);
  const tier = getHandTier(heroHole);
  const bfreqs = bluffFreqs(personality);

  // Fold margin: aggressive players call wider, tight players fold more
  const foldMargin = -0.10 - (1 - aggression) * 0.20; // -0.10 (maniac) to -0.30 (nit)
  // Raise margin: aggressive players raise thinner
  const raiseMargin = 0.15 - aggression * 0.12; // 0.03 (maniac) to 0.15 (passive)
  // Check-raise frequency
  const checkRaiseFreq = 0.08 + aggression * 0.25; // 0.08 (passive) to 0.33 (maniac)

  // ── Preflop: use ranges ─────────────────────────────────────────
  if (street === 'preflop') {
    const decision = preflopDecision({
      tier, position, toCall, pot, stack, bigBlind, minRaise, currentBet,
      facingRaise: facingRaise || (currentBet > bigBlind),
      personality,
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
  const bluffChance = bfreqs[street] || 0.05;

  // ── Facing a bet ────────────────────────────────────────────────
  if (toCall > 0) {
    if (margin < foldMargin) {
      // Below threshold: maybe bluff-raise (maniacs do this a lot)
      if (Math.random() < bluffChance && stack > toCall * 3) {
        const bluffSize = chooseBetSize(0.35, pot, stack, street, aggression);
        const raiseAmount = Math.max(currentBet + minRaise, currentBet + bluffSize);
        if (raiseAmount >= stack) return { action: 'allin' };
        return sanitize({ action: 'raise', amount: raiseAmount }, toCall, stack, minRaise, currentBet, bigBlind);
      }
      return { action: 'fold' };
    }

    if (margin > raiseMargin) {
      // Strong equity: value raise
      const betSize = chooseBetSize(equity, pot, stack, street, aggression);
      const raiseAmount = Math.max(currentBet + minRaise, currentBet + betSize);
      if (raiseAmount >= stack || stack <= toCall * 1.5) return { action: 'allin' };
      return sanitize({ action: 'raise', amount: raiseAmount }, toCall, stack, minRaise, currentBet, bigBlind);
    }

    // Marginal: mostly call, but aggressive players sometimes raise
    if (aggression > 0.65 && Math.random() < (aggression - 0.5) * 0.6) {
      const betSize = chooseBetSize(equity, pot, stack, street, aggression);
      const raiseAmount = Math.max(currentBet + minRaise, currentBet + betSize);
      if (raiseAmount >= stack) return { action: 'allin' };
      return sanitize({ action: 'raise', amount: raiseAmount }, toCall, stack, minRaise, currentBet, bigBlind);
    }
    if (toCall >= stack) return { action: 'allin' };
    return { action: 'call' };
  }

  // ── No bet to us: check or lead ─────────────────────────────────
  if (equity > 0.60) {
    // Strong: value bet, sometimes check-raise (more often if aggressive)
    if (Math.random() < checkRaiseFreq) {
      return { action: 'check' };
    }
    const betSize = chooseBetSize(equity, pot, stack, street, aggression);
    if (betSize >= stack) return { action: 'allin' };
    const betAmount = currentBet + betSize;
    return sanitize({ action: 'bet', amount: betAmount }, 0, stack, minRaise, currentBet, bigBlind);
  }

  if (equity > 0.35) {
    // Medium: bet frequency scales with aggression
    const betChance = 0.3 + aggression * 0.4; // 0.3 (passive) to 0.7 (maniac)
    if (Math.random() < betChance) {
      const betSize = chooseBetSize(equity, pot, stack, street, aggression);
      if (betSize >= stack) return { action: 'allin' };
      return sanitize({ action: 'bet', amount: currentBet + betSize }, 0, stack, minRaise, currentBet, bigBlind);
    }
    return { action: 'check' };
  }

  // Weak: check, occasionally bluff
  if (Math.random() < bluffChance) {
    const bluffSize = chooseBetSize(0.3, pot, stack, street, aggression);
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
    if (target >= stack + currentBet) return { action: 'allin' };
    if (target < minBet) return { action: toCall > 0 ? 'call' : 'check' };
    return { action: 'raise', amount: target };
  }

  return decision;
}

module.exports = { decideAction, getPosition, getHandTier };
