const workerURL = "https://tiktok-follower-api.sillybillyshowemail.workers.dev";

let populationData = [];
let followers = 0;
let previousFollowers = 0;
let focusedLocation = null;
let selectedSuggestionIndex = -1;

const CONTEXT_ROWS = 5;
const cardsContainer = document.getElementById("cards-container");
const countdownEl = document.getElementById("countdown");
const barEl = document.getElementById("bar");
const searchInput = document.getElementById("location-search");
const searchButton = document.getElementById("search-button");
const resetButton = document.getElementById("reset-button");
const searchResults = document.getElementById("search-results");

async function loadData() {
  const popRes = await fetch("populationdata.json");
  populationData = await popRes.json();
  populationData.sort((a, b) => a.population - b.population);

  setupSearch();
  await getFollowers();
  renderCards(true);
  startClock();
}

// Mock follower fetch for testing
async function getFollowers() {
  previousFollowers = followers;
  followers = previousFollowers === 0 ? 4258 : 4280;
}

// Binary search to find rank index
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

function createCityCard(city, position) {
  const card = document.createElement("div");
  card.className = `card ${position}-card`;
  card.dataset.locationKey = getLocationKey(city);

  const name = document.createElement("span");
  name.className = "card-label";
  name.textContent = `${city.city}, ${city.country}`;

  const population = document.createElement("span");
  population.className = "card-value";
  population.textContent = city.population.toLocaleString();

  card.appendChild(name);
  card.appendChild(population);
  return card;
}

function createFollowerCard() {
  const followerCard = document.createElement("div");
  followerCard.className = "card follower";
  followerCard.id = "follower-card";
  followerCard.dataset.locationKey = "followers";

  const name = document.createElement("span");
  name.className = "card-label";
  name.textContent = "Silly Billy Show Followers";

  const population = document.createElement("span");
  population.className = "card-value";
  population.textContent = followers.toLocaleString();

  followerCard.appendChild(name);
  followerCard.appendChild(population);
  return followerCard;
}

function getLocationKey(city) {
  return `${city.city}, ${city.country}`;
}

function getFocusedElement() {
  if (focusedLocation) {
    return cardsContainer.querySelector(`[data-location-key="${CSS.escape(focusedLocation)}"]`);
  }

  return document.getElementById("follower-card");
}

function scrollToFocus(behavior = "auto") {
  const focusedElement = getFocusedElement();
  if (!focusedElement) return;

  focusedElement.scrollIntoView({
    behavior,
    block: "center",
  });
}

function animateNoChange(followerCard) {
  followerCard.animate(
    [
      { transform: "translateX(0px)" },
      { transform: "translateX(-6px)" },
      { transform: "translateX(5px)" },
      { transform: "translateX(-4px)" },
      { transform: "translateX(3px)" },
      { transform: "translateX(0px)" },
    ],
    {
      duration: 650,
      easing: "ease-out",
    }
  );
}

function animateRankShift(deltaIndex) {
  const followerCard = document.getElementById("follower-card");
  if (!followerCard) return;

  const direction = deltaIndex > 0 ? 1 : -1;
  const shiftRows = Math.min(Math.abs(deltaIndex), CONTEXT_ROWS);
  const backgroundShift = Math.max(36, shiftRows * 28) * direction;
  const allCards = Array.from(cardsContainer.querySelectorAll(".card"));
  const followerIndex = allCards.indexOf(followerCard);
  const backgroundCards = allCards.filter((card) => card !== followerCard);

  followerCard.animate(
    [
      { transform: "translateY(0px) scale(1)", boxShadow: "0 2px 6px rgba(0,0,0,0.1)" },
      { transform: "translateY(-24px) scale(1.02)", boxShadow: "0 18px 34px rgba(0,0,0,0.18)" },
      { transform: "translateY(-20px) scale(1.02)", boxShadow: "0 16px 30px rgba(0,0,0,0.16)" },
      { transform: "translateY(0px) scale(1)", boxShadow: "0 2px 6px rgba(0,0,0,0.1)" },
    ],
    {
      duration: 1450,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    }
  );

  backgroundCards.forEach((card) => {
    const cardIndex = allCards.indexOf(card);
    const distance = Math.abs(cardIndex - followerIndex);
    const dampening = Math.max(0.35, 1 - distance * 0.08);
    const offset = backgroundShift * dampening;

    card.animate(
      [
        {
          transform: "translateY(0px) scale(1)",
          opacity: 1,
          filter: "blur(0px)",
        },
        {
          transform: `translateY(${offset}px) scale(0.985)`,
          opacity: 0.72,
          filter: "blur(1.5px)",
        },
        {
          transform: `translateY(${offset * 0.35}px) scale(0.992)`,
          opacity: 0.9,
          filter: "blur(0.6px)",
        },
        {
          transform: "translateY(0px) scale(1)",
          opacity: 1,
          filter: "blur(0px)",
        },
      ],
      {
        duration: 1550,
        delay: Math.min(distance * 28, 240),
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      }
    );
  });
}

function getSearchMatches(query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  return populationData
    .filter((city) => getLocationKey(city).toLowerCase().includes(normalizedQuery))
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

  matches.forEach((city, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "search-result";
    option.dataset.index = String(index);
    option.textContent = getLocationKey(city);
    option.addEventListener("click", () => {
      searchInput.value = getLocationKey(city);
      focusedLocation = getLocationKey(city);
      clearSearchResults();
      renderCards();
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
  const activeMatch =
    selectedSuggestionIndex >= 0
      ? matches[selectedSuggestionIndex]
      : matches.find((city) => getLocationKey(city).toLowerCase() === query.toLowerCase()) || matches[0];

  if (!activeMatch) return;

  focusedLocation = getLocationKey(activeMatch);
  searchInput.value = focusedLocation;
  clearSearchResults();
  renderCards();
}

function setupSearch() {
  if (!searchInput || !searchButton || !resetButton || !searchResults) return;

  searchInput.addEventListener("input", () => {
    selectedSuggestionIndex = -1;
    renderSearchResults(getSearchMatches(searchInput.value));
  });

  searchInput.addEventListener("keydown", (event) => {
    const results = Array.from(searchResults.querySelectorAll(".search-result"));
    if (!results.length && event.key !== "Enter") return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, results.length - 1);
      updateSuggestionSelection();
    }

    if (event.key === "ArrowUp") {
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
    renderCards();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-panel")) {
      clearSearchResults();
    }
  });
}

// Render all cards and anchor the scroll around the follower row
function renderCards(initial = false) {
  const index = findRank(followers);
  const oldIndex = findRank(previousFollowers);
  const deltaIndex = index - oldIndex;

  cardsContainer.innerHTML = "";

  const higherPopulation = populationData.slice(index).reverse();
  const lowerPopulation = populationData.slice(0, index).reverse();

  higherPopulation.forEach((city, position) => {
    const distanceFromFollower = higherPopulation.length - position;
    const card = createCityCard(
      city,
      distanceFromFollower <= CONTEXT_ROWS ? "top" : "higher"
    );
    cardsContainer.appendChild(card);
  });

  cardsContainer.appendChild(createFollowerCard());

  lowerPopulation.forEach((city, position) => {
    const card = createCityCard(
      city,
      position < CONTEXT_ROWS ? "bottom" : "lower"
    );
    cardsContainer.appendChild(card);
  });

  const focusedElement = getFocusedElement();
  if (focusedElement) {
    focusedElement.classList.add("focused-card");
  }

  scrollToFocus(initial ? "auto" : "smooth");

  if (!initial) {
    const followerCard = document.getElementById("follower-card");
    if (!followerCard) return;

    if (deltaIndex === 0) {
      animateNoChange(followerCard);
    } else {
      animateRankShift(deltaIndex);
    }
  }
}

// Milliseconds until next GMT minute
function msToNextMinute() {
  const now = new Date();
  return (60 - now.getUTCSeconds()) * 1000 - now.getUTCMilliseconds();
}

// Countdown timer + scheduler
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
      renderCards();
      schedule();
    }, msToNextMinute());
  }
  schedule();
}

// Start
loadData();
