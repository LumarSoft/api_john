# Naming Conventions

## Language

- Everything in English: file names, variables, classes, methods, comments.

## Files

- `kebab-case` for all files:
  - `auth.service.ts`
  - `jwt-auth.guard.ts`
  - `register.dto.ts`
  - `create-user.dto.ts`

## Classes

- `PascalCase`:
  - `AuthService`
  - `JwtAuthGuard`
  - `RegisterDto`
  - `PrismaService`

## Variables and methods

- `camelCase`:
  - `findUserById`
  - `hashedPassword`
  - `accessToken`

## DTOs

- Always include the `Dto` suffix.
- Prefix with action for input DTOs: `CreateUserDto`, `UpdateUserDto`, `LoginDto`
- Prefix with resource for output DTOs: `UserResponseDto`

## Modules and folders

- One folder per feature module, named in `kebab-case`:
  - `src/auth/`
  - `src/users/`
  - `src/products/`

## Constants and enums

- Constants: `UPPER_SNAKE_CASE`
- Enum values: `UPPER_SNAKE_CASE`

```typescript
export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}
```