(function () {
  'use strict';
  const MG = window.MG = window.MG || {};
  MG.clamp = function (value, min, max) { return Math.max(min, Math.min(max, value)); };
  MG.exp = function (rate, dt) { return 1 - Math.exp(-rate * dt); };
  MG.angleDelta = function (a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); };
  const $ = id => document.getElementById(id);
  const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 20)));
  const defaults = { shadowQuality: 'low', fov: 70, sensitivity: 1, volume: .45, drawDistance: 220 };

  MG.Game = class Game {
    constructor() {
      this.time = 0; this.frame = 0; this.fps = 60;
      this.started = false; this.paused = false; this.ready = false;
      this.night = false; this.deathTimer = 0;
      this.keys = new Set(); this.pressed = new Set();
      this.mouse = { fire: false, orbit: false, x: innerWidth / 2, y: innerHeight / 2 };
      this.settings = Object.assign({}, defaults);
      try {
        const saved = JSON.parse(localStorage.getItem('marikina-gta-settings') || '{}');
        this.settings.shadowQuality = ['off', 'low', 'high'].includes(saved.shadowQuality) ? saved.shadowQuality : defaults.shadowQuality;
        ['fov', 'sensitivity', 'volume', 'drawDistance'].forEach(key => {
          if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) this.settings[key] = saved[key];
        });
        this.settings.fov = MG.clamp(this.settings.fov, 60, 90);
        this.settings.sensitivity = MG.clamp(this.settings.sensitivity, .2, 3);
        this.settings.volume = MG.clamp(this.settings.volume, 0, 1);
        this.settings.drawDistance = MG.clamp(this.settings.drawDistance, 100, 350);
      } catch (_) { /* File URLs and private browser windows may restrict storage. */ }
      this.lastFrame = performance.now();
      this.frameCallback = this.loop.bind(this);
    }
    loading(progress, text) {
      if ($('loadingProgress')) $('loadingProgress').style.width = (progress * 100) + '%';
      if ($('loadingStatus')) $('loadingStatus').textContent = text;
    }
    async init() {
      if (!window.THREE) throw new Error('Three.js could not load. Connect to the internet and reload to reach cdnjs.cloudflare.com.');
      this.loading(.03, 'Preparing Marikina…');
      await nextPaint();
      this.scene = new THREE.Scene();
      this.scene.background = MG.srgb(0x87ceeb);
      this.scene.fog = new THREE.FogExp2(MG.srgb(0x87ceeb), .003);
      this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, .1, 1000);
      this.renderer = new THREE.WebGLRenderer({ canvas: $('gameCanvas'), antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      this.renderer.setSize(innerWidth, innerHeight);
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = .95;
      this.renderer.shadowMap.enabled = this.settings.shadowQuality !== 'off';
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.hemisphere = new THREE.HemisphereLight(MG.srgb(0xc6e8ff), MG.srgb(0xb79978), .35);
      this.sun = new THREE.DirectionalLight(MG.srgb(0xffd3a0), 1.2);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      Object.assign(this.sun.shadow.camera, { left: -65, right: 65, top: 65, bottom: -65, near: 1, far: 260 });
      // Without this the default 10 unit frustum is kept and nothing is shadowed.
      this.sun.shadow.camera.updateProjectionMatrix();
      this.sun.shadow.bias = -.0005; this.sun.shadow.normalBias = .035;
      this.scene.add(this.hemisphere, this.sun, this.sun.target);
      this.audio = new MG.Audio(this);
      this.hud = new MG.HUD(this);
      this.world = new MG.World(this);
      /* The map is downloaded from OpenStreetMap at runtime, so the city build
       * is now asynchronous and reports its own progress. */
      this.loading(.12, 'Building city…');
      await nextPaint();
      await this.world.init((text, progress) => {
        this.loading(.12 + (progress || 0) * .34, text);
      });
      this.player = new MG.Player(this);
      this.player.init();
      this.loading(.48, 'Placing vehicles…');
      await nextPaint();
      this.vehicles = new MG.Vehicles(this); this.vehicles.init();
      this.loading(.67, 'Spawning NPCs…');
      await nextPaint();
      this.npcs = new MG.NPCs(this); this.npcs.init();
      this.police = new MG.Police(this); this.police.init();
      this.combat = new MG.Combat(this); this.combat.init();
      this.hud.init();
      this.bindInputs(); this.bindSettings(); this.applySettings();
      this.loading(.88, 'Starting engine…');
      await nextPaint();
      this.updateLighting();
      this.world.update(0);
      this.menuCamera(0);
      this.renderer.compile(this.scene, this.camera);
      this.renderer.render(this.scene, this.camera);
      this.ready = true;
      this.loading(1, 'Welcome to the Shoe Capital.');
      await nextPaint();
      $('loading').classList.add('loaded');
      setTimeout(() => $('loading').classList.add('hidden'), 650);
      $('menu').classList.remove('hidden');
      this.lastFrame = performance.now();
      requestAnimationFrame(this.frameCallback);
    }
    focusPosition() { return this.player ? (this.player.vehicle ? this.player.vehicle.position : this.player.position) : new THREE.Vector3(); }
    inputPressed(code) {
      if (!this.pressed.has(code)) return false;
      this.pressed.delete(code); return true;
    }
    clearInput() { this.keys.clear(); this.pressed.clear(); this.mouse.fire = false; this.mouse.orbit = false; }
    start() {
      if (!this.ready) return;
      this.started = true; this.paused = false; this.clearInput();
      $('menu').classList.add('hidden'); $('pauseMenu').classList.add('hidden'); $('hud').classList.remove('hidden');
      this.audio.start(); this.audio.setPaused(false);
      this.player.updateCamera(1, true);
      this.hud.notify('Welcome to Marikina. Your city, your pace.');
      this.renderer.domElement.focus();
    }
    pause(value) {
      if (!this.started) return;
      this.paused = value; this.clearInput();
      $('pauseMenu').classList.toggle('hidden', !value);
      this.audio.setPaused(value);
      if (!value) { this.audio.start(); this.renderer.domElement.focus(); }
    }
    quit() {
      this.pause(false); this.started = false; this.clearInput();
      this.audio.setPaused(true);
      $('hud').classList.add('hidden'); $('menu').classList.remove('hidden');
      $('startButton').textContent = 'RETURN TO THE CITY';
    }
    bindInputs() {
      const canvas = this.renderer.domElement;
      canvas.tabIndex = 0;
      $('startButton').addEventListener('click', () => this.start());
      $('resumeButton').addEventListener('click', () => this.pause(false));
      $('quitButton').addEventListener('click', () => this.quit());
      if ($('settingsButton')) $('settingsButton').addEventListener('click', () => this.pause(true));
      window.addEventListener('keydown', event => {
        if (event.code === 'Escape') { if (!event.repeat) this.pause(!this.paused); return; }
        if (!this.started || this.paused || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
        if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(event.code)) event.preventDefault();
        if (!this.keys.has(event.code)) this.pressed.add(event.code);
        this.keys.add(event.code);
      });
      window.addEventListener('keyup', event => this.keys.delete(event.code));
      canvas.addEventListener('contextmenu', event => event.preventDefault());
      canvas.addEventListener('mousedown', event => {
        if (!this.started || this.paused) return;
        event.preventDefault(); canvas.focus();
        if (event.button === 0) { this.mouse.fire = true; this.pressed.add('Mouse0'); }
        if (event.button === 2) this.mouse.orbit = true;
        this.mouse.x = event.clientX; this.mouse.y = event.clientY;
      });
      window.addEventListener('mouseup', event => {
        if (event.button === 0) this.mouse.fire = false;
        if (event.button === 2) this.mouse.orbit = false;
      });
      window.addEventListener('mousemove', event => {
        if (this.started && !this.paused && this.mouse.orbit) this.player.orbit(event.clientX - this.mouse.x, event.clientY - this.mouse.y);
        this.mouse.x = event.clientX; this.mouse.y = event.clientY;
      });
      canvas.addEventListener('wheel', event => {
        if (!this.started || this.paused) return;
        event.preventDefault(); this.player.zoom(event.deltaY);
      }, { passive: false });
      window.addEventListener('blur', () => { this.clearInput(); if (this.started) this.pause(true); });
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.started) this.pause(true); });
      window.addEventListener('resize', () => {
        this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
        this.renderer.setSize(innerWidth, innerHeight);
      });
      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault(); this.pause(true);
        this.hud.notify('Graphics connection lost. Reload to restore the city.', 'danger');
      });
    }
    bindSettings() {
      Object.keys(defaults).forEach(key => {
        const input = $(key);
        if (!input) return;
        input.value = this.settings[key];
        const output = $(key + 'Value');
        if (output) output.textContent = input.value;
        input.addEventListener('input', () => {
          this.settings[key] = key === 'shadowQuality' ? input.value : Number(input.value);
          if (output) output.textContent = input.value;
          this.applySettings();
          try { localStorage.setItem('marikina-gta-settings', JSON.stringify(this.settings)); } catch (_) { /* Settings still work for this session. */ }
        });
      });
    }
    applySettings() {
      this.camera.fov = this.settings.fov; this.camera.updateProjectionMatrix();
      const enabled = this.settings.shadowQuality !== 'off';
      const size = this.settings.shadowQuality === 'high' ? 2048 : 1024;
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
      if (this.renderer.shadowMap.enabled !== enabled) {
        this.renderer.shadowMap.enabled = enabled;
        this.scene.traverse(object => {
          if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.needsUpdate = true);
        });
      }
      this.audio.setVolume(this.settings.volume);
    }
    updateLighting() {
      const angle = this.time / 600 * Math.PI * 2 + .7;
      const height = Math.sin(angle);
      const daylight = MG.clamp((height + .16) / .65, 0, 1);
      this.night = daylight < .25;
      const focus = this.focusPosition();
      this.sun.position.set(focus.x + Math.cos(angle) * 95, Math.max(20, Math.abs(height) * 135), focus.z - 65);
      this.sun.target.position.copy(focus);
      this.sun.intensity = .05 + daylight * 1.15;
      this.sun.color.copy(MG.srgb(height < .35 ? 0xffbe83 : 0xffe3bb));
      this.hemisphere.intensity = .12 + daylight * .23;
      this.hemisphere.color.copy(MG.srgb(this.night ? 0x748eba : 0xbddfff));
      this.scene.background.copy(MG.srgb(0x111d36).lerp(MG.srgb(0x87ceeb), daylight));
      this.scene.fog.color.copy(this.scene.background);
      /* 0.55 rather than 1.1: the stronger value turned most of the city into
       * flat blue haze, which is the same washed-out look the palette fix
       * removed. Draw distance still bounds the visible range. */
      this.scene.fog.density = (0.55 / this.settings.drawDistance) * (1 + (1 - daylight) * .55);
    }
    menuCamera(dt) {
      this.menuTime = (this.menuTime || 0) + dt;
      const center = this.world.spawn;
      const angle = -.75 + Math.sin(this.menuTime * .06) * .13;
      this.camera.position.set(center.x + Math.sin(angle) * 48, 26, center.z - Math.cos(angle) * 48);
      this.camera.lookAt(center.x + 13, 3, center.z + 15);
    }
    step(dt) {
      this.time += dt; this.frame++;
      if (this.player.hp > 0 && this.inputPressed('KeyE')) {
        if (this.player.vehicle) this.vehicles.exit();
        else {
          const nearest = this.vehicles.nearest(this.player.position, 3);
          if (nearest) this.vehicles.enter(nearest);
          else this.hud.notify('Get closer to a vehicle to drive.');
        }
      }
      if (this.player.hp <= 0) {
        this.deathTimer -= dt;
        if (this.deathTimer <= 0) this.player.respawn();
      }
      this.player.update(dt);
      this.vehicles.update(dt);
      this.npcs.update(dt);
      this.police.update(dt);
      this.player.updateCamera(dt, false);
      this.combat.update(dt);
      this.world.update(dt);
      this.updateLighting();
      this.audio.update(dt);
      this.hud.update(dt);
      this.pressed.clear();
    }
    loop(now) {
      requestAnimationFrame(this.frameCallback);
      const rawDelta = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      const dt = Math.min(.05, Math.max(.001, rawDelta));
      this.fps += ((1 / Math.max(.001, rawDelta)) - this.fps) * .04;
      if (this.started && !this.paused) this.step(dt);
      else if (!this.started) this.menuCamera(dt);
      document.body.style.cursor = this.started && !this.paused && !this.player.vehicle ? 'none' : 'default';
      this.renderer.render(this.scene, this.camera);
    }
  };
  function boot() {
    const game = new MG.Game();
    window.game = game;
    game.init().catch(error => {
      console.error('Marikina initialization failed:', error);
      showLoadFailure(error);
    });
  }
  /* A failed Overpass download is not recoverable by falling back to the old
   * procedural city, so the loading screen stays up and offers a retry. */
  function showLoadFailure(error) {
    const screen = $('loading');
    const message = $('loadingError');
    const retry = $('retryButton');
    if (screen) { screen.classList.remove('loaded', 'hidden'); }
    if (message) {
      message.textContent = 'Could not load map data. Check your internet connection and refresh.\n(' +
        (error && error.message ? error.message : 'Unknown error') + ')';
      message.classList.remove('hidden');
      message.style.whiteSpace = 'pre-line';
    }
    if ($('loadingStatus')) $('loadingStatus').textContent = 'Marikina needs OpenStreetMap data to start.';
    if (retry) {
      retry.classList.remove('hidden');
      retry.onclick = () => {
        retry.classList.add('hidden');
        if (message) message.classList.add('hidden');
        const fresh = new MG.Game();
        window.game = fresh;
        fresh.init().catch(retryError => {
          console.error('Marikina retry failed:', retryError);
          showLoadFailure(retryError);
        });
      };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());