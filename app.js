const workerURL = "https://tiktok-follower-api.sillybillyshowemail.workers.dev";

let populationData = [];
let followers = 0;
let previousFollowers = 0;
let focusedLocation = null;
let selectedSuggestionIndex = -1;
let searchableLocations = [];
let projectedMapPoints = [];
let mapNeedsRender = false;

const MAP_WIDTH = 900;
const MAP_HEIGHT = 420;
const MAP_MIN_SCALE = 1;
const MAP_MAX_SCALE = 12;
const WORLD_LAND_PATHS = [
  "M48 100 L88 82 L134 80 L170 92 L210 112 L242 110 L280 120 L312 146 L326 172 L312 194 L286 194 L252 182 L218 184 L190 196 L154 192 L116 176 L86 156 L58 132 Z",
  "M302 220 L330 210 L354 220 L362 246 L348 276 L356 300 L344 328 L320 338 L304 316 L306 282 L296 250 Z",
  "M402 104 L432 92 L470 88 L508 94 L544 106 L582 122 L624 134 L660 156 L694 182 L712 204 L704 228 L672 226 L642 214 L614 214 L592 228 L574 254 L544 258 L524 244 L508 220 L482 212 L456 202 L432 184 L414 162 Z",
  "M610 266 L646 278 L674 298 L682 330 L664 354 L628 348 L604 324 L596 294 Z",
  "M724 284 L752 274 L788 286 L820 304 L838 332 L832 360 L806 370 L776 354 L748 330 L728 304 Z",
];

const cardsContainer = document.getElementById("cards-container");
const countdownEl = document.getElementById("countdown");
const barEl = document.getElementById("bar");
const searchInput = document.getElementById("location-search");
const searchButton = document.getElementById("search-button");
const resetButton = document.getElementById("reset-button");
const searchResults = document.getElementById("search-results");
const nextPlaceNameEl = document.getElementById("next-place-name");
const nextPlaceValueEl = document.getElementById("next-place-value");
const lastPlaceNameEl = document.getElementById("last-place-name");
const lastPlaceValueEl = document.getElementById("last-place-value");
const mapCanvas = document.getElementById("world-map");
const mapResetButton = document.getElementById("map-reset");

async function loadData() {
  const popRes = await fetch("populationdata.json");
  populationData = await popRes.json();
  populationData.sort((a, b) => a.population - b.population);

  searchableLocations = populationData
    .slice()
    .reverse()
    .map((city) => {
      const key = getLocationKey(city);
      return {
        city,
        key,
        keyLower: key.toLowerCase(),
      };
    });

  projectedMapPoints = populationData.map((city) => ({
    x: ((city.lng + 180) / 360) * MAP_WIDTH,
    y: ((90 - city.lat) / 180) * MAP_HEIGHT,
    population: city.population,
  }));

  setupSearch();
  setupMap();
  await getFollowers();
  renderView({
    centerFocus: true,
    preserveScroll: false,
    followAccountIfVisible: false,
  });
  startClock();
}

function extractFollowerCount(data) {
  const candidates = [
    data?.followers,
    data?.count,
    data?.followerCount,
    data?.data?.followers,
    data?.data?.count,
    data?.stats?.followers,
    data?.user?.followers,
  ];

  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  throw new Error("Unable to find follower count in worker response");
}

async function getFollowers() {
  previousFollowers = followers;

  try {
    const response = await fetch(workerURL, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Follower request failed: ${response.status}`);
    }

    const data = await response.json();
    followers = extractFollowerCount(data);
  } catch (error) {
    console.error("Follower fetch failed", error);
    if (followers === 0) {
      followers = 4258;
      previousFollowers = 4258;
    }
  }
}

function findRank(value) {
  let low = 0;
  let high = populationData.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (populationData[mid].population < value) low = mid + 1;
    else high = mid - 1;
  }
  return low;
}

function getLocationKey(city) {
  return `${city.city}, ${city.country}`;
}

function getFocusTarget() {
  return focusedLocation || "followers";
}

function getFocusedElement() {
  const key = getFocusTarget();
  return cardsContainer.querySelector(`[data-location-key="${CSS.escape(key)}"]`);
}

function formatPlaceName(city) {
  return `${city.city}, ${city.country}`;
}

function formatPlaceValue(city) {
  return city.population.toLocaleString();
}

function updateTakeoverSummary(index) {
  const nextPlace = populationData[index] || null;
  const lastPlace = populationData[index - 1] || null;

  nextPlaceNameEl.textContent = nextPlace ? formatPlaceName(nextPlace) : "None left";
  nextPlaceValueEl.textContent = nextPlace ? formatPlaceValue(nextPlace) : "";

  lastPlaceNameEl.textContent = lastPlace ? formatPlaceName(lastPlace) : "None yet";
  lastPlaceValueEl.textContent = lastPlace ? formatPlaceValue(lastPlace) : "";
}

function createCityCard(city, rank) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.locationKey = getLocationKey(city);

  const rankLabel = document.createElement("span");
  rankLabel.className = "card-rank";
  rankLabel.textContent = `${rank})`;

  const name = document.createElement("span");
  name.className = "card-label";
  name.textContent = formatPlaceName(city);

  const population = document.createElement("span");
  population.className = "card-value";
  population.textContent = formatPlaceValue(city);

  card.appendChild(rankLabel);
  card.appendChild(name);
  card.appendChild(population);
  return card;
}

function createFollowerCard(rank) {
  const followerCard = document.createElement("div");
  followerCard.className = "card follower";
  followerCard.dataset.locationKey = "followers";

  const rankLabel = document.createElement("span");
  rankLabel.className = "card-rank";
  rankLabel.textContent = `${rank})`;

  const name = document.createElement("span");
  name.className = "card-label";
  name.textContent = "Silly Billy Show Followers";

  const population = document.createElement("span");
  population.className = "card-value";
  population.textContent = followers.toLocaleString();

  followerCard.appendChild(rankLabel);
  followerCard.appendChild(name);
  followerCard.appendChild(population);
  return followerCard;
}

function getSearchMatches(query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  return searchableLocations
    .filter((entry) => entry.keyLower.includes(normalizedQuery))
    .slice(0, 8);
}

function clearSearchResults() {
  searchResults.innerHTML = "";
  searchResults.hidden = true;
  selectedSuggestionIndex = -1;
}

function renderSearchResults(matches) {
  clearSearchResults();
  if (!matches.length) return;

  matches.forEach((entry, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "search-result";
    option.dataset.index = String(index);
    option.textContent = entry.key;
    option.addEventListener("click", () => {
      searchInput.value = entry.key;
      focusedLocation = entry.key;
      clearSearchResults();
      renderView({
        centerFocus: true,
        preserveScroll: false,
        followAccountIfVisible: false,
      });
    });
    searchResults.appendChild(option);
  });

  searchResults.hidden = false;
}

function updateSuggestionSelection() {
  const results = Array.from(searchResults.querySelectorAll(".search-result"));
  results.forEach((result, index) => {
    result.classList.toggle("active", index === selectedSuggestionIndex);
  });
}

function showSearchResults() {
  renderSearchResults(getSearchMatches(searchInput.value));
}

function setupSearch() {
  if (!searchInput || !searchButton || !resetButton || !searchResults) return;

  searchInput.addEventListener("keydown", (event) => {
    const results = Array.from(searchResults.querySelectorAll(".search-result"));

    if (event.key === "ArrowDown") {
      if (searchResults.hidden) {
        showSearchResults();
      }
      const refreshedResults = Array.from(searchResults.querySelectorAll(".search-result"));
      if (!refreshedResults.length) return;
      event.preventDefault();
      selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, refreshedResults.length - 1);
      updateSuggestionSelection();
    }

    if (event.key === "ArrowUp") {
      if (!results.length) return;
      event.preventDefault();
      selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0);
      updateSuggestionSelection();
    }

    if (event.key === "Enter") {
      event.preventDefault();
      showSearchResults();
    }
  });

  searchButton.addEventListener("click", showSearchResults);

  resetButton.addEventListener("click", () => {
    focusedLocation = null;
    searchInput.value = "";
    clearSearchResults();
    renderView({
      centerFocus: true,
      preserveScroll: false,
      followAccountIfVisible: false,
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-panel")) {
      clearSearchResults();
    }
  });
}

function getMapContext() {
  if (!mapCanvas) return null;
  return mapCanvas.getContext("2d");
}

function clampMapOffsets() {
  const scaledWidth = MAP_WIDTH * mapState.scale;
  const scaledHeight = MAP_HEIGHT * mapState.scale;
  const viewportWidth = mapCanvas.clientWidth || MAP_WIDTH;
  const viewportHeight = mapCanvas.clientHeight || MAP_HEIGHT;
  const minOffsetX = Math.min(0, viewportWidth - scaledWidth);
  const minOffsetY = Math.min(0, viewportHeight - scaledHeight);

  mapState.offsetX = Math.min(0, Math.max(minOffsetX, mapState.offsetX));
  mapState.offsetY = Math.min(0, Math.max(minOffsetY, mapState.offsetY));
}

function requestMapRender() {
  if (mapNeedsRender) return;
  mapNeedsRender = true;
  requestAnimationFrame(() => {
    mapNeedsRender = false;
    renderMap();
  });
}

function resetMapView() {
  mapState.scale = 1;
  mapState.offsetX = 0;
  mapState.offsetY = 0;
  requestMapRender();
}

function resizeMapCanvas() {
  if (!mapCanvas) return;

  const ratio = window.devicePixelRatio || 1;
  const displayWidth = mapCanvas.clientWidth || mapCanvas.parentElement.clientWidth || MAP_WIDTH;
  const displayHeight = (displayWidth / MAP_WIDTH) * MAP_HEIGHT;

  mapCanvas.width = Math.round(displayWidth * ratio);
  mapCanvas.height = Math.round(displayHeight * ratio);
  mapCanvas.style.height = `${displayHeight}px`;

  const context = getMapContext();
  if (context) {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  clampMapOffsets();
  requestMapRender();
}

function setupMap() {
  if (!mapCanvas) return;

  mapResetButton?.addEventListener("click", resetMapView);

  mapCanvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      const rect = mapCanvas.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const worldX = (cursorX - mapState.offsetX) / mapState.scale;
      const worldY = (cursorY - mapState.offsetY) / mapState.scale;
      const zoomFactor = event.deltaY < 0 ? 1.15 : 0.87;
      const nextScale = Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, mapState.scale * zoomFactor));

      mapState.scale = nextScale;
      mapState.offsetX = cursorX - worldX * mapState.scale;
      mapState.offsetY = cursorY - worldY * mapState.scale;
      clampMapOffsets();
      requestMapRender();
    },
    { passive: false }
  );

  mapCanvas.addEventListener("pointerdown", (event) => {
    mapState.isDragging = true;
    mapState.dragStartX = event.clientX;
    mapState.dragStartY = event.clientY;
    mapState.startOffsetX = mapState.offsetX;
    mapState.startOffsetY = mapState.offsetY;
    mapCanvas.setPointerCapture(event.pointerId);
  });

  mapCanvas.addEventListener("pointermove", (event) => {
    if (!mapState.isDragging) return;
    mapState.offsetX = mapState.startOffsetX + (event.clientX - mapState.dragStartX);
    mapState.offsetY = mapState.startOffsetY + (event.clientY - mapState.dragStartY);
    clampMapOffsets();
    requestMapRender();
  });

  const stopDrag = (event) => {
    if (!mapState.isDragging) return;
    mapState.isDragging = false;
    if (event && mapCanvas.hasPointerCapture(event.pointerId)) {
      mapCanvas.releasePointerCapture(event.pointerId);
    }
  };

  mapCanvas.addEventListener("pointerup", stopDrag);
  mapCanvas.addEventListener("pointerleave", stopDrag);
  mapCanvas.addEventListener("pointercancel", stopDrag);
  window.addEventListener("resize", resizeMapCanvas);

  requestAnimationFrame(resizeMapCanvas);
}

function drawWorldBackdrop(context) {
  context.save();
  context.fillStyle = "#e2e2e2";
  context.strokeStyle = "#d2d2d2";
  context.lineWidth = 1.1 / mapState.scale;

  WORLD_LAND_PATHS.forEach((pathText) => {
    const path = new Path2D(pathText);
    context.fill(path);
    context.stroke(path);
  });

  context.restore();
}

function renderMap() {
  const context = getMapContext();
  if (!context || !mapCanvas) return;

  const width = mapCanvas.clientWidth;
  const height = mapCanvas.clientHeight;
  if (!width || !height) return;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#eef3f6";
  context.fillRect(0, 0, width, height);

  context.save();
  context.translate(mapState.offsetX, mapState.offsetY);
  context.scale(mapState.scale, mapState.scale);

  context.strokeStyle = "#d8d8d8";
  context.lineWidth = 1 / mapState.scale;

  for (let lng = -120; lng <= 120; lng += 60) {
    const x = ((lng + 180) / 360) * MAP_WIDTH;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, MAP_HEIGHT);
    context.stroke();
  }

  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * MAP_HEIGHT;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(MAP_WIDTH, y);
    context.stroke();
  }

  drawWorldBackdrop(context);

  const pointRadius = Math.max(0.45, 0.9 / Math.sqrt(mapState.scale));

  context.fillStyle = "rgba(159, 159, 159, 0.55)";
  projectedMapPoints.forEach((point) => {
    if (point.population < followers) return;
    context.beginPath();
    context.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
    context.fill();
  });

  context.fillStyle = "rgba(31, 157, 92, 0.82)";
  projectedMapPoints.forEach((point) => {
    if (point.population >= followers) return;
    context.beginPath();
    context.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
    context.fill();
  });

  context.restore();
}

function isAccountVisible() {
  const followerCard = cardsContainer.querySelector('[data-location-key="followers"]');
  if (!followerCard) return false;

  const containerTop = cardsContainer.scrollTop;
  const containerBottom = containerTop + cardsContainer.clientHeight;
  const cardTop = followerCard.offsetTop;
  const cardBottom = cardTop + followerCard.offsetHeight;

  return cardBottom >= containerTop && cardTop <= containerBottom;
}

function renderCards(options = {}) {
  const {
    centerFocus = false,
    preserveScroll = false,
    followAccountIfVisible = false,
  } = options;
  const currentScrollTop = preserveScroll ? cardsContainer.scrollTop : 0;
  const accountWasVisible = followAccountIfVisible ? isAccountVisible() : false;
  const index = findRank(followers);
  const higherPopulation = populationData.slice(index).reverse();
  const lowerPopulation = populationData.slice(0, index).reverse();
  const followerRank = higherPopulation.length + 1;

  cardsContainer.innerHTML = "";

  higherPopulation.forEach((city, position) => {
    cardsContainer.appendChild(createCityCard(city, position + 1));
  });

  cardsContainer.appendChild(createFollowerCard(followerRank));

  lowerPopulation.forEach((city, position) => {
    cardsContainer.appendChild(createCityCard(city, followerRank + position + 1));
  });

  const focusedElement = getFocusedElement();
  if (focusedElement) {
    focusedElement.classList.add("focused-card");
  }

  if (preserveScroll) {
    cardsContainer.scrollTop = currentScrollTop;
  }

  if (accountWasVisible) {
    const followerCard = cardsContainer.querySelector('[data-location-key="followers"]');
    if (followerCard) {
      followerCard.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  } else if (!preserveScroll && centerFocus) {
    const target = focusedElement || cardsContainer.querySelector('[data-location-key="followers"]');
    if (target) {
      target.scrollIntoView({
        behavior: "auto",
        block: "center",
      });
    }
  }

  updateTakeoverSummary(index);
  requestMapRender();
}

function renderView(options = {}) {
  renderCards(options);
}

function msToNextMinute() {
  const now = new Date();
  return (60 - now.getUTCSeconds()) * 1000 - now.getUTCMilliseconds();
}

function startClock() {
  function updateTimer() {
    const now = new Date();
    const seconds = now.getUTCSeconds();
    const remain = seconds === 0 ? 0 : 60 - seconds;
    countdownEl.textContent = `Next update in ${remain}s`;
    barEl.style.width = `${(seconds / 60) * 100}%`;
  }

  updateTimer();
  setInterval(updateTimer, 1000);

  function schedule() {
    setTimeout(async () => {
      await getFollowers();
      renderView({
        centerFocus: false,
        preserveScroll: true,
        followAccountIfVisible: true,
      });
      schedule();
    }, msToNextMinute());
  }

  schedule();
}

loadData();
