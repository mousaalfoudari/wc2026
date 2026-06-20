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

module.exports = { findByName, findById, createUser, checkLogin, listAll, setStatus, resetPassword };
