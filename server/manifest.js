import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ClaimStore } from './store.js';
import {
  claimFileFrom, readClaim, ownerKey, sessionLabel, holderLabel, takeoverMail, takeoverNotice, DEFAULT_CLAIM_FILE,
} from './claim.js';

// The extension manifest (agent-wrangler docs/extensions.md). `dir` is the repo
// root so `client` resolves inside `<dir>/public/`; for an installed copy
// discovery overwrites it with the real location.
export const dir = fileURLToPath(new URL('..', import.meta.url));

// Reads the claim file, notices when the holder changes, and tells the board.
// One per extension load; tests make their own.
export function createWatcher({ fsImpl = fs, now = () => Date.now() } = {}) {
  let lastSent = null;
  // card id -> the title the board shows. `sessions:read` does not carry it,
  // so it comes from the board graph (see the manifest's `graph` hook).
  let titles = new Map();

  function noteGraph(graph) {
    if (!Array.isArray(graph?.sessions)) return;
    titles = new Map(graph.sessions.filter((s) => s?.sessionId && s.label).map((s) => [s.sessionId, s.label]));
  }

  function withTitle(s) {
    return s ? { ...s, label: titles.get(s.sessionId) ?? '' } : null;
  }

  function sessionFor(host, claim) {
    if (!claim?.awSessionId) return null;
    const s = host.sessions.get(claim.awSessionId);
    return s && !s.archived ? withTitle(s) : null;
  }

  function view(host, claim) {
    if (!claim) return null;
    const session = sessionFor(host, claim);
    return { ...claim, onBoard: Boolean(session), holder: holderLabel(claim, session) };
  }

  // A takeover is the holder changing from one session to another. A release
  // followed by a fresh claim is not one: the first session let go.
  function noticeTakeover(host, previous, claim) {
    const toLabel = holderLabel(claim, sessionFor(host, claim));
    const fromSession = previous.awSessionId ? withTitle(host.sessions.get(previous.awSessionId)) : null;
    const fromLabel = fromSession ? `“${sessionLabel(fromSession)}”` : (previous.label || holderLabel(previous, null));
    host.log(`KIND cluster taken over: ${ownerKey(previous)} -> ${ownerKey(claim)}`);

    if (host.settings.get('noMail') !== true && fromSession && !fromSession.archived) {
      try {
        host.mail.send(previous.awSessionId, takeoverMail({ to: claim, toLabel }));
      } catch (err) {
        host.log(`could not mail ${previous.awSessionId}: ${err.message}`);
      }
    }
    return host.settings.get('noNotice') === true ? null : takeoverNotice({ from: previous, fromLabel, to: claim, toLabel });
  }

  function poll(host, { force = false } = {}) {
    const file = claimFileFrom(host.settings.get('claimFile'));
    const claim = readClaim(file, fsImpl);
    const store = host.stores.kindClaim;
    const previous = store.owner;
    let takeover = null;

    if (ownerKey(claim) !== (previous?.key ?? null)) {
      if (claim && previous) takeover = noticeTakeover(host, previous, claim);
      store.setOwner(claim ? { key: ownerKey(claim), ...claim, label: holderLabel(claim, sessionFor(host, claim)) } : null);
    } else if (claim && previous && claim.claimedAt !== previous.claimedAt) {
      // Same holder, fresh claim (a second redeploy): keep the stored copy current.
      store.setOwner({ key: ownerKey(claim), ...claim, label: holderLabel(claim, sessionFor(host, claim)) });
    }

    const current = view(host, claim);
    const frame = JSON.stringify(current);
    if (force || takeover || frame !== lastSent) {
      lastSent = frame;
      host.broadcast({ claim: current, ...(takeover ? { takeover } : {}), at: now() });
    }
    return { claim: current, takeover };
  }

  // Browser-supplied, so it only ever releases the claim held by the card it
  // names, and only if that card still holds it.
  function release(host, sessionId) {
    const file = claimFileFrom(host.settings.get('claimFile'));
    const claim = readClaim(file, fsImpl);
    if (!claim || !sessionId || claim.awSessionId !== sessionId) return false;
    try {
      fsImpl.unlinkSync(file);
    } catch (err) {
      host.log(`could not release the claim: ${err.message}`);
      return false;
    }
    host.log(`released the KIND cluster held by ${sessionId}`);
    poll(host);
    return true;
  }

  return { poll, release, noteGraph };
}

const watcher = createWatcher();

export default {
  id: 'kind-claim',
  label: 'KIND cluster claim',
  description: 'Shows which session is using the local KIND cluster, and tells a session when another one takes the cluster over.',
  help: 'The enterprise repo\'s kubernetes/kind-claim.sh (and the kind skill and kind-redeploy.sh, which call it) records which session is using the local KIND cluster. This extension reads that record: the holder\'s card gets a ☸ KIND chip, its menu gets "Release the KIND cluster", and when another session takes the cluster over the session that lost it gets a mail and the board shows a notification. Turning the extension off changes nothing in the claim itself.',
  author: 'Mark Whitaker',
  homepage: 'https://github.com/markwhitaker-ps/wrangler-kind-claim',
  defaultEnabled: true,
  dir,
  requires: ['sessions:read', 'board:broadcast', 'mail:send'],
  engines: { wranglerApi: '^1.23.0' },

  settings: [
    {
      key: 'claimFile',
      type: 'text',
      label: 'Claim file',
      help: 'Where kind-claim.sh keeps the claim. Empty uses the script\'s default. Set it only if you set KIND_CLAIM_FILE for the script too.',
      placeholder: DEFAULT_CLAIM_FILE,
    },
    {
      key: 'noMail',
      type: 'toggle',
      label: 'Don\'t mail the session that loses the cluster',
      help: 'Normally the session that held the cluster gets a mail when another session takes it over, so its agent knows its deployment may have changed.',
    },
    {
      key: 'noNotice',
      type: 'toggle',
      label: 'Don\'t show a notification on takeover',
      help: 'Normally the board shows a notification when one session takes the cluster over from another.',
    },
  ],

  stores: { kindClaim: () => new ClaimStore() },

  handlers: [
    // A board that just loaded asks rather than waiting for a change.
    { type: 'kind-claim-hello', handler: (msg, host) => { watcher.poll(host, { force: true }); } },
    { type: 'kind-claim-release', handler: (msg, host) => { watcher.release(host, msg?.sessionId); } },
  ],

  // The ~4s board rebuild: keep each card's title for labels. Adds nothing.
  graph: ({ graph }) => {
    watcher.noteGraph(graph);
    return {};
  },

  // The file is tiny and local, so a short poll is cheaper and more reliable than
  // fs.watch, which loses track of a file replaced by rename.
  sweeps: [{ id: 'poll', everyMs: 2_000, run: ({ host }) => { watcher.poll(host); } }],

  client: 'public/index.js',
  styles: 'public/styles.css',
};
