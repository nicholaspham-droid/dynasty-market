# Dynasty market board

Tracks your Sleeper dynasty league against KeepTradeCut market values, and keeps
the history so you can see trajectory rather than just today's price.

KTC's own League Power Rankings already does the static version of this well.
The reason this exists is the time series: KTC shows you a 30 day trend number,
this keeps every daily reading, so you can watch a roster's curve over months and
see when a rival's window actually opened or closed.

## Layout

```
scripts/fetch_snapshot.py   pulls Sleeper + KTC, writes data/snapshots/<date>.json
scripts/build_dataset.py    folds all snapshots into docs/data.json
docs/index.html           zero build entry point, compiles the JSX in browser
docs/Dashboard.jsx        the dashboard
.github/workflows/          daily cron that runs both scripts and commits
```

Full setup steps are in DEPLOY.md. Project context for coding agents is in
CLAUDE.md.

Snapshots are the raw record and are append only. Everything in `docs/data.json`
is derived, so deleting and rebuilding it is always safe.

## Setup

1. Get your league ID from the Sleeper URL, the long number after `/league/`.
2. Find your roster ID by running the fetch once and reading the team list it prints.
3. In the repo, go to Settings, then Secrets and variables, then Actions, then
   Variables, and add `LEAGUE_ID` and `MY_ROSTER_ID`.
4. Under Settings and Pages, serve from your default branch with the folder set
   to `/docs`.

Local run:

```bash
pip install -r requirements.txt
python3 scripts/fetch_snapshot.py --league-id YOUR_LEAGUE_ID
python3 scripts/build_dataset.py --my-roster-id 7 --out docs/data.json
cd docs && python3 -m http.server 8000
```

Open the printed address. Opening `index.html` directly off the filesystem will
not work, since it fetches two files over HTTP.

## What the views show

Board ranks every team by total asset value including picks, with a sparkline over
the selected window. Sorting by momentum reorders the board, which is the fastest
way to see who has been quietly gaining.

Team breaks a roster into its optimal starting lineup at current market value,
bench, and pick capital, plus where that team ranks league wide at each position.

Trades compares your positional standing against one rival, then proposes swaps.
Value rarely balances one for one, so where it does not, the tool names the draft
pick from the side receiving more that comes closest to closing the gap.

Market lists the largest movers over the window and the most valuable unrostered
players.

## Things that will break

The KTC parser is the fragile part. It first looks for the rankings data embedded
in the page as a JavaScript array, and falls back to reading the rendered rows if
that is gone. If both fail the script raises rather than writing a bad snapshot,
so your history never silently fills with zeros. Fixing it means updating
`parse_rankings_html`.

Name matching between Sleeper and KTC is keyed on normalized name plus position.
Every run prints any rostered player it could not match. Real misses go in the
`ALIASES` map at the top of `fetch_snapshot.py`, then rerun with `--force`.

Pick valuation uses KTC's early, mid and late buckets. For the upcoming rookie
draft it projects order from current standings, and for later seasons it assumes
mid. Rookie draft rounds default to four and are set with `--rookie-rounds`.

Be careful with scrape frequency. Daily is plenty, and the whole thing stops
working if the requests get rude enough to earn a block.
