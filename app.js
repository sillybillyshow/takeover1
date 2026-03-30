// The raw URL for the public GitHub Gist that the Cloudflare Worker writes the follower count to
const GIST_URL = "https://gist.githubusercontent.com/sillybillyshow/ae68c331d964ff293623a01ca1766256/raw/tiktok_stats.json";

// The localStorage key used to persist the last known follower count across page loads
const FOLLOWER_CACHE_KEY = "sbs-followers-cache";

// The fixed pixel height of each row in the virtual scroll table — must match the CSS --row-height variable
const ROW_HEIGHT = 44;

// The number of rows to render above and below the visible viewport as a scroll buffer
const BUFFER = 10;

// ── State ─────────────────────────────────────────────────────────────────────

// The full sorted array of city/population objects loaded from populationdata.json
let populationData = [];

// The current TikTok follower count
let followers = 0;

// A pre-processed array of city entries with lowercase keys for efficient search filtering
let searchableLocations = [];

// The city key the user has navigated to via search, or null if showing the follower row
let focusedKey = null;

// Whether the initial follower count has been successfully loaded
let hasLoaded = false;

// The flat ordered array representing every row in the table, including the follower row
let flatList = [];

// The index of the follower row within flatList — used for scrolling to it
let followerIndex = 0;

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

// The scrollable container that acts as the virtual scroll viewport
const scroller = document.getElementById("table-body");

// The invisible element whose height represents the total scroll height of all rows
const spacer   = document.getElementById("table-spacer");

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadData() {
  // Fetch the population dataset from the local JSON file
  const res = await fetch("populationdata.json");
  populationData = await res.json();

  // Sort cities by population ascending so binary search and ranking work correctly
  populationData.sort((a, b) => a.population - b.population);

  // Build the search index once at load time — reversing so largest cities appear first
  // in search results, and pre-lowercasing keys to avoid doing it on every keystroke
  searchableLocations = populationData
    .slice()
    .reverse()
    .map(city => ({ city, key: cityKey(city), keyLower: cityKey(city).toLowerCase() }));

  // Attach all search-related event listeners now that the data is ready
  setupSearch();

  // If a follower count was cached from a previous visit, use it immediately so the
  // page renders with content rather than showing a blank state while the Gist loads
  const cached = readCache();
  if (cached !== null) {
    followers = cached;
    hasLoaded = true;
    buildFlatList();
    renderPanels();
    drawRows();
    // Instantly jump to the follower row position without a smooth scroll animation
    scrollToFollower("auto");
  }

  // Fetch the live follower count from the Gist, then start the polling clock
  await fetchFollowers();
  startClock();
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function readCache() {
  try {
    const raw = localStorage.getItem(FOLLOWER_CACHE_KEY);
    if (!raw) return null;
    // Parse the stored value and validate it is a finite number before using it
    const v = Number(JSON.parse(raw).followers);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

function writeCache(v) {
  try {
    // Persist the latest follower count to localStorage so it's available on the next page load
    localStorage.setItem(FOLLOWER_CACHE_KEY, JSON.stringify({ followers: v }));
  } catch {}
}

// ── Followers ─────────────────────────────────────────────────────────────────

async function fetchFollowers() {
  try {
    // Append a timestamp query parameter to bust GitHub's CDN cache and ensure
    // we always receive the latest version of the file from origin
    const res = await fetch(`${GIST_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);

    const data = await res.json();
    const v = Number(data.followers);

    // Reject any response that doesn't contain a valid numeric follower count
    if (!Number.isFinite(v)) throw new Error("bad value");

    // Only update the UI if the follower count has actually changed, or if this
    // is the very first successful load (hasLoaded is false)
    if (v !== followers || !hasLoaded) {
      const wasLoaded = hasLoaded;
      followers = v;
      hasLoaded = true;
      writeCache(v);

      // Rebuild the flat list since the follower row may have moved position
      buildFlatList();
      renderPanels();

      // Force a full redraw of the visible rows so the table reflects the new data
      drawRows();

      // On the very first load, scroll to centre the follower row in the viewport
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

  // Calculate milliseconds until the next 30-second boundary (:00 or :30)
  // The Worker writes to the Gist at :00, so fetching at :00 and :30 gives
  // the Gist time to propagate while still catching updates as quickly as possible
  const secondsUntilNext = s < 30 ? (30 - s) : (60 - s);
  return secondsUntilNext * 1000 - ms;
}

function startClock() {
  // Update the progress bar and countdown label four times per second for a smooth animation
  setInterval(() => {
    const now = new Date();
    const s = now.getUTCSeconds();
    const ms = now.getUTCMilliseconds();

    // Calculate how many milliseconds remain until the next :00 or :30 boundary
    const secondsUntilNext = s < 30 ? (30 - s) : (60 - s);
    const totalMs = secondsUntilNext * 1000 - ms;

    // Express remaining time as a fraction of 30 seconds and fill the bar accordingly
    barEl.style.width = `${Math.max(0, Math.min(1, 1 - totalMs / 30000)) * 100}%`;
    countdownEl.textContent = `Next update in ${Math.ceil(totalMs / 1000)}s`;
  }, 250);

  // Schedule the next fetch to fire precisely at the next :00 or :30 wall-clock boundary,
  // then reschedule itself so it always aligns to the clock rather than drifting over time
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
  // Find the insertion index — the number of cities with population less than the follower count
  const insertAt = findRank(followers);
  flatList = [];

  // Cities ranked above the follower count (higher population) — reversed so the closest
  // city to the follower count appears immediately above the follower row
  const above = populationData.slice(insertAt).reverse();
  above.forEach((city, i) => {
    flatList.push({ type: 'city', city, rank: i + 1 });
  });

  // Record the follower row's index before pushing it, so we can scroll to it later
  followerIndex = flatList.length;
  flatList.push({ type: 'follower', rank: above.length + 1 });

  // Cities ranked below the follower count (lower population) — reversed so the closest
  // city to the follower count appears immediately below the follower row
  const below = populationData.slice(0, insertAt).reverse();
  below.forEach((city, i) => {
    flatList.push({ type: 'city', city, rank: above.length + 2 + i });
  });

  // Set the spacer height to represent the full list height without rendering every row —
  // this gives the scrollbar the correct proportions for the complete dataset
  spacer.style.height = `${flatList.length * ROW_HEIGHT}px`;
}

// ── Virtual scroll renderer ───────────────────────────────────────────────────

// Track the last rendered row range to avoid unnecessary DOM operations on scroll
let lastStart = -1;
let lastEnd = -1;

function renderVirtualTable() {
  // Determine which rows are currently in or near the viewport
  const { start, end } = getVisibleRange();

  // If the visible range hasn't changed since the last render, skip the DOM update entirely
  if (start === lastStart && end === lastEnd) return;
  lastStart = start;
  lastEnd = end;
  paintRows(start, end);
}

function drawRows() {
  // Always perform a full redraw regardless of whether the visible range has changed —
  // used when the underlying data changes and the existing DOM rows may be stale
  const { start, end } = getVisibleRange();
  lastStart = start;
  lastEnd = end;
  paintRows(start, end);
}

function getVisibleRange() {
  const scrollTop = scroller.scrollTop;
  const viewportH = scroller.clientHeight;

  // Calculate the first and last row indices that fall within the current viewport
  const visibleStart = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleEnd   = Math.ceil((scrollTop + viewportH) / ROW_HEIGHT);

  // Expand the range by the buffer amount so rows are ready before the user scrolls to them
  return {
    start: Math.max(0, visibleStart - BUFFER),
    end:   Math.min(flatList.length - 1, visibleEnd + BUFFER),
  };
}

function paintRows(start, end) {
  // Remove only the rendered row elements — the spacer must remain untouched
  scroller.querySelectorAll(".row").forEach(el => el.remove());

  // Build all rows in a document fragment to minimise DOM reflows
  const fragment = document.createDocumentFragment();
  for (let i = start; i <= end; i++) {
    fragment.appendChild(makeRow(i, flatList[i]));
  }
  scroller.appendChild(fragment);
}

function makeRow(index, entry) {
  const el = document.createElement("div");
  el.className = "row";

  // Position the row absolutely using a CSS transform so it appears at the correct
  // vertical offset within the scroll container without affecting document flow
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

    // Highlight this row if the user has navigated to it via search
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
  // Calculate the scroll position that places the follower row in the centre of the viewport
  const targetScrollTop = followerIndex * ROW_HEIGHT - scroller.clientHeight / 2 + ROW_HEIGHT / 2;
  scroller.scrollTo({ top: Math.max(0, targetScrollTop), behavior });

  // Trigger a render pass on the next animation frame to ensure the correct rows are painted
  requestAnimationFrame(renderVirtualTable);
}

function scrollToKey(key) {
  // Find the flat list index of the city matching the given key
  const idx = flatList.findIndex(e => e.type === 'city' && cityKey(e.city) === key);
  if (idx === -1) return;

  // Scroll so the target row is centred in the viewport
  const targetScrollTop = idx * ROW_HEIGHT - scroller.clientHeight / 2 + ROW_HEIGHT / 2;
  scroller.scrollTo({ top: Math.max(0, targetScrollTop), behavior: "smooth" });
  requestAnimationFrame(renderVirtualTable);
}

// ── Panels ────────────────────────────────────────────────────────────────────

function renderPanels() {
  const insertAt = findRank(followers);

  // The city immediately below the follower count is the most recently overtaken place
  const prev = populationData[insertAt - 1] || null;

  // The city immediately above the follower count is the next place to overtake
  const next = populationData[insertAt] || null;

  panelLastName.textContent  = prev ? cityKey(prev) : "None yet";
  panelLastPop.textContent   = prev ? fmt(prev.population) : "—";
  panelFollowers.textContent = fmt(followers);
  panelNextName.textContent  = next ? cityKey(next) : "Top of the list!";
  panelNextPop.textContent   = next ? fmt(next.population) : "—";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Produce a consistent display key for a city used as both a label and a lookup identifier
function cityKey(city) { return `${city.city}, ${city.country}`; }

// Format a number with locale-appropriate thousands separators
function fmt(n) { return Number(n).toLocaleString(); }

function findRank(value) {
  // Binary search to find how many cities have a population strictly less than value —
  // this is the insertion index and doubles as the follower count's rank offset
  let lo = 0, hi = populationData.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    populationData[mid].population < value ? lo = mid + 1 : hi = mid - 1;
  }
  return lo;
}

// ── Search ────────────────────────────────────────────────────────────────────

function setupSearch() {
  // Re-render visible rows on every scroll event, throttled to animation frames
  // to avoid firing more often than the browser can paint
  scroller.addEventListener("scroll", () => requestAnimationFrame(renderVirtualTable), { passive: true });

  searchInput.addEventListener("keydown", e => {
    // Trigger a search when the user presses Enter in the search field
    if (e.key === "Enter") { e.preventDefault(); doSearch(); }
    // Dismiss the results dropdown when the user presses Escape
    if (e.key === "Escape") clearResults();
  });

  searchButton.addEventListener("click", doSearch);

  resetButton.addEventListener("click", () => {
    // Clear the focused location and return the viewport to the follower row
    focusedKey = null;
    searchInput.value = "";
    clearResults();
    scrollToFollower("smooth");
  });

  // Dismiss the results dropdown when the user clicks anywhere outside the search panel
  document.addEventListener("click", e => {
    if (!e.target.closest(".search-panel")) clearResults();
  });
}

function doSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { clearResults(); return; }

  // Filter the pre-built search index and return the top 8 matches
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
      // Set the focused key and scroll the table to that city's position
      focusedKey = entry.key;
      searchInput.value = entry.key;
      clearResults();
      // Force a redraw so the focused highlight is applied before the scroll animation
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

// Kick off the data load as soon as the script executes
loadData();
