# Deploy runbook

Takes this repo from a local folder to a live site with a daily cron. About
fifteen minutes. Run once.

## Prerequisites

- [ ] Python 3.10 or newer
- [ ] A GitHub account
- [ ] `gh` CLI installed and authenticated (`gh auth login`). This step is
      interactive and cannot be delegated to an agent.
- [ ] Your Sleeper league ID, the long number in your league URL:
      `sleeper.com/leagues/<LEAGUE_ID>/team`

The repo must be public. GitHub Pages is a paid feature on private repos, and
league rosters are not sensitive.

---

## Phase 1: verify it works locally

### Step 1: Install dependencies

```bash
pip install -r requirements.txt
```

**Expected:** requests and beautifulsoup4 install cleanly.

**If it fails:** On a managed Python, use a virtual environment:
`python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`

### Step 2: Capture the first snapshot

```bash
python3 scripts/fetch_snapshot.py --league-id YOUR_LEAGUE_ID
```

**Expected:** A summary ending with the count of rostered players and how many
carried a market value, and a new file in `data/snapshots/`.

**If it fails on Sleeper:** A 404 means the league ID is wrong or the league is
private. Confirm the number from your league URL.

**If it fails on KTC:** The error will say the page structure changed. This is
the known fragile point. See the KTC parsing section of CLAUDE.md, which
includes how to dump the page and what to fix. Do not proceed until this passes,
since everything downstream depends on it.

**If it warns about unmatched players:** A handful of deep bench players with no
KTC match is normal. If a well known starter is missing, add the mapping to
`ALIASES` in `scripts/fetch_snapshot.py` and rerun with `--force`.

### Step 3: Find your roster ID

```bash
python3 -c "import json,glob;s=json.load(open(sorted(glob.glob('data/snapshots/*.json'))[-1]));[print(t['roster_id'],t['name']) for t in s['teams']]"
```

**Expected:** A numbered list of every team. Note the number next to yours.

### Step 4: Build the dataset

```bash
python3 scripts/build_dataset.py --my-roster-id YOUR_ROSTER_ID --out docs/data.json
```

**Expected:** Confirmation of the file size and asset count, plus a note that
there is only one day of history. That note is correct at this stage.

### Step 5: View it

```bash
cd docs && python3 -m http.server 8000
```

Open `http://localhost:8000`.

**Expected:** Your real league name in the header, your teams on the board, and
no "sample data" badge. Sparklines will be flat with one day of data.

**If you see the sample badge:** `docs/data.json` was not found. Confirm step 4
wrote it to `docs/`, not `public/`.

**If you see "Could not start the dashboard":** You opened the file directly
instead of over HTTP. Use the server address, not a `file://` path.

Stop the server with Ctrl-C when done.

---

## Phase 2: put it on GitHub

### Step 6: Create the repo and push

```bash
git init
git add .
git commit -m "Dynasty market board"
gh repo create dynasty-market --public --source=. --push
```

**Expected:** The repo is created and the push completes.

**If `gh` is not authenticated:** Run `gh auth login` and repeat.

### Step 7: Set the Actions variables

```bash
gh variable set LEAGUE_ID --body "YOUR_LEAGUE_ID"
gh variable set MY_ROSTER_ID --body "YOUR_ROSTER_ID"
```

**Expected:** Confirmation for each. Verify with `gh variable list`.

These are variables, not secrets. Secrets are masked in logs and would make
debugging a failed run harder for no benefit, since neither value is sensitive.

### Step 8: Allow the workflow to commit

```bash
gh api -X PUT repos/:owner/:repo/actions/permissions/workflow \
  -f default_workflow_permissions=write
```

**Expected:** A JSON response showing write permissions.

**If you skip this:** The daily run will fetch and build correctly and then fail
at the push step with a 403. This is the single most common setup mistake.

### Step 9: Turn on Pages

```bash
gh api -X POST repos/:owner/:repo/pages \
  -f "source[branch]=main" -f "source[path]=/docs"
```

**Expected:** A JSON response including your site URL.

**If it returns 409:** Pages is already enabled. Point it at the right folder
with the same call using `-X PUT`.

**If the CLI call is awkward:** Do it in the browser under Settings, then Pages.
Source is "Deploy from a branch", branch `main`, folder `/docs`.

### Step 10: Trigger the first run

```bash
gh workflow run "Daily snapshot"
gh run watch
```

**Expected:** All steps green. Since you already captured today's snapshot
locally and pushed it, the fetch step will report that today's file exists and
skip, which is correct behaviour rather than a failure.

---

## Verification

- [ ] `gh run list --limit 1` shows a successful run
- [ ] Your site loads at `https://<username>.github.io/dynasty-market`
- [ ] The header shows your league name with no "sample data" badge
- [ ] The Board tab lists every team in your league
- [ ] The Team tab shows your roster split into lineup and bench
- [ ] The Trades tab proposes something against at least one rival

Pages can take a couple of minutes to publish on first enable. A 404 immediately
after step 9 is usually just propagation.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Workflow fails at the commit step with 403 | Workflow permissions are read only | Step 8 |
| Site 404s after a successful run | Pages pointed at the wrong folder or still propagating | Confirm Settings, Pages shows `/docs`, then wait a few minutes |
| Site shows "sample data" badge | `docs/data.json` missing or not committed | Confirm the build step wrote to `docs/` and that the workflow commits that path |
| Fetch step fails on KTC | Page structure changed | See KTC parsing in CLAUDE.md |
| A starter shows no value | Name mismatch between sources | Add to `ALIASES`, rerun with `--force` |
| Sparklines flat or empty | Not enough history yet | Expected. Needs roughly two weeks |
| Cron stopped firing after a quiet period | GitHub disables schedules on inactive repos after about 60 days | Re-enable the workflow in the Actions tab |

## Rollback

Nothing here is destructive. To undo:

```bash
gh api -X DELETE repos/:owner/:repo/pages     # unpublish the site
gh workflow disable "Daily snapshot"          # stop the cron
```

The snapshots in `data/snapshots/` are the only irreplaceable artifact. Keep them
even if you abandon the rest, since the history cannot be backfilled.

## After it is live

The KTC parser is what will eventually break. When it does, the daily run turns
red and stops, which is the intended behaviour. Two options: fix it locally and
push, or install the Claude GitHub app with `/install-github-app` from Claude
Code, then open an issue describing the failure and tag `@claude` to get a fix
as a pull request.

Check back in about two weeks. The momentum sort and the sparklines are the
reason this exists, and neither says anything useful until the series has
accumulated.
