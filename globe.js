// globe.js — WebGL globe renderer using Three.js
// Renders all 48,000+ cities as instanced points on a 3D globe.
// Cities below the follower count are dimmed; cities just overtaken pulse red;
// the city immediately next to overtake glows white.
// Designed to be initialised once from app.js and updated whenever the follower count changes.

// ── Constants ─────────────────────────────────────────────────────────────────

// Radius of the globe sphere in Three.js world units
const GLOBE_RADIUS = 1.0;

// How many units above the sphere surface city dots are placed
const DOT_ALTITUDE = 0.008;

// Base sizes for city dots — population drives which tier a city falls into
const DOT_SIZE_SMALL  = 0.004;
const DOT_SIZE_MEDIUM = 0.007;
const DOT_SIZE_LARGE  = 0.012;

// Colours used for city states
const COLOR_OVERTAKEN   = new THREE.Color(0xff0050); // brand red — cities below follower count
const COLOR_NEXT        = new THREE.Color(0xffffff); // white — the next city to overtake
const COLOR_FUTURE      = new THREE.Color(0x334466); // muted blue — cities not yet reached
const COLOR_ATMOSPHERE  = new THREE.Color(0x1a3a6b); // deep blue atmosphere halo
const COLOR_GLOBE_BASE  = new THREE.Color(0x0a1628); // very dark ocean colour

// Auto-rotate speed in radians per frame
const AUTO_ROTATE_SPEED = 0.0008;

// How many frames a pulse animation lasts when a city is overtaken
const PULSE_DURATION = 90;

// ── Module state ──────────────────────────────────────────────────────────────

let scene, camera, renderer, globe, cityMesh, atmosphereMesh;
let animationId = null;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let targetRotationX = 0;
let targetRotationY = 0;
let currentRotationX = 0;
let currentRotationY = 0;
let autoRotate = true;
let populationData = [];
let currentFollowers = 0;
let pulsingIndices = new Map(); // cityIndex → framesRemaining

// Typed arrays for instanced mesh colour updates — reused to avoid GC pressure
let colorArray;
let dummy;

// ── Public API ────────────────────────────────────────────────────────────────

// Initialise the globe inside the given container element.
// populationArr must be the same sorted array used by app.js.
// Returns an object with an update(followers) method.
export function initGlobe(container, populationArr) {
  populationData = populationArr;

  // Measure the container so the canvas fills it exactly
  const width  = container.clientWidth;
  const height = container.clientHeight;

  // ── Scene ──────────────────────────────────────────────────────────────────

  scene = new THREE.Scene();

  // ── Camera ─────────────────────────────────────────────────────────────────

  camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100);
  // Pull the camera back far enough to see the whole globe with some breathing room
  camera.position.z = 2.6;

  // ── Renderer ───────────────────────────────────────────────────────────────

  renderer = new THREE.WebGLRenderer({
    // Antialiasing smooths the edges of the sphere and dots
    antialias: true,
    // Transparent background so the page background shows through
    alpha: true,
  });
  renderer.setSize(width, height);
  // Respect device pixel ratio up to 2x for sharp rendering on retina screens
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  // ── Globe sphere ───────────────────────────────────────────────────────────

  // 64 segments gives a smooth sphere without excessive vertex count
  const globeGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
  const globeMaterial = new THREE.MeshPhongMaterial({
    color: COLOR_GLOBE_BASE,
    shininess: 15,
    transparent: true,
    opacity: 0.97,
  });
  globe = new THREE.Mesh(globeGeometry, globeMaterial);
  scene.add(globe);

  // ── Atmosphere halo ────────────────────────────────────────────────────────

  // A slightly larger transparent sphere behind the globe creates a soft glow effect
  const atmosphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.08, 64, 64);
  const atmosphereMaterial = new THREE.MeshPhongMaterial({
    color: COLOR_ATMOSPHERE,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.25,
  });
  atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  scene.add(atmosphereMesh);

  // ── Lighting ───────────────────────────────────────────────────────────────

  // Ambient light lifts the shadow side so it's not completely black
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambientLight);

  // Directional light simulates a distant sun, creating the lit/shadow hemisphere effect
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
  sunLight.position.set(5, 3, 5);
  scene.add(sunLight);

  // Subtle fill light from the opposite side softens harsh shadows
  const fillLight = new THREE.DirectionalLight(0x4488ff, 0.2);
  fillLight.position.set(-5, -2, -3);
  scene.add(fillLight);

  // ── City dots ──────────────────────────────────────────────────────────────

  buildCityMesh();

  // ── Grid lines (latitude/longitude) ────────────────────────────────────────

  buildGridLines();

  // ── Event listeners ────────────────────────────────────────────────────────

  bindInteraction(container);

  // Resize the renderer and camera when the container changes size
  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(container);

  // ── Animation loop ─────────────────────────────────────────────────────────

  startAnimationLoop();

  // Return the public API so app.js can drive follower updates
  return {
    update: updateFollowers,
    destroy: destroyGlobe,
  };
}

// Called by app.js whenever the follower count changes.
// Recolours all city dots to reflect the new ranking and triggers pulse animations
// on any cities that have just been overtaken.
export function updateFollowers(newFollowers) {
  if (!cityMesh || newFollowers === currentFollowers) return;

  const previousFollowers = currentFollowers;
  currentFollowers = newFollowers;

  // Find cities that moved from above to below the follower count —
  // these are the ones that have just been overtaken and should pulse
  populationData.forEach((city, i) => {
    if (city.population >= previousFollowers && city.population < newFollowers) {
      pulsingIndices.set(i, PULSE_DURATION);
    }
  });

  recolourCities();
}

// ── Internal builders ─────────────────────────────────────────────────────────

function buildCityMesh() {
  const count = populationData.length;

  // Use a small sphere for each city dot — instanced rendering means all 48k dots
  // are drawn in a single GPU draw call rather than one per city
  const dotGeometry = new THREE.SphereGeometry(1, 5, 5);

  // MeshPhongMaterial responds to lighting, giving dots depth
  const dotMaterial = new THREE.MeshPhongMaterial({
    vertexColors: true,
    shininess: 30,
  });

  cityMesh = new THREE.InstancedMesh(dotGeometry, dotMaterial, count);
  cityMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Allocate a colour array once and reuse it throughout the session
  colorArray = new Float32Array(count * 3);
  dummy = new THREE.Object3D();

  // Position every city dot on the globe surface based on its lat/lng
  populationData.forEach((city, i) => {
    positionInstance(i, city.lat, city.lng, dotSizeForPopulation(city.population));
  });

  cityMesh.instanceMatrix.needsUpdate = true;

  // Set initial colours — all cities start in the future (not yet overtaken) state
  recolourCities();

  scene.add(cityMesh);
}

function positionInstance(index, lat, lng, size) {
  // Convert geographic coordinates to a 3D position on the sphere surface
  const phi   = (90 - lat) * (Math.PI / 180);   // polar angle from north pole
  const theta = (lng + 180) * (Math.PI / 180);   // azimuthal angle

  const r = GLOBE_RADIUS + DOT_ALTITUDE;

  dummy.position.set(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );

  // Scale the dummy object uniformly to the desired dot size
  dummy.scale.setScalar(size);

  // Orient the dot so it points outward from the globe centre (faces the camera)
  dummy.lookAt(0, 0, 0);
  dummy.rotateX(Math.PI);

  dummy.updateMatrix();
  cityMesh.setMatrixAt(index, dummy.matrix);
}

function recolourCities() {
  if (!cityMesh) return;

  const color = new THREE.Color();

  // Find the index of the next city to overtake — it gets a special highlight
  const nextIndex = findNextIndex(currentFollowers);

  populationData.forEach((city, i) => {
    if (city.population < currentFollowers) {
      // This city has been overtaken — show in brand red
      color.copy(COLOR_OVERTAKEN);
      // Scale up slightly to make overtaken cities more visible
      positionInstance(i, city.lat, city.lng, dotSizeForPopulation(city.population) * 1.4);
    } else if (i === nextIndex) {
      // This is the next city to overtake — highlight in white
      color.copy(COLOR_NEXT);
      positionInstance(i, city.lat, city.lng, dotSizeForPopulation(city.population) * 1.8);
    } else {
      // Not yet reached — dim blue-grey
      color.copy(COLOR_FUTURE);
      positionInstance(i, city.lat, city.lng, dotSizeForPopulation(city.population));
    }

    color.toArray(colorArray, i * 3);
  });

  // Upload the entire colour buffer to the GPU in one operation
  cityMesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
  cityMesh.instanceColor.needsUpdate = true;
  cityMesh.instanceMatrix.needsUpdate = true;
}

function buildGridLines() {
  // Render subtle latitude and longitude lines to give the globe geographic context
  const material = new THREE.LineBasicMaterial({
    color: 0x1a3a5c,
    transparent: true,
    opacity: 0.3,
  });

  const r = GLOBE_RADIUS + 0.001;

  // Latitude lines every 30 degrees
  for (let lat = -60; lat <= 60; lat += 30) {
    const points = [];
    const phi = (90 - lat) * (Math.PI / 180);
    for (let lng = 0; lng <= 360; lng += 2) {
      const theta = (lng + 180) * (Math.PI / 180);
      points.push(new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(theta),
         r * Math.cos(phi),
         r * Math.sin(phi) * Math.sin(theta)
      ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    scene.add(new THREE.Line(geometry, material));
  }

  // Longitude lines every 60 degrees
  for (let lng = 0; lng < 360; lng += 60) {
    const points = [];
    const theta = (lng + 180) * (Math.PI / 180);
    for (let lat = -90; lat <= 90; lat += 2) {
      const phi = (90 - lat) * (Math.PI / 180);
      points.push(new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(theta),
         r * Math.cos(phi),
         r * Math.sin(phi) * Math.sin(theta)
      ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    scene.add(new THREE.Line(geometry, material));
  }
}

// ── Animation loop ────────────────────────────────────────────────────────────

function startAnimationLoop() {
  const color = new THREE.Color();

  function animate() {
    animationId = requestAnimationFrame(animate);

    // Auto-rotate the globe slowly when the user isn't interacting
    if (autoRotate) {
      globe.rotation.y      += AUTO_ROTATE_SPEED;
      atmosphereMesh.rotation.y += AUTO_ROTATE_SPEED;
      cityMesh.rotation.y   += AUTO_ROTATE_SPEED;
    }

    // Apply smooth inertia to manual rotation so dragging feels fluid
    if (isDragging) {
      globe.rotation.x      = currentRotationX;
      globe.rotation.y      = currentRotationY;
      atmosphereMesh.rotation.x = currentRotationX;
      atmosphereMesh.rotation.y = currentRotationY;
      cityMesh.rotation.x   = currentRotationX;
      cityMesh.rotation.y   = currentRotationY;
    }

    // Animate any pulsing cities — their colour oscillates between red and white
    if (pulsingIndices.size > 0) {
      let anyPulsing = false;

      pulsingIndices.forEach((framesLeft, cityIndex) => {
        const progress = framesLeft / PULSE_DURATION;
        // Oscillate between red and a bright orange-white using sine
        const pulse = Math.sin(progress * Math.PI * 4) * 0.5 + 0.5;
        color.setRGB(1, pulse * 0.4, pulse * 0.1);
        color.toArray(colorArray, cityIndex * 3);

        const remaining = framesLeft - 1;
        if (remaining <= 0) {
          pulsingIndices.delete(cityIndex);
          // Settle the city back to its final overtaken colour
          COLOR_OVERTAKEN.toArray(colorArray, cityIndex * 3);
        } else {
          pulsingIndices.set(cityIndex, remaining);
        }
        anyPulsing = true;
      });

      if (anyPulsing) {
        cityMesh.instanceColor.needsUpdate = true;
      }
    }

    renderer.render(scene, camera);
  }

  animate();
}

// ── Interaction ───────────────────────────────────────────────────────────────

function bindInteraction(container) {
  // Track whether the pointer is down so we can distinguish drag from click
  container.addEventListener("pointerdown", e => {
    isDragging = true;
    autoRotate = false;
    previousMousePosition = { x: e.clientX, y: e.clientY };
    // Sync rotation state to whatever the globe is currently showing
    currentRotationX = globe.rotation.x;
    currentRotationY = globe.rotation.y;
  });

  container.addEventListener("pointermove", e => {
    if (!isDragging) return;
    const dx = e.clientX - previousMousePosition.x;
    const dy = e.clientY - previousMousePosition.y;
    // Scale the drag delta to a rotation amount — smaller divisor = more sensitive
    currentRotationY += dx * 0.005;
    currentRotationX += dy * 0.005;
    // Clamp vertical rotation so the globe doesn't flip upside down
    currentRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, currentRotationX));
    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  container.addEventListener("pointerup", () => {
    isDragging = false;
    // Resume auto-rotation after the user stops interacting
    setTimeout(() => { autoRotate = true; }, 2000);
  });

  container.addEventListener("pointerleave", () => {
    if (isDragging) {
      isDragging = false;
      setTimeout(() => { autoRotate = true; }, 2000);
    }
  });

  // Prevent context menu appearing on right-click drag
  container.addEventListener("contextmenu", e => e.preventDefault());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dotSizeForPopulation(population) {
  // Larger cities get bigger dots so major population centres are more visible
  if (population >= 5_000_000)  return DOT_SIZE_LARGE;
  if (population >= 500_000)    return DOT_SIZE_MEDIUM;
  return DOT_SIZE_SMALL;
}

function findNextIndex(followers) {
  // Binary search for the first city with population >= followers
  let lo = 0, hi = populationData.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    populationData[mid].population < followers ? lo = mid + 1 : hi = mid - 1;
  }
  return lo < populationData.length ? lo : -1;
}

function destroyGlobe() {
  // Clean up WebGL resources and cancel the animation loop
  if (animationId) cancelAnimationFrame(animationId);
  renderer.dispose();
}
