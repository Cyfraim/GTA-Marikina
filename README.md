# Marikina — The City Is Yours

A procedural, low-poly 3D browser sandbox inspired by open-world driving games.
The Marikina districts and landmarks are fictionalized for gameplay, not an
accurate geographic reconstruction. No affiliation with Rockstar Games or any
government agency.

## Play

Open `index.html` inside this folder in a desktop browser with WebGL enabled.
No server, npm, build tools, or downloaded art assets are required. An internet
connection is needed to load **Three.js r128 from cdnjs.cloudflare.com** and to
download the OpenStreetMap city data from the Overpass API; all other geometry,
textures, signs, and audio are generated locally.

There is also a hosted copy — see the repository links, or run
`npx vercel` for a local preview that behaves like production.

Click **Enter the city** to begin and unlock browser audio. Use a keyboard and
mouse; touch controls are not implemented.

The first visit spends a few seconds downloading roughly 38 MB of map data, which
is then cached by the browser. The loading screen shows progress and offers a
retry if no Overpass mirror responds.

## Controls

| Input | Action |
| --- | --- |
| W / A / S / D | Camera-relative movement; accelerate / steer / reverse when driving |
| Shift | Sprint |
| Space | Jump; handbrake when driving |
| Right mouse drag | Orbit camera / adjust aim |
| Mouse wheel | Zoom third-person camera |
| C | Toggle first-person / third-person camera |
| Left mouse | Fire pistol at the center crosshair |
| R | Reload; 2 seconds |
| E | Enter a nearby vehicle / exit at a safe door position |
| H | Vehicle horn |
| Escape | Pause / settings |

The pistol starts with 12 rounds loaded and 48 in reserve. Colored rotating
pickups near the plaza replenish health, armor, and ammunition. Health also
regenerates after five seconds without damage. If Juan is defeated, he respawns
at City Hall and the pursuit resets.

## Systems

- 800 × 800 city, diagonal river, three bridges, six themed districts, local
  landmark signs, procedural buildings, roadside props, and animated water.
- Juan, third/first-person camera, jumping, wall sliding, camera collision.
- Jeepney, tricycle, UV Express, private car, pedicab, MKPD SUV, and SWAT van;
  driveable vehicles, traffic, horns, lights, and basic arcade collision physics.
- Twenty pedestrians with walking, idle, fleeing, and defeated states.
- Pistol, reloading, pooled bullets, swept hit detection, impact particles.
- Three wanted levels, police pursuit, roadblocks, armed officers, and evasion.
- Ten-minute day/night cycle, shadows, fog, and procedurally synthesized audio.
- HTML HUD, minimap, speedometer, landmark labels, notifications, settings.
- Settings save to localStorage; the code tolerates storage being blocked.

## Implementation notes

Classic scripts share a small `window.MG` namespace and load in dependency
order. This deliberately avoids ES modules and fetch-based assets so local
`file://` loading works. `window.game` exposes the current session for debugging.

Performance measures include repeated-object instancing, distance/detail
culling, pooled bullet/impact objects, throttled pedestrian decisions, capped
pixel ratio, and a fixed small pool of dynamic point lights. Frame rate depends
on hardware, browser, viewport, and the number of nearby actors; 60 FPS is a
target, not a guarantee. Turn shadows off and reduce draw distance on slower
machines. Arcade AI and collision shapes are simplified rather than full
navigation-mesh / rigid-body simulation.

## Deploying

The project is a **static site with no build step**. There is no bundler, no
`package.json`, and no server-side code, so hosting it is a file copy.

### Vercel (dashboard)

1. Push this folder to a new GitHub repository.
2. In Vercel, choose **Add New → Project** and import that repository.
3. Leave **Framework Preset** as *Other*. Do not pick a framework.
4. Leave **Build Command** empty and **Output Directory** empty.
5. Deploy. Vercel serves `index.html` as the root document.

`vercel.json` sets `"framework": null` so autodetection cannot misfire, and adds
caching plus a few security headers. It does not add a build step.

### Vercel (CLI)

```bash
npx vercel            # preview deployment
npx vercel --prod     # production deployment
```

The Vercel CLI is not a project dependency, so it is not vendored here.

### Any other static host

Upload the repository as-is. `index.html`, `css/`, `js/`, and `assets/` are all
that is required; `tests/` is developer tooling and is excluded via
`.vercelignore`.

> **Note:** there is deliberately no `package.json`. Adding one makes Vercel
> treat the project as a Node build and look for a build script that does not
> exist. If you later add one, keep a no-op `build` script or set
> `"buildCommand": null` alongside `"framework": null`.

## Tests

The optional developer harnesses under `tests/` use an already-installed Python
Playwright package and Microsoft Edge. They are not runtime dependencies, and the
game does not require running them.

- `tests/scene_smoke.py` boots only the simulation modules in a blank page and
  reports building, collider, route, and draw-call counts, plus nine gameplay
  invariants. It writes `tests/scene-results.json` and `tests/world-preview.png`.
- `tests/browser_smoke.py` loads the real `index.html` over `file://`, walks the
  menu, drives, shoots, pauses, changes settings, and runs `tests/gameplay_checks.js`.
  It writes `tests/results.json` and the menu, day, night, and pause screenshots.

Run either with `python tests/<name>.py` from this folder.

The tests expect a captured Overpass payload and default to an absolute path
outside this repository (`MARIKINA_OSM_FIXTURE` overrides it). That ~38 MB file
is intentionally not committed, because it would exceed GitHub's per-file size
limit and add nothing to the site. Capture one with `tests/capture_osm.py`.

## License

MIT — see [LICENSE](LICENSE). Map data is © OpenStreetMap contributors under
the ODbL and is fetched at runtime, not redistributed here.