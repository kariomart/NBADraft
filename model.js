// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  TEAM EVALUATION MODEL                                                      ║
// ║                                                                            ║
// ║  Converts a starting five into estimated team Offensive / Defensive        ║
// ║  Ratings (points per 100 possessions), then into a projected record,       ║
// ║  letter grades, and a scouting report.                                     ║
// ║                                                                            ║
// ║  Inputs per player (from data.js / api_players.js):                        ║
// ║    stats: { ppg, rpg, apg, spg, bpg }                                       ║
// ║    per   — Player Efficiency Rating  (league avg ≈ 15)                      ║
// ║    ws48  — Win Shares per 48 minutes  (league avg ≈ 0.100)                  ║
// ║    ts    — True Shooting %            (league avg ≈ 56)                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

const MODEL = (() => {

  // League baselines — a roster of five "average" starters nets ~0 → 41 wins.
  const LEAGUE = {
    ORTG: 112.0, DRTG: 112.0,
    TS: 56.0, PER: 15.0, WS48: 0.100,
    sumPPG: 70, sumAPG: 15, sumRPG: 25, sumSPG: 5.0, sumBPG: 2.5,
    winsPerNetPoint: 2.4,     // ≈ wins gained per +1 net rating over 82 games
    starterMinutesFactor: 61.5, // (82 games × 36 min) / 48 → WS from a WS/48 value
  };

  // A replacement-level player, used to fill any empty roster slot (penalizes
  // an incomplete team rather than silently ignoring the hole).
  const REPLACEMENT = {
    name: '(empty)', positions: [],
    stats: { ppg: 6, rpg: 3, apg: 1.5, spg: 0.5, bpg: 0.3 },
    per: 9.0, ws48: 0.030, ts: 50.0,
  };

  // ── Main entry point ───────────────────────────────────────────────────────
  function evaluateTeam(roster, coach = null) {
    const slots = ['PG', 'SG', 'SF', 'PF', 'C'];
    const lineup = slots.map(pos => ({ pos, player: roster[pos] || REPLACEMENT }));
    const players = lineup.map(l => l.player);

    // ── Aggregate raw inputs ──────────────────────────────────────────────────
    const sum = key => players.reduce((t, p) => t + p.stats[key], 0);
    const sumPPG = sum('ppg'), sumAPG = sum('apg'), sumRPG = sum('rpg');
    const sumSPG = sum('spg'), sumBPG = sum('bpg');

    const avgPER = players.reduce((t, p) => t + p.per, 0) / players.length;
    const avgWS48 = players.reduce((t, p) => t + p.ws48, 0) / players.length;
    const maxPER = Math.max(...players.map(p => p.per));

    // Volume-weighted team True Shooting — efficient stars count more.
    const wTS = sumPPG > 0
      ? players.reduce((t, p) => t + p.ts * p.stats.ppg, 0) / sumPPG
      : LEAGUE.TS;

    // ── Fit factors ────────────────────────────────────────────────────────────
    const spacers = players.filter(p => p.ts >= 55).length;
    const spacingAdj = clamp((spacers - 3) * 0.9, -3.0, 2.5);

    // Usage clash: only ONE ball. Secondary ball-dominant scorers cost efficiency.
    const ballLoads = players
      .map(p => p.stats.ppg + 0.6 * p.stats.apg)
      .sort((a, b) => b - a);
    let usageClash = 0;
    for (let i = 1; i < ballLoads.length; i++) {       // skip the #1 option
      usageClash += Math.max(0, ballLoads[i] - 22) * 0.20;
    }
    usageClash = clamp(usageClash, 0, 6);

    // Star gravity — an elite shot-maker lifts the offensive ceiling.
    const starOffBonus = maxPER >= 27 ? 2.0
                       : maxPER >= 24 ? 1.2
                       : maxPER >= 21 ? 0.5 : 0.0;

    // Rim protection — a shot-blocking big anchors the defense.
    const bigs = lineup.filter(l => ['PF', 'C'].includes(l.pos)).map(l => l.player);
    const rimBonus = clamp(
      Math.max(0, ...bigs.map(p => (p.stats.bpg - 1.0) * 1.0)), 0, 2.0);

    // Perimeter stopper — an elite on-ball defender.
    const maxSPG = Math.max(...players.map(p => p.stats.spg));
    const defStarBonus = maxSPG >= 2.0 ? 0.8 : maxSPG >= 1.6 ? 0.4 : 0.0;

    // Undersized center — a small/non-shotblocking C gives up the paint.
    const centerP = (roster.C || REPLACEMENT);
    const smallBallPenalty =
      (centerP.stats.rpg < 7 && centerP.stats.bpg < 1.0) ? 1.5 : 0.0;

    // ── Coach modifiers ─────────────────────────────────────────────────────────
    // Familiar players: those who played for this coach's team during a tenure.
    // Each familiar player adds a small bonus (knowledge of the system).
    const familiarPositions = [];
    if (coach) {
      lineup.forEach(l => {
        if (l.player === REPLACEMENT) return;
        const p = l.player;
        const familiar = coach.tenures.some(t =>
          p.team === t.team &&
          p.peak_years[0] <= t.to &&
          p.peak_years[1] >= t.from
        );
        if (familiar) familiarPositions.push(l.pos);
      });
    }
    const famCount   = Math.min(familiarPositions.length, 3);
    const coachOrtg  = coach ? coach.ortgMod + famCount * 0.4 : 0;
    const coachDrtg  = coach ? coach.drtgMod - famCount * 0.3 : 0;

    // ── Offensive Rating ────────────────────────────────────────────────────────
    const ortg = LEAGUE.ORTG
      + (wTS - LEAGUE.TS)        * 0.90   // shot efficiency / spacing
      + (sumAPG - LEAGUE.sumAPG) * 0.22   // ball movement
      + (sumPPG - LEAGUE.sumPPG) * 0.05   // shot-making volume
      + (avgPER - LEAGUE.PER)    * 0.30   // overall offensive talent
      + spacingAdj
      + starOffBonus
      - usageClash
      + coachOrtg;

    // ── Defensive Rating (lower = better) ───────────────────────────────────────
    const drtg = LEAGUE.DRTG
      - (sumBPG - LEAGUE.sumBPG)   * 0.90  // rim protection
      - (sumSPG - LEAGUE.sumSPG)   * 0.80  // forcing turnovers
      - (sumRPG - LEAGUE.sumRPG)   * 0.18  // defensive rebounding
      - (avgWS48 - LEAGUE.WS48)    * 14    // overall two-way impact
      - rimBonus
      - defStarBonus
      + smallBallPenalty
      + coachDrtg;

    const netRtg = ortg - drtg;

    // ── Win projection ───────────────────────────────────────────────────────────
    // Compress net rating with tanh: near-linear for normal teams, but stacking
    // five stars hits diminishing returns (only one ball, 48 minutes, one rim).
    // Asymptote ±COMP keeps even an all-GOAT five just shy of a perfect 82-0.
    const COMP = 17;
    const compNet = COMP * Math.tanh(netRtg / COMP);
    const rawWins = 41 + compNet * LEAGUE.winsPerNetPoint;
    const wins = clamp(Math.round(rawWins), 8, 82);
    const losses = 82 - wins;

    // Pythagorean win% as a secondary, "expected" view (Morey exponent 14).
    const pyExp = 14;
    const pythagPct = Math.pow(ortg, pyExp) /
      (Math.pow(ortg, pyExp) + Math.pow(drtg, pyExp));

    // ── Per-player win-share contribution (for the roster table) ─────────────────
    const contributions = lineup.map(l => ({
      pos: l.pos,
      player: l.player === REPLACEMENT ? null : l.player,
      ws: round1(l.player.ws48 * LEAGUE.starterMinutesFactor),
    }));

    // ── Sub-grades (0–100) ───────────────────────────────────────────────────────
    const versatile = players.filter(p => p.positions.length >= 2).length;
    const twoWay = players.filter(p =>
      (p.stats.spg + p.stats.bpg) >= 1.5 && p.stats.ppg >= 12).length;

    const balanceRaw = 50
      + (spacers - 3)   * 7
      + (twoWay - 1)    * 6
      + (versatile - 1) * 4
      - usageClash      * 4;

    const sub = {
      offense:    sg(ortg,            LEAGUE.ORTG, 6),
      defense:    sg(LEAGUE.DRTG - drtg, 0,        5),
      playmaking: sg(sumAPG,          LEAGUE.sumAPG, 6),
      rebounding: sg(sumRPG,          LEAGUE.sumRPG, 7),
      starPower:  sg(maxPER,          18,          6),
      balance:    { score: clamp(Math.round(balanceRaw), 0, 100),
                    grade: scoreToGrade(clamp(balanceRaw, 0, 100)) },
    };

    // ── Headline grade & projection (from wins) ──────────────────────────────────
    const grade = winsToGrade(wins);
    const projection = winsToProjection(wins);

    // ── Scouting report ──────────────────────────────────────────────────────────
    const report = buildReport({
      sub, spacers, rimBonus, defStarBonus, usageClash,
      maxPER, twoWay, smallBallPenalty,
    });

    return {
      wins, losses,
      ortg: round1(ortg), drtg: round1(drtg), netRtg: round1(netRtg),
      pythagWins: Math.round(pythagPct * 82),
      grade, projection, sub, report, contributions,
      bestPlayer: contributions.slice().sort((a, b) => b.ws - a.ws)[0],
      coach: coach || null,
      familiarPositions,
    };
  }

  // ── Scouting report generator ────────────────────────────────────────────────
  function buildReport(c) {
    const pos = [], neg = [];

    if (c.sub.offense.score   >= 82) pos.push('Elite, high-octane offense');
    else if (c.sub.offense.score >= 70) pos.push('Above-average scoring punch');
    if (c.sub.offense.score   <= 38) neg.push('Offense will struggle to score');

    if (c.sub.defense.score   >= 82) pos.push('Lockdown, championship-level defense');
    else if (c.sub.defense.score >= 70) pos.push('Stingy, reliable defense');
    if (c.sub.defense.score   <= 38) neg.push('Defense is a glaring weakness');

    if (c.sub.playmaking.score >= 78) pos.push('Excellent ball movement & creation');
    if (c.sub.playmaking.score <= 40) neg.push('Lacks a true floor general');

    if (c.sub.rebounding.score >= 78) pos.push('Dominates the glass');
    if (c.sub.rebounding.score <= 40) neg.push('Will get out-rebounded');

    if (c.maxPER >= 27) pos.push('Anchored by a bona-fide superstar');
    if (c.rimBonus >= 1.5) pos.push('Protected by a true rim deterrent');
    if (c.defStarBonus >= 1.0) pos.push('Has an elite perimeter stopper');
    if (c.twoWay >= 3) pos.push('Loaded with two-way wings');

    if (c.spacers <= 2) neg.push('Cramped spacing — not enough shooting');
    if (c.usageClash >= 3) neg.push('Too many ball-dominant scorers competing for touches');
    if (c.smallBallPenalty > 0) neg.push('Undersized in the middle');

    if (!pos.length) pos.push('A balanced, no-frills starting five');
    return { strengths: pos, weaknesses: neg };
  }

  // ── Grade scales ───────────────────────────────────────────────────────────────

  // Sub-grade: normalize a metric to 0–100 (mean → 50, ±`spread` → ±20).
  function sg(value, mean, spread) {
    const score = clamp(Math.round(50 + (value - mean) / spread * 20), 0, 100);
    return { score, grade: scoreToGrade(score) };
  }

  function scoreToGrade(s) {
    if (s >= 93) return 'A+'; if (s >= 87) return 'A'; if (s >= 82) return 'A-';
    if (s >= 77) return 'B+'; if (s >= 72) return 'B'; if (s >= 67) return 'B-';
    if (s >= 62) return 'C+'; if (s >= 57) return 'C'; if (s >= 52) return 'C-';
    if (s >= 47) return 'D+'; if (s >= 42) return 'D'; if (s >= 36) return 'D-';
    return 'F';
  }

  function winsToGrade(w) {
    if (w >= 67) return 'A+'; if (w >= 60) return 'A'; if (w >= 55) return 'A-';
    if (w >= 50) return 'B+'; if (w >= 45) return 'B'; if (w >= 41) return 'B-';
    if (w >= 37) return 'C+'; if (w >= 33) return 'C'; if (w >= 29) return 'C-';
    if (w >= 24) return 'D+'; if (w >= 19) return 'D'; if (w >= 14) return 'D-';
    return 'F';
  }

  function winsToProjection(w) {
    if (w >= 70) return 'Historic — Title Favorite';
    if (w >= 60) return 'Championship Contender';
    if (w >= 53) return 'Top Seed';
    if (w >= 45) return 'Solid Playoff Team';
    if (w >= 41) return 'Play-In Hopeful';
    if (w >= 33) return 'Rebuilding';
    return 'Lottery-Bound';
  }

  // ── Head-to-head: 7-game series ──────────────────────────────────────────────
  // Given two evaluated teams, derive a single-game win probability from the
  // difference in net rating, then compute best-of-7 series odds analytically.
  function simulateSeries(evA, evB) {
    // When A and B play each other, A's expected per-game margin (per 100 poss,
    // ≈ per game in the modern NBA) is half the gap in their net ratings.
    const margin = (evA.netRtg - evB.netRtg) / 2;

    // NBA single-game point margins have a standard deviation of ≈ 12.
    const SD = 12;
    let p = clamp(normCdf(margin / SD), 0.02, 0.98);  // A's single-game win prob
    const q = 1 - p;

    // P(win the series in exactly n games) = C(n-1, 3) · pw^4 · pl^(n-4)
    const dist = pw => {
      const pl = 1 - pw;
      return {
        4: Math.pow(pw, 4),
        5: 4  * Math.pow(pw, 4) * pl,
        6: 10 * Math.pow(pw, 4) * pl * pl,
        7: 20 * Math.pow(pw, 4) * pl * pl * pl,
      };
    };
    const dA = dist(p), dB = dist(q);
    const pSeriesA = dA[4] + dA[5] + dA[6] + dA[7];
    const pSeriesB = 1 - pSeriesA;

    // Most likely final scoreline across all eight outcomes.
    const outcomes = [
      ['A', '4-0', dA[4]], ['A', '4-1', dA[5]], ['A', '4-2', dA[6]], ['A', '4-3', dA[7]],
      ['B', '4-0', dB[4]], ['B', '4-1', dB[5]], ['B', '4-2', dB[6]], ['B', '4-3', dB[7]],
    ].sort((x, y) => y[2] - x[2]);

    const winner = pSeriesA >= pSeriesB ? 'A' : 'B';
    return {
      winner,
      pGameA: p,
      marginA: round1(margin),
      pSeriesA, pSeriesB,
      pSeriesWinner: Math.max(pSeriesA, pSeriesB),
      likelyWinner: outcomes[0][0],
      likelyScore: outcomes[0][1],
    };
  }

  // Error function (Abramowitz & Stegun 7.1.26) → normal CDF.
  function erf(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }
  function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  // ── Utilities ────────────────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }

  // Map a 0–100 score (or letter grade) to a display color.
  function gradeColor(grade) {
    const g = grade[0];
    if (g === 'A') return '#22c55e';
    if (g === 'B') return '#84cc16';
    if (g === 'C') return '#eab308';
    if (g === 'D') return '#f97316';
    return '#ef4444';
  }

  return { evaluateTeam, simulateSeries, gradeColor, scoreToGrade };
})();
