/* Heads-up display: vitals, wanted stars, minimap, speedometer, notifications
 * and screen-projected landmark labels. Pure HTML/CSS over the WebGL canvas. */
(function () {
  'use strict';
  const MG = window.MG = window.MG || {};
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const MAP_RANGE = 120;
  let _mouseX = window.innerWidth / 2;
  let _mouseY = window.innerHeight / 2;
  window.addEventListener('mousemove', event => {
    _mouseX = event.clientX;
    _mouseY = event.clientY;
  });

  MG.HUD = class HUD {
    constructor(game) {
      this.game = game;
      this.el = {};
      this.notifications = [];
      this.labels = [];
      this.lastHp = 100;
      this.flash = 0;
      this.mapClock = 0;
      this.projected = new THREE.Vector3();
      this.shoeDrawn = false;
    }
    init() {
      const names = ['healthFill', 'healthValue', 'armorFill', 'armorValue', 'playerStatus', 'wantedShields',
        'wantedStatus', 'evadeFill', 'crosshair', 'interactionPrompt', 'interactionText', 'notifications',
        'ammoValue', 'reserveValue', 'reloadFill', 'weaponStatus', 'speedGauge', 'vehicleName', 'speedValue',
        'gearValue', 'speedFill', 'minimap', 'districtName', 'worldClock', 'dayStatus', 'mapStatus',
        'deathOverlay', 'respawnTime', 'hitFlash', 'worldLabels', 'ammoCard', 'playerCard'];
      names.forEach(id => { this.el[id] = $(id); });
      if (!this.el.playerCard) this.el.playerCard = document.querySelector('.player-card');
      if (!this.el.ammoCard) this.el.ammoCard = document.querySelector('.ammo-card');
      this.shields = this.el.wantedShields ? Array.from(this.el.wantedShields.children) : [];
      this.map = this.el.minimap;
      this.mapCtx = this.map ? this.map.getContext('2d') : null;
      this.drawShoe();
      this.buildLabels();
      this.lastHp = this.game.player.hp;
    }
    /* Line-art sneaker used on the loading screen. */
    drawShoe() {
      const canvas = $('loadingShoe');
      if (!canvas || this.shoeDrawn) return;
      this.shoeDrawn = true;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#edc47d';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(70, 168);
      ctx.lineTo(70, 108);
      ctx.bezierCurveTo(70, 82, 96, 70, 128, 74);
      ctx.lineTo(196, 84);
      ctx.bezierCurveTo(232, 90, 268, 112, 322, 140);
      ctx.lineTo(548, 176);
      ctx.bezierCurveTo(576, 182, 584, 198, 570, 210);
      ctx.lineTo(88, 210);
      ctx.bezierCurveTo(70, 208, 64, 194, 70, 168);
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = '#f47563';
      ctx.beginPath();
      ctx.moveTo(70, 186);
      ctx.lineTo(566, 186);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(245,241,232,.55)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(150 + i * 26, 104 + i * 5);
        ctx.lineTo(196 + i * 26, 132 + i * 5);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(237,196,125,.45)';
      ctx.beginPath();
      ctx.arc(300, 120, 46, 0, Math.PI * 2);
      ctx.stroke();
    }
    buildLabels() {
      const host = this.el.worldLabels;
      if (!host) return;
      (this.game.world.landmarks || []).forEach(landmark => {
        const node = document.createElement('div');
        node.className = 'world-label';
        node.innerHTML = '<i class="label-dot"></i><strong></strong><small></small>';
        node.style.opacity = '0';
        node.querySelector('strong').textContent = landmark.name;
        const subtitle = landmark.subtitle || this.game.world.districtAt(landmark.position);
        node.querySelector('small').textContent = (subtitle || '').toUpperCase();
        host.appendChild(node);
        this.labels.push({ landmark: landmark, node: node });
      });
    }
    notify(text, kind) {
      if (!this.el.notifications || !text) return;
      const node = document.createElement('div');
      node.className = 'notification' + (kind ? ' ' + kind : '');
      node.textContent = text;
      this.el.notifications.appendChild(node);
      const item = { node: node, life: 3.2 };
      this.notifications.push(item);
      while (this.notifications.length > 4) this.removeNotification(this.notifications[0]);
    }
    removeNotification(item) {
      const index = this.notifications.indexOf(item);
      if (index >= 0) this.notifications.splice(index, 1);
      if (!item.node.parentNode) return;
      item.node.classList.add('leaving');
      setTimeout(() => { if (item.node.parentNode) item.node.parentNode.removeChild(item.node); }, 420);
    }
    updateVitals() {
      const player = this.game.player;
      const hp = Math.max(0, Math.round(player.hp));
      if (this.el.healthFill) this.el.healthFill.style.width = hp + '%';
      if (this.el.healthValue) this.el.healthValue.textContent = hp;
      if (this.el.armorFill) this.el.armorFill.style.width = Math.max(0, Math.round(player.armor)) + '%';
      if (this.el.armorValue) this.el.armorValue.textContent = Math.max(0, Math.round(player.armor));
      if (this.el.playerCard) this.el.playerCard.classList.toggle('low-health', hp <= 30);
      if (this.el.playerStatus) {
        this.el.playerStatus.textContent = player.vehicle ? player.vehicle.name.toUpperCase() : 'LOCAL / ON FOOT';
      }
      if (hp < this.lastHp) this.flash = Math.min(1, (this.lastHp - hp) / 25);
      this.lastHp = hp;
    }
    updateWanted() {
      const police = this.game.police;
      this.shields.forEach((node, index) => node.classList.toggle('active', index < police.wanted));
      if (this.el.wantedShields) {
        this.el.wantedShields.setAttribute('aria-label', police.wanted ? 'Wanted level ' + police.wanted + ' of 3' : 'No wanted level');
      }
      if (this.el.wantedStatus) {
        this.el.wantedStatus.textContent = !police.wanted ? 'KEEP IT QUIET' :
          police.detected ? 'IN PURSUIT' : 'SEARCHING · ' + Math.max(0, 15 - police.evadeTime).toFixed(0) + 'S';
      }
      if (this.el.evadeFill) this.el.evadeFill.style.width = (police.wanted && !police.detected ? clamp(police.evadeTime / 15, 0, 1) * 100 : 0) + '%';
    }
    updateWeapon() {
      const combat = this.game.combat;
      if (this.el.ammoValue) this.el.ammoValue.textContent = String(combat.ammo).padStart(2, '0');
      if (this.el.reserveValue) this.el.reserveValue.textContent = combat.reserve;
      if (this.el.ammoCard) this.el.ammoCard.classList.toggle('empty', combat.ammo === 0);
      if (this.el.reloadFill) {
        this.el.reloadFill.style.width = combat.reloading ? (1 - combat.reloadRemaining / 2) * 100 + '%' : '0';
      }
      if (this.el.weaponStatus) {
        this.el.weaponStatus.textContent = combat.reloading ? 'RELOADING…' : combat.ammo === 0 ? 'PRESS R' : 'SEMI-AUTOMATIC';
      }
      // The crosshair is an on-foot aiming aid, so it is hidden while driving.
      if (this.el.crosshair) this.el.crosshair.classList.toggle('reloading', combat.reloading);
      if (this.el.crosshair) this.el.crosshair.classList.toggle('hidden', !!this.game.player.vehicle);
    }
    updateVehicle() {
      const vehicle = this.game.player.vehicle;
      const gauge = this.el.speedGauge;
      if (!gauge) return;
      gauge.classList.toggle('hidden', !vehicle);
      if (!vehicle) return;
      const kmh = Math.abs(vehicle.speed) * 3.6;
      if (this.el.speedValue) this.el.speedValue.textContent = String(Math.round(kmh)).padStart(3, '0');
      if (this.el.speedFill) this.el.speedFill.style.width = clamp(kmh / (vehicle.maxSpeed * 3.6), 0, 1) * 100 + '%';
      if (this.el.vehicleName) this.el.vehicleName.textContent = vehicle.name.toUpperCase();
      if (this.el.gearValue) this.el.gearValue.textContent = vehicle.speed < -0.4 ? 'R' : vehicle.speed > 0.4 ? 'D' : 'N';
    }
    /* Bird's-eye map: north is up, MAP_RANGE metres around the player. Roads,
     * water and buildings all come from the OpenStreetMap download, so the
     * minimap redraws from world road/water polylines rather than the old
     * procedural arrays. */
    drawMap() {
      const ctx = this.mapCtx;
      if (!ctx) return;
      const game = this.game;
      const world = game.world;
      const size = this.map.width;
      const focus = game.focusPosition();
      const scale = size / (MAP_RANGE * 2);
      const toX = x => (x - focus.x) * scale + size / 2;
      const toY = z => (z - focus.z) * scale + size / 2;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#141f28';
      ctx.fillRect(0, 0, size, size);

      // Real waterways, drawn as polylines.
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#2c5f74';
      (world.linesNear(world._waterLines || [], focus.x, focus.z, MAP_RANGE * 1.5) || [])
        .forEach(line => {
          ctx.lineWidth = Math.max(2, (line.width || 12) * scale);
          ctx.beginPath();
          line.points.forEach((point, i) => {
            if (i === 0) ctx.moveTo(toX(point.x), toY(point.z));
            else ctx.lineTo(toX(point.x), toY(point.z));
          });
          ctx.stroke();
        });

      // Roads, thinned by class so arterials stay readable over the grid.
      ctx.strokeStyle = '#39434b';
      (world.linesNear(world._roadLines || [], focus.x, focus.z, MAP_RANGE * 1.4) || [])
        .forEach(line => {
          ctx.lineWidth = Math.max(1, line.width * scale * 0.7);
          ctx.beginPath();
          line.points.forEach((point, i) => {
            if (i === 0) ctx.moveTo(toX(point.x), toY(point.z));
            else ctx.lineTo(toX(point.x), toY(point.z));
          });
          ctx.stroke();
        });

      // Only the buildings inside the viewport, via the world's spatial index.
      ctx.fillStyle = '#232d35';
      (world.buildingsNear ? world.buildingsNear(focus.x, focus.z, MAP_RANGE + 30) : []).forEach(building => {
        if (Math.abs(building.x - focus.x) > MAP_RANGE + building.w || Math.abs(building.z - focus.z) > MAP_RANGE + building.d) return;
        ctx.fillRect(toX(building.x - building.w / 2), toY(building.z - building.d / 2), Math.max(1, building.w * scale), Math.max(1, building.d * scale));
      });

      const dot = (position, radius, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(toX(position.x), toY(position.z), radius, 0, Math.PI * 2);
        ctx.fill();
      };
      (game.vehicles.items || []).forEach(vehicle => {
        if (!vehicle.active || vehicle.destroyed || vehicle === game.player.vehicle) return;
        ctx.fillStyle = vehicle.police ? '#e05a4c' : '#d8b25a';
        ctx.fillRect(toX(vehicle.position.x) - 2.5, toY(vehicle.position.z) - 2.5, 5, 5);
      });
      (game.npcs.people || []).forEach(person => {
        if (person.hp > 0) dot(person.position, 2, person.state === 'flee' ? '#f0c86a' : '#dfe6e8');
      });
      (game.police.officers || []).forEach(officer => {
        if (officer.hp > 0) dot(officer.position, 2.6, '#ff6a55');
      });
      (game.police.units || []).forEach(unit => {
        if (unit.siren && unit.pursuitActive) dot(unit.position, 3.2, '#ff4a3a');
      });

      if (game.police.wanted && !game.police.detected) {
        ctx.strokeStyle = 'rgba(255,255,255,.75)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(toX(game.police.lastKnown.x), toY(game.police.lastKnown.z), 50 * scale * (1 - game.police.evadeTime / 30), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.save();
      ctx.translate(toX(focus.x), toY(focus.z));
      ctx.rotate(-(game.player.vehicle ? game.player.vehicle.heading : game.player.heading));
      ctx.fillStyle = '#7fd4ff';
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5.5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5.5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    updatePrompt() {
      const prompt = this.el.interactionPrompt;
      if (!prompt) return;
      let text = null;
      if (!this.game.player.vehicle) {
        const nearby = this.game.vehicles.nearest(this.game.player.position, 3);
        if (nearby) text = nearby.police ? ' commandeer MKPD unit' : nearby.name;
      }
      prompt.classList.toggle('hidden', !text);
      if (text && this.el.interactionText) this.el.interactionText.textContent = text;
    }
    updateLabels() {
      if (!this.labels.length) return;
      const camera = this.game.camera;
      const focus = this.game.focusPosition();
      const width = innerWidth, height = innerHeight;
      this.labels.forEach(item => {
        const landmark = item.landmark;
        const distance = landmark.position.distanceTo(focus);
        this.projected.copy(landmark.position);
        this.projected.y += 7;
        this.projected.project(camera);
        const visible = distance < 80 && this.projected.z < 1 &&
          this.projected.x > -1.15 && this.projected.x < 1.15 && this.projected.y > -1.1 && this.projected.y < 1.1;
        item.node.style.opacity = visible ? String(clamp(1 - (distance - 55) / 25, 0.25, 1)) : '0';
        if (!visible) return;
        item.node.style.left = ((this.projected.x * 0.5 + 0.5) * width).toFixed(1) + 'px';
        item.node.style.top = ((-this.projected.y * 0.5 + 0.5) * height).toFixed(1) + 'px';
      });
    }
    updateStatus() {
      const game = this.game;
      if (this.el.districtName) this.el.districtName.textContent = (game.world.districtAt(game.focusPosition()) || 'Marikina').toUpperCase();
      // The ten minute cycle opens on a bright morning.
      const hours = (8 + (game.time / 600) * 24) % 24;
      if (this.el.worldClock) this.el.worldClock.textContent = String(Math.floor(hours)).padStart(2, '0') + ':' + String(Math.floor((hours % 1) * 60)).padStart(2, '0');
      if (this.el.dayStatus) this.el.dayStatus.textContent = game.night ? 'NIGHT' : 'DAYTIME';
      if (this.el.mapStatus) this.el.mapStatus.textContent = game.police.wanted ? 'MKPD SEARCHING' : 'MARIKINA CITY';
      const dead = game.player.hp <= 0;
      if (this.el.deathOverlay) this.el.deathOverlay.classList.toggle('hidden', !dead);
      if (dead && this.el.respawnTime) this.el.respawnTime.textContent = ' ' + Math.max(0, Math.ceil(game.deathTimer)) + 's';
    }
    update(dt) {
      const game = this.game;
      if (!game.player || !game.world) return;
      const ch = this.el.crosshair;
      if (ch && ch.style.display !== 'none') {
        ch.style.left = _mouseX + 'px';
        ch.style.top = _mouseY + 'px';
        ch.style.transform = 'translate(-50%, -50%)';
      }
      this.updateVitals();
      this.updateWanted();
      this.updateWeapon();
      this.updateVehicle();
      this.updatePrompt();
      this.updateStatus();
      this.updateLabels();
      for (let i = this.notifications.length - 1; i >= 0; i--) {
        const item = this.notifications[i];
        item.life -= dt;
        if (item.life <= 0) this.removeNotification(item);
      }
      this.flash = Math.max(0, this.flash - dt * 1.6);
      if (this.el.hitFlash) this.el.hitFlash.style.opacity = (this.flash * 0.85).toFixed(3);
      this.drawMap();
    }
  };
}());
