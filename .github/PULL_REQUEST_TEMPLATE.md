<!-- Thanks for contributing! Keep PRs small and focused. -->

## What & why

Briefly describe the change and the motivation. Link any related issue
(e.g. `Closes #12`).

## Type of change

- [ ] Bug fix
- [ ] New feature (read-only — see scope below)
- [ ] Docs / chore / refactor

## Checklist

- [ ] Stays within scope: **read-only, no auth, single XCO** (see
      [COMMUNITY.md](../COMMUNITY.md)).
- [ ] Backend tests pass: `cd backend && .venv/bin/python -m pytest -q`
- [ ] Frontend builds + tests pass: `cd frontend && npm run build && npm test`
- [ ] New presentational components have a `*.test.tsx`.
- [ ] No secrets, keys, or `.env` files committed.
- [ ] Updated docs / `CHANGELOG.md` if behavior changed.

## Notes for reviewers

Anything reviewers should pay special attention to.
