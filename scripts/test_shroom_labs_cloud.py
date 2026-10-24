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
        cxx = os.environ.get("CXX", "g++")
        sh(
            cxx,
            "-std=c++17",
            "-O1",
            "-Wall",
            "-Werror",
            "-fsanitize=address,undefined",
            "-fno-omit-frame-pointer",
            "-I",
            str(COMP),
            str(REPO / "scripts/shroom_labs_cloud_host_test.cpp"),
            str(COMP / "cloud_format.cpp"),
            str(COMP / "cloud_http.cpp"),
            str(COMP / "cloud_engine.cpp"),
            str(COMP / "cloud_qr.cpp"),
            "-lcrypto",
            "-lmbedtls",
            "-lmbedcrypto",
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
