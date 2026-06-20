'use strict';
const { normScorer } = require('./util');

// Bridges the Arabic/English mismatch in scorer-name matching: official
// results (admin-entered or auto-synced from the English results feed) are
// always in Latin script, but participants often write the scorer's name in
// Arabic. Each canonical key below is the player's English surname (the form
// that almost always appears in official scorer lists); the array lists
// Arabic spellings participants commonly use for that player.
//
// To add a player: pick any key (usually the surname, lowercase, no
// accents), and list the Arabic spelling(s) you've seen participants use.
// Spelling doesn't need to be exact — everything is normalized (extra
// spaces collapsed, lowercased) before comparison, same as the rest of the
// scorer-matching logic.
const PLAYER_ALIASES = {
  messi: ['ميسي', 'ميسى', 'ليونيل ميسي', 'ليو ميسي'],
  ronaldo: ['رونالدو', 'كريستيانو رونالدو', 'كريستيانو', 'سي رونالدو'],
  mbappe: ['مبابي', 'مبابى', 'كيليان مبابي', 'كيليان مبابى'],
  haaland: ['هالاند', 'إيرلينغ هالاند', 'ايرلينج هالاند', 'هاالاند'],
  neymar: ['نيمار', 'نيمار جونيور'],
  vinicius: ['فينيسيوس', 'فينيسيوس جونيور', 'فينسيوس', 'فينيسيوس جونيوور'],
  rodrygo: ['رودريغو', 'رودريجو'],
  bellingham: ['بيلينغهام', 'جود بيلينغهام', 'بيلينجهام', 'بيلينحهام'],
  kane: ['كين', 'هاري كين'],
  foden: ['فودين', 'فيل فودين'],
  saka: ['ساكا', 'بوكايو ساكا'],
  salah: ['صلاح', 'محمد صلاح'],
  lewandowski: ['ليفاندوفسكي', 'روبرت ليفاندوفسكي', 'ليفاندوسكي'],
  alvarez: ['ألفاريز', 'الفاريز', 'خوليان ألفاريز', 'خوليان الفاريز'],
  martinez: ['مارتينيز', 'لاوتارو مارتينيز', 'لوتارو مارتينيز'],
  griezmann: ['غريزمان', 'انطوان غريزمان', 'أنطوان غريزمان'],
  dembele: ['ديمبلي', 'عثمان ديمبلي', 'ديمبيلي'],
  modric: ['مودريتش', 'لوكا مودريتش', 'مودريش'],
  pedri: ['بيدري'],
  gavi: ['غافي', 'جافي'],
  yamal: ['يامال', 'لامين يامال'],
  musiala: ['موسيالا', 'جمال موسيالا'],
  wirtz: ['فيرتز', 'فلوريان فيرتز'],
  son: ['سون', 'سون هيونغ مين', 'سون هيونج مين'],
  davies: ['دافيز', 'ألفونسو دافيز', 'الفونسو دافيز'],
  pulisic: ['بوليسيتش', 'كريستيان بوليسيتش'],
  hakimi: ['حكيمي', 'أشرف حكيمي', 'اشرف حكيمي'],
  ennesyri: ['النصيري', 'يوسف النصيري'],
  bounou: ['بونو', 'ياسين بونو'],
  aldawsari: ['الدوسري', 'سالم الدوسري'],
  mahrez: ['محرز', 'رياض محرز'],
};

// Flattened lookup: every Arabic variant (normalized) -> canonical key.
// The canonical key also maps to itself so English-typed surnames benefit
// from the same resolution (e.g. "Messi" and "Lionel Messi" both resolve to
// "messi").
const ALIAS_LOOKUP = {};
for (const [key, variants] of Object.entries(PLAYER_ALIASES)) {
  ALIAS_LOOKUP[normScorer(key)] = key;
  for (const v of variants) {
    ALIAS_LOOKUP[normScorer(v)] = key;
  }
}

const CANONICAL_KEYS = Object.keys(PLAYER_ALIASES);

// Resolves a raw scorer name (Arabic alias, full English name, or surname
// only) to a stable canonical key whenever we recognize the player, so e.g.
// "ميسي" (predicted) and "Lionel Messi" (official record) compare equal.
// Falls back to the plain normalized text for any player not in the list
// above — identical to the matching behavior before this file existed.
function resolveScorerKey(raw) {
  const norm = normScorer(raw);
  if (ALIAS_LOOKUP[norm]) return ALIAS_LOOKUP[norm];
  for (const key of CANONICAL_KEYS) {
    if (new RegExp(`\\b${key}\\b`).test(norm)) return key;
  }
  return norm;
}

module.exports = { PLAYER_ALIASES, resolveScorerKey };
