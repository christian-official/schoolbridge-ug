"""Offline-verifiable SchoolBridge installation activation licenses."""
import base64
import hashlib
import json
import os
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def _decode_b64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_activation_license(token: str) -> dict:
    encoded_key = os.getenv("SCHOOLBRIDGE_LICENSE_PUBLIC_KEY", "").strip()
    if not encoded_key:
        raise RuntimeError("SCHOOLBRIDGE_LICENSE_PUBLIC_KEY is not configured.")
    try:
        public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(encoded_key, validate=True))
        payload_part, signature_part = token.split(".", 1)
        payload_bytes = _decode_b64url(payload_part)
        signature = _decode_b64url(signature_part)
        public_key.verify(signature, payload_bytes)
        claims = json.loads(payload_bytes.decode("utf-8"))
    except (ValueError, TypeError, UnicodeDecodeError, InvalidSignature, json.JSONDecodeError):
        raise ValueError("Invalid activation license.")
    if not isinstance(claims, dict) or not claims.get("installation_id") or claims.get("product") != "SchoolBridge" or not claims.get("license_id") or not claims.get("issued_at"):
        raise ValueError("Invalid activation claims.")
    if claims.get("expires_at") is not None and int(claims["expires_at"]) < time.time():
        raise ValueError("Activation license has expired.")
    return claims


def license_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
