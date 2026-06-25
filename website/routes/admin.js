'use strict';
const fs = require('fs');
const path = require('path');
const { layout, redirect, escapeHtml, lockCountdownHtml } = require('../lib/render');
const { sendHtml, sendText } = require('../lib/http');
const { requireAdmin, requireUser } = require('../lib/guard');
const { toArray, fmtDateTime, kuwaitLocalToUtcIso, safeJsonParse } = require('../lib/util');
const logic = require('../lib/logic');
const users = require('../lib/users');
const { syncLiveResults, FEED_URL } = require('../lib/livesync');
const { renderUserHistory } = require('../lib/userHistoryView');

// Admin-uploaded "predicted lineup" images live under data/ (not public/) so
// they survive a redeploy — public/ is rebuilt fresh from the git repo every
// deploy, but data/ holds the persistent SQLite DB and is the one directory
// confirmed to survive across this app's actual Render redeploys. Override-
// able via env var (mirrors DB_PATH in lib/db.js) so local/throwaway test
// runs never write into the real project's data/ folder.
const LINEUP_DIR = process.env.LINEUP_DIR || path.join(__dirname, '..', 'data', 'uploads', 'lineups');

function ensureLineupDir() {
  fs.mkdirSync(LINEUP_DIR, { recursive: true });
}

// Sniffs the first few bytes of the uploaded file to confirm it's actually
// one of the image types we accept, regardless of what the browser claimed
// in Content-Type or the original filename's extension — cheap defense
// against a mislabeled or malicious upload.
function sniffImageExt(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf.length >= 6 && buf.slice(0, 3).toString('ascii') === 'GIF') return '.gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return null;
}

function removeExistingLineupFiles(matchId, slot) {
  if (!fs.existsSync(LINEUP_DIR)) return;
  for (const f of fs.readdirSync(LINEUP_DIR)) {
    if (f.startsWith(`match-${matchId}-${slot}.`)) {
      try {
        fs.unlinkSync(path.join(LINEUP_DIR, f));
      } catch (e) {
        // best-effort cleanup — a leftover orphaned file isn't harmful.
      }
    }
  }
}

const LINEUP_SERVE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function shell(title, body, active) {
  return { title, body, active };
}

// Standalone print page (no nav/header) — opens the browser's print dialog
// automatically so the admin can pick "حفظ كـ PDF" without any extra library.
function leaderboardPrintPage(rows) {
  const rowsHtml = rows
    .map((u, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      return `<tr>
        <td style="padding:6px 10px;text-align:center;font-weight:bold;">${medal}</td>
        <td style="padding:6px 10px;">${escapeHtml(u.name)}${u.status === 'frozen' ? ' ❄️' : ''}</td>
        <td style="padding:6px 10px;text-align:center;font-weight:bold;">${u.total}</td>
      </tr>`;
    })
    .join('');

  const today = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>الترتيب العام — كأس العالم 2026</title>
<style>
  body { font-family: 'Tajawal', system-ui, sans-serif; padding: 24px; color: #1e293b; }
  h1 { font-size: 20px; margin-bottom: 2px; }
  .sub { color: #64748b; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  thead { background: #f1f5f9; }
  th { padding: 8px 10px; text-align: center; font-size: 13px; color: #475569; }
  th:nth-child(2) { text-align: right; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  td { font-size: 13px; border-top: 1px solid #e2e8f0; }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <h1>🏆 الترتيب العام — مسابقة توقعات كأس العالم 2026</h1>
  <div class="sub">تاريخ التصدير: ${today}</div>
  <table>
    <thead><tr><th>#</th><th>الاسم</th><th>النقاط</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="3" style="text-align:center;padding:20px;color:#94a3b8;">لا يوجد مشتركين بعد</td></tr>'}</tbody>
  </table>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
}

// Same standalone print/PDF approach as leaderboardPrintPage above, but for a
// single round's points summary (admin-only — see roundPointsSummary in lib/logic.js).
function roundPointsPrintPage(round, rows) {
  const rowsHtml = rows
    .map((u, i) => {
      const medal = i === 0 && u.points > 0 ? '🥇' : i === 1 && u.points > 0 ? '🥈' : i === 2 && u.points > 0 ? '🥉' : `${i + 1}`;
      return `<tr>
        <td style="padding:6px 10px;text-align:center;font-weight:bold;">${medal}</td>
        <td style="padding:6px 10px;">${escapeHtml(u.name)}</td>
        <td style="padding:6px 10px;text-align:center;font-weight:bold;">${u.points}</td>
      </tr>`;
    })
    .join('');

  const today = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>نقاط ${escapeHtml(round.name)} — كأس العالم 2026</title>
<style>
  body { font-family: 'Tajawal', system-ui, sans-serif; padding: 24px; color: #1e293b; }
  h1 { font-size: 20px; margin-bottom: 2px; }
  .sub { color: #64748b; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  thead { background: #f1f5f9; }
  th { padding: 8px 10px; text-align: center; font-size: 13px; color: #475569; }
  th:nth-child(2) { text-align: right; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  td { font-size: 13px; border-top: 1px solid #e2e8f0; }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <h1>🏅 نقاط ${escapeHtml(round.name)} — مسابقة توقعات كأس العالم 2026</h1>
  <div class="sub">تاريخ التصدير: ${today}</div>
  <table>
    <thead><tr><th>#</th><th>الاسم</th><th>النقاط</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="3" style="text-align:center;padding:20px;color:#94a3b8;">لا يوجد مشتركين بعد</td></tr>'}</tbody>
  </table>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
}

function dashboard() {
  const rounds = logic.listRounds();
  const allUsers = users.listAll();
  const frozenCount = allUsers.filter((u) => u.status === 'frozen').length;
  const availJokers = logic.availableJokers();

  const jokersRows = availJokers
    .map(
      (j) => `<tr>
        <td class="px-3 py-2 font-bold text-purple-700">${escapeHtml(j.ownerName)}</td>
        <td class="px-3 py-2 text-sm">${escapeHtml(j.team_a)} × ${escapeHtml(j.team_b)}</td>
        <td class="px-3 py-2 text-sm text-slate-500">${escapeHtml(j.roundName)}</td>
        <td class="px-3 py-2 text-center">
          <form method="post" action="/admin/jokers/${j.id}/delete" class="inline" data-confirm="تأكيد حذف هذا الجوكر من ${escapeHtml(j.ownerName)} نهائياً؟ هذا غير عملية استخدام — هذا حذف الجوكر نفسه، ولازم يكسب جوكر جديد من توقع كامل لو يبي وحد ثاني.">
            <button class="text-[10px] bg-rose-100 hover:bg-rose-200 text-rose-700 rounded px-1.5 py-0.5">🗑️ حذف</button>
          </form>
        </td>
      </tr>`
    )
    .join('');

  const roundsRows = rounds
    .map((r) => {
      const status = r.matches.length === 0 ? '⚪ بدون مباريات' : r.locked ? '🔒 مقفولة' : '🟢 مفتوحة';
      const ungraded = r.matches.filter((m) => !m.graded).length;
      return `<tr>
        <td class="px-3 py-2">${escapeHtml(r.name)}</td>
        <td class="px-3 py-2 text-sm text-slate-500">${r.matches.length}</td>
        <td class="px-3 py-2 text-sm">${status}</td>
        <td class="px-3 py-2 text-sm ${ungraded ? 'text-amber-600' : 'text-slate-400'}">${ungraded ? `${ungraded} بدون نتيجة` : 'كل النتائج مدخلة'}</td>
        <td class="px-3 py-2 whitespace-nowrap">
          <a href="/admin/rounds/${r.id}" class="text-emerald-700 font-medium">إدارة</a>
          ${r.matches.length ? `<a href="/admin/rounds/${r.id}/predictions" class="text-slate-500 font-medium mr-2">👁️ التوقعات</a>` : ''}
        </td>
      </tr>`;
    })
    .join('');

  return `
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">لوحة تحكم الأدمن</h1>
      <div class="flex gap-2">
        <form method="post" action="/admin/sync-results">
          <button class="bg-slate-600 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-slate-700">🔄 تحديث النتائج الآن</button>
        </form>
        <a href="/admin/rounds/new" class="bg-emerald-600 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-emerald-700">+ جولة جديدة</a>
        <a href="/admin/leaderboard/pdf" target="_blank" class="bg-white border border-slate-300 text-slate-700 rounded-lg px-4 py-2 text-sm font-bold hover:bg-slate-50">📄 تصدير الترتيب PDF</a>
      </div>
    </div>
    <p class="text-xs text-slate-400 mb-4">⚽ دور المجموعات (٧٢ مباراة) يتحمّل أوتوماتيك، والنتائج تتحدث من مصدر خارجي كل ١٠ دقائق تقريباً (المصدر نفسه يتحدث تقريباً مرة كل يوم، فما هو لحظي بالثانية). أدوار خروج المغلوب تضيفها يدوياً لما تتحدد الفرق.</p>
    <div class="grid grid-cols-3 gap-3 mb-6">
      <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
        <div class="text-2xl font-bold text-emerald-700">${allUsers.length}</div>
        <div class="text-xs text-slate-500">مشترك</div>
      </div>
      <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
        <div class="text-2xl font-bold text-rose-600">${frozenCount}</div>
        <div class="text-xs text-slate-500">مجمّد</div>
      </div>
      <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
        <div class="text-2xl font-bold text-slate-700">${rounds.length}</div>
        <div class="text-xs text-slate-500">جولة</div>
      </div>
    </div>
    <div class="flex items-center justify-between mb-2">
      <h2 class="font-bold">الجولات</h2>
      <div class="flex gap-3">
        <a href="/admin/rosters" class="text-sm text-emerald-700 font-medium">قوائم اللاعبين →</a>
        <a href="/admin/users" class="text-sm text-emerald-700 font-medium">إدارة المشتركين →</a>
      </div>
    </div>
    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500"><tr><th class="px-3 py-2 text-right">الجولة</th><th class="px-3 py-2">مباريات</th><th class="px-3 py-2">الحالة</th><th class="px-3 py-2">النتائج</th><th></th></tr></thead>
        <tbody class="divide-y divide-slate-100">${roundsRows || `<tr><td colspan="5" class="px-3 py-6 text-center text-slate-400">لا توجد جولات بعد</td></tr>`}</tbody>
      </table>
    </div>

    <div class="flex items-center justify-between mb-2 mt-6">
      <h2 class="font-bold">🃏 الجوكرات المتاحة الآن (${availJokers.length})</h2>
    </div>
    <p class="text-xs text-slate-400 mb-2">جوكر مكتسب من مباراة حقيقية يبقى متاح لصاحبه طبيعياً (حتى بعد ما تتراجع عن استخدامه لو كان تجربة) — هذا مو خطأ. إذا طلع جوكر من نتيجة دخّلتها كتجربة وما تراجعت عنها قبل تصحيحها بالنتيجة الحقيقية، احذفه من هنا.</p>
    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500"><tr><th class="px-3 py-2 text-right">اللاعب</th><th class="px-3 py-2 text-right">من مباراة</th><th class="px-3 py-2 text-right">الجولة</th><th></th></tr></thead>
        <tbody class="divide-y divide-slate-100">${jokersRows || `<tr><td colspan="4" class="px-3 py-6 text-center text-slate-400">ما فيه أي جوكر متاح حالياً</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function newRoundForm() {
  const maxOrder = logic.listRounds().length;
  return `
    <h1 class="text-xl font-bold mb-4">جولة جديدة</h1>
    <form method="post" action="/admin/rounds" class="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div>
        <label class="block text-sm font-medium mb-1">اسم الجولة</label>
        <input name="name" required class="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="مثال: الجولة ١ - الإثنين ١١ يونيو" />
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">المرحلة (اختياري)</label>
        <input name="stage" class="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="دور المجموعات / ثمن النهائي ..." />
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">ترتيب الجولة</label>
        <input name="order_index" type="number" value="${maxOrder + 1}" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
      </div>
      <button class="bg-emerald-600 text-white rounded-lg px-4 py-2 font-bold hover:bg-emerald-700">إنشاء الجولة</button>
    </form>
  `;
}

function scorerInputsBlock(idA, idB, teamA, teamB) {
  return `<div class="flex gap-4 mt-2">
    <div id="${idA}" class="flex-1 flex flex-wrap gap-1"></div>
    <div id="${idB}" class="flex-1 flex flex-wrap gap-1"></div>
  </div>`;
}

// One upload slot for one team's expected lineup image within a match (see
// lineupAdminBlock below, which renders one of these per team side by side).
function lineupSlotBlock(m, slot, teamName) {
  const filename = slot === 'b' ? m.lineup_image_b : m.lineup_image_a;
  const hasImage = !!filename;
  return `<div>
    <div class="flex items-center justify-between mb-1">
      <span class="text-[10px] font-bold text-slate-500">${escapeHtml(teamName)}</span>
      ${
        hasImage
          ? `<form method="post" action="/admin/matches/${m.id}/lineup/${slot}/delete" class="inline" data-confirm="تأكيد حذف صورة تشكيلة ${escapeHtml(teamName)} المتوقعة؟">
              <button class="text-[10px] bg-rose-100 hover:bg-rose-200 text-rose-700 rounded px-1.5 py-0.5">🗑️</button>
            </form>`
          : ''
      }
    </div>
    ${hasImage ? `<img src="/lineups/${escapeHtml(filename)}" class="w-full max-h-32 object-cover rounded-lg mb-2" />` : ''}
    <form method="post" action="/admin/matches/${m.id}/lineup/${slot}" enctype="multipart/form-data" class="flex items-center gap-1">
      <input type="file" name="lineup_image" accept="image/*" required class="text-[11px] flex-1 min-w-0" />
      <button class="text-[11px] bg-slate-600 text-white rounded-lg px-2 py-1 font-bold hover:bg-slate-700 whitespace-nowrap">${hasImage ? 'استبدال' : 'رفع'}</button>
    </form>
  </div>`;
}

// Lets the admin attach/replace/remove an image of each team's expected
// lineup for a specific match — shown to participants on /predict to help
// them decide their prediction (see matchCard in routes/predict.js). Two
// independent slots per match (one per team); uploading a new one replaces
// only that team's old file on disk.
function lineupAdminBlock(m) {
  return `<div class="border border-slate-200 rounded-lg p-2 mt-2 bg-slate-50">
    <div class="text-[11px] font-bold text-slate-500 mb-1">📋 التشكيلة المتوقعة (صورة لكل فريق، اختياري)</div>
    <div class="grid grid-cols-2 gap-2">
      ${lineupSlotBlock(m, 'a', m.team_a)}
      ${lineupSlotBlock(m, 'b', m.team_b)}
    </div>
  </div>`;
}

function matchRow(m) {
  if (m.graded) {
    const sa = safeJsonParse(m.final_scorers_a, []);
    const sb = safeJsonParse(m.final_scorers_b, []);
    return `<div class="bg-white border border-slate-200 rounded-xl p-3 mb-2">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-bold">${escapeHtml(m.team_a)} ${m.final_score_a} - ${m.final_score_b} ${escapeHtml(m.team_b)}</div>
          <div class="text-xs text-slate-400">${fmtDateTime(m.kickoff_at)} ${sa.length || sb.length ? '| هدافين: ' + [...sa, ...sb].map(escapeHtml).join('، ') : ''}</div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-emerald-600 text-sm font-medium">✅ تمت إضافة النتيجة</span>
          <form method="post" action="/admin/matches/${m.id}/ungrade" class="inline" data-confirm="تأكيد التراجع عن نتيجة ${escapeHtml(m.team_a)} × ${escapeHtml(m.team_b)}؟ بترجع المباراة بدون نتيجة وتنحذف كل النقاط المحسوبة عليها (تقدر تدخل النتيجة الصحيحة بعدين من جديد).">
            <button class="text-[10px] bg-rose-100 hover:bg-rose-200 text-rose-700 rounded px-1.5 py-0.5">↩️ تراجع عن النتيجة</button>
          </form>
        </div>
      </div>
      ${lineupAdminBlock(m)}
    </div>`;
  }

  const idA = `res-scorers-a-${m.id}`;
  const idB = `res-scorers-b-${m.id}`;
  const rosterA = logic.getRoster(m.team_a);
  const rosterB = logic.getRoster(m.team_b);
  return `<div class="bg-white border border-amber-200 rounded-xl p-3 mb-2">
    <form method="post" action="/admin/matches/${m.id}/result">
      <div class="flex items-center justify-between text-xs text-slate-400 mb-2">
        <span>${fmtDateTime(m.kickoff_at)}</span>
      </div>
      <div class="flex items-center justify-center gap-3">
        <span class="font-bold">${escapeHtml(m.team_a)}</span>
        <input type="number" min="0" max="20" name="final_score_a" required class="score-input w-16 text-center border border-slate-300 rounded-lg py-1" data-target="${idA}" data-field="final_scorers_a_${m.id}" data-team="${escapeHtml(m.team_a)}" data-players="${escapeHtml(JSON.stringify(rosterA))}" />
        <span class="text-slate-400">-</span>
        <input type="number" min="0" max="20" name="final_score_b" required class="score-input w-16 text-center border border-slate-300 rounded-lg py-1" data-target="${idB}" data-field="final_scorers_b_${m.id}" data-team="${escapeHtml(m.team_b)}" data-players="${escapeHtml(JSON.stringify(rosterB))}" />
        <span class="font-bold">${escapeHtml(m.team_b)}</span>
      </div>
      ${scorerInputsBlock(idA, idB, m.team_a, m.team_b)}
      <button class="w-full mt-2 bg-amber-600 text-white rounded-lg py-1.5 text-sm font-bold hover:bg-amber-700">حفظ النتيجة وحساب النقاط</button>
    </form>
    ${lineupAdminBlock(m)}
  </div>`;
}

function roundManage(round) {
  const matchesHtml = round.matches.map(matchRow).join('') || `<div class="text-slate-400 text-sm py-4 text-center">لا توجد مباريات بعد</div>`;
  const bonusOptsValue = round.bonus_options.join('\n');

  return `
    <a href="/admin" class="text-sm text-slate-500">← رجوع للوحة التحكم</a>
    <div class="flex items-center justify-between mt-1 mb-4">
      <h1 class="text-xl font-bold">${escapeHtml(round.name)} ${round.locked ? '🔒' : '🟢'} ${round.is_fire ? '🔥' : ''}</h1>
      ${round.matches.length ? `<a href="/admin/rounds/${round.id}/predictions" class="text-sm text-emerald-700 font-medium">👁️ شوف كل التوقعات</a>` : ''}
    </div>
    ${lockCountdownHtml(round)}

    <div class="bg-white border ${round.is_fire ? 'border-orange-300' : 'border-slate-200'} rounded-xl p-4 mb-4 flex items-center justify-between">
      <div>
        <h3 class="font-bold text-sm">🔥 الجولة النارية</h3>
        <p class="text-xs text-slate-500 mt-0.5">${round.is_fire ? 'مفعّلة: كل التوقعات الصحيحة بهذي الجولة تاخذ ضعف النقاط.' : 'لو فعّلتها، كل التوقعات الصحيحة بهذي الجولة تاخذ ضعف النقاط (نفس مضاعفة الدبل، بدون تراكم بينهم).'}</p>
      </div>
      <form method="post" action="/admin/rounds/${round.id}/fire" class="inline">
        <input type="hidden" name="is_fire" value="${round.is_fire ? '0' : '1'}" />
        <button class="text-xs ${round.is_fire ? 'text-rose-600' : 'text-orange-600'} font-medium whitespace-nowrap">${round.is_fire ? 'إلغاء التفعيل' : 'تفعيل 🔥'}</button>
      </form>
    </div>

    <h2 class="font-bold mb-2">المباريات</h2>
    ${matchesHtml}

    <div class="bg-white border border-slate-200 rounded-xl p-4 my-4">
      <h3 class="font-bold mb-2 text-sm">إضافة مباراة</h3>
      <form method="post" action="/admin/rounds/${round.id}/matches" class="grid grid-cols-3 gap-2">
        <input name="team_a" placeholder="الفريق الأول" required class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <input name="team_b" placeholder="الفريق الثاني" required class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <input name="kickoff_at" type="datetime-local" required class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <button class="col-span-3 bg-emerald-600 text-white rounded-lg py-1.5 text-sm font-bold hover:bg-emerald-700">إضافة</button>
      </form>
      <details class="mt-3">
        <summary class="text-xs text-slate-500 cursor-pointer">إضافة عدة مباريات دفعة واحدة</summary>
        <form method="post" action="/admin/rounds/${round.id}/matches/bulk" class="mt-2">
          <textarea name="bulk" rows="4" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-mono" placeholder="فريق أ;فريق ب;2026-06-21T19:00&#10;فريق ج;فريق د;2026-06-21T22:00"></textarea>
          <p class="text-xs text-slate-400 mt-1">كل سطر: الفريق الأول;الفريق الثاني;تاريخ ووقت الانطلاق (YYYY-MM-DDTHH:MM)</p>
          <button class="bg-slate-600 text-white rounded-lg px-3 py-1.5 text-sm font-bold mt-2 hover:bg-slate-700">إضافة الكل</button>
        </form>
      </details>
    </div>

    <div class="bg-white border border-slate-200 rounded-xl p-4">
      <h3 class="font-bold mb-2 text-sm">⭐ سؤال البونص</h3>
      <form method="post" action="/admin/rounds/${round.id}/bonus" class="space-y-2">
        <input name="question" value="${escapeHtml(round.bonus_question || '')}" placeholder="نص السؤال" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <textarea name="options" rows="3" placeholder="كل اختيار في سطر" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">${escapeHtml(bonusOptsValue)}</textarea>
        <div class="flex items-center gap-2">
          <label class="text-sm">رقم الاختيار الصحيح (يبدأ من ١):</label>
          <input name="correct" type="number" min="1" value="${round.bonus_correct_index != null ? round.bonus_correct_index + 1 : ''}" class="w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm" />
        </div>
        <button class="bg-amber-600 text-white rounded-lg px-3 py-1.5 text-sm font-bold hover:bg-amber-700">حفظ السؤال</button>
      </form>
      ${
        round.bonus_question
          ? round.bonus_graded
            ? `<div class="mt-2 flex items-center gap-2">
                <span class="text-emerald-600 text-sm font-medium">✅ تم تصحيح سؤال البونص</span>
                <form method="post" action="/admin/rounds/${round.id}/bonus/ungrade" class="inline" data-confirm="تأكيد التراجع عن تصحيح سؤال البونص؟ بترجع نقاط كل المشتركين لهذي الجولة كأنه ما انحسب.">
                  <button class="text-xs bg-rose-100 hover:bg-rose-200 text-rose-700 rounded px-2 py-1">↩️ تراجع عن التصحيح</button>
                </form>
              </div>`
            : `<form method="post" action="/admin/rounds/${round.id}/bonus/grade" class="mt-2">
              <button class="bg-purple-600 text-white rounded-lg px-3 py-1.5 text-sm font-bold hover:bg-purple-700">تصحيح إجابات سؤال البونص الآن</button>
            </form>`
          : ''
      }
    </div>
  `;
}

function roundPredictions(round, data, bonusAnswers, pointsSummary) {
  const pointsSummaryHtml =
    pointsSummary && pointsSummary.length
      ? `<div class="bg-white border border-slate-200 rounded-xl p-3 mb-4">
          <div class="flex items-center justify-between mb-2">
            <div class="font-bold">🏅 نقاط هذي الجولة (لكل مشترك)</div>
            <a href="/admin/rounds/${round.id}/points/pdf" target="_blank" class="text-xs bg-white border border-slate-300 text-slate-700 rounded-lg px-2 py-1 font-bold hover:bg-slate-50">📄 تصدير PDF</a>
          </div>
          <div class="space-y-1">
            ${pointsSummary
              .map(
                (u, i) => `<div class="flex items-center justify-between text-sm border-t border-slate-100 pt-1 first:border-t-0 first:pt-0">
                  <span>${i === 0 && u.points > 0 ? '🥇 ' : ''}${escapeHtml(u.name)}</span>
                  <span class="font-bold ${u.points > 0 ? 'text-emerald-600' : u.points < 0 ? 'text-rose-600' : 'text-slate-400'}">${u.points}</span>
                </div>`
              )
              .join('')}
          </div>
        </div>`
      : '';

  const bonusSection = round.bonus_question
    ? `<div class="bg-white border border-slate-200 rounded-xl p-3 mb-4">
        <div class="font-bold mb-1">🎯 سؤال البونص: ${escapeHtml(round.bonus_question)}</div>
        ${
          bonusAnswers && bonusAnswers.length
            ? `<div class="space-y-1 mt-2">${bonusAnswers
                .map((a) => {
                  const choice = round.bonus_options[a.choice_index];
                  const pts =
                    a.points != null
                      ? `<span class="font-bold ${a.points > 0 ? 'text-emerald-600' : 'text-slate-500'}">${a.points} نقطة</span>`
                      : '<span class="text-slate-400">بدون تصحيح بعد</span>';
                  return `<div class="flex items-center justify-between gap-2 text-sm border-t border-slate-100 pt-1">
                    <span><span class="font-bold">${escapeHtml(a.user_name)}:</span> ${escapeHtml(choice || '')} <span class="mx-1">| ${pts}</span></span>
                    <form method="post" action="/admin/rounds/${round.id}/bonus/answers/${a.user_id}/delete" data-confirm="تأكيد حذف إجابة ${escapeHtml(a.user_name)} على سؤال البونص؟ يقدر يرسل إجابة جديدة بنفسه بعدها لو الجولة لسا مفتوحة.">
                      <button class="text-[10px] bg-rose-100 hover:bg-rose-200 text-rose-700 rounded px-1.5 py-0.5">🗑️ حذف الإجابة</button>
                    </form>
                  </div>`;
                })
                .join('')}</div>`
            : '<div class="text-center text-slate-400 text-sm py-2">لا توجد إجابات بعد</div>'
        }
      </div>`
    : '';

  const sections = data
    .map(({ match, predictions, missing }) => {
      const names = predictions
        .map((p, i) => {
          const detailId = `pd-${match.id}-${i}`;
          return `<button type="button" class="pred-toggle-btn bg-slate-100 hover:bg-emerald-100 text-slate-700 text-sm rounded-full px-3 py-1" data-target="${detailId}" ${p.isDouble ? 'title="هذي مباراة الدبل عنده"' : ''}>${escapeHtml(p.userName)}${p.isDouble ? ' ⭐' : ''}</button>`;
        })
        .join('');

      const details = predictions
        .map((p, i) => {
          const detailId = `pd-${match.id}-${i}`;
          const pts =
            p.pointsEarned != null
              ? `<span class="font-bold ${p.pointsEarned > 0 ? 'text-emerald-600' : p.pointsEarned < 0 ? 'text-rose-600' : 'text-slate-500'}">${p.pointsEarned} نقطة</span>`
              : '<span class="text-slate-400">بدون نقاط بعد</span>';

          // ✅ next to a scorer name means it already matched automatically
          // (literally or via the alias dictionary). If it didn't match but
          // the score itself was exact, show a manual "احسبه صحيح" button
          // so the admin can credit it after eyeballing the name themselves.
          const scorerItem = (name, matched) => {
            if (!p.canCreditScorer) return `<span class="text-slate-500">${escapeHtml(name)}</span>`;
            if (matched) return `<span class="text-emerald-700">${escapeHtml(name)} ✅</span>`;
            const addPts = p.isDouble ? 4 : 2;
            return `<span class="text-slate-500">${escapeHtml(name)}</span>
              <form method="post" action="/admin/predictions/${p.id}/credit-scorer" class="inline" data-confirm="تأكيد اعتبار ${escapeHtml(name)} هداف صحيح لتوقع ${escapeHtml(p.userName)}؟ بتنضاف +${addPts} نقطة. لا تكرر الضغط لنفس الهداف.">
                <button class="text-[10px] bg-amber-100 hover:bg-amber-200 text-amber-700 rounded px-1.5 py-0.5 align-middle">✓ احسبه صحيح</button>
              </form>`;
          };

          const scorerNamesHtml = [
            ...p.predScorersA.map((name, idx) => scorerItem(name, p.scorerMatchA[idx])),
            ...p.predScorersB.map((name, idx) => scorerItem(name, p.scorerMatchB[idx])),
          ].join(' &nbsp;');

          return `<div id="${detailId}" class="pred-detail hidden border-t border-slate-100 mt-2 pt-2 text-sm">
            <span class="font-bold">${escapeHtml(p.userName)}${p.isDouble ? ' ⭐' : ''}:</span>
            <span class="font-bold mx-1">${escapeHtml(match.team_a)} ${p.predScoreA} - ${p.predScoreB} ${escapeHtml(match.team_b)}</span>
            ${scorerNamesHtml ? `<span class="text-slate-500">| هدافين: </span>${scorerNamesHtml}` : ''}
            <span class="mx-1">| ${pts}</span>
            <form method="post" action="/admin/predictions/${p.id}/delete" class="inline" data-confirm="تأكيد حذف توقع ${escapeHtml(p.userName)} لهذي المباراة؟ ما يمكن التراجع.">
              <button class="text-[10px] bg-rose-100 hover:bg-rose-200 text-rose-700 rounded px-1.5 py-0.5 align-middle">🗑️ حذف التوقع</button>
            </form>
          </div>`;
        })
        .join('');

      return `<div class="bg-white border border-slate-200 rounded-xl p-3 mb-3">
        <div class="font-bold mb-1">${escapeHtml(match.team_a)} × ${escapeHtml(match.team_b)} <span class="text-xs text-slate-400 font-normal">${fmtDateTime(match.kickoff_at)}</span></div>
        <div class="text-xs text-slate-400 mb-2">${predictions.length} توقّع${missing.length ? ' — ما توقع: ' + missing.map(escapeHtml).join('، ') : ''}</div>
        ${
          predictions.length
            ? `<div class="flex flex-wrap gap-1.5">${names}</div>${details}`
            : '<div class="text-center text-slate-400 text-sm py-2">لا توجد توقعات بعد</div>'
        }
      </div>`;
    })
    .join('');

  return `
    <a href="/admin/rounds/${round.id}" class="text-sm text-slate-500">← رجوع لإدارة الجولة</a>
    <h1 class="text-xl font-bold mt-1 mb-4">كل التوقعات — ${escapeHtml(round.name)}</h1>
    ${pointsSummaryHtml}
    ${bonusSection}
    ${sections || `<div class="text-slate-400 text-sm py-8 text-center">لا توجد مباريات بهذي الجولة</div>`}
  `;
}

function usersPage() {
  const rows = users.listAll();
  const admins = users.listAdmins();
  const totals = logic.computeTotals();
  const manualPoints = logic.manualPointsByUser();
  const canDemote = admins.length > 1;

  const adminsHtml = admins
    .map((a) => {
      return `<tr>
        <td class="px-3 py-2">${escapeHtml(a.name)} 👑</td>
        <td class="px-3 py-2">
          ${
            canDemote
              ? `<form method="post" action="/admin/users/${a.id}/admin" class="inline" data-confirm="تأكيد إلغاء صلاحية الأدمن عن ${escapeHtml(a.name)}؟">
                  <input type="hidden" name="is_admin" value="0" />
                  <button class="text-xs text-rose-600 font-medium">إلغاء صلاحية الأدمن</button>
                </form>`
              : `<span class="text-xs text-slate-400">آخر أدمن — ما يمكن إلغاؤه</span>`
          }
        </td>
      </tr>`;
    })
    .join('');

  const rowsHtml = rows
    .map((u) => {
      const total = totals[u.id] || 0;
      const manual = manualPoints[u.id] || 0;
      return `<tr>
        <td class="px-3 py-2"><a href="/admin/users/${u.id}/predictions" class="font-medium text-emerald-700 hover:underline">${escapeHtml(u.name)}</a></td>
        <td class="px-3 py-2 text-center">${total}${manual ? `<div class="text-xs text-slate-400">(منها ${manual > 0 ? '+' : ''}${manual} يدوي)</div>` : ''}</td>
        <td class="px-3 py-2 text-center">${u.miss_streak}</td>
        <td class="px-3 py-2 text-center">${u.status === 'frozen' ? '❄️ مجمّد' : '✅ نشط'}</td>
        <td class="px-3 py-2">
          <form method="post" action="/admin/users/${u.id}/status" class="inline">
            <input type="hidden" name="status" value="${u.status === 'frozen' ? 'active' : 'frozen'}" />
            <button class="text-xs ${u.status === 'frozen' ? 'text-emerald-700' : 'text-rose-600'} font-medium">${u.status === 'frozen' ? 'إلغاء التجميد' : 'تجميد'}</button>
          </form>
        </td>
        <td class="px-3 py-2">
          <form method="post" action="/admin/users/${u.id}/points" class="flex gap-1">
            <input name="delta" type="number" placeholder="+/- نقاط" required class="border border-slate-300 rounded px-2 py-1 text-xs w-20" />
            <input name="reason" placeholder="السبب (اختياري)" class="border border-slate-300 rounded px-2 py-1 text-xs w-28" />
            <button class="text-xs text-emerald-700 font-medium">إضافة</button>
          </form>
        </td>
        <td class="px-3 py-2">
          <form method="post" action="/admin/users/${u.id}/admin" class="inline" data-confirm="تأكيد ترقية ${escapeHtml(u.name)} لأدمن؟ راح يقدر يسوي كل شي تسويه بلوحة التحكم.">
            <input type="hidden" name="is_admin" value="1" />
            <button class="text-xs text-purple-700 font-medium">ترقية لأدمن</button>
          </form>
        </td>
        <td class="px-3 py-2">
          <form method="post" action="/admin/users/${u.id}/password" class="flex gap-1">
            <input name="password" placeholder="باسوورد جديد" class="border border-slate-300 rounded px-2 py-1 text-xs w-28" />
            <button class="text-xs text-emerald-700 font-medium">تغيير</button>
          </form>
        </td>
        <td class="px-3 py-2">
          <form method="post" action="/admin/users/${u.id}/delete" class="inline" data-confirm="حذف ${escapeHtml(u.name)} نهائياً؟ راح تنحذف كل توقعاته ونقاطه وسجل الجوكر — ما يمكن التراجع عن هذا!">
            <button class="text-xs text-rose-700 font-bold">🗑️ حذف نهائي</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');

  return `
    <a href="/admin" class="text-sm text-slate-500">← رجوع للوحة التحكم</a>
    <h1 class="text-xl font-bold mt-1 mb-4">إدارة المشتركين (${rows.length})</h1>

    <h2 class="font-bold mb-2 text-sm">الأدمنز الحاليين (${admins.length})</h2>
    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
      <table class="w-full text-sm">
        <tbody class="divide-y divide-slate-100">${adminsHtml}</tbody>
      </table>
    </div>

    <div class="bg-white border border-slate-200 rounded-xl overflow-x-auto">
      <table class="w-full text-sm whitespace-nowrap">
        <thead class="bg-slate-50 text-slate-500"><tr>
          <th class="px-3 py-2 text-right">الاسم</th><th class="px-3 py-2">النقاط</th><th class="px-3 py-2">غياب متتالي</th><th class="px-3 py-2">الحالة</th><th class="px-3 py-2"></th><th class="px-3 py-2">إضافة/خصم نقاط</th><th class="px-3 py-2"></th><th class="px-3 py-2">إعادة تعيين باسوورد</th><th class="px-3 py-2"></th>
        </tr></thead>
        <tbody class="divide-y divide-slate-100">${rowsHtml || `<tr><td colspan="9" class="px-3 py-6 text-center text-slate-400">لا يوجد مشتركين بعد</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

// Admin-only "click a participant, see everything" drill-down — every
// prediction they've made across every round, their bonus answers, manual
// adjustments, and joker activity, with each round subtotaled and rolled up
// to the same grand total /leaderboard shows for them. Built from
// logic.getUserPredictionHistory(); see routes/leaderboard.js and
// usersPage() above for the entry-point links (admin-only).
function rostersPage() {
  const teamNames = logic.listTeamNames();
  const rosters = logic.listRosters();
  const doneCount = teamNames.filter((t) => (rosters[t] || []).length > 0).length;

  const cards = teamNames
    .map((team) => {
      const players = rosters[team] || [];
      const status = players.length
        ? `<span class="text-emerald-600">✅ ${players.length} لاعب</span>`
        : `<span class="text-slate-400">بلا قائمة — يتوقعون بكتابة الاسم</span>`;
      return `<div class="bg-white border border-slate-200 rounded-xl p-4 mb-3">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-sm">${escapeHtml(team)}</h3>
          <span class="text-xs">${status}</span>
        </div>
        <form method="post" action="/admin/rosters" class="space-y-2">
          <input type="hidden" name="team_name" value="${escapeHtml(team)}" />
          <textarea name="players" rows="4" placeholder="كل لاعب بسطر مستقل، مثال: ميسي = Messi" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">${escapeHtml(players.join('\n'))}</textarea>
          <button class="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm font-bold hover:bg-emerald-700">حفظ القائمة</button>
        </form>
      </div>`;
    })
    .join('');

  return `
    <a href="/admin" class="text-sm text-slate-500">← رجوع للوحة التحكم</a>
    <h1 class="text-xl font-bold mt-1 mb-1">قوائم لاعبي الفرق</h1>
    <p class="text-sm text-slate-500 mb-4">${doneCount} من ${teamNames.length} فريق عنده قائمة. أي فريق عنده قائمة، المشتركين يختارون الهداف من قائمة منسدلة بدل كتابة الاسم (وكذا أنت لما تدخل النتيجة الرسمية) — يضمن مطابقة دقيقة بدون أي اختلاف بالكتابة. الفرق اللي بلا قائمة تفضل تعمل بالكتابة الحرة كالسابق.</p>
    <p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">💡 تقدر تضيف الاسم الرسمي بالإنجليزي لأي لاعب بنفس السطر بصيغة <code class="font-mono">الاسم العربي = English Name</code> (مثال: <code class="font-mono">ميسي = Messi</code>) — هذا يخلي تحديث النتائج الأوتوماتيكي (اللي يجيك بالإنجليزي من المصدر الخارجي) يطابق توقعات المشتركين العربية لذاك اللاعب بدون أي تدخل يدوي منك أو مني. الجزء الإنجليزي ما يظهر للمشترك، فقط يستخدم بالمطابقة بالخلفية. كتابة الاسم العربي لوحده (بدون "=") تبقى تشتغل عادي كالسابق.</p>

    <div class="bg-white border border-emerald-200 rounded-xl p-4 mb-4">
      <h3 class="font-bold mb-1 text-sm">📥 استيراد قوائم جاهزة (ملف JSON)</h3>
      <p class="text-xs text-slate-500 mb-2">رفع ملف JSON واحد يحدّث كل الفرق دفعة واحدة، بدل لصق كل فريق لحاله. صيغة الملف: كائن JSON اسم كل فريق فيه (بالعربي، نفس اسم الفريق بالموقع) يقابله مصفوفة أسماء اللاعبين — مثال:</p>
      <pre class="text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-2 mb-2 overflow-x-auto font-mono" dir="ltr">{"قطر": ["Hassan Al-Haydos", "Akram Afif", ...], "البرازيل": ["Neymar", ...]}</pre>
      <form method="post" action="/admin/rosters/import" enctype="multipart/form-data" class="flex items-center gap-2">
        <input type="file" name="rosters_file" accept=".json,application/json" required class="text-sm flex-1 min-w-0" />
        <button class="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm font-bold hover:bg-emerald-700 whitespace-nowrap">استيراد</button>
      </form>
      <p class="text-xs text-slate-400 mt-2">أي اسم فريق بالملف ما يطابق اسم فريق موجود بالموقع يتم تجاوزه (ويظهر لك تنبيه بالعدد) — باقي الفرق المطابقة تتحدث عادي.</p>
    </div>

    ${cards || `<div class="text-slate-400 text-sm py-8 text-center">لا توجد فرق بالجدول بعد</div>`}
  `;
}

module.exports = function (router) {
  router.get('/admin', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendHtml(res, layout({ title: 'الأدمن', user: req.user, active: 'admin', msg: req.flashMsg, msgType: req.flashType, body: dashboard() }));
  });

  router.get('/admin/leaderboard/pdf', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const rows = logic.leaderboard();
    sendHtml(res, leaderboardPrintPage(rows));
  });

  router.get('/admin/rounds/:id/points/pdf', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const round = logic.getRound(Number(req.params.id));
    if (!round) return redirect(res, '/admin', 'الجولة غير موجودة.', 'error');
    const rows = logic.roundPointsSummary(round.id);
    sendHtml(res, roundPointsPrintPage(round, rows));
  });

  router.post('/admin/sync-results', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const result = await syncLiveResults();
    if (!result.ok) return redirect(res, '/admin', `فشل الاتصال بمصدر النتائج (${FEED_URL}): ${result.error}`, 'error');
    redirect(res, '/admin', `تم التحقق من النتائج — ${result.updated} مباراة تم تصحيحها أوتوماتيك ✅`);
  });

  router.get('/admin/rounds/new', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendHtml(res, layout({ title: 'جولة جديدة', user: req.user, active: 'admin', body: newRoundForm() }));
  });

  router.post('/admin/rounds', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { name, stage, order_index } = req.body;
    if (!name) return redirect(res, '/admin/rounds/new', 'اسم الجولة مطلوب.', 'error');
    const id = logic.createRound({ name, stage, orderIndex: parseInt(order_index, 10) || 1 });
    redirect(res, `/admin/rounds/${id}`, 'تم إنشاء الجولة ✅');
  });

  router.get('/admin/rounds/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const round = logic.getRound(Number(req.params.id));
    if (!round) return redirect(res, '/admin', 'الجولة غير موجودة.', 'error');
    sendHtml(res, layout({ title: round.name, user: req.user, active: 'admin', msg: req.flashMsg, msgType: req.flashType, body: roundManage(round) }));
  });

  router.get('/admin/rounds/:id/predictions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const round = logic.getRound(Number(req.params.id));
    if (!round) return redirect(res, '/admin', 'الجولة غير موجودة.', 'error');
    const data = logic.getRoundPredictionsByMatch(round.id);
    const bonusAnswers = logic.getBonusAnswersForRound(round.id);
    const pointsSummary = logic.roundPointsSummary(round.id);
    sendHtml(
      res,
      layout({
        title: 'كل التوقعات',
        user: req.user,
        active: 'admin',
        msg: req.flashMsg,
        msgType: req.flashType,
        body: roundPredictions(round, data, bonusAnswers, pointsSummary),
      })
    );
  });

  router.post('/admin/rounds/:id/matches', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const roundId = Number(req.params.id);
    const { team_a, team_b, kickoff_at } = req.body;
    if (!team_a || !team_b || !kickoff_at) return redirect(res, `/admin/rounds/${roundId}`, 'كل الحقول مطلوبة.', 'error');
    logic.addMatch(roundId, team_a, team_b, kuwaitLocalToUtcIso(kickoff_at));
    redirect(res, `/admin/rounds/${roundId}`, 'تمت إضافة المباراة ✅');
  });

  router.post('/admin/rounds/:id/matches/bulk', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const roundId = Number(req.params.id);
    const lines = String(req.body.bulk || '').split('\n').map((l) => l.trim()).filter(Boolean);
    let count = 0;
    for (const line of lines) {
      const parts = line.split(';').map((p) => p.trim());
      if (parts.length < 3) continue;
      const [teamA, teamB, dt] = parts;
      const iso = kuwaitLocalToUtcIso(dt);
      if (!iso) continue;
      logic.addMatch(roundId, teamA, teamB, iso);
      count++;
    }
    redirect(res, `/admin/rounds/${roundId}`, `تمت إضافة ${count} مباراة ✅`);
  });

  router.post('/admin/matches/:id/result', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const matchId = Number(req.params.id);
    const match = logic.getMatch(matchId);
    if (!match) return redirect(res, '/admin', 'المباراة غير موجودة.', 'error');

    const finalA = parseInt(req.body.final_score_a, 10);
    const finalB = parseInt(req.body.final_score_b, 10);
    if (Number.isNaN(finalA) || Number.isNaN(finalB)) return redirect(res, `/admin/rounds/${match.round_id}`, 'النتيجة غير صحيحة.', 'error');

    const scorersA = toArray(req.body[`final_scorers_a_${matchId}`]).filter((s) => s && s.trim()).slice(0, finalA);
    const scorersB = toArray(req.body[`final_scorers_b_${matchId}`]).filter((s) => s && s.trim()).slice(0, finalB);

    logic.gradeMatch(matchId, finalA, finalB, scorersA, scorersB);
    redirect(res, `/admin/rounds/${match.round_id}`, 'تم حفظ النتيجة وحساب نقاط الكل ✅');
  });

  router.post('/admin/matches/:id/ungrade', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const matchId = Number(req.params.id);
    const result = logic.ungradeMatch(matchId);
    if (!result.ok) return redirect(res, '/admin', result.error, 'error');
    const backTo = `/admin/rounds/${result.roundId}`;
    if (result.usedJokerWarning) {
      return redirect(res, backTo, 'تم التراجع عن النتيجة، لكن فيه جوكر مأخوذ من هذي المباراة استُخدم بالفعل — تأكد منه يدوياً.', 'error');
    }
    redirect(res, backTo, 'تم التراجع عن النتيجة ✅ — المباراة رجعت بدون نتيجة.');
  });

  // Admin uploads (or replaces) one team's "predicted lineup" image for a
  // match — see lineupAdminBlock() above and matchCard() in routes/predict.js
  // for where participants see it. Multipart parsing happens centrally in
  // server.js; req.files.lineup_image.data is the raw image Buffer here.
  // :slot is 'a' or 'b' (which team within the match this image is for).
  router.post('/admin/matches/:id/lineup/:slot', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const matchId = Number(req.params.id);
    const slot = req.params.slot === 'b' ? 'b' : 'a';
    const match = logic.getMatch(matchId);
    if (!match) return redirect(res, '/admin', 'المباراة غير موجودة.', 'error');

    const file = req.files && req.files.lineup_image;
    if (!file || !file.data || !file.data.length) {
      return redirect(res, `/admin/rounds/${match.round_id}`, 'اختر صورة للرفع.', 'error');
    }

    const ext = sniffImageExt(file.data);
    if (!ext) {
      return redirect(res, `/admin/rounds/${match.round_id}`, 'الملف المرفوع لازم يكون صورة (jpg / png / webp / gif).', 'error');
    }

    ensureLineupDir();
    removeExistingLineupFiles(matchId, slot);
    const filename = `match-${matchId}-${slot}${ext}`;
    fs.writeFileSync(path.join(LINEUP_DIR, filename), file.data);
    logic.setMatchLineupImage(matchId, slot, filename);

    redirect(res, `/admin/rounds/${match.round_id}`, 'تم رفع صورة التشكيلة المتوقعة ✅');
  });

  router.post('/admin/matches/:id/lineup/:slot/delete', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const matchId = Number(req.params.id);
    const slot = req.params.slot === 'b' ? 'b' : 'a';
    const match = logic.getMatch(matchId);
    if (!match) return redirect(res, '/admin', 'المباراة غير موجودة.', 'error');

    removeExistingLineupFiles(matchId, slot);
    logic.clearMatchLineupImage(matchId, slot);
    redirect(res, `/admin/rounds/${match.round_id}`, 'تم حذف صورة التشكيلة المتوقعة ✅');
  });

  // Serves an uploaded lineup image to any logged-in participant (gated like
  // the rest of the app — requireUser, not requireAdmin). Lives under data/
  // rather than public/, so it can't go through the existing serveStatic()
  // helper in lib/http.js (which only serves public/) — hence this dedicated
  // route, with the filename pattern strictly whitelisted to block any path
  // traversal via the :filename param. Accepts both the current per-team
  // naming (match-<id>-a/b.ext) and the older single-image naming
  // (match-<id>.ext) in case any pre-existing file is still referenced.
  router.get('/lineups/:filename', async (req, res) => {
    if (!requireUser(req, res)) return;
    const name = String(req.params.filename || '');
    if (!/^match-\d+(-[ab])?\.(jpg|jpeg|png|webp|gif)$/i.test(name)) {
      return sendText(res, 'غير موجود', 404);
    }
    const full = path.join(LINEUP_DIR, name);
    if (!fs.existsSync(full)) return sendText(res, 'غير موجود', 404);
    const ext = path.extname(name).toLowerCase();
    const body = fs.readFileSync(full);
    res.writeHead(200, {
      'Content-Type': LINEUP_SERVE_MIME[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'private, max-age=600',
    });
    res.end(body);
  });

  router.post('/admin/jokers/:id/ungrade', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const jokerId = Number(req.params.id);
    const result = logic.ungradeJokerUse(jokerId);
    if (!result.ok) return redirect(res, '/leaderboard', result.error, 'error');
    redirect(res, '/leaderboard', 'تم التراجع عن استخدام الجوكر ✅ — رجعت النقاط وصار الجوكر متاح من جديد.');
  });

  // Permanently removes an available (unused) joker — for cleaning up one
  // earned from a test/fake result that wasn't undone via "تراجع عن النتيجة"
  // before the real result was entered (see availableJokers/forfeitJoker in
  // lib/logic.js, and the "🃏 الجوكرات المتاحة الآن" section on the dashboard).
  router.post('/admin/jokers/:id/delete', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const jokerId = Number(req.params.id);
    const result = logic.forfeitJoker(jokerId);
    if (!result.ok) return redirect(res, '/admin', result.error, 'error');
    redirect(res, '/admin', 'تم حذف الجوكر نهائياً ✅');
  });

  router.post('/admin/rounds/:id/bonus', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const roundId = Number(req.params.id);
    const options = String(req.body.options || '').split('\n').map((o) => o.trim()).filter(Boolean);
    const correctRaw = parseInt(req.body.correct, 10);
    const correctIndex = correctRaw ? correctRaw - 1 : null;
    logic.updateRoundBonus(roundId, { question: req.body.question, options, correctIndex });
    redirect(res, `/admin/rounds/${roundId}`, 'تم حفظ سؤال البونص ✅');
  });

  router.post('/admin/rounds/:id/bonus/grade', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const roundId = Number(req.params.id);
    const round = logic.getRound(roundId);
    if (!round || round.bonus_correct_index == null) {
      return redirect(res, `/admin/rounds/${roundId}`, 'لازم تحدد الاختيار الصحيح أول.', 'error');
    }
    logic.gradeBonus(roundId, round.bonus_correct_index);
    redirect(res, `/admin/rounds/${roundId}`, 'تم تصحيح إجابات البونص ✅');
  });

  router.post('/admin/rounds/:id/fire', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const roundId = Number(req.params.id);
    const isFire = req.body.is_fire === '1';
    logic.setRoundFire(roundId, isFire);
    redirect(res, `/admin/rounds/${roundId}`, isFire ? 'تم تفعيل الجولة النارية 🔥' : 'تم إلغاء تفعيل الجولة النارية ✅');
  });

  router.post('/admin/rounds/:id/bonus/ungrade', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const roundId = Number(req.params.id);
    const result = logic.ungradeBonus(roundId);
    if (!result.ok) return redirect(res, `/admin/rounds/${roundId}`, result.error, 'error');
    redirect(res, `/admin/rounds/${roundId}`, 'تم التراجع عن تصحيح سؤال البونص ✅ — النقاط رجعت طبيعية.');
  });

  router.get('/admin/users', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendHtml(res, layout({ title: 'المشتركين', user: req.user, active: 'admin', msg: req.flashMsg, msgType: req.flashType, body: usersPage() }));
  });

  router.get('/admin/users/:id/predictions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const history = logic.getUserPredictionHistory(Number(req.params.id));
    if (!history) return redirect(res, '/admin/users', 'المشترك غير موجود.', 'error');
    sendHtml(
      res,
      layout({
        title: `توقعات ${history.user.name}`,
        user: req.user,
        active: 'admin',
        msg: req.flashMsg,
        msgType: req.flashType,
        body: renderUserHistory(history),
      })
    );
  });

  router.get('/admin/rosters', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendHtml(res, layout({ title: 'قوائم اللاعبين', user: req.user, active: 'admin', msg: req.flashMsg, msgType: req.flashType, body: rostersPage() }));
  });

  router.post('/admin/rosters', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const teamName = String(req.body.team_name || '').trim();
    if (!teamName) return redirect(res, '/admin/rosters', 'اسم الفريق ناقص.', 'error');
    const players = String(req.body.players || '')
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);
    logic.setRoster(teamName, players);
    redirect(res, '/admin/rosters', `تم حفظ قائمة ${teamName} ✅`);
  });

  // Bulk import: lets the admin upload one rosters.json file (shape:
  // { "اسم الفريق": ["Player One", "Player Two", ...], ... }) and apply it
  // to every matching team in one click, instead of pasting each team's
  // list by hand on this same page. Goes through the same multipart
  // pipeline as the lineup-image uploads above (parsed centrally in
  // server.js) — req.files.rosters_file.data is the raw uploaded Buffer.
  // Only team names that exactly match an existing team (from
  // logic.listTeamNames(), i.e. names actually used in the schedule) are
  // applied; anything else is silently skipped and counted so the admin
  // gets an accurate "X طبّقنا، Y تجاوزنا" message rather than a false
  // "all good" if the file has typos or extra/renamed teams.
  router.post('/admin/rosters/import', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const file = req.files && req.files.rosters_file;
    if (!file || !file.data || !file.data.length) {
      return redirect(res, '/admin/rosters', 'اختر ملف JSON للرفع.', 'error');
    }

    let parsed;
    try {
      parsed = JSON.parse(file.data.toString('utf8'));
    } catch (e) {
      return redirect(res, '/admin/rosters', 'الملف المرفوع ليس JSON صحيح — تأكد إنه نفس صيغة rosters.json.', 'error');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return redirect(res, '/admin/rosters', 'صيغة الملف غير متوقعة — لازم يكون كائن JSON بصيغة {"اسم الفريق": ["لاعب١", "لاعب٢"]}.', 'error');
    }

    const knownTeams = new Set(logic.listTeamNames());
    let updated = 0;
    let skipped = 0;

    for (const [teamName, players] of Object.entries(parsed)) {
      if (!Array.isArray(players) || !players.every((p) => typeof p === 'string')) {
        skipped++;
        continue;
      }
      if (!knownTeams.has(teamName)) {
        skipped++;
        continue;
      }
      const clean = players.map((p) => p.trim()).filter(Boolean);
      logic.setRoster(teamName, clean);
      updated++;
    }

    if (updated === 0) {
      return redirect(res, '/admin/rosters', 'ما تحدث أي فريق — تأكد إن أسماء الفرق بالملف مطابقة بالضبط لأسماء الفرق بالموقع.', 'error');
    }

    const msg = skipped
      ? `تم تحديث ${updated} فريق ✅ (${skipped} اسم بالملف ما طابق فريق موجود وتم تجاوزه)`
      : `تم تحديث ${updated} فريق بنجاح ✅`;
    redirect(res, '/admin/rosters', msg, skipped ? 'error' : 'ok');
  });

  router.post('/admin/users/:id/status', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    users.setStatus(Number(req.params.id), req.body.status === 'frozen' ? 'frozen' : 'active');
    redirect(res, '/admin/users', 'تم تحديث حالة المشترك ✅');
  });

  router.post('/admin/users/:id/password', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const pw = String(req.body.password || '');
    if (pw.length < 4) return redirect(res, '/admin/users', 'كلمة المرور قصيرة.', 'error');
    users.resetPassword(Number(req.params.id), pw);
    redirect(res, '/admin/users', 'تم تغيير كلمة المرور ✅');
  });

  router.post('/admin/users/:id/points', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    const delta = parseInt(req.body.delta, 10);
    if (Number.isNaN(delta) || delta === 0) return redirect(res, '/admin/users', 'لازم تكتب رقم نقاط صحيح (موجب أو سالب).', 'error');
    logic.addAdjustment(id, delta, String(req.body.reason || '').trim());
    redirect(res, '/admin/users', `تمت إضافة ${delta > 0 ? '+' : ''}${delta} نقطة ✅`);
  });

  router.post('/admin/users/:id/admin', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    const makeAdmin = req.body.is_admin === '1';
    if (!makeAdmin) {
      const admins = users.listAdmins();
      if (admins.length <= 1 && admins[0].id === id) {
        return redirect(res, '/admin/users', 'ما يمكن إلغاء صلاحية آخر أدمن بالموقع.', 'error');
      }
    }
    users.setAdmin(id, makeAdmin);
    redirect(res, '/admin/users', makeAdmin ? 'تمت الترقية لأدمن ✅' : 'تم إلغاء صلاحية الأدمن ✅');
  });

  // Permanent delete of a participant account — irreversible, unlike the
  // freeze/unfreeze toggle above. Refuses to touch admin accounts (they'd
  // need to be demoted first via the admin-toggle route above, which is a
  // separate, deliberate step) so this can't be used to accidentally wipe
  // an admin, including the last one.
  router.post('/admin/users/:id/delete', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    const target = users.findById(id);
    if (!target) return redirect(res, '/admin/users', 'المشترك غير موجود.', 'error');
    if (target.is_admin) return redirect(res, '/admin/users', 'ما يمكن حذف حساب أدمن من هنا — لازم تلغي صلاحيته كأدمن أول.', 'error');
    users.deleteUser(id);
    redirect(res, '/admin/users', `تم حذف ${target.name} وكل توقعاته نهائياً ✅`);
  });

  router.post('/admin/predictions/:id/credit-scorer', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    const result = logic.creditManualScorer(id);
    const backTo = result.roundId ? `/admin/rounds/${result.roundId}/predictions` : '/admin';
    if (!result.ok) return redirect(res, backTo, result.error, 'error');
    redirect(res, backTo, `تمت إضافة +${result.delta} نقطة لـ ${result.userName} ✅`);
  });

  router.post('/admin/predictions/:id/delete', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    const result = logic.deletePrediction(id);
    const backTo = result.roundId ? `/admin/rounds/${result.roundId}/predictions` : '/admin';
    if (!result.ok) return redirect(res, backTo, result.error, 'error');
    redirect(res, backTo, `تم حذف توقع ${result.userName} ✅`);
  });

  router.post('/admin/rounds/:roundId/bonus/answers/:userId/delete', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const roundId = Number(req.params.roundId);
    const userId = Number(req.params.userId);
    const backTo = `/admin/rounds/${roundId}/predictions`;
    const result = logic.deleteBonusAnswer(userId, roundId);
    if (!result.ok) return redirect(res, backTo, result.error, 'error');
    redirect(res, backTo, `تم حذف إجابة ${result.userName} على سؤال البونص ✅ يقدر يرسل إجابة جديدة لو الجولة لسا مفتوحة.`);
  });
};
