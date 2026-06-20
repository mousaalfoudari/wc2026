'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_PATH = path.join(__dirname, '..', 'data', 'secret.key');

function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  } catch (e) {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
    return secret;
  }
}

const SECRET = getSecret();
const COOKIE_NAME = 'wc26_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch (e) {
    return false;
  }
}

function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function unsign(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (e) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
}

function makeSessionCookie(userId) {
  const token = sign({ uid: userId, t: Date.now() });
  const maxAge = 60 * 60 * 24 * 120; // 120 days
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

function getUserIdFromCookies(cookies) {
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const data = unsign(token);
  if (!data || !data.uid) return null;
  return data.uid;
}

module.exports = {
  hashPassword,
  verifyPassword,
  makeSessionCookie,
  clearSessionCookie,
  getUserIdFromCookies,
  COOKIE_NAME,
};
