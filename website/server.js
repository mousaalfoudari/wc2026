'use strict';
const http = require('http');
const { URL } = require('url');

const Router = require('./lib/router');
const { parseCookies, readBody, readBodyBuffer, parseFormBody } = require('./lib/util');
const { parseContentType, parseMultipart } = require('./lib/multipart');
const { getUserIdFromCookies } = require('./lib/auth');
const { serveStatic, sendHtml, sendText } = require('./lib/http');
const { layout, redirect } = require('./lib/render');
const users = require('./lib/users');
const logic = require('./lib/logic');
const { seedGroupStage } = require('./lib/seed-schedule');
const { syncLiveResults } = require('./lib/livesync');

const router = new Router();
require('./routes/auth')(router);
require('./routes/predict')(router);
require('./routes/leaderboard')(router);
require('./routes/admin')(router);

const PORT = process.env.PORT || 3000;
// Generous cap for image uploads (lineup photos) — well above what a normal
// phone screenshot/graphic needs, while still bounding memory use per request.
const MULTIPART_MAX_BYTES = 8 * 1024 * 1024;

function ensureAdminAccount() {
  const db = require('./lib/db');
  const count = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get().c;
  if (count > 0) return;
  const crypto = require('crypto');
  const name = process.env.ADMIN_NAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(4).toString('hex');
  const result = users.createUser(name, password, true);
  if (result.ok) {
    console.log('\n========================================');
    console.log(' تم إنشاء حساب أدمن تلقائياً:');
    console.log(' الاسم:        ', name);
    console.log(' كلمة المرور: ', password);
    console.log(' (احفظها الحين - راح تحتاجها لتسجيل الدخول كأدمن)');
    console.log('========================================\n');
  }
}

ensureAdminAccount();

// Auto-load the 72 group-stage matches on first boot (no-op if rounds
// already exist — important since the free-tier DB gets wiped on every
// redeploy/restart, so this needs to re-run itself every time).
try {
  const seedResult = seedGroupStage();
  if (seedResult.ok) {
    console.log(`✔ تم تحميل جدول دور المجموعات أوتوماتيك: ${seedResult.rounds} جولة، ${seedResult.matches} مباراة.`);
  }
} catch (e) {
  console.error('seedGroupStage error:', e);
}

// Live results: check immediately on boot (to catch up on anything already
// finished), then every 10 minutes while the server is awake. Source feed
// updates roughly once a day, so this isn't minute-by-minute live — just
// "no admin typing required".
const LIVESYNC_INTERVAL_MS = 10 * 60 * 1000;
syncLiveResults().catch((e) => console.error('livesync (startup) error:', e));
setInterval(() => {
  syncLiveResults().catch((e) => console.error('livesync (interval) error:', e));
}, LIVESYNC_INTERVAL_MS);

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(u.pathname);

    if (pathname !== '/' && (pathname.startsWith('/style.css') || pathname.startsWith('/app.js') || pathname.startsWith('/favicon') || pathname.startsWith('/banner'))) {
      if (serveStatic(req, res, pathname)) return;
    }

    // Best-effort periodic processing of round locks / miss-streaks.
    try {
      logic.processRoundLocks();
    } catch (e) {
      console.error('processRoundLocks error', e);
    }

    const cookies = parseCookies(req);
    const uid = getUserIdFromCookies(cookies);
    req.user = uid ? users.findById(uid) : null;
    req.cookies = cookies;
    req.flashMsg = u.searchParams.get('msg') || '';
    req.flashType = u.searchParams.get('t') || 'ok';
    req.query = Object.fromEntries(u.searchParams.entries());

    if (req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      if (ct.toLowerCase().includes('multipart/form-data')) {
        const { boundary } = parseContentType(ct);
        const buf = await readBodyBuffer(req, MULTIPART_MAX_BYTES);
        const { fields, files } = parseMultipart(buf, boundary);
        req.body = fields;
        req.files = files;
      } else {
        const raw = await readBody(req);
        req.body = ct.includes('application/json') ? safeJson(raw) : parseFormBody(raw);
        req.files = {};
      }
    } else {
      req.body = {};
      req.files = {};
    }

    const match = router.match(req.method, pathname);

    if (pathname === '/' ) {
      return redirect(res, req.user ? '/predict' : '/login');
    }

    if (!match) {
      sendHtml(res, layout({ title: 'الصفحة غير موجودة', user: req.user, body: notFoundBody() }), 404);
      return;
    }

    req.params = match.params || {};
    await match.handler(req, res, req.params);
  } catch (err) {
    console.error('Request error:', err);
    try {
      if (err && err.message === 'Body too large') {
        sendText(res, 'الملف المرفوع كبير جداً (الحد الأقصى تقريباً ٨ ميجابايت لصور التشكيلة). رجع وارفع ملف أصغر.', 413);
      } else {
        sendText(res, 'حدث خطأ غير متوقع في السيرفر. حاول مرة ثانية.', 500);
      }
    } catch (e) {
      res.end();
    }
  }
});

function safeJson(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}

function notFoundBody() {
  return `<div class="text-center py-16">
    <p class="text-5xl mb-4">🔍</p>
    <h1 class="text-xl font-bold mb-2">الصفحة غير موجودة</h1>
    <a href="/" class="text-emerald-700 font-medium">رجوع للرئيسية</a>
  </div>`;
}

server.listen(PORT, () => {
  console.log(`✔ السيرفر شغال على http://localhost:${PORT}`);
});
