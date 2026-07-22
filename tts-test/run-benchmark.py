from __future__ import annotations

import ctypes
from ctypes import wintypes
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "models" / "es_AR-daniela-high.onnx"
OUTPUT_DIR = ROOT / "output"
PHRASE = (
    "Esta es una prueba de voz generada localmente para nuestro sistema de animación."
)


class ProcessMemoryCountersEx(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


get_process_memory_info = ctypes.windll.psapi.GetProcessMemoryInfo
get_process_memory_info.argtypes = [
    wintypes.HANDLE,
    ctypes.POINTER(ProcessMemoryCountersEx),
    wintypes.DWORD,
]
get_process_memory_info.restype = wintypes.BOOL

TH32CS_SNAPPROCESS = 0x00000002
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value


class ProcessEntry32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    ]


create_snapshot = ctypes.windll.kernel32.CreateToolhelp32Snapshot
create_snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
create_snapshot.restype = wintypes.HANDLE
process_first = ctypes.windll.kernel32.Process32FirstW
process_first.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry32W)]
process_first.restype = wintypes.BOOL
process_next = ctypes.windll.kernel32.Process32NextW
process_next.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry32W)]
process_next.restype = wintypes.BOOL
open_process = ctypes.windll.kernel32.OpenProcess
open_process.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
open_process.restype = wintypes.HANDLE
close_handle = ctypes.windll.kernel32.CloseHandle
close_handle.argtypes = [wintypes.HANDLE]
close_handle.restype = wintypes.BOOL


def process_tree(root_pid: int) -> set[int]:
    snapshot = create_snapshot(TH32CS_SNAPPROCESS, 0)
    if snapshot == INVALID_HANDLE_VALUE:
        return {root_pid}

    parents: dict[int, int] = {}
    entry = ProcessEntry32W()
    entry.dwSize = ctypes.sizeof(entry)

    try:
        if process_first(snapshot, ctypes.byref(entry)):
            while True:
                parents[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
                if not process_next(snapshot, ctypes.byref(entry)):
                    break
    finally:
        close_handle(snapshot)

    tree = {root_pid}
    changed = True
    while changed:
        changed = False
        for process_id, parent_id in parents.items():
            if parent_id in tree and process_id not in tree:
                tree.add(process_id)
                changed = True

    return tree


def process_memory(process_id: int) -> tuple[int, int]:
    handle = open_process(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, process_id)
    if not handle:
        return 0, 0

    counters = ProcessMemoryCountersEx()
    counters.cb = ctypes.sizeof(counters)
    try:
        success = get_process_memory_info(
            handle,
            ctypes.byref(counters),
            counters.cb,
        )
        if not success:
            return 0, 0
        return counters.WorkingSetSize, counters.PeakWorkingSetSize
    finally:
        close_handle(handle)


def tree_memory_snapshot(root_pid: int) -> tuple[int, int, int]:
    process_ids = process_tree(root_pid)
    total_working_set = 0
    total_peak_working_set = 0
    measured_processes = 0

    for process_id in process_ids:
        working_set, peak_working_set = process_memory(process_id)
        if working_set or peak_working_set:
            measured_processes += 1
        total_working_set += working_set
        total_peak_working_set += peak_working_set

    return total_working_set, total_peak_working_set, measured_processes


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as input_file:
        for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_generation(run_number: int, output_path: Path) -> dict[str, object]:
    args = [
        sys.executable,
        "-m",
        "piper",
        "-m",
        str(MODEL),
        "-f",
        str(output_path),
        "--length-scale",
        "1.55",
        "--",
        PHRASE,
    ]

    started_at = time.perf_counter()
    process = subprocess.Popen(
        args,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        shell=False,
    )

    maximum_working_set = 0
    reported_peak_working_set = 0
    maximum_measured_processes = 0
    samples = 0

    while process.poll() is None:
        working_set, peak_working_set, measured_processes = tree_memory_snapshot(
            process.pid
        )
        maximum_working_set = max(maximum_working_set, working_set)
        reported_peak_working_set = max(reported_peak_working_set, peak_working_set)
        maximum_measured_processes = max(maximum_measured_processes, measured_processes)
        samples += 1
        time.sleep(0.01)

    stdout, stderr = process.communicate()
    elapsed_seconds = time.perf_counter() - started_at

    (OUTPUT_DIR / f"piper-run-{run_number}.stdout.txt").write_text(
        stdout, encoding="utf-8"
    )
    (OUTPUT_DIR / f"piper-run-{run_number}.stderr.txt").write_text(
        stderr, encoding="utf-8"
    )

    if process.returncode != 0:
        raise RuntimeError(
            f"Piper run {run_number} failed with code {process.returncode}: {stderr}"
        )

    return {
        "run": run_number,
        "command": args,
        "elapsed_seconds": round(elapsed_seconds, 6),
        "maximum_sampled_working_set_mb": round(
            maximum_working_set / (1024 * 1024), 3
        ),
        "process_reported_peak_working_set_mb": round(
            reported_peak_working_set / (1024 * 1024), 3
        ),
        "memory_samples": samples,
        "maximum_measured_processes": maximum_measured_processes,
        "output": str(output_path.relative_to(ROOT)),
        "wav_size_bytes": output_path.stat().st_size,
        "wav_sha256": sha256(output_path),
        "return_code": process.returncode,
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (ROOT / "phrase.txt").write_text(f"{PHRASE}\n", encoding="utf-8")

    outputs = [
        OUTPUT_DIR / "piper-test.wav",
        OUTPUT_DIR / "piper-test-second.wav",
    ]

    results = [
        run_generation(run_number, output_path)
        for run_number, output_path in enumerate(outputs, start=1)
    ]

    report = {
        "piper_version": importlib.metadata.version("piper-tts"),
        "python_version": sys.version,
        "python_executable": sys.executable,
        "model": MODEL.name,
        "model_size_bytes": MODEL.stat().st_size,
        "phrase": PHRASE,
        "runs": results,
        "waveforms_are_byte_identical": (
            results[0]["wav_sha256"] == results[1]["wav_sha256"]
        ),
    }

    report_path = OUTPUT_DIR / "benchmark-process-results.json"
    report_path.write_text(
        f"{json.dumps(report, ensure_ascii=False, indent=2)}\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
