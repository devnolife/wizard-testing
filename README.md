# Copilot Testing Wizard

A local, generic testing app for full-stack **Next.js** projects, where the **GitHub Copilot
SDK is the brain**. You point it at a project; the agent autonomously starts the app, explores
it like a user, exercises the UI, checks accessibility/UX heuristics, probes API routes, watches
for process crashes, and reports findings (with severity + suggestions) — streamed live to a
dashboard.

> Architecture and rationale: [`docs/superpowers/specs/2026-06-06-copilot-testing-wizard-design.md`](docs/superpowers/specs/2026-06-06-copilot-testing-wizard-design.md)

## How it works

```
Browser (dashboard)  ──SSE──▶  Next.js app (this repo)
                                   │
                                   ├─ orchestrator (singleton, event bus, background runs)
                                   └─ Copilot session (@github/copilot-sdk)
                                         │ drives tools:
                                         ├─ project-runner  (auto-start dev server / URL, crash detect)
                                         ├─ codebase        (discover pages + API routes, read files)
                                         ├─ http            (localhost-only API requests)
                                         ├─ browser         (Playwright: navigate/click/fill/snapshot/a11y)
                                         └─ test-writer     (write + run Playwright tests)
```

The agent is fully agentic (Approach A): Copilot decides what to test and calls the tools itself.
Progress events are persisted to SQLite and replayed/streamed over Server-Sent Events.

## Prerequisites

- **Node.js** 20+ (developed on v24).
- **GitHub Copilot CLI** installed and authenticated (`copilot` on PATH). The SDK connects to it.
  An enterprise/individual Copilot subscription is required.
- The target project must be a Next.js app with a `dev` (or `start`) script and a `package.json`.

## Setup

```bash
npm install
npx playwright install chromium   # first run only, for the browser tool
```

## Run

```bash
npm run build
npm run start            # serves the dashboard (set PORT to choose a port, e.g. PORT=4100)
```

Then open the dashboard, click **New Run**, and provide:

- **Project path** — absolute path to the Next.js project to test.
- **Mode** — `auto-start` (the wizard runs the dev script on an isolated free port) or `url`
  (you provide a URL to an already-running app).
- **Scope** — any combination of UI, UX, and API.
- **Save mode** — `ephemeral` (generated tests live in a temp dir) or save tests into the project.

Live progress, findings, and screenshots stream into the run page. History is kept across runs.

### Dev mode

```bash
npm run dev
```

## Configuration

- `PORT` — port the dashboard listens on (default 3000; this repo's smoke tests use 4100).
- `WIZARD_MODEL` — optional Copilot model override; otherwise the SDK default is used.

## Guardrails

- Only `dev`/`start` scripts may be auto-run — never arbitrary commands.
- HTTP tool is restricted to localhost with a method allowlist.
- File reads are guarded against path traversal outside the target project.
- Generated tests are ephemeral by default; saving into the project is opt-in.
- Each run has a 15-minute agent timeout and is cancellable.
- The target app is launched in an isolated environment (the wizard's own `PORT`/`NODE_ENV` are
  not inherited) on a dedicated free port to avoid port conflicts.

## Tests

```bash
npm test            # unit tests (vitest)
```

A buggy sample app lives in [`fixtures/sample-next-app`](fixtures/sample-next-app) with planted
problems (missing `lang`, missing `alt`, a dead-end login flow with an unlabeled input, a render
crash page, and a 500 API route). Point a run at it to validate the wizard end-to-end.

## Project layout

| Path | Purpose |
| --- | --- |
| `app/` | Dashboard UI + API route handlers (incl. SSE stream) |
| `server/orchestrator.ts` | Run lifecycle singleton, event bus, background execution |
| `server/copilot/` | SDK session wiring, tool definitions, the run pipeline/prompt |
| `server/tools/` | The tools the agent calls (project-runner, http, codebase, browser, test-writer) |
| `server/store/` | SQLite persistence + on-disk artifacts (screenshots, logs, tests) |
| `fixtures/sample-next-app/` | Buggy app for end-to-end validation |
| `test/` | Unit tests |
