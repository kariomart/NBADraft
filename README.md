# 🏀 NBA Draft Sim

Spin a wheel for an NBA team, draft a player from it onto your roster, and once
all five starting positions are filled, an analytics model projects your team's
record and grades the roster. Built head-to-head challenges in too — share a code
with a friend and sim a 7-game series between your teams.

**[▶️ Play it here](https://kariomart.github.io/REPO_NAME/)**

## How it works

- **Spin & draft** — each round the wheel lands on a random team; pick one of its
  players (drag onto the court, or click to auto-slot) at a position they actually
  play. Fill PG / SG / SF / PF / C.
- **Set your era** — tap one or more era tags (80s → 2020s, or All-Time) to span
  the years players are drawn from, or enter a custom year range.
- **Ball Knowledge mode** — hides all stats during the draft so you pick on name
  and gut alone; everything is revealed at the end.
- **Team grade** — a model derives team Offensive/Defensive Ratings from box and
  advanced stats (TS%, PER, WS/48, usage, spacing, rim protection…), converts them
  to a projected record, and produces letter grades plus a scouting report.
- **Challenge a friend** — finish a draft to get a shareable code. A friend pastes
  it to draft in the same era, then a 7-game series is simulated between the teams.

## Data

Player data (~2,300 players, all 30 teams, 1973–2024) is pulled from the NBA Stats
API via [`nba_api`](https://github.com/swar/nba_api) and baked into `api_players.js`.
Regenerate it with:

```bash
pip install nba_api
python3 fetch_nba_data.py
```

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page shell |
| `data.js` | Curated legends + teams + era filtering |
| `api_players.js` | Auto-generated player dataset |
| `model.js` | Team evaluation + 7-game series model |
| `game.js` | Game flow, drafting, challenge codes, UI |
| `style.css` | Styles |
| `fetch_nba_data.py` | Data pipeline (NBA Stats API → `api_players.js`) |

No build step, no dependencies — it's plain HTML/CSS/JS.
