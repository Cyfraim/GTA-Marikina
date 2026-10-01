(function () {
  'use strict';
  var MG = window.MG = window.MG || {}, T = window.THREE;
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  var turn = function (a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); };
  function point(p) {
    p = p.position || p;
    if (Array.isArray(p)) return new T.Vector3(p[0], p.length > 2 ? p[1] : 0, p.length > 2 ? p[2] : p[1]);
    return new T.Vector3(p.x || 0, p.y || 0, p.z || 0);
  }
  var equipmentMaterial = new T.MeshLambertMaterial({ color: MG.srgb(0x1c2b39) });
  var badgeMaterial = new T.MeshLambertMaterial({ color: MG.srgb(0xf2c65d) });
  var equipmentGeometry = new T.BoxGeometry(1, 1, 1);
  function equipment(parent, material, w, h, d, x, y, z) {
    var m = new T.Mesh(equipmentGeometry, material); m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  }
  function Police(game) {
    this.game = game; this.wanted = 0; this.evadeTime = 0; this.detected = false;
    this.units = []; this.officers = []; this.clock = 0; this.shots = [];
    this.lastKnown = new T.Vector3(); this.lastCrimeTime = -100; this.roadblockLevel = false;
    this.nodes = []; this._spawnTimer = 0; this._frame = 0; this._ray = new T.Ray(); this._intersection = new T.Vector3();
  }
  Police.prototype.init = function () {
    this.lastKnown.copy(this.game.world.spawn); this.buildRoadGraph(); return this;
  };
  Police.prototype.crime = function (type) {
    if (this.game.player.hp <= 0) return;
    var level = 1;
    if (type === 'killing' || type === 'assaultPolice') level = 2;
    if (type === 'killPolice') level = 3;
    if (type === 'shooting') {
      this.shots.push(this.clock);
      this.shots = this.shots.filter(function (t) { return this.clock - t < 24; }, this);
      if (this.shots.length >= 18) level = 3;
    }
    var previous = this.wanted;
    this.wanted = Math.max(this.wanted, level); this.evadeTime = 0; this.detected = true;
    this.lastCrimeTime = this.clock; this.lastKnown.copy(this.game.focusPosition());
    if (this.wanted > previous && this.game.hud) {
      var messages = ['', 'WANTED · Police are responding', 'WANTED ×2 · Roadblock reported ahead', 'WANTED ×3 · SWAT response authorized'];
      this.game.hud.notify(messages[this.wanted], 'danger');
    }
    this._spawnTimer = 0;
  };
  Police.prototype.lineClear = function (a, b, radius) {
    var length = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(1, Math.ceil(length / 4));
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      if (this.game.world.isBlocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius || 1.2)) return false;
    }
    return true;
  };
  Police.prototype.canSee = function (origin, target) {
    var direction = target.clone().sub(origin), length = direction.length();
    if (length < 0.1) return true;
    this._ray.set(origin, direction.multiplyScalar(1 / length));
    var colliders = this.game.world.colliders || [];
    for (var i = 0; i < colliders.length; i++) {
      if (!colliders[i].isBox3) continue;
      var hit = this._ray.intersectBox(colliders[i], this._intersection);
      if (hit && hit.distanceToSquared(origin) < (length - 0.2) * (length - 0.2)) return false;
    }
    return true;
  };
  Police.prototype.buildRoadGraph = function () {
    var world = this.game.world, segments = [], nodes = this.nodes, self = this;
    (world.roads || []).forEach(function (r) {
      if (r.width < 10 || !Number.isFinite(r.x1)) return;
      segments.push([new T.Vector3(r.x1, 0, r.z1), new T.Vector3(r.x2, 0, r.z2)]);
    });
    if (!segments.length) (world.trafficRoutes || []).forEach(function (route) {
      var pts = route.points || route;
      for (var i = 0; i < pts.length; i++) segments.push([point(pts[i]), point(pts[(i + 1) % pts.length])]);
    });
    var lookup = {};
    function add(p) {
      var key = Math.round(p.x * 10) + ':' + Math.round(p.z * 10);
      if (lookup[key] !== undefined) return lookup[key];
      var index = nodes.length; lookup[key] = index; nodes.push({ point: p.clone(), links: [] }); return index;
    }
    segments.forEach(function (s) { add(s[0]); add(s[1]); });
    for (var i = 0; i < segments.length; i++) {
      var a = segments[i][0], b = segments[i][1], rx = b.x - a.x, rz = b.z - a.z;
      for (var j = i + 1; j < segments.length; j++) {
        var c = segments[j][0], d = segments[j][1], sx = d.x - c.x, sz = d.z - c.z, cross = rx * sz - rz * sx;
        if (Math.abs(cross) < 0.0001) continue;
        var qx = c.x - a.x, qz = c.z - a.z, ta = (qx * sz - qz * sx) / cross, tb = (qx * rz - qz * rx) / cross;
        if (ta >= 0 && ta <= 1 && tb >= 0 && tb <= 1) add(new T.Vector3(a.x + ta * rx, 0, a.z + ta * rz));
      }
    }
    segments.forEach(function (s) {
      var dx = s[1].x - s[0].x, dz = s[1].z - s[0].z, len2 = dx * dx + dz * dz, list = [];
      if (len2 < 1) return;
      nodes.forEach(function (n, index) {
        var t = ((n.point.x - s[0].x) * dx + (n.point.z - s[0].z) * dz) / len2;
        var px = s[0].x + t * dx, pz = s[0].z + t * dz;
        if (t >= -0.001 && t <= 1.001 && Math.hypot(px - n.point.x, pz - n.point.z) < 0.2) list.push({ index: index, t: t });
      });
      list.sort(function (a, b) { return a.t - b.t; });
      for (var i = 1; i < list.length; i++) {
        var x = list[i - 1].index, y = list[i].index;
        if (!self.lineClear(nodes[x].point, nodes[y].point, 1.45)) continue;
        if (nodes[x].links.indexOf(y) === -1) nodes[x].links.push(y);
        if (nodes[y].links.indexOf(x) === -1) nodes[y].links.push(x);
      }
    });
  };
  Police.prototype.routeTo = function (from, to) {
    var nodes = this.nodes, self = this;
    if (nodes.length < 2) return [to.clone()];
    function nearest(p) {
      var candidates = nodes.map(function (node, index) { return { index: index, distance: node.point.distanceToSquared(p) }; });
      candidates.sort(function (a, b) { return a.distance - b.distance; });
      for (var i = 0; i < Math.min(8, candidates.length); i++) if (nodes[candidates[i].index].links.length && self.lineClear(p, nodes[candidates[i].index].point, 1.3)) return candidates[i].index;
      return candidates[0].index;
    }
    var start = nearest(from), goal = nearest(to), costs = [], previous = [], done = [], open = [start];
    for (var i = 0; i < nodes.length; i++) costs[i] = Infinity;
    costs[start] = 0;
    while (open.length) {
      var bestAt = 0, bestScore = Infinity;
      for (var k = 0; k < open.length; k++) {
        var score = costs[open[k]] + nodes[open[k]].point.distanceTo(nodes[goal].point);
        if (score < bestScore) { bestScore = score; bestAt = k; }
      }
      var current = open.splice(bestAt, 1)[0];
      if (current === goal) break;
      done[current] = true;
      nodes[current].links.forEach(function (next) {
        if (done[next]) return;
        var cost = costs[current] + nodes[current].point.distanceTo(nodes[next].point);
        if (cost < costs[next]) { costs[next] = cost; previous[next] = current; if (open.indexOf(next) === -1) open.push(next); }
      });
    }
    if (!Number.isFinite(costs[goal])) return [nodes[start].point.clone(), to.clone()];
    var result = [], cursor = goal, guard = 0;
    while (cursor !== undefined && guard++ <= nodes.length) { result.unshift(nodes[cursor].point.clone()); if (cursor === start) break; cursor = previous[cursor]; }
    result.push(to.clone());
    // Skip a redundant initial intersection only when the connecting road is clear.
    if (result.length > 2 && this.lineClear(from, result[1], 1.4)) result.shift();
    return result;
  };
  Police.prototype.chooseSpawn = function (slot, ahead) {
    var game = this.game, target = game.focusPosition(), car = game.player.vehicle;
    var heading = car ? car.heading : game.player.heading || 0;
    var wish = target.clone().add(new T.Vector3(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(ahead ? 60 : -55));
    var candidates = (game.world.roadSpawns || []).map(point);
    this.nodes.forEach(function (n) { if (n.links.length) candidates.push(n.point.clone()); });
    candidates.sort(function (a, b) {
      function score(p) { var d = p.distanceTo(target); return p.distanceToSquared(wish) + (d < 32 ? 100000 : 0) + (d > 140 ? 50000 : 0); }
      return score(a) - score(b);
    });
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].distanceTo(target) < 25) continue;
      var p = game.vehicles.findClear(candidates[(i + slot % 2) % candidates.length], 1.45, 9);
      if (p) return p;
    }
    return game.vehicles.findClear(wish, 1.5, 28);
  };
  Police.prototype.activateUnit = function (type, role, slot) {
    var game = this.game, pos = this.chooseSpawn(slot, role === 'roadblock');
    if (!pos) return null;
    var v = null;
    for (var i = 0; i < this.units.length; i++) if (this.units[i].type === type && !this.units[i].pursuitActive && this.units[i].driver !== 'player') { v = this.units[i]; break; }
    var target = game.focusPosition(), heading = Math.atan2(target.x - pos.x, target.z - pos.z);
    if (role === 'roadblock') heading = (game.player.vehicle ? game.player.vehicle.heading : heading) + Math.PI / 2;
    if (!v) { v = game.vehicles.spawn(type, pos, heading, { driver: 'police', police: true }); this.units.push(v); }
    v.position.copy(pos); v.heading = heading; v.mesh.rotation.set(0, heading, 0); v.active = true; v.mesh.visible = true;
    v.hp = v.maxHp; v.destroyed = false; v.driver = 'police'; v.speed = 0; v.velocity.set(0, 0, 0); v.siren = true;
    v.spawnPosition.copy(pos); v.spawnHeading = heading; v.pursuitActive = true;
    v.policeAI = { role: role, slot: slot, path: [], index: 0, routeTime: 0, think: 0, steer: 0, throttle: 0, stuck: 0, reverse: 0, deployed: false, age: 0, origin: pos.clone() };
    return v;
  };
  Police.prototype.ensureResponse = function () {
    var chasing = this.units.filter(function (v) { return v.pursuitActive && v.driver === 'police' && !v.destroyed && v.type === 'police' && v.policeAI.role !== 'roadblock'; });
    while (chasing.length < this.wanted) {
      var v = this.activateUnit('police', 'chase', chasing.length);
      if (!v) break;
      chasing.push(v);
    }
    if (this.wanted >= 2 && !this.roadblockLevel) {
      var block = this.activateUnit('police', 'roadblock', 4);
      if (block) this.roadblockLevel = true;
    }
    if (this.wanted >= 3 && !this.units.some(function (v) { return v.type === 'swat' && v.pursuitActive && v.driver === 'police' && !v.destroyed; })) this.activateUnit('swat', 'chase', 3);
  };
  Police.prototype.deploy = function (v, count) {
    var game = this.game, self = this, alive = this.officers.filter(function (p) { return p.hp > 0; }).length;
    count = Math.min(count, 9 - alive);
    for (var i = 0; i < count; i++) {
      var side = i % 2 ? -1 : 1;
      var origin = v.position.clone().add(new T.Vector3(Math.cos(v.heading) * side * 2.6, 0, -Math.sin(v.heading) * side * 2.6));
      var pos = game.vehicles.findClear(origin, 0.5, 6); if (!pos) continue;
      var tactical = v.type === 'swat', mesh = MG.makePerson(tactical ? 0x30433d : 0x1e416c, 0xb17b54);
      equipment(mesh, equipmentMaterial, 0.58, 0.11, 0.61, 0, 1.94, 0.04);
      equipment(mesh, equipmentMaterial, 0.48, tactical ? 0.21 : 0.13, 0.47, 0, 2.01, 0);
      equipment(mesh, equipmentMaterial, 0.55, 0.45, 0.11, 0, 1.11, 0.19);
      equipment(mesh, badgeMaterial, 0.095, 0.13, 0.035, -0.14, 1.23, 0.265);
      equipment(mesh, equipmentMaterial, 0.56, 0.09, 0.34, 0, 0.76, 0);
      var gun = equipment(mesh, equipmentMaterial, 0.09, 0.11, tactical ? 0.55 : 0.29, -0.27, 1.22, 0.5);
      mesh.position.copy(pos);
      var p = { mesh: mesh, position: mesh.position, hp: tactical ? 80 : 60, state: 'flank', radius: 0.5,
        tactical: tactical, unit: v, side: side, phase: this.officers.length * 1.37, shot: 0.8 + i * 0.37,
        think: 0, target: pos.clone(), heading: v.heading, speed: 0, deadTime: 0, hitCooldown: 0, gun: gun,
        damage: null };
      p.damage = (function (officer) { return function (amount, impulse) { self.hurtOfficer(officer, amount, impulse); }; }(p));
      mesh.userData.person = p; game.scene.add(mesh); this.officers.push(p);
    }
    v.policeAI.deployed = true;
  };
  Police.prototype.hurtOfficer = function (p, amount, impulse) {
    if (p.hp <= 0 || amount <= 0) return;
    p.hp = Math.max(0, p.hp - amount); p.hitCooldown = 0.9;
    if (impulse && impulse.isVector3) this.game.world.moveCircle(p.position, impulse.clone().setY(0), p.radius);
    this.crime(p.hp === 0 ? 'killPolice' : 'assaultPolice');
    if (p.hp === 0) { p.state = 'dead'; p.deadTime = 0; p.speed = 0; p.gun.visible = false; }
    else { p.think = 0; p.state = 'cover'; }
  };
  Police.prototype.findCover = function (p, target) {
    var colliders = this.game.world.colliders || [], best = null, score = Infinity;
    for (var i = 0; i < colliders.length; i++) {
      var box = colliders[i]; if (!box.isBox3 || box.max.y < 0.8) continue;
      if (p.position.x < box.min.x - 14 || p.position.x > box.max.x + 14 || p.position.z < box.min.z - 14 || p.position.z > box.max.z + 14) continue;
      var corners = [[box.min.x - 0.9, box.min.z - 0.9], [box.max.x + 0.9, box.min.z - 0.9], [box.min.x - 0.9, box.max.z + 0.9], [box.max.x + 0.9, box.max.z + 0.9]];
      for (var j = 0; j < corners.length; j++) {
        var q = new T.Vector3(corners[j][0], p.position.y, corners[j][1]);
        var dist = q.distanceTo(p.position), range = q.distanceTo(target);
        if (dist > 15 || range < 8 || range > 34 || this.game.world.isBlocked(q.x, q.z, 0.55)) continue;
        var eye = q.clone(); eye.y += 1.3;
        if (!this.canSee(eye, target)) continue;
        var s = dist + Math.abs(range - 19) * 0.35;
        if (s < score) { score = s; best = q; }
      }
    }
    return best;
  };
  Police.prototype.updateOfficer = function (p, dt, target) {
    var game = this.game;
    if (p.hp <= 0) {
      if (!p.mesh.visible) return;
      p.deadTime += dt; p.mesh.rotation.z += (p.side * Math.PI / 2 - p.mesh.rotation.z) * (1 - Math.exp(-7 * dt));
      if (p.deadTime > 35) p.mesh.visible = false;
      return;
    }
    if (!this.wanted) return;
    p.hitCooldown = Math.max(0, p.hitCooldown - dt);
    var car = game.player.vehicle;
    if (car && Math.abs(car.speed) > 3 && p.hitCooldown <= 0 && p.position.distanceTo(car.position) < car.radius + 0.55) {
      p.damage(Math.abs(car.speed) * 5, new T.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading)).multiplyScalar(Math.sign(car.speed)));
      if (p.hp <= 0) return;
    }
    p.think -= dt; p.shot -= dt;
    var dist = p.position.distanceTo(target);
    if (p.think <= 0) {
      p.think = 0.3 + (p.phase % 0.15);
      var away = p.position.clone().sub(target).setY(0).normalize();
      if (away.lengthSq() < 0.1) away.set(1, 0, 0);
      var cover = dist < 31 && (p.tactical || p.hp < 35) ? this.findCover(p, target) : null;
      if (cover) { p.target.copy(cover); p.state = 'cover'; }
      else {
        var flank = new T.Vector3(away.z * p.side, 0, -away.x * p.side);
        p.target.copy(target).addScaledVector(away, dist < 9 ? 14 : 17).addScaledVector(flank, 5 + Math.sin(this.clock * 0.7 + p.phase) * 3);
        p.state = 'flank';
      }
      if (game.world.isBlocked(p.target.x, p.target.z, 0.5)) {
        var safe = game.vehicles.findClear(p.target, 0.5, 8);
        if (safe) p.target.copy(safe); else p.target.copy(p.position);
      }
    }
    var move = p.target.clone().sub(p.position).setY(0), travel = move.length();
    p.speed = travel > 1.2 ? (dist > 28 ? 4.1 : 2.6) : 0;
    if (p.speed > 0) game.world.moveCircle(p.position, move.normalize().multiplyScalar(Math.min(travel, p.speed * dt)), 0.5);
    p.heading += turn(p.heading, Math.atan2(target.x - p.position.x, target.z - p.position.z)) * (1 - Math.exp(-10 * dt));
    p.mesh.rotation.y = p.heading;
    MG.animatePerson(p.mesh, this.clock + p.phase, p.speed, false);
    p.mesh.userData.arms[0].rotation.x = -1.42; p.mesh.userData.arms[1].rotation.x = -1.25;
    var origin = p.position.clone(); origin.y += 1.32; origin.x += Math.sin(p.heading) * 0.55; origin.z += Math.cos(p.heading) * 0.55;
    var aim = target.clone(); aim.y += game.player.vehicle ? 1.05 : 1.0;
    if (p.shot <= 0 && dist < 38 && game.player.hp > 0 && this.canSee(origin, aim)) {
      if (game.combat && game.combat.spawnPoliceBullet) game.combat.spawnPoliceBullet(origin, aim);
      p.shot = 1.5;
    }
  };
  Police.prototype.updateUnit = function (v, dt, target) {
    var ai = v.policeAI, game = this.game;
    if (!v.pursuitActive || !ai || v.driver !== 'police') return;
    if (v.destroyed) { v.pursuitActive = false; return; }
    ai.age += dt; ai.routeTime -= dt; ai.think -= dt;
    var distance = v.position.distanceTo(target);
    if (ai.role === 'roadblock') {
      v.speed = 0; v.velocity.set(0, 0, 0);
      if (this.wanted >= 3 && !ai.deployed && distance < 40) this.deploy(v, 2);
      if (ai.age < 12 || distance < 30) return;
      ai.role = 'chase';
    }
    if (this.wanted >= 3 && !ai.deployed && ((v.type === 'swat' && (distance < 32 || ai.age > 16)) || (!game.player.vehicle && distance < 17))) this.deploy(v, v.type === 'swat' ? 4 : 1);
    if (ai.deployed && !game.player.vehicle && distance < 13) { game.vehicles.drive(v, v.speed > 0.4 ? -0.9 : 0, 0, dt); return; }
    if (ai.think <= 0) {
      ai.think = 0.09 + ai.slot * 0.01;
      var prediction = target.clone(), car = game.player.vehicle;
      if (car && this.detected) prediction.addScaledVector(car.velocity, clamp(distance / 38, 0.3, 1.65));
      if (game.world.isBlocked(prediction.x, prediction.z, 1.5)) prediction.copy(target);
      var direct = distance < 42 && this.lineClear(v.position, prediction, v.radius + 0.1);
      var goal = prediction;
      if (!direct) {
        if (ai.routeTime <= 0 || !ai.path.length) { ai.path = this.routeTo(v.position, prediction); ai.index = 0; ai.routeTime = 1.5 + ai.slot * 0.1; }
        while (ai.index < ai.path.length - 1 && v.position.distanceTo(ai.path[ai.index]) < Math.max(5, Math.abs(v.speed) * 0.38)) ai.index++;
        if (ai.path[ai.index]) goal = ai.path[ai.index];
      }
      var desiredHeading = Math.atan2(goal.x - v.position.x, goal.z - v.position.z), error = turn(v.heading, desiredHeading);
      ai.steer = clamp(error * 1.8, -1, 1);
      var desiredSpeed = Math.min(v.maxSpeed * 0.82, 20 + this.wanted * 7) * clamp(1 - Math.abs(error) * 0.8, 0.18, 1);
      if (distance < 14) desiredSpeed = Math.min(desiredSpeed, car ? Math.max(8, Math.abs(car.speed) + 4) : 5);
      var probe = 3 + Math.abs(v.speed) * 0.42;
      var aheadBlocked = game.world.isBlocked(v.position.x + Math.sin(v.heading) * probe, v.position.z + Math.cos(v.heading) * probe, v.radius);
      if (aheadBlocked) {
        desiredSpeed = Math.min(desiredSpeed, 6);
        var options = [0.55, -0.55, 1.1, -1.1], best = Infinity;
        for (var i = 0; i < options.length; i++) {
          var h = v.heading + options[i];
          if (game.world.isBlocked(v.position.x + Math.sin(h) * probe, v.position.z + Math.cos(h) * probe, v.radius)) continue;
          var score = Math.abs(turn(h, desiredHeading));
          if (score < best) { best = score; ai.steer = Math.sign(options[i]); }
        }
      }
      // Police yield to allies/traffic; the player is the only intentional ram target.
      for (var j = 0; j < game.vehicles.items.length; j++) {
        var other = game.vehicles.items[j]; if (other === v || !other.active || other === car) continue;
        var dx = other.position.x - v.position.x, dz = other.position.z - v.position.z;
        var along = dx * Math.sin(v.heading) + dz * Math.cos(v.heading), side = dx * Math.cos(v.heading) - dz * Math.sin(v.heading);
        if (along > 0 && along < 6 + Math.max(0, v.speed) * 0.55 && Math.abs(side) < v.radius + other.radius + 0.6) {
          desiredSpeed = Math.min(desiredSpeed, Math.max(0, along - 3) * 1.4);
          ai.steer = clamp(ai.steer + (side > 0 ? -0.6 : 0.6), -1, 1);
        }
      }
      ai.throttle = desiredSpeed < 0.3 ? (v.speed > 0.3 ? -0.8 : 0) : clamp((desiredSpeed - v.speed) * 0.4, -1, 1);
      if (Math.abs(v.speed) < 1 && desiredSpeed > 2) ai.stuck += ai.think; else ai.stuck = Math.max(0, ai.stuck - ai.think);
      if (ai.stuck > 1.8) { ai.reverse = 1.2; ai.stuck = 0; ai.routeTime = 0; }
    }
    if (ai.reverse > 0) { ai.reverse -= dt; game.vehicles.drive(v, -0.8, -ai.steer, dt); }
    else game.vehicles.drive(v, ai.throttle, ai.steer, dt);
  };
  Police.prototype.clear = function (silent) {
    var wasWanted = this.wanted;
    this.wanted = 0; this.evadeTime = 0; this.detected = false; this.shots.length = 0; this.roadblockLevel = false;
    for (var i = 0; i < this.units.length; i++) {
      var v = this.units[i]; v.siren = false; v.pursuitActive = false;
      if (v.driver === 'player') continue;
      var clear = this.game.vehicles.findClear(v.spawnPosition, v.radius, 10);
      if (clear) v.position.copy(clear); else v.position.copy(v.spawnPosition);
      v.heading = v.spawnHeading; v.mesh.rotation.set(0, v.heading, 0); v.speed = 0; v.velocity.set(0, 0, 0);
      v.driver = null; v.policeAI = null; v.hp = v.maxHp; v.destroyed = false;
    }
    for (var j = 0; j < this.officers.length; j++) {
      this.officers[j].hp = 0; this.officers[j].state = 'inactive'; this.officers[j].mesh.visible = false;
      this.game.scene.remove(this.officers[j].mesh);
    }
    this.officers.length = 0;
    if (wasWanted && !silent && this.game.hud) this.game.hud.notify('POLICE EVADED · Keep a low profile', 'success');
  };
  Police.prototype.reset = function () { this.clear(true); this.lastCrimeTime = -100; this._spawnTimer = 0; this.lastKnown.copy(this.game.world.spawn); };
  Police.prototype.update = function (dt) {
    dt = Math.min(dt, 0.1); this.clock += dt; this._frame++;
    if (!this.wanted) return;
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0) { this.ensureResponse(); this._spawnTimer = 2; }
    var focus = this.game.focusPosition(); this.detected = false;
    for (var i = 0; i < this.units.length; i++) {
      var v = this.units[i];
      if (v.pursuitActive && v.driver === 'police' && !v.destroyed && v.position.distanceToSquared(focus) <= 2500) this.detected = true;
    }
    for (var j = 0; j < this.officers.length; j++) if (this.officers[j].hp > 0 && this.officers[j].position.distanceToSquared(focus) <= 2500) this.detected = true;
    if (this.detected) { this.evadeTime = 0; this.lastKnown.copy(focus); }
    else { this.evadeTime += dt; if (this.evadeTime >= 15) { this.clear(); return; } }
    var target = this.detected ? focus : this.lastKnown;
    for (var n = 0; n < this.units.length; n++) this.updateUnit(this.units[n], dt, target);
    for (var k = 0; k < this.officers.length; k++) this.updateOfficer(this.officers[k], dt, target);
  };
  MG.Police = Police;
}());