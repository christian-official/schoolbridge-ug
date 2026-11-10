# SchoolBridge owner activation

Fresh installations require an owner-signed Ed25519 activation license before a school administrator can be created. The school server receives only the public verification key and a signed license; it never receives the owner's private signing key.

## Create the owner keypair once

Run this on a trusted owner-controlled computer, with the private key stored outside the SchoolBridge repository and deployment:

```bash
python backend/tools/schoolbridge_owner_license.py generate-keypair \
  --private-key /secure/schoolbridge-owner.key \
  --public-key /secure/schoolbridge-owner.pub
```

Keep `schoolbridge-owner.key` offline, backed up securely, and never commit or upload it. Configure the deployment environment variable `SCHOOLBRIDGE_LICENSE_PUBLIC_KEY` with the printed base64 public-key value. This is a public verification key, not a secret.

## Issue an installation license

1. Open the new installation's first-time setup screen.
2. Copy its unique installation ID.
3. On the trusted owner computer, sign a license:

```bash
python backend/tools/schoolbridge_owner_license.py sign-license \
  --private-key /secure/schoolbridge-owner.key \
  --installation-id "INSTALLATION-ID-FROM-SCHOOLBRIDGE" \
  --license-id "SCHOOL-REFERENCE-001"
```

Optionally add `--expires-at` with a Unix timestamp. Give the resulting signed license string to the school installer to paste into SchoolBridge.

The license is bound to one installation ID. Activation attempts are rate-limited, successful activation is one-time, and the database stores only a SHA-256 fingerprint of the license. The original license and private signing key are not stored.

## Existing schools

The database migration automatically marks an installation with existing users or school records as already initialized. Existing schools are not sent through first-time activation or locked out by this gate.
