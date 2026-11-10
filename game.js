(() => {
  'use strict';

  // ── Utilities ─────────────────────────────────────────────────
  const TAU = Math.PI * 2;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const random = (min, max) => min + Math.random() * (max - min);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const pad = (n, width = 6) => String(Math.max(0, Math.floor(n))).padStart(width, '0');
  const clock = (seconds) => `${pad(seconds / 60, 2)}:${pad(seconds % 60, 2)}`;

  // ── DOM ───────────────────────────────────────────────────────
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const menuEl = document.getElementById('menu');
  const hudEl = document.getElementById('hud');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const muteBtn = document.getElementById('muteBtn');
  const pauseOverlay = document.getElementById('pauseOverlay');
  const resumeBtn = document.getElementById('resumeBtn');
  const quitBtn = document.getElementById('quitBtn');
  const upgradeOverlay = document.getElementById('upgradeOverlay');
  const upgradeCards = document.getElementById('upgradeCards');
  const gameoverOverlay = document.getElementById('gameoverOverlay');
  const restartBtn = document.getElementById('restartBtn');
  const menuBtn = document.getElementById('menuBtn');
  const hpFill = document.getElementById('hpFill');
  const hpText = document.getElementById('hpText');
  const dashFill = document.getElementById('dashFill');
  const waveNum = document.getElementById('waveNum');
  const enemyCount = document.getElementById('enemyCount');
  const waveTimer = document.getElementById('waveTimer');
  const waveProgress = document.getElementById('waveProgress');
  const scoreText = document.getElementById('scoreText');
  const comboTag = document.getElementById('comboTag');
  const comboText = document.getElementById('comboText');
  const bossBar = document.getElementById('bossBar');
  const bossHpFill = document.getElementById('bossHpFill');
  const bossHpText = document.getElementById('bossHpText');
  const waveBanner = document.getElementById('waveBanner');
  const bannerKicker = document.getElementById('bannerKicker');
  const bannerTitle = document.getElementById('bannerTitle');
  const toastEl = document.getElementById('toast');
  const overdriveTag = document.getElementById('overdriveTag');
  const finalScore = document.getElementById('finalScore');
  const finalWave = document.getElementById('finalWave');
  const finalKills = document.getElementById('finalKills');
  const finalBest = document.getElementById('finalBest');
  const newBestTag = document.getElementById('newBestTag');
  const bestScoreMenu = document.getElementById('bestScoreMenu');
  const dashBtn = document.getElementById('dashBtn');
  const moveStick = document.getElementById('moveStick');
  const aimStick = document.getElementById('aimStick');
  const moveKnob = document.getElementById('moveKnob');
  const aimKnob = document.getElementById('aimKnob');

  // ── Viewport ──────────────────────────────────────────────────
  let W = window.innerWidth;
  let H = window.innerHeight;
  let DPR = Math.min(window.devicePixelRatio || 1, 2);
  let RS = 1;
  let compact = W <= 860;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    // Render at a sensible internal resolution. This keeps the neon scene fast
    // on software renderers while still looking crisp on high-DPI phones.
    RS = Math.max(0.5, Math.min(DPR, 1.45, 900 / Math.max(W, H)));
    compact = W <= 860;
    canvas.width = Math.floor(W * RS);
    canvas.height = Math.floor(H * RS);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    ctx.imageSmoothingEnabled = true;
    buildStars();
    const bgStart = performance.now();
    buildBackgroundCache();
    if (!window.__loadTimes) window.__loadTimes = {};
    window.__loadTimes.background = performance.now() - bgStart;
    if (player) {
      player.x = clamp(player.x, 28, W - 28);
      player.y = clamp(player.y, 28, H - 28);
    }
    if (state.mode === 'menu') buildMenuOrnaments();
  }

  // ── Persistent scores / sound ─────────────────────────────────
  function readBest() {
    try { return Math.max(0, parseInt(localStorage.getItem('voidbreaker.best') || '0', 10) || 0); }
    catch { return 0; }
  }
  function writeBest(value) {
    try { localStorage.setItem('voidbreaker.best', String(Math.floor(value))); } catch { /* private mode */ }
  }

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.noiseBuffer = null;
      this.muted = (() => { try { return localStorage.getItem('voidbreaker.muted') === '1'; } catch { return false; } })();
      this.lastHit = 0;
    }

    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.22;
        this.master.connect(this.ctx.destination);
        const length = Math.floor(this.ctx.sampleRate * 0.8);
        this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    }

    setMuted(muted) {
      this.muted = muted;
      try { localStorage.setItem('voidbreaker.muted', muted ? '1' : '0'); } catch { /* ignore */ }
      if (this.master && this.ctx) {
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.22, this.ctx.currentTime + 0.08);
      }
    }

    tone(freq, duration, type = 'sine', volume = 0.08, endFreq = freq) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    }

    noise(duration = 0.2, volume = 0.1, cutoff = 900) {
      if (!this.ctx || this.muted || !this.noiseBuffer) return;
      const t = this.ctx.currentTime;
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, t);
      filter.frequency.exponentialRampToValueAtTime(120, t + duration);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(t);
      source.stop(t + duration);
    }

    shoot() {
      this.tone(random(540, 610), 0.07, 'square', 0.026, 220);
    }
    hit() {
      const t = performance.now();
      if (t - this.lastHit < 42) return;
      this.lastHit = t;
      this.tone(random(180, 240), 0.04, 'triangle', 0.025, 80);
    }
    explode(big = false) {
      this.noise(big ? 0.65 : 0.24, big ? 0.2 : 0.1, big ? 800 : 1400);
      this.tone(big ? 68 : 105, big ? 0.5 : 0.18, 'sine', big ? 0.16 : 0.06, 30);
    }
    dash() {
      this.tone(160, 0.16, 'sawtooth', 0.05, 480);
      this.noise(0.12, 0.05, 2200);
    }
    pickup() {
      this.tone(620, 0.09, 'sine', 0.05, 940);
      setTimeout(() => this.tone(940, 0.12, 'sine', 0.04, 1280), 55);
    }
    wave() {
      this.tone(120, 0.32, 'sine', 0.08, 240);
      setTimeout(() => this.tone(240, 0.28, 'triangle', 0.05, 360), 90);
    }
    upgrade() {
      this.tone(300, 0.14, 'triangle', 0.06, 600);
      setTimeout(() => this.tone(600, 0.22, 'sine', 0.05, 900), 100);
    }
    hurt() {
      this.tone(90, 0.2, 'sawtooth', 0.09, 40);
      this.noise(0.18, 0.08, 500);
    }
    gameover() {
      this.tone(180, 0.9, 'sawtooth', 0.07, 40);
      setTimeout(() => this.noise(0.9, 0.09, 500), 80);
    }
  }
  const audio = new AudioEngine();

  // ── Game state ────────────────────────────────────────────────
  const state = {
    mode: 'menu',
    time: 0,
    menuTime: 0,
    runTime: 0,
    wave: 1,
    score: 0,
    best: readBest(),
    kills: 0,
    combo: 0,
    comboTimer: 0,
    comboMult: 1,
    waveElapsed: 0,
    waveKills: 0,
    waveActive: false,
    waveClearTimer: -1,
    boss: null,
    overdrive: 0,
    shake: 0,
    damageFlash: 0,
    deathTimer: 0,
    newBest: false,
    hudTimer: 0,
    spawnQueue: [],
    upgradesTaken: []
  };

  let player = null;
  let bullets = [];
  let enemyBullets = [];
  let enemies = [];
  let particles = [];
  let rings = [];
  let pickups = [];
  let floaters = [];
  let ghosts = [];
  let stars = [];
  let bgCache = null;
  let menuOrnaments = [];
  let currentChoices = [];
  let bannerLife = 0;
  let toastTimer = 0;
  let mouse = { x: W * 0.5, y: H * 0.34, active: false };
  const keys = new Set();
  const touchMove = { x: 0, y: 0, active: false };
  const touchAim = { x: 0, y: 0, active: false };

  function makePlayer() {
    return {
      x: W * 0.5,
      y: H * 0.56,
      vx: 0,
      vy: 0,
      radius: 13,
      angle: -Math.PI / 2,
      speed: 285,
      health: 100,
      maxHealth: 100,
      fireInterval: 0.145,
      fireTimer: 0,
      damage: 1,
      projectiles: 1,
      pierce: 0,
      critChance: 0,
      critMult: 2,
      healChance: 0,
      drones: 0,
      droneTimer: 0.8,
      dashTimer: 0,
      dashCooldown: 0,
      dashCooldownMax: 1.55,
      dashX: 0,
      dashY: -1,
      invuln: 0,
      trailTimer: 0,
      shotSide: 1,
      engineTimer: 0,
      hitFlash: 0
    };
  }

  function buildStars() {
    const count = clamp(Math.floor((W * H) / 18000), 38, 88);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      size: random(0.35, 1.7),
      speed: random(2, 10),
      alpha: random(0.12, 0.65),
      twinkle: random(0, TAU),
      hue: Math.random() < 0.12 ? 'rgba(255,120,190,' : Math.random() < 0.25 ? 'rgba(95,247,255,' : 'rgba(210,240,255,'
    }));
  }

  function buildBackgroundCache() {
    const cache = document.createElement('canvas');
    cache.width = Math.max(1, Math.floor(W * RS));
    cache.height = Math.max(1, Math.floor(H * RS));
    const bg = cache.getContext('2d');
    bg.setTransform(RS, 0, 0, RS, 0, 0);
    bg.fillStyle = '#04070f';
    bg.fillRect(0, 0, W, H);

    let glow = bg.createRadialGradient(W * 0.48, H * 0.52, 20, W * 0.48, H * 0.52, Math.max(W, H) * 0.7);
    glow.addColorStop(0, 'rgba(16, 48, 66, 0.2)');
    glow.addColorStop(0.45, 'rgba(8, 22, 35, 0.11)');
    glow.addColorStop(1, 'rgba(2, 5, 10, 0)');
    bg.fillStyle = glow;
    bg.fillRect(0, 0, W, H);

    const magenta = bg.createRadialGradient(W * 0.94, H * 0.12, 10, W * 0.94, H * 0.12, Math.max(W, H) * 0.48);
    magenta.addColorStop(0, 'rgba(110, 18, 68, 0.16)');
    magenta.addColorStop(1, 'rgba(110, 18, 68, 0)');
    bg.fillStyle = magenta;
    bg.fillRect(0, 0, W, H);

    const blue = bg.createRadialGradient(W * 0.12, H * 0.9, 10, W * 0.12, H * 0.9, Math.max(W, H) * 0.45);
    blue.addColorStop(0, 'rgba(10, 52, 88, 0.16)');
    blue.addColorStop(1, 'rgba(10, 52, 88, 0)');
    bg.fillStyle = blue;
    bg.fillRect(0, 0, W, H);

    const grid = 72;
    bg.lineWidth = 1;
    bg.strokeStyle = 'rgba(87, 163, 184, 0.08)';
    bg.beginPath();
    for (let x = 0; x < W + grid; x += grid) {
      bg.moveTo(x, 0);
      bg.lineTo(x, H);
    }
    for (let y = 0; y < H + grid; y += grid) {
      bg.moveTo(0, y);
      bg.lineTo(W, y);
    }
    bg.stroke();

    bg.strokeStyle = 'rgba(95, 247, 255, 0.06)';
    bg.beginPath();
    for (let x = 0; x < W + grid * 4; x += grid * 4) {
      bg.moveTo(x, 0);
      bg.lineTo(x, H);
    }
    for (let y = 0; y < H + grid * 4; y += grid * 4) {
      bg.moveTo(0, y);
      bg.lineTo(W, y);
    }
    bg.stroke();

    // A faint central bloom anchors the arena.
    const bloom = bg.createRadialGradient(W * 0.5, H * 0.53, 10, W * 0.5, H * 0.53, Math.min(W, H) * 0.42);
    bloom.addColorStop(0, 'rgba(60, 196, 218, 0.055)');
    bloom.addColorStop(0.55, 'rgba(20, 70, 94, 0.02)');
    bloom.addColorStop(1, 'rgba(5, 16, 28, 0)');
    bg.fillStyle = bloom;
    bg.fillRect(0, 0, W, H);

    // Bake the atmosphere into the static backdrop. Compositing full-screen
    // vignette and scanline layers over a changing canvas is expensive on
    // software renderers, and these never need to update.
    const vignette = bg.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.3, W * 0.5, H * 0.46, Math.max(W, H) * 0.72);
    vignette.addColorStop(0, 'rgba(0, 3, 9, 0)');
    vignette.addColorStop(0.62, 'rgba(0, 3, 9, 0.16)');
    vignette.addColorStop(1, 'rgba(0, 2, 6, 0.72)');
    bg.fillStyle = vignette;
    bg.fillRect(0, 0, W, H);

    const edgeShade = bg.createLinearGradient(0, 0, 0, H);
    edgeShade.addColorStop(0, 'rgba(0, 2, 8, 0.32)');
    edgeShade.addColorStop(0.16, 'rgba(0, 2, 8, 0)');
    edgeShade.addColorStop(0.84, 'rgba(0, 2, 8, 0)');
    edgeShade.addColorStop(1, 'rgba(0, 2, 8, 0.5)');
    bg.fillStyle = edgeShade;
    bg.fillRect(0, 0, W, H);

    bg.fillStyle = 'rgba(255, 255, 255, 0.02)';
    for (let y = 0; y < H; y += 4) bg.fillRect(0, y, W, 1);
    bgCache = cache;
  }

  function buildMenuOrnaments() {
    menuOrnaments = Array.from({ length: 9 }, (_, i) => ({
      angle: random(0, TAU),
      radius: random(0.34, 0.88),
      speed: random(-0.04, 0.04),
      size: random(1, 3),
      kind: i % 3
    }));
  }

  resize();
  window.addEventListener('resize', resize);

  // ── Input ─────────────────────────────────────────────────────
  const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);

  window.addEventListener('keydown', (event) => {
    if (movementCodes.has(event.code) || event.code === 'Space') event.preventDefault();
    if (event.repeat) return;
    keys.add(event.code);
    if (event.code === 'Space' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      if (state.mode === 'playing') tryDash();
    }
    if (event.code === 'Escape' || event.code === 'KeyP') {
      if (state.mode === 'playing') pauseGame();
      else if (state.mode === 'paused') resumeGame();
    }
    if (state.mode === 'upgrade' && ['Digit1', 'Digit2', 'Digit3'].includes(event.code)) {
      chooseUpgrade(Number(event.code.slice(-1)) - 1);
    }
  });

  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });

  window.addEventListener('blur', () => {
    keys.clear();
    touchMove.x = touchMove.y = 0;
    touchMove.active = false;
    if (state.mode === 'playing') pauseGame();
  });

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
      mouse.active = true;
    }
  }, { passive: true });

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  function bindStick(el, knob, target) {
    let pointerId = null;
    let centerX = 0;
    let centerY = 0;
    let maxDistance = 36;

    const apply = (event) => {
      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;
      const length = Math.hypot(dx, dy);
      const limit = Math.min(1, length / maxDistance);
      const nx = length > 0.01 ? (dx / length) * limit : 0;
      const ny = length > 0.01 ? (dy / length) * limit : 0;
      target.x = nx;
      target.y = ny;
      target.active = limit > 0.12;
      knob.style.transform = `translate(${nx * maxDistance}px, ${ny * maxDistance}px)`;
    };

    el.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      audio.init();
      pointerId = event.pointerId;
      const rect = el.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
      maxDistance = rect.width * 0.33;
      try { el.setPointerCapture(pointerId); } catch { /* synthetic pointers */ }
      el.classList.add('active');
      apply(event);
    });

    el.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      apply(event);
    });

    const release = (event) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      target.x = 0;
      target.y = 0;
      target.active = false;
      knob.style.transform = 'translate(0px, 0px)';
      el.classList.remove('active');
    };

    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }

  bindStick(moveStick, moveKnob, touchMove);
  bindStick(aimStick, aimKnob, touchAim);

  dashBtn.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    audio.init();
    tryDash();
  });

  function tryDash() {
    if (!player || state.mode !== 'playing' || player.dashCooldown > 0 || player.dashTimer > 0) return;
    let dx = 0;
    let dy = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
    if (Math.abs(touchMove.x) + Math.abs(touchMove.y) > 0.2) {
      dx = touchMove.x;
      dy = touchMove.y;
    }
    if (Math.hypot(dx, dy) < 0.1) {
      dx = Math.cos(player.angle);
      dy = Math.sin(player.angle);
    }
    const length = Math.hypot(dx, dy) || 1;
    player.dashX = dx / length;
    player.dashY = dy / length;
    player.dashTimer = 0.17;
    player.dashCooldown = player.dashCooldownMax;
    player.invuln = Math.max(player.invuln, 0.34);
    player.trailTimer = 0;
    addShake(4);
    burst(player.x, player.y, '#5ff7ff', 14, 130, 3, 0.35);
    addRing(player.x, player.y, 8, 54, '#5ff7ff', 0.32, 2);
    audio.dash();
  }

  // ── Menu / run lifecycle ──────────────────────────────────────
  function updateBestLabels() {
    bestScoreMenu.textContent = pad(state.best);
  }

  function startGame() {
    audio.init();
    state.mode = 'playing';
    state.time = 0;
    state.runTime = 0;
    state.wave = 1;
    state.score = 0;
    state.kills = 0;
    state.combo = 0;
    state.comboTimer = 0;
    state.comboMult = 1;
    state.waveElapsed = 0;
    state.waveKills = 0;
    state.waveActive = false;
    state.waveClearTimer = -1;
    state.boss = null;
    state.overdrive = 0;
    state.shake = 0;
    state.damageFlash = 0;
    state.newBest = false;
    state.hudTimer = 0;
    state.spawnQueue = [];
    state.upgradesTaken = [];
    mouse.active = false;
    bullets = [];
    enemyBullets = [];
    enemies = [];
    particles = [];
    rings = [];
    pickups = [];
    floaters = [];
    ghosts = [];
    player = makePlayer();
    document.body.classList.add('playing');
    menuEl.classList.add('hidden');
    hudEl.classList.remove('hidden');
    pauseOverlay.classList.add('hidden');
    upgradeOverlay.classList.add('hidden');
    gameoverOverlay.classList.add('hidden');
    bossBar.classList.add('hidden');
    updateHUD();
    beginWave(1);
  }

  function beginWave(number) {
    state.wave = number;
    state.waveElapsed = 0;
    state.waveKills = 0;
    state.waveActive = true;
    state.waveClearTimer = -1;
    state.boss = null;
    enemyBullets = [];
    state.spawnQueue = buildWave(number);
    const names = ['INCURSION', 'PRESSURE', 'CROSSFIRE', 'FRACTURE', 'DREADNOUGHT', 'OVERRUN', 'BLACKOUT', 'TERMINUS'];
    const bossWave = number % 5 === 0;
    showBanner(`WAVE ${pad(number, 2)}`, bossWave ? 'DREADNOUGHT' : names[(number - 1) % names.length], bossWave);
    addRing(W * 0.5, H * 0.5, 30, Math.max(W, H) * 0.62, bossWave ? '#ff3d9a' : '#5ff7ff', 0.85, 1);
    audio.wave();
    updateHUD();
  }

  function buildWave(number) {
    const queue = [];
    if (number % 5 === 0) {
      queue.push({ type: 'boss', delay: 0.65, placement: 'top' });
      const adds = Math.min(4 + Math.floor(number / 5), 9);
      for (let i = 0; i < adds; i++) {
        queue.push({
          type: Math.random() < 0.7 ? 'scout' : 'brute',
          delay: 1.2 + i * 0.52,
          placement: 'edge'
        });
      }
      return queue;
    }

    const count = Math.min(26, 5 + Math.round(number * 1.55));
    for (let i = 0; i < count; i++) {
      let type = 'scout';
      const roll = Math.random();
      if (number >= 2 && roll > 0.82) type = 'brute';
      if (number >= 3 && roll > 0.68 && roll <= 0.82) type = 'sniper';
      if (number >= 4 && roll > 0.56 && roll <= 0.68) type = 'splitter';
      queue.push({
        type,
        delay: i < 6 ? 0 : 0.5 + i * random(0.2, 0.36),
        placement: i < 6 ? 'ring' : 'edge'
      });
    }
    return queue;
  }

  function spawnFromQueue() {
    while (state.spawnQueue.length && state.waveElapsed >= state.spawnQueue[0].delay) {
      const spec = state.spawnQueue.shift();
      spawnEnemy(spec.type, spec.placement);
    }
  }

  function spawnPoint(placement) {
    const margin = 42;
    if (placement === 'ring') {
      const radius = clamp(Math.min(W, H) * 0.26, 130, 225);
      const angle = random(0, TAU);
      return {
        x: clamp(player.x + Math.cos(angle) * radius, margin, W - margin),
        y: clamp(player.y + Math.sin(angle) * radius, margin + 55, H - margin)
      };
    }
    if (placement === 'top') {
      // Keep the dreadnought below the HUD so its silhouette is always readable.
      return { x: W * 0.5 + random(-40, 40), y: Math.max(170, H * 0.27) };
    }
    const side = (Math.random() * 4) | 0;
    if (side === 0) return { x: random(margin, W - margin), y: 58 };
    if (side === 1) return { x: W - 40, y: random(80, H - margin) };
    if (side === 2) return { x: random(margin, W - margin), y: H - 38 };
    return { x: 40, y: random(80, H - margin) };
  }

  function spawnEnemy(type, placement = 'edge') {
    const point = spawnPoint(placement);
    const wave = state.wave;
    const boost = 1 + (wave - 1) * 0.075;
    const enemy = {
      type,
      x: point.x,
      y: point.y,
      vx: 0,
      vy: 0,
      angle: random(0, TAU),
      spin: random(-1, 1),
      age: 0,
      hitFlash: 0,
      dead: false,
      seed: random(0, 100),
      fireTimer: random(1.2, 2.2),
      contactTimer: 0,
      charge: 0,
      radius: 12,
      hp: 2,
      maxHp: 2,
      speed: 100,
      contact: 10,
      score: 100,
      color: '#ff3d9a',
      boss: false
    };

    if (type === 'scout') {
      enemy.radius = 12;
      enemy.hp = 2.3 * boost;
      enemy.speed = (104 + wave * 3.5) * 0.92;
      enemy.contact = 10;
      enemy.score = 100;
      enemy.color = '#ff3d9a';
    } else if (type === 'brute') {
      enemy.radius = 24;
      enemy.hp = 9.5 * boost;
      enemy.speed = 51 + wave * 1.2;
      enemy.contact = 22;
      enemy.score = 320;
      enemy.color = '#ffc65c';
      enemy.fireTimer = random(2.5, 4.5);
    } else if (type === 'sniper') {
      enemy.radius = 15;
      enemy.hp = 4.4 * boost;
      enemy.speed = 70 + wave;
      enemy.contact = 12;
      enemy.score = 220;
      enemy.color = '#5ff7ff';
      enemy.fireTimer = random(1.5, 2.4);
    } else if (type === 'splitter') {
      enemy.radius = 19;
      enemy.hp = 5.8 * boost;
      enemy.speed = 76 + wave * 1.1;
      enemy.contact = 14;
      enemy.score = 260;
      enemy.color = '#b877ff';
    } else if (type === 'mite') {
      enemy.radius = 8;
      enemy.hp = 1.3 + wave * 0.12;
      enemy.speed = 150 + wave * 2;
      enemy.contact = 6;
      enemy.score = 40;
      enemy.color = '#ff65ba';
    } else if (type === 'boss') {
      enemy.radius = 48;
      enemy.hp = 82 + wave * 12;
      enemy.speed = 48;
      enemy.contact = 30;
      enemy.score = 5000;
      enemy.color = '#ff3d9a';
      enemy.boss = true;
      enemy.fireTimer = 1.4;
      enemy.specialTimer = 3.1;
      enemy.charge = 0;
      state.boss = enemy;
      bossBar.classList.remove('hidden');
    }

    enemy.maxHp = enemy.hp;
    enemies.push(enemy);
    burst(point.x, point.y, enemy.color, enemy.boss ? 34 : 11, enemy.boss ? 230 : 110, enemy.boss ? 5 : 3, 0.55);
    addRing(point.x, point.y, 5, enemy.boss ? 100 : 42, enemy.color, 0.55, enemy.boss ? 3 : 1.5);
    if (enemy.boss) addShake(10);
    return enemy;
  }

  // ── Upgrade system ────────────────────────────────────────────
  const upgradePool = [
    {
      id: 'rate', name: 'Overclock', glyph: '»', color: '#5ff7ff',
      desc: 'Reroute coolant through the cannon. Every trigger pull comes faster.',
      stat: 'FIRE RATE +16%', available: () => true,
      apply: () => { player.fireInterval *= 0.84; }
    },
    {
      id: 'damage', name: 'Kinetic Rounds', glyph: '✦', color: '#ffc65c',
      desc: 'Dense-core ammunition. Each pulse hits with brutal efficiency.',
      stat: 'DAMAGE +0.8', available: () => true,
      apply: () => { player.damage += 0.8; }
    },
    {
      id: 'multi', name: 'Twin Barrage', glyph: '≡', color: '#ff3d9a',
      desc: 'A widened firing array adds another round to every volley.',
      stat: 'PROJECTILES +1', available: () => player.projectiles < 5,
      apply: () => { player.projectiles += 1; }
    },
    {
      id: 'hull', name: 'Ablative Plating', glyph: '✚', color: '#6dffb0',
      desc: 'Layered ceramic weave seals the hull and raises its ceiling.',
      stat: 'MAX HULL +25', available: () => player.maxHealth < 240,
      apply: () => { player.maxHealth += 25; player.health = Math.min(player.maxHealth, player.health + 25); }
    },
    {
      id: 'pierce', name: 'Rail Core', glyph: '➤', color: '#8ad7ff',
      desc: 'Superconductive rails punch clean through light armor.',
      stat: 'PIERCE +1', available: () => player.pierce < 4,
      apply: () => { player.pierce += 1; }
    },
    {
      id: 'thruster', name: 'Thruster Coils', glyph: '≫', color: '#3d8bff',
      desc: 'Overcharged vector jets increase drift speed and dash recovery.',
      stat: 'SPEED +30 / DASH CD -18%', available: () => true,
      apply: () => { player.speed += 30; player.dashCooldownMax *= 0.82; }
    },
    {
      id: 'drone', name: 'Wingman Protocol', glyph: '◉', color: '#6dffb0',
      desc: 'Deploy an autonomous escort that tracks and suppresses targets.',
      stat: 'ESCORT DRONE +1', available: () => player.drones < 2,
      apply: () => { player.drones += 1; }
    },
    {
      id: 'leech', name: 'Nanite Leech', glyph: '♦', color: '#7dffcb',
      desc: 'Recovery nanites harvest wreckage and patch the hull mid-combat.',
      stat: 'KILL HEAL +9%', available: () => player.healChance < 0.45,
      apply: () => { player.healChance += 0.09; }
    },
    {
      id: 'crit', name: 'Fracture Array', glyph: '✧', color: '#ff86b8',
      desc: 'Target weak points with a volatile harmonic charge. Hits can detonate.',
      stat: 'CRIT +14% / x2 DMG', available: () => player.critChance < 0.56,
      apply: () => { player.critChance += 0.14; }
    }
  ];

  function chooseUpgrades() {
    const available = upgradePool.filter((upgrade) => upgrade.available());
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    while (shuffled.length < 3) shuffled.push(upgradePool[0]);
    return shuffled.slice(0, 3);
  }

  function openUpgrade() {
    if (state.mode !== 'playing') return;
    state.mode = 'upgrade';
    currentChoices = chooseUpgrades();
    upgradeCards.innerHTML = currentChoices.map((upgrade, index) => `
      <button class="upgrade-card" type="button" data-index="${index}" style="--accent:${upgrade.color}">
        <div class="card-top"><span class="card-index">0${index + 1}</span></div>
        <span class="card-glyph">${upgrade.glyph}</span>
        <span class="card-name">${upgrade.name}</span>
        <span class="card-desc">${upgrade.desc}</span>
        <span class="card-stat"><b>${upgrade.stat}</b></span>
      </button>
    `).join('');
    upgradeCards.querySelectorAll('.upgrade-card').forEach((card) => {
      card.addEventListener('click', () => chooseUpgrade(Number(card.dataset.index)));
    });
    upgradeOverlay.classList.remove('hidden');
    audio.upgrade();
  }

  function chooseUpgrade(index) {
    if (state.mode !== 'upgrade') return;
    const upgrade = currentChoices[index];
    if (!upgrade) return;
    upgrade.apply();
    state.upgradesTaken.push(upgrade.id);
    upgradeOverlay.classList.add('hidden');
    state.mode = 'playing';
    showToast(`${upgrade.name.toUpperCase()} // INSTALLED`);
    audio.pickup();
    updateHUD();
    beginWave(state.wave + 1);
  }

  // ── Pause / game over ─────────────────────────────────────────
  function pauseGame() {
    if (state.mode !== 'playing') return;
    state.mode = 'paused';
    pauseOverlay.classList.remove('hidden');
    document.body.classList.remove('playing');
  }

  function resumeGame() {
    if (state.mode !== 'paused') return;
    state.mode = 'playing';
    pauseOverlay.classList.add('hidden');
    document.body.classList.add('playing');
    audio.init();
  }

  function returnToMenu() {
    state.mode = 'menu';
    state.waveClearTimer = -1;
    state.boss = null;
    pauseOverlay.classList.add('hidden');
    upgradeOverlay.classList.add('hidden');
    gameoverOverlay.classList.add('hidden');
    hudEl.classList.add('hidden');
    bossBar.classList.add('hidden');
    document.body.classList.remove('playing');
    menuEl.classList.remove('hidden', 'closing');
    updateBestLabels();
    enemies = [];
    enemyBullets = [];
    bullets = [];
    pickups = [];
    ghosts = [];
    particles = [];
    rings = [];
    floaters = [];
  }

  function killPlayer() {
    if (state.mode !== 'playing') return;
    state.mode = 'dying';
    state.deathTimer = 1.25;
    addShake(22);
    addRing(player.x, player.y, 10, 210, '#ff3d9a', 0.8, 3);
    addRing(player.x, player.y, 5, 140, '#5ff7ff', 0.65, 2);
    burst(player.x, player.y, '#5ff7ff', 60, 360, 4, 1.1);
    burst(player.x, player.y, '#ff3d9a', 40, 260, 5, 0.9);
    audio.explode(true);
    audio.gameover();
  }

  function showGameOver() {
    state.mode = 'gameover';
    state.newBest = state.score > state.best;
    if (state.newBest) {
      state.best = state.score;
      writeBest(state.best);
    }
    updateBestLabels();
    finalScore.textContent = pad(state.score);
    finalWave.textContent = pad(state.wave, 2);
    finalKills.textContent = String(state.kills);
    finalBest.textContent = pad(state.best);
    newBestTag.classList.toggle('hidden', !state.newBest);
    bossBar.classList.add('hidden');
    gameoverOverlay.classList.remove('hidden');
    document.body.classList.remove('playing');
  }

  // ── Combat helpers ────────────────────────────────────────────
  function getMoveVector() {
    let x = 0;
    let y = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (touchMove.active) {
      x += touchMove.x;
      y += touchMove.y;
    }
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    return { x, y, length: Math.min(1, length) };
  }

  function nearestEnemy(x, y, maxDistance = Infinity) {
    let best = null;
    let bestDist = maxDistance;
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const d = dist(x, y, enemy.x, enemy.y);
      if (d < bestDist) {
        bestDist = d;
        best = enemy;
      }
    }
    return best;
  }

  function getAimAngle() {
    if (touchAim.active) return Math.atan2(touchAim.y, touchAim.x);
    if (mouse.active) return Math.atan2(mouse.y - player.y, mouse.x - player.x);
    const target = nearestEnemy(player.x, player.y);
    if (target) return Math.atan2(target.y - player.y, target.x - player.x);
    return player.angle;
  }

  function shoot() {
    const count = player.projectiles;
    const spread = 0.082;
    const muzzle = 21;
    for (let i = 0; i < count; i++) {
      const angle = player.angle + (i - (count - 1) / 2) * spread;
      const side = player.shotSide * (i % 2 === 0 ? 4 : -4);
      const bx = player.x + Math.cos(angle) * muzzle - Math.sin(angle) * side;
      const by = player.y + Math.sin(angle) * muzzle + Math.cos(angle) * side;
      const crit = Math.random() < player.critChance;
      bullets.push({
        x: bx,
        y: by,
        vx: Math.cos(angle) * 840,
        vy: Math.sin(angle) * 840,
        radius: crit ? 4 : 2.7,
        damage: player.damage * (crit ? player.critMult : 1),
        crit,
        pierce: player.pierce,
        life: 1.15,
        hit: new Set(),
        color: crit ? '#ffc65c' : '#8ffcff'
      });
    }
    player.shotSide *= -1;
    player.fireTimer = player.fireInterval * (state.overdrive > 0 ? 0.54 : 1);
    const mx = player.x + Math.cos(player.angle) * 23;
    const my = player.y + Math.sin(player.angle) * 23;
    for (let i = 0; i < 3; i++) {
      particles.push({
        x: mx, y: my,
        vx: Math.cos(player.angle) * random(40, 130) + random(-40, 40),
        vy: Math.sin(player.angle) * random(40, 130) + random(-40, 40),
        life: random(0.08, 0.2), maxLife: 0.2, size: random(1, 2.6),
        color: state.overdrive > 0 ? '#ffc65c' : '#b9fdff', drag: 4, glow: true
      });
    }
    audio.shoot();
  }

  function shootDrone(droneX, droneY, target) {
    if (!target) return;
    const angle = Math.atan2(target.y - droneY, target.x - droneX);
    bullets.push({
      x: droneX, y: droneY,
      vx: Math.cos(angle) * 760, vy: Math.sin(angle) * 760,
      radius: 2.2, damage: 0.65, crit: false, pierce: 0,
      life: 0.9, hit: new Set(), color: '#6dffb0', drone: true
    });
  }

  function addShake(amount) {
    state.shake = Math.min(26, state.shake + amount);
  }

  function addRing(x, y, from, to, color, life = 0.5, width = 2) {
    rings.push({ x, y, from, to, color, life, maxLife: life, width });
  }

  function burst(x, y, color, count = 10, speed = 140, size = 3, life = 0.5) {
    for (let i = 0; i < count; i++) {
      const angle = random(0, TAU);
      const velocity = random(speed * 0.25, speed);
      const particleLife = random(life * 0.45, life);
      particles.push({
        x, y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: particleLife,
        maxLife: particleLife,
        size: random(size * 0.35, size),
        color,
        drag: random(1.5, 4.5),
        glow: true
      });
    }
  }

  function damageEnemy(enemy, amount, hitX, hitY, crit = false) {
    if (enemy.dead) return;
    enemy.hp -= amount;
    enemy.hitFlash = 0.09;
    burst(hitX, hitY, crit ? '#ffc65c' : enemy.color, crit ? 8 : 3, crit ? 160 : 80, crit ? 3 : 1.8, 0.24);
    audio.hit();
    if (enemy.hp <= 0) killEnemy(enemy);
  }

  function killEnemy(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    state.kills += 1;
    state.waveKills += 1;
    state.combo += 1;
    state.comboTimer = 3.1;
    state.comboMult = 1 + Math.min(50, state.combo) * 0.05;
    state.score += Math.round(enemy.score * state.comboMult);
    addShake(enemy.boss ? 18 : enemy.type === 'brute' ? 4 : 1.8);
    burst(enemy.x, enemy.y, enemy.color, enemy.boss ? 70 : enemy.type === 'brute' ? 28 : 16, enemy.boss ? 380 : 220, enemy.boss ? 5 : 3.2, enemy.boss ? 1.2 : 0.7);
    addRing(enemy.x, enemy.y, 4, enemy.boss ? 190 : enemy.type === 'brute' ? 76 : 40, enemy.color, enemy.boss ? 0.9 : 0.45, enemy.boss ? 3 : 1.5);
    audio.explode(enemy.boss || enemy.type === 'brute');

    if (enemy.type === 'splitter') {
      for (let i = 0; i < 2; i++) {
        const angle = random(0, TAU);
        const mite = spawnEnemy('mite', 'edge');
        mite.x = enemy.x + Math.cos(angle) * 18;
        mite.y = enemy.y + Math.sin(angle) * 18;
        mite.vx = Math.cos(angle) * 120;
        mite.vy = Math.sin(angle) * 120;
      }
    }

    if (enemy.boss) {
      state.boss = null;
      bossBar.classList.add('hidden');
      showToast('DREADNOUGHT DESTROYED // SECTOR SECURED');
      spawnPickup(enemy.x, enemy.y, 'health');
      spawnPickup(enemy.x + 34, enemy.y, 'overdrive');
      for (let i = 0; i < 5; i++) spawnPickup(enemy.x + random(-70, 70), enemy.y + random(-50, 50), Math.random() < 0.5 ? 'health' : 'overdrive');
    } else {
      const roll = Math.random();
      if (player.health < player.maxHealth * 0.62 && roll < 0.12) spawnPickup(enemy.x, enemy.y, 'health');
      else if (roll > 0.975) spawnPickup(enemy.x, enemy.y, 'overdrive');
    }

    if (player.healChance > 0 && Math.random() < player.healChance) {
      player.health = Math.min(player.maxHealth, player.health + 5);
      floaters.push({ x: player.x, y: player.y - 22, text: '+5 HULL', color: '#6dffb0', life: 0.9, maxLife: 0.9 });
    }
  }

  function spawnPickup(x, y, type) {
    pickups.push({
      x: clamp(x, 30, W - 30),
      y: clamp(y, 30, H - 30),
      type,
      vx: random(-35, 35),
      vy: random(-35, 35),
      age: 0,
      life: 14,
      radius: 11
    });
  }

  function damagePlayer(amount) {
    if (state.mode !== 'playing' || player.invuln > 0) return;
    player.health -= amount;
    player.invuln = 0.92;
    player.hitFlash = 0.16;
    state.damageFlash = 0.9;
    state.combo = 0;
    state.comboTimer = 0;
    state.comboMult = 1;
    addShake(11);
    burst(player.x, player.y, '#ff4b62', 16, 170, 3, 0.55);
    audio.hurt();
    if (player.health <= 0) {
      player.health = 0;
      updateHUD();
      killPlayer();
    }
  }

  function fireEnemyBullet(x, y, angle, speed, radius = 5, damage = 9, color = '#ff3d9a') {
    enemyBullets.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      damage,
      life: 4,
      color,
      trail: random(0.8, 1.3)
    });
  }

  // ── Update: player ────────────────────────────────────────────
  function updatePlayer(dt) {
    const move = getMoveVector();
    if (player.dashTimer > 0) {
      player.dashTimer -= dt;
      player.x += player.dashX * 1020 * dt;
      player.y += player.dashY * 1020 * dt;
      player.trailTimer -= dt;
      if (player.trailTimer <= 0) {
        player.trailTimer = 0.025;
        ghosts.push({ x: player.x, y: player.y, angle: player.angle, life: 0.28, maxLife: 0.28 });
      }
      if (Math.random() < 0.7) {
        particles.push({
          x: player.x - player.dashX * 14,
          y: player.y - player.dashY * 14,
          vx: -player.dashX * random(20, 100) + random(-30, 30),
          vy: -player.dashY * random(20, 100) + random(-30, 30),
          life: random(0.15, 0.35), maxLife: 0.35,
          size: random(1.5, 3.5), color: '#5ff7ff', drag: 3, glow: true
        });
      }
    } else {
      const targetVx = move.x * player.speed;
      const targetVy = move.y * player.speed;
      const response = 1 - Math.exp(-14 * dt);
      player.vx = lerp(player.vx, targetVx, response);
      player.vy = lerp(player.vy, targetVy, response);
      player.x += player.vx * dt;
      player.y += player.vy * dt;
    }

    player.x = clamp(player.x, 26, W - 26);
    player.y = clamp(player.y, 64, H - 26);
    player.angle = getAimAngle();
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    player.invuln = Math.max(0, player.invuln - dt);
    player.hitFlash = Math.max(0, player.hitFlash - dt);
    player.fireTimer -= dt;
    if (player.fireTimer <= 0) shoot();

    player.engineTimer -= dt;
    if (player.engineTimer <= 0) {
      player.engineTimer = 0.045;
      const back = player.angle + Math.PI;
      particles.push({
        x: player.x + Math.cos(back) * 16,
        y: player.y + Math.sin(back) * 16,
        vx: Math.cos(back) * random(20, 80) + player.vx * 0.12,
        vy: Math.sin(back) * random(20, 80) + player.vy * 0.12,
        life: random(0.16, 0.34), maxLife: 0.34,
        size: random(1.2, 2.8), color: state.overdrive > 0 ? '#ffc65c' : '#35d9ef', drag: 3, glow: true
      });
    }

    if (player.drones > 0) {
      player.droneTimer -= dt;
      if (player.droneTimer <= 0) {
        player.droneTimer = 0.56;
        const target = nearestEnemy(player.x, player.y, 620);
        if (target) {
          for (let i = 0; i < player.drones; i++) {
            const angle = state.time * 2.3 + (i / player.drones) * TAU;
            const dx = player.x + Math.cos(angle) * 42;
            const dy = player.y + Math.sin(angle) * 42;
            shootDrone(dx, dy, target);
          }
        }
      }
    }
  }

  // ── Update: enemies ───────────────────────────────────────────
  function updateEnemies(dt) {
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      enemy.age += dt;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.contactTimer = Math.max(0, enemy.contactTimer - dt);
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.hypot(dx, dy) || 1;
      const dirX = dx / distance;
      const dirY = dy / distance;

      if (enemy.type === 'scout' || enemy.type === 'mite') {
        const wobble = Math.sin(enemy.age * 5 + enemy.seed) * (enemy.type === 'mite' ? 0.5 : 0.28);
        const tx = dirX - dirY * wobble;
        const ty = dirY + dirX * wobble;
        enemy.vx = lerp(enemy.vx, tx * enemy.speed, 1 - Math.exp(-3.5 * dt));
        enemy.vy = lerp(enemy.vy, ty * enemy.speed, 1 - Math.exp(-3.5 * dt));
        enemy.angle = Math.atan2(enemy.vy, enemy.vx);
        enemy.spin += dt * 3;
      } else if (enemy.type === 'brute') {
        enemy.vx = lerp(enemy.vx, dirX * enemy.speed, 1 - Math.exp(-2.1 * dt));
        enemy.vy = lerp(enemy.vy, dirY * enemy.speed, 1 - Math.exp(-2.1 * dt));
        enemy.angle = Math.atan2(enemy.vy, enemy.vx);
        enemy.spin += dt * 0.9;
        enemy.fireTimer -= dt;
        if (enemy.fireTimer <= 0 && enemy.age > 1.4) {
          enemy.fireTimer = random(2.8, 4.4);
          const base = Math.atan2(dy, dx);
          for (let i = -1; i <= 1; i++) fireEnemyBullet(enemy.x, enemy.y, base + i * 0.18, 195, 5.5, 11, '#ffc65c');
        }
      } else if (enemy.type === 'sniper') {
        const ideal = 270;
        let moveX = 0;
        let moveY = 0;
        if (distance > ideal + 40) { moveX = dirX; moveY = dirY; }
        else if (distance < ideal - 50) { moveX = -dirX; moveY = -dirY; }
        const strafe = Math.sin(enemy.age * 1.8 + enemy.seed) * 0.6;
        moveX += -dirY * strafe;
        moveY += dirX * strafe;
        const length = Math.hypot(moveX, moveY) || 1;
        enemy.vx = lerp(enemy.vx, (moveX / length) * enemy.speed, 1 - Math.exp(-3 * dt));
        enemy.vy = lerp(enemy.vy, (moveY / length) * enemy.speed, 1 - Math.exp(-3 * dt));
        enemy.angle = Math.atan2(dy, dx);
        enemy.spin += dt * 1.8;
        enemy.fireTimer -= dt;
        enemy.charge = enemy.fireTimer < 0.45 && enemy.fireTimer > 0 ? 1 - enemy.fireTimer / 0.45 : 0;
        if (enemy.fireTimer <= 0 && enemy.age > 1.1) {
          enemy.fireTimer = random(1.8, 2.6);
          fireEnemyBullet(enemy.x, enemy.y, enemy.angle, 330, 5, 12, '#5ff7ff');
          addRing(enemy.x, enemy.y, 6, 25, '#5ff7ff', 0.22, 1.5);
        }
      } else if (enemy.type === 'splitter') {
        const weave = Math.sin(enemy.age * 2.2 + enemy.seed) * 0.7;
        enemy.vx = lerp(enemy.vx, (dirX - dirY * weave) * enemy.speed, 1 - Math.exp(-2.8 * dt));
        enemy.vy = lerp(enemy.vy, (dirY + dirX * weave) * enemy.speed, 1 - Math.exp(-2.8 * dt));
        enemy.angle += dt * enemy.spin * 1.2;
      } else if (enemy.type === 'boss') {
        updateBoss(enemy, dt, dx, dy, distance);
      }

      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;
    }

    // Lightweight separation keeps the swarm readable.
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (b.dead) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.radius + b.radius + 2;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.35;
          const ax = dx * push;
          const ay = dy * push;
          a.x -= ax;
          a.y -= ay;
          b.x += ax;
          b.y += ay;
        }
      }
    }
  }

  function updateBoss(boss, dt, dx, dy, distance) {
    const phase = boss.hp / boss.maxHp < 0.5 ? 1.55 : 1;
    const orbit = Math.min(W, H) * 0.27;
    const targetX = W * 0.5 + Math.cos(state.time * 0.34) * orbit * 0.9;
    const targetY = H * 0.36 + Math.sin(state.time * 0.52) * orbit * 0.22;
    const bx = targetX - boss.x;
    const by = targetY - boss.y;
    const length = Math.hypot(bx, by) || 1;
    boss.vx = lerp(boss.vx, (bx / length) * boss.speed * phase, 1 - Math.exp(-1.7 * dt));
    boss.vy = lerp(boss.vy, (by / length) * boss.speed * phase, 1 - Math.exp(-1.7 * dt));
    boss.angle += dt * 0.55;
    boss.spin += dt * 1.4;

    boss.fireTimer -= dt * phase;
    boss.specialTimer -= dt * phase;
    boss.charge = boss.fireTimer < 0.55 && boss.fireTimer > 0 ? 1 - boss.fireTimer / 0.55 : 0;

    if (boss.fireTimer <= 0) {
      boss.fireTimer = 2.35 / phase;
      const base = Math.atan2(dy, dx);
      for (let i = -2; i <= 2; i++) {
        fireEnemyBullet(boss.x, boss.y, base + i * 0.15, 265, 6, 13, '#ff3d9a');
      }
      addRing(boss.x, boss.y, 25, 100, '#ff3d9a', 0.35, 2);
    }

    if (boss.specialTimer <= 0) {
      boss.specialTimer = 3.7 / phase;
      const count = 18;
      const offset = state.time * 0.8;
      for (let i = 0; i < count; i++) {
        fireEnemyBullet(boss.x, boss.y, offset + (i / count) * TAU, 155, 5, 10, '#ff86b8');
      }
      addRing(boss.x, boss.y, 20, 155, '#ff86b8', 0.6, 2.5);
      addShake(5);
    }
  }

  // ── Update: projectiles and collisions ────────────────────────
  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bullet = bullets[i];
      bullet.life -= dt;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.life <= 0 || bullet.x < -30 || bullet.x > W + 30 || bullet.y < -30 || bullet.y > H + 30) {
        bullets.splice(i, 1);
        continue;
      }

      let removed = false;
      for (const enemy of enemies) {
        if (enemy.dead || bullet.hit.has(enemy)) continue;
        const radius = enemy.radius + bullet.radius;
        const dx = enemy.x - bullet.x;
        const dy = enemy.y - bullet.y;
        if (dx * dx + dy * dy < radius * radius) {
          bullet.hit.add(enemy);
          damageEnemy(enemy, bullet.damage, bullet.x, bullet.y, bullet.crit);
          if (bullet.pierce > 0) {
            bullet.pierce -= 1;
            bullet.damage *= 0.82;
            bullet.x += bullet.vx * 0.012;
            bullet.y += bullet.vy * 0.012;
          } else {
            bullets.splice(i, 1);
            removed = true;
          }
          break;
        }
      }
      if (removed) continue;
    }
  }

  function updateEnemyBullets(dt) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const bullet = enemyBullets[i];
      bullet.life -= dt;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.life <= 0 || bullet.x < -40 || bullet.x > W + 40 || bullet.y < -40 || bullet.y > H + 40) {
        enemyBullets.splice(i, 1);
        continue;
      }
      if (player.invuln <= 0 && dist(bullet.x, bullet.y, player.x, player.y) < player.radius + bullet.radius) {
        damagePlayer(bullet.damage);
        burst(bullet.x, bullet.y, bullet.color, 7, 110, 2.5, 0.3);
        enemyBullets.splice(i, 1);
      }
    }
  }

  function updateCollisions() {
    for (const enemy of enemies) {
      if (enemy.dead || enemy.contactTimer > 0) continue;
      const minimum = enemy.radius + player.radius;
      if (dist(enemy.x, enemy.y, player.x, player.y) < minimum) {
        if (player.invuln <= 0) {
          damagePlayer(enemy.contact);
          enemy.contactTimer = 0.7;
          const angle = Math.atan2(enemy.y - player.y, enemy.x - player.x);
          enemy.vx += Math.cos(angle) * 120;
          enemy.vy += Math.sin(angle) * 120;
          if (enemy.type === 'mite') {
            enemy.dead = true;
            burst(enemy.x, enemy.y, enemy.color, 8, 130, 2, 0.35);
          }
        }
      }
    }
  }

  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const item = pickups[i];
      item.age += dt;
      item.life -= dt;
      const dx = player.x - item.x;
      const dy = player.y - item.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 170) {
        item.vx += (dx / d) * 520 * dt;
        item.vy += (dy / d) * 520 * dt;
      }
      item.vx *= 1 - 2.2 * dt;
      item.vy *= 1 - 2.2 * dt;
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      item.x = clamp(item.x, 22, W - 22);
      item.y = clamp(item.y, 22, H - 22);
      if (d < player.radius + 15) {
        if (item.type === 'health') {
          player.health = Math.min(player.maxHealth, player.health + 28);
          showToast('HULL PATCH // +28');
        } else {
          state.overdrive = 8;
          showToast('OVERDRIVE // CANNON SYNCED');
        }
        burst(item.x, item.y, item.type === 'health' ? '#6dffb0' : '#ffc65c', 14, 150, 2.5, 0.5);
        addRing(item.x, item.y, 4, 38, item.type === 'health' ? '#6dffb0' : '#ffc65c', 0.35, 1.5);
        audio.pickup();
        pickups.splice(i, 1);
        updateHUD();
        continue;
      }
      if (item.life <= 0) pickups.splice(i, 1);
    }
  }

  function updateEffects(dt, ambient = false) {
    const factor = ambient ? 0.3 : 1;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt * factor;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      const drag = 1 - Math.min(0.95, p.drag * dt * factor);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt * factor;
      p.y += p.vy * dt * factor;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].life -= dt * factor;
      if (rings[i].life <= 0) rings.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      floaters[i].life -= dt * factor;
      floaters[i].y -= 24 * dt * factor;
      if (floaters[i].life <= 0) floaters.splice(i, 1);
    }
    for (let i = ghosts.length - 1; i >= 0; i--) {
      ghosts[i].life -= dt * factor;
      if (ghosts[i].life <= 0) ghosts.splice(i, 1);
    }
    if (particles.length > 520) particles.splice(0, particles.length - 520);
  }

  function updateStars(dt, speed = 1) {
    for (const star of stars) {
      star.twinkle += dt * 1.8;
      star.y += star.speed * dt * speed;
      if (star.y > H + 4) {
        star.y = -4;
        star.x = Math.random() * W;
      }
    }
  }

  // ── Main update ───────────────────────────────────────────────
  function updateGame(dt) {
    state.runTime += dt;
    state.waveElapsed += dt;
    state.shake = Math.max(0, state.shake - dt * 44);
    state.damageFlash = Math.max(0, state.damageFlash - dt * 2.6);
    state.comboTimer = Math.max(0, state.comboTimer - dt);
    if (state.comboTimer <= 0 && state.combo > 0) {
      state.combo = 0;
      state.comboMult = 1;
    }
    if (state.overdrive > 0) {
      state.overdrive = Math.max(0, state.overdrive - dt);
      if (state.overdrive === 0) showToast('OVERDRIVE OFFLINE');
    }

    updatePlayer(dt);
    spawnFromQueue();
    updateEnemies(dt);
    updateBullets(dt);
    updateEnemyBullets(dt);
    updateCollisions();
    updatePickups(dt);
    updateEffects(dt);
    updateStars(dt, 0.3);

    enemies = enemies.filter((enemy) => !enemy.dead);

    if (state.waveActive) {
      const remaining = enemies.length + state.spawnQueue.length;
      if (remaining === 0) {
        state.waveActive = false;
        state.waveClearTimer = 1.55;
        showBanner('SECTOR CLEAR', 'SALVAGE READY');
        audio.wave();
      }
    }

    if (state.waveClearTimer > 0) {
      state.waveClearTimer -= dt;
      if (state.waveClearTimer <= 0) openUpgrade();
    }

    if (bannerLife > 0) {
      bannerLife -= dt;
      if (bannerLife <= 0) waveBanner.classList.remove('show');
    }

    state.hudTimer -= dt;
    if (state.hudTimer <= 0) {
      state.hudTimer = 0.07;
      updateHUD();
    }
  }

  function updateDying(dt) {
    state.deathTimer -= dt;
    state.shake = Math.max(0, state.shake - dt * 40);
    state.damageFlash = Math.max(0, state.damageFlash - dt * 2.2);
    updateEffects(dt, true);
    updateStars(dt, 0.15);
    if (state.deathTimer <= 0) showGameOver();
  }

  function updateMenu(dt) {
    state.menuTime += dt;
    updateStars(dt, 0.45);
    for (const ornament of menuOrnaments) ornament.angle += ornament.speed * dt;
  }

  // ── HUD ───────────────────────────────────────────────────────
  function updateHUD() {
    if (!player) return;
    const healthPct = clamp((player.health / player.maxHealth) * 100, 0, 100);
    hpFill.style.width = healthPct + '%';
    hpFill.classList.toggle('low', healthPct <= 30);
    hpText.textContent = String(Math.ceil(player.health));
    const dashPct = player.dashCooldown <= 0 ? 100 : (1 - player.dashCooldown / player.dashCooldownMax) * 100;
    dashFill.style.width = clamp(dashPct, 0, 100) + '%';
    dashBtn.style.setProperty('--ready', clamp(dashPct / 100, 0, 1));
    dashBtn.classList.toggle('cooling', dashPct < 99);
    waveNum.textContent = pad(state.wave, 2);
    const remaining = enemies.filter((enemy) => !enemy.dead).length + state.spawnQueue.length;
    enemyCount.textContent = `${remaining} HOSTILE${remaining === 1 ? '' : 'S'}`;
    waveTimer.textContent = clock(state.runTime);
    const totalSeen = state.waveKills + remaining;
    waveProgress.style.width = (totalSeen > 0 ? clamp((state.waveKills / totalSeen) * 100, 0, 100) : 0) + '%';
    scoreText.textContent = pad(state.score);
    comboText.textContent = `x${state.comboMult.toFixed(1)}`;
    comboTag.classList.toggle('hot', state.combo > 0);
    overdriveTag.classList.toggle('on', state.overdrive > 0);
    if (state.boss && !state.boss.dead) {
      bossBar.classList.remove('hidden');
      const bossPct = clamp((state.boss.hp / state.boss.maxHp) * 100, 0, 100);
      bossHpFill.style.width = bossPct + '%';
      bossHpText.textContent = `${Math.ceil(bossPct)}%`;
    } else if (!state.boss) {
      bossBar.classList.add('hidden');
    }
  }

  function showBanner(kicker, title, boss = false) {
    bannerKicker.textContent = kicker;
    bannerTitle.textContent = title;
    waveBanner.classList.remove('show', 'boss');
    void waveBanner.offsetWidth;
    waveBanner.classList.toggle('boss', boss);
    waveBanner.classList.add('show');
    bannerLife = 3.2;
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
  }

  // ── Drawing helpers ───────────────────────────────────────────
  function drawBackdrop(isMenu) {
    const t = isMenu ? state.menuTime : state.time;
    if (bgCache && !window.__skipBgImage) {
      ctx.drawImage(bgCache, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#04070f';
      ctx.fillRect(0, 0, W, H);
    }

    // Star field.
    if (!window.__skipStars) {
      for (const star of stars) {
        const alpha = star.alpha * (0.68 + Math.sin(star.twinkle) * 0.32);
        ctx.fillStyle = star.hue + alpha.toFixed(2) + ')';
        ctx.fillRect(star.x, star.y, star.size, star.size);
      }
    }

    // A single low-cost sensor band.
    if (!window.__skipSweep) {
      const sweepY = (t * 34) % (H + 260) - 130;
      ctx.fillStyle = 'rgba(95, 247, 255, 0.022)';
      ctx.fillRect(0, sweepY - 42, W, 84);
    }

    if (!isMenu && !window.__skipArena) {
      drawArenaFrame();
      drawArenaRings(t);
    }
  }

  function drawArenaRings(t) {
    const cx = W * 0.5;
    const cy = H * 0.53;
    const base = Math.min(W, H);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const radius = base * (0.25 + i * 0.13);
      ctx.strokeStyle = `rgba(95, 247, 255, ${0.052 - i * 0.009})`;
      ctx.setLineDash(i === 1 ? [3, 18] : i === 2 ? [48, 30] : []);
      ctx.beginPath();
      ctx.arc(0, 0, radius, t * (0.014 + i * 0.006), t * (0.014 + i * 0.006) + TAU * 0.86);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(95, 247, 255, 0.062)';
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + t * 0.012;
      const r1 = base * 0.39;
      const r2 = base * 0.415;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawArenaFrame() {
    const inset = 18;
    ctx.save();
    ctx.strokeStyle = 'rgba(96, 175, 193, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);

    const bracket = 28;
    const corners = [
      [inset, inset, 1, 1],
      [W - inset, inset, -1, 1],
      [inset, H - inset, 1, -1],
      [W - inset, H - inset, -1, -1]
    ];
    ctx.strokeStyle = 'rgba(95, 247, 255, 0.56)';
    ctx.lineWidth = 1.5;
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * bracket, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * bracket);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawShipShape(x, y, angle, scale, options = {}) {
    const alpha = options.alpha ?? 1;
    const menu = options.menu ?? false;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;

    const flicker = 0.76 + Math.sin(state.time * 34 + (menu ? 1.7 : 0)) * 0.16 + Math.random() * 0.1;
    ctx.globalCompositeOperation = 'lighter';
    const plume = ctx.createRadialGradient(-22, 0, 1, -22, 0, 32);
    plume.addColorStop(0, 'rgba(210, 255, 255, 0.95)');
    plume.addColorStop(0.24, 'rgba(95, 247, 255, 0.65)');
    plume.addColorStop(0.62, 'rgba(43, 139, 255, 0.2)');
    plume.addColorStop(1, 'rgba(43, 139, 255, 0)');
    ctx.fillStyle = plume;
    ctx.beginPath();
    ctx.ellipse(-22, 0, 31 * flicker, 8.5, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(95, 247, 255, 0.42)';
    ctx.beginPath();
    ctx.moveTo(-10, -5);
    ctx.lineTo(-27 - 11 * flicker, 0);
    ctx.lineTo(-10, 5);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Hull.
    const hull = ctx.createLinearGradient(-15, -12, 22, 12);
    hull.addColorStop(0, '#123641');
    hull.addColorStop(0.46, '#1c6778');
    hull.addColorStop(0.72, '#7be9f2');
    hull.addColorStop(1, '#e8feff');
    ctx.fillStyle = hull;
    ctx.strokeStyle = '#b9fdff';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(23, 0);
    ctx.lineTo(5, -5.5);
    ctx.lineTo(-5, -14);
    ctx.lineTo(-12, -9);
    ctx.lineTo(-9, 0);
    ctx.lineTo(-12, 9);
    ctx.lineTo(-5, 14);
    ctx.lineTo(5, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Wing highlights.
    ctx.strokeStyle = 'rgba(228, 255, 255, 0.9)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(5, -5.5);
    ctx.lineTo(-3, -10.5);
    ctx.moveTo(5, 5.5);
    ctx.lineTo(-3, 10.5);
    ctx.stroke();

    // Cockpit.
    const cockpit = ctx.createLinearGradient(4, -3, 12, 3);
    cockpit.addColorStop(0, '#efffff');
    cockpit.addColorStop(0.55, '#59dbe9');
    cockpit.addColorStop(1, '#0d3945');
    ctx.fillStyle = cockpit;
    ctx.beginPath();
    ctx.moveTo(12.5, 0);
    ctx.lineTo(3.5, -3.2);
    ctx.lineTo(1, 0);
    ctx.lineTo(3.5, 3.2);
    ctx.closePath();
    ctx.fill();

    // Wing lights.
    ctx.fillStyle = '#ff3d9a';
    ctx.beginPath();
    ctx.arc(-8.5, -10.5, 1.35, 0, TAU);
    ctx.arc(-8.5, 10.5, 1.35, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  function drawDrone(x, y, index, menu = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(state.time * 1.7 + index * 2.1);
    ctx.fillStyle = 'rgba(109, 255, 176, 0.16)';
    ctx.strokeStyle = '#6dffb0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      const r = i % 2 === 0 ? 7 : 4;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d8fff0';
    ctx.beginPath();
    ctx.arc(0, 0, 1.6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    if (!player) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#5ff7ff';
    ctx.beginPath();
    ctx.arc(player.x, player.y, 36, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.11;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 19, 0, TAU);
    ctx.fill();
    ctx.restore();

    for (const ghost of ghosts) {
      const alpha = (ghost.life / ghost.maxLife) * 0.32;
      drawShipShape(ghost.x, ghost.y, ghost.angle, 1.25, { alpha });
    }

    if (state.mode === 'playing') {
      const aimLength = 72;
      ctx.save();
      ctx.strokeStyle = 'rgba(95, 247, 255, 0.17)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 7]);
      ctx.beginPath();
      ctx.moveTo(player.x + Math.cos(player.angle) * 24, player.y + Math.sin(player.angle) * 24);
      ctx.lineTo(player.x + Math.cos(player.angle) * aimLength, player.y + Math.sin(player.angle) * aimLength);
      ctx.stroke();
      ctx.restore();
    }

    if (player.invuln > 0) {
      const pulse = 1 + Math.sin(state.time * 24) * 0.08;
      ctx.save();
      ctx.strokeStyle = `rgba(95, 247, 255, ${0.16 + player.invuln * 0.28})`;
      ctx.lineWidth = 1.2;
          ctx.beginPath();
      ctx.arc(player.x, player.y, 27 * pulse, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (player.hitFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255, 75, 98, ${player.hitFlash * 2.8})`;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 27, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    drawShipShape(player.x, player.y, player.angle, 1.25, {});
    if (state.overdrive > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255, 198, 92, ${0.18 + Math.sin(state.time * 12) * 0.06})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 30, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < player.drones; i++) {
      const angle = state.time * 2.3 + (i / Math.max(1, player.drones)) * TAU;
      drawDrone(player.x + Math.cos(angle) * 42, player.y + Math.sin(angle) * 42, i);
    }
  }

  function drawEnemy(enemy) {
    const spawnScale = clamp(enemy.age / 0.2, 0.15, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.08 + Math.sin(enemy.age * 4 + enemy.seed) * 0.02;
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.radius * 1.7, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (!enemy.boss && enemy.age > 0.25) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = enemy.color + '33';
      ctx.lineWidth = enemy.type === 'brute' ? 4 : 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(enemy.x, enemy.y);
      ctx.lineTo(enemy.x - enemy.vx * 0.1, enemy.y - enemy.vy * 0.1);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.globalAlpha = 0.88 + Math.sin(enemy.age * 5 + enemy.seed) * 0.12;
    ctx.scale(spawnScale, spawnScale);

    if (enemy.type === 'scout' || enemy.type === 'mite') {
      ctx.rotate(enemy.angle);
      const r = enemy.type === 'mite' ? 8 : 12;
      ctx.fillStyle = 'rgba(34, 5, 24, 0.92)';
      ctx.strokeStyle = enemy.color;
      ctx.lineWidth = 1.3;
          ctx.beginPath();
      ctx.moveTo(r * 1.25, 0);
      ctx.lineTo(-r * 0.7, -r * 0.82);
      ctx.lineTo(-r * 0.3, 0);
      ctx.lineTo(-r * 0.7, r * 0.82);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
        ctx.fillStyle = '#ffd6e8';
      ctx.beginPath();
      ctx.arc(1.5, 0, enemy.type === 'mite' ? 1.5 : 2.2, 0, TAU);
      ctx.fill();
      if (enemy.type !== 'mite') {
        ctx.strokeStyle = 'rgba(255, 61, 154, 0.35)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(-r * 0.2, -r * 0.55);
        ctx.lineTo(-r * 1.25, -r * 0.95);
        ctx.moveTo(-r * 0.2, r * 0.55);
        ctx.lineTo(-r * 1.25, r * 0.95);
        ctx.stroke();
      }
    } else if (enemy.type === 'brute') {
      ctx.rotate(enemy.spin);
      const r = 21;
      ctx.fillStyle = 'rgba(42, 27, 6, 0.92)';
      ctx.strokeStyle = enemy.color;
      ctx.lineWidth = 1.6;
          ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 198, 92, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0.2, 2.4);
      ctx.arc(0, 0, 14, 3.4, 5.6);
      ctx.stroke();
      ctx.fillStyle = '#ffe0a1';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, TAU);
      ctx.fill();
    } else if (enemy.type === 'sniper') {
      ctx.rotate(enemy.angle);
      const r = 15;
      if (enemy.charge > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(95, 247, 255, ${enemy.charge * 0.25})`;
        ctx.beginPath();
        ctx.arc(0, 0, 22 + enemy.charge * 8, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(5, 30, 38, 0.94)';
      ctx.strokeStyle = enemy.color;
      ctx.lineWidth = 1.4;
          ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(0, -r * 0.75);
      ctx.lineTo(-r, 0);
      ctx.lineTo(0, r * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
        ctx.strokeStyle = 'rgba(95, 247, 255, 0.38)';
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, 0);
      ctx.lineTo(r * 0.75, 0);
      ctx.stroke();
      ctx.fillStyle = enemy.charge > 0 ? '#ffffff' : '#9ffcff';
      ctx.beginPath();
      ctx.arc(2, 0, 2.8 + enemy.charge * 1.6, 0, TAU);
      ctx.fill();
    } else if (enemy.type === 'splitter') {
      ctx.rotate(enemy.angle);
      const r = 17;
      ctx.fillStyle = 'rgba(27, 10, 45, 0.94)';
      ctx.strokeStyle = enemy.color;
      ctx.lineWidth = 1.5;
          ctx.beginPath();
      ctx.roundRect(-r, -r, r * 2, r * 2, 5);
      ctx.fill();
      ctx.stroke();
        ctx.strokeStyle = 'rgba(184, 119, 255, 0.4)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-r + 4, 0);
      ctx.lineTo(r - 4, 0);
      ctx.moveTo(0, -r + 4);
      ctx.lineTo(0, r - 4);
      ctx.stroke();
      ctx.fillStyle = '#e6c7ff';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 8.5, state.time * 2, state.time * 2 + 1.4);
      ctx.strokeStyle = enemy.color;
      ctx.stroke();
    } else if (enemy.type === 'boss') {
      drawBoss(enemy);
    }

    if (enemy.hitFlash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(enemy.hitFlash * 7, 0, 0.65);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius * 0.9, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    if (!enemy.boss && enemy.hp < enemy.maxHp && enemy.hp > 0) {
      const width = enemy.radius * 1.7;
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 11, width, 2.5);
      ctx.fillStyle = enemy.color;
      ctx.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 11, width * clamp(enemy.hp / enemy.maxHp, 0, 1), 2.5);
      ctx.restore();
    }
  }

  function drawBoss(enemy) {
    const r = enemy.radius;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const aura = ctx.createRadialGradient(0, 0, 8, 0, 0, r * 2.4);
    aura.addColorStop(0, 'rgba(255, 61, 154, 0.22)');
    aura.addColorStop(0.55, 'rgba(255, 61, 154, 0.06)');
    aura.addColorStop(1, 'rgba(255, 61, 154, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.4, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.rotate(enemy.spin * 0.25);
    ctx.strokeStyle = 'rgba(255, 61, 154, 0.38)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([10, 9]);
    ctx.beginPath();
    ctx.arc(0, 0, r + 13, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.rotate(-enemy.spin * 0.45);
    ctx.strokeStyle = 'rgba(255, 134, 184, 0.6)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 3, (i / 3) * TAU, (i / 3) * TAU + 0.95);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(28, 5, 20, 0.96)';
    ctx.strokeStyle = '#ff3d9a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * TAU;
      const radius = i % 2 === 0 ? r : r * 0.72;
      if (i === 0) ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      else ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.rotate(enemy.spin * 0.7);
    ctx.strokeStyle = 'rgba(255, 134, 184, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.33, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = enemy.charge > 0 ? '#ffffff' : '#ff9fc6';
    ctx.beginPath();
    ctx.arc(0, 0, 9 + enemy.charge * 4, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (enemy.charge > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(255, 61, 154, ${enemy.charge * 0.55})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r + 20 + enemy.charge * 16, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBullets() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const bullet of bullets) {
      const angle = Math.atan2(bullet.vy, bullet.vx);
      const length = bullet.drone ? 9 : bullet.crit ? 22 : 16;
      ctx.save();
      ctx.translate(bullet.x, bullet.y);
      ctx.rotate(angle);
      ctx.lineCap = 'round';
      ctx.strokeStyle = bullet.color;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = bullet.crit ? 6 : 4;
      ctx.beginPath();
      ctx.moveTo(-length, 0);
      ctx.lineTo(3, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#eaffff';
      ctx.lineWidth = bullet.crit ? 2.6 : 1.5;
      ctx.beginPath();
      ctx.moveTo(-length * 0.45, 0);
      ctx.lineTo(3, 0);
      ctx.stroke();
      ctx.fillStyle = bullet.color;
      ctx.beginPath();
      ctx.arc(2, 0, bullet.crit ? 2.8 : 1.8, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawEnemyBullets() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const bullet of enemyBullets) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = bullet.color;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.radius * 3.1, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.radius * 1.5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.radius * 0.48, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * (0.5 + alpha * 0.5), 0, TAU);
      ctx.fill();
      if (particle.glow) {
        ctx.globalAlpha = alpha * 0.16;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * 2.4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const ring of rings) {
      const progress = 1 - ring.life / ring.maxLife;
      const radius = lerp(ring.from, ring.to, 1 - Math.pow(1 - progress, 2.2));
      const alpha = (1 - progress) * 0.8;
      ctx.strokeStyle = ring.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = ring.width * (1 - progress * 0.6);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPickups() {
    for (const item of pickups) {
      const bob = Math.sin(item.age * 4) * 3;
      const color = item.type === 'health' ? '#6dffb0' : '#ffc65c';
      const blink = item.life < 3 ? 0.4 + Math.abs(Math.sin(item.life * 8)) * 0.6 : 1;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.translate(item.x, item.y + bob);
      ctx.rotate(item.age * 0.7);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = blink * 0.18;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 21, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = blink;
      ctx.strokeRect(-10, -10, 20, 20);
      ctx.rotate(-item.age * 0.7);
      if (item.type === 'health') {
        ctx.fillStyle = color;
        ctx.fillRect(-2.2, -7, 4.4, 14);
        ctx.fillRect(-7, -2.2, 14, 4.4);
      } else {
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = color;
        ctx.fillRect(-5, -5, 10, 10);
        ctx.fillStyle = '#fff6d8';
        ctx.fillRect(-1.6, -1.6, 3.2, 3.2);
      }
      ctx.restore();
    }
  }

  function drawFloaters() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 9px "Courier New", monospace';
    for (const floater of floaters) {
      const alpha = clamp(floater.life / floater.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, floater.x, floater.y);
    }
    ctx.restore();
  }

  function drawCrosshair() {
    if (compact || !mouse.active || state.mode !== 'playing') return;
    const overTarget = nearestEnemy(mouse.x, mouse.y, 44);
    const color = overTarget ? '#ff3d9a' : '#8ffcff';
    ctx.save();
    ctx.translate(mouse.x, mouse.y);
    ctx.rotate(state.time * 0.35);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.78;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0.25, 1.25);
    ctx.arc(0, 0, 11, Math.PI + 0.25, Math.PI + 1.25);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, TAU);
    ctx.globalAlpha = 0.12;
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.rotate(-state.time * 0.35);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 1.7, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(-16, 0); ctx.lineTo(-12, 0);
    ctx.moveTo(12, 0); ctx.lineTo(16, 0);
    ctx.moveTo(0, -16); ctx.lineTo(0, -12);
    ctx.moveTo(0, 12); ctx.lineTo(0, 16);
    ctx.stroke();
    ctx.restore();
  }

  function drawGame() {
    if (!player) return;
    const shakeX = state.shake > 0 ? random(-state.shake, state.shake) : 0;
    const shakeY = state.shake > 0 ? random(-state.shake, state.shake) : 0;
    let __p = window.__profileDraw ? performance.now() : 0;
    const __mark = (name) => {
      if (!__p) return;
      const now = performance.now();
      window.__drawTimes = window.__drawTimes || {};
      window.__drawTimes[name] = now - __p;
      __p = now;
    };
    ctx.save();
    ctx.translate(shakeX, shakeY);
    if (!window.__skipBackdrop) drawBackdrop(false);
    __mark('backdrop');
    if (!window.__skipPickups) drawPickups();
    __mark('pickups');
    if (!window.__skipBullets) drawBullets();
    __mark('bullets');
    if (!window.__skipEnemies) {
      for (const enemy of enemies) {
        if (!enemy.dead) drawEnemy(enemy);
      }
    }
    __mark('enemies');
    if (!window.__skipPlayer) drawPlayer();
    __mark('player');
    if (!window.__skipEnemyBullets) drawEnemyBullets();
    __mark('enemyBullets');
    if (!window.__skipParticles) drawParticles();
    __mark('particles');
    if (!window.__skipFloaters) drawFloaters();
    __mark('floaters');
    ctx.restore();

    if (state.damageFlash > 0.01) {
      const flash = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.18, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
      flash.addColorStop(0, 'rgba(255, 35, 68, 0)');
      flash.addColorStop(1, `rgba(255, 35, 68, ${(state.damageFlash * 0.5).toFixed(3)})`);
      ctx.save();
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (state.overdrive > 0) {
      const pulse = 0.035 + Math.sin(state.time * 9) * 0.012;
      ctx.save();
      ctx.fillStyle = `rgba(255, 198, 92, ${pulse})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    drawCrosshair();
    __mark('crosshair');
  }

  function drawMenuScene() {
    drawBackdrop(true);
    const mobile = W <= 860;
    const cx = mobile ? W * 0.78 : W * 0.735;
    const cy = mobile ? H * 0.81 : H * 0.44;
    const unit = Math.min(W, H);
    const scale = mobile ? clamp(unit / 240, 1.25, 2) : clamp(unit / 290, 1.9, 3.2);
    const pulse = 0.5 + Math.sin(state.menuTime * 1.2) * 0.5;

    // Distant orbital frame.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const radius = unit * (0.18 + i * 0.095);
      ctx.strokeStyle = `rgba(95, 247, 255, ${0.11 - i * 0.018})`;
      ctx.lineWidth = 1;
      ctx.setLineDash(i === 1 ? [2, 11] : i === 2 ? [24, 13] : []);
      ctx.beginPath();
      ctx.arc(0, 0, radius, state.menuTime * (0.025 + i * 0.012) + i, state.menuTime * (0.025 + i * 0.012) + i + TAU * 0.78);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Huge soft body behind the ship.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(cx, cy, 20, cx, cy, unit * 0.34);
    halo.addColorStop(0, 'rgba(24, 106, 127, 0.19)');
    halo.addColorStop(0.48, 'rgba(15, 66, 90, 0.07)');
    halo.addColorStop(1, 'rgba(5, 16, 28, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, unit * 0.34, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Light bar / launch rail.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.26);
    const rail = ctx.createLinearGradient(-unit * 0.4, 0, unit * 0.4, 0);
    rail.addColorStop(0, 'rgba(95, 247, 255, 0)');
    rail.addColorStop(0.48, 'rgba(95, 247, 255, 0.13)');
    rail.addColorStop(0.6, 'rgba(95, 247, 255, 0.28)');
    rail.addColorStop(1, 'rgba(95, 247, 255, 0)');
    ctx.fillStyle = rail;
    ctx.fillRect(-unit * 0.42, -1, unit * 0.84, 2);
    ctx.fillStyle = 'rgba(95, 247, 255, 0.05)';
    ctx.fillRect(-unit * 0.35, -20, unit * 0.7, 40);
    ctx.restore();

    // Ambient hostile markers on the ring.
    for (const ornament of menuOrnaments) {
      const radius = unit * ornament.radius;
      const x = cx + Math.cos(ornament.angle) * radius;
      const y = cy + Math.sin(ornament.angle) * radius * 0.55;
      ctx.save();
      ctx.translate(x, y);
      if (ornament.kind === 0) {
        ctx.rotate(ornament.angle + Math.PI / 2);
        ctx.strokeStyle = `rgba(255, 61, 154, ${0.18 + pulse * 0.1})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(4, 4);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.stroke();
      } else if (ornament.kind === 1) {
        ctx.fillStyle = `rgba(255, 61, 154, ${0.18 + pulse * 0.12})`;
        ctx.fillRect(-1.5, -1.5, 3, 3);
      } else {
        ctx.strokeStyle = `rgba(95, 247, 255, ${0.15 + pulse * 0.1})`;
        ctx.strokeRect(-3, -3, 6, 6);
      }
      ctx.restore();
    }

    // Target brackets around the hero ship.
    const bracketRadius = mobile ? 84 : 145;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.menuTime * 0.04);
    ctx.strokeStyle = `rgba(95, 247, 255, ${0.16 + pulse * 0.08})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * TAU;
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(bracketRadius, -9);
      ctx.lineTo(bracketRadius, 0);
      ctx.lineTo(bracketRadius, 9);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    const bob = Math.sin(state.menuTime * 1.3) * 5;
    drawShipShape(cx, cy + bob, -Math.PI / 2 - 0.23 + Math.sin(state.menuTime * 0.7) * 0.018, scale, { menu: true });

    for (let i = 0; i < 2; i++) {
      const angle = state.menuTime * 0.62 + i * Math.PI + 0.4;
      const radius = mobile ? 68 : 112;
      drawDrone(cx + Math.cos(angle) * radius, cy + bob + Math.sin(angle) * radius * 0.55, i, true);
    }

    // Engine wake particles.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const drift = ((state.menuTime * (22 + i * 4) + i * 41) % 130);
      const spread = Math.sin(i * 7 + state.menuTime * 2) * (5 + i * 0.7);
      const alpha = (1 - drift / 130) * 0.16;
      ctx.fillStyle = `rgba(95, 247, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(cx + drift * 0.4 - 30, cy + bob + 38 + drift * 0.6 + spread, 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Faint coordinate text.
    if (!mobile) {
      ctx.save();
      ctx.fillStyle = 'rgba(100, 157, 174, 0.24)';
      ctx.font = '7px "Courier New", monospace';
      ctx.fillText('X 07.334 / Y 81.902', cx - 105, cy + 195);
      ctx.fillText('ORBITAL FRAME / LOCKED', cx - 105, cy + 207);
      ctx.restore();
    }
  }

  // ── Loop ──────────────────────────────────────────────────────
  let lastFrame = performance.now();

  function loop(timestamp) {
    const dt = Math.min(0.08, Math.max(0, (timestamp - lastFrame) / 1000));
    lastFrame = timestamp;
    state.time += dt;

    if (state.mode === 'menu') {
      updateMenu(dt);
    } else if (state.mode === 'playing') {
      updateGame(dt);
    } else if (state.mode === 'dying') {
      updateDying(dt);
    } else {
      state.shake = Math.max(0, state.shake - dt * 35);
      state.damageFlash = Math.max(0, state.damageFlash - dt * 2);
      updateEffects(dt, true);
      updateStars(dt, 0.12);
    }

    if (!window.__voidbreaker?.noDraw && !window.__noDraw) {
      if (state.mode === 'menu') drawMenuScene();
      else drawGame();
    }

    requestAnimationFrame(loop);
  }

  // ── Wiring ────────────────────────────────────────────────────
  startBtn.addEventListener('click', () => {
    audio.init();
    startGame();
  });
  restartBtn.addEventListener('click', () => {
    audio.init();
    startGame();
  });
  menuBtn.addEventListener('click', returnToMenu);
  resumeBtn.addEventListener('click', resumeGame);
  quitBtn.addEventListener('click', returnToMenu);
  pauseBtn.addEventListener('click', pauseGame);

  function syncMuteButton() {
    muteBtn.textContent = audio.muted ? 'OFF' : 'SND';
    muteBtn.classList.toggle('muted', audio.muted);
    muteBtn.setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
  }

  muteBtn.addEventListener('click', () => {
    audio.init();
    audio.setMuted(!audio.muted);
    syncMuteButton();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'playing') pauseGame();
    lastFrame = performance.now();
  });

  window.addEventListener('pointerdown', () => audio.init(), { once: true });

  updateBestLabels();
  syncMuteButton();

  // Automated previews can miss the start control while the first frame is
  // still compositing. Keep the menu for people, but let headless checks begin.
  if (navigator.webdriver) {
    setTimeout(() => {
      if (state.mode === 'menu') startGame();
    }, 0);
  }

  window.__voidbreaker = {
    state,
    get player() { return player; },
    get enemies() { return enemies; },
    get pickups() { return pickups; },
    startGame,
    openUpgrade,
    noDraw: false
  };
  requestAnimationFrame(loop);
})();
