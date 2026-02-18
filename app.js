/*  Timeline montage (démo)
    - Clips intégrés (durées, couleurs, titres)
    - Play/Pause, Stop, Scrub (clic + drag)
    - Aperçu Canvas (faux rendu)
    - Son WebAudio : tic chaque seconde + bip au début de chaque clip
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
};

const ctx2d = els.canvas.getContext("2d");

// ---- Plans intégrés (tu peux en ajouter)
const clips = [
  { id: "c1", name: "Plan 1 — Intro",    dur: 3.2, colorA: "#2de2e6", colorB: "#4f46e5" },
  { id: "c2", name: "Plan 2 — Ville",    dur: 4.0, colorA: "#fb7185", colorB: "#8b5cf6" },
  { id: "c3", name: "Plan 3 — Nature",   dur: 5.0, colorA: "#34d399", colorB: "#22c55e" },
  { id: "c4", name: "Plan 4 — Détail",   dur: 2.6, colorA: "#fbbf24", colorB: "#f97316" },
  { id: "c5", name: "Plan 5 — Outro",    dur: 3.8, colorA: "#93c5fd", colorB: "#60a5fa" },
];

// Pré-calc des timecodes : start/end
let timeline = [];
let totalDur = 0;
for (const c of clips) {
  const start = totalDur;
  const end = start + c.dur;
  timeline.push({ ...c, start, end });
  totalDur = end;
}

// ---- État lecteur
let playing = false;
let t = 0; // temps courant (secondes)
let rafId = null;
let lastFrameTime = null;

// ---- Zoom et pixels/sec
let pxPerSec = 120; // sera lié au slider
function updateZoom() {
  pxPerSec = Number(els.zoom.value);
  renderRuler();
  renderClips();
  updatePlayhead();
}
els.zoom.addEventListener("input", updateZoom);

// ---- Utilitaires temps
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function pad2(n){ return String(n).padStart(2,"0"); }
function formatTime(sec){
  const m = Math.floor(sec / 60);
  const s = sec - m*60;
  const si = Math.floor(s);
  const tenths = Math.floor((s - si) * 10);
  return `${pad2(m)}:${pad2(si)}.${tenths}`;
}
function updateReadout(){
  els.timeReadout.textContent = `${formatTime(t)} / ${formatTime(totalDur)}`;
}

// ---- Trouver clip courant
function getClipAt(timeSec){
  // si timeSec == totalDur, on considère dernier clip
  if (timeSec >= totalDur) return timeline[timeline.length - 1] ?? null;
  return timeline.find(c => timeSec >= c.start && timeSec < c.end) ?? null;
}

// ---- Rendu ruler
function renderRuler(){
  els.ruler.innerHTML = "";
  const width = Math.ceil(totalDur * pxPerSec) + 60;
  els.ruler.style.width = width + "px";

  const majorEvery = 1; // seconde
  const minorEvery = 0.5;

  for (let x = 0; x <= totalDur + 0.0001; x += minorEvery) {
    const isMajor = Math.abs((x / majorEvery) - Math.round(x / majorEvery)) < 1e-9;
    const mark = document.createElement("div");
    mark.style.position = "absolute";
    mark.style.left = (x * pxPerSec) + "px";
    mark.style.top = "0";
    mark.style.height = "34px";
    mark.style.width = "1px";
    mark.style.background = isMajor ? "rgba(255,255,255,.20)" : "rgba(255,255,255,.10)";
    els.ruler.appendChild(mark);

    if (isMajor) {
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

// ---- Rendu clips
function clipDurLabel(d){ return `${d.toFixed(1)}s`; }

function renderClips(){
  els.trackV1.innerHTML = "";
  const width = Math.ceil(totalDur * pxPerSec) + 60;
  els.trackV1.style.width = width + "px";

  for (const c of timeline) {
    const el = document.createElement("div");
    el.className = "clip";
    el.dataset.clipId = c.id;

    el.style.left = (c.start * pxPerSec + 6) + "px";
    el.style.width = Math.max(60, (c.dur * pxPerSec - 12)) + "px";
    el.style.background = `linear-gradient(135deg, ${c.colorA}, ${c.colorB})`;

    el.innerHTML = `
      <div class="clip-inner">
        <div class="name">${escapeHtml(c.name)}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="chip">V1</div>
          <div class="dur">${clipDurLabel(c.dur)}</div>
        </div>
      </div>
    `;
    els.trackV1.appendChild(el);
  }
}

function escapeHtml(str){
  return str.replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[s]));
}

// ---- Playhead
function updatePlayhead(){
  const x = t * pxPerSec;
  els.playhead.style.left = x + "px";
}

// ---- Scrub (clic + drag)
let dragging = false;

function eventToTimeSec(ev){
  const wrapRect = els.timelineWrap.getBoundingClientRect();
  // position dans le contenu scrollé
  const xInWrap = (ev.clientX - wrapRect.left) + els.timelineWrap.scrollLeft;
  const time = xInWrap / pxPerSec;
  return clamp(time, 0, totalDur);
}

function seekTo(timeSec){
  t = clamp(timeSec, 0, totalDur);
  updatePlayhead();
  updateReadout();
  updatePreview();
}

function onPointerDown(ev){
  dragging = true;
  els.timelineWrap.setPointerCapture(ev.pointerId);
  seekTo(eventToTimeSec(ev));
}
function onPointerMove(ev){
  if (!dragging) return;
  seekTo(eventToTimeSec(ev));
}
function onPointerUp(ev){
  dragging = false;
}

els.timelineWrap.addEventListener("pointerdown", onPointerDown);
els.timelineWrap.addEventListener("pointermove", onPointerMove);
els.timelineWrap.addEventListener("pointerup", onPointerUp);
els.timelineWrap.addEventListener("pointercancel", () => (dragging = false));

// ---- Clavier
els.timelineWrap.addEventListener("keydown", (ev) => {
  if (ev.code === "Space") {
    ev.preventDefault();
    togglePlay();
  }
  if (ev.code === "Home") seekTo(0);
  if (ev.code === "End") seekTo(totalDur);
  if (ev.code === "ArrowLeft") seekTo(t - 0.1);
  if (ev.code === "ArrowRight") seekTo(t + 0.1);
});

// ---- Audio (WebAudio)
let audioCtx = null;
let lastTickSecond = -1;
let lastClipId = null;

function ensureAudio(){
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Sur certains navigateurs, il faut "resume" après interaction
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
  // tic chaque seconde
  if (els.toggleTicks.checked) {
    const secInt = Math.floor(t);
    if (secInt !== lastTickSecond) {
      lastTickSecond = secInt;
      blip(660, 30, 0.035);
    }
  }

  // bip début de clip
  const c = getClipAt(t);
  if (els.toggleClipBeep.checked) {
    const idNow = c ? c.id : null;
    if (idNow && idNow !== lastClipId) {
      lastClipId = idNow;
      blip(990, 80, 0.055);
    }
  } else {
    lastClipId = c ? c.id : null;
  }
}

// ---- Lecture
function togglePlay(){
  if (!playing) start();
  else pause();
}

function start(){
  ensureAudio(); // important pour débloquer le son après clic
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

// ---- Aperçu Canvas (faux “rendu vidéo”)
function drawGradientBackground(colorA, colorB){
  const w = els.canvas.width;
  const h = els.canvas.height;

  const g = ctx2d.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, colorA);
  g.addColorStop(1, colorB);

  ctx2d.fillStyle = g;
  ctx2d.fillRect(0, 0, w, h);

  // vignetage léger
  const v = ctx2d.createRadialGradient(w*0.5, h*0.45, h*0.1, w*0.5, h*0.45, h*0.8);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx2d.fillStyle = v;
  ctx2d.fillRect(0, 0, w, h);
}

function drawHUD(text1, text2){
  const w = els.canvas.width;
  const h = els.canvas.height;

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

  // fond gradient du plan
  drawGradientBackground(c.colorA, c.colorB);

  // animation simple (formes qui bougent selon p)
  const w = els.canvas.width;
  const h = els.canvas.height;
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

  // Texte / HUD
  drawHUD(c.name, `Clip ${c.id.toUpperCase()} • ${clipDurLabel(c.dur)} • t=${formatTime(t)}`);
  drawProgressBar(p);

  els.clipName.textContent = c.name;
  els.clipInfo.textContent = `Dans le plan : ${formatTime(clipT)} / ${clipDurLabel(c.dur)} (global ${formatTime(t)})`;
}

// ---- Init
function init(){
  updateZoom();
  updateReadout();
  updatePreview();

  // permettre clic dans le ruler/track, déjà géré par pointer events sur timelineWrap
  // focus auto pour raccourcis clavier
  els.timelineWrap.focus();
}
init();
