# Wizard testing guide

## App summary

A tiny demo app with intentional bugs, used to validate the Copilot Testing Wizard.

## Test accounts

| Role | Email / username  | Password  | Notes                          |
| ---- | ----------------- | --------- | ------------------------------ |
| user | demo@example.test | demo1234  | Use on the /login page         |

## Available features

- Home page with a logo image
- Login page with a single input and a submit button
- A `/broken` page (known to crash on render)

## Key flows to exercise

1. Open `/login`, fill the input with the test account, and submit — verify the
   form actually does something (it currently does not).
2. Visit `/` and confirm the logo renders.

## API notes

- Base path: `/api`
- `GET /api/health` should return 200.
- `GET /api/users` should return a list.
- `GET /api/broken` is expected to fail — confirm it returns a useful error.

## Out of scope / constraints

- Do not perform destructive actions; this is a throwaway fixture.
