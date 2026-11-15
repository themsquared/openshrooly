#!/usr/bin/env python3
"""Host tests for the shared Shroom Labs local status JSON."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# OpenShrooly keeps the component under esphome/external_components.
# lykyn-firmware keeps it under external_components.
CANDIDATES = [
    REPO / "esphome/external_components/shroom_labs_local_api",
    REPO / "external_components/shroom_labs_local_api",
]


def component_dir() -> Path:
    for path in CANDIDATES:
        if (path / "status_json.cpp").is_file():
            return path
    sys.exit(f"could not find shroom_labs_local_api in {REPO}")


def main() -> None:
    comp = component_dir()
    tmp = Path(tempfile.mkdtemp())
    exe = tmp / "host_test"
    cxx = os.environ.get("CXX", "g++")
    cmd = [
        cxx,
        "-std=c++17",
        "-O1",
        "-Wall",
        "-Werror",
        "-fsanitize=address,undefined",
        "-fno-omit-frame-pointer",
        "-I",
        str(comp),
        str(REPO / "scripts/shroom_labs_local_api_host_test.cpp"),
        str(comp / "status_json.cpp"),
        "-o",
        str(exe),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"compile failed:\n{r.stdout}{r.stderr}")
    r = subprocess.run([str(exe)], capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    if r.returncode != 0:
        sys.exit(r.returncode)


if __name__ == "__main__":
    main()
