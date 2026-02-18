/*  Timeline montage (démo améliorée)
    - Drag & drop clips pour changer leur place (rushs)
    - Résout les overlaps (un clip “pousse” les suivants)
    - Fondu au blanc (transition) réglable
    - Sélection + Suppr pour supprimer, Ctrl+D pour dupliquer
*/

const els = {
  btnPlay: document.getElementById("btnPlay"),
  btnStop: document.getElementById("btnStop"),
  timeReadout: document.getElementById("timeReadout"),
  toggleTicks: document.getElementById("toggleTicks"),
  toggleClipBeep: document.getElementById("toggleClipBeep"),
  zoom: document.getElementById("zoom"),
  timelineWrap: document.getElementById("timelineWrap"),
  ruler: document.getElementById("ruler"),
  trackV1: document.getElementById("trackV1"),
  playhead: document.getElementById("playhead"),
  canvas: document.getElementById("previewCanvas"),
  clipName: document.getElementById("clipName"),
  clipInfo: document.getElementById("clipInfo"),

  // Transition UI (ajoutée dans index.html)
  toggleWhiteFade: document.getElementById("toggleWhiteFade"),
  whiteFadeDur: document.getElementById("whiteFadeDur"),
  whiteFadeDurLabel: document.getElementById("whiteFadeDurLabel"),
};

const ctx2d = els.canvas.getContext("2d");

// ---- Données clips (rushs)
let clips = [
  { id: "c1", name: "Plan 1 — Intro",  dur: 3.2, colorA: "#2de2e6", colorB: "#4f46e5" },
  { id: "c2", name: "Plan 2 — Ville",  dur: 4.0, colorA: "#fb7185", colorB: "#8b5cf6" },
  { id: "c3", name: "Plan 3 — Nature", dur: 5.0, colorA: "#34d399", colorB: "#22c55e" },
  { id: "c4", name: "Plan 4 — Détail", dur: 2.6, colorA: "#fbbf24", colorB: "#f97316" },
  { id: "c5", name: "Plan 5 — Outro",  dur: 3.8, colorA: "#93c5fd", colorB: "#60a5fa" },
];

// timeline calculée : start/end
let timeline = [];
let totalDur = 0;

// ---- État
let playing = false;
let t = 0;
let rafId = null;
let lastFrameTime = null;

let pxPerSec = 120;

let selectedClipId = null;

// Drag state pour CLIP
let drag = {
  active: false,
  clipId: null,
  pointerId: null,
  grabOffsetPx: 0,
};

// Drag state pour SCRUB (timeline)
let scrub = {
  active: false,
  pointerId: null
};

// ---- Audio (identique à avant)
let audioCtx = null;
let lastTickSecond = -1;
let lastClipId = null;

function ensureAudio(){
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(()=>{});
}
function blip(freq = 880, ms = 60, gain = 0.06){
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();

  osc.type = "sine";
  osc.frequency.value = freq;

  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + ms/1000);

  osc.connect(g).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + ms/1000 + 0.02);
}
function processAudioEvents(){
  if (els.toggleTicks?.checked) {
    const secInt = Math.floor(t);
    if (secInt !== lastTickSecond) {
      lastTickSecond = secInt;
      blip(660, 30, 0.035);
    }
  }
  const c = getClipAt(t);
  if (els.toggleClipBeep?.checked) {
    const idNow = c ? c.id : null;
    if (idNow && idNow !== lastClipId) {
      lastClipId = idNow;
      blip(990, 80, 0.055);
    }
  } else {
    lastClipId = c ? c.id : null;
  }
}

// ---- Utilitaires
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function pad2(n){ return String(n).padStart(2,"0"); }
function formatTime(sec){
  const m = Math.floor(sec / 60);
  const s = sec - m*60;
  const si = Math.floor(s);
  const tenths = Math.floor((s - si) * 10);
  return `${pad2(m)}:${pad2(si)}.${tenths}`;
}
function escapeHtml(str){
  return str.replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[s]));
}
function clipDurLabel(d){ return `${d.toFixed(1)}s`; }

// ---- Transition (fondu blanc)
function getWhiteFadeDurSec(){
  const ms = Number(els.whiteFadeDur?.value ?? 600);
  return clamp(ms, 0, 3000) / 1000;
}

// ---- Build timeline (start/end) à partir des clips & leurs positions
function rebuildTimeline(){
  // si pas de start, on construit en séquence
  let cur = 0;
  timeline = clips.map((c, i) => {
    const start = (typeof c.start === "number") ? c.start : cur;
    const end = start + c.dur;
    cur = end;
    return { ...c, start, end };
  });

  // si on a des starts (drag), on trie par start et on “pousse” pour éviter overlap
  timeline.sort((a,b) => a.start - b.start);

  // push overlap
  for (let i=1; i<timeline.length; i++){
    const prev = timeline[i-1];
    const curC = timeline[i];
    if (curC.start < prev.end) curC.start = prev.end;
    curC.end = curC.start + curC.dur;
  }

  // réinjecter starts dans clips (source de vérité)
  const byId = new Map(timeline.map(c => [c.id, c]));
  clips = clips.map(c => {
    const x = byId.get(c.id);
    return x ? { ...c, start: x.start } : c;
  });

  // total duration
  totalDur = timeline.length ? timeline[timeline.length-1].end : 0;
}

// ---- Clip courant
function getClipAt(timeSec){
  if (!timeline.length) return null;
  if (timeSec >= totalDur) return timeline[timeline.length - 1];
  return timeline.find(c => timeSec >= c.start && timeSec < c.end) ?? null;
}

// ---- Zoom
function updateZoom(){
  pxPerSec = Number(els.zoom.value);
  renderRuler();
  renderClips();
  updatePlayhead();
  updateReadout();
  updatePreview();
}
els.zoom.addEventListener("input", updateZoom);

// ---- Ruler
function renderRuler(){
  els.ruler.innerHTML = "";
  const width = Math.ceil(totalDur * pxPerSec) + 120;
  els.ruler.style.width = width + "px";

  const minorEvery = 0.5;
  const majorEvery = 1;

  for (let x = 0; x <= totalDur + 1e-9; x += minorEvery){
    const isMajor = Math.abs((x / majorEvery) - Math.round(x / majorEvery)) < 1e-9;

    const mark = document.createElement("div");
    mark.style.position = "absolute";
    mark.style.left = (x * pxPerSec) + "px";
    mark.style.top = "0";
    mark.style.height = "34px";
    mark.style.width = "1px";
    mark.style.background = isMajor ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.10)";
    els.ruler.appendChild(mark);

    if (isMajor){
      const label = document.createElement("div");
      label.textContent = `${x.toFixed(0)}s`;
      label.style.position = "absolute";
      label.style.left = (x * pxPerSec + 6) + "px";
      label.style.top = "8px";
      label.style.fontSize = "11px";
      label.style.color = "rgba(255,255,255,.65)";
      label.style.fontVariantNumeric = "tabular-nums";
      els.ruler.appendChild(label);
    }
  }
}

// ---- Rendu clips + events drag
function renderClips(){
  els.trackV1.innerHTML = "";
  const width = Math.ceil(totalDur * pxPerSec) + 120;
  els.trackV1.style.width = width + "px";

  for (const c of timeline){
    const el = document.createElement("div");
    el.className = "clip";
    if (c.id === selectedClipId) el.classList.add("selected");
    el.dataset.clipId = c.id;

    const leftPx = (c.start * pxPerSec + 6);
    el.style.left = leftPx + "px";
    el.style.width = Math.max(70, (c.dur * pxPerSec - 12)) + "px";
    el.style.background = `linear-gradient(135deg, ${c.colorA}, ${c.colorB})`;

    el.innerHTML = `
      <div class="handles" aria-hidden="true">
        <div class="handle"></div>
        <div class="handle"></div>
      </div>
      <div class="clip-inner">
        <div class="name">${escapeHtml(c.name)}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="chip">V1</div>
          <div class="dur">${clipDurLabel(c.dur)}</div>
        </div>
      </div>
    `;

    // sélection
    el.addEventListener("pointerdown", (ev) => {
      // Si on clique un clip : on sélectionne et on init drag clip
      ev.stopPropagation();
      selectClip(c.id);

      drag.active = true;
      drag.clipId = c.id;
      drag.pointerId = ev.pointerId;

      const rect = el.getBoundingClientRect();
      drag.grabOffsetPx = ev.clientX - rect.left;

      el.classList.add("dragging");
      el.setPointerCapture(ev.pointerId);
    });

    el.addEventListener("pointermove", (ev) => {
      if (!drag.active || drag.pointerId !== ev.pointerId) return;
      if (drag.clipId !== c.id) return;

      const wrapRect = els.timelineWrap.getBoundingClientRect();
      const xInWrap = (ev.clientX - wrapRect.left) + els.timelineWrap.scrollLeft;

      // position voulue = xInWrap - grabOffset
      const newLeftPx = xInWrap - drag.grabOffsetPx;
      const newStart = clamp((newLeftPx - 6) / pxPerSec, 0, Math.max(0, totalDur));

      // update source clip start
      const idx = clips.findIndex(k => k.id === c.id);
      if (idx >= 0) clips[idx].start = newStart;

      rebuildTimeline();
      renderRuler();
      renderClips();
      updatePlayhead();
      updateReadout();
      updatePreview();
    });

    el.addEventListener("pointerup", (ev) => {
      if (!drag.active || drag.pointerId !== ev.pointerId) return;
      drag.active = false;
      drag.clipId = null;
      drag.pointerId = null;
      drag.grabOffsetPx = 0;

      // reconstruit proprement et rerender
      rebuildTimeline();
      renderRuler();
      renderClips();
      updatePreview();
    });

    el.addEventListener("pointercancel", () => {
      drag.active = false;
      drag.clipId = null;
      drag.pointerId = null;
    });

    els.trackV1.appendChild(el);
  }
}

// ---- Sélection / actions
function selectClip(id){
  selectedClipId = id;
  renderClips();
  updatePreview();
}

function deleteSelected(){
  if (!selectedClipId) return;
  clips = clips.filter(c => c.id !== selectedClipId);
  selectedClipId = null;
  rebuildTimeline();
  renderRuler();
  renderClips();
  seekTo(clamp(t, 0, totalDur));
}

function duplicateSelected(){
  if (!selectedClipId) return;
  const base = clips.find(c => c.id === selectedClipId);
  if (!base) return;
  const newId = "c" + Math.random().toString(16).slice(2, 7);
  const copy = { ...base, id: newId, name: base.name + " (copie)", start: (base.start ?? 0) + 0.2 };
  clips.push(copy);
  rebuildTimeline();
  renderRuler();
  renderClips();
  selectClip(newId);
}

// ---- Playhead / seek
function updatePlayhead(){
  const x = t * pxPerSec;
  els.playhead.style.left = x + "px";
}
function updateReadout(){
  els.timeReadout.textContent = `${formatTime(t)} / ${formatTime(totalDur)}`;
}

function eventToTimeSec(ev){
  const wrapRect = els.timelineWrap.getBoundingClientRect();
  const xInWrap = (ev.clientX - wrapRect.left) + els.timelineWrap.scrollLeft;
  return clamp(xInWrap / pxPerSec, 0, totalDur);
}
function seekTo(timeSec){
  t = clamp(timeSec, 0, totalDur);
  updatePlayhead();
  updateReadout();
  updatePreview();
}

// ---- Scrub timeline (clic/drag dans la zone vide)
els.timelineWrap.addEventListener("pointerdown", (ev) => {
  // si on clique dans timelineWrap (pas un clip) => scrub
  if (ev.target.closest(".clip")) return;
  scrub.active = true;
  scrub.pointerId = ev.pointerId;
  els.timelineWrap.setPointerCapture(ev.pointerId);
  seekTo(eventToTimeSec(ev));
});

els.timelineWrap.addEventListener("pointermove", (ev) => {
  if (!scrub.active || scrub.pointerId !== ev.pointerId) return;
  seekTo(eventToTimeSec(ev));
});

els.timelineWrap.addEventListener("pointerup", (ev) => {
  if (!scrub.active || scrub.pointerId !== ev.pointerId) return;
  scrub.active = false;
  scrub.pointerId = null;
});

els.timelineWrap.addEventListener("pointercancel", () => {
  scrub.active = false;
  scrub.pointerId = null;
});

// ---- Clavier
els.timelineWrap.addEventListener("keydown", (ev) => {
  if (ev.code === "Space") { ev.preventDefault(); togglePlay(); }
  if (ev.code === "Delete" || ev.code === "Backspace") { ev.preventDefault(); deleteSelected(); }
  if (ev.ctrlKey && ev.code === "KeyD") { ev.preventDefault(); duplicateSelected(); }

  if (ev.code === "Home") seekTo(0);
  if (ev.code === "End") seekTo(totalDur);
  if (ev.code === "ArrowLeft") seekTo(t - 0.1);
  if (ev.code === "ArrowRight") seekTo(t + 0.1);
});

// ---- UI transition label
function updateFadeLabel(){
  if (!els.whiteFadeDurLabel || !els.whiteFadeDur) return;
  els.whiteFadeDurLabel.textContent = `${Number(els.whiteFadeDur.value)} ms`;
}
els.whiteFadeDur?.addEventListener("input", () => {
  updateFadeLabel();
  updatePreview();
});
els.toggleWhiteFade?.addEventListener("change", updatePreview);

// ---- Lecture
function togglePlay(){
  if (!playing) start();
  else pause();
}
function start(){
  ensureAudio();
  playing = true;
  els.btnPlay.textContent = "⏸ Pause";
  lastFrameTime = null;
  rafId = requestAnimationFrame(loop);
}
function pause(){
  playing = false;
  els.btnPlay.textContent = "▶︎ Play";
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  lastFrameTime = null;
}
function stop(){
  pause();
  lastTickSecond = -1;
  lastClipId = null;
  seekTo(0);
}
els.btnPlay.addEventListener("click", togglePlay);
els.btnStop.addEventListener("click", stop);

function loop(ts){
  if (!playing) return;
  if (lastFrameTime == null) lastFrameTime = ts;
  const dt = (ts - lastFrameTime) / 1000;
  lastFrameTime = ts;

  t += dt;

  if (t >= totalDur) {
    t = totalDur;
    updatePlayhead();
    updateReadout();
    updatePreview();
    pause();
    return;
  }

  updatePlayhead();
  updateReadout();
  updatePreview();
  processAudioEvents();

  rafId = requestAnimationFrame(loop);
}

// ---- Preview canvas + fondu blanc
function drawGradientBackground(colorA, colorB){
  const w = els.canvas.width, h = els.canvas.height;
  const g = ctx2d.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, colorA);
  g.addColorStop(1, colorB);
  ctx2d.fillStyle = g;
  ctx2d.fillRect(0, 0, w, h);

  const v = ctx2d.createRadialGradient(w*0.5, h*0.45, h*0.1, w*0.5, h*0.45, h*0.8);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx2d.fillStyle = v;
  ctx2d.fillRect(0, 0, w, h);
}
function roundRect(c, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  c.beginPath();
  c.moveTo(x+rr, y);
  c.arcTo(x+w, y, x+w, y+h, rr);
  c.arcTo(x+w, y+h, x, y+h, rr);
  c.arcTo(x, y+h, x, y, rr);
  c.arcTo(x, y, x+w, y, rr);
  c.closePath();
}
function drawHUD(text1, text2){
  const w = els.canvas.width;
  ctx2d.fillStyle = "rgba(0,0,0,0.35)";
  ctx2d.fillRect(40, 40, w-80, 120);

  ctx2d.fillStyle = "rgba(255,255,255,.92)";
  ctx2d.font = "700 44px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx2d.fillText(text1, 70, 95);

  ctx2d.fillStyle = "rgba(255,255,255,.75)";
  ctx2d.font = "500 26px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx2d.fillText(text2, 70, 135);
}
function drawProgressBar(progress){
  const w = els.canvas.width;
  const h = els.canvas.height;

  const barW = w - 120;
  const x = 60;
  const y = h - 70;

  ctx2d.fillStyle = "rgba(255,255,255,.18)";
  roundRect(ctx2d, x, y, barW, 16, 10);
  ctx2d.fill();

  ctx2d.fillStyle = "rgba(255,255,255,.85)";
  roundRect(ctx2d, x, y, barW * progress, 16, 10);
  ctx2d.fill();
}

// easing simple pour fondu
function smooth01(x){
  const v = clamp(x, 0, 1);
  return v*v*(3 - 2*v);
}

function computeWhiteFadeAlpha(c, timeSec){
  if (!els.toggleWhiteFade?.checked) return 0;
  const d = getWhiteFadeDurSec();
  if (d <= 0.0001) return 0;

  // fondu vers blanc à la fin du clip
  let aEnd = 0;
  const endStart = c.end - d;
  if (timeSec >= endStart && timeSec <= c.end){
    aEnd = smooth01((timeSec - endStart) / d); // 0 -> 1
  }

  // fondu depuis blanc au début du clip
  let aStart = 0;
  const startEnd = c.start + d;
  if (timeSec >= c.start && timeSec <= startEnd){
    aStart = 1 - smooth01((timeSec - c.start) / d); // 1 -> 0
  }

  return Math.max(aEnd, aStart);
}

function updatePreview(){
  const c = getClipAt(t);

  if (!c) {
    ctx2d.clearRect(0,0,els.canvas.width, els.canvas.height);
    els.clipName.textContent = "—";
    els.clipInfo.textContent = "—";
    return;
  }

  const clipT = clamp(t - c.start, 0, c.dur);
  const p = c.dur > 0 ? clipT / c.dur : 0;

  drawGradientBackground(c.colorA, c.colorB);

  // animation simple
  const w = els.canvas.width, h = els.canvas.height;
  const a = Math.sin(p * Math.PI * 2);
  const b = Math.cos(p * Math.PI * 2);

  ctx2d.fillStyle = "rgba(255,255,255,.20)";
  ctx2d.beginPath();
  ctx2d.arc(w*0.72 + a*60, h*0.40 + b*40, 90, 0, Math.PI*2);
  ctx2d.fill();

  ctx2d.fillStyle = "rgba(255,255,255,.12)";
  ctx2d.beginPath();
  ctx2d.arc(w*0.25 + b*70, h*0.62 + a*45, 120, 0, Math.PI*2);
  ctx2d.fill();

  drawHUD(c.name, `Clip ${c.id.toUpperCase()} • ${clipDurLabel(c.dur)} • t=${formatTime(t)}`);
  drawProgressBar(p);

  // Fondu au blanc
  const alpha = computeWhiteFadeAlpha(c, t);
  if (alpha > 0){
    ctx2d.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx2d.fillRect(0,0,w,h);
  }

  els.clipName.textContent = c.name + (c.id === selectedClipId ? " (sélectionné)" : "");
  els.clipInfo.textContent = `Dans le plan : ${formatTime(clipT)} / ${clipDurLabel(c.dur)} (global ${formatTime(t)})`;
}

// ---- INIT
function init(){
  rebuildTimeline();
  updateFadeLabel();
  updateZoom();
  updateReadout();
  updatePreview();
  els.timelineWrap.focus();
}
init();
(() => {
  // ====== Config "simple & pro" ======
  const BASE_PX_PER_SEC = 80;         // densité standard
  const MIN_TIMELINE_SEC = 30;        // minimum affiché
  const MAX_TIMELINE_SEC = 20 * 60;   // 20 min max (évite "11 km")
  const SNAP_SEC = 0.1;               // snapping 100ms

  // ====== DOM ======
  const dropZone = document.getElementById("dropZone");
  const btnImport = document.getElementById("btnImport");
  const filePicker = document.getElementById("filePicker");
  const zoomSlider = document.getElementById("zoomSlider");
  const timeInfo = document.getElementById("timeInfo");

  const viewport = document.getElementById("timelineViewport");
  const content = document.getElementById("timelineContent");
  const ruler = document.getElementById("ruler");
  const laneVideo = document.getElementById("laneVideo");
  const laneAudio = document.getElementById("laneAudio");

  // ====== State ======
  let zoom = Number(zoomSlider.value);
  /** clips: {id, kind:'video'|'audio', name, url, duration, start, track} */
  let clips = [];
  let timelineSec = MIN_TIMELINE_SEC;

  // ====== Helpers ======
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pxPerSec = () => BASE_PX_PER_SEC * zoom;
  const secToPx = (s) => s * pxPerSec();
  const pxToSec = (px) => px / pxPerSec();
  const snap = (sec) => Math.round(sec / SNAP_SEC) * SNAP_SEC;

  function updateTimelineLength() {
    // timelineSec = max(fin de clips, min) bornée pour ne pas exploser
    const end = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    timelineSec = clamp(Math.ceil(end + 5), MIN_TIMELINE_SEC, MAX_TIMELINE_SEC);
    content.style.width = `${Math.max(900, secToPx(timelineSec) + 120)}px`;
    drawRuler();
    updateTimeInfo();
  }

  function updateTimeInfo() {
    timeInfo.textContent = `Durée: ${formatTime(timelineSec)} | Clips: ${clips.length}`;
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
  }

  function drawRuler() {
    const pps = pxPerSec();
    ruler.innerHTML = "";

    // ticks: 1s / 5s / 10s selon zoom
    let majorEvery = 5;
    if (pps < 60) majorEvery = 10;
    if (pps > 140) majorEvery = 2;

    const totalPx = secToPx(timelineSec);
    ruler.style.width = `${Math.max(900, totalPx + 120)}px`;

    const frag = document.createDocumentFragment();

    for (let s = 0; s <= timelineSec; s++) {
      const x = secToPx(s);

      // tick
      const tick = document.createElement("div");
      tick.style.position = "absolute";
      tick.style.left = `${x}px`;
      tick.style.top = "0";
      tick.style.bottom = "0";
      tick.style.width = "1px";

      const isMajor = (s % majorEvery === 0);
      tick.style.background = isMajor ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.14)";

      if (isMajor) {
        const label = document.createElement("div");
        label.textContent = s >= 60 ? `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}` : `${s}s`;
        label.style.position = "absolute";
        label.style.left = `${x + 6}px`;
        label.style.top = "6px";
        label.style.fontSize = "12px";
        label.style.opacity = ".85";
        frag.appendChild(label);
      }

      frag.appendChild(tick);
    }

    ruler.style.position = "relative";
    ruler.appendChild(frag);
  }

  function render() {
    laneVideo.innerHTML = "";
    laneAudio.innerHTML = "";

    for (const c of clips) {
      const el = document.createElement("div");
      el.className = "tl__clip";
      el.dataset.id = c.id;
      el.dataset.kind = c.kind;

      el.style.left = `${secToPx(c.start)}px`;
      el.style.width = `${Math.max(60, secToPx(c.duration))}px`;

      const title = document.createElement("div");
      title.className = "tl__clipTitle";
      title.textContent = c.name;

      const meta = document.createElement("div");
      meta.className = "tl__clipMeta";
      meta.textContent = formatTime(c.duration);

      el.appendChild(title);
      el.appendChild(meta);

      // drag clip within lane
      enableClipDrag(el, c);

      (c.track === "video" ? laneVideo : laneAudio).appendChild(el);
    }
  }

  function enableClipDrag(el, clip) {
    let dragging = false;
    let startX = 0;
    let origStart = 0;

    el.addEventListener("pointerdown", (e) => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
      startX = e.clientX;
      origStart = clip.start;
    });

    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;

      const newStart = snap(clamp(origStart + pxToSec(dx), 0, timelineSec - clip.duration));
      clip.start = newStart;

      el.style.left = `${secToPx(clip.start)}px`;

      // auto-scroll si on approche des bords du viewport
      const rect = viewport.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const edge = 60;
      if (mx > rect.width - edge) viewport.scrollLeft += 12;
      if (mx < edge) viewport.scrollLeft -= 12;

      updateTimelineLength();
    });

    el.addEventListener("pointerup", () => {
      dragging = false;
      updateTimelineLength();
      render();
    });
  }

  // ====== Import local files ======
  function isVideo(file) { return file.type.startsWith("video/"); }
  function isAudio(file) { return file.type.startsWith("audio/"); }

  async function fileToClip(file) {
    const kind = isVideo(file) ? "video" : "audio";
    const url = URL.createObjectURL(file);
    const duration = await readMediaDuration(url, kind);

    return {
      id: crypto.randomUUID(),
      kind,
      name: file.name,
      url,
      duration: clamp(duration || 3, 0.5, MAX_TIMELINE_SEC),
      start: findNextFreeStart(kind),
      track: kind // piste = kind
    };
  }

  function findNextFreeStart(kind) {
    // place à la fin sur sa piste
    const same = clips.filter(c => c.track === kind);
    const end = same.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    return snap(clamp(end, 0, MAX_TIMELINE_SEC - 1));
  }

  function readMediaDuration(url, kind) {
    return new Promise((resolve) => {
      const el = document.createElement(kind === "video" ? "video" : "audio");
      el.preload = "metadata";
      el.src = url;

      const done = (d) => {
        el.removeAttribute("src");
        el.load();
        resolve(d);
      };

      el.onloadedmetadata = () => done(el.duration);
      el.onerror = () => done(3); // fallback
    });
  }

  async function addFiles(fileList) {
    const files = [...fileList].filter(f => isVideo(f) || isAudio(f));
    if (!files.length) return;

    for (const f of files) {
      const clip = await fileToClip(f);
      clips.push(clip);
    }
    updateTimelineLength();
    render();
  }

  // ====== Dropzone events ======
  ["dragenter", "dragover"].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("isOver");
    });
  });

  ["dragleave", "drop"].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("isOver");
    });
  });

  dropZone.addEventListener("drop", async (e) => {
    await addFiles(e.dataTransfer.files);
  });

  // ====== Import button ======
  btnImport.addEventListener("click", () => filePicker.click());
  filePicker.addEventListener("change", async () => {
    await addFiles(filePicker.files);
    filePicker.value = "";
  });

  // ====== Zoom ======
  zoomSlider.addEventListener("input", () => {
    // garder le point visuel (scroll) à peu près stable
    const oldPps = pxPerSec();
    zoom = Number(zoomSlider.value);
    const newPps = pxPerSec();

    const center = viewport.scrollLeft + viewport.clientWidth / 2;
    const centerSec = center / oldPps;

    updateTimelineLength();
    render();

    viewport.scrollLeft = Math.max(0, centerSec * newPps - viewport.clientWidth / 2);
  });

  // ====== Init ======
  updateTimelineLength();
  render();
})();
