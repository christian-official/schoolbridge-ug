# SchoolBridge Working Guidelines

These guidelines govern all SchoolBridge development and release work.

## 1. Speed with discipline
- Prioritise the shortest safe path to a working, verifiable result.
- Start useful work immediately; avoid unnecessary planning loops, repeated explanations, and avoidable CI/configuration detours.
- Work in small, coherent batches. Prefer one focused change with a clear acceptance check over broad speculative rewrites.
- Reuse the existing architecture, scripts, workflows, and conventions before introducing new systems.

## 2. Verify honestly
- Run the narrowest relevant checks first, then the required broader checks at meaningful milestones.
- Do not repeatedly rerun an unchanged failing pipeline. Inspect the failure, identify the cause, and fix the cause before retrying.
- Never report a test, build, installation, or acceptance check as passed unless its result was observed.
- Clearly distinguish implemented, automated-test-verified, and real-machine-accepted functionality.

## 3. Protect working code and data
- Continue on the active feature branch unless a deliberate branch change is needed.
- Do not merge unfinished work into `main`.
- Do not commit production secrets, private signing keys, credentials, real student/parent records, or unredacted school data.
- Preserve existing behaviour and backwards compatibility unless the task explicitly requires a change.
- Treat student, parent, staff, financial, and school records as sensitive.

## 4. Deliver in usable increments
- Keep documentation aligned with actual implementation and test evidence.
- For offline/Windows release work, distinguish package-generation checks from clean-machine installation and disconnected-operation acceptance.
- Record blockers precisely and move to the next independent task where possible.
- Keep user updates concise: state what changed, where it changed, what was verified, and the next concrete step.

## 5. Definition of done
A batch is complete only when its code/documentation change is committed, the relevant checks have been run and reported accurately, and any remaining manual or real-environment acceptance steps are explicitly listed.

**Standing priority:** finish the remaining SchoolBridge phases as quickly as safely possible, without sacrificing correctness, security, or truthful reporting.
