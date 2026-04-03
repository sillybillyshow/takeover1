const GIST_URL = "https://gist.githubusercontent.com/sillybillyshow/ae68c331d964ff293623a01ca1766256/raw/tiktok_stats.json";
const COUNTRY_POP_URL = "countrypopulations.json";
const FOLLOWER_CACHE_KEY = "sbs-followers-cache";
const ROW_HEIGHT = 44;
const BUFFER = 10;

let populationData = [];
let countryData = [];
let followers = 0;
let searchableLocations = [];
let focusedId = null;
let hasLoaded = false;
let flatList = [];
let followerIndex = 0;
let activeCountryTab = "overtaken";
let globeHandle = null;

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
const scroller = document.getElementById("table-body");
const spacer = document.getElementById("table-spacer");
const globeContainer = document.getElementById("globe-container");
const countryTableTitle = document.getElementById("country-table-title");
const countryTableBody = document.getElementById("country-table-body");
const countryEmpty = document.getElementById("country-empty");
const countryTabs = [...document.querySelectorAll(".country-tab")];

async function loadData() {
  const res = await fetch("populationdata.json");
  populationData = await res.json();
  populationData.sort((a, b) => a.population - b.population);

  searchableLocations = populationData
    .slice()
    .reverse()
    .map(city => ({
      city,
      id: cityId(city),
      key: cityKey(city),
      display: cityLabel(city),
      keyLower: cityKey(city).toLowerCase(),
    }));

  const labelCounts = new Map();
  searchableLocations.forEach(entry => {
    labelCounts.set(entry.display, (labelCounts.get(entry.display) || 0) + 1);
  });

  searchableLocations.forEach(entry => {
    entry.label = labelCounts.get(entry.display) > 1
      ? `${entry.display} (${fmt(entry.city.population)})`
      : entry.display;
    entry.labelLower = entry.label.toLowerCase();
  });

  setupSearch();
  setupCountryTabs();
  fetchCountryData();

  if (globeContainer) {
    try {
      const { initGlobe } = await import("./globe.js");
      globeHandle = await initGlobe(globeContainer, populationData);
    } catch (e) {
      console.error("Globe failed to initialise", e);
    }
  }

  const cached = readCache();
  if (cached !== null) {
    followers = cached;
    hasLoaded = true;
    buildFlatList();
    refreshFollowerViews();
    scrollToFollower("auto");
  }

  await fetchFollowers();
  startClock();
}

function readCache() {
  try {
    const raw = localStorage.getItem(FOLLOWER_CACHE_KEY);
    if (!raw) return null;
    const v = Number(JSON.parse(raw).followers);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function writeCache(v) {
  try {
    localStorage.setItem(FOLLOWER_CACHE_KEY, JSON.stringify({ followers: v }));
  } catch {}
}

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
      refreshFollowerViews();
      if (!wasLoaded) scrollToFollower("auto");
    }
  } catch (e) {
    console.error("Follower fetch failed", e);
  }
}

async function fetchCountryData() {
  try {
    const res = await fetch(COUNTRY_POP_URL);
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();

    countryData = rows
      .filter(row => row && Number.isFinite(Number(row.population)))
      .map(row => ({
        country: row.country,
        population: Number(row.population),
      }));

    renderCountryTable();
  } catch (e) {
    console.error("Country population fetch failed", e);
    if (countryTableTitle) countryTableTitle.textContent = "Country totals unavailable right now.";
    if (countryEmpty) countryEmpty.hidden = false;
  }
}

function msUntilNextFetch() {
  const now = new Date();
  const s = now.getUTCSeconds();
  const ms = now.getUTCMilliseconds();
  const secondsUntil = s < 30 ? (30 - s) : (60 - s);
  return secondsUntil * 1000 - ms;
}

function startClock() {
  setInterval(() => {
    const now = new Date();
    const s = now.getUTCSeconds();
    const ms = now.getUTCMilliseconds();
    const sUntil = s < 30 ? (30 - s) : (60 - s);
    const totalMs = sUntil * 1000 - ms;
    barEl.style.width = `${Math.max(0, Math.min(1, 1 - totalMs / 30000)) * 100}%`;
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

function buildFlatList() {
  const insertAt = findRank(followers);
  flatList = [];

  const above = populationData.slice(insertAt).reverse();
  above.forEach((city, i) => flatList.push({ type: "city", city, rank: i + 1 }));

  followerIndex = flatList.length;
  flatList.push({ type: "follower", rank: above.length + 1 });

  const below = populationData.slice(0, insertAt).reverse();
  below.forEach((city, i) => flatList.push({ type: "city", city, rank: above.length + 2 + i }));

  spacer.style.height = `${flatList.length * ROW_HEIGHT}px`;
}

let lastStart = -1;
let lastEnd = -1;

function renderVirtualTable() {
  const { start, end } = visibleRange();
  if (start === lastStart && end === lastEnd) return;
  lastStart = start;
  lastEnd = end;
  paintRows(start, end);
}

function drawRows() {
  const { start, end } = visibleRange();
  lastStart = start;
  lastEnd = end;
  paintRows(start, end);
}

function visibleRange() {
  const top = scroller.scrollTop;
  const height = scroller.clientHeight;
  return {
    start: Math.max(0, Math.floor(top / ROW_HEIGHT) - BUFFER),
    end: Math.min(flatList.length - 1, Math.ceil((top + height) / ROW_HEIGHT) + BUFFER),
  };
}

function paintRows(start, end) {
  scroller.querySelectorAll(".row").forEach(el => el.remove());
  const frag = document.createDocumentFragment();
  for (let i = start; i <= end; i++) frag.appendChild(makeRow(i, flatList[i]));
  scroller.appendChild(frag);
}

function makeRow(index, entry) {
  const el = document.createElement("div");
  el.className = "row";
  el.style.transform = `translateY(${index * ROW_HEIGHT}px)`;

  if (entry.type === "follower") {
    el.classList.add("row--follower");
    el.id = "follower-row";
    el.innerHTML = `
      <span class="row-rank">${entry.rank}</span>
      <span class="row-name">Silly Billy Show</span>
      <span class="row-value">${fmt(followers)}</span>`;
  } else {
    const label = cityLabel(entry.city);
    el.dataset.key = label;
    if (focusedId === cityId(entry.city)) el.classList.add("row--focused");
    el.innerHTML = `
      <span class="row-rank">${entry.rank}</span>
      <span class="row-name">${label}</span>
      <span class="row-value">${fmt(entry.city.population)}</span>`;
  }

  return el;
}

function scrollToFollower(behavior = "smooth") {
  const top = followerIndex * ROW_HEIGHT - scroller.clientHeight / 2 + ROW_HEIGHT / 2;
  scroller.scrollTo({ top: Math.max(0, top), behavior });
  requestAnimationFrame(renderVirtualTable);
}

function scrollToCity(id) {
  const idx = flatList.findIndex(e => e.type === "city" && cityId(e.city) === id);
  if (idx === -1) return;
  const top = idx * ROW_HEIGHT - scroller.clientHeight / 2 + ROW_HEIGHT / 2;
  scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  requestAnimationFrame(renderVirtualTable);
}

function renderPanels() {
  const insertAt = findRank(followers);
  const prev = populationData[insertAt - 1] || null;
  const next = populationData[insertAt] || null;

  panelLastName.textContent = prev ? cityLabel(prev) : "None yet";
  panelLastPop.textContent = prev ? fmt(prev.population) : "—";
  panelFollowers.textContent = fmt(followers);
  panelNextName.textContent = next ? cityLabel(next) : "Top of the list!";
  panelNextPop.textContent = next ? fmt(next.population) : "—";
}

function refreshFollowerViews() {
  renderPanels();
  drawRows();
  renderCountryTable();
  if (globeHandle) globeHandle.update(followers);
}

function setupCountryTabs() {
  countryTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      activeCountryTab = tab.dataset.tab;
      countryTabs.forEach(btn => {
        const active = btn === tab;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", String(active));
      });
      renderCountryTable();
    });
  });
}

function renderCountryTable() {
  if (!countryTableBody || !countryTableTitle) return;
  if (!countryData.length) return;

  const overtaken = countryData
    .filter(entry => entry.population < followers)
    .sort((a, b) => b.population - a.population || a.country.localeCompare(b.country));

  const future = countryData
    .filter(entry => entry.population >= followers)
    .sort((a, b) => a.population - b.population || a.country.localeCompare(b.country));

  const rows = activeCountryTab === "overtaken" ? overtaken : future;
  countryTableTitle.textContent = activeCountryTab === "overtaken"
    ? `${rows.length} countries overtaken`
    : `${rows.length} countries to overtake`;

  countryTableBody.innerHTML = "";
  countryEmpty.hidden = rows.length > 0;

  rows.forEach(entry => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${entry.country}</td>
      <td>${fmt(entry.population)}</td>`;
    countryTableBody.appendChild(tr);
  });
}

function cityKey(city) { return `${city.city}, ${city.country}`; }

function cityContext(city) {
  const context = typeof city.context === "string" ? city.context.trim() : "";
  return context || "";
}

function cityLabel(city) {
  const context = cityContext(city);
  return context ? `${city.city} (${context}), ${city.country}` : cityKey(city);
}

function cityId(city) {
  return `${city.city}|${city.country}|${city.population}|${city.lat}|${city.lng}`;
}

function fmt(n) { return Number(n).toLocaleString(); }

function findRank(value) {
  let lo = 0;
  let hi = populationData.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    populationData[mid].population < value ? lo = mid + 1 : hi = mid - 1;
  }
  return lo;
}

function setupSearch() {
  scroller.addEventListener("scroll", () => requestAnimationFrame(renderVirtualTable), { passive: true });

  searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch();
    }
    if (e.key === "Escape") clearResults();
  });

  searchButton.addEventListener("click", doSearch);

  resetButton.addEventListener("click", () => {
    focusedId = null;
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
  if (!q) {
    clearResults();
    return;
  }

  renderResults(
    searchableLocations
      .filter(e => e.labelLower.includes(q) || e.keyLower.includes(q))
      .slice(0, 8)
  );
}

function renderResults(matches) {
  searchResults.innerHTML = "";
  if (!matches.length) {
    searchResults.hidden = true;
    return;
  }

  matches.forEach(entry => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-result";
    btn.textContent = entry.label;
    btn.addEventListener("click", () => {
      focusedId = entry.id;
      searchInput.value = entry.label;
      clearResults();
      drawRows();
      scrollToCity(entry.id);
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
