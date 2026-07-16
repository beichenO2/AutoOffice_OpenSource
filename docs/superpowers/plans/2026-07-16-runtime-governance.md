# AutoOffice Runtime Governance Implementation Plan

1. Add failing tests for managed serve-port resolution, test-only direct binding,
   foreground launcher, registration phases, and exact status/stop clients.
2. Implement the port guard, integrate it into CLI serve, replace all lifecycle
   behavior in `Start/`, and add registration-only staging.
3. Add R7 runtime SSoT, complete service management, and update README, PolarSoul,
   capability, and operations-skill launch guidance.
4. Run build then all tests, shell/JSON/diff checks, and project audit; fast-forward
   main without staging the user report.
5. Build main, keep both cron records unchanged, stage the API record, and call only
   `autooffice/restart`.
6. Verify the new API PID, single 3900 listener/owner, health and cron snapshots;
   finalize, mark R7 tested, run the fresh completion gate, mark done, update the
   ecosystem inventory, and clean the merged worktree/branch.

