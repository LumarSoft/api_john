# Security Rules

## Passwords

- Always hash passwords with bcrypt before persisting. Never store plain text passwords.
- Use a salt rounds value of 10 minimum.
- Never log, return, or expose password fields in any response.

## Tokens and secrets

- Never hardcode secrets, API keys, or connection strings in the codebase.
- All sensitive configuration must live in environment variables (`.env`).
- Never commit `.env` files — ensure `.env` is in `.gitignore`.
- JWT secret must come from `process.env.JWT_SECRET`.

## Route protection

- Every route that requires authentication must have `@UseGuards(JwtAuthGuard)` explicitly.
- Never assume a route is protected — always declare the guard.
- Public routes (login, register) must remain unguarded intentionally.

## Logging

- Never log passwords, tokens, or any sensitive user data.
- Never use `console.log` in production code — remove all debug logs before committing.

## General

- Always validate and sanitize input via DTOs before processing.
- Never expose internal implementation details in error messages returned to the client.