import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageText, holds, tooltip, renderPill, menuItemsFor, createClient } from './index.js';

const NOW = Date.parse('2026-10-14T14:00:00Z');
const CLAIM = { awSessionId: 'card-a', branch: 'main', commit: 'abc123', checkout: '/repo', purpose: 'redeploy web-server', claimedAt: '2026-10-14T13:30:00Z' };

// Just enough of a DOM element for renderPill.
function fakeEl() {
  const el = {
    children: [],
    replaceChildren(...kids) { el.children = kids; },
    ownerDocument: { createElement: (tag) => ({ tag, className: '', title: '', textContent: '' }) },
  };
  return el;
}

test('ageText says now for under a minute', () => {
  assert.equal(ageText('2026-10-14T13:59:30Z', NOW), 'now');
});

test('ageText counts minutes', () => {
  assert.equal(ageText(CLAIM.claimedAt, NOW), '30m');
});

test('ageText counts days after two days', () => {
  assert.equal(ageText('2026-10-11T14:00:00Z', NOW), '3d');
});

test('ageText of a bad date is empty', () => {
  assert.equal(ageText('nonsense', NOW), '');
});

test('holds is false with no claim', () => {
  assert.equal(holds(null, 'card-a'), false);
});

test('tooltip names the branch and commit', () => {
  assert.match(tooltip(CLAIM, NOW), /Branch: main at abc123/);
});

test('renderPill draws the chip on the holder card', () => {
  const el = fakeEl();
  renderPill(el, CLAIM, 'card-a', NOW);
  assert.equal(el.children[0].textContent, '☸ KIND · 30m');
});

test('renderPill draws nothing on another card', () => {
  const el = fakeEl();
  renderPill(el, CLAIM, 'card-b', NOW);
  assert.equal(el.children.length, 0);
});

test('menuItemsFor offers release only on the holder card', () => {
  assert.equal(menuItemsFor(CLAIM, { sessionId: 'card-b' }, () => {}).length, 0);
});

test('the release item sends the holder card id', () => {
  const sent = [];
  menuItemsFor(CLAIM, { sessionId: 'card-a' }, (m) => sent.push(m))[0].run();
  assert.deepEqual(sent, [{ type: 'kind-claim-release', sessionId: 'card-a' }]);
});

test('a broadcast redraws chips already on screen', () => {
  const client = createClient({ api: { send() {} }, now: () => NOW });
  const el = fakeEl();
  client.pill.mount(el);
  client.pill.update(el, { sessionId: 'card-a' });
  client.onFrame({ claim: CLAIM });
  assert.equal(el.children.length, 1);
});

test('a takeover frame raises a notification', () => {
  const notes = [];
  const client = createClient({ api: { send() {}, ui: { notify: (n) => notes.push(n) } }, now: () => NOW });
  client.onFrame({ claim: CLAIM, takeover: { id: 't1', title: 'KIND cluster taken over', body: 'B took it from A.' } });
  assert.equal(notes[0].body, 'B took it from A.');
});

test('an unmounted chip is no longer redrawn', () => {
  const client = createClient({ api: { send() {} }, now: () => NOW });
  const el = fakeEl();
  client.pill.mount(el);
  client.pill.update(el, { sessionId: 'card-a' });
  client.pill.unmount(el);
  client.onFrame({ claim: CLAIM });
  assert.equal(el.children.length, 0);
});
