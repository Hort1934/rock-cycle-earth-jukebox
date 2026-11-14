"""Download NASA SVS / Earth Information Center visualizations and make web-sized clips.

Usage:
    python tools/build_media.py            # all tracks
    python tools/build_media.py lightning  # only some tracks

Needs ffmpeg on PATH, in the FFMPEG env var, or via `pip install imageio-ffmpeg`.
Raw downloads are cached in .cache/ (git-ignored); outputs go to media/.
"""

import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
MEDIA = ROOT / "media"
SVS = "https://svs.gsfc.nasa.gov/vis/a000000"

# id, SVS page id, source path, output width, output height, start s, max output duration s, speed-up
# (speed-up > 1 makes a time-lapse so long hyperwall pieces fit in about a minute)
TRACKS = [
    ("sea-surface", 3912, "a003900/a003912/ecco2_sst_flow.webmhd.webm", 960, 540, 0, 67, 1),
    ("ocean-currents", 5505, "a005500/a005505/fast_global_small.mp4", 960, 480, 0, 60, 1),
    ("night-lights", 5313, "a005300/a005313/nightlights_flat_series_and_change_wZooms_13_EIC_2160p30_h265.mp4", 1280, 360, 0, 90, 1),
    ("aerosols", 4582, "a004500/a004582/gmao_aerosols.webm", 960, 480, 0, 60, 1),
    ("air-quality", 5533, "a005500/a005533/EIC_AirQuality_Preview_3840x1080.mp4", 1280, 360, 0, 76, 1),
    ("carbon-dioxide", 5196, "a005100/a005196/dyamondPointCloud_12-1-2023b_dyamond_co2_anim_globe_orbit_1080p30_h265.mp4", 960, 540, 0, 60, 1),
    ("lightning", 5011, "a005000/a005011/iss_lightning_sphere_07312023.mp4", 960, 540, 0, 60, 3.6),
    ("atmospheric-river", 4960, "a004900/a004960/atmos_river_HD.webm", 960, 540, 0, 60, 4.86),
    ("forest-height", 4950, "a004900/a004950/GEDI_global_w_colorbar_1080p60.webm", 960, 540, 0, 60, 1),
    ("temperature", 5207, "a005200/a005207/2023GISTEMP_Map_HD.mp4", 960, 540, 0, 90, 1),
]


def ffmpeg_exe() -> str:
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit("ffmpeg not found: install it or run `pip install imageio-ffmpeg`")


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"  downloading {url}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "earth-jukebox-media-builder"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
        shutil.copyfileobj(resp, out, length=1 << 20)
    tmp.replace(dest)


def probe_duration(ff: str, path: Path) -> float:
    out = subprocess.run([ff, "-i", str(path)], capture_output=True, text=True).stderr
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            h, m, s = line.split(",")[0].split()[1].split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return 0.0


def build(ff: str, track: tuple) -> dict:
    tid, svs_id, src, width, height, start, max_dur, speed = track
    url = f"{SVS}/{src}"
    raw = CACHE / f"{tid}{Path(src).suffix}"
    download(url, raw)

    clip = MEDIA / f"{tid}.mp4"
    poster = MEDIA / f"{tid}.jpg"
    scale = f"setpts=PTS/{speed},scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps=24"
    print(f"  encoding {clip.name}", flush=True)
    subprocess.run(
        [ff, "-y", "-loglevel", "error", "-ss", str(start), "-t", str(max_dur * speed), "-i", str(raw),
         "-vf", scale, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "30",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(clip)],
        check=True,
    )
    duration = probe_duration(ff, clip)
    subprocess.run(
        [ff, "-y", "-loglevel", "error", "-ss", f"{duration * 0.45:.2f}", "-i", str(clip),
         "-frames:v", "1", "-q:v", "4", str(poster)],
        check=True,
    )
    return {
        "id": tid,
        "svs": svs_id,
        "source": url,
        "video": f"media/{clip.name}",
        "poster": f"media/{poster.name}",
        "width": width,
        "height": height,
        "duration": round(duration, 2),
        "speed": speed,
        "bytes": clip.stat().st_size,
    }


def main() -> None:
    wanted = set(sys.argv[1:])
    CACHE.mkdir(exist_ok=True)
    MEDIA.mkdir(exist_ok=True)
    ff = ffmpeg_exe()
    manifest_path = MEDIA / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for track in TRACKS:
        if wanted and track[0] not in wanted:
            continue
        print(f"[{track[0]}]", flush=True)
        manifest[track[0]] = build(ff, track)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(t["bytes"] for t in manifest.values()) / 1e6
    print(f"done: {len(manifest)} clips, {total:.1f} MB in media/")


if __name__ == "__main__":
    main()
