"""scripts/make-dashboard-cert.sh: the dashboard's certificate and its local CA."""

from __future__ import annotations

import shutil
import stat
import subprocess
from pathlib import Path

import pytest

from tests.helpers import PROJECT_ROOT

SCRIPT = PROJECT_ROOT / "scripts" / "make-dashboard-cert.sh"

pytestmark = pytest.mark.skipif(
    shutil.which("openssl") is None or shutil.which("sh") is None,
    reason="needs sh and openssl",
)


def make(certs: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["sh", str(SCRIPT), *args],
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "STRATA_CERTS_DIR": str(certs)},
        capture_output=True,
        text=True,
        timeout=60,
    )


def openssl(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["openssl", *args], capture_output=True, text=True, timeout=30)


def fingerprint(cert: Path) -> str:
    return openssl("x509", "-in", str(cert), "-noout", "-fingerprint", "-sha256").stdout


@pytest.fixture
def certs(tmp_path: Path) -> Path:
    folder = tmp_path / "certs"
    result = make(folder, "192.168.1.50", "strata.lan")
    assert result.returncode == 0, result.stderr
    return folder


def test_makes_a_certificate_the_ca_vouches_for(certs: Path) -> None:
    verified = openssl(
        "verify", "-CAfile", str(certs / "strata-local-ca.crt"), str(certs / "dashboard.crt")
    )
    assert verified.returncode == 0, verified.stdout + verified.stderr
    text = openssl("x509", "-in", str(certs / "dashboard.crt"), "-noout", "-text").stdout
    for name in (
        "DNS:localhost",
        "DNS:strata.lan",
        "IP Address:127.0.0.1",
        "IP Address:192.168.1.50",
    ):
        assert name in text
    assert "TLS Web Server Authentication" in text
    assert "CA:FALSE" in text


def test_keys_are_private_and_certificates_public(certs: Path) -> None:
    assert stat.S_IMODE(certs.stat().st_mode) == 0o700
    for key in ("dashboard.key", "strata-local-ca.key"):
        assert stat.S_IMODE((certs / key).stat().st_mode) == 0o600
    for cert in ("dashboard.crt", "strata-local-ca.crt"):
        assert stat.S_IMODE((certs / cert).stat().st_mode) == 0o644


def test_the_ca_cannot_vouch_for_other_websites(certs: Path, tmp_path: Path) -> None:
    # Even with the CA's key in hand, a certificate for a public name fails.
    ca_crt, ca_key = certs / "strata-local-ca.crt", certs / "strata-local-ca.key"
    key, csr, crt = tmp_path / "evil.key", tmp_path / "evil.csr", tmp_path / "evil.crt"
    config = tmp_path / "evil.cnf"
    config.write_text(
        "[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=bank.example.com\n"
        "[x]\nsubjectAltName=DNS:bank.example.com,IP:8.8.8.8\n"
    )
    assert (
        openssl(
            "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", str(key)
        ).returncode
        == 0
    )
    assert (
        openssl(
            "req", "-new", "-key", str(key), "-config", str(config), "-out", str(csr)
        ).returncode
        == 0
    )
    signed = openssl(
        "x509", "-req", "-in", str(csr), "-CA", str(ca_crt), "-CAkey", str(ca_key),
        "-set_serial", "7", "-days", "30", "-extfile", str(config), "-extensions", "x",
        "-out", str(crt),
    )  # fmt: skip
    assert signed.returncode == 0, signed.stderr
    verified = openssl("verify", "-CAfile", str(ca_crt), str(crt))
    assert verified.returncode != 0
    assert "permitted subtree violation" in verified.stdout + verified.stderr


def test_the_ca_is_limited_by_critical_name_constraints(certs: Path) -> None:
    text = openssl("x509", "-in", str(certs / "strata-local-ca.crt"), "-noout", "-text").stdout
    assert "X509v3 Name Constraints: critical" in text
    assert "CA:TRUE, pathlen:0" in text


@pytest.mark.parametrize(
    ("extra", "why"),
    [
        ("8.8.8.8", "not a private"),
        ("bank.example.com", "can be used"),
        ("--bogus", "unknown option"),
    ],
)
def test_refuses_public_addresses_and_names(certs: Path, extra: str, why: str) -> None:
    before = (certs / "dashboard.crt").read_bytes()
    result = make(certs, extra)
    assert result.returncode == 2
    assert why in result.stderr
    assert (certs / "dashboard.crt").read_bytes() == before  # nothing changed


def test_running_again_keeps_the_ca_and_renews_the_certificate(certs: Path) -> None:
    ca_before = fingerprint(certs / "strata-local-ca.crt")
    cert_before = fingerprint(certs / "dashboard.crt")
    assert make(certs).returncode == 0
    assert fingerprint(certs / "strata-local-ca.crt") == ca_before
    assert fingerprint(certs / "dashboard.crt") != cert_before
    assert make(certs, "--new-ca").returncode == 0
    assert fingerprint(certs / "strata-local-ca.crt") != ca_before
