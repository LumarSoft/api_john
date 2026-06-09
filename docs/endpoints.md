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

## Admin — Asegurados

All endpoints are scoped to the authenticated user's `producerId` and require a `user` JWT.

### GET /admin/clients

Returns a paginated, searchable and filterable list of insured clients (asegurados) with a summary of their policies.

**Auth required:** Yes

**Query parameters**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `search` | string | No | Max 120 chars. Matches first name, last name, email, DNI, phone or vehicle plate (`dominio`). |
| `riskType` | enum | No | One of `auto`, `home`, `life`, `commercial`, `other`. Filters clients with at least one policy of that risk. |
| `estado` | enum | No | One of `vigente` (has an in-force policy), `por_vencer` (a policy expiring within 30 days), `vencida` (has policies but none in force), `sin_polizas` (no policies). |
| `sort` | enum | No | One of `nombre_asc` (default), `nombre_desc`, `reciente`. |
| `page` | int | No | `>= 1`. Defaults to 1. |
| `pageSize` | int | No | `1..100`. Defaults to 20. |

**Responses**

`200 OK`
```json
{
  "data": [
    {
      "id": 12,
      "firstName": "Juan",
      "lastName": "Pérez",
      "email": "juan@example.com",
      "phone": "+5491155550000",
      "city": "CABA",
      "dni": "30111222",
      "createdAt": "2026-01-10T12:00:00.000Z",
      "polizas": [
        {
          "id": 88,
          "certificado": "000123",
          "riskType": "auto",
          "status": "VIGENTE",
          "vigenciaDesde": "2026-01-01T00:00:00.000Z",
          "vigenciaHasta": "2027-01-01T00:00:00.000Z",
          "premio": "150000.00",
          "vehiculo": { "id": 5, "dominio": "AB123CD", "marca": "Toyota", "modelo": "Corolla", "subModelo": null, "anio": 2022, "cobertura": "C", "sumaAsegurada": "12000000.00" }
        }
      ]
    }
  ],
  "total": 134,
  "page": 1,
  "pageSize": 20,
  "totalPages": 7
}
```

`401 Unauthorized` — Missing or invalid token

### GET /admin/clients/stats

Returns aggregate portfolio metrics for the dashboard/stat bar.

**Auth required:** Yes

**Responses**

`200 OK`
```json
{ "totalClients": 134, "vigentes": 210, "porVencer": 12, "vencidas": 8, "cuotasVencidas": 5 }
```

`401 Unauthorized` — Missing or invalid token

### GET /admin/clients/:id

Returns the full detail of a single insured client, including every policy with its vehicle and instalments (`cuotas`).

**Auth required:** Yes

**Responses**

`200 OK` — Client detail object (see `AdminClientDetail`).

`401 Unauthorized` — Missing or invalid token

`404 Not Found` — Client does not exist within the producer
```json
{ "statusCode": 404, "message": "Client 99 not found", "error": "Not Found" }
```

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


---

## Cobranzas

### GET /admin/cobranzas

Returns a paginated worklist of clients that owe money, enriched with debt stats and total debt per client. Results are filtered to debtors and ordered by urgency (oldest overdue installment first, then largest debt). Used by the admin Cobranzas page. `oldestOverdueDate` is the ISO date of the client's oldest overdue installment, or `null` when the client has no overdue installments.

**Auth required:** Yes (JWT user token)

**Query parameters**

| Parameter | Type   | Required | Description                                                       |
|-----------|--------|----------|-------------------------------------------------------------------|
| search    | string | No       | Filter by first name, last name, email, DNI, phone, or plate      |
| estado    | string | No       | `vencidas` \| `rechazadas` \| `pendientes` \| `todas` (default `todas`) |
| page      | number | No       | Page number (default: 1)                                          |
| pageSize  | number | No       | Results per page (default: 20, max: 100)                          |

**Responses**

`200 OK`
```json
{
  "data": [
    {
      "id": 1,
      "firstName": "María",
      "lastName": "García",
      "dni": "12345678",
      "email": "maria@example.com",
      "phone": "+54 11 1234-5678",
      "ramos": ["auto", "home"],
      "dominio": "AB123CD",
      "pendingCount": 2,
      "overdueCount": 1,
      "rejectedCount": 0,
      "paidCount": 5,
      "totalDeuda": "15420.00",
      "oldestOverdueDate": "2026-04-10T00:00:00.000Z"
    }
  ],
  "total": 40,
  "page": 1,
  "pageSize": 20,
  "totalPages": 2
}
```

`401 Unauthorized` — Missing or invalid JWT

---

### GET /admin/cobranzas/stats

Returns aggregate debt stats across all clients for the authenticated producer. Includes both per-client counts (used by the segmented filter badges) and per-installment counts.

**Auth required:** Yes (JWT user token)

**Responses**

`200 OK`
```json
{
  "clientesConDeuda": 12,
  "clientesVencidas": 7,
  "clientesRechazadas": 2,
  "clientesPendientes": 10,
  "cuotasVencidas": 18,
  "cuotasRechazadas": 3,
  "cuotasPendientes": 47,
  "montoDeudaTotal": "284500.00"
}
```

`401 Unauthorized` — Missing or invalid JWT
