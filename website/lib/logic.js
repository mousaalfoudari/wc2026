'use strict';
const db = require('./db');
const { safeJsonParse, nowIso } = require('./util');
const { gradePrediction, scorerMatchFlags } = require('./scoring');

// ---------- Rounds & matches ----------

function listRounds() {
  const rounds = db.prepare('SELECT * FROM rounds ORDER BY order_index ASC, id ASC').all();
  return rounds.map(attachRoundMeta);
}

function getRound(roundId) {
  const r = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
  return r ? attachRoundMeta(r) : null;
}

function attachRoundMeta(round) {
  const matches = listMatchesForRound(round.id);
  const lockTime = matches.length ? matches.reduce((min, m) => (m.kickoff_at < min ? m.kickoff_at : min), matches[0].kickoff_at) : null;
  const locked = lockTime ? new Date(lockTime).getTime() <= Date.now() : false;
  return {
    ...round,
    bonus_options: safeJsonParse(round.bonus_options, []),
    matches,
    lock_time: lockTime,
    locked,
  };
}

function listMatchesForRound(roundId) {
  return db.prepare('SELECT * FROM matches WHERE round_id = ? ORDER BY kickoff_at ASC, id ASC').all(roundId);
}

function getMatch(matchId) {
  return db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
}

function createRound({ name, stage, orderIndex }) {
  const r = db
    .prepare('INSERT INTO rounds (name, stage, order_index) VALUES (?, ?, ?)')
    .run(name, stage || null, orderIndex);
  return r.lastInsertRowid;
}

function updateRoundBonus(roundId, { question, options, correctIndex }) {
  db.prepare(
    'UPDATE rounds SET bonus_question = ?, bonus_options = ?, bonus_correct_index = ?, bonus_graded = 0 WHERE id = ?'
  ).run(question || null, JSON.stringify(options || []), correctIndex == null ? null : correctIndex, roundId);
}

function addMatch(roundId, teamA, teamB, kickoffAt) {
  const r = db
    .prepare('INSERT INTO matches (round_id, team_a, team_b, kickoff_at) VALUES (?, ?, ?, ?)')
    .run(roundId, teamA, teamB, kickoffAt);
  return r.lastInsertRowid;
}

// Returns set of match ids within `roundId` that are eligible for the "double"
// pick: any match in the round, as long as the round has 2+ matches total.
// (Previously restricted to same calendar day, but matches just after
// midnight were getting counted as the next day, splitting rounds unfairly.)
function doubleEligibleMatchIds(roundId) {
  const matches = listMatchesForRound(roundId);
  const eligible = new Set();
  if (matches.length >= 2) matches.forEach((m) => eligible.add(m.id));
  return eligible;
}

// ---------- Predictions ----------

function getUserPrediction(userId, matchId) {
  return db.prepare('SELECT * FROM predictions WHERE user_id = ? AND match_id = ?').get(userId, matchId);
}

function getUserPredictionsForRound(userId, roundId) {
  const matches = listMatchesForRound(roundId);
  const ids = matches.map((m) => m.id);
  if (!ids.length) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM predictions WHERE user_id = ? AND match_id IN (${placeholders})`)
    .all(userId, ...ids);
  const map = {};
  rows.forEach((r) => (map[r.match_id] = r));
  return map;
}

function submitPrediction(userId, matchId, scoreA, scoreB, scorersA, scorersB) {
  db.prepare(
    `INSERT INTO predictions (user_id, match_id, pred_score_a, pred_score_b, pred_scorers_a, pred_scorers_b)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, matchId, scoreA, scoreB, JSON.stringify(scorersA), JSON.stringify(scorersB));
}

function getRoundPick(userId, roundId) {
  return db.prepare('SELECT * FROM round_picks WHERE user_id = ? AND round_id = ?').get(userId, roundId);
}

function setDoublePick(userId, roundId, matchId) {
  const existing = getRoundPick(userId, roundId);
  if (existing) {
    db.prepare('UPDATE round_picks SET double_match_id = ? WHERE id = ?').run(matchId, existing.id);
  } else {
    db.prepare('INSERT INTO round_picks (user_id, round_id, double_match_id) VALUES (?, ?, ?)').run(
      userId,
      roundId,
      matchId
    );
  }
}

function getBonusAnswer(userId, roundId) {
  return db.prepare('SELECT * FROM bonus_answers WHERE user_id = ? AND round_id = ?').get(userId, roundId);
}

function submitBonusAnswer(userId, roundId, choiceIndex) {
  const existing = getBonusAnswer(userId, roundId);
  if (existing) return false;
  db.prepare('INSERT INTO bonus_answers (user_id, round_id, choice_index) VALUES (?, ?, ?)').run(
    userId,
    roundId,
    choiceIndex
  );
  return true;
}

// Full per-match prediction breakdown for the admin: every user's predicted
// score/scorers for each match in the round, plus the names of users who
// haven't predicted that match yet. Visible regardless of lock status.
function getRoundPredictionsByMatch(roundId) {
  const matches = listMatchesForRound(roundId);
  if (!matches.length) return [];

  const allUsers = db.prepare("SELECT id, name FROM users WHERE is_admin = 0 ORDER BY name COLLATE NOCASE ASC").all();
  const matchIds = matches.map((m) => m.id);
  const placeholders = matchIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT p.*, u.name as user_name FROM predictions p JOIN users u ON u.id = p.user_id WHERE p.match_id IN (${placeholders})`
    )
    .all(...matchIds);

  const matchById = new Map(matches.map((m) => [m.id, m]));
  const byMatch = new Map(matches.map((m) => [m.id, []]));
  const predictedUserIds = new Map(matches.map((m) => [m.id, new Set()]));
  for (const r of rows) {
    const match = matchById.get(r.match_id);
    const predScorersA = safeJsonParse(r.pred_scorers_a, []);
    const predScorersB = safeJsonParse(r.pred_scorers_b, []);
    // Scorer bonus only ever applies when the score prediction is an exact
    // match (see gradePrediction in lib/scoring.js) — so the manual
    // "احسبه صحيح" correction button should only be offered in that case.
    const exactScore = !!match.graded && r.pred_score_a === match.final_score_a && r.pred_score_b === match.final_score_b;
    let scorerMatchA = [];
    let scorerMatchB = [];
    if (match.graded) {
      const finalScorersA = safeJsonParse(match.final_scorers_a, []);
      const finalScorersB = safeJsonParse(match.final_scorers_b, []);
      scorerMatchA = scorerMatchFlags(predScorersA, finalScorersA);
      scorerMatchB = scorerMatchFlags(predScorersB, finalScorersB);
    }
    byMatch.get(r.match_id).push({
      id: r.id,
      userName: r.user_name,
      predScoreA: r.pred_score_a,
      predScoreB: r.pred_score_b,
      predScorersA,
      predScorersB,
      scorerMatchA,
      scorerMatchB,
      canCreditScorer: exactScore,
      isDouble: !!r.is_double,
      pointsEarned: r.points_earned,
    });
    predictedUserIds.get(r.match_id).add(r.user_id);
  }

  return matches.map((m) => {
    const predicted = byMatch.get(m.id).sort((a, b) => a.userName.localeCompare(b.userName, 'ar'));
    const predictedIds = predictedUserIds.get(m.id);
    const missing = allUsers.filter((u) => !predictedIds.has(u.id)).map((u) => u.name);
    return { match: m, predictions: predicted, missing };
  });
}

// ---------- Grading ----------

function gradeMatch(matchId, finalA, finalB, scorersA, scorersB) {
  const match = getMatch(matchId);
  if (!match) throw new Error('Match not found');

  db.prepare(
    `UPDATE matches SET status='finished', final_score_a=?, final_score_b=?, final_scorers_a=?, final_scorers_b=?, graded=1 WHERE id=?`
  ).run(finalA, finalB, JSON.stringify(scorersA), JSON.stringify(scorersB), matchId);

  const preds = db.prepare('SELECT * FROM predictions WHERE match_id = ?').all(matchId);

  for (const row of preds) {
    const pick = getRoundPick(row.user_id, match.round_id);
    const isDouble = !!(pick && pick.double_match_id === matchId);
    const pred = {
      pred_score_a: row.pred_score_a,
      pred_score_b: row.pred_score_b,
      pred_scorers_a: safeJsonParse(row.pred_scorers_a, []),
      pred_scorers_b: safeJsonParse(row.pred_scorers_b, []),
    };
    const result = gradePrediction(pred, finalA, finalB, scorersA, scorersB, isDouble);

    db.prepare('UPDATE predictions SET points_earned = ?, is_double = ?, perfect = ? WHERE id = ?').run(
      result.points,
      isDouble ? 1 : 0,
      result.perfect ? 1 : 0,
      row.id
    );

    if (result.perfect) {
      const already = db
        .prepare('SELECT id FROM jokers WHERE user_id = ? AND earned_match_id = ?')
        .get(row.user_id, matchId);
      if (!already) {
        db.prepare(
          'INSERT INTO jokers (user_id, earned_match_id, earned_round_id, status) VALUES (?, ?, ?, ?)'
        ).run(row.user_id, matchId, match.round_id, 'available');
      }
    }
  }
}

// Reverts a graded match back to "not played yet" — for when the admin
// entered a result by mistake or just to test, before the match actually
// happened. Clears the final score/scorers and un-grades every prediction
// for that match (points_earned/is_double/perfect reset), so participants
// can be graded again normally once the real result comes in.
function ungradeMatch(matchId) {
  const match = getMatch(matchId);
  if (!match) return { ok: false, error: 'المباراة غير موجودة.' };
  if (!match.graded) return { ok: false, error: 'هذي المباراة لسا ما انحسبت نتيجتها أصلاً.' };

  db.prepare(
    `UPDATE matches SET status='scheduled', final_score_a=NULL, final_score_b=NULL, final_scorers_a=NULL, final_scorers_b=NULL, graded=0 WHERE id=?`
  ).run(matchId);

  db.prepare('UPDATE predictions SET points_earned = NULL, is_double = 0, perfect = 0 WHERE match_id = ?').run(matchId);

  // Jokers earned from this match's grading: safe to remove if still unused.
  // One already 'used' already moved points off another participant via the
  // adjustments table — auto-reverting that silently would be misleading, so
  // we leave it and just flag it for the admin to check manually.
  const usedCount = db
    .prepare("SELECT COUNT(*) as c FROM jokers WHERE earned_match_id = ? AND status != 'available'")
    .get(matchId).c;
  db.prepare("DELETE FROM jokers WHERE earned_match_id = ? AND status = 'available'").run(matchId);

  return { ok: true, roundId: match.round_id, usedJokerWarning: usedCount > 0 };
}

function gradeBonus(roundId, correctIndex) {
  db.prepare('UPDATE rounds SET bonus_correct_index = ?, bonus_graded = 1 WHERE id = ?').run(correctIndex, roundId);
  const answers = db.prepare('SELECT * FROM bonus_answers WHERE round_id = ?').all(roundId);
  for (const a of answers) {
    const pts = a.choice_index === correctIndex ? 7 : -7;
    db.prepare('UPDATE bonus_answers SET points = ? WHERE id = ?').run(pts, a.id);
  }
}

// ---------- Jokers ----------

function getAvailableJokers(userId) {
  return db
    .prepare("SELECT * FROM jokers WHERE user_id = ? AND status = 'available' ORDER BY id ASC")
    .all(userId);
}

function useJoker(jokerId, userId, targetUserId) {
  const joker = db.prepare('SELECT * FROM jokers WHERE id = ? AND user_id = ?').get(jokerId, userId);
  if (!joker || joker.status !== 'available') return { ok: false, error: 'الجوكر غير متاح.' };
  if (targetUserId === userId) return { ok: false, error: 'لا يمكنك استخدام الجوكر على نفسك.' };

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
  if (!target) return { ok: false, error: 'اللاعب غير موجود.' };

  const totals = computeTotals();
  const targetTotal = totals[targetUserId] || 0;
  if (targetTotal < 5) return { ok: false, error: 'هذا اللاعب عنده أقل من ٥ نقاط، لا يمكن أخذ الجوكر منه.' };

  db.prepare('INSERT INTO adjustments (user_id, round_id, delta, reason) VALUES (?, ?, ?, ?)').run(
    targetUserId,
    joker.earned_round_id,
    -5,
    `جوكر مستخدم ضدك من قبل لاعب آخر`
  );
  db.prepare('INSERT INTO adjustments (user_id, round_id, delta, reason) VALUES (?, ?, ?, ?)').run(
    userId,
    joker.earned_round_id,
    5,
    `استخدام الجوكر`
  );
  db.prepare("UPDATE jokers SET status='used', used_against_user_id=?, used_at=? WHERE id=?").run(
    targetUserId,
    nowIso(),
    jokerId
  );
  return { ok: true };
}

// ---------- Totals / leaderboard ----------

function computeTotals() {
  const totals = {};
  db.prepare('SELECT id FROM users').all().forEach((u) => (totals[u.id] = 0));

  db.prepare('SELECT user_id, SUM(points_earned) as s FROM predictions WHERE points_earned IS NOT NULL GROUP BY user_id')
    .all()
    .forEach((row) => {
      totals[row.user_id] = (totals[row.user_id] || 0) + row.s;
    });

  db.prepare('SELECT user_id, SUM(points) as s FROM bonus_answers WHERE points IS NOT NULL GROUP BY user_id')
    .all()
    .forEach((row) => {
      totals[row.user_id] = (totals[row.user_id] || 0) + row.s;
    });

  db.prepare('SELECT user_id, SUM(delta) as s FROM adjustments GROUP BY user_id')
    .all()
    .forEach((row) => {
      totals[row.user_id] = (totals[row.user_id] || 0) + row.s;
    });

  return totals;
}

function leaderboard() {
  const users = db.prepare("SELECT * FROM users WHERE is_admin = 0 ORDER BY name COLLATE NOCASE ASC").all();
  const totals = computeTotals();
  return users
    .map((u) => ({ ...u, total: totals[u.id] || 0 }))
    .sort((a, b) => b.total - a.total);
}

// Manual point adjustments — used by the admin to credit/debit points outside
// match grading (e.g. points a participant already earned before the
// competition started being tracked on the site). Stored as a delta + reason
// in the existing `adjustments` table; computeTotals() already folds these
// into each user's total, so the leaderboard re-sorts itself automatically.
function addAdjustment(userId, delta, reason) {
  db.prepare('INSERT INTO adjustments (user_id, delta, reason) VALUES (?, ?, ?)').run(userId, delta, reason || 'تعديل يدوي');
}

function manualPointsByUser() {
  const out = {};
  db.prepare('SELECT user_id, SUM(delta) as s FROM adjustments GROUP BY user_id')
    .all()
    .forEach((row) => {
      out[row.user_id] = row.s;
    });
  return out;
}

// Manual scorer-name correction: the admin looked at a prediction whose
// scorer name didn't auto-match (e.g. a spelling/alias our dictionary
// doesn't cover yet) and confirmed it's actually correct. Credits the same
// +2 (or +4 if it was the participant's "double" pick) directly onto that
// prediction's points_earned — not via the `adjustments` table — so the
// per-match breakdown on the admin predictions page and the leaderboard
// total both stay consistent with a single source of truth.
function creditManualScorer(predictionId) {
  const pred = db.prepare('SELECT * FROM predictions WHERE id = ?').get(predictionId);
  if (!pred) return { ok: false, error: 'التوقع غير موجود.' };
  if (pred.points_earned == null) return { ok: false, error: 'هذي المباراة لسا ما تصحّحت.' };

  const match = getMatch(pred.match_id);
  if (!match) return { ok: false, error: 'المباراة غير موجودة.' };

  const exact = pred.pred_score_a === match.final_score_a && pred.pred_score_b === match.final_score_b;
  if (!exact) return { ok: false, error: 'توقع النتيجة ما طابق بالضبط، فمكافأة الهداف ما تنطبق على هذا التوقع.' };

  const delta = pred.is_double ? 4 : 2;
  db.prepare('UPDATE predictions SET points_earned = points_earned + ? WHERE id = ?').run(delta, predictionId);

  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(pred.user_id);
  return { ok: true, delta, roundId: match.round_id, userName: user ? user.name : '' };
}

// Admin override to remove a prediction entirely (e.g. a test/mistaken
// submission). Works whether the match is graded or not — since totals are
// always computed live via SUM() over the predictions table, deleting the
// row automatically removes any points it had contributed too.
function deletePrediction(predictionId) {
  const pred = db.prepare('SELECT * FROM predictions WHERE id = ?').get(predictionId);
  if (!pred) return { ok: false, error: 'التوقع غير موجود.' };

  const match = getMatch(pred.match_id);
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(pred.user_id);

  db.prepare('DELETE FROM predictions WHERE id = ?').run(predictionId);

  return { ok: true, roundId: match ? match.round_id : null, userName: user ? user.name : '' };
}

// ---------- Miss-streak processing ----------

function processRoundLocks() {
  const now = nowIso();
  const rounds = listRounds().filter((r) => r.processed === 0 && r.matches.length > 0 && r.locked);

  for (const round of rounds) {
    const matchIds = round.matches.map((m) => m.id);
    const placeholders = matchIds.map(() => '?').join(',');
    const participants = new Set(
      db
        .prepare(`SELECT DISTINCT user_id FROM predictions WHERE match_id IN (${placeholders})`)
        .all(...matchIds)
        .map((r) => r.user_id)
    );

    const users = db.prepare("SELECT * FROM users WHERE is_admin = 0").all();
    for (const u of users) {
      if (participants.has(u.id)) {
        if (u.miss_streak !== 0) {
          db.prepare('UPDATE users SET miss_streak = 0 WHERE id = ?').run(u.id);
        }
      } else {
        const newStreak = u.miss_streak + 1;
        const newStatus = newStreak >= 3 ? 'frozen' : u.status;
        db.prepare('UPDATE users SET miss_streak = ?, status = ? WHERE id = ?').run(newStreak, newStatus, u.id);
      }
    }

    // Expire jokers earned in earlier rounds that are still unused once this round locks.
    db.prepare(
      `UPDATE jokers SET status='expired'
       WHERE status='available' AND earned_round_id IN (
         SELECT id FROM rounds WHERE order_index < ?
       )`
    ).run(round.order_index);

    db.prepare('UPDATE rounds SET processed = 1 WHERE id = ?').run(round.id);
  }
}

// ---------- Team rosters (scorer dropdown) ----------

// Every distinct team name seen across the schedule, alphabetically sorted —
// used by the admin rosters page so the admin can see/curate every team,
// not just ones they've already added a roster for.
function listTeamNames() {
  const rows = db.prepare('SELECT team_a AS name FROM matches UNION SELECT team_b AS name FROM matches').all();
  return rows.map((r) => r.name).sort((a, b) => a.localeCompare(b, 'ar'));
}

function getRoster(teamName) {
  const row = db.prepare('SELECT players FROM team_rosters WHERE team_name = ?').get(teamName);
  return row ? safeJsonParse(row.players, []) : [];
}

// teamName -> players[] for every team that currently has a roster saved.
function listRosters() {
  const rows = db.prepare('SELECT team_name, players FROM team_rosters').all();
  const map = {};
  for (const r of rows) map[r.team_name] = safeJsonParse(r.players, []);
  return map;
}

function setRoster(teamName, players) {
  const json = JSON.stringify(players);
  db.prepare(
    `INSERT INTO team_rosters (team_name, players, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(team_name) DO UPDATE SET players = excluded.players, updated_at = excluded.updated_at`
  ).run(teamName, json);
}

module.exports = {
  listRounds,
  getRound,
  listMatchesForRound,
  getMatch,
  createRound,
  updateRoundBonus,
  addMatch,
  doubleEligibleMatchIds,
  getUserPrediction,
  getUserPredictionsForRound,
  getRoundPredictionsByMatch,
  submitPrediction,
  getRoundPick,
  setDoublePick,
  getBonusAnswer,
  submitBonusAnswer,
  gradeMatch,
  ungradeMatch,
  gradeBonus,
  getAvailableJokers,
  useJoker,
  computeTotals,
  leaderboard,
  addAdjustment,
  manualPointsByUser,
  creditManualScorer,
  deletePrediction,
  processRoundLocks,
  listTeamNames,
  getRoster,
  listRosters,
  setRoster,
};
