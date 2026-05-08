# Error Handling Rules

## NestJS exceptions

Always use NestJS built-in exceptions. Never throw generic `Error` objects.

| Situation                        | Exception                  |
|----------------------------------|----------------------------|
| Resource not found               | `NotFoundException`        |
| Duplicate / already exists       | `ConflictException`        |
| Invalid credentials / token      | `UnauthorizedException`    |
| Forbidden action                 | `ForbiddenException`       |
| Invalid input (not caught by DTO)| `BadRequestException`      |
| Unexpected server error          | `InternalServerErrorException` |

## Async error handling

- Every `async` method must handle errors explicitly.
- Use `try/catch` for operations that can fail (external calls, complex DB operations).
- Let NestJS exceptions propagate naturally — do not wrap them in another try/catch.

## What NOT to do

- Never expose stack traces or internal error messages to the client.
- Never throw plain `new Error('something')` — always use NestJS exceptions.
- Never swallow errors silently with an empty `catch` block.

## Example

```typescript
async findOne(id: number) {
  const user = await this.prisma.user.findUnique({ where: { id } })
  if (!user) throw new NotFoundException(`User with id ${id} not found`)
  return user
}
```