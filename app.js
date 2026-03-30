const GIST_URL = "https://gist.githubusercontent.com/sillybillyshow/ae68c331d964ff293623a01ca1766256/raw/tiktok_stats.json";
const FOLLOWER_CACHE_KEY = "sbs-followers-cache";
const ROW_HEIGHT = 44;
const BUFFER = 10;

let populationData = [];
let followers = 0;
let searchableLocations = [];
let focusedKey = null;
let hasLoaded = false;
let flatList = [];
let followerIndex = 0;

// DOM refs
const countdownEl    = document.getElementById("countdown");
const barEl          = document.getElementById("bar");
const searchInput    = document.getElementById("location-search");
const searchButton   = document.getElementById("search-button");
const resetButton    = document.getElementById("reset-button");
const searchResults  = document.getElementById("search-results");
const panelLastName  = document.getElementById("panel-last-name");
const panelLastPop   = document.getElementById("panel-last-pop");
const panelFollowers = document.getElementById("panel-followers");
const panelNextName  = document.getElementById("panel-next-name");
const panelNextPop   = document.getElementById("panel-next-pop");
const scroller       = document.getElementById("table-body");
const spacer         = document.getElementById("table-spacer");

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadData() {
  const res = await fetch("populationdata.json");
  populationData = await res.json();
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
    buildFlatList();
    renderPanels();
    drawRows();
    scrollToFollower("auto");
  }

  await fetchFollowers();
  startClock();
}

// ── Cache ─────────────────────────────────────────────────────────────────────

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

// ── Followers ─────────────────────────────────────────────────────────────────

async function fetchFollowers() {
  try {
    const res = await fetch(`${GIST_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const v = Number(data.followers);
    if (!Number.isFinite(v)) throw new Error("bad value");
    if (v !== followers || !hasLoaded) {
      const wasLoaded = hasLoaded;
      followers = v;
      hasLoaded = true;
      writeCache(v);
      buildFlatList();
      renderPanels();
      drawRows(); // unconditional full redraw
      if (!wasLoaded) scrollToFollower("auto");
    }
  } catch (e) {
    console.error("Follower fetch failed", e);
  }
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function msUntilNextFetch() {
  const now = new Date();
  const s = now.getUTCSeconds();
  const ms = now.getUTCMilliseconds();
  const secondsUntil = s < 10 ? (10 - s) : (70 - s);
  return secondsUntil * 1000 - ms;
}

function startClock() {
  setInterval(() => {
    const now = new Date();
    const s = now.getUTCSeconds();
    const ms = now.getUTCMilliseconds();
    const secondsUntil = s < 10 ? (10 - s) : (70 - s);
    const totalMs = secondsUntil * 1000 - ms;
    barEl.style.width = `${Math.max(0, Math.min(1, 1 - totalMs / 60000)) * 100}%`;
    countdownEl.textContent = `Next update in ${Math.ceil(totalMs / 1000)}s`;
  }, 250);

  function scheduleFetch() {
    setTimeout(async () => {
      await fetchFollowers();
      scheduleFetch();
    }, msUntilNextFetch());
  }
  scheduleFetch();
}

// ── Flat list builder ─────────────────────────────────────────────────────────

function buildFlatList() {
  const insertAt = findRank(followers);
  flatList = [];

  const above = populationData.slice(insertAt).reverse();
  above.forEach((city, i) => {
    flatList.push({ type: 'city', city, rank: i + 1 });
  });

  followerIndex = flatList.length;
  flatList.push({ type: 'follower', rank: above.length + 1 });

  const below = populationData.slice(0, insertAt).reverse();
  below.forEach((city, i) => {
    flatList.push({ type: 'city', city, rank: above.length + 2 + i });
  });

  spacer.style.height = `${flatList.length * ROW_HEIGHT}px`;
}

// ── Virtual scroll renderer ───────────────────────────────────────────────────

// Called on scroll — skips redraw if visible range hasn't changed
let lastStart = -1;
let lastEnd = -1;

function renderVirtualTable() {
  const { start, end } = getVisibleRange();
  if (start === lastStart && end === lastEnd) return;
  lastStart = start;
  lastEnd = end;
  paintRows(start, end);
}

// Called when data changes — always redraws regardless of scroll position
function drawRows() {
  const { start, end } = getVisibleRange();
  lastStart = start;
  lastEnd = end;
  paintRows(start, end);
}

function getVisibleRange() {
  const scrollTop = scroller.scrollTop;
  const viewportH = scroller.clientHeight;
  const visibleStart = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleEnd   = Math.ceil((scrollTop + viewportH) / ROW_HEIGHT);
  return {
    start: Math.max(0, visibleStart - BUFFER),
    end:   Math.min(flatList.length - 1, visibleEnd + BUFFER),
  };
}

function paintRows(start, end) {
  // Remove only existing row elements, leave spacer intact
  const existing = scroller.querySelectorAll(".row");
  existing.forEach(el => el.remove());

  const fragment = document.createDocumentFragment();
  for (let i = start; i <= end; i++) {
    fragment.appendChild(makeRow(i, flatList[i]));
  }
  scroller.appendChild(fragment);
}

function makeRow(index, entry) {
  const el = document.createElement("div");
  el.className = "row";
  el.style.transform = `translateY(${index * ROW_HEIGHT}px)`;

  if (entry.type === 'follower') {
    el.classList.add("row--follower");
    el.id = "follower-row";
    el.innerHTML = `
      <span class="row-rank">${entry.rank}</span>
      <span class="row-name">Silly Billy Show</span>
      <span class="row-value">${fmt(followers)}</span>
    `;
  } else {
    const key = cityKey(entry.city);
    el.dataset.key = key;
    if (focusedKey === key) el.classList.add("row--focused");
    el.innerHTML = `
      <span class="row-rank">${entry.rank}</span>
      <span class="row-name">${key}</span>
      <span class="row-value">${fmt(entry.city.population)}</span>
    `;
  }

  return el;
}

// ── Scroll helpers ────────────────────────────────────────────────────────────

function scrollToFollower(behavior = "smooth") {
  const targetScrollTop = followerIndex * ROW_HEIGHT - scroller.clientHeight / 2 + ROW_HEIGHT / 2;
  scroller.scrollTo({ top: Math.max(0, targetScrollTop), behavior });
  requestAnimationFrame(renderVirtualTable);
}

function scrollToKey(key) {
  const idx = flatList.findIndex(e => e.type === 'city' && cityKey(e.city) === key);
  if (idx === -1) return;
  const targetScrollTop = idx * ROW_HEIGHT - scroller.clientHeight / 2 + ROW_HEIGHT / 2;
  scroller.scrollTo({ top: Math.max(0, targetScrollTop), behavior: "smooth" });
  requestAnimationFrame(renderVirtualTable);
}

// ── Panels ────────────────────────────────────────────────────────────────────

function renderPanels() {
  const insertAt = findRank(followers);
  const prev = populationData[insertAt - 1] || null;
  const next = populationData[insertAt] || null;

  panelLastName.textContent  = prev ? cityKey(prev) : "None yet";
  panelLastPop.textContent   = prev ? fmt(prev.population) : "—";
  panelFollowers.textContent = fmt(followers);
  panelNextName.textContent  = next ? cityKey(next) : "Top of the list!";
  panelNextPop.textContent   = next ? fmt(next.population) : "—";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Search ────────────────────────────────────────────────────────────────────

function setupSearch() {
  scroller.addEventListener("scroll", () => requestAnimationFrame(renderVirtualTable), { passive: true });

  searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); doSearch(); }
    if (e.key === "Escape") clearResults();
  });
  searchButton.addEventListener("click", doSearch);
  resetButton.addEventListener("click", () => {
    focusedKey = null;
    searchInput.value = "";
    clearResults();
    scrollToFollower("smooth");
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
      drawRows();
      scrollToKey(entry.key);
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
