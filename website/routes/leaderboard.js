'use strict';
const { layout, escapeHtml } = require('../lib/render');
const { sendHtml } = require('../lib/http');
const { requireUser } = require('../lib/guard');
const logic = require('../lib/logic');

module.exports = function (router) {
  router.get('/leaderboard', async (req, res) => {
    if (!requireUser(req, res)) return;
    const rows = logic.leaderboard();

    const rowsHtml = rows
      .map((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
        const frozen = u.status === 'frozen' ? ' <span class="text-rose-500 text-xs">❄️ مجمّد</span>' : '';
        const me = u.id === req.user.id ? ' class="bg-emerald-50"' : '';
        return `<tr${me}>
          <td class="px-3 py-2 text-center font-bold">${medal}</td>
          <td class="px-3 py-2">${escapeHtml(u.name)}${frozen}</td>
          <td class="px-3 py-2 text-center font-bold ${u.total < 0 ? 'text-rose-600' : 'text-emerald-700'}">${u.total}</td>
        </tr>`;
      })
      .join('');

    const body = `
      <h1 class="text-xl font-bold mb-4">🏆 جدول الترتيب</h1>
      <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500">
            <tr><th class="px-3 py-2">#</th><th class="px-3 py-2 text-right">الاسم</th><th class="px-3 py-2">النقاط</th></tr>
          </thead>
          <tbody class="divide-y divide-slate-100">${rowsHtml || `<tr><td colspan="3" class="px-3 py-6 text-center text-slate-400">لا يوجد مشتركين بعد</td></tr>`}</tbody>
        </table>
      </div>
    `;

    sendHtml(res, layout({ title: 'الترتيب', user: req.user, active: 'leaderboard', msg: req.flashMsg, msgType: req.flashType, body }));
  });
};
