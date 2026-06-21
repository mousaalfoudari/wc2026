'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');
const db = new DatabaseSync(DB_PATH);

try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch (e) {
  // Some mounted/network filesystems don't support WAL's shared memory mapping.
  // Fall back to the universally-compatible rollback journal mode.
  db.exec('PRAGMA journal_mode = DELETE;');
}
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  miss_streak INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  stage TEXT,
  order_index INTEGER NOT NULL,
  bonus_question TEXT,
  bonus_options TEXT,
  bonus_correct_index INTEGER,
  bonus_graded INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  team_a TEXT NOT NULL,
  team_b TEXT NOT NULL,
  kickoff_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  final_score_a INTEGER,
  final_score_b INTEGER,
  final_scorers_a TEXT,
  final_scorers_b TEXT,
  graded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  match_id INTEGER NOT NULL REFERENCES matches(id),
  pred_score_a INTEGER NOT NULL,
  pred_score_b INTEGER NOT NULL,
  pred_scorers_a TEXT NOT NULL DEFAULT '[]',
  pred_scorers_b TEXT NOT NULL DEFAULT '[]',
  points_earned INTEGER,
  is_double INTEGER NOT NULL DEFAULT 0,
  perfect INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, match_id)
);

CREATE TABLE IF NOT EXISTS round_picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  double_match_id INTEGER,
  UNIQUE(user_id, round_id)
);

CREATE TABLE IF NOT EXISTS bonus_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  choice_index INTEGER NOT NULL,
  points INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, round_id)
);

CREATE TABLE IF NOT EXISTS jokers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  earned_match_id INTEGER NOT NULL REFERENCES matches(id),
  earned_round_id INTEGER NOT NULL REFERENCES rounds(id),
  status TEXT NOT NULL DEFAULT 'available',
  used_against_user_id INTEGER,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  round_id INTEGER,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-team list of player names the admin curates, so participants pick a
-- scorer from a dropdown instead of typing a free-text name. Keyed by the
-- exact team name string used in matches.team_a/team_b.
CREATE TABLE IF NOT EXISTS team_rosters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name TEXT NOT NULL UNIQUE,
  players TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
