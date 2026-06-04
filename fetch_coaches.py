#!/usr/bin/env python3
"""
fetch_coaches.py — scrapes Basketball Reference to build COACHES entries.

Usage:
  pip install requests beautifulsoup4
  python3 fetch_coaches.py

Output: coach_additions.js — review it, then paste the entries into the
        COACHES array in data.js (before the closing ];).
"""

import re
import sys
import time
import requests
from bs4 import BeautifulSoup, Comment

BASE    = "https://www.basketball-reference.com"
HEADERS = {"User-Agent": "Mozilla/5.0 (NBADraftSim coach-scraper/1.0)"}
DELAY   = 3.5   # seconds between requests (be polite to BBRef)
MIN_WINS = 200  # skip coaches with fewer career wins (weeds out interim/short stints)

# ── Coach IDs already in data.js ─────────────────────────────────────────────
EXISTING_IDS = {
    "phil_jackson","pat_riley","gregg_popovich","mike_dantoni","chuck_daly",
    "red_auerbach","larry_brown","don_nelson","jerry_sloan","rick_adelman",
    "tom_thibodeau","erik_spoelstra","billy_cunningham","lenny_wilkens",
    "doc_rivers","stan_van_gundy","george_karl","doug_moe","frank_vogel",
    "larry_bird_coach","rick_carlisle","jeff_van_gundy","mike_budenholzer",
    "nick_nurse","dwane_casey","quin_snyder","flip_saunders","lionel_hollins",
    "monty_williams","scott_brooks","jason_kidd","dick_motta","doug_collins",
    "kc_jones","al_attles","terry_stotts","mike_malone","steve_kerr",
    "tom_heinsohn","red_holzman","rudy_tomjanovich","nate_mcmillan",
    "cotton_fitzsimmons","mark_daigneault","tyronn_lue","byron_scott",
    "bill_russell_coach","hubie_brown","brad_stevens","paul_silas",
    "larry_costello","john_macleod",
}

# ── BBRef team abbreviation → our game's team ID ─────────────────────────────
ABBR_MAP = {
    # Current franchises (same abbreviation)
    "ATL":"ATL","BOS":"BOS","BKN":"BKN","CHA":"CHA","CHI":"CHI","CLE":"CLE",
    "DAL":"DAL","DEN":"DEN","DET":"DET","GSW":"GSW","HOU":"HOU","IND":"IND",
    "LAC":"LAC","LAL":"LAL","MEM":"MEM","MIA":"MIA","MIL":"MIL","MIN":"MIN",
    "NOP":"NOP","NYK":"NYK","OKC":"OKC","ORL":"ORL","PHI":"PHI","PHX":"PHX",
    "POR":"POR","SAC":"SAC","SAS":"SAS","TOR":"TOR","UTA":"UTA","WAS":"WAS",
    # Relocated / renamed franchises
    "SEA":"OKC",  # Seattle SuperSonics → Oklahoma City Thunder
    "NJN":"BKN",  # New Jersey Nets → Brooklyn Nets
    "NOH":"NOP",  # New Orleans Hornets → Pelicans
    "NOK":"NOP",  # New Orleans/Oklahoma City Hornets (Katrina season)
    "VAN":"MEM",  # Vancouver Grizzlies → Memphis
    "CHH":"CHA",  # Charlotte Hornets (original) → Bobcats/Hornets
    "MNL":"LAL",  # Minneapolis Lakers → LA Lakers
    "FTW":"DET",  # Fort Wayne Pistons → Detroit
    "STL":"ATL",  # St. Louis Hawks → Atlanta
    "MLH":"ATL",  # Milwaukee Hawks → St. Louis → Atlanta
    "TRI":"ATL",  # Tri-Cities Blackhawks
    "SYR":"PHI",  # Syracuse Nationals → Philadelphia 76ers
    "ROC":"SAC",  # Rochester Royals → Cincinnati → KC → Sacramento
    "CIN":"SAC",  # Cincinnati Royals
    "KCK":"SAC",  # Kansas City Kings
    "KCO":"SAC",  # Kansas City–Omaha Kings
    "SDR":"HOU",  # San Diego Rockets → Houston
    "SFW":"GSW",  # San Francisco Warriors
    "PHW":"GSW",  # Philadelphia/Pittsburgh Warriors
    "SDC":"LAC",  # San Diego Clippers → LA Clippers
    "BUF":"LAC",  # Buffalo Braves → San Diego → LA Clippers
    "NOJ":"UTA",  # New Orleans Jazz → Utah
    "TEX":"SAS",  # Texas Chaparrals → San Antonio Spurs
    "CAP":"WAS",  # Capital Bullets → Washington
    "BAL":"WAS",  # Baltimore Bullets
    "WSB":"WAS",  # Washington Bullets → Wizards
    "CHZ":"WAS",  # Chicago Zephyrs → Washington
    "AND":"PHI",  # Anderson Packers (early BAA)
    "WAT":"PHI",  # Waterloo Hawks (early BAA, loosely → 76ers)
    "SHE":"PHI",  # Sheboygan Redskins
}

VALID_GAME_TEAMS = set(ABBR_MAP.values())


# ── Helpers ───────────────────────────────────────────────────────────────────

def fetch(url):
    time.sleep(DELAY)
    r = requests.get(url, headers=HEADERS, timeout=25)
    r.raise_for_status()
    return r.text


def find_table(soup, table_id):
    """Find a BBRef table by id, including tables hidden inside HTML comments."""
    t = soup.find("table", id=table_id)
    if t:
        return t
    for comment in soup.find_all(string=lambda s: isinstance(s, Comment)):
        if table_id in comment:
            sub = BeautifulSoup(comment, "html.parser")
            t = sub.find("table", id=table_id)
            if t:
                return t
    return None


def make_id(name):
    """coach name → stable snake_case id, e.g. 'K.C. Jones' → 'kc_jones'."""
    s = re.sub(r"[^a-z0-9 ]", "", name.lower().replace(".", " ").replace("'", ""))
    return "_".join(s.split())


def estimate_mods(win_pct, champs):
    """Rough ortg/drtg modifiers from career win% and championship count."""
    quality = (win_pct - 0.500) * 20          # e.g. .600 → +2.0, .480 → -0.4
    quality = max(-2.0, min(4.0, quality))
    # Winning coaches tend to be better on both ends; championship coaches
    # skew defensive (most dynasties were built on D).
    ortg = round(quality * 0.55 + champs * 0.15, 1)
    drtg = round(-quality * 0.45 - champs * 0.20, 1)
    return ortg, drtg


# ── Step 1: get list of all coaches from BBRef ────────────────────────────────

def get_coach_list():
    print("Fetching coaches list from BBRef...")
    html = fetch(f"{BASE}/coaches/NBA_stats.html")
    soup = BeautifulSoup(html, "html.parser")
    table = find_table(soup, "coaches")
    if not table:
        sys.exit("ERROR: Could not find coaches table on BBRef page.")

    coaches = []
    for row in table.select("tbody tr"):
        if "thead" in row.get("class", []):
            continue
        link = row.find("a")
        if not link or "/coaches/" not in link.get("href", ""):
            continue
        name = link.text.strip().rstrip("*").strip()
        href = link["href"]

        cells = row.find_all(["th", "td"])
        try:
            wins   = int(cells[6].text.strip() or 0)   # W column
            wl_txt = cells[8].text.strip()              # W/L%
            win_pct = float(wl_txt) if wl_txt else 0.0
            champs = int(cells[-1].text.strip() or 0)  # Champ column
        except (ValueError, IndexError):
            continue

        coaches.append((name, href, wins, win_pct, champs))

    print(f"  Found {len(coaches)} total coaches on BBRef.")
    return coaches


# ── Step 2: scrape each coach's detail page for team-by-year data ─────────────

def get_tenures(href):
    """Return list of {team, from, to} dicts for a coach."""
    html  = fetch(f"{BASE}{href}")
    soup  = BeautifulSoup(html, "html.parser")
    table = find_table(soup, "coach-stats")
    if not table:
        return []

    year_team = []   # [(season_start_year, game_team_id)]

    for row in table.select("tbody tr"):
        if "partial_table" in row.get("class", []) or "thead" in row.get("class", []):
            continue
        cells = row.find_all(["th", "td"])
        if len(cells) < 4:
            continue

        # Season cell: e.g. "2001-02"
        season_text = cells[0].text.strip()
        m = re.match(r"(\d{4})", season_text)
        if not m:
            continue
        year = int(m.group(1))

        # Skip assistant/interim rows (cell[4] contains role text if not a head coach)
        role_text = cells[4].text.strip() if len(cells) > 4 else ""
        if "Assistant" in role_text or "Interim" in role_text.split()[:1]:
            continue

        # Team abbreviation is in cell[2] via a /teams/XXX/ link
        team_id = None
        a = cells[2].find("a", href=re.compile(r"/teams/[A-Z]+/"))
        if a:
            abbr = a["href"].split("/teams/")[1].split("/")[0]
            team_id = ABBR_MAP.get(abbr)

        if team_id and team_id in VALID_GAME_TEAMS:
            year_team.append((year, team_id))

    if not year_team:
        return []

    # Consolidate consecutive seasons with the same team
    year_team.sort()
    tenures = []
    cur_team = year_team[0][1]
    cur_from = year_team[0][0]
    cur_to   = year_team[0][0]

    for yr, tm in year_team[1:]:
        if tm == cur_team and yr <= cur_to + 2:   # ≤2-yr gap treated as same stint
            cur_to = yr
        else:
            tenures.append({"team": cur_team, "from": cur_from, "to": cur_to})
            cur_team, cur_from, cur_to = tm, yr, yr
    tenures.append({"team": cur_team, "from": cur_from, "to": cur_to})

    return tenures


# ── Step 3: emit JS ───────────────────────────────────────────────────────────

def format_entry(name, tenures, win_pct, champs):
    coach_id = make_id(name)
    ortg, drtg = estimate_mods(win_pct, champs)
    tenure_js = ", ".join(
        f"{{ team: '{t['team']}', from: {t['from']}, to: {t['to']} }}"
        for t in tenures
    )
    # Escape single quotes in name
    js_name = name.replace("'", "\\'")
    return (
        f"  {{\n"
        f"    id: '{coach_id}', name: '{js_name}', style: 'TODO',\n"
        f"    note: 'TODO',\n"
        f"    ortgMod: {ortg}, drtgMod: {drtg},\n"
        f"    tenures: [{tenure_js}],\n"
        f"  }},"
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    all_coaches = get_coach_list()

    candidates = [
        (name, href, wins, wl, ch)
        for name, href, wins, wl, ch in all_coaches
        if wins >= MIN_WINS and make_id(name) not in EXISTING_IDS
    ]
    print(f"  {len(candidates)} coaches pass filters (≥{MIN_WINS} W, not already in DB).")
    print(f"  Estimated time: ~{round(len(candidates) * DELAY / 60, 1)} minutes.\n")

    entries   = []
    skipped   = []

    for i, (name, href, wins, wl, champs) in enumerate(candidates, 1):
        print(f"  [{i:3}/{len(candidates)}] {name:<30} {wins}W  {wl:.3f}  {champs}ch", end=" ... ")
        sys.stdout.flush()
        try:
            tenures = get_tenures(href)
        except Exception as e:
            print(f"ERROR ({e})")
            skipped.append(name)
            continue

        if not tenures:
            print("no valid tenures, skipped")
            skipped.append(name)
            continue

        entry = format_entry(name, tenures, wl, champs)
        entries.append(entry)
        print(f"OK ({len(tenures)} tenure{'s' if len(tenures)>1 else ''})")

    # Write output
    out_path = "coach_additions.js"
    with open(out_path, "w") as f:
        f.write("// ── Paste these entries into the COACHES array in data.js ──\n")
        f.write("// Review style/note/ortgMod/drtgMod — they are rough estimates.\n\n")
        f.write("\n".join(entries))
        f.write("\n")

    print(f"\n✓ {len(entries)} coaches written to {out_path}")
    if skipped:
        print(f"  Skipped ({len(skipped)}): {', '.join(skipped)}")
    print("\nNext steps:")
    print("  1. Open coach_additions.js and fill in 'TODO' style/note fields")
    print("  2. Paste the entries into the COACHES array in data.js (before the closing ];)")
    print("  3. Run: node --check game.js")


if __name__ == "__main__":
    main()
