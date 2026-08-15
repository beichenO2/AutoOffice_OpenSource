# AutoOffice

Repo-local commands only. Cross-tool Polarisor rules live in `~/Polarisor/AGENTS.md`.

## SSoT

- Identity: `PolarSoul.md`
- Progress / features: `polaris.json`
- Authority map: `docs/ssot.md`
- Product narrative: `README.md`
- Maintainer notes: `docs/agent/worker.md`

Do not invent a second source of truth. Behavior changes update polaris / PolarSoul / README / `docs/planning/roadmap.md` together.

## Repo layout

After cleanup, the root stays small: `src/` `tests/` `public/` `electron/` `contracts/` `tools/` `scripts/` `PolarSkills/` `Start/` `deploy/` `integrations/` `vendor/` `docs/` `_design/` `_report/` `reports/` plus identity/config files.

- Planning, sessions, reference → `docs/`
- Layout decisions → `_design/<topic>/`
- Delivery evidence → `_report/`
- Optional Presenton compose → `deploy/`
- scientific-illustrator wrap → `integrations/scientific-illustrator/`; pin → `vendor/scientific-illustrator`
- Do not drop junk, session md, coverage, or runtime logs at repo root.

## Text layout

High-density Slidev copy: wrap + tighten type (`data-ao-dense`) + theme/line-budget pagination (`paginateDeckSpec`). Continuation titles use `（2/N）`. Never ellipsis-condense body copy on the Slidev path. Authoring still has a 6 / 80 / 280 CJK budget (bullets per content slide / bullet / paragraph).

## Lobster events

Live sink: `logs/lobster/events.jsonl` (gitignored via `/logs/`). Not a root `lobster-events` file.

## Presenton

Optional sidecar via `deploy/` and `PRESENTON_URL`. Not vendored in the tree. Clone instructions live in `deploy/README.md`. Persistent processes still go through PolarProcess.

## Build

```bash
npm ci
npm run build
```

## Test

```bash
npm test
```

## Start

Persistent API is PolarProcess service `autooffice` (preferred port 3900).
Do not run `npm run serve` / `npm start` directly.

```bash
bash scripts/register-runtime.sh finalize
curl -fsS -X POST http://127.0.0.1:11055/api/services/autooffice/start
```

Foreground launcher (PolarProcess only): `bash Start/start.sh`.
