"""End-to-end tests for the offline owner license utility."""
import subprocess
import sys
from pathlib import Path

from app.school_setup import verify_activation_license


TOOL = Path(__file__).resolve().parents[1] / "tools" / "schoolbridge_owner_license.py"


def run_tool(*args):
    return subprocess.run(
        [sys.executable, str(TOOL), *map(str, args)],
        capture_output=True,
        text=True,
        check=False,
    )


def test_owner_keypair_and_activation_license_round_trip(tmp_path, monkeypatch):
    private_key = tmp_path / "owner.key"
    public_key = tmp_path / "owner.pub"
    generated = run_tool("generate-keypair", "--private-key", private_key, "--public-key", public_key)
    assert generated.returncode == 0, generated.stderr
    assert private_key.exists() and public_key.exists()
    assert private_key.stat().st_mode & 0o777 == 0o600
    assert public_key.stat().st_mode & 0o777 == 0o644
    monkeypatch.setenv("SCHOOLBRIDGE_LICENSE_PUBLIC_KEY", public_key.read_text(encoding="ascii"))
    signed = run_tool("sign-license", "--private-key", private_key,
        "--installation-id", "a2b3c4d5-e6f7-4890-8123-456789abcdef",
        "--license-id", "school-test-activation-001")
    assert signed.returncode == 0, signed.stderr
    claims = verify_activation_license(signed.stdout.strip())
    assert claims["product"] == "SchoolBridge"
    assert claims["installation_id"] == "a2b3c4d5-e6f7-4890-8123-456789abcdef"
    assert claims["license_id"] == "school-test-activation-001"
    assert claims["action"] == "activate"


def test_owner_license_utility_refuses_to_overwrite_or_alias_key_files(tmp_path):
    private_key = tmp_path / "owner.key"
    public_key = tmp_path / "owner.pub"
    private_key.write_text("existing-private-key", encoding="ascii")
    refused_existing = run_tool("generate-keypair", "--private-key", private_key, "--public-key", public_key)
    assert refused_existing.returncode != 0
    assert private_key.read_text(encoding="ascii") == "existing-private-key"
    same_path = tmp_path / "same-key-file"
    refused_alias = run_tool("generate-keypair", "--private-key", same_path, "--public-key", same_path)
    assert refused_alias.returncode != 0
    assert not same_path.exists()


def test_owner_license_utility_signs_authorised_identity_correction(tmp_path, monkeypatch):
    private_key = tmp_path / "owner.key"
    public_key = tmp_path / "owner.pub"
    generated = run_tool("generate-keypair", "--private-key", private_key, "--public-key", public_key)
    assert generated.returncode == 0, generated.stderr
    monkeypatch.setenv("SCHOOLBRIDGE_LICENSE_PUBLIC_KEY", public_key.read_text(encoding="ascii"))
    signed = run_tool("sign-license", "--private-key", private_key,
        "--installation-id", "a2b3c4d5-e6f7-4890-8123-456789abcdef",
        "--license-id", "school-test-correction-001", "--action", "school_identity_correction",
        "--school-name", "Updated School Name", "--school-type", "Combined",
        "--country", "Uganda", "--school-structure", "Both")
    assert signed.returncode == 0, signed.stderr
    claims = verify_activation_license(signed.stdout.strip())
    assert claims["action"] == "school_identity_correction"
    assert claims["school_identity"] == {
        "school_name": "Updated School Name", "school_type": "Combined",
        "country": "Uganda", "school_structure": "Both",
    }


def test_owner_identity_correction_requires_all_identity_fields(tmp_path):
    private_key = tmp_path / "owner.key"
    public_key = tmp_path / "owner.pub"
    generated = run_tool("generate-keypair", "--private-key", private_key, "--public-key", public_key)
    assert generated.returncode == 0, generated.stderr
    missing_identity = run_tool("sign-license", "--private-key", private_key,
        "--installation-id", "a2b3c4d5-e6f7-4890-8123-456789abcdef",
        "--license-id", "school-test-correction-incomplete",
        "--action", "school_identity_correction", "--school-name", "Updated School Name")
    assert missing_identity.returncode != 0
    assert "require" in missing_identity.stderr
