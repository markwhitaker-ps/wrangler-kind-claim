// The client half: the server broadcasts the current claim whenever it changes.
// This draws a ☸ KIND chip on the holder's card, adds "Release the KIND
// cluster" to that card's menu, and raises a notification when one session
// takes the cluster over from another.

export function ageText(claimedAt, now = Date.now()) {
  const t = Date.parse(claimedAt);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 172800) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function holds(claim, sessionId) {
  return Boolean(claim && sessionId && claim.awSessionId === sessionId);
}

export function tooltip(claim, now = Date.now()) {
  const lines = ['This session holds the local KIND cluster.'];
  if (claim.purpose) lines.push(`For: ${claim.purpose}`);
  if (claim.branch) lines.push(`Branch: ${claim.branch}${claim.commit ? ` at ${claim.commit}` : ''}`);
  if (claim.checkout) lines.push(`Checkout: ${claim.checkout}`);
  const t = Date.parse(claim.claimedAt);
  if (Number.isFinite(t)) {
    const age = ageText(claim.claimedAt, now);
    lines.push(`Claimed ${age === 'now' ? 'just now' : `${age} ago`} (${new Date(t).toLocaleString()})`);
  }
  return lines.join('\n');
}

// Everything goes in as text, never markup: the claim file is written by a
// shell script and its strings are not trusted.
export function renderPill(el, claim, sessionId, now = Date.now()) {
  if (!holds(claim, sessionId)) {
    el.replaceChildren();
    return;
  }
  const doc = el.ownerDocument;
  const tag = doc.createElement('span');
  tag.className = 'card-tag kind-claim';
  tag.title = tooltip(claim, now);
  const age = ageText(claim.claimedAt, now);
  tag.textContent = age ? `☸ KIND · ${age}` : '☸ KIND';
  el.replaceChildren(tag);
}

export function menuItemsFor(claim, session, send) {
  if (!holds(claim, session?.sessionId)) return [];
  return [{
    label: 'Release the KIND cluster',
    run: () => send({ type: 'kind-claim-release', sessionId: session.sessionId }),
  }];
}

export function createClient({ api, now = () => Date.now() }) {
  let claim = null;
  // Every chip element on screen and the card it belongs to, so a broadcast can
  // redraw them all without waiting for the board's next render.
  const pills = new Map();

  function redraw() {
    for (const [el, sid] of pills) renderPill(el, claim, sid, now());
  }

  return {
    pill: {
      id: 'holder',
      label: 'KIND cluster',
      mount(el) { pills.set(el, null); },
      update(el, session) {
        pills.set(el, session?.sessionId ?? null);
        renderPill(el, claim, session?.sessionId, now());
      },
      unmount(el) { pills.delete(el); },
    },
    action: {
      id: 'release',
      items: (session) => menuItemsFor(claim, session, (msg) => api.send(msg)),
    },
    onFrame(frame) {
      claim = frame?.claim ?? null;
      redraw();
      const t = frame?.takeover;
      if (t && api.ui?.notify) {
        api.ui.notify({ id: t.id, title: t.title, body: t.body, actions: [{ id: 'ok', label: 'OK', primary: true }] });
      }
    },
  };
}

export default {
  register(slots) {
    const api = slots.api;
    const client = createClient({ api });
    slots.register('card.pill', client.pill);
    slots.register('card.action', client.action);
    slots.onMessage((frame) => client.onFrame(frame));
    api.send({ type: 'kind-claim-hello' });
  },
};
