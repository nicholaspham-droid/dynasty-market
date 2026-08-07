#!/usr/bin/env python3
"""Capture one day of league state and market value into a dated snapshot.

Reads Sleeper (public, unauthenticated) for rosters, users, settings and traded
picks, then reads KeepTradeCut's dynasty rankings for crowdsourced values.
Writes data/snapshots/YYYY-MM-DD.json. Never overwrites an existing snapshot
unless --force is passed, so the history stays append-only.

Usage:
    python scripts/fetch_snapshot.py --league-id 123456789012345678
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

SLEEPER = "https://api.sleeper.app/v1"
KTC_RANKINGS = "https://keeptradecut.com/dynasty-rankings"

# Be a good citizen. KTC is a free site run by a small team and the whole
# project dies if this gets rude enough to earn an IP ban.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
PAGE_DELAY_SECONDS = 2.5

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

# KTC three-letter codes -> Sleeper codes. Only used as a weak tiebreaker,
# since team changes constantly and neither source is authoritative mid-week.
TEAM_FIXES = {
    "NEP": "NE", "LVR": "LV", "KCC": "KC", "SFO": "SF", "TBB": "TB",
    "GBP": "GB", "NOS": "NO", "JAC": "JAX", "LAR": "LAR", "LAC": "LAC",
}

# Real name collisions between the two sources. Left side is the normalized
# KTC name, right side the normalized Sleeper name. Add to this as the
# unmatched report surfaces new ones.
ALIASES = {
    "hollywoodbrown": "marquisebrown",
    "gabedavis": "gabrieldavis",
    "chigokonkwo": "chigozieokonkwo",
    "camward": "cameronward",
    "tyronetracy": "tyronetracy",
    "joshuapalmer": "joshpalmer",
    "mitchelltrubisky": "mitchtrubisky",
    "nathanieldell": "tankdell",
    "elijahmitchell": "elijahmitchell",
    "chriswilliams": "chriswilliams",
    "damariomadden": "damariomadden",
}

POSITIONS = {"QB", "RB", "WR", "TE"}


# --------------------------------------------------------------------------
# name handling
# --------------------------------------------------------------------------

def normalize(name: str) -> str:
    """Collapse a display name to a comparable key.

    Matches Sleeper's own search_full_name convention: strip accents and
    punctuation, drop generational suffixes, join without spaces.
    'Amon-Ra St. Brown' -> 'amonrastbrown'
    """
    stripped = unicodedata.normalize("NFKD", name)
    stripped = stripped.encode("ascii", "ignore").decode("ascii").lower()
    stripped = re.sub(r"[^a-z0-9 ]", "", stripped)
    parts = [p for p in stripped.split() if p not in SUFFIXES]
    key = "".join(parts)
    return ALIASES.get(key, key)


# --------------------------------------------------------------------------
# http
# --------------------------------------------------------------------------

def get(url: str, params: dict | None = None, retries: int = 3) -> requests.Response:
    last = None
    for attempt in range(retries):
        try:
            response = requests.get(url, params=params, headers=HEADERS, timeout=30)
            if response.status_code == 200:
                return response
            last = f"HTTP {response.status_code}"
        except requests.RequestException as exc:
            last = str(exc)
        time.sleep(2 ** attempt)
    raise RuntimeError(f"Could not reach {url}: {last}")


# --------------------------------------------------------------------------
# sleeper
# --------------------------------------------------------------------------

def fetch_sleeper(league_id: str) -> dict:
    league = get(f"{SLEEPER}/league/{league_id}").json()
    rosters = get(f"{SLEEPER}/league/{league_id}/rosters").json()
    users = get(f"{SLEEPER}/league/{league_id}/users").json()
    traded = get(f"{SLEEPER}/league/{league_id}/traded_picks").json()

    user_by_id = {u["user_id"]: u for u in users}
    teams = []
    for roster in rosters:
        user = user_by_id.get(roster.get("owner_id"), {})
        settings = roster.get("settings") or {}
        teams.append({
            "roster_id": roster["roster_id"],
            "manager": user.get("display_name", f"Roster {roster['roster_id']}"),
            "name": (user.get("metadata") or {}).get("team_name")
                    or user.get("display_name", f"Roster {roster['roster_id']}"),
            "wins": settings.get("wins", 0),
            "losses": settings.get("losses", 0),
            "ties": settings.get("ties", 0),
            "points_for": settings.get("fpts", 0),
            "players": roster.get("players") or [],
            "starters": roster.get("starters") or [],
        })

    return {
        "league": {
            "league_id": league_id,
            "name": league.get("name"),
            "season": league.get("season"),
            "status": league.get("status"),
            "total_rosters": league.get("total_rosters"),
            "roster_positions": league.get("roster_positions") or [],
            "scoring": league.get("scoring_settings") or {},
        },
        "teams": teams,
        "traded_picks": traded,
    }


def fetch_player_index() -> dict:
    """Sleeper's full NFL player dump. Large, so this is called once per run.

    Returns {(normalized_name, position): [player_dicts]} plus a by-id map.
    """
    raw = get(f"{SLEEPER}/players/nfl").json()
    by_id = {}
    by_key: dict[tuple[str, str], list] = {}

    for pid, player in raw.items():
        position = player.get("position")
        if position not in POSITIONS:
            continue
        full = player.get("full_name") or " ".join(
            filter(None, [player.get("first_name"), player.get("last_name")])
        )
        if not full.strip():
            continue
        record = {
            "player_id": pid,
            "name": full,
            "pos": position,
            "nfl": player.get("team"),
            "age": player.get("age"),
            "years_exp": player.get("years_exp"),
            "status": player.get("status"),
            "injury_status": player.get("injury_status"),
            "key": normalize(full),
        }
        by_id[pid] = record
        by_key.setdefault((record["key"], position), []).append(record)

    return {"by_id": by_id, "by_key": by_key}


# --------------------------------------------------------------------------
# keeptradecut
# --------------------------------------------------------------------------

ARRAY_PATTERN = re.compile(r"var\s+playersArray\s*=\s*(\[.*?\])\s*;", re.DOTALL)
PLAYER_HREF = re.compile(r"/dynasty-rankings/players/([a-z0-9-]+?)-(\d+)$")
POS_RANK = re.compile(r"\b(QB|RB|WR|TE)(\d+)\b")
AGE_PATTERN = re.compile(r"([\d.]+)\s*y\.o\.")
TIER_PATTERN = re.compile(r"Tier\s+(\d+)")


def parse_players_array(html: str) -> list[dict] | None:
    """Preferred path: KTC embeds the full ranking set as a JS literal.

    This is the cleanest source when present, since it carries both superflex
    and 1QB values without pagination. Returns None if the variable is gone,
    which is the signal to fall back to HTML parsing.
    """
    match = ARRAY_PATTERN.search(html)
    if not match:
        return None
    try:
        raw = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None

    out = []
    for entry in raw:
        values = entry.get("superflexValues") or entry.get("oneQBValues") or {}
        name = entry.get("playerName")
        if not name:
            continue
        out.append({
            "name": name,
            "pos": entry.get("position"),
            "nfl": entry.get("team"),
            "age": entry.get("age"),
            "value": values.get("value"),
            "overall_rank": values.get("rank"),
            "pos_rank": values.get("positionalRank"),
            "tier": values.get("overallTier"),
            "ktc_id": entry.get("playerID"),
        })
    return out or None


def parse_rankings_html(html: str) -> list[dict]:
    """Fallback: read the rendered rankings rows.

    Each row links to /dynasty-rankings/players/<slug>-<id>. Walking up from
    that link to its row container gives a text blob holding position rank,
    age, tier and value, with the value reliably last.
    """
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    seen = set()

    for link in soup.find_all("a", href=True):
        match = PLAYER_HREF.search(link["href"])
        if not match:
            continue
        slug, ktc_id = match.group(1), int(match.group(2))
        if ktc_id in seen:
            continue

        container = link
        for _ in range(5):
            if container.parent is None:
                break
            container = container.parent
            text = container.get_text(" ", strip=True)
            if AGE_PATTERN.search(text) or "PICK" in text:
                break
        else:
            continue

        text = container.get_text(" ", strip=True)
        numbers = re.findall(r"\b\d{2,5}\b", text.replace(",", ""))
        if not numbers:
            continue

        pos_match = POS_RANK.search(text)
        age_match = AGE_PATTERN.search(text)
        tier_match = TIER_PATTERN.search(text)

        rows.append({
            "name": link.get_text(strip=True) or slug.replace("-", " ").title(),
            "pos": pos_match.group(1) if pos_match else ("PICK" if "PICK" in text else None),
            "nfl": None,
            "age": float(age_match.group(1)) if age_match else None,
            "value": int(numbers[-1]),
            "overall_rank": None,
            "pos_rank": int(pos_match.group(2)) if pos_match else None,
            "tier": int(tier_match.group(1)) if tier_match else None,
            "ktc_id": ktc_id,
        })
        seen.add(ktc_id)

    return rows


def fetch_ktc(pages: int = 10, superflex: bool = True) -> list[dict]:
    fmt = 2 if superflex else 1
    first = get(KTC_RANKINGS, params={"page": 0, "format": fmt}).text

    embedded = parse_players_array(first)
    if embedded:
        print(f"  KTC: read {len(embedded)} entries from embedded array")
        return embedded

    print("  KTC: embedded array not found, falling back to HTML rows")
    collected: dict[int, dict] = {}
    for page in range(pages):
        html = first if page == 0 else get(
            KTC_RANKINGS, params={"page": page, "format": fmt}
        ).text
        rows = parse_rankings_html(html)
        if not rows:
            break
        before = len(collected)
        for row in rows:
            collected.setdefault(row["ktc_id"], row)
        if len(collected) == before:
            break
        if page < pages - 1:
            time.sleep(PAGE_DELAY_SECONDS)

    if not collected:
        raise RuntimeError(
            "KTC returned no parseable rows. The page structure likely changed. "
            "Inspect the saved HTML and update parse_rankings_html."
        )
    print(f"  KTC: read {len(collected)} entries from HTML")
    return list(collected.values())


# --------------------------------------------------------------------------
# matching
# --------------------------------------------------------------------------

def match_values(ktc_rows: list[dict], index: dict) -> tuple[dict, list, list]:
    """Join KTC values onto Sleeper player IDs.

    Keys on (normalized name, position) because same-name collisions are real
    and frequent. Where several Sleeper records collide, prefers the one on an
    active roster spot. Draft picks are split out separately.
    """
    values: dict[str, dict] = {}
    picks: list[dict] = []
    unmatched: list[dict] = []

    for row in ktc_rows:
        if row.get("pos") in ("PICK", "RDP") or not row.get("pos"):
            if row.get("value"):
                picks.append({
                    "label": row["name"],
                    "value": row["value"],
                    "ktc_id": row.get("ktc_id"),
                })
            continue

        key = normalize(row["name"])
        candidates = index["by_key"].get((key, row["pos"]), [])

        if not candidates:
            unmatched.append({"name": row["name"], "pos": row["pos"], "value": row["value"]})
            continue

        if len(candidates) > 1:
            wanted = TEAM_FIXES.get(row.get("nfl") or "", row.get("nfl"))
            same_team = [c for c in candidates if wanted and c["nfl"] == wanted]
            active = [c for c in candidates if c.get("nfl")]
            chosen = (same_team or active or candidates)[0]
        else:
            chosen = candidates[0]

        values[chosen["player_id"]] = {
            "value": row["value"],
            "pos_rank": row.get("pos_rank"),
            "tier": row.get("tier"),
            "ktc_id": row.get("ktc_id"),
            "ktc_age": row.get("age"),
        }

    return values, picks, unmatched


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--league-id", required=True)
    parser.add_argument("--out", default="data/snapshots")
    parser.add_argument("--pages", type=int, default=10)
    parser.add_argument("--one-qb", action="store_true", help="Use 1QB values instead of superflex")
    parser.add_argument("--force", action="store_true", help="Overwrite today's snapshot")
    args = parser.parse_args()

    stamp = date.today().isoformat()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{stamp}.json"

    if target.exists() and not args.force:
        print(f"Snapshot for {stamp} already exists. Nothing to do.")
        return 0

    print(f"Building snapshot for {stamp}")
    print("  Sleeper: league, rosters, users, traded picks")
    league_data = fetch_sleeper(args.league_id)

    print("  Sleeper: player index")
    index = fetch_player_index()

    ktc_rows = fetch_ktc(pages=args.pages, superflex=not args.one_qb)
    values, pick_values, unmatched = match_values(ktc_rows, index)

    rostered = {pid for team in league_data["teams"] for pid in team["players"]}
    missing = sorted(
        (pid for pid in rostered if pid not in values and pid in index["by_id"]),
        key=lambda pid: index["by_id"][pid]["name"],
    )

    players = {}
    for pid in rostered:
        record = index["by_id"].get(pid)
        if record:
            players[pid] = {
                "name": record["name"],
                "pos": record["pos"],
                "nfl": record["nfl"],
                "age": record["age"],
                "years_exp": record["years_exp"],
                "injury_status": record["injury_status"],
            }

    free_agents = []
    for pid, value in values.items():
        if pid in rostered:
            continue
        record = index["by_id"].get(pid)
        if not record or value["value"] is None:
            continue
        free_agents.append({
            "player_id": pid,
            "name": record["name"],
            "pos": record["pos"],
            "nfl": record["nfl"],
            "age": record["age"],
            "value": value["value"],
        })
    free_agents.sort(key=lambda p: p["value"], reverse=True)

    snapshot = {
        "date": stamp,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "format": "1qb" if args.one_qb else "superflex",
        "league": league_data["league"],
        "teams": league_data["teams"],
        "traded_picks": league_data["traded_picks"],
        "players": players,
        "values": {pid: v for pid, v in values.items() if pid in rostered},
        "pick_values": pick_values,
        "free_agents": free_agents[:200],
        "diagnostics": {
            "ktc_rows": len(ktc_rows),
            "matched": len(values),
            "rostered_without_value": missing,
            "ktc_unmatched_sample": unmatched[:40],
        },
    }

    target.write_text(json.dumps(snapshot, indent=2, sort_keys=True))
    print(f"Wrote {target}")
    print(f"  {len(players)} rostered players, {len(snapshot['values'])} valued")
    if missing:
        print(f"  {len(missing)} rostered players had no KTC match:")
        for pid in missing[:10]:
            print(f"    - {index['by_id'][pid]['name']} ({index['by_id'][pid]['pos']})")
        print("  Add any real misses to ALIASES and rerun with --force.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
