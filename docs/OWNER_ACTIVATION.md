# SchoolBridge owner activation

Fresh installations use the five-choice owner recognition challenge described in [OWNER_ACTIVATION_V2_DESIGN.md](OWNER_ACTIVATION_V2_DESIGN.md). The school installer sees five long, balanced mixed-character options and selects the one containing the owner's six-digit sequence as one uninterrupted substring.

## Initial activation

- Exactly five options are displayed. All options have the same length and the same character counts: mostly digits, some letters and a few symbols.
- Exactly one option contains the configured six-digit owner sequence consecutively and unchanged. Four decoys do not contain it.
- The sequence is provisioned outside the repository through `SCHOOLBRIDGE_OWNER_SEQUENCE`. On Windows, the Tauri launcher stores it in Windows Credential Manager and passes it only to the local backend process.
- Each new installation receives freshly generated surrounding characters and a shuffled option order. Refreshing an unsubmitted challenge returns the same five options so a refresh cannot create extra attempts.
- The installer gets one selection only. A wrong selection permanently declines that installation. There is no retry or reset.
- The same selection is not requested again during school setup. Once activated, the first administrator can be created through the ordinary first-time setup form.
- The initial activation does not ask the school installer to paste a signed licence or handle Ed25519 keys.

## Computer binding and transfer

The Windows Tauri launcher creates a random machine token and stores it in Windows Credential Manager. It passes the token to the local backend process; the database stores only its SHA-256 fingerprint. Copying the SchoolBridge folder and database to another computer does not copy the protected Credential Manager entry, so the copied installation is blocked.

To move an existing installation:

1. Open the copied installation on the destination computer.
2. Copy the Installation ID and destination machine fingerprint shown by the transfer screen.
3. Send both values to the SchoolBridge developer.
4. The developer issues a single-use, expiring transfer authorisation bound to that installation and destination fingerprint.
5. Paste the authorisation into the transfer screen. On success, the new computer becomes the registered computer and the old binding is replaced.

Developer transfer authorisations are separate from the normal five-choice activation. The private owner key remains with the developer; school staff never need to generate or handle it.

## Developer key and exceptional identity corrections

The Ed25519 owner key remains a developer-side tool for signing exceptional school-identity corrections and computer-transfer authorisations. It is not required as an extra step in the ordinary five-choice activation screen.

Generate the keypair once on a trusted owner-controlled computer:

```bash
python backend/tools/schoolbridge_owner_license.py generate-keypair \
  --private-key /secure/schoolbridge-owner.key \
  --public-key /secure/schoolbridge-owner.pub
```

Keep the private key encrypted, backed up securely, and outside the repository. The matching public key is packaged for backend verification. Never commit or distribute the private key.

For a legitimate legal or structural change to a protected school identity, the developer may issue a separate signed correction authorisation using the `school_identity_correction` action. The backend records the previous and new identity and rejects reuse.

Existing schools detected by the database migration remain initialized; they are not forced through the new first-time activation flow.
