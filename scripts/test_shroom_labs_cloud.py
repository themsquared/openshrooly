#!/usr/bin/env python3
"""Host tests for cloud pairing: claim URL, QR payload, state machine, CSR PEM."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
COMP = REPO / "esphome/external_components/shroom_labs_cloud"


def sh(*cmd, ok=True, **kw):
    kw.setdefault("text", True)
    r = subprocess.run(cmd, capture_output=True, **kw)
    if ok and r.returncode != 0:
        sys.exit(f"command failed: {' '.join(map(str, cmd))}\n{r.stdout}{r.stderr}")
    return r


def main():
    tmp = Path(tempfile.mkdtemp())
    try:
        exe = tmp / "host_test"
        sh(
            os.environ.get("CXX", "g++"),
            "-std=c++17",
            "-O1",
            "-Wall",
            "-Werror",
            "-I",
            str(COMP),
            str(REPO / "scripts/shroom_labs_cloud_host_test.cpp"),
            str(COMP / "cloud_format.cpp"),
            str(COMP / "cloud_http.cpp"),
            str(COMP / "cloud_qr.cpp"),
            "-o",
            str(exe),
        )
        print(sh(str(exe)).stdout.strip())
        print("shroom_labs_cloud host tests passed")
    finally:
        import shutil

        shutil.rmtree(tmp)


if __name__ == "__main__":
    main()
