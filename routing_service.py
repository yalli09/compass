"""Route calculation behind a small provider-neutral interface.

The default provider is the public OSRM service for driving routes. Set
ROUTING_ENGINE_URL to a compatible OSRM endpoint before deploying at scale.
"""

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


SUPPORTED_MODES = {"driving"}
DEFAULT_ENGINE_URL = "https://router.project-osrm.org"


class RoutingError(Exception):
    """An expected route calculation failure."""


def _coordinate(value, name):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise RoutingError(f"Invalid {name}") from exc
    is_latitude = "latitude" in name
    if not (-90 <= number <= 90 if is_latitude else -180 <= number <= 180):
        raise RoutingError(f"Invalid {name}")
    return number


def _validate_point(point, name):
    if not isinstance(point, dict):
        raise RoutingError(f"Missing {name} point")
    return (
        _coordinate(point.get("lat"), f"{name} latitude"),
        _coordinate(point.get("lng"), f"{name} longitude"),
    )


def calculate_route(start, end, mode="driving"):
    """Return a normalized route response for two coordinate points."""
    mode = str(mode or "driving").lower()
    if mode not in SUPPORTED_MODES:
        raise RoutingError(f"Routing mode '{mode}' is not available yet")

    start_lat, start_lng = _validate_point(start, "start")
    end_lat, end_lng = _validate_point(end, "end")
    if start_lat == end_lat and start_lng == end_lng:
        raise RoutingError("Start and destination must be different")

    base_url = os.environ.get("ROUTING_ENGINE_URL", DEFAULT_ENGINE_URL).rstrip("/")
    coordinates = f"{start_lng},{start_lat};{end_lng},{end_lat}"
    query = urlencode({
        "overview": "full",
        "geometries": "geojson",
        "steps": "true",
        "alternatives": "true",
    })
    url = f"{base_url}/route/v1/driving/{coordinates}?{query}"

    request = Request(url, headers={"User-Agent": "Compass/1.0 route planner"})
    try:
        with urlopen(request, timeout=20) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RoutingError("The routing service could not be reached") from exc

    if payload.get("code") != "Ok" or not payload.get("routes"):
        raise RoutingError("No drivable route was found")

    routes = []
    for route in payload["routes"]:
        geometry = route.get("geometry", {}).get("coordinates", [])
        path = [[lat, lng] for lng, lat in geometry]
        if not path:
            continue
        steps = []
        for leg in route.get("legs", []):
            for step in leg.get("steps", []):
                maneuver = step.get("maneuver", {})
                instruction = step.get("name") or maneuver.get("type", "Continue").replace("_", " ").title()
                steps.append({
                    "instruction": instruction,
                    "distance": step.get("distance", 0),
                    "duration": step.get("duration", 0),
                })
        routes.append({
            "path": path,
            "distance": route.get("distance", 0),
            "duration": route.get("duration", 0),
            "steps": steps,
        })

    if not routes:
        raise RoutingError("The routing service returned no usable geometry")
    return {"mode": mode, "routes": routes}
