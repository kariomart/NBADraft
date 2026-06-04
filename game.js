// ── State ────────────────────────────────────────────────────────────────────
const state = {
  yearFrom: 1980,
  yearTo: 2024,
  round: 1,
  totalRounds: 5,
  roster: { PG: null, SG: null, SF: null, PF: null, C: null },
  currentTeam: null,
  currentEra: null,       // the era the wheel landed on this round
  rerollTeam: 1,          // reroll tokens remaining this round
  rerollEra: 1,
  spinning: false,
  phase: 'setup',
  posFilter: 'All',
  sortBy: 'name',
  searchQuery: '',
  usedTeams: [],
  ballKnowledge: false,   // hide all stats during the draft, reveal at the end
  salaryCapMode: false,   // players cost $1–$5; stay under the $15 cap
  sameTeamsChallenge: false, // encode draft history so opponent gets same teams/eras
  draftHistory: [],       // [{t,ef,et,ek,el}] — one entry per round, filled as picks are made
  coachOptions: [],       // the 5 coaches shown during coach pick (for mirror draft)
  selectedEras: [],       // multi-select era tags driving yearFrom/yearTo
  challenge: null,        // an opponent team loaded from a challenge code
  coach: null,            // selected after the roster is full
};

const FILL_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];

// Selectable era tags. Multi-select → the active window spans from the earliest
// selected era's start to the latest selected era's end.
const ERAS = [
  { key: '80s',  label: '80s',      from: 1979, to: 1989 },
  { key: '90s',  label: '90s',      from: 1989, to: 1999 },
  { key: '00s',  label: '2000s',    from: 1999, to: 2009 },
  { key: '10s',  label: '2010s',    from: 2009, to: 2019 },
  { key: '20s',  label: '2020s',    from: 2019, to: 2024 },
  { key: 'all',  label: 'All-Time', from: 1960, to: 2024 },
];

// ── Drag State ────────────────────────────────────────────────────────────────
const drag = { type: null, playerId: null, fromPos: null };

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
  // Auto-load a challenge if the page was opened from a share link (?c=…).
  const code = new URLSearchParams(location.search).get('c');
  if (code) {
    const dec = decodeTeam(code);
    if (dec) {
      applyChallenge(dec);
      // Clean the URL so a refresh/re-share doesn't re-trigger or grow.
      history.replaceState(null, '', location.pathname);
    }
  }
  renderSetup();
}

// ── Setup Phase ───────────────────────────────────────────────────────────────
function renderSetup() {
  state.phase = 'setup';
  const app = document.getElementById('app');
  const locked = !!state.challenge;   // era is fixed to match the opponent

  app.innerHTML = `
    <div class="setup-screen">
      <div class="logo">🏀 NBA Draft Sim</div>
      <h1>Build Your All-Time Team</h1>
      <p class="subtitle">Set your era, spin for teams, draft players, get a record.</p>

      ${locked ? `
      <div class="challenge-banner">
        <div class="challenge-banner-main">⚔️ Challenge from <strong>${state.challenge.name}</strong></div>
        <div class="challenge-banner-sub">Era locked to ${state.yearFrom}–${state.yearTo}${state.ballKnowledge ? ' · 🧠 Ball Knowledge ON' : ''}${state.salaryCapMode ? ' · 💰 Salary Cap ON ($15)' : ''}${state.challenge.payload.sq ? ' · 🔁 Mirror Draft — your teams & eras are predetermined' : ''} · draft your five, then face their team in a 7-game series.</div>
        <button class="btn-ghost" onclick="clearChallenge()">Cancel challenge</button>
      </div>` : ''}

      <div class="year-inputs ${locked ? 'locked' : ''}">
        <div class="year-group">
          <label>From Year</label>
          <input type="number" id="yearFrom" value="${state.yearFrom}" min="1950" max="2024" step="1" ${locked ? 'disabled' : ''}>
        </div>
        <div class="year-sep">–</div>
        <div class="year-group">
          <label>To Year</label>
          <input type="number" id="yearTo" value="${state.yearTo}" min="1950" max="2024" step="1" ${locked ? 'disabled' : ''}>
        </div>
      </div>
      <div class="era-label">${locked ? 'Era locked by challenge' : 'Tap one or more eras to span them'}</div>
      <div class="era-presets ${locked ? 'locked' : ''}">
        ${ERAS.map(e => `<button class="preset-btn ${state.selectedEras.includes(e.key) ? 'active' : ''}" ${locked ? '' : `onclick="toggleEra('${e.key}')"`}>${e.label}</button>`).join('')}
      </div>

      <button class="mode-toggle ${state.ballKnowledge ? 'on' : ''} ${locked ? 'locked' : ''}" id="bkToggle" ${locked ? '' : 'onclick="toggleBallKnowledge()"'}>
        <span class="mode-toggle-switch"><span class="mode-toggle-knob"></span></span>
        <span class="mode-toggle-text">
          <span class="mode-toggle-title">🧠 Ball Knowledge Mode</span>
          <span class="mode-toggle-sub">${locked ? 'Locked by challenge to match your opponent' : 'Stats hidden while drafting — pick on name & gut alone'}</span>
        </span>
      </button>

      <button class="mode-toggle ${state.salaryCapMode ? 'on' : ''} ${locked ? 'locked' : ''}" id="scToggle" ${locked ? '' : 'onclick="toggleSalaryCap()"'}>
        <span class="mode-toggle-switch"><span class="mode-toggle-knob"></span></span>
        <span class="mode-toggle-text">
          <span class="mode-toggle-title">💰 Salary Cap Mode</span>
          <span class="mode-toggle-sub">${locked ? 'Locked by challenge to match your opponent' : 'Players cost $1–$5 based on talent. Stay under the $15 cap.'}</span>
        </span>
      </button>

      <button class="btn-primary" onclick="startGame()">${locked ? `Draft vs ${state.challenge.name}` : 'Start Draft'}</button>

      ${locked ? '' : `
      <div class="challenge-entry">
        <div class="challenge-entry-title">⚔️ Got a challenge code?</div>
        <div class="challenge-entry-row">
          <input id="challengeCode" class="challenge-input" placeholder="Paste a friend's code…">
          <button class="btn-ghost" onclick="loadChallenge()">Load</button>
        </div>
        <div class="challenge-error" id="challengeError"></div>
      </div>`}
    </div>
  `;
  // Manually editing a year is a custom range — drop any selected era tags.
  document.getElementById('yearFrom').addEventListener('change', e => {
    state.yearFrom = parseInt(e.target.value);
    state.selectedEras = [];
    renderSetup();
  });
  document.getElementById('yearTo').addEventListener('change', e => {
    state.yearTo = parseInt(e.target.value);
    state.selectedEras = [];
    renderSetup();
  });
}

function toggleBallKnowledge() {
  state.ballKnowledge = !state.ballKnowledge;
  document.getElementById('bkToggle').classList.toggle('on', state.ballKnowledge);
}

function toggleSameTeams() {
  state.sameTeamsChallenge = !state.sameTeamsChallenge;
  const btn = document.getElementById('sameTeamsToggle');
  if (btn) btn.classList.toggle('on', state.sameTeamsChallenge);
  refreshShareCode();
}

function toggleSalaryCap() {
  state.salaryCapMode = !state.salaryCapMode;
  const btn = document.getElementById('scToggle');
  if (btn) btn.classList.toggle('on', state.salaryCapMode);
}

// PER-based salary tiers: $5 elite → $1 fringe
function playerSalary(player) {
  if (player.per >= 26) return 5;
  if (player.per >= 21) return 4;
  if (player.per >= 17) return 3;
  if (player.per >= 13) return 2;
  return 1;
}

function rosterCapUsed() {
  return FILL_ORDER.reduce((sum, pos) => {
    const p = state.roster[pos];
    return sum + (p ? playerSalary(p) : 0);
  }, 0);
}

function updateCapDisplay() {
  const el = document.getElementById('capTracker');
  if (!el) return;
  const used = rosterCapUsed();
  const remaining = 15 - used;
  const pct = Math.min((used / 15) * 100, 100);
  const tight = remaining <= 3;
  el.innerHTML = `
    <div class="cap-tracker-row">
      <span class="cap-tracker-label">💰 Salary Cap</span>
      <span class="cap-tracker-value${tight ? ' cap-tight' : ''}">$${remaining} left · $${used}/$15</span>
    </div>
    <div class="cap-bar"><div class="cap-bar-fill${tight ? ' cap-bar-danger' : ''}" style="width:${pct}%"></div></div>
  `;
}

// Toggle an era tag, then span the active window across all selected eras.
function toggleEra(key) {
  const i = state.selectedEras.indexOf(key);
  if (i >= 0) state.selectedEras.splice(i, 1);
  else state.selectedEras.push(key);

  const sel = ERAS.filter(e => state.selectedEras.includes(e.key));
  if (sel.length) {
    state.yearFrom = Math.min(...sel.map(e => e.from));
    state.yearTo = Math.max(...sel.map(e => e.to));
  }
  renderSetup();
}

function startGame() {
  state.round = 1;
  state.roster = { PG: null, SG: null, SF: null, PF: null, C: null };
  state.usedTeams = [];
  state.rerollTeam = 1;
  state.rerollEra = 1;
  state.coach = null;
  state.draftHistory = [];
  state.coachOptions = [];
  state.sameTeamsChallenge = false;
  renderDraftScreen();
  spinWheel();
}

// ── Draft Screen ──────────────────────────────────────────────────────────────
function renderDraftScreen() {
  state.phase = 'spin';
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="draft-screen">
      <div class="draft-header">
        <button class="btn-ghost" onclick="renderSetup()">← Back</button>
        <div class="round-badge" id="roundBadge">Round ${state.round}/${state.totalRounds}</div>
        <div class="era-badge">${state.yearFrom} – ${state.yearTo}</div>
      </div>
      <div class="draft-body">
        <div class="left-panel">
          <div class="wheel-area" id="wheelArea">
            <div class="dials">
              <div class="dial">
                <div class="dial-spinner" id="teamSpinner"><div id="teamLabel">—</div></div>
                <div class="dial-cap">TEAM</div>
                <button class="reroll-btn" id="rerollTeamBtn" onclick="rerollDial('team')" disabled>
                  🎲 <span id="rerollTeamCount">1</span>
                </button>
              </div>
              <div class="dial-x">×</div>
              <div class="dial">
                <div class="dial-spinner era" id="eraSpinner"><div id="eraLabel">—</div></div>
                <div class="dial-cap">ERA</div>
                <button class="reroll-btn" id="rerollEraBtn" onclick="rerollDial('era')" disabled>
                  🎲 <span id="rerollEraCount">1</span>
                </button>
              </div>
            </div>
          </div>
          <div class="player-list-area" id="playerListArea" style="display:none">
            <div class="list-controls">
              <div class="pos-filters">
                ${['All','PG','SG','SF','PF','C'].map(p => `<button class="pos-btn ${state.posFilter===p?'active':''}" onclick="setPosFilter('${p}')">${p}</button>`).join('')}
              </div>
              <input class="search-input" id="searchInput" placeholder="Search player..." value="${state.searchQuery}" oninput="setSearch(this.value)">
            </div>
            <div class="players-count" id="playersCount"></div>
            ${state.ballKnowledge ? '<div class="drag-hint bk-hint">🧠 Ball Knowledge Mode — stats revealed at the end. Trust your gut.</div>' : '<div class="drag-hint">Drag a player to a matching position slot →</div>'}
            ${state.salaryCapMode ? '<div id="capTracker" class="cap-tracker"></div>' : ''}
            <div class="player-list" id="playerList"></div>
          </div>
        </div>
        <div class="right-panel">
          <div class="court-container">
            <div class="court" id="court">
              ${renderCourtSlots()}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Court ─────────────────────────────────────────────────────────────────────
function renderCourtSlots() {
  const slots = [
    { id: 'C',  cls: 'slot-c' },
    { id: 'PF', cls: 'slot-pf' },
    { id: 'SF', cls: 'slot-sf' },
    { id: 'PG', cls: 'slot-pg' },
    { id: 'SG', cls: 'slot-sg' },
  ];

  return slots.map(slot => {
    const p = state.roster[slot.id];
    const dragAttrs = p
      ? `draggable="true" ondragstart="onSlotDragStart(event,'${slot.id}')" ondragend="onDragEnd(event)"`
      : '';
    const inner = p
      ? `<div class="slot-name">${p.name.split(' ').pop()}</div><div class="slot-pos-label">${slot.id}</div>`
      : `<div class="slot-pos-label">${slot.id}</div>`;

    return `
      <div class="court-slot ${slot.cls} ${p ? 'filled' : 'empty'}"
           data-pos="${slot.id}"
           ${dragAttrs}
           ondragover="onSlotDragOver(event,'${slot.id}')"
           ondrop="onSlotDrop(event,'${slot.id}')"
           ondragleave="onSlotDragLeave(event)">
        ${inner}
      </div>
    `;
  }).join('');
}

function updateCourt() {
  const court = document.getElementById('court');
  if (court) court.innerHTML = renderCourtSlots();
}

// ── Drag: from player list ────────────────────────────────────────────────────
function onPlayerDragStart(event, playerId) {
  drag.type = 'list';
  drag.playerId = playerId;
  drag.fromPos = null;
  event.dataTransfer.effectAllowed = 'move';
  highlightValidSlots(playerId, null);
}

// ── Drag: from court slot ────────────────────────────────────────────────────
function onSlotDragStart(event, pos) {
  const player = state.roster[pos];
  if (!player) { event.preventDefault(); return; }
  drag.type = 'slot';
  drag.playerId = player.id;
  drag.fromPos = pos;
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.classList.add('dragging');
  highlightValidSlots(player.id, pos);
}

// ── Slot drag events ──────────────────────────────────────────────────────────
function onSlotDragOver(event, pos) {
  event.preventDefault();
  const player = PLAYERS.find(p => p.id === drag.playerId);
  if (!player) return;
  const el = event.currentTarget;
  el.classList.remove('drag-over', 'drag-over-invalid');
  if (player.positions.includes(pos)) {
    event.dataTransfer.dropEffect = 'move';
    el.classList.add('drag-over');
  } else {
    event.dataTransfer.dropEffect = 'none';
    el.classList.add('drag-over-invalid');
  }
}

function onSlotDragLeave(event) {
  event.currentTarget.classList.remove('drag-over', 'drag-over-invalid');
}

function onSlotDrop(event, targetPos) {
  event.preventDefault();
  clearDragHighlights();

  const player = PLAYERS.find(p => p.id === drag.playerId);
  if (!player) return;

  // Hard block: player doesn't play this position
  if (!player.positions.includes(targetPos)) {
    flashInvalid(targetPos);
    return;
  }

  if (drag.type === 'list') {
    // Only place in empty slots (can't overwrite a pick with another from the list)
    if (state.roster[targetPos]) {
      flashInvalid(targetPos);
      return;
    }
    if (state.salaryCapMode) {
      const salary = playerSalary(player);
      const remaining = 15 - rosterCapUsed();
      const otherOpenCount = getOpenPositions().filter(p => p !== targetPos).length;
      if (salary + otherOpenCount > remaining) {
        flashInvalid(targetPos);
        const ct = document.getElementById('capTracker');
        if (ct) { ct.classList.add('cap-flash'); ct.addEventListener('animationend', () => ct.classList.remove('cap-flash'), { once: true }); }
        return;
      }
    }
    state.roster[targetPos] = player;
    drag.type = null; drag.playerId = null; drag.fromPos = null;
    advanceAfterPick();

  } else if (drag.type === 'slot') {
    const fromPos = drag.fromPos;
    if (fromPos === targetPos) { drag.type = null; return; }

    const targetPlayer = state.roster[targetPos];

    if (targetPlayer) {
      // Swap: the displaced player must be eligible for fromPos
      if (!targetPlayer.positions.includes(fromPos)) {
        flashInvalid(targetPos);
        return;
      }
      state.roster[fromPos] = targetPlayer;
    } else {
      state.roster[fromPos] = null;
    }
    state.roster[targetPos] = player;
    drag.type = null; drag.playerId = null; drag.fromPos = null;
    updateCourt();
  }
}

function onDragEnd(event) {
  clearDragHighlights();
  document.querySelectorAll('.court-slot.dragging').forEach(el => el.classList.remove('dragging'));
  drag.type = null;
  drag.playerId = null;
  drag.fromPos = null;
}

// ── Drag helpers ──────────────────────────────────────────────────────────────
function highlightValidSlots(playerId, excludePos) {
  const player = PLAYERS.find(p => p.id === playerId);
  if (!player) return;
  FILL_ORDER.forEach(pos => {
    if (pos === excludePos) return;
    const el = document.querySelector(`.court-slot[data-pos="${pos}"]`);
    if (!el) return;
    if (player.positions.includes(pos)) {
      el.classList.add('drag-valid');
    } else {
      el.classList.add('drag-invalid');
    }
  });
}

function clearDragHighlights() {
  document.querySelectorAll('.court-slot').forEach(el => {
    el.classList.remove('drag-valid', 'drag-invalid', 'drag-over', 'drag-over-invalid');
  });
}

function flashInvalid(pos) {
  const el = document.querySelector(`.court-slot[data-pos="${pos}"]`);
  if (!el) return;
  el.classList.add('flash-invalid');
  el.addEventListener('animationend', () => el.classList.remove('flash-invalid'), { once: true });
}

// Eras the wheel can land on: the selected tags, or a single custom range.
function activeEras() {
  if (state.selectedEras.length) {
    return ERAS.filter(e => state.selectedEras.includes(e.key));
  }
  return [{ key: 'custom', label: `${state.yearFrom}–${state.yearTo}`,
            from: state.yearFrom, to: state.yearTo }];
}

// ── Wheel Spin (team dial × era dial) ──────────────────────────────────────────
function spinWheel() {
  if (state.spinning) return;
  state.spinning = true;

  const teamLabel = document.getElementById('teamLabel');
  const eraLabel = document.getElementById('eraLabel');
  const teamSpinner = document.getElementById('teamSpinner');
  const eraSpinner = document.getElementById('eraSpinner');

  const availableTeams = TEAMS.filter(t => !state.usedTeams.includes(t.id));
  const eras = activeEras();

  // Only land on (team, era) combos that actually have eligible players.
  const combos = [];
  availableTeams.forEach(t => eras.forEach(e => {
    const players = getPlayersForTeam(t.id, e.from, e.to);
    if (players.length < 5) return;
    if (state.salaryCapMode && !players.some(p => playerCanFill(p))) return;
    combos.push({ team: t, era: e });
  }));

  // Mirror draft: use the forced team/era from the challenger's history if present.
  const sq = state.challenge?.payload?.sq;
  let chosen;
  if (sq && sq[state.round - 1]) {
    const f = sq[state.round - 1];
    const team = TEAMS.find(t => t.id === f.t);
    if (team) chosen = { team, era: { key: f.ek, label: f.el, from: f.ef, to: f.et } };
  }
  if (!chosen) {
    if (!combos.length) { endGame(); return; }
    chosen = combos[Math.floor(Math.random() * combos.length)];
  }

  let ticks = 0;
  const total = 20 + Math.floor(Math.random() * 15);
  teamSpinner.classList.add('spinning');
  eraSpinner.classList.add('spinning');

  const interval = setInterval(() => {
    teamLabel.textContent = availableTeams[Math.floor(Math.random() * availableTeams.length)].id;
    eraLabel.textContent = eras[Math.floor(Math.random() * eras.length)].label;
    ticks++;
    if (ticks >= total) {
      clearInterval(interval);
      teamSpinner.classList.remove('spinning');
      eraSpinner.classList.remove('spinning');

      state.currentTeam = chosen.team;
      state.currentEra = chosen.era;
      state.usedTeams.push(chosen.team.id);

      teamLabel.textContent = chosen.team.id;
      eraLabel.textContent = chosen.era.label;
      teamSpinner.style.background = chosen.team.color + '22';
      teamSpinner.style.borderColor = chosen.team.color;

      state.spinning = false;
      showPlayerPicker(chosen.team, chosen.era);
    }
  }, 40);
}

// ── Player Picker ─────────────────────────────────────────────────────────────
function updateRerollButtons() {
  const tb = document.getElementById('rerollTeamBtn');
  const eb = document.getElementById('rerollEraBtn');
  const tc = document.getElementById('rerollTeamCount');
  const ec = document.getElementById('rerollEraCount');
  if (tb) tb.disabled = state.rerollTeam <= 0 || state.spinning;
  if (eb) {
    eb.disabled = state.rerollEra <= 0 || state.spinning || activeEras().length <= 1;
  }
  if (tc) tc.textContent = state.rerollTeam;
  if (ec) ec.textContent = state.rerollEra;
}

function showPlayerPicker(team, era) {
  state.phase = 'pick';
  updateRerollButtons();
  const listArea = document.getElementById('playerListArea');
  if (!listArea) return;
  listArea.style.display = 'flex';

  // Team + era banner (insert before list-controls)
  const existing = listArea.querySelector('.team-name-banner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.className = 'team-name-banner';
  banner.innerHTML = `${team.name} <span class="banner-era">${era.label}</span>`;
  banner.style.color = team.color;
  listArea.insertBefore(banner, listArea.firstChild);

  renderPlayerList();
}

function rerollDial(which) {
  if (state.spinning) return;
  if (which === 'team' && state.rerollTeam <= 0) return;
  if (which === 'era' && state.rerollEra <= 0) return;

  state.spinning = true;
  updateRerollButtons();

  const eras = activeEras();
  const availableTeams = TEAMS.filter(t => !state.usedTeams.includes(t.id));

  // Build valid reroll targets — must have eligible players with the locked dial.
  let newTeam = state.currentTeam;
  let newEra  = state.currentEra;

  if (which === 'team') {
    state.rerollTeam--;
    // Return old team to the pool, pick a new one.
    state.usedTeams = state.usedTeams.filter(id => id !== state.currentTeam.id);
    const freshTeams = TEAMS.filter(t => {
      if (state.usedTeams.includes(t.id) || t.id === state.currentTeam.id) return false;
      const players = getPlayersForTeam(t.id, state.currentEra.from, state.currentEra.to);
      if (players.length < 5) return false;
      if (state.salaryCapMode && !players.some(p => playerCanFill(p))) return false;
      return true;
    });
    if (!freshTeams.length) { state.spinning = false; updateRerollButtons(); return; }
    newTeam = freshTeams[Math.floor(Math.random() * freshTeams.length)];
    state.usedTeams.push(newTeam.id);
  } else {
    state.rerollEra--;
    const freshEras = eras.filter(e => {
      if (e.key === state.currentEra.key) return false;
      const players = getPlayersForTeam(state.currentTeam.id, e.from, e.to);
      if (players.length < 5) return false;
      if (state.salaryCapMode && !players.some(p => playerCanFill(p))) return false;
      return true;
    });
    if (!freshEras.length) { state.spinning = false; updateRerollButtons(); return; }
    newEra = freshEras[Math.floor(Math.random() * freshEras.length)];
  }

  // Animate only the rerolled dial.
  const spinnerId = which === 'team' ? 'teamSpinner' : 'eraSpinner';
  const labelId   = which === 'team' ? 'teamLabel'   : 'eraLabel';
  const spinner = document.getElementById(spinnerId);
  const label   = document.getElementById(labelId);
  const pool    = which === 'team' ? availableTeams : eras;

  let ticks = 0;
  const total = 12 + Math.floor(Math.random() * 8);   // shorter than a fresh spin
  spinner.classList.add('spinning');

  const interval = setInterval(() => {
    label.textContent = pool[Math.floor(Math.random() * pool.length)][which === 'team' ? 'id' : 'label'];
    ticks++;
    if (ticks >= total) {
      clearInterval(interval);
      spinner.classList.remove('spinning');

      state.currentTeam = newTeam;
      state.currentEra  = newEra;

      // Settle the team dial visuals.
      const teamLabel   = document.getElementById('teamLabel');
      const teamSpinner = document.getElementById('teamSpinner');
      teamLabel.textContent = state.currentTeam.id;
      teamSpinner.style.background   = state.currentTeam.color + '22';
      teamSpinner.style.borderColor  = state.currentTeam.color;
      document.getElementById('eraLabel').textContent = state.currentEra.label;

      state.spinning = false;
      showPlayerPicker(state.currentTeam, state.currentEra);
    }
  }, 40);
}

function renderPlayerList() {
  const team = state.currentTeam;
  const era = state.currentEra;
  const allPlayers = getPlayersForTeam(team.id, era.from, era.to);

  let filtered = allPlayers;
  if (state.posFilter !== 'All') {
    filtered = filtered.filter(p => p.positions.includes(state.posFilter));
  }
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filtered = filtered.filter(p => p.name.toLowerCase().includes(q));
  }
  if (state.ballKnowledge) {
    // No stat-based ordering — that would leak the very info we're hiding.
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  const countEl = document.getElementById('playersCount');
  if (countEl) countEl.textContent = `${filtered.length} player${filtered.length !== 1 ? 's' : ''} available`;

  const listEl = document.getElementById('playerList');
  if (!listEl) return;

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="no-players">No players match your filters.</div>';
    return;
  }

  listEl.innerHTML = filtered.map(p => {
    const canFill = playerCanFill(p);
    const posLabel = p.positions.join(' · ');
    const salary = state.salaryCapMode ? playerSalary(p) : null;
    const salaryBadge = salary ? `<div class="salary-badge salary-${salary}">$${salary}</div>` : '';

    // Show position pips: player's positions with open/filled state
    const pips = p.positions.map(pos => {
      const isOpen = !state.roster[pos];
      return `<span class="slot-pip ${isOpen ? 'pip-open' : 'pip-taken'}">${pos}</span>`;
    }).join('');

    return `
      <div class="player-card ${canFill ? '' : 'no-fit'}"
           draggable="true"
           onclick="quickPlace(${p.id})"
           ondragstart="onPlayerDragStart(event, ${p.id})"
           ondragend="onDragEnd(event)">
        <div class="player-info">
          <div class="player-name">${p.name}</div>
          <div class="player-meta"><span class="player-pos">${posLabel}</span> · ${p.from}–${p.to}</div>
          <div class="player-pips">${pips}</div>
        </div>
        <div class="player-stats${state.ballKnowledge ? ' hidden-stats' : ''}">
          ${salaryBadge}
          ${state.ballKnowledge && !salary ? '<div class="stat-hidden">🧠</div>' : ''}
          ${!state.ballKnowledge ? `
          <div class="stat"><span>${p.stats.ppg.toFixed(1)}</span><small>PPG</small></div>
          <div class="stat"><span>${p.stats.rpg.toFixed(1)}</span><small>RPG</small></div>
          <div class="stat"><span>${p.stats.apg.toFixed(1)}</span><small>APG</small></div>
          <div class="stat"><span>${p.stats.spg.toFixed(1)}</span><small>SPG</small></div>
          <div class="stat"><span>${p.stats.bpg.toFixed(1)}</span><small>BPG</small></div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  updateCapDisplay();
}

function getOpenPositions() {
  return FILL_ORDER.filter(pos => !state.roster[pos]);
}

function playerCanFill(player) {
  const openPositions = getOpenPositions();
  if (!openPositions.some(pos => player.positions.includes(pos))) return false;
  if (state.salaryCapMode) {
    const salary = playerSalary(player);
    const remaining = 15 - rosterCapUsed();
    // Other open slots each need at least $1 minimum
    const otherSlotsMin = openPositions.length - 1;
    if (salary + otherSlotsMin > remaining) return false;
  }
  return true;
}

// Click (no drag) → drop the player into their first eligible OPEN position,
// preferring the order they're listed in (their "natural" position first).
function quickPlace(playerId) {
  const player = PLAYERS.find(p => p.id === playerId);
  if (!player) return;

  const target = player.positions.find(pos => !state.roster[pos]);
  if (!target) return;   // none of their positions are open — ignore the click

  if (state.salaryCapMode) {
    const salary = playerSalary(player);
    const remaining = 15 - rosterCapUsed();
    const otherSlotsMin = getOpenPositions().length - 1;
    if (salary + otherSlotsMin > remaining) {
      const ct = document.getElementById('capTracker');
      if (ct) { ct.classList.add('cap-flash'); ct.addEventListener('animationend', () => ct.classList.remove('cap-flash'), { once: true }); }
      return;
    }
  }

  state.roster[target] = player;
  advanceAfterPick();
}

// ── Filters / Sort ────────────────────────────────────────────────────────────
function setPosFilter(pos) {
  state.posFilter = pos;
  renderPlayerList();
  document.querySelectorAll('.pos-btn').forEach(b => {
    b.classList.toggle('active', b.textContent === pos);
  });
}

function setSort(val) {
  state.sortBy = val;
  renderPlayerList();
}

function setSearch(val) {
  state.searchQuery = val;
  renderPlayerList();
}

// ── After placing a pick ──────────────────────────────────────────────────────
function advanceAfterPick() {
  updateCourt();
  updateCapDisplay();

  // Record which team/era was used this round so mirror-draft challenges can replay it.
  if (state.currentTeam && state.currentEra) {
    state.draftHistory.push({
      t: state.currentTeam.id,
      ef: state.currentEra.from,
      et: state.currentEra.to,
      ek: state.currentEra.key,
      el: state.currentEra.label,
    });
  }

  const allFilled = FILL_ORDER.every(pos => state.roster[pos]);
  if (allFilled || state.round >= state.totalRounds) {
    setTimeout(spinCoachRound, 500);
    return;
  }

  state.round++;
  state.posFilter = 'All';
  state.searchQuery = '';
  renderDraftScreen();
  spinWheel();
}

// ── Coach Round ───────────────────────────────────────────────────────────────
function spinCoachRound() {
  state.phase = 'pick';

  const roundBadge = document.getElementById('roundBadge');
  if (roundBadge) roundBadge.textContent = 'Coach';

  const eraLabel = document.getElementById('eraLabel');
  const rb1 = document.getElementById('rerollTeamBtn');
  const rb2 = document.getElementById('rerollEraBtn');
  if (eraLabel) eraLabel.textContent = 'COACH';
  if (rb1) rb1.style.display = 'none';
  if (rb2) rb2.style.display = 'none';

  showCoachList();
}

function showCoachList() {
  state.phase = 'pick';

  // Use forced coach list from mirror challenge, or pick 5 random
  const cq = state.challenge?.payload?.cq;
  let list;
  if (cq && Array.isArray(cq)) {
    list = cq.map(id => COACHES.find(c => c.id === id)).filter(Boolean);
  } else {
    list = COACHES.slice().sort(() => Math.random() - 0.5).slice(0, 5);
  }
  state.coachOptions = list;
  const header = 'Pick Your Coach';

  const area = document.getElementById('playerListArea');
  if (!area) return;
  area.style.display = '';

  area.innerHTML = `
    <div class="coach-list-hdr">${header}</div>
    <div class="coach-list-inner">
      ${list.map(c => {
        const famPos = FILL_ORDER.filter(pos => {
          const p = state.roster[pos];
          return p && c.tenures.some(t =>
            p.team === t.team && p.from <= t.to && p.to >= t.from
          );
        });
        const famBadge = famPos.length > 0
          ? `<div class="coach-fam">★ ${famPos.join(', ')} on your roster</div>`
          : '';
        return `
          <div class="coach-list-card" onclick="selectCoach('${c.id}')">
            <div class="coach-card-head">
              <div>
                <div class="coach-card-name">${c.name}</div>
                <div class="coach-card-style">${c.style}</div>
              </div>
            </div>
            ${famBadge}
            <div class="coach-card-note">${c.note}</div>
          </div>`;
      }).join('')}
    </div>
  `;
}

function selectCoach(coachId) {
  state.coach = COACHES.find(c => c.id === coachId) || null;
  endGame();
}

// ── Result Screen (model-driven) ────────────────────────────────────────────
function endGame() {
  state.phase = 'result';
  const ev = MODEL.evaluateTeam(state.roster, state.coach);

  // If an opponent code was loaded, show the head-to-head series instead.
  if (state.challenge) { renderHeadToHead(ev); return; }

  const gradeColor = MODEL.gradeColor(ev.grade);
  const arch = teamArchetype(ev, state.roster);
  const shareCode = encodeTeam(state.roster, '');

  const subCards = [
    ['Offense', ev.sub.offense],
    ['Defense', ev.sub.defense],
    ['Playmaking', ev.sub.playmaking],
    ['Rebounding', ev.sub.rebounding],
    ['Star Power', ev.sub.starPower],
    ['Balance', ev.sub.balance],
  ].map(([label, s]) => `
    <div class="subgrade">
      <div class="subgrade-top">
        <span class="subgrade-label">${label}</span>
        <span class="subgrade-grade" style="color:${MODEL.gradeColor(s.grade)}">${s.grade}</span>
      </div>
      <div class="subgrade-bar">
        <div class="subgrade-fill" style="width:${s.score}%;background:${MODEL.gradeColor(s.grade)}"></div>
      </div>
    </div>
  `).join('');

  const reportHtml = `
    ${ev.report.strengths.map(s => `<li class="report-pos">✓ ${s}</li>`).join('')}
    ${ev.report.weaknesses.map(s => `<li class="report-neg">✗ ${s}</li>`).join('')}
  `;

  const rosterHtml = ev.contributions.map(c => {
    const p = c.player;
    const salaryStr = state.salaryCapMode && p ? `<span class="salary-badge salary-${playerSalary(p)} result-salary">$${playerSalary(p)}</span> ` : '';
    return `
      <div class="result-player">
        <div class="result-pos">${c.pos}</div>
        <div class="result-player-info">
          ${p
            ? `<div class="result-player-name">${salaryStr}${p.name}</div>
               <div class="result-player-stats">${p.stats.ppg} PPG · ${p.stats.rpg} RPG · ${p.stats.apg} APG · ${p.ts}% TS</div>`
            : `<div class="result-player-name empty">— Empty —</div>`}
        </div>
        <div class="result-ws" title="Estimated Win Shares">
          <span>${c.ws}</span><small>WS</small>
        </div>
      </div>
    `;
  }).join('');
  const capSummaryHtml = state.salaryCapMode
    ? `<div class="cap-summary">💰 Total salary: $${rosterCapUsed()} / $15 cap</div>`
    : '';

  document.getElementById('app').innerHTML = `
    <div class="result-screen">
      <div class="result-hero">
        <div class="hero-left">
          <h1>Your Team</h1>
          <div class="result-archetype">${arch.label}</div>
          <div class="result-archetype-desc">${arch.desc}</div>
          <div class="record-badge">
            <span class="record-wins">${ev.wins}</span>
            <span class="record-dash">-</span>
            <span class="record-losses">${ev.losses}</span>
          </div>
          <div class="record-label">Projected Record</div>
          <div class="projection-label">${ev.projection}</div>
        </div>
        <div class="hero-grade" style="border-color:${gradeColor}">
          <div class="hero-grade-letter" style="color:${gradeColor}">${ev.grade}</div>
          <div class="hero-grade-label">Team Grade</div>
        </div>
      </div>

      <div class="ratings-row">
        <div class="rating-pill"><span class="rating-val" style="color:#22c55e">${ev.ortg}</span><small>OFF RTG</small></div>
        <div class="rating-pill"><span class="rating-val" style="color:#ef4444">${ev.drtg}</span><small>DEF RTG</small></div>
        <div class="rating-pill"><span class="rating-val" style="color:${ev.netRtg>=0?'#22c55e':'#ef4444'}">${ev.netRtg>=0?'+':''}${ev.netRtg}</span><small>NET RTG</small></div>
        <div class="rating-pill"><span class="rating-val">${ev.pythagWins}</span><small>PYTHAG W</small></div>
      </div>

      <div class="result-grid">
        <div class="result-col">
          <div class="col-title">Grades</div>
          <div class="subgrades">${subCards}</div>
        </div>
        <div class="result-col">
          <div class="col-title">Scouting Report</div>
          <ul class="report-list">${reportHtml}</ul>
        </div>
      </div>

      <div class="result-col">
        <div class="col-title">Starting Five</div>
        <div class="result-roster">
          ${ev.coach ? (() => {
            const offSign = ev.coach.ortgMod >= 0 ? '+' : '';
            const defSign = ev.coach.drtgMod <= 0 ? '' : '+';
            const famStr  = ev.familiarPositions.length > 0
              ? ` · ★ ${ev.familiarPositions.join(', ')} familiar`
              : '';
            return `
              <div class="result-player coach-result-row">
                <div class="result-pos" style="color:var(--accent2)">HC</div>
                <div class="result-player-info">
                  <div class="result-player-name">${ev.coach.name}</div>
                  <div class="result-player-stats">${ev.coach.style} · OFF ${offSign}${ev.coach.ortgMod} / DEF ${defSign}${ev.coach.drtgMod}${famStr}</div>
                </div>
                <div class="result-ws"></div>
              </div>`;
          })() : ''}
          <div class="roster-divider"></div>
          ${rosterHtml}
          ${capSummaryHtml}
        </div>
      </div>

      <div class="result-col share-block">
        <div class="col-title">⚔️ Challenge a Friend</div>
        <p class="share-sub">Send this link. They draft in the same era (${state.yearFrom}–${state.yearTo})${state.ballKnowledge ? ' with Ball Knowledge mode on' : ''}, then we sim a 7-game series between your teams.</p>
        <button class="mode-toggle ${state.sameTeamsChallenge ? 'on' : ''}" id="sameTeamsToggle" onclick="toggleSameTeams()" style="max-width:100%;margin-bottom:12px">
          <span class="mode-toggle-switch"><span class="mode-toggle-knob"></span></span>
          <span class="mode-toggle-text">
            <span class="mode-toggle-title">🔁 Mirror Draft</span>
            <span class="mode-toggle-sub">Opponent gets the exact same teams & eras you drafted from</span>
          </span>
        </button>
        <input id="challengerName" class="share-name" placeholder="Your name (optional)" maxlength="24" oninput="refreshShareCode()">
        <div class="share-code-row">
          <input id="shareLink" class="share-code" readonly value="${buildShareURL(shareCode)}">
          <button class="btn-ghost" id="copyLinkBtn" onclick="copyShare('link')">Copy Link</button>
        </div>
        <button class="share-altcopy" id="copyCodeBtn" onclick="copyShare('code')">Copy raw code instead</button>
      </div>

      <div class="result-actions">
        <button class="btn-primary" onclick="startGame()">Draft Again</button>
        <button class="btn-ghost" onclick="renderSetup()">Change Era</button>
        <button class="btn-ghost" id="copyImgBtn" onclick="copyResultImage()">📸 Share</button>
      </div>
    </div>
  `;
}

// ── Result image share ────────────────────────────────────────────────────────
async function copyResultImage() {
  const btn = document.getElementById('copyImgBtn');
  const el  = document.querySelector('.result-screen');
  if (!el || !window.html2canvas) return;

  const orig = btn.textContent;
  btn.textContent = 'Capturing…';
  btn.disabled = true;

  try {
    const canvas = await html2canvas(el, {
      scale: 1,
      useCORS: true,
      backgroundColor: '#0a0f09',
      scrollX: 0,
      scrollY: -window.scrollY,
    });

    canvas.toBlob(async blob => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        btn.textContent = 'Copied!';
      } catch {
        // Clipboard API blocked — fall back to download
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'nba-draft-result.png';
        a.click();
        btn.textContent = 'Downloaded!';
      }
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
    }, 'image/png');
  } catch (e) {
    btn.textContent = 'Error';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }
}

// ── Challenge codes ───────────────────────────────────────────────────────────

// URL-safe base64 (UTF-8 aware).
function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

// Pack a roster + era + mode into a shareable code.
function encodeTeam(roster, name) {
  const payload = {
    v: 1,
    n: (name || '').slice(0, 24),
    f: state.yearFrom, t: state.yearTo,
    e: state.selectedEras.slice(),
    b: state.ballKnowledge ? 1 : 0,                      // ball-knowledge mode
    sc: state.salaryCapMode ? 1 : 0,                     // salary cap mode
    sq: state.sameTeamsChallenge ? state.draftHistory : undefined,   // mirror draft history
    cq: state.sameTeamsChallenge ? state.coachOptions.map(c => c.id) : undefined, // mirror coach pool
    dv: PLAYERS.length,                                  // dataset size (soft check)
    p: FILL_ORDER.map(pos => (roster[pos] ? roster[pos].id : 0)),
    c: state.coach ? state.coach.id : null,              // coach id
  };
  return b64urlEncode(JSON.stringify(payload));
}

// Full shareable URL carrying the challenge code in a ?c= param.
function buildShareURL(code) {
  return `${location.origin}${location.pathname}?c=${code}`;
}

// Accept either a raw code or a pasted share link, and return the code.
function extractCode(input) {
  const s = (input || '').trim();
  const m = s.match(/[?&#]c=([^&\s]+)/);
  return m ? m[1] : s;
}

// Decode a code back into { payload, roster, missing }.
function decodeTeam(code) {
  try {
    const payload = JSON.parse(b64urlDecode(code.trim()));
    if (!payload || !Array.isArray(payload.p) || payload.p.length !== 5) return null;
    const roster = {};
    let missing = 0;
    FILL_ORDER.forEach((pos, i) => {
      const pl = PLAYERS.find(p => p.id === payload.p[i]) || null;
      if (!pl) missing++;
      roster[pos] = pl;
    });
    const coach = payload.c ? (COACHES.find(c => c.id === payload.c) || null) : null;
    return { payload, roster, missing, coach };
  } catch (e) {
    return null;
  }
}

function refreshShareCode() {
  const name = document.getElementById('challengerName').value;
  const code = encodeTeam(state.roster, name);
  document.getElementById('shareLink').value = buildShareURL(code);
}

// kind: 'link' (full URL) or 'code' (raw code only)
function copyShare(kind) {
  const name = document.getElementById('challengerName').value;
  const code = encodeTeam(state.roster, name);
  const text = kind === 'link' ? buildShareURL(code) : code;
  navigator.clipboard?.writeText(text);
  const btn = document.getElementById(kind === 'link' ? 'copyLinkBtn' : 'copyCodeBtn');
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }
}

// Apply a decoded challenge to state (era + mode are locked to the opponent's).
function applyChallenge(dec) {
  state.challenge = { name: dec.payload.n || 'Challenger', roster: dec.roster, payload: dec.payload, coach: dec.coach };
  state.yearFrom = dec.payload.f;
  state.yearTo = dec.payload.t;
  state.selectedEras = Array.isArray(dec.payload.e) ? dec.payload.e : [];
  state.ballKnowledge = !!dec.payload.b;
  state.salaryCapMode = !!dec.payload.sc;
}

function loadChallenge() {
  const input = document.getElementById('challengeCode');
  const errEl = document.getElementById('challengeError');
  const dec = decodeTeam(extractCode(input.value));
  if (!dec) {
    if (errEl) errEl.textContent = 'That code/link is not valid — check for a typo.';
    return;
  }
  if (dec.missing > 0 || (dec.payload.dv && dec.payload.dv !== PLAYERS.length)) {
    if (errEl) errEl.textContent =
      'This code was made with a different player dataset — results may be off.';
  }
  applyChallenge(dec);
  renderSetup();
}

function clearChallenge() {
  state.challenge = null;
  renderSetup();
}

// ── Team archetype classifier ────────────────────────────────────────────────
function teamArchetype(ev, roster) {
  const slots = ['PG', 'SG', 'SF', 'PF', 'C'];
  const players = slots.map(p => roster[p]).filter(Boolean);
  if (!players.length) return { label: 'Empty Gym', desc: 'Nobody showed up to practice.' };

  const maxPER     = Math.max(...players.map(p => p.per));
  const avgPER     = players.reduce((s, p) => s + p.per, 0) / players.length;
  const sumSPG     = players.reduce((s, p) => s + p.stats.spg, 0);
  const sumBPG     = players.reduce((s, p) => s + p.stats.bpg, 0);
  const sumAPG     = players.reduce((s, p) => s + p.stats.apg, 0);
  const avgTS      = players.reduce((s, p) => s + p.ts, 0) / players.length;
  const superstars = players.filter(p => p.per >= 26).length;
  const allStars   = players.filter(p => p.per >= 21).length;
  const defenders  = players.filter(p => (p.stats.spg + p.stats.bpg) >= 2.0).length;
  const heavyBalls = players.filter(p => p.stats.ppg + 0.6 * p.stats.apg >= 24).length;

  const offS = ev.sub.offense.score;
  const defS = ev.sub.defense.score;
  const balS = ev.sub.balance.score;
  const rebS = ev.sub.rebounding.score;

  if (superstars >= 3 && avgPER >= 25)
    return { label: 'All-Time GOAT Five', desc: 'Three or more all-time legends — a historically dominant lineup that may never exist again.' };
  if (superstars >= 2 && ev.wins >= 60)
    return { label: 'Superteam', desc: 'Multiple bonafide stars gravitating toward rings. History has mixed feelings about this.' };
  if (heavyBalls >= 3 && superstars >= 1)
    return { label: 'Ball-Dominant All-Stars', desc: 'Elite on paper, chaotic in practice — who gets the rock in crunch time?' };
  if (allStars >= 4)
    return { label: 'Star-Studded Lineup', desc: 'Loaded top to bottom with All-Star caliber talent. Scary on paper.' };
  if (defS >= 82 && offS <= 42)
    return { label: 'Grit & Grind', desc: 'Wins the ugly ones. Your coach has a whiteboard full of coverages and zero interest in your feelings.' };
  if (defS >= 72 && (sumBPG + sumSPG) >= 8)
    return { label: 'Defensive Juggernaut', desc: 'Suffocating, physical, and deeply unpleasant to play against.' };
  if (offS >= 80 && avgTS >= 58)
    return { label: 'Pace & Space', desc: 'Spreading the floor and firing threes — the modern offensive nightmare.' };
  if (sumAPG >= 22 && offS >= 68)
    return { label: 'Ball Movement Clinic', desc: 'Unselfish, fluid, and devastating. Every possession ends with the right shot.' };
  if (defenders >= 3 && defS >= 65)
    return { label: 'Two-Way Grit Squad', desc: 'Tough on both ends. Nobody on this roster takes a possession off.' };
  if (rebS >= 78)
    return { label: 'Glass Eaters', desc: 'Every missed shot belongs to them. Second chances are a way of life.' };
  if (ev.wins >= 50 && balS >= 70)
    return { label: 'Well-Oiled Machine', desc: 'No weak links, no ego clashes. Just basketball the right way.' };
  if (maxPER >= 21 && allStars === 1)
    return { label: 'One Star & Four Soldiers', desc: 'One franchise player, four role players ready to run through a wall for him.' };
  if (allStars === 0 && balS >= 65)
    return { label: 'Glue Guy Collective', desc: 'No names, all game. Underrated, overachieving, perpetually disrespected.' };
  if (ev.wins <= 28)
    return { label: 'Process Believers', desc: 'Trust the process. Playoff odds: slim. Character-building: guaranteed.' };
  return { label: 'Solid Starting Five', desc: 'A dependable, no-frills lineup that can hang with anyone on a good night.' };
}

// ── Series narrative ──────────────────────────────────────────────────────────
function buildSeriesNarrative(evMine, evOpp, series, myName, oppName) {
  const archMine = teamArchetype(evMine, state.roster);
  const archOpp  = teamArchetype(evOpp, state.challenge.roster);
  const iWin     = series.winner === 'A';
  const winner   = iWin ? myName : oppName;
  const loser    = iWin ? oppName : myName;
  const evW      = iWin ? evMine : evOpp;
  const evL      = iWin ? evOpp : evMine;
  const wArch    = iWin ? archMine : archOpp;
  const lArch    = iWin ? archOpp : archMine;
  const pct      = Math.round(series.pSeriesWinner * 100);
  const [wGm, lGm] = series.likelyScore.split('-').map(Number);
  const totalGames = wGm + lGm;
  const gameWord   = ['four','five','six','seven'][totalGames - 4];

  const lines = [];

  // 1. Series opener
  if (pct >= 82) {
    lines.push(`${winner} handles this in ${totalGames === 4 ? 'a sweep' : gameWord} — the gap is too wide for ${loser} to paper over.`);
  } else if (pct >= 67) {
    lines.push(`${winner} takes the series in ${gameWord}, though ${loser} forces a couple of uncomfortable moments along the way.`);
  } else if (pct >= 56) {
    lines.push(`${winner} survives a hard-fought ${series.likelyScore} — a single bad quarter for ${loser} probably decides it.`);
  } else {
    lines.push(`Pick 'em. ${winner} escapes ${series.likelyScore} in what would be an all-timer — any game could go either way.`);
  }

  // 2. Key statistical matchup
  const offAdv = evMine.ortg - evOpp.ortg;
  const defAdv = evOpp.drtg - evMine.drtg;   // positive = my defense is better

  if (Math.abs(offAdv) >= Math.abs(defAdv)) {
    if (offAdv > 3)
      lines.push(`The difference is firepower: ${myName}'s offense (${evMine.ortg} ORtg) is significantly more efficient than ${oppName}'s (${evOpp.ortg}), and ${oppName}'s defense can't generate enough stops to keep pace.`);
    else if (offAdv < -3)
      lines.push(`${oppName}'s offense (${evOpp.ortg} ORtg) runs ahead of ${myName}'s (${evMine.ortg}) all series long — the pressure to score first and score often tips the balance.`);
    else
      lines.push(`Offensively they're well matched (${evMine.ortg} vs ${evOpp.ortg} ORtg), making individual execution in crunch time the real swing factor.`);
  } else {
    if (defAdv > 3)
      lines.push(`${myName}'s defense (${evMine.drtg} DRtg) is the X-factor — ${oppName} will get their buckets, but not at the volume needed to take a series.`);
    else if (defAdv < -3)
      lines.push(`${oppName}'s defense (${evOpp.drtg} DRtg) is a buzzsaw. ${myName}'s offense will grind for every point, every single night.`);
    else
      lines.push(`Both defenses are stout (${evMine.drtg} vs ${evOpp.drtg} DRtg) — this comes down to who makes the right play when the game is on the line.`);
  }

  // 3. Style clash
  if (wArch.label.includes('GOAT') || wArch.label === 'Superteam') {
    lines.push(`When ${winner} hits their ceiling, this isn't a contest — the sheer firepower of that roster leaves ${loser} scrambling for answers they don't have.`);
  } else if (lArch.label.includes('GOAT') || lArch.label === 'Superteam') {
    lines.push(`${loser} has the bigger names, but ${winner}'s system exploits the cracks that star-heavy rosters always leave open.`);
  } else if ((wArch.label.includes('Grit') || wArch.label.includes('Defensive')) && lArch.label.includes('Pace')) {
    lines.push(`${winner}'s grind-it-out identity is built to suffocate pace teams — expect brutally slow, physical basketball that the flashier squad despises.`);
  } else if (lArch.label.includes('Grit') && (wArch.label.includes('Pace') || wArch.label.includes('Ball'))) {
    lines.push(`${winner} plays at a tempo ${loser} was never built to match — the moment the pace gets pushed, the series is over.`);
  } else if (wArch.label === 'Glue Guy Collective' || wArch.label === 'Well-Oiled Machine') {
    lines.push(`${winner} wins on cohesion — no single player is the story, but every one of them shows up, and that togetherness compounds over a seven-game war.`);
  } else if (lArch.label === 'Glue Guy Collective') {
    lines.push(`${loser}'s overachieving group keeps this competitive longer than expected, but the talent gap proves insurmountable when it counts.`);
  }

  // 4. Coach matchup
  if (evMine.coach && evOpp.coach && evMine.coach.id !== evOpp.coach.id) {
    lines.push(`On the bench: ${evMine.coach.name} (${evMine.coach.style}) against ${evOpp.coach.name} (${evOpp.coach.style}). The in-series adjustments between Games 3 and 4 could swing the whole thing.`);
  } else if (evW.coach && !evL.coach) {
    lines.push(`The coaching advantage belongs firmly to ${winner} — ${evW.coach.name}'s experience showing in the adjustments when the other bench goes quiet.`);
  }

  return `<p class="series-narrative-p">${lines.join(' ')}</p>`;
}

// ── Head-to-head result ─────────────────────────────────────────────────────
function renderHeadToHead(evMine) {
  const evOpp = MODEL.evaluateTeam(state.challenge.roster, state.challenge.coach || null);
  const series = MODEL.simulateSeries(evMine, evOpp);   // A = mine, B = opponent

  const myName = 'You';
  const oppName = state.challenge.name;
  const iWin = series.winner === 'A';
  const winnerName = iWin ? myName : oppName;
  const seriesPct = Math.round(series.pSeriesWinner * 100);
  const myGamePct = Math.round(series.pGameA * 100);
  const myBarPct = Math.round(series.pSeriesA * 100);

  const teamColumn = (ev, label, isMe, roster) => {
    const gc = MODEL.gradeColor(ev.grade);
    const arch = teamArchetype(ev, roster);
    const net = ev.netRtg >= 0 ? '+' + ev.netRtg : ev.netRtg;

    const subGrades = [
      ['OFF', ev.sub.offense],
      ['DEF', ev.sub.defense],
      ['PLAY', ev.sub.playmaking],
      ['STAR', ev.sub.starPower],
    ].map(([lbl, s]) =>
      `<span class="h2h-sg" style="color:${MODEL.gradeColor(s.grade)}">${lbl} ${s.grade}</span>`
    ).join('');

    const playerRows = ev.contributions.map(c => `
      <div class="h2h-player">
        <span class="h2h-pos">${c.pos}</span>
        <span class="h2h-name-block">
          <span class="h2h-name">${c.player ? c.player.name : '—'}</span>
          ${c.player ? `<span class="h2h-stats">${c.player.stats.ppg}p &middot; ${c.player.per.toFixed(1)} PER</span>` : ''}
        </span>
        <span class="h2h-ws">${c.ws} WS</span>
      </div>`).join('');

    return `
      <div class="h2h-team ${isMe ? 'me' : 'opp'}">
        <div class="h2h-team-head">
          <div class="h2h-team-name">${label}</div>
          <div class="h2h-grade" style="color:${gc}">${ev.grade}</div>
        </div>
        <div class="h2h-record">${ev.wins}–${ev.losses}</div>
        ${ev.coach ? `<div class="h2h-coach">${ev.coach.name} · <em>${ev.coach.style}</em>${ev.familiarPositions.length > 0 ? ` · ★ ${ev.familiarPositions.join(', ')}` : ''}</div>` : ''}
        <div class="h2h-archetype">${arch.label}</div>
        <div class="h2h-archetype-desc">${arch.desc}</div>
        <div class="h2h-ratings">
          <span class="h2h-pill">OFF ${ev.ortg}</span>
          <span class="h2h-pill">DEF ${ev.drtg}</span>
          <span class="h2h-pill net">NET ${net}</span>
        </div>
        <div class="h2h-subgrades">${subGrades}</div>
        <div class="h2h-roster">${playerRows}</div>
      </div>`;
  };

  document.getElementById('app').innerHTML = `
    <div class="result-screen h2h-screen">
      <div class="h2h-banner ${iWin ? 'win' : 'lose'}">
        <div class="h2h-verdict">${winnerName} win${winnerName === 'You' ? '' : 's'} the series</div>
        <div class="h2h-series">${seriesPct}% · most likely <strong>${series.likelyScore}</strong></div>
        <div class="h2h-bar">
          <div class="h2h-bar-fill" style="width:${myBarPct}%"></div>
          <span class="h2h-bar-label left">You ${myBarPct}%</span>
          <span class="h2h-bar-label right">${oppName} ${100 - myBarPct}%</span>
        </div>
        <div class="h2h-detail">Single game: you win ${myGamePct}% · expected margin ${series.marginA >= 0 ? '+' : ''}${series.marginA} per game</div>
      </div>

      <div class="series-narrative">
        ${buildSeriesNarrative(evMine, evOpp, series, myName, oppName)}
      </div>

      <div class="h2h-grid">
        ${teamColumn(evMine, myName, true, state.roster)}
        <div class="h2h-vs">VS</div>
        ${teamColumn(evOpp, oppName, false, state.challenge.roster)}
      </div>

      <div class="result-actions">
        <button class="btn-primary" onclick="startGame()">Rematch (same era)</button>
        <button class="btn-ghost" onclick="clearChallenge()">New Game</button>
        <button class="btn-ghost" id="copyImgBtn" onclick="copyResultImage()">📸 Share</button>
      </div>
    </div>
  `;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
