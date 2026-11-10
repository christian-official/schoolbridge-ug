"""Exercise the offline owner key and signed-license utility."""
import base64
import json
import os
import subprocess
import sys
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def test_owner_license_cli_generates_protected_key_and_signs_activation(tmp_path):
    script = Path(__file__).resolve().parents[1] / "tools" / "schoolbridge_owner_license.py"
    private_key_path = tmp_path / "owner.key"
    public_key_path = tmp_path / "owner.pub"

    generated = subprocess.run(
        [
            sys.executable, str(script), "generate-keypair",
            "--private-key", str(private_key_path),
            "--public-key", str(public_key_path),
        ],
        check=True, capture_output=True, text=True, input="a-very-strong-test-passphrase-123\na-very-strong-test-passphrase-123\n",
    )
    assert private_key_path.is_file()
    assert public_key_path.is_file()
    if os.name == "posix":
        assert private_key_path.stat().st_mode & 0o777 == 0o600
    public_key_bytes = base64.b64decode(public_key_path.read_bytes(), validate=True)
    assert base64.b64encode(public_key_bytes).decode("ascii") in generated.stdout

    signed = subprocess.run(
        [
            sys.executable, str(script), "sign-license",
            "--private-key", str(private_key_path),
            "--installation-id", "test-installation-123",
            "--license-id", "owner-cli-test-001",
        ],
        check=True, capture_output=True, text=True, input="a-very-strong-test-passphrase-123\n",
    )
    token = signed.stdout.strip().splitlines()[-1]
    assert token.startswith("CHRISTIAN:")
    payload_part, signature_part = token.removeprefix("CHRISTIAN:").split(".", 1)

    def decode(value):
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

    payload = decode(payload_part)
    signature = decode(signature_part)
    Ed25519PublicKey.from_public_bytes(public_key_bytes).verify(signature, payload)
    claims = json.loads(payload)
    assert claims["product"] == "SchoolBridge"
    assert claims["installation_id"] == "test-installation-123"
    assert claims["license_id"] == "owner-cli-test-001"
    assert claims["action"] == "activate"

    correction = subprocess.run(
        [
            sys.executable, str(script), "sign-license",
            "--private-key", str(private_key_path),
            "--installation-id", "test-installation-123",
            "--license-id", "owner-cli-correction-001",
            "--action", "school_identity_correction",
            "--school-name", "Corrected School",
            "--school-type", "Combined",
            "--country", "Uganda",
            "--school-structure", "Both",
        ],
        check=True, capture_output=True, text=True, input="a-very-strong-test-passphrase-123\n",
    )
    correction_token = correction.stdout.strip().splitlines()[-1]
    assert correction_token.startswith("CHRISTIAN:")
    correction_payload_part, correction_signature_part = correction_token.removeprefix("CHRISTIAN:").split(".", 1)
    correction_payload = decode(correction_payload_part)
    Ed25519PublicKey.from_public_bytes(public_key_bytes).verify(
        decode(correction_signature_part), correction_payload
    )
    correction_claims = json.loads(correction_payload)
    assert correction_claims["action"] == "school_identity_correction"
    assert correction_claims["school_identity"]["school_type"] == "Combined"

    overwrite = subprocess.run(
        [
            sys.executable, str(script), "generate-keypair",
            "--private-key", str(private_key_path),
            "--public-key", str(public_key_path),
        ],
        capture_output=True, text=True,
    )
    assert overwrite.returncode != 0
