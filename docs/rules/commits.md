# Commit Conventions

## Format

Use Conventional Commits:
<type>: <short description in english, lowercase>

## Types

| Type       | When to use                                      |
|------------|--------------------------------------------------|
| `feat`     | New feature or endpoint                          |
| `fix`      | Bug fix                                          |
| `refactor` | Code change that doesn't fix a bug or add feature|
| `chore`    | Tooling, dependencies, config changes            |
| `docs`     | Documentation only                               |
| `test`     | Adding or fixing tests                           |
| `perf`     | Performance improvement                          |

## Examples
feat: add user registration endpoint
fix: return 404 when user is not found
refactor: extract password hashing to auth helper
chore: add husky pre-commit hook
docs: update CLAUDE.md with prisma commands

## Rules

- Never commit `console.log`, commented-out code, or debug artifacts.
- Never commit `.env` files or secrets.
- One commit = one responsibility. Do not mix features with refactors.
- Description in lowercase, no period at the end.