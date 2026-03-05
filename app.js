// app.js
const workerURL = "https://tiktok-follower-api.sillybillyshowemail.workers.dev";

let populationData = [];
let followers = 0;
let previousFollowers = 0;

const CARD_COUNT = 5; // Number of top/bottom cards
const cardsContainer = document.getElementById("cards-container");
const countdownEl = document.getElementById("countdown");
const barEl = document.getElementById("bar");

// Load population data and initial follower count
async function loadData() {
  const popRes = await fetch("populationdata.json");
  populationData = await popRes.json();
  populationData.sort((a,b) => a.population - b.population);

  await getFollowers();          // Initial follower fetch
  renderCards(true);             // Initial render
  startClock();                  // Start countdown
}

// Mock or actual follower fetch
async function getFollowers() {
  // Uncomment below for actual fetch
  /*
  const res = await fetch(workerURL);
  const data = await res.json();
  previousFollowers = followers;
  followers = data.followers;
  */

  // Mock for testing
  previousFollowers = followers;
  followers = previousFollowers === 0 ? 4258 : 4280;
}

// Binary search to find rank index
function findRank(value) {
  let low = 0, high = populationData.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high)/2);
    if (populationData[mid].population < value) low = mid + 1;
    else high = mid -1;
  }
  return low;
}

// Render leaderboard snapshot
function renderCards(initial=false) {
  const index = findRank(followers);
  const oldIndex = findRank(previousFollowers);
  const deltaIndex = index - oldIndex;

  const above = populationData.slice(index, index + CARD_COUNT).reverse(); // Next to beat
  const below = populationData.slice(Math.max(0, index - CARD_COUNT), index).reverse(); // Bigger than

  cardsContainer.innerHTML = "";

  // Top cards
  above.forEach(city => {
    const card = document.createElement("div");
    card.className = "card top-card";
    card.textContent = `${city.city}, ${city.country} — ${city.population.toLocaleString()}`;
    cardsContainer.appendChild(card);
  });

  // Follower card
  const followerCard = document.createElement("div");
  followerCard.className = "card follower";
  followerCard.textContent = `Silly Billy Show Followers — ${followers.toLocaleString()}`;
  cardsContainer.appendChild(followerCard);

  // Bottom cards
  below.forEach(city => {
    const card = document.createElement("div");
    card.className = "card bottom-card";
    card.textContent = `${city.city}, ${city.country} — ${city.population.toLocaleString()}`;
    cardsContainer.appendChild(card);
  });

  if (!initial && deltaIndex !== 0) {
    animateCards(deltaIndex);
    animateFollowerCard(deltaIndex);
  }
}

// Animate surrounding cards sliding past follower card
function animateCards(deltaIndex) {
  const topCards = document.querySelectorAll(".top-card");
  const bottomCards = document.querySelectorAll(".bottom-card");

  const direction = deltaIndex > 0 ? 1 : -1; // 1 = follower up, -1 = follower down
  const moveDistance = 60; // px per card

  const duration = 2000; // 2 seconds animation

  topCards.forEach((card, i) => {
    card.style.transition = `transform ${duration}ms ease, filter ${duration}ms ease`;
    card.style.transform = `translateY(${moveDistance * direction}px)`;
    card.style.filter = "blur(3px)";
    setTimeout(() => {
      card.style.transform = `translateY(0px)`;
      card.style.filter = "blur(0px)";
    }, 50);
  });

  bottomCards.forEach((card, i) => {
    card.style.transition = `transform ${duration}ms ease, filter ${duration}ms ease`;
    card.style.transform = `translateY(${moveDistance * direction}px)`;
    card.style.filter = "blur(3px)";
    setTimeout(() => {
      card.style.transform = `translateY(0px)`;
      card.style.filter = "blur(0px)";
    }, 50);
  });
}

// Animate follower card “dramatic lift”
function animateFollowerCard(deltaIndex) {
  const followerCard = document.querySelector(".card.follower");
  if (!followerCard) return;

  const direction = deltaIndex > 0 ? -1 : 1; // up if followers increased
  const liftDistance = 40; // px
  const durationUp = 800;  // lift up duration
  const durationDown = 1200; // settle down duration

  followerCard.style.transition = `transform ${durationUp}ms ease-out, box-shadow ${durationUp}ms ease-out`;
  followerCard.style.transform = `translateY(${liftDistance * direction}px)`;
  followerCard.style.boxShadow = "0 16px 40px rgba(0,0,0,0.4)";

  setTimeout(() => {
    followerCard.style.transition = `transform ${durationDown}ms ease-in-out, box-shadow ${durationDown}ms ease-in-out`;
    followerCard.style.transform = "translateY(0px)";
    followerCard.style.boxShadow = "0 2px 6px rgba(0,0,0,0.1)";
  }, durationUp);
}

// Milliseconds until next GMT minute
function msToNextMinute() {
  const now = new Date();
  return (60 - now.getUTCSeconds())*1000 - now.getUTCMilliseconds();
}

// Countdown timer + scheduler
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
