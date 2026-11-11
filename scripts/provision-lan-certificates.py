#!/usr/bin/env python3
"""Provision a per-installation SchoolBridge LAN CA and IP-bound TLS server certificate."""
from __future__ import annotations

import argparse
import ipaddress
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

CA_KEY = "lan-root-ca-key.pem"
CA_CERT = "lan-root-ca.pem"
SERVER_KEY = "lan-server-key.pem"
SERVER_CERT = "lan-server-cert.pem"
CA_LIFETIME_DAYS = 1825
SERVER_LIFETIME_DAYS = 397
CA_RENEW_BEFORE_DAYS = 90
SERVER_RENEW_BEFORE_DAYS = 30


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _private_key_bytes(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )


def _load_key(path: Path) -> ec.EllipticCurvePrivateKey:
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey):
        raise ValueError(f"Unsupported key type in {path}; expected an EC private key.")
    return key


def _load_ca(directory: Path, now: datetime):
    key_path, cert_path = directory / CA_KEY, directory / CA_CERT
    if key_path.exists() != cert_path.exists():
        raise ValueError("LAN CA key/certificate pair is incomplete; restore both from a protected backup.")
    if key_path.exists():
        key = _load_key(key_path)
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        if key.public_key().public_numbers() != cert.public_key().public_numbers():
            raise ValueError("LAN CA private key does not match its certificate.")
        if cert.subject != cert.issuer:
            raise ValueError("Existing LAN root certificate is not self-issued.")
        key.public_key().verify(cert.signature, cert.tbs_certificate_bytes, ec.ECDSA(cert.signature_hash_algorithm))
        if cert.not_valid_after.replace(tzinfo=timezone.utc) <= now + timedelta(days=CA_RENEW_BEFORE_DAYS):
            raise ValueError("LAN root CA is expired or nearing expiry. Rotate it deliberately and reinstall the new public CA certificate on client devices.")
        constraints = cert.extensions.get_extension_for_class(x509.BasicConstraints).value
        if not constraints.ca or constraints.path_length != 0:
            raise ValueError("Existing LAN root certificate is not a constrained CA.")
        return key, cert

    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SchoolBridge"),
        x509.NameAttribute(NameOID.COMMON_NAME, "SchoolBridge Local Network Root CA"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=CA_LIFETIME_DAYS))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(x509.KeyUsage(
            digital_signature=True, content_commitment=False, key_encipherment=False,
            data_encipherment=False, key_agreement=False, key_cert_sign=True,
            crl_sign=True, encipher_only=False, decipher_only=False,
        ), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(key, hashes.SHA256())
    )
    _atomic_write(key_path, _private_key_bytes(key))
    _atomic_write(cert_path, cert.public_bytes(serialization.Encoding.PEM))
    return key, cert


def _server_certificate(directory: Path, bind_ip: ipaddress.IPv4Address, ca_key, ca_cert, now):
    key_path, cert_path = directory / SERVER_KEY, directory / SERVER_CERT
    key = _load_key(key_path) if key_path.exists() else None
    cert = x509.load_pem_x509_certificate(cert_path.read_bytes()) if cert_path.exists() else None
    if key_path.exists() != cert_path.exists():
        raise ValueError("LAN server key/certificate pair is incomplete; remove neither file automatically.")
    if key is not None and cert is not None:
        key_matches = key.public_key().public_numbers() == cert.public_key().public_numbers()
        try:
            san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
            has_ip = bind_ip in san.get_values_for_type(x509.IPAddress)
        except x509.ExtensionNotFound:
            has_ip = False
        valid_until = cert.not_valid_after.replace(tzinfo=timezone.utc)
        if key_matches and has_ip and cert.issuer == ca_cert.subject and valid_until > now + timedelta(days=SERVER_RENEW_BEFORE_DAYS):
            try:
                ca_key.public_key().verify(cert.signature, cert.tbs_certificate_bytes, ec.ECDSA(cert.signature_hash_algorithm))
            except Exception:
                pass
            else:
                return key, cert

    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SchoolBridge"),
        x509.NameAttribute(NameOID.COMMON_NAME, f"SchoolBridge LAN {bind_ip}"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=SERVER_LIFETIME_DAYS))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(
            digital_signature=True, content_commitment=False, key_encipherment=False,
            data_encipherment=False, key_agreement=True, key_cert_sign=False,
            crl_sign=False, encipher_only=False, decipher_only=False,
        ), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(bind_ip)]), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
        .sign(ca_key, hashes.SHA256())
    )
    _atomic_write(key_path, _private_key_bytes(key))
    _atomic_write(cert_path, cert.public_bytes(serialization.Encoding.PEM))
    return key, cert


def _update_env(path: Path, bind_ip: str, cert_path: Path, key_path: Path) -> None:
    updates = {
        "SCHOOLBRIDGE_LAN_BIND_IP": bind_ip,
        "SCHOOLBRIDGE_LAN_CERT_FILE": str(cert_path.resolve()),
        "SCHOOLBRIDGE_LAN_KEY_FILE": str(key_path.resolve()),
    }
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    output, written = [], set()
    for line in existing:
        key = line.split("=", 1)[0].strip() if "=" in line else ""
        if key in updates:
            if key not in written:
                output.append(f"{key}={updates[key]}")
                written.add(key)
        else:
            output.append(line)
    for key, value in updates.items():
        if key not in written:
            output.append(f"{key}={value}")
    _atomic_write(path, ("\n".join(output).rstrip() + "\n").encode("utf-8"))


def provision(bind_ip_text: str, secret_dir: Path, env_file: Path, public_ca_export: Path) -> dict[str, str]:
    try:
        bind_ip = ipaddress.ip_address(bind_ip_text)
    except ValueError as error:
        raise ValueError("Bind address must be a valid private IPv4 address.") from error
    private_networks = (
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.168.0.0/16"),
    )
    if not isinstance(bind_ip, ipaddress.IPv4Address) or not any(bind_ip in network for network in private_networks):
        raise ValueError("Bind address must be a private school-network IPv4 address (10/8, 172.16/12, or 192.168/16).")

    secret_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    ca_key, ca_cert = _load_ca(secret_dir, now)
    _server_certificate(secret_dir, bind_ip, ca_key, ca_cert, now)
    ca_export = public_ca_export.resolve()
    _atomic_write(ca_export, ca_cert.public_bytes(serialization.Encoding.PEM))
    cert_path, key_path = secret_dir / SERVER_CERT, secret_dir / SERVER_KEY
    _update_env(env_file, str(bind_ip), cert_path, key_path)
    return {
        "server_certificate": str(cert_path.resolve()),
        "server_private_key": str(key_path.resolve()),
        "public_root_certificate": str(ca_export),
        "bind_ip": str(bind_ip),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind-ip", required=True)
    parser.add_argument("--secret-dir", required=True, type=Path)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--export-ca", required=True, type=Path)
    args = parser.parse_args()
    result = provision(args.bind_ip, args.secret_dir, args.env_file, args.export_ca)
    for name, value in result.items():
        print(f"{name}={value}")
    print("LAN remains disabled; explicitly set SCHOOLBRIDGE_LAN_ENABLED=true only after client trust is installed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
