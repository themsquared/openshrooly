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


def find_idf_mbedtls():
    root = Path.home() / ".cache/esphome/idf/frameworks"
    if not root.is_dir():
        return None
    for p in sorted(root.glob("*/components/mbedtls/mbedtls"), reverse=True):
        if (p / "include/mbedtls/sha256.h").is_file() and (p / "library/sha256.c").is_file():
            return p
    return None


def compile_host(cxx, exe, idf):
    cmd = [
        cxx,
        "-std=c++17",
        "-O1",
        "-Wall",
        "-Werror",
        "-fsanitize=address,undefined",
        "-fno-omit-frame-pointer",
        "-I",
        str(COMP),
    ]
    if idf is not None:
        cmd.extend(
            [
                "-I",
                str(idf / "include"),
                "-I",
                str(REPO / "scripts"),
                '-DMBEDTLS_CONFIG_FILE="mbedtls_host_config.h"',
            ]
        )
    cmd.extend(
        [
            str(REPO / "scripts/shroom_labs_cloud_host_test.cpp"),
            str(COMP / "cloud_format.cpp"),
            str(COMP / "cloud_http.cpp"),
            str(COMP / "cloud_engine.cpp"),
            str(COMP / "cloud_qr.cpp"),
            "-lcrypto",
        ]
    )
    if idf is not None:
        cmd.append(str(idf / "library/sha256.c"))
        platform = idf / "library/platform_util.c"
        if platform.is_file():
            cmd.append(str(platform))
    else:
        cmd.extend(["-lmbedtls", "-lmbedcrypto"])
    cmd.extend(["-o", str(exe)])
    return subprocess.run(cmd, capture_output=True, text=True)


def main():
    tmp = Path(tempfile.mkdtemp())
    try:
        exe = tmp / "host_test"
        cxx = os.environ.get("CXX", "g++")
        idf = find_idf_mbedtls()
        r = compile_host(cxx, exe, idf)
        used_idf = r.returncode == 0 and idf is not None
        if r.returncode != 0 and idf is not None:
            sys.stderr.write("IDF mbedtls 3.x host build failed, using system mbedtls\n")
            r = compile_host(cxx, exe, None)
        if r.returncode != 0:
            sys.exit(f"host test compile failed\n{r.stdout}{r.stderr}")
        if used_idf:
            print(f"host SHA KAT linked mbedtls 3.x from {idf}")
        print(sh(str(exe)).stdout.strip())
        print("shroom_labs_cloud host tests passed")
    finally:
        import shutil

        shutil.rmtree(tmp)


if __name__ == "__main__":
    main()
