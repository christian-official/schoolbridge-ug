"""Offline-verifiable SchoolBridge installation activation licenses."""
import base64
import hashlib
import json
import os
import secrets
import string
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
        format_prefix, signed_part = token.split(":", 1)
        if format_prefix != "CHRISTIAN":
            raise ValueError("Invalid activation license format.")
        payload_part, signature_part = signed_part.split(".", 1)
        payload_bytes = _decode_b64url(payload_part)
        signature = _decode_b64url(signature_part)
        public_key.verify(signature, payload_bytes)
        claims = json.loads(payload_bytes.decode("utf-8"))
    except (ValueError, TypeError, UnicodeDecodeError, InvalidSignature, json.JSONDecodeError):
        raise ValueError("Invalid activation license.")
    if not isinstance(claims, dict) or not claims.get("installation_id") or claims.get("product") != "SchoolBridge" or not claims.get("license_id") or not claims.get("issued_at"):
        raise ValueError("Invalid activation claims.")
    issued_at = int(claims["issued_at"])
    if issued_at > time.time() + 300:
        raise ValueError("Activation license issue time is invalid.")
    if claims.get("expires_at") is not None and int(claims["expires_at"]) < time.time():
        raise ValueError("Activation license has expired.")
    return claims


def license_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_owner_challenge(sequence: str) -> tuple[str, list[str]]:
    """Create five equally-sized mixed-character choices with one exact sequence match.

    The owner sequence is supplied only through server-side configuration; it is
    never returned separately or embedded in frontend assets.
    """
    if not isinstance(sequence, str) or len(sequence) != 6 or not sequence.isdigit():
        raise RuntimeError("SCHOOLBRIDGE_OWNER_SEQUENCE must be configured as exactly six digits.")

    digits = string.digits
    letters = string.ascii_letters
    symbols = "!@#$%^&*+="
    target_length = 52

    def make_option(include_sequence: bool) -> str:
        # Every option has the same total length and exact character counts:
        # 36 digits, 13 letters and 3 symbols. The correct sequence occupies
        # six of the digit positions; decoys receive six unrelated digits.
        digit_count = 36 - (6 if include_sequence else 0)
        pool = (
            [secrets.choice(digits) for _ in range(digit_count)]
            + [secrets.choice(letters) for _ in range(13)]
            + [secrets.choice(symbols) for _ in range(3)]
        )
        secrets.SystemRandom().shuffle(pool)
        value = "".join(pool)
        if include_sequence:
            position = secrets.randbelow(len(value) + 1)
            value = value[:position] + sequence + value[position:]
        return value

    correct = make_option(True)
    while correct.count(sequence) != 1:
        correct = make_option(True)

    choices = [correct]
    while len(choices) < 5:
        candidate = make_option(False)
        if sequence not in candidate and candidate not in choices:
            choices.append(candidate)
    secrets.SystemRandom().shuffle(choices)
    if len(choices) != 5 or sum(sequence in item for item in choices) != 1:
        raise RuntimeError("Unable to construct a unique owner activation challenge.")
    if any(len(item) != target_length for item in choices):
        raise RuntimeError("Owner activation challenge options have inconsistent lengths.")
    return correct, choices


def owner_challenge_option_hash(challenge_id: str, option: str) -> str:
    """Bind a selected option to its challenge without storing the secret itself."""
    return hashlib.sha256((challenge_id + ":" + option).encode("utf-8")).hexdigest()
