'use strict';
/* =====================================================================
   GARDEN DESIGNER — plan-mode garden planner
   Architecture:
     - Google Maps JS API provides live satellite (framing mode)
     - "Lock" freezes the map; an SVG overlay becomes the drawing surface
     - Objects are stored in LAT/LNG + meters, so they're anchored to reality
     - metersPerPixel = 156543.03392 * cos(lat) / 2^zoom  → real scale
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
      greenhouse:{name: 'Greenhouse', icon: '植物园',color: '#7ec8a0',shape: 'rect',      w: 3,   h: 2 },
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
let overlay = null;        // OverlayView for projection access
let mode = 'setup';        // setup | framing | draw
let objects = [];          // {id,type,lat,lng,w,h,rot,label}
let selectedId = null;
let placingType = null;    // when set, next click places this type
let metersPerPixel = 1;
let mapCenter = null;      // {lat,lng}
let mapZoom = 20;
let undoStack = [];
let redoStack = [];
let snapGrid = true;
let showLabels = true;
let currentTab = 'plants';
let dragState = null;
let renderQueued = false;

/* ===================================================================== */
/*  SETUP / API KEY                                                      */
/* ===================================================================== */
function init() {
  $('api-key-input').addEventListener('input', (e) => {
    $('start-btn').disabled = e.target.value.trim().length < 10;
  });
  $('start-btn').addEventListener('click', () => {
    apiKey = $('api-key-input').value.trim();
    if ($('remember-key').checked) localStorage.setItem('gd_apikey', apiKey);
    else sessionStorage.setItem('gd_apikey', apiKey);
    enterFraming();
  });

  if (apiKey) { $('api-key-input').value = apiKey; $('start-btn').disabled = false; }
  // Auto-start if key exists + a design is saved
  const saved = loadDesign();
  if (apiKey && saved && saved.mapCenter) {
    enterFraming(() => {
      restoreDesign(saved);
      if (saved.objects && saved.objects.length) enterDraw(false);
    });
  }
}

function loadGoogleMaps(cb) {
  if (window.google && window.google.maps) { cb(); return; }
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=geometry&callback=__gmapsCb`;
  window.__gmapsCb = () => cb();
  s.onerror = () => alert('Could not load Google Maps. Check your API key and that Maps JavaScript API + Geocoding API are enabled.');
  document.head.appendChild(s);
}

/* ===================================================================== */
/*  PROJECTION OVERLAY                                                   */
/* ===================================================================== */
class ProjectionOverlay extends google.maps.OverlayView {
  constructor(map) { super(); this.setMap(map); }
  draw() {}
  onAdd() {}
  onRemove() {}
}

function proj() { return overlay.getProjection(); }
function latLngToPx(lat, lng) {
  const p = proj();
  if (!p) return { x: 0, y: 0 };
  const px = p.fromLatLngToContainerPixel(new google.maps.LatLng(lat, lng));
  return { x: px.x, y: px.y };
}
function pxToLatLng(x, y) {
  const p = proj();
  if (!p) return null;
  return p.fromContainerPixelToLatLng(new google.maps.Point(x, y));
}
function computeMetersPerPixel() {
  const lat = mapCenter ? mapCenter.lat : 0;
  return 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, mapZoom);
}

/* ===================================================================== */
/*  FRAMING MODE                                                         */
/* ===================================================================== */
function enterFraming(cb) {
  mode = 'framing';
  $('setup-screen').classList.add('hidden');
  $('topbar').classList.remove('hidden');
  $('framing-bar').classList.remove('hidden');
  $('canvas-area').classList.add('visible');
  $('palette').classList.add('hidden');
  $('lock-overlay-hint').classList.add('hidden');

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
      overlay = new ProjectionOverlay(map);
      map.addListener('bounds_changed', () => queueRender());
      map.addListener('idle', () => { mapCenter = { lat: map.getCenter().lat(), lng: map.getCenter().lng() }; mapZoom = map.getZoom(); metersPerPixel = computeMetersPerPixel(); updateScaleBar(); queueRender(); });
      // defer callback until projection ready
      google.maps.event.addListenerOnce(map, 'idle', () => setTimeout(cb, 50));
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
  $('reframe-btn').onclick = () => { selectedId = null; renderObjects(); enterFraming(); };
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
/*  DRAW MODE (locked)                                                   */
/* ===================================================================== */
function enterDraw(lock) {
  mode = 'draw';
  if (lock) {
    mapCenter = { lat: map.getCenter().lat(), lng: map.getCenter().lng() };
    mapZoom = map.getZoom();
    enableMapInteraction(false);
  }
  $('framing-bar').classList.add('hidden');
  $('palette').classList.remove('hidden');
  $('scale-bar').classList.remove('hidden');
  metersPerPixel = computeMetersPerPixel();
  updateScaleBar();
  renderObjects();
  saveDesign();
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
  // visual hint via title flash
  const hint = document.createElement('div');
  hint.id = 'place-hint';
  hint.textContent = `👆 Tap on the map to place ${TYPES[typeKey].name}`;
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
  // size svg to container
  const r = $('canvas-area').getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
  svg.innerHTML = '';

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

function renderShape(t, w, h) {
  const wrap = el('g', {});
  const style = `fill:${t.color};fill-opacity:0.78;stroke:${shade(t.color, -30)};stroke-width:1.5`;
  if (t.shape === 'circle') {
    const r = Math.min(w, h) / 2;
    wrap.appendChild(el('circle', { cx: 0, cy: 0, r, style }));
    // inner texture ring for trees
    wrap.appendChild(el('circle', { cx: 0, cy: 0, r: r * 0.6, fill: 'none', stroke: shade(t.color, 20), 'stroke-width': 1, 'stroke-opacity': 0.5 }));
  } else if (t.shape === 'roundrect') {
    wrap.appendChild(el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(w, h) * 0.15, style }));
  } else if (t.shape === 'rect') {
    wrap.appendChild(el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, style }));
  } else if (t.shape === 'blob') {
    // pond organic shape
    wrap.appendChild(el('path', { d: blobPath(w, h), style }));
  }
  // icon emoji centered
  wrap.appendChild(el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Math.min(w, h) * 0.5, y: 0 }, t.icon.length > 2 ? '' : t.icon));
  return wrap;
}

function blobPath(w, h) {
  // simple irregular closed curve
  const a = w / 2, b = h / 2;
  return `M ${-a * 0.8} ${-b} C ${a} ${-b*1.1}, ${a*1.1} ${b*0.5}, ${a*0.4} ${b} C ${-a*1.05} ${b*1.05}, ${-a*1.1} ${-b*0.3}, ${-a*0.8} ${-b} Z`;
}

function renderSelection(w, h) {
  const g = el('g', { class: 'sel' });
  g.appendChild(el('rect', { class: 'selection-box', x: -w / 2 - 6, y: -h / 2 - 6, width: w + 12, height: h + 12, rx: 4 }));
  // corner resize handles
  const corners = [[-w/2-6,-h/2-6],[w/2+6,-h/2-6],[w/2+6,h/2+6],[-w/2-6,h/2+6]];
  for (const [cx,cy] of corners) g.appendChild(el('rect', { class:'handle', x:cx-5, y:cy-5, width:10, height:10, rx:2, 'data-handle':'resize' }));
  // rotate handle above top edge
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
}

function onPointerDown(e) {
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

  // empty space → deselect / cancel placing
  if (placingType) { cancelPlacing(); return; }
  selectedId = null;
  $('props-panel').classList.add('hidden');
  renderObjects();
}

function onPointerMove(e) {
  if (!dragState) return;
  const o = objects.find(x => x.id === dragState.id);
  if (!o) return;
  const pt = svgPoint(e);

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
    const ang = Math.atan2(pt.y - cyOffset(0), pt.x - cx.x) * 180 / Math.PI;
    const startAng = Math.atan2(dragState.startPt.y - cx.y, dragState.startPt.x - cx.x) * 180 / Math.PI;
    o.rot = (dragState.startRot + (ang - startAng) + 360) % 360;
  }
  renderObjects(); syncProps();
}
function cyOffset() { return 0; }

function onPointerUp() {
  if (dragState) { pushHistory(); saveDesign(); }
  dragState = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
}

function roundGrid(v) { return Math.round(v * 10000) / 10000; }

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
  $('prop-duplicate').onclick = () => { const o = objects.find(x => x.id === selectedId); if (o) { pushHistory(); const n = { ...o, id: 'o'+Date.now(), lat: o.lat + 0.00005, lng: o.lng + 0.00005 }; objects.push(n); selectedId = n.id; renderObjects(); syncProps(); saveDesign(); } };
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
  const data = { mapCenter, mapZoom, objects, snapGrid, showLabels, savedAt: Date.now() };
  localStorage.setItem('gd_design', JSON.stringify(data));
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
  // pick a "nice" round distance near 80px
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
  const data = { mapCenter, mapZoom, objects, version: 1 };
  download('garden-design.json', JSON.stringify(data, null, 2), 'application/json');
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d.objects) throw new Error('bad file');
      pushHistory();
      restoreDesign(d);
      if (d.mapCenter) map.setCenter(d.mapCenter);
      if (d.mapZoom) map.setZoom(d.mapZoom);
      enterDraw(false);
      renderObjects();
      saveDesign();
    } catch (e) { alert('Could not import: ' + e.message); }
  };
  reader.readAsText(file);
}
function exportPNG() {
  // Compose: satellite snapshot (via Static Maps) + SVG overlay → canvas
  const r = $('canvas-area').getBoundingClientRect();
  const w = Math.round(r.width), h = Math.round(r.height);
  const lat = mapCenter.lat, lng = mapCenter.lng;
  // static map at same zoom & size — note max size 640, scale 2
  const s = Math.min(w, 1280);
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${mapZoom}&size=${s}x${Math.round(s*h/w)}&maptype=satellite&key=${encodeURIComponent(apiKey)}`;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    // serialize SVG overlay
    const svg = $('drawing-layer').cloneNode(true);
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    const xml = new XMLSerializer().serializeToString(svg);
    const svgImg = new Image();
    svgImg.onload = () => { ctx.drawImage(svgImg, 0, 0, w, h); cv.toBlob(b => downloadBlob(b, 'garden-plan.png'), 'image/png'); };
    svgImg.onerror = () => { alert('Could not render overlay.'); };
    svgImg.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  };
  img.onerror = () => alert('Could not fetch satellite image. Check your API key has Static Maps API enabled.');
  img.src = url;
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
  $('new-design').onclick = () => { if (confirm('Start a new design? This clears the current plan.')) { pushHistory(); objects = []; selectedId = null; $('props-panel').classList.add('hidden'); $('menu-modal').classList.add('hidden'); enterFraming(); } };
  $('clear-all').onclick = () => { if (confirm('Delete everything?')) { pushHistory(); objects = []; selectedId = null; renderObjects(); saveDesign(); $('menu-modal').classList.add('hidden'); } };
  $('change-key').onclick = () => { if (confirm('Remove saved API key and go to setup?')) { localStorage.removeItem('gd_apikey'); sessionStorage.removeItem('gd_apikey'); location.reload(); } };
  $('toggle-grid').onchange = (e) => { snapGrid = e.target.checked; };
  $('toggle-labels').onchange = (e) => { showLabels = e.target.checked; renderObjects(); saveDesign(); };
  $('undo-btn').onclick = undo;
  $('redo-btn').onclick = redo;

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
// Run now if DOM is ready, otherwise wait — app.js sits at end of <body>,
// so DOM is usually already parsed by the time we execute.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
