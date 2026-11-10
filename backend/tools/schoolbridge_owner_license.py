"""Owner-only offline Ed25519 license utility. Keep private keys outside the repository."""
import argparse
import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def write_private_key(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(base64.b64encode(value))


def write_public_key(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(descriptor, "wb") as output:
        output.write(base64.b64encode(value))


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or sign SchoolBridge installation licenses offline.")
    sub = parser.add_subparsers(dest="command", required=True)
    generate = sub.add_parser("generate-keypair")
    generate.add_argument("--private-key", required=True)
    generate.add_argument("--public-key", required=True)
    sign = sub.add_parser("sign-license")
    sign.add_argument("--private-key", required=True)
    sign.add_argument("--installation-id", required=True)
    sign.add_argument("--license-id", required=True)
    sign.add_argument("--expires-at", type=int)
    sign.add_argument("--action", choices=["activate", "school_identity_correction"], default="activate")
    sign.add_argument("--school-name")
    sign.add_argument("--school-type", choices=["Primary", "Secondary", "Combined"])
    sign.add_argument("--country")
    sign.add_argument("--school-structure", choices=["Day", "Boarding", "Both"])
    args = parser.parse_args()

    if args.command == "generate-keypair":
        private_path = Path(args.private_key)
        public_path = Path(args.public_key)
        if private_path.resolve() == public_path.resolve():
            parser.error("--private-key and --public-key must be different files.")
        if private_path.exists() or public_path.exists():
            parser.error("Key output files must not already exist; refusing to overwrite an existing key.")
        key = Ed25519PrivateKey.generate()
        private = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
        public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        write_private_key(private_path, private)
        write_public_key(public_path, public)
        print("Private key created with owner-only permissions. Keep it offline and never upload it.")
        print("Configure SCHOOLBRIDGE_LICENSE_PUBLIC_KEY with this public key value:")
        print(base64.b64encode(public).decode("ascii"))
        return

    private_bytes = base64.b64decode(Path(args.private_key).read_bytes(), validate=True)
    key = Ed25519PrivateKey.from_private_bytes(private_bytes)
    claims = {
        "product": "SchoolBridge",
        "installation_id": args.installation_id,
        "license_id": args.license_id,
        "issued_at": int(datetime.now(timezone.utc).timestamp()),
        "action": args.action,
    }
    if args.action == "school_identity_correction":
        if not all([args.school_name, args.school_type, args.country, args.school_structure]):
            parser.error("Identity correction licenses require --school-name, --school-type, --country and --school-structure.")
        claims["school_identity"] = {
            "school_name": args.school_name,
            "school_type": args.school_type,
            "country": args.country,
            "school_structure": args.school_structure,
        }
    if args.expires_at:
        claims["expires_at"] = args.expires_at
    payload = json.dumps(claims, sort_keys=True, separators=(",", ":")).encode("utf-8")
    print(encode(payload) + "." + encode(key.sign(payload)))


if __name__ == "__main__":
    main()
