# Security Policy

## Supported release status

SchoolBridge is under active development. No production release or legacy Windows 8/8.1 installer is currently certified. Do not deploy it with real student, parent, staff, or financial records until the release and deployment acceptance checks are complete.

## Reporting a vulnerability

Please do not publish exploitable vulnerability details, credentials, personal data, or proof-of-concept attacks in public issues or discussions.

Use GitHub's **Report a vulnerability** option in this repository's Security tab to send a private report when that option is available. Include:
- affected commit, release, or component;
- a concise description and security impact;
- reproducible steps using synthetic data only;
- any suggested mitigation.

If private vulnerability reporting is unavailable, contact the repository maintainers privately through their GitHub profile and request a secure reporting channel. Do not disclose sensitive details in a public issue.

## Scope and handling

Security reports involving authentication, authorization, school-data isolation, offline device registration, sync conflicts, backup/restore, dependency vulnerabilities, or installer integrity are especially important.

Please allow maintainers reasonable time to investigate, prepare a fix, and coordinate disclosure. Do not access, modify, or retain real school records while testing a suspected vulnerability.