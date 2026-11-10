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

Optionally add `--expires-at` with a Unix timestamp. Give the resulting signed license string to the school installer. The same license is required twice in the first-time wizard: first to activate the installation, then again to authorise creation of the first administrator. The wizard keeps it only in page memory; if the page is refreshed before setup is complete, paste the same license again.

The license is bound to one installation ID. Activation attempts are rate-limited, successful activation is one-time, and the database stores only a SHA-256 fingerprint of the license. The first administrator cannot be claimed using activation status alone: setup completion must present the exact same owner-signed license. The original license and private signing key are not stored.

## Existing schools

The database migration automatically marks an installation with existing users or school records as already initialized. Existing schools are not sent through first-time activation or locked out by this gate.


## Authorise an exceptional identity correction

A school administrator cannot change the registered school name, type, country or day/boarding structure after setup. If a legitimate legal or structural change is required, the owner must issue a separate signed correction license:

```bash
python backend/tools/schoolbridge_owner_license.py sign-license \
  --private-key /secure/schoolbridge-owner.key \
  --installation-id "INSTALLATION-ID-FROM-SCHOOLBRIDGE" \
  --license-id "SCHOOL-REFERENCE-CORRECTION-002" \
  --action school_identity_correction \
  --school-name "New Registered School Name" \
  --school-type Combined \
  --country Uganda \
  --school-structure Both
```

An authenticated school administrator pastes that signed license into the protected identity-correction control. The server verifies the owner signature, applies only the identity embedded in the signed license, records the previous and new identity, and rejects reuse of the same license.
