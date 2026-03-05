// app.js
const workerURL = "https://tiktok-follower-api.sillybillyshowemail.workers.dev";

let populationData = [];
let followers = 0;
let previousFollowers = 0;

const CARD_COUNT = 5;
const cardsContainer = document.getElementById("cards-container");
const countdownEl = document.getElementById("countdown");
const barEl = document.getElementById("bar");

async function loadData() {
  const popRes = await fetch("populationdata.json");
  populationData = await popRes.json();
  populationData.sort((a,b) => a.population - b.population);

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
  let low = 0, high = populationData.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high)/2);
    if (populationData[mid].population < value) low = mid + 1;
    else high = mid -1;
  }
  return low;
}

// Render cards snapshot
function renderCards(initial=false) {
  const index = findRank(followers);
  const oldIndex = findRank(previousFollowers);
  const deltaIndex = index - oldIndex;

  const above = populationData.slice(index, index + CARD_COUNT).reverse();
  const below = populationData.slice(Math.max(0, index - CARD_COUNT), index).reverse();

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
    animateOvertaking(deltaIndex);
  }
}

// Overtaking animation sequence
function animateOvertaking(deltaIndex) {
  const followerCard = document.querySelector(".card.follower");
  const topCards = document.querySelectorAll(".top-card");
  const bottomCards = document.querySelectorAll(".bottom-card");

  if (!followerCard) return;

  const direction = deltaIndex > 0 ? 1 : -1; // 1 = follower increased (cards move down), -1 = follower decreased
  const liftDistance = 50;
  const moveDistance = 60; // px per card
  const liftDuration = 500;
  const moveDuration = 2000;
  const settleDuration = 700;

  // 1️⃣ Lift follower card
  followerCard.style.transition = `transform ${liftDuration}ms ease-out, box-shadow ${liftDuration}ms ease-out`;
  followerCard.style.transform = `translateY(${-liftDistance * direction}px)`;
  followerCard.style.boxShadow = "0 20px 50px rgba(0,0,0,0.4)";

  // 2️⃣ Move top/bottom cards after lift
  setTimeout(() => {
    topCards.forEach(card => {
      card.style.transition = `transform ${moveDuration}ms ease, filter ${moveDuration}ms ease`;
      card.style.transform = `translateY(${moveDistance * direction}px)`;
      card.style.filter = "blur(4px)";
      setTimeout(() => {
        card.style.transform = "translateY(0px)";
        card.style.filter = "blur(0px)";
      }, 50);
    });

    bottomCards.forEach(card => {
      card.style.transition = `transform ${moveDuration}ms ease, filter ${moveDuration}ms ease`;
      card.style.transform = `translateY(${moveDistance * direction}px)`;
      card.style.filter = "blur(4px)";
      setTimeout(() => {
        card.style.transform = "translateY(0px)";
        card.style.filter = "blur(0px)";
      }, 50);
    });

  }, liftDuration);

  // 3️⃣ Settle follower card after cards moved
  setTimeout(() => {
    followerCard.style.transition = `transform ${settleDuration}ms ease-in-out, box-shadow ${settleDuration}ms ease-in-out`;
    followerCard.style.transform = "translateY(0px)";
    followerCard.style.boxShadow = "0 2px 6px rgba(0,0,0,0.1)";
  }, liftDuration + moveDuration);
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
