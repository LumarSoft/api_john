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

### POST /cotizador/:vehicleType

Requests a vehicle insurance quote from the Triunfo API. `vehicleType` is the path segment `auto` or `moto`; it selects both the InfoAuto catalog (cars vs motorcycles) and the Triunfo product code (`Articulo` 458 auto / 481 moto). If the request includes a valid JWT, the quote is saved to the database linked to that user. Unauthenticated requests are allowed — the quote is saved without a user association.

**Auth required:** No (optional — send Bearer token to associate the quote with a user)

**Path params**

| Param       | Type   | Constraints     |
|-------------|--------|-----------------|
| vehicleType | string | `auto` or `moto` |

The vehicle value is resolved from InfoAuto (0km list price, or used price by year) and sent to Triunfo. The raw Triunfo response is persisted as `Cotizacion` (with `vehicleType`); the endpoint returns a normalized result with one entry per valid coverage, sorted by premium ascending.

**Request body**

| Field           | Type   | Required | Constraints                              |
|-----------------|--------|----------|------------------------------------------|
| brand           | string | Yes      | InfoAuto brand id                        |
| model           | string | Yes      | InfoAuto CODIA                           |
| manufactureYear | number | Yes      | Integer between 1900 and current year +1 |
| postalCode      | number | Yes      | Integer                                  |
| coverage        | string | No       | Triunfo coverage code — empty quotes all |

```json
{
  "brand": "2",
  "model": "12345",
  "manufactureYear": 2020,
  "postalCode": 1425
}
```

**Responses**

`201 Created`
```json
{
  "quoteNumber": "15464992",
  "validUntil": "2026-06-25",
  "vehicleValue": "5000000.00",
  "coverages": [
    {
      "code": "A",
      "paymentOptions": [
        { "code": "6", "name": "Contado", "premium": 59228, "installmentValue": 59228, "installments": 1 },
        { "code": "1", "name": "Débito Automático", "premium": 60889, "installmentValue": 60889, "installments": 1 }
      ]
    }
  ],
  "messages": []
}
```

`messages` contains Triunfo error descriptions (e.g. `"Código de modelo no válido"`) when the quote returns no coverages.

`400 Bad Request` — Validation error (missing or invalid fields)

`401 Unauthorized` — Triunfo token could not be obtained

`502 Bad Gateway` — Triunfo cotizador unreachable or returned an unexpected response

### POST /cotizador/:vehicleType/:quoteNumber/solicitud

Records the coverage request (lead) for an existing quote: the coverage the visitor chose, the desired start date, and their personal data. It does not emit the policy — the broker follows up manually (inspection + emission are pending integrations). `vehicleType` (`auto` or `moto`) keeps the path parallel to the quote route; the lead itself is keyed by `quoteNumber`.

**Auth required:** No

**Request body**

| Field      | Type   | Required | Constraints                                          |
|------------|--------|----------|------------------------------------------------------|
| coverage   | string | Yes      | Triunfo coverage code chosen by the visitor (≤ 10)   |
| startDate  | string | Yes      | ISO date `YYYY-MM-DD`, today or later                |
| personType | string | Yes      | `FISICA` or `JURIDICA`                               |
| firstName  | string | Yes      | ≤ 80 — razón social when `personType` is `JURIDICA`  |
| lastName   | string | No       | ≤ 80                                                 |
| email      | string | Yes      | Valid email                                          |
| phone      | string | Yes      | ≤ 25                                                 |
| birthDate  | string | No       | ISO date `YYYY-MM-DD`                                |
| docType    | string | Yes      | `DNI`, `CUIL`, `CUIT` or `PASAPORTE`                 |
| docNumber  | string | Yes      | ≤ 15                                                 |
| address    | string | Yes      | ≤ 160                                                |
| paymentMethod | string | Yes   | `CREDIT`, `DEBIT` or `OTHER`                         |
| cardCompany | string | If card | ≤ 30 — required when `paymentMethod` is `CREDIT`/`DEBIT` |
| cardNumber | string | If card  | 13–19 digits — required when `paymentMethod` is `CREDIT`/`DEBIT` |
| cardExpiry | string | If card  | `YYYYMM`, current month or later — required when `paymentMethod` is `CREDIT`/`DEBIT` |
| cardHolder | string | If card  | ≤ 80 — required when `paymentMethod` is `CREDIT`/`DEBIT` |

With `paymentMethod: "OTHER"` no card data is taken — an agent contacts the applicant by phone to finish the purchase. Card fields sent with `OTHER` are ignored.

```json
{
  "coverage": "C1",
  "startDate": "2026-07-01",
  "personType": "FISICA",
  "firstName": "Juan",
  "lastName": "Pérez",
  "email": "juan@email.com",
  "phone": "3413000000",
  "birthDate": "1990-01-15",
  "docType": "DNI",
  "docNumber": "30123456",
  "address": "Calle Ejemplo 123, Rosario",
  "paymentMethod": "CREDIT",
  "cardCompany": "VISA",
  "cardNumber": "4111111111111111",
  "cardExpiry": "202712",
  "cardHolder": "Juan Pérez"
}
```

**Responses**

`201 Created`
```json
{
  "quoteNumber": "15465802",
  "coverage": "C1",
  "startDate": "2026-07-01"
}
```

`400 Bad Request` — Validation error, `startDate` is in the past, or `cardExpiry` is in the past

`404 Not Found` — No quote exists with that `quoteNumber`

---

## InfoAuto

Proxies the InfoAuto API to expose vehicle data for the quotation form. The `vehicleType` path segment (`auto` or `moto`) selects the catalog: cars (`INFOAUTO_BASE_URL`) or motorcycles (`INFOAUTO_MOTO_BASE_URL`). All endpoints are public. Responses include a `pagination` object parsed from the `X-Pagination` header.

### GET /infoauto/:vehicleType/brands

Returns a paginated list of vehicle brands for the brand selector.

**Auth required:** No

**Path params**

| Param       | Type   | Constraints      |
|-------------|--------|------------------|
| vehicleType | string | `auto` or `moto` |

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

### GET /infoauto/:vehicleType/brands/:brandId/groups

Returns the groups (model families, e.g. "Corolla", "Hilux") for a given brand.

**Auth required:** No

**Path params**

| Param       | Type    | Required | Constraints      |
|-------------|---------|----------|------------------|
| vehicleType | string  | Yes      | `auto` or `moto` |
| brandId     | integer | Yes      |                  |

**Query params** — same as `/infoauto/:vehicleType/brands`

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

### GET /infoauto/:vehicleType/brands/:brandId/groups/:groupId/models

Returns the specific versions (with their `codia`) for a given brand + group.
The `codia` is the identifier used in `POST /cotizador/:vehicleType` as the `model` field.

**Auth required:** No

**Path params**

| Param       | Type    | Required | Constraints      |
|-------------|---------|----------|------------------|
| vehicleType | string  | Yes      | `auto` or `moto` |
| brandId     | integer | Yes      |                  |
| groupId     | integer | Yes      |                  |

**Query params** — same as `/infoauto/:vehicleType/brands`

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

## Admin — Siniestros

Triunfo's API has no claims endpoint, so claims filed through the bot or the client portal are stored locally with `estado: "pendiente"`. The admin reviews them here, files them manually in Triunfo's web, and records the official claim number via `PATCH`.

All endpoints require an employee/admin JWT (`type: "user"`). A client token returns `403`.

### GET /admin/siniestros

Paginated list of the producer's claims, newest first.

**Auth required:** Yes (user JWT)

**Query params**

| Param    | Type   | Required | Constraints                                              |
|----------|--------|----------|----------------------------------------------------------|
| estado   | string | No       | `pendiente`, `en_proceso` or `resuelto`                  |
| search   | string | No       | Matches client name, DNI, certificado or official number |
| page     | number | No       | Default 1                                                |
| pageSize | number | No       | Default 20, max 100                                      |

**Responses**

`200 OK`
```json
{
  "data": [
    {
      "id": 6,
      "tipo": "auto",
      "descripcion": "Granizo, daños en capot y techo",
      "fecha": "2026-06-11T00:00:00.000Z",
      "estado": "pendiente",
      "nroSiniestroCompania": null,
      "adjuntos": null,
      "createdAt": "2026-06-12T13:05:00.000Z",
      "updatedAt": "2026-06-12T13:05:00.000Z",
      "client": { "id": 3, "firstName": "EVELYN", "lastName": "BENITEZ", "dni": "30123456", "email": "evelyn@example.com", "phone": "5491155556666" },
      "poliza": {
        "id": 12,
        "certificado": "334455",
        "company": "triunfo",
        "riskType": "auto",
        "vehiculo": { "dominio": "AB123CD", "marca": "FIAT", "modelo": "CRONOS" }
      }
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1
}
```

`401 Unauthorized` — Missing or invalid JWT

`403 Forbidden` — Token is not an employee/admin token

### GET /admin/siniestros/stats

Claim counters for the admin dashboard. `sinNroCompania` counts claims not yet filed in Triunfo's web.

**Auth required:** Yes (user JWT)

**Responses**

`200 OK`
```json
{ "pendientes": 3, "enProceso": 1, "resueltos": 14, "sinNroCompania": 4 }
```

### GET /admin/siniestros/:id

Detail of a single claim (same shape as the list items).

**Auth required:** Yes (user JWT)

**Responses**

`200 OK` — Claim object

`404 Not Found` — Claim not found in this tenant

### PATCH /admin/siniestros/:id

Progresses the claim and/or records the official Triunfo number after filing it manually. Sending an empty `nroSiniestroCompania` clears it.

**Auth required:** Yes (user JWT)

**Request body**

| Field                | Type   | Required | Constraints                              |
|----------------------|--------|----------|------------------------------------------|
| estado               | string | No*      | `pendiente`, `en_proceso` or `resuelto`  |
| nroSiniestroCompania | string | No*      | Max 50 chars                             |

*At least one field is required.

```json
{ "estado": "en_proceso", "nroSiniestroCompania": "SIN-884213" }
```

**Responses**

`200 OK` — Updated claim object

`400 Bad Request` — Empty body (nothing to update)

`404 Not Found` — Claim not found in this tenant

## Bot (WhatsApp)

All `/bot/*` endpoints require the header `x-bot-secret` matching the `BOT_SECRET` env variable. They are consumed exclusively by `whatsapp-bot-seguros` — the bot never accesses the database directly.

`401 Unauthorized` is returned by every endpoint when the header is missing or invalid, or when `BOT_SECRET` is not configured.

### GET /bot/context/:phoneNumberId

Resolves the producer (tenant) behind a Meta phone number ID, including its system prompt.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`200 OK`
```json
{
  "producerId": 1,
  "producerName": "John Pellegrini Management Group SRL",
  "producerSlug": "john",
  "systemPrompt": "Sos el asistente virtual de..."
}
```

`404 Not Found` — Phone number not registered or producer inactive

### GET /bot/conversation/:phoneNumberId/:waId

Finds or creates the conversation for a WhatsApp user (`waId`) under the producer that owns `phoneNumberId`. Returns the last 10 messages of the **current session** in chronological order and the linked client (or `null` if the user has not identified yet).

**Inactivity timeout (lazy):** if more than `SESSION_TIMEOUT_MINUTES` (env, default 5) elapsed since the last message, a new session is started — older messages are excluded from the response (they remain in the DB until the retention job) and `newSession` is `true` so the bot can greet the user again. The identified client link is kept across sessions. There is no background job: the boundary is evaluated on each inbound message.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`200 OK`
```json
{
  "conversationId": 7,
  "client": null,
  "newSession": false,
  "botPaused": false,
  "flowState": "{\"step\":\"CLIENT_MENU\",\"data\":{}}",
  "messages": [
    { "id": 41, "role": "user", "content": "Hola", "createdAt": "2026-06-12T13:00:00.000Z" },
    { "id": 42, "role": "assistant", "content": "¡Hola! ¿Sos cliente?", "createdAt": "2026-06-12T13:00:02.000Z" }
  ]
}
```

`404 Not Found` — Phone number not registered

### POST /bot/conversation/:conversationId/reset

Resets the conversation session (used by the secret `/reset` dev command in the bot). Moves the session boundary to now so the chat history drops out of the context window on the next message; the identified client link is kept. Old messages stay in the DB until the retention job prunes them.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`201 Created`
```json
{ "ok": true }
```

`404 Not Found` — Conversation not found

### POST /bot/conversation/:conversationId/flow-state

Persists the bot's deterministic flow state for a conversation (the serialized `{ step, data }` snapshot of the state machine), or clears it with `null`. This is what makes the bot stateless: it rehydrates the snapshot on the next inbound message instead of keeping it in process memory, so a restart or deploy doesn't lose the user's place in the flow. The snapshot is returned as `flowState` by `GET /bot/conversation/:phoneNumberId/:waId` and is cleared automatically when a new session starts.

**Auth required:** Yes (`x-bot-secret`)

**Request body**

| Field       | Type           | Required | Constraints                          |
|-------------|----------------|----------|--------------------------------------|
| `flowState` | string \| null | Yes      | string ≤ 20000 chars, or `null` to clear |

```json
{ "flowState": "{\"step\":\"CLIENT_MENU\",\"data\":{}}" }
```

**Responses**

`201 Created`
```json
{ "ok": true }
```

`404 Not Found` — Conversation not found

### POST /bot/conversations/pending-warnings

Sweep used by the bot's inactivity job (runs every minute). Finds the conversations that have been idle longer than `SESSION_TIMEOUT_MINUTES` and have not been warned yet, and **atomically marks them as warned** so the same silence is never warned twice. Each returned item carries the user's `waId` and the Meta `phoneNumberId` the chat came through, so the warning is sent from the same number the user wrote to.

The chat is always finalized (claimed), but the warning is only **returned** during office hours (Mon–Fri 08–16, Argentina time); outside that window the conversations are finalized silently and the response is empty. Legacy conversations with no stored phone number are skipped until the next inbound message backfills it.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`201 Created`
```json
[
  { "conversationId": 7, "waId": "5491155556666", "phoneNumberId": "123456789012345" }
]
```

### POST /bot/conversation/:conversationId/message

Persists a message in the conversation.

**Auth required:** Yes (`x-bot-secret`)

**Request body**

| Field   | Type   | Required | Constraints              |
|---------|--------|----------|--------------------------|
| role    | string | Yes      | `user` or `assistant`    |
| content | string | Yes      | Non-empty, max 10000 chars |

```json
{ "role": "user", "content": "Quiero cotizar mi auto" }
```

**Responses**

`201 Created`
```json
{ "id": 43, "role": "user", "content": "Quiero cotizar mi auto", "createdAt": "2026-06-12T13:01:00.000Z" }
```

`404 Not Found` — Conversation not found

### POST /bot/conversation/:conversationId/identify

Links the conversation to a `Client` found by DNI or license plate within the producer's tenant. Required before calling the client-scoped endpoints below.

**Auth required:** Yes (`x-bot-secret`)

**Request body**

| Field | Type   | Required | Constraints   |
|-------|--------|----------|---------------|
| dni   | string | One of   | 6–11 chars    |
| plate | string | One of   | 5–10 chars    |

```json
{ "dni": "30123456" }
```

**Responses**

`201 Created`
```json
{
  "client": {
    "id": 3,
    "firstName": "EVELYN",
    "lastName": "BENITEZ",
    "dni": "30123456",
    "email": "evelyn@example.com",
    "phone": "5491155556666",
    "city": "CABA"
  },
  "polizasCount": 2
}
```

`400 Bad Request` — Neither `dni` nor `plate` provided

`404 Not Found` — No client matches the given dni/plate

### GET /bot/conversation/:conversationId/polizas

Policies of the identified client, with vehicle summary.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`200 OK`
```json
[
  {
    "id": 12,
    "certificado": "334455",
    "company": "triunfo",
    "riskType": "auto",
    "status": "VIGENTE",
    "vigenciaDesde": "2026-01-01T00:00:00.000Z",
    "vigenciaHasta": "2027-01-01T00:00:00.000Z",
    "paymentMethod": "Débito Automático",
    "vehiculo": { "dominio": "AB123CD", "marca": "FIAT", "modelo": "CRONOS", "anio": 2022, "cobertura": "C" }
  }
]
```

`403 Forbidden` — Conversation has no identified client

### GET /bot/conversation/:conversationId/estado-cuenta

Account status per policy: unpaid installments (pending / overdue / rejected), paid count, and a `tieneRechazos` flag for debit-rejection detection.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`200 OK`
```json
[
  {
    "id": 12,
    "certificado": "334455",
    "riskType": "auto",
    "status": "VIGENTE",
    "paymentMethod": "Débito Automático",
    "vehiculo": { "dominio": "AB123CD", "marca": "FIAT", "modelo": "CRONOS" },
    "cuotasPagas": 4,
    "cuotasImpagas": [
      { "numeroCuota": 5, "amount": "45200.00", "dueDate": "2026-06-10T00:00:00.000Z", "status": "rejected" }
    ],
    "tieneRechazos": true
  }
]
```

`403 Forbidden` — Conversation has no identified client

### GET /bot/conversation/:conversationId/polizas/:polizaId/documentos

Documents of a policy (tarjeta de circulación, certificado de cobertura, cupón de pago) fetched on demand from Triunfo. The policy must belong to the identified client.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`200 OK`
```json
[
  { "codigo": "1001", "nombre": "Tarjeta de Circulación", "url": "https://..." },
  { "codigo": "1000", "nombre": "Certificado de Cobertura", "url": "https://..." }
]
```

`403 Forbidden` — Conversation has no identified client

`404 Not Found` — Policy not found or not owned by the client

### GET /bot/conversation/:conversationId/siniestros

Claims filed by the identified client, newest first, with their internal tracking state.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`200 OK`
```json
[
  {
    "id": 5,
    "tipo": "auto",
    "descripcion": "Choque en Av. Corrientes",
    "fecha": "2026-06-10T00:00:00.000Z",
    "estado": "en_proceso",
    "nroSiniestroCompania": "SIN-884213",
    "createdAt": "2026-06-10T15:00:00.000Z",
    "poliza": { "id": 12, "certificado": "334455", "riskType": "auto" }
  }
]
```

`403 Forbidden` — Conversation has no identified client

### POST /bot/conversation/:conversationId/siniestros

Files a new claim for one of the identified client's policies and notifies the advisor by email. Photos can be attached afterwards via `POST /bot/conversation/:conversationId/adjuntos` (the bot forwards images received over WhatsApp).

**Auth required:** Yes (`x-bot-secret`)

**Request body**

| Field       | Type   | Required | Constraints            |
|-------------|--------|----------|------------------------|
| polizaId    | number | Yes      | Policy of the client   |
| tipo        | string | Yes      | Max 50 chars           |
| fecha       | string | Yes      | ISO date (incident)    |
| descripcion | string | Yes      | Max 5000 chars         |

```json
{ "polizaId": 12, "tipo": "auto", "fecha": "2026-06-11", "descripcion": "Granizo, daños en capot y techo" }
```

**Responses**

`201 Created`
```json
{
  "id": 6,
  "tipo": "auto",
  "descripcion": "Granizo, daños en capot y techo",
  "fecha": "2026-06-11T00:00:00.000Z",
  "estado": "pendiente",
  "nroSiniestroCompania": null,
  "createdAt": "2026-06-12T13:05:00.000Z",
  "poliza": { "id": 12, "certificado": "334455", "riskType": "auto" }
}
```

`403 Forbidden` — Conversation has no identified client

`404 Not Found` — Policy not found or not owned by the client

### POST /bot/conversation/:conversationId/adjuntos

Attaches photos (received by the bot over WhatsApp) to the conversation's most
recent open claim — the latest siniestro of the identified client whose `estado`
is not `resuelto`. The total per claim is capped at 5 attachments, keeping the
most recent. Sent as `multipart/form-data`.

**Auth required:** Yes (`x-bot-secret`)

**Request body** (`multipart/form-data`)

| Field    | Type   | Required | Constraints                                        |
|----------|--------|----------|----------------------------------------------------|
| adjuntos | file[] | Yes      | 1–5 files, ≤5 MB each, jpeg/png/webp/heic/pdf only |

**Responses**

`201 Created`
```json
{ "siniestroId": 6, "adjuntosCount": 2 }
```

`400 Bad Request` — No files received

`403 Forbidden` — Conversation has no identified client

`404 Not Found` — No open siniestro to attach photos to
