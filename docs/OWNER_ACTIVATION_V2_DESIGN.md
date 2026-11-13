# Owner activation v2 — implementation specification

Status: agreed product requirements; implementation pending.

This document records the owner-approved activation experience for the Windows desktop installation. It does not contain the owner's secret sequence.

## User-facing challenge

- Present exactly five long, single-line combinations.
- Each option is a mixed string made mostly of digits, with letters and a small number of symbols.
- Keep all five options close in total length and in their approximate digit/letter/symbol proportions. Do not make the correct option visually distinctive.
- Exactly one option contains the owner's six-digit sequence as one uninterrupted substring, unchanged and in order. It may occur anywhere in the string.
- The other four options must not contain that substring.
- Generate fresh random surrounding characters and a fresh option order for every new installation challenge. Do not reuse a fixed set of examples.
- Permit one selection only. A wrong selection permanently declines that installation challenge; do not offer a retry or regenerate a new challenge after a wrong answer.
- Never include the owner's sequence in frontend source, generated assets, logs, telemetry, API responses, or this repository. The verifier must run on the trusted side and use a protected provisioned secret.

## Computer binding and transfer

- Bind an activated installation to a machine-held, non-exportable device identity (prefer a TPM-backed Windows key where available); do not rely only on a MAC address, hostname, disk serial, or a browser/local-storage identifier.
- Store the installation binding and activation state outside the portable application folder, protected by Windows machine/user security.
- A copied application folder, USB package, database, or configuration must not be sufficient to activate SchoolBridge on another computer.
- If the device proof is absent, invalid, or belongs to another machine, fail closed and display a clear message that developer-authorised transfer is required.
- Moving an installation requires an explicit, single-use developer transfer authorization bound to the source installation identity and destination device identity. Record the transfer and revoke the old device binding after successful transfer.
- Do not silently rebind, reset the attempt counter, or create a fresh challenge when a device mismatch is detected.

## Security boundary

The five-choice sequence challenge is an owner-controlled recognition step, not strong cryptographic authentication by itself. A six-digit sequence has a small search space and must not be treated as a substitute for a machine-bound cryptographic identity. The production implementation must keep the sequence verifier out of the client and combine the selection with machine-bound proof and a developer-controlled transfer mechanism.

No private owner key, owner sequence, verifier secret, or production credential may be committed to this repository. Any signing or cryptographic proof used internally for developer transfer must remain invisible to the school installer; the user should only see the five-choice challenge and, when needed, a developer-authorised transfer process.

## Acceptance tests

1. Every challenge contains exactly five options.
2. Exactly one option contains the configured sequence as an uninterrupted substring.
3. Four options do not contain the sequence.
4. All options satisfy the configured length and character-composition bounds.
5. Challenge contents and option order differ across independently generated installations.
6. A correct selection activates only the installation that requested the challenge.
7. A wrong selection consumes the sole attempt and permanently declines that installation challenge.
8. A second selection, challenge refresh, or retry after failure is rejected.
9. A copied installation on a different machine fails device proof and cannot create a replacement binding.
10. A valid developer transfer authorization binds the destination device once and invalidates the source binding.
11. Existing school installations and their data are not forced through first-time activation again.
