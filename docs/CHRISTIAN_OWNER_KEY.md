# CHRISTIAN Owner Key provisioning

The visible owner-activation brand is **CHRISTIAN**. Signed activation codes begin with `CHRISTIAN:`; the cryptographic signature algorithm remains Ed25519 internally.

## Key-handling rules

- Generate the owner keypair on your trusted owner computer, not in a browser and not on the school server.
- The private key is encrypted with a passphrase and must remain outside this repository, GitHub, Render environment variables and school installations.
- Never send the private key or passphrase in chat, email, screenshots or support tickets.
- Only the matching Base64 public key is configured in the backend environment.
- Keep a secure offline backup of the encrypted private-key file and store the passphrase separately. Losing either means you may be unable to sign future activation or identity-correction codes.
- Generate the keypair once for the owner identity. Do not generate a new keypair for every school.

## 1. Generate the owner keypair on your trusted Windows computer

Use a local copy of the reviewed SchoolBridge release. Open PowerShell in the repository root:

```powershell
New-Item -ItemType Directory -Force "$HOME\SchoolBridgeOwner"
python -m pip install cryptography
python backend\tools\schoolbridge_owner_license.py generate-keypair --private-key "$HOME\SchoolBridgeOwner\christian-owner-private.pem" --public-key "$HOME\SchoolBridgeOwner\christian-owner-public.key"
```

The utility asks for a passphrase twice. Use a unique passphrase of at least 14 characters and store it separately in a reputable password manager. The private-key file is encrypted before it is written. Do not put either key file inside the repository or a shared school folder.

The command prints the public key as Base64. This public value is the only key value that belongs in a server environment.

## 2. Configure the public key on the school installation

For the current local-network school installation, open the school's private `.env` file on the school host and set:

- Variable: `SCHOOLBRIDGE_LICENSE_PUBLIC_KEY`
- Value: the Base64 public-key value printed by the key-generation command.

Restart/recreate the backend service after changing the environment. Never put the private key or its passphrase in the school's `.env`.

For a separately hosted preview or future hosted service, the public key belongs in that backend service's environment configuration (not the frontend static site). The private key still remains on the owner's trusted computer.

## 3. Sign an activation code for a school's installation

After the school host has started and the first-time setup page displays its **Unique Installation ID**, copy that exact ID.

On your trusted owner computer, from the repository root, run:

```powershell
python backend\tools\schoolbridge_owner_license.py sign-license --private-key "$HOME\SchoolBridgeOwner\christian-owner-private.pem" --installation-id "PASTE-INSTALLATION-ID" --license-id "SB-OWNER-0001"
```

Enter the private-key passphrase when prompted. The command prints a signed activation code beginning with `CHRISTIAN:`. Paste that code into the intended SchoolBridge installation's activation field. The same code is required again to complete initial school setup and create the first administrator.

Use a new unique license ID for every newly signed code. The code is bound to the installation ID and cannot activate a different installation.

## 4. Verification checklist

- The school's backend has the public key configured and has restarted successfully.
- The installation ID was copied from the intended school's first-time setup page.
- The activation code begins with `CHRISTIAN:`.
- The code is pasted only into the intended installation.
- The first administrator is created only after activation succeeds.
- The private-key file and passphrase remain under the owner's control.

**Never generate a production key or configure it on a school host until the corresponding owner-key code has passed CI and is included in the reviewed release intended for that school.**

## Desktop installer packaging and CI test keys

The production desktop build reads the owner's Base64 Ed25519 **public** verification key from `frontend/src-tauri/owner-activation-public-key.txt`. Keep the matching private key outside the repository. The packaging script validates the public key, stages it as `frontend/desktop-resources/owner-activation-public-key.txt`, and Tauri embeds that staged file in the installer.

GitHub Actions creates a fresh random **CI-only test public key** to exercise this packaging path. Any installer or USB artifact produced by that workflow is test-only and must not be distributed to schools or treated as a production release. The workflow labels the desktop installer artifact accordingly.

A production installer build remains blocked until the real owner's public key is provisioned in the source file on the trusted build machine. Do not substitute the CI test key or commit the private key.
