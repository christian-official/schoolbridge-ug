# SchoolBridge Development Instructions

These instructions apply to all SchoolBridge development work in this repository.

## Working priority
- Work quickly and deliver useful, verifiable progress immediately.
- Choose the shortest safe path. Avoid unnecessary planning loops, repeated explanations, and avoidable CI/configuration detours.
- Break work into small, coherent batches with clear acceptance checks.
- Reuse the existing architecture, scripts, workflows, and conventions before adding new systems.

## Verification
- Run the narrowest relevant checks first, followed by broader checks at meaningful milestones.
- Never rerun an unchanged failing pipeline without first inspecting the failure and addressing its cause.
- Never claim a test, build, install, or acceptance check passed unless its result was observed.
- Distinguish clearly between implemented, automated-test-verified, and real-machine-accepted functionality.

## Branch and data safety
- Continue on the active feature branch unless a deliberate branch change is required.
- Do not merge unfinished work into `main`.
- Never commit production secrets, credentials, private signing keys, real student/parent records, or unredacted school data.
- Preserve existing behaviour and backwards compatibility unless a task explicitly requires a change.
- Treat student, parent, staff, financial, and school records as sensitive.

## Delivery
- Keep documentation aligned with actual implementation and evidence.
- For Windows/offline release work, distinguish package-generation checks from clean-machine installation and disconnected-operation acceptance.
- Record blockers precisely and continue with independent work where possible.
- Keep progress updates concise: what changed, where, what was verified, and the next concrete step.

## Definition of done
A batch is complete only when its change is committed, relevant checks have been run and reported accurately, and remaining manual or real-environment acceptance steps are explicitly listed.

**Standing goal:** complete the remaining SchoolBridge phases as quickly as safely possible, without sacrificing correctness, security, or truthful reporting.
