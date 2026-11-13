# CHRISTIAN Owner Key — developer-only operations

The normal SchoolBridge first-install activation is the five-choice owner recognition challenge documented in [OWNER_ACTIVATION_V2_DESIGN.md](OWNER_ACTIVATION_V2_DESIGN.md). The school installer does not paste a `CHRISTIAN:` activation code and does not handle Ed25519 keys during ordinary activation.

The owner key remains a developer-only signing tool for two exceptional operations:
- Authorising a protected school-identity correction.
- Authorising a one-time transfer of an installation to a different computer.

## Key-handling rules

- Generate the keypair once on a trusted developer-controlled Windows computer.
- Keep the encrypted private key and its passphrase outside this repository and outside school computers.
- Never send the private key or passphrase in chat, email, screenshots or support tickets.
- Only the matching Base64 public key is packaged for backend verification.
- The private key must never be committed, uploaded to GitHub, or distributed with an installer.
- School staff do not need to know what Ed25519 is or handle key files.

## 1. Generate the developer keypair

```powershell
New-Item -ItemType Directory -Force "$HOME\SchoolBridgeOwner"
python -m pip install cryptography
python backend\tools\schoolbridge_owner_license.py generate-keypair --private-key "$HOME\SchoolBridgeOwner\christian-owner-private.pem" --public-key "$HOME\SchoolBridgeOwner\christian-owner-public.key"
```

The utility encrypts the private key with a passphrase. Store the passphrase separately. The public key is used by the backend to verify developer authorisations.

## 2. Authorise a computer transfer

When a school moves an installation, the destination screen displays:
- The existing installation ID.
- A fingerprint for the destination computer.

The developer uses those two values to create an expiring, single-use transfer authorisation:

```powershell
python backend\tools\schoolbridge_owner_license.py sign-license --private-key "$HOME\SchoolBridgeOwner\christian-owner-private.pem" --installation-id "PASTE-INSTALLATION-ID" --license-id "SB-TRANSFER-UNIQUE-001" --action machine_transfer --machine-binding-hash "PASTE-DESTINATION-FINGERPRINT" --expires-at "UNIX-TIMESTAMP-WITHIN-SEVEN-DAYS"
```

Use a new unique license ID for every transfer and set an expiry within seven days. Send the resulting token to the school contact. It is bound to the named installation and destination fingerprint, and the backend rejects reuse.

## 3. Authorise a school identity correction

A school administrator cannot independently change the protected school name, type, country or day/boarding structure. For a legitimate legal or structural correction, the developer signs a separate correction authorisation:

```powershell
python backend\tools\schoolbridge_owner_license.py sign-license --private-key "$HOME\SchoolBridgeOwner\christian-owner-private.pem" --installation-id "PASTE-INSTALLATION-ID" --license-id "SB-IDENTITY-CORRECTION-UNIQUE-002" --action school_identity_correction --school-name "New Registered School Name" --school-type Combined --country Uganda --school-structure Both
```

An authenticated school administrator submits that authorisation through the protected identity-correction control. The backend applies only the identity embedded in the signed token, records the previous and new identity, and rejects reuse.

## 4. Desktop installer packaging and CI test keys

The Windows desktop package still embeds the public verification key for these exceptional developer-authorised operations. The matching private key remains outside the repository. GitHub Actions creates a fresh random CI-only public key to exercise the packaging path; workflow installers and USB artifacts using that test key are not production releases.

Do not substitute a CI test key for the production developer public key, and never commit the private key.
