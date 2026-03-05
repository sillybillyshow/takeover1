const workerURL = "https://tiktok-follower-api.sillybillyshowemail.workers.dev";

let populationData = [];
let followers = 0;
let previousFollowers = 0;

// Number of cards above/below
const CARD_COUNT = 5;

// DOM elements
const cardsContainer = document.getElementById("cards-container");
const countdownEl = document.getElementById("countdown");
const barEl = document.getElementById("bar");

async function loadData() {
  const popRes = await fetch("populationdata.json");
  populationData = await popRes.json();
  populationData.sort((a,b) => a.population - b.population);

  await getFollowers();  // Fetch initial followers
  renderCards(true);      // Initial render
  startClock();
}

// Fetch follower count from worker
async function getFollowers() {
  const res = await fetch(workerURL);
  const data = await res.json();
  previousFollowers = followers;
  followers = data.followers;
}

// Binary search to find rank index
function findRank(value) {
  let low = 0, high = populationData.length -1;
  while (low <= high) {
    const mid = Math.floor((low+high)/2);
    if (populationData[mid].population < value) low = mid +1;
    else high = mid -1;
  }
  return low;
}

// Render cards snapshot
function renderCards(initial=false) {
  const index = findRank(followers);
  const oldIndex = findRank(previousFollowers);

  const above = populationData.slice(index, index + CARD_COUNT).reverse(); // Next to beat
  const below = populationData.slice(Math.max(0,index - CARD_COUNT), index); // Bigger than
  below.reverse(); // highest below at top

  // Animate movement if not initial load
  const delta = followers - previousFollowers;

  cardsContainer.innerHTML = "";

  // Top cards (Next to Beat)
  above.forEach(city => {
    const card = document.createElement("div");
    card.className = "card";
    card.textContent = `${city.city}, ${city.country} — ${city.population.toLocaleString()}`;
    cardsContainer.appendChild(card);
  });

  // Current Follower Card
  const followerCard = document.createElement("div");
  followerCard.className = "card follower";
  followerCard.textContent = `Silly Billy Show Followers — ${followers.toLocaleString()}`;
  cardsContainer.appendChild(followerCard);

  // Bottom cards (Bigger Than)
  below.forEach(city => {
    const card = document.createElement("div");
    card.className = "card";
    card.textContent = `${city.city}, ${city.country} — ${city.population.toLocaleString()}`;
    cardsContainer.appendChild(card);
  });

  if (!initial && delta !==0) animateCards(delta);
}

// Simple card slide animation
function animateCards(delta) {
  const allCards = document.querySelectorAll(".cards-container .card");
  allCards.forEach((card, i) => {
    card.style.transform = `translateY(${delta>0? -20:20}px)`;
    card.style.opacity = "0.5";
    setTimeout(() => {
      card.style.transition = "transform 0.8s ease, opacity 0.8s ease";
      card.style.transform = "translateY(0)";
      card.style.opacity = "1";
    }, 50);
  });
}

// Milliseconds until next GMT minute
function msToNextMinute() {
  const now = new Date();
  return (60 - now.getUTCSeconds())*1000 - now.getUTCMilliseconds();
}

// Countdown timer and GMT scheduling
function startClock() {
  function updateTimer() {
    const now = new Date();
    const seconds = now.getUTCSeconds();
    const remain = 60 - seconds;
    countdownEl.textContent = `Next update in ${remain}s`;
    barEl.style.width = ((seconds/60)*100) + "%";
  }
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
