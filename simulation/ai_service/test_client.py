#!/usr/bin/env python3
"""
Test client for Edge-AI Inference Service.
"""
import urllib.request
import json
import time

def test_ai_service():
    url = "http://127.0.0.1:8000/predict"
    payload = {
        "timestamp": 15.2,
        "mode": 1,
        "target_waypoint": [1200.0, 1850.0, -850.0],
        "sensors": {
            "gnss": {
                "position": [250.0, 950.0, -180.0],
                "altitude": 950.0,
                "ground_speed": 10.2,
                "track_deg": 45.0
            },
            "barometer": {
                "pressure_pa": 90500.0,
                "altitude_m": 948.5
            },
            "wind_estimator": {
                "estimated_speed": 9.8,
                "estimated_bearing_deg": 45.0
            },
            "battery": {
                "percent": 96.5,
                "voltage_v": 16.1
            }
        }
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=1.0) as resp:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        data = json.loads(resp.read().decode("utf-8"))
        print(f"✅ AI Inference Response ({elapsed_ms:.1f} ms):")
        print(json.dumps(data, indent=2))

if __name__ == "__main__":
    test_ai_service()
