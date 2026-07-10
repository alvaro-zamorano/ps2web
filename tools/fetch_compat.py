#!/usr/bin/env python3
"""Descarga la lista state-playable del tracker jpd002/Play-Compatibility → bench/compat.json.

Uso: python3 tools/fetch_compat.py [--label state-playable] [--out bench/compat.json]
Sin token: ~60 req/h de límite (14 páginas → OK). Con GITHUB_TOKEN en env: sin problema.
"""
import json, os, re, sys, time, urllib.request

LABEL = "state-playable"
OUT = "bench/compat.json"
REPO = "jpd002/Play-Compatibility"

args = sys.argv[1:]
if "--label" in args: LABEL = args[args.index("--label") + 1]
if "--out" in args: OUT = args[args.index("--out") + 1]

REGION = {"SLUS": "NTSC-U", "SCUS": "NTSC-U", "SLES": "PAL", "SCES": "PAL",
          "SLPM": "NTSC-J", "SLPS": "NTSC-J", "SCPS": "NTSC-J", "SCAJ": "NTSC-J",
          "SLKA": "NTSC-K", "SLAJ": "NTSC-J", "PBPX": "NTSC-J"}

def fetch(url):
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "ps2web-compat-fetch",
        **({"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"} if os.environ.get("GITHUB_TOKEN") else {})
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

games, seen = [], set()
def harvest(direction):
    page = 1
    while page <= 10:  # GitHub limita paginación anónima a 1000 resultados por dirección
        url = (f"https://api.github.com/repos/{REPO}/issues?labels={LABEL}&state=all"
               f"&sort=created&direction={direction}&per_page=100&page={page}")
        try:
            batch = fetch(url)
        except urllib.error.HTTPError as e:
            if e.code == 422: break
            raise
        if not batch: break
        add(batch)
        sys.stderr.write(f"{direction} page {page}: total {len(games)}\n")
        page += 1
        time.sleep(0.5)

def add(batch):
    for i in batch:
        if i["number"] in seen: continue
        seen.add(i["number"])
        m = re.match(r"\[([A-Z]{4}[- ]?\d{5})\]\s*(.+)", i["title"])
        serial = m.group(1).replace(" ", "-") if m else None
        title = m.group(2).strip() if m else i["title"].strip()
        games.append({
            "serial": serial,
            "title": title,
            "region": REGION.get(serial[:4], "?") if serial else "?",
            "labels": sorted(l["name"] for l in i["labels"] if l["name"] != LABEL),
            "issue": i["number"],
            "url": i["html_url"],
        })

harvest("asc")
harvest("desc")
games.sort(key=lambda g: g["title"].lower())
out = {"source": f"https://github.com/{REPO}", "label": LABEL,
       "fetched": time.strftime("%Y-%m-%d"), "count": len(games), "games": games}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(f"{len(games)} juegos → {OUT}")
