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
- **Scope** — any combination of eleven locally-run test scopes:
  - **UI** — pages render, navigation & user flows work.
  - **UX** — usability heuristics, clear errors/feedback, no dead-ends.
  - **API** — endpoint status codes, payloads & error handling.
  - **Performance** — Lighthouse score & Core Web Vitals (FCP, LCP, TBT, CLS).
  - **Accessibility** — deep WCAG 2 A/AA audit (axe-core + Lighthouse a11y).
  - **SEO** — titles, meta tags, headings & Lighthouse SEO score.
  - **Visual regression** — baseline & pixel-diff key pages.
  - **Security** — security headers, secret/error leakage, unauthenticated access to protected routes.
  - **Responsive** — layout at mobile, tablet & desktop widths (`set_viewport` checks for overflow/breakage).
  - **Links** — crawl internal links to find broken/dead routes.
  - **Console errors** — catch console errors & uncaught JS exceptions during navigation.

  Each enabled scope adds focused instructions to the agent and a matching finding category
  (PERF, A11Y, SEO, SECURITY, VISUAL) so results are easy to filter.
- **Authentication** *(optional)* — supply a login path + test credentials and the wizard
  signs in before testing (auto-detecting the username/password fields), so authenticated
  pages and flows can be exercised. The agent can also re-authenticate via the `browser_login` tool.
  After a successful login the session (cookies/localStorage) is saved and **reused on the next
  run for the same project** (within 12h), skipping a redundant re-login.
- **Seed / test accounts** *(local, on by default)* — instead of typing credentials, let the wizard
  auto-detect them. It scans the project's `.env*` files, seed scripts (`prisma/seed`, `db`,
  `scripts`, …), and fixtures for identifier/secret pairs (env-var pairs, object literals, and
  SQL `VALUES` tuples). Detected accounts are injected into the agent prompt (secrets are **masked
  in the live log**) and exposed via the `find_seed_accounts` tool, so when a flow needs login and
  no credentials were provided the agent can sign in with a real seeded account. Optionally point it
  at a specific **seed file** to scan. Safe because the wizard only targets local projects.
- **Save mode** — `ephemeral` (generated tests live in a temp dir) or save tests into the project.

Live progress, findings, and screenshots stream into the run page. The **Live browser view**
updates continuously (a frame roughly every 1.5s) while the agent drives the browser — so you
can watch it navigate, click, and type in near real time — plus discrete frames on each action.
History is kept across runs.

### Accessibility & performance audits

On any page the agent can call `audit_page`, which injects [axe-core](https://github.com/dequelabs/axe-core)
and runs a **WCAG 2 A/AA accessibility audit** plus lightweight **performance metrics**
(DOMContentLoaded, load, first contentful paint, TTFB, request count, transferred bytes).
Violations are grouped by impact and used to back up UX/accessibility findings with hard data.

### Full Lighthouse audit

For authoritative scores the agent can call `lighthouse_audit({ path })`, which runs a complete
[Google Lighthouse](https://github.com/GoogleChrome/lighthouse) audit and returns **category
scores (0–100)** for performance, accessibility, best-practices and SEO, plus **Core Web Vitals**
(First/Largest Contentful Paint, Total Blocking Time, Cumulative Layout Shift, Speed Index). It
runs in an isolated headless Chromium (its own remote-debugging port) so it never disturbs the
live testing page, and Lighthouse is loaded lazily via dynamic import. When a category scores low
(performance < 80 or accessibility < 90) the agent raises a PERF/UX finding citing the score. The
tool **fails soft** — if Lighthouse or Chrome can't run it returns `{ available: false, reason }`
and the agent falls back to `audit_page`, so a run never breaks because of it.

### Visual regression

The agent can call `visual_check({ label })` on key pages. The first time it sees a page it
captures a full-page screenshot (at a fixed 1280×800 viewport) as a **baseline** under
`.wizard-data/baselines/<projectHash>/`. On subsequent runs it diffs the current page against the
baseline with [pixelmatch](https://github.com/mapbox/pixelmatch); if more than 1% of pixels change
it writes a diff image and reports a UI finding — catching unintended visual changes between runs.

### Flaky test detection

When the agent runs generated specs via `run_tests`, the wizard passes Playwright `--retries`
(default 2) so a spec that fails and then **passes on a retry** is reported as *flaky*. The tool
returns `{ passed, failed, flaky, skipped }`; when `flaky > 0` the agent raises a `PROCESS/minor`
finding naming the unstable spec, so intermittent failures surface instead of hiding.

### Framework-agnostic discovery

`discover_app` is no longer Next.js-only. The wizard inspects the target project's
`package.json` (dependencies + scripts) to **detect the framework** — Next.js, SvelteKit,
Remix, Astro, Nuxt, Vite, or Create React App — and reports it (e.g. *"Detected nextjs:
3 pages, 3 API routes"*). It maps UI routes and API handlers using each framework's
conventions (Next App/Pages router, SvelteKit `+page`, Remix `routes/`, Astro `pages/`),
and auto-selects the right dev script (`dev`, falling back to `start`).

For client-rendered SPAs (e.g. plain Vite/CRA) where routes can't be derived from the file
tree, discovery returns a `note` and the agent navigates to `/` and calls the **`list_links`**
tool to crawl same-origin links dynamically — so route coverage degrades gracefully instead
of failing.

### Export reports

When a run finishes, use the **Export** buttons on the run page (or hit the API directly) to
download a report:

```
/api/runs/<id>/export?format=html   # self-contained HTML (screenshots inlined; print to PDF)
/api/runs/<id>/export?format=md     # Markdown
/api/runs/<id>/export?format=json   # full machine-readable report
/api/runs/<id>/export?format=junit  # JUnit XML for CI (each finding is a testcase)
```

The **JUnit** format lets you wire the wizard into CI pipelines (GitHub Actions,
Jenkins, GitLab). Critical/major findings become `<failure>` test cases, minor
findings become `<skipped>`, and info findings pass — so a buggy app fails the build.


### Testing guide (`wizard.md`) — tell the agent about accounts & features

The agent can only infer so much from code. To give it **authoritative context**
— test accounts/credentials, which features exist, and the key flows to exercise —
copy [`wizard.template.md`](wizard.template.md) into the **root of the project you
want to test**, rename it to `wizard.md`, and fill it in.

When a run starts, the wizard auto-detects this file and injects it into the agent
prompt (you'll see a `Loaded testing guide from wizard.md` step in the live
timeline). Detected locations, first match wins:

```
wizard.md   .wizard.md   .wizard/testing.md   docs/wizard.md
```

Use **test-only** credentials — never put real production secrets in this file.

### Dev mode

```bash
npm run dev
```

## Configuration

- `PORT` — port the dashboard listens on (default 3000; this repo's smoke tests use 4100).
- `WIZARD_MODEL` — optional Copilot model override; otherwise the SDK default is used.
- `WIZARD_HEADED` — set to `1` to force the Playwright browser to run in a **visible
  window** for every run (watch it navigate, click, and type). You can also enable this
  per-run with the **Show the browser window** checkbox on the New Run page.

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
| `server/report/` | Report export builders (HTML / Markdown / JSON / JUnit) |
| `server/store/` | SQLite persistence + on-disk artifacts (screenshots, logs, tests) |
| `fixtures/sample-next-app/` | Buggy app for end-to-end validation |
| `test/` | Unit tests |
