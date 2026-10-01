(function () {
  'use strict';
  const MG = window.MG = window.MG || {};
  const UP = new THREE.Vector3(0, 1, 0);
  MG.Combat = class Combat {
    constructor(game) {
      this.game = game;
      this.ammo = 12;
      this.reserve = 48;
      this.reloading = false;
      this.reloadRemaining = 0;
      this.cooldown = 0;
      this.bullets = [];
      this.particles = [];
      this.ray = new THREE.Ray();
      this.cameraRay = new THREE.Raycaster();
      this.aimPlane = new THREE.Plane();
      this.aimTarget = new THREE.Vector3();
      this.hitPoint = new THREE.Vector3();
      this.flashTime = 0;
    }
    init() {
      const geometry = new THREE.SphereGeometry(.1, 6, 4);
      const playerMaterial = new THREE.MeshBasicMaterial({ color: MG.srgb(0xffe6a0) });
      const policeMaterial = new THREE.MeshBasicMaterial({ color: MG.srgb(0xff8870) });
      const tracerMaterial = new THREE.LineBasicMaterial({ color: MG.srgb(0xffd88b), transparent: true, opacity: .6 });
      for (let i = 0; i < 64; i++) {
        const mesh = new THREE.Mesh(geometry, playerMaterial);
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        const tracer = new THREE.Line(lineGeometry, tracerMaterial);
        mesh.visible = false; tracer.visible = false; tracer.frustumCulled = false;
        this.game.scene.add(mesh, tracer);
        this.bullets.push({ mesh: mesh, tracer: tracer, active: false, velocity: new THREE.Vector3(), previous: new THREE.Vector3(), travelled: 0, owner: 'player', playerMaterial: playerMaterial, policeMaterial: policeMaterial });
      }
      for (let i = 0; i < 18; i++) {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: MG.srgb(0xffe6c4), transparent: true, opacity: 0, depthWrite: false }));
        mesh.visible = false; this.game.scene.add(mesh);
        this.particles.push({ mesh: mesh, life: 0 });
      }
      this.flash = new THREE.PointLight(0xffd278, 0, 7);
      this.game.scene.add(this.flash);
    }
    reset() {
      this.ammo = 12; this.reserve = 48; this.reloading = false; this.reloadRemaining = 0;
      this.bullets.forEach(b => this.release(b));
    }
    reload() {
      if (this.reloading || this.ammo === 12 || this.reserve === 0 || this.game.player.hp <= 0) return;
      this.reloading = true; this.reloadRemaining = 2;
      this.game.hud.notify('RELOADING…', 'info');
    }
    spawn(origin, direction, owner) {
      const bullet = this.bullets.find(b => !b.active);
      if (!bullet) return null;
      bullet.active = true; bullet.owner = owner; bullet.travelled = 0;
      bullet.mesh.position.copy(origin); bullet.previous.copy(origin);
      bullet.mesh.material = owner === 'police' ? bullet.policeMaterial : bullet.playerMaterial;
      bullet.velocity.copy(direction).normalize().multiplyScalar(80);
      bullet.mesh.visible = true; bullet.tracer.visible = false;
      return bullet;
    }
    fire() {
      const game = this.game;
      if (this.cooldown > 0 || this.reloading || game.player.hp <= 0) return;
      if (this.ammo === 0) { this.reload(); return; }
      this.cooldown = .22;
      this.ammo--;
      game.player.aimUntil = game.time + .7;
      const vehicle = game.player.vehicle;
      const origin = game.focusPosition().clone();
      origin.y += vehicle ? 1.8 : 1.3;
      origin.addScaledVector(new THREE.Vector3(Math.sin(game.player.cameraYaw), 0, Math.cos(game.player.cameraYaw)), vehicle ? 1.8 : .55);
      const direction = this.aimDirection(origin);
      this.spawn(origin, direction, 'player');
      this.flash.position.copy(origin); this.flash.intensity = 2.5; this.flashTime = .035;
      game.audio.gunshot();
      game.npcs.onGunshot(origin);
      game.police.crime('shooting');
    }
    /* A real 3D raycast from the camera through the mouse cursor, so the
     * bullet flies where the crosshair points instead of along the camera's
     * centre ray. The cursor is projected onto a horizontal plane at the
     * gun's height, which is what the player is actually aiming at on a street. */
    aimDirection(gunPosition) {
      const game = this.game;
      const width = window.innerWidth || 1;
      const height = window.innerHeight || 1;
      const mouse = new THREE.Vector2(
        (game.mouse.x / width) * 2 - 1,
        -(game.mouse.y / height) * 2 + 1
      );
      this.cameraRay.setFromCamera(mouse, game.camera);
      this.aimPlane.set(UP, -gunPosition.y);
      const aimTarget = this.aimTarget;
      if (!this.cameraRay.ray.intersectPlane(this.aimPlane, aimTarget)) {
        // Cursor is above the horizon: fall back to the camera's forward ray.
        return game.camera.getWorldDirection(new THREE.Vector3());
      }
      return aimTarget.clone().sub(gunPosition).normalize();
    }
    updatePlayerFacing() {
      const game = this.game;
      const player = game.player;
      if (player.vehicle || player.hp <= 0) return;
      const mouse = new THREE.Vector2(
        (game.mouse.x / (window.innerWidth || 1)) * 2 - 1,
        -(game.mouse.y / (window.innerHeight || 1)) * 2 + 1
      );
      game.camera.updateMatrixWorld(true);
      this.cameraRay.setFromCamera(mouse, game.camera);
      this.aimPlane.set(UP, -player.position.y);
      if (this.cameraRay.ray.intersectPlane(this.aimPlane, this.aimTarget)) {
        const angle = Math.atan2(this.aimTarget.x - player.position.x, this.aimTarget.z - player.position.z);
        player.heading = angle;
        player.mesh.rotation.y = angle;
      }
    }
    spawnPoliceBullet(origin, target) {
      // Deliberate spread gives a moving player room to escape.
      const aim = target.clone().sub(origin);
      aim.x += (Math.random() - .5) * 1.8;
      aim.z += (Math.random() - .5) * 1.8;
      aim.y += (Math.random() - .5) * .6;
      this.spawn(origin, aim.normalize(), 'police');
    }
    release(bullet) { bullet.active = false; bullet.mesh.visible = false; bullet.tracer.visible = false; }
    dust(position) {
      const p = this.particles.find(particle => particle.life <= 0) || this.particles[0];
      p.life = .25; p.mesh.visible = true; p.mesh.position.copy(position);
      p.mesh.scale.setScalar(1); p.mesh.material.opacity = .65;
    }
    update(dt) {
      const game = this.game;
      this.updatePlayerFacing();
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (game.inputPressed('KeyR')) this.reload();
      if (this.reloading) {
        this.reloadRemaining -= dt;
        if (this.reloadRemaining <= 0) {
          const quantity = Math.min(12 - this.ammo, this.reserve);
          this.ammo += quantity; this.reserve -= quantity;
          this.reloading = false; this.reloadRemaining = 0;
        }
      }
      // Fire once per mousedown rather than auto-repeating while held, which
      // keeps the pistol semi-automatic and the shot lands on the press frame.
      if (game.inputPressed('Mouse0')) this.fire();
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flash.intensity = 0;
      this.bullets.forEach(b => {
        if (!b.active) return;
        b.previous.copy(b.mesh.position);
        const distance = Math.min(80 * dt, 80 - b.travelled);
        const dir = b.velocity.clone().normalize();
        this.ray.set(b.previous, dir);
        let closest = distance + .001;
        let hit = null;
        game.world.colliders.forEach(box => {
          const point = this.ray.intersectBox(box, this.hitPoint);
          if (!point) return;
          const d = point.distanceTo(b.previous);
          if (d < closest) { closest = d; hit = { type: 'wall' }; }
        });
        const targets = b.owner === 'player' ? game.npcs.people.concat(game.police.officers) : [game.player];
        targets.forEach(p => {
          if (p.hp <= 0) return;
          const center = p === game.player ? game.focusPosition().clone() : p.position.clone();
          center.y += p.vehicle ? 1.1 : .95;
          const sphere = new THREE.Sphere(center, p.vehicle ? 1.0 : .5);
          const point = this.ray.intersectSphere(sphere, this.hitPoint);
          if (point && point.distanceTo(b.previous) < closest) {
            closest = point.distanceTo(b.previous); hit = { type: 'person', target: p };
          }
        });
        if (b.owner === 'player') game.vehicles.items.forEach(v => {
          if (!v.active || v === game.player.vehicle) return;
          const center = v.position.clone(); center.y += .9;
          const point = this.ray.intersectSphere(new THREE.Sphere(center, Math.min(v.radius, 1.1)), this.hitPoint);
          if (point && point.distanceTo(b.previous) < closest) {
            closest = point.distanceTo(b.previous); hit = { type: 'vehicle', target: v };
          }
        });
        // The swept segment also intersects the ground; bullets never travel
        // visibly through a plaza or road before their range expires.
        if (dir.y < -.0001) {
          const ground = game.world.groundHeight(b.previous.x, b.previous.z);
          const groundDistance = (ground + .04 - b.previous.y) / dir.y;
          if (groundDistance >= 0 && groundDistance < closest) {
            closest = groundDistance; hit = { type: 'wall' };
          }
        }
        b.mesh.position.addScaledVector(dir, hit ? closest : distance);
        b.travelled += hit ? closest : distance;
        const attr = b.tracer.geometry.attributes.position;
        attr.setXYZ(0, b.previous.x, b.previous.y, b.previous.z);
        attr.setXYZ(1, b.mesh.position.x, b.mesh.position.y, b.mesh.position.z);
        attr.needsUpdate = true; b.tracer.visible = true;
        if (hit) {
          if (hit.type === 'person') hit.target.damage(b.owner === 'player' ? 20 : 10, dir.clone().multiplyScalar(.6));
          else if (hit.type === 'vehicle' && game.vehicles.damage) {
            game.vehicles.damage(hit.target, 12);
            if (hit.target.police) game.police.crime(hit.target.destroyed ? 'killPolice' : 'assaultPolice');
          }
          this.dust(b.mesh.position);
          this.release(b);
        } else if (b.travelled >= 80 || b.mesh.position.y < -.8) this.release(b);
      });
      this.particles.forEach(p => {
        if (p.life <= 0) return;
        p.life -= dt;
        p.mesh.visible = p.life > 0;
        p.mesh.scale.setScalar(1 + (1 - p.life / .25) * 5);
        p.mesh.material.opacity = Math.max(0, p.life / .25) * .65;
      });
    }
  };
}());