# Wizard testing guide

> Copy this file into the **root of the project you want to test** and rename it to
> `wizard.md` (the Copilot Testing Wizard auto-detects it). Fill in the sections
> below. Anything you write here is given to the testing agent as authoritative
> context, so it knows how to log in, which features exist, and what to exercise —
> instead of guessing.
>
> Accepted locations (first match wins): `wizard.md`, `.wizard.md`,
> `.wizard/testing.md`, `docs/wizard.md`.
>
> ⚠️ This file may contain **test-only** credentials. Never put real production
> secrets here.

## App summary

One or two sentences: what the app does and who its users are.

## Test accounts

List credentials the agent can use to sign in. Use test/staging accounts only.

| Role  | Email / username        | Password      | Notes                       |
| ----- | ----------------------- | ------------- | --------------------------- |
| admin | admin@example.test      | Passw0rd!     | Full access                 |
| user  | user@example.test       | Passw0rd!     | Standard account            |

If auth uses something else (magic link, OTP, SSO), describe how to authenticate
in test mode here.

## Available features

Bullet the main features so the agent prioritizes real functionality:

- Login / logout
- Dashboard with ...
- Create / edit / delete ...
- Search, filters, pagination ...

## Key flows to exercise

Describe end-to-end journeys worth testing, step by step:

1. Log in as `user` → open dashboard → create an item → verify it appears in the list.
2. Log in as `admin` → ...

## API notes

- Base path: `/api`
- Auth: e.g. session cookie after login, or `Authorization: Bearer <token>`.
- Endpoints worth checking and their expected behavior.

## Out of scope / constraints

- Do NOT submit real payments, send emails, or call third-party services.
- Avoid destructive actions on shared data, etc.
