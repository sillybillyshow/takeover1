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
      duration: 360,
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
      duration: 900,
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
        duration: 950,
        delay: Math.min(distance * 18, 140),
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      }
    );
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
