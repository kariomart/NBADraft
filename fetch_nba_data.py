#!/usr/bin/env python3
"""
Fetch NBA player data from the NBA stats API via nba_api and generate api_players.js.

Usage:
    pip install nba_api
    python3 fetch_nba_data.py

Runtime: ~15-25 min (rate-limited to avoid bans). Fully resumable — raw
responses are cached in ./nba_cache/ so re-running only fetches what's missing.
"""

import json, time, os, sys, re
from collections import defaultdict

try:
    from nba_api.stats.endpoints import (
        leaguedashplayerstats, commonplayerinfo, leagueleaders,
    )
except ImportError:
    print("ERROR: nba_api not installed.\n  Run: pip install nba_api")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────

CACHE = "nba_cache"
os.makedirs(CACHE, exist_ok=True)

# All seasons with available per-game data
# Modern seasons use the rich dashboard endpoint (deep rosters, ~500+/season).
SEASONS = [f"{y}-{str(y + 1)[2:]}" for y in range(1996, 2024)]

# Historical seasons (back to 1973-74, when STL/BLK began being tracked) come
# from the LeagueLeaders endpoint, which the dashboard endpoint doesn't serve.
HISTORICAL_SEASONS = [f"{y}-{str(y + 1)[2:]}" for y in range(1973, 1996)]

# Franchise moves / name changes → current team code.
TEAM_ALIASES = {
    # modern relocations
    "NOH": "NOP", "NOK": "NOP", "NJN": "BKN", "SEA": "OKC",
    "VAN": "MEM", "CHH": "CHA", "CHO": "CHA", "WSB": "WAS",
    "SDC": "LAC", "PHO": "PHX", "GOS": "GSW", "UTJ": "UTA",
    # historical franchises (1973-1995)
    "BUF": "LAC", "SDR": "HOU", "KCK": "SAC", "KCO": "SAC", "CIN": "SAC",
    "NOJ": "UTA", "UTH": "UTA", "SFW": "GSW", "NYN": "BKN", "WSA": "WAS",
    "CAP": "WAS", "BAL": "WAS", "NYA": "BKN", "SAA": "SAS", "SAN": "SAS",
    "DNR": "DEN", "DNA": "DEN", "INA": "IND", "MLW": "MIL", "PHL": "PHI",
}

KNOWN_TEAMS = {
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
    "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
    "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
}

# NBA API position string → our position list
POS_MAP = {
    "Guard":          ["PG", "SG"],
    "Forward":        ["SF", "PF"],
    "Center":         ["C"],
    "Guard-Forward":  ["SG", "SF"],
    "Forward-Guard":  ["SF", "SG"],
    "Forward-Center": ["PF", "C"],
    "Center-Forward": ["C", "PF"],
    "G":  ["PG", "SG"], "F":  ["SF", "PF"], "C":  ["C"],
    "G-F": ["SG", "SF"], "F-G": ["SF", "SG"],
    "F-C": ["PF", "C"],  "C-F": ["C", "PF"],
    "PG": ["PG"], "SG": ["SG"], "SF": ["SF"], "PF": ["PF"],
}

# Minimum bar to be included (peak-season filter). Low enough to capture solid
# rotation/role players, not just stars.
MIN_PPG   = 3.0   # peak PPG threshold
MIN_GP    = 10    # games played per qualifying season
MIN_MPG   = 5     # minutes per game per qualifying season

# ── Helpers ───────────────────────────────────────────────────────────────────

TIMEOUT = 45   # seconds per request before giving up
MAX_RETRY = 3  # attempts before skipping a season/player

def pause():
    """Polite pause between API calls to avoid rate-limiting."""
    time.sleep(0.7)


def load_cache(path):
    with open(path) as f:
        return json.load(f)


def save_cache(path, data):
    with open(path, "w") as f:
        json.dump(data, f)


# ── Phase 1: Season stats ─────────────────────────────────────────────────────

print("=" * 60)
print("Phase 1/3 — Season stats (1996-97 → 2023-24)")
print("=" * 60)

all_rows = []

for season in SEASONS:
    path = f"{CACHE}/season_{season}.json"
    if os.path.exists(path):
        rows = load_cache(path)
        print(f"  {season} cached ({len(rows)} rows)")
    else:
        print(f"  {season} fetching...", end=" ", flush=True)
        rows = []
        for attempt in range(1, MAX_RETRY + 1):
            try:
                r = leaguedashplayerstats.LeagueDashPlayerStats(
                    season=season,
                    per_mode_detailed="PerGame",
                    season_type_all_star="Regular Season",
                    timeout=TIMEOUT,
                )
                rows = r.get_normalized_dict()["LeagueDashPlayerStats"]
                save_cache(path, rows)
                print(f"✓ {len(rows)} players")
                pause()
                break
            except Exception as e:
                if attempt < MAX_RETRY:
                    print(f"retry {attempt}...", end=" ", flush=True)
                    time.sleep(2)
                else:
                    print(f"✗ skipped ({e})")

    year = int(season[:4])
    for row in rows:
        row["_year"] = year
    all_rows.extend(rows)

# ── Phase 1b: Historical seasons via LeagueLeaders (1973-74 → 1995-96) ─────────

print("\n" + "=" * 60)
print("Phase 1b — Historical seasons (1973-74 → 1995-96)")
print("=" * 60)

def normalize_leader_row(r):
    """Map a LeagueLeaders row onto the LeagueDashPlayerStats field names."""
    return {
        "PLAYER_ID":          r.get("PLAYER_ID"),
        "PLAYER_NAME":        r.get("PLAYER"),
        "TEAM_ABBREVIATION":  r.get("TEAM"),
        "GP":   r.get("GP"),  "MIN": r.get("MIN"),
        "PTS":  r.get("PTS"), "REB": r.get("REB"), "AST": r.get("AST"),
        "STL":  r.get("STL"), "BLK": r.get("BLK"),
        "FGA":  r.get("FGA"), "FTA": r.get("FTA"),
        "PLUS_MINUS": 0,
    }

for season in HISTORICAL_SEASONS:
    path = f"{CACHE}/leaders_{season}.json"
    if os.path.exists(path):
        rows = load_cache(path)
        print(f"  {season} cached ({len(rows)} rows)")
    else:
        print(f"  {season} fetching...", end=" ", flush=True)
        rows = []
        for attempt in range(1, MAX_RETRY + 1):
            try:
                r = leagueleaders.LeagueLeaders(
                    season=season,
                    per_mode48="PerGame",
                    season_type_all_star="Regular Season",
                    stat_category_abbreviation="PTS",
                    timeout=TIMEOUT,
                )
                d = r.get_normalized_dict()
                raw = d[list(d.keys())[0]]
                rows = [normalize_leader_row(x) for x in raw]
                save_cache(path, rows)
                print(f"✓ {len(rows)} players")
                pause()
                break
            except Exception as e:
                if attempt < MAX_RETRY:
                    print(f"retry {attempt}...", end=" ", flush=True)
                    time.sleep(2)
                else:
                    print(f"✗ skipped ({e})")

    year = int(season[:4])
    for row in rows:
        row["_year"] = year
    all_rows.extend(rows)

print(f"\nTotal raw rows: {len(all_rows)}")

# ── Deduplicate traded players (keep highest-minutes team row per player/year) ─

best_row_per_year = {}
for row in all_rows:
    if row.get("TEAM_ABBREVIATION") == "TOT":
        continue
    key = (row["PLAYER_ID"], row["_year"])
    new_load = (row.get("GP") or 0) * (row.get("MIN") or 0)
    existing = best_row_per_year.get(key)
    if existing is None:
        best_row_per_year[key] = row
    else:
        old_load = (existing.get("GP") or 0) * (existing.get("MIN") or 0)
        if new_load > old_load:
            best_row_per_year[key] = row

by_player = defaultdict(list)
for row in best_row_per_year.values():
    by_player[row["PLAYER_ID"]].append(row)

print(f"Unique players: {len(by_player)}")

# Filter to players with at least one real season
def qualifies(rows):
    return any(
        (r.get("GP") or 0) >= MIN_GP and (r.get("MIN") or 0) >= MIN_MPG
        for r in rows
    )

qualified_ids = [pid for pid, rows in by_player.items() if qualifies(rows)]
print(f"Qualified:      {len(qualified_ids)}")

# ── Phase 2: Player info (positions + full name) ───────────────────────────────

print("\n" + "=" * 60)
print(f"Phase 2/3 — Player info / positions ({len(qualified_ids)} players)")
print("=" * 60)

info_cache = {}
for i, pid in enumerate(qualified_ids):
    path = f"{CACHE}/info_{pid}.json"
    if os.path.exists(path):
        info_cache[pid] = load_cache(path)
        continue
    for attempt in range(1, MAX_RETRY + 1):
        try:
            r = commonplayerinfo.CommonPlayerInfo(player_id=pid, timeout=TIMEOUT)
            info = r.get_normalized_dict()["CommonPlayerInfo"][0]
            info_cache[pid] = info
            save_cache(path, info)
            pause()
            break
        except Exception as e:
            if attempt < MAX_RETRY:
                time.sleep(2)
            else:
                print(f"  ✗ {pid}: {e}")
    if (i + 1) % 100 == 0:
        print(f"  {i + 1}/{len(qualified_ids)} ({len(info_cache)} cached)")

print(f"  Fetched info for {len(info_cache)} players.")

# ── Phase 3: Build profiles ───────────────────────────────────────────────────

print("\n" + "=" * 60)
print("Phase 3/3 — Building profiles")
print("=" * 60)

import unicodedata

def norm_name(s):
    """Lowercase, strip accents and punctuation → robust dedup key.
    'Nikola Jokić' and 'Shaquille O'Neal' → 'nikolajokic' / 'shaquilleoneal'."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())

# Build a set of (normalized_name, team) pairs already covered by data.js so we
# never duplicate a hand-curated player on the same franchise. The regex handles
# escaped apostrophes (e.g. O\'Neal) and grabs the team that follows each name.
curated_keys = set()
try:
    with open("data.js") as f:
        text = f.read()
    pairs = re.findall(r"name:\s*'((?:[^'\\]|\\.)*)',\s*team:\s*'([A-Z]{3})'", text)
    for raw_name, team in pairs:
        clean = raw_name.replace("\\'", "'")
        curated_keys.add((norm_name(clean), team))
    print(f"  Loaded {len(curated_keys)} curated (name, team) keys from data.js")
except FileNotFoundError:
    pass


def best_team(rows):
    """Team the player spent the most distinct seasons with."""
    team_years = defaultdict(set)
    for row in rows:
        raw = row.get("TEAM_ABBREVIATION", "")
        team = TEAM_ALIASES.get(raw, raw)
        if team in KNOWN_TEAMS:
            team_years[team].add(row["_year"])
    if not team_years:
        return None
    return max(team_years, key=lambda t: len(team_years[t]))


def compute_peak_stats(rows, top_n=4):
    """Average box stats from the player's top-N seasons by PPG."""
    valid = [
        r for r in rows
        if (r.get("GP") or 0) >= MIN_GP and (r.get("MIN") or 0) >= MIN_MPG
    ]
    if not valid:
        valid = rows

    top = sorted(valid, key=lambda r: r.get("PTS") or 0, reverse=True)[:top_n]

    def avg(key):
        vals = [r.get(key) or 0 for r in top]
        return round(sum(vals) / len(vals), 1)

    ts_list = []
    for r in top:
        gp  = r.get("GP") or 1
        pts = (r.get("PTS") or 0) * gp
        fga = (r.get("FGA") or 0) * gp
        fta = (r.get("FTA") or 0) * gp
        denom = 2 * (fga + 0.44 * fta)
        ts_list.append(round(pts / denom * 100, 1) if denom > 0 else 50.0)

    return {
        "ppg": avg("PTS"),
        "rpg": avg("REB"),
        "apg": avg("AST"),
        "spg": avg("STL"),
        "bpg": avg("BLK"),
        "ts":  round(sum(ts_list) / len(ts_list), 1) if ts_list else 50.0,
        "net_rating": avg("PLUS_MINUS"),
    }


players_out = []
next_id = 2000  # well above our hand-curated IDs (1–999)

for pid in qualified_ids:
    info = info_cache.get(pid)
    if not info:
        continue

    name = info.get("DISPLAY_FIRST_LAST", "").strip()
    if not name:
        continue

    rows = by_player[pid]
    ps = compute_peak_stats(rows)

    if ps["ppg"] < MIN_PPG:
        continue

    team = best_team(rows)
    if not team:
        continue

    # Skip if a hand-curated player already covers this name on this team.
    if (norm_name(name), team) in curated_keys:
        continue

    raw_pos = info.get("POSITION", "Forward")
    positions = POS_MAP.get(raw_pos, ["SF", "PF"])

    active_years = sorted(
        r["_year"] for r in rows
        if (r.get("GP") or 0) >= 10
    )
    peak_years = (
        [active_years[0], active_years[-1] + 1]
        if active_years else [2000, 2010]
    )

    # Approximate PER and WS/48 from the box score (no play-by-play needed).
    # Calibrated so an average starter (14/5/3/1/0.5) lands at PER ≈ 15 and
    # WS/48 ≈ 0.100 — matching the league baselines used by model.js.
    raw = (
        ps["ppg"] * 0.70
        + ps["rpg"] * 0.90
        + ps["apg"] * 1.00
        + ps["spg"] * 2.00
        + ps["bpg"] * 2.00
    )
    # Mild True-Shooting adjustment: reward/penalize scoring efficiency.
    eff_mult = 0.90 + (ps["ts"] - 50.0) / 100.0
    per_approx = round(max(2.0, raw * 0.74 * eff_mult), 1)

    ws48_approx = round(
        max(0.005, min(0.300, 0.100 + (per_approx - 15.0) * 0.011)), 3)

    players_out.append({
        "id":          next_id,
        "name":        name,
        "team":        team,
        "positions":   positions,
        "from":        peak_years[0],
        "to":          peak_years[1],
        "stats": {
            "ppg": ps["ppg"],
            "rpg": ps["rpg"],
            "apg": ps["apg"],
            "spg": ps["spg"],
            "bpg": ps["bpg"],
        },
        "ws48":       ws48_approx,
        "per":        per_approx,
        "ts":         ps["ts"],
        "net_rating": ps["net_rating"],
    })
    next_id += 1

print(f"  Generated {len(players_out)} new players (PPG ≥ {MIN_PPG})\n")

# ── Write api_players.js ──────────────────────────────────────────────────────

lines = [
    "// AUTO-GENERATED by fetch_nba_data.py — do not edit by hand.\n",
    "// Loaded after data.js; pushes generated players into the global PLAYERS array.\n",
    "(function () {\n",
    "  var generated = [\n",
]
for p in players_out:
    lines.append(f"    {json.dumps(p, separators=(',', ':'))},\n")
lines += [
    "  ];\n",
    "  generated.forEach(function (p) { PLAYERS.push(p); });\n",
    "  console.log('[nba_api] Added ' + generated.length + ' players. Total: ' + PLAYERS.length);\n",
    "})();\n",
]

out_path = "api_players.js"
with open(out_path, "w") as f:
    f.writelines(lines)

print(f"Wrote {out_path}  ({len(players_out)} players, {os.path.getsize(out_path)//1024} KB)")
print("\nNext steps:")
print("  1. index.html already loads api_players.js — you're done!")
print("  2. Open index.html in your browser and check the console for player count.")
