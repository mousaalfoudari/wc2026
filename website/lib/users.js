'use strict';
const db = require('./db');
const { normName } = require('./util');
const { hashPassword, verifyPassword } = require('./auth');

function findByName(name) {
  return db.prepare('SELECT * FROM users WHERE name_norm = ?').get(normName(name));
}

function findById(id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function createUser(name, password, isAdmin) {
  const trimmed = String(name || '').trim();
  if (trimmed.length < 2) return { ok: false, error: 'الاسم لازم يكون ٢ حروف أو أكثر.' };
  if (String(password || '').length < 4) return { ok: false, error: 'كلمة المرور لازم تكون ٤ خانات أو أكثر.' };
  if (findByName(trimmed)) return { ok: false, error: 'فيه مشترك مسجل بهذا الاسم من قبل، اختر اسم آخر.' };

  const hash = hashPassword(password);
  const r = db
    .prepare('INSERT INTO users (name, name_norm, password_hash, is_admin) VALUES (?, ?, ?, ?)')
    .run(trimmed, normName(trimmed), hash, isAdmin ? 1 : 0);
  return { ok: true, id: r.lastInsertRowid };
}

function checkLogin(name, password) {
  const user = findByName(name);
  if (!user) return { ok: false, error: 'الاسم غير مسجل.' };
  if (!verifyPassword(password, user.password_hash)) return { ok: false, error: 'كلمة المرور غير صحيحة.' };
  return { ok: true, user };
}

function listAll() {
  return db.prepare("SELECT * FROM users WHERE is_admin = 0 ORDER BY created_at ASC").all();
}

function setStatus(id, status) {
  db.prepare('UPDATE users SET status = ?, miss_streak = 0 WHERE id = ?').run(status, id);
}

function resetPassword(id, newPassword) {
  const hash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
}

function listAdmins() {
  return db.prepare("SELECT * FROM users WHERE is_admin = 1 ORDER BY created_at ASC").all();
}

function setAdmin(id, isAdmin) {
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, id);
}

// Permanent delete of a participant account, including every row that
// points at them (predictions, double picks, bonus answers, manual point
// adjustments, jokers they earned). All of these tables declare
// `user_id INTEGER NOT NULL REFERENCES users(id)` in lib/db.js with
// `PRAGMA foreign_keys = ON`, so they must be cleared before the users row
// itself or SQLite throws a foreign key constraint error — hence deleting
// child rows first, wrapped in a transaction so a failure midway rolls back
// instead of leaving the account half-deleted.
//
// jokers.used_against_user_id (the *victim* of a joker someone else holds)
// has no FK constraint, so it wouldn't block this delete either way — but a
// dangling id left behind there would point at a person who no longer
// exists, so it's nulled out rather than left stale. This intentionally
// does NOT delete or touch the *other* user's own adjustments/joker rows —
// computeTotals() in lib/logic.js sums adjustments by user_id, so the
// attacker's earned +5 and the (now-deleted) victim's own -5 row (which gets
// removed along with the rest of their adjustments above) are independent;
// removing this account never changes anyone else's points.
function deleteUser(id) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM predictions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM round_picks WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM bonus_answers WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM adjustments WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM jokers WHERE user_id = ?').run(id);
    db.prepare('UPDATE jokers SET used_against_user_id = NULL WHERE used_against_user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { findByName, findById, createUser, checkLogin, listAll, setStatus, resetPassword, listAdmins, setAdmin, deleteUser };
