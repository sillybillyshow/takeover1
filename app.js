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
const mapState = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  startOffsetX: 0,
  startOffsetY: 0,
};

const cardsContainer = document.getElementById("cards-container");
const countdownEl = document.getElementById("countdown");
const barEl = document.getElementById("bar");
const searchInput = document.getElementById("location-search");
const searchButton = document.getElementById("search-button");
const resetButton = document.getElementById("reset-button");
const searchResults = document.getElementById("search-results");
const nextPlaceEl = document.getElementById("next-place");
const lastPlaceEl = document.getElementById("last-place");
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
  });
  startClock();
}

// Mock follower fetch for testing
async function getFollowers() {
  previousFollowers = followers;
  followers = previousFollowers === 0 ? 4258 : 4280;
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

function formatPlace(city) {
  return `${city.city}, ${city.country} (${city.population.toLocaleString()})`;
}

function updateTakeoverSummary(index) {
  const nextPlace = populationData[index] || null;
  const lastPlace = populationData[index - 1] || null;

  nextPlaceEl.textContent = nextPlace
    ? `Next place to overtake: ${formatPlace(nextPlace)}`
    : "Next place to overtake: None left";

  lastPlaceEl.textContent = lastPlace
    ? `Place just taken over: ${formatPlace(lastPlace)}`
    : "Place just taken over: None yet";
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
  name.textContent = `${city.city}, ${city.country}`;

  const population = document.createElement("span");
  population.className = "card-value";
  population.textContent = city.population.toLocaleString();

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

function submitSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  const matches = getSearchMatches(query);
  renderSearchResults(matches);

  const activeMatch =
    selectedSuggestionIndex >= 0
      ? matches[selectedSuggestionIndex]
      : matches.find((entry) => entry.keyLower === query.toLowerCase()) || matches[0] || null;

  if (!activeMatch) return;

  focusedLocation = activeMatch.key;
  searchInput.value = activeMatch.key;
  clearSearchResults();
  renderView({
    centerFocus: true,
    preserveScroll: false,
  });
}

function setupSearch() {
  if (!searchInput || !searchButton || !resetButton || !searchResults) return;

  searchInput.addEventListener("keydown", (event) => {
    const results = Array.from(searchResults.querySelectorAll(".search-result"));

    if (event.key === "ArrowDown") {
      if (!results.length) return;
      event.preventDefault();
      selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, results.length - 1);
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
      submitSearch();
    }
  });

  searchButton.addEventListener("click", submitSearch);

  resetButton.addEventListener("click", () => {
    focusedLocation = null;
    searchInput.value = "";
    clearSearchResults();
    renderView({
      centerFocus: true,
      preserveScroll: false,
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
  const context = mapCanvas.getContext("2d");
  if (!context) return null;
  return context;
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

  mapCanvas.addEventListener("wheel", (event) => {
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
  }, { passive: false });

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

  resizeMapCanvas();
}

function renderMap() {
  const context = getMapContext();
  if (!context || !mapCanvas) return;

  const width = mapCanvas.clientWidth;
  const height = mapCanvas.clientHeight;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f4f4f4";
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

  const pointRadius = Math.max(1.35, 2 / Math.sqrt(mapState.scale));

  context.fillStyle = "rgba(159, 159, 159, 0.65)";
  projectedMapPoints.forEach((point) => {
    if (point.population <= followers) return;
    context.beginPath();
    context.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
    context.fill();
  });

  context.fillStyle = "rgba(31, 157, 92, 0.9)";
  projectedMapPoints.forEach((point) => {
    if (point.population > followers) return;
    context.beginPath();
    context.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
    context.fill();
  });

  context.restore();
}

function renderCards(options = {}) {
  const { centerFocus = false, preserveScroll = false } = options;
  const currentScrollTop = preserveScroll ? cardsContainer.scrollTop : 0;
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
  } else if (centerFocus) {
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
      });
      schedule();
    }, msToNextMinute());
  }

  schedule();
}

loadData();
