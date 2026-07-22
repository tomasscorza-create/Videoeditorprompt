from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"
BENCHMARK = OUTPUT_DIR / "benchmark-process-results.json"
WAV_FILES = [
    OUTPUT_DIR / "piper-test.wav",
    OUTPUT_DIR / "piper-test-second.wav",
]


def run_capture(executable: str, args: list[str]) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [executable, *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        shell=False,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"{executable} failed with code {result.returncode}: {result.stderr}"
        )
    return result


def volume_metrics(wav_path: Path) -> dict[str, float | None]:
    result = run_capture(
        "ffmpeg",
        [
            "-hide_banner",
            "-i",
            str(wav_path),
            "-af",
            "volumedetect",
            "-f",
            "null",
            "NUL",
        ],
    )
    mean_match = re.search(r"mean_volume:\s+(-?[\d.]+) dB", result.stderr)
    max_match = re.search(r"max_volume:\s+(-?[\d.]+) dB", result.stderr)
    return {
        "mean_volume_db": float(mean_match.group(1)) if mean_match else None,
        "max_volume_db": float(max_match.group(1)) if max_match else None,
    }


def probe(wav_path: Path) -> dict[str, object]:
    result = run_capture(
        "ffprobe",
        [
            "-v",
            "error",
            "-show_entries",
            "format=filename,duration,size,bit_rate:stream=index,codec_name,codec_type,sample_fmt,sample_rate,channels,duration",
            "-of",
            "json",
            str(wav_path),
        ],
    )
    return json.loads(result.stdout)


def main() -> None:
    benchmark = json.loads(BENCHMARK.read_text(encoding="utf-8"))
    verified_runs: list[dict[str, object]] = []

    for benchmark_run, wav_path in zip(benchmark["runs"], WAV_FILES, strict=True):
        probe_result = probe(wav_path)
        audio_stream = probe_result["streams"][0]
        duration_seconds = float(probe_result["format"]["duration"])
        elapsed_seconds = float(benchmark_run["elapsed_seconds"])
        verified_runs.append(
            {
                "run": benchmark_run["run"],
                "wav": str(wav_path.relative_to(ROOT)),
                "elapsed_seconds": elapsed_seconds,
                "duration_seconds": duration_seconds,
                "real_time_factor": round(elapsed_seconds / duration_seconds, 6),
                "audio_seconds_generated_per_second": round(
                    duration_seconds / elapsed_seconds, 6
                ),
                "maximum_sampled_working_set_mb": benchmark_run[
                    "maximum_sampled_working_set_mb"
                ],
                "wav_size_bytes": wav_path.stat().st_size,
                "codec": audio_stream["codec_name"],
                "sample_format": audio_stream["sample_fmt"],
                "sample_rate": int(audio_stream["sample_rate"]),
                "channels": audio_stream["channels"],
                **volume_metrics(wav_path),
            }
        )

    report = {
        "phrase": benchmark["phrase"],
        "model": benchmark["model"],
        "piper_version": benchmark["piper_version"],
        "runs": verified_runs,
        "duration_difference_seconds": round(
            abs(
                float(verified_runs[0]["duration_seconds"])
                - float(verified_runs[1]["duration_seconds"])
            ),
            6,
        ),
        "size_difference_bytes": abs(
            int(verified_runs[0]["wav_size_bytes"])
            - int(verified_runs[1]["wav_size_bytes"])
        ),
        "waveforms_are_byte_identical": benchmark["waveforms_are_byte_identical"],
    }

    report_path = OUTPUT_DIR / "wav-verification.json"
    report_path.write_text(
        f"{json.dumps(report, ensure_ascii=False, indent=2)}\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
