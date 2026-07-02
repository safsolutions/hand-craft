/* NeonDraw — камерадан қол танып, ауада жарқыраған сызық сызу,
   сызықты кез келген жерінен ұстап-жылжыту, кесу */

// ---------- Canvas ----------
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const video = document.getElementById('cam');
const loader = document.getElementById('loader');

// ---------- Неон түстер ----------
const COLORS = ['#00e5ff', '#ff2bd6', '#7cff3a', '#ffe14d', '#ff6a3d', '#ffffff'];
let currentColor = 0;

// ---------- Сызық деректері ----------
// stroke = { pts: [{x,y}...], color }
let strokes = [];
let activeStroke = null;   // сызу кезінде
let grabbed = null;        // { stroke, lastX, lastY } — ұсталған сызық
const MIN_DIST = 6;        // сызу кезіндегі минимал нүкте қашықтығы
const GRAB_R = 55;         // ұстау/кесу радиусы (px)

// ---------- Қосымша функциялар ----------
function dist2D(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

// Нүктеге ең жақын stroke пен нүкте индексін табу
function nearestStroke(x, y, maxR) {
  let best = null, bestD = maxR;
  for (const s of strokes) {
    for (let i = 0; i < s.pts.length; i++) {
      const d = dist2D(x, y, s.pts[i].x, s.pts[i].y);
      if (d < bestD) { bestD = d; best = { stroke: s, index: i, d }; }
    }
  }
  return best;
}

// ---------- Жарқыраған сызу ----------
function drawStroke(s, glow) {
  if (s.pts.length < 2) {
    // жалғыз нүкте — жарқыраған дақ
    if (s.pts.length === 1) {
      const p = s.pts[0];
      ctx.beginPath();
      ctx.fillStyle = s.color;
      ctx.shadowBlur = glow; ctx.shadowColor = s.color;
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(s.pts[0].x, s.pts[0].y);
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // 1) кең жұмсақ жарық
  ctx.shadowBlur = glow; ctx.shadowColor = s.color;
  ctx.strokeStyle = s.color; ctx.globalAlpha = 0.35; ctx.lineWidth = 12;
  path(); ctx.stroke();
  // 2) негізгі өзек
  ctx.globalAlpha = 0.9; ctx.lineWidth = 4;
  path(); ctx.stroke();
  // 3) ақ ыстық өзек
  ctx.shadowBlur = 0; ctx.globalAlpha = 0.95; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
  path(); ctx.stroke();
  ctx.globalAlpha = 1;
}

// ---------- Overlay (қол қаңқасы) ----------
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17]
];
function drawHand(lm, w, h, color) {
  ctx.save();
  ctx.shadowBlur = 0; ctx.globalAlpha = 0.5;
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  ctx.restore();
}

// Курсор (жест түсіне қарай)
function drawCursor(x, y, color, r) {
  ctx.save();
  ctx.shadowBlur = 18; ctx.shadowColor = color;
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}

// ---------- Жест тану ----------
function d3(a, b) { return Math.hypot(a.x-b.x, a.y-b.y, (a.z||0)-(b.z||0)); }
function fingerUp(lm, tip, pip) { return d3(lm[tip], lm[0]) > d3(lm[pip], lm[0]) * 1.05; }

function detectGesture(lm) {
  const scale = d3(lm[0], lm[9]) || 1;
  const pinch = (d3(lm[4], lm[8]) / scale) < 0.45;
  const idx = fingerUp(lm, 8, 6);
  const mid = fingerUp(lm, 12, 10);
  const rng = fingerUp(lm, 16, 14);
  const pky = fingerUp(lm, 20, 18);
  const up = [idx, mid, rng, pky].filter(Boolean).length;

  if (pinch) return 'grab';                       // 🤏 ұстау
  if (idx && mid && !rng && !pky) return 'cut';   // ✌️ кесу
  if (idx && !mid) return 'draw';                 // ☝️ сызу
  return 'idle';                                  // ✊/🖐️ тыныш
}
const MODE_LABEL = { draw: '☝️ Сызу', grab: '🤏 Ұстап жүру', cut: '✌️ Кесу', idle: '✋ Тыныш' };

// ---------- Күй ----------
let lastGesture = 'idle';

// ---------- MediaPipe ----------
const hands = new Hands({
  locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 0,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

let lastTime = performance.now();
let fps = 0;

hands.onResults((res) => {
  const w = overlay.width, h = overlay.height;

  const now = performance.now();
  fps = 0.9 * fps + 0.1 * (1000 / (now - lastTime));
  lastTime = now;
  document.getElementById('fps').textContent = 'FPS: ' + fps.toFixed(0);

  const color = COLORS[currentColor];

  // Пульстеп жарқырау
  const glow = 16 + 8 * Math.abs(Math.sin(now / 500));

  // Фонды тазарту (сызықтар жарқырауы қосылсын)
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  for (const s of strokes) drawStroke(s, glow);
  if (activeStroke) drawStroke(activeStroke, glow);
  ctx.globalCompositeOperation = 'source-over';

  if (!res.multiHandLandmarks || !res.multiHandLandmarks.length) {
    document.getElementById('mode').textContent = 'Режим: қол көрінбейді';
    activeStroke = null; grabbed = null; lastGesture = 'idle';
    return;
  }

  const lm = res.multiHandLandmarks[0];
  const g = detectGesture(lm);
  document.getElementById('mode').textContent = 'Режим: ' + MODE_LABEL[g];
  drawHand(lm, w, h, color);

  // Курсор нүктесі: сызуда — көрсеткіш ұшы(8); ұстауда — бармақ+саусақ ортасы
  let cx, cy;
  if (g === 'grab') { cx = (lm[4].x + lm[8].x) / 2 * w; cy = (lm[4].y + lm[8].y) / 2 * h; }
  else { cx = lm[8].x * w; cy = lm[8].y * h; }

  // Жест ауысса — күйді жабу
  if (g !== lastGesture) {
    if (lastGesture === 'draw' && activeStroke) {
      if (activeStroke.pts.length) strokes.push(activeStroke);
      activeStroke = null;
    }
    if (lastGesture === 'grab') grabbed = null;
    lastGesture = g;
  }

  if (g === 'draw') {
    if (!activeStroke) activeStroke = { pts: [], color };
    const p = activeStroke.pts[activeStroke.pts.length - 1];
    if (!p || dist2D(p.x, p.y, cx, cy) > MIN_DIST) activeStroke.pts.push({ x: cx, y: cy });
    drawCursor(cx, cy, color, 6);

  } else if (g === 'grab') {
    if (!grabbed) {
      const near = nearestStroke(cx, cy, GRAB_R);
      if (near) grabbed = { stroke: near.stroke, lastX: cx, lastY: cy };
    }
    if (grabbed) {
      const dx = cx - grabbed.lastX, dy = cy - grabbed.lastY;
      for (const pt of grabbed.stroke.pts) { pt.x += dx; pt.y += dy; }
      grabbed.lastX = cx; grabbed.lastY = cy;
      drawCursor(cx, cy, '#ffffff', 10);
    } else {
      drawCursor(cx, cy, '#ffffff', GRAB_R);   // ұстайтын аймақты көрсету
    }

  } else if (g === 'cut') {
    cutAt(cx, cy, GRAB_R * 0.5);
    drawCursor(cx, cy, '#ff4d4d', GRAB_R * 0.5);

  } else {
    drawCursor(cx, cy, color, 5);
  }
});

// Курсорға жақын нүктелерді өшіріп, сызықты бөлу (кесу)
function cutAt(x, y, r) {
  const next = [];
  for (const s of strokes) {
    let seg = [];
    for (const pt of s.pts) {
      if (dist2D(pt.x, pt.y, x, y) < r) {
        if (seg.length >= 2) next.push({ pts: seg, color: s.color });
        seg = [];
      } else {
        seg.push(pt);
      }
    }
    if (seg.length >= 2) next.push({ pts: seg, color: s.color });
  }
  strokes = next;
}

// ---------- Камера ----------
const mpCamera = new Camera(video, {
  onFrame: async () => { await hands.send({ image: video }); },
  width: 640,
  height: 480
});
mpCamera.start()
  .then(() => loader.classList.add('hidden'))
  .catch((e) => { loader.innerHTML = 'Камераға қол жеткізу қатесі:<br><small>' + e.message + '</small>'; });

// ---------- Палитра UI ----------
const paletteEl = document.getElementById('palette');
COLORS.forEach((c, i) => {
  const s = document.createElement('div');
  s.className = 'swatch' + (i === 0 ? ' active' : '');
  s.style.background = c;
  s.style.color = c;
  s.onclick = () => {
    currentColor = i;
    document.querySelectorAll('.swatch').forEach(el => el.classList.remove('active'));
    s.classList.add('active');
  };
  paletteEl.appendChild(s);
});

// ---------- Resize ----------
function resize() {
  overlay.width = window.innerWidth;
  overlay.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ---------- Пернетақта: түс (1-6), C — тазарту, Z — соңғыны өшіру ----------
window.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '6') {
    const i = +e.key - 1;
    if (i < COLORS.length) document.querySelectorAll('.swatch')[i].click();
  }
  if (e.key.toLowerCase() === 'c') strokes = [];
  if (e.key.toLowerCase() === 'z') strokes.pop();
});
