const workerURL = "https://tiktok-follower-api.sillybillyshowemail.workers.dev";
const FOLLOWER_CACHE_KEY = "sbs-followers-cache";
const IDLE_TIMEOUT_MS = 2 * 60 * 1000;

let populationData = [];
let followers = 0;
let previousFollowers = 0;
let focusedLocation = null;
let selectedSuggestionIndex = -1;
let searchableLocations = [];
let lastActivityAt = Date.now();
let hasLoadedInitialFollowers = false;

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

  const cachedFollowers = readFollowersCache();
  if (cachedFollowers !== null) {
    followers = cachedFollowers;
    previousFollowers = cachedFollowers;
    hasLoadedInitialFollowers = true;
    renderView({
      centerFocus: true,
      preserveScroll: false,
      followAccountIfVisible: false,
    });
  } else {
    renderLoadingState();
  }

  startClock();
}

function readFollowersCache() {
  try {
    const raw = localStorage.getItem(FOLLOWER_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const value = Number(parsed.followers);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    console.error("Failed to read follower cache", error);
    return null;
  }
}

function writeFollowersCache(value) {
  try {
    localStorage.setItem(
      FOLLOWER_CACHE_KEY,
      JSON.stringify({
        followers: value,
        savedAt: Date.now(),
      })
    );
  } catch (error) {
    console.error("Failed to write follower cache", error);
  }
}

function renderLoadingState() {
  countdownEl.textContent = "Follower count loading";
  cardsContainer.innerHTML = "";
  nextPlaceNameEl.textContent = "Loading...";
  nextPlaceValueEl.textContent = "";
  lastPlaceNameEl.textContent = "Loading...";
  lastPlaceValueEl.textContent = "";
}

async function getFollowers() {
  previousFollowers = followers;

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
  const nextFollowers = Number(data.followers);

  if (!Number.isFinite(nextFollowers)) {
    throw new Error("Worker response did not include a numeric followers value");
  }

  followers = nextFollowers;
  writeFollowersCache(followers);
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

function markActivity() {
  lastActivityAt = Date.now();
}

function isUserActive() {
  return Date.now() - lastActivityAt < IDLE_TIMEOUT_MS;
}

function shouldPollFollowers() {
  return !document.hidden && isUserActive();
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
}

function renderView(options = {}) {
  renderCards(options);
}

function msToNextMinute() {
  const now = new Date();
  return (60 - now.getUTCSeconds()) * 1000 - now.getUTCMilliseconds();
}

function startClock() {
  ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, markActivity, { passive: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      markActivity();
    }
  });

  function updateTimer() {
    const now = new Date();
    const seconds = now.getUTCSeconds();
    const remain = seconds === 0 ? 0 : 60 - seconds;

    if (!hasLoadedInitialFollowers) {
      countdownEl.textContent = "Follower count loading";
    } else if (shouldPollFollowers()) {
      countdownEl.textContent = `Next update in ${remain}s`;
    } else {
      countdownEl.textContent = "Updates paused";
    }

    barEl.style.width = `${(seconds / 60) * 100}%`;
  }

  updateTimer();
  setInterval(updateTimer, 1000);

  function schedule() {
    setTimeout(async () => {
      const initialLoad = !hasLoadedInitialFollowers;

      if (shouldPollFollowers() || initialLoad) {
        try {
          await getFollowers();
          hasLoadedInitialFollowers = true;
          renderView({
            centerFocus: initialLoad,
            preserveScroll: !initialLoad,
            followAccountIfVisible: !initialLoad,
          });
        } catch (error) {
          console.error("Follower refresh failed", error);
        }
      }

      schedule();
    }, msToNextMinute());
  }

  schedule();
}

loadData();
