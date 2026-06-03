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
  sortBy: 'ppg',
  searchQuery: '',
  usedTeams: [],
  ballKnowledge: false,   // hide all stats during the draft, reveal at the end
  selectedEras: [],       // multi-select era tags driving yearFrom/yearTo
  challenge: null,        // an opponent team loaded from a challenge code
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
        <div class="challenge-banner-sub">Era locked to ${state.yearFrom}–${state.yearTo}${state.ballKnowledge ? ' · 🧠 Ball Knowledge ON' : ''} · draft your five, then face their team in a 7-game series.</div>
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
              ${state.ballKnowledge ? '' : `
              <select class="sort-select" onchange="setSort(this.value)">
                <option value="ppg" ${state.sortBy==='ppg'?'selected':''}>PPG</option>
                <option value="rpg" ${state.sortBy==='rpg'?'selected':''}>RPG</option>
                <option value="apg" ${state.sortBy==='apg'?'selected':''}>APG</option>
                <option value="per" ${state.sortBy==='per'?'selected':''}>PER</option>
              </select>`}
            </div>
            <div class="players-count" id="playersCount"></div>
            ${state.ballKnowledge ? '<div class="drag-hint bk-hint">🧠 Ball Knowledge Mode — stats revealed at the end. Trust your gut.</div>' : '<div class="drag-hint">Drag a player to a matching position slot →</div>'}
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
    if (getPlayersForTeam(t.id, e.from, e.to).length > 0) combos.push({ team: t, era: e });
  }));
  if (!combos.length) { endGame(); return; }

  const chosen = combos[Math.floor(Math.random() * combos.length)];

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
  }, 80);
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
    const freshTeams = TEAMS.filter(t =>
      !state.usedTeams.includes(t.id) &&
      t.id !== state.currentTeam.id &&
      getPlayersForTeam(t.id, state.currentEra.from, state.currentEra.to).length > 0
    );
    if (!freshTeams.length) { state.spinning = false; updateRerollButtons(); return; }
    newTeam = freshTeams[Math.floor(Math.random() * freshTeams.length)];
    state.usedTeams.push(newTeam.id);
  } else {
    state.rerollEra--;
    const freshEras = eras.filter(e =>
      e.key !== state.currentEra.key &&
      getPlayersForTeam(state.currentTeam.id, e.from, e.to).length > 0
    );
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
  }, 80);
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
    filtered.sort((a, b) => {
      if (state.sortBy === 'per') return b.per - a.per;
      return b.stats[state.sortBy] - a.stats[state.sortBy];
    });
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
          <div class="player-meta"><span class="player-pos">${posLabel}</span> · ${p.peak_years[0]}–${p.peak_years[1]}</div>
          <div class="player-pips">${pips}</div>
        </div>
        ${state.ballKnowledge ? `
        <div class="player-stats hidden-stats">
          <div class="stat-hidden">🧠</div>
        </div>` : `
        <div class="player-stats">
          <div class="stat"><span>${p.stats.ppg.toFixed(1)}</span><small>PPG</small></div>
          <div class="stat"><span>${p.stats.rpg.toFixed(1)}</span><small>RPG</small></div>
          <div class="stat"><span>${p.stats.apg.toFixed(1)}</span><small>APG</small></div>
          <div class="stat"><span>${p.stats.spg.toFixed(1)}</span><small>SPG</small></div>
          <div class="stat"><span>${p.stats.bpg.toFixed(1)}</span><small>BPG</small></div>
        </div>`}
      </div>
    `;
  }).join('');
}

function getOpenPositions() {
  return FILL_ORDER.filter(pos => !state.roster[pos]);
}

function playerCanFill(player) {
  return getOpenPositions().some(pos => player.positions.includes(pos));
}

// Click (no drag) → drop the player into their first eligible OPEN position,
// preferring the order they're listed in (their "natural" position first).
function quickPlace(playerId) {
  const player = PLAYERS.find(p => p.id === playerId);
  if (!player) return;

  const target = player.positions.find(pos => !state.roster[pos]);
  if (!target) return;   // none of their positions are open — ignore the click

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

  const allFilled = FILL_ORDER.every(pos => state.roster[pos]);
  if (allFilled || state.round >= state.totalRounds) {
    setTimeout(endGame, 500);
    return;
  }

  state.round++;
  state.posFilter = 'All';
  state.searchQuery = '';
  state.rerollTeam = 1;
  state.rerollEra = 1;
  renderDraftScreen();
  spinWheel();
}

// ── Result Screen (model-driven) ────────────────────────────────────────────
function endGame() {
  state.phase = 'result';
  const ev = MODEL.evaluateTeam(state.roster);

  // If an opponent code was loaded, show the head-to-head series instead.
  if (state.challenge) { renderHeadToHead(ev); return; }

  const gradeColor = MODEL.gradeColor(ev.grade);
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
    return `
      <div class="result-player">
        <div class="result-pos">${c.pos}</div>
        <div class="result-player-info">
          ${p
            ? `<div class="result-player-name">${p.name}</div>
               <div class="result-player-stats">${p.stats.ppg} PPG · ${p.stats.rpg} RPG · ${p.stats.apg} APG · ${p.ts}% TS</div>`
            : `<div class="result-player-name empty">— Empty —</div>`}
        </div>
        <div class="result-ws" title="Estimated Win Shares">
          <span>${c.ws}</span><small>WS</small>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('app').innerHTML = `
    <div class="result-screen">
      <div class="result-hero">
        <div class="hero-left">
          <h1>Your Team</h1>
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
        <div class="result-roster">${rosterHtml}</div>
      </div>

      <div class="result-col share-block">
        <div class="col-title">⚔️ Challenge a Friend</div>
        <p class="share-sub">Send this link. They draft in the same era (${state.yearFrom}–${state.yearTo})${state.ballKnowledge ? ' with Ball Knowledge mode on' : ''}, then we sim a 7-game series between your teams.</p>
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
      </div>
    </div>
  `;
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
    dv: PLAYERS.length,                                  // dataset size (soft check)
    p: FILL_ORDER.map(pos => (roster[pos] ? roster[pos].id : 0)),
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
    return { payload, roster, missing };
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
  state.challenge = { name: dec.payload.n || 'Challenger', roster: dec.roster, payload: dec.payload };
  state.yearFrom = dec.payload.f;
  state.yearTo = dec.payload.t;
  state.selectedEras = Array.isArray(dec.payload.e) ? dec.payload.e : [];
  state.ballKnowledge = !!dec.payload.b;
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

// ── Head-to-head result ─────────────────────────────────────────────────────
function renderHeadToHead(evMine) {
  const evOpp = MODEL.evaluateTeam(state.challenge.roster);
  const series = MODEL.simulateSeries(evMine, evOpp);   // A = mine, B = opponent

  const myName = 'You';
  const oppName = state.challenge.name;
  const iWin = series.winner === 'A';
  const winnerName = iWin ? myName : oppName;
  const seriesPct = Math.round(series.pSeriesWinner * 100);
  const myGamePct = Math.round(series.pGameA * 100);
  const myBarPct = Math.round(series.pSeriesA * 100);

  const teamColumn = (ev, label, isMe) => {
    const gc = MODEL.gradeColor(ev.grade);
    const roster = ev.contributions.map(c => `
      <div class="h2h-player">
        <span class="h2h-pos">${c.pos}</span>
        <span class="h2h-name">${c.player ? c.player.name : '—'}</span>
        <span class="h2h-ws">${c.ws}</span>
      </div>`).join('');
    return `
      <div class="h2h-team ${isMe ? 'me' : 'opp'}">
        <div class="h2h-team-head">
          <div class="h2h-team-name">${label}</div>
          <div class="h2h-grade" style="color:${gc}">${ev.grade}</div>
        </div>
        <div class="h2h-record">${ev.wins}-${ev.losses} · Net ${ev.netRtg >= 0 ? '+' : ''}${ev.netRtg}</div>
        <div class="h2h-roster">${roster}</div>
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

      <div class="h2h-grid">
        ${teamColumn(evMine, myName, true)}
        <div class="h2h-vs">VS</div>
        ${teamColumn(evOpp, oppName, false)}
      </div>

      <div class="result-actions">
        <button class="btn-primary" onclick="startGame()">Rematch (same era)</button>
        <button class="btn-ghost" onclick="clearChallenge()">New Game</button>
      </div>
    </div>
  `;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
