'use strict';
// Periodically pulls finished group-stage results from the public, keyless
// openfootball/worldcup.json feed and auto-grades matches that are still
// ungraded in our DB — so the admin doesn't have to type in every score.
//
// IMPORTANT caveat (tell the admin): this feed is maintained by hand and
// typically updates about once a day, not instantly/in-play. It's "live"
// in the sense of "no admin data entry needed", not "real-time minute by
// minute". Already-graded matches (including ones the admin entered
// manually) are never touched again.
const db = require('./db');
const logic = require('./logic');
const { teamAr } = require('./teams-ar');

const FEED_URL = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

async function fetchFeed() {
  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function extractNames(goals) {
  return (Array.isArray(goals) ? goals : []).map((g) => String((g && g.name) || '').trim()).filter(Boolean);
}

async function syncLiveResults() {
  let feed;
  try {
    feed = await fetchFeed();
  } catch (e) {
    console.error('livesync: فشل الاتصال بمصدر النتائج —', e.message);
    return { ok: false, error: e.message };
  }

  const feedMatches = Array.isArray(feed.matches) ? feed.matches : [];
  const byTeams = new Map();
  for (const m of feedMatches) {
    if (!m || !m.score || !m.score.ft) continue; // only fully-finished matches
    const key = `${teamAr(m.team1)}|||${teamAr(m.team2)}`;
    byTeams.set(key, m);
  }

  const pending = db.prepare('SELECT * FROM matches WHERE graded = 0').all();
  let updated = 0;
  const errors = [];
  for (const match of pending) {
    const feedMatch = byTeams.get(`${match.team_a}|||${match.team_b}`);
    if (!feedMatch) continue;
    const [finalA, finalB] = feedMatch.score.ft;
    const scorersA = extractNames(feedMatch.goals1);
    const scorersB = extractNames(feedMatch.goals2);
    try {
      logic.gradeMatch(match.id, finalA, finalB, scorersA, scorersB);
      updated++;
      console.log(`livesync: تم تصحيح ${match.team_a} ${finalA}-${finalB} ${match.team_b} أوتوماتيك ✅`);
    } catch (e) {
      errors.push({ matchId: match.id, error: e.message });
      console.error('livesync: فشل تصحيح المباراة', match.id, e.message);
    }
  }

  return { ok: true, updated, checked: pending.length, errors, checkedAt: new Date().toISOString() };
}

module.exports = { syncLiveResults, FEED_URL };
