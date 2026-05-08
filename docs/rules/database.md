# Database Rules

## Prisma queries

- All Prisma queries go in the service layer — never in controllers or guards.
- Always use `select` or manually exclude sensitive fields when returning data to the client.
  Never return a full row that contains fields like `password`, `token`, or any secret.
- Prefer explicit field selection over `omit` for clarity.

## Example — excluding sensitive fields

```typescript
// Wrong — exposes password
return this.prisma.user.findUnique({ where: { id } })

// Correct — explicit select
return this.prisma.user.findUnique({
  where: { id },
  select: { id: true, email: true, createdAt: true },
})
```

## Migrations

- Always run migrations with a descriptive name:
```bash
  npx prisma migrate dev --name add-refresh-token-to-user
```
- Never modify an already-applied migration — always create a new one.
- Run `npx prisma generate` after every schema change.
- Never edit the `_prisma_migrations` table manually.

## Schema

- Every model must have a primary key (`@id`).
- Use `@default(now())` for `createdAt` and `@updatedAt` for `updatedAt`.
- Foreign keys must have explicit `@relation` annotations.
- Keep the schema as the single source of truth for the database structure.