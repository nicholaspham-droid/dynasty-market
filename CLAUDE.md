# CLAUDE.md

Context for coding agents working in this repo. Read this before changing anything.

## What this is

A dynasty fantasy football valuation dashboard. It joins Sleeper league state
(who owns which players and picks) against KeepTradeCut crowdsourced market
values, captures that pairing once a day, and keeps every reading so roster
value can be charted over time.

KTC's own League Power Rankings already does the static version of this. The
only reason this project exists is the accumulated history. Any change that
compromises the integrity of the snapshot series defeats the point of the
project, so treat that data as the crown jewels.

## Architecture

Two stages, deliberately separated:

```
Sleeper API  ─┐
              ├─> fetch_snapshot.py ─> data/snapshots/<date>.json   (raw, append only)
KTC rankings ─┘                                  │
                                                 v
                                        build_dataset.py ─> docs/data.json  (derived)
                                                 │
                                                 v
                                    docs/index.html + Dashboard.jsx
```

The split matters. Snapshots are the permanent record. `docs/data.json` is pure
derivation, so it can be deleted and rebuilt from snapshots at any time without
loss. If you are tempted to compute something at fetch time, put it in the build
step instead, so it can be recomputed for the full history rather than only
applying going forward.

## File map

```
scripts/fetch_snapshot.py   ingest and name matching
scripts/build_dataset.py    time series fold, lineup optimizer, pick inventory
docs/index.html             browser entry point, compiles the JSX at runtime
docs/Dashboard.jsx          the whole UI, single file
data/snapshots/             dated raw captures, append only
.github/workflows/          daily cron
```

Pages serves from `/docs`, which is why the front end lives there. GitHub Pages
only serves from the repo root or a folder named `docs`, so do not rename it.

## Commands

```bash
pip install -r requirements.txt

python3 scripts/fetch_snapshot.py --league-id <ID>          # one day's capture
python3 scripts/fetch_snapshot.py --league-id <ID> --force  # overwrite today
python3 scripts/build_dataset.py --my-roster-id <N> --out docs/data.json
cd docs && python3 -m http.server 8000                      # then open localhost:8000
```

## Invariants

Do not break these without a very good reason.

1. Never edit or delete files in `data/snapshots/`. They are the append only
   history and cannot be reconstructed. `fetch_snapshot.py` refuses to overwrite
   an existing date unless `--force` is passed, which is intentional.

2. Do not raise the KTC scrape frequency. Daily is enough. There is a 2.5 second
   delay between paginated requests and a real user agent header. The project
   stops working entirely if the requests earn an IP block.

3. `docs/Dashboard.jsx` must import nothing except React. `docs/index.html`
   compiles the file in the browser by stripping module syntax with a regex and
   evaluating the result with `new Function`. Adding a second import silently
   produces an undefined identifier at runtime. If you need a library, add it as
   a global via a script tag in `index.html` and reference it directly.

4. Keep the `buildSample()` fallback working. When `fetch("data.json")` fails,
   the dashboard generates a synthetic league so the UI is explorable with no
   backend. This is how the file previews outside a browser and how a new clone
   renders before the first snapshot exists.

5. No `localStorage` or `sessionStorage` in the dashboard. All state is React
   state by design.

6. `fetch_snapshot.py` raises rather than writing a partial snapshot when the
   KTC parse fails. Keep it that way. A loud failure is recoverable, a snapshot
   quietly full of zeros corrupts the series permanently.

## The two fragile parts

### KTC parsing

`fetch_snapshot.py` tries two strategies in order. First it looks for a
`playersArray` JavaScript literal embedded in the page, which is the clean path
and carries both superflex and 1QB values. If that is gone it falls back to
`parse_rankings_html`, which finds player links matching
`/dynasty-rankings/players/<slug>-<id>`, walks up to the containing row, and
reads the value as the last integer in the row text.

If both fail the script raises. To fix, save the page HTML and inspect it:

```python
import requests
html = requests.get("https://keeptradecut.com/dynasty-rankings",
                    headers={"User-Agent": "Mozilla/5.0"}).text
open("/tmp/ktc.html", "w").write(html)
```

Then update `parse_players_array` or `parse_rankings_html` to match what is
actually there. Do not loosen the parser to the point where it accepts garbage.

### Name matching

Sleeper and KTC do not agree on player names. `normalize()` strips accents and
punctuation and drops generational suffixes, matching Sleeper's own
`search_full_name` convention, so `Amon-Ra St. Brown` becomes `amonrastbrown`.
Matching is keyed on normalized name plus position, because same name collisions
are real and frequent, for example the quarterback and the linebacker both named
Josh Allen.

Every run prints the rostered players it could not match. Genuine misses go in
the `ALIASES` dict at the top of the file, keyed KTC name to Sleeper name, then
rerun with `--force`. A handful of unmatched deep bench players is normal and not
worth chasing.

## Testing changes

There is no test suite. The dashboard is verified by mounting it headlessly:

```bash
npm install react react-dom jsdom esbuild @babel/standalone
```

Then mount `Dashboard.jsx` in jsdom, render it, and click through the Board,
Team, Trades and Market tabs, asserting that `.tickrow`, `.grid` and `.fits`
nodes appear and that React logs no errors. Also verify `index.html` stays
compatible by replicating its transform exactly: strip module syntax with the
same regexes, run `Babel.transform` with `sourceType: "script"`, wrap in
`new Function`, and confirm it returns a renderable component.

When changing `build_dataset.py`, generate a few synthetic snapshots and check
the emitted `docs/data.json` still carries `meta`, `teams`, `players`, `rosters`,
`picks`, `team_series`, `player_series` and `free_agents`, with every series
array the same length as `meta.dates`.

## Domain notes

The league is superflex, meaning a second quarterback can be started in a flex
slot, which makes quarterback values far higher than in standard formats. Always
read KTC's superflex column, not the 1QB one.

"Surplus" in the trade engine means depth beyond the slots that genuinely
require a position, not whoever missed the starting lineup. On a 20 man roster
the non starters are all bench filler, so defining surplus that way surfaces
only junk. A third quarterback in superflex is a real trade chip even while he
occupies the flex, because moving him just promotes the next receiver up.

Trades rarely balance one for one. A surplus quarterback worth 6000 against a
rival's best spare receiver worth 900 is a real trade that needs a pick to
close it, which is why the fit engine reaches into the pick inventory. Do not
reintroduce a strict value tolerance filter, since it discards every deal worth
making.

Sleeper only reports picks that have been traded. Untraded picks are implicitly
owned by the original roster, so `build_pick_inventory` reconstructs the full
set and then applies the traded feed as overrides.

## Style

Comments explain why, not what. The existing code comments the non obvious
decisions and leaves the mechanical parts bare. Match that.

No em dashes in prose or comments.
