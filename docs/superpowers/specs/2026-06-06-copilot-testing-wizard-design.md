# Copilot Testing Wizard — Design Spec

**Date:** 2026-06-06
**Status:** Approved (design phase)
**Author:** @arikalkhairat (with Copilot CLI)

## Problem

Maintaining a large full-stack Next.js application makes manual testing overwhelming:
it is hard to know where to start across UI, UX, API, and whether the app process even
runs. The goal is a **local testing app** where the **GitHub Copilot SDK is the main brain**
that autonomously plans, runs, explores, and analyzes tests against any Next.js project.

## Goals

- A **reusable, generic** tool that can be pointed at **any full-stack Next.js project**.
- A **full pipeline**: generate tests → run them → explore the app like a user → analyze results.
- Cover **UI**, **UX**, **API**, and **process-health** ("does it run or crash?").
- **UX** means all of: end-to-end flows, accessibility/UI quality, and heuristic usability review.
- Generated tests can be **saved into the target project** (reusable, CI-ready) **or run ephemerally**.
- The tool can **auto-start** the target project (`npm run dev`) **or** use an already-running URL.
- A **local web dashboard** to launch runs, watch live progress, and view reports.

## Non-Goals (YAGNI for v1)

- No cloud/hosted deployment — local only.
- No support for non-Next.js stacks in v1 (architecture stays extensible).
- No deterministic CI harness yet (that is the future evolution toward the "Hybrid" approach).
- No multi-user/auth — single local user.

## Chosen Approach

**Approach A — Fully agentic: Copilot as orchestrator + tools.** The backend uses
`@github/copilot-sdk` to run one Copilot session per test run. Copilot is given a set of
tools (run the project, drive a browser, hit APIs, read the codebase, write/run tests). It
reads the project, plans scenarios itself, executes them, and analyzes results. This is the
purest expression of "Copilot as the brain" and naturally covers unexpected UX findings.

The design intentionally leaves room to grow into **Approach C (Hybrid)** later by adding a
fast deterministic harness for saved tests alongside the agentic exploration mode.

## Architecture

A **single Next.js app** (App Router, Node runtime). The agent orchestration lives as a
**server-only singleton module** inside the app; live progress is streamed to the UI via
**SSE** through Route Handlers. Agent work runs as a background task managed by the
singleton (not tied to the HTTP request lifecycle). The singleton is cached on `globalThis`
to survive dev hot-reload.

```
wizard-testing/   (single Next.js app)
├─ app/
│  ├─ (dashboard pages: New Run, Live Run, Report, History)
│  └─ api/
│     ├─ runs/route.ts            POST start run, GET list
│     ├─ runs/[id]/route.ts       GET report
│     └─ runs/[id]/stream/route.ts  GET SSE live events
├─ server/                        (server-only, never imported by client)
│  ├─ orchestrator.ts             singleton run manager (globalThis-cached)
│  ├─ copilot/
│  │  ├─ session.ts               @github/copilot-sdk wiring
│  │  └─ tools.ts                 tool definitions registered with the session
│  ├─ tools/
│  │  ├─ project-runner.ts        auto-start / URL / health-check / crash detect
│  │  ├─ browser.ts               Playwright: navigate/click/fill/screenshot/a11y
│  │  ├─ http.ts                  API requests (status/latency/body)
│  │  └─ test-writer.ts           write Playwright/Vitest to project or temp + run
│  └─ store/
│     ├─ db.ts                    SQLite (better-sqlite3)
│     └─ artifacts.ts             screenshots/logs/generated tests on disk
├─ packages/shared/ (optional)    shared types & schemas
└─ fixtures/sample-next-app/      small buggy Next.js app to test this tool itself
```

### Why single app (vs separate orchestrator service)

Chosen for simplicity at the user's request. Trade-off accepted: long-lived agent sessions
and streaming are handled via a `globalThis` singleton + SSE Route Handlers on the Node
runtime rather than a dedicated long-running service. Route handlers must declare
`export const runtime = 'nodejs'` and be dynamic.

## Tools Given to Copilot

Each tool is a small, independently testable unit with a clear interface.

| Tool | Purpose | Notes |
|------|---------|-------|
| **project-runner** | Detect package manager; `run dev` auto-start OR use provided URL; health-check the port; detect crash/exit | Crash/exit surfaces as a `PROCESS` finding, not a tool error |
| **browser** | Playwright: navigate, click, fill forms, screenshot, accessibility-tree snapshot | Powers UI flows + UX/a11y checks (contrast, labels, keyboard nav) |
| **http** | Send requests to API routes; capture status, latency, body | Powers API correctness + error-handling checks |
| **codebase** | Read project structure: pages, `app/api/**` route handlers, forms, components | Source material for scenario planning |
| **test-writer** | Write Playwright/Vitest files to the project (opt-in) or temp dir (ephemeral), then run | Save-to-project requires explicit user opt-in + chosen folder |

## Run Pipeline (data flow)

1. User selects target project path + mode (auto-start / URL) + scope (UI/UX/API/all) +
   save-mode (project / ephemeral) on the **New Run** page.
2. Orchestrator creates a `Run` record, starts a Copilot session, registers tools.
3. Copilot **ensures the app is running** (project-runner) → **reads the codebase**
   (codebase) → **plans scenarios** (UI flows, API endpoints, UX heuristics).
4. Copilot **executes**: drives the browser for UI/flows/a11y and hits APIs; captures
   results and screenshots as it goes.
5. Optionally **generates and saves** test files; optionally runs them.
6. Copilot **analyzes** results into a structured report (pass/fail, severity, UX findings,
   process-health status).
7. Every step streams to the dashboard via SSE; the final report is persisted.

## Dashboard (UX)

- **New Run** — pick project path, mode, scope, save-mode; start.
- **Live Run** — real-time timeline of Copilot's steps (SSE) with inline screenshots.
- **Report** — pass/fail summary per category; findings list with severity, screenshots, and
  Copilot's suggested fixes; viewable run history.

## Data Model (SQLite)

- `runs(id, project_path, mode, scope, save_mode, status, started_at, finished_at, token_usage)`
- `findings(id, run_id, category[UI|UX|API|PROCESS], title, severity[critical|major|minor|info], detail, screenshot_path, suggestion)`
- `artifacts(id, run_id, type[screenshot|log|generated_test], path)`
- `events(id, run_id, ts, kind, message, payload_json)` — backing store for live timeline / replay.

## Error Handling & Guardrails

Critical because an autonomous agent operates on the user's own project.

- **Permission gating** via the SDK `onPermissionRequest`: auto-approve safe actions (read
  files, browser, HTTP GET to localhost); **require confirmation** for writes to the project
  and shell commands.
- **Command allowlist** — only package-manager scripts like `run dev` / `run test`; reject
  destructive commands.
- **Ephemeral by default** — runs write to a temp dir; "save to project" only on explicit
  opt-in with a chosen folder.
- **Timeout & token budget** per run; per-step retry; dev-server crash becomes a `PROCESS`
  finding rather than aborting the whole run as a tool error.
- **Target isolation** — never run outside the selected project path; no network writes
  beyond the target's localhost.

## Testing This Tool Itself

- **Unit tests** for each tool (project-runner, http, report builder, test-writer).
- **Fixture app** `fixtures/sample-next-app` — a small Next.js app with intentional bugs
  (a broken flow, a failing API route, an a11y issue, a crash path) used for **E2E**:
  assert the wizard correctly surfaces each planted problem.

## Future Evolution (out of scope for v1)

- Add a deterministic harness to re-run saved tests quickly (path to Approach C / hybrid).
- CI integration for saved tests.
- Support stacks beyond Next.js via the same tool interfaces.
