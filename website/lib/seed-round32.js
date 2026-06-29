'use strict';
// Auto-loads the Round of 32 knockout matches (16 matches across 6 match
// days) once the bracket is fully known — i.e. once real team names have
// replaced FIFA's placeholder slot codes ("2A", "3C/D/F/G/H", etc.) that
// the public openfootball/worldcup.json feed still used as of 2026-06-29.
//
// Each matchup below was cross-checked against three independent sources
// on 2026-06-29: Al Jazeera's team-by-team qualification writeup, Yahoo
// Sports' full group-standings + Round of 32 schedule article, and the
// match-number/date/venue structure already in the openfootball feed that
// lib/livesync.js trusts for auto-grading. team1/team2 use the exact
// English spelling from that feed (same convention as
// GROUP_STAGE_MATCHES in lib/seed-schedule.js) and are listed in the same
// team1/team2 order the feed uses for each match number — this matters so
// livesync's `${teamAr(team1)}|||${teamAr(team2)}` lookup still lines up
// once the feed itself swaps the placeholder codes for real names.
//
// Unlike seedGroupStage() (which only runs against an empty DB), this
// runs against a DB that already holds real participants/predictions —
// so the guard below checks specifically for an existing "دور الـ٣٢"
// round instead of "any round at all", and is safe to leave running on
// every boot (re-deploys never duplicate these rounds).
const logic = require('./logic');
const { teamAr } = require('./teams-ar');
const { toUtcIso, arDate } = require('./seed-schedule');

const STAGE = 'دور الـ٣٢';

// { orderIndex, date: 'YYYY-MM-DD', matches: [{ time: 'HH:MM UTC±N', team1, team2 }] }
// One entry per real-world match day (mirrors the "one round per matchday"
// pattern already used for the group stage).
const ROUND32_DAYS = [
  {
    orderIndex: 18,
    date: '2026-06-28',
    matches: [
      { time: '12:00 UTC-7', team1: 'South Africa', team2: 'Canada' }, // M73 — SoFi Stadium, Inglewood
    ],
  },
  {
    orderIndex: 19,
    date: '2026-06-29',
    matches: [
      { time: '12:00 UTC-5', team1: 'Brazil', team2: 'Japan' },           // M76 — NRG Stadium, Houston
      { time: '16:30 UTC-4', team1: 'Germany', team2: 'Paraguay' },       // M74 — Gillette Stadium, Foxborough
      { time: '19:00 UTC-6', team1: 'Netherlands', team2: 'Morocco' },    // M75 — Estadio BBVA, Monterrey
    ],
  },
  {
    orderIndex: 20,
    date: '2026-06-30',
    matches: [
      { time: '12:00 UTC-5', team1: 'Ivory Coast', team2: 'Norway' },     // M78 — AT&T Stadium, Arlington
      { time: '17:00 UTC-4', team1: 'France', team2: 'Sweden' },          // M77 — MetLife Stadium, East Rutherford
      { time: '19:00 UTC-6', team1: 'Mexico', team2: 'Ecuador' },         // M79 — Estadio Azteca, Mexico City
    ],
  },
  {
    orderIndex: 21,
    date: '2026-07-01',
    matches: [
      { time: '12:00 UTC-4', team1: 'England', team2: 'DR Congo' },             // M80 — Mercedes-Benz Stadium, Atlanta
      { time: '13:00 UTC-7', team1: 'Belgium', team2: 'Senegal' },              // M82 — Lumen Field, Seattle
      { time: '17:00 UTC-7', team1: 'USA', team2: 'Bosnia & Herzegovina' },     // M81 — Levi's Stadium, Santa Clara
    ],
  },
  {
    orderIndex: 22,
    date: '2026-07-02',
    matches: [
      { time: '12:00 UTC-7', team1: 'Spain', team2: 'Austria' },          // M84 — SoFi Stadium, Inglewood
      { time: '19:00 UTC-4', team1: 'Portugal', team2: 'Croatia' },       // M83 — BMO Field, Toronto
      { time: '20:00 UTC-7', team1: 'Switzerland', team2: 'Algeria' },    // M85 — BC Place, Vancouver
    ],
  },
  {
    orderIndex: 23,
    date: '2026-07-03',
    matches: [
      { time: '13:00 UTC-5', team1: 'Australia', team2: 'Egypt' },        // M88 — AT&T Stadium, Arlington
      { time: '18:00 UTC-4', team1: 'Argentina', team2: 'Cape Verde' },   // M86 — Hard Rock Stadium, Miami Gardens
      { time: '20:30 UTC-5', team1: 'Colombia', team2: 'Ghana' },        // M87 — Arrowhead Stadium, Kansas City
    ],
  },
];

// Seeds the 6 Round-of-32 rounds/16 matches, unless a "دور الـ٣٢" round
// already exists (so this is safe to call on every boot without
// duplicating rounds on re-deploy).
function seedRound32() {
  const existing = logic.listRounds();
  if (existing.some((r) => r.stage === STAGE)) {
    return { ok: false, skipped: true, reason: 'فيه جولات دور الـ٣٢ موجودة بالفعل.' };
  }

  let totalMatches = 0;
  for (const day of ROUND32_DAYS) {
    const roundId = logic.createRound({
      name: `الجولة ${day.orderIndex} — ${arDate(day.date)} (${STAGE})`,
      stage: STAGE,
      orderIndex: day.orderIndex,
    });
    for (const m of day.matches) {
      logic.addMatch(roundId, teamAr(m.team1), teamAr(m.team2), toUtcIso(day.date, m.time));
      totalMatches++;
    }
  }

  return { ok: true, skipped: false, rounds: ROUND32_DAYS.length, matches: totalMatches };
}

module.exports = { seedRound32, ROUND32_DAYS, STAGE };
