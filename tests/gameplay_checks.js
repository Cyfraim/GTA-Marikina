/* Loaded by browser_smoke.py into the running page, with the game paused. */
window.runGameplayChecks = function () {
  'use strict';
  const g = window.game;
  const result = {};
  const dt = 1 / 60;
  g.clearInput();
  g.player.respawn();
  g.clearInput();

  // Jump stays airborne across multiple horizontal integration steps.
  const baseY = g.player.position.y;
  g.pressed.add('Space');
  let highest = baseY;
  for (let i = 0; i < 90; i++) {
    g.player.update(dt);
    highest = Math.max(highest, g.player.position.y);
  }
  result.jump = highest - baseY > .9 && g.player.grounded;

  // Camera-relative strafe and first-person view keep finite coordinates.
  const startX = g.player.position.x;
  g.player.cameraYaw = 0; g.keys.add('KeyD');
  for (let i = 0; i < 20; i++) g.player.update(dt);
  g.clearInput();
  result.strafeRight = g.player.position.x < startX;
  g.pressed.add('KeyC'); g.player.update(dt); g.player.updateCamera(dt, true);
  result.firstPerson = g.player.firstPerson && !g.player.mesh.visible && g.camera.position.toArray().every(Number.isFinite);
  g.pressed.add('KeyC'); g.player.update(dt);

  // Swept bullet collision hits a target even across a low-frame-rate step.
  const npc = g.npcs.people.find(p => p.hp > 0);
  const saved = npc.position.clone();
  npc.position.copy(g.world.spawn).add(new THREE.Vector3(0, 0, 5));
  npc.hp = 30;
  const origin = g.world.spawn.clone(); origin.y += .95;
  g.combat.spawn(origin, new THREE.Vector3(0, 0, 1), 'player');
  g.combat.update(.1);
  result.sweptHit = npc.hp === 10;
  npc.position.copy(saved); npc.hp = 30;
  g.police.reset();

  // Aiming: the shot must follow the mouse cursor, not the camera's centre ray.
  const aimResults = (() => {
    const gun = g.world.spawn.clone(); gun.y += 1.3;
    const sample = (x, y) => {
      g.mouse.x = x; g.mouse.y = y;
      return g.combat.aimDirection(gun.clone()).clone();
    };
    // Screen centre, then two clearly offset cursor positions.
    const w = window.innerWidth, h = window.innerHeight;
    const centre = sample(w / 2, h / 2);
    const left = sample(w * 0.2, h / 2);
    const right = sample(w * 0.8, h / 2);
    const yawOf = v => Math.atan2(v.x, v.z);
    return {
      centreFinite: centre.toArray().every(Number.isFinite),
      unitLength: Math.abs(centre.length() - 1) < 1e-3,
      leftDiffersFromCentre: Math.abs(yawOf(left) - yawOf(centre)) > 0.05,
      rightDiffersFromCentre: Math.abs(yawOf(right) - yawOf(centre)) > 0.05,
      leftAndRightOpposite: Math.sign(yawOf(left) - yawOf(centre)) === -Math.sign(yawOf(right) - yawOf(centre)),
    };
  })();
  Object.keys(aimResults).forEach(k => { result['aim_' + k] = aimResults[k]; });

  // Firing spawns a player bullet travelling toward the cursor.
  g.combat.ammo = 12; g.combat.cooldown = 0; g.combat.reloading = false;
  g.mouse.x = window.innerWidth * 0.8; g.mouse.y = window.innerHeight * 0.5;
  const beforeShots = g.combat.bullets.filter(b => b.active).length;
  const shotOrigin = g.focusPosition().clone(); shotOrigin.y += 1.3;
  shotOrigin.addScaledVector(new THREE.Vector3(Math.sin(g.player.cameraYaw), 0, Math.cos(g.player.cameraYaw)), .55);
  const expectedShot = g.combat.aimDirection(shotOrigin).clone();
  g.pressed.add('Mouse0');
  g.combat.update(0.016);
  const fired = g.combat.bullets.filter(b => b.active && b.owner === 'player');
  result.fireOnMousedown = fired.length > beforeShots;
  result.bulletSpeed = fired.length ? Math.abs(fired[fired.length - 1].velocity.length() - 80) < 1 : false;
  result.bulletFollowsMouse = fired.length
    ? fired[fired.length - 1].velocity.clone().normalize().dot(expectedShot) > .999999
    : false;
  // One press must not auto-repeat while the button is held.
  g.combat.cooldown = 0;
  g.pressed.add('Mouse0');
  g.combat.update(0.016);
  g.mouse.fire = true;
  g.combat.cooldown = 0;
  g.combat.update(0.016);
  result.semiAutomatic = g.combat.bullets.filter(b => b.active && b.owner === 'player').length
    === fired.length + 1;
  g.mouse.fire = false;

  // On foot, Juan turns to face the aim point.
  g.player.respawn(); g.clearInput();
  g.mouse.x = window.innerWidth * 0.75; g.mouse.y = window.innerHeight * 0.65;
  g.combat.updatePlayerFacing();
  const firstHeading = g.player.mesh.rotation.y;
  g.mouse.x = window.innerWidth * 0.25;
  g.combat.update(0);
  result.facesAimTarget = Number.isFinite(g.player.mesh.rotation.y)
    && Math.abs(MG.angleDelta(firstHeading, g.player.mesh.rotation.y)) > .05
    && g.player.heading === g.player.mesh.rotation.y;

  // The real river blocks movement; real landmarks are on clear ground.
  const river = (g.world._waterLines || [])[0];
  result.riverBlocks = river
    ? river.points.some(p => g.world.isBlocked(p.x, p.z, .35))
    : false;
  result.landmarksClear = g.world.landmarks.every(l => !g.world.isBlocked(l.position.x, l.position.z, 1.2));
  result.spawnClear = !g.world.isBlocked(g.world.spawn.x, g.world.spawn.z, .35);
  result.finiteRoutes = g.world.trafficRoutes.every(route => route.every(p => p.toArray().every(Number.isFinite)));
  result.buildingsFromOSM = g.world.buildings.length > 1000;
  result.roadsFromOSM = g.world._roadLines.length > 50;

  // Armor absorbs some damage and regeneration waits five seconds.
  g.time += 3;
  g.player.armor = 100; g.player.hp = 100; g.player.damage(10);
  result.armor = g.player.armor === 93.5 && g.player.hp === 96.5;
  const health = g.player.hp; g.player.update(dt);
  result.regenerationDelay = g.player.hp === health;

  // Escape requires a complete 15-second detection-free interval.
  g.police.crime('shooting');
  g.police.units.forEach(v => { v.position.set(350, 0, 350); v.speed = 0; });
  g.police.officers.forEach(p => p.position.set(350, 0, 350));
  for (let i = 0; i < 16 * 60; i++) {
    g.police.units.forEach(v => v.position.set(350, 0, 350));
    g.police.officers.forEach(p => p.position.set(350, 0, 350));
    g.police.update(dt);
  }
  result.wantedEscape = g.police.wanted === 0;

  // Three rapid shots raise one star, eighteen escalate all the way to SWAT.
  g.police.reset(); g.player.respawn();
  g.police.crime('shooting'); g.police.crime('shooting'); g.police.crime('shooting');
  result.escalation = g.police.wanted === 1;
  for (let i = 0; i < 15; i++) g.police.crime('shooting');
  result.escalationMax = g.police.wanted === 3;

  // Foot patrols dismount from a cruiser that closes in on a player on foot.
  const cruiser = g.police.units.find(u => !u.destroyed);
  if (cruiser) {
    for (let i = 0; i < 90; i++) {
      cruiser.position.set(g.player.position.x + 8, 0, g.player.position.z + 8);
      cruiser.speed = 0;
      g.police.update(dt);
    }
  }
  result.officersDeploy = g.police.wanted > 0 && g.police.officers.some(o => o.hp > 0);
  g.player.respawn(); g.clearInput();
  return result;
};