'use strict';
// Shared renderer for "full prediction history + points breakdown" of ONE
// participant — used by BOTH:
//   1) the admin drill-down page (GET /admin/users/:id/predictions in
//      routes/admin.js), for any participant, and
//   2) the participant's own self-view page (GET /points in
//      routes/predict.js), restricted to req.user.id only.
// Extracted into its own module so the two routes don't duplicate this
// markup — the data shape (from logic.getUserPredictionHistory) and the
// breakdown itself are identical either way; only the back-link differs.
const { escapeHtml } = require('./render');
const { fmtDateTime } = require('./util');

function renderUserHistory(history, opts) {
  opts = opts || {};
  const backHref = opts.backHref || '/admin/users';
  const backLabel = opts.backLabel || '← رجوع لإدارة المشتركين';
  const { user, rounds, noRoundAdjustments, jokersEarned, jokersAgainstThem, grandTotal } = history;

  const ptsClass = (n) => (n > 0 ? 'text-emerald-700' : n < 0 ? 'text-rose-600' : 'text-slate-400');

  const roundsHtml = rounds
    .map((rd) => {
      const matchesHtml = rd.predictions
        .map((p) => {
          const finalHtml = p.graded
            ? `<span class="text-slate-400 text-xs">(النتيجة: ${p.finalScoreA}-${p.finalScoreB})</span>`
            : '<span class="text-slate-400 text-xs">(لسا بدون نتيجة)</span>';
          const scorerName = (name, matched) =>
            p.graded && matched
              ? `<span class="text-emerald-700">${escapeHtml(name)} ✅</span>`
              : `<span class="text-slate-500">${escapeHtml(name)}</span>`;
          const scorersHtml = [
            ...p.predScorersA.map((n, i) => scorerName(n, p.scorerMatchA[i])),
            ...p.predScorersB.map((n, i) => scorerName(n, p.scorerMatchB[i])),
          ].join(' &nbsp;');
          const pts =
            p.pointsEarned != null
              ? `<span class="font-bold ${ptsClass(p.pointsEarned)}">${p.pointsEarned} نقطة</span>`
              : '<span class="text-slate-400">بدون نقاط بعد</span>';
          return `<div class="border-t border-slate-100 pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0 text-sm">
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold">${escapeHtml(p.teamA)} ${p.predScoreA} - ${p.predScoreB} ${escapeHtml(p.teamB)}${p.isDouble ? ' ⭐' : ''}${p.perfect ? ' 🃏' : ''}</span>
              <span>${pts}</span>
            </div>
            <div class="text-xs text-slate-400 mt-0.5">${fmtDateTime(p.kickoffAt)} ${finalHtml}</div>
            ${scorersHtml ? `<div class="text-xs mt-1"><span class="text-slate-500">هدافين: </span>${scorersHtml}</div>` : ''}
          </div>`;
        })
        .join('');

      const bonusHtml = rd.bonusAnswer
        ? `<div class="border-t border-slate-100 pt-2 mt-2 text-sm">
            <span class="text-slate-500">🎯 البونص:</span> ${escapeHtml(rd.bonusAnswer.choiceText || '—')}
            <span class="mx-1">| ${
              rd.bonusAnswer.points != null
                ? `<span class="font-bold ${ptsClass(rd.bonusAnswer.points)}">${rd.bonusAnswer.points} نقطة</span>`
                : '<span class="text-slate-400">بدون تصحيح</span>'
            }</span>
          </div>`
        : '';

      const adjustmentsHtml = rd.adjustments.length
        ? rd.adjustments
            .map(
              (a) => `<div class="border-t border-slate-100 pt-2 mt-2 text-sm flex items-center justify-between gap-2">
                <span class="text-slate-500">⚖️ ${escapeHtml(a.reason || 'تعديل يدوي')}</span>
                <span class="font-bold ${ptsClass(a.delta)}">${a.delta > 0 ? '+' : ''}${a.delta} نقطة</span>
              </div>`
            )
            .join('')
        : '';

      return `<div class="bg-white border border-slate-200 rounded-xl p-3 mb-3">
        <div class="flex items-center justify-between mb-1">
          <div class="font-bold">${escapeHtml(rd.roundName)} ${rd.locked ? '🔒' : '🟢'} ${rd.isFire ? '🔥' : ''}</div>
          <div class="font-bold ${ptsClass(rd.subtotal)}">${rd.subtotal} نقطة</div>
        </div>
        ${matchesHtml}
        ${bonusHtml}
        ${adjustmentsHtml}
      </div>`;
    })
    .join('');

  const noRoundAdjustmentsHtml = noRoundAdjustments.length
    ? `<div class="bg-white border border-slate-200 rounded-xl p-3 mb-3">
        <div class="font-bold mb-1">⚖️ تعديلات يدوية عامة (بدون جولة محددة)</div>
        ${noRoundAdjustments
          .map(
            (a) => `<div class="border-t border-slate-100 pt-2 mt-2 text-sm flex items-center justify-between gap-2">
              <span class="text-slate-500">${escapeHtml(a.reason || 'تعديل يدوي')}</span>
              <span class="font-bold ${ptsClass(a.delta)}">${a.delta > 0 ? '+' : ''}${a.delta} نقطة</span>
            </div>`
          )
          .join('')}
      </div>`
    : '';

  const jokerSection =
    jokersEarned.length || jokersAgainstThem.length
      ? `<div class="bg-white border border-slate-200 rounded-xl p-3 mb-3">
        <div class="font-bold mb-1">🃏 سجل الجوكر</div>
        ${
          jokersEarned.length
            ? jokersEarned
                .map(
                  (j) => `<div class="text-sm border-t border-slate-100 pt-1.5 mt-1.5 first:border-t-0 first:pt-0 first:mt-0">
                  كسب جوكر من مباراة ${escapeHtml(j.team_a)} × ${escapeHtml(j.team_b)} (${escapeHtml(j.roundName)})
                  — ${j.status === 'used' ? `استخدمه على ${escapeHtml(j.victimName || '—')}` : '<span class="text-purple-700 font-medium">متاح حالياً</span>'}
                </div>`
                )
                .join('')
            : '<div class="text-sm text-slate-400">ما كسب أي جوكر لحد الحين.</div>'
        }
        ${jokersAgainstThem
          .map(
            (j) => `<div class="text-sm border-t border-slate-100 pt-1.5 mt-1.5 text-rose-600">
              أُخذ منه جوكر من ${escapeHtml(j.attackerName)}${j.roundName ? ' (' + escapeHtml(j.roundName) + ')' : ''}
            </div>`
          )
          .join('')}
      </div>`
      : '';

  return `
    <a href="${backHref}" class="text-sm text-slate-500">${backLabel}</a>
    <div class="flex items-center justify-between mt-1 mb-4">
      <h1 class="text-xl font-bold">${escapeHtml(user.name)}</h1>
      <div class="text-left">
        <div class="text-xs text-slate-400">الإجمالي</div>
        <div class="text-xl font-bold ${ptsClass(grandTotal)}">${grandTotal}</div>
      </div>
    </div>
    ${noRoundAdjustmentsHtml}
    ${jokerSection}
    ${roundsHtml || `<div class="text-slate-400 text-sm py-8 text-center">هذا المشترك ما عنده أي توقعات أو نشاط بعد</div>`}
  `;
}

module.exports = { renderUserHistory };
