const workerURL = "https://tiktok-follower-api.sillybillyshowemail.workers.dev";

let populationData = [];
let followers = 0;
let previousFollowers = 0;
let focusedLocation = null;
let selectedSuggestionIndex = -1;
let searchableLocations = [];

const cardsContainer = document.getElementById("cards-container");
const countdownEl = document.getElementById("countdown");
const barEl = document.getElementById("bar");
const searchInput = document.getElementById("location-search");
const searchButton = document.getElementById("search-button");
const resetButton = document.getElementById("reset-button");
const searchResults = document.getElementById("search-results");
const nextPlaceEl = document.getElementById("next-place");
const lastPlaceEl = document.getElementById("last-place");
const mapEl = document.getElementById("world-map");

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

  setupSearch();
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

function renderMap() {
  if (!mapEl) return;

  const width = 900;
  const height = 420;
  const overtaken = [];
  const remaining = [];

  populationData.forEach((city) => {
    const point = {
      x: ((city.lng + 180) / 360) * width,
      y: ((90 - city.lat) / 180) * height,
    };

    if (city.population < followers) overtaken.push(point);
    else remaining.push(point);
  });

  const graticule = [];
  for (let lng = -120; lng <= 120; lng += 60) {
    const x = ((lng + 180) / 360) * width;
    graticule.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" />`);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * height;
    graticule.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" />`);
  }

  const renderPoints = (points, className) =>
    points
      .map((point) => `<circle class="${className}" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="2.1"></circle>`)
      .join("");

  mapEl.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="World city takeover map">
      <rect class="map-bg" x="0" y="0" width="${width}" height="${height}" rx="22"></rect>
      <g class="map-grid">${graticule.join("")}</g>
      <g class="map-points remaining">${renderPoints(remaining, "remaining-point")}</g>
      <g class="map-points overtaken">${renderPoints(overtaken, "overtaken-point")}</g>
    </svg>
  `;
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
    const rank = position + 1;
    cardsContainer.appendChild(createCityCard(city, rank));
  });

  cardsContainer.appendChild(createFollowerCard(followerRank));

  lowerPopulation.forEach((city, position) => {
    const rank = followerRank + position + 1;
    cardsContainer.appendChild(createCityCard(city, rank));
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
  renderMap();
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
