(function () {
  'use strict';
  var MG = window.MG = window.MG || {};
  var T = window.THREE;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var angleDelta = function (a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); };
  var UP = new T.Vector3(0, 1, 0);
  var SPECS = {
    jeepney: { name: 'Sarao Jeepney', width: 2.05, length: 5.8, radius: 1.25, max: 35, accel: 12, hp: 180, turn: 1.28, mass: 2.2 },
    tricycle: { name: 'Marikina Tricycle', width: 1.85, length: 2.65, radius: 0.91, max: 55, accel: 17, hp: 95, turn: 1.85, mass: 0.65 },
    uv: { name: 'UV Express', width: 1.95, length: 4.9, radius: 1.17, max: 50, accel: 16, hp: 150, turn: 1.5, mass: 1.7 },
    car: { name: 'City Sedan', width: 1.8, length: 4.25, radius: 1.06, max: 60, accel: 20, hp: 120, turn: 1.65, mass: 1.2 },
    pedicab: { name: 'Padyak Pedicab', width: 1.65, length: 2.5, radius: 0.8, max: 15, accel: 6.5, hp: 75, turn: 2.1, mass: 0.3 },
    police: { name: 'Marikina Police SUV', width: 2.05, length: 4.75, radius: 1.2, max: 70, accel: 22, hp: 240, turn: 1.62, mass: 2 },
    swat: { name: 'PNP Tactical Response', width: 2.35, length: 5.8, radius: 1.4, max: 40, accel: 13, hp: 420, turn: 1.3, mass: 4.8 }
  };
  var paintCache = {};
  // Vehicles reuse paint materials so identical parts merge into one draw call.
  function mat(color, metal, rough) {
    var key = color + '|' + (metal || 0) + '|' + (rough === undefined ? 0.65 : rough);
    if (!paintCache[key]) paintCache[key] = new T.MeshStandardMaterial({ color: MG.srgb(color), metalness: metal || 0, roughness: rough === undefined ? 0.65 : rough });
    return paintCache[key];
  }
  var rubber = mat(0x22282f, 0.05, 0.98);
  var chrome = mat(0xc6d2df, 0.8, 0.27);
  var dark = mat(0x18222d, 0.18, 0.72);
  var seat = mat(0x313144, 0, 0.94);
  var glass = new T.MeshStandardMaterial({ color: MG.srgb(0x72b6cf), metalness: 0.12, roughness: 0.15, transparent: true, opacity: 0.58, depthWrite: false });
  var white = mat(0xe9eee9, 0.2, 0.5);
  var amber = mat(0xffb329, 0.2, 0.35);
  var palettes = [0xf3b52d, 0xc43537, 0x177f8b, 0x355fad, 0xddd3b5, 0x80aa55, 0x803d88];
  var labelCache = {};
  var unitBox = new T.BoxGeometry(1, 1, 1);
  function box(parent, w, h, d, x, y, z, material) {
    var m = new T.Mesh(unitBox, material); m.scale.set(w, h, d);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  function cylinder(parent, radius, height, x, y, z, material, segments) {
    var m = new T.Mesh(new T.CylinderGeometry(radius, radius, height, segments || 12), material);
    m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  }
  function bar(parent, a, b, radius, material) {
    var d = new T.Vector3().subVectors(b, a);
    var m = cylinder(parent, radius, d.length(), 0, 0, 0, material, 6);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); return m;
  }
  function label(parent, text, w, h, x, y, z, ry, fg, bg) {
    var key = text + ':' + fg + ':' + bg;
    if (!labelCache[key]) {
      var canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = bg || '#102238'; ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = fg || '#ffffff'; ctx.font = 'bold 54px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 69, 482);
      var tex = new T.CanvasTexture(canvas); tex.encoding = T.sRGBEncoding;
      labelCache[key] = new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide });
    }
    var m = new T.Mesh(new T.PlaneGeometry(w, h), labelCache[key]);
    m.position.set(x, y, z); m.rotation.y = ry || 0; parent.add(m); return m;
  }
  function wheel(parent, x, z, radius, width, wheels, front, spoke) {
    var pivot = new T.Group(); pivot.position.set(x, radius + 0.08, z); parent.add(pivot);
    var roll = new T.Group(); pivot.add(roll);
    var tire = cylinder(roll, radius, width, 0, 0, 0, rubber, 14); tire.rotation.z = Math.PI / 2;
    var hub = cylinder(roll, radius * (spoke ? 0.79 : 0.54), width + 0.014, 0, 0, 0, chrome, 12); hub.rotation.z = Math.PI / 2;
    if (spoke) {
      var inset = cylinder(roll, radius * 0.69, width + 0.023, 0, 0, 0, dark, 12); inset.rotation.z = Math.PI / 2;
    }
    for (var i = 0; i < 5; i++) {
      var a = i * Math.PI * 0.4;
      var bolt = box(roll, width + 0.04, radius * 0.12, radius * 0.12, 0, Math.sin(a) * radius * 0.36, Math.cos(a) * radius * 0.36, chrome);
      bolt.castShadow = false;
    }
    pivot.userData.roll = roll; pivot.userData.front = front; pivot.userData.radius = radius; wheels.push(pivot);
    if (MG.batchStatic) MG.batchStatic(roll, true);
    return pivot;
  }
  function makeModel(type, options) {
    var spec = SPECS[type], g = new T.Group(), wheels = [], lightMeshes = [], sirenMeshes = [];
    var paint = mat(options.color === undefined ? palettes[Math.floor(Math.random() * palettes.length)] : options.color, 0.3, 0.42);
    var headMat = new T.MeshStandardMaterial({ color: MG.srgb(0xfff4bf), emissive: MG.srgb(0xffe8ab), emissiveIntensity: 0.3, roughness: 0.3 });
    var tailMat = new T.MeshStandardMaterial({ color: MG.srgb(0xce2134), emissive: MG.srgb(0xf0242d), emissiveIntensity: 0.3 });
    var w = spec.width, l = spec.length;
    function lamps(y, z, spacing) {
      [-1, 1].forEach(function (side) {
        lightMeshes.push(box(g, 0.34, 0.2, 0.08, side * spacing, y, z, headMat));
        box(g, 0.26, 0.22, 0.07, side * spacing, y, -l / 2 - 0.02, tailMat);
      });
    }
    function fourWheels(r, front, rear) {
      [-1, 1].forEach(function (s) { wheel(g, s * w * 0.48, front, r, 0.26, wheels, true); wheel(g, s * w * 0.48, rear, r, 0.26, wheels, false); });
    }
    function lightbar(y) {
      box(g, 1.45, 0.13, 0.32, 0, y, 0.28, dark);
      [0x247bff, 0xff283e].forEach(function (color, i) {
        var lm = new T.MeshStandardMaterial({ color: MG.srgb(color), emissive: MG.srgb(color), emissiveIntensity: 0.2 });
        sirenMeshes.push(box(g, 0.56, 0.19, 0.31, i ? 0.39 : -0.39, y + 0.15, 0.28, lm));
      });
    }
    if (type === 'tricycle' || type === 'pedicab') {
      var pedal = type === 'pedicab', bx = -0.48, wr = pedal ? 0.39 : 0.32;
      wheel(g, bx, 0.83, wr, pedal ? 0.09 : 0.16, wheels, true, pedal);
      wheel(g, bx, -0.81, wr, pedal ? 0.09 : 0.2, wheels, false, pedal);
      wheel(g, 0.83, -0.43, wr, 0.16, wheels, false, pedal);
      bar(g, new T.Vector3(bx, 0.43, -0.8), new T.Vector3(bx, 0.93, 0.45), 0.065, paint);
      bar(g, new T.Vector3(bx, 0.43, 0.8), new T.Vector3(bx, 1.18, 0.48), 0.055, chrome);
      bar(g, new T.Vector3(bx, 0.43, -0.8), new T.Vector3(bx, 0.98, -0.3), 0.06, paint);
      bar(g, new T.Vector3(bx, 0.98, -0.3), new T.Vector3(bx, 1.05, 0.4), 0.06, paint);
      box(g, 0.45, 0.13, 0.55, bx, 1.05, -0.3, seat);
      box(g, 0.8, 0.065, 0.09, bx, 1.22, 0.5, chrome);
      if (!pedal) { box(g, 0.32, 0.35, 0.5, bx, 0.66, -0.05, dark); box(g, 0.33, 0.23, 0.4, bx, 0.95, 0.25, paint); }
      box(g, 0.98, 0.17, 1.72, 0.37, 0.42, -0.07, chrome);
      box(g, 0.92, 0.52, 1.47, 0.4, 0.75, -0.15, paint);
      box(g, 0.77, 0.13, 0.74, 0.4, 0.99, -0.39, seat);
      box(g, 0.77, 0.54, 0.12, 0.4, 1.24, -0.79, seat);
      box(g, 1.13, 0.12, 1.85, 0.33, 1.88, -0.1, pedal ? paint : chrome);
      [[-0.18, -0.85], [0.87, -0.85], [0.87, 0.7], [-0.18, 0.7]].forEach(function (p) { box(g, 0.055, 0.94, 0.055, p[0], 1.38, p[1], chrome); });
      box(g, 0.99, 0.54, 0.025, 0.35, 1.52, 0.7, glass);
      label(g, pedal ? 'PADYAK' : 'MARIKINA', 0.91, 0.23, 0.36, 1.83, 0.85, 0, '#10212c', '#f7c544');
      lightMeshes.push(box(g, 0.23, 0.22, 0.09, bx, 1.13, 0.9, headMat));
      box(g, 0.19, 0.17, 0.05, bx, 0.8, -0.94, tailMat);
      label(g, 'MK ' + (100 + Math.floor(Math.random() * 899)), 0.44, 0.15, 0.4, 0.7, -0.91, Math.PI);
      g.userData.driverSeat = new T.Vector3(bx, 0.45, -0.24);
    } else if (type === 'jeepney') {
      box(g, w, 0.27, l, 0, 0.56, 0, chrome);
      box(g, w, 0.78, 4.15, 0, 1.03, -0.68, paint);
      box(g, 1.52, 0.61, 1.72, 0, 0.97, 2.04, paint);
      box(g, 1.58, 0.1, 1.7, 0, 1.31, 2.04, chrome);
      box(g, w + 0.13, 0.17, 4.63, 0, 2.41, -0.41, chrome);
      box(g, w + 0.02, 0.13, 4.43, 0, 2.28, -0.44, paint);
      box(g, 1.9, 0.73, 0.04, 0, 1.88, 1.48, glass);
      for (var k = 0; k < 5; k++) {
        [-1, 1].forEach(function (s) {
          box(g, 0.065, 0.91, 0.08, s * 0.99, 1.88, -2.57 + k * 0.95, chrome);
          if (k < 4) box(g, 0.025, 0.54, 0.77, s * 1.0, 1.98, -2.08 + k * 0.95, glass);
        });
      }
      [-1, 1].forEach(function (s) {
        box(g, 0.45, 0.16, 3.35, s * 0.64, 1.03, -0.8, seat);
        box(g, 0.13, 0.35, 3.35, s * 0.87, 1.23, -0.8, seat);
        box(g, 0.045, 0.12, 4.1, s * 1.036, 1.24, -0.7, amber);
        box(g, 0.07, 0.08, 4.43, s * 1.055, 0.68, -0.45, chrome);
        label(g, 'MARIKINA • CUBAO', 3.1, 0.28, s * 1.033, 0.98, -0.68, s * Math.PI / 2, '#fff6db', '#a42b32');
        box(g, 0.44, 0.15, 1.25, s * 0.95, 1.02, 2.05, chrome);
      });
      box(g, 1.38, 0.54, 0.08, 0, 0.96, 2.925, chrome);
      for (var gr = 0; gr < 8; gr++) box(g, 0.085, 0.39, 0.03, -0.49 + gr * 0.14, 0.97, 2.974, dark);
      box(g, 2.25, 0.17, 0.26, 0, 0.57, 3.03, chrome);
      box(g, 1.45, 0.14, 0.36, 0, 0.45, -3.0, chrome);
      label(g, 'MARIKINA', 1.79, 0.29, 0, 2.31, 1.925, 0, '#fddd54', '#123335');
      label(g, 'GOD BLESS OUR TRIP', 1.62, 0.21, 0, 1.48, 1.516, 0, '#ffffff', '#264a69');
      // Roof rack, horns and a rear spare are part of the iconic silhouette.
      [-0.73, 0.73].forEach(function (x) { box(g, 0.065, 0.17, 3.55, x, 2.58, -0.5, chrome); });
      for (var rr = 0; rr < 5; rr++) box(g, 1.56, 0.065, 0.065, 0, 2.53, -2.05 + rr * 0.77, chrome);
      var spare = cylinder(g, 0.36, 0.19, 0.7, 1.36, -2.86, rubber, 14); spare.rotation.x = Math.PI / 2;
      var spareHub = cylinder(g, 0.15, 0.21, 0.7, 1.36, -2.86, chrome, 10); spareHub.rotation.x = Math.PI / 2;
      fourWheels(0.42, 1.97, -1.94); lamps(1.09, 2.975, 0.75);
      g.userData.driverSeat = new T.Vector3(-0.49, 0.65, 0.99);
    } else {
      var isCar = type === 'car', isSwat = type === 'swat', isPolice = type === 'police';
      if (isPolice) paint = white;
      if (isSwat) paint = mat(0x263742, 0.3, 0.8);
      if (type === 'uv') paint = mat(0xece9df, 0.15, 0.48);
      var bodyY = isCar ? 0.78 : 0.92, roofY = isCar ? 1.79 : isSwat ? 2.68 : 2.24;
      box(g, w, 0.66, l, 0, bodyY, 0, paint);
      box(g, w * 0.95, 0.17, l * 0.94, 0, 0.44, 0, dark);
      var cabinLength = isCar ? 2.38 : isSwat ? 4.06 : 3.29;
      box(g, w * 0.89, 0.12, cabinLength, 0, roofY, -0.32, isPolice ? dark : paint);
      var winHeight = roofY - bodyY - 0.47;
      box(g, w * 0.84, winHeight, 0.04, 0, roofY - winHeight * 0.5 - 0.06, -0.32 + cabinLength / 2, glass);
      box(g, w * 0.84, winHeight * 0.83, 0.04, 0, roofY - winHeight * 0.5 - 0.06, -0.33 - cabinLength / 2, glass);
      [-1, 1].forEach(function (s) {
        box(g, 0.045, winHeight, cabinLength * 0.91, s * w * 0.43, roofY - winHeight * 0.5 - 0.06, -0.32, glass);
        for (var pillar = 0; pillar < 3; pillar++) box(g, 0.1, winHeight + 0.13, 0.12, s * w * 0.445, roofY - winHeight * 0.5 - 0.05, -0.32 + (pillar - 1) * cabinLength * 0.49, paint);
        box(g, 0.12, 0.18, 0.31, s * (w * 0.5 + 0.08), roofY - 0.48, cabinLength * 0.4, paint);
        box(g, 0.035, 0.06, 0.25, s * (w / 2 + 0.01), bodyY + 0.18, 0.06, chrome);
        box(g, 0.025, 0.025, 1.54, s * (w / 2 + 0.012), bodyY + 0.32, -0.08, dark);
        box(g, 0.08, 0.08, l * 0.83, s * w * 0.503, bodyY - 0.12, -0.01, isPolice ? dark : chrome);
        box(g, 0.52, 0.48, 0.53, s * 0.47, 1.16, 0.23, seat);
      });
      box(g, w * 0.83, 0.13, l * 0.22, 0, bodyY + 0.39, l * 0.37, paint);
      box(g, w * 0.58, 0.26, 0.04, 0, bodyY + 0.03, l / 2 + 0.025, dark);
      for (var grille = 0; grille < 3; grille++) box(g, w * 0.54, 0.025, 0.02, 0, bodyY - 0.06 + grille * 0.09, l / 2 + 0.051, chrome);
      box(g, w * 1.025, 0.14, 0.17, 0, 0.52, l / 2 + 0.03, isSwat ? dark : chrome);
      box(g, w * 1.025, 0.14, 0.17, 0, 0.52, -l / 2 - 0.02, dark);
      fourWheels(isSwat ? 0.47 : isCar ? 0.34 : 0.39, l * 0.32, -l * 0.32);
      lamps(bodyY + 0.17, l / 2 + 0.05, w * 0.365);
      if (type === 'uv') {
        label(g, 'UV EXPRESS', 1.42, 0.26, 0, roofY - 0.19, 1.349, 0, '#152f53', '#fffdf3');
        [-1, 1].forEach(function (s) { label(g, 'MARIKINA • AYALA', 2.38, 0.29, s * (w / 2 + 0.016), bodyY + 0.08, -0.25, s * Math.PI / 2, '#173e6a', '#faf7e9'); });
      }
      if (isPolice || isSwat) {
        lightbar(roofY + 0.12);
        [-1, 1].forEach(function (s) {
          label(g, isSwat ? 'PNP  •  SWAT' : 'MARIKINA POLICE', isSwat ? 2.72 : 2.75, 0.39, s * (w / 2 + 0.018), bodyY + 0.08, -0.1, s * Math.PI / 2, isSwat ? '#d1e2de' : '#fff', isSwat ? '#263742' : '#193f66');
          if (isSwat) for (var armor = 0; armor < 3; armor++) box(g, 0.06, 0.57, 0.76, s * w * 0.46, 2.18, -1.63 + armor * 1.03, paint);
        });
        box(g, w * 0.85, 0.12, 0.13, 0, 1.09, l / 2 + 0.17, dark);
        [-0.57, 0.57].forEach(function (x) { box(g, 0.1, 0.64, 0.15, x, 0.85, l / 2 + 0.17, dark); });
        cylinder(g, 0.022, 0.92, -0.76, roofY + 0.48, -0.9, dark, 5);
      }
      g.userData.driverSeat = new T.Vector3(-0.45, isCar ? 0.43 : 0.64, 0.48);
    }
    if (type !== 'tricycle' && type !== 'pedicab') {
      label(g, 'MK ' + (1000 + Math.floor(Math.random() * 8999)), 0.59, 0.18, 0, 0.56, spec.length / 2 + (type === 'jeepney' ? 0.18 : 0.13), 0, '#122f32', '#e9eee7');
    }
    g.userData.headMaterial = headMat; g.userData.tailMaterial = tailMat;
    g.userData.sirenMeshes = sirenMeshes;
    if (MG.batchStatic) MG.batchStatic(g, false, true);
    return { mesh: g, wheels: wheels, lights: lightMeshes };
  }
  function point(p) {
    if (!p) return new T.Vector3();
    if (Array.isArray(p)) return new T.Vector3(p[0] || 0, p.length > 2 ? p[1] || 0 : 0, p.length > 2 ? p[2] || 0 : p[1] || 0);
    p = p.position || p; return new T.Vector3(p.x || 0, p.y || 0, p.z || 0);
  }
  function Vehicles(game) {
    this.game = game; this.items = []; this.lights = []; this.clock = 0; this._lightClock = 0; this._hornTime = 0;
    this._delta = new T.Vector3(); this._before = new T.Vector3();
  }
  Vehicles.prototype.init = function () {
    var world = this.game.world, home = point(world.spawn), self = this;
    var starts = [[-6, 5, 'jeepney'], [6, 5, 'tricycle'], [-6, -6, 'car'], [7, -5, 'pedicab'], [12, 9, 'uv']];
    starts.forEach(function (s, i) {
      var p = self.findClear(home.clone().add(new T.Vector3(s[0], 0, s[1])), SPECS[s[2]].radius, 18);
      if (p) self.spawn(s[2], p, i % 2 ? Math.PI : 0, { parked: true });
    });
    var spawns = world.roadSpawns || [];
    for (var i = 0; i < Math.min(10, spawns.length); i++) {
      var seed = spawns[Math.floor(i * spawns.length / Math.min(10, spawns.length))];
      var p = point(seed), heading = seed.heading || 0;
      if (p.distanceTo(home) < 24) continue;
      p.x += Math.cos(heading) * 3.4; p.z -= Math.sin(heading) * 3.4;
      var type = ['car', 'uv', 'tricycle', 'jeepney', 'pedicab'][i % 5];
      p = this.findClear(p, SPECS[type].radius, 8);
      if (p) this.spawn(type, p, heading, { parked: true });
    }
    for (var j = 0; j < 4; j++) { var light = new T.PointLight(0xffe9bd, 0, 15, 2); light.castShadow = false; this.game.scene.add(light); this.lights.push(light); }
    return this;
  };
  Vehicles.prototype.findClear = function (origin, radius, range) {
    var world = this.game.world;
    for (var i = 0; i < 65; i++) {
      var a = i * 2.39996, d = i ? Math.sqrt(i / 64) * range : 0;
      var p = point(origin); p.x += Math.sin(a) * d; p.z += Math.cos(a) * d;
      if (world.isBlocked(p.x, p.z, radius)) continue;
      var occupied = this.items.some(function (v) { return v.active && Math.hypot(v.position.x - p.x, v.position.z - p.z) < v.radius + radius + 0.7; });
      if (!occupied) { p.y = world.groundHeight(p.x, p.z); return p; }
    }
    return null;
  };
  Vehicles.prototype.spawn = function (type, pos, heading, options) {
    type = SPECS[type] ? type : 'car'; options = options || {}; heading = heading || 0;
    var spec = SPECS[type], model = makeModel(type, options), mesh = model.mesh;
    mesh.position.copy(point(pos)); mesh.position.y = this.game.world.groundHeight(mesh.position.x, mesh.position.z); mesh.rotation.y = heading;
    var v = { type: type, name: spec.name, mesh: mesh, position: mesh.position, heading: heading, speed: 0, maxSpeed: spec.max,
      radius: spec.radius, driver: options.driver || null, police: type === 'police' || type === 'swat' || !!options.police,
      active: true, velocity: new T.Vector3(), wheels: model.wheels, hp: spec.hp, maxHp: spec.hp,
      acceleration: spec.accel, turnRate: spec.turn, mass: spec.mass, steer: 0, siren: false, parked: !!options.parked, spawnPosition: mesh.position.clone(), previousPosition: mesh.position.clone(),
      spawnHeading: heading, lights: model.lights, collisionCooldown: 0, destroyed: false, options: options };
    mesh.userData.vehicle = v;
    if (MG.makePerson) {
      var avatar = MG.makePerson(v.police ? 0x172e4f : 0xcbb899, 0xb78258);
      avatar.scale.setScalar(0.7); avatar.position.copy(mesh.userData.driverSeat);
      if (avatar.userData.legs) avatar.userData.legs.forEach(function (leg) { leg.rotation.x = -1.25; });
      avatar.visible = false; mesh.add(avatar); v.driverMesh = avatar;
    }
    this.game.scene.add(mesh); this.items.push(v); return v;
  };
  Vehicles.prototype.nearest = function (position, maxDist) {
    var best = null, dist = maxDist === undefined ? 3 : maxDist;
    this.items.forEach(function (v) {
      if (!v.active || v.destroyed || v.driver === 'player') return;
      var d = Math.hypot(v.position.x - position.x, v.position.z - position.z);
      if (d < dist) { best = v; dist = d; }
    }); return best;
  };
  Vehicles.prototype.enter = function (v) {
    var game = this.game;
    if (!v || !v.active || v.destroyed || v.hp <= 0 || game.player.vehicle || game.player.hp <= 0) return false;
    if (Math.hypot(v.position.x - game.player.position.x, v.position.z - game.player.position.z) > 4.6) return false;
    if (v.police && game.police) game.police.crime('assaultPolice');
    if (v.driver === 'traffic' && game.npcs && game.npcs.ejectDriver) game.npcs.ejectDriver(v);
    v.driver = 'player'; v.parked = false; v.siren = false; game.player.vehicle = v;
    game.player.mesh.visible = false; game.player.position.copy(v.position);
    if (game.hud) game.hud.notify(v.name + '  •  W/S drive · A/D steer · E exit', 'info');
    return true;
  };
  Vehicles.prototype.exit = function () {
    var game = this.game, player = game.player, v = player.vehicle;
    if (!v) return false;
    var chosen = null, world = game.world, right = new T.Vector3(Math.cos(v.heading), 0, -Math.sin(v.heading));
    var forward = new T.Vector3(Math.sin(v.heading), 0, Math.cos(v.heading));
    var offsets = [right.clone().multiplyScalar(v.radius + 1.1), right.clone().multiplyScalar(-v.radius - 1.1), forward.clone().multiplyScalar(-SPECS[v.type].length / 2 - 1), forward.clone().multiplyScalar(SPECS[v.type].length / 2 + 1)];
    for (var i = 0; i < offsets.length; i++) {
      var candidate = v.position.clone().add(offsets[i]);
      if (world.isBlocked(candidate.x, candidate.z, 0.5)) continue;
      if (this.items.some(function (other) { return other !== v && other.active && candidate.distanceTo(other.position) < other.radius + 0.65; })) continue;
      chosen = candidate; break;
    }
    if (!chosen) chosen = this.findClear(v.position, 0.6, 8);
    if (!chosen) { if (game.hud) game.hud.notify('The doors are blocked. Move to an open spot.', 'warning'); return false; }
    chosen.y = world.groundHeight(chosen.x, chosen.z); player.vehicle = null; v.driver = null; v.speed *= 0.35;
    player.position.copy(chosen); player.mesh.position.copy(chosen); player.mesh.visible = true;
    return true;
  };
  Vehicles.prototype.damage = function (v, amount) {
    if (!v || v.destroyed || !v.active) return;
    v.hp = Math.max(0, v.hp - Math.max(0, amount));
    if (v.hp === 0) {
      v.destroyed = true; v.speed = 0; v.velocity.set(0, 0, 0); v.siren = false;
      if (v.driver === 'player') {
        var player = this.game.player;
        this.exit();
        player.damage(25);
        if (this.game.hud) this.game.hud.notify('Vehicle disabled. Find another ride.', 'warning');
      }
      v.driver = null;
    }
  };
  Vehicles.prototype.drive = function (v, throttle, steer, dt) {
    if (!v || !v.active || v.destroyed || dt <= 0) return;
    dt = Math.min(dt, 0.1); throttle = clamp(throttle, -1, 1); steer = clamp(steer, -1, 1);
    v.previousPosition.copy(v.position);
    var game = this.game, beforeSpeed = v.speed;
    var handbrake = v.driver === 'player' && game.keys && game.keys.has('Space');
    var acc = v.acceleration * (v.hp < v.maxHp * 0.22 ? 0.6 : 1);
    if (throttle) {
      var braking = throttle * v.speed < -0.8;
      v.speed += throttle * (braking ? acc * 2.5 : acc) * dt;
      v.speed *= Math.pow(0.998, dt * 60);
    } else v.speed *= Math.pow(0.92, dt * 60);
    if (handbrake) v.speed *= Math.pow(0.84, dt * 60);
    v.speed = clamp(v.speed, -v.maxSpeed * 0.35, v.maxSpeed);
    if (Math.abs(v.speed) < 0.04) v.speed = 0;
    v.steer += (steer - v.steer) * (1 - Math.exp(-8 * dt));
    var turnFactor = clamp(Math.abs(v.speed) / 3, 0, 1) / (1 + Math.abs(v.speed) * 0.034);
    v.heading += v.steer * v.turnRate * turnFactor * Math.sign(v.speed) * dt * (handbrake ? 1.55 : 1);
    v.heading = Math.atan2(Math.sin(v.heading), Math.cos(v.heading));
    var start = this._before.copy(v.position), dx = Math.sin(v.heading) * v.speed * dt, dz = Math.cos(v.heading) * v.speed * dt;
    var steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.55));
    for (var i = 0; i < steps; i++) {
      this._delta.set(dx / steps, 0, dz / steps);
      var moved = game.world.moveCircle(v.position, this._delta, v.radius);
      if (moved && moved.isVector3 && moved !== v.position) v.position.copy(moved);
    }
    var actualDistance = Math.hypot(v.position.x - start.x, v.position.z - start.z);
    if (Math.abs(v.speed) > 3 && actualDistance < Math.hypot(dx, dz) * 0.45) {
      v.speed *= -0.12;
      if (v.collisionCooldown <= 0) {
        v.collisionCooldown = 0.65; this.damage(v, Math.max(0, Math.abs(beforeSpeed) - 5) * 1.45);
        if (v.driver === 'player' && Math.abs(beforeSpeed) > 16) game.player.damage(3);
      }
    }
    for (var j = 0; j < this.items.length; j++) {
      var other = this.items[j];
      if (other === v || !other.active) continue;
      var ox = v.position.x - other.position.x, oz = v.position.z - other.position.z, distance = Math.hypot(ox, oz), gap = (v.radius + other.radius) * 0.88;
      if (distance >= gap || distance < 0.001) continue;
      var push = gap - distance;
      var correction = new T.Vector3(ox / distance * push, 0, oz / distance * push);
      var correctionResult = game.world.moveCircle(v.position, correction, v.radius);
      if (correctionResult && correctionResult.isVector3 && correctionResult !== v.position) v.position.copy(correctionResult);
      if (Math.abs(v.speed) > 5 && v.collisionCooldown <= 0) {
        var impact = Math.abs(v.speed - other.speed);
        v.collisionCooldown = 0.75; other.collisionCooldown = 0.75;
        this.damage(v, impact * 0.7 * clamp(other.mass / v.mass, 0.4, 2));
        this.damage(other, impact * 1.1 * clamp(v.mass / other.mass, 0.4, 2));
        if (v.driver === 'player' && other.police && game.police) game.police.crime('assaultPolice');
      }
      v.speed *= 0.35;
    }
    v.position.y = game.world.groundHeight(v.position.x, v.position.z);
    v.velocity.copy(v.position).sub(start).multiplyScalar(1 / dt); v.velocity.y = 0;
    v.mesh.rotation.y = v.heading;
  };
  Vehicles.prototype.setLights = function () {
    var game = this.game, focus = game.focusPosition(), night = !!game.night;
    var near = this.items.filter(function (v) { return v.active && !v.destroyed && (night || v.siren) && v.position.distanceToSquared(focus) < 3600; });
    near.sort(function (a, b) { return a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus); });
    for (var i = 0; i < this.lights.length; i++) {
      var light = this.lights[i], v = near[i];
      if (!v) { light.intensity = 0; continue; }
      light.position.copy(v.position); light.position.y += v.siren ? 2.5 : 1.1;
      light.position.x += Math.sin(v.heading) * 2; light.position.z += Math.cos(v.heading) * 2;
      light.color.setHex(v.siren ? (Math.sin(this.clock * 17) > 0 ? 0xff2447 : 0x287bff) : 0xffe5b2);
      light.intensity = v.siren ? 1.45 : 0.9;
    }
  };
  Vehicles.prototype.update = function (dt) {
    dt = Math.min(dt, 0.1); this.clock += dt; this._hornTime = Math.max(0, this._hornTime - dt);
    var game = this.game, player = game.player, v = player.vehicle;
    if (v && v.active && player.hp > 0) {
      var forward = game.keys.has('KeyW') || game.keys.has('ArrowUp'), backward = game.keys.has('KeyS') || game.keys.has('ArrowDown');
      var left = game.keys.has('KeyA') || game.keys.has('ArrowLeft'), right = game.keys.has('KeyD') || game.keys.has('ArrowRight');
      // With forward +Z, positive yaw turns toward screen-left in the chase camera.
      this.drive(v, (forward ? 1 : 0) - (backward ? 1 : 0), (left ? 1 : 0) - (right ? 1 : 0), dt);
      player.position.copy(v.position); player.mesh.visible = false;
      if (game.inputPressed('KeyH') && this._hornTime <= 0) { if (game.audio) game.audio.horn(); this._hornTime = 0.7; }
    } else if (v && player.hp <= 0) { v.speed = 0; v.velocity.set(0, 0, 0); }
    var focus = game.focusPosition(), drawDistance = Math.min(180, game.settings.drawDistance || 180);
    for (var i = 0; i < this.items.length; i++) {
      var car = this.items[i];
      car.mesh.visible = car.active && (car === v || car.position.distanceToSquared(focus) < drawDistance * drawDistance);
      car.collisionCooldown = Math.max(0, car.collisionCooldown - dt);
      if (!car.driver && Math.abs(car.speed) > 0.05) this.drive(car, 0, 0, dt);
      if (car.driverMesh) car.driverMesh.visible = !!car.driver && !car.destroyed;
      var lean = -car.steer * Math.min(Math.abs(car.speed), 22) * (car.type === 'tricycle' || car.type === 'pedicab' ? 0.0035 : 0.0013);
      car.mesh.rotation.z += (lean - car.mesh.rotation.z) * (1 - Math.exp(-6 * dt));
      car.mesh.rotation.x = Math.sin(this.clock * 11 + i) * Math.min(Math.abs(car.speed), 15) * 0.0005;
      car.wheels.forEach(function (w) { w.userData.roll.rotation.x += car.speed * dt / w.userData.radius; if (w.userData.front) w.rotation.y = car.steer * 0.39; });
      car.mesh.userData.headMaterial.emissiveIntensity = car.destroyed ? 0 : game.night ? 1.8 : 0.22;
      car.mesh.userData.tailMaterial.emissiveIntensity = car.destroyed ? 0 : (car.driver === 'player' && game.keys.has('KeyS') ? 2.5 : game.night ? 0.85 : 0.25);
      var flash = Math.floor(this.clock * 9) % 2;
      car.mesh.userData.sirenMeshes.forEach(function (m, n) { m.material.emissiveIntensity = car.siren && !car.destroyed ? (n === flash ? 3.5 : 0.12) : 0.06; });
    }
    this._lightClock -= dt;
    if (this._lightClock <= 0) { this.setLights(); this._lightClock = 0.09; }
  };
  MG.Vehicles = Vehicles;
}());