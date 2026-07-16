# AutoOffice Runtime Governance Design

## Goal

Replace the backgrounding Start scripts with a fail-closed foreground service while
preserving the live API, canonical `autooffice:3900` identity, and both existing
PolarProcess cron registrations.

## Baseline

- API: PolarProcess `autooffice`, PID 25503, port 3900, healthy, auto-start true.
- PolarPort already has the preferred reservation and sole active owner
  `AutoOffice/autooffice:3900`.
- The live process was detached by the old `Start/start.sh` (`nohup`, PPID 1), and
  `Start/stop.sh` sends direct signals. Project audit reports one drift.
- `autooffice-auto-evolve` and `autooffice-sota-radar` are stopped cron services;
  they are protected from all migration lifecycle calls.
- PolarPilot monitors only AutoOffice in dormant observer mode; no daemon config is
  added or changed.
- Build-first baseline: 48 test files / 384 tests pass; TypeScript build passes.
- Preserve untracked `reports/auto-evolve-202607152000.md`.

## Runtime contract

`Start/start.sh` checks PolarPort and PolarProcess, claims 3900 as `autooffice` for
AutoOffice, exports `POLAR_RUNTIME_MANAGED=1` and `PORT=3900`, then foreground-execs
Node 22 `dist/cli.js serve -p 3900`.

The CLI serve branch requires the managed marker and exact injected port. Its
existing direct-port path remains available only when both `NODE_ENV=test` and
`AUTOOFFICE_DIRECT_PORT=1`, preserving terminating integration tests without
creating a production bypass. The PolarPort SDK claim remains to provide heartbeat;
any allocation other than 3900 is rejected.

`Start/stop.sh` becomes an exact PolarProcess client. `Start/status.sh` reads the
exact authority record and health endpoint. A registration-only script stages the
existing direct command, foreground cutover, and final auto-start/health settings.

## Cutover

Build and test main while PID 25503 remains healthy. Register prepare and cutover,
then call only `autooffice/restart`. Verify one new PID, one listener, one active
owner, full health, and unchanged cron records before finalize. If startup fails,
inspect only `autooffice`; never signal the listener, release another identity, or
invoke either cron.

