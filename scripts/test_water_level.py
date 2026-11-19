#!/usr/bin/env python3
"""Host tests for the tank water state machine and the water telemetry fields."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
COMP = REPO / "esphome/external_components/shroom_labs_cloud"


def main():
    with tempfile.TemporaryDirectory() as tmp:
        exe = Path(tmp) / "water_test"
        cxx = os.environ.get("CXX", "g++")
        cmd = [
            cxx, "-std=c++17", "-O1", "-Wall", "-Werror", "-fsanitize=address,undefined",
            "-I", str(COMP),
            str(REPO / "scripts/water_level_host_test.cpp"),
            str(COMP / "cloud_format.cpp"),
            "-o", str(exe),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"water host test compile failed\n{r.stdout}{r.stderr}")
        r = subprocess.run([str(exe)], capture_output=True, text=True)
        sys.stdout.write(r.stdout)
        if r.returncode != 0:
            sys.exit(f"water host test failed\n{r.stderr}")


if __name__ == "__main__":
    main()
