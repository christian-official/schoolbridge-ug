# School data isolation

## Current deployment boundary

SchoolBridge is currently deployed as a single-school installation. Each school must have its own application installation, database, database credentials, application secret and activation identity. Staff, parent and student accounts are stored only in that school's database.

Do not point two schools' installations at the same PostgreSQL database or SQLite data directory. Sharing a database between schools is not a supported deployment mode and would mix school records because the current schema is not a shared multi-tenant schema with a tenant key on every record.

## Required deployment controls

- Provision a separate database and credentials for every school.
- Use a unique SCHOOLBRIDGE_SECRET_KEY for every school installation.
- Keep each school's backups in a separate, access-controlled location.
- Do not share parent or staff login accounts between school installations.
- Keep the activation identity bound to the correct school installation.
- Restore backups only into the matching school's installation.

## Future shared-hosting requirement

Before operating multiple schools inside one shared application/database, implement tenant identifiers and enforce tenant scoping on every school-owned table, user account, foreign-key relationship, query, background job, offline sync snapshot, export, report and backup. Add cross-tenant isolation tests for every role before enabling that deployment model.

This document describes the current single-school deployment boundary; it is not a claim that shared-database multi-tenancy has already been implemented.