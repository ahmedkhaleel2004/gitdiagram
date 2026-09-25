# One frame at the end of every beat, tiled into a contact sheet per video.
import json, subprocess, sys, pathlib
out = pathlib.Path("experiments/video-models/out")
key = json.loads((out / "blind-key.json").read_text())
for repo, labels in key.items():
    owner, name = repo.split("/")
    for variant, label in labels.items():
        mp4 = out / "videos" / f"{owner}__{name}" / f"{label}.mp4"
        sheet = mp4.with_name(f"{label}-sheet.jpg")
        if not mp4.exists() or sheet.exists():
            continue
        art = json.loads((out / "runs" / variant / ".video-cache/video/v1" / owner / name / "artifact.json").read_text())
        beats = art["timing"]["beats"]
        times = [max(b["start"], b["end"] - 0.05) for b in beats]
        frames = []
        for i, t in enumerate(times):
            f = mp4.with_name(f".{label}-{i:02d}.jpg")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(mp4), "-frames:v", "1", "-vf", "scale=640:-1", str(f)], check=True)
            frames.append(f)
        cols = 4
        rows = (len(frames) + cols - 1) // cols
        inputs = sum([["-i", str(f)] for f in frames], [])
        layout = "|".join(f"{(i % cols) * 640}_{(i // cols) * 360}" for i in range(len(frames)))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex",
                        f"xstack=inputs={len(frames)}:layout={layout}:fill=black" if len(frames) > 1 else "null",
                        "-frames:v", "1", "-q:v", "3", str(sheet)], check=True)
        for f in frames: f.unlink()
        print("sheet", sheet)
