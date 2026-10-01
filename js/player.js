(function () {
  'use strict';
  const MG = window.MG = window.MG || {};
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = new Map();
  let vertexMaterial = null;
  function material(color) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color: MG.srgb(color) }));
    return materials.get(color);
  }
  // Bake rigid child boxes into a single mesh to keep draw calls low. With
  // `flat` the source colors are written to a vertex-color attribute, which
  // collapses differently colored parts of one limb or wheel into one draw.
  MG.batchStatic = function (group, flat, windows) {
    if (!group || !group.children) return;
    const eligible = group.children.filter(mesh => mesh.isMesh && !Array.isArray(mesh.material) &&
      !mesh.material.vertexColors && (windows || !mesh.material.transparent) && (!flat || !mesh.material.map));
    if (eligible.length < 2) return;
    const groups = new Map();
    eligible.forEach(mesh => {
      const key = flat ? 'flat' : mesh.material.uuid;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mesh);
    });
    groups.forEach((meshes, key) => {
      if (meshes.length < 2) return;
      const pieces = meshes.map(mesh => {
        mesh.updateMatrix();
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geometry.applyMatrix4(mesh.matrix);
        return { geometry: geometry, color: mesh.material.color ? mesh.material.color.clone() : new THREE.Color(0xffffff) };
      });
      const merged = new THREE.BufferGeometry();
      ['position', 'normal', 'uv'].forEach(name => {
        if (!pieces.some(piece => piece.geometry.attributes[name])) return;
        const size = pieces[0].geometry.attributes[name].itemSize;
        let length = 0;
        pieces.forEach(piece => { length += piece.geometry.attributes[name].array.length; });
        const array = new Float32Array(length);
        let offset = 0;
        pieces.forEach(piece => {
          const source = piece.geometry.attributes[name].array;
          array.set(source, offset);
          offset += source.length;
        });
        merged.setAttribute(name, new THREE.BufferAttribute(array, size));
      });
      if (key === 'flat') {
        if (!vertexMaterial) vertexMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
        const length = pieces.reduce((total, piece) => total + piece.geometry.attributes.position.count * 3, 0);
        const array = new Float32Array(length);
        let offset = 0;
        pieces.forEach(piece => {
          const count = piece.geometry.attributes.position.count;
          for (let i = 0; i < count; i++) { array[offset++] = piece.color.r; array[offset++] = piece.color.g; array[offset++] = piece.color.b; }
        });
        merged.setAttribute('color', new THREE.BufferAttribute(array, 3));
      }
      const batch = new THREE.Mesh(merged, key === 'flat' ? vertexMaterial : meshes[0].material);
      batch.castShadow = true; batch.receiveShadow = true;
      group.add(batch);
      meshes.forEach(mesh => group.remove(mesh));
      pieces.forEach(piece => piece.geometry.dispose());
    });
  };
  function part(parent, color, dimensions, position) {
    const mesh = new THREE.Mesh(boxGeometry, material(color));
    mesh.scale.set.apply(mesh.scale, dimensions);
    mesh.position.set.apply(mesh.position, position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  MG.makePerson = function (shirt, skin, pants) {
    const group = new THREE.Group();
    const torso = new THREE.Group();
    group.add(torso);
    const skinColor = skin || 0xba825d;
    part(torso, shirt || 0x287eb8, [.5, .8, .3], [0, .96, 0]);
    part(torso, skinColor, [.5, .5, .5], [0, 1.61, 0]);
    part(torso, 0x272525, [.51, .15, .51], [0, 1.82, -.015]);
    part(torso, 0x30292a, [.07, .055, .015], [-.12, 1.64, .257]);
    part(torso, 0x30292a, [.07, .055, .015], [.12, 1.64, .257]);
    const arms = [], legs = [];
    [-1, 1].forEach(function (side) {
      const arm = new THREE.Group();
      arm.position.set(side * .35, 1.25, 0);
      part(arm, shirt || 0x287eb8, [.18, .24, .2], [0, -.08, 0]);
      part(arm, skinColor, [.15, .5, .15], [0, -.28, 0]);
      MG.batchStatic(arm, true);
      torso.add(arm); arms.push(arm);
      const leg = new THREE.Group();
      leg.position.set(side * .15, .53, 0);
      part(leg, pants || 0x263a4d, [.15, .5, .15], [0, -.23, 0]);
      part(leg, 0xf0e4cd, [.21, .11, .3], [0, -.47, .055]);
      MG.batchStatic(leg, true);
      group.add(leg); legs.push(leg);
    });
    // Head, hair, eyes and torso are rigid, so they become one draw call.
    MG.batchStatic(torso, true);
    const torsoMesh = torso.children[torso.children.length - 1];
    group.userData = { arms: arms, legs: legs, body: torsoMesh, head: torsoMesh, torso: torso };
    return group;
  };
  MG.animatePerson = function (group, time, speed, flee) {
    const parts = group.userData;
    if (!parts.arms) return;
    const moving = Math.min(1, Math.abs(speed) / 3);
    const phase = time * (Math.abs(speed) > 5 ? 13 : 8);
    const swing = Math.sin(phase) * moving * (Math.abs(speed) > 5 ? .85 : .48);
    parts.legs[0].rotation.x = swing;
    parts.legs[1].rotation.x = -swing;
    parts.arms[0].rotation.x = -swing + (flee ? -1.5 : 0);
    parts.arms[1].rotation.x = swing + (flee ? -1.5 : 0);
    parts.arms[0].rotation.z = flee ? Math.sin(time * 20) * .4 : .04;
    parts.arms[1].rotation.z = flee ? -Math.sin(time * 20) * .4 : -.04;
    parts.torso.position.y = Math.sin(time * 2.5) * .015 + Math.abs(Math.sin(phase)) * moving * .045;
  };

  MG.Player = class Player {
    constructor(game) {
      this.game = game;
      this.mesh = MG.makePerson(0x1a5276, 0xf4a460, 0x2c3e50);
      this.position = this.mesh.position;
      this.velocity = new THREE.Vector3();
      this.heading = 0;
      this.hp = 100;
      this.armor = 0;
      this.vehicle = null;
      this.radius = .35;
      this.verticalVelocity = 0;
      this.grounded = true;
      this.lastDamage = -20;
      this.lastImpact = -20;
      this.firstPerson = false;
      this.cameraYaw = 0;
      this.cameraPitch = .16;
      this.cameraDistance = 6;
      this.orbitTime = -20;
      this.stepClock = 0;
      this.aimUntil = 0;
      this.target = new THREE.Vector3();
      this.desiredCamera = new THREE.Vector3();
      this.cameraRay = new THREE.Raycaster();
      this.pickups = [];
    }
    init() {
      this.position.copy(this.game.world.spawn);
      this.game.scene.add(this.mesh);
      this.mesh.visible = true;
      this.gun = new THREE.Group();
      part(this.gun, 0x282d34, [.12, .13, .34], [0, 0, .12]);
      part(this.gun, 0x151b23, [.1, .19, .1], [0, -.12, .02]);
      this.gun.position.set(-.35, 1.03, .26);
      this.mesh.add(this.gun);
      const specs = [
        { kind: 'armor', color: 0x51b7ec, offset: [6, 5] },
        { kind: 'ammo', color: 0xffc35c, offset: [-6, 7] },
        { kind: 'health', color: 0xee7268, offset: [8, -6] }
      ];
      specs.forEach(spec => {
        const p = this.position.clone().add(new THREE.Vector3(spec.offset[0], 0, spec.offset[1]));
        if (this.game.world.isBlocked(p.x, p.z, .6)) return;
        const group = new THREE.Group();
        const shape = part(group, spec.color, [.55, .65, .22], [0, 0, 0]);
        if (spec.kind === 'health') {
          part(group, 0xffffff, [.12, .4, .03], [0, 0, .125]);
          part(group, 0xffffff, [.36, .12, .03], [0, 0, .13]);
        } else if (spec.kind === 'ammo') {
          for (let i = 0; i < 3; i++) part(group, 0x473724, [.07, .36, .04], [-.15 + i * .15, 0, .13]);
        } else shape.rotation.z = Math.PI / 4;
        group.position.copy(p); group.position.y = 1;
        this.game.scene.add(group);
        this.pickups.push({ kind: spec.kind, mesh: group, cooldown: 0 });
      });
      this.updateCamera(1, true);
    }
    orbit(dx, dy) {
      const sensitivity = this.game.settings.sensitivity * .003;
      this.cameraYaw -= dx * sensitivity;
      this.cameraPitch = MG.clamp(this.cameraPitch + dy * sensitivity, -.5, 1.05);
      this.orbitTime = this.game.time;
    }
    zoom(delta) { this.cameraDistance = MG.clamp(this.cameraDistance + delta * .008, 3, 15); }
    damage(amount) {
      if (this.hp <= 0 || this.game.time - this.respawnTime < 2) return;
      const absorbed = Math.min(this.armor, amount * .65);
      this.armor -= absorbed;
      this.hp = Math.max(0, this.hp - (amount - absorbed));
      this.lastDamage = this.game.time;
      if (this.hp <= 0) {
        this.game.deathTimer = 3;
        this.game.hud.notify('WASTED · Returning to City Hall', 'danger');
        this.mesh.rotation.x = -Math.PI / 2;
        this.velocity.set(0, 0, 0);
      }
    }
    respawn() {
      if (this.vehicle) {
        const abandoned = this.vehicle;
        this.game.vehicles.exit();
        abandoned.driver = null;
        abandoned.speed = 0;
        abandoned.velocity.set(0, 0, 0);
      }
      this.vehicle = null;
      this.position.copy(this.game.world.spawn);
      this.position.y = this.game.world.groundHeight(this.position.x, this.position.z);
      this.mesh.rotation.set(0, 0, 0);
      this.mesh.visible = true;
      this.velocity.set(0, 0, 0);
      this.verticalVelocity = 0; this.hp = 100; this.armor = 0;
      this.respawnTime = this.game.time; this.lastDamage = -20;
      this.game.police.reset();
      this.game.combat.reset();
      this.updateCamera(1, true);
      this.game.hud.notify('A fresh start. Ingat, Juan.');
    }
    update(dt) {
      if (this.hp <= 0) return;
      const game = this.game;
      if (game.inputPressed('KeyC')) {
        this.firstPerson = !this.firstPerson;
        game.hud.notify(this.firstPerson ? 'First-person camera' : 'Third-person camera');
      }
      if (!this.vehicle) {
        const forward = Number(game.keys.has('KeyW')) - Number(game.keys.has('KeyS'));
        const side = Number(game.keys.has('KeyD')) - Number(game.keys.has('KeyA'));
        const direction = new THREE.Vector3(
          Math.sin(this.cameraYaw) * forward - Math.cos(this.cameraYaw) * side,
          0, Math.cos(this.cameraYaw) * forward + Math.sin(this.cameraYaw) * side
        );
        if (direction.lengthSq() > 0) direction.normalize();
        const speed = game.keys.has('ShiftLeft') || game.keys.has('ShiftRight') ? 9 : 5;
        this.velocity.lerp(direction.multiplyScalar(speed), MG.exp(11, dt));
        const displacement = this.velocity.clone().multiplyScalar(dt);
        const old = this.position.clone();
        game.world.moveCircle(this.position, displacement, this.radius);
        // World movement follows bridge deck height for cars; Juan keeps his
        // independent vertical trajectory while airborne.
        this.position.y = old.y;
        if (Math.abs(this.position.x - old.x) < .00001) this.velocity.x = 0;
        if (Math.abs(this.position.z - old.z) < .00001) this.velocity.z = 0;
        const ground = game.world.groundHeight(this.position.x, this.position.z);
        if (game.inputPressed('Space') && this.grounded) { this.verticalVelocity = 7; this.grounded = false; }
        this.verticalVelocity -= 20 * dt;
        this.position.y += this.verticalVelocity * dt;
        if (this.position.y <= ground) { this.position.y = ground; this.verticalVelocity = 0; this.grounded = true; }
        const movingSpeed = this.velocity.length();
        if (game.time < this.aimUntil) this.heading = this.cameraYaw;
        else if (movingSpeed > .25) this.heading += MG.angleDelta(this.heading, Math.atan2(this.velocity.x, this.velocity.z)) * MG.exp(14, dt);
        this.mesh.rotation.y = this.heading;
        MG.animatePerson(this.mesh, game.time, movingSpeed, false);
        if (game.time < this.aimUntil) this.mesh.userData.arms[0].rotation.x = -Math.PI / 2;
        this.mesh.visible = !this.firstPerson;
        this.stepClock += movingSpeed * dt;
        if (this.stepClock > 2 && this.grounded) { this.stepClock = 0; game.audio.footstep(); }
        game.vehicles.items.forEach(v => {
          if (!v.active || this.position.distanceTo(v.position) > v.radius + this.radius) return;
          const away = this.position.clone().sub(v.position).setY(0);
          if (away.lengthSq() < .001) away.set(1, 0, 0);
          away.normalize();
          const jumpHeight = this.position.y;
          game.world.moveCircle(this.position, away.multiplyScalar(Math.max(.05, Math.abs(v.speed) * dt)), this.radius);
          this.position.y = Math.max(jumpHeight, game.world.groundHeight(this.position.x, this.position.z));
          if (Math.abs(v.speed) > 4 && game.time - this.lastImpact > 1) {
            this.damage(Math.min(55, Math.abs(v.speed) * 1.1)); this.lastImpact = game.time;
          }
        });
      } else {
        this.mesh.visible = false;
        this.position.copy(this.vehicle.position);
        this.heading = this.vehicle.heading;
        if (game.time - this.orbitTime > 2 && Math.abs(this.vehicle.speed) > 2) {
          this.cameraYaw += MG.angleDelta(this.cameraYaw, this.heading + (this.vehicle.speed < -2 ? Math.PI : 0)) * MG.exp(2.4, dt);
        }
      }
      if (game.time - this.lastDamage > 5) this.hp = Math.min(100, this.hp + dt * 2);
      this.pickups.forEach(p => {
        p.cooldown = Math.max(0, p.cooldown - dt);
        p.mesh.visible = p.cooldown === 0;
        p.mesh.rotation.y += dt;
        p.mesh.position.y = 1 + Math.sin(game.time * 2) * .15;
        if (p.cooldown || this.vehicle || this.position.distanceTo(p.mesh.position) > 1.6) return;
        if (p.kind === 'armor' && this.armor < 100) this.armor = 100;
        else if (p.kind === 'ammo' && game.combat.reserve < 96) game.combat.reserve = Math.min(96, game.combat.reserve + 24);
        else if (p.kind === 'health' && this.hp < 100) this.hp = Math.min(100, this.hp + 40);
        else return;
        p.cooldown = 45;
        game.audio.pickup();
        game.hud.notify(p.kind.toUpperCase() + ' collected', 'success');
      });
    }
    updateCamera(dt, snap) {
      const focus = this.game.focusPosition();
      const vehicle = this.vehicle;
      const distance = this.cameraDistance + (vehicle ? 3.5 : 0);
      this.target.copy(focus).y += vehicle ? 1.35 : 1.25;
      if (this.firstPerson) {
        this.desiredCamera.copy(focus).y += vehicle ? 1.7 : 1.66;
        if (vehicle) this.desiredCamera.add(new THREE.Vector3(Math.sin(vehicle.heading), 0, Math.cos(vehicle.heading)).multiplyScalar(.45));
        this.game.camera.position.lerp(this.desiredCamera, snap ? 1 : MG.exp(20, dt));
        this.target.copy(this.game.camera.position).add(new THREE.Vector3(Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch), -Math.sin(this.cameraPitch), Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch)));
      } else {
        this.desiredCamera.copy(this.target).add(new THREE.Vector3(-Math.sin(this.cameraYaw) * distance * Math.cos(this.cameraPitch), Math.sin(this.cameraPitch) * distance + (vehicle ? 1.3 : .8), -Math.cos(this.cameraYaw) * distance * Math.cos(this.cameraPitch)));
        const rayDirection = this.desiredCamera.clone().sub(this.target);
        const rayLength = rayDirection.length();
        this.cameraRay.set(this.target, rayDirection.normalize());
        this.cameraRay.far = rayLength;
        const collisions = this.cameraRay.intersectObjects(this.game.world.raycastObjects, false);
        if (collisions.length) this.desiredCamera.copy(this.target).addScaledVector(rayDirection, Math.max(.6, collisions[0].distance - .3));
        this.desiredCamera.y = Math.max(this.desiredCamera.y, this.game.world.groundHeight(this.desiredCamera.x, this.desiredCamera.z) + .3);
        this.game.camera.position.lerp(this.desiredCamera, snap ? 1 : MG.exp(9, dt));
        // Look past Juan, keeping his silhouette below the aim reticle.
        this.target.add(new THREE.Vector3(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw)).multiplyScalar(vehicle ? 5 : 3));
      }
      this.game.camera.lookAt(this.target);
      this.game.camera.updateMatrixWorld();
    }
  };
}());