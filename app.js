'use strict';
/* =====================================================================
   GARDEN DESIGNER — plan-mode garden planner
   Base layers (all design at true metric scale):
     - 'satellite' : Google Maps live aerial; objects anchored in lat/lng
     - 'image'     : an uploaded photo/plan; scale set by calibration line
     - 'blank'     : empty scaled grid sized to the plot
   The drawing/selection code is base-agnostic: it only goes through
   latLngToPx() / pxToLatLng() / metersPerPixel, which branch per base.
   For image/blank, objects are stored in a flat "world" plane and the
   view {tx,ty,scale} maps world units -> screen pixels.
   ===================================================================== */

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------- Object type catalog ---------- */
const CATALOG = {
  plants: {
    label: '🌿 Plants',
    items: {
      tree:     { name: 'Tree',       icon: '🌳', color: '#3a7d3a', shape: 'circle',    w: 4,   h: 4 },
      pine:     { name: 'Pine',       icon: '🌲', color: '#1f5c2e', shape: 'circle',    w: 2.5, h: 2.5 },
      palm:     { name: 'Palm',       icon: '🌴', color: '#2d7a4a', shape: 'circle',    w: 2,   h: 2 },
      shrub:    { name: 'Shrub',      icon: '🌿', color: '#5a8a3f', shape: 'circle',    w: 1.5, h: 1.5 },
      hedge:    { name: 'Hedge',      icon: '🟩', color: '#2d6b2d', shape: 'roundrect', w: 3,   h: 0.8 },
      flowers:  { name: 'Flower bed', icon: '🌷', color: '#c84b7e', shape: 'roundrect', w: 2,   h: 1 },
      roses:    { name: 'Roses',      icon: '🌹', color: '#b83b5e', shape: 'circle',    w: 1.2, h: 1.2 },
      veg:      { name: 'Veg plot',   icon: '🥕', color: '#c68642', shape: 'roundrect', w: 2,   h: 1.5 },
    }
  },
  lawn: {
    label: '🟩 Lawns & Beds',
    items: {
      lawn:     { name: 'Lawn',       icon: '🍃', color: '#4a8f3a', shape: 'roundrect', w: 8,   h: 5 },
      raisedbed:{ name: 'Raised bed', icon: '🪵', color: '#8b5a2b', shape: 'roundrect', w: 2,   h: 1 },
      mulch:    { name: 'Mulch',      icon: '🟫', color: '#6b4226', shape: 'roundrect', w: 3,   h: 2 },
      gravel:   { name: 'Gravel',     icon: '⚪', color: '#9a9a8a', shape: 'roundrect', w: 3,   h: 1.5 },
    }
  },
  hardscape: {
    label: '🧱 Hard Landscape',
    items: {
      path:     { name: 'Path',       icon: '⬜', color: '#b8a888', shape: 'roundrect', w: 5,   h: 1.2 },
      patio:    { name: 'Patio',      icon: '🔳', color: '#a39580', shape: 'roundrect', w: 4,   h: 3 },
      deck:     { name: 'Decking',    icon: '🟧', color: '#9c6b3f', shape: 'roundrect', w: 4,   h: 3 },
      fence:    { name: 'Fence',      icon: '🚧', color: '#7a5c3a', shape: 'rect',      w: 5,   h: 0.3 },
      wall:     { name: 'Wall',       icon: '🧱', color: '#8a8a8a', shape: 'rect',      w: 5,   h: 0.4 },
      shed:     { name: 'Shed',       icon: '🏠', color: '#6b4226', shape: 'rect',      w: 3,   h: 2 },
      greenhouse:{name: 'Greenhouse', icon: '🪟',  color: '#7ec8a0', shape: 'rect',      w: 3,   h: 2 },
    }
  },
  water: {
    label: '💧 Water',
    items: {
      pond:     { name: 'Pond',       icon: '💧', color: '#2d7fb8', shape: 'blob',      w: 3,   h: 2 },
      pool:     { name: 'Pool',       icon: '🏊', color: '#3a9bd9', shape: 'roundrect', w: 4,   h: 2.5 },
      fountain: { name: 'Fountain',   icon: '⛲', color: '#5ab8e6', shape: 'circle',    w: 1.5, h: 1.5 },
    }
  },
  features: {
    label: '✨ Features',
    items: {
      bench:    { name: 'Bench',      icon: '🪑', color: '#7a5c3a', shape: 'rect',      w: 1.5, h: 0.6 },
      table:    { name: 'Table',      icon: '🍽️', color: '#8a7a5a', shape: 'roundrect', w: 1.8, h: 1 },
      firepit:  { name: 'Fire pit',   icon: '🔥', color: '#c85a2e', shape: 'circle',    w: 1,   h: 1 },
      trampoline:{name: 'Trampoline', icon: '⭕', color: '#3a3a3a', shape: 'circle',    w: 3,   h: 3 },
      sandbox:  { name: 'Sandpit',    icon: '🏖️', color: '#d9c27a', shape: 'roundrect', w: 2,   h: 2 },
      composter:{ name: 'Composter',  icon: '♻️', color: '#3a5a2a', shape: 'rect',      w: 1,   h: 1 },
      swing:    { name: 'Swing set',  icon: '🛝', color: '#c64b3a', shape: 'roundrect', w: 3,   h: 1.5 },
      solarlight:{name: 'Solar light',icon: '💡', color: '#e6c84a', shape: 'circle',    w: 0.4, h: 0.4 },
    }
  }
};

/* Flatten catalog for quick lookup */
const TYPES = {};
for (const cat of Object.values(CATALOG)) for (const [k, v] of Object.entries(cat.items)) TYPES[k] = v;

/* ---------- Global state ---------- */
let apiKey = localStorage.getItem('gd_apikey') || '';
let map = null;
let overlay = null;          // OverlayView for projection access
let mode = 'setup';          // setup | framing | calibrate | draw
let baseType = 'satellite';  // satellite | image | blank
let objects = [];            // satellite: {lat,lng}; image/blank: {lat=worldY, lng=worldX}
let selectedId = null;
let placingType = null;
let metersPerPixel = 1;
let mapCenter = null;
let mapZoom = 20;
let undoStack = [];
let redoStack = [];
let snapGrid = true;
let showLabels = true;
let currentTab = 'plants';
let dragState = null;
let renderQueued = false;

/* image/blank base-layer state */
let view = { tx: 0, ty: 0, scale: 40 };  // world-units -> screen px, + pan offset
let bgDataUrl = null;                     // uploaded image (data URL)
let bgImg = { w: 0, h: 0 };               // image size in world units (= pixels of stored image)
let metersPerWorldUnit = 1;               // image: from calibration; blank: 1 (world unit = metre)
let plot = { w: 20, h: 15 };              // blank plot size in metres
let calib = null;                         // { p1:{x,y}, p2:{x,y} } in world units while calibrating
let pendingFit = false;                   // fit view to plot once the canvas is visible
let uploadIntent = 'calibrate';           // what to do after an image upload: 'calibrate' | 'rectify'
let rectPts = null;                        // 4 corner points (world units) while straightening a photo

/* ===================================================================== */
/*  SETUP / ENTRY                                                        */
/* ===================================================================== */
function init() {
  // --- base-layer chooser ---
  $('opt-image').addEventListener('click', () => { uploadIntent = 'calibrate'; $('bg-file').value = ''; $('bg-file').click(); });
  $('opt-rectify').addEventListener('click', () => { uploadIntent = 'rectify'; $('bg-file').value = ''; $('bg-file').click(); });
  $('opt-blank').addEventListener('click', () => showPanel('blank-panel'));
  $('opt-satellite').addEventListener('click', () => {
    showPanel('key-panel');
    if (apiKey) { $('api-key-input').value = apiKey; $('start-btn').disabled = false; }
  });
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', showChooser));

  // --- satellite key panel ---
  $('api-key-input').addEventListener('input', (e) => {
    $('start-btn').disabled = e.target.value.trim().length < 10;
  });
  $('start-btn').addEventListener('click', () => {
    apiKey = $('api-key-input').value.trim();
    if ($('remember-key').checked) localStorage.setItem('gd_apikey', apiKey);
    else { localStorage.removeItem('gd_apikey'); sessionStorage.setItem('gd_apikey', apiKey); }
    baseType = 'satellite';
    enterFraming();
  });

  // --- blank panel ---
  $('blank-start').addEventListener('click', () => {
    plot.w = Math.max(1, parseFloat($('blank-w').value) || 20);
    plot.h = Math.max(1, parseFloat($('blank-h').value) || 15);
    startBlank();
  });

  // --- image upload ---
  $('bg-file').addEventListener('change', (e) => { if (e.target.files[0]) loadBackgroundImage(e.target.files[0]); });

  // --- calibration controls ---
  $('calib-set').addEventListener('click', applyCalibration);
  $('calib-redraw').addEventListener('click', resetCalibration);

  // --- rectify controls ---
  $('rect-go').addEventListener('click', applyRectify);

  // --- resume a saved design ---
  const saved = loadDesign();
  if (saved && saved.baseType) tryResume(saved);
}

function showPanel(id) {
  $('base-chooser').classList.add('hidden');
  ['key-panel', 'blank-panel'].forEach((p) => $(p).classList.toggle('hidden', p !== id));
}
function showChooser() {
  $('base-chooser').classList.remove('hidden');
  $('key-panel').classList.add('hidden');
  $('blank-panel').classList.add('hidden');
}

function tryResume(saved) {
  // Offer to pick up where the user left off (only if it can be reconstructed).
  if (saved.baseType === 'satellite') {
    if (apiKey && saved.mapCenter) {
      baseType = 'satellite';
      enterFraming(() => { restoreDesign(saved); if (saved.objects && saved.objects.length) enterDraw(false); });
    }
  } else if (saved.baseType === 'image' && saved.bgDataUrl) {
    baseType = 'image';
    bgDataUrl = saved.bgDataUrl;
    bgImg = saved.bgImg || { w: 0, h: 0 };
    metersPerWorldUnit = saved.metersPerWorldUnit || 1;
    restoreDesign(saved);
    enterDraw(false);
  } else if (saved.baseType === 'blank') {
    baseType = 'blank';
    metersPerWorldUnit = 1;
    plot = saved.plot || plot;
    restoreDesign(saved);
    enterDraw(false);
  }
}

/* ---------- image upload + downscale ---------- */
function loadBackgroundImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      // Downscale very large photos so they fit localStorage and render fast.
      const MAX = 2400;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (Math.max(w, h) > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      bgDataUrl = cv.toDataURL('image/jpeg', 0.85);
      bgImg = { w, h };
      baseType = 'image';
      metersPerWorldUnit = 1;          // provisional until calibrated (world unit == image pixel)
      objects = [];
      if (uploadIntent === 'rectify') enterRectify();
      else enterCalibrate();
    };
    img.onerror = () => alert('Could not read that image. Try a JPG or PNG.');
    img.src = reader.result;
  };
  reader.onerror = () => alert('Could not read that file.');
  reader.readAsDataURL(file);
}

function startBlank() {
  baseType = 'blank';
  metersPerWorldUnit = 1;
  objects = [];
  pendingFit = true;     // fit the new plot once the canvas is on screen
  enterDraw(false);
}

/* ===================================================================== */
/*  GOOGLE MAPS (satellite)                                              */
/* ===================================================================== */
function loadGoogleMaps(cb) {
  if (window.google && window.google.maps) { cb(); return; }
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=geometry&callback=__gmapsCb`;
  window.__gmapsCb = () => cb();
  s.onerror = () => alert('Could not load Google Maps. Check your API key and that Maps JavaScript API + Geocoding API are enabled.');
  document.head.appendChild(s);
}

// Defined lazily: google.maps.OverlayView only exists after the Maps script
// loads. Referencing it at top-level parse time would throw and kill the app.
let ProjectionOverlay = null;
function createOverlay(map) {
  if (!ProjectionOverlay) {
    ProjectionOverlay = class extends google.maps.OverlayView {
      constructor(map) { super(); this.setMap(map); }
      draw() {}
      onAdd() {}
      onRemove() {}
    };
  }
  return new ProjectionOverlay(map);
}
function proj() { return overlay && overlay.getProjection(); }

/* ===================================================================== */
/*  PROJECTION (base-agnostic)                                           */
/*    latLngToPx / pxToLatLng switch on baseType. For image/blank the    */
/*    stored "lat" is world-Y and "lng" is world-X (both world units).   */
/* ===================================================================== */
function worldToScreen(wx, wy) { return { x: wx * view.scale + view.tx, y: wy * view.scale + view.ty }; }
function screenToWorld(sx, sy) { return { x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale }; }

function latLngToPx(lat, lng) {
  if (baseType === 'satellite') {
    const p = proj();
    if (!p) return { x: 0, y: 0 };
    const px = p.fromLatLngToContainerPixel(new google.maps.LatLng(lat, lng));
    return { x: px.x, y: px.y };
  }
  return worldToScreen(lng, lat);   // lng = world X, lat = world Y
}
function pxToLatLng(x, y) {
  if (baseType === 'satellite') {
    const p = proj();
    if (!p) return null;
    return p.fromContainerPixelToLatLng(new google.maps.Point(x, y));
  }
  // mimic google.maps.LatLng shape so shared drag code works unchanged
  const w = screenToWorld(x, y);
  return { lat: () => w.y, lng: () => w.x };
}
function computeMetersPerPixel() {
  if (baseType === 'satellite') {
    const lat = mapCenter ? mapCenter.lat : 0;
    return 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, mapZoom);
  }
  return metersPerWorldUnit / view.scale;
}

/* fit the image / plot into the visible canvas */
function fitView() {
  const r = $('canvas-area').getBoundingClientRect();
  let cw, ch;
  if (baseType === 'image') { cw = bgImg.w; ch = bgImg.h; }
  else { cw = plot.w; ch = plot.h; }                  // blank: world unit == metre
  if (!cw || !ch) { view = { tx: 0, ty: 0, scale: 40 }; return; }
  const pad = 0.9;
  view.scale = Math.min(r.width / cw, r.height / ch) * pad;
  view.tx = (r.width - cw * view.scale) / 2;
  view.ty = (r.height - ch * view.scale) / 2;
}

/* ===================================================================== */
/*  FRAMING MODE (satellite)                                             */
/* ===================================================================== */
function enterFraming(cb) {
  mode = 'framing';
  $('drawing-layer').classList.remove('draw-mode');  // let the map receive pan/zoom while framing
  $('setup-screen').classList.add('hidden');
  $('topbar').classList.remove('hidden');
  $('framing-bar').classList.remove('hidden');
  $('calibrate-bar').classList.add('hidden');
  $('canvas-area').classList.add('visible');
  $('palette').classList.add('hidden');
  $('lock-overlay-hint').classList.add('hidden');
  $('reframe-btn').classList.remove('hidden');
  $('map').style.display = '';

  const startMap = () => {
    if (!map) {
      map = new google.maps.Map($('map'), {
        center: (mapCenter || { lat: 51.5074, lng: -0.1277 }),
        zoom: mapZoom,
        mapTypeId: 'satellite',
        tilt: 0,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      overlay = createOverlay(map);
      map.addListener('bounds_changed', () => queueRender());
      map.addListener('idle', () => { mapCenter = { lat: map.getCenter().lat(), lng: map.getCenter().lng() }; mapZoom = map.getZoom(); metersPerPixel = computeMetersPerPixel(); updateScaleBar(); queueRender(); });
      google.maps.event.addListenerOnce(map, 'idle', () => setTimeout(() => cb && cb(), 50));
    } else {
      enableMapInteraction(true);
      if (cb) cb();
    }
  };
  loadGoogleMaps(startMap);
  bindFramingUI();
}

function bindFramingUI() {
  const doSearch = async () => {
    const q = $('address-input').value.trim();
    if (!q) return;
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${encodeURIComponent(apiKey)}`);
      const d = await r.json();
      if (d.status === 'OK' && d.results[0]) {
        const loc = d.results[0].geometry.location;
        map.setCenter(loc);
        if (map.getZoom() < 19) map.setZoom(20);
      } else {
        alert('Address not found: ' + d.status);
      }
    } catch (e) { alert('Search failed: ' + e.message); }
  };
  $('search-btn').onclick = doSearch;
  $('address-input').onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
  $('lock-btn').onclick = () => enterDraw(true);
}

function enableMapInteraction(on) {
  if (!map) return;
  map.setOptions({
    draggable: on,
    scrollwheel: on,
    zoomControl: on,
    disableDoubleClickZoom: !on,
    gestureHandling: on ? 'greedy' : 'none',
    keyboardShortcuts: on,
  });
}

/* ===================================================================== */
/*  CALIBRATION MODE (image)                                             */
/* ===================================================================== */
function enterCalibrate() {
  mode = 'calibrate';
  calib = null;
  $('setup-screen').classList.add('hidden');
  $('topbar').classList.remove('hidden');
  $('framing-bar').classList.add('hidden');
  $('calibrate-bar').classList.remove('hidden');
  $('canvas-area').classList.add('visible');
  $('palette').classList.add('hidden');
  $('scale-bar').classList.add('hidden');
  $('reframe-btn').classList.add('hidden');
  $('map').style.display = 'none';              // image lives in the SVG, not the Google map
  $('drawing-layer').classList.add('draw-mode');
  resetCalibration();
  fitView();
  renderObjects();
}

function resetCalibration() {
  calib = null;
  $('calib-instr').textContent = '📏 Draw a line over something you know the length of — a fence, wall, or the house. Tap two points on the image.';
  $('calib-input-wrap').style.display = 'none';
  $('calib-redraw').style.display = 'none';
  renderObjects();
}

function applyCalibration() {
  if (!calib || !calib.p2) return;
  const m = parseFloat($('calib-len').value);
  if (!m || m <= 0) { alert('Enter the real length of the line in metres.'); return; }
  const dist = Math.hypot(calib.p2.x - calib.p1.x, calib.p2.y - calib.p1.y); // world units
  if (dist < 1) { alert('That line is too short to measure — draw a longer one.'); return; }
  metersPerWorldUnit = m / dist;
  calib = null;
  enterDraw(false);
}

/* ===================================================================== */
/*  RECTIFY MODE (straighten an angled photo via a homography)           */
/* ===================================================================== */
function enterRectify() {
  mode = 'rectify';
  $('setup-screen').classList.add('hidden');
  $('topbar').classList.remove('hidden');
  $('framing-bar').classList.add('hidden');
  $('calibrate-bar').classList.add('hidden');
  $('rectify-bar').classList.remove('hidden');
  $('canvas-area').classList.add('visible');
  $('palette').classList.add('hidden');
  $('scale-bar').classList.add('hidden');
  $('reframe-btn').classList.add('hidden');
  $('map').style.display = 'none';
  $('drawing-layer').classList.add('draw-mode');
  // default quad: an inset rectangle the user drags onto a real one
  rectPts = [
    { x: bgImg.w * 0.30, y: bgImg.h * 0.35 },
    { x: bgImg.w * 0.70, y: bgImg.h * 0.35 },
    { x: bgImg.w * 0.78, y: bgImg.h * 0.72 },
    { x: bgImg.w * 0.22, y: bgImg.h * 0.72 },
  ];
  fitView();
  renderObjects();
}

function applyRectify() {
  const realW = parseFloat($('rect-w').value);
  const realH = parseFloat($('rect-h').value);
  if (!realW || !realH || realW <= 0 || realH <= 0) { alert('Enter the real width and depth of the rectangle in metres.'); return; }

  // Output raster sized to the real rectangle, capped on the long side.
  const MAX = 1400;
  const pxPerM = MAX / Math.max(realW, realH);
  const outW = Math.max(2, Math.round(realW * pxPerM));
  const outH = Math.max(2, Math.round(realH * pxPerM));
  const dst = [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }];

  // Reverse map: for each output pixel, find the source pixel (homography dst -> src).
  const H = solveHomography(dst, rectPts);
  if (!H) { alert('Could not compute the perspective — make sure the 4 dots form a proper quadrilateral.'); return; }

  const srcImg = new Image();
  srcImg.onload = () => {
    const sc = document.createElement('canvas'); sc.width = bgImg.w; sc.height = bgImg.h;
    const sctx = sc.getContext('2d'); sctx.drawImage(srcImg, 0, 0, bgImg.w, bgImg.h);
    const src = sctx.getImageData(0, 0, bgImg.w, bgImg.h).data;

    const oc = document.createElement('canvas'); oc.width = outW; oc.height = outH;
    const octx = oc.getContext('2d');
    const out = octx.createImageData(outW, outH);
    const od = out.data, sw = bgImg.w, sh = bgImg.h;
    for (let Y = 0; Y < outH; Y++) {
      for (let X = 0; X < outW; X++) {
        const den = H[6] * X + H[7] * Y + 1;
        const sx = (H[0] * X + H[1] * Y + H[2]) / den;
        const sy = (H[3] * X + H[4] * Y + H[5]) / den;
        const o = (Y * outW + X) * 4;
        if (sx >= 0 && sx < sw - 1 && sy >= 0 && sy < sh - 1) {
          // bilinear sample
          const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
          const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
          for (let k = 0; k < 3; k++) {
            const top = src[i00 + k] * (1 - fx) + src[i10 + k] * fx;
            const bot = src[i01 + k] * (1 - fx) + src[i11 + k] * fx;
            od[o + k] = top * (1 - fy) + bot * fy;
          }
          od[o + 3] = 255;
        } else { od[o + 3] = 0; }
      }
    }
    octx.putImageData(out, 0, 0);

    bgDataUrl = oc.toDataURL('image/jpeg', 0.85);
    bgImg = { w: outW, h: outH };
    metersPerWorldUnit = realW / outW;   // metres per output pixel (world unit)
    baseType = 'image';
    rectPts = null;
    objects = [];
    pendingFit = true;
    enterDraw(false);
  };
  srcImg.onerror = () => alert('Could not process the image.');
  srcImg.src = bgDataUrl;
}

/* Solve the projective transform mapping from[4] -> to[4].
   Returns [a,b,c,d,e,f,g,h] for:  u=(ax+by+c)/(gx+hy+1), v=(dx+ey+f)/(gx+hy+1). */
function solveHomography(from, to) {
  const A = [], bvec = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); bvec.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); bvec.push(v);
  }
  return gaussSolve(A, bvec);
}

/* Gaussian elimination with partial pivoting for an 8x8 system. */
function gaussSolve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-9) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let k = col; k <= n; k++) M[col][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map(row => row[n]);
}

/* ===================================================================== */
/*  DRAW MODE                                                            */
/* ===================================================================== */
function enterDraw(lock) {
  mode = 'draw';
  if (baseType === 'satellite') {
    if (lock) {
      mapCenter = { lat: map.getCenter().lat(), lng: map.getCenter().lng() };
      mapZoom = map.getZoom();
      enableMapInteraction(false);
    }
    $('map').style.display = '';
    $('reframe-btn').classList.remove('hidden');
  } else {
    $('map').style.display = 'none';
    $('reframe-btn').classList.add('hidden');
  }
  $('setup-screen').classList.add('hidden');
  $('topbar').classList.remove('hidden');
  $('canvas-area').classList.add('visible');
  $('framing-bar').classList.add('hidden');
  $('calibrate-bar').classList.add('hidden');
  $('palette').classList.remove('hidden');
  $('scale-bar').classList.remove('hidden');
  $('drawing-layer').classList.add('draw-mode');   // overlay captures clicks for drawing
  if (baseType !== 'satellite' && pendingFit) { fitView(); pendingFit = false; }
  metersPerPixel = computeMetersPerPixel();
  updateScaleBar();
  renderObjects();
  saveDesign();
}

/* "Re-frame / Fit" button */
function reframe() {
  selectedId = null;
  $('props-panel').classList.add('hidden');
  if (baseType === 'satellite') { renderObjects(); enterFraming(); }
  else { fitView(); metersPerPixel = computeMetersPerPixel(); updateScaleBar(); renderObjects(); }
}

/* ===================================================================== */
/*  PALETTE                                                              */
/* ===================================================================== */
function buildPalette() {
  const tabs = $('palette-tabs');
  const items = $('palette-items');
  tabs.innerHTML = '';
  items.innerHTML = '';
  for (const [catKey, cat] of Object.entries(CATALOG)) {
    const tab = document.createElement('div');
    tab.className = 'palette-tab' + (catKey === currentTab ? ' active' : '');
    tab.textContent = cat.label;
    tab.onclick = () => { currentTab = catKey; buildPalette(); };
    tabs.appendChild(tab);
  }
  if (CATALOG[currentTab]) {
    for (const [typeKey, t] of Object.entries(CATALOG[currentTab].items)) {
      const it = document.createElement('div');
      it.className = 'palette-item';
      it.innerHTML = `<div class="icon">${t.icon}</div><div class="name">${t.name}</div>`;
      it.onclick = () => startPlacing(typeKey);
      items.appendChild(it);
    }
  }
}

function startPlacing(typeKey) {
  placingType = typeKey;
  $('drawing-layer').classList.add('placing');
  const hint = document.createElement('div');
  hint.id = 'place-hint';
  hint.textContent = `👆 Tap to place ${TYPES[typeKey].name}`;
  hint.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);background:var(--accent);color:#0e1f12;padding:8px 16px;border-radius:20px;font-weight:600;font-size:14px;z-index:150;box-shadow:var(--shadow)';
  document.body.appendChild(hint);
}

function cancelPlacing() {
  placingType = null;
  $('drawing-layer').classList.remove('placing');
  const h = $('place-hint'); if (h) h.remove();
}

/* ===================================================================== */
/*  RENDER                                                               */
/* ===================================================================== */
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderObjects(); });
}

function renderObjects() {
  const svg = $('drawing-layer');
  const r = $('canvas-area').getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
  svg.innerHTML = '';

  // ---- background (image / blank grid) ----
  if (baseType === 'image' && bgDataUrl) {
    const tl = worldToScreen(0, 0);
    const w = bgImg.w * view.scale, h = bgImg.h * view.scale;
    svg.appendChild(el('image', { href: bgDataUrl, x: tl.x, y: tl.y, width: w, height: h, preserveAspectRatio: 'none' }));
  } else if (baseType === 'blank') {
    svg.appendChild(renderGrid(r));
  }

  // ---- rectify: draggable corner quad ----
  if (mode === 'rectify' && rectPts) {
    const pts = rectPts.map(p => worldToScreen(p.x, p.y));
    svg.appendChild(el('polygon', { class: 'rect-poly', points: pts.map(p => `${p.x},${p.y}`).join(' ') }));
    pts.forEach((p, i) => {
      svg.appendChild(el('circle', { class: 'rect-handle', cx: p.x, cy: p.y, r: 11, 'data-rectpt': i }));
      svg.appendChild(el('text', { class: 'rect-num', x: p.x, y: p.y }, String(i + 1)));
    });
    return;
  }

  // ---- calibration line ----
  if (mode === 'calibrate' && calib && calib.p1) {
    const a = worldToScreen(calib.p1.x, calib.p1.y);
    const b = calib.p2 ? worldToScreen(calib.p2.x, calib.p2.y) : a;
    svg.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    for (const p of [a, calib.p2 ? b : null]) if (p) svg.appendChild(el('circle', { cx: p.x, cy: p.y, r: 6, fill: 'var(--accent)', stroke: '#fff', 'stroke-width': 2 }));
    return; // no objects while calibrating
  }

  // ---- objects ----
  for (const o of objects) {
    const t = TYPES[o.type];
    const { x, y } = latLngToPx(o.lat, o.lng);
    const wPx = Math.max(8, o.w / metersPerPixel);
    const hPx = Math.max(8, o.h / metersPerPixel);
    const g = el('g', { class: 'garden-obj' + (o.id === selectedId ? ' selected' : ''), transform: `translate(${x},${y}) rotate(${o.rot})`, 'data-id': o.id });
    g.appendChild(renderShape(t, wPx, hPx));
    if (showLabels && o.label) g.appendChild(el('text', { class: 'obj-label', y: hPx / 2 + 14 }, o.label));
    if (o.id === selectedId) g.appendChild(renderSelection(wPx, hPx));
    svg.appendChild(g);
  }
}

function renderGrid(r) {
  // 1-metre grid covering the plot, with a highlighted plot boundary.
  const g = el('g', {});
  const o = worldToScreen(0, 0);
  const far = worldToScreen(plot.w, plot.h);
  g.appendChild(el('rect', { x: o.x, y: o.y, width: far.x - o.x, height: far.y - o.y, fill: '#223', 'fill-opacity': 0.35 }));
  const stepPx = view.scale; // 1 world unit (metre) in px
  if (stepPx >= 6) {
    for (let mx = 0; mx <= plot.w + 0.001; mx++) {
      const a = worldToScreen(mx, 0), b = worldToScreen(mx, plot.h);
      g.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'grid-line' }));
    }
    for (let my = 0; my <= plot.h + 0.001; my++) {
      const a = worldToScreen(0, my), b = worldToScreen(plot.w, my);
      g.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'grid-line' }));
    }
  }
  g.appendChild(el('rect', { x: o.x, y: o.y, width: far.x - o.x, height: far.y - o.y, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 }));
  return g;
}

function renderShape(t, w, h) {
  const wrap = el('g', {});
  const style = `fill:${t.color};fill-opacity:0.78;stroke:${shade(t.color, -30)};stroke-width:1.5`;
  if (t.shape === 'circle') {
    const r = Math.min(w, h) / 2;
    wrap.appendChild(el('circle', { cx: 0, cy: 0, r, style }));
    wrap.appendChild(el('circle', { cx: 0, cy: 0, r: r * 0.6, fill: 'none', stroke: shade(t.color, 20), 'stroke-width': 1, 'stroke-opacity': 0.5 }));
  } else if (t.shape === 'roundrect') {
    wrap.appendChild(el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(w, h) * 0.15, style }));
  } else if (t.shape === 'rect') {
    wrap.appendChild(el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, style }));
  } else if (t.shape === 'blob') {
    wrap.appendChild(el('path', { d: blobPath(w, h), style }));
  }
  wrap.appendChild(el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Math.min(w, h) * 0.5, y: 0 }, t.icon.length > 2 ? '' : t.icon));
  return wrap;
}

function blobPath(w, h) {
  const a = w / 2, b = h / 2;
  return `M ${-a * 0.8} ${-b} C ${a} ${-b*1.1}, ${a*1.1} ${b*0.5}, ${a*0.4} ${b} C ${-a*1.05} ${b*1.05}, ${-a*1.1} ${-b*0.3}, ${-a*0.8} ${-b} Z`;
}

function renderSelection(w, h) {
  const g = el('g', { class: 'sel' });
  g.appendChild(el('rect', { class: 'selection-box', x: -w / 2 - 6, y: -h / 2 - 6, width: w + 12, height: h + 12, rx: 4 }));
  const corners = [[-w/2-6,-h/2-6],[w/2+6,-h/2-6],[w/2+6,h/2+6],[-w/2-6,h/2+6]];
  for (const [cx,cy] of corners) g.appendChild(el('rect', { class:'handle', x:cx-5, y:cy-5, width:10, height:10, rx:2, 'data-handle':'resize' }));
  g.appendChild(el('line', { x1:0, y1:-h/2-6, x2:0, y2:-h/2-28, stroke:'var(--accent)','stroke-width':1.5,'stroke-dasharray':'3 2' }));
  g.appendChild(el('circle', { class:'handle rot', cx:0, cy:-h/2-30, r:7, 'data-handle':'rotate' }));
  return g;
}

function el(tag, attrs, text) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function shade(hex, amt) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  let r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  r = Math.max(0, Math.min(255, r + amt)); g = Math.max(0, Math.min(255, g + amt)); b = Math.max(0, Math.min(255, b + amt));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

/* ===================================================================== */
/*  POINTER INTERACTION                                                  */
/* ===================================================================== */
function svgPoint(e) {
  const r = $('drawing-layer').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function bindCanvas() {
  const svg = $('drawing-layer');
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('wheel', onWheel, { passive: false });
}

function onWheel(e) {
  if (baseType === 'satellite' || (mode !== 'draw' && mode !== 'calibrate' && mode !== 'rectify')) return;
  e.preventDefault();
  const pt = svgPoint(e);
  const before = screenToWorld(pt.x, pt.y);
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  view.scale = Math.max(2, Math.min(4000, view.scale * factor));
  view.tx = pt.x - before.x * view.scale;
  view.ty = pt.y - before.y * view.scale;
  metersPerPixel = computeMetersPerPixel();
  updateScaleBar();
  renderObjects();
}

function onPointerDown(e) {
  // ---- calibration: two taps define the reference line ----
  if (mode === 'calibrate') {
    const sp = svgPoint(e);
    const w = screenToWorld(sp.x, sp.y);
    if (!calib || calib.p2) { calib = { p1: w, p2: null }; }
    else {
      calib.p2 = w;
      $('calib-instr').textContent = 'Now type how long that line is in real life:';
      $('calib-input-wrap').style.display = 'flex';
      $('calib-redraw').style.display = 'inline-flex';
      setTimeout(() => $('calib-len').focus(), 0);
    }
    renderObjects();
    return;
  }

  // ---- rectify: drag a corner marker, or pan empty space ----
  if (mode === 'rectify') {
    const pt = svgPoint(e);
    const idAttr = e.target.getAttribute && e.target.getAttribute('data-rectpt');
    if (idAttr != null) {
      dragState = { type: 'rectpt', index: +idAttr };
    } else {
      dragState = { type: 'pan', startPt: pt, startTx: view.tx, startTy: view.ty };
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return;
  }

  if (mode !== 'draw') return;
  const pt = svgPoint(e);
  const target = e.target;
  const objEl = target.closest('.garden-obj');
  const handle = target.getAttribute('data-handle');

  // PLACING takes priority
  if (placingType) {
    const ll = pxToLatLng(pt.x, pt.y);
    if (!ll) return;
    const o = makeObject(placingType, ll.lat(), ll.lng());
    pushHistory();
    objects.push(o);
    selectedId = o.id;
    cancelPlacing();
    renderObjects(); syncProps();
    saveDesign();
    return;
  }

  if (objEl) {
    const id = objEl.getAttribute('data-id');
    const o = objects.find(x => x.id === id);
    if (!o) return;
    selectedId = id;
    if (handle === 'rotate') {
      dragState = { type: 'rotate', id, startPt: pt, startRot: o.rot, cx: latLngToPx(o.lat, o.lng) };
    } else if (handle === 'resize') {
      dragState = { type: 'resize', id, startPt: pt, startW: o.w, startH: o.h, cx: latLngToPx(o.lat, o.lng) };
    } else {
      dragState = { type: 'move', id, startPt: pt, startLat: o.lat, startLng: o.lng };
    }
    e.preventDefault();
    renderObjects(); syncProps();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return;
  }

  // empty space
  if (placingType) { cancelPlacing(); return; }
  selectedId = null;
  $('props-panel').classList.add('hidden');

  // for image/blank, dragging empty space pans the view
  if (baseType !== 'satellite') {
    dragState = { type: 'pan', startPt: pt, startTx: view.tx, startTy: view.ty };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }
  renderObjects();
}

function onPointerMove(e) {
  if (!dragState) return;
  const pt = svgPoint(e);

  if (dragState.type === 'pan') {
    view.tx = dragState.startTx + (pt.x - dragState.startPt.x);
    view.ty = dragState.startTy + (pt.y - dragState.startPt.y);
    renderObjects();
    return;
  }

  if (dragState.type === 'rectpt') {
    rectPts[dragState.index] = screenToWorld(pt.x, pt.y);
    renderObjects();
    return;
  }

  const o = objects.find(x => x.id === dragState.id);
  if (!o) return;

  if (dragState.type === 'move') {
    const ll = pxToLatLng(pt.x, pt.y);
    const startLL = pxToLatLng(dragState.startPt.x, dragState.startPt.y);
    if (ll && startLL) {
      o.lat = dragState.startLat + (ll.lat() - startLL.lat());
      o.lng = dragState.startLng + (ll.lng() - startLL.lng());
      if (snapGrid) { o.lat = roundGrid(o.lat); o.lng = roundGrid(o.lng); }
    }
  } else if (dragState.type === 'resize') {
    const dx = pt.x - dragState.cx.x, dy = pt.y - dragState.cx.y;
    const startDx = dragState.startPt.x - dragState.cx.x, startDy = dragState.startPt.y - dragState.cx.y;
    const scale = Math.hypot(dx, dy) / (Math.hypot(startDx, startDy) || 1);
    o.w = Math.max(0.2, dragState.startW * scale);
    o.h = Math.max(0.2, dragState.startH * scale);
  } else if (dragState.type === 'rotate') {
    const cx = dragState.cx;
    const ang = Math.atan2(pt.y - cx.y, pt.x - cx.x) * 180 / Math.PI;
    const startAng = Math.atan2(dragState.startPt.y - cx.y, dragState.startPt.x - cx.x) * 180 / Math.PI;
    o.rot = (dragState.startRot + (ang - startAng) + 360) % 360;
  }
  renderObjects(); syncProps();
}

function onPointerUp() {
  if (dragState && (dragState.type === 'move' || dragState.type === 'resize' || dragState.type === 'rotate')) { pushHistory(); saveDesign(); }
  dragState = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
}

function roundGrid(v) {
  if (baseType === 'satellite') return Math.round(v * 10000) / 10000;
  // snap world coords to 0.25 m
  const stepWorld = 0.25 / metersPerWorldUnit;
  return Math.round(v / stepWorld) * stepWorld;
}

function makeObject(type, lat, lng) {
  const t = TYPES[type];
  return { id: 'o' + Date.now() + Math.random().toString(36).slice(2, 6), type, lat, lng, w: t.w, h: t.h, rot: 0, label: '' };
}

/* ===================================================================== */
/*  PROPS PANEL                                                          */
/* ===================================================================== */
function syncProps() {
  const o = objects.find(x => x.id === selectedId);
  if (!o) { $('props-panel').classList.add('hidden'); return; }
  $('props-panel').classList.remove('hidden');
  $('props-title').textContent = TYPES[o.type].name;
  if (document.activeElement !== $('prop-w')) $('prop-w').value = o.w.toFixed(1);
  if (document.activeElement !== $('prop-h')) $('prop-h').value = o.h.toFixed(1);
  $('prop-rot').value = o.rot;
  $('prop-rot-val').textContent = Math.round(o.rot) + '°';
  if (document.activeElement !== $('prop-label')) $('prop-label').value = o.label || '';
}

function bindProps() {
  const update = (key, val) => { const o = objects.find(x => x.id === selectedId); if (o) { o[key] = val; renderObjects(); saveDebounced(); } };
  $('prop-w').oninput = (e) => update('w', Math.max(0.1, parseFloat(e.target.value) || 0.1));
  $('prop-h').oninput = (e) => update('h', Math.max(0.1, parseFloat(e.target.value) || 0.1));
  $('prop-rot').oninput = (e) => { update('rot', parseFloat(e.target.value)); $('prop-rot-val').textContent = Math.round(e.target.value) + '°'; };
  $('prop-label').oninput = (e) => update('label', e.target.value);
  $('prop-rot').onchange = () => pushHistory();
  $('prop-w').onchange = () => pushHistory();
  $('prop-h').onchange = () => pushHistory();
  $('props-close').onclick = () => { selectedId = null; $('props-panel').classList.add('hidden'); renderObjects(); };
  $('prop-duplicate').onclick = () => { const o = objects.find(x => x.id === selectedId); if (o) { pushHistory(); const off = baseType === 'satellite' ? 0.00005 : 0.5 / metersPerWorldUnit; const n = { ...o, id: 'o'+Date.now(), lat: o.lat + off, lng: o.lng + off }; objects.push(n); selectedId = n.id; renderObjects(); syncProps(); saveDesign(); } };
  $('prop-delete').onclick = deleteSelected;
}

function deleteSelected() {
  if (!selectedId) return;
  pushHistory();
  objects = objects.filter(o => o.id !== selectedId);
  selectedId = null;
  $('props-panel').classList.add('hidden');
  renderObjects(); saveDesign();
}

/* ===================================================================== */
/*  HISTORY / SAVE                                                       */
/* ===================================================================== */
let saveTimer = null;
function saveDebounced() { clearTimeout(saveTimer); saveTimer = setTimeout(saveDesign, 400); }
function saveDesign() {
  const data = {
    baseType, objects, snapGrid, showLabels, savedAt: Date.now(),
    mapCenter, mapZoom,
    view, metersPerWorldUnit, plot, bgImg,
    bgDataUrl: baseType === 'image' ? bgDataUrl : null,
  };
  try { localStorage.setItem('gd_design', JSON.stringify(data)); }
  catch (e) {
    // Most likely the image pushed us over quota — save without it.
    try { localStorage.setItem('gd_design', JSON.stringify({ ...data, bgDataUrl: null })); } catch (_) {}
  }
}
function loadDesign() {
  try { return JSON.parse(localStorage.getItem('gd_design')); } catch { return null; }
}
function restoreDesign(d) {
  if (!d) return;
  objects = d.objects || [];
  snapGrid = d.snapGrid !== false;
  showLabels = d.showLabels !== false;
  if (d.mapCenter) mapCenter = d.mapCenter;
  if (d.mapZoom) mapZoom = d.mapZoom;
  if (d.view) view = d.view;
  if (d.metersPerWorldUnit) metersPerWorldUnit = d.metersPerWorldUnit;
  if (d.plot) plot = d.plot;
  if (d.bgImg) bgImg = d.bgImg;
  $('toggle-grid').checked = snapGrid;
  $('toggle-labels').checked = showLabels;
}
function pushHistory() {
  undoStack.push(JSON.stringify(objects));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(objects)); objects = JSON.parse(undoStack.pop()); selectedId = null; renderObjects(); syncProps(); saveDesign(); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(objects)); objects = JSON.parse(redoStack.pop()); selectedId = null; renderObjects(); syncProps(); saveDesign(); }

/* ===================================================================== */
/*  SCALE BAR                                                            */
/* ===================================================================== */
function updateScaleBar() {
  const targetPx = 80;
  const targetM = targetPx * metersPerPixel;
  const nice = niceNumber(targetM);
  const px = nice / metersPerPixel;
  $('scale-bar').querySelector('.scale-line').style.width = px + 'px';
  $('scale-label').textContent = nice >= 1000 ? (nice / 1000) + ' km' : nice + ' m';
}
function niceNumber(x) {
  if (x <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / pow;
  let m;
  if (n < 1.5) m = 1; else if (n < 3.5) m = 2; else if (n < 7.5) m = 5; else m = 10;
  return m * pow;
}

/* ===================================================================== */
/*  EXPORT / IMPORT                                                      */
/* ===================================================================== */
function exportJSON() {
  const data = { baseType, mapCenter, mapZoom, objects, view, metersPerWorldUnit, plot, bgImg, bgDataUrl, version: 2 };
  download('garden-design.json', JSON.stringify(data, null, 2), 'application/json');
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d.objects) throw new Error('bad file');
      pushHistory();
      baseType = d.baseType || 'satellite';
      if (d.bgDataUrl) bgDataUrl = d.bgDataUrl;
      restoreDesign(d);
      if (baseType === 'satellite' && map) { if (d.mapCenter) map.setCenter(d.mapCenter); if (d.mapZoom) map.setZoom(d.mapZoom); }
      enterDraw(false);
      saveDesign();
    } catch (e) { alert('Could not import: ' + e.message); }
  };
  reader.readAsText(file);
}

function exportPNG() {
  const r = $('canvas-area').getBoundingClientRect();
  const w = Math.round(r.width), h = Math.round(r.height);

  if (baseType !== 'satellite') {
    // The SVG already contains the background image / grid + objects — just rasterise it.
    rasterizeOverlay(w, h, null);
    return;
  }
  // satellite: fetch a static aerial at the same framing, then overlay the SVG
  const lat = mapCenter.lat, lng = mapCenter.lng;
  const s = Math.min(w, 1280);
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${mapZoom}&size=${s}x${Math.round(s*h/w)}&maptype=satellite&key=${encodeURIComponent(apiKey)}`;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => rasterizeOverlay(w, h, img);
  img.onerror = () => alert('Could not fetch satellite image. Check your API key has Static Maps API enabled.');
  img.src = url;
}

function rasterizeOverlay(w, h, bgImage) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1a1f1c'; ctx.fillRect(0, 0, w, h);
  if (bgImage) ctx.drawImage(bgImage, 0, 0, w, h);
  const svg = $('drawing-layer').cloneNode(true);
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  const xml = new XMLSerializer().serializeToString(svg);
  const svgImg = new Image();
  svgImg.onload = () => { ctx.drawImage(svgImg, 0, 0, w, h); cv.toBlob(b => downloadBlob(b, 'garden-plan.png'), 'image/png'); };
  svgImg.onerror = () => { alert('Could not render the overlay.'); };
  svgImg.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  downloadBlob(blob, name);
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ===================================================================== */
/*  MENU / MISC WIRING                                                   */
/* ===================================================================== */
function bindMenu() {
  $('save-btn').onclick = () => $('menu-modal').classList.remove('hidden');
  $('menu-close').onclick = () => $('menu-modal').classList.add('hidden');
  $('menu-btn').onclick = () => $('menu-modal').classList.remove('hidden');
  $('export-json').onclick = exportJSON;
  $('export-png').onclick = exportPNG;
  $('import-json').onchange = (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); };
  $('new-design').onclick = () => { if (confirm('Start a new design? This clears the current plan and returns to the start screen.')) { objects = []; selectedId = null; bgDataUrl = null; $('props-panel').classList.add('hidden'); $('menu-modal').classList.add('hidden'); location.reload(); } };
  $('clear-all').onclick = () => { if (confirm('Delete everything?')) { pushHistory(); objects = []; selectedId = null; renderObjects(); saveDesign(); $('menu-modal').classList.add('hidden'); } };
  $('change-key').onclick = () => { if (confirm('Remove saved API key and go to setup?')) { localStorage.removeItem('gd_apikey'); sessionStorage.removeItem('gd_apikey'); location.reload(); } };
  $('toggle-grid').onchange = (e) => { snapGrid = e.target.checked; };
  $('toggle-labels').onchange = (e) => { showLabels = e.target.checked; renderObjects(); saveDesign(); };
  $('undo-btn').onclick = undo;
  $('redo-btn').onclick = redo;
  $('reframe-btn').onclick = reframe;

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedId) { e.preventDefault(); deleteSelected(); } }
    if (e.key === 'Escape') { cancelPlacing(); selectedId = null; $('props-panel').classList.add('hidden'); renderObjects(); }
  });
}

/* Service worker */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* ---------- BOOT ---------- */
function boot() {
  init();
  buildPalette();
  bindCanvas();
  bindProps();
  bindMenu();
  window.addEventListener('resize', () => queueRender());
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
