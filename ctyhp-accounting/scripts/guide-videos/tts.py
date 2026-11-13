"""The guide videos' voice (3.0.28): Piper's "Ryan", one clip per line of narration.json.

    python scripts/guide-videos/tts.py <work-dir>

Needs piper-tts 1.3 (pip install piper-tts==1.3.0), the voice en_US-ryan-high
(python -m piper.download_voices en_US-ryan-high), and an ffmpeg:
    PIPER_VOICE=<path to en_US-ryan-high.onnx>   FFMPEG=<path to ffmpeg>

One voice reads every guide, offline: nothing is sent anywhere. Each line is
spoken on its own, so a caption changes exactly when the voice does, and is
cached by a hash of its words and settings, so changing one line re-speaks only
that one. Silence is trimmed from both ends; the lengths the recorder holds each
beat for are written to <work-dir>/durations.json. The clips stay in the work
dir, out of the repo.
"""

import hashlib
import json
import os
import subprocess
import sys
import wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

HERE = Path(__file__).parent
# A touch slower than Piper's default: the viewer follows the screen while listening.
SETTINGS = {"length_scale": 1.06, "noise_scale": 0.6, "noise_w_scale": 0.75}


def trim(ffmpeg: str, src: Path, dst: Path) -> None:
    """Trim silence at both ends, keep a short tail; 48 kHz mono 16-bit."""
    chain = (
        "silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02,"
        "areverse,"
        "silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.12,"
        "areverse,"
        "aresample=48000,aformat=channel_layouts=mono"
    )
    subprocess.run([ffmpeg, "-y", "-v", "error", "-i", str(src), "-af", chain,
                    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "1", str(dst)], check=True)


def seconds(path: Path) -> float:
    with wave.open(str(path)) as f:
        return f.getnframes() / f.getframerate()


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: tts.py <work-dir>")
    work = Path(sys.argv[1])
    onnx = os.environ.get("PIPER_VOICE")
    ffmpeg = os.environ.get("FFMPEG")
    if not onnx or not ffmpeg:
        raise SystemExit("Set PIPER_VOICE (en_US-ryan-high.onnx) and FFMPEG")
    raw_dir = work / "voice-raw"
    out_dir = work / "voice"
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    script = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))
    voice = PiperVoice.load(onnx)
    config = SynthesisConfig(**SETTINGS)
    durations: dict[str, list[float]] = {}
    for guide, body in script["guides"].items():
        total = 0.0
        for beat in body["beats"]:
            durations[beat["id"]] = []
            for n, line in enumerate(beat["lines"]):
                key = hashlib.md5(json.dumps([line["say"], SETTINGS], sort_keys=True).encode("utf-8")).hexdigest()[:12]
                raw = raw_dir / f"{key}.wav"
                if not raw.exists():
                    with wave.open(str(raw), "wb") as wf:
                        voice.synthesize_wav(line["say"], wf, syn_config=config)
                dst = out_dir / f"{beat['id']}-{n}.wav"
                trim(ffmpeg, raw, dst)
                d = round(seconds(dst), 3)
                durations[beat["id"]].append(d)
                total += d
        print(f"  {guide}: {total:.1f}s spoken over {sum(len(b['lines']) for b in body['beats'])} lines")
    (work / "durations.json").write_text(json.dumps(durations, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
