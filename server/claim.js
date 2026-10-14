import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The claim file is the whole contract with the enterprise repo's
// `kubernetes/kind-claim.sh`, which writes it. This extension only ever reads
// it, and deletes it when someone presses "Release" on the holder's card.

export const DEFAULT_CLAIM_FILE = path.join(os.homedir(), '.local', 'state', 'kind-dast', 'claim.json');

const FIELDS = ['awSessionId', 'claudeSessionId', 'checkout', 'branch', 'commit', 'purpose', 'claimedAt'];

export function claimFileFrom(setting, home = os.homedir()) {
  const s = typeof setting === 'string' ? setting.trim() : '';
  if (!s) return DEFAULT_CLAIM_FILE;
  if (s === '~') return home;
  return s.startsWith('~/') ? path.join(home, s.slice(2)) : s;
}

// Only the known string fields survive, so nothing the file carries reaches a
// browser or a mail unless it was meant to.
export function normaliseClaim(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const claim = {};
  for (const k of FIELDS) claim[k] = typeof raw[k] === 'string' ? raw[k] : '';
  return claim;
}

// Missing, empty or unreadable all mean "nobody holds the cluster".
export function readClaim(file, fsImpl = fs) {
  try {
    return normaliseClaim(JSON.parse(fsImpl.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

// Who holds it, as one comparable value. Mirrors kind-claim.sh's own rule: the
// Agent Wrangler card id wins, because it survives resumes and /clear.
export function ownerKey(claim) {
  if (!claim) return null;
  if (claim.awSessionId) return `aw:${claim.awSessionId}`;
  if (claim.claudeSessionId) return `claude:${claim.claudeSessionId}`;
  return 'terminal';
}

export function sessionLabel(session) {
  if (!session) return '';
  const firstLine = (session.intent || '').split('\n')[0].trim();
  const intent = firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
  return session.label || session.name || session.lastLabel || intent || 'an unnamed session';
}

// How a holder reads in a sentence, whether or not it is a card on the board.
export function holderLabel(claim, session) {
  if (!claim) return 'nobody';
  if (session) return `“${sessionLabel(session)}”`;
  if (claim.awSessionId) return `an Agent Wrangler session that is no longer on the board (${claim.awSessionId.slice(0, 8)})`;
  if (claim.claudeSessionId) return `a Claude session outside Agent Wrangler (${claim.claudeSessionId.slice(0, 8)})`;
  return 'a terminal with no session id';
}

function where(claim) {
  const parts = [];
  if (claim.branch) parts.push(`branch ${claim.branch}${claim.commit ? ` at ${claim.commit}` : ''}`);
  if (claim.checkout) parts.push(`checkout ${claim.checkout}`);
  return parts.join(', ');
}

// Addressed to the AGENT in the session that lost the cluster: it arrives as
// mail and starts a turn when that session is idle.
export function takeoverMail({ to, toLabel }) {
  const lines = [
    `The local KIND cluster has been taken over by another session: ${toLabel}.`,
  ];
  const w = where(to);
  if (w) lines.push(`It is working from ${w}.`);
  if (to.purpose) lines.push(`It claimed the cluster for: ${to.purpose}.`);
  lines.push(
    '',
    'Anything you deployed or were testing in the cluster may have been replaced or restarted.',
    'Before you change the cluster again, run `kubernetes/kind-claim.sh take "<what for>"` as the kind skill describes.',
    'It refuses while the other session holds the claim. Ask the developer before taking it back with `--force`.',
    'If this interrupts what you were doing, tell the developer.',
  );
  return lines.join('\n');
}

// Addressed to the HUMAN, as a board notification.
export function takeoverNotice({ from, fromLabel, to, toLabel }) {
  const body = [`${toLabel} took the cluster from ${fromLabel}.`];
  if (to.purpose) body.push(`For: ${to.purpose}.`);
  const w = where(to);
  if (w) body.push(`From ${w}.`);
  return {
    id: `kind-claim-takeover-${to.claimedAt || Date.now()}`,
    title: 'KIND cluster taken over',
    body: body.join(' '),
    from: ownerKey(from),
    to: ownerKey(to),
  };
}
