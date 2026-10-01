"""Shared helpers for the Playwright smoke tests.

The city is now built from live OpenStreetMap data, which is a ~38 MB download
that would make the tests slow and network-dependent. Instead the tests route
the Overpass request to a captured real payload, so the genuine
fetch -> JSON.parse -> geometry pipeline still runs end to end.

Point MARIKINA_OSM_FIXTURE at a different capture to test another area.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = os.environ.get(
    "MARIKINA_OSM_FIXTURE",
    r"D:\Documents\System Projects\GTA Marikina\osm_full.json",
)
FIXTURE = Path(FIXTURE_PATH)

OVERPASS_HOSTS = (
    "overpass-api.de",
    "overpass.kumi.systems",
    "overpass.private.coffee",
    "maps.mail.ru",
)


def serve_osm(page, fixture=FIXTURE):
    """Answer any Overpass request with the captured payload."""
    fixture = Path(fixture)
    if not fixture.exists():
        raise SystemExit(
            "Missing OSM fixture at %s.\n"
            "Capture one with tests/capture_osm.py, or pass a path to serve_osm()." % fixture
        )
    body = fixture.read_bytes()
    hits = []

    def handler(route):
        hits.append(route.request.url)
        route.fulfill(
            status=200,
            content_type="application/json",
            # Access-Control-Allow-Origin mirrors the real mirrors, so the
            # file:// fetch path is exercised as it is in production.
            headers={"Access-Control-Allow-Origin": "*"},
            body=body,
        )

    for host in OVERPASS_HOSTS:
        page.route("**/*%s*/api/interpreter*" % host, handler)
    return hits


def attach_scene(page):
    """Load the game scripts into a blank page, as scene_smoke.py does."""
    page.set_content("<html><body></body></html>")
    page.add_script_tag(url="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js")
    for file in ["maploader.js", "world.js", "player.js", "vehicles.js",
                 "npcs.js", "police.js", "combat.js"]:
        page.add_script_tag(path=str(ROOT / "js" / file))


BOOT = """
() => {
    const M = MG;
    M.clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    M.exp=(r,d)=>1-Math.exp(-r*d);
    M.angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
    const g=window.game={scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(70,1.6,.1,4000),
        settings:{drawDistance:220,sensitivity:1},time:0,night:false,
        keys:new Set(),pressed:new Set(),mouse:{fire:false,x:innerWidth/2,y:innerHeight/2},
        audio:{footstep(){},scream(){},gunshot(){}},hud:{notify(){}},
        inputPressed(k){if(!this.pressed.has(k))return false;this.pressed.delete(k);return true;},
        focusPosition(){return this.player?this.player.vehicle?this.player.vehicle.position:this.player.position:this.world.spawn;},
        clearInput(){this.keys.clear();this.pressed.clear();this.mouse.fire=false;}
    };
    g.world=new M.World(g);
    g.player=new M.Player(g);
    g.vehicles=new M.Vehicles(g);g.npcs=new M.NPCs(g);g.police=new M.Police(g);g.combat=new M.Combat(g);
    g.camera.position.set(25,6,-50);
    g.scene.background=MG.srgb(0x9bbdcb);g.scene.fog=new THREE.FogExp2(MG.srgb(0x9bbdcb),.0022);
    g.scene.add(new THREE.HemisphereLight(MG.srgb(0xc6e8ff),MG.srgb(0xb79978),1));
    const sun=new THREE.DirectionalLight(MG.srgb(0xffddaa),1.3);sun.position.set(45,90,-30);g.scene.add(sun);
    g.renderer=new THREE.WebGLRenderer({antialias:true});g.renderer.setSize(1280,800);
    g.renderer.outputEncoding=THREE.sRGBEncoding;
    document.body.style.margin='0';document.body.appendChild(g.renderer.domElement);
    return g.world.init().then(() => {
        g.player.init();
        g.vehicles.init();g.npcs.init();g.police.init();g.combat.init();
        /* Elevated oblique overview over the spawn block. At street level the
         * camera sits inside a building, which hides roads, water and palette. */
        g.camera.position.set(g.world.spawn.x+150,95,g.world.spawn.z-190);
        g.camera.lookAt(g.world.spawn.x,0,g.world.spawn.z);
        return true;
    });
}
"""
