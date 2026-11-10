import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// DEAD DROP — a compact low-poly FPS.
// Procedural geometry, textures and audio. No external assets besides Three.js.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const dom = {
  canvas: $('game'), menu: $('menu'), hud: $('hud'), pause: $('pause'), end: $('endScreen'),
  playBtn: $('playBtn'), modeCards: [...document.querySelectorAll('.mode-card')],
  modeNote: $('modeNote'), briefTitle: $('briefTitle'), briefText: $('briefText'), briefTags: $('briefTags'),
  healthFill: $('healthFill'), healthNum: $('healthNum'), healthState: $('healthState'),
  objectiveKicker: $('objectiveKicker'), objectiveClock: $('objectiveClock'), objectiveMain: $('objectiveMain'),
  objectiveSub: $('objectiveSub'), objectiveTrack: $('objectiveTrack'),
  scoreNum: $('scoreNum'), killNum: $('killNum'), hsNum: $('hsNum'), killfeed: $('killfeed'),
  ammoNum: $('ammoNum'), ammoReserve: $('ammoReserve'), weaponName: document.querySelector('.weapon-name'),
  weaponSlot: $('weaponSlot'), weaponPips: [...document.querySelectorAll('[data-weapon]')],
  reloadBar: $('reloadBar'), scanFill: $('scanFill'), chargeLabel: $('chargeLabel'), scanKey: $('scanKey'),
  crosshair: $('crosshair'), hitmarker: $('hitmarker'), damageFlash: $('damageFlash'), lowHealth: $('lowHealth'),
  banner: $('banner'), pickupToast: $('pickupToast'), mouseHint: $('mouseHint'), worldLayer: $('worldLayer'),
  radar: $('radar'), radarDist: $('radarDist'), hintBar: $('hintBar'),
  pauseScore: $('pauseScore'), pauseKills: $('pauseKills'), pauseAcc: $('pauseAcc'),
  resumeBtn: $('resumeBtn'), restartBtn: $('restartBtn'), quitBtn: $('quitBtn'),
  endKicker: $('endKicker'), endTitle: $('endTitle'), endText: $('endText'), endGrade: $('endGrade'),
  endScore: $('endScore'), endKills: $('endKills'), endHs: $('endHs'), endAcc: $('endAcc'),
  endWave: $('endWave'), endTime: $('endTime'), retryBtn: $('retryBtn'), menuBtn: $('menuBtn'),
  touch: $('touch'), transition: $('transition'), bootError: $('bootError'),
  stick: $('stick'), stickKnob: $('stickKnob'), touchFire: $('touchFire'), touchAim: $('touchAim'),
  touchJump: $('touchJump'), touchReload: $('touchReload'), touchSwap: $('touchSwap'),
  touchScan: $('touchScan'), touchPause: $('touchPause')
};

const IS_TOUCH = new URLSearchParams(location.search).has('touch') || matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const ARENA = 29.2;
const UP = new THREE.Vector3(0, 1, 0);
const TMP_V1 = new THREE.Vector3();
const TMP_V2 = new THREE.Vector3();
const TMP_Q = new THREE.Quaternion();
const TMP_M = new THREE.Matrix4();
const TMP_C = new THREE.Color();
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const formatScore = (n) => Math.max(0, Math.round(n)).toString().padStart(6, '0');
const formatTime = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: dom.canvas,
    antialias: false,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false
  });
} catch (error) {
  dom.bootError.classList.remove('hidden');
  dom.bootError.textContent = `WebGL could not start.\n${error.message}`;
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, IS_TOUCH ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.26;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9764b);
scene.fog = new THREE.FogExp2(0xb9794f, 0.0135);

const camera = new THREE.PerspectiveCamera(71, innerWidth / innerHeight, 0.045, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const clock = new THREE.Clock();
const worldRoot = new THREE.Group();
scene.add(worldRoot);

// Sky dome with a big hazy sun.
const sunDirection = new THREE.Vector3(0.46, 0.25, -0.85).normalize();
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(155, 32, 18),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x52637d) },
      horizonColor: { value: new THREE.Color(0xdc9a68) },
      bottomColor: { value: new THREE.Color(0x7a4a31) },
      sunColor: { value: new THREE.Color(0xffd29b) },
      sunDirection: { value: sunDirection }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPosition;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      void main() {
        vec3 dir = normalize(vWorldPosition);
        float h = dir.y;
        vec3 col = mix(horizonColor, topColor, smoothstep(0.0, 0.62, h));
        col = mix(bottomColor, col, smoothstep(-0.12, 0.02, h));
        float sd = max(dot(dir, normalize(sunDirection)), 0.0);
        col += sunColor * (pow(sd, 420.0) * 2.5 + pow(sd, 16.0) * 0.2);
        float band = sin((h + 0.13) * 95.0) * 0.5 + 0.5;
        col += sunColor * band * 0.006;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  })
);
sky.frustumCulled = false;
scene.add(sky);

// Lights.
const hemi = new THREE.HemisphereLight(0xb9cbe0, 0x71452b, 1.22);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffc08a, 2.75);
sun.position.set(29, 30, -46);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 105;
sun.shadow.camera.left = -39;
sun.shadow.camera.right = 39;
sun.shadow.camera.top = 39;
sun.shadow.camera.bottom = -39;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight(0x8fa9c2, 0.78);
fill.position.set(-16, 17, 34);
scene.add(fill);
const ambient = new THREE.AmbientLight(0x9a7356, 0.5);
scene.add(ambient);

// ---------------------------------------------------------------------------
// Small procedural texture helpers
// ---------------------------------------------------------------------------
function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

const sandTex = canvasTexture(512, (ctx, s) => {
  ctx.fillStyle = '#94704b';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    const v = Math.random();
    ctx.fillStyle = v > .8 ? 'rgba(205,172,127,.16)' : v > .4 ? 'rgba(66,45,29,.13)' : 'rgba(45,30,20,.08)';
    const w = Math.random() * 2 + .4;
    ctx.fillRect(x, y, w, w);
  }
  for (let i = 0; i < 24; i++) {
    ctx.strokeStyle = `rgba(49,34,23,${rand(.04, .11)})`;
    ctx.lineWidth = rand(.5, 1.4);
    ctx.beginPath();
    let x = Math.random() * s, y = Math.random() * s;
    ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) { x += rand(-26, 26); y += rand(-18, 18); ctx.lineTo(x, y); }
    ctx.stroke();
  }
}, 9, 9);

const concreteTex = canvasTexture(512, (ctx, s) => {
  ctx.fillStyle = '#817a6d';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 5200; i++) {
    const g = Math.floor(rand(70, 150));
    ctx.fillStyle = `rgba(${g},${g - 5},${g - 12},${rand(.04, .18)})`;
    const w = rand(.5, 3.5);
    ctx.fillRect(Math.random() * s, Math.random() * s, w, w);
  }
  ctx.strokeStyle = 'rgba(45,39,32,.28)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    let x = Math.random() * s, y = Math.random() * s;
    ctx.moveTo(x, y);
    for (let j = 0; j < 4; j++) { x += rand(-38, 38); y += rand(-30, 30); ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(56,49,41,.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, s, s);
}, 5, 5);

const woodTex = canvasTexture(256, (ctx, s) => {
  ctx.fillStyle = '#6b4829';
  ctx.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 9) {
    ctx.fillStyle = y % 18 === 0 ? 'rgba(38,23,12,.25)' : 'rgba(154,107,63,.12)';
    ctx.fillRect(0, y, s, 2);
  }
  for (let i = 0; i < 28; i++) {
    ctx.strokeStyle = `rgba(41,25,13,${rand(.1, .3)})`;
    ctx.beginPath();
    ctx.ellipse(rand(0, s), rand(0, s), rand(6, 28), rand(2, 6), rand(0, 3), 0, Math.PI * 2);
    ctx.stroke();
  }
}, 2, 2);

const rustTex = canvasTexture(256, (ctx, s) => {
  ctx.fillStyle = '#7d4526';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = Math.random() > .5 ? 'rgba(42,25,15,.22)' : 'rgba(190,108,53,.14)';
    const w = rand(1, 8);
    ctx.fillRect(Math.random() * s, Math.random() * s, w, rand(1, 5));
  }
  for (let i = 0; i < 13; i++) {
    ctx.strokeStyle = 'rgba(186,96,43,.3)';
    ctx.lineWidth = rand(1, 4);
    ctx.beginPath(); ctx.moveTo(rand(0, s), 0); ctx.lineTo(rand(0, s), s); ctx.stroke();
  }
}, 2, 1);

function makeSignTexture(lines, { bg = '#2a241b', fg = '#e5d5ae', accent = '#ff5a1f', size = 512, vertical = false } = {}) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = vertical ? size * 2 : size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = Math.random() > .5 ? 'rgba(255,255,255,.025)' : 'rgba(0,0,0,.05)';
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, rand(1, 6), rand(1, 3));
  }
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.lineWidth = 8;
  ctx.strokeRect(18, 18, c.width - 36, c.height - 36);
  ctx.fillStyle = accent;
  ctx.fillRect(18, 18, c.width - 36, 12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  const count = lines.length;
  lines.forEach((line, i) => {
    const main = i === 0;
    const fs = main ? Math.floor(c.width * (vertical ? .24 : .25)) : Math.floor(c.width * .085);
    ctx.font = `${main ? 800 : 700} ${fs}px 'Arial Narrow', Arial, sans-serif`;
    ctx.fillText(line, c.width / 2, c.height * (count === 1 ? .52 : .34 + i * .24));
  });
  ctx.strokeStyle = 'rgba(0,0,0,.25)';
  for (let i = 0; i < 20; i++) {
    ctx.beginPath(); ctx.moveTo(rand(0, c.width), 0); ctx.lineTo(rand(0, c.width), c.height); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------
// Audio — all sounds synthesised on the fly
// ---------------------------------------------------------------------------
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambientStarted = false;
    this.lastGroan = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.startAmbient();
  }
  get t() { return this.ctx ? this.ctx.currentTime : 0; }
  noiseSource(duration = .15, filterType = 'lowpass', frequency = 1200, gain = .2) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, this.t);
    filter.Q.value = .8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.t);
    g.gain.exponentialRampToValueAtTime(.0001, this.t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    src.stop(this.t + duration + .02);
    return { filter, gain: g, src };
  }
  tone(freq, duration, type = 'sine', gain = .08, endFreq = null, delay = 0) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, this.t + delay);
    if (endFreq !== null) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), this.t + delay + duration);
    g.gain.setValueAtTime(gain, this.t + delay);
    g.gain.exponentialRampToValueAtTime(.0001, this.t + delay + duration);
    o.connect(g).connect(this.master);
    o.start(this.t + delay);
    o.stop(this.t + delay + duration + .02);
  }
  startAmbient() {
    if (!this.ctx || this.ambientStarted) return;
    this.ambientStarted = true;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    const g = this.ctx.createGain();
    g.gain.value = .018;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = .09;
    lfoGain.gain.value = .012;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    this.ambient = { src, filter, g, lfo };
  }
  shot() {
    if (!this.ctx) return;
    const n = this.noiseSource(.11, 'lowpass', 2500, .34);
    if (n) n.filter.frequency.exponentialRampToValueAtTime(350, this.t + .1);
    this.tone(92, .12, 'triangle', .18, 38);
    this.tone(1800, .025, 'square', .025, 700);
  }
  dry() { this.tone(780, .025, 'square', .035, 300); }
  reload(step = 0) {
    this.tone(step ? 320 : 240, .035, 'square', .04, step ? 140 : 90);
    this.noiseSource(.03, 'highpass', 2800, .025);
  }
  rpg() {
    const n = this.noiseSource(.45, 'bandpass', 900, .26);
    if (n) n.filter.frequency.exponentialRampToValueAtTime(150, this.t + .4);
    this.tone(72, .35, 'sawtooth', .12, 42);
  }
  explosion() {
    const n = this.noiseSource(.9, 'lowpass', 550, .55);
    if (n) n.filter.frequency.exponentialRampToValueAtTime(70, this.t + .8);
    this.tone(58, .75, 'sine', .34, 26);
    this.tone(110, .3, 'triangle', .12, 45);
  }
  hit(head = false) {
    this.tone(head ? 1500 : 1000, head ? .1 : .055, 'square', .055, head ? 2200 : 780);
    if (head) this.tone(2400, .07, 'sine', .04, 1600, .015);
  }
  kill() {
    this.tone(150, .16, 'triangle', .1, 80);
    this.tone(720, .09, 'square', .035, 340, .03);
  }
  hurt() {
    this.noiseSource(.24, 'lowpass', 500, .24);
    this.tone(68, .18, 'sine', .14, 44);
  }
  groan(distance = 10) {
    if (!this.ctx || this.t - this.lastGroan < .75) return;
    this.lastGroan = this.t;
    const vol = clamp(1 - distance / 28, .02, .09);
    this.tone(rand(65, 95), rand(.35, .7), 'sawtooth', vol, rand(45, 60));
    this.tone(rand(110, 155), .28, 'triangle', vol * .5, rand(80, 105));
  }
  scan() {
    this.tone(480, .22, 'sine', .06, 1250);
    this.tone(720, .3, 'sine', .035, 1800, .08);
  }
  decoy() {
    this.tone(220, .12, 'square', .06, 120);
    this.tone(160, .18, 'sawtooth', .05, 90, .06);
  }
  propBreak() {
    this.noiseSource(.16, 'highpass', 1800, .13);
    this.tone(95, .1, 'triangle', .09, 55);
  }
  pickup() {
    this.tone(620, .1, 'sine', .05, 920);
    this.tone(920, .14, 'sine', .035, 1240, .06);
  }
  wave() {
    this.tone(88, .7, 'sawtooth', .1, 64);
    this.tone(132, .7, 'triangle', .06, 88);
    this.tone(176, .5, 'sine', .03, 132, .06);
  }
  click() { this.tone(880, .025, 'square', .025, 520); }
  victory() {
    [196, 247, 294, 392].forEach((f, i) => this.tone(f, .6, 'triangle', .05, null, i * .09));
  }
  defeat() {
    [130, 110, 82, 55].forEach((f, i) => this.tone(f, .7, 'sawtooth', .06, null, i * .14));
  }
}
const audio = new AudioEngine();

// ---------------------------------------------------------------------------
// World construction
// ---------------------------------------------------------------------------
const COLLIDERS = [];
const targetProps = [];
const ambientEmitters = [];
let mapDecorRoot;
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  rock: new THREE.DodecahedronGeometry(1, 0),
  barrel: new THREE.CylinderGeometry(.42, .42, 1.05, 9, 1, false),
  barrelTop: new THREE.CylinderGeometry(.4, .4, .035, 9),
  shaft: new THREE.CylinderGeometry(1, 1, 1, 6),
  sphere: new THREE.SphereGeometry(1, 6, 4),
  cone: new THREE.ConeGeometry(1, 1, 6),
  ring: new THREE.RingGeometry(.86, 1, 32),
  plane: new THREE.PlaneGeometry(1, 1),
  tetra: new THREE.TetrahedronGeometry(1, 0)
};

function lam(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
}

const MAT = {
  concrete: lam(0x9b9181),
  concreteDark: lam(0x6d665b),
  concreteWarm: lam(0xb0a28c),
  rust: lam(0x9a4e2a, { map: rustTex }),
  teal: lam(0x3f7370, { map: rustTex, color: 0x8bbab2 }),
  blue: lam(0x466276, { map: rustTex, color: 0x92aabe }),
  olive: lam(0x53604a),
  wood: lam(0x98734c, { map: woodTex }),
  woodDark: lam(0x4f3621),
  metal: lam(0x4e5353),
  metalDark: lam(0x2d3030),
  black: lam(0x1c1b18),
  sandbag: lam(0x8d7c53),
  tire: lam(0x242321),
  orange: lam(0xe15a21),
  white: lam(0xd8d0bc),
  red: lam(0x9c2923),
  glass: new THREE.MeshLambertMaterial({ color: 0x5b7782, transparent: true, opacity: .5, flatShading: true }),
  flame: new THREE.MeshBasicMaterial({ color: 0xff8a28, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false })
};
const ROCK_MATS = Array.from({ length: 5 }, (_, i) => lam(new THREE.Color().setHSL(.08, .17, .23 + i * .035)));
const MESA_MATS = Array.from({ length: 4 }, (_, i) => lam(new THREE.Color().setHSL(.06, .16, .17 + i * .035)));
let rockIndex = 0, mesaIndex = 0;

function addCollider(x, z, w, d, h = 4) {
  COLLIDERS.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h, cx: x, cz: z, w, d });
}
function box(w, h, d, x, y, z, material, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  if (opts.ry) m.rotation.y = opts.ry;
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  (opts.parent || worldRoot).add(m);
  return m;
}
function plane(w, h, x, y, z, material, opts = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  m.position.set(x, y, z);
  m.rotation.set(opts.rx || 0, opts.ry || 0, opts.rz || 0);
  m.receiveShadow = opts.receive !== false;
  m.castShadow = !!opts.cast;
  (opts.parent || worldRoot).add(m);
  return m;
}
function signOn(texture, w, h, x, y, z, ry = 0, parent = worldRoot) {
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: false });
  const m = plane(w, h, x, y, z, mat, { ry, cast: false, receive: false, parent });
  return m;
}

function addContainer(x, z, rot, colorMat, title) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  worldRoot.add(g);
  const L = 7.4, W = 2.65, H = 2.82;
  const body = box(L, H, W, 0, H / 2 + .08, 0, colorMat, { parent: g });
  body.castShadow = true;
  // frame rails
  box(L + .16, .12, .16, 0, H + .1, W / 2, MAT.metalDark, { parent: g });
  box(L + .16, .12, .16, 0, H + .1, -W / 2, MAT.metalDark, { parent: g });
  box(.12, H + .12, .12, -L / 2, H / 2, W / 2, MAT.metalDark, { parent: g });
  box(.12, H + .12, .12, L / 2, H / 2, W / 2, MAT.metalDark, { parent: g });
  box(.12, H + .12, .12, -L / 2, H / 2, -W / 2, MAT.metalDark, { parent: g });
  box(.12, H + .12, .12, L / 2, H / 2, -W / 2, MAT.metalDark, { parent: g });
  // corrugation ribs
  for (let i = -7; i <= 7; i++) {
    box(.055, H - .22, .045, i * .48, H / 2 + .08, W / 2 + .025, MAT.metalDark, { parent: g, cast: false });
    box(.055, H - .22, .045, i * .48, H / 2 + .08, -W / 2 - .025, MAT.metalDark, { parent: g, cast: false });
  }
  // doors on one end
  box(.055, H - .2, W - .18, L / 2 + .005, H / 2 + .08, 0, MAT.metalDark, { parent: g, cast: false });
  box(.06, .45, .06, L / 2 + .04, H / 2, .42, MAT.metal, { parent: g });
  box(.06, .45, .06, L / 2 + .04, H / 2, -.42, MAT.metal, { parent: g });
  // roof tarp / vents
  box(1.1, .18, .8, -L * .25, H + .2, 0, MAT.metalDark, { parent: g });
  // hazard stripe
  box(L * .8, .16, .02, 0, .62, W / 2 + .05, MAT.orange, { parent: g, cast: false });
  // stencilled sign
  const tex = makeSignTexture([title, 'PROPERTY OF SECTOR 7'], { bg: '#28231d', fg: '#e8ddc9', accent: '#ff5a1f' });
  signOn(tex, 2.5, 1.25, -1.3, 1.66, W / 2 + .056, 0, g);
  addCollider(x, z, rot ? W : L, rot ? L : W, H);
  return g;
}

function addCrate(x, z, size = 1.1, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  worldRoot.add(g);
  const h = size;
  box(size, h, size, 0, h / 2, 0, MAT.wood, { parent: g });
  const b = .085;
  box(size + .02, b, b, 0, h * .2, size / 2 + .01, MAT.woodDark, { parent: g, cast: false });
  box(size + .02, b, b, 0, h * .8, size / 2 + .01, MAT.woodDark, { parent: g, cast: false });
  box(size + .02, b, b, 0, h * .2, -size / 2 - .01, MAT.woodDark, { parent: g, cast: false });
  box(size + .02, b, b, 0, h * .8, -size / 2 - .01, MAT.woodDark, { parent: g, cast: false });
  box(b, h + .02, b, size / 2 + .01, h / 2, 0, MAT.woodDark, { parent: g });
  box(b, h + .02, b, -size / 2 - .01, h / 2, 0, MAT.woodDark, { parent: g });
  // diagonal brace
  const d = box(.07, Math.sqrt(2) * size, .045, 0, h / 2, size / 2 + .035, MAT.woodDark, { parent: g, cast: false });
  d.rotation.z = Math.PI / 4;
  addCollider(x, z, size + .1, size + .1, h);
  return g;
}

function addBarrel(x, z, colorMat = MAT.rust, opts = {}) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rand(0, Math.PI);
  if (opts.tilt) g.rotation.z = opts.tilt;
  worldRoot.add(g);
  const body = new THREE.Mesh(GEO.barrel, colorMat);
  body.position.y = .55;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  for (const y of [.28, .82]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.43, .025, 4, 9), MAT.metalDark);
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    g.add(ring);
  }
  const top = new THREE.Mesh(GEO.barrelTop, MAT.metalDark);
  top.position.y = 1.09;
  g.add(top);
  if (opts.fire) {
    const glow = new THREE.PointLight(0xff6a1c, 7, 12, 2);
    glow.position.y = 1.2;
    g.add(glow);
    ambientEmitters.push({ type: 'fire', obj: g, light: glow, timer: 0 });
    const fire = new THREE.Mesh(new THREE.ConeGeometry(.3, .8, 5), MAT.flame);
    fire.position.y = 1.5;
    fire.name = 'fire';
    fire.userData.noMerge = true;
    g.add(fire);
  }
  if (opts.collider !== false) addCollider(x, z, .95, .95, 1.1);
  return g;
}

function addBarrier(x, z, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  worldRoot.add(g);
  box(2.45, .9, .62, 0, .55, 0, MAT.concreteWarm, { parent: g });
  box(2.45, .16, .42, 0, 1.08, 0, MAT.concrete, { parent: g });
  box(.35, .16, .64, -.65, 1.06, 0, MAT.orange, { parent: g, cast: false });
  box(.35, .16, .64, .65, 1.06, 0, MAT.orange, { parent: g, cast: false });
  addCollider(x, z, Math.abs(Math.cos(ry)) * 2.5 + Math.abs(Math.sin(ry)) * .7, Math.abs(Math.sin(ry)) * 2.5 + Math.abs(Math.cos(ry)) * .7, 1.2);
  return g;
}

function addSandbags(x, z, rows = 3, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  worldRoot.add(g);
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < 4 - Math.floor(r / 2); i++) {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(.24, .58, 2, 6), MAT.sandbag);
      m.rotation.z = Math.PI / 2;
      m.position.set((i - (3 - Math.floor(r / 2)) / 2) * .62, .22 + r * .38, rand(-.04, .04));
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
  }
  addCollider(x, z, 2.5, .9, 1.5);
  return g;
}

function addWatchtower(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  worldRoot.add(g);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = box(.2, 5.4, .2, sx * 1.55, 2.7, sz * 1.55, MAT.metalDark, { parent: g });
    leg.rotation.z = sx * .028;
  }
  // cross braces
  for (const y of [1.5, 3.1]) {
    box(3.2, .1, .1, 0, y, -1.55, MAT.metal, { parent: g });
    box(3.2, .1, .1, 0, y, 1.55, MAT.metal, { parent: g });
    box(.1, .1, 3.2, -1.55, y, 0, MAT.metal, { parent: g });
    box(.1, .1, 3.2, 1.55, y, 0, MAT.metal, { parent: g });
    box(.1, 1.9, .1, -1.55, y - .85, 0, MAT.metalDark, { parent: g });
    box(.1, 1.9, .1, 1.55, y - .85, 0, MAT.metalDark, { parent: g });
  }
  box(3.9, .22, 3.9, 0, 5.42, 0, MAT.woodDark, { parent: g });
  // shack
  box(3.2, 1.8, 3.2, 0, 6.4, 0, MAT.olive, { parent: g });
  box(3.5, .16, 3.5, 0, 7.35, 0, MAT.metalDark, { parent: g });
  box(1.05, .16, .5, 0, 6.82, -1.63, MAT.orange, { parent: g, cast: false });
  box(1.2, 1.05, .04, 0, 6.38, 1.62, MAT.glass, { parent: g, cast: false });
  // ladder
  for (let i = 0; i < 7; i++) box(.7, .05, .05, 0, 1 + i * .62, -1.9, MAT.metal, { parent: g, cast: false });
  box(.05, 4.6, .05, -.35, 2.5, -1.9, MAT.metal, { parent: g, cast: false });
  box(.05, 4.6, .05, .35, 2.5, -1.9, MAT.metal, { parent: g, cast: false });
  // flag
  const flag = box(1.65, .62, .035, 1.2, 8.12, 0, MAT.rust, { parent: g, cast: false });
  flag.name = 'flag';
  addCollider(x, z, 4.3, 4.3, 7.2);
  return g;
}

function addRadioMast(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  worldRoot.add(g);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.09, .22, 13, 5), MAT.metalDark);
  mast.position.y = 6.5;
  mast.castShadow = true;
  g.add(mast);
  for (let i = 0; i < 7; i++) {
    const y = 2 + i * 1.6;
    const w = 2.2 - i * .26;
    box(w, .08, .08, 0, y, 0, MAT.metal, { parent: g, cast: false });
    box(.08, .08, w, 0, y, 0, MAT.metal, { parent: g, cast: false });
    const diag = box(Math.sqrt(w * w + 2.4), .06, .06, 0, y + .8, 0, MAT.metal, { parent: g, cast: false });
    diag.rotation.z = Math.atan2(w, 2.4);
  }
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2d24 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.18, 6, 4), beaconMat);
  beacon.position.y = 13.15;
  beacon.userData.noMerge = true;
  g.add(beacon);
  const light = new THREE.PointLight(0xff2218, 2.8, 18, 2);
  light.position.y = 13.15;
  g.add(light);
  ambientEmitters.push({ type: 'beacon', light, mesh: beacon, timer: 0 });
  addCollider(x, z, 2.3, 2.3, 3);
  return g;
}

function addDeadTree(x, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  worldRoot.add(g);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.13, .32, 4.3, 5), MAT.woodDark);
  trunk.position.y = 2.15;
  trunk.rotation.z = rand(-.07, .07);
  trunk.castShadow = true;
  g.add(trunk);
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(.035, .12, rand(1.1, 2), 4), MAT.woodDark);
    b.position.y = rand(2.7, 4.1);
    b.rotation.z = rand(.55, 1.05) * (Math.random() > .5 ? 1 : -1);
    b.rotation.y = rand(0, Math.PI * 2);
    b.translateY(.45);
    b.castShadow = true;
    g.add(b);
  }
  return g;
}

function addRock(x, z, s) {
  const m = new THREE.Mesh(GEO.rock, ROCK_MATS[rockIndex++ % ROCK_MATS.length]);
  m.scale.set(s * rand(.8, 1.4), s * rand(.45, .85), s * rand(.8, 1.2));
  m.position.set(x, s * .3, z);
  m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
  m.castShadow = m.receiveShadow = true;
  worldRoot.add(m);
  if (s > .55) addCollider(x, z, s * 1.7, s * 1.7, s);
  return m;
}

function addPallets(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rand(0, 3);
  worldRoot.add(g);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) box(.18, .06, 1.1, (j - 1.5) * .23, .1 + i * .13, 0, MAT.wood, { parent: g, cast: false });
    for (let j = 0; j < 3; j++) box(1.15, .05, .15, 0, .04 + i * .13, (j - 1) * .44, MAT.woodDark, { parent: g, cast: false });
  }
  addCollider(x, z, 1.3, 1.2, .5);
  return g;
}

function addTire(x, z, stack = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  worldRoot.add(g);
  for (let i = 0; i < stack; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(.4, .16, 5, 10), MAT.tire);
    t.rotation.x = Math.PI / 2;
    t.position.y = .18 + i * .3;
    t.rotation.z = rand(0, 3);
    t.castShadow = true;
    g.add(t);
  }
  return g;
}

function addFenceSegment(x, z, ry, len = 5) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  worldRoot.add(g);
  for (const s of [-1, 1]) box(.08, 1.9, .08, s * len / 2, .95, 0, MAT.metalDark, { parent: g });
  box(len, .06, .06, 0, 1.78, 0, MAT.metal, { parent: g, cast: false });
  box(len, .06, .06, 0, .34, 0, MAT.metal, { parent: g, cast: false });
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const xx = -len / 2 + i * len / 23;
    pts.push(new THREE.Vector3(xx, .34, 0), new THREE.Vector3(xx, 1.78, 0));
  }
  for (let i = 0; i < 7; i++) {
    pts.push(new THREE.Vector3(-len / 2, lerp(.34, 1.78, i / 6), 0), new THREE.Vector3(len / 2, lerp(.34, 1.78, i / 6), 0));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const wires = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x766f60, transparent: true, opacity: .42 }));
  g.add(wires);
  addCollider(x, z, Math.abs(Math.cos(ry)) * len + .12, Math.abs(Math.sin(ry)) * len + .12, 1.9);
}

function buildWorld() {
  mapDecorRoot = new THREE.Group();
  worldRoot.add(mapDecorRoot);

  // ground + slab
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(94, 94), new THREE.MeshLambertMaterial({ map: sandTex, color: 0xb3875b }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  mapDecorRoot.add(ground);
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(58, 58), new THREE.MeshLambertMaterial({ map: concreteTex, color: 0xa89c8a }));
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = .018;
  slab.receiveShadow = true;
  mapDecorRoot.add(slab);
  // painted slab border
  const borderMat = new THREE.MeshBasicMaterial({ color: 0xdc8a42, transparent: true, opacity: .35 });
  for (const [x, z, w, d] of [[0, -28.4, 55, .2], [0, 28.4, 55, .2], [-28.4, 0, .2, 55], [28.4, 0, .2, 55]]) {
    plane(w, d, x, .035, z, borderMat, { rx: -Math.PI / 2 });
  }
  // ground markings and tire tracks
  const paint = new THREE.MeshBasicMaterial({ color: 0xd6bd8a, transparent: true, opacity: .23 });
  for (let i = -2; i <= 2; i++) plane(.16, 18, i * 3.4, .028, 15.4, paint, { rx: -Math.PI / 2, ry: 0 });
  const markTex = makeSignTexture(['HOLD', 'THE LINE'], { bg: '#746758', fg: '#e0c893', accent: '#9f7b42' });
  const mark = plane(9.5, 4.8, 2.4, .027, 3.8, new THREE.MeshBasicMaterial({ map: markTex, transparent: true, opacity: .36 }), { rx: -Math.PI / 2 });
  mark.rotation.z = .19;
  const hazard = new THREE.MeshBasicMaterial({ color: 0x2d2924, transparent: true, opacity: .35 });
  for (let i = 0; i < 10; i++) {
    const st = plane(.3, 2.8, -29 + i * .62, .029, 24.8, hazard, { rx: -Math.PI / 2 });
    st.rotation.z = .6;
  }

  // boundary walls — segmented concrete panels
  for (let i = 0; i < 8; i++) {
    const x = -26.25 + i * 7.5;
    for (const [z, ry] of [[-31.5, 0], [31.5, Math.PI]]) {
      box(7.25, 4.6, .7, x, 2.3, z, i % 2 ? MAT.concrete : MAT.concreteWarm);
      box(7.0, .2, .82, x, 4.65, z, MAT.concreteDark);
      box(.18, .55, .12, x - 2.6, 2.9, z + (z < 0 ? .37 : -.37), MAT.metalDark, { cast: false });
    }
    for (const [x2, ry] of [[-31.5, Math.PI / 2], [31.5, -Math.PI / 2]]) {
      box(.7, 4.6, 7.25, x2, 2.3, x, i % 2 ? MAT.concreteWarm : MAT.concrete);
      box(.82, .2, 7.0, x2, 4.65, x, MAT.concreteDark);
      box(.12, .55, .18, x2 + (x2 < 0 ? .37 : -.37), 2.9, x - 2.6, MAT.metalDark, { cast: false });
    }
  }
  addCollider(0, -31.5, 64, .8, 4.8);
  addCollider(0, 31.5, 64, .8, 4.8);
  addCollider(-31.5, 0, .8, 64, 4.8);
  addCollider(31.5, 0, .8, 64, 4.8);

  // large warning signs on walls
  const qTex = makeSignTexture(['QUARANTINE', 'SECTOR 7 // NO EXIT'], { bg: '#211b15', fg: '#e7d9be', accent: '#d74220', size: 768 });
  signOn(qTex, 9, 2.6, -12, 3.1, -31.12, 0);
  const sTex = makeSignTexture(['RUSTBELT', 'FORWARD OPERATING BASE'], { bg: '#27241d', fg: '#e7d9be', accent: '#e5a841', size: 768 });
  signOn(sTex, 10, 2.9, 16, 3.1, 31.12, Math.PI);
  const arrowTex = makeSignTexture(['→', 'ARMORY'], { bg: '#3b2d1d', fg: '#e7d9be', accent: '#ff5a1f' });
  signOn(arrowTex, 3.4, 1.7, -31.12, 2.7, 12, Math.PI / 2);

  // containers and cover
  addContainer(-16.5, -11.2, 0, MAT.rust, 'CARGO 09');
  addContainer(16.5, 8.2, Math.PI / 2, MAT.teal, 'MEDICAL');
  addContainer(10.5, -20.8, 0, MAT.blue, 'BUNK 04');
  addContainer(-20.8, 14.2, Math.PI / 2, MAT.rust, 'FUEL');
  addBarrier(-7.2, 6.3, 0);
  addBarrier(7.1, 12.4, .12);
  addBarrier(-2.5, -8.8, -.18);
  addBarrier(13.2, -7.2, Math.PI / 2);
  addBarrier(-13.8, -2.4, Math.PI / 2);
  addBarrier(2.3, 20.6, 0);
  addSandbags(-3.8, 12.8, 3, 0);
  addSandbags(11.6, 2.6, 2.4, .12);
  addSandbags(-19.3, -20.1, 2, Math.PI / 2);
  addWatchtower(-23.5, -22.6);
  addRadioMast(22.2, -20.6);
  addDeadTree(-27.2, 6.2, 1.1);
  addDeadTree(25.8, 17.2, .85);
  addDeadTree(-24.7, 25.1, .8);
  addPallets(4.5, -3.2);
  addPallets(-11.8, 21.8);
  addTire(-25.4, -7.7, 2);
  addTire(25.2, -4.8, 1);
  addTire(-10.3, 21.7, 1);

  // crates
  addCrate(-11.8, -19.4, 1.2, .1);
  addCrate(-10.55, -19.2, .8, -.2);
  addCrate(-12.5, -18.2, .9, .38);
  addCrate(18.8, 15.2, 1.15, .1);
  addCrate(17.6, 16.1, .8, .6);
  addCrate(6.3, -12.4, 1.05, .2);
  addCrate(7.4, -12.2, .7, -.3);
  addCrate(-4.8, 17.2, .9, .1);
  addCrate(20.7, -3.5, .9, .28);

  // barrels
  addBarrel(3.5, 5.6, MAT.rust);
  addBarrel(4.3, 4.9, MAT.olive);
  addBarrel(-9.0, 2.2, MAT.rust);
  addBarrel(-8.2, 2.9, MAT.blue);
  addBarrel(14.3, -14.5, MAT.olive);
  addBarrel(15.1, -13.7, MAT.rust);
  addBarrel(15.2, -14.8, MAT.rust);
  addBarrel(21.0, 13.5, MAT.olive);
  addBarrel(-22.3, -5.4, MAT.rust);
  addBarrel(-23.0, -6.3, MAT.blue);
  addBarrel(-6.8, -24.0, MAT.rust);
  addBarrel(8.4, 22.6, MAT.olive);
  addBarrel(9.2, 22.1, MAT.rust);
  addBarrel(-16.0, -22.7, MAT.blue);
  addBarrel(2.5, 5.6, MAT.rust, { fire: true });
  addBarrel(-4.0, -13.0, MAT.rust);

  // small rocks, debris, papers
  for (let i = 0; i < 32; i++) {
    const x = rand(-28, 28), z = rand(-28, 28);
    if (Math.abs(x) < 4 && Math.abs(z) < 4) continue;
    addRock(x, z, rand(.16, .65));
  }
  const paperMat = new THREE.MeshBasicMaterial({ color: 0xd8c8a7, side: THREE.DoubleSide });
  for (let i = 0; i < 22; i++) {
    const p = plane(rand(.18, .4), rand(.22, .5), rand(-27, 27), .04, rand(-27, 27), paperMat, { rx: -Math.PI / 2 });
    p.rotation.z = rand(0, 6);
  }

  // fencing / sightline props
  addFenceSegment(-25.6, 1.8, Math.PI / 2, 5.5);
  addFenceSegment(25.6, 24.1, 0, 5.5);
  addFenceSegment(-9.5, 27.6, 0, 5.5);

  // big overhead cables between mast and tower
  const cablePts = [];
  for (let i = 0; i < 3; i++) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(22.2, 11 - i * .4, -20.6),
      new THREE.Vector3(0, 8 - i * .55, -15),
      new THREE.Vector3(-23.5, 7.5 - i * .35, -22.6)
    ]);
    curve.getPoints(34).forEach(p => cablePts.push(p));
    if (i < 2) cablePts.push(new THREE.Vector3(NaN, NaN, NaN));
  }
  const cableGeo = new THREE.BufferGeometry().setFromPoints(cablePts.filter(p => !Number.isNaN(p.x)));
  const cables = new THREE.Line(cableGeo, new THREE.LineBasicMaterial({ color: 0x221d18, transparent: true, opacity: .7 }));
  worldRoot.add(cables);

  // distant mesas
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2 + rand(-.14, .14);
    const r = rand(66, 98);
    const height = rand(6, 19);
    const mesa = new THREE.Mesh(new THREE.ConeGeometry(rand(6, 16), height, 5, 1), MESA_MATS[mesaIndex++ % MESA_MATS.length]);
    mesa.position.set(Math.cos(a) * r, height / 2 - 1, Math.sin(a) * r);
    mesa.rotation.y = rand(0, 3);
    mesa.castShadow = false;
    mesa.receiveShadow = false;
    mapDecorRoot.add(mesa);
  }

  // dust motes
  const dustCount = 320;
  const dustGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    positions[i * 3] = rand(-32, 32);
    positions[i * 3 + 1] = rand(.2, 8);
    positions[i * 3 + 2] = rand(-32, 32);
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xe4b27f, size: .045, transparent: true, opacity: .54, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  dust.frustumCulled = false;
  mapDecorRoot.add(dust);
  mapDecorRoot.userData.dust = dust;

  // crows circling
  for (let i = 0; i < 3; i++) {
    const bird = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(.16, .1, .38), MAT.black);
    body.castShadow = true;
    bird.add(body);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(.7, .035, .18), MAT.black);
      wing.position.x = s * .35;
      wing.name = s < 0 ? 'wingL' : 'wingR';
      bird.add(wing);
    }
    const a = i / 3 * Math.PI * 2;
    bird.position.set(Math.cos(a) * 18, 12 + i * 1.1, Math.sin(a) * 18);
    bird.userData.noMerge = true;
    mapDecorRoot.add(bird);
    bird.userData.angle = a;
    bird.userData.radius = 18 + i * 3;
    bird.userData.speed = .045 + i * .01;
    bird.userData.phase = i * 2.4;
  }
}

// Merge static world meshes by material to keep draw calls low on modest GPUs.
function mergeStaticWorld() {
  worldRoot.updateMatrixWorld(true);
  const groups = new Map();
  worldRoot.traverse(o => {
    if (!o.isMesh || o.isPoints || o.isLine) return;
    let p = o;
    while (p) {
      if (p.userData?.noMerge) return;
      p = p.parent;
    }
    if (Array.isArray(o.material) || !o.geometry?.attributes?.position) return;
    const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}`;
    let g = groups.get(key);
    if (!g) { g = { material: o.material, cast: o.castShadow, receive: o.receiveShadow, items: [] }; groups.set(key, g); }
    let geo = o.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    geo.applyMatrix4(o.matrixWorld);
    g.items.push({ mesh: o, geo });
  });
  for (const g of groups.values()) {
    if (g.items.length < 2) {
      g.items[0].geo.dispose();
      continue;
    }
    const merged = mergeGeometries(g.items.map(i => i.geo), false);
    if (!merged) {
      g.items.forEach(i => i.geo.dispose());
      continue;
    }
    const mesh = new THREE.Mesh(merged, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.matrixAutoUpdate = false;
    worldRoot.add(mesh);
    for (const item of g.items) {
      if (item.mesh.parent) item.mesh.parent.remove(item.mesh);
      item.geo.dispose();
    }
  }
}

// prop spots used by prop-hunt
const PROP_SPOTS = [
  [-15.2, -7.7, 0.0], [16.8, 10.8, 0.0], [-20.5, 14.5, 0.0], [10.7, -19.4, 0.0],
  [-7.0, 4.1, 0.0], [8.0, 11.4, 0.0], [-13.7, -2.0, 0.0], [13.0, -5.6, 0.0],
  [-2.0, 14.4, 0.0], [-24.4, 8.0, 0.0], [23.8, 3.2, 0.0], [5.0, -4.8, 0.0],
  [-17.0, 18.0, 0.0], [18.6, -15.7, 0.0], [-10.4, 18.8, 0.0], [3.5, -16.0, 0.0],
  [-26.2, -14.0, 0.0], [25.0, 22.8, 0.0], [0.0, -24.4, 0.0], [12.0, 18.4, 0.0]
];
const MENU_PROPS = [
  { type: 'crate', x: -6.4, z: 6.8, ry: .25 },
  { type: 'barrel', x: 3.0, z: 2.2, ry: 0 },
  { type: 'crate', x: 8.4, z: 4.0, ry: -.15 },
  { type: 'barrel', x: -2.4, z: -5.0, ry: .5 }
];

// ---------------------------------------------------------------------------
// Shared dynamic material / effect helpers
// ---------------------------------------------------------------------------
const particles = [];
const corpses = [];
const decals = [];
const damageNumbers = [];
let muzzleLight;

function addParticle(mesh, vel, opts = {}) {
  const p = {
    mesh, vel: vel.clone(),
    baseScale: mesh.scale.x,
    gravity: opts.gravity ?? -16,
    drag: opts.drag ?? 1.6,
    life: opts.life ?? 1,
    maxLife: opts.life ?? 1,
    spin: opts.spin ? new THREE.Vector3(rand(-opts.spin, opts.spin), rand(-opts.spin, opts.spin), rand(-opts.spin, opts.spin)) : new THREE.Vector3(),
    grow: opts.grow ?? 0,
    fade: opts.fade !== false,
    bounce: opts.bounce ?? 0,
    floor: opts.floor ?? .02,
    onGround: opts.onGround || null
  };
  scene.add(mesh);
  particles.push(p);
  return p;
}

function burst(position, count, type, dir = null, power = 1) {
  for (let i = 0; i < count; i++) {
    let mat, geo, size, life, gravity, drag, spin;
    if (type === 'blood') {
      mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(.99, .75, rand(.18, .36)), transparent: true });
      geo = GEO.tetra; size = rand(.045, .13); life = rand(.5, 1.2); gravity = -20; drag = .6; spin = 13;
    } else if (type === 'spark') {
      mat = new THREE.MeshBasicMaterial({ color: Math.random() > .4 ? 0xffc46b : 0xfff1ca, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      geo = GEO.box; size = rand(.018, .055); life = rand(.15, .45); gravity = -10; drag = 2.5; spin = 18;
    } else if (type === 'smoke') {
      mat = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(.07, .08, rand(.16, .35)), transparent: true, opacity: .5, depthWrite: false });
      geo = GEO.box; size = rand(.16, .45); life = rand(.8, 1.8); gravity = .9; drag = .8; spin = 2.4;
    } else if (type === 'debris') {
      mat = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(.08, .25, rand(.16, .38)), transparent: true });
      geo = GEO.box; size = rand(.04, .16); life = rand(.7, 1.5); gravity = -20; drag = .5; spin = 14;
    } else {
      mat = new THREE.MeshBasicMaterial({ color: 0xdcbc8a, transparent: true });
      geo = GEO.box; size = rand(.025, .08); life = rand(.35, .9); gravity = -12; drag = 1.3; spin = 9;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(size, size, size);
    mesh.position.copy(position);
    mesh.castShadow = false;
    const v = new THREE.Vector3(rand(-1, 1), rand(-.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(.4, 1) * power);
    if (dir) v.addScaledVector(dir, rand(.5, 1.4) * power);
    addParticle(mesh, v, { gravity, drag, life, spin, bounce: type === 'blood' || type === 'debris' ? .25 : 0, floor: .04 });
  }
}

function spawnImpact(point, normal) {
  burst(point, 5, 'spark', normal, .5);
  burst(point, 3, 'dust', normal, .35);
}

function spawnBloodPool(position, amount = 1) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x4d0907, transparent: true, opacity: .6, depthWrite: false });
  const m = new THREE.Mesh(GEO.plane, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(position.x, .026, position.z);
  m.scale.setScalar(rand(.55, 1.2) * amount);
  scene.add(m);
  decals.push({ mesh: m, life: rand(12, 22), maxLife: 22, scale: 1 });
  // little darker spots
  for (let i = 0; i < 5; i++) {
    const d = new THREE.Mesh(GEO.plane, mat.clone());
    d.rotation.x = -Math.PI / 2;
    d.rotation.z = rand(0, 6);
    d.position.set(position.x + rand(-.65, .65), .027, position.z + rand(-.65, .65));
    d.scale.setScalar(rand(.08, .25) * amount);
    scene.add(d);
    decals.push({ mesh: d, life: rand(10, 18), maxLife: 18, scale: 1 });
  }
}

function clearDynamicWorld() {
  for (const p of particles) scene.remove(p.mesh);
  particles.length = 0;
  for (const c of corpses) {
    scene.remove(c.obj);
    c.obj.traverse?.(o => { if (o.material) { if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose(); } });
  }
  corpses.length = 0;
  for (const d of decals) scene.remove(d.mesh);
  decals.length = 0;
  for (const d of damageNumbers) d.el.remove();
  damageNumbers.length = 0;
  for (const e of state.enemies) scene.remove(e.root);
  state.enemies.length = 0;
  for (const p of targetProps) scene.remove(p.root);
  targetProps.length = 0;
  for (const p of state.projectiles) scene.remove(p.mesh);
  state.projectiles.length = 0;
  for (const f of state.gibs) scene.remove(f.mesh);
  state.gibs.length = 0;
  for (const fx of state.effects) scene.remove(fx.mesh);
  state.effects.length = 0;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const player = {
  pos: new THREE.Vector3(0, 0, 19),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: -0.035,
  onGround: true,
  radius: 0.42,
  eye: 1.68,
  health: 100,
  bobTime: 0,
  bob: 0,
  moveAmount: 0,
  sprint: false,
  ads: false,
  step: 0
};

const state = {
  selectedMode: 'zombie',
  mode: 'zombie',
  active: false,
  paused: false,
  over: false,
  score: 0,
  kills: 0,
  headshots: 0,
  shots: 0,
  hits: 0,
  wave: 0,
  waveKills: 0,
  waveTotal: 0,
  waveRemaining: 0,
  spawnRemaining: 0,
  spawnTimer: 0,
  waveActive: false,
  betweenWaves: false,
  intermission: 0,
  timeLeft: 95,
  operationTime: 0,
  mimicsTotal: 8,
  mimicsLeft: 8,
  scanCooldown: 0,
  scanTimer: 0,
  scanPulse: 0,
  enemies: [],
  projectiles: [],
  effects: [],
  gibs: [],
  lastHitTime: -10,
  killStreak: 0,
  lastKillTime: -10,
  menuTime: 0,
  enemyCheckTimer: 0,
  crosshairEnemy: false,
  hintTimer: 0,
  tutorialSeen: false,
  shake: 0,
  flash: 0,
  waveStartHealth: 100
};

const weapons = {
  ak: {
    key: 'ak', name: 'AK-47', type: 'ASSAULT RIFLE', ammo: 30, mag: 30, reserve: Infinity,
    fireRate: 0.094, reloadTime: 1.62, cooldown: 0, reloading: false, reloadTimer: 0,
    damage: 34, kick: 0, auto: true, slot: '01'
  },
  rpg: {
    key: 'rpg', name: 'RPG-7', type: 'ANTI-ARMOR', ammo: 1, mag: 1, reserve: 6,
    fireRate: 1.05, reloadTime: 2.15, cooldown: 0, reloading: false, reloadTimer: 0,
    damage: 250, kick: 0, auto: false, slot: '02'
  }
};
let currentWeapon = 'ak';
let trigger = false;
let weaponSwitchTimer = 0;

// ---------------------------------------------------------------------------
// First-person weapon models
// ---------------------------------------------------------------------------
// The viewmodel lives in its own scene/camera so the wide world FOV does not
// stretch it. It is composited over the world with a cleared depth buffer.
const viewScene = new THREE.Scene();
const viewCamera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .01, 12);
viewScene.add(viewCamera);
viewScene.add(new THREE.HemisphereLight(0xffe2c0, 0x3a2a1e, 1.15));
const viewKey = new THREE.DirectionalLight(0xffd9ad, 0.95);
viewKey.position.set(-.9, 1.3, .8);
viewScene.add(viewKey);
const viewRoot = new THREE.Group();
viewCamera.add(viewRoot);
const viewmodelGroups = {};

function gunMat(color, emissive = 0x000000) {
  return new THREE.MeshLambertMaterial({ color, emissive, flatShading: true });
}
const GUN = {
  metal: gunMat(0x616a6c, 0x0b0d0d),
  metalLight: gunMat(0x7d8683, 0x0b0d0c),
  dark: gunMat(0x2f3435, 0x050606),
  wood: gunMat(0x8a5429, 0x1c0d05),
  woodLight: gunMat(0xa26a3a, 0x180b04),
  grip: gunMat(0x3a3531, 0x070606),
  glove: gunMat(0x4f4132, 0x0b0806),
  sleeve: gunMat(0x6f5c41, 0x0d0a06),
  skin: gunMat(0xa87a51, 0x0c0806),
  rocket: gunMat(0x5f7155, 0x090d08),
  rpgGreen: gunMat(0x5c7050, 0x0a0d08),
  rpgDark: gunMat(0x39462f),
  glass: new THREE.MeshLambertMaterial({ color: 0x89b7b1, transparent: true, opacity: .55, flatShading: true }),
  white: gunMat(0xd7cfb8, 0x11100d)
};

function addGunBox(parent, w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
function addGunCyl(parent, r, len, x, y, z, mat, axis = 'z') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.set(x, y, z);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  parent.add(m);
  return m;
}

function buildAKModel() {
  const g = new THREE.Group();
  // receiver
  addGunBox(g, .13, .15, .5, 0, 0, -.06, GUN.metal);
  addGunBox(g, .145, .055, .18, 0, .096, -.09, GUN.metalLight);
  addGunBox(g, .12, .045, .3, 0, .12, -.27, GUN.dark);
  // wood stock and handguard
  addGunBox(g, .12, .14, .34, 0, -.02, .35, GUN.wood);
  addGunBox(g, .105, .16, .08, 0, -.015, .53, GUN.woodLight, .1);
  addGunBox(g, .105, .11, .3, 0, .005, -.39, GUN.wood);
  addGunBox(g, .115, .06, .09, 0, .07, -.4, GUN.woodLight);
  addGunCyl(g, .026, .42, 0, .025, -.68, GUN.metalLight);
  addGunCyl(g, .035, .12, 0, .025, -.4, GUN.metal);
  addGunBox(g, .038, .07, .055, 0, .075, -.79, GUN.dark);
  addGunBox(g, .07, .05, .03, 0, .11, -.83, GUN.metal);
  addGunBox(g, .025, .05, .03, 0, .085, -.57, GUN.metalLight);
  // curved magazine
  addGunBox(g, .1, .22, .18, 0, -.185, -.04, GUN.metal, .18, 0, 0);
  addGunBox(g, .09, .18, .16, .015, -.335, .015, GUN.metal, .32, 0, 0);
  addGunBox(g, .085, .09, .14, .028, -.45, .035, GUN.metalLight, .38, 0, 0);
  // grip
  addGunBox(g, .075, .21, .11, .015, -.19, .17, GUN.grip, -.25, 0, 0);
  // trigger guard
  addGunBox(g, .045, .018, .13, 0, -.12, .045, GUN.dark);
  addGunBox(g, .018, .07, .018, 0, -.09, .105, GUN.dark);
  // stock pad
  addGunBox(g, .13, .18, .055, 0, -.025, .545, GUN.dark);
  // right hand / sleeve
  const hand = new THREE.Group();
  hand.position.set(.015, -.22, -.08);
  hand.rotation.z = -.15;
  g.add(hand);
  addGunBox(hand, .10, .11, .15, 0, 0, 0, GUN.glove, .08);
  addGunBox(hand, .11, .10, .2, .045, -.06, .16, GUN.sleeve, -.25, .12, 0);
  // left hand under handguard
  const lhand = new THREE.Group();
  lhand.position.set(-.01, -.09, -.38);
  g.add(lhand);
  addGunBox(lhand, .11, .085, .15, -.03, 0, 0, GUN.glove, 0, 0, .1);
  addGunBox(lhand, .10, .09, .18, -.07, -.07, .14, GUN.sleeve, .05, -.2, .2);
  // sling
  addGunBox(g, .016, .012, .7, .075, -.09, .1, GUN.dark, .04);
  // muzzle flash
  const flash = makeMuzzleFlash();
  flash.position.set(0, .025, -.91);
  g.add(flash);
  g.userData.flash = flash;
  const light = new THREE.PointLight(0xffb35c, 0, 6, 2);
  light.position.set(0, .05, -.85);
  g.add(light);
  g.userData.light = light;
  return g;
}

function buildRPGModel() {
  const g = new THREE.Group();
  // tube
  addGunCyl(g, .075, 1.15, 0, 0, -.36, GUN.rpgGreen);
  addGunCyl(g, .092, .13, 0, 0, -.94, GUN.rpgDark);
  addGunCyl(g, .098, .2, 0, 0, .26, GUN.rpgDark);
  addGunCyl(g, .083, .09, 0, 0, -.18, GUN.rpgDark);
  addGunCyl(g, .047, .32, 0, 0, -1.02, GUN.rocket);
  // rocket cone
  const cone = new THREE.Mesh(new THREE.ConeGeometry(.105, .34, 7), GUN.rocket);
  cone.rotation.x = -Math.PI / 2;
  cone.position.set(0, 0, -1.25);
  g.add(cone);
  // warhead band
  addGunCyl(g, .075, .05, 0, 0, -1.12, GUN.white);
  // wooden heat guard
  addGunBox(g, .13, .055, .42, 0, .04, -.38, GUN.wood);
  addGunBox(g, .15, .05, .12, 0, .07, -.16, GUN.woodLight);
  // rear grip + trigger
  addGunBox(g, .06, .21, .1, 0, -.17, .03, GUN.grip, -.18);
  addGunBox(g, .055, .17, .09, 0, -.14, -.16, GUN.grip, .18);
  addGunBox(g, .045, .018, .18, 0, -.105, -.07, GUN.dark);
  // optic
  addGunBox(g, .11, .05, .14, 0, .13, -.2, GUN.dark);
  addGunBox(g, .04, .1, .04, 0, .19, -.2, GUN.metal);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .02, 8), GUN.glass);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, .15, -.27);
  g.add(lens);
  // hands
  const hand = new THREE.Group();
  hand.position.set(.02, -.17, .02);
  g.add(hand);
  addGunBox(hand, .12, .12, .16, 0, 0, 0, GUN.glove);
  addGunBox(hand, .12, .10, .2, .04, -.07, .17, GUN.sleeve, -.25, .12);
  const lhand = new THREE.Group();
  lhand.position.set(0, .01, -.37);
  g.add(lhand);
  addGunBox(lhand, .13, .1, .18, -.02, -.07, 0, GUN.glove, .1, 0, .15);
  addGunBox(lhand, .11, .1, .2, -.06, -.15, .15, GUN.sleeve, .1, -.15, .25);
  // front sight
  addGunBox(g, .018, .1, .03, 0, .11, -.9, GUN.dark);
  addGunBox(g, .06, .025, .03, 0, .16, -.9, GUN.metal);
  const flash = makeMuzzleFlash();
  flash.position.set(0, 0, -1.44);
  g.add(flash);
  g.userData.flash = flash;
  const light = new THREE.PointLight(0xffd49b, 0, 7, 2);
  light.position.set(0, .1, -1.1);
  g.add(light);
  g.userData.light = light;
  return g;
}

function makeMuzzleFlash() {
  const shape = new THREE.Shape();
  const points = 8;
  for (let i = 0; i < points * 2; i++) {
    const a = i / (points * 2) * Math.PI * 2;
    const r = i % 2 === 0 ? .09 : .025;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffd38c, transparent: true, opacity: .95, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
  mesh.visible = false;
  mesh.renderOrder = 12;
  return mesh;
}

viewmodelGroups.ak = buildAKModel();
viewmodelGroups.rpg = buildRPGModel();
viewRoot.add(viewmodelGroups.ak, viewmodelGroups.rpg);
viewmodelGroups.ak.scale.setScalar(.55);
viewmodelGroups.rpg.scale.setScalar(.38);
viewmodelGroups.ak.position.set(.20, -.17, -1.0);
viewmodelGroups.rpg.position.set(.22, -.18, -1.05);
viewmodelGroups.rpg.visible = false;
const viewLight = new THREE.PointLight(0xffd6a8, 2.5, 4.2, 1.25);
viewLight.position.set(.30, .26, -.55);
viewCamera.add(viewLight);

// ---------------------------------------------------------------------------
// Zombie model + ragdoll
// ---------------------------------------------------------------------------
function mergeLocalMeshes(group, zone) {
  group.updateMatrixWorld(true);
  const groups = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || Array.isArray(child.material)) continue;
    child.updateMatrix();
    let geo = child.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    geo.applyMatrix4(child.matrix);
    const key = child.material.uuid;
    let entry = groups.get(key);
    if (!entry) { entry = { material: child.material, geos: [], cast: child.castShadow }; groups.set(key, entry); }
    entry.geos.push(geo);
    entry.cast = entry.cast || child.castShadow;
    group.remove(child);
  }
  for (const entry of groups.values()) {
    const geo = entry.geos.length > 1 ? mergeGeometries(entry.geos, false) : entry.geos[0];
    if (entry.geos.length > 1) entry.geos.forEach(g => g.dispose());
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, entry.material);
    mesh.castShadow = entry.cast;
    mesh.receiveShadow = true;
    mesh.userData = { zone };
    group.add(mesh);
  }
}

function createZombieModel(kind = 'walker') {
  const root = new THREE.Group();
  const runner = kind === 'runner';
  const brute = kind === 'brute';
  const mimic = kind === 'mimic';
  const scale = brute ? 1.24 : runner ? .91 : mimic ? .88 : rand(.94, 1.06);
  root.scale.setScalar(scale);

  const skinColors = mimic ? [0x3f4c4a, 0x697a70] : brute ? [0x596042, 0x7c845d] : runner ? [0x778064, 0x929978] : [0x697a54, 0x839169, 0x737d5a];
  const skin = lam(skinColors[0]);
  const skinDark = lam(skinColors[1]);
  const shirt = lam(mimic ? 0x343d39 : brute ? 0x3e3a2f : runner ? 0x564334 : [0x4b4a38, 0x574333, 0x3f4a44][Math.floor(rand(0, 3))]);
  const pants = lam(mimic ? 0x252c2c : [0x32332e, 0x3d3328, 0x2d3340][Math.floor(rand(0, 3))]);
  const boots = lam(0x1f1c18);
  const blood = new THREE.MeshBasicMaterial({ color: 0x6f1512 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: mimic ? 0x9bfff2 : 0xff4a25 });
  const torsoMats = [skin, skinDark, shirt, pants, boots];

  const torso = new THREE.Group();
  torso.position.y = 1.27;
  root.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(brute ? .78 : .66, brute ? .83 : .72, .34), shirt);
  chest.position.y = .05;
  chest.castShadow = true;
  chest.userData = { zone: 'body' };
  torso.add(chest);
  const belly = new THREE.Mesh(new THREE.BoxGeometry(brute ? .65 : .55, .3, .3), skin);
  belly.position.y = -.36;
  belly.castShadow = true;
  belly.userData = { zone: 'body' };
  torso.add(belly);
  // ragged shirt flaps
  for (let i = 0; i < 3; i++) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(.14, rand(.16, .32), .025), shirt);
    flap.position.set(-.22 + i * .22, -.48 + rand(-.08, .05), .17);
    flap.rotation.z = rand(-.25, .25);
    torso.add(flap);
  }
  // chest wound
  const wound = new THREE.Mesh(new THREE.BoxGeometry(.15, .18, .015), blood);
  wound.position.set(.17, .13, .176);
  wound.rotation.z = .4;
  torso.add(wound);
  // shoulder cloth
  const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(.18, .16, .36), shirt);
  shoulderL.position.set(-.39, .27, 0);
  shoulderL.castShadow = true;
  torso.add(shoulderL);
  const shoulderR = shoulderL.clone();
  shoulderR.position.x = .39;
  torso.add(shoulderR);

  const head = new THREE.Group();
  head.position.y = 1.82;
  if (brute) head.scale.setScalar(1.08);
  root.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(brute ? .46 : .4, brute ? .42 : .38, .39), skin);
  skull.castShadow = true;
  skull.userData = { zone: 'head' };
  head.add(skull);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(brute ? .31 : .26, .14, .26), skinDark);
  jaw.position.set(0, -.21, .07);
  jaw.rotation.x = -.12;
  jaw.userData = { zone: 'head' };
  head.add(jaw);
  // brow + dead eyes
  const brow = new THREE.Mesh(new THREE.BoxGeometry(.34, .06, .06), skinDark);
  brow.position.set(0, .07, .195);
  head.add(brow);
  for (const sx of [-.1, .1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(.06, .038, .022), eyeMat);
    eye.position.set(sx, .015, .202);
    head.add(eye);
    eye.userData = { eye: true };
  }
  // mouth
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(.15, .025, .018), blood);
  mouth.position.set(0, -.12, .205);
  head.add(mouth);
  // hair / hood / helmet
  if (mimic) {
    const hood = new THREE.Mesh(new THREE.BoxGeometry(.46, .2, .42), shirt);
    hood.position.y = .23;
    head.add(hood);
  } else if (brute) {
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(.5, .12, .46), MAT.metalDark);
    helmet.position.y = .25;
    head.add(helmet);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(.56, .04, .52), MAT.metal);
    rim.position.y = .19;
    head.add(rim);
  } else {
    const hair = new THREE.Mesh(new THREE.BoxGeometry(.37, .1, .36), lam(0x2b241c));
    hair.position.set(rand(-.04, .04), .22, -.02);
    hair.rotation.z = rand(-.12, .12);
    head.add(hair);
  }

  const armL = new THREE.Group();
  armL.position.set(-.43, 1.59, 0);
  root.add(armL);
  const upperL = new THREE.Mesh(new THREE.BoxGeometry(brute ? .21 : .16, .48, .18), shirt);
  upperL.position.y = -.24;
  upperL.castShadow = true;
  upperL.userData = { zone: 'limb' };
  armL.add(upperL);
  const foreL = new THREE.Mesh(new THREE.BoxGeometry(.14, .44, .15), skin);
  foreL.position.set(0, -.68, .04);
  foreL.rotation.x = -.25;
  foreL.castShadow = true;
  foreL.userData = { zone: 'limb' };
  armL.add(foreL);
  const handL = new THREE.Mesh(new THREE.BoxGeometry(.15, .14, .2), skinDark);
  handL.position.set(0, -.92, .1);
  handL.castShadow = true;
  handL.userData = { zone: 'limb' };
  armL.add(handL);

  const armR = new THREE.Group();
  armR.position.set(.43, 1.59, 0);
  root.add(armR);
  const upperR = upperL.clone(); upperR.position.set(0, -.24, 0); armR.add(upperR);
  const foreR = foreL.clone(); foreR.position.set(0, -.68, .04); armR.add(foreR);
  const handR = handL.clone(); handR.position.set(0, -.92, .1); armR.add(handR);

  const legL = new THREE.Group();
  legL.position.set(-.18, .98, 0);
  root.add(legL);
  const thighL = new THREE.Mesh(new THREE.BoxGeometry(.22, .48, .23), pants);
  thighL.position.y = -.24;
  thighL.castShadow = true;
  thighL.userData = { zone: 'limb' };
  legL.add(thighL);
  const calfL = new THREE.Mesh(new THREE.BoxGeometry(.18, .45, .18), pants);
  calfL.position.set(0, -.69, .02);
  calfL.castShadow = true;
  calfL.userData = { zone: 'limb' };
  legL.add(calfL);
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(.22, .16, .32), boots);
  bootL.position.set(0, -.99, .07);
  bootL.castShadow = true;
  bootL.userData = { zone: 'limb' };
  legL.add(bootL);

  const legR = new THREE.Group();
  legR.position.set(.18, .98, 0);
  root.add(legR);
  const thighR = thighL.clone(); thighR.position.set(0, -.24, 0); legR.add(thighR);
  const calfR = calfL.clone(); calfR.position.set(0, -.69, .02); legR.add(calfR);
  const bootR = bootL.clone(); bootR.position.set(0, -.99, .07); legR.add(bootR);

  root.userData.parts = [torso, head, armL, armR, legL, legR];
  mergeLocalMeshes(torso, 'body');
  mergeLocalMeshes(head, 'head');
  mergeLocalMeshes(armL, 'limb');
  mergeLocalMeshes(armR, 'limb');
  mergeLocalMeshes(legL, 'limb');
  mergeLocalMeshes(legR, 'limb');
  root.userData.flashMats = torsoMats;
  root.userData.eyeMats = [eyeMat];
  root.userData.materials = [...torsoMats, eyeMat, blood];
  return {
    root, torso, head, armL, armR, legL, legR,
    parts: root.userData.parts,
    flashMats: torsoMats,
    materials: root.userData.materials,
    scale
  };
}

function createRagdoll(z, impactDir, force = 1) {
  const basePos = z.root.position.clone();
  for (const part of z.parts) {
    part.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(part);
    // Object3D.clone deep-copies userData through JSON, and the enemy back
    // reference is circular, so strip it before cloning the body parts.
    part.traverse(o => { if (o.userData) delete o.userData.enemy; });
    const clone = part.clone(true);
    clone.matrix.copy(part.matrixWorld);
    clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
    clone.matrixAutoUpdate = true;
    clone.traverse(o => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.castShadow = true;
        o.receiveShadow = true;
        // grubby it up
        if (o.material.color) o.material.color.multiplyScalar(rand(.68, .92));
      }
    });
    scene.add(clone);
    const mats = [];
    clone.traverse(o => { if (o.isMesh) mats.push(o.material); });
    const isHead = part === z.head;
    const isTorso = part === z.torso;
    const dir = impactDir ? impactDir.clone() : new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
    dir.y = 0;
    if (dir.lengthSq() < .001) dir.set(0, 0, 1);
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const vel = dir.multiplyScalar(rand(2.2, 4.8) * force * (isHead ? 1.4 : isTorso ? 1 : .8));
    vel.addScaledVector(side, rand(-1.5, 1.5) * force);
    vel.y = rand(1.4, 3.8) * force * (isHead ? 1.3 : 1);
    const pivotToBase = Math.max(.06, clone.position.y - box.min.y);
    corpses.push({
      obj: clone,
      vel,
      angVel: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)).multiplyScalar(force * (isHead ? 1.4 : 1)),
      base: pivotToBase,
      life: rand(7.5, 10),
      maxLife: 10,
      fade: false,
      mats,
      bounce: isHead ? 3 : 1
    });
  }
  spawnBloodPool(basePos, z.scale);
}

function updateCorpses(dt) {
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i];
    c.life -= dt;
    c.vel.y -= 19 * dt;
    c.vel.x *= 1 - .65 * dt;
    c.vel.z *= 1 - .65 * dt;
    c.obj.position.addScaledVector(c.vel, dt);
    // rotate by angular velocity
    TMP_Q.setFromEuler(new THREE.Euler(c.angVel.x * dt, c.angVel.y * dt, c.angVel.z * dt));
    c.obj.quaternion.multiply(TMP_Q);
    c.angVel.multiplyScalar(1 - .6 * dt);
    if (c.obj.position.y < c.base) {
      c.obj.position.y = c.base;
      if (c.vel.y < -.8) {
        c.vel.y *= -.3;
        c.vel.x *= .7;
        c.vel.z *= .7;
        spawnImpact(c.obj.position.clone().setY(.12), UP);
      } else {
        c.vel.y = 0;
        c.vel.x *= .82;
        c.vel.z *= .82;
      }
      c.angVel.x *= .7;
      c.angVel.z *= .7;
    }
    if (c.life < 2.5) {
      if (!c.fade) { c.fade = true; }
      const op = clamp(c.life / 2.5, 0, 1);
      for (const m of c.mats) m.opacity = op;
      c.obj.position.y -= dt * .08;
    }
    if (c.life <= 0) {
      scene.remove(c.obj);
      c.obj.traverse(o => { if (o.material) o.material.dispose(); });
      corpses.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------
function spawnPointAwayFromPlayer(minDist = 14) {
  const points = [
    [-26, -26], [0, -26], [26, -26], [26, 0], [26, 26], [0, 26], [-26, 26], [-26, 0],
    [-20, -18], [20, -18], [20, 18], [-20, 18], [-12, 27], [12, -27], [27, 12], [-27, -12]
  ];
  let best = points[Math.floor(Math.random() * points.length)];
  for (let i = 0; i < 6; i++) {
    const p = points[Math.floor(Math.random() * points.length)];
    if (Math.hypot(p[0] - player.pos.x, p[1] - player.pos.z) > minDist) { best = p; break; }
  }
  return new THREE.Vector3(best[0] + rand(-1.2, 1.2), 0, best[1] + rand(-1.2, 1.2));
}

function spawnEnemy(kind = null) {
  if (!kind) {
    const roll = Math.random();
    if (state.wave >= 4 && roll < .13) kind = 'brute';
    else if (state.wave >= 2 && roll < .38) kind = 'runner';
    else kind = 'walker';
  }
  const model = createZombieModel(kind);
  const pos = spawnPointAwayFromPlayer(13);
  model.root.position.copy(pos);
  model.root.rotation.y = rand(0, Math.PI * 2);
  scene.add(model.root);
  const hp = kind === 'brute' ? 380 + state.wave * 30 : kind === 'runner' ? 62 + state.wave * 8 : 108 + state.wave * 14;
  const z = {
    ...model,
    kind,
    health: hp,
    maxHealth: hp,
    speed: kind === 'brute' ? 1.08 + state.wave * .015 : kind === 'runner' ? 2.8 + state.wave * .045 : 1.45 + state.wave * .035,
    attackCd: rand(.3, 1.2),
    phase: rand(0, 10),
    dead: false,
    hitFlash: 0,
    stagger: 0,
    id: Math.random().toString(36).slice(2),
    net: new THREE.Vector3()
  };
  model.root.traverse(o => {
    if (!o.isMesh) return;
    const zone = o.userData.zone || 'body';
    o.userData.enemy = z;
    o.userData.zone = zone;
    o.castShadow = true;
  });
  state.enemies.push(z);
  burst(pos.clone().setY(.4), 8, 'dust', null, .7);
  // health hint for brutes
  if (kind === 'brute') {
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(.85, .1), new THREE.MeshBasicMaterial({ color: 0x180d09, transparent: true, opacity: .7, depthTest: false }));
    barBg.position.set(0, 2.42, 0);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(.8, .065), new THREE.MeshBasicMaterial({ color: 0xd33122, depthTest: false }));
    bar.position.z = .006;
    barBg.add(bar);
    barBg.userData.bar = bar;
    model.root.add(barBg);
    z.healthBar = barBg;
  }
  return z;
}

function updateEnemies(dt) {
  for (const z of state.enemies) {
    if (z.dead) continue;
    const dx = player.pos.x - z.root.position.x;
    const dz = player.pos.z - z.root.position.z;
    const dist = Math.hypot(dx, dz);
    const desiredYaw = Math.atan2(dx, dz);
    // spin to face the player
    let dy = desiredYaw - z.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    z.root.rotation.y += dy * Math.min(1, dt * 6);
    if (dist > 1.12) {
      const speed = z.speed * (z.stagger > 0 ? .35 : 1);
      const wobble = Math.sin(z.phase * 1.7) * .4;
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      const sx = -nz, sz = nx;
      z.root.position.x += (nx + sx * wobble * .22) * speed * dt;
      z.root.position.z += (nz + sz * wobble * .22) * speed * dt;
    }
    // collision against world
    resolveCircle(z.root.position, .38);
    // keep zombies apart
    for (const other of state.enemies) {
      if (other === z || other.dead) continue;
      const ox = z.root.position.x - other.root.position.x;
      const oz = z.root.position.z - other.root.position.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < .7 && d2 > .0001) {
        const d = Math.sqrt(d2);
        z.root.position.x += ox / d * dt * .9;
        z.root.position.z += oz / d * dt * .9;
      }
    }
    // animation
    z.phase += dt * (3.3 + z.speed * 1.6);
    const moving = dist > 1.15 ? 1 : .35;
    const sw = Math.sin(z.phase);
    z.legL.rotation.x = sw * .56 * moving;
    z.legR.rotation.x = -sw * .56 * moving;
    z.armL.rotation.x = -.82 - sw * .34 * moving;
    z.armR.rotation.x = -.82 + sw * .34 * moving;
    z.armL.rotation.z = .08 + Math.sin(z.phase * .5) * .06;
    z.armR.rotation.z = -.08 - Math.sin(z.phase * .5) * .06;
    z.torso.position.y = 1.27 + Math.abs(sw) * .035 * moving;
    z.torso.rotation.z = sw * .045;
    z.head.rotation.z = Math.sin(z.phase * .6) * .08;
    z.head.rotation.x = -.08 + Math.sin(z.phase * .45) * .05;
    // hit flash
    if (z.hitFlash > 0) {
      z.hitFlash -= dt;
      for (const m of z.flashMats) m.emissive.setRGB(.65, .02, .01);
    } else {
      for (const m of z.flashMats) m.emissive.setRGB(0, 0, 0);
    }
    if (z.stagger > 0) z.stagger -= dt;
    // attack
    z.attackCd -= dt;
    if (dist < 1.65 && z.attackCd <= 0) {
      z.attackCd = z.kind === 'runner' ? .85 : 1.15;
      damagePlayer(z.kind === 'brute' ? 18 : z.kind === 'runner' ? 9 : 12, z);
      z.armR.rotation.x = -2.2;
      z.lunge = 1;
    }
    if (z.lunge > 0) {
      z.lunge -= dt * 5;
      z.root.position.x += Math.sin(z.root.rotation.y) * dt * 1.8;
      z.root.position.z += Math.cos(z.root.rotation.y) * dt * 1.8;
      resolveCircle(z.root.position, .38);
    }
    // random groan
    if (Math.random() < dt * .18) audio.groan(dist);
    // health bar
    if (z.healthBar) {
      z.healthBar.quaternion.copy(camera.quaternion);
      z.healthBar.userData.bar.scale.x = clamp(z.health / z.maxHealth, 0.01, 1);
      z.healthBar.userData.bar.position.x = -(1 - z.healthBar.userData.bar.scale.x) * .4;
    }
    // world bounds
    z.root.position.x = clamp(z.root.position.x, -ARENA, ARENA);
    z.root.position.z = clamp(z.root.position.z, -ARENA, ARENA);
  }
}

function damageEnemy(z, damage, zone, point, impactDir, explosive = false) {
  if (!z || z.dead) return;
  let mult = zone === 'head' ? 2.55 : zone === 'limb' ? .65 : 1;
  if (zone === 'head' && z.kind === 'brute') mult = 1.8;
  const dealt = damage * mult * rand(.93, 1.07);
  z.health -= dealt;
  z.hitFlash = .12;
  z.stagger = .18;
  spawnDamageNumber(point, Math.round(dealt), zone === 'head');
  if (zone === 'head') {
    burst(point, 7, 'blood', impactDir, 1.35);
    audio.hit(true);
    state.headshots++;
  } else {
    burst(point, 4, 'blood', impactDir, .8);
    audio.hit(false);
  }
  if (z.healthBar) z.healthBar.userData.bar.scale.x = clamp(z.health / z.maxHealth, .01, 1);
  if (z.health <= 0) killEnemy(z, zone === 'head', impactDir, explosive);
}

function killEnemy(z, headshot, impactDir, explosive = false) {
  if (!z || z.dead) return;
  z.dead = true;
  const idx = state.enemies.indexOf(z);
  if (idx >= 0) state.enemies.splice(idx, 1);
  const pos = z.root.position.clone();
  scene.remove(z.root);
  const force = explosive ? 2.4 : headshot ? 1.4 : 1;
  createRagdoll(z, impactDir, force);
  spawnBloodPool(pos, 1.1 * z.scale);
  burst(pos.clone().setY(1.05), headshot ? 20 : 10, 'blood', impactDir, headshot ? 1.7 : 1.05);
  state.kills++;
  state.waveKills++;
  state.killStreak++;
  state.lastKillTime = state.operationTime;
  const points = z.kind === 'brute' ? 300 : z.kind === 'runner' ? 150 : 120;
  state.score += Math.round(points * (headshot ? 2.4 : 1) * (1 + Math.min(state.killStreak, 8) * .06));
  audio.kill();
  addKillFeed(z.kind, headshot, explosive);
  if (headshot) {
    showHitmarker(true);
    state.score += 40;
  }
  if (z.kind === 'brute') addPickupToast('BRUTE DOWN // +300');
  state.waveRemaining = state.enemies.length + state.spawnRemaining;
}

function damagePlayer(amount, source) {
  if (state.over || state.paused || !state.active) return;
  player.health -= amount;
  state.shake = Math.max(state.shake, amount * .055);
  state.flash = .9;
  dom.damageFlash.classList.add('on');
  setTimeout(() => dom.damageFlash.classList.remove('on'), 90);
  audio.hurt();
  if (source) {
    const dx = player.pos.x - source.root.position.x;
    const dz = player.pos.z - source.root.position.z;
    player.yaw += Math.atan2(dx, dz) * .01;
  }
  if (player.health <= 0) {
    player.health = 0;
    endOperation(false, 'KILLED IN ACTION');
  }
}

// ---------------------------------------------------------------------------
// Collision helpers
// ---------------------------------------------------------------------------
function resolveCircle(pos, radius) {
  for (const c of COLLIDERS) {
    if (pos.y > c.h - .15) continue;
    const cx = clamp(pos.x, c.minX, c.maxX);
    const cz = clamp(pos.z, c.minZ, c.maxZ);
    let dx = pos.x - cx;
    let dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > .00001) {
      const d = Math.sqrt(d2);
      pos.x = cx + dx / d * radius;
      pos.z = cz + dz / d * radius;
    } else {
      const left = Math.abs(pos.x - c.minX), right = Math.abs(c.maxX - pos.x);
      const front = Math.abs(pos.z - c.minZ), back = Math.abs(c.maxZ - pos.z);
      const m = Math.min(left, right, front, back);
      if (m === left) pos.x = c.minX - radius;
      else if (m === right) pos.x = c.maxX + radius;
      else if (m === front) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
    }
  }
  pos.x = clamp(pos.x, -ARENA, ARENA);
  pos.z = clamp(pos.z, -ARENA, ARENA);
}

// ---------------------------------------------------------------------------
// Prop hunt targets
// ---------------------------------------------------------------------------
function createTargetProp(type, x, z, mimic) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = rand(0, Math.PI * 2);
  scene.add(root);
  const shade = rand(.78, 1.12);
  const mats = [];
  const eyeGroup = new THREE.Group();
  eyeGroup.position.y = .56;
  eyeGroup.visible = false;
  root.add(eyeGroup);

  if (type === 'crate') {
    const base = new THREE.Color(0x87623c).multiplyScalar(shade);
    const wood = lam(base, { map: woodTex });
    const trim = lam(0x4f3520);
    mats.push(wood, trim);
    const s = rand(.8, 1.05);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), wood);
    mesh.position.y = s / 2;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.zone = 'prop';
    root.add(mesh);
    for (const y of [s * .22, s * .78]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(s + .02, .06, .06), trim);
      bar.position.set(0, y, s / 2 + .01);
      root.add(bar);
      const bar2 = bar.clone(); bar2.position.z = -s / 2 - .01; root.add(bar2);
    }
    const diag = new THREE.Mesh(new THREE.BoxGeometry(.06, Math.sqrt(2) * s * .92, .04), trim);
    diag.position.set(0, s / 2, s / 2 + .035);
    diag.rotation.z = Math.PI / 4;
    root.add(diag);
    eyeGroup.position.set(0, s * .62, s / 2 + .03);
  } else if (type === 'barrel') {
    const col = new THREE.Color([0x9a4e2a, 0x53604a, 0x466276][Math.floor(rand(0, 3))]).multiplyScalar(shade);
    const bodyMat = lam(col, { map: rustTex });
    const trim = lam(0x2e2c28);
    mats.push(bodyMat, trim);
    const body = new THREE.Mesh(GEO.barrel, bodyMat);
    body.position.y = .55;
    body.castShadow = body.receiveShadow = true;
    body.userData.zone = 'prop';
    root.add(body);
    for (const y of [.27, .82]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.43, .025, 4, 9), trim);
      ring.position.y = y;
      ring.rotation.x = Math.PI / 2;
      root.add(ring);
    }
    const top = new THREE.Mesh(GEO.barrelTop, trim);
    top.position.y = 1.09;
    root.add(top);
    eyeGroup.position.set(0, .65, .44);
  } else {
    const orange = lam(0xd5581e);
    const white = lam(0xd4c9ae);
    const dark = lam(0x3a3128);
    mats.push(orange, white, dark);
    const base = new THREE.Mesh(new THREE.BoxGeometry(.62, .1, .62), dark);
    base.position.y = .05;
    base.castShadow = true;
    root.add(base);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(.3, .8, 7), orange);
    cone.position.y = .48;
    cone.castShadow = true;
    cone.userData.zone = 'prop';
    root.add(cone);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(.22, .26, .16, 7), white);
    band.position.y = .42;
    root.add(band);
    eyeGroup.position.set(0, .5, .25);
  }
  // faint mimic eyes (only visible on scan)
  for (const sx of [-.1, .1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(.07, .035, .02), new THREE.MeshBasicMaterial({ color: 0x8ffff0 }));
    eye.position.x = sx;
    eyeGroup.add(eye);
  }
  root.traverse(o => {
    if (o.isMesh) {
      o.userData.propRoot = root;
      if (!o.userData.zone) o.userData.zone = 'prop';
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const prop = {
    root, type, mimic, alive: true, home: new THREE.Vector3(x, 0, z),
    eyeGroup, mats, moveTimer: rand(1.8, 4.5), moving: null,
    scanGlow: 0, phase: rand(0, 10), original: root.position.clone(), id: Math.random()
  };
  root.userData.prop = prop;
  targetProps.push(prop);
  return prop;
}

function setupPropMode() {
  const spots = PROP_SPOTS.slice().sort(() => Math.random() - .5);
  const types = ['crate', 'barrel', 'cone'];
  state.mimicsTotal = 8;
  state.mimicsLeft = 8;
  for (let i = 0; i < 8; i++) {
    const [x, z] = spots[i];
    createTargetProp(types[Math.floor(rand(0, 3))], x, z, true);
  }
  for (let i = 8; i < 15; i++) {
    const [x, z] = spots[i];
    createTargetProp(types[Math.floor(rand(0, 3))], x, z, false);
  }
  state.timeLeft = 95;
  state.scanCooldown = 0;
  state.scanTimer = 0;
  dom.chargeLabel.textContent = 'SCAN READY';
  dom.scanKey.textContent = 'Q';
}

function isPropObserved(prop) {
  const to = TMP_V1.set(prop.root.position.x, 1.1, prop.root.position.z).sub(camera.position);
  const dist = to.length();
  if (dist < 5.5) return true;
  camera.getWorldDirection(TMP_V2);
  to.normalize();
  return TMP_V2.dot(to) > .52;
}

function moveProp(prop) {
  const spots = PROP_SPOTS;
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 4; i++) {
    const s = spots[Math.floor(Math.random() * spots.length)];
    const dPlayer = Math.hypot(s[0] - player.pos.x, s[1] - player.pos.z);
    const dHome = Math.hypot(s[0] - prop.home.x, s[1] - prop.home.z);
    const score = Math.min(dPlayer, 13) * .6 + Math.min(dHome, 15) * .25 + rand(0, 6);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (!best) return;
  prop.moving = {
    from: prop.root.position.clone(),
    to: new THREE.Vector3(best[0], 0, best[1]),
    t: 0,
    dur: rand(.8, 1.5),
    hop: rand(.28, .6)
  };
  prop.home.set(best[0], 0, best[1]);
  burst(prop.root.position.clone().setY(.1), 3, 'dust', null, .3);
}

function updateProps(dt) {
  if (state.mode !== 'prop' || !state.active || state.paused) return;
  for (const prop of targetProps) {
    if (!prop.alive) continue;
    prop.phase += dt;
    // subtle breathing motion by the imposter
    if (prop.mimic) {
      const s = 1 + Math.sin(prop.phase * 2.1) * .008;
      prop.root.scale.set(s, 1 / s, s);
      prop.root.rotation.z = Math.sin(prop.phase * 1.3) * .004;
      if (prop.scanGlow > 0) {
        prop.scanGlow -= dt;
        for (const m of prop.mats) {
          if (m.emissive) m.emissive.setRGB(.1, .5, .45);
        }
        prop.eyeGroup.visible = true;
        prop.eyeGroup.rotation.y = Math.sin(prop.phase * 4) * .5;
      } else {
        for (const m of prop.mats) {
          if (m.emissive) m.emissive.setRGB(0, 0, 0);
        }
        prop.eyeGroup.visible = false;
      }
    }
    if (prop.moving) {
      prop.moving.t += dt;
      const t = clamp(prop.moving.t / prop.moving.dur, 0, 1);
      const e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      prop.root.position.x = lerp(prop.moving.from.x, prop.moving.to.x, e);
      prop.root.position.z = lerp(prop.moving.from.z, prop.moving.to.z, e);
      prop.root.position.y = Math.sin(t * Math.PI) * prop.moving.hop;
      prop.root.rotation.y += dt * 3.2;
      if (t >= 1) {
        prop.root.position.y = 0;
        prop.root.rotation.z = 0;
        prop.moving = null;
        prop.moveTimer = rand(2.8, 6.2);
      }
      continue;
    }
    prop.moveTimer -= dt;
    if (prop.moving === null && prop.moveTimer <= 0) {
      prop.moveTimer = rand(2.5, 5.5);
      if (!isPropObserved(prop) && Math.hypot(prop.root.position.x - player.pos.x, prop.root.position.z - player.pos.z) > 4.5) {
        moveProp(prop);
      }
    }
    // keep away from the player physically
    const dx = prop.root.position.x - player.pos.x;
    const dz = prop.root.position.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.1 && d > .01) {
      prop.root.position.x += dx / d * dt * 1.2;
      prop.root.position.z += dz / d * dt * 1.2;
    }
  }
}

function hitProp(prop, point, dir, explosive = false) {
  if (!prop.alive) return false;
  prop.alive = false;
  const idx = targetProps.indexOf(prop);
  if (idx >= 0) targetProps.splice(idx, 1);
  const pos = prop.root.position.clone();
  scene.remove(prop.root);
  // prop shell breaks apart
  burst(pos.clone().setY(.4), explosive ? 26 : 14, 'debris', dir, explosive ? 1.8 : 1.1);
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(rand(.06, .18), rand(.06, .2), rand(.05, .16)), prop.mats[i % prop.mats.length].clone());
    m.position.copy(pos).add(new THREE.Vector3(rand(-.3, .3), rand(.2, 1), rand(-.3, .3)));
    m.material.transparent = true;
    addParticle(m, new THREE.Vector3(rand(-3, 3), rand(1.5, 5), rand(-3, 3)), { gravity: -19, drag: .4, life: rand(.9, 1.8), spin: 15, bounce: .25, floor: .05 });
  }
  if (prop.mimic) {
    state.mimicsLeft--;
    state.score += explosive ? 420 : 320;
    audio.propBreak();
    audio.kill();
    addKillFeed('mimic', false, explosive);
    addPickupToast(`MIMIC NEUTRALISED // ${state.mimicsLeft} REMAIN`);
    // a mimic dies as the thing it was pretending to be: a little disguised
    // body pops out and ragdolls.
    const body = createZombieModel('mimic');
    body.root.position.copy(pos);
    body.root.rotation.y = prop.root.rotation.y;
    scene.add(body.root);
    body.root.updateMatrixWorld(true);
    const dir2 = dir ? dir.clone() : new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1));
    createRagdoll({ ...body, root: body.root, parts: body.parts, scale: .88, head: body.head, torso: body.torso }, dir2, explosive ? 2.3 : 1.45);
    scene.remove(body.root);
    state.kills++;
    if (state.mimicsLeft <= 0) {
      state.score += Math.round(state.timeLeft * 45);
      setTimeout(() => { if (state.active && state.mode === 'prop') endOperation(true, 'ALL MIMICS NEUTRALISED'); }, 650);
    }
  } else {
    state.timeLeft = Math.max(0, state.timeLeft - 4);
    state.score = Math.max(0, state.score - 120);
    audio.decoy();
    addKillFeed('decoy', false, false);
    addPickupToast('DECOY // -4 SEC');
    state.flash = .35;
  }
  showHitmarker(prop.mimic);
  return true;
}

// ---------------------------------------------------------------------------
// Weapons / shooting
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
raycaster.far = 140;
const muzzleNDC = new THREE.Vector2();
const raycasterCandidates = [];

function getShotSpread() {
  const w = weapons[currentWeapon];
  let spread = player.ads ? .0017 : .0065;
  spread += player.moveAmount * .0052;
  if (!player.onGround) spread += .01;
  if (currentWeapon === 'rpg') spread *= .6;
  return spread;
}

function firstGameplayHit(intersections) {
  for (const hit of intersections) {
    let node = hit.object;
    while (node) {
      if (node.userData?.enemy) return { hit, enemy: node.userData.enemy };
      if (node.userData?.prop) return { hit, prop: node.userData.prop };
      if (node === worldRoot) return { hit, world: true };
      node = node.parent;
    }
  }
  return null;
}

function fireWeapon() {
  if (!state.active || state.paused || state.over) return;
  const w = weapons[currentWeapon];
  if (w.cooldown > 0 || w.reloading || weaponSwitchTimer > 0) return;
  if (w.ammo <= 0) {
    audio.dry();
    w.cooldown = .22;
    if (currentWeapon === 'rpg' && w.reserve > 0) startReload();
    return;
  }
  w.ammo--;
  w.cooldown = w.fireRate;
  state.shots++;
  state.shake = Math.max(state.shake, currentWeapon === 'ak' ? .07 : .16);
  if (currentWeapon === 'ak') {
    audio.shot();
    fireHitscan();
    muzzleFlash(currentWeapon);
    ejectShell();
  } else {
    audio.rpg();
    launchRocket();
    muzzleFlash(currentWeapon);
    viewmodelGroups.rpg.userData.flash.scale.setScalar(1.55);
  }
  w.kick = Math.min(1.5, w.kick + (currentWeapon === 'ak' ? .85 : 1.7));
  updateAmmoUI();
  scheduleAutoReload();
}

function scheduleAutoReload() {
  if (currentWeapon === 'rpg' && weapons.rpg.ammo === 0 && weapons.rpg.reserve > 0) {
    setTimeout(() => {
      if (state.active && !state.paused && currentWeapon === 'rpg' && weapons.rpg.ammo === 0) startReload();
    }, 550);
  }
}

function fireHitscan() {
  const spread = getShotSpread();
  muzzleNDC.set(rand(-spread, spread), rand(-spread, spread));
  raycaster.setFromCamera(muzzleNDC, camera);
  raycasterCandidates.length = 0;
  raycasterCandidates.push(worldRoot);
  for (const z of state.enemies) raycasterCandidates.push(z.root);
  for (const p of targetProps) raycasterCandidates.push(p.root);
  const hits = raycaster.intersectObjects(raycasterCandidates, true);
  const found = firstGameplayHit(hits);
  const origin = camera.position.clone();
  const endpoint = found ? found.hit.point.clone() : origin.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(90));
  // occasional tracer to sell the automatic fire
  if (Math.random() < .45) spawnTracer(origin.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(.7)), endpoint);
  if (!found) return;
  const point = found.hit.point;
  const normal = found.hit.face ? found.hit.face.normal.clone().transformDirection(found.hit.object.matrixWorld) : UP;
  if (found.enemy) {
    state.hits++;
    damageEnemy(found.enemy, weapons.ak.damage, found.hit.object.userData.zone || 'body', point, camera.getWorldDirection(new THREE.Vector3()));
    showHitmarker(found.enemy.health <= 0);
  } else if (found.prop) {
    state.hits++;
    hitProp(found.prop, point, camera.getWorldDirection(new THREE.Vector3()));
  } else {
    spawnImpact(point, normal);
    burst(point, 2, 'dust', normal, .25);
  }
}

function spawnTracer(a, b) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const mat = new THREE.LineBasicMaterial({ color: 0xffcf93, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  state.effects.push({ type: 'tracer', mesh: line, life: .07, maxLife: .07, mats: [mat], geo });
}

function ejectShell() {
  const geo = new THREE.BoxGeometry(.025, .025, .06);
  const mat = new THREE.MeshBasicMaterial({ color: 0xd2a348, transparent: true });
  const shell = new THREE.Mesh(geo, mat);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  shell.position.copy(camera.position).add(right.clone().multiplyScalar(.25)).add(up.clone().multiplyScalar(-.15));
  addParticle(shell, right.clone().multiplyScalar(rand(2, 4)).add(up.clone().multiplyScalar(rand(1.5, 2.5))), {
    gravity: -15, drag: .7, life: .9, spin: 16, bounce: .4, floor: .04
  });
}

function muzzleFlash(key) {
  const group = viewmodelGroups[key];
  const flash = group.userData.flash;
  flash.visible = true;
  flash.rotation.z = rand(0, Math.PI * 2);
  flash.scale.setScalar(rand(.8, 1.25));
  group.userData.light.intensity = key === 'ak' ? 12 : 18;
  group.userData.flashTimer = .045;
}

function launchRocket() {
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const origin = camera.position.clone().add(dir.clone().multiplyScalar(.8));
  const group = new THREE.Group();
  group.position.copy(origin);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.055, .065, .45, 7), gunMat(0x596e4b));
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(.08, .25, 7), gunMat(0x44543a));
  cone.rotation.x = Math.PI / 2;
  cone.position.z = -.32;
  group.add(cone);
  const glow = new THREE.PointLight(0xff9c4f, 3.5, 5, 2);
  glow.position.z = .35;
  group.add(glow);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  scene.add(group);
  state.projectiles.push({
    mesh: group,
    vel: dir.clone().multiplyScalar(36),
    life: 6,
    trailTimer: 0,
    pos: origin.clone(),
    prev: origin.clone()
  });
}

function updateProjectiles(dt) {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    p.life -= dt;
    p.prev.copy(p.pos);
    p.vel.y -= 2.0 * dt;
    p.pos.addScaledVector(p.vel, dt);
    p.mesh.position.copy(p.pos);
    p.trailTimer -= dt;
    if (p.trailTimer <= 0) {
      p.trailTimer = .028;
      burst(p.pos.clone().addScaledVector(p.vel, -.008), 1, 'smoke', null, .25);
      burst(p.pos.clone(), 1, 'spark', null, .3);
    }
    let hitPos = null;
    // ground / world bounds
    if (p.pos.y <= .12) hitPos = p.pos.clone().setY(.12);
    if (Math.abs(p.pos.x) > ARENA || Math.abs(p.pos.z) > ARENA) hitPos = p.pos.clone();
    // collision with world via ray
    if (!hitPos) {
      const dir = TMP_V1.copy(p.pos).sub(p.prev);
      const len = dir.length();
      if (len > .001) {
        dir.normalize();
        raycaster.set(p.prev, dir);
        raycaster.far = len + .15;
        const hits = raycaster.intersectObject(worldRoot, true);
        if (hits.length) hitPos = hits[0].point.clone();
        raycaster.far = 140;
      }
    }
    // collision with enemies (swept segment so fast rockets do not tunnel)
    if (!hitPos) {
      const sx = p.pos.x - p.prev.x, sy = p.pos.y - p.prev.y, sz = p.pos.z - p.prev.z;
      const segLenSq = sx * sx + sy * sy + sz * sz || 1;
      let bestT = 2;
      for (const z of state.enemies) {
        if (z.dead) continue;
        const cx = z.root.position.x, cy = 1.1, cz = z.root.position.z;
        const t = clamp(((cx - p.prev.x) * sx + (cy - p.prev.y) * sy + (cz - p.prev.z) * sz) / segLenSq, 0, 1);
        const qx = p.prev.x + sx * t - cx;
        const qy = p.prev.y + sy * t - cy;
        const qz = p.prev.z + sz * t - cz;
        if (qx * qx + qy * qy + qz * qz < 1.2 && t < bestT) { bestT = t; }
      }
      if (bestT <= 1) hitPos = p.prev.clone().addScaledVector(TMP_V1.set(sx, sy, sz), bestT);
    }
    if (!hitPos) {
      const sx = p.pos.x - p.prev.x, sy = p.pos.y - p.prev.y, sz = p.pos.z - p.prev.z;
      const segLenSq = sx * sx + sy * sy + sz * sz || 1;
      let bestT = 2;
      for (const prop of targetProps) {
        if (!prop.alive) continue;
        const cx = prop.root.position.x, cy = .5, cz = prop.root.position.z;
        const t = clamp(((cx - p.prev.x) * sx + (cy - p.prev.y) * sy + (cz - p.prev.z) * sz) / segLenSq, 0, 1);
        const qx = p.prev.x + sx * t - cx;
        const qy = p.prev.y + sy * t - cy;
        const qz = p.prev.z + sz * t - cz;
        if (qx * qx + qy * qy + qz * qz < 1.25 && t < bestT) { bestT = t; }
      }
      if (bestT <= 1) hitPos = p.prev.clone().addScaledVector(TMP_V1.set(sx, sy, sz), bestT);
    }
    if (hitPos || p.life <= 0) {
      explode(hitPos || p.pos.clone());
      scene.remove(p.mesh);
      state.projectiles.splice(i, 1);
    }
  }
}

function explode(point) {
  audio.explosion();
  state.shake = Math.max(state.shake, .8);
  state.flash = 1;
  const dist = point.distanceTo(camera.position);
  if (dist < 10) {
    dom.damageFlash.style.background = 'radial-gradient(ellipse at center, transparent 20%, rgba(255,180,95,.5) 100%)';
    dom.damageFlash.classList.add('on');
    setTimeout(() => {
      dom.damageFlash.classList.remove('on');
      dom.damageFlash.style.background = '';
    }, 130);
  }
  // fireball
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffcd82, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), flashMat);
  ball.position.copy(point);
  scene.add(ball);
  state.effects.push({ type: 'explosion', mesh: ball, life: .3, maxLife: .3, mats: [flashMat], scale: 1 });
  const light = new THREE.PointLight(0xffa34f, 55, 24, 2);
  light.position.copy(point).add(new THREE.Vector3(0, .8, 0));
  scene.add(light);
  state.effects.push({ type: 'light', mesh: light, light, life: .45, maxLife: .45, mats: [] });
  // ring
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb86c, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(GEO.ring, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(point).setY(.04);
  scene.add(ring);
  state.effects.push({ type: 'ring', mesh: ring, life: .6, maxLife: .6, mats: [ringMat], scale: 1 });
  burst(point, 36, 'spark', null, 2.8);
  burst(point, 18, 'smoke', null, 1.4);
  burst(point, 20, 'debris', null, 2.1);
  burst(point, 10, 'blood', null, 1.5);
  // damage enemies in radius
  const radius = 8.2;
  for (const z of [...state.enemies]) {
    const d = z.root.position.distanceTo(point);
    if (d < radius) {
      const dmg = (weapons.rpg.damage + 60) * clamp(1 - d / radius, .12, 1);
      const dir = z.root.position.clone().sub(point).setY(0).normalize();
      damageEnemy(z, dmg, d < 2.2 ? 'head' : 'body', z.root.position.clone().setY(1.2), dir, true);
    }
  }
  for (const prop of [...targetProps]) {
    const d = prop.root.position.distanceTo(point);
    if (prop.alive && d < radius) {
      hitProp(prop, prop.root.position.clone().setY(.5), prop.root.position.clone().sub(point).setY(0).normalize(), true);
    }
  }
  // player splash
  const pd = Math.hypot(player.pos.x - point.x, player.pos.z - point.z);
  if (pd < 5.4 && Math.abs(point.y - 1) < 3) {
    damagePlayer(Math.round(34 * (1 - pd / 5.4)), null);
  }
}

function startReload() {
  const w = weapons[currentWeapon];
  if (w.reloading || w.ammo >= w.mag) return;
  if (currentWeapon === 'rpg' && w.reserve <= 0) {
    addPickupToast('NO ROCKETS // CLEAR A WAVE');
    return;
  }
  w.reloading = true;
  w.reloadTimer = 0;
  audio.reload(0);
  setTimeout(() => { if (w.reloading) audio.reload(1); }, w.reloadTime * 500);
  dom.reloadBar.classList.add('on');
}

function updateWeapons(dt) {
  for (const key in weapons) {
    const w = weapons[key];
    w.cooldown = Math.max(0, w.cooldown - dt);
    if (w.reloading) {
      w.reloadTimer += dt;
      const p = clamp(w.reloadTimer / w.reloadTime, 0, 1);
      dom.reloadBar.querySelector('i').style.width = `${p * 100}%`;
      if (w.reloadTimer >= w.reloadTime) {
        if (key === 'ak') {
          w.ammo = w.mag;
        } else {
          const missing = w.mag - w.ammo;
          const load = Math.min(missing, w.reserve);
          w.ammo += load;
          w.reserve -= load;
          w.ammo = Math.min(w.ammo, w.mag);
        }
        w.reloading = false;
        dom.reloadBar.classList.remove('on');
        updateAmmoUI();
      }
    }
    // muzzle flash decay
    const group = viewmodelGroups[key];
    if (group.userData.flashTimer > 0) {
      group.userData.flashTimer -= dt;
      if (group.userData.flashTimer <= 0) {
        group.userData.flash.visible = false;
        group.userData.light.intensity = 0;
      } else {
        group.userData.light.intensity *= .65;
      }
    }
  }
  if (trigger && currentWeapon === 'ak') fireWeapon();
  if (weaponSwitchTimer > 0) weaponSwitchTimer -= dt;

  // viewmodel motion
  const activeGroup = viewmodelGroups[currentWeapon];
  const otherGroup = viewmodelGroups[currentWeapon === 'ak' ? 'rpg' : 'ak'];
  activeGroup.visible = true;
  otherGroup.visible = false;
  const w = weapons[currentWeapon];
  const ads = player.ads;
  const isAK = currentWeapon === 'ak';
  // Narrow phone screens have a much smaller horizontal FOV; shrink and
  // tuck the weapon into the lower-right safe area.
  const portrait = clamp((1.3333 - viewCamera.aspect) / (1.3333 - .46), 0, 1);
  const responsiveScale = isAK ? lerp(.55, .27, portrait) : lerp(.38, .22, portrait);
  activeGroup.scale.setScalar(responsiveScale);
  const hipX = isAK ? lerp(.20, .13, portrait) : lerp(.22, .14, portrait);
  const adsX = isAK ? lerp(.015, .01, portrait) : lerp(.08, .05, portrait);
  const base = isAK
    ? (ads ? new THREE.Vector3(adsX, -.06, -.82) : new THREE.Vector3(hipX, -.17, -1.0))
    : (ads ? new THREE.Vector3(adsX, -.10, -.92) : new THREE.Vector3(hipX, -.18, -1.05));
  const bobSpeed = player.sprint ? 8.4 : 6.2;
  const bobX = Math.sin(player.bobTime * bobSpeed) * .008 * player.moveAmount;
  const bobY = Math.abs(Math.cos(player.bobTime * bobSpeed)) * .009 * player.moveAmount;
  const swayX = clamp(player.vel.x * .0015, -.012, .012);
  const target = base.clone();
  target.x += bobX + swayX;
  target.y += bobY - Math.abs(w.kick) * .008;
  target.z += w.kick * (isAK ? .055 : .08);
  activeGroup.position.lerp(target, 1 - Math.exp(-dt * (ads ? 15 : 10)));
  activeGroup.rotation.x = damp(activeGroup.rotation.x, -w.kick * .06 - (ads ? 0 : .015), 12, dt);
  activeGroup.rotation.y = damp(activeGroup.rotation.y, ads ? 0 : (isAK ? .26 : .18) + bobX * .2, 12, dt);
  activeGroup.rotation.z = damp(activeGroup.rotation.z, ads ? 0 : -.05 + Math.sin(player.bobTime * bobSpeed * .5) * .008 * player.moveAmount, 12, dt);
  w.kick = damp(w.kick, 0, isAK ? 17 : 10, dt);
  if (weaponSwitchTimer > 0) {
    activeGroup.position.y -= .2 * (weaponSwitchTimer / .28);
  }
  // camera fov
  const targetFov = ads ? (isAK ? 57 : 53) : 71;
  camera.fov = damp(camera.fov, targetFov, 15, dt);
  camera.updateProjectionMatrix();
}

function switchWeapon(key) {
  if (!state.active || state.paused || state.over || key === currentWeapon) return;
  const old = weapons[currentWeapon];
  old.reloading = false;
  dom.reloadBar.classList.remove('on');
  currentWeapon = key;
  weaponSwitchTimer = .28;
  trigger = false;
  audio.click();
  updateAmmoUI();
  dom.weaponName.innerHTML = `<span id="weaponSlot">${weapons[key].slot}</span> ${weapons[key].name} <small>${weapons[key].type}</small>`;
  for (const btn of dom.weaponPips) btn.classList.toggle('active', btn.dataset.weapon === key);
}

function updateAmmoUI() {
  const w = weapons[currentWeapon];
  dom.ammoNum.textContent = w.ammo;
  dom.ammoReserve.textContent = currentWeapon === 'ak' ? '/ ∞' : `/ ${w.reserve}`;
  dom.ammoNum.style.color = w.ammo === 0 ? 'var(--rust)' : '';
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
function startWave(n) {
  state.wave = n;
  state.waveKills = 0;
  state.waveActive = true;
  state.betweenWaves = false;
  state.spawnRemaining = 5 + n * 3;
  state.waveTotal = state.spawnRemaining;
  state.waveRemaining = state.spawnRemaining;
  state.spawnTimer = .8;
  state.waveStartHealth = player.health;
  audio.wave();
  showBanner('INCOMING', `WAVE ${String(n).padStart(2, '0')}`, n === 1 ? 'HOLD THE LINE' : `${state.spawnRemaining} HOSTILES`);
  addKillFeedMessage(`WAVE ${String(n).padStart(2, '0')} // ${state.spawnRemaining} HOSTILES`);
}

function completeWave() {
  state.waveActive = false;
  state.betweenWaves = true;
  state.intermission = 6;
  const bonus = 250 * state.wave;
  state.score += bonus;
  player.health = Math.min(100, player.health + 25);
  weapons.ak.ammo = weapons.ak.mag;
  weapons.rpg.reserve = Math.min(10, weapons.rpg.reserve + 2);
  weapons.rpg.reloading = false;
  dom.reloadBar.classList.remove('on');
  updateAmmoUI();
  audio.victory();
  showBanner('SECTOR SECURED', 'WAVE CLEARED', `+${bonus} BONUS · +25 HP · +2 ROCKETS`);
  addPickupToast('WAVE BONUS // REARMED');
  addKillFeedMessage('WAVE CLEARED');
}

function updateMode(dt) {
  if (state.mode === 'zombie') {
    if (state.waveActive) {
      state.spawnTimer -= dt;
      if (state.spawnRemaining > 0 && state.spawnTimer <= 0 && state.enemies.length < 15) {
        spawnEnemy();
        state.spawnRemaining--;
        state.spawnTimer = Math.max(.18, .78 - state.wave * .035) * rand(.72, 1.35);
      }
      const remaining = state.enemies.length + state.spawnRemaining;
      state.waveRemaining = remaining;
      if (state.spawnRemaining <= 0 && state.enemies.length === 0 && state.waveActive) {
        completeWave();
      }
    } else if (state.betweenWaves) {
      state.intermission -= dt;
      if (state.intermission <= 0) {
        startWave(state.wave + 1);
      }
    }
  } else if (state.mode === 'prop') {
    state.timeLeft -= dt;
    state.scanCooldown = Math.max(0, state.scanCooldown - dt);
    state.scanTimer = Math.max(0, state.scanTimer - dt);
    if (state.timeLeft <= 0 && !state.over) {
      state.timeLeft = 0;
      endOperation(false, 'OUT OF TIME');
    }
  }
  // combo decay
  if (state.operationTime - state.lastKillTime > 3.2) state.killStreak = 0;
}

function useScan() {
  if (!state.active || state.paused || state.over || state.mode !== 'prop') return;
  if (state.scanCooldown > 0) {
    audio.dry();
    return;
  }
  state.scanCooldown = 10;
  state.scanTimer = 2.2;
  state.scanPulse = 1;
  audio.scan();
  for (const prop of targetProps) {
    if (!prop.alive || !prop.mimic) continue;
    prop.scanGlow = 2.2;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7fe7dc, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(GEO.ring, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(prop.root.position).setY(.04);
    ring.scale.setScalar(.4);
    scene.add(ring);
    state.effects.push({ type: 'scanRing', mesh: ring, life: 1.2, maxLife: 1.2, mats: [ringMat], basePos: prop.root.position.clone() });
  }
  addPickupToast('SONAR PING // 2.2s');
}

// ---------------------------------------------------------------------------
// Player controls
// ---------------------------------------------------------------------------
const keys = {};
const touchMove = { x: 0, y: 0, ads: false };
let touchAimId = null;
let lastTouch = { x: 0, y: 0 };
let stickId = null;
let stickCenter = { x: 0, y: 0 };

function updatePlayer(dt) {
  if (state.paused || state.over) return;
  let forward = 0, strafe = 0;
  if (keys['KeyW'] || keys['ArrowUp']) forward += 1;
  if (keys['KeyS'] || keys['ArrowDown']) forward -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) strafe += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) strafe -= 1;
  forward += -touchMove.y;
  strafe += touchMove.x;
  const len = Math.hypot(forward, strafe);
  if (len > 1) { forward /= len; strafe /= len; }
  player.sprint = (keys['ShiftLeft'] || keys['ShiftRight']) && forward > .3 && !player.ads;
  player.ads = !!(keys['MouseRight'] || touchMove.ads);
  const speed = player.ads ? 3.45 : player.sprint ? 7.9 : 5.25;

  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const wishX = (-sin * forward + cos * strafe) * speed;
  const wishZ = (-cos * forward - sin * strafe) * speed;
  player.vel.x = damp(player.vel.x, wishX, player.onGround ? 15 : 2.5, dt);
  player.vel.z = damp(player.vel.z, wishZ, player.onGround ? 15 : 2.5, dt);
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  resolveCircle(player.pos, player.radius);

  // jumping
  if ((keys['Space'] || keys['_jump']) && player.onGround) {
    player.vel.y = 5.3;
    player.onGround = false;
    keys['_jump'] = false;
    audio.click();
  }
  player.vel.y -= 18 * dt;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= 0) {
    if (!player.onGround && player.vel.y < -3) state.shake = Math.max(state.shake, .09);
    player.pos.y = 0;
    player.vel.y = 0;
    player.onGround = true;
  }

  const planar = Math.hypot(player.vel.x, player.vel.z);
  player.moveAmount = damp(player.moveAmount, clamp(planar / 7.9, 0, 1), 9, dt);
  if (planar > .4) {
    player.bobTime += dt;
    if (player.bobTime - player.step > (player.sprint ? .28 : .4)) {
      player.step = player.bobTime;
      if (player.onGround && Math.random() < .8) burst(player.pos.clone().add(new THREE.Vector3(rand(-.2, .2), .05, rand(-.2, .2))), 1, 'dust', null, .15);
    }
  }
  const bobAmp = player.ads ? .004 : .018;
  player.bob = damp(player.bob, Math.sin(player.bobTime * (player.sprint ? 10 : 7.3)) * bobAmp * player.moveAmount, 10, dt);
  camera.fov = damp(camera.fov, player.ads ? 58 : 71, 15, dt);
  camera.position.set(player.pos.x, player.pos.y + player.eye + player.bob + Math.abs(Math.sin(player.bobTime * 7.3)) * .013 * player.moveAmount, player.pos.z);
  if (state.operationTime - state.lastHitTime > 5.5 && player.health < 100) {
    player.health = Math.min(100, player.health + 6.5 * dt);
  }
}

function applyCameraMotion() {
  state.shake = Math.max(0, state.shake - 1 / 60 * 2.2);
  const sh = state.shake;
  const sx = (Math.random() - .5) * sh * .2;
  const sy = (Math.random() - .5) * sh * .18;
  const roll = (Math.random() - .5) * sh * .1;
  camera.rotation.set(player.pitch + sy, player.yaw + sx, roll + Math.sin(player.bobTime * 3.65) * .006 * player.moveAmount);
  camera.position.y += sy * .22;
  camera.position.x += sx * .18;
}

function addKillFeedMessage(message) {
  const el = document.createElement('div');
  el.className = 'kill-item';
  el.innerHTML = message;
  dom.killfeed.prepend(el);
  while (dom.killfeed.children.length > 5) dom.killfeed.lastChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3300);
}
function addKillFeed(kind, headshot, explosive) {
  const names = { walker: 'WALKER', runner: 'RUNNER', brute: 'BRUTE', mimic: 'MIMIC' };
  const el = document.createElement('div');
  el.className = `kill-item${headshot ? ' head' : ''}`;
  const verb = explosive ? 'OBLITERATED' : headshot ? 'HEADSHOT' : 'DOWNED';
  el.innerHTML = `YOU <span style="color:var(--rust)">▸</span> <b>${names[kind] || kind.toUpperCase()}</b> <span style="color:var(--dim)">${verb}</span>${headshot ? ' <span style="color:var(--rust)">HS</span>' : ''}`;
  dom.killfeed.prepend(el);
  while (dom.killfeed.children.length > 5) dom.killfeed.lastChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3700);
}
function addPickupToast(text) {
  dom.pickupToast.textContent = text;
  dom.pickupToast.classList.add('on');
  clearTimeout(addPickupToast.timer);
  addPickupToast.timer = setTimeout(() => dom.pickupToast.classList.remove('on'), 1800);
}

function showBanner(kicker, main, sub) {
  dom.banner.querySelector('.banner-kicker').textContent = kicker;
  dom.banner.querySelector('.banner-main').textContent = main;
  dom.banner.querySelector('.banner-sub').textContent = sub;
  dom.banner.classList.add('show');
  clearTimeout(showBanner.timer);
  showBanner.timer = setTimeout(() => dom.banner.classList.remove('show'), 2600);
}

function showHitmarker(kill = false) {
  dom.hitmarker.classList.remove('show', 'kill');
  void dom.hitmarker.offsetWidth;
  dom.hitmarker.classList.toggle('kill', kill);
  dom.hitmarker.classList.add('show');
}

function spawnDamageNumber(point, amount, head) {
  const el = document.createElement('div');
  el.className = `dmg-num${head ? ' head' : ''}`;
  el.textContent = head ? `${amount} HS` : amount;
  dom.worldLayer.appendChild(el);
  damageNumbers.push({ el, pos: point.clone().add(new THREE.Vector3(0, .2, 0)), life: .55 });
}

function updateDamageNumbers(dt) {
  for (let i = damageNumbers.length - 1; i >= 0; i--) {
    const d = damageNumbers[i];
    d.life -= dt;
    if (d.life <= 0) {
      d.el.remove();
      damageNumbers.splice(i, 1);
      continue;
    }
    const p = d.pos.clone().project(camera);
    if (p.z > 1 || p.z < -1) { d.el.style.opacity = 0; continue; }
    d.el.style.left = `${(p.x * .5 + .5) * innerWidth}px`;
    d.el.style.top = `${(-p.y * .5 + .5) * innerHeight}px`;
    d.el.style.opacity = clamp(d.life / .35, 0, 1);
  }
}

// ---------------------------------------------------------------------------
// Start / end / pause
// ---------------------------------------------------------------------------
function resetPlayer() {
  player.pos.set(0, 0, 18.6);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = -.035;
  player.health = 100;
  player.onGround = true;
  player.bob = 0;
  player.bobTime = 0;
  player.moveAmount = 0;
  player.ads = false;
  state.shake = 0;
  state.flash = 0;
  camera.fov = 71;
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.position.set(player.pos.x, player.eye, player.pos.z);
  keys['Space'] = false;
}

function resetWeapons() {
  weapons.ak.ammo = 30;
  weapons.ak.reloading = false;
  weapons.ak.cooldown = 0;
  weapons.ak.reloadTimer = 0;
  weapons.ak.kick = 0;
  weapons.rpg.ammo = 1;
  weapons.rpg.reserve = 6;
  weapons.rpg.reloading = false;
  weapons.rpg.cooldown = 0;
  weapons.rpg.reloadTimer = 0;
  weapons.rpg.kick = 0;
  currentWeapon = 'ak';
  weaponSwitchTimer = 0;
  trigger = false;
  dom.reloadBar.classList.remove('on');
  dom.weaponName.innerHTML = `<span id="weaponSlot">01</span> AK-47 <small>ASSAULT RIFLE</small>`;
  for (const btn of dom.weaponPips) btn.classList.toggle('active', btn.dataset.weapon === 'ak');
  updateAmmoUI();
}

function deploy() {
  if (state.active) return;
  audio.init();
  audio.click();
  state.selectedMode = state.selectedMode || 'zombie';
  state.mode = state.selectedMode;
  state.active = true;
  state.paused = false;
  state.over = false;
  menuIdle = false;
  menuFrames = 0;
  state.score = 0;
  state.kills = 0;
  state.headshots = 0;
  state.shots = 0;
  state.hits = 0;
  state.wave = 0;
  state.waveKills = 0;
  state.waveTotal = 0;
  state.waveRemaining = 0;
  state.spawnRemaining = 0;
  state.waveActive = false;
  state.betweenWaves = false;
  state.intermission = 0;
  state.operationTime = 0;
  state.timeLeft = 95;
  state.mimicsTotal = 8;
  state.mimicsLeft = 8;
  state.scanCooldown = 0;
  state.scanTimer = 0;
  state.scanPulse = 0;
  state.killStreak = 0;
  state.lastKillTime = -10;
  state.lastHitTime = 0;
  state.enemyCheckTimer = 0;
  state.crosshairEnemy = false;
  clearDynamicWorld();
  resetPlayer();
  resetWeapons();
  dom.menu.classList.add('out');
  dom.hud.classList.remove('hidden');
  dom.pause.classList.add('hidden');
  dom.end.classList.add('hidden');
  dom.hud.classList.toggle('mobile', IS_TOUCH);
  dom.touch.classList.toggle('hidden', !IS_TOUCH);
  dom.mouseHint.classList.toggle('on', !IS_TOUCH);
  dom.banner.classList.remove('show');
  if (state.mode === 'zombie') {
    weapons.rpg.reserve = 6;
    startWave(1);
    dom.hintBar.innerHTML = '<kbd>R</kbd> RELOAD <span>·</span> <kbd>1</kbd><kbd>2</kbd> WEAPONS <span>·</span> <kbd>SPACE</kbd> JUMP <span>·</span> <kbd>ESC</kbd> PAUSE';
  } else {
    setupPropMode();
    showBanner('OPERATION 02', 'PROP HUNT', '8 MIMICS · 95 SECONDS');
    addKillFeedMessage('TRUST NOTHING');
    dom.hintBar.innerHTML = '<kbd>Q</kbd> SONAR PING <span>·</span> <kbd>R</kbd> RELOAD <span>·</span> <kbd>1</kbd><kbd>2</kbd> WEAPONS <span>·</span> <kbd>ESC</kbd> PAUSE';
  }
  dom.transition.classList.remove('flash');
  void dom.transition.offsetWidth;
  dom.transition.classList.add('flash');
  if (!IS_TOUCH) {
    try { dom.canvas.requestPointerLock(); } catch { /* pointer lock can be rejected by the host */ }
  }
  updateHUD(0);
  updateAmmoUI();
}

function requestMouseCapture() {
  if (!IS_TOUCH && state.active && !state.paused && !state.over && document.pointerLockElement !== dom.canvas) {
    try { dom.canvas.requestPointerLock(); } catch { /* noop */ }
  }
}

function pauseGame() {
  if (!state.active || state.over || state.paused) return;
  state.paused = true;
  trigger = false;
  dom.pause.classList.remove('hidden');
  dom.pauseScore.textContent = Math.round(state.score);
  dom.pauseKills.textContent = state.kills;
  dom.pauseAcc.textContent = `${state.shots ? Math.round(state.hits / state.shots * 100) : 0}%`;
  if (document.pointerLockElement) document.exitPointerLock();
  audio.click();
}

function resumeGame() {
  if (!state.active || state.over) return;
  dom.pause.classList.add('hidden');
  state.paused = false;
  audio.click();
  if (!IS_TOUCH) requestMouseCapture();
}

function quitToMenu() {
  state.active = false;
  state.paused = false;
  state.over = false;
  trigger = false;
  menuIdle = false;
  menuFrames = 0;
  if (document.pointerLockElement) document.exitPointerLock();
  dom.pause.classList.add('hidden');
  dom.end.classList.add('hidden');
  dom.hud.classList.add('hidden');
  dom.touch.classList.add('hidden');
  dom.menu.classList.remove('out');
  dom.mouseHint.classList.remove('on');
  clearDynamicWorld();
  camera.fov = 61;
  camera.updateProjectionMatrix();
  audio.click();
}

function endOperation(victory, reason = '') {
  if (state.over) return;
  state.over = true;
  state.active = false;
  trigger = false;
  if (document.pointerLockElement) document.exitPointerLock();
  dom.touch.classList.add('hidden');
  dom.hud.classList.add('hidden');
  dom.pause.classList.add('hidden');
  const time = state.operationTime;
  const acc = state.shots ? Math.round(state.hits / state.shots * 100) : 0;
  dom.endKicker.textContent = victory ? 'OPERATION COMPLETE' : 'OPERATION FAILED';
  dom.endKicker.style.color = victory ? 'var(--acid)' : 'var(--rust)';
  dom.endTitle.textContent = victory ? (state.mode === 'prop' ? 'HUNTED' : 'SURVIVED') : (state.mode === 'prop' ? 'TIME UP' : 'K.I.A.');
  dom.endText.textContent = victory
    ? (state.mode === 'prop' ? 'Every prop was a liar. Every liar is down.' : 'The horde broke against you. For now.')
    : (reason || 'The dust keeps what it takes.');
  const grade = victory ? (state.mode === 'prop' ? (time > 45 ? 'A' : 'B') : state.wave >= 8 ? 'S' : state.wave >= 5 ? 'A' : state.wave >= 3 ? 'B' : 'C') : state.mode === 'prop' ? 'D' : 'F';
  dom.endGrade.textContent = grade;
  dom.endScore.textContent = Math.round(state.score);
  dom.endKills.textContent = state.kills;
  dom.endHs.textContent = state.headshots;
  dom.endAcc.textContent = `${acc}%`;
  dom.endWave.textContent = state.mode === 'zombie' ? state.wave : `${state.mimicsTotal - state.mimicsLeft}/${state.mimicsTotal}`;
  dom.endTime.textContent = formatTime(time);
  dom.end.classList.remove('hidden');
  if (victory) audio.victory(); else audio.defeat();
}

function redeploy() {
  dom.end.classList.add('hidden');
  state.over = false;
  state.active = false;
  deploy();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function setText(node, value) {
  if (node.__last === value) return;
  node.__last = value;
  node.textContent = value;
}

function updateHUD() {
  const hp = clamp(player.health, 0, 100);
  dom.healthFill.style.transform = `scaleX(${hp / 100})`;
  setText(dom.healthNum, String(Math.ceil(hp)));
  setText(dom.healthState, hp > 65 ? 'STABLE' : hp > 30 ? 'WOUNDED' : 'CRITICAL');
  dom.healthState.style.color = hp > 65 ? 'var(--acid)' : hp > 30 ? '#ffc15e' : 'var(--rust)';
  dom.healthNum.style.color = hp > 30 ? '' : 'var(--rust)';
  dom.lowHealth.classList.toggle('on', hp < 35 && state.active);
  setText(dom.scoreNum, formatScore(state.score));
  setText(dom.killNum, String(state.kills));
  setText(dom.hsNum, String(state.headshots).padStart(2, '0'));

  if (state.mode === 'zombie') {
    setText(dom.objectiveKicker, 'WAVE DEFENSE');
    setText(dom.objectiveClock, state.betweenWaves ? `NEXT ${Math.ceil(state.intermission)}s` : 'LIVE');
    setText(dom.objectiveMain, state.betweenWaves ? 'WAVE CLEARED' : `WAVE ${String(Math.max(1, state.wave)).padStart(2, '0')}`);
    const hostiles = state.waveActive ? state.enemies.length + state.spawnRemaining : 0;
    setText(dom.objectiveSub, state.betweenWaves ? 'REARMING' : `${hostiles} HOSTILES REMAINING`);
    const p = state.waveTotal ? (1 - hostiles / state.waveTotal) * 100 : 0;
    dom.objectiveTrack.style.width = `${clamp(p, 0, 100)}%`;
    dom.objectiveTrack.style.background = 'var(--rust)';
    const nearest = state.enemies.length ? Math.min(...state.enemies.map(e => e.root.position.distanceTo(player.pos))) : 0;
    dom.radarDist.textContent = `RANGE ${Math.round(Math.min(24, nearest))}M`;
  } else {
    setText(dom.objectiveKicker, 'PROP HUNT');
    setText(dom.objectiveClock, formatTime(state.timeLeft));
    setText(dom.objectiveMain, `${state.mimicsLeft} MIMICS`);
    setText(dom.objectiveSub, `${state.mimicsTotal - state.mimicsLeft}/${state.mimicsTotal} NEUTRALISED`);
    dom.objectiveTrack.style.width = `${(1 - state.mimicsLeft / state.mimicsTotal) * 100}%`;
    dom.objectiveTrack.style.background = 'var(--cyan)';
    setText(dom.radarDist, 'RANGE 24M');
    dom.objectiveClock.style.color = state.timeLeft < 20 ? 'var(--rust)' : '';
  }

  const w = weapons[currentWeapon];
  setText(dom.ammoNum, String(w.ammo).padStart(2, '0'));
  setText(dom.ammoReserve, currentWeapon === 'ak' ? '/ ∞' : `/ ${w.reserve}`);
  dom.ammoNum.style.color = w.ammo <= 3 && currentWeapon === 'rpg' ? 'var(--rust)' : '';

  const spread = getShotSpread();
  dom.crosshair.style.setProperty('--gap', `${5 + spread * 1350 + player.moveAmount * 6}px`);
  dom.crosshair.classList.toggle('enemy', state.crosshairEnemy);
  dom.crosshair.classList.toggle('ads', player.ads);
  dom.crosshair.style.opacity = state.paused ? 0 : 1;

  if (state.mode === 'prop') {
    const ready = state.scanCooldown <= 0;
    const pct = ready ? 1 : 1 - state.scanCooldown / 10;
    dom.scanFill.style.transform = `scaleX(${pct})`;
    dom.scanFill.style.background = ready ? 'var(--cyan)' : 'var(--dim)';
    dom.chargeLabel.textContent = state.scanTimer > 0 ? 'SONAR ACTIVE' : ready ? 'SCAN READY' : `RECHARGE ${Math.ceil(state.scanCooldown)}s`;
    dom.chargeLabel.parentElement.classList.toggle('ready', ready);
    dom.scanKey.textContent = 'Q';
  } else {
    dom.scanFill.style.transform = 'scaleX(0)';
    dom.chargeLabel.textContent = 'SONAR // PROP HUNT ONLY';
    dom.scanKey.textContent = '—';
    dom.chargeLabel.parentElement.classList.remove('ready');
  }
  dom.scanFill.style.opacity = state.scanCooldown > 9.7 ? .3 : 1;

  if (w.reloading) {
    dom.reloadBar.classList.add('on');
    dom.reloadBar.querySelector('i').style.width = `${clamp(w.reloadTimer / w.reloadTime, 0, 1) * 100}%`;
  }
  if (!IS_TOUCH && state.active && !state.paused) {
    dom.mouseHint.classList.toggle('on', document.pointerLockElement !== dom.canvas);
  } else {
    dom.mouseHint.classList.remove('on');
  }
}

function drawRadar() {
  const ctx = dom.radar.getContext('2d');
  const W = dom.radar.width, H = dom.radar.height;
  ctx.clearRect(0, 0, W, H);
  const grd = ctx.createRadialGradient(W / 2, H / 2, 4, W / 2, H / 2, W / 2);
  grd.addColorStop(0, 'rgba(27,22,16,.88)');
  grd.addColorStop(1, 'rgba(10,8,5,.8)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  const scale = (W - 18) / (ARENA * 2 + 2);
  const cx = W / 2, cy = H / 2;
  const mapX = (x) => cx + x * scale;
  const mapY = (z) => cy + z * scale;
  ctx.strokeStyle = 'rgba(180,200,170,.09)';
  ctx.lineWidth = 1;
  for (let r = 1; r < 4; r++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (W / 2 - 5) * r / 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx, 4); ctx.lineTo(cx, H - 4);
  ctx.moveTo(4, cy); ctx.lineTo(W - 4, cy);
  ctx.stroke();
  ctx.fillStyle = 'rgba(167,144,112,.22)';
  for (const c of COLLIDERS) {
    if (c.w > 60 || c.d > 60) continue;
    ctx.fillRect(mapX(c.minX), mapY(c.minZ), c.w * scale, c.d * scale);
  }
  if (state.mode === 'zombie') {
    ctx.fillStyle = '#ff4a2a';
    for (const z of state.enemies) {
      if (z.root.position.distanceTo(player.pos) > 30) continue;
      ctx.beginPath();
      ctx.arc(mapX(z.root.position.x), mapY(z.root.position.z), z.kind === 'brute' ? 3.2 : 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (const p of targetProps) {
      if (!p.mimic) continue;
      if (p.scanGlow <= 0 && state.scanTimer <= 0) continue;
      ctx.strokeStyle = p.scanGlow > 0 ? '#7fe7dc' : 'rgba(127,231,220,.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mapX(p.root.position.x), mapY(p.root.position.z), 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.save();
  ctx.translate(mapX(player.pos.x), mapY(player.pos.z));
  ctx.rotate(-player.yaw);
  ctx.fillStyle = '#d5f25c';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 5);
  ctx.lineTo(0, 2.5);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const t = (state.operationTime * .55) % (Math.PI * 2);
  const sweep = ctx.createLinearGradient(cx, cy, cx + Math.cos(t) * W, cy + Math.sin(t) * W);
  sweep.addColorStop(0, 'rgba(213,242,92,.13)');
  sweep.addColorStop(1, 'rgba(213,242,92,0)');
  ctx.fillStyle = sweep;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, W / 2, t - .25, t + .05);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Effects / ambient animation
// ---------------------------------------------------------------------------
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      if (p.mesh.material) p.mesh.material.dispose();
      if (p.mesh.geometry && p.disposeGeo) p.mesh.geometry.dispose();
      particles.splice(i, 1);
      continue;
    }
    p.vel.y += p.gravity * dt;
    p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.rotation.x += p.spin.x * dt;
    p.mesh.rotation.y += p.spin.y * dt;
    p.mesh.rotation.z += p.spin.z * dt;
    if (p.mesh.position.y < p.floor) {
      p.mesh.position.y = p.floor;
      if (p.bounce > 0) {
        p.vel.y = Math.abs(p.vel.y) * p.bounce;
        p.vel.x *= .7;
        p.vel.z *= .7;
        p.spin.multiplyScalar(.65);
      } else {
        p.vel.y = 0;
        p.vel.x *= .72;
        p.vel.z *= .72;
      }
    }
    if (p.grow) {
      const s = 1 + p.grow * (1 - p.life / p.maxLife);
      p.mesh.scale.setScalar(s * p.baseScale);
    }
    if (p.fade && p.mesh.material) p.mesh.material.opacity = clamp(p.life / p.maxLife, 0, 1) * (p.mesh.material.userData?.baseOpacity || 1);
  }
  // point light flicker on fire / beacon
  for (const e of ambientEmitters) {
    if (e.type === 'fire') {
      const flicker = .7 + Math.sin(performance.now() * .017 + 2) * .12 + Math.random() * .15;
      e.light.intensity = 6.5 * flicker;
      const fire = e.obj.getObjectByName('fire');
      if (fire) {
        fire.scale.set(1 + Math.sin(performance.now() * .022) * .15, .85 + Math.random() * .35, 1 + Math.cos(performance.now() * .019) * .12);
        fire.rotation.y += dt * 2;
      }
      e.timer -= dt;
      if (e.timer <= 0) {
        e.timer = .14 + Math.random() * .16;
        const p = new THREE.Vector3();
        e.obj.getWorldPosition(p);
        p.y = 1.65;
        const smoke = new THREE.Mesh(GEO.box, new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(.06, .15, rand(.1, .22)), transparent: true, opacity: .28, depthWrite: false }));
        smoke.scale.setScalar(rand(.08, .2));
        smoke.position.copy(p).add(new THREE.Vector3(rand(-.1, .1), 0, rand(-.1, .1)));
        addParticle(smoke, new THREE.Vector3(rand(-.15, .15), rand(.5, 1.1), rand(-.15, .15)), { gravity: .2, drag: .4, life: rand(1.6, 2.8), spin: 1.5, fade: true, grow: .8 });
      }
    } else if (e.type === 'beacon') {
      const t = performance.now() * .002;
      const on = (t % 2.4) < .18;
      e.light.intensity = on ? 6 : .3;
      e.mesh.material.color.setHex(on ? 0xff3322 : 0x47100d);
    }
  }
}

function updateEffects(dt) {
  for (let i = state.effects.length - 1; i >= 0; i--) {
    const e = state.effects[i];
    e.life -= dt;
    const t = clamp(e.life / e.maxLife, 0, 1);
    if (e.type === 'tracer') {
      e.mats[0].opacity = t * .5;
    } else if (e.type === 'explosion') {
      e.mesh.scale.setScalar(1 + (1 - t) * 2.6);
      e.mats[0].opacity = t * .95;
    } else if (e.type === 'light') {
      e.light.intensity = 55 * Math.pow(t, 2.4);
    } else if (e.type === 'ring') {
      e.mesh.scale.setScalar(1 + (1 - t) * 9);
      e.mats[0].opacity = t * .85;
    } else if (e.type === 'scanRing') {
      e.mesh.scale.setScalar(.4 + (1 - t) * 2.4);
      e.mats[0].opacity = t * .9;
    }
    if (e.life <= 0) {
      scene.remove(e.mesh);
      e.mats.forEach(m => m.dispose());
      if (e.geo) e.geo.dispose();
      state.effects.splice(i, 1);
    }
  }
}

function updateDecals(dt) {
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    d.life -= dt;
    if (d.life < 3) d.mesh.material.opacity = clamp(d.life / 3, 0, 1) * .6;
    if (d.life <= 0) {
      scene.remove(d.mesh);
      d.mesh.material.dispose();
      decals.splice(i, 1);
    }
  }
}

// Menu camera orbit and world ambience
let menuAngle = 0;
function updateMenuCamera(dt) {
  state.menuTime += dt;
  menuAngle += dt * .035;
  const t = menuAngle + .6;
  const radius = 25 + Math.sin(menuAngle * .8) * 1.4;
  const height = 6.7 + Math.sin(menuAngle * .55) * 1.05;
  camera.position.set(Math.cos(t) * radius, height, Math.sin(t) * radius);
  const look = new THREE.Vector3(Math.cos(t + .9) * 3.4, 2.15 + Math.sin(menuAngle * .3) * .25, Math.sin(t + .9) * 3.4);
  camera.lookAt(look);
  camera.fov = damp(camera.fov, 59, 2, dt);
  camera.updateProjectionMatrix();
}

function updateDust(dt) {
  const dust = mapDecorRoot?.userData.dust;
  if (!dust) return;
  const pos = dust.geometry.attributes.position;
  const time = performance.now() * .001;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) + dt * (.35 + (i % 5) * .03);
    let y = pos.getY(i) + Math.sin(time * .55 + i) * dt * .04;
    if (x > 32) x = -32;
    pos.setX(i, x);
    if (y > 8.5) y = .3;
    if (y < .2) y = 8;
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
}

function updateBirds(dt) {
  if (!mapDecorRoot) return;
  for (const obj of mapDecorRoot.children) {
    if (!obj.userData.radius) continue;
    obj.userData.angle += dt * obj.userData.speed;
    const a = obj.userData.angle;
    obj.position.set(Math.cos(a) * obj.userData.radius, 11.8 + Math.sin(a * 2 + obj.userData.phase) * 1.1, Math.sin(a) * obj.userData.radius);
    obj.rotation.y = -a + Math.PI / 2;
    const flap = Math.sin(performance.now() * .006 + obj.userData.phase) * .45;
    const l = obj.getObjectByName('wingL');
    const r = obj.getObjectByName('wingR');
    if (l) l.rotation.z = flap;
    if (r) r.rotation.z = -flap;
  }
}

function updateCrosshairTarget() {
  if (!state.active || state.paused || state.over) return;
  if (state.mode !== 'zombie') { state.crosshairEnemy = false; return; }
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycasterCandidates.length = 0;
  raycasterCandidates.push(worldRoot);
  for (const z of state.enemies) raycasterCandidates.push(z.root);
  const found = firstGameplayHit(raycaster.intersectObjects(raycasterCandidates, true));
  state.crosshairEnemy = !!(found && found.enemy);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const modeBriefs = {
  zombie: {
    title: 'THE HORDE<br>DOESN\'T STOP.',
    text: 'Survive escalating waves of the infected. Headshots pay double. When it gets loud, introduce them to the RPG.',
    tags: ['ENDLESS', 'HEADSHOTS', 'RAGDOLLS'],
    note: 'WAVE DEFENSE // ARENA LOCKED'
  },
  prop: {
    title: 'TRUST<br>NOTHING.',
    text: 'Eight shape-shifting mimics are wearing the scenery. Shoot every liar before the clock runs out. Decoys cost you four seconds.',
    tags: ['8 MIMICS', 'SONAR', '95 SECONDS'],
    note: 'PROP HUNT // SHAPESHIFTERS ACTIVE'
  }
};

function selectMode(mode, silent = false) {
  state.selectedMode = mode;
  for (const card of dom.modeCards) {
    const on = card.dataset.mode === mode;
    card.classList.toggle('selected', on);
    card.setAttribute('aria-checked', String(on));
  }
  const brief = modeBriefs[mode];
  dom.briefTitle.innerHTML = brief.title;
  dom.briefText.textContent = brief.text;
  dom.briefTags.innerHTML = brief.tags.map(t => `<span>${t}</span>`).join('');
  dom.modeNote.textContent = brief.note;
  if (!silent) {
    audio.init();
    audio.click();
  }
}

for (const card of dom.modeCards) {
  card.addEventListener('click', () => selectMode(card.dataset.mode));
}
dom.playBtn.addEventListener('click', () => deploy());
dom.resumeBtn.addEventListener('click', () => resumeGame());
dom.restartBtn.addEventListener('click', () => {
  dom.pause.classList.add('hidden');
  state.over = false;
  state.active = false;
  deploy();
});
dom.quitBtn.addEventListener('click', () => quitToMenu());
dom.retryBtn.addEventListener('click', () => redeploy());
dom.menuBtn.addEventListener('click', () => quitToMenu());

document.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && state.active) e.preventDefault();
  if (e.code === 'Escape') {
    if (state.paused) resumeGame(); else if (state.active && !state.over) pauseGame();
    return;
  }
  if (!state.active || state.paused || state.over) return;
  keys[e.code] = true;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Digit1') switchWeapon('ak');
  if (e.code === 'Digit2') switchWeapon('rpg');
  if (e.code === 'KeyQ') useScan();
  if (e.code === 'Space') keys['_jump'] = true;
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  trigger = false;
});

dom.canvas.addEventListener('mousedown', (e) => {
  audio.init();
  if (!state.active || state.paused || state.over) return;
  if (!IS_TOUCH && document.pointerLockElement !== dom.canvas) {
    requestMouseCapture();
    return;
  }
  if (e.button === 0) {
    trigger = true;
    fireWeapon();
  } else if (e.button === 2) {
    keys['MouseRight'] = true;
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) trigger = false;
  if (e.button === 2) keys['MouseRight'] = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (!state.active || state.paused || state.over || document.pointerLockElement !== dom.canvas) return;
  const sens = player.ads ? .00135 : .0022;
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  player.pitch = clamp(player.pitch, -1.42, 1.35);
  player.yaw = ((player.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === dom.canvas) {
    dom.mouseHint.classList.remove('on');
  } else if (state.active && !state.paused && !state.over && !IS_TOUCH) {
    pauseGame();
  }
});

for (const btn of dom.weaponPips) {
  btn.addEventListener('click', () => switchWeapon(btn.dataset.weapon));
}
for (const id of ['touchJump', 'touchReload', 'touchSwap', 'touchScan', 'touchPause']) {
  dom[id].addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (id === 'touchJump') keys['_jump'] = true;
    if (id === 'touchReload') startReload();
    if (id === 'touchSwap') switchWeapon(currentWeapon === 'ak' ? 'rpg' : 'ak');
    if (id === 'touchScan') useScan();
    if (id === 'touchPause') { if (state.paused) resumeGame(); else pauseGame(); }
  });
}
function stopTouchFire(e) {
  e?.preventDefault();
  trigger = false;
  dom.touchFire.classList.remove('active');
}
dom.touchFire.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!state.active || state.paused) return;
  trigger = true;
  fireWeapon();
  dom.touchFire.classList.add('active');
});
dom.touchFire.addEventListener('pointerup', stopTouchFire);
dom.touchFire.addEventListener('pointercancel', stopTouchFire);
dom.touchFire.addEventListener('pointerleave', stopTouchFire);

function startStick(e) {
  e.preventDefault();
  e.stopPropagation();
  stickId = e.pointerId;
  const rect = dom.stick.getBoundingClientRect();
  stickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  dom.stick.setPointerCapture(e.pointerId);
}
function moveStick(e) {
  if (e.pointerId !== stickId) return;
  const dx = e.clientX - stickCenter.x;
  const dy = e.clientY - stickCenter.y;
  const max = 44;
  const len = Math.hypot(dx, dy);
  const nx = len > max ? dx / len * max : dx;
  const ny = len > max ? dy / len * max : dy;
  touchMove.x = nx / max;
  touchMove.y = ny / max;
  dom.stickKnob.style.transform = `translate(${nx}px, ${ny}px)`;
}
function endStick(e) {
  if (e.pointerId !== stickId) return;
  stickId = null;
  touchMove.x = 0;
  touchMove.y = 0;
  dom.stickKnob.style.transform = 'translate(0px, 0px)';
}
dom.stick.addEventListener('pointerdown', startStick);
dom.stick.addEventListener('pointermove', moveStick);
dom.stick.addEventListener('pointerup', endStick);
dom.stick.addEventListener('pointercancel', endStick);

let touchAdsId = null;
dom.touchAim.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  touchAdsId = e.pointerId;
  touchMove.ads = true;
  dom.touchAim.setPointerCapture(e.pointerId);
});
const stopAds = (e) => {
  if (touchAdsId !== null && e.pointerId !== touchAdsId) return;
  touchAdsId = null;
  touchMove.ads = false;
};
dom.touchAim.addEventListener('pointerup', stopAds);
dom.touchAim.addEventListener('pointercancel', stopAds);

dom.canvas.addEventListener('pointerdown', (e) => {
  if (!IS_TOUCH || !state.active || state.paused || state.over) return;
  if (e.pointerType === 'mouse') return;
  touchAimId = e.pointerId;
  lastTouch.x = e.clientX;
  lastTouch.y = e.clientY;
});
dom.canvas.addEventListener('pointermove', (e) => {
  if (!IS_TOUCH || e.pointerId !== touchAimId || !state.active || state.paused) return;
  const dx = e.clientX - lastTouch.x;
  const dy = e.clientY - lastTouch.y;
  lastTouch.x = e.clientX;
  lastTouch.y = e.clientY;
  player.yaw -= dx * .0042;
  player.pitch = clamp(player.pitch - dy * .0042, -1.42, 1.35);
});
const endAim = (e) => { if (e.pointerId === touchAimId) touchAimId = null; };
dom.canvas.addEventListener('pointerup', endAim);
dom.canvas.addEventListener('pointercancel', endAim);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  viewCamera.aspect = camera.aspect;
  viewCamera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, IS_TOUCH ? 1.25 : 1.5));
  renderer.setSize(innerWidth, innerHeight);
  if (!state.active && !state.over) { menuIdle = false; menuFrames = 0; }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.active && !state.paused && !state.over) pauseGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const bootT0 = performance.now();
buildWorld();
const bootT1 = performance.now();
mergeStaticWorld();
const bootT2 = performance.now();
viewRoot.visible = false;
camera.position.set(25, 7, 24);
camera.fov = 59;
camera.updateProjectionMatrix();
selectMode('zombie', true);
let firstFrameLogged = false;
let menuIdle = false;
let menuFrames = 0;
let radarTimer = 0;
let targetTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  if (menuIdle) return;
  const dt = Math.min(clock.getDelta(), .05);
  const activePlay = state.active && !state.paused && !state.over;
  if (activePlay) {
    state.operationTime += dt;
    updatePlayer(dt);
    updateWeapons(dt);
    updateEnemies(dt);
    updateProps(dt);
    updateProjectiles(dt);
    updateMode(dt);
    applyCameraMotion();
    updateHUD();
    updateDamageNumbers(dt);
    state.enemyCheckTimer -= dt;
    targetTimer -= dt;
    if (state.enemyCheckTimer <= 0) {
      state.enemyCheckTimer = .09;
      updateCrosshairTarget();
    }
    radarTimer -= dt;
    if (radarTimer <= 0) { radarTimer = .1; drawRadar(); }
  } else if (!state.active && !state.over) {
    updateMenuCamera(dt);
    viewRoot.visible = false;
  } else if (state.paused) {
    // keep the scene alive behind the pause card, but freeze gameplay
  }
  updateAmbient(dt);
  updateParticles(dt);
  updateCorpses(dt);
  updateEffects(dt);
  updateDecals(dt);
  updateDust(dt);
  updateBirds(dt);
  if (activePlay) viewRoot.visible = true;
  if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 3);
  renderer.render(scene, camera);
  if (!firstFrameLogged) {
    firstFrameLogged = true;
    console.info(`[boot] build=${Math.round(bootT1-bootT0)}ms merge=${Math.round(bootT2-bootT1)}ms firstFrame=${Math.round(performance.now()-bootT0)}ms programs=${renderer.info.programs?.length} calls=${renderer.info.render.calls}`);
  }
  if (viewRoot.visible) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(viewScene, viewCamera);
    renderer.autoClear = true;
  }
  if (!state.active && !state.over) {
    menuFrames++;
    // Freeze the menu diorama after one presented frame. Keeping a heavy
    // WebGL render loop alive here makes the menu feel unresponsive on slow
    // software renderers and blocks automated start clicks.
    if (menuFrames >= 1) menuIdle = true;
  }
}

function updateAmbient(dt) {
  // tiny camera drift on menu is handled above; nothing else here yet.
}

// Expose a tiny debug hook for automated capture and manual QA.
window.DEAD_DROP = {
  get state() { return state; },
  get player() { return player; },
  get renderer() { return renderer; },
  get THREE() { return THREE; },
  get scene() { return scene; },
  get camera() { return camera; },
  get viewScene() { return viewScene; },
  get viewCamera() { return viewCamera; },
  get viewRoot() { return viewRoot; },
  get viewmodelGroups() { return viewmodelGroups; },
  get currentWeapon() { return currentWeapon; },
  get corpses() { return corpses; },
  get targetProps() { return targetProps; },
  get menuIdle() { return menuIdle; },
  start(mode = 'zombie') { state.selectedMode = mode; selectMode(mode, true); deploy(); },
  spawnEnemy,
  damageEnemy,
  fireWeapon,
  switchWeapon,
  endOperation,
  useScan
};

// Compile every world/viewmodel program up front. On software renderers the
// lazy per-frame shader compilation otherwise stalls input for ~30 seconds.
renderer.compile(scene, camera);
renderer.compile(viewScene, viewCamera);

animate();


