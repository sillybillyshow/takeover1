const workerURL = "https://tiktok-follower-api.sillybillyshowemail.workers.dev";

let populationData = [];
let followers = 0;
let previousFollowers = 0;

const CONTEXT_ROWS = 5;
const cardsContainer = document.getElementById("cards-container");
const countdownEl = document.getElementById("countdown");
const barEl = document.getElementById("bar");

async function loadData() {
  const popRes = await fetch("populationdata.json");
  populationData = await popRes.json();
  populationData.sort((a, b) => a.population - b.population);

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
  card.textContent = `${city.city}, ${city.country} — ${city.population.toLocaleString()}`;
  return card;
}

function createFollowerCard() {
  const followerCard = document.createElement("div");
  followerCard.className = "card follower";
  followerCard.id = "follower-card";
  followerCard.textContent = `Silly Billy Show Followers — ${followers.toLocaleString()}`;
  return followerCard;
}

function scrollToFollower(behavior = "auto") {
  const followerCard = document.getElementById("follower-card");
  if (!followerCard) return;

  followerCard.scrollIntoView({
    behavior,
    block: "center",
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

  scrollToFollower(initial ? "auto" : "smooth");

  if (!initial && deltaIndex !== 0) {
    const followerCard = document.getElementById("follower-card");
    if (followerCard) {
      followerCard.animate(
        [
          { transform: "scale(1)", boxShadow: "0 2px 6px rgba(0,0,0,0.1)" },
          { transform: "scale(1.03)", boxShadow: "0 12px 24px rgba(255,0,80,0.3)" },
          { transform: "scale(1)", boxShadow: "0 2px 6px rgba(0,0,0,0.1)" },
        ],
        {
          duration: 700,
          easing: "ease-out",
        }
      );
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
