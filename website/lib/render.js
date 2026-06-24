'use strict';
const { escapeHtml } = require('./util');

function layout({ title, user, body, msg, msgType, active }) {
  const nav = navHtml(user, active);
  const flash = msg
    ? `<div class="max-w-3xl mx-auto mt-4 px-4">
         <div class="rounded-lg px-4 py-3 text-sm font-medium ${
           msgType === 'error'
             ? 'bg-red-50 text-red-700 border border-red-200'
             : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
         }">${escapeHtml(msg)}</div>
       </div>`
    : '';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title || 'مسابقة توقعات كأس العالم 2026')}</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="/style.css" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap" rel="stylesheet">
</head>
<body class="bg-slate-50 min-h-screen font-arabic text-slate-800">
${bannerHtml()}
${nav}
${flash}
<main class="max-w-3xl mx-auto px-4 py-6">
${body}
</main>
<footer class="text-center text-xs text-slate-400 py-8">مسابقة توقعات كأس العالم 2026 ⚽</footer>
<script src="/app.js"></script>
</body>
</html>`;
}

// Top-of-every-page banner strip — shows the tournament poster (logo,
// trophy, ball, tagline) so the site has some visual identity beyond plain
// text/tables, instead of only appearing on the login/register card like
// before. Same crop (aspect-ratio + object-position: top center) the
// login/register card already used, just full-width across every page now.
function bannerHtml() {
  return `<div class="max-w-3xl mx-auto px-4 pt-3">
    <div class="w-full rounded-xl shadow-sm overflow-hidden" style="aspect-ratio: 700 / 380;">
      <img src="/banner.jpg" alt="مسابقة توقعات كأس العالم 2026" style="width: 100%; height: 100%; object-fit: cover; object-position: top center;" />
    </div>
  </div>`;
}

function navHtml(user, active) {
  const link = (href, label, key) =>
    `<a href="${href}" class="px-3 py-2 rounded-md text-sm font-medium ${
      active === key ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
    }">${label}</a>`;

  if (!user) {
    return `<header class="bg-white border-b border-slate-200">
      <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
        <span class="font-bold text-emerald-700">⚽ توقعات كأس العالم 2026</span>
        <nav class="flex gap-1">
          ${link('/login', 'تسجيل الدخول', 'login')}
          ${link('/register', 'مشترك جديد', 'register')}
        </nav>
      </div>
    </header>`;
  }

  const adminLink = user.is_admin ? link('/admin', 'لوحة الأدمن', 'admin') : '';
  const frozenBadge = user.status === 'frozen'
    ? '<span class="bg-rose-100 text-rose-700 text-xs px-2 py-1 rounded-full mr-2">مجمّد ❄️</span>'
    : '';

  return `<header class="bg-white border-b border-slate-200">
    <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-2">
      <span class="font-bold text-emerald-700">⚽ توقعات كأس العالم 2026</span>
      <nav class="flex gap-1 flex-wrap items-center">
        ${link('/predict', 'توقعاتي', 'predict')}
        ${link('/leaderboard', 'الترتيب', 'leaderboard')}
        ${adminLink}
        ${frozenBadge}
        <span class="text-sm text-slate-500 px-2">${escapeHtml(user.name)}</span>
        <a href="/logout" class="px-3 py-2 rounded-md text-sm font-medium text-slate-500 hover:bg-slate-100">خروج</a>
      </nav>
    </div>
  </header>`;
}

// A prominent live countdown card showing the time left until a round's
// deadline (the kickoff of its earliest match — the same moment
// `round.locked` flips to true). Rendered once server-side with the
// deadline in `data-countdown`; public/app.js ticks the big clock display
// (days + HH:MM:SS) client-side every second so it stays accurate without a
// page refresh. Returns '' once the round is already locked (or has no
// matches yet), since there's nothing to count down to.
function lockCountdownHtml(round) {
  if (!round || round.locked || !round.lock_time) return '';
  return `<div data-countdown="${round.lock_time}" class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-3 text-center">
    <div class="text-xs text-amber-700 font-medium mb-1">⏳ الوقت المتبقي لقفل الجولة</div>
    <div class="countdown-display text-3xl font-extrabold text-amber-800 tabular-nums tracking-wider">--:--:--</div>
  </div>`;
}

function redirect(res, location, msg, msgType) {
  let url = location;
  if (msg) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}msg=${encodeURIComponent(msg)}&t=${msgType || 'ok'}`;
  }
  res.writeHead(302, { Location: url });
  res.end();
}

module.exports = { layout, redirect, escapeHtml, lockCountdownHtml };
