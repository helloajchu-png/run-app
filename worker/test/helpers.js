import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function wrapD1(raw) {
  return {
    prepare(sql) {
      const make = params => ({
        __sql: sql,
        __params: params,
        bind(...next) { return make(next); },
        async first() {
          const row = raw.prepare(sql).get(...params);
          return row === undefined ? null : row;
        },
        async all() {
          return { results: raw.prepare(sql).all(...params) };
        },
        async run() {
          const info = raw.prepare(sql).run(...params);
          return { success: true, meta: { changes: Number(info.changes || 0) }, results: [] };
        },
      });
      return make([]);
    },
    async batch(statements) {
      if (!Array.isArray(statements) || !statements.length) throw new Error('D1 batch requires statements');
      raw.exec('BEGIN');
      try {
        const results = [];
        for (const stmt of statements) {
          if (!stmt || !stmt.__sql) throw new Error('batch statement is missing SQL');
          const info = raw.prepare(stmt.__sql).run(...(stmt.__params || []));
          results.push({ success: true, meta: { changes: Number(info.changes || 0) }, results: [] });
        }
        raw.exec('COMMIT');
        return results;
      } catch (err) {
        try { raw.exec('ROLLBACK'); } catch { /* the transaction is already closed */ }
        throw err;
      }
    },
  };
}

export async function createEnv() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const file of ['schema.sql', 'migrations/001_garmin_activities.sql', 'migrations/002_accounts.sql', 'migrations/003_goal_profiles.sql', 'migrations/004_cross_training.sql']) {
    raw.exec(readFileSync(join(root, file), 'utf8'));
  }
  return {
    raw,
    DB: wrapD1(raw),
    GARMIN_CONSUMER_KEY: 'test-consumer-key',
    GARMIN_CONSUMER_SECRET: 'test-consumer-secret',
    close() { raw.close(); },
  };
}

export async function call(env, path, { method = 'GET', token = '', body, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined && !requestHeaders.has('Content-Type')) requestHeaders.set('Content-Type', 'application/json');
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);
  const request = new Request('https://run-app-api.helloajchu.workers.dev' + path, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await worker.fetch(request, env);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: response.status, data, headers: response.headers };
}
