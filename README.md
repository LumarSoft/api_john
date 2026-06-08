# API — NestJS + Prisma + MySQL

## Prerequisites

- Node.js 18+
- MySQL 8+ running locally (or via Docker)

---

## Quick start (cloning from scratch)

```bash
git clone <repo-url>
cd api
npm install
# copy .env and fill in your credentials (see step 2)
npx prisma migrate dev   # applies ALL existing migrations in order + regenerates client
npm run start:dev
```

---

## 1. Install dependencies

```bash
npm install
```

---

## 2. Configure environment variables

Create a `.env` file in the project root (never commit this file):

```env
DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/john_db"
JWT_SECRET="your-secret-here"
PORT=3000
```

Replace `USER` and `PASSWORD` with your MySQL credentials. The database `john_db` must exist before running migrations:

```sql
CREATE DATABASE john_db;
```

---

## 3. Run migrations

Apply all pending migrations to the database:

```bash
npx prisma migrate dev
```

This also regenerates the Prisma client automatically.

> If you're setting up from scratch for the first time, this creates all tables.

---

## 4. Generate Prisma client (if skipping migrations)

If you only changed the schema without new migrations, regenerate the client manually:

```bash
npx prisma generate
```

---

## 5. Start the server

```bash
# Development with hot-reload
npm run start:dev

# Debug mode
npm run start:debug

# Production
npm run build
npm run start:prod
```

The API will be available at `http://localhost:3000` (or the port defined in `.env`).

---

## Prisma reference

| Command | Description |
|---|---|
| `npx prisma migrate dev --name <name>` | Create and apply a new migration |
| `npx prisma migrate deploy` | Apply pending migrations (production) |
| `npx prisma generate` | Regenerate client after schema changes |
| `npx prisma studio` | Open visual DB browser at localhost:5555 |
| `npx prisma migrate reset` | Drop DB, re-run all migrations (dev only) |
| `npx prisma db pull` | Introspect existing DB and update schema |

> Always use a descriptive name for migrations:
> `npx prisma migrate dev --name add-deleted-at-to-user`

---

## Creating a new migration after schema changes

1. Edit `prisma/schema.prisma`
2. Run:
   ```bash
   npx prisma migrate dev --name describe-your-change
   ```
3. Commit both the schema change and the generated migration file together.

---

## Tests

```bash
npm run test          # Unit tests
npm run test:e2e      # End-to-end tests
npm run test:cov      # Coverage report
```

---

## Lint & format

```bash
npm run lint
npm run format
```
