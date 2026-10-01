"""Capture a real OpenStreetMap payload for Marikina to use as a test fixture.

Run once; it writes osm_full.json into the repository root, which the smoke
tests then serve in place of a live Overpass call.

    python marikina-gta/tests/capture_osm.py
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "osm_full.json"

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

BBOX = (14.6200, 121.0800, 14.6700, 121.1200)

QUERY = (
    '[out:json][timeout:600];('
    'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|'
    'living_street|service|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|'
    'tertiary_link)$"]["area"!~"yes"](%s,%s,%s,%s);'
    'way["building"]["building"!~"^(roof|carport|garage|shed|toilets|canopy)$"](%s,%s,%s,%s);'
    'way["waterway"~"^(river|stream|canal)$"](%s,%s,%s,%s);'
    'way["natural"="water"](%s,%s,%s,%s);'
    'relation["natural"="water"](%s,%s,%s,%s);'
    ');out geom;'
) % (BBOX * 5)


def main():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    failure = None
    for mirror in MIRRORS:
        host = mirror.split("/")[2]
        started = time.time()
        try:
            request = urllib.request.Request(
                mirror, data=body, headers={"User-Agent": "marikina-fixture/1.0"})
            payload = urllib.request.urlopen(request, timeout=900).read()
            data = json.loads(payload)
            if not data.get("elements"):
                raise ValueError("no elements returned")
            OUT.write_bytes(payload)
            print("%s OK %d elements, %.1f MB in %.1fs -> %s" % (
                host, len(data["elements"]), len(payload) / 1048576,
                time.time() - started, OUT))
            return
        except Exception as error:  # noqa: BLE001 - try the next mirror
            failure = error
            print("%s failed: %s" % (host, error))
    raise SystemExit("all mirrors failed: %s" % failure)


if __name__ == "__main__":
    main()
