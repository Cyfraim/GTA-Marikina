"""Independent real-WebGL scene test; no server or installation required.

The city is built from OpenStreetMap data, so the Overpass request is routed to
a captured real payload (see osm_fixture.serve_osm). Everything downstream --
fetch, JSON parse, projection, geometry batching, collision -- is the real code.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from osm_fixture import BOOT, ROOT, attach_scene, serve_osm  # noqa: E402

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def run():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=EDGE, headless=True,
            args=["--enable-webgl", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text)
                if message.type == "error" else None)
        hits = serve_osm(page)
        attach_scene(page)
        page.evaluate(BOOT)
        page.wait_for_function("game.world && game.world._initialized", timeout=180000)
        result = page.evaluate("""() => {
            const g = window.game;
            g.world.update(.2); g.vehicles.update(.01);
            g.renderer.render(g.scene, g.camera);
            const meshes = root => { let n = 0; root.traverse(o => { if (o.isMesh && o.visible) n++; }); return n; };
            return {
                osmBuildings: g.world.buildings.length,
                colliders: g.world.colliders.length,
                roadLines: g.world._roadLines.length,
                waterLines: g.world._waterLines.length,
                landmarks: g.world.landmarks.map(l => l.name),
                spawn: g.world.spawn.toArray(),
                spawnClear: !g.world.isBlocked(g.world.spawn.x, g.world.spawn.z, .4),
                roadSpawns: g.world.roadSpawns.length,
                trafficRoutes: g.world.trafficRoutes.length,
                pedestrianRoutes: g.world.pedestrianRoutes.length,
                bounds: g.world.bounds,
                drawCalls: g.renderer.info.render.calls,
                triangles: g.renderer.info.render.triangles,
                worldMeshes: meshes(g.world.root),
                people: g.npcs.people.length,
                traffic: g.npcs.traffic.length,
                roadNodes: g.police.nodes.length
            };
        }""")
        result["osm_requests"] = len(hits)
        page.screenshot(path=str(ROOT / "tests" / "world-preview.png"))
        page.add_script_tag(path=str(ROOT / "tests" / "gameplay_checks.js"))
        result["checks"] = page.evaluate("runGameplayChecks()")
        print(json.dumps(result, indent=2))
        (ROOT / "tests" / "scene-results.json").write_text(
            json.dumps(result, indent=2), encoding="utf-8")
        browser.close()
    assert not errors, "Console errors: %s" % errors
    for key, value in result["checks"].items():
        assert all(value) if isinstance(value, list) else value, "Check failed: %s" % key
    return result


if __name__ == "__main__":
    run()
    print("scene_smoke: all checks passed")
