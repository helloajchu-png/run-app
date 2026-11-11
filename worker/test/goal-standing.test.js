import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const file = join(dirname(fileURLToPath(import.meta.url)), '../../site/goal-standing.js');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(readFileSync(file, 'utf8') + '\nthis.goalStanding = goalStanding;', sandbox);
const { goalStanding } = sandbox;

test('half marathon 2:10:05 vs 2:10:00 is behind, not ahead', () => {
  const target = 2 * 3600 + 10 * 60;
  const predicted = target + 5;
  const standing = goalStanding(predicted, target);
  assert.equal(standing.status, 'behind');
  assert.equal(standing.label, '落後目標');
  assert.equal(standing.clock, '0:05');
  assert.equal(standing.gap, 5);
  assert.ok(standing.pct < 100);
  assert.equal(standing.pct, 99);
  assert.match(standing.slogan, /還沒到/);
});

test('ahead only when the rounded prediction is strictly faster', () => {
  const target = 2 * 3600 + 10 * 60;
  const ahead = goalStanding(target - 5, target);
  assert.equal(ahead.status, 'ahead');
  assert.equal(ahead.label, '領先目標');
  assert.equal(ahead.pct, 100);
  assert.equal(ahead.clock, '0:05');
  const even = goalStanding(target, target);
  assert.equal(even.status, 'even');
  assert.equal(even.label, '剛好達標');
  assert.equal(even.pct, 100);
});

test('rounding decides the sign, including a fraction of a second over the target', () => {
  const target = 7800;
  assert.equal(goalStanding(7804.6, target).status, 'behind');
  assert.equal(goalStanding(7799.6, target).status, 'even');
  assert.equal(goalStanding(7799.4, target).status, 'ahead');
});
