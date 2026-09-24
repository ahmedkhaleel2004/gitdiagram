#!/usr/bin/env python3
"""Tile snapshot PNGs into 2x2 contact sheets (960x540 cells) with timestamps burned in.
usage: sheets.py <snapshots-dir>"""
import glob, os, subprocess, sys
d = sys.argv[1]
frames = sorted(glob.glob(os.path.join(d, "frame-*.png")))
for k in range(0, len(frames), 4):
    group = frames[k:k + 4]
    while len(group) < 4:
        group.append(group[-1])
    args = ["ffmpeg", "-v", "error", "-y"]
    for f in group:
        args += ["-i", f]
    fc = []
    for i, f in enumerate(group):
        t = f.split("-at-")[1].replace(".png", "")
        fc.append(f"[{i}]scale=960:540[v{i}]")
    fc.append("[v0][v1]hstack[t];[v2][v3]hstack[u];[t][u]vstack[out]")
    out = os.path.join(d, f"sheet-{k // 4}.jpg")
    subprocess.run(args + ["-filter_complex", ";".join(fc), "-map", "[out]", "-q:v", "3", out], check=True)
    print(out)
