'use strict';

function normName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normScorer(s) {
  // Strip Latin diacritics (e.g. "Mbappé" -> "Mbappe") so accent differences
  // between what a participant types and what's officially recorded don't
  // cost them the scorer bonus.
  const deaccented = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return deaccented.trim().replace(/\s+/g, ' ').toLowerCase();
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

// Buffer-preserving body reader (no UTF-8 stringify) — needed for binary
// bodies like multipart/form-data file uploads. maxBytes defaults to the
// same 2MB cap readBody has always used; callers that need more (e.g. image
// uploads) pass a higher explicit cap.
function readBodyBuffer(req, maxBytes) {
  const limit = maxBytes || 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readBody(req) {
  return readBodyBuffer(req, 2 * 1024 * 1024).then((buf) => buf.toString('utf8'));
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
  readBodyBuffer,
  parseFormBody,
  toArray,
  dayKey,
  fmtDateTime,
  nowIso,
  safeJsonParse,
};
