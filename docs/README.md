# Orchestrator docs

| Folder | What's in it |
|---|---|
| **`plan/`** | The roadmap. `execution-plan.md` (the full back-to-front plan, all phases) and `phase-0-brief.md` (the original Phase 0 scope). |
| **`specs/`** | Design specs. `group-dealership-entity-model.md` (the group → dealership → project model) and `dms-approval-flows.md` (per-DMS integration-approval flows: Fortellis, Reynolds, Tekion, DealerVault). |
| **`plans/`** | Implementation plans. `phase-0.5-entity-model.md` (the next build). |
| **`reference/`** | Source material, not part of the app. |
| `reference/onboarding-skill/` | The existing **EZ-Wins onboarding skill** (`SKILL.md` + `process_fortellis.py`) — the blueprint the orchestrator absorbs as **Phase 2** (turns a Fortellis CSV / Reynolds RCI-1 PDF / DealerVault paste / Tekion paste or APC scrape into a structured ClickUp "Branch" task). |
| `reference/dms-samples/` | Real DMS emails/PDFs (gitignored — customer data). `fortellis/` and `reynolds/` hold the verified samples each spec was built from. |

**Start here:** `../STATUS.md` for current state, then `plan/execution-plan.md`.

Real samples (`*.eml`, `*.pdf`, `*.skill`, `memory.json`) are gitignored and live only locally.
