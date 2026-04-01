// globe.js — WebGL globe renderer using Three.js r128
// All cities rendered as instanced flat disks in a single GPU draw call.
// World map drawn from TopoJSON onto a canvas texture.
// All dots are green, with the next target in white.
// Supports drag-to-rotate, scroll-to-zoom, and pinch-to-zoom on mobile.

// ── Constants ─────────────────────────────────────────────────────────────────

const GLOBE_RADIUS     = 1.0;
const DOT_ALTITUDE     = 0.010;
const DOT_SIZE_SMALL   = 0.0028;
const DOT_SIZE_MEDIUM  = 0.0036;
const DOT_SIZE_LARGE   = 0.0048;

// City state colours
const COLOR_CITY       = new THREE.Color(0x00e676);
const COLOR_NEXT       = new THREE.Color(0xffffff);

const AUTO_ROTATE_SPEED = 0.0007;
const PULSE_DURATION    = 120;
const ZOOM_MIN          = 1.3;
const ZOOM_MAX          = 3.5;

// Natural Earth TopoJSON — 110m resolution, compact, reliable CDN
const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ── Module state ──────────────────────────────────────────────────────────────

let scene, camera, renderer, globeGroup, cityMesh;
let animationId      = null;
let populationData   = [];
let currentFollowers = 0;
let pulsingIndices   = new Map();
let colorArray, dummy;

// Rotation state
let rotX = 0, rotY = 0;
let isDragging    = false;
let prevPointer   = { x: 0, y: 0 };
let autoRotate    = true;
let resumeTimer   = null;

// Pinch state — keyed by pointerId
let touches          = new Map();
let lastPinchDist    = null;

// ── Public API ────────────────────────────────────────────────────────────────

export async function initGlobe(container, populationArr) {
  populationData = populationArr;

  const W = container.clientWidth;
  const H = container.clientHeight;

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100);
  camera.position.z = 2.6;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(5, 3, 5);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x4488ff, 0.12);
  fill.position.set(-5, -2, -3);
  scene.add(fill);

  globeGroup = new THREE.Group();
  scene.add(globeGroup);

  const mapTexture = await buildMapTexture();

  const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96);
  const sphereMat = new THREE.MeshPhongMaterial({
    map:       mapTexture,
    shininess: 6,
    specular:  new THREE.Color(0x0a1a33),
  });
  globeGroup.add(new THREE.Mesh(sphereGeo, sphereMat));

  const atmoGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.06, 64, 64);
  const atmoMat = new THREE.MeshPhongMaterial({
    color:       new THREE.Color(0x0d2444),
    side:        THREE.BackSide,
    transparent: true,
    opacity:     0.20,
  });
  scene.add(new THREE.Mesh(atmoGeo, atmoMat));

  buildCityMesh();
  bindInteraction(container);

  new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }).observe(container);

  startLoop();

  return { update: updateFollowers, destroy };
}

export function updateFollowers(next) {
  if (!cityMesh || next === currentFollowers) return;
  const prev = currentFollowers;
  currentFollowers = next;

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

  ctx.fillStyle = "#060e1a";
  ctx.fillRect(0, 0, TW, TH);

  try {
    const res  = await fetch(TOPO_URL);
    const topo = await res.json();
    const geo  = topoToGeo(topo, topo.objects.countries);

    const project = ([lng, lat]) => [
      ((lng + 180) / 360) * TW,
      ((90 - lat)  / 180) * TH,
    ];

    ctx.fillStyle = "rgba(18, 38, 68, 0.95)";
    geo.features.forEach(f => {
      drawFeature(ctx, f, project);
      ctx.fill();
    });

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

  const geo = new THREE.CircleGeometry(1, 7);

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side:         THREE.DoubleSide,
    depthWrite:   false,
    transparent:  true,
    opacity:      0.95,
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

function recolour() {
  if (!cityMesh) return;

  const next = findNextIdx(currentFollowers);

  populationData.forEach((city, i) => {
    if (i === next) {
      COLOR_NEXT.toArray(colorArray, i * 3);
    } else {
      COLOR_CITY.toArray(colorArray, i * 3);
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
        pulseColor.setRGB(0.0, 0.85 + p * 0.15, 0.35 + p * 0.2);
        pulseColor.toArray(colorArray, idx * 3);

        const rem = left - 1;
        if (rem <= 0) {
          pulsingIndices.delete(idx);
          COLOR_CITY.toArray(colorArray, idx * 3);
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

function findNextIdx(followers) {
  let lo = 0;
  let hi = populationData.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (populationData[mid].population < followers) lo = mid + 1;
    else hi = mid - 1;
  }

  return lo < populationData.length ? lo : -1;
}

function destroy() {
  if (animationId) cancelAnimationFrame(animationId);
  if (resumeTimer) clearTimeout(resumeTimer);
  renderer.dispose();
}
