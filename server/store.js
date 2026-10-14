import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The wrangler hands a store factory no data dir, so this resolves the same one
// the wrangler uses (AW_DATA_DIR, else ~/.agent-wrangler).
export function defaultFile() {
  const dataDir = process.env.AW_DATA_DIR || path.join(os.homedir(), '.agent-wrangler');
  return path.join(dataDir, 'kind-claim.json');
}

// The last holder this extension saw, kept on disk so a wrangler restart does
// not read an unchanged claim as a takeover, and a takeover that happened while
// the wrangler was down is still reported when it comes back.
export class ClaimStore {
  constructor({ file = defaultFile() } = {}) {
    this.file = file;
    this.owner = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed?.owner && typeof parsed.owner === 'object') this.owner = parsed.owner;
    } catch { /* missing or unreadable: start with no holder */ }
  }

  setOwner(owner) {
    this.owner = owner;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ owner }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
