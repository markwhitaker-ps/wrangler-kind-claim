# KIND cluster claim

An [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler) extension that shows which session is using the local KIND cluster for the DAST cloud product. It also tells a session when another session takes the cluster over.

Several sessions can share one KIND cluster. A redeploy or restart from one session can break whatever another session is testing. The enterprise repo's `kubernetes/kind-claim.sh` records which session holds the cluster. The `kind` skill and `kubernetes/kind-redeploy.sh` call it before they change the cluster. This extension reads that record and puts it on the board:

- **A chip on the holder's card.** The card of the session holding the cluster shows **☸ KIND · 25m**, with the time since it claimed the cluster. Hover over it for the branch, commit, checkout and what the session claimed it for.
- **Release from the card menu.** The holder's right-click and Actions menus get **Release the KIND cluster**, which deletes the claim.
- **A mail to the session that lost the cluster.** When one session takes the cluster from another, the old holder gets a mail. Its agent then knows its deployment may have changed, and how to claim the cluster again.
- **A board notification on takeover.** The board shows which session took the cluster from which.

The two parts don't depend on each other. Without this extension, the script and skill still record the claim and refuse to redeploy over another session's claim. Without the script, this extension shows nothing.

A release followed by a new claim is not a takeover. Neither is the same session claiming the cluster again. If the wrangler was stopped when a takeover happened, the extension reports it when the wrangler starts again.

## The claim file

`~/.local/state/kind-dast/claim.json`, written by `kind-claim.sh`:

```json
{
  "awSessionId": "eeb7c897-…",
  "claudeSessionId": "1cbba405-…",
  "checkout": "/Users/me/Git/enterprise",
  "branch": "ENT-123-some-change",
  "commit": "a9e4d06c8f",
  "purpose": "redeploy web-server",
  "claimedAt": "2026-10-14T13:50:31Z"
}
```

`awSessionId` comes from `$AW_SESSION_ID`, which the wrangler sets in every session it launches. That's how the extension finds the holder's card. A claim from a Claude session outside the wrangler has only `claudeSessionId`, so no card shows the chip, but a takeover is still reported.

## Settings

Under **Settings → Extensions → KIND cluster claim**:

- **Claim file**: change it only if you also set `KIND_CLAIM_FILE` for the script.
- **Don't mail the session that loses the cluster**
- **Don't show a notification on takeover**

The extension keeps the last holder it saw in `<AW_DATA_DIR>/kind-claim.json`.

Requires host API `^1.23.0` and the capabilities `sessions:read`, `board:broadcast` and `mail:send`.

## Install

In the wrangler's Extensions tab, install from `https://github.com/markwhitaker-ps/wrangler-kind-claim.git` and agree to its capabilities.

## Develop

```
npm test
```

To try it on a development wrangler, **copy** this directory to `<AW_DATA_DIR>/extensions/kind-claim` (don't symlink it), then start the wrangler.

## Licence

Apache-2.0, see `LICENSE`.
