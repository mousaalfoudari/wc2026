'use strict';

function normName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normScorer(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseCookies(req) {
  const header = req.headers['cookie'];
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch (e) {
      out[k] = v;
    }
  });
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseFormBody(raw) {
  const out = {};
  if (!raw) return out;
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const k = idx === -1 ? pair : pair.slice(0, idx);
    const v = idx === -1 ? '' : pair.slice(idx + 1);
    const key = decodeURIComponent(k.replace(/\+/g, ' '));
    const val = decodeURIComponent(v.replace(/\+/g, ' '));
    if (out[key] === undefined) {
      out[key] = val;
    } else if (Array.isArray(out[key])) {
      out[key].push(val);
    } else {
      out[key] = [out[key], val];
    }
  }
  return out;
}

function toArray(v) {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

// "day key" used for double-eligibility grouping (local calendar date of kickoff)
function dayKey(isoDateTime) {
  return String(isoDateTime).slice(0, 10);
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ar-KW', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

module.exports = {
  normName,
  normScorer,
  escapeHtml,
  parseCookies,
  readBody,
  parseFormBody,
  toArray,
  dayKey,
  fmtDateTime,
  nowIso,
  safeJsonParse,
};
