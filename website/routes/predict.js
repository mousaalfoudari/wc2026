'use strict';
const { layout, redirect, escapeHtml, lockCountdownHtml } = require('../lib/render');
const { sendHtml } = require('../lib/http');
const { requireUser } = require('../lib/guard');
const { toArray, fmtDateTime, safeJsonParse } = require('../lib/util');
const logic = require('../lib/logic');
const db = require('../lib/db');

function roundPicker(rounds, currentId) {
  const opts = rounds
    .map((r) => {
      const icon = r.matches.length === 0 ? '⚪' : r.locked ? '🔒' : '🟢';
      return `<option value="${r.id}" ${r.id === currentId ? 'selected' : ''}>${icon} ${escapeHtml(r.name)}</option>`;
    })
    .join('');
  return `<select onchange="location.href='/predict?round='+this.value" class="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full mb-4 bg-white">${opts}</select>`;
}

// Shown only before a match is graded — once the real result is in, the
// predicted lineup is no longer relevant. Uploaded/managed by the admin via
// lineupAdminBlock() in routes/admin.js (one image per team); served by
// GET /lineups/:filename. Renders side by side; if only one team's image
// was uploaded, shows just that one.
function lineupImageHtml(match) {
  const a = match.lineup_image_a;
  const b = match.lineup_image_b;
  if (!a && !b) return '';
  const col = (filename, teamName) =>
    filename
      ? `<div class="flex-1 min-w-0">
          <div class="text-[10px] text-slate-400 mb-1 text-center">${escapeHtml(teamName)}</div>
          <img src="/lineups/${escapeHtml(filename)}" class="w-full rounded-lg border border-slate-100" />
        </div>`
      : '';
  return `<div class="mb-2">
    <div class="text-[11px] text-slate-400 mb-1">📋 التشكيلة المتوقعة (تقديرية)</div>
    <div class="flex gap-2">
      ${col(a, match.team_a)}
      ${col(b, match.team_b)}
    </div>
  </div>`;
}

function matchCard(match, prediction, eligibleDoubleIds, doublePickId, locked) {
  const id = match.id;
  const already = !!prediction;
  const teamRow = `<div class="flex items-center justify-between text-sm text-slate-400 mb-2">
      <span>${fmtDateTime(match.kickoff_at)}</span>
      ${eligibleDoubleIds.has(id) ? `<span class="text-amber-600 font-medium">${doublePickId === id ? '⭐ مباراة الدبل' : ''}</span>` : ''}
    </div>`;

  if (match.graded) {
    const finalScorersA = safeJsonParse(match.final_scorers_a, []);
    const finalScorersB = safeJsonParse(match.final_scorers_b, []);
    const predBlock = already
      ? `<div class="mt-2 text-sm text-slate-600">توقعك: ${prediction.pred_score_a} - ${prediction.pred_score_b}
          ${prediction.pred_scorers_a && JSON.parse(prediction.pred_scorers_a).length ? ' | ' + JSON.parse(prediction.pred_scorers_a).join('، ') : ''}
          ${prediction.pred_scorers_b && JSON.parse(prediction.pred_scorers_b).length ? ' - ' + JSON.parse(prediction.pred_scorers_b).join('، ') : ''}
          <div class="mt-1 font-bold ${prediction.points_earned > 0 ? 'text-emerald-600' : prediction.points_earned < 0 ? 'text-rose-600' : 'text-slate-500'}">
            النقاط: ${prediction.points_earned ?? 0} ${prediction.is_double ? '(دبل ✅)' : ''} ${prediction.perfect ? '🃏 جوكر!' : ''}
          </div>
        </div>`
      : `<div class="mt-2 text-sm text-rose-500">ما توقعت هذي المباراة.</div>`;
    return `<div class="bg-white border border-slate-200 rounded-xl p-4 mb-3">
      ${teamRow}
      <div class="flex items-center justify-center gap-4 text-lg font-bold">
        <span>${escapeHtml(match.team_a)}</span>
        <span class="bg-slate-100 rounded-lg px-3 py-1">${match.final_score_a} - ${match.final_score_b}</span>
        <span>${escapeHtml(match.team_b)}</span>
      </div>
      ${finalScorersA.length || finalScorersB.length ? `<div class="text-center text-xs text-slate-400 mt-1">الهدافين: ${[...finalScorersA, ...finalScorersB].map(escapeHtml).join('، ')}</div>` : ''}
      ${predBlock}
    </div>`;
  }

  if (already) {
    return `<div class="bg-white border border-slate-200 rounded-xl p-4 mb-3">
      ${teamRow}
      ${lineupImageHtml(match)}
      <div class="flex items-center justify-center gap-4 text-lg font-bold">
        <span>${escapeHtml(match.team_a)}</span>
        <span class="bg-emerald-50 text-emerald-700 rounded-lg px-3 py-1">${prediction.pred_score_a} - ${prediction.pred_score_b}</span>
        <span>${escapeHtml(match.team_b)}</span>
      </div>
      <div class="text-center text-xs text-emerald-600 mt-2">✅ تم إرسال توقعك، بانتظار النتيجة.</div>
    </div>`;
  }

  if (locked) {
    return `<div class="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-3 opacity-70">
      ${teamRow}
      <div class="flex items-center justify-center gap-4 text-lg font-bold text-slate-400">
        <span>${escapeHtml(match.team_a)}</span><span>vs</span><span>${escapeHtml(match.team_b)}</span>
      </div>
      <div class="text-center text-xs text-rose-500 mt-2">🔒 فاتك وقت التوقع لهذي المباراة.</div>
    </div>`;
  }

  const rosterA = logic.getRoster(match.team_a);
  const rosterB = logic.getRoster(match.team_b);
  return `<form method="post" action="/predict/match/${id}" class="bg-white border border-slate-200 rounded-xl p-4 mb-3">
    ${teamRow}
    ${lineupImageHtml(match)}
    <div class="flex items-center justify-center gap-3">
      <span class="font-bold">${escapeHtml(match.team_a)}</span>
      <input type="number" min="0" max="20" name="score_a" required class="score-input w-16 text-center border border-slate-300 rounded-lg py-1.5" data-target="scorers-a-${id}" data-team="${escapeHtml(match.team_a)}" data-field="scorers_a_${id}" data-players="${escapeHtml(JSON.stringify(rosterA))}" />
      <span class="text-slate-400">-</span>
      <input type="number" min="0" max="20" name="score_b" required class="score-input w-16 text-center border border-slate-300 rounded-lg py-1.5" data-target="scorers-b-${id}" data-team="${escapeHtml(match.team_b)}" data-field="scorers_b_${id}" data-players="${escapeHtml(JSON.stringify(rosterB))}" />
      <span class="font-bold">${escapeHtml(match.team_b)}</span>
    </div>
    <div id="scorers-a-${id}" class="flex flex-wrap gap-2 justify-center mt-3"></div>
    <div id="scorers-b-${id}" class="flex flex-wrap gap-2 justify-center mt-1"></div>
    ${
      eligibleDoubleIds.has(id)
        ? doublePickId == null
          ? `<label class="flex items-center justify-center gap-2 mt-3 p-2 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800 cursor-pointer">
              <input type="checkbox" name="set_double_${id}" value="1" />
              ⭐ اعتبرها مباراة الدبل (نقاطها تتضاعف) — مباراة واحدة فقط بكل الجولة
            </label>`
          : `<div class="flex items-center justify-center gap-2 mt-3 p-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-400">
              🔒 مباراة الدبل لهذي الجولة محددة بالفعل على مباراة ثانية (أول مباراة ترسل توقعها وتحدد عليها الخيار هي اللي تثبت)
            </div>`
        : ''
    }
    <button class="w-full mt-3 bg-emerald-600 text-white rounded-lg py-2 font-bold hover:bg-emerald-700">إرسال التوقع (لا يمكن تعديله بعد الإرسال)</button>
  </form>`;
}

function bonusSection(round, user, answer) {
  if (!round.bonus_question) return '';
  if (round.locked) {
    if (!answer) return `<div class="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 text-sm text-slate-500">سؤال البونص: ${escapeHtml(round.bonus_question)} — ما جاوبت عليه.</div>`;
    const correct = round.bonus_correct_index;
    const yourChoice = round.bonus_options[answer.choice_index] || '';
    return `<div class="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 text-sm">
      <div class="font-medium mb-1">سؤال البونص: ${escapeHtml(round.bonus_question)}</div>
      <div>جوابك: ${escapeHtml(yourChoice)} ${answer.points != null ? `<span class="font-bold ${answer.points > 0 ? 'text-emerald-600' : 'text-rose-600'}">(${answer.points > 0 ? '+' : ''}${answer.points} نقاط)</span>` : '<span class="text-slate-400">(بانتظار التصحيح)</span>'}</div>
    </div>`;
  }
  if (answer) {
    return `<div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-sm text-amber-700">✅ جاوبت على سؤال البونص: ${escapeHtml(round.bonus_options[answer.choice_index] || '')}</div>`;
  }
  const opts = round.bonus_options
    .map((opt, i) => `<label class="flex items-center gap-2"><input type="radio" name="choice_index" value="${i}" required /> ${escapeHtml(opt)}</label>`)
    .join('');
  return `<form method="post" action="/predict/round/${round.id}/bonus" class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
    <div class="font-bold text-amber-800 mb-2">⭐ سؤال البونص (٧+ صح / ٧- غلط)</div>
    <div class="mb-2">${escapeHtml(round.bonus_question)}</div>
    <div class="flex flex-col gap-2 mb-3">${opts}</div>
    <button class="bg-amber-600 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-amber-700">إرسال الجواب</button>
  </form>`;
}

function jokerBanner(jokers, currentUserId) {
  if (!jokers.length) return '';
  // Players already hit by a joker this round are off-limits to everyone
  // (including the same attacker) until the next round opens — see
  // jokerVictimLockedThisRound in lib/logic.js. Hiding them here is just UX;
  // the real enforcement is server-side in useJoker.
  const lockedIds = logic.jokerLockedTargetIdsThisRound();
  const targets = logic
    .leaderboard()
    .filter((u) => u.id !== currentUserId && u.total >= 5 && !lockedIds.has(u.id));

  return jokers
    .map((j) => {
      if (!targets.length) {
        return `<div class="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-4 text-sm text-purple-700">🃏 عندك جوكر متاح! بس ما فيه حالياً لاعب عنده ٥ نقاط أو أكثر تاخذ منه (أو كل من ينطبق عليه الشرط أُخذ منه جوكر بالفعل هذي الجولة).</div>`;
      }
      const opts = targets.map((t) => `<option value="${t.id}">${escapeHtml(t.name)} (${t.total} نقطة)</option>`).join('');
      return `<form method="post" action="/joker/${j.id}/use" class="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-4">
        <div class="font-bold text-purple-800 mb-2">🃏 عندك جوكر متاح! استخدمه الحين (ما يصير تأجيله)</div>
        <div class="flex gap-2">
          <select name="target_user_id" class="flex-1 border border-purple-300 rounded-lg px-2 py-1.5 text-sm">${opts}</select>
          <button class="bg-purple-600 text-white rounded-lg px-4 py-1.5 text-sm font-bold hover:bg-purple-700">خذ ٥ نقاط</button>
        </div>
      </form>`;
    })
    .join('');
}

module.exports = function (router) {
  router.get('/predict', async (req, res) => {
    if (!requireUser(req, res)) return;
    const rounds = logic.listRounds();

    if (!rounds.length) {
      sendHtml(
        res,
        layout({
          title: 'توقعاتي',
          user: req.user,
          active: 'predict',
          msg: req.flashMsg,
          msgType: req.flashType,
          body: `<div class="text-center py-16 text-slate-500">لا توجد جولات بعد، الأدمن لسا ما ضاف مباريات.</div>`,
        })
      );
      return;
    }

    const openRounds = rounds.filter((r) => !r.locked && r.matches.length > 0);
    let currentId = req.query.round ? Number(req.query.round) : null;
    if (!currentId) currentId = openRounds.length ? openRounds[0].id : rounds[rounds.length - 1].id;
    const round = logic.getRound(currentId) || rounds[0];

    const predictions = logic.getUserPredictionsForRound(req.user.id, round.id);
    const eligibleDoubleIds = logic.doubleEligibleMatchIds(round.id);
    const doublePickId = logic.activeDoubleMatchId(req.user.id, round.id);
    const bonusAns = logic.getBonusAnswer(req.user.id, round.id);
    const jokers = logic.getAvailableJokers(req.user.id);

    const frozenNotice =
      req.user.status === 'frozen'
        ? `<div class="bg-rose-50 border border-rose-200 rounded-xl p-4 mb-4 text-sm text-rose-700">❄️ حسابك مجمّد، ما يمكنك تسجيل توقعات جديدة. تواصل مع الأدمن لو تبي توضيح.</div>`
        : '';

    const cards = round.matches
      .map((m) => matchCard(m, predictions[m.id], eligibleDoubleIds, doublePickId, round.locked))
      .join('');

    const body = `
      ${roundPicker(rounds, round.id)}
      <h2 class="text-lg font-bold mb-1">${escapeHtml(round.name)} ${round.locked ? '🔒 مقفولة' : '🟢 مفتوحة'}</h2>
      ${lockCountdownHtml(round)}
      ${
        // Only reveal the fiery badge to participants once the round is
        // locked (deadline passed, no more new predictions) — this way the
        // admin can flag a round as fiery at any point, even before or
        // during the open prediction window, without tipping anyone off
        // early. Before locking, this stays a surprise; on the admin side
        // (routes/admin.js roundManage) the 🔥 status is always visible.
        round.is_fire && round.locked
          ? `<div class="bg-orange-50 border border-orange-300 rounded-xl p-3 mb-4 text-sm text-orange-700 font-bold">🔥 جولة نارية! كل توقع صحيح بهذي الجولة ياخذ ضعف النقاط.</div>`
          : ''
      }
      ${frozenNotice}
      ${req.user.status !== 'frozen' ? jokerBanner(jokers, req.user.id) : ''}
      ${cards}
      ${bonusSection(round, req.user, bonusAns)}
    `;

    sendHtml(
      res,
      layout({
        title: 'توقعاتي',
        user: req.user,
        active: 'predict',
        msg: req.flashMsg,
        msgType: req.flashType,
        body,
      })
    );
  });

  router.post('/predict/match/:matchId', async (req, res) => {
    if (!requireUser(req, res)) return;
    const matchId = Number(req.params.matchId);
    const match = logic.getMatch(matchId);
    if (!match) return redirect(res, '/predict', 'المباراة غير موجودة.', 'error');

    const round = logic.getRound(match.round_id);
    if (req.user.status === 'frozen') return redirect(res, `/predict?round=${round.id}`, 'حسابك مجمّد، ما يمكنك التوقع.', 'error');
    if (round.locked) return redirect(res, `/predict?round=${round.id}`, 'فاتك وقت التوقع لهذي الجولة.', 'error');
    if (logic.getUserPrediction(req.user.id, matchId)) return redirect(res, `/predict?round=${round.id}`, 'توقعت هذي المباراة من قبل.', 'error');

    const scoreA = parseInt(req.body.score_a, 10);
    const scoreB = parseInt(req.body.score_b, 10);
    if (Number.isNaN(scoreA) || Number.isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
      return redirect(res, `/predict?round=${round.id}`, 'النتيجة غير صحيحة.', 'error');
    }
    const scorersA = toArray(req.body[`scorers_a_${matchId}`] || req.body.scorers_a).filter((s) => s && s.trim()).slice(0, scoreA);
    const scorersB = toArray(req.body[`scorers_b_${matchId}`] || req.body.scorers_b).filter((s) => s && s.trim()).slice(0, scoreB);

    // Scorer names are mandatory for every goal predicted — e.g. predicting
    // 2-1 means picking exactly 2 names for team A and 1 for team B. A 0-0
    // prediction needs none (both counts are already 0), so it passes this
    // check automatically.
    if (scorersA.length !== scoreA || scorersB.length !== scoreB) {
      return redirect(res, `/predict?round=${round.id}`, 'لازم تحدد اسم الهداف لكل هدف بالنتيجة المتوقعة (إلا إذا توقعت ٠-٠).', 'error');
    }

    logic.submitPrediction(req.user.id, matchId, scoreA, scoreB, scorersA, scorersB);

    if (req.body[`set_double_${matchId}`] === '1') {
      const eligible = logic.doubleEligibleMatchIds(round.id);
      if (eligible.has(matchId)) logic.setDoublePick(req.user.id, round.id, matchId);
    }

    redirect(res, `/predict?round=${round.id}`, 'تم تسجيل توقعك ✅');
  });

  router.post('/predict/round/:roundId/bonus', async (req, res) => {
    if (!requireUser(req, res)) return;
    const roundId = Number(req.params.roundId);
    const round = logic.getRound(roundId);
    if (!round) return redirect(res, '/predict', 'الجولة غير موجودة.', 'error');
    if (req.user.status === 'frozen') return redirect(res, `/predict?round=${roundId}`, 'حسابك مجمّد.', 'error');
    if (round.locked) return redirect(res, `/predict?round=${roundId}`, 'فاتك وقت سؤال البونص.', 'error');

    const choiceIndex = parseInt(req.body.choice_index, 10);
    if (Number.isNaN(choiceIndex)) return redirect(res, `/predict?round=${roundId}`, 'اختر إجابة.', 'error');

    const ok = logic.submitBonusAnswer(req.user.id, roundId, choiceIndex);
    redirect(res, `/predict?round=${roundId}`, ok ? 'تم إرسال جوابك على سؤال البونص ✅' : 'جاوبت على السؤال من قبل.', ok ? 'ok' : 'error');
  });

  router.post('/joker/:jokerId/use', async (req, res) => {
    if (!requireUser(req, res)) return;
    const jokerId = Number(req.params.jokerId);
    const targetUserId = Number(req.body.target_user_id);
    const result = logic.useJoker(jokerId, req.user.id, targetUserId);
    redirect(res, '/predict', result.ok ? 'تم استخدام الجوكر، أخذت ٥ نقاط 🃏' : result.error, result.ok ? 'ok' : 'error');
  });
};
