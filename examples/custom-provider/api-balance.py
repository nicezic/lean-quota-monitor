#!/usr/bin/env python3
import json
import os
import urllib.request

key = os.environ.get("CUSTOM_PROVIDER_KEY")
url = os.environ.get("CUSTOM_PROVIDER_URL")

if not key:
    raise SystemExit("CUSTOM_PROVIDER_KEY missing")
if not url:
    raise SystemExit("CUSTOM_PROVIDER_URL missing")

request = urllib.request.Request(
    url,
    headers={
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    },
)

with urllib.request.urlopen(request, timeout=15) as response:
    data = json.load(response)

balance = float(data["balance"])
print(f"${balance:.2f}")
