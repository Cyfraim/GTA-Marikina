(function () {
  'use strict';
  var MG = window.MG = window.MG || {}, T = window.THREE;
  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };
  var deltaAngle = function (a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); };
  function point(p) {
    p = p.position || p;
    if (Array.isArray(p)) return new T.Vector3(p[0], p.length > 2 ? p[1] : 0, p.length > 2 ? p[2] : p[1]);
    return new T.Vector3(p.x || 0, p.y || 0, p.z || 0);
  }
  function routes(source) {
    if (!source || !source.length) return [];
    if (source[0].isVector3 || (typeof source[0].x === 'number')) source = [source];
    return source.map(function (r) { return (r.points || r.waypoints || r).map(point); }).filter(function (r) { return r.length > 1; });
  }
  function addBox(parent, color, w, h, d, x, y, z) {
    var mesh = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshLambertMaterial({ color: MG.srgb(color) }));
    mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  function NPCs(game) {
    this.game = game; this.people = []; this.traffic = []; this.frame = 0; this.clock = 0;
    this.pedestrianRoutes = []; this.trafficRoutes = []; this._screamCooldown = 0;
  }
  NPCs.prototype.init = function () {
    var game = this.game, self = this;
    this.pedestrianRoutes = routes(game.world.pedestrianRoutes);
    this.trafficRoutes = routes(game.world.trafficRoutes);
    if (!this.pedestrianRoutes.length) {
      var c = point(game.world.spawn);
      this.pedestrianRoutes = [[c.clone().add(new T.Vector3(-13, 0, -11)), c.clone().add(new T.Vector3(13, 0, -11)), c.clone().add(new T.Vector3(13, 0, 11)), c.clone().add(new T.Vector3(-13, 0, 11))]];
    }
    // Seed by distance so the starting neighbourhood feels populated immediately.
    this.pedestrianRoutes.sort(function (a, b) { return a[0].distanceToSquared(game.world.spawn) - b[0].distanceToSquared(game.world.spawn); });
    for (var i = 0; i < 20; i++) {
      var route = this.pedestrianRoutes[i % Math.min(8, this.pedestrianRoutes.length)];
      var index = Math.floor(i / Math.min(8, this.pedestrianRoutes.length)) % route.length;
      var pos = route[index].clone().lerp(route[(index + 1) % route.length], 0.17 + ((i * 0.271) % 0.67));
      var clear = game.vehicles.findClear(pos, 0.5, 7);
      if (!clear) clear = game.vehicles.findClear(point(game.world.spawn).add(new T.Vector3((i % 5) * 2 - 4, 0, Math.floor(i / 5) * 2)), 0.5, 20);
      if (clear) this.spawnPerson(clear, route, (index + 1) % route.length, i);
    }
    var kinds = ['jeepney', 'tricycle', 'jeepney', 'tricycle', 'uv', 'jeepney', 'tricycle'];
    for (var n = 0; n < 7; n++) {
      if (!this.trafficRoutes.length) break;
      var path = this.trafficRoutes[n % this.trafficRoutes.length];
      var segment = Math.floor(n * 1.71) % path.length, from = path[segment], to = path[(segment + 1) % path.length];
      var spawn = from.clone().lerp(to, 0.14 + (n * 0.19) % 0.61);
      var heading = Math.atan2(to.x - from.x, to.z - from.z);
      // Philippine right-hand traffic: keep right of each directed route segment.
      spawn.x -= Math.cos(heading) * 2.9; spawn.z += Math.sin(heading) * 2.9;
      spawn = game.vehicles.findClear(spawn, 1.3, 6);
      if (!spawn) continue;
      var v = game.vehicles.spawn(kinds[n], spawn, heading, { driver: 'traffic' });
      this.traffic.push({ vehicle: v, route: path, index: (segment + 1) % path.length, cruise: Math.min(v.maxSpeed, 15 + n % 6), stuck: 0, reverse: 0, think: 0, steer: 0, throttle: 1, stopped: 0, origin: v.position.clone() });
    }
    this.people.forEach(function (p) { p.mesh.userData.person = p; });
    return self;
  };
  NPCs.prototype.spawnPerson = function (position, route, index, variant) {
    var self = this, colors = [0xc77f42, 0x24a1a1, 0xf1cd68, 0x6a83bd, 0xa95472, 0xe8dfc4, 0x77a663, 0x3f638f];
    var skins = [0xa66b47, 0xc3895d, 0xd7a67a, 0xb47950];
    var mesh = MG.makePerson(colors[variant % colors.length], skins[variant % skins.length]);
    mesh.position.copy(position); mesh.scale.setScalar(0.88 + (variant % 5) * 0.037);
    mesh.rotation.y = variant * 1.8;
    if (variant % 4 === 0) {
      addBox(mesh, 0xd8ba80, 0.66, 0.07, 0.63, 0, 1.94, 0.04);
      addBox(mesh, 0xc69b58, 0.45, 0.17, 0.44, 0, 2.03, 0);
    } else if (variant % 4 === 1) {
      addBox(mesh, 0x934a31, 0.4, 0.52, 0.19, 0, 1.04, -0.25);
    } else if (variant % 4 === 2) {
      addBox(mesh, 0xc4dccb, 0.28, 0.4, 0.21, 0.43, 0.59, 0);
    }
    if (MG.batchStatic) MG.batchStatic(mesh, true);
    var p = { mesh: mesh, position: mesh.position, hp: 30, state: variant % 6 === 0 ? 'idle' : 'walk', radius: 0.5,
      route: route, waypoint: index || 0, speed: 0, walkSpeed: 1.05 + variant % 5 * 0.15, heading: mesh.rotation.y,
      desired: new T.Vector3(), threat: new T.Vector3(), fleeUntil: 0, idleUntil: this.clock + 1 + variant % 4,
      phase: variant * 1.137, decisionDt: 0, deadTime: 0, hitCooldown: 0, corpseSide: variant % 2 ? 1 : -1,
      damage: function (amount, impulse) { self.hurt(p, amount, impulse); } };
    this.game.scene.add(mesh); this.people.push(p); return p;
  };
  NPCs.prototype.hurt = function (p, amount, impulse) {
    if (p.hp <= 0 || amount <= 0) return;
    p.hp = Math.max(0, p.hp - amount); p.hitCooldown = 0.9;
    if (impulse && impulse.isVector3) this.game.world.moveCircle(p.position, impulse.clone().setY(0), p.radius);
    if (p.hp === 0) {
      p.state = 'dead'; p.speed = 0; p.deadTime = 0;
      if (this.game.police) this.game.police.crime('killing');
    } else {
      p.state = 'flee'; p.threat.copy(this.game.focusPosition()); p.fleeUntil = this.clock + 9;
      if (this.game.police) this.game.police.crime('assault');
    }
    this.onGunshot(p.position);
  };
  NPCs.prototype.onGunshot = function (position) {
    var affected = 0;
    for (var i = 0; i < this.people.length; i++) {
      var p = this.people[i];
      if (p.hp <= 0 || p.position.distanceToSquared(position) > 225) continue;
      p.threat.copy(position); p.fleeUntil = this.clock + 7 + Math.random() * 5; p.state = 'flee'; affected++;
    }
    if (affected && this._screamCooldown <= 0) {
      if (this.game.audio) this.game.audio.scream(); this._screamCooldown = 1.8;
    }
  };
  NPCs.prototype.ejectDriver = function (vehicle) {
    // Reuse a nearby pedestrian reaction rather than growing the population forever.
    this.onGunshot(vehicle.position);
    if (this.game.police) this.game.police.crime('theft');
  };
  NPCs.prototype.decide = function (p, elapsed) {
    var game = this.game, world = game.world;
    p.desired.set(0, 0, 0);
    if (p.state === 'flee' && this.clock >= p.fleeUntil) { p.state = 'walk'; p.waypoint = this.nearestWaypoint(p); }
    if (p.state === 'idle') {
      if (this.clock < p.idleUntil) return;
      p.state = 'walk';
    }
    if (p.state === 'flee') {
      p.desired.copy(p.position).sub(p.threat).setY(0);
      if (p.desired.lengthSq() < 0.01) p.desired.set(Math.sin(p.phase), 0, Math.cos(p.phase));
      p.desired.normalize(); p.speed = 5.2 + Math.sin(p.phase) * 0.55;
    } else {
      var goal = p.route[p.waypoint];
      var dist = Math.hypot(goal.x - p.position.x, goal.z - p.position.z);
      if (dist < 1.2) {
        p.waypoint = (p.waypoint + 1) % p.route.length;
        if (Math.random() < 0.25) { p.state = 'idle'; p.idleUntil = this.clock + 1.5 + Math.random() * 4; p.speed = 0; return; }
        goal = p.route[p.waypoint];
      }
      p.desired.copy(goal).sub(p.position).setY(0).normalize(); p.speed = p.walkSpeed;
    }
    var avoid = new T.Vector3();
    for (var i = 0; i < this.people.length; i++) {
      var other = this.people[i]; if (other === p || other.hp <= 0) continue;
      var dx = p.position.x - other.position.x, dz = p.position.z - other.position.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.4 && d2 > 0.001) { avoid.x += dx / d2 * 0.42; avoid.z += dz / d2 * 0.42; }
    }
    for (var j = 0; j < game.vehicles.items.length; j++) {
      var v = game.vehicles.items[j]; if (!v.active) continue;
      var distance = Math.hypot(v.position.x - p.position.x, v.position.z - p.position.z);
      if (distance < v.radius + 1.2) {
        avoid.x += (p.position.x - v.position.x) / Math.max(0.2, distance) * 1.8;
        avoid.z += (p.position.z - v.position.z) / Math.max(0.2, distance) * 1.8;
      }
    }
    p.desired.add(avoid).normalize();
    var look = p.state === 'flee' ? 2.0 : 1.25, heading = Math.atan2(p.desired.x, p.desired.z);
    if (world.isBlocked(p.position.x + p.desired.x * look, p.position.z + p.desired.z * look, p.radius)) {
      var found = false, turns = [0.6, -0.6, 1.15, -1.15, 1.8, -1.8, Math.PI];
      for (var k = 0; k < turns.length; k++) {
        var test = heading + turns[k];
        if (!world.isBlocked(p.position.x + Math.sin(test) * look, p.position.z + Math.cos(test) * look, p.radius)) {
          p.desired.set(Math.sin(test), 0, Math.cos(test)); found = true; break;
        }
      }
      if (!found) { p.desired.set(0, 0, 0); p.speed = 0; }
    }
  };
  NPCs.prototype.nearestWaypoint = function (p) {
    var best = 0, distance = Infinity;
    p.route.forEach(function (v, i) { var d = v.distanceToSquared(p.position); if (d < distance) { best = i; distance = d; } });
    return best;
  };
  NPCs.prototype.updateTraffic = function (dt) {
    var game = this.game, world = game.world;
    for (var i = 0; i < this.traffic.length; i++) {
      var ai = this.traffic[i], v = ai.vehicle;
      if (v.driver !== 'traffic' || !v.active || v.destroyed) continue;
      ai.think -= dt;
      if (ai.think <= 0) {
        ai.think = 0.10 + (i % 3) * 0.012;
        var goal = ai.route[ai.index], prev = ai.route[(ai.index + ai.route.length - 1) % ai.route.length];
        var routeHeading = Math.atan2(goal.x - prev.x, goal.z - prev.z);
        var target = goal.clone(); target.x -= Math.cos(routeHeading) * 2.9; target.z += Math.sin(routeHeading) * 2.9;
        if (target.distanceTo(v.position) < Math.max(5, Math.abs(v.speed) * 0.8)) {
          ai.index = (ai.index + 1) % ai.route.length; goal = ai.route[ai.index];
          prev = ai.route[(ai.index + ai.route.length - 1) % ai.route.length];
          routeHeading = Math.atan2(goal.x - prev.x, goal.z - prev.z);
          target.copy(goal); target.x -= Math.cos(routeHeading) * 2.9; target.z += Math.sin(routeHeading) * 2.9;
        }
        var error = deltaAngle(v.heading, Math.atan2(target.x - v.position.x, target.z - v.position.z));
        ai.steer = clamp(error * 1.75, -1, 1);
        var desiredSpeed = ai.cruise * clamp(1 - Math.abs(error) * 0.65, 0.22, 1);
        var fx = Math.sin(v.heading), fz = Math.cos(v.heading), nearest = Infinity;
        for (var j = 0; j < game.vehicles.items.length; j++) {
          var other = game.vehicles.items[j]; if (other === v || !other.active) continue;
          var dx = other.position.x - v.position.x, dz = other.position.z - v.position.z;
          var along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
          if (along > 0 && side < v.radius + other.radius + 0.4) nearest = Math.min(nearest, along - v.radius - other.radius);
        }
        // Leave a real braking gap instead of pushing a stationary queue forever.
        if (nearest < 3 + Math.max(0, v.speed) * 0.9) desiredSpeed = Math.min(desiredSpeed, Math.max(0, (nearest - 2.5) * 1.25));
        var probe = 3 + Math.max(0, v.speed) * 0.55;
        if (world.isBlocked(v.position.x + fx * probe, v.position.z + fz * probe, v.radius)) {
          desiredSpeed = Math.min(desiredSpeed, 5);
          var leftClear = !world.isBlocked(v.position.x + Math.sin(v.heading - 0.7) * probe, v.position.z + Math.cos(v.heading - 0.7) * probe, v.radius);
          var rightClear = !world.isBlocked(v.position.x + Math.sin(v.heading + 0.7) * probe, v.position.z + Math.cos(v.heading + 0.7) * probe, v.radius);
          if (leftClear || rightClear) ai.steer = leftClear && !rightClear ? -1 : rightClear && !leftClear ? 1 : Math.sign(error) || 1;
          else desiredSpeed = 0;
        }
        ai.throttle = desiredSpeed < 0.4 ? (v.speed > 0.3 ? -0.65 : 0) : clamp((desiredSpeed - v.speed) * 0.42, -0.8, 1);
        if (Math.abs(v.speed) < 0.7 && desiredSpeed > 1) ai.stuck += ai.think; else ai.stuck = Math.max(0, ai.stuck - ai.think * 0.5);
        if (ai.stuck > 2.5) { ai.reverse = 1.25; ai.stuck = 0; }
      }
      if (ai.reverse > 0) { ai.reverse -= dt; game.vehicles.drive(v, -0.65, -ai.steer, dt); }
      else game.vehicles.drive(v, ai.throttle, ai.steer, dt);
    }
  };
  NPCs.prototype.update = function (dt) {
    dt = Math.min(dt, 0.1); this.clock += dt; this.frame++;
    this._screamCooldown = Math.max(0, this._screamCooldown - dt);
    this.updateTraffic(dt);
    var game = this.game, car = game.player.vehicle;
    for (var i = 0; i < this.people.length; i++) {
      var p = this.people[i]; p.hitCooldown = Math.max(0, p.hitCooldown - dt);
      if (p.hp <= 0) {
        p.deadTime += dt; p.mesh.rotation.z += (p.corpseSide * Math.PI / 2 - p.mesh.rotation.z) * (1 - Math.exp(-7 * dt));
        continue;
      }
      if (car && Math.abs(car.speed) > 3 && p.hitCooldown <= 0) {
        var start = car.previousPosition || car.position, end = car.position;
        var sx = end.x - start.x, sz = end.z - start.z, denom = sx * sx + sz * sz;
        var t = denom > 0 ? clamp(((p.position.x - start.x) * sx + (p.position.z - start.z) * sz) / denom, 0, 1) : 0;
        var distance = Math.hypot(p.position.x - start.x - sx * t, p.position.z - start.z - sz * t);
        if (distance < car.radius + p.radius) {
          p.damage(Math.min(65, Math.abs(car.speed) * 4), new T.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading)).multiplyScalar(Math.sign(car.speed) * 1.4));
          car.speed *= 0.83; if (p.hp <= 0) continue;
        }
      }
      p.decisionDt += dt;
      // Stagger expensive neighbourhood decisions, but integrate movement every frame.
      if ((this.frame + i) % 3 === 0) { this.decide(p, p.decisionDt); p.decisionDt = 0; }
      var speed = p.state === 'idle' ? 0 : p.speed;
      if (speed > 0 && p.desired.lengthSq() > 0) {
        game.world.moveCircle(p.position, p.desired.clone().multiplyScalar(speed * dt), p.radius);
        p.heading += deltaAngle(p.heading, Math.atan2(p.desired.x, p.desired.z)) * (1 - Math.exp(-10 * dt));
        p.mesh.rotation.y = p.heading;
      }
      p.position.y = game.world.groundHeight(p.position.x, p.position.z);
      MG.animatePerson(p.mesh, this.clock + p.phase, speed, p.state === 'flee');
    }
  };
  MG.NPCs = NPCs;
}());