with open("app.js", "r", encoding="utf-8") as f:
    text = f.read()

import re
matches = re.finditer(r"(function play|async function play|playTrack|loadTrack|fetchStream)", text, re.IGNORECASE)
for m in matches:
    start = max(0, m.start() - 100)
    end = min(len(text), m.end() + 200)
    print(f"--- MATCH ---")
    print(text[start:end])
