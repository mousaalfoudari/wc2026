'use strict';
// Auto-loads the 72 group-stage matches of the World Cup 2026 on first boot,
// so the admin doesn't have to type every match by hand. Source data below
// (teams, dates, kickoff times) comes from the openfootball/worldcup.json
// public-domain dataset and is fixed/known in advance — no network call
// needed for the schedule itself (only results need a live fetch, see
// lib/livesync.js). Knockout-stage matches are intentionally NOT included
// here since their team names aren't decided yet (e.g. "Winner Group A").
const logic = require('./logic');
const { teamAr } = require('./teams-ar');

// { matchday, date: 'YYYY-MM-DD', time: 'HH:MM UTC±N', team1, team2 }
// team1/team2 use the exact English spelling from the source feed — this
// matters because lib/livesync.js looks up the same spelling when matching
// finished results back to these rows.
const GROUP_STAGE_MATCHES = [
  // Group A
  { matchday: 1, date: '2026-06-11', time: '13:00 UTC-6', team1: 'Mexico', team2: 'South Africa' },
  { matchday: 1, date: '2026-06-11', time: '20:00 UTC-6', team1: 'South Korea', team2: 'Czech Republic' },
  { matchday: 8, date: '2026-06-18', time: '12:00 UTC-4', team1: 'Czech Republic', team2: 'South Africa' },
  { matchday: 8, date: '2026-06-18', time: '19:00 UTC-6', team1: 'Mexico', team2: 'South Korea' },
  { matchday: 14, date: '2026-06-24', time: '19:00 UTC-6', team1: 'Czech Republic', team2: 'Mexico' },
  { matchday: 14, date: '2026-06-24', time: '19:00 UTC-6', team1: 'South Africa', team2: 'South Korea' },

  // Group B
  { matchday: 2, date: '2026-06-12', time: '15:00 UTC-4', team1: 'Canada', team2: 'Bosnia & Herzegovina' },
  { matchday: 3, date: '2026-06-13', time: '12:00 UTC-7', team1: 'Qatar', team2: 'Switzerland' },
  { matchday: 8, date: '2026-06-18', time: '12:00 UTC-7', team1: 'Switzerland', team2: 'Bosnia & Herzegovina' },
  { matchday: 8, date: '2026-06-18', time: '15:00 UTC-7', team1: 'Canada', team2: 'Qatar' },
  { matchday: 14, date: '2026-06-24', time: '12:00 UTC-7', team1: 'Switzerland', team2: 'Canada' },
  { matchday: 14, date: '2026-06-24', time: '12:00 UTC-7', team1: 'Bosnia & Herzegovina', team2: 'Qatar' },

  // Group C
  { matchday: 3, date: '2026-06-13', time: '18:00 UTC-4', team1: 'Brazil', team2: 'Morocco' },
  { matchday: 3, date: '2026-06-13', time: '21:00 UTC-4', team1: 'Haiti', team2: 'Scotland' },
  { matchday: 9, date: '2026-06-19', time: '18:00 UTC-4', team1: 'Scotland', team2: 'Morocco' },
  { matchday: 9, date: '2026-06-19', time: '20:30 UTC-4', team1: 'Brazil', team2: 'Haiti' },
  { matchday: 14, date: '2026-06-24', time: '18:00 UTC-4', team1: 'Scotland', team2: 'Brazil' },
  { matchday: 14, date: '2026-06-24', time: '18:00 UTC-4', team1: 'Morocco', team2: 'Haiti' },

  // Group D
  { matchday: 2, date: '2026-06-12', time: '18:00 UTC-7', team1: 'USA', team2: 'Paraguay' },
  { matchday: 3, date: '2026-06-13', time: '21:00 UTC-7', team1: 'Australia', team2: 'Turkey' },
  { matchday: 9, date: '2026-06-19', time: '12:00 UTC-7', team1: 'USA', team2: 'Australia' },
  { matchday: 9, date: '2026-06-19', time: '20:00 UTC-7', team1: 'Turkey', team2: 'Paraguay' },
  { matchday: 15, date: '2026-06-25', time: '19:00 UTC-7', team1: 'Turkey', team2: 'USA' },
  { matchday: 15, date: '2026-06-25', time: '19:00 UTC-7', team1: 'Paraguay', team2: 'Australia' },

  // Group E
  { matchday: 4, date: '2026-06-14', time: '12:00 UTC-5', team1: 'Germany', team2: 'Curaçao' },
  { matchday: 4, date: '2026-06-14', time: '19:00 UTC-4', team1: 'Ivory Coast', team2: 'Ecuador' },
  { matchday: 10, date: '2026-06-20', time: '16:00 UTC-4', team1: 'Germany', team2: 'Ivory Coast' },
  { matchday: 10, date: '2026-06-20', time: '19:00 UTC-5', team1: 'Ecuador', team2: 'Curaçao' },
  { matchday: 15, date: '2026-06-25', time: '16:00 UTC-4', team1: 'Curaçao', team2: 'Ivory Coast' },
  { matchday: 15, date: '2026-06-25', time: '16:00 UTC-4', team1: 'Ecuador', team2: 'Germany' },

  // Group F
  { matchday: 4, date: '2026-06-14', time: '15:00 UTC-5', team1: 'Netherlands', team2: 'Japan' },
  { matchday: 4, date: '2026-06-14', time: '20:00 UTC-6', team1: 'Sweden', team2: 'Tunisia' },
  { matchday: 10, date: '2026-06-20', time: '12:00 UTC-5', team1: 'Netherlands', team2: 'Sweden' },
  { matchday: 10, date: '2026-06-20', time: '22:00 UTC-6', team1: 'Tunisia', team2: 'Japan' },
  { matchday: 15, date: '2026-06-25', time: '18:00 UTC-5', team1: 'Japan', team2: 'Sweden' },
  { matchday: 15, date: '2026-06-25', time: '18:00 UTC-5', team1: 'Tunisia', team2: 'Netherlands' },

  // Group G
  { matchday: 5, date: '2026-06-15', time: '12:00 UTC-7', team1: 'Belgium', team2: 'Egypt' },
  { matchday: 5, date: '2026-06-15', time: '18:00 UTC-7', team1: 'Iran', team2: 'New Zealand' },
  { matchday: 11, date: '2026-06-21', time: '12:00 UTC-7', team1: 'Belgium', team2: 'Iran' },
  { matchday: 11, date: '2026-06-21', time: '18:00 UTC-7', team1: 'New Zealand', team2: 'Egypt' },
  { matchday: 16, date: '2026-06-26', time: '20:00 UTC-7', team1: 'Egypt', team2: 'Iran' },
  { matchday: 16, date: '2026-06-26', time: '20:00 UTC-7', team1: 'New Zealand', team2: 'Belgium' },

  // Group H
  { matchday: 5, date: '2026-06-15', time: '12:00 UTC-4', team1: 'Spain', team2: 'Cape Verde' },
  { matchday: 5, date: '2026-06-15', time: '18:00 UTC-4', team1: 'Saudi Arabia', team2: 'Uruguay' },
  { matchday: 11, date: '2026-06-21', time: '12:00 UTC-4', team1: 'Spain', team2: 'Saudi Arabia' },
  { matchday: 11, date: '2026-06-21', time: '18:00 UTC-4', team1: 'Uruguay', team2: 'Cape Verde' },
  { matchday: 16, date: '2026-06-26', time: '19:00 UTC-5', team1: 'Cape Verde', team2: 'Saudi Arabia' },
  { matchday: 16, date: '2026-06-26', time: '18:00 UTC-6', team1: 'Uruguay', team2: 'Spain' },

  // Group I
  { matchday: 6, date: '2026-06-16', time: '15:00 UTC-4', team1: 'France', team2: 'Senegal' },
  { matchday: 6, date: '2026-06-16', time: '18:00 UTC-4', team1: 'Iraq', team2: 'Norway' },
  { matchday: 12, date: '2026-06-22', time: '17:00 UTC-4', team1: 'France', team2: 'Iraq' },
  { matchday: 12, date: '2026-06-22', time: '20:00 UTC-4', team1: 'Norway', team2: 'Senegal' },
  { matchday: 16, date: '2026-06-26', time: '15:00 UTC-4', team1: 'Norway', team2: 'France' },
  { matchday: 16, date: '2026-06-26', time: '15:00 UTC-4', team1: 'Senegal', team2: 'Iraq' },

  // Group J
  { matchday: 6, date: '2026-06-16', time: '20:00 UTC-5', team1: 'Argentina', team2: 'Algeria' },
  { matchday: 6, date: '2026-06-16', time: '21:00 UTC-7', team1: 'Austria', team2: 'Jordan' },
  { matchday: 12, date: '2026-06-22', time: '12:00 UTC-5', team1: 'Argentina', team2: 'Austria' },
  { matchday: 12, date: '2026-06-22', time: '20:00 UTC-7', team1: 'Jordan', team2: 'Algeria' },
  { matchday: 17, date: '2026-06-27', time: '21:00 UTC-5', team1: 'Algeria', team2: 'Austria' },
  { matchday: 17, date: '2026-06-27', time: '21:00 UTC-5', team1: 'Jordan', team2: 'Argentina' },

  // Group K
  { matchday: 7, date: '2026-06-17', time: '12:00 UTC-5', team1: 'Portugal', team2: 'DR Congo' },
  { matchday: 7, date: '2026-06-17', time: '20:00 UTC-6', team1: 'Uzbekistan', team2: 'Colombia' },
  { matchday: 13, date: '2026-06-23', time: '12:00 UTC-5', team1: 'Portugal', team2: 'Uzbekistan' },
  { matchday: 13, date: '2026-06-23', time: '20:00 UTC-6', team1: 'Colombia', team2: 'DR Congo' },
  { matchday: 17, date: '2026-06-27', time: '19:30 UTC-4', team1: 'Colombia', team2: 'Portugal' },
  { matchday: 17, date: '2026-06-27', time: '19:30 UTC-4', team1: 'DR Congo', team2: 'Uzbekistan' },

  // Group L
  { matchday: 7, date: '2026-06-17', time: '15:00 UTC-5', team1: 'England', team2: 'Croatia' },
  { matchday: 7, date: '2026-06-17', time: '19:00 UTC-4', team1: 'Ghana', team2: 'Panama' },
  { matchday: 13, date: '2026-06-23', time: '16:00 UTC-4', team1: 'England', team2: 'Ghana' },
  { matchday: 13, date: '2026-06-23', time: '19:00 UTC-4', team1: 'Panama', team2: 'Croatia' },
  { matchday: 17, date: '2026-06-27', time: '17:00 UTC-4', team1: 'Panama', team2: 'England' },
  { matchday: 17, date: '2026-06-27', time: '17:00 UTC-4', team1: 'Croatia', team2: 'Ghana' },
];

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function arDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d} ${AR_MONTHS[m - 1]}`;
}

// "13:00 UTC-6" -> ISO UTC datetime string for that date.
function toUtcIso(date, time) {
  const m = /^(\d{2}):(\d{2})\s+UTC([+-]\d+)$/.exec(String(time).trim());
  if (!m) throw new Error('وقت غير متوقع: ' + time);
  const [, hh, mm, offRaw] = m;
  const offset = parseInt(offRaw, 10);
  // Treat the wall-clock numbers as UTC first (arithmetic trick), then
  // shift by the offset: local = UTC + offset  =>  UTC = local - offset.
  const asIfUtc = new Date(`${date}T${hh}:${mm}:00Z`);
  const utcMs = asIfUtc.getTime() - offset * 60 * 60 * 1000;
  return new Date(utcMs).toISOString();
}

// Seeds the 72 group-stage matches into 17 rounds (one per "matchday"),
// only if no rounds exist yet. Safe to call on every boot.
function seedGroupStage() {
  if (logic.listRounds().length > 0) {
    return { ok: false, skipped: true, reason: 'فيه جولات موجودة بالفعل.' };
  }

  const byMatchday = new Map();
  for (const m of GROUP_STAGE_MATCHES) {
    if (!byMatchday.has(m.matchday)) byMatchday.set(m.matchday, []);
    byMatchday.get(m.matchday).push(m);
  }

  let totalMatches = 0;
  for (const md of [...byMatchday.keys()].sort((a, b) => a - b)) {
    const matches = byMatchday.get(md);
    const roundId = logic.createRound({
      name: `الجولة ${md} — ${arDate(matches[0].date)} (دور المجموعات)`,
      stage: 'دور المجموعات',
      orderIndex: md,
    });
    for (const m of matches) {
      logic.addMatch(roundId, teamAr(m.team1), teamAr(m.team2), toUtcIso(m.date, m.time));
      totalMatches++;
    }
  }

  return { ok: true, skipped: false, rounds: byMatchday.size, matches: totalMatches };
}

module.exports = { seedGroupStage, GROUP_STAGE_MATCHES, toUtcIso, arDate };
