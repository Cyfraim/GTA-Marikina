/* Marikina, a city with sole. Real OpenStreetMap scenery for Three.js r128.
 *
 * Geography comes from js/maploader.js, which downloads OSM ways for Marikina
 * City over the Overpass API. This module owns everything that is still
 * generated at runtime: collision hashing, spawn points, traffic and
 * pedestrian routes, street lamps, trees and distance culling.
 *
 * Coordinates: metres, Y up, north = -Z.
 * Data (c) OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright
 */
(function () {
  'use strict';
  var MG = window.MG = window.MG || {};
  var T = window.THREE;
  var PI = Math.PI;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* Landmarks double as lamp/tree anchors and as navigation targets. */
  var SPOTS = [
    { key: 'sports', lat: 14.6503, lon: 121.0934, label: 'Marikina Sports Center' },
    { key: 'riverbanks', lat: 14.6333, lon: 121.0981, label: 'Riverbanks Mall' },
    { key: 'cityhall', lat: 14.6424, lon: 121.0983, label: 'Marikina City Hall' },
    { key: 'museum', lat: 14.6390, lon: 121.0966, label: 'Shoe Museum' },
    { key: 'market', lat: 14.6369, lon: 121.1006, label: 'Marikina Public Market' },
    { key: 'rizal', lat: 14.6400, lon: 121.0950, label: 'J. P. Rizal Avenue' },
    { key: 'sumulong', lat: 14.6550, lon: 121.1050, label: 'Sumulong Highway' }
  ];

  class World {
    constructor(game) {
      this.game = game;
      this.scene = game.scene;
      /* Real Marikina is ~4.3 km x 5.5 km, so bounds are far larger than the
       * old 390 m procedural square. Filled in from the downloaded extent. */
      this.bounds = 2000;
      this.river = { width: 34, slope: 0, offset: 0, lines: [] };
      this.bridges = [];
      this.buildings = [];
      this.roads = [];
      this.colliders = [];
      this.raycastObjects = [];
      this.landmarks = [];
      this.roadSpawns = [];
      this.trafficRoutes = [];
      this.pedestrianRoutes = [];
      this.spawn = new T.Vector3(0, 0, 0);
      this.root = new T.Group();
      this.root.name = 'Marikina OpenStreetMap world';
      this._seed = 20260927;
      this._hash = new Map();
      this._batch = new Map();
      this._instanceChunks = [];
      this._chunks = [];
      this._lamps = [];
      this._lights = [];
      this._animated = [];
      this._signCache = new Map();
      this._clock = 0;
      this._lodClock = 1;
      this._initialized = false;
      this._dummy = new T.Object3D();
      this._focus = new T.Vector3();
      this._roadLines = [];
      this._waterLines = [];
      this.latlonToXZ = null;
    }

    /* Async because the map is downloaded at runtime. main.js awaits this. */
    init(onProgress) {
      var self = this;
      if (this._initialized) return Promise.resolve(this);
      if (!MG.MapLoader) {
        return Promise.reject(new Error('maploader.js is missing, so Marikina cannot be built.'));
      }
      this.latlonToXZ = MG.MapLoader.latlonToXZ;
      return MG.MapLoader.loadMarikinaMap(this.scene, onProgress).then(function (map) {
        self._adopt(map);
        return self;
      });
    }
    /* Takes the loader's result and wires it into everything else that reads
     * world state: colliders, road centerlines, landmarks and spawns. */
    _adopt(map) {
      var self = this;
      this._initialized = true;
      this.map = map;
      this._roadLines = map.roadLines;
      this._waterLines = map.waterLines;
      this.river.lines = map.waterLines;
      this.bounds = Math.max(map.extent.halfWidth, map.extent.halfDepth) + 40;
      this._materials();
      /* Building colliders, hashed so movement and bullets stay O(1). */
      map.colliders.forEach(function (box) { self._insert(box); });
      /* Water is a low blocker, not a wall: cars stop, bullets pass over. */
      (map.waterColliders || []).forEach(function (w) {
        self._insert(new T.Box3(new T.Vector3(w.x - w.w / 2, 0, w.z - w.d / 2),
          new T.Vector3(w.x + w.w / 2, w.h, w.z + w.d / 2)));
      });
      this.colliders = map.colliders;
      this.raycastObjects = map.chunkMeshes;
      this._chunks = map.chunkMeshes;
      this.buildings = map.buildings;
      this.roads = map.roadSegments;
      this._indexBuildings();
      this._landmarksFromSpots();
      this._spawnAt('museum');
      this._routes();
      this._streetFurniture();
      this._finishInstances();
      this._makeLights();
      if (!this.scene.fog) this.scene.fog = new T.Fog(0xc8c9b8, 155, 450);
      this.root.updateMatrixWorld(true);
      this.update(0);
      return this;
    }

    /* Uniform grid over XZ. With ~61k buildings a linear scan is far too slow,
     * so collision lookups only visit the handful of cells they overlap. */
    _insert(box) {
      var size = 60;
      for (var ix = Math.floor(box.min.x / size); ix <= Math.floor(box.max.x / size); ix++) {
        for (var iz = Math.floor(box.min.z / size); iz <= Math.floor(box.max.z / size); iz++) {
          var key = ix + ',' + iz;
          var bucket = this._hash.get(key);
          if (!bucket) { bucket = []; this._hash.set(key, bucket); }
          bucket.push(box);
        }
      }
    }

    /* Coarse index of building footprints, keyed by cell. The minimap redraws
     * every frame, so it must not walk all 61k buildings to find the ~40 that
     * are actually on screen. */
    _indexBuildings() {
      var cell = 220;
      var grid = new Map();
      for (var i = 0; i < this.buildings.length; i++) {
        var b = this.buildings[i];
        var key = Math.floor(b.x / cell) + ',' + Math.floor(b.z / cell);
        var bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        bucket.push(b);
      }
      this._buildingGrid = grid;
      this._buildingCell = cell;
    }

    buildingsNear(x, z, radius) {
      if (!this._buildingGrid) return [];
      var cell = this._buildingCell;
      var out = [];
      for (var ix = Math.floor((x - radius) / cell); ix <= Math.floor((x + radius) / cell); ix++) {
        for (var iz = Math.floor((z - radius) / cell); iz <= Math.floor((z + radius) / cell); iz++) {
          var bucket = this._buildingGrid.get(ix + ',' + iz);
          if (!bucket) continue;
          for (var i = 0; i < bucket.length; i++) out.push(bucket[i]);
        }
      }
      return out;
    }

    /* Polylines that come within `radius` of a point, for the minimap. */
    linesNear(list, x, z, radius) {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var points = list[i].points;
        for (var k = 0; k < points.length; k++) {
          var dx = points[k].x - x, dz = points[k].z - z;
          if (dx * dx + dz * dz <= radius * radius) { out.push(list[i]); break; }
        }
      }
      return out;
    }

    _rand(a, b) {
      this._seed = (Math.imul(1664525, this._seed) + 1013904223) >>> 0;
      var n = this._seed / 4294967296;
      return a === undefined ? n : a + n * (b - a);
    }
    _mesh(geometry, material, parent) {
      var mesh = new T.Mesh(geometry, material);
      mesh.receiveShadow = true;
      (parent || this.root).add(mesh);
      return mesh;
    }

    _box(parent, x, y, z, w, h, d, material, shadow) {
      var mesh = this._mesh(this.geo.box, material || this.mat.white, parent);
      mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
      mesh.castShadow = shadow !== false;
      return mesh;
    }

    _cylinder(parent, x, y, z, radius, height, material) {
      var mesh = this._mesh(this.geo.cylinder, material, parent);
      mesh.position.set(x, y, z); mesh.scale.set(radius, height, radius); mesh.castShadow = true;
      return mesh;
    }

    _canvas(w, h, draw) {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      var texture = new T.CanvasTexture(c);
      texture.encoding = T.sRGBEncoding;
      texture.anisotropy = 4;
      return texture;
    }

    /* Only the materials still needed at runtime: the road, building and water
     * surfaces come from maploader.js. */
    _materials() {
      this.geo = {
        box: new T.BoxGeometry(1, 1, 1),
        cylinder: new T.CylinderGeometry(1, 1, 1, 8),
        cone: new T.ConeGeometry(1, 1, 6),
        leaf: new T.IcosahedronGeometry(1, 1)
      };
      this.mat = {};
      var colors = {
        white: 0xf1e7cf, cream: 0xe6cf9e, ochre: 0xdba65e, teal: 0x296963,
        navy: 0x314d58, roof: 0x9e5946, timber: 0x6e5040, trunk: 0x715844,
        leaf: 0x648650, leafLight: 0x8caa62, leafDark: 0x446d52,
        metal: 0x43595a, chrome: 0xa6b7b3, terracotta: 0xaf6950
      };
      var self = this;
      Object.keys(colors).forEach(function (k) {
        self.mat[k] = new T.MeshLambertMaterial({ color: MG.srgb(colors[k]) });
      });
      this.mat.lamp = new T.MeshStandardMaterial({
        color: MG.srgb(0xffe4a0), emissive: MG.srgb(0xffbf61), emissiveIntensity: 0.12
      });
    }

    _collider(x, z, w, d, height, base) {
      var box = new T.Box3(new T.Vector3(x - w / 2, base || 0, z - d / 2),
        new T.Vector3(x + w / 2, (base || 0) + (height || 3), z + d / 2));
      this._insert(box);
      return box;
    }

    _instance(geometry, material, x, y, z, sx, sy, sz, ry, rz) {
      var cx = Math.floor(x / 220), cz = Math.floor(z / 220);
      var key = geometry.uuid + ':' + material.uuid + ':' + cx + ':' + cz;
      if (!this._batch.has(key)) {
        this._batch.set(key, {
          geometry: geometry, material: material,
          cx: cx * 220 + 110, cz: cz * 220 + 110, transforms: []
        });
      }
      this._batch.get(key).transforms.push([x, y, z, sx, sy, sz, ry || 0, rz || 0]);
    }

    _finishInstances() {
      this._batch.forEach((batch) => {
        var mesh = new T.InstancedMesh(batch.geometry, batch.material, batch.transforms.length);
        batch.transforms.forEach((p, i) => {
          this._dummy.position.set(p[0], p[1], p[2]);
          this._dummy.scale.set(p[3], p[4], p[5]); this._dummy.rotation.set(0, p[6], p[7]);
          this._dummy.updateMatrix(); mesh.setMatrixAt(i, this._dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.root.add(mesh);
        this._instanceChunks.push({ mesh: mesh, x: batch.cx, z: batch.cz });
      });
      this._batch.clear();
    }
    _landmark(name, x, z, subtitle) {
      var item = { name: name, position: new T.Vector3(x, 0, z), subtitle: subtitle || null };
      this.landmarks.push(item);
      return item;
    }

    /* Projects the real Marikina landmarks into world space. Each one snaps to
     * the nearest clear spot, since an OSM coordinate can land inside a house. */
    _landmarksFromSpots() {
      var self = this;
      this.spots = {};
      SPOTS.forEach(function (spot) {
        var p = self.latlonToXZ(spot.lat, spot.lon);
        var clear = self._nearestClear(p.x, p.z, 90, 4);
        self.spots[spot.key] = clear;
        self._landmark(spot.label, clear.x, clear.z, self.districtAt(clear));
      });
      if (this._waterLines.length) {
        var river = this._waterLines[0];
        var mid = river.points[Math.floor(river.points.length / 2)];
        self._landmark(river.name || 'Marikina River', mid.x, mid.z, 'Riverbanks');
      }
    }

    /* Juan starts by the Shoe Museum, nudged onto open ground. */
    _spawnAt(key) {
      var spot = this.spots && this.spots[key];
      this.spawn.set(spot ? spot.x : 0, 0, spot ? spot.z : 0);
    }

    /* Spiral outward for a spot that is not inside a building or the river. */
    _nearestClear(x, z, maxRadius, radius) {
      if (!this.isBlocked(x, z, radius)) return new T.Vector3(x, 0, z);
      for (var step = 6; step <= maxRadius; step += 6) {
        for (var a = 0; a < 12; a++) {
          var angle = a / 12 * PI * 2;
          var tx = x + Math.cos(angle) * step;
          var tz = z + Math.sin(angle) * step;
          if (!this.isBlocked(tx, tz, radius)) return new T.Vector3(tx, 0, tz);
        }
      }
      return new T.Vector3(x, 0, z);
    }

    _tree(x, z, height, palm) {
      if (this.isBlocked(x, z, 1.2)) return;
      height = height || 6;
      this._instance(this.geo.cylinder, this.mat.trunk, x, height * 0.36, z,
        0.18, height * 0.72, 0.18);
      if (palm) {
        for (var i = 0; i < 5; i++) {
          var a = i / 5 * PI * 2;
          this._instance(this.geo.leaf, i % 2 ? this.mat.leaf : this.mat.leafDark,
            x + Math.cos(a) * 1.1, height * 0.86, z + Math.sin(a) * 1.1,
            2.6, 0.33, 0.65, -a, -0.18);
        }
      } else {
        this._instance(this.geo.leaf, this.mat.leaf, x, height * 0.78, z,
          height * 0.4, height * 0.35, height * 0.4);
        this._instance(this.geo.leaf, this.mat.leafLight, x - 1, height * 0.91, z - 0.4,
          height * 0.26, height * 0.27, height * 0.3);
      }
      this._collider(x, z, 0.7, 0.7, height * 0.65);
    }

    _lamp(x, z, height, collision) {
      height = height || 6.6;
      this._instance(this.geo.cylinder, this.mat.metal, x, height / 2, z, 0.1, height, 0.1);
      this._instance(this.geo.box, this.mat.metal, x + 0.55, height, z, 1.3, 0.12, 0.18);
      this._instance(this.geo.box, this.mat.lamp, x + 1, height - 0.12, z, 0.64, 0.13, 0.38);
      this._instance(this.geo.box, this.mat.metal, x, 0.18, z, 0.45, 0.35, 0.45);
      this._lamps.push(new T.Vector3(x + 1, height - 0.35, z));
      if (collision !== false) this._collider(x, z, 0.42, 0.42, height);
    }

    _sign(title, subtitle, x, y, z, width, height, parent, rotation, bg) {
      var key = title + '/' + subtitle + '/' + (bg || '');
      var entry = this._signCache.get(key);
      if (!entry) {
        var texture = this._canvas(512, 128, function (ctx, w, h) {
          ctx.fillStyle = bg || '#285951'; ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#e5c78d'; ctx.lineWidth = 4; ctx.strokeRect(7, 7, w - 14, h - 14);
          ctx.fillStyle = '#fff2d0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = 'bold ' + Math.min(40, Math.floor(750 / Math.max(title.length, 1))) + 'px Arial';
          ctx.fillText(title, w / 2, subtitle ? 46 : 66, w - 30);
          if (subtitle) { ctx.font = '18px Arial'; ctx.fillStyle = '#e4cfac'; ctx.fillText(subtitle, w / 2, 91, w - 35); }
        });
        entry = new T.MeshStandardMaterial({ map: texture, roughness: 0.8, side: T.FrontSide,
          emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.08 });
        this._signCache.set(key, entry);
      }
      var mesh = this._mesh(new T.PlaneGeometry(width, height), entry, parent);
      mesh.position.set(x, y, z); mesh.rotation.y = rotation || 0;
      /* A twin board rotated half a turn faces the opposite direction, so the
       * lettering reads forwards from either side of the street. */
      var reverse = this._mesh(new T.PlaneGeometry(width, height), entry, parent);
      reverse.position.set(x, y, z); reverse.rotation.y = (rotation || 0) + PI;
      return mesh;
    }
    /* A drivable route is a real OSM way, sampled to a few waypoints so the
     * traffic AI has something cheap to steer along. */
    _route(points, target, width) {
      if (!points || points.length < 2) return;
      var sampled = [points[0].clone()];
      var step = 45;
      var carried = 0;
      for (var i = 1; i < points.length; i++) {
        var previous = points[i - 1], current = points[i];
        var dx = current.x - previous.x, dz = current.z - previous.z;
        var length = Math.hypot(dx, dz);
        if (length < 1e-3) continue;
        carried += length;
        if (carried >= step) {
          sampled.push(new T.Vector3(current.x, 0, current.z));
          carried = 0;
        }
      }
      var last = points[points.length - 1];
      if (sampled[sampled.length - 1].distanceTo(last) > 1) sampled.push(last.clone());
      if (sampled.length >= 2) target.push(sampled);
    }

    /* Builds traffic and pedestrian loops from the biggest real roads only:
     * alleys would make the AI stutter in tight corners. */
    _routes() {
      var self = this;
      var majors = this._roadLines.filter(function (line) {
        return line.points.length >= 4 && line.width >= 6;
      });
      majors.slice(0, 40).forEach(function (line) {
        self._route(line.points, self.trafficRoutes, 2.1);
      });
      var walks = this._roadLines.filter(function (line) {
        return line.points.length >= 3 && line.width <= 8;
      });
      walks.slice(0, 60).forEach(function (line) {
        self._route(line.points, self.pedestrianRoutes, 0.65);
      });
      if (!this.pedestrianRoutes.length && this.spawn) {
        this.pedestrianRoutes.push([
          new T.Vector3(this.spawn.x - 60, 0, this.spawn.z - 60),
          new T.Vector3(this.spawn.x + 60, 0, this.spawn.z + 60)
        ]);
      }
      /* Road spawns sit on real road centerlines, never in a driveway. */
      this.roads.forEach(function (road) {
        if (self.roadSpawns.length >= 90) return;
        var mx = (road.x1 + road.x2) / 2, mz = (road.z1 + road.z2) / 2;
        if (self.isBlocked(mx, mz, 3)) return;
        if (Math.hypot(mx - self.spawn.x, mz - self.spawn.z) < 30) return;
        if (self.roadSpawns.some(function (v) { return Math.hypot(v.x - mx, v.z - mz) < 12; })) return;
        self.roadSpawns.push(new T.Vector3(mx, 0, mz));
      });
      /* Landmarks always get a parked vehicle within reach. */
      Object.keys(this.spots || {}).forEach(function (key) {
        var spot = self.spots[key];
        if (self.isBlocked(spot.x + 8, spot.z, 2.5)) return;
        self.roadSpawns.push(new T.Vector3(spot.x + 8, 0, spot.z));
      });
    }

    /* Lamps and trees are placed along real roads, on the verge. */
    _streetFurniture() {
      var self = this;
      var placed = 0;
      this._roadLines.forEach(function (line) {
        if (placed > 900) return;
        if (line.width < 5) return;
        var spacing = line.width > 9 ? 34 : 46;
        var next = 0;
        for (var i = 1; i < line.points.length; i++) {
          if (placed > 900) return;
          var a = line.points[i - 1], b = line.points[i];
          var dx = b.x - a.x, dz = b.z - a.z;
          var length = Math.hypot(dx, dz);
          if (length < 1e-3) continue;
          if (length < next) continue;
          next = spacing;
          var t = 0.5;
          var mx = a.x + dx * t, mz = a.z + dz * t;
          var nx = -dz / length, nz = dx / length;
          var side = (placed % 2 === 0) ? 1 : -1;
          var offset = line.width / 2 + 1.6;
          var lx = mx + nx * offset * side, lz = mz + nz * offset * side;
          if (self.isBlocked(lx, lz, 1)) continue;
          self._lamp(lx, lz, 6.6);
          placed++;
          /* A slim tree on the opposite verge every few lamps. */
          if (placed % 4 === 0) {
            var tx = mx - nx * offset * side, tz = mz - nz * offset * side;
            if (!self.isBlocked(tx, tz, 1.6)) self._tree(tx, tz, 6.5 + (placed % 3), placed % 9 === 0);
          }
        }
      });
      /* A landmark marker sign at each of the seven real locations. */
      Object.keys(this.spots || {}).forEach(function (key) {
        var spot = self.spots[key];
        var lift = 3.4;
        self._sign(SPOTS.filter(function (s) { return s.key === key; })[0].label.toUpperCase(),
          'MARIKINA • WELCOME', spot.x, lift, spot.z, 9, 2.2, self.root, 0);
      });
    }
    /* __WORLD6__ */
    /* Flat terrain: the OSM data is 2D, so ground height is always zero. */
    groundHeight() { return 0; }

    /* Water is a low blocker, so a car stops at the bank but a bullet (which
     * is tested against world.colliders only) still flies over. */
    isBlocked(x, z, r) {
      r = Number.isFinite(r) ? Math.max(0, r) : 0.4;
      if (!Number.isFinite(x) || !Number.isFinite(z)) return true;
      if (x - r < -this.bounds || x + r > this.bounds || z - r < -this.bounds || z + r > this.bounds) return true;
      var size = 60;
      for (var ix = Math.floor((x - r) / size); ix <= Math.floor((x + r) / size); ix++) {
        for (var iz = Math.floor((z - r) / size); iz <= Math.floor((z + r) / size); iz++) {
          var bucket = this._hash.get(ix + ',' + iz);
          if (!bucket) continue;
          for (var i = 0; i < bucket.length; i++) {
            var b = bucket[i];
            var nx = clamp(x, b.min.x, b.max.x), nz = clamp(z, b.min.z, b.max.z);
            var dx = x - nx, dz = z - nz;
            if ((dx === 0 && dz === 0) || dx * dx + dz * dz < r * r) return true;
          }
        }
      }
      return false;
    }

    moveCircle(pos, delta, r) {
      r = Number.isFinite(r) ? Math.max(0, r) : 0.4;
      var dx = Number.isFinite(delta.x) ? delta.x : 0, dz = Number.isFinite(delta.z) ? delta.z : 0;
      /* Substeps prevent a fast jeepney tunnelling through a thin wall. */
      var n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / Math.max(0.15, Math.min(0.75, r * 0.7))));
      dx /= n; dz /= n;
      for (var i = 0; i < n; i++) {
        if (!this.isBlocked(pos.x + dx, pos.z, r)) pos.x += dx;
        if (!this.isBlocked(pos.x, pos.z + dz, r)) pos.z += dz;
      }
      pos.y = this.groundHeight(pos.x, pos.z);
      return pos;
    }

    /* Names real Marikina districts by compass position, matching the
     * barangays the player actually spawns in. */
    districtAt(position) {
      var x = position.x, z = position.z;
      if (z < -900) return 'Concepcion';
      if (z < -300) return x < 0 ? 'Barangka' : 'Marikina Heights';
      if (z < 300) return x < -200 ? 'San Roque' : 'Bayan • City Center';
      if (z < 1200) return x < 300 ? 'Riverbanks' : 'Marikina Heights';
      return 'Industrial Valley';
    }

    _makeLights() {
      /* Four reused pools of warm light, never a PointLight per street lamp. */
      for (var i = 0; i < 4; i++) {
        var light = new T.PointLight(0xffce86, 0, 40, 2);
        light.castShadow = false; light.visible = false;
        this.root.add(light); this._lights.push(light);
      }
    }

    update(dt) {
      if (!this._initialized) return;
      dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      this._clock += dt; this._lodClock += dt;
      var night = this.game.night === true ? 1 : clamp(Number(this.game.night) || 0, 0, 1);
      this.mat.lamp.emissiveIntensity = 0.12 + night * 2.3;
      this._animated.forEach((item, i) => {
        if (item.type === 'flag') item.mesh.rotation.y = Math.sin(this._clock * 1.8 + i) * 0.15;
        else item.mesh.scale.y = item.base + Math.sin(this._clock * 3.1 + i) * 0.24;
      });
      if (this._lodClock < 0.25) return;
      this._lodClock = 0;
      var camera = this.game.camera;
      if (camera && camera.position) this._focus.copy(camera.position);
      else this._focus.copy(this.spawn);
      var x = this._focus.x, z = this._focus.z;
      var view = Math.max(320, this.game.settings ? this.game.settings.drawDistance : 220);
      /* Real Marikina is kilometres wide, so whole 420 m chunks are hidden
       * rather than individual triangles. */
      this._chunks.forEach(function (chunk) {
        var c = chunk.userData.center;
        if (!c) { chunk.visible = true; return; }
        var dx = c.x - x, dz = c.z - z;
        chunk.visible = dx * dx + dz * dz < (view + 420) * (view + 420);
      });
      this._instanceChunks.forEach(function (chunk) {
        var dx = chunk.x - x, dz = chunk.z - z;
        chunk.mesh.visible = dx * dx + dz * dz < (view + 220) * (view + 220);
      });
      /* Reuse the four light pools for whichever lamps are closest. */
      var nearest = this._lamps.map(function (p) {
        return { p: p, d: (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) };
      });
      nearest.sort(function (a, b) { return a.d - b.d; });
      this._lights.forEach((light, i) => {
        var item = nearest[i];
        light.visible = !!item && night > 0.02 && item.d < 90 * 90;
        light.intensity = night * 2.4;
        if (item) light.position.copy(item.p);
      });
    }
  }

  MG.World = World;
}());
