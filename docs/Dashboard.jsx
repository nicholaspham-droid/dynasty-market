import React, { useState, useEffect, useMemo } from "react";

/* ----------------------------------------------------------------------
   Dynasty market board

   Reads public/data.json produced by scripts/build_dataset.py. When that
   file is absent, as it is inside a preview, it falls back to a generated
   sample league so every view stays explorable.
   ---------------------------------------------------------------------- */

const C = {
  paper: "#E9EBE6",
  panel: "#F4F5F1",
  sunk: "#DFE3DC",
  rule: "#C8CDC5",
  ink: "#171C19",
  soft: "#5C6560",
  faint: "#8B938C",
  up: "#0B6E4F",
  down: "#8C2F39",
  brass: "#8A6D1F",
};

const POSITIONS = ["QB", "RB", "WR", "TE"];
const POS_TINT = { QB: "#3A5A8C", RB: "#0B6E4F", WR: "#8A6D1F", TE: "#7A3E6B" };
const SKIP_SLOTS = new Set(["BN", "IR", "TAXI"]);
const FLEX_ELIGIBLE = {
  FLEX: ["RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString());
const signed = (n) => (n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n)));
const ORD = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };
const pickLabel = (p) =>
  `${p.season} ${p.bucket} ${ORD[p.round] || `${p.round}th`}`;

/* ---------------------------------------------------------------- sample */

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_POOL = [
  ["Jahmyr Gibbs", "RB", 9997], ["Ja'Marr Chase", "WR", 9992], ["Josh Allen", "QB", 9988],
  ["Bijan Robinson", "RB", 9988], ["Jaxon Smith-Njigba", "WR", 9282], ["Drake Maye", "QB", 9206],
  ["Puka Nacua", "WR", 8882], ["Brock Bowers", "TE", 8246], ["Amon-Ra St. Brown", "WR", 7896],
  ["Caleb Williams", "QB", 7887], ["Ashton Jeanty", "RB", 7627], ["Lamar Jackson", "QB", 7576],
  ["Justin Jefferson", "WR", 7538], ["Jayden Daniels", "QB", 7537], ["Joe Burrow", "QB", 7444],
  ["Jeremiyah Love", "RB", 7410], ["Malik Nabers", "WR", 7328], ["Trey McBride", "TE", 7326],
  ["CeeDee Lamb", "WR", 7167], ["Justin Herbert", "QB", 7078], ["Omarion Hampton", "RB", 7027],
  ["Drake London", "WR", 6970], ["De'Von Achane", "RB", 6818], ["Tetairoa McMillan", "WR", 6406],
  ["Colston Loveland", "TE", 6324], ["Emeka Egbuka", "WR", 6322], ["Patrick Mahomes", "QB", 6271],
  ["Trevor Lawrence", "QB", 6221], ["Jonathan Taylor", "RB", 6203], ["Jaxson Dart", "QB", 6187],
  ["George Pickens", "WR", 6169], ["James Cook", "RB", 6126], ["Jalen Hurts", "QB", 6072],
  ["Carnell Tate", "WR", 5987], ["Bo Nix", "QB", 5977], ["Tyler Warren", "TE", 5951],
  ["Brock Purdy", "QB", 5738], ["Chris Olave", "WR", 5647], ["Ladd McConkey", "WR", 5634],
  ["Kenneth Walker III", "RB", 5590], ["Garrett Wilson", "WR", 5573], ["Nico Collins", "WR", 5565],
  ["Luther Burden", "WR", 5539], ["Quinshon Judkins", "RB", 5465], ["Chase Brown", "RB", 5454],
  ["Jordan Love", "QB", 5431], ["DeVonta Smith", "WR", 5426], ["Rome Odunze", "WR", 5180],
  ["Xavier Worthy", "WR", 5050], ["Bucky Irving", "RB", 4980], ["Marvin Harrison Jr.", "WR", 4890],
  ["Sam LaPorta", "TE", 4610], ["Kyren Williams", "RB", 4390], ["Dak Prescott", "QB", 4280],
  ["Jayden Higgins", "WR", 4210], ["Travis Hunter", "WR", 4120], ["Breece Hall", "RB", 3980],
  ["Jared Goff", "QB", 3870], ["Courtland Sutton", "WR", 3760], ["Isiah Pacheco", "RB", 3640],
  ["Zay Flowers", "WR", 3520], ["Dalton Kincaid", "TE", 3410], ["Tucker Kraft", "TE", 3300],
  ["Jerry Jeudy", "WR", 3180], ["Michael Penix Jr.", "QB", 3080], ["Javonte Williams", "RB", 2960],
  ["Rashee Rice", "WR", 2870], ["Keon Coleman", "WR", 2740], ["Jaylen Waddle", "WR", 2650],
  ["Tony Pollard", "RB", 2530], ["David Njoku", "TE", 2410], ["Calvin Ridley", "WR", 2300],
  ["Aaron Jones", "RB", 2180], ["Deebo Samuel", "WR", 2060], ["Geno Smith", "QB", 1940],
  ["Jakobi Meyers", "WR", 1820], ["Chris Godwin", "WR", 1710], ["Sam Darnold", "QB", 1600],
  ["Najee Harris", "RB", 1480], ["Tyreek Hill", "WR", 1360], ["Bryce Young", "QB", 1240],
  ["Brandon Aiyuk", "WR", 1120], ["Ricky Pearsall", "WR", 1010],
];

// Depth. A 10-team superflex roster runs ~20 deep, and without a real bench
// the lineup optimizer has nothing to choose between. Values here decay on a
// curve rather than being hand-set, since only the ordering matters.
const SAMPLE_TAIL = [
  ["Kyler Murray", "QB"], ["Josh Jacobs", "RB"], ["DK Metcalf", "WR"], ["George Kittle", "TE"],
  ["Tua Tagovailoa", "QB"], ["Derrick Henry", "RB"], ["Terry McLaurin", "WR"], ["Mark Andrews", "TE"],
  ["Anthony Richardson", "QB"], ["Saquon Barkley", "RB"], ["Mike Evans", "WR"], ["Evan Engram", "TE"],
  ["Shedeur Sanders", "QB"], ["Travis Etienne", "RB"], ["Davante Adams", "WR"], ["T.J. Hockenson", "TE"],
  ["Dillon Gabriel", "QB"], ["Rhamondre Stevenson", "RB"], ["Michael Pittman", "WR"], ["Kyle Pitts", "TE"],
  ["Jalen Milroe", "QB"], ["TreVeyon Henderson", "RB"], ["Jayden Reed", "WR"], ["Isaiah Likely", "TE"],
  ["Tyler Shough", "QB"], ["Cam Skattebo", "RB"], ["Josh Downs", "WR"], ["Brenton Strange", "TE"],
  ["Quinn Ewers", "QB"], ["RJ Harvey", "RB"], ["Matthew Golden", "WR"], ["Dalton Schultz", "TE"],
  ["Will Levis", "QB"], ["Zach Charbonnet", "RB"], ["Khalil Shakir", "WR"], ["Cole Kmet", "TE"],
  ["Spencer Rattler", "QB"], ["Bhayshul Tuten", "RB"], ["Tre Harris", "WR"], ["Mason Taylor", "TE"],
  ["Aaron Rodgers", "QB"], ["Trey Benson", "RB"], ["Jayden Higgins", "WR"], ["Ben Sinnott", "TE"],
  ["Russell Wilson", "QB"], ["Blake Corum", "RB"], ["Rashid Shaheed", "WR"], ["Harold Fannin", "TE"],
  ["Daniel Jones", "QB"], ["Braelon Allen", "RB"], ["Jalen Royals", "WR"], ["Elijah Arroyo", "TE"],
  ["Gardner Minshew", "QB"], ["Tyjae Spears", "RB"], ["Alec Pierce", "WR"], ["Jonnu Smith", "TE"],
  ["Jameis Winston", "QB"], ["Jaylen Warren", "RB"], ["Marvin Mims", "WR"], ["Pat Freiermuth", "TE"],
  ["Malik Willis", "QB"], ["Chuba Hubbard", "RB"], ["Isaiah Bond", "WR"], ["Chig Okonkwo", "TE"],
  ["Aidan O'Connell", "QB"], ["Rico Dowdle", "RB"], ["Tory Horton", "WR"], ["Theo Johnson", "TE"],
  ["Kenny Pickett", "QB"], ["Jordan Mason", "RB"], ["Kyle Williams", "WR"], ["Noah Fant", "TE"],
  ["Mac Jones", "QB"], ["Tank Bigsby", "RB"], ["Jack Bech", "WR"], ["Cade Otton", "TE"],
  ["Jarrett Stidham", "QB"], ["Kaleb Johnson", "RB"], ["Jaylin Noel", "WR"], ["Hunter Henry", "TE"],
  ["Tanner McKee", "QB"], ["Jaydon Blue", "RB"], ["Elic Ayomanor", "WR"], ["Zach Ertz", "TE"],
  ["Desmond Ridder", "QB"], ["Dylan Sampson", "RB"], ["Savion Williams", "WR"], ["Mike Gesicki", "TE"],
  ["Tyler Huntley", "QB"], ["Woody Marks", "RB"], ["Quentin Johnston", "WR"], ["Gunnar Helm", "TE"],
  ["Kirk Cousins", "QB"], ["Devin Neal", "RB"], ["Cedric Tillman", "WR"], ["Terrance Ferguson", "TE"],
  ["Michael Pratt", "QB"], ["Keaton Mitchell", "RB"], ["Troy Franklin", "WR"], ["Ja'Tavion Sanders", "TE"],
  ["Cam Miller", "QB"], ["Kimani Vidal", "RB"], ["Xavier Legette", "WR"], ["Oronde Gadsden", "TE"],
  ["Jalen Tolbert", "WR"], ["Tyler Allgeier", "RB"], ["Wan'Dale Robinson", "WR"],
  ["Isaac Guerendo", "RB"], ["Dontayvion Wicks", "WR"], ["Jerome Ford", "RB"],
  ["Romeo Doubs", "WR"], ["Will Shipley", "RB"], ["Darius Slayton", "WR"],
];

const SAMPLE_TEAMS = [
  "Norm's Ghost", "Turf Monsters", "Bagholders", "The Rebuild",
  "Screen Pass Co.", "Deadpan Dynasty", "Value Over Vibes", "Fourth & Long",
  "Regression Kings", "Late Round Larry",
];

export function buildSample() {
  const rand = mulberry32(20260806);
  const days = 74;
  const dates = [];
  const start = new Date("2026-08-06T00:00:00Z");
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const players = {};
  const playerSeries = {};
  const pool = [
    ...SAMPLE_POOL,
    ...SAMPLE_TAIL.map(([name, pos], i) => [name, pos, Math.round(950 * Math.exp(-i / 46) + 135)]),
  ];
  const order = pool
    .map((p) => ({ p, r: rand() }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.p);

  order.forEach(([name, pos, value], i) => {
    const pid = `s${i}`;
    players[pid] = { name, pos, nfl: null, age: Math.round((21 + rand() * 10) * 10) / 10 };
    // Walk backward from today's value so the last point is the real one.
    const series = new Array(days);
    series[days - 1] = value;
    let cur = value;
    const drift = (rand() - 0.45) * value * 0.0022;
    for (let d = days - 2; d >= 0; d--) {
      const shock = rand() < 0.05 ? (rand() - 0.5) * value * 0.09 : 0;
      cur = cur - drift + (rand() - 0.5) * value * 0.008 - shock;
      series[d] = Math.max(120, Math.round(cur));
    }
    playerSeries[pid] = series;
  });

  const rosters = {};
  const picks = {};
  for (let t = 1; t <= 10; t++) {
    rosters[String(t)] = [];
    picks[String(t)] = [];
  }
  // Snake within each position, rotating the starting seat per position.
  // Even counts keep every lineup fillable, while the rotation still leaves
  // real positional imbalance for the trade finder to work against.
  // Hold back the cheapest few at each position as the waiver pool, so the
  // market view has something unrostered to rank.
  const freeAgentIds = new Set();
  POSITIONS.forEach((pos) => {
    Object.keys(players)
      .filter((pid) => players[pid].pos === pos)
      .sort((a, b) => playerSeries[b][days - 1] - playerSeries[a][days - 1])
      .slice(-3)
      .forEach((pid) => freeAgentIds.add(pid));
  });

  POSITIONS.forEach((pos) => {
    const group = Object.keys(players)
      .filter((pid) => players[pid].pos === pos && !freeAgentIds.has(pid))
      .sort((a, b) => playerSeries[b][days - 1] - playerSeries[a][days - 1]);
    const offset = Math.floor(rand() * 10);
    group.forEach((pid, i) => {
      const round = Math.floor(i / 10);
      const slot = i % 10;
      const seat = round % 2 === 0 ? slot : 9 - slot;
      rosters[String(((seat + offset) % 10) + 1)].push(pid);
    });
  });

  const pickMenu = [
    ["2027", 1, "early", 7068], ["2027", 1, "mid", 5581], ["2027", 1, "late", 4310],
    ["2026", 1, "early", 5536], ["2027", 2, "mid", 2640], ["2028", 1, "mid", 4900],
    ["2027", 3, "mid", 1180], ["2026", 2, "mid", 2180],
  ];
  for (let t = 1; t <= 10; t++) {
    const count = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) {
      const [season, round, bucket, value] = pickMenu[Math.floor(rand() * pickMenu.length)];
      picks[String(t)].push({ season, round, bucket, value, own: rand() > 0.35, from: t });
    }
  }

  const rosterPositions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"];
  const teamSeries = {};
  for (let t = 1; t <= 10; t++) {
    const key = String(t);
    const pickTotal = picks[key].reduce((a, p) => a + p.value, 0);
    const totals = dates.map((_, d) =>
      rosters[key].reduce((a, pid) => a + playerSeries[pid][d], 0) + pickTotal
    );
    teamSeries[key] = { total: totals, picks: dates.map(() => pickTotal) };
    POSITIONS.forEach((pos) => {
      teamSeries[key][pos] = dates.map((_, d) =>
        rosters[key]
          .filter((pid) => players[pid].pos === pos)
          .reduce((a, pid) => a + playerSeries[pid][d], 0)
      );
    });
  }

  return {
    meta: {
      league_name: "Sample Dynasty League",
      season: "2026",
      format: "superflex",
      roster_positions: rosterPositions,
      dates,
      my_roster_id: 7,
      generated_at: new Date().toISOString(),
    },
    teams: Array.from({ length: 10 }, (_, i) => ({
      roster_id: i + 1,
      name: SAMPLE_TEAMS[i],
      manager: SAMPLE_TEAMS[i],
      wins: Math.floor(rand() * 8),
      losses: 0,
      points_for: 0,
    })),
    players,
    rosters,
    picks,
    team_series: teamSeries,
    player_series: playerSeries,
    free_agents: [...freeAgentIds]
      .map((pid) => ({ player_id: pid, value: playerSeries[pid][days - 1] }))
      .sort((a, b) => b.value - a.value),
  };
}

/* -------------------------------------------------------------- analytics */

function lastDefined(series, idx) {
  if (!series) return null;
  for (let i = Math.min(idx, series.length - 1); i >= 0; i--) {
    if (series[i] != null) return series[i];
  }
  return null;
}

export function analyzeTeam(rosterId, data, idx) {
  const key = String(rosterId);
  const ids = data.rosters[key] || [];
  const roster = ids
    .map((pid) => {
      const meta = data.players[pid];
      const value = lastDefined(data.player_series[pid], idx);
      return meta && value ? { pid, ...meta, value } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value);

  const slots = (data.meta.roster_positions || []).filter((s) => !SKIP_SLOTS.has(s));
  const used = new Set();
  const lineup = [];

  slots.filter((s) => POSITIONS.includes(s)).forEach((slot) => {
    const pick = roster.find((p) => !used.has(p.pid) && p.pos === slot);
    if (pick) {
      used.add(pick.pid);
      lineup.push({ slot, ...pick });
    }
  });
  slots.filter((s) => !POSITIONS.includes(s)).forEach((slot) => {
    const eligible = FLEX_ELIGIBLE[slot] || [];
    const pick = roster.find((p) => !used.has(p.pid) && eligible.includes(p.pos));
    if (pick) {
      used.add(pick.pid);
      lineup.push({ slot, ...pick });
    }
  });

  const starterByPos = {};
  const surplusByPos = {};
  POSITIONS.forEach((pos) => {
    starterByPos[pos] = lineup.filter((p) => p.pos === pos).reduce((a, p) => a + p.value, 0);
    // Surplus is depth beyond the slots that genuinely require this position,
    // not simply whoever missed the lineup. A team's third quarterback in
    // superflex is a real trade chip even while he fills the flex, because
    // moving him just promotes the next receiver into that slot.
    const required = slots.filter((s) => s === pos).length;
    surplusByPos[pos] = roster.filter((p) => p.pos === pos).slice(required);
  });

  const pickList = data.picks[key] || [];
  const pickValue = pickList.reduce((a, p) => a + (p.value || 0), 0);

  return {
    rosterId,
    roster,
    lineup,
    starterIds: used,
    starterByPos,
    surplusByPos,
    starterTotal: lineup.reduce((a, p) => a + p.value, 0),
    playerTotal: roster.reduce((a, p) => a + p.value, 0),
    pickValue,
    picks: pickList,
    total: roster.reduce((a, p) => a + p.value, 0) + pickValue,
  };
}

export function positionRanks(analyses) {
  // Where each team sits league-wide in starting-lineup value per position.
  // 1 is strongest. This is what turns "I have four QBs" into "and three
  // teams cannot field two."
  const ranks = {};
  POSITIONS.forEach((pos) => {
    const sorted = [...analyses].sort((a, b) => b.starterByPos[pos] - a.starterByPos[pos]);
    sorted.forEach((a, i) => {
      ranks[a.rosterId] = ranks[a.rosterId] || {};
      ranks[a.rosterId][pos] = i + 1;
    });
  });
  return ranks;
}

/* ------------------------------------------------------------------ parts */

function Spark({ series, idx, span, width = 108, height = 26 }) {
  const points = useMemo(() => {
    const from = Math.max(0, idx - span + 1);
    const slice = (series || []).slice(from, idx + 1).filter((v) => v != null);
    if (slice.length < 2) return null;
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    const range = max - min || 1;
    return slice
      .map((v, i) => {
        const x = (i / (slice.length - 1)) * (width - 2) + 1;
        const y = height - 2 - ((v - min) / range) * (height - 4);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [series, idx, span, width, height]);

  if (!points) return <svg width={width} height={height} aria-hidden="true" />;
  const parts = points.split(" ");
  const rising = parseFloat(parts[parts.length - 1].split(",")[1]) <= parseFloat(parts[0].split(",")[1]);

  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: "block" }}>
      <polyline
        points={points}
        fill="none"
        stroke={rising ? C.up : C.down}
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Delta({ value, pct }) {
  const tone = value > 0 ? C.up : value < 0 ? C.down : C.faint;
  return (
    <span className="num" style={{ color: tone, fontWeight: 600 }}>
      {signed(value)}
      {pct != null && Math.abs(pct) >= 0.1 && (
        <span style={{ color: C.faint, fontWeight: 400, marginLeft: 6, fontSize: "0.82em" }}>
          {pct > 0 ? "+" : "−"}
          {Math.abs(pct).toFixed(1)}%
        </span>
      )}
    </span>
  );
}

function PosBar({ byPos, max }) {
  return (
    <div className="posbar">
      {POSITIONS.map((pos) => {
        const width = max ? (byPos[pos] / max) * 100 : 0;
        return (
          <div key={pos} className="posbar-row">
            <span className="posbar-label">{pos}</span>
            <div className="posbar-track">
              <div
                className="posbar-fill"
                style={{ width: `${Math.max(width, 0.6)}%`, background: POS_TINT[pos] }}
              />
            </div>
            <span className="num posbar-val">{fmt(byPos[pos])}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- app */

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [live, setLive] = useState(false);
  const [view, setView] = useState("board");
  const [span, setSpan] = useState(30);
  const [sortKey, setSortKey] = useState("total");
  const [focus, setFocus] = useState(null);
  const [partner, setPartner] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("data.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no dataset"))))
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setLive(true);
      })
      .catch(() => {
        if (!cancelled) setData(buildSample());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const idx = data ? data.meta.dates.length - 1 : 0;
  const back = Math.max(0, idx - span + 1);

  const analyses = useMemo(() => {
    if (!data) return [];
    return data.teams.map((t) => analyzeTeam(t.roster_id, data, idx));
  }, [data, idx]);

  const ranks = useMemo(() => (analyses.length ? positionRanks(analyses) : {}), [analyses]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.teams
      .map((team) => {
        const series = data.team_series[String(team.roster_id)]?.total || [];
        const now = lastDefined(series, idx);
        const then = lastDefined(series, back);
        const analysis = analyses.find((a) => a.rosterId === team.roster_id);
        const delta = now != null && then != null ? now - then : null;
        return {
          team,
          series,
          now,
          delta,
          pct: delta != null && then ? (delta / then) * 100 : null,
          starters: analysis?.starterTotal ?? 0,
          analysis,
        };
      })
      .sort((a, b) => {
        if (sortKey === "momentum") return (b.delta ?? -1e9) - (a.delta ?? -1e9);
        if (sortKey === "starters") return b.starters - a.starters;
        return (b.now ?? 0) - (a.now ?? 0);
      });
  }, [data, idx, back, sortKey, analyses]);

  const movers = useMemo(() => {
    if (!data) return [];
    const owner = {};
    Object.entries(data.rosters).forEach(([rid, ids]) =>
      ids.forEach((pid) => {
        owner[pid] = rid;
      })
    );
    return Object.entries(data.player_series)
      .map(([pid, series]) => {
        const meta = data.players[pid];
        const now = lastDefined(series, idx);
        const then = lastDefined(series, back);
        if (!meta || now == null || then == null) return null;
        return { pid, ...meta, now, delta: now - then, pct: then ? ((now - then) / then) * 100 : 0, owner: owner[pid] };
      })
      .filter(Boolean)
      .sort((a, b) => b.delta - a.delta);
  }, [data, idx, back]);

  if (!data) {
    return (
      <div className="shell">
        <Styles />
        <div className="loading">Loading market data</div>
      </div>
    );
  }

  const me = data.meta.my_roster_id;
  const teamName = (rid) => data.teams.find((t) => t.roster_id === rid)?.name || `Roster ${rid}`;
  const focused = focus ?? me ?? data.teams[0].roster_id;
  const asOf = data.meta.dates[idx];
  const spanLabel = span >= 999 ? "all time" : `${span} days`;

  return (
    <div className="shell">
      <Styles />

      <header className="head">
        <div className="head-left">
          <h1>{data.meta.league_name || "Dynasty Market"}</h1>
          <p className="meta">
            {data.meta.format === "superflex" ? "Superflex" : "1QB"} · {data.teams.length} teams · as of {asOf}
            {!live && <span className="badge">sample data</span>}
          </p>
        </div>
        <div className="spans" role="group" aria-label="Time window">
          {[7, 30, 999].map((s) => (
            <button
              key={s}
              className={span === s ? "chip on" : "chip"}
              onClick={() => setSpan(s)}
              aria-pressed={span === s}
            >
              {s === 999 ? "ALL" : `${s}D`}
            </button>
          ))}
        </div>
      </header>

      <nav className="tabs">
        {[
          ["board", "Board"],
          ["team", "Team"],
          ["trades", "Trades"],
          ["market", "Market"],
        ].map(([id, label]) => (
          <button key={id} className={view === id ? "tab on" : "tab"} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </nav>

      {view === "board" && (
        <section>
          <div className="sortbar">
            <span className="eyebrow">Rank by</span>
            {[
              ["total", "Total value"],
              ["starters", "Starting lineup"],
              ["momentum", `Momentum, ${spanLabel}`],
            ].map(([id, label]) => (
              <button
                key={id}
                className={sortKey === id ? "chip on" : "chip"}
                onClick={() => setSortKey(id)}
                aria-pressed={sortKey === id}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="board" style={{ height: rows.length * 62 }}>
            {rows.map((row, position) => {
              const mine = row.team.roster_id === me;
              return (
                <button
                  key={row.team.roster_id}
                  className={mine ? "tickrow mine" : "tickrow"}
                  style={{ transform: `translateY(${position * 62}px)` }}
                  onClick={() => {
                    setFocus(row.team.roster_id);
                    setView("team");
                  }}
                >
                  <span className="num rank">{String(position + 1).padStart(2, "0")}</span>
                  <span className="tname">
                    {row.team.name}
                    {mine && <span className="you">you</span>}
                  </span>
                  <Spark series={row.series} idx={idx} span={span} />
                  <span className="num total">{fmt(row.now)}</span>
                  <span className="dcell">
                    <Delta value={row.delta} pct={row.pct} />
                  </span>
                </button>
              );
            })}
          </div>
          <p className="note">
            Total includes rookie picks valued at KTC's bucketed pick prices. Tap a team for its
            positional breakdown.
          </p>
        </section>
      )}

      {view === "team" && (
        <section>
          <div className="sortbar wrap">
            <span className="eyebrow">Team</span>
            {data.teams.map((t) => (
              <button
                key={t.roster_id}
                className={focused === t.roster_id ? "chip on" : "chip"}
                onClick={() => setFocus(t.roster_id)}
              >
                {t.name}
              </button>
            ))}
          </div>
          <TeamPanel
            analysis={analyses.find((a) => a.rosterId === focused)}
            data={data}
            idx={idx}
            back={back}
            span={span}
            ranks={ranks[focused] || {}}
          />
        </section>
      )}

      {view === "trades" && (
        <TradePanel
          data={data}
          analyses={analyses}
          ranks={ranks}
          me={me ?? data.teams[0].roster_id}
          partner={partner}
          setPartner={setPartner}
          teamName={teamName}
        />
      )}

      {view === "market" && (
        <section>
          <div className="cols">
            <MoverList title="Risers" rows={movers.slice(0, 12)} data={data} idx={idx} span={span} teamName={teamName} />
            <MoverList
              title="Fallers"
              rows={movers.slice(-12).reverse()}
              data={data}
              idx={idx}
              span={span}
              teamName={teamName}
            />
          </div>
          {data.free_agents?.length > 0 && (
            <div className="panel">
              <h2 className="eyebrow">Unrostered, by market value</h2>
              <table className="grid">
                <tbody>
                  {data.free_agents.slice(0, 15).map((fa) => {
                    const meta = data.players[fa.player_id] || {};
                    return (
                      <tr key={fa.player_id}>
                        <td>
                          <span className="pos" style={{ color: POS_TINT[meta.pos] }}>
                            {meta.pos}
                          </span>
                          {meta.name}
                        </td>
                        <td className="num right">{fmt(fa.value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- panels */

function TeamPanel({ analysis, data, idx, back, span, ranks }) {
  if (!analysis) return null;
  const maxPos = Math.max(...POSITIONS.map((p) => analysis.starterByPos[p] || 0), 1);

  return (
    <div className="cols">
      <div className="panel">
        <h2 className="eyebrow">Starting lineup strength</h2>
        <PosBar byPos={analysis.starterByPos} max={maxPos} />
        <div className="rankrow">
          {POSITIONS.map((pos) => (
            <div key={pos} className="rankchip">
              <span className="rankchip-pos">{pos}</span>
              <span className="num rankchip-num" style={{ color: ranks[pos] <= 3 ? C.up : ranks[pos] >= 8 ? C.down : C.soft }}>
                #{ranks[pos] ?? "—"}
              </span>
            </div>
          ))}
        </div>
        <dl className="stats">
          <div>
            <dt>Lineup</dt>
            <dd className="num">{fmt(analysis.starterTotal)}</dd>
          </div>
          <div>
            <dt>Bench</dt>
            <dd className="num">{fmt(analysis.playerTotal - analysis.starterTotal)}</dd>
          </div>
          <div>
            <dt>Picks</dt>
            <dd className="num">{fmt(analysis.pickValue)}</dd>
          </div>
        </dl>
        {analysis.picks.length > 0 && (
          <ul className="picks">
            {analysis.picks.map((p, i) => (
              <li key={i}>
                <span>
                  {pickLabel(p)}
                  {!p.own && <span className="via">via {p.from}</span>}
                </span>
                <span className="num">{fmt(p.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h2 className="eyebrow">Assets</h2>
        <table className="grid">
          <tbody>
            {analysis.roster.map((p) => {
              const series = data.player_series[p.pid];
              const then = lastDefined(series, back);
              const delta = then != null ? p.value - then : null;
              return (
                <tr key={p.pid} className={analysis.starterIds.has(p.pid) ? "starter" : ""}>
                  <td>
                    <span className="pos" style={{ color: POS_TINT[p.pos] }}>
                      {p.pos}
                    </span>
                    {p.name}
                  </td>
                  <td className="sparkcell">
                    <Spark series={series} idx={idx} span={span} width={70} height={20} />
                  </td>
                  <td className="num right">{fmt(p.value)}</td>
                  <td className="right">
                    <Delta value={delta} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="note">Shaded rows are the optimal starting lineup at current market value.</p>
      </div>
    </div>
  );
}

function TradePanel({ data, analyses, ranks, me, partner, setPartner, teamName }) {
  const mine = analyses.find((a) => a.rosterId === me);
  const others = data.teams.filter((t) => t.roster_id !== me);
  const chosen = partner ?? others[0]?.roster_id;
  const theirs = analyses.find((a) => a.rosterId === chosen);

  const fits = useMemo(() => {
    if (!mine || !theirs) return [];
    const myRank = ranks[me] || {};
    const theirRank = ranks[chosen] || {};
    const out = [];

    POSITIONS.forEach((givePos) => {
      POSITIONS.forEach((getPos) => {
        if (givePos === getPos) return;
        // Mutual benefit: they are weaker than me where I would send, and I am
        // weaker than them where I would receive. Comparing the two teams
        // directly beats an absolute cutoff, which finds nothing whenever both
        // sides sit mid-table.
        const theyNeed = (theirRank[givePos] ?? 5) - (myRank[givePos] ?? 5);
        const iNeed = (myRank[getPos] ?? 5) - (theirRank[getPos] ?? 5);
        if (theyNeed <= 0 || iNeed <= 0) return;

        mine.surplusByPos[givePos].slice(0, 3).forEach((give) => {
          theirs.surplusByPos[getPos].slice(0, 3).forEach((get) => {
            const scale = Math.max(give.value, get.value);
            if (scale < 400) return;
            const gap = get.value - give.value;
            // The trades worth making are rarely balanced on their own. The
            // side receiving more value adds the pick that comes closest to
            // closing the difference, which is how these actually get done.
            const owed = gap > 0 ? "mine" : "theirs";
            const bank = owed === "mine" ? mine.picks : theirs.picks;
            const clean = Math.abs(gap) / scale <= 0.12;
            let sweetener = null;
            if (!clean && bank?.length) {
              sweetener = bank.reduce(
                (best, p) => {
                  const residual = Math.abs(Math.abs(gap) - (p.value || 0));
                  return !best || residual < best.residual ? { pick: p, residual, side: owed } : best;
                },
                null
              );
            }
            const residual = clean ? Math.abs(gap) : sweetener ? sweetener.residual : Math.abs(gap);
            if (residual / scale > 0.35) return;

            out.push({
              give,
              get,
              gap,
              clean,
              sweetener,
              residual: residual * (gap > 0 ? 1 : -1),
              score: (theyNeed + iNeed) * 30 + scale / 150 - (residual / scale) * 90,
            });
          });
        });
      });
    });

    const seen = new Set();
    return out
      .sort((a, b) => b.score - a.score)
      .filter((f) => {
        // One row per chip. Six variations on trading the same quarterback
        // is a list of one idea wearing six hats.
        if (seen.has(f.give.pid)) return false;
        seen.add(f.give.pid);
        return true;
      })
      .slice(0, 6);
  }, [mine, theirs, ranks, me, chosen]);

  if (!mine) return null;

  return (
    <section>
      <div className="sortbar wrap">
        <span className="eyebrow">Trade with</span>
        {others.map((t) => (
          <button
            key={t.roster_id}
            className={chosen === t.roster_id ? "chip on" : "chip"}
            onClick={() => setPartner(t.roster_id)}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="cols">
        <div className="panel">
          <h2 className="eyebrow">Positional standing, 1 is strongest</h2>
          <table className="grid">
            <thead>
              <tr>
                <th />
                <th className="right">You</th>
                <th className="right">{teamName(chosen)}</th>
              </tr>
            </thead>
            <tbody>
              {POSITIONS.map((pos) => {
                const mineRank = ranks[me]?.[pos];
                const theirRankValue = ranks[chosen]?.[pos];
                return (
                  <tr key={pos}>
                    <td>
                      <span className="pos" style={{ color: POS_TINT[pos] }}>
                        {pos}
                      </span>
                    </td>
                    <td className="num right" style={{ color: mineRank >= 8 ? C.down : mineRank <= 3 ? C.up : C.soft }}>
                      #{mineRank ?? "—"}
                    </td>
                    <td
                      className="num right"
                      style={{ color: theirRankValue >= 8 ? C.down : theirRankValue <= 3 ? C.up : C.soft }}
                    >
                      #{theirRankValue ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="note">
            Rank reflects value locked into required starting slots, not raw roster totals. A team
            can hold the most valuable roster in the league and still start a bottom-three quarterback
            pair.
          </p>
        </div>

        <div className="panel">
          <h2 className="eyebrow">Where the fits are</h2>
          {fits.length === 0 ? (
            <p className="empty">
              No clean one-for-one fit with {teamName(chosen)}. Their weaknesses overlap with yours,
              so any deal here needs a pick to balance it. Try another partner.
            </p>
          ) : (
            <ul className="fits">
              {fits.map((fit, i) => (
                <li key={i}>
                  <div className="fit-side">
                    <span className="fit-tag">send</span>
                    <span className="pos" style={{ color: POS_TINT[fit.give.pos] }}>
                      {fit.give.pos}
                    </span>
                    {fit.give.name}
                    <span className="num fit-val">{fmt(fit.give.value)}</span>
                  </div>
                  {fit.sweetener?.side === "mine" && (
                    <div className="fit-side sweet">
                      <span className="fit-tag" />
                      <span className="pos" />
                      {pickLabel(fit.sweetener.pick)}
                      <span className="num fit-val">{fmt(fit.sweetener.pick.value)}</span>
                    </div>
                  )}
                  <div className="fit-side">
                    <span className="fit-tag get">get</span>
                    <span className="pos" style={{ color: POS_TINT[fit.get.pos] }}>
                      {fit.get.pos}
                    </span>
                    {fit.get.name}
                    <span className="num fit-val">{fmt(fit.get.value)}</span>
                  </div>
                  {fit.sweetener?.side === "theirs" && (
                    <div className="fit-side sweet">
                      <span className="fit-tag" />
                      <span className="pos" />
                      {pickLabel(fit.sweetener.pick)}
                      <span className="num fit-val">{fmt(fit.sweetener.pick.value)}</span>
                    </div>
                  )}
                  <div className="fit-gap">
                    <Delta value={fit.residual} />
                    <span className="fit-note">
                      {fit.clean ? "market gap" : fit.sweetener ? "left over after the pick" : "market gap"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function MoverList({ title, rows, data, idx, span, teamName }) {
  return (
    <div className="panel">
      <h2 className="eyebrow">
        {title}, {span >= 999 ? "all time" : `${span} days`}
      </h2>
      <table className="grid">
        <tbody>
          {rows.map((row) => (
            <tr key={row.pid}>
              <td>
                <span className="pos" style={{ color: POS_TINT[row.pos] }}>
                  {row.pos}
                </span>
                {row.name}
                <span className="owner">{row.owner ? teamName(Number(row.owner)) : "free agent"}</span>
              </td>
              <td className="sparkcell">
                <Spark series={data.player_series[row.pid]} idx={idx} span={span} width={64} height={20} />
              </td>
              <td className="num right">{fmt(row.now)}</td>
              <td className="right">
                <Delta value={row.delta} pct={row.pct} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- styles */

function Styles() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.shell {
  --paper:${C.paper}; --panel:${C.panel}; --rule:${C.rule};
  --ink:${C.ink}; --soft:${C.soft}; --faint:${C.faint};
  background: var(--paper);
  color: var(--ink);
  font-family: 'Archivo', system-ui, -apple-system, sans-serif;
  min-height: 100vh;
  padding: 28px 22px 56px;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}
.shell * { box-sizing: border-box; }
.num { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.loading { font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); padding: 60px 0; }

.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; flex-wrap: wrap;
  border-bottom: 1.5px solid var(--ink); padding-bottom: 14px; margin-bottom: 18px; }
.head h1 { margin: 0; font-size: clamp(21px, 3.4vw, 30px); font-weight: 700; letter-spacing: -0.025em; }
.meta { margin: 5px 0 0; font-size: 12.5px; color: var(--soft); }
.badge { margin-left: 9px; padding: 2px 7px; border: 1px solid ${C.brass}; color: ${C.brass};
  font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase; border-radius: 2px; }

.spans { display: flex; gap: 5px; }
.tabs { display: flex; gap: 22px; margin-bottom: 22px; border-bottom: 1px solid var(--rule); }
.tab { background: none; border: 0; padding: 0 0 10px; margin-bottom: -1px; cursor: pointer;
  font-family: inherit; font-size: 13.5px; font-weight: 500; color: var(--faint);
  border-bottom: 2px solid transparent; transition: color .15s; }
.tab:hover { color: var(--soft); }
.tab.on { color: var(--ink); border-bottom-color: var(--ink); font-weight: 600; }

.chip { background: none; border: 1px solid var(--rule); border-radius: 2px; padding: 5px 10px;
  cursor: pointer; font-family: inherit; font-size: 11.5px; font-weight: 500; color: var(--soft);
  transition: all .15s; }
.chip:hover { border-color: var(--soft); color: var(--ink); }
.chip.on { background: var(--ink); border-color: var(--ink); color: var(--paper); }

.eyebrow { font-size: 10.5px; letter-spacing: 0.15em; text-transform: uppercase;
  color: var(--faint); font-weight: 600; margin: 0 0 12px; display: block; }
.sortbar { display: flex; align-items: center; gap: 7px; margin-bottom: 16px; }
.sortbar .eyebrow { margin: 0 4px 0 0; }
.sortbar.wrap { flex-wrap: wrap; }

.board { position: relative; }
.tickrow { position: absolute; left: 0; right: 0; height: 56px; display: flex; align-items: center;
  gap: 16px; padding: 0 14px; background: var(--panel); border: 1px solid var(--rule);
  border-radius: 2px; cursor: pointer; text-align: left; font-family: inherit; color: inherit;
  transition: transform .42s cubic-bezier(.22,.61,.36,1), border-color .15s, background .15s; }
.tickrow:hover { border-color: var(--ink); }
.tickrow.mine { border-left: 3px solid ${C.brass}; background: #F7F6EF; }
.rank { font-size: 12px; color: var(--faint); width: 22px; flex-shrink: 0; }
.tname { flex: 1; font-size: 14.5px; font-weight: 500; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.you { margin-left: 8px; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase;
  color: ${C.brass}; font-weight: 600; }
.total { font-size: 16px; font-weight: 600; width: 74px; text-align: right; flex-shrink: 0; }
.dcell { width: 116px; text-align: right; font-size: 13px; flex-shrink: 0; }
.note { font-size: 11.5px; color: var(--faint); line-height: 1.55; margin: 14px 0 0; max-width: 62ch; }

.cols { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.25fr); gap: 16px; align-items: start; }
.panel { background: var(--panel); border: 1px solid var(--rule); border-radius: 2px; padding: 16px 16px 14px; }

.posbar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; }
.posbar-label { font-size: 11px; font-weight: 600; width: 26px; color: var(--soft); }
.posbar-track { flex: 1; height: 9px; background: ${C.sunk}; border-radius: 1px; overflow: hidden; }
.posbar-fill { height: 100%; border-radius: 1px; transition: width .35s ease; }
.posbar-val { font-size: 12px; width: 54px; text-align: right; color: var(--soft); }

.rankrow { display: flex; gap: 7px; margin: 14px 0 4px; }
.rankchip { flex: 1; border: 1px solid var(--rule); border-radius: 2px; padding: 7px 4px; text-align: center; }
.rankchip-pos { display: block; font-size: 10px; letter-spacing: .08em; color: var(--faint); font-weight: 600; }
.rankchip-num { font-size: 14px; font-weight: 600; }

.stats { display: flex; gap: 20px; margin: 16px 0 0; padding-top: 13px; border-top: 1px solid var(--rule); }
.stats div { flex: 1; }
.stats dt { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); font-weight: 600; }
.stats dd { margin: 3px 0 0; font-size: 15px; font-weight: 600; }

.picks { list-style: none; padding: 13px 0 0; margin: 13px 0 0; border-top: 1px solid var(--rule); font-size: 12.5px; }
.picks li { display: flex; justify-content: space-between; padding: 3px 0; color: var(--soft); }
.via { margin-left: 6px; font-size: 10px; color: var(--faint); }

.grid { width: 100%; border-collapse: collapse; font-size: 13px; }
.grid th { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--faint);
  font-weight: 600; padding: 0 0 7px; text-align: left; }
.grid td { padding: 6px 0; border-top: 1px solid var(--rule); vertical-align: middle; }
.grid tr:first-child td { border-top: 0; }
.grid .right { text-align: right; }
.grid .starter td { background: ${C.sunk}; }
.grid .starter td:first-child { box-shadow: inset 3px 0 0 ${C.brass}; padding-left: 8px; }
.sparkcell { width: 76px; }
.pos { display: inline-block; width: 27px; font-size: 10px; font-weight: 700; letter-spacing: .04em; }
.owner { display: block; font-size: 10.5px; color: var(--faint); padding-left: 27px; }

.fits { list-style: none; padding: 0; margin: 0; font-size: 13px; }
.fits li { padding: 10px 0; border-top: 1px solid var(--rule); }
.fits li:first-child { border-top: 0; padding-top: 0; }
.fit-side { display: flex; align-items: center; gap: 4px; padding: 1px 0; }
.fit-tag { font-size: 9px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700;
  color: ${C.down}; width: 34px; }
.fit-tag.get { color: ${C.up}; }
.fit-val { margin-left: auto; font-size: 12px; color: var(--soft); }
.fit-side.sweet { color: var(--soft); font-size: 12px; }
.fit-side.sweet .pos { width: 27px; }
.fit-gap { display: flex; align-items: baseline; gap: 7px; padding-left: 34px; margin-top: 3px; font-size: 12px; }
.fit-note { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
.empty { font-size: 12.5px; color: var(--soft); line-height: 1.6; margin: 0; }

.shell button:focus-visible { outline: 2px solid ${C.brass}; outline-offset: 2px; }

@media (max-width: 820px) {
  .shell { padding: 20px 14px 44px; }
  .cols { grid-template-columns: 1fr; }
  .tickrow { gap: 10px; padding: 0 10px; }
  .tickrow svg { display: none; }
  .total { width: 62px; font-size: 15px; }
  .dcell { width: 88px; font-size: 12px; }
  .tabs { gap: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .tickrow, .posbar-fill { transition: none; }
}
`}</style>
  );
}
