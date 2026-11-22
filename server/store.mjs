import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function openStore(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, password TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0, victories INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), expires INTEGER NOT NULL, seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), text TEXT NOT NULL, sent INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, host INTEGER NOT NULL REFERENCES players(id), guest INTEGER NOT NULL REFERENCES players(id),
      status TEXT NOT NULL, deadline INTEGER NOT NULL, battle TEXT, host_orders TEXT, guest_orders TEXT
    );
    CREATE INDEX IF NOT EXISTS active_sessions ON sessions(seen, expires);
    CREATE INDEX IF NOT EXISTS player_sessions ON sessions(player_id);
    CREATE INDEX IF NOT EXISTS host_rooms ON rooms(host, status);
    CREATE INDEX IF NOT EXISTS guest_rooms ON rooms(guest, status);
  `)
  return {
    get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}
