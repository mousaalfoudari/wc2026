'use strict';
const { normScorer } = require('./util');

// Multiset intersection count between predicted and actual scorer name lists.
function countScorerMatches(predicted, actual) {
  const remaining = actual.map(normScorer);
  let count = 0;
  for (const raw of predicted) {
    const p = normScorer(raw);
    const idx = remaining.indexOf(p);
    if (idx !== -1) {
      remaining.splice(idx, 1);
      count++;
    }
  }
  return count;
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

module.exports = { countScorerMatches, outcome, gradePrediction };
