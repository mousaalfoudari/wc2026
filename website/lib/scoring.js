'use strict';
const { resolveScorerKey } = require('./scorer-aliases');

// Multiset intersection count between predicted and actual scorer name lists.
// Names are resolved through the alias dictionary first (lib/scorer-aliases.js)
// so e.g. a participant writing "ميسي" still matches an official record of
// "Lionel Messi" for any player we recognize; unrecognized players fall back
// to plain normalized-text matching, same as before.
function countScorerMatches(predicted, actual) {
  const remaining = actual.map(resolveScorerKey);
  let count = 0;
  for (const raw of predicted) {
    const p = resolveScorerKey(raw);
    const idx = remaining.indexOf(p);
    if (idx !== -1) {
      remaining.splice(idx, 1);
      count++;
    }
  }
  return count;
}

// Same multiset matching as countScorerMatches, but returns a per-name
// true/false flag (same order/length as `predicted`) instead of just a
// total — used by the admin "كل التوقعات" page to show which predicted
// scorer names already matched automatically, so the admin only needs to
// manually credit the ones that didn't.
function scorerMatchFlags(predicted, actual) {
  const remaining = actual.map(resolveScorerKey);
  return predicted.map((raw) => {
    const p = resolveScorerKey(raw);
    const idx = remaining.indexOf(p);
    if (idx !== -1) {
      remaining.splice(idx, 1);
      return true;
    }
    return false;
  });
}

function outcome(scoreA, scoreB) {
  if (scoreA > scoreB) return 'A';
  if (scoreA < scoreB) return 'B';
  return 'D';
}

/**
 * Grade a single prediction against the final result.
 * Returns { points, perfect, scorerPoints, basePoints }
 */
function gradePrediction(pred, finalA, finalB, finalScorersA, finalScorersB, isDouble) {
  const exact = pred.pred_score_a === finalA && pred.pred_score_b === finalB;
  const outcomeMatch = outcome(pred.pred_score_a, pred.pred_score_b) === outcome(finalA, finalB);

  let basePoints = 0;
  if (exact) basePoints = 7;
  else if (outcomeMatch) basePoints = 3;

  let scorerPoints = 0;
  let perfect = false;
  if (exact) {
    const matchedA = countScorerMatches(pred.pred_scorers_a, finalScorersA);
    const matchedB = countScorerMatches(pred.pred_scorers_b, finalScorersB);
    scorerPoints = (matchedA + matchedB) * 2;
    perfect =
      matchedA === finalScorersA.length &&
      matchedB === finalScorersB.length &&
      pred.pred_scorers_a.length === finalScorersA.length &&
      pred.pred_scorers_b.length === finalScorersB.length;
  }

  let points = basePoints + scorerPoints;
  if (isDouble) points *= 2;

  return { points, perfect, scorerPoints, basePoints };
}

module.exports = { countScorerMatches, scorerMatchFlags, outcome, gradePrediction };
