"""Optional developer smoke test. Game runtime does not depend on Python/Playwright.

Uses the already-installed Python Playwright package and Microsoft Edge; no npm,
server, bundler, or game dependencies are installed by this test.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from osm_fixture import serve_osm

ROOT = Path(__file__).resolve().parents[1]
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def run():
    errors = []
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=EDGE, headless=True,
                                   args=["--enable-webgl", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        hits = serve_osm(page)
        page.goto((ROOT / "index.html").as_uri(), wait_until="load", timeout=90000)
        page.wait_for_function("window.game && game.ready", timeout=180000)
        results["initialization"] = page.evaluate("""() => ({
            revision: THREE.REVISION, people: game.npcs.people.length,
            types: [...new Set(game.vehicles.items.map(v => v.type))],
            buildings: game.world.buildings.length,
            roads: game.world._roadLines.length,
            museumDistance: (() => {
                const p = MG.MapLoader.latlonToXZ(14.6390, 121.0966);
                return Math.hypot(game.world.spawn.x - p.x, game.world.spawn.z - p.z);
            })(),
            landmarks: game.world.landmarks.map(l => l.name),
            spawnClear: !game.world.isBlocked(game.world.spawn.x,game.world.spawn.z,.4),
            roadSpawns: game.world.roadSpawns.length,
            drawCalls: game.renderer.info.render.calls,
            triangles: game.renderer.info.render.triangles,
            shadows: game.renderer.shadowMap.enabled,
            // 2 / (right - left) proves the shadow frustum was rebuilt.
            shadowProjection: game.sun.shadow.camera.projectionMatrix.elements[0]
        })""")
        assert results["initialization"]["shadowProjection"] == 2 / 130
        assert results["initialization"]["revision"] == "128"
        assert results["initialization"]["people"] == 20
        assert results["initialization"]["spawnClear"]
        assert results["initialization"]["buildings"] > 1000
        assert results["initialization"]["roads"] > 50
        assert results["initialization"]["museumDistance"] <= 90
        results["osm_requests"] = len(hits)
        assert hits, "No local OSM fixture request was served"
        page.wait_for_timeout(900)
        page.screenshot(path=str(ROOT / "tests" / "menu.png"))
        page.click("#startButton")
        page.wait_for_function("game.started && !game.paused")
        page.mouse.move(1000, 580)
        page.wait_for_timeout(200)
        first_heading = page.evaluate("game.player.mesh.rotation.y")
        page.mouse.move(420, 580)
        page.wait_for_timeout(200)
        results["mouse_aim"] = page.evaluate("""first => {
            const ch = document.getElementById('crosshair');
            const rect = ch.getBoundingClientRect();
            return {
                turnsWithoutFiring: Math.abs(MG.angleDelta(first, game.player.mesh.rotation.y)) > .05,
                headingMatchesMesh: game.player.heading === game.player.mesh.rotation.y,
                crosshairFollowsMouse: Math.abs(rect.x + rect.width / 2 - 420) < 1
                    && Math.abs(rect.y + rect.height / 2 - 580) < 1,
                cursorHidden: getComputedStyle(document.body).cursor === 'none'
            };
        }""", first_heading)
        assert all(results["mouse_aim"].values()), results["mouse_aim"]
        before = page.evaluate("game.player.position.toArray()")
        page.keyboard.down("KeyW")
        page.wait_for_timeout(900)
        page.keyboard.up("KeyW")
        after = page.evaluate("game.player.position.toArray()")
        results["keyboard_movement"] = sum((a-b)**2 for a, b in zip(after, before)) ** .5
        assert results["keyboard_movement"] > .5
        page.evaluate("""() => {
            const v = game.vehicles.items.find(v => v.type === 'jeepney' && !v.driver);
            game.player.position.copy(v.position).add(new THREE.Vector3(v.radius+.6,0,0));
            game.player.velocity.set(0,0,0);
        }""")
        page.keyboard.press("KeyE")
        page.wait_for_function("game.player.vehicle !== null")
        page.wait_for_timeout(100)
        assert page.evaluate("getComputedStyle(document.body).cursor === 'default'")
        page.keyboard.down("KeyW")
        page.wait_for_timeout(1100)
        page.keyboard.up("KeyW")
        results["driving"] = page.evaluate("({name:game.player.vehicle.name, speed:game.player.vehicle.speed})")
        assert results["driving"]["speed"] > 1
        page.keyboard.press("KeyE")
        page.wait_for_function("game.player.vehicle === null")
        results["exit_clear"] = page.evaluate("!game.world.isBlocked(game.player.position.x, game.player.position.z, .35)")
        assert results["exit_clear"]
        results["npc_shot"] = page.evaluate("""() => {
            const g = game;
            g.pause(true); g.player.respawn(); g.clearInput(); g.police.reset(); g.combat.reset();
            const npc = g.npcs.people.find(p => p.hp > 0);
            const saved = npc.position.clone(); const health = npc.hp;
            npc.position.copy(g.world.spawn).add(new THREE.Vector3(0, 0, 5)); npc.hp = 30;
            g.player.cameraYaw = 0;
            g.camera.position.copy(g.world.spawn).add(new THREE.Vector3(0, 5, -6));
            g.camera.lookAt(npc.position.x, 1.3, npc.position.z); g.camera.updateMatrixWorld(true);
            g.paused = false;
            g.renderer.domElement.dispatchEvent(new MouseEvent('mousedown', {
                button: 0, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true
            }));
            g.paused = true;
            g.combat.update(0); g.combat.update(.1);
            const result = {npcHit: npc.hp === 10, wanted: g.police.wanted, ammo: g.combat.ammo};
            npc.position.copy(saved); npc.hp = health;
            g.combat.reset(); g.clearInput(); g.pause(false);
            return result;
        }""")
        assert results["npc_shot"] == {"npcHit": True, "wanted": 1, "ammo": 11}
        page.wait_for_function("game.combat.cooldown === 0")
        page.mouse.click(720, 450)
        page.wait_for_function("game.combat.ammo < 12 && game.police.wanted >= 1")
        results["shot"] = page.evaluate("({ammo:game.combat.ammo, wanted:game.police.wanted})")
        page.wait_for_timeout(700)
        page.screenshot(path=str(ROOT / "tests" / "gameplay.png"))
        # Same spot after dusk, with the default low shadow map still enabled.
        page.evaluate("game.time=430;game.updateLighting()")
        page.wait_for_timeout(900)
        page.screenshot(path=str(ROOT / "tests" / "night.png"))
        results["night_lights"] = page.evaluate("game.world._lights.filter(l => l.visible).length")
        page.evaluate("game.time=0;game.updateLighting()")
        page.keyboard.press("Escape")
        page.wait_for_function("game.paused")
        assert page.evaluate("getComputedStyle(document.body).cursor === 'default'")
        paused_time = page.evaluate("game.time")
        page.wait_for_timeout(300)
        assert page.evaluate("game.time") == paused_time
        results["pause"] = True
        page.select_option("#shadowQuality", "off")
        page.locator("#fov").evaluate("e => { e.value=83; e.dispatchEvent(new Event('input')); }")
        results["settings"] = page.evaluate("({fov:game.camera.fov, shadows:game.renderer.shadowMap.enabled,saved:JSON.parse(localStorage.getItem('marikina-gta-settings')).fov})")
        assert results["settings"] == {"fov": 83, "shadows": False, "saved": 83}
        # Deterministic simulation while rendering remains paused.
        results["simulation"] = page.evaluate("""() => {
            const g=game, c=g.combat, p=g.player;
            g.clearInput();
            c.ammo=3; c.reserve=20; c.reload();
            for(let i=0;i<125;i++) c.update(1/60);
            const reloaded=c.ammo===12 && c.reserve===11 && !c.reloading;
            g.police.crime('killing'); const two=g.police.wanted;
            g.police.crime('killPolice');
            for(let i=0;i<90;i++) g.step(1/60);
            const maxWanted=g.police.wanted;
            const response=g.police.units.map(v=>v.type);
            const npc=g.npcs.people.find(n=>n.hp>0);
            const old=npc.hp; npc.damage(20,new THREE.Vector3());
            const damageWorks=npc.hp===old-20;
            p.armor=0;p.hp=80;p.lastDamage=g.time-6;
            g.player.update(.5);const regen=p.hp>80;
            g.time=400;g.updateLighting();const night=g.night;
            g.time=0;g.updateLighting();const day=!g.night;
            p.respawnTime=g.time-3;
            p.damage(200);
            const dead=p.hp===0;
            for(let i=0;i<190;i++) g.step(1/60);
            const respawn=p.hp>0 && g.police.wanted===0;
            return {reloaded,two,maxWanted,response,damageWorks,regen,night,day,dead,respawn,
                pool:c.bullets.length, officers:g.police.officers.length};
        }""")
        simulation = results["simulation"]
        for key in ["reloaded", "damageWorks", "regen", "night", "day", "dead", "respawn"]:
            assert simulation[key], f"Simulation failed: {key}: {simulation}"
        assert simulation["two"] == 2 and simulation["maxWanted"] == 3
        assert "swat" in simulation["response"]
        assert simulation["pool"] == 64
        page.add_script_tag(path=str(ROOT / "tests" / "gameplay_checks.js"))
        results["gameplay_checks"] = page.evaluate("runGameplayChecks()")
        for key, value in results["gameplay_checks"].items():
            assert all(value) if isinstance(value, list) else value, f"Gameplay check failed: {key}: {value}"
        page.click("#resumeButton")
        page.wait_for_timeout(500)
        page.screenshot(path=str(ROOT / "tests" / "paused-resume.png"))
        page.set_viewport_size({"width": 900, "height": 620})
        page.wait_for_timeout(200)
        results["resize"] = page.evaluate("Math.abs(game.camera.aspect - 900/620) < .001")
        assert results["resize"]
        page.keyboard.press("Escape")
        page.click("#quitButton")
        assert page.evaluate("!game.started && !document.getElementById('menu').classList.contains('hidden')")
        # No developer console must report an error.
        results["errors"] = errors
        assert page.evaluate("getComputedStyle(document.body).cursor === 'default'")
        browser.close()
    (ROOT / "tests" / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))
    assert not errors, f"Browser errors: {errors}"


if __name__ == "__main__":
    run()