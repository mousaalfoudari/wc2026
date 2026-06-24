'use strict';
const { layout, escapeHtml } = require('../lib/render');
const { sendHtml } = require('../lib/http');
const { requireUser } = require('../lib/guard');
const { fmtDateTime } = require('../lib/util');
const logic = require('../lib/logic');

module.exports = function (router) {
  router.get('/leaderboard', async (req, res) => {
    if (!requireUser(req, res)) return;
    const rows = logic.leaderboard();
    const jokerLog = logic.jokerUsageLog();
    const isAdmin = !!(req.user && req.user.is_admin);

    const rowsHtml = rows
      .map((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
        const frozen = u.status === 'frozen' ? ' <span class="text-rose-500 text-xs">❄️ مجمّد</span>' : '';
        const me = u.id === req.user.id ? ' class="bg-emerald-50"' : '';
        // Admin sees a drill-down link to ANY participant's full prediction
        // history + points breakdown (see /admin/users/:id/predictions in
        // routes/admin.js). A regular participant only gets that same link
        // on their OWN row, pointing at their self-service breakdown
        // (GET /points in routes/predict.js) — everyone else's row stays
        // plain text, so no one can see another participant's details.
        const nameHtml = isAdmin
          ? `<a href="/admin/users/${u.id}/predictions" class="hover:underline">${escapeHtml(u.name)}</a>`
          : u.id === req.user.id
            ? `<a href="/points" class="hover:underline">${escapeHtml(u.name)}</a>`
            : escapeHtml(u.name);
        return `<tr${me}>
          <td class="px-3 py-2 text-center font-bold">${medal}</td>
          <td class="px-3 py-2">${nameHtml}${frozen}</td>
          <td class="px-3 py-2 text-center font-bold ${u.total < 0 ? 'text-rose-600' : 'text-emerald-700'}">${u.total}</td>
        </tr>`;
      })
      .join('');

    const jokerRowsHtml = jokerLog
      .map(
        (j) => `<tr>
          <td class="px-3 py-2 font-bold text-purple-700">${escapeHtml(j.attackerName)}</td>
          <td class="px-3 py-2 font-bold text-rose-600">${escapeHtml(j.victimName)}</td>
          <td class="px-3 py-2 text-slate-500">${j.roundName ? escapeHtml(j.roundName) : '—'}</td>
          <td class="px-3 py-2 text-slate-400 text-xs">${fmtDateTime(j.used_at)}</td>
          ${
            isAdmin
              ? `<td class="px-3 py-2 text-center">
            <form method="post" action="/admin/jokers/${j.id}/ungrade" class="inline" data-confirm="تأكيد التراجع عن استخدام الجوكر من ${escapeHtml(j.attackerName)} على ${escapeHtml(j.victimName)}؟ بترجع ٥ نقاط لـ${escapeHtml(j.victimName)} وتنخصم ٥ نقاط من ${escapeHtml(j.attackerName)}، ويرجع الجوكر متاح يستخدمه ${escapeHtml(j.attackerName)} من جديد.">
              <button class="text-[10px] bg-rose-100 hover:bg-rose-200 text-rose-700 rounded px-1.5 py-0.5">↩️ تراجع</button>
            </form>
          </td>`
              : ''
          }
        </tr>`
      )
      .join('');

    const body = `
      <h1 class="text-xl font-bold mb-4">🏆 جدول الترتيب</h1>
      <div class="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500">
            <tr><th class="px-3 py-2">#</th><th class="px-3 py-2 text-right">الاسم</th><th class="px-3 py-2">النقاط</th></tr>
          </thead>
          <tbody class="divide-y divide-slate-100">${rowsHtml || `<tr><td colspan="3" class="px-3 py-6 text-center text-slate-400">لا يوجد مشتركين بعد</td></tr>`}</tbody>
        </table>
      </div>

      <h2 class="text-lg font-bold mb-2">🃏 سجل الجوكر</h2>
      <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500">
            <tr><th class="px-3 py-2 text-right">منو استخدمه</th><th class="px-3 py-2 text-right">على منو</th><th class="px-3 py-2 text-right">الجولة</th><th class="px-3 py-2 text-right">الوقت</th>${isAdmin ? '<th class="px-3 py-2"></th>' : ''}</tr>
          </thead>
          <tbody class="divide-y divide-slate-100">${jokerRowsHtml || `<tr><td colspan="${isAdmin ? 5 : 4}" class="px-3 py-6 text-center text-slate-400">ما فيه أي جوكر مستخدم لحد الحين</td></tr>`}</tbody>
        </table>
      </div>
    `;

    sendHtml(res, layout({ title: 'الترتيب', user: req.user, active: 'leaderboard', msg: req.flashMsg, msgType: req.flashType, body }));
  });
};
