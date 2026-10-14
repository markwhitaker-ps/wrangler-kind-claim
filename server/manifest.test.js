import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import manifest, { createWatcher, RESEND_MS } from './manifest.js';
import { ClaimStore } from './store.js';

function setup({ sessions = {}, settings = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-claim-'));
  const claimFile = path.join(tmp, 'claim.json');
  const sent = [];
  const mail = [];
  const host = {
    settings: { get: (k) => ({ claimFile, ...settings })[k] },
    sessions: { get: (id) => sessions[id] ?? null },
    stores: { kindClaim: new ClaimStore({ file: path.join(tmp, 'state.json') }) },
    broadcast: (p) => sent.push(p),
    mail: { send: (to, text) => mail.push({ to, text }) },
    log: () => {},
  };
  const claim = (fields) => fs.writeFileSync(claimFile, JSON.stringify({ claimedAt: '2026-10-14T13:00:00Z', ...fields }));
  return { tmp, claimFile, host, sent, mail, claim };
}

const A = { sessionId: 'card-a', name: 'Fix tabs', archived: false };
const B = { sessionId: 'card-b', name: 'Agentic test work', archived: false };

test('manifest declares the capabilities its package.json does', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.requires, pkg.wranglerExtension.requires);
  assert.equal(manifest.id, pkg.wranglerExtension.id);
});

test('no claim file broadcasts a null claim once', () => {
  const { host, sent } = setup();
  const w = createWatcher();
  w.poll(host);
  w.poll(host);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].claim, null);
});

test('a claim by a board card is broadcast with its card name', () => {
  const { host, sent, claim } = setup({ sessions: { 'card-a': A } });
  claim({ awSessionId: 'card-a', branch: 'main' });
  createWatcher().poll(host);
  assert.equal(sent[0].claim.awSessionId, 'card-a');
  assert.equal(sent[0].claim.onBoard, true);
  assert.equal(sent[0].claim.holder, '“Fix tabs”');
});

test('the first claim is not a takeover', () => {
  const { host, sent, mail, claim } = setup({ sessions: { 'card-a': A } });
  claim({ awSessionId: 'card-a' });
  createWatcher().poll(host);
  assert.equal(sent[0].takeover, undefined);
  assert.equal(mail.length, 0);
});

test('a takeover mails the session that lost the cluster', () => {
  const { host, mail, claim } = setup({ sessions: { 'card-a': A, 'card-b': B } });
  const w = createWatcher();
  claim({ awSessionId: 'card-a' });
  w.poll(host);
  claim({ awSessionId: 'card-b', purpose: 'redeploy web-server', claimedAt: '2026-10-14T14:00:00Z' });
  w.poll(host);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'card-a');
  assert.match(mail[0].text, /taken over by another session: “Agentic test work”/);
  assert.match(mail[0].text, /redeploy web-server/);
});

test('a takeover broadcasts a notice naming both sessions', () => {
  const { host, sent, claim } = setup({ sessions: { 'card-a': A, 'card-b': B } });
  const w = createWatcher();
  claim({ awSessionId: 'card-a' });
  w.poll(host);
  claim({ awSessionId: 'card-b', claimedAt: '2026-10-14T14:00:00Z' });
  w.poll(host);
  assert.equal(sent.at(-1).takeover.body, '“Agentic test work” took the cluster from “Fix tabs”.');
});

test('a release then a new claim is not a takeover', () => {
  const { host, claimFile, mail, sent, claim } = setup({ sessions: { 'card-a': A, 'card-b': B } });
  const w = createWatcher();
  claim({ awSessionId: 'card-a' });
  w.poll(host);
  fs.unlinkSync(claimFile);
  w.poll(host);
  claim({ awSessionId: 'card-b' });
  w.poll(host);
  assert.equal(mail.length, 0);
  assert.ok(sent.every((f) => !f.takeover));
});

test('the same session claiming again is not a takeover', () => {
  const { host, mail, claim } = setup({ sessions: { 'card-a': A } });
  const w = createWatcher();
  claim({ awSessionId: 'card-a' });
  w.poll(host);
  claim({ awSessionId: 'card-a', claimedAt: '2026-10-14T15:00:00Z' });
  w.poll(host);
  assert.equal(mail.length, 0);
});

test('an archived previous holder gets no mail', () => {
  const { host, mail, claim } = setup({ sessions: { 'card-a': { ...A, archived: true }, 'card-b': B } });
  const w = createWatcher();
  claim({ awSessionId: 'card-a' });
  w.poll(host);
  claim({ awSessionId: 'card-b' });
  w.poll(host);
  assert.equal(mail.length, 0);
});

test('noMail turns the takeover mail off', () => {
  const { host, mail, claim } = setup({ sessions: { 'card-a': A, 'card-b': B }, settings: { noMail: true } });
  const w = createWatcher();
  claim({ awSessionId: 'card-a' });
  w.poll(host);
  claim({ awSessionId: 'card-b' });
  w.poll(host);
  assert.equal(mail.length, 0);
});

test('noNotice turns the board notice off', () => {
  const { host, sent, claim } = setup({ sessions: { 'card-a': A, 'card-b': B }, settings: { noNotice: true } });
  const w = createWatcher();
  claim({ awSessionId: 'card-a' });
  w.poll(host);
  claim({ awSessionId: 'card-b' });
  w.poll(host);
  assert.ok(sent.every((f) => !f.takeover));
});

test('a takeover while the wrangler was down is reported after a restart', () => {
  const { host, mail, claim } = setup({ sessions: { 'card-a': A, 'card-b': B } });
  claim({ awSessionId: 'card-a' });
  createWatcher().poll(host);
  claim({ awSessionId: 'card-b' });
  host.stores.kindClaim = new ClaimStore({ file: host.stores.kindClaim.file });
  createWatcher().poll(host);
  assert.equal(mail.length, 1);
});

test('a restart with an unchanged claim is not a takeover', () => {
  const { host, mail, claim } = setup({ sessions: { 'card-a': A } });
  claim({ awSessionId: 'card-a' });
  createWatcher().poll(host);
  host.stores.kindClaim = new ClaimStore({ file: host.stores.kindClaim.file });
  createWatcher().poll(host);
  assert.equal(mail.length, 0);
});

test('a failing mail does not stop the broadcast', () => {
  const { host, sent, claim } = setup({ sessions: { 'card-a': A, 'card-b': B } });
  host.mail.send = () => { throw new Error('backed up'); };
  const w = createWatcher();
  claim({ awSessionId: 'card-a' });
  w.poll(host);
  claim({ awSessionId: 'card-b' });
  w.poll(host);
  assert.ok(sent.at(-1).takeover);
});

test('release deletes the claim held by the named card', () => {
  const { host, claimFile, claim } = setup({ sessions: { 'card-a': A } });
  claim({ awSessionId: 'card-a' });
  assert.equal(createWatcher().release(host, 'card-a'), true);
  assert.equal(fs.existsSync(claimFile), false);
});

test('release refuses a card that does not hold the claim', () => {
  const { host, claimFile, claim } = setup({ sessions: { 'card-a': A } });
  claim({ awSessionId: 'card-a' });
  assert.equal(createWatcher().release(host, 'card-b'), false);
  assert.equal(fs.existsSync(claimFile), true);
});

test('a forced poll broadcasts even when nothing changed', () => {
  const { host, sent } = setup();
  const w = createWatcher();
  w.poll(host);
  w.poll(host, { force: true });
  assert.equal(sent.length, 2);
});

// Store names share one namespace across every extension, so a generic one
// like `state` collides with other installed extensions at install time.
test('store names are prefixed with the extension name', () => {
  for (const name of Object.keys(manifest.stores)) assert.match(name, /^kindClaim/);
});

test('labels use the title the board shows', () => {
  const { host, sent, claim } = setup({ sessions: { 'card-a': A } });
  const w = createWatcher();
  w.noteGraph({ sessions: [{ sessionId: 'card-a', label: 'KIND cluster lock' }] });
  claim({ awSessionId: 'card-a' });
  w.poll(host);
  assert.equal(sent[0].claim.holder, '“KIND cluster lock”');
});

test('an unchanged claim is sent again after the resend interval', () => {
  const { host, sent } = setup();
  let t = 0;
  const w = createWatcher({ now: () => t });
  w.poll(host);
  t = RESEND_MS;
  w.poll(host);
  assert.equal(sent.length, 2);
});
