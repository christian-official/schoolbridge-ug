# CHRISTIAN Owner Key provisioning

The visible owner-activation brand is **CHRISTIAN**. The signed activation-code format begins with `CHRISTIAN:`; the signature algorithm remains Ed25519 internally for security and interoperability.

## Important key-handling rules

- Generate the owner keypair on the owner's trusted computer, not on Render and not in a browser.
- The private key is encrypted with a passphrase and must stay outside this repository, GitHub, Render environment variables, and school installations.
- Never send the private key or its passphrase in chat, email, screenshots, or support tickets.
- Only the matching public key is configured on the backend.
- Keep a secure offline backup of the encrypted private-key file. Losing it means the owner can no longer sign new activation or identity-correction codes.

## 1. Generate the owner keypair (Windows PowerShell)

From the repository root, create a private folder and generate the keys:

```powershell
New-Item -ItemType Directory -Force "$HOME\SchoolBridgeOwner"
python backend\tools\schoolbridge_owner_license.py generate-keypair --private-key "$HOME\SchoolBridgeOwner\christian-owner-private.pem" --public-key "$HOME\SchoolBridgeOwner\christian-owner-public.key"
```

The utility asks for a passphrase twice. Use a unique passphrase of at least 14 characters. It encrypts the private key before writing it. Store the passphrase separately in a reputable password manager. Do not put either key file inside the repository.

The command prints the public key as Base64. This is the only key value that belongs on the server.

## 2. Configure the backend

In the Render dashboard, open the **SchoolBridge backend web service** (not the frontend static site), then add this environment variable:

- Key: `SCHOOLBRIDGE_LICENSE_PUBLIC_KEY`
- Value: the Base64 public-key value printed by the generation command

Save the environment variable and allow the backend service to restart. Never configure the private key on Render.

## 3. Sign an installation activation code

Open the installation's first-time setup screen. Copy its **Unique Installation ID**. On the owner's trusted computer, run:

```powershell
python backend\tools\schoolbridge_owner_license.py sign-license --private-key "$HOME\SchoolBridgeOwner\christian-owner-private.pem" --installation-id "PASTE-INSTALLATION-ID" --license-id "SB-OWNER-0001"
```

Enter the private-key passphrase when prompted. The command prints a one-time activation code beginning with `CHRISTIAN:`. Paste that code into the SchoolBridge installation activation field. The same code is required again to complete the initial school setup and create its first administrator.

Use a new unique license ID for each newly signed code. The code is bound to the installation ID, so it cannot activate a different installation.

## 4. Verification checklist

- Backend has the public key configured and has restarted successfully.
- The activation code begins with `CHRISTIAN:`.
- The code is pasted only into the intended SchoolBridge installation.
- The first administrator is created only after activation succeeds.
- The private-key file and passphrase remain under the owner's control.

**Do not generate or configure the production key until the code carrying this guide has passed CI and is available in the intended deployment.** This change is committed to the development branch only; it has not been deployed.
