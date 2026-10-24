#!/usr/bin/env python3
"""Tests for the signed update trust path, runnable on any Linux or macOS host.

1. Builds update_logic.cpp + Monocypher natively and runs the unit tests
   (versions, URL allow-list, base64, RFC 8032 vector).
2. Signs a fake release with scripts/sign_release.mjs using a throwaway key and
   checks the device code accepts it and refuses every tampered field, a wrong
   key, a key stored inside the repo, and a key that does not match the device.
3. Checks the .signed.bin file for installing from the chamber page: the device
   code accepts it and refuses unsigned, tampered, wrong-key and USB-signed files.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
COMP = REPO / "esphome/external_components/signed_update"
HOST_VENDOR = REPO / "scripts/host_vendor"


def sh(*cmd, ok=True, **kw):
    kw.setdefault("text", True)
    r = subprocess.run(cmd, capture_output=True, **kw)
    if ok and r.returncode != 0:
        sys.exit(f"command failed: {' '.join(map(str, cmd))}\n{r.stdout}{r.stderr}")
    return r


def keypair(tmp, name):
    key = tmp / f"{name}.pem"
    sh("openssl", "genpkey", "-algorithm", "ed25519", "-out", str(key))
    der = sh("openssl", "pkey", "-in", str(key), "-pubout", "-outform", "DER", text=False).stdout
    return key, der[-32:].hex()


def main():
    tmp = Path(tempfile.mkdtemp())
    try:
        exe = tmp / "host_test"
        sh(os.environ.get("CC", "cc"), "-O1", "-c", str(COMP / "monocypher.c"), "-o", str(tmp / "m.o"))
        sh(os.environ.get("CC", "cc"), "-O1", "-I", str(COMP), "-c", str(HOST_VENDOR / "monocypher-ed25519.c"), "-o", str(tmp / "me.o"))
        sh(os.environ.get("CXX", "c++"), "-std=c++17", "-O1", "-Wall", "-Werror", "-I", str(COMP), "-I", str(HOST_VENDOR), str(REPO / "scripts/signed_update_host_test.cpp"),
           str(COMP / "update_logic.cpp"), str(tmp / "m.o"), str(tmp / "me.o"), "-o", str(exe))
        print(sh(str(exe)).stdout.strip())

        key, pub = keypair(tmp, "release")
        wrong_key, wrong_pub = keypair(tmp, "wrong")
        (tmp / "ota.bin").write_bytes(os.urandom(4096))
        (tmp / "factory.bin").write_bytes(os.urandom(8192))
        out = tmp / "out"

        def sign(k, expect, extra_env=None):
            js = (
                "import { signRelease } from %s;"
                "signRelease({key:%s,version:'1.0.3-sl.1',ota:%s,factory:%s,out:%s,channel:'stable',expectPublic:%s});"
            ) % tuple(json.dumps(str(x)) for x in (REPO / "scripts/sign_release.mjs", k, tmp / "ota.bin", tmp / "factory.bin", out, expect))
            return sh("node", "--input-type=module", "-e", js, ok=False)

        r = sign(key, pub)
        assert r.returncode == 0, r.stderr
        m = json.loads((out / "manifest.json").read_text())

        def accepted(entry, pubhex):
            msg = tmp / "msg.txt"
            msg.write_text(
                "openshrooly-release-v1\n"
                f"product={entry['product']}\nchannel={entry['channel']}\nversion={entry['version']}\n"
                f"size={entry['size']}\nsha256={entry['sha256']}\nurl={entry['url']}\n"
            )
            return sh(str(exe), pubhex, str(msg), entry["signature"], ok=False).returncode == 0

        assert accepted(m, pub), "good OTA entry refused"
        assert accepted(m["usb"], pub), "good USB entry refused"
        assert m["url"] == "https://shroomlabs.io/firmware/stable/openshrooly-1.0.3-sl.1.ota.bin"
        assert m["product"] == "openshrooly" and m["usb"]["product"] == "openshrooly-usb"
        for field, value in [("version", "1.0.4"), ("size", m["size"] + 1), ("sha256", "0" * 64),
                             ("url", m["url"].replace("ota.bin", "x.bin")), ("channel", "beta"),
                             ("product", "openshrooly-usb")]:
            assert not accepted({**m, field: value}, pub), f"tampered {field} accepted"
        assert not accepted(m, wrong_pub), "wrong public key accepted"
        import base64
        raw = base64.b64decode(m["signature"])
        L = 2**252 + 27742317777372353535851937790883648493
        s_plus_l = int.from_bytes(raw[32:], "little") + L
        assert s_plus_l < 2**256
        malleable = base64.b64encode(raw[:32] + s_plus_l.to_bytes(32, "little")).decode()
        assert not accepted({**m, "signature": malleable}, pub), "non-canonical S accepted"
        flipped = base64.b64encode(bytes([raw[0] ^ 1]) + raw[1:]).decode()
        assert not accepted({**m, "signature": flipped}, pub), "flipped R accepted"
        assert not accepted({**m, "signature": m["signature"][:-4]}, pub), "short signature accepted"
        # USB signature can never pass as an OTA release.
        assert not accepted({**m["usb"], "product": "openshrooly"}, pub)

        # File for "Install from file" on the chamber page: image + signature block.
        import hashlib
        signed = out / "openshrooly-1.0.3-sl.1.signed.bin"
        data = signed.read_bytes()
        image = (tmp / "ota.bin").read_bytes()
        assert data[:-512] == image and data[-8:] == b"OSSIGNv1", "signed.bin layout"

        def lan_ok(blob, pubhex):
            f = tmp / "lan.bin"
            f.write_bytes(blob)
            sha = hashlib.sha256(blob[:-512]).hexdigest()
            return sh(str(exe), "lan", pubhex, str(f), sha, ok=False).returncode == 0

        assert lan_ok(data, pub), "good signed file refused"
        assert not lan_ok(data, wrong_pub), "signed file accepted with the wrong key"
        assert not lan_ok(image, pub), "unsigned image accepted"
        assert not lan_ok(image + bytes(512), pub), "blank signature block accepted"
        tampered = bytearray(data)
        tampered[100] ^= 1
        assert not lan_ok(bytes(tampered), pub), "changed image accepted"
        assert not lan_ok(data.replace(b"version=1.0.3-sl.1", b"version=1.0.3-sl.9"), pub), "changed version accepted"
        assert not lan_ok(data.replace(b"channel=stable", b"channel=stabl1"), pub), "changed channel accepted"
        usb_block = data[-512:].replace(m["signature"].encode(), m["usb"]["signature"].encode())
        assert not lan_ok(image + usb_block, pub), "USB signature accepted for a file install"

        r = sign(wrong_key, pub)
        assert r.returncode != 0 and "does not match" in r.stderr, "mismatched key was used"
        inside = REPO / "esphome" / ".signing-test-key.pem"
        shutil.copy(key, inside)
        try:
            r = sign(inside, pub)
            assert r.returncode != 0 and "inside the repository" in r.stderr, "in-repo key was used"
        finally:
            inside.unlink()
        print("sign_release end-to-end tests passed")
    finally:
        shutil.rmtree(tmp)


if __name__ == "__main__":
    main()
