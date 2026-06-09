# API Endpoints

Base URL: `http://localhost:3000`

---

## Auth

### POST /auth/register

Registers a new user.

**Auth required:** No

**Request body**

| Field    | Type   | Required | Constraints          |
|----------|--------|----------|----------------------|
| email    | string | Yes      | Valid email format   |
| password | string | Yes      | Minimum 6 characters |

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

## Cotizador

### POST /cotizador/auto

Requests an auto insurance quote from the Triunfo API. If the request includes a valid JWT, the quote is saved to the database linked to that user. Unauthenticated requests are allowed — the quote is saved without a user association.

**Auth required:** No (optional — send Bearer token to associate the quote with a user)

**Request body**

| Field           | Type   | Required | Constraints                              |
|-----------------|--------|----------|------------------------------------------|
| marca           | string | Yes      | Triunfo brand code                       |
| modelo          | string | Yes      | Triunfo model code                       |
| anioFabricacion | number | Yes      | Integer between 1900 and current year +1 |
| codigoPostal    | number | Yes      | Integer                                  |

```json
{
  "marca": "2",
  "modelo": "12345",
  "anioFabricacion": 2020,
  "codigoPostal": 1425
}
```

**Responses**

`201 Created` — Raw Triunfo API response. Key field:
```json
{
  "SDTSrvCotizacionOut": {
    "PresupuestoNro": 987654,
    "..."
  }
}
```

`400 Bad Request` — Validation error (missing or invalid fields)

`401 Unauthorized` — Triunfo token could not be obtained

---

## InfoAuto

Proxies the InfoAuto API (`INFOAUTO_BASE_URL`) to expose vehicle data for the quotation form.
All endpoints are public. Responses include a `pagination` object parsed from the `X-Pagination` header.

### GET /infoauto/brands

Returns a paginated list of vehicle brands for the brand selector.

**Auth required:** No

**Query params**

| Param        | Type   | Required | Constraints       |
|--------------|--------|----------|-------------------|
| query_string | string | No       | Max 100 chars     |
| page         | number | No       | Integer ≥ 1       |
| page_size    | number | No       | Integer 1–100     |

**Responses**

`200 OK`
```json
{
  "data": [
    { "id": 1, "name": "Toyota", "logo_url": "https://...", "prices": true, "prices_from": 2010, "prices_to": 2024 }
  ],
  "pagination": { "total": 50, "page": 1, "page_size": 10, "total_pages": 5, "next_page": 2 }
}
```

`502 Bad Gateway` — InfoAuto API unreachable or returned an error

---

### GET /infoauto/brands/:brandId/groups

Returns the groups (model families, e.g. "Corolla", "Hilux") for a given brand.

**Auth required:** No

**Path params**

| Param   | Type    | Required |
|---------|---------|----------|
| brandId | integer | Yes      |

**Query params** — same as `/infoauto/brands`

**Responses**

`200 OK`
```json
{
  "data": [
    { "id": 101, "name": "Corolla", "prices": true, "prices_from": 2015, "prices_to": 2024 }
  ],
  "pagination": { "total": 8, "page": 1, "page_size": 10, "total_pages": 1, "next_page": null }
}
```

`400 Bad Request` — Invalid brandId

`502 Bad Gateway` — InfoAuto API error

---

### GET /infoauto/brands/:brandId/groups/:groupId/models

Returns the specific versions (with their `codia`) for a given brand + group.
The `codia` is the identifier used in `POST /cotizador/auto` as the `modelo` field.

**Auth required:** No

**Path params**

| Param   | Type    | Required |
|---------|---------|----------|
| brandId | integer | Yes      |
| groupId | integer | Yes      |

**Query params** — same as `/infoauto/brands`

**Responses**

`200 OK`
```json
{
  "data": [
    {
      "codia": 12345,
      "description": "Corolla 1.8 XEI CVT",
      "brand": { "id": 1, "name": "Toyota" },
      "group": { "id": 101, "name": "Corolla" },
      "list_price": true,
      "prices": true,
      "prices_from": 2019,
      "prices_to": 2024,
      "photo_url": "https://..."
    }
  ],
  "pagination": { "total": 4, "page": 1, "page_size": 10, "total_pages": 1, "next_page": null }
}
```

`400 Bad Request` — Invalid brandId or groupId

`502 Bad Gateway` — InfoAuto API error

---

## Users

All endpoints require a valid `User` JWT (`Authorization: Bearer <token>`). Users are scoped to the producer of the authenticated user. Every administrator has `role: "admin"` and can manage other administrators (sub-admins).

### GET /users/me

Returns the authenticated user's profile.

**Auth required:** Yes

**Responses**

`200 OK`
```json
{
  "id": 2,
  "email": "test@gmail.com",
  "role": "admin",
  "producerId": 1,
  "createdAt": "2026-06-08T00:00:00.000Z",
  "updatedAt": "2026-06-08T00:00:00.000Z"
}
```

`401 Unauthorized` — Missing or invalid token

---

### PATCH /users/me

Updates the authenticated user's own email and/or password (settings screen).

**Auth required:** Yes

**Request body**

| Field    | Type   | Required | Constraints          |
|----------|--------|----------|----------------------|
| email    | string | No       | Valid email format   |
| password | string | No       | Minimum 6 characters |

```json
{
  "email": "nuevo@gmail.com",
  "password": "newsecret123"
}
```

**Responses**

`200 OK`
```json
{
  "id": 2,
  "email": "nuevo@gmail.com",
  "role": "admin",
  "producerId": 1,
  "createdAt": "2026-06-08T00:00:00.000Z",
  "updatedAt": "2026-06-08T12:00:00.000Z"
}
```

`401 Unauthorized` — Missing or invalid token

`409 Conflict` — Email already in use
```json
{ "statusCode": 409, "message": "Email already in use", "error": "Conflict" }
```

---

### GET /users

Lists all (non-deleted) administrators of the authenticated user's producer.

**Auth required:** Yes

**Responses**

`200 OK`
```json
[
  {
    "id": 2,
    "email": "test@gmail.com",
    "role": "admin",
    "producerId": 1,
    "createdAt": "2026-06-08T00:00:00.000Z",
    "updatedAt": "2026-06-08T00:00:00.000Z"
  }
]
```

`401 Unauthorized` — Missing or invalid token

---

### POST /users

Creates a new administrator (sub-admin) under the authenticated user's producer.

**Auth required:** Yes

**Request body**

| Field    | Type   | Required | Constraints          |
|----------|--------|----------|----------------------|
| email    | string | Yes      | Valid email format   |
| password | string | Yes      | Minimum 6 characters |

```json
{
  "email": "subadmin@gmail.com",
  "password": "secret123"
}
```

**Responses**

`201 Created`
```json
{
  "id": 3,
  "email": "subadmin@gmail.com",
  "role": "admin",
  "producerId": 1,
  "createdAt": "2026-06-08T00:00:00.000Z",
  "updatedAt": "2026-06-08T00:00:00.000Z"
}
```

`401 Unauthorized` — Missing or invalid token

`409 Conflict` — Email already in use
```json
{ "statusCode": 409, "message": "Email already in use", "error": "Conflict" }
```

---

### PATCH /users/:id

Updates an administrator's email and/or password.

**Auth required:** Yes

**Request body**

| Field    | Type   | Required | Constraints          |
|----------|--------|----------|----------------------|
| email    | string | No       | Valid email format   |
| password | string | No       | Minimum 6 characters |

**Responses**

`200 OK`
```json
{
  "id": 3,
  "email": "subadmin@gmail.com",
  "role": "admin",
  "producerId": 1,
  "createdAt": "2026-06-08T00:00:00.000Z",
  "updatedAt": "2026-06-08T12:00:00.000Z"
}
```

`401 Unauthorized` — Missing or invalid token

`404 Not Found` — User does not exist within the producer
```json
{ "statusCode": 404, "message": "User with id 3 not found", "error": "Not Found" }
```

`409 Conflict` — Email already in use

---

### DELETE /users/:id

Soft-deletes an administrator (sets `deletedAt`). A user cannot delete their own account.

**Auth required:** Yes

**Responses**

`200 OK`
```json
{ "id": 3 }
```

`401 Unauthorized` — Missing or invalid token

`403 Forbidden` — Attempting to delete your own account
```json
{ "statusCode": 403, "message": "You cannot delete your own account", "error": "Forbidden" }
```

`404 Not Found` — User does not exist within the producer

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
