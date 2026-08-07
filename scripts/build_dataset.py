#!/usr/bin/env python3
"""Fold every snapshot into one time series the dashboard can read.

Snapshots are the raw record and are never modified. This step is pure
derivation, so it is always safe to delete public/data.json and rebuild.

Usage:
    python scripts/build_dataset.py --my-roster-id 7
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

FLEX_ELIGIBLE = {
    "FLEX": {"RB", "WR", "TE"},
    "REC_FLEX": {"WR", "TE"},
    "WRRB_FLEX": {"WR", "RB"},
    "SUPER_FLEX": {"QB", "RB", "WR", "TE"},
    "IDP_FLEX": set(),
}
DEDICATED = {"QB", "RB", "WR", "TE"}
SKIP_SLOTS = {"BN", "IR", "TAXI"}
ORDINALS = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th"}


def load_snapshots(directory: Path) -> list[dict]:
    files = sorted(directory.glob("*.json"))
    if not files:
        raise SystemExit(f"No snapshots in {directory}. Run fetch_snapshot.py first.")
    snapshots = []
    for path in files:
        try:
            snapshots.append(json.loads(path.read_text()))
        except json.JSONDecodeError:
            print(f"  skipping unreadable snapshot {path.name}")
    snapshots.sort(key=lambda s: s["date"])
    return snapshots


def optimal_starters(player_ids: list[str], snapshot: dict) -> tuple[list[str], int]:
    """Fill the league's actual lineup slots with the most valuable eligible players.

    Greedy fill of dedicated slots before flex slots, which is optimal here
    because every flex slot is a superset of some dedicated slot.
    """
    values = snapshot["values"]
    players = snapshot["players"]
    slots = [s for s in snapshot["league"]["roster_positions"] if s not in SKIP_SLOTS]

    pool = []
    for pid in player_ids:
        record = players.get(pid)
        value = (values.get(pid) or {}).get("value")
        if record and value:
            pool.append((value, pid, record["pos"]))
    pool.sort(reverse=True)

    used: set[str] = set()
    chosen: list[str] = []

    for slot in [s for s in slots if s in DEDICATED]:
        for value, pid, pos in pool:
            if pid not in used and pos == slot:
                used.add(pid)
                chosen.append(pid)
                break

    for slot in [s for s in slots if s not in DEDICATED]:
        eligible = FLEX_ELIGIBLE.get(slot, set())
        for value, pid, pos in pool:
            if pid not in used and pos in eligible:
                used.add(pid)
                chosen.append(pid)
                break

    total = sum((values.get(pid) or {}).get("value", 0) for pid in chosen)
    return chosen, total


def pick_lookup(pick_values: list[dict]) -> dict:
    return {entry["label"].strip().lower(): entry["value"] for entry in pick_values}


def value_pick(season: str, rnd: int, bucket: str, lookup: dict) -> int:
    ordinal = ORDINALS.get(rnd, f"{rnd}th")
    for label in (
        f"{season} {bucket} {ordinal}",
        f"{season} {ordinal}",
        f"{season} mid {ordinal}",
    ):
        hit = lookup.get(label.lower())
        if hit:
            return hit
    return 0


def build_pick_inventory(snapshot: dict, rounds: int) -> dict[int, list[dict]]:
    """Reconstruct who owns which rookie picks.

    Sleeper only reports picks that have moved, so ownership starts at the
    original roster and gets overridden by the traded_picks feed.
    """
    league = snapshot["league"]
    season = int(league.get("season") or 0)
    roster_ids = [t["roster_id"] for t in snapshot["teams"]]
    lookup = pick_lookup(snapshot.get("pick_values") or [])

    # Projected draft order: worst record picks first, so the weakest teams
    # hold the Early picks. Thirds, which is how KTC buckets them.
    standings = sorted(
        snapshot["teams"],
        key=lambda t: (t.get("wins", 0), t.get("points_for", 0)),
    )
    order = {t["roster_id"]: i for i, t in enumerate(standings)}
    third = max(1, len(roster_ids) / 3)

    def bucket_for(roster_id: int, target_season: int) -> str:
        if target_season != season + 1:
            return "mid"
        slot = order.get(roster_id, len(roster_ids) // 2)
        return "early" if slot < third else ("mid" if slot < third * 2 else "late")

    owners: dict[tuple[str, int, int], int] = {}
    for season_offset in range(1, 4):
        target = str(season + season_offset)
        for rnd in range(1, rounds + 1):
            for roster_id in roster_ids:
                owners[(target, rnd, roster_id)] = roster_id

    for traded in snapshot.get("traded_picks") or []:
        key = (str(traded.get("season")), traded.get("round"), traded.get("roster_id"))
        if key in owners and traded.get("owner_id"):
            owners[key] = traded["owner_id"]

    inventory: dict[int, list[dict]] = {rid: [] for rid in roster_ids}
    for (target, rnd, original), owner in owners.items():
        if owner not in inventory:
            continue
        bucket = bucket_for(original, int(target))
        inventory[owner].append({
            "season": target,
            "round": rnd,
            "bucket": bucket,
            "from": original,
            "own": original == owner,
            "value": value_pick(target, rnd, bucket, lookup),
        })

    for rid in inventory:
        inventory[rid].sort(key=lambda p: (p["season"], p["round"], -p["value"]))
    return inventory


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshots", default="data/snapshots")
    parser.add_argument("--out", default="public/data.json")
    parser.add_argument("--my-roster-id", type=int, default=None)
    parser.add_argument("--rookie-rounds", type=int, default=4)
    parser.add_argument("--fa-limit", type=int, default=120)
    args = parser.parse_args()

    snapshots = load_snapshots(Path(args.snapshots))
    latest = snapshots[-1]
    dates = [s["date"] for s in snapshots]
    print(f"Folding {len(snapshots)} snapshots: {dates[0]} to {dates[-1]}")

    roster_ids = [t["roster_id"] for t in latest["teams"]]

    team_series = {
        str(rid): {k: [] for k in ("total", "starters", "QB", "RB", "WR", "TE", "picks")}
        for rid in roster_ids
    }
    player_series: dict[str, list] = {}
    tracked: set[str] = set()

    for snapshot in snapshots:
        picks = build_pick_inventory(snapshot, args.rookie_rounds)
        by_roster = {t["roster_id"]: t for t in snapshot["teams"]}

        for rid in roster_ids:
            series = team_series[str(rid)]
            team = by_roster.get(rid)
            if not team:
                for key in series:
                    series[key].append(None)
                continue

            ids = team["players"]
            by_pos = {"QB": 0, "RB": 0, "WR": 0, "TE": 0}
            total = 0
            for pid in ids:
                value = (snapshot["values"].get(pid) or {}).get("value")
                record = snapshot["players"].get(pid)
                if not value or not record:
                    continue
                total += value
                if record["pos"] in by_pos:
                    by_pos[record["pos"]] += value

            _, starter_total = optimal_starters(ids, snapshot)
            pick_total = sum(p["value"] for p in picks.get(rid, []))

            series["total"].append(total + pick_total)
            series["starters"].append(starter_total)
            series["picks"].append(pick_total)
            for pos in by_pos:
                series[pos].append(by_pos[pos])

        for pid in snapshot["values"]:
            tracked.add(pid)
        for entry in snapshot.get("free_agents", [])[: args.fa_limit]:
            tracked.add(entry["player_id"])

    for pid in tracked:
        row = []
        for snapshot in snapshots:
            value = (snapshot["values"].get(pid) or {}).get("value")
            if value is None:
                match = next(
                    (f["value"] for f in snapshot.get("free_agents", []) if f["player_id"] == pid),
                    None,
                )
                value = match
            row.append(value)
        if any(v is not None for v in row):
            player_series[pid] = row

    directory: dict[str, dict] = {}
    for snapshot in snapshots:
        for pid, record in snapshot["players"].items():
            directory[pid] = record
        for entry in snapshot.get("free_agents", []):
            directory.setdefault(entry["player_id"], {
                "name": entry["name"], "pos": entry["pos"],
                "nfl": entry["nfl"], "age": entry["age"],
            })

    rostered_now = {pid for t in latest["teams"] for pid in t["players"]}
    latest_picks = build_pick_inventory(latest, args.rookie_rounds)

    dataset = {
        "meta": {
            "league_id": latest["league"]["league_id"],
            "league_name": latest["league"]["name"],
            "season": latest["league"]["season"],
            "format": latest.get("format", "superflex"),
            "roster_positions": latest["league"]["roster_positions"],
            "dates": dates,
            "my_roster_id": args.my_roster_id,
            "generated_at": latest["captured_at"],
        },
        "teams": [
            {
                "roster_id": t["roster_id"],
                "manager": t["manager"],
                "name": t["name"],
                "wins": t.get("wins", 0),
                "losses": t.get("losses", 0),
                "points_for": t.get("points_for", 0),
            }
            for t in latest["teams"]
        ],
        "players": {pid: directory[pid] for pid in directory},
        "rosters": {str(t["roster_id"]): t["players"] for t in latest["teams"]},
        "picks": {str(rid): latest_picks.get(rid, []) for rid in roster_ids},
        "team_series": team_series,
        "player_series": player_series,
        "free_agents": [
            {"player_id": f["player_id"], "value": f["value"]}
            for f in latest.get("free_agents", [])[: args.fa_limit]
            if f["player_id"] not in rostered_now
        ],
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dataset, separators=(",", ":")))
    size_kb = out.stat().st_size / 1024
    print(f"Wrote {out} ({size_kb:.0f} KB)")
    print(f"  {len(dataset['teams'])} teams, {len(player_series)} tracked assets")
    if len(dates) < 8:
        print(f"  Only {len(dates)} days of history. Trend columns fill in as this accumulates.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
