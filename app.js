// The raw URL for the public GitHub Gist that the Cloudflare Worker writes the follower count to
const GIST_URL = "https://gist.githubusercontent.com/sillybillyshow/ae68c331d964ff293623a01ca1766256/raw/tiktok_stats.json";

// The localStorage key used to persist the last known follower count across page loads
const FOLLOWER_CACHE_KEY = "sbs-followers-cache";

// The fixed pixel height of each row in the virtual scroll table — must match --row-height in CSS
const ROW_HEIGHT = 44;

// The number of rows to render above and below the visible viewport as a scroll buffer
const BUFFER = 10;

// ── State ─────────────────────────────────────────────────────────────────────

let populationData   = [];
let followers        = 0;
let searchableLocations = [];
let focusedKey       = null;
let hasLoaded        = false;
let flatList         = [];
let followerIndex    = 0;

// Handle returned by initGlobe — exposes update(followers) and destroy()
let globeHandle = null;

// ── DOM references ────────────────────────────────────────────────────────────

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
const globeContainer = document.getElementById("globe-container");

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadData() {
  // Fetch and sort the population dataset ascending so binary search works correctly
  const res = await fetch("populationdata.json");
  populationData = await res.json();
  populationData.sort((a, b) => a.population - b.population);

  // Build the search index once — reversed so largest cities appear first in results,
  // keys pre-lowercased to avoid doing it on every keystroke
  searchableLocations = populationData
    .slice()
    .reverse()
    .map(city => ({ city, key: cityKey(city), keyLower: cityKey(city).toLowerCase() }));

  setupSearch();

  // Initialise the globe — must be awaited because it fetches the map texture
  if (globeContainer) {
    try {
      const { initGlobe } = await import('./globe.js');
      globeHandle = await initGlobe(globeContainer, populationData);
    } catch (e) {
      console.error("Globe failed to initialise", e);
    }
  }

  // Render immediately from cache if available so the page isn't blank on return visits
  const cached = readCache();
  if (cached !== null) {
    followers = cached;
    hasLoaded = true;
    buildFlatList();
    renderPanels();
    drawRows();
    scrollToFollower("auto");
    // Feed the cached count to the globe so it starts in the correct colour state
    if (globeHandle) globeHandle.update(followers);
  }

  // Fetch the live count then start the polling clock
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
    // Cache-bust with a timestamp so GitHub's CDN always returns the latest value
    const res = await fetch(`${GIST_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const v = Number(data.followers);
    if (!Number.isFinite(v)) throw new Error("bad value");

    if (v !== followers || !hasLoaded) {
      const wasLoaded = hasLoaded;
      followers  = v;
      hasLoaded  = true;
      writeCache(v);
      buildFlatList();
      renderPanels();
      drawRows();
      // Notify the globe so it recolours dots to match the new count
      if (globeHandle) globeHandle.update(followers);
      if (!wasLoaded) scrollToFollower("auto");
    }
  } catch (e) {
    console.error("Follower fetch failed", e);
  }
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function msUntilNextFetch() {
  // Fire at each :00 and :30 boundary — gives the Worker's :00 write time to propagate
  const now = new Date();
  const s   = now.getUTCSeconds();
  const ms  = now.getUTCMilliseconds();
  const secondsUntil = s < 30 ? (30 - s) : (60 - s);
  return secondsUntil * 1000 - ms;
}

function startClock() {
  // Update the countdown label and bar four times per second for smooth animation
  setInterval(() => {
    const now  = new Date();
    const s    = now.getUTCSeconds();
    const ms   = now.getUTCMilliseconds();
    const sUntil = s < 30 ? (30 - s) : (60 - s);
    const totalMs = sUntil * 1000 - ms;
    barEl.style.width = `${Math.max(0, Math.min(1, 1 - totalMs / 30000)) * 100}%`;
    countdownEl.textContent = `Next update in ${Math.ceil(totalMs / 1000)}s`;
  }, 250);

  // Schedule fetches precisely at the next wall-clock :00 or :30, then reschedule
  // so timing never drifts regardless of how long each fetch takes
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

  // Cities with population >= followers go above — reversed so the nearest is first
  const above = populationData.slice(insertAt).reverse();
  above.forEach((city, i) => flatList.push({ type: 'city', city, rank: i + 1 }));

  // Record the follower row index before pushing it
  followerIndex = flatList.length;
  flatList.push({ type: 'follower', rank: above.length + 1 });

  // Cities with population < followers go below — reversed so the nearest is first
  const below = populationData.slice(0, insertAt).reverse();
  below.forEach((city, i) => flatList.push({ type: 'city', city, rank: above.length + 2 + i }));

  // Spacer height = total rows × row height — gives the scrollbar correct proportions
  // without rendering all 48k rows as DOM elements
  spacer.style.height = `${flatList.length * ROW_HEIGHT}px`;
}

// ── Virtual scroll renderer ───────────────────────────────────────────────────

let lastStart = -1;
let lastEnd   = -1;

// Called on scroll — skips work if the visible range hasn't changed
function renderVirtualTable() {
  const { start, end } = visibleRange();
  if (start === lastStart && end === lastEnd) return;
  lastStart = start;
  lastEnd   = end;
  paintRows(start, end);
}

// Called when data changes — always repaints even if scroll position is unchanged
function drawRows() {
  const { start, end } = visibleRange();
  lastStart = start;
  lastEnd   = end;
  paintRows(start, end);
}

function visibleRange() {
  const top    = scroller.scrollTop;
  const height = scroller.clientHeight;
  return {
    start: Math.max(0,                  Math.floor(top / ROW_HEIGHT)              - BUFFER),
    end:   Math.min(flatList.length - 1, Math.ceil((top + height) / ROW_HEIGHT)   + BUFFER),
  };
}

function paintRows(start, end) {
  // Remove existing row elements but leave the spacer in place
  scroller.querySelectorAll(".row").forEach(el => el.remove());
  const frag = document.createDocumentFragment();
  for (let i = start; i <= end; i++) frag.appendChild(makeRow(i, flatList[i]));
  scroller.appendChild(frag);
}

function makeRow(index, entry) {
  const el = document.createElement("div");
  el.className = "row";
  // Absolute positioning via transform — keeps all rows in the same stacking context
  el.style.transform = `translateY(${index * ROW_HEIGHT}px)`;

  if (entry.type === 'follower') {
    el.classList.add("row--follower");
    el.id = "follower-row";
    el.innerHTML = `
      <span class="row-rank">${entry.rank}</span>
      <span class="row-name">Silly Billy Show</span>
      <span class="row-value">${fmt(followers)}</span>`;
  } else {
    const key = cityKey(entry.city);
    el.dataset.key = key;
    if (focusedKey === key) el.classList.add("row--focused");
    el.innerHTML = `
      <span class="row-rank">${entry.rank}</span>
      <span class="row-name">${key}</span>
      <span class="row-value">${fmt(entry.city.population)}</span>`;
  }
  return el;
}

// ── Scroll helpers ────────────────────────────────────────────────────────────

function scrollToFollower(behavior = "smooth") {
  const top = followerIndex * ROW_HEIGHT - scroller.clientHeight / 2 + ROW_HEIGHT / 2;
  scroller.scrollTo({ top: Math.max(0, top), behavior });
  requestAnimationFrame(renderVirtualTable);
}

function scrollToKey(key) {
  const idx = flatList.findIndex(e => e.type === 'city' && cityKey(e.city) === key);
  if (idx === -1) return;
  const top = idx * ROW_HEIGHT - scroller.clientHeight / 2 + ROW_HEIGHT / 2;
  scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  requestAnimationFrame(renderVirtualTable);
}

// ── Panels ────────────────────────────────────────────────────────────────────

function renderPanels() {
  const insertAt = findRank(followers);
  const prev = populationData[insertAt - 1] || null;
  const next = populationData[insertAt]     || null;

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
  // Binary search: returns the number of cities with population < value
  let lo = 0, hi = populationData.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    populationData[mid].population < value ? lo = mid + 1 : hi = mid - 1;
  }
  return lo;
}

// ── Search ────────────────────────────────────────────────────────────────────

function setupSearch() {
  // Re-render only the visible rows on scroll, throttled to animation frames
  scroller.addEventListener("scroll", () => requestAnimationFrame(renderVirtualTable), { passive: true });

  searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter")  { e.preventDefault(); doSearch(); }
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
  renderResults(searchableLocations.filter(e => e.keyLower.includes(q)).slice(0, 8));
}

function renderResults(matches) {
  searchResults.innerHTML = "";
  if (!matches.length) { searchResults.hidden = true; return; }
  matches.forEach(entry => {
    const btn = document.createElement("button");
    btn.type      = "button";
    btn.className = "search-result";
    btn.textContent = entry.key;
    btn.addEventListener("click", () => {
      focusedKey = entry.key;
      searchInput.value = entry.key;
      clearResults();
      drawRows();          // apply focus highlight before scroll
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
