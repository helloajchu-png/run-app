import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function wrapD1(raw) {
  return {
    prepare(sql) {
      const build = params => ({
        async first() {
          const row = raw.prepare(sql).get(...params);
          return row === undefined ? null : row;
        },
        async all() {
          return { results: raw.prepare(sql).all(...params) };
        },
        async run() {
          const info = raw.prepare(sql).run(...params);
          return { success: true, meta: { changes: Number(info.changes || 0) } };
        },
      });
      return {
        bind(...params) { return build(params); },
        first() { return build([]).first(); },
        all() { return build([]).all(); },
        run() { return build([]).run(); },
      };
    },
  };
}

export async function createEnv() {
  const raw = new DatabaseSync(':memory:');
  for (const file of ['schema.sql', 'migrations/001_garmin_activities.sql', 'migrations/002_accounts.sql', 'migrations/003_goal_profiles.sql']) {
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
