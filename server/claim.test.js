import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimFileFrom, normaliseClaim, readClaim, ownerKey, sessionLabel, holderLabel, takeoverMail, DEFAULT_CLAIM_FILE,
} from './claim.js';

test('an empty setting uses the default claim file', () => {
  assert.equal(claimFileFrom(''), DEFAULT_CLAIM_FILE);
});

test('a ~ path setting resolves against the home directory', () => {
  assert.equal(claimFileFrom('~/x/claim.json', '/home/me'), '/home/me/x/claim.json');
});

test('normaliseClaim keeps only known string fields', () => {
  const c = normaliseClaim({ awSessionId: 'a', extra: 'x', branch: 7 });
  assert.equal(c.extra, undefined);
  assert.equal(c.branch, '');
});

test('normaliseClaim refuses an array', () => {
  assert.equal(normaliseClaim([]), null);
});

test('readClaim treats an unreadable file as no claim', () => {
  assert.equal(readClaim('/nonexistent/claim.json'), null);
});

test('readClaim treats invalid JSON as no claim', () => {
  assert.equal(readClaim('f', { readFileSync: () => '{' }), null);
});

test('ownerKey prefers the Agent Wrangler card id', () => {
  assert.equal(ownerKey({ awSessionId: 'a', claudeSessionId: 'c' }), 'aw:a');
});

test('ownerKey falls back to the Claude session id', () => {
  assert.equal(ownerKey({ awSessionId: '', claudeSessionId: 'c' }), 'claude:c');
});

test('ownerKey counts a claim with no ids as the terminal', () => {
  assert.equal(ownerKey({ awSessionId: '', claudeSessionId: '' }), 'terminal');
});

test('ownerKey of no claim is null', () => {
  assert.equal(ownerKey(null), null);
});

test('sessionLabel prefers the card name', () => {
  assert.equal(sessionLabel({ name: 'Named', lastLabel: 'label', intent: 'intent' }), 'Named');
});

test('sessionLabel shortens a long first line of intent', () => {
  assert.equal(sessionLabel({ intent: `${'x'.repeat(80)}\nmore` }).length, 58);
});

test('holderLabel describes a Claude session outside the wrangler', () => {
  assert.match(holderLabel({ awSessionId: '', claudeSessionId: '1234567890' }, null), /outside Agent Wrangler \(12345678\)/);
});

test('takeoverMail tells the agent how to claim the cluster again', () => {
  assert.match(takeoverMail({ to: normaliseClaim({}), toLabel: '“B”' }), /kind-claim\.sh take/);
});
