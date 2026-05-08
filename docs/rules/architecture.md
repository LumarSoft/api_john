# Architecture Rules

## Module structure

- Every feature lives in its own NestJS module: `*.module.ts`, `*.controller.ts`, `*.service.ts`.
- One module per business resource. Never mix responsibilities in the same service.
- Every module must be imported in `AppModule` or in a parent module — never leave orphaned modules.

## Controller rules

- Controllers only receive requests, delegate to the service, and return the response.
- No business logic in controllers.
- No direct Prisma queries in controllers.
- Always use DTOs for `@Body()`, `@Param()`, and `@Query()`.

## Service rules

- All business logic lives in the service.
- Services are the only layer that calls `PrismaService`.
- One service per module — do not inject one feature's service into another unless strictly necessary.
  If shared logic is needed, extract it into a dedicated shared module.

## PrismaService

- `PrismaService` is the single point of access to the database across the entire app.
- Never instantiate `PrismaClient` directly outside of `PrismaService`.
- `PrismaModule` is global — no need to import it in every module.

## General

- Keep methods small and focused on a single responsibility.
- Avoid logic duplication — extract shared logic into helpers or shared services.
- Keep logic as simple as possible. Avoid over-engineering.