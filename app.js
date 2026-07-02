/* HandCraft — камерадан қол танып, ауада сызу + Minecraft блоктарын қою */

// ---------- Three.js сахна ----------
const sceneEl = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
sceneEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);

// Орбита параметрлері (жұдырықпен айналдырамыз)
const orbit = { az: 0.6, pol: 0.9, r: 16, target: new THREE.Vector3(0, 0, 0) };
function updateCamera() {
  const sp = Math.sin(orbit.pol), cp = Math.cos(orbit.pol);
  camera.position.set(
    orbit.target.x + orbit.r * sp * Math.sin(orbit.az),
    orbit.target.y + orbit.r * cp,
    orbit.target.z + orbit.r * sp * Math.cos(orbit.az)
  );
  camera.lookAt(orbit.target);
}
updateCamera();

// Жарық
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.9));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(6, 12, 4);
scene.add(dir);

// Grid ground
const GRID = 16;
const grid = new THREE.GridHelper(GRID, GRID, 0x66ccff, 0x224455);
grid.position.y = 0;
scene.add(grid);

// Ground жазықтығы (raycast үшін, көрінбейтін)
const groundGeo = new THREE.PlaneGeometry(GRID, GRID);
const ground = new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({ visible: false }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// ---------- Блоктар ----------
const PALETTE = ['#7ec850', '#c8873f', '#5aa9e6', '#e6577a', '#f2c14e', '#e8eef5'];
let currentColor = 0;
const BS = 1; // блок өлшемі
const blockGeo = new THREE.BoxGeometry(BS, BS, BS);
const edgeGeo = new THREE.EdgesGeometry(blockGeo);
const blocks = new Map(); // "x,y,z" -> mesh

function keyOf(x, y, z) { return `${x},${y},${z}`; }

function addBlock(gx, gy, gz, colorHex) {
  const k = keyOf(gx, gy, gz);
  if (blocks.has(k)) return false;
  if (gx < -GRID/2 || gx >= GRID/2 || gz < -GRID/2 || gz >= GRID/2 || gy < 0) return false;
  const mat = new THREE.MeshLambertMaterial({ color: colorHex });
  const mesh = new THREE.Mesh(blockGeo, mat);
  mesh.position.set(gx + 0.5, gy + 0.5, gz + 0.5);
  const line = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  mesh.add(line);
  mesh.userData.cell = { gx, gy, gz };
  scene.add(mesh);
  blocks.set(k, mesh);
  return true;
}

function removeBlockAt(mesh) {
  const c = mesh.userData.cell;
  scene.remove(mesh);
  blocks.delete(keyOf(c.gx, c.gy, c.gz));
}

// ---------- Cursor (нысана) ----------
const cursorGeo = new THREE.BoxGeometry(BS * 1.02, BS * 1.02, BS * 1.02);
const cursor = new THREE.LineSegments(
  new THREE.EdgesGeometry(cursorGeo),
  new THREE.LineBasicMaterial({ color: 0xffffff })
);
cursor.visible = false;
scene.add(cursor);

const raycaster = new THREE.Raycaster();

// Экран нүктесінен (NDC) target ұяшықты табу
function pickCell(ndc) {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([...blocks.values(), ground], false);
  if (!hits.length) return null;
  const h = hits[0];
  if (h.object === ground) {
    const gx = Math.floor(h.point.x);
    const gz = Math.floor(h.point.z);
    return { place: { gx, gy: 0, gz }, hitMesh: null };
  } else {
    // блок беті — көрші ұяшық (қою) немесе сол блок (өшіру)
    const c = h.object.userData.cell;
    const n = h.face.normal;
    return {
      place: { gx: c.gx + Math.round(n.x), gy: c.gy + Math.round(n.y), gz: c.gz + Math.round(n.z) },
      hitMesh: h.object
    };
  }
}

// ---------- Overlay (қол қаңқасы) ----------
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];

function drawHand(lm, w, h, color) {
  octx.strokeStyle = color;
  octx.lineWidth = 3;
  for (const [a, b] of HAND_CONNECTIONS) {
    octx.beginPath();
    octx.moveTo(lm[a].x * w, lm[a].y * h);
    octx.lineTo(lm[b].x * w, lm[b].y * h);
    octx.stroke();
  }
  octx.fillStyle = '#fff';
  for (const p of lm) {
    octx.beginPath();
    octx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
    octx.fill();
  }
}

// ---------- Жест тану ----------
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z||0) - (b.z||0));
}
// Саусақ ашық па (tip ұшы pip буынынан алақаннан алыс па)
function fingerUp(lm, tip, pip) {
  return dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.05;
}

function detectGesture(lm) {
  const thumbIndex = dist(lm[4], lm[8]);
  const scale = dist(lm[0], lm[9]) || 1; // қол өлшеміне қалыпқа келтіру
  const pinch = (thumbIndex / scale) < 0.4;

  const idx = fingerUp(lm, 8, 6);
  const mid = fingerUp(lm, 12, 10);
  const rng = fingerUp(lm, 16, 14);
  const pky = fingerUp(lm, 20, 18);
  const up = [idx, mid, rng, pky].filter(Boolean).length;

  if (pinch) return 'pinch';
  if (idx && mid && !rng && !pky) return 'delete';   // ✌️
  if (up >= 4) return 'draw';                          // 🖐️
  if (up === 0) return 'rotate';                       // ✊
  if (idx && !mid) return 'aim';                       // ☝️
  return 'aim';
}

const MODE_LABEL = {
  pinch: '🤏 Блок қою', delete: '✌️ Өшіру', draw: '🖐️ Сызу',
  rotate: '✊ Айналдыру', aim: '☝️ Нысана'
};

// ---------- Күй ----------
let cursorNDC = null;      // соңғы курсор
let lastGesture = 'aim';
let placedCellKey = null;  // pinch кезінде қайталамау үшін
let deletedThisGesture = false;
let rotAnchor = null;      // жұдырық орбитасы

// ---------- MediaPipe ----------
const video = document.getElementById('cam');
const loader = document.getElementById('loader');

const hands = new Hands({
  locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

let lastTime = performance.now();
let fps = 0;

hands.onResults((res) => {
  const w = overlay.width, h = overlay.height;
  octx.clearRect(0, 0, w, h);

  const now = performance.now();
  fps = 0.9 * fps + 0.1 * (1000 / (now - lastTime));
  lastTime = now;
  document.getElementById('fps').textContent = 'FPS: ' + fps.toFixed(0);

  if (!res.multiHandLandmarks || !res.multiHandLandmarks.length) {
    cursor.visible = false;
    document.getElementById('mode').textContent = 'Режим: қол көрінбейді';
    return;
  }

  const lm = res.multiHandLandmarks[0];
  const g = detectGesture(lm);
  document.getElementById('mode').textContent = 'Режим: ' + (MODE_LABEL[g] || g);
  drawHand(lm, w, h, PALETTE[currentColor]);

  // Курсор: көрсеткіш саусақ ұшы (landmark 8). Видео айналы → x-ті аударамыз
  const tip = lm[8];
  const sx = (1 - tip.x);            // 0..1 (экран, айналы ескерілген)
  const sy = tip.y;
  cursorNDC = new THREE.Vector2(sx * 2 - 1, -(sy * 2 - 1));

  // Gesture ауысса — күйді тазарту
  if (g !== lastGesture) {
    placedCellKey = null;
    deletedThisGesture = false;
    rotAnchor = null;
    lastGesture = g;
  }

  if (g === 'rotate') {
    // Жұдырық: курсор жылжуымен камераны айналдыру
    if (!rotAnchor) rotAnchor = { x: sx, y: sy, az: orbit.az, pol: orbit.pol };
    orbit.az = rotAnchor.az + (sx - rotAnchor.x) * 4;
    orbit.pol = Math.max(0.15, Math.min(1.5, rotAnchor.pol - (sy - rotAnchor.y) * 3));
    updateCamera();
    cursor.visible = false;
    return;
  }

  const pick = pickCell(cursorNDC);
  if (!pick) { cursor.visible = false; return; }

  cursor.visible = true;
  cursor.position.set(pick.place.gx + 0.5, pick.place.gy + 0.5, pick.place.gz + 0.5);

  if (g === 'pinch' || g === 'draw') {
    const k = keyOf(pick.place.gx, pick.place.gy, pick.place.gz);
    // pinch — әр жаңа ұяшыққа бір рет; draw — үздіксіз (ізбен)
    if (g === 'draw' || k !== placedCellKey) {
      if (addBlock(pick.place.gx, pick.place.gy, pick.place.gz, PALETTE[currentColor])) {
        placedCellKey = k;
      }
    }
  } else if (g === 'delete') {
    if (!deletedThisGesture && pick.hitMesh) {
      removeBlockAt(pick.hitMesh);
      deletedThisGesture = true;
    }
  }
});

// ---------- Камера ----------
const mpCamera = new Camera(video, {
  onFrame: async () => { await hands.send({ image: video }); },
  width: 640,
  height: 480
});

mpCamera.start()
  .then(() => { loader.classList.add('hidden'); })
  .catch((e) => { loader.innerHTML = 'Камераға қол жеткізу қатесі:<br><small>' + e.message + '</small>'; });

// ---------- Рендер циклі ----------
function animate() {
  requestAnimationFrame(animate);
  if (cursor.visible) {
    cursor.material.opacity = 0.5 + 0.5 * Math.abs(Math.sin(performance.now() / 300));
    cursor.material.transparent = true;
  }
  renderer.render(scene, camera);
}
animate();

// ---------- Палитра UI ----------
const paletteEl = document.getElementById('palette');
PALETTE.forEach((c, i) => {
  const s = document.createElement('div');
  s.className = 'swatch' + (i === 0 ? ' active' : '');
  s.style.background = c;
  s.onclick = () => {
    currentColor = i;
    document.querySelectorAll('.swatch').forEach(el => el.classList.remove('active'));
    s.classList.add('active');
  };
  paletteEl.appendChild(s);
});

// ---------- Resize ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  overlay.width = w;
  overlay.height = h;
}
window.addEventListener('resize', resize);
resize();

// Пернетақта: түс ауыстыру (1-6), C — тазарту
window.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '6') {
    const i = +e.key - 1;
    if (i < PALETTE.length) document.querySelectorAll('.swatch')[i].click();
  }
  if (e.key.toLowerCase() === 'c') {
    [...blocks.values()].forEach(m => scene.remove(m));
    blocks.clear();
  }
});
