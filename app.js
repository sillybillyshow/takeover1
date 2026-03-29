const GIST_URL = "https://gist.githubusercontent.com/sillybillyshow/ae68c331d964ff293623a01ca1766256/raw/tiktok_stats.json";
const FOLLOWER_CACHE_KEY = "sbs-followers-cache";

let populationData = [];
let followers = 0;
let searchableLocations = [];
let focusedKey = null;
let hasLoaded = false;
let timerInterval = null;

// DOM refs
const countdownEl = document.getElementById("countdown");
const barEl = document.getElementById("bar");
const searchInput = document.getElementById("location-search");
const searchButton = document.getElementById("search-button");
const resetButton = document.getElementById("reset-button");
const searchResults = document.getElementById("search-results");
const panelLastName = document.getElementById("panel-last-name");
const panelLastPop = document.getElementById("panel-last-pop");
const panelFollowers = document.getElementById("panel-followers");
const panelNextName = document.getElementById("panel-next-name");
const panelNextPop = document.getElementById("panel-next-pop");
const tableBody = document.getElementById("table-body");

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadData() {
  const [popRes] = await Promise.all([fetch("populationdata.json")]);
  populationData = await popRes.json();
  populationData.sort((a, b) => a.population - b.population);

  searchableLocations = populationData
    .slice()
    .reverse()
    .map(city => ({ city, key: cityKey(city), keyLower: cityKey(city).toLowerCase() }));

  setupSearch();

  const cached = readCache();
  if (cached !== null) {
    followers = cached;
    hasLoaded = true;
    render();
  }

  await fetchFollowers();
  startClock();
}

// ── Followers ─────────────────────────────────────────────────────────────────

function readCache() {
  try {
    const raw = localStorage.getItem(FOLLOWER_CACHE_KEY);
    if (!raw) return null;
    const v = Number(JSON.parse(raw).followers);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

function writeCache(v) {
  try {
    localStorage.setItem(FOLLOWER_CACHE_KEY, JSON.stringify({ followers: v }));
  } catch {}
}

async function fetchFollowers() {
  try {
    const res = await fetch(GIST_URL);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const v = Number(data.followers);
    if (!Number.isFinite(v)) throw new Error("bad value");
    if (v !== followers || !hasLoaded) {
      followers = v;
      writeCache(v);
      hasLoaded = true;
      render();
    }
  } catch (e) {
    console.error("Follower fetch failed", e);
  }
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function msUntilNextFetch() {
  // Fire at each minute + 10s (i.e. when clock shows :10)
  const now = new Date();
  const s = now.getUTCSeconds();
  const ms = now.getUTCMilliseconds();
  const secondsUntil = s < 10 ? (10 - s) : (70 - s);
  return secondsUntil * 1000 - ms;
}

function startClock() {
  // Countdown bar: counts 0→60 aligned to wall clock seconds
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const now = new Date();
    const s = now.getUTCSeconds();
    const ms = now.getUTCMilliseconds();
    // Time until next :10 mark
    const secondsUntil = s < 10 ? (10 - s) : (70 - s);
    const totalMs = secondsUntil * 1000 - ms;
    const pct = 1 - totalMs / 60000;
    barEl.style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`;
    countdownEl.textContent = `Next update in ${Math.ceil(totalMs / 1000)}s`;
  }, 250);

  // Schedule fetches at :10 past each minute
  function scheduleFetch() {
    setTimeout(async () => {
      await fetchFollowers();
      scheduleFetch();
    }, msUntilNextFetch());
  }
  scheduleFetch();
}

// ── Render ────────────────────────────────────────────────────────────────────

function cityKey(city) { return `${city.city}, ${city.country}`; }
function fmt(n) { return Number(n).toLocaleString(); }

function findRank(value) {
  let lo = 0, hi = populationData.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    populationData[mid].population < value ? lo = mid + 1 : hi = mid - 1;
  }
  return lo;
}

function render() {
  if (!hasLoaded) return;
  const index = findRank(followers);
  const prev = populationData[index - 1] || null;
  const next = populationData[index] || null;
  const rank = index + 1;

  // Summary panels
  panelLastName.textContent = prev ? cityKey(prev) : "None yet";
  panelLastPop.textContent  = prev ? fmt(prev.population) : "—";
  panelFollowers.textContent = fmt(followers);
  panelNextName.textContent = next ? cityKey(next) : "Top of the list!";
  panelNextPop.textContent  = next ? fmt(next.population) : "—";

  renderTable(index, rank);
}

function renderTable(index, followerRank) {
  const focusIdx = focusedKey
    ? populationData.findIndex(c => cityKey(c) === focusedKey)
    : -1;

  tableBody.innerHTML = "";
  const fragment = document.createDocumentFragment();

  // Build rows: cities above (higher pop), follower row, cities below (lower pop)
  const above = populationData.slice(index).reverse(); // higher pop, closest first
  const below = populationData.slice(0, index).reverse(); // lower pop, closest first

  above.forEach((city, i) => {
    fragment.appendChild(makeRow(i + 1, cityKey(city), fmt(city.population), false, focusIdx === populationData.indexOf(city)));
  });

  const followerRow = makeRow(followerRank, "Silly Billy Show", fmt(followers), true, focusedKey === null);
  followerRow.id = "follower-row";
  fragment.appendChild(followerRow);

  below.forEach((city, i) => {
    const globalIdx = index - 1 - i;
    fragment.appendChild(makeRow(followerRank + i + 1, cityKey(city), fmt(city.population), false, focusIdx === globalIdx));
  });

  tableBody.appendChild(fragment);

  // Scroll to focused element
  const target = focusedKey
    ? tableBody.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`)
    : document.getElementById("follower-row");

  if (target) {
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
}

function makeRow(rank, name, value, isFollower, isFocused) {
  const row = document.createElement("div");
  row.className = "row" + (isFollower ? " row--follower" : "") + (isFocused && !isFollower ? " row--focused" : "");
  if (!isFollower) row.dataset.key = name;

  row.innerHTML = `
    <span class="row-rank">${rank}</span>
    <span class="row-name">${name}</span>
    <span class="row-value">${value}</span>
  `;
  return row;
}

// ── Search ────────────────────────────────────────────────────────────────────

function setupSearch() {
  searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); doSearch(); }
    if (e.key === "Escape") clearResults();
  });
  searchButton.addEventListener("click", doSearch);
  resetButton.addEventListener("click", () => {
    focusedKey = null;
    searchInput.value = "";
    clearResults();
    render();
  });
  document.addEventListener("click", e => {
    if (!e.target.closest(".search-panel")) clearResults();
  });
}

function doSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { clearResults(); return; }
  const matches = searchableLocations.filter(e => e.keyLower.includes(q)).slice(0, 8);
  renderResults(matches);
}

function renderResults(matches) {
  searchResults.innerHTML = "";
  if (!matches.length) { searchResults.hidden = true; return; }
  matches.forEach(entry => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-result";
    btn.textContent = entry.key;
    btn.addEventListener("click", () => {
      focusedKey = entry.key;
      searchInput.value = entry.key;
      clearResults();
      render();
    });
    searchResults.appendChild(btn);
  });
  searchResults.hidden = false;
}

function clearResults() {
  searchResults.innerHTML = "";
  searchResults.hidden = true;
}

loadData();
