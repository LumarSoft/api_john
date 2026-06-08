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
- Every model must include a `deletedAt DateTime?` field for soft deletes — never use hard deletes.
- Foreign keys must have explicit `@relation` annotations.
- Keep the schema as the single source of truth for the database structure.

## Soft deletes

- Never use `delete` or `deleteMany` in Prisma — always set `deletedAt` to the current timestamp.
- All queries that list or fetch records must filter `deletedAt: null` to exclude soft-deleted rows.
- Unique constraints that could conflict with soft-deleted rows must account for this (e.g. deactivate before re-creating, or use composite uniqueness).

```typescript
// Wrong — hard delete
await this.prisma.user.delete({ where: { id } })

// Correct — soft delete
await this.prisma.user.update({
  where: { id },
  data: { deletedAt: new Date() },
})

// Correct — exclude soft-deleted rows in queries
await this.prisma.user.findMany({
  where: { deletedAt: null },
})
```