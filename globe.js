// globe.js — WebGL globe renderer using Three.js
// Renders all 48,000+ cities as instanced points on a 3D globe.
// The globe surface shows a faint world map drawn from Natural Earth GeoJSON boundaries.
// Cities overtaken are bright green and prominent; the next target is white; others are near-black.
// Supports drag-to-rotate and scroll/pinch-to-zoom.

// ── Constants ─────────────────────────────────────────────────────────────────

// Radius of the globe sphere in Three.js world units
const GLOBE_RADIUS = 1.0;

// How many units above the sphere surface city dots are placed
const DOT_ALTITUDE = 0.006;

// Base dot sizes — larger cities get bigger dots
const DOT_SIZE_SMALL  = 0.005;
const DOT_SIZE_MEDIUM = 0.009;
const DOT_SIZE_LARGE  = 0.015;

// City state colours
const COLOR_OVERTAKEN = new THREE.Color(0x00e676); // vivid green — cities below follower count
const COLOR_NEXT      = new THREE.Color(0xffffff); // white — the very next city to overtake
const COLOR_FUTURE    = new THREE.Color(0x111111); // near-black — cities not yet reached

// Atmosphere halo colour
const COLOR_ATMOSPHERE = new THREE.Color(0x0d2444);

// Auto-rotate speed in radians per frame
const AUTO_ROTATE_SPEED = 0.0007;

// Pulse animation duration in frames when a city is newly overtaken
const PULSE_DURATION = 120;

// Zoom limits — how close and far the camera can get from the globe
const ZOOM_MIN = 1.4;  // closest (zoomed in)
const ZOOM_MAX = 3.2;  // furthest (zoomed out)

// How fast the mouse wheel zooms — smaller = gentler
const ZOOM_SPEED = 0.001;

// GeoJSON source for world country boundaries — Natural Earth via a public CDN
const GEOJSON_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ── Module state ──────────────────────────────────────────────────────────────

let scene, camera, renderer, globeGroup, atmosphereMesh, cityMesh;
let animationId = null;
let isDragging = false;
let previousPointer = { x: 0, y: 0 };
let rotationX = 0;   // current globe rotation around X axis (vertical tilt)
let rotationY = 0;   // current globe rotation around Y axis (horizontal spin)
let autoRotate = true;
let autoRotateTimer = null;
let populationData = [];
let currentFollowers = 0;
let pulsingIndices = new Map(); // cityIndex → framesRemaining

// Pinch-to-zoom tracking
let activeTouches = new Map(); // pointerId → {x, y}
let lastPinchDistance = null;

// Typed arrays reused across colour updates to avoid GC pressure
let colorArray;
let dummy;

// ── Public API ────────────────────────────────────────────────────────────────

// Initialise the globe inside the given container element.
// populationArr must be the same sorted array used by app.js.
// Returns an object with an update(followers) method and a destroy() method.
export async function initGlobe(container, populationArr) {
  populationData = populationArr;

  const width  = container.clientWidth;
  const height = container.clientHeight;

  // ── Scene ──────────────────────────────────────────────────────────────────

  scene = new THREE.Scene();

  // ── Camera ─────────────────────────────────────────────────────────────────

  camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100);
  // Start at a comfortable zoom level showing the full globe
  camera.position.z = 2.6;

  // ── Renderer ───────────────────────────────────────────────────────────────

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  // Cap at 2x pixel ratio — beyond that the gain is imperceptible and the cost is real
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  // ── Globe group ────────────────────────────────────────────────────────────

  // All globe objects share a parent group so rotation is applied once,
  // not repeated across globe + atmosphere + cities separately
  globeGroup = new THREE.Group();
  scene.add(globeGroup);

  // ── Lighting ───────────────────────────────────────────────────────────────

  // Ambient light ensures the dark side of the globe is still faintly visible
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambientLight);

  // Primary directional light simulates sunlight from the upper-right
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
  sunLight.position.set(5, 3, 5);
  scene.add(sunLight);

  // Subtle cool fill light from the opposite side softens the terminator line
  const fillLight = new THREE.DirectionalLight(0x3366aa, 0.15);
  fillLight.position.set(-5, -2, -3);
  scene.add(fillLight);

  // ── World map texture ──────────────────────────────────────────────────────

  // Build the globe map texture from GeoJSON country boundaries, then create the sphere.
  // We fetch the GeoJSON and draw it onto a canvas, then use the canvas as a Three.js texture.
  const mapTexture = await buildMapTexture();

  // ── Globe sphere ───────────────────────────────────────────────────────────

  // 96 segments for a very smooth sphere — the map texture benefits from higher resolution
  const globeGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96);
  const globeMaterial = new THREE.MeshPhongMaterial({
    // The map texture is drawn as land outlines on a dark ocean background
    map: mapTexture,
    shininess: 8,
    specular: new THREE.Color(0x112233),
  });
  const globeMesh = new THREE.Mesh(globeGeometry, globeMaterial);
  globeGroup.add(globeMesh);

  // ── Atmosphere halo ────────────────────────────────────────────────────────

  // Rendered on the back face of a slightly larger sphere to create a rim-light glow
  const atmosphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.07, 64, 64);
  const atmosphereMaterial = new THREE.MeshPhongMaterial({
    color: COLOR_ATMOSPHERE,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.22,
  });
  atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  // The atmosphere doesn't rotate with the globe — it stays fixed around it
  scene.add(atmosphereMesh);

  // ── City dots ──────────────────────────────────────────────────────────────

  buildCityMesh();

  // ── Event listeners ────────────────────────────────────────────────────────

  bindInteraction(container);

  // Resize handler — keeps the canvas and camera in sync with the container
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

  return {
    update: updateFollowers,
    destroy: destroyGlobe,
  };
}

// Called by app.js whenever the follower count changes.
// Marks any newly overtaken cities for pulse animation, then recolours everything.
export function updateFollowers(newFollowers) {
  if (!cityMesh || newFollowers === currentFollowers) return;

  const previousFollowers = currentFollowers;
  currentFollowers = newFollowers;

  // Any city that just crossed the threshold gets a pulse animation
  populationData.forEach((city, i) => {
    if (city.population >= previousFollowers && city.population < newFollowers) {
      pulsingIndices.set(i, PULSE_DURATION);
    }
  });

  recolourCities();
}

// ── Map texture builder ───────────────────────────────────────────────────────

async function buildMapTexture() {
  // Canvas resolution — higher = sharper texture, especially when zoomed in
  const W = 4096;
  const H = 2048;

  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Fill the ocean — very dark navy so the land outlines read clearly
  ctx.fillStyle = "#070f1a";
  ctx.fillRect(0, 0, W, H);

  try {
    // Fetch Natural Earth country boundaries as TopoJSON
    const res  = await fetch(GEOJSON_URL);
    const topo = await res.json();

    // Convert TopoJSON to GeoJSON using the built-in topojson-client algorithm.
    // We implement a minimal TopoJSON decoder inline to avoid a library dependency.
    const countries = topoToGeo(topo, topo.objects.countries);

    // Helper: convert geographic coordinates [lng, lat] to canvas [x, y]
    // Uses an equirectangular (plate carrée) projection — lon/lat map linearly to x/y
    const project = ([lng, lat]) => [
      ((lng + 180) / 360) * W,
      ((90 - lat) / 180) * H,
    ];

    // Draw country fills first — a slightly lighter shade than the ocean
    ctx.fillStyle = "rgba(20, 40, 70, 0.9)";
    countries.features.forEach(feature => {
      drawFeature(ctx, feature, project);
      ctx.fill();
    });

    // Draw country outlines on top — brighter so borders are legible
    ctx.strokeStyle = "rgba(60, 120, 200, 0.55)";
    ctx.lineWidth = 0.8;
    countries.features.forEach(feature => {
      drawFeature(ctx, feature, project);
      ctx.stroke();
    });

  } catch (e) {
    // If the fetch fails (e.g. offline), fall back to a plain textured globe
    console.warn("Globe map texture failed to load — using plain surface", e);
    ctx.fillStyle = "#0a1628";
    ctx.fillRect(0, 0, W, H);
  }

  // Wrap the canvas as a Three.js texture
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Draw a single GeoJSON feature (Polygon or MultiPolygon) onto a canvas context
function drawFeature(ctx, feature, project) {
  ctx.beginPath();
  const geom = feature.geometry;
  if (!geom) return;

  const rings = geom.type === "Polygon"
    ? geom.coordinates
    : geom.type === "MultiPolygon"
      ? geom.coordinates.flat(1)
      : [];

  rings.forEach(ring => {
    ring.forEach(([lng, lat], i) => {
      const [x, y] = project([lng, lat]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
  });
}

// Minimal TopoJSON → GeoJSON converter (supports arcs only, no quantization delta encoding)
function topoToGeo(topology, object) {
  const arcs = topology.arcs;

  // TopoJSON stores coordinates as delta-encoded integers — decode them into absolute positions
  const decodedArcs = arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      // Apply the topology transform to convert back to geographic coordinates
      const lng = x * topology.transform.scale[0] + topology.transform.translate[0];
      const lat = y * topology.transform.scale[1] + topology.transform.translate[1];
      return [lng, lat];
    });
  });

  function arcToCoords(index) {
    // Negative indices reference the arc in reverse
    if (index < 0) return decodedArcs[~index].slice().reverse();
    return decodedArcs[index].slice();
  }

  function geometryToFeature(geom) {
    if (geom.type === "Polygon") {
      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          // Each ring is a sequence of arc index arrays joined end-to-end
          coordinates: geom.arcs.map(ring => ring.flatMap(arcToCoords)),
        },
        properties: geom.properties || {},
      };
    }
    if (geom.type === "MultiPolygon") {
      return {
        type: "Feature",
        geometry: {
          type: "MultiPolygon",
          coordinates: geom.arcs.map(polygon =>
            polygon.map(ring => ring.flatMap(arcToCoords))
          ),
        },
        properties: geom.properties || {},
      };
    }
    return null;
  }

  // The top-level object is a GeometryCollection containing all countries
  const features = (object.geometries || [])
    .map(geometryToFeature)
    .filter(Boolean);

  return { type: "FeatureCollection", features };
}

// ── City mesh builder ─────────────────────────────────────────────────────────

function buildCityMesh() {
  const count = populationData.length;

  // A flat circle (disk) geometry reads more clearly than a sphere at small sizes
  // CircleGeometry: radius=1, 6 segments (hexagon approximation — efficient and clean)
  const dotGeometry = new THREE.CircleGeometry(1, 6);

  // MeshBasicMaterial ignores lighting — dots appear at full brightness regardless of globe shading.
  // This makes green/white dots pop against the dark surface even on the unlit side.
  const dotMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  cityMesh = new THREE.InstancedMesh(dotGeometry, dotMaterial, count);
  cityMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Pre-allocate the colour buffer — reused on every update to avoid allocations
  colorArray = new Float32Array(count * 3);
  dummy = new THREE.Object3D();

  // Place every city on the globe surface at its lat/lng
  populationData.forEach((city, i) => {
    positionInstance(i, city.lat, city.lng, dotSizeForPopulation(city.population));
  });

  cityMesh.instanceMatrix.needsUpdate = true;

  // Apply initial colours — all cities start as future (dark) before follower data arrives
  recolourCities();

  // Add the city mesh to the group so it rotates with the globe
  globeGroup.add(cityMesh);
}

function positionInstance(index, lat, lng, size) {
  // Convert lat/lng to a point on the sphere surface using spherical coordinates
  const phi   = (90 - lat)  * (Math.PI / 180); // polar angle, 0 = north pole
  const theta = (lng + 180) * (Math.PI / 180); // azimuthal angle

  const r = GLOBE_RADIUS + DOT_ALTITUDE;

  dummy.position.set(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );

  dummy.scale.setScalar(size);

  // Orient the disk so it lies flat on the globe surface (normal points outward)
  dummy.lookAt(0, 0, 0);
  dummy.rotateX(Math.PI);

  dummy.updateMatrix();
  cityMesh.setMatrixAt(index, dummy.matrix);
}

// ── Colour management ─────────────────────────────────────────────────────────

function recolourCities() {
  if (!cityMesh) return;

  const color = new THREE.Color();
  const nextIndex = findNextIndex(currentFollowers);

  populationData.forEach((city, i) => {
    if (city.population < currentFollowers) {
      // Overtaken — vivid green, scaled up so they read clearly against the dark surface
      color.copy(COLOR_OVERTAKEN);
      positionInstance(i, city.lat, city.lng, dotSizeForPopulation(city.population) * 1.6);
    } else if (i === nextIndex) {
      // Next target — white, scaled up even more to stand out
      color.copy(COLOR_NEXT);
      positionInstance(i, city.lat, city.lng, dotSizeForPopulation(city.population) * 2.2);
    } else {
      // Not yet reached — near-black so they're present but not distracting
      color.copy(COLOR_FUTURE);
      positionInstance(i, city.lat, city.lng, dotSizeForPopulation(city.population));
    }

    color.toArray(colorArray, i * 3);
  });

  // Upload the full colour buffer to the GPU in a single operation
  cityMesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray.slice(), 3);
  cityMesh.instanceColor.needsUpdate = true;
  cityMesh.instanceMatrix.needsUpdate = true;
}

// ── Animation loop ────────────────────────────────────────────────────────────

function startAnimationLoop() {
  const pulseColor = new THREE.Color();

  function animate() {
    animationId = requestAnimationFrame(animate);

    // Slowly auto-rotate around Y axis when not interacting
    if (autoRotate) {
      rotationY += AUTO_ROTATE_SPEED;
    }

    // Apply accumulated rotation to the whole group
    globeGroup.rotation.x = rotationX;
    globeGroup.rotation.y = rotationY;

    // Tick pulse animations for newly overtaken cities
    if (pulsingIndices.size > 0) {
      let dirty = false;

      pulsingIndices.forEach((framesLeft, cityIndex) => {
        const progress = framesLeft / PULSE_DURATION;
        // Pulse oscillates between green and a bright yellow-white using sine
        const pulse = Math.abs(Math.sin(progress * Math.PI * 5));
        // Interpolate between green (0,0.9,0.46) and white (1,1,1)
        pulseColor.setRGB(
          pulse,
          0.9 + pulse * 0.1,
          pulse * 0.46
        );
        pulseColor.toArray(colorArray, cityIndex * 3);

        const remaining = framesLeft - 1;
        if (remaining <= 0) {
          pulsingIndices.delete(cityIndex);
          // Settle to the final green colour
          COLOR_OVERTAKEN.toArray(colorArray, cityIndex * 3);
        } else {
          pulsingIndices.set(cityIndex, remaining);
        }
        dirty = true;
      });

      if (dirty && cityMesh.instanceColor) {
        cityMesh.instanceColor.needsUpdate = true;
      }
    }

    renderer.render(scene, camera);
  }

  animate();
}

// ── Interaction ───────────────────────────────────────────────────────────────

function bindInteraction(container) {
  // ── Drag to rotate ──────────────────────────────────────────────────────────

  container.addEventListener("pointerdown", e => {
    // Track all active touch points for pinch-zoom detection
    activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Only treat as a drag if it's a single touch/pointer
    if (activeTouches.size === 1) {
      isDragging = true;
      stopAutoRotate();
      previousPointer = { x: e.clientX, y: e.clientY };
      container.setPointerCapture(e.pointerId);
    }
  });

  container.addEventListener("pointermove", e => {
    // Update stored touch position for pinch calculation
    if (activeTouches.has(e.pointerId)) {
      activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Handle pinch-to-zoom when two fingers are active
    if (activeTouches.size === 2) {
      isDragging = false;
      const [a, b] = [...activeTouches.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);

      if (lastPinchDistance !== null) {
        // Positive delta = fingers spreading = zoom in (decrease camera.position.z)
        const delta = lastPinchDistance - dist;
        applyZoom(delta * 0.008);
      }
      lastPinchDistance = dist;
      return;
    }

    // Single pointer drag — rotate the globe
    if (!isDragging) return;
    const dx = e.clientX - previousPointer.x;
    const dy = e.clientY - previousPointer.y;
    rotationY += dx * 0.005;
    rotationX += dy * 0.005;
    // Clamp vertical rotation to prevent the globe from flipping over
    rotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotationX));
    previousPointer = { x: e.clientX, y: e.clientY };
  });

  container.addEventListener("pointerup", e => {
    activeTouches.delete(e.pointerId);
    isDragging = false;
    lastPinchDistance = null;
    scheduleAutoRotateResume();
  });

  container.addEventListener("pointercancel", e => {
    activeTouches.delete(e.pointerId);
    isDragging = false;
    lastPinchDistance = null;
  });

  container.addEventListener("pointerleave", e => {
    if (activeTouches.has(e.pointerId)) {
      activeTouches.delete(e.pointerId);
      isDragging = false;
      lastPinchDistance = null;
      scheduleAutoRotateResume();
    }
  });

  // ── Scroll / wheel to zoom ──────────────────────────────────────────────────

  container.addEventListener("wheel", e => {
    e.preventDefault();
    // deltaY > 0 = scroll down = zoom out; < 0 = scroll up = zoom in
    applyZoom(e.deltaY * ZOOM_SPEED);
    stopAutoRotate();
    scheduleAutoRotateResume();
  }, { passive: false });

  // Prevent browser context menu on right-click drag
  container.addEventListener("contextmenu", e => e.preventDefault());
}

function applyZoom(delta) {
  // Move the camera closer or further along the Z axis, clamped to defined limits
  camera.position.z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camera.position.z + delta));
}

function stopAutoRotate() {
  autoRotate = false;
  if (autoRotateTimer) {
    clearTimeout(autoRotateTimer);
    autoRotateTimer = null;
  }
}

function scheduleAutoRotateResume() {
  // Resume auto-rotation 2.5 seconds after the user stops interacting
  if (autoRotateTimer) clearTimeout(autoRotateTimer);
  autoRotateTimer = setTimeout(() => { autoRotate = true; }, 2500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dotSizeForPopulation(population) {
  // Three tiers — larger cities get bigger dots so they're legible when zoomed out
  if (population >= 5_000_000)  return DOT_SIZE_LARGE;
  if (population >= 500_000)    return DOT_SIZE_MEDIUM;
  return DOT_SIZE_SMALL;
}

function findNextIndex(followers) {
  // Binary search for the index of the first city with population >= followers
  let lo = 0, hi = populationData.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    populationData[mid].population < followers ? lo = mid + 1 : hi = mid - 1;
  }
  return lo < populationData.length ? lo : -1;
}

function destroyGlobe() {
  // Cancel the animation loop and release GPU resources
  if (animationId) cancelAnimationFrame(animationId);
  if (autoRotateTimer) clearTimeout(autoRotateTimer);
  renderer.dispose();
}
