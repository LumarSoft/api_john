# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev        # Start with hot-reload (watch mode)
npm run start:debug      # Start with debugger + watch

# Build & Production
npm run build            # Compile TypeScript via nest build
npm run start:prod       # Run compiled output from dist/

# Lint & Format
npm run lint             # ESLint with auto-fix on src/
npm run format           # Prettier on src/ and test/

# Tests
npm run test             # Unit tests (Jest)
npm run test:watch       # Unit tests in watch mode
npm run test:cov         # Unit tests with coverage
npm run test:e2e         # End-to-end tests (jest-e2e.json config)

# Database (Prisma)
npx prisma migrate dev   # Run migrations in development
npx prisma generate      # Regenerate Prisma client after schema changes
npx prisma studio        # Open Prisma Studio GUI
```

## Architecture

NestJS REST API with MySQL via Prisma ORM. The project is in early stages — the scaffolding and dependencies are in place but most features still need to be built.

**Module structure** follows NestJS conventions: each feature lives in its own module (`*.module.ts`) that declares its controllers, services, and imports. Everything is wired into `AppModule` (`src/app.module.ts`).

**Database:** MySQL at `john_db` (configured in `.env` as `DATABASE_URL`). The Prisma schema lives at `prisma/schema.prisma`; the generated client outputs to `generated/prisma/`. Run `npx prisma generate` after any schema change.

**Auth:** JWT + Passport dependencies are installed (`@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `bcrypt`) but no auth module, strategy, or guards exist yet. When implementing, follow the NestJS Passport JWT recipe: `AuthModule` with `JwtStrategy`, `JwtAuthGuard`, and `/auth/login` route.

**Validation:** `class-validator` and `class-transformer` are installed. Enable the global `ValidationPipe` in `main.ts` when adding DTOs.

**Port:** Reads from `process.env.PORT`, defaults to 3000.
