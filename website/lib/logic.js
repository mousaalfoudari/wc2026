'use strict';
const db = require('./db');
const { dayKey, safeJsonParse, nowIso } = require('./util');
const { gradePrediction } = require('./scoring');

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
// pick: the calendar day (kickoff date) they fall on must contain >= 2 matches.
function doubleEligibleMatchIds(roundId) {
  const matches = listMatchesForRound(roundId);
  const byDay = new Map();
  for (const m of matches) {
    const k = dayKey(m.kickoff_at);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(m.id);
  }
  const eligible = new Set();
  for (const ids of byDay.values()) {
    if (ids.length >= 2) ids.forEach((id) => eligible.add(id));
  }
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

  const byMatch = new Map(matches.map((m) => [m.id, []]));
  const predictedUserIds = new Map(matches.map((m) => [m.id, new Set()]));
  for (const r of rows) {
    byMatch.get(r.match_id).push({
      userName: r.user_name,
      predScoreA: r.pred_score_a,
      predScoreB: r.pred_score_b,
      predScorersA: safeJsonParse(r.pred_scorers_a, []),
      predScorersB: safeJsonParse(r.pred_scorers_b, []),
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
  gradeBonus,
  getAvailableJokers,
  useJoker,
  computeTotals,
  leaderboard,
  processRoundLocks,
};
