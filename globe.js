// globe.js — WebGL globe renderer using Three.js r128
// All cities rendered as tiny instanced flat disks in a single GPU draw call.
// World map drawn from TopoJSON onto a canvas texture.
// Green = overtaken (population below follower count), black = not yet overtaken.
// Supports drag-to-rotate, scroll-to-zoom, and pinch-to-zoom on mobile.

// ── Constants ─────────────────────────────────────────────────────────────────

const GLOBE_RADIUS     = 1.0;
const DOT_ALTITUDE     = 0.010;
const DOT_SIZE_SMALL   = 0.0024;
const DOT_SIZE_MEDIUM  = 0.0030;
const DOT_SIZE_LARGE   = 0.0038;

// City state colours
const COLOR_OVERTAKEN  = new THREE.Color(0x00e676);
const COLOR_FUTURE     = new THREE.Color(0x050505);

const AUTO_ROTATE_SPEED = 0.0007;
const PULSE_DURATION    = 120;   // frames
const ZOOM_MIN          = 1.3;   // closest camera Z
const ZOOM_MAX          = 3.5;   // furthest camera Z

// Natural Earth TopoJSON — 110m resolution, compact, reliable CDN
const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ── Module state ──────────────────────────────────────────────────────────────

let scene, camera, renderer, globeGroup, cityMesh;
let animationId      = null;
let populationData   = [];
let currentFollowers = 0;
let pulsingIndices   = new Map();  // index → framesRemaining
let colorArray, dummy;

// Rotation state
let rotX = 0, rotY = 0;
let isDragging    = false;
let prevPointer   = { x: 0, y: 0 };
let autoRotate    = true;
let resumeTimer   = null;

// Pinch state — keyed by pointerId
let touches       = new Map();
let lastPinchDist = null;

// ── Public API ────────────────────────────────────────────────────────────────

// Initialise the globe. Returns { update(followers), destroy() }.
// Must be awaited — the map texture fetch is async.
export async function initGlobe(container, populationArr) {
  populationData = populationArr;

  const W = container.clientWidth;
  const H = container.clientHeight;

  // ── Scene & camera ─────────────────────────────────────────────────────────

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100);
  camera.position.z = 2.6;

  // ── Renderer ───────────────────────────────────────────────────────────────

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  // ── Lighting ───────────────────────────────────────────────────────────────

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(5, 3, 5);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x4488ff, 0.12);
  fill.position.set(-5, -2, -3);
  scene.add(fill);

  // ── Globe group — all rotating objects are children of this ───────────────

  globeGroup = new THREE.Group();
  scene.add(globeGroup);

  // ── World map texture (async) ──────────────────────────────────────────────

  const mapTexture = await buildMapTexture();

  // ── Globe sphere ───────────────────────────────────────────────────────────

  const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96);
  const sphereMat = new THREE.MeshPhongMaterial({
    map:       mapTexture,
    shininess: 6,
    specular:  new THREE.Color(0x0a1a33),
  });
  globeGroup.add(new THREE.Mesh(sphereGeo, sphereMat));

  // ── Atmosphere halo — back-face sphere just outside the globe ─────────────

  const atmoGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.06, 64, 64);
  const atmoMat = new THREE.MeshPhongMaterial({
    color:       new THREE.Color(0x0d2444),
    side:        THREE.BackSide,
    transparent: true,
    opacity:     0.20,
  });
  scene.add(new THREE.Mesh(atmoGeo, atmoMat));

  // ── City dots ──────────────────────────────────────────────────────────────

  buildCityMesh();

  // ── Interaction & resize ───────────────────────────────────────────────────

  bindInteraction(container);

  new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }).observe(container);

  // ── Animation loop ─────────────────────────────────────────────────────────

  startLoop();

  return { update: updateFollowers, destroy };
}

// Called by app.js on every follower count change
export function updateFollowers(next) {
  if (!cityMesh || next === currentFollowers) return;
  const prev = currentFollowers;
  currentFollowers = next;

  // Mark newly overtaken cities for pulse animation
  populationData.forEach((city, i) => {
    if (city.population >= prev && city.population < next) {
      pulsingIndices.set(i, PULSE_DURATION);
    }
  });

  recolour();
}

// ── Map texture ───────────────────────────────────────────────────────────────

async function buildMapTexture() {
  const TW = 4096;
  const TH = 2048;
  const canvas = document.createElement("canvas");
  canvas.width  = TW;
  canvas.height = TH;
  const ctx = canvas.getContext("2d");

  // Deep ocean background
  ctx.fillStyle = "#060e1a";
  ctx.fillRect(0, 0, TW, TH);

  try {
    const res  = await fetch(TOPO_URL);
    const topo = await res.json();
    const geo  = topoToGeo(topo, topo.objects.countries);

    // Equirectangular projection: lng→x, lat→y
    const project = ([lng, lat]) => [
      ((lng + 180) / 360) * TW,
      ((90 - lat)  / 180) * TH,
    ];

    // Land fills
    ctx.fillStyle = "rgba(18, 38, 68, 0.95)";
    geo.features.forEach(f => {
      drawFeature(ctx, f, project);
      ctx.fill();
    });

    // Country outlines
    ctx.strokeStyle = "rgba(80, 150, 230, 0.45)";
    ctx.lineWidth   = 0.9;
    geo.features.forEach(f => {
      drawFeature(ctx, f, project);
      ctx.stroke();
    });

  } catch (err) {
    console.warn("Globe map fetch failed, using plain surface", err);
    ctx.fillStyle = "#091422";
    ctx.fillRect(0, 0, TW, TH);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Draw a GeoJSON Feature (Polygon or MultiPolygon) onto a 2D canvas context
function drawFeature(ctx, feature, project) {
  if (!feature.geometry) return;
  ctx.beginPath();
  const { type, coordinates } = feature.geometry;
  const rings = type === "Polygon"
    ? coordinates
    : type === "MultiPolygon"
      ? coordinates.flat(1)
      : [];

  rings.forEach(ring => {
    ring.forEach(([lng, lat], i) => {
      const [x, y] = project([lng, lat]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  });
}

// Minimal TopoJSON → GeoJSON converter — handles delta-encoded arcs + transform
function topoToGeo(topo, obj) {
  const { scale, translate } = topo.transform;

  const decoded = topo.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });

  const arcCoords = i => (i < 0 ? decoded[~i].slice().reverse() : decoded[i].slice());

  const toFeature = geom => {
    if (geom.type === "Polygon") {
      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: geom.arcs.map(ring => ring.flatMap(arcCoords)),
        },
        properties: {},
      };
    }
    if (geom.type === "MultiPolygon") {
      return {
        type: "Feature",
        geometry: {
          type: "MultiPolygon",
          coordinates: geom.arcs.map(p => p.map(ring => ring.flatMap(arcCoords))),
        },
        properties: {},
      };
    }
    return null;
  };

  return {
    type: "FeatureCollection",
    features: (obj.geometries || []).map(toFeature).filter(Boolean),
  };
}

// ── City mesh ─────────────────────────────────────────────────────────────────

function buildCityMesh() {
  const count = populationData.length;

  // Flat hexagonal disk — renders as a circle at small sizes, very cheap
  const geo = new THREE.CircleGeometry(1, 7);

  // MeshBasicMaterial ignores lighting so dot colours stay crisp
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side:         THREE.DoubleSide,
    depthWrite:   false,
  });

  cityMesh = new THREE.InstancedMesh(geo, mat, count);
  cityMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cityMesh.renderOrder = 1;

  colorArray = new Float32Array(count * 3);
  dummy      = new THREE.Object3D();

  populationData.forEach((city, i) => {
    placeInstance(i, city.lat, city.lng, sizeFor(city.population));
  });
  cityMesh.instanceMatrix.needsUpdate = true;

  recolour();
  globeGroup.add(cityMesh);
}

// Convert lat/lng → 3D position on the sphere, oriented outward, sized to `sz`
function placeInstance(i, lat, lng, sz) {
  const phi   = (90 - lat)  * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const r     = GLOBE_RADIUS + DOT_ALTITUDE;

  dummy.position.set(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
  dummy.scale.setScalar(sz);
  dummy.lookAt(0, 0, 0);
  dummy.rotateX(Math.PI);
  dummy.updateMatrix();
  cityMesh.setMatrixAt(i, dummy.matrix);
}

// Recolour all city instances to reflect current follower count
function recolour() {
  if (!cityMesh) return;

  populationData.forEach((city, i) => {
    if (city.population < currentFollowers) {
      COLOR_OVERTAKEN.toArray(colorArray, i * 3);
    } else {
      COLOR_FUTURE.toArray(colorArray, i * 3);
    }
  });

  cityMesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray.slice(), 3);
  cityMesh.instanceColor.needsUpdate = true;
  cityMesh.instanceMatrix.needsUpdate = true;
}

// ── Animation loop ────────────────────────────────────────────────────────────

function startLoop() {
  const pulseColor = new THREE.Color();

  function tick() {
    animationId = requestAnimationFrame(tick);

    if (autoRotate) rotY += AUTO_ROTATE_SPEED;

    globeGroup.rotation.x = rotX;
    globeGroup.rotation.y = rotY;

    if (pulsingIndices.size > 0 && cityMesh?.instanceColor) {
      let dirty = false;

      pulsingIndices.forEach((left, idx) => {
        const t = left / PULSE_DURATION;
        const p = Math.abs(Math.sin(t * Math.PI * 5));
        pulseColor.setRGB(0.0, 0.82 + p * 0.18, 0.22 + p * 0.18);
        pulseColor.toArray(colorArray, idx * 3);

        const rem = left - 1;
        if (rem <= 0) {
          pulsingIndices.delete(idx);
          COLOR_OVERTAKEN.toArray(colorArray, idx * 3);
        } else {
          pulsingIndices.set(idx, rem);
        }

        dirty = true;
      });

      if (dirty) cityMesh.instanceColor.needsUpdate = true;
    }

    renderer.render(scene, camera);
  }

  tick();
}

// ── Interaction ───────────────────────────────────────────────────────────────

function bindInteraction(el) {
  el.addEventListener("pointerdown", e => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1) {
      isDragging  = true;
      prevPointer = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      stopAuto();
    }
  });

  el.addEventListener("pointermove", e => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (touches.size === 2) {
      isDragging = false;
      const [a, b] = [...touches.values()];
      const dist   = Math.hypot(b.x - a.x, b.y - a.y);
      if (lastPinchDist !== null) {
        const delta = (lastPinchDist - dist) * 0.012;
        zoom(delta);
      }
      lastPinchDist = dist;
      return;
    }

    if (!isDragging) return;
    const dx = e.clientX - prevPointer.x;
    const dy = e.clientY - prevPointer.y;
    rotY += dx * 0.005;
    rotX += dy * 0.005;
    rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotX));
    prevPointer = { x: e.clientX, y: e.clientY };
  });

  el.addEventListener("pointerup", e => {
    touches.delete(e.pointerId);
    isDragging    = false;
    lastPinchDist = null;
    scheduleResume();
  });

  el.addEventListener("pointercancel", e => {
    touches.delete(e.pointerId);
    isDragging    = false;
    lastPinchDist = null;
  });

  el.addEventListener("pointerleave", e => {
    if (touches.has(e.pointerId)) {
      touches.delete(e.pointerId);
      isDragging    = false;
      lastPinchDist = null;
      scheduleResume();
    }
  });

  el.addEventListener("wheel", e => {
    e.preventDefault();
    zoom(e.deltaY * 0.0015);
    stopAuto();
    scheduleResume();
  }, { passive: false });

  el.addEventListener("contextmenu", e => e.preventDefault());
}

function zoom(delta) {
  camera.position.z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camera.position.z + delta));
}

function stopAuto() {
  autoRotate = false;
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}

function scheduleResume() {
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    autoRotate = true;
  }, 2500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sizeFor(pop) {
  if (pop >= 5_000_000) return DOT_SIZE_LARGE;
  if (pop >= 500_000)   return DOT_SIZE_MEDIUM;
  return DOT_SIZE_SMALL;
}

function destroy() {
  if (animationId) cancelAnimationFrame(animationId);
  if (resumeTimer) clearTimeout(resumeTimer);
  renderer.dispose();
}
