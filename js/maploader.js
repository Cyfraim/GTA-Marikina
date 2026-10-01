/* Marikina map loader: real OpenStreetMap data turned into Three.js geometry.
 *
 * Data (c) OpenStreetMap contributors, ODbL license.
 * https://www.openstreetmap.org/copyright
 * No API key required. Free for non-commercial use.
 *
 * Loaded as a classic script (not an ES module) so index.html keeps running
 * straight from file:// -- module scripts are blocked by CORS on that scheme.
 * Everything hangs off window.MG.MapLoader, like the rest of the project.
 */
(function () {
  'use strict';
  var MG = window.MG = window.MG || {};
  var T = window.THREE;

  /* Three r128 has no automatic colour management, yet the renderer encodes
   * to sRGB on output. Authored hex values are therefore read as linear and
   * gamma-lifted, which turns every surface into the same pale wash. Running
   * authored sRGB colours through this helper restores the intended palette.
   * Defined here because maploader.js is the first module that needs it. */
  function srgbColor(hex) {
    var color = new T.Color(hex);
    color.convertSRGBToLinear();
    return color;
  }
  MG.srgb = srgbColor;

  /* Marikina City bounding box in OSM coordinates. */
  var BBOX = { south: 14.6200, west: 121.0800, north: 14.6700, east: 121.1200 };

  /* Centre of the map, used as the world origin. */
  var CENTER_LAT = (BBOX.south + BBOX.north) / 2;
  var CENTER_LON = (BBOX.west + BBOX.east) / 2;

  /* One degree of latitude is ~111,320 m, and one world unit is one metre.
   * Keeping 1:1 with reality matters: a real 8 m house must stay taller than
   * the 1.8 unit player, and a real 12 m road must stay drivable. */
  var SCALE = 111320;
  var COS_CENTER = Math.cos(CENTER_LAT * Math.PI / 180);

  /* Geometry is merged into square chunks so the renderer can frustum-cull
   * whole neighbourhoods instead of 61,000 individual buildings. */
  var CHUNK = 420;

  /* Real Marikina landmarks, used for spawns, labels and vehicle placement. */
  var LANDMARKS = [
    { name: 'Marikina Sports Center', lat: 14.6503, lon: 121.0934 },
    { name: 'Riverbanks Mall', lat: 14.6333, lon: 121.0981 },
    { name: 'Marikina City Hall', lat: 14.6424, lon: 121.0983 },
    { name: 'Shoe Museum', lat: 14.6390, lon: 121.0966 },
    { name: 'Marikina Public Market', lat: 14.6369, lon: 121.1006 },
    { name: 'J. P. Rizal Avenue', lat: 14.6400, lon: 121.0950 },
    { name: 'Sumulong Highway', lat: 14.6550, lon: 121.1050 }
  ];

  /* Road widths in metres, taken from typical Metro Manila street sections. */
  var HIGHWAY_WIDTHS = {
    motorway: 16, trunk: 14, primary: 12, secondary: 10, tertiary: 8,
    unclassified: 7, residential: 6, living_street: 5, service: 4,
    pedestrian: 5, motorway_link: 9, trunk_link: 8, primary_link: 7,
    secondary_link: 6, tertiary_link: 5, default: 5
  };

  /* Overpass mirrors, tried in order. The canonical overpass-api.de answers
   * 406 on some networks, so a fallback list is not optional. */
  var ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ];
  var TIMEOUT_MS = 120000;
  /* Footways, alleys and tracks are excluded: they triple the payload and add
   * nothing a player can drive. `out geom` inlines coordinates per way. */
  function buildQuery() {
    var b = BBOX.south + ',' + BBOX.west + ',' + BBOX.north + ',' + BBOX.east;
    return '[out:json][timeout:180];(' +
      'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]["area"!~"yes"](' + b + ');' +
      'way["building"]["building"!~"^(roof|carport|garage|shed|toilets|canopy)$"](' + b + ');' +
      'way["waterway"~"^(river|stream|canal)$"](' + b + ');' +
      'way["natural"="water"](' + b + ');' +
      'relation["natural"="water"](' + b + ');' +
      ');out geom;';
  }

  /* East is +X, north is -Z, matching the rest of the project's coordinate
   * convention. */
  function latlonToXZ(lat, lon) {
    return {
      x: (lon - CENTER_LON) * SCALE * COS_CENTER,
      z: -(lat - CENTER_LAT) * SCALE
    };
  }

  function xzToLatLon(x, z) {
    return {
      lat: CENTER_LAT - z / SCALE,
      lon: CENTER_LON + x / (SCALE * COS_CENTER)
    };
  }

  /* Deterministic 0..1 hash, so a reload rebuilds the exact same skyline
   * instead of reshuffling every untagged building's height. */
  function hashUnit(value) {
    var h = value | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }

  /* Ways carry either inline geometry (out geom) or node references. */
  function wayPoints(element, nodes) {
    var out = [];
    var i;
    if (element.geometry && element.geometry.length) {
      for (i = 0; i < element.geometry.length; i++) {
        var p = element.geometry[i];
        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
          var g = latlonToXZ(p.lat, p.lon);
          out.push(g.x, g.z);
        }
      }
      return out;
    }
    if (element.nodes && nodes) {
      for (i = 0; i < element.nodes.length; i++) {
        var n = nodes[element.nodes[i]];
        if (!n) continue;
        var q = latlonToXZ(n.lat, n.lon);
        out.push(q.x, q.z);
      }
    }
    return out;
  }

  function buildNodeMap(elements) {
    var nodes = {};
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (el.type === 'node') nodes[el.id] = { lat: el.lat, lon: el.lon };
    }
    return nodes;
  }
  /* Streams the body so a 38 MB download can report progress, then parses. */
  function readJSON(response, onBytes) {
    if (!response.body || !response.body.getReader) return response.json();
    var reader = response.body.getReader();
    var parts = [];
    var received = 0;
    return (function pump() {
      return reader.read().then(function (step) {
        if (step.done) {
          var buffer = new Uint8Array(received);
          var offset = 0;
          for (var i = 0; i < parts.length; i++) {
            buffer.set(parts[i], offset);
            offset += parts[i].length;
          }
          return JSON.parse(new TextDecoder('utf-8').decode(buffer));
        }
        parts.push(step.value);
        received += step.value.length;
        if (onBytes) onBytes(received);
        return pump();
      });
    }());
  }

  function fetchFrom(url, body, onBytes) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, TIMEOUT_MS);
    var options = { method: 'POST', body: body };
    if (controller) options.signal = controller.signal;
    return fetch(url, options).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return readJSON(res, onBytes);
    }).then(function (data) {
      clearTimeout(timer);
      if (!data || !Array.isArray(data.elements)) throw new Error('Unexpected response from ' + url);
      return data;
    }, function (error) {
      clearTimeout(timer);
      throw error;
    });
  }

  /* Tries each mirror in turn; a single 406 or timeout is not fatal. */
  function fetchOSMData(onProgress) {
    var body = 'data=' + encodeURIComponent(buildQuery());
    var failure = null;
    function attempt(index) {
      if (index >= ENDPOINTS.length) {
        return Promise.reject(failure || new Error('No Overpass mirror responded.'));
      }
      if (onProgress) onProgress('Contacting OpenStreetMap…', 0.02);
      return fetchFrom(ENDPOINTS[index], body, onProgress ? function (bytes) {
        var mb = (bytes / 1048576).toFixed(1);
        onProgress('Downloading Marikina map… ' + mb + ' MB', 0.02 + Math.min(0.5, bytes / 38e6 * 0.5));
      } : null).catch(function (error) {
        failure = error;
        return attempt(index + 1);
      });
    }
    return attempt(0);
  }
  /* Accumulates triangles per (material, chunk) pair and emits one mesh each.
   * A box is 12 triangles; 61,208 buildings therefore cost a few dozen draw
   * calls instead of 61,208. */
  function MeshBatcher() {
    this.groups = new Map();
  }
  MeshBatcher.prototype.key = function (material, chunkX, chunkZ) {
    return material.uuid + '|' + chunkX + '|' + chunkZ;
  };
  MeshBatcher.prototype.group = function (material, x, z) {
    var cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    var key = this.key(material, cx, cz);
    var group = this.groups.get(key);
    if (!group) {
      group = { material: material, cx: cx, cz: cz, pos: [], nor: [], col: [], idx: [], count: 0 };
      this.groups.set(key, group);
    }
    return group;
  };
  /* Adds a quad as two triangles, winding counter-clockwise seen from above. */
  MeshBatcher.prototype.quad = function (material, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, r, g, b) {
    var group = this.group(material, ax, az);
    var p = group.pos, n = group.nor, c = group.col, ix = group.idx, base = group.count;
    p.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    n.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    c.push(r, g, b, r, g, b, r, g, b, r, g, b);
    ix.push(base, base + 1, base + 2, base, base + 2, base + 3);
    group.count += 4;
  };
  /* Triangulate concave footprints with upward-facing triangles. */
  MeshBatcher.prototype.polygon = function (material, pts, height, r, g, b) {
    var contour = [];
    for (var i = 0; i < pts.length; i += 2) contour.push(new T.Vector2(pts[i], pts[i + 1]));
    if (contour.length > 1 && contour[0].equals(contour[contour.length - 1])) contour.pop();
    var faces = T.ShapeUtils.triangulateShape(contour, []);
    for (var f = 0; f < faces.length; f++) {
      var a = contour[faces[f][0]], c = contour[faces[f][1]], d = contour[faces[f][2]];
      if ((c.x - a.x) * (d.y - a.y) - (c.y - a.y) * (d.x - a.x) > 0) {
        var swap = c; c = d; d = swap;
      }
      var group = this.group(material, a.x, a.y), base = group.count;
      group.pos.push(a.x, height, a.y, c.x, height, c.y, d.x, height, d.y);
      group.nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      group.col.push(r, g, b, r, g, b, r, g, b);
      group.idx.push(base, base + 1, base + 2);
      group.count += 3;
    }
  };
  /* Vertical wall quad with an explicit normal, for building sides. */
  MeshBatcher.prototype.wall = function (material, ax, ay, az, bx, by, bz, height, r, g, b) {
    var group = this.group(material, ax, az);
    var p = group.pos, n = group.nor, c = group.col, ix = group.idx, base = group.count;
    var dx = bx - ax, dz = bz - az;
    var len = Math.hypot(dx, dz) || 1;
    var nx = dz / len, nz = -dx / len;
    p.push(ax, ay, az, bx, by, bz, bx, by + height, bz, ax, ay + height, az);
    n.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
    c.push(r, g, b, r, g, b, r, g, b, r, g, b);
    ix.push(base, base + 2, base + 1, base, base + 3, base + 2);
    group.count += 4;
  };
  MeshBatcher.prototype.finish = function (parent, name, castShadow, receiveShadow) {
    var out = [];
    var self = this;
    this.groups.forEach(function (group) {
      if (!group.count) return;
      var geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(group.pos, 3));
      geometry.setAttribute('normal', new T.Float32BufferAttribute(group.nor, 3));
      geometry.setAttribute('color', new T.Float32BufferAttribute(group.col, 3));
      geometry.setIndex(group.idx);
      geometry.computeBoundingSphere();
      var mesh = new T.Mesh(geometry, group.material);
      mesh.name = name;
      mesh.castShadow = !!castShadow;
      mesh.receiveShadow = receiveShadow !== false;
      mesh.userData.chunk = { x: group.cx, z: group.cz };
      mesh.userData.center = new T.Vector3((group.cx + 0.5) * CHUNK, 0, (group.cz + 0.5) * CHUNK);
      parent.add(mesh);
      out.push(mesh);
    });
    this.groups.clear();
    return out;
  };
  /* Builds road ribbons from OSM ways. Also returns the centerline polylines,
   * because the minimap, vehicle spawns and traffic routes all reuse them. */
  function buildRoads(elements, nodes, parent, materials) {
    var batcher = new MeshBatcher();
    var lines = [];
    var roads = [];
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (element.type !== 'way' || !element.tags || !element.tags.highway) continue;
      var pts = wayPoints(element, nodes);
      if (pts.length < 4) continue;
      var tags = element.tags;
      var width = HIGHWAY_WIDTHS[tags.highway] || HIGHWAY_WIDTHS.default;
      if (tags.lanes) {
        var lanes = parseInt(tags.lanes, 10);
        if (lanes > 0) width = Math.max(width, lanes * 3.4);
      }
      width = Math.min(width, 22);
      var tint = materials.roadTint(tags.highway);
      for (var s = 0; s + 3 < pts.length; s += 2) {
        var ax = pts[s], az = pts[s + 1], bx = pts[s + 2], bz = pts[s + 3];
        var dx = bx - ax, dz = bz - az;
        var len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        var half = width / 2;
        var nx = -dz / len * half, nz = dx / len * half;
        batcher.quad(materials.road, ax + nx, 0.05, az + nz, bx + nx, 0.05, bz + nz,
          bx - nx, 0.05, bz - nz, ax - nx, 0.05, az - nz, tint[0], tint[1], tint[2]);
        if (/^(motorway|trunk|primary)$/.test(tags.highway)) {
          for (var dash = 0; dash + 2 <= len; dash += 6) {
            var sx = ax + dx / len * dash, sz = az + dz / len * dash;
            var ex = sx + dx / len * 2, ez = sz + dz / len * 2;
            var mx = -dz / len * 0.15, mz = dx / len * 0.15;
            batcher.quad(materials.marking, sx + mx, 0.06, sz + mz, ex + mx, 0.06, ez + mz,
              ex - mx, 0.06, ez - mz, sx - mx, 0.06, sz - mz, 1, 1, 1);
          }
        }
        /* Raised 1.5 m concrete strips; keep them in the chunk batch. */
        for (var side = -1; side <= 1; side += 2) {
          var ox = -dz / len * (half + 0.75) * side;
          var oz = dx / len * (half + 0.75) * side;
          var wx = -dz / len * 0.75, wz = dx / len * 0.75;
          batcher.quad(materials.sidewalk, ax + ox + wx, 0.13, az + oz + wz,
            bx + ox + wx, 0.13, bz + oz + wz, bx + ox - wx, 0.13, bz + oz - wz,
            ax + ox - wx, 0.13, az + oz - wz, 1, 1, 1);
          batcher.wall(materials.sidewalk, ax + ox + wx, 0.05, az + oz + wz,
            bx + ox + wx, 0.05, bz + oz + wz, 0.08, 1, 1, 1);
          batcher.wall(materials.sidewalk, bx + ox - wx, 0.05, bz + oz - wz,
            ax + ox - wx, 0.05, az + oz - wz, 0.08, 1, 1, 1);
        }
        roads.push({ x1: ax, z1: az, x2: bx, z2: bz, width: width, name: tags.name || '' });
      }
      var line = [];
      for (var k = 0; k < pts.length; k += 2) line.push(new T.Vector3(pts[k], 0, pts[k + 1]));
      lines.push({ points: line, width: width, name: tags.name || '', class: tags.highway });
    }
    var meshes = batcher.finish(parent, 'osm-roads', false, true);
    return { meshes: meshes, lines: lines, roads: roads };
  }
  /* Building colours keyed off real OSM tags. */
  var BUILDING_COLORS = {
    residential: 0xd4956a, commercial: 0x5b7fa6, government: 0xdeded0,
    school: 0x8aab6e, hospital: 0xffffff, church: 0xf2e8d0,
    industrial: 0x7a7a6e, default: 0xc8a882
  };

  function buildingType(tags) {
    var type = tags.building || 'default';
    if (/^(school|college|university)$/.test(tags.amenity || '') || /^(school|university|college)$/.test(type)) return 'school';
    if (/^(hospital|clinic)$/.test(tags.amenity || '') || type === 'hospital') return 'hospital';
    if (tags.amenity === 'place_of_worship' || /^(church|religious|cathedral|chapel|mosque|temple)$/.test(type)) return 'church';
    if (tags.office === 'government' || tags.amenity === 'townhall' || /^(government|civic|public)$/.test(type)) return 'government';
    if (/^(house|residential|detached|terrace|apartments|semidetached_house|bungalow|dormitory)$/.test(type)) return 'residential';
    if (/^(commercial|retail|office|supermarket)$/.test(type) || tags.shop) return 'commercial';
    if (/^(industrial|warehouse)$/.test(type)) return 'industrial';
    return 'default';
  }

  /* Height in metres: prefer the real tag, then fall back to a storey count
   * implied by footprint size, seeded by the OSM id so reloads match. */
  function buildingHeight(tags, id, area) {
    var seed = hashUnit(id);
    var type = buildingType(tags);
    var cap = type === 'residential' ? 12 : type === 'commercial' ? 40 : type === 'default' ? 8 : 40;
    if (tags.height) {
      var metres = parseFloat(tags.height);
      if (/ft|feet|foot/i.test(String(tags.height))) metres *= 0.3048;
      if (Number.isFinite(metres) && metres > 1) return Math.min(cap, metres);
    }
    if (tags['building:levels']) {
      var levels = parseFloat(tags['building:levels']);
      if (Number.isFinite(levels) && levels > 0) return Math.min(cap, levels * 3.4 + 1);
    }
    if (type === 'church') return 14 + seed * 8;
    if (type === 'commercial') return 8 + seed * 22;
    if (type === 'industrial') return 6 + seed * 8;
    /* Residential Marikina is mostly two to three storeys. */
    var storeys = area > 400 ? 3 : area > 150 ? 2 : 1;
    return Math.min(cap, storeys * 3.2 + seed * 1.6);
  }

  function buildingColor(tags) {
    return BUILDING_COLORS[buildingType(tags)];
  }

  /* Builds extruded building shells from OSM footprints and registers an axis
   * aligned collider so bullets, the player and cars all respect them. */
  function buildBuildings(elements, nodes, parent, materials, colliders, onProgress) {
    var batcher = new MeshBatcher();
    var buildings = [];
    var color = new T.Color();
    var count = 0;
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (element.type !== 'way' || !element.tags || !element.tags.building) continue;
      var pts = wayPoints(element, nodes);
      var n = pts.length / 2;
      if (n < 3) continue;
      var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (var k = 0; k < n; k++) {
        var px = pts[k * 2], pz = pts[k * 2 + 1];
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (pz < minZ) minZ = pz;
        if (pz > maxZ) maxZ = pz;
      }
      var width = maxX - minX, depth = maxZ - minZ;
      /* Slivers are mapping artefacts, not places; skipping them keeps the
       * collision hash and the triangle budget sane. */
      if (width < 1.5 || depth < 1.5) continue;
      var height = buildingHeight(element.tags, element.id, width * depth);
      var hex = buildingColor(element.tags);
      color.setHex(hex);
      color.convertSRGBToLinear();
      var r = color.r, g = color.g, b = color.b;
      var cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      /* Walls follow the real footprint so L-shapes read correctly. */
      for (var w = 0; w < n; w++) {
        var ax = pts[w * 2], az = pts[w * 2 + 1];
        var j = (w + 1) % n;
        batcher.wall(materials.shell, ax, 0, az, pts[j * 2], 0, pts[j * 2 + 1], height, r, g, b);
      }
      /* Flat, slightly darker roofs follow concave footprints correctly. */
      batcher.polygon(materials.shell, pts, height + 0.01, r * 0.85, g * 0.85, b * 0.85);
      colliders.push(new T.Box3(new T.Vector3(minX, 0, minZ), new T.Vector3(maxX, height, maxZ)));
      buildings.push({ x: cx, z: cz, w: width, d: depth, h: height, tags: element.tags });
      count++;
    }
    var meshes = batcher.finish(parent, 'osm-buildings', true, true);
    if (onProgress) onProgress(count);
    return { meshes: meshes, buildings: buildings, count: count };
  }
  /* Waterways: natural=water polygons and river/stream centerlines. The
   * centerlines become a wide ribbon and double as minimap input. */
  function buildWater(elements, nodes, parent, materials) {
    var batcher = new MeshBatcher();
    var lines = [];
    var colliders = [];
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (element.type !== 'way' || !element.tags) continue;
      var isArea = element.tags.natural === 'water' || element.tags.waterway === 'riverbank';
      var isLine = element.tags.waterway === 'river' || element.tags.waterway === 'stream' || element.tags.waterway === 'canal';
      if (!isArea && !isLine) continue;
      var pts = wayPoints(element, nodes);
      if (pts.length < 4) continue;
      var n = pts.length / 2;
      var riverWidth = isArea ? 0 : (element.tags.waterway === 'river' ? 35 : element.tags.waterway === 'stream' ? 8 : 14);
      if (riverWidth === 0) {
        batcher.polygon(materials.water, pts, -0.05, 1, 1, 1);
        continue;
      }
      var line = [];
      for (var s = 0; s + 3 < pts.length; s += 2) {
        var ax = pts[s], az = pts[s + 1], bx = pts[s + 2], bz = pts[s + 3];
        var dx = bx - ax, dz = bz - az;
        var len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        var half = riverWidth / 2;
        var nx = -dz / len * half, nz = dx / len * half;
        batcher.quad(materials.water, ax + nx, -0.05, az + nz, bx + nx, -0.05, bz + nz,
          bx - nx, -0.05, bz - nz, ax - nx, -0.05, az - nz, 1, 1, 1);
        /* Water is walkable-blocking but not a building, so it gets a thin,
         * low collider that still stops the player and cars. */
        colliders.push({ x: (ax + bx) / 2, z: (az + bz) / 2, w: riverWidth, d: len, h: 0.5 });
      }
      for (var p = 0; p < pts.length; p += 2) line.push(new T.Vector3(pts[p], 0, pts[p + 1]));
      lines.push({ points: line, width: riverWidth, name: element.tags.name || 'Marikina River' });
    }
    var meshes = batcher.finish(parent, 'osm-water', false, true);
    return { meshes: meshes, lines: lines, colliders: colliders };
  }
  /* Vertex-coloured Lambert/Phong materials: one draw call per chunk each. */
  function createMaterials() {
    var ROAD_TINTS = {
      motorway: 0x2a2a2a, trunk: 0x2a2a2a, primary: 0x2a2a2a, default: 0x333333
    };
    return {
      ground: new T.MeshLambertMaterial({ color: srgbColor(0x4a5e3a) }),
      road: new T.MeshLambertMaterial({ vertexColors: true }),
      marking: new T.MeshLambertMaterial({ color: srgbColor(0xffffff) }),
      sidewalk: new T.MeshLambertMaterial({ color: srgbColor(0xc8b89a), side: T.DoubleSide }),
      /* One material for both walls and roofs: the roof tint is baked into
       * the vertex colours, which halves the building draw calls. */
      shell: new T.MeshLambertMaterial({ vertexColors: true }),
      building: new T.MeshLambertMaterial({ vertexColors: true }),
      roof: new T.MeshLambertMaterial({ vertexColors: true }),
      water: new T.MeshPhongMaterial({ color: srgbColor(0x2e86ab), shininess: 100, transparent: true, opacity: 0.85 }),
      roadTint: function (name) {
        var tint = srgbColor(ROAD_TINTS[name] || ROAD_TINTS.default);
        return [tint.r, tint.g, tint.b];
      }
    };
  }

  /* Ground plane sized to the real data extent rather than a guessed square. */
  function buildGround(extent, materials, parent) {
    var geometry = new T.PlaneGeometry(extent.halfWidth * 2 + 400, extent.halfDepth * 2 + 400);
    geometry.rotateX(-Math.PI / 2);
    var mesh = new T.Mesh(geometry, materials.ground);
    mesh.position.set(extent.centerX, -0.1, extent.centerZ);
    mesh.receiveShadow = true;
    mesh.name = 'osm-ground';
    parent.add(mesh);
    return mesh;
  }

  /* Main entry point. Yields to the event loop between stages so the loading
   * screen keeps painting while ~66,000 OSM elements are turned into meshes. */
  function loadMarikinaMap(scene, onProgress) {
    var report = function (text, progress) { if (onProgress) onProgress(text, progress); };
    report('Downloading Marikina map from OpenStreetMap…', 0.02);
    return fetchOSMData(report).then(function (data) {
      report('Reading ' + data.elements.length.toLocaleString() + ' map features…', 0.55);
      return yieldFrame().then(function () {
        var elements = data.elements;
        var nodes = buildNodeMap(elements);
        var materials = createMaterials();
        var root = new T.Group();
        root.name = 'Marikina (OpenStreetMap)';
        scene.add(root);
        var colliders = [];
        var extent = computeExtent(elements);
        buildGround(extent, materials, root);

        report('Laying down Marikina roads…', 0.6);
        return yieldFrame().then(function () {
          var roads = buildRoads(elements, nodes, root, materials);
          report('Raising Marikina buildings…', 0.72);
          return yieldFrame().then(function () {
            var buildings = buildBuildings(elements, nodes, root, materials, colliders);
            report('Filling in the Marikina River…', 0.92);
            return yieldFrame().then(function () {
              var water = buildWater(elements, nodes, root, materials);
              report('Map ready.', 1);
              return {
                root: root, materials: materials, colliders: colliders,
                waterColliders: water.colliders, roadLines: roads.lines,
                roadSegments: roads.roads, waterLines: water.lines,
                buildings: buildings.buildings, buildingCount: buildings.count,
                chunkMeshes: roads.meshes.concat(buildings.meshes, water.meshes),
                extent: extent, elements: elements, nodes: nodes,
                landmarks: LANDMARKS.map(function (item) {
                  var p = latlonToXZ(item.lat, item.lon);
                  return { name: item.name, lat: item.lat, lon: item.lon, x: p.x, z: p.z };
                })
              };
            });
          });
        });
      });
    });
  }

  function yieldFrame() {
    return new Promise(function (resolve) { requestAnimationFrame(function () { setTimeout(resolve, 0); }); });
  }

  /* Real bounds of the downloaded data, used for the world bounds and ground. */
  function computeExtent(elements) {
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (el.type !== 'way' || !el.geometry) continue;
      for (var k = 0; k < el.geometry.length; k++) {
        var p = latlonToXZ(el.geometry[k].lat, el.geometry[k].lon);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
    }
    if (!Number.isFinite(minX)) {
      minX = (BBOX.west - CENTER_LON) * SCALE * COS_CENTER;
      maxX = (BBOX.east - CENTER_LON) * SCALE * COS_CENTER;
      minZ = -(BBOX.north - CENTER_LAT) * SCALE;
      maxZ = -(BBOX.south - CENTER_LAT) * SCALE;
    }
    return {
      minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ,
      halfWidth: (maxX - minX) / 2, halfDepth: (maxZ - minZ) / 2,
      centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2
    };
  }

  MG.MapLoader = {
    loadMarikinaMap: loadMarikinaMap,
    latlonToXZ: latlonToXZ,
    xzToLatLon: xzToLatLon,
    fetchOSMData: fetchOSMData,
    buildQuery: buildQuery,
    createMaterials: createMaterials,
    /* Exposed for the offline test harness and for debugging in the console. */
    buildRoads: buildRoads,
    buildBuildings: buildBuildings,
    buildWater: buildWater,
    buildNodeMap: buildNodeMap,
    wayPoints: wayPoints,
    computeExtent: computeExtent,
    LANDMARKS: LANDMARKS,
    HIGHWAY_WIDTHS: HIGHWAY_WIDTHS,
    BBOX: BBOX,
    CENTER_LAT: CENTER_LAT,
    CENTER_LON: CENTER_LON,
    SCALE: SCALE,
    CHUNK: CHUNK
  };
}());
