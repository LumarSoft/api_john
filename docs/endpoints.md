# API Endpoints

Base URL: `http://localhost:3000`

---

## Auth

### POST /auth/register

Registers a new user.

**Auth required:** No

**Request body**

| Field    | Type   | Required | Constraints         |
|----------|--------|----------|---------------------|
| email    | string | Yes      | Valid email format  |
| password | string | Yes      | Minimum 6 characters|

```json
{
  "email": "user@example.com",
  "password": "secret123"
}
```

**Responses**

`201 Created`
```json
{
  "id": 1,
  "email": "user@example.com",
  "createdAt": "2026-05-08T00:00:00.000Z",
  "updatedAt": "2026-05-08T00:00:00.000Z"
}
```

`409 Conflict` — Email already in use
```json
{
  "statusCode": 409,
  "message": "Email already in use",
  "error": "Conflict"
}
```

`400 Bad Request` — Validation error (missing or invalid fields)

---

### POST /auth/login

Authenticates a user and returns a JWT access token.

**Auth required:** No

**Request body**

| Field    | Type   | Required | Constraints        |
|----------|--------|----------|--------------------|
| email    | string | Yes      | Valid email format |
| password | string | Yes      | Non-empty string   |

```json
{
  "email": "user@example.com",
  "password": "secret123"
}
```

**Responses**

`200 OK`
```json
{
  "access_token": "<jwt>"
}
```

`401 Unauthorized` — Invalid credentials
```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

`400 Bad Request` — Validation error (missing or invalid fields)

---

## Health

### GET /

Returns a health-check string. Not intended for production use.

**Auth required:** No

**Responses**

`200 OK`
```
Hello World!
```
