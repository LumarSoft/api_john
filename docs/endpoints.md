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

The raw Triunfo response is persisted as `Quote` (with `vehicleType`); the endpoint returns a normalized result with one entry per coverage that is meant to be shown.

Two rules are applied on top of what Triunfo returns:

- **Payment methods** — only `Débito Automático` (`1`) and `Plan de Pago` (`9`) are exposed. `Contado` (`6`) is quoted by Triunfo but never shown; see `src/common/payment-methods.ts`.
- **Coverages** — filtered, ordered and captioned according to `CoverageSetting` (see *Admin — Coberturas*). A car coverage is only returned when its content is known: an admin configured it, or its code has office-confirmed default wording. New codes are registered so they show up in the admin screen. Motorcycle quotes always return A, B4 and B1 with fixed moto wording.

`Valor` is sent as `"0"` so Triunfo resolves the market value itself and returns it in `vehicleValue`; the InfoAuto valuation endpoints are not part of the current subscription.

**Request body**

| Field           | Type   | Required | Constraints                              |
|-----------------|--------|----------|------------------------------------------|
| brand           | string | Yes      | InfoAuto brand id                        |
| model           | string | Yes      | InfoAuto CODIA                           |
| manufactureYear | number | Yes      | Integer between 1900 and current year +1 |
| postalCode      | number | Yes      | Integer between 1000 and 9499 (Argentine postal code) |
| coverage        | string | No       | Triunfo coverage code — empty quotes all |
| zeroKm          | boolean | No      | Brand new, not registered: sent as `CeroKM` 1. Only for the current or previous model year |
| hasGnc          | boolean | No      | Cars: the vehicle has GNC. Not priced yet (the accessory code is unknown): `messages` says the price leaves the equipment out |

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
      "name": "Responsabilidad Civil",
      "tagline": "La cobertura obligatoria para circular",
      "benefits": ["Daños a terceros, personas y cosas", "Asistencia y defensa legal"],
      "exclusions": ["Robo, incendio o daños de tu propio auto"],
      "deductible": null,
      "highlighted": false,
      "paymentOptions": [
        { "code": "1", "name": "Débito Automático", "premium": 67825, "installmentValue": 67825, "installments": 1 },
        { "code": "9", "name": "Plan de Pago", "premium": 71713, "installmentValue": 71713, "installments": 1 }
      ]
    }
  ],
  "valuationMissing": false,
  "messages": []
}
```

`messages` contains Triunfo error descriptions (e.g. `"Código de modelo no válido"`) when the quote returns no coverages, and notices the client must read with the prices (valuation missing, a motorcycle coverage without price, GNC not included).

`deductible` is the franquicia the client pays on each claim (D2, D3, D4), or `null`. It is not an exclusion.

Prices are monthly: with `CantidadCuotas` 1, `premium` equals `installmentValue`, the amount of each monthly installment.

`valuationMissing` is `true` when Triunfo could not value the vehicle (`vehicleValue` 0) and therefore priced only Responsabilidad Civil, rejecting every other coverage as "no válida". It is a temporary failure, not a final answer: `messages` then explains that an advisor quotes the remaining coverages, and the bot alerts the office.

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
| paymentMethod | string | Yes   | `CREDIT`, `DEBIT` or `OTHER` — preferred method only |

Card data is never taken or stored: an agent contacts the applicant to finish the payment when issuing the policy. Card fields are rejected as unknown properties.

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
  "paymentMethod": "CREDIT"
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

`400 Bad Request` — Validation error or `startDate` is in the past

`404 Not Found` — No quote exists with that `quoteNumber`

---

## InfoAuto

Proxies the InfoAuto API to expose vehicle data for the quotation form. The `vehicleType` path segment (`auto` or `moto`) selects the catalog: cars (`INFOAUTO_BASE_URL`) or motorcycles (`INFOAUTO_MOTO_BASE_URL`). All endpoints are public. Responses include a `pagination` object parsed from the `X-Pagination` header.

The motorcycle catalog uses separate `INFOAUTO_MOTO_EMAIL` and `INFOAUTO_MOTO_PASSWORD` credentials (falling back to the car credentials when empty). If it is not configured, motorcycle catalog and quote requests return `503 Service Unavailable`.

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

### GET /infoauto/:vehicleType/brands/:brandId/models

Returns every model/version for a brand without requiring an InfoAuto group.
The motorcycle form and bot use this route so customers can search familiar
names such as `NAVI 110` without knowing technical classifications such as
`CUB/BUSINESS DESDE 1 A 300 CC`.

**Auth required:** No

**Path params**

| Param       | Type    | Required | Constraints      |
|-------------|---------|----------|------------------|
| vehicleType | string  | Yes      | `auto` or `moto` |
| brandId     | integer | Yes      |                  |

**Query params** — same as `/infoauto/:vehicleType/brands`

The response has the same shape as the grouped models endpoint below.

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
| name     | string | No       | Max 80 characters; how the office calls the person ("Mili"). Empty string clears it |

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
| name     | string | No       | Max 80 characters; how the office calls the person ("Mili") |

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
| name     | string | No       | Max 80 characters; how the office calls the person ("Mili"). Empty string clears it |

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

## Admin — Configuración

### GET /admin/config

Configuración del bot de la organización del usuario autenticado, incluido quién fue el último en encender o apagar el bot y cuándo.

**Auth required:** Yes (admin)

**Responses**

`200 OK`
```json
{
  "botName": "Nico",
  "botEnabled": false,
  "staffNames": ["Mili", "Milagros"],
  "lastBotStatusChange": {
    "botEnabled": false,
    "at": "2026-10-06T11:12:00.000Z",
    "by": "mili@jpmg.com"
  }
}
```

`lastBotStatusChange` es `null` cuando el switch nunca se usó desde que existe la auditoría. `staffNames` son los nombres de las personas de la oficina a las que los clientes les escriben por nombre (lista vacía si no hay).

### PATCH /admin/config

Actualiza el nombre con el que se presenta el bot y los nombres de las personas de la oficina. Solo cambian los campos enviados. Un `botName` vacío vuelve al nombre por defecto; una lista `staffNames` vacía borra los nombres. Si un mensaje nombra a una de esas personas ("Hola Mili"), el bot le deja un aviso a la oficina y sigue atendiendo al cliente.

**Auth required:** Yes (admin)

**Request body**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| botName | string | No | máx. 60 caracteres |
| staffNames | string[] | No | hasta 10 nombres de máx. 30 caracteres; se descartan vacíos y repetidos |

```json
{ "botName": "Nico", "staffNames": ["Mili", "Milagros"] }
```

**Responses**

`200 OK`
```json
{ "botName": "Nico", "botEnabled": true, "staffNames": ["Mili", "Milagros"] }
```

### PATCH /admin/config/bot-status

Switch global: enciende o apaga todas las respuestas automáticas del bot de la organización. Los mensajes entrantes se siguen guardando en la bandeja. Cada cambio real queda registrado en `BotStatusChange` (quién, cuándo) y se anuncia al dueño por los canales configurados (`BOT_STATUS_ALERT_EMAIL`, `BOT_STATUS_ALERT_PHONE` + `BOT_STATUS_ALERT_TEMPLATE`); sin configuración el aviso solo se loguea. Repetir el estado actual no genera registro ni aviso.

**Auth required:** Yes (SuperAdmin)

**Request body**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| botEnabled | boolean | Yes | — |

```json
{ "botEnabled": false }
```

**Responses**

`200 OK`
```json
{ "botName": "Nico", "botEnabled": false }
```

`403 Forbidden`
```json
{ "statusCode": 403, "message": "Forbidden resource", "error": "Forbidden" }
```

`404 Not Found`
```json
{ "statusCode": 404, "message": "Producer not found", "error": "Not Found" }
```

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
| `status` | enum | No | One of `vigente` (has an in-force policy), `por_vencer` (a policy expiring within 30 days), `vencida` (has policies but none in force), `sin_polizas` (no policies). |
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
      "policies": [
        {
          "id": 88,
          "certificateNumber": "000123",
          "riskType": "auto",
          "lastMovement": "REFACTURACION",
          "validFrom": "2026-01-01T00:00:00.000Z",
          "validTo": "2027-01-01T00:00:00.000Z",
          "premium": "150000.00",
          "vehicle": { "id": 5, "licensePlate": "AB123CD", "brand": "Toyota", "model": "Corolla", "version": null, "year": 2022, "coverage": "C", "sumInsured": "12000000.00" }
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
{ "totalClients": 134, "inForce": 210, "expiringSoon": 12, "expired": 8, "overdueInstallments": 5 }
```

`401 Unauthorized` — Missing or invalid token

### GET /admin/clients/:id

Returns the full detail of a single insured client, including every policy with its vehicle and instalments (`installments`).

**Auth required:** Yes

**Responses**

`200 OK` — Client detail object (see `AdminClientDetail`).

`401 Unauthorized` — Missing or invalid token

`404 Not Found` — Client does not exist within the producer
```json
{ "statusCode": 404, "message": "Client 99 not found", "error": "Not Found" }
```

### GET /admin/clients/:id/polizas/:polizaId/documentos

Documents Triunfo has for one policy of the client, fetched live (`RESTDocumentosV2`, see `docs/triunfo-services.md`), most requested first. Same codes as the bot endpoint: `1050` Tarjeta verde (Mercosur), `1000` Certificado de cobertura, `1040` Constancia de pago, `1060` Cuponera de pago, `1020` Póliza, `1030` Cláusulas. The client must be visible to the admin's producer codes, as in `GET /admin/clients`.

**Auth required:** Yes (Bearer token, any panel role)

**Responses**

`200 OK`
```json
[
  { "code": "1050", "name": "Tarjeta verde (Mercosur)", "url": "https://www.triunfonet.com.ar/gauswebtriunfo/servlet/htarjetaverdec?..." },
  { "code": "1020", "name": "Póliza", "url": "https://www.triunfonet.com.ar/gauswebtriunfo/servlet/hpolizap?..." }
]
```

`401 Unauthorized` — Missing or invalid token

`404 Not Found` — The policy is not the client's or the client is not visible to the admin

### GET /admin/clients/:id/polizas/:polizaId/documentos/:code

One of those documents as a PDF download, fetched from Triunfo at the moment.

**Auth required:** Yes (Bearer token, any panel role)

**Responses**

`200 OK` — `Content-Type: application/pdf`, `Content-Disposition: attachment; filename*=UTF-8''Constancia%20de%20pago%20-%20AB123CD.pdf`

`401 Unauthorized` — Missing or invalid token

`404 Not Found` — Policy not visible to the admin, or Triunfo has no document with that code for it

`502 Bad Gateway` — Triunfo did not hand over the PDF

---

## Admin — Dashboard

### GET /admin/dashboard

Returns the aggregated home-dashboard payload for the admin panel: KPI counters, the
upcoming-renewals pipeline (policies expiring per month over the next 6 months plus the
premium at risk), and breakdowns for cartera, solicitudes por estado, cobranzas and
siniestros. All metrics are scoped to the authenticated user's producer.

**Auth required:** Yes (user)

**Responses**

`200 OK`
```json
{
  "kpis": {
    "insuredClients": 134,
    "newRequests": 7,
    "overdueInstallments": 5,
    "totalDebt": "182340.50",
    "openClaims": 3
  },
  "renewals": {
    "premiumAtRisk": "2415000.00",
    "timeline": [
      { "month": "2026-06", "label": "Jun", "total": 9, "premium": "540000.00" },
      { "month": "2026-07", "label": "Jul", "total": 18, "premium": "910000.00" },
      { "month": "2026-08", "label": "Ago", "total": 7, "premium": "320000.00" },
      { "month": "2026-09", "label": "Sep", "total": 12, "premium": "415000.00" },
      { "month": "2026-10", "label": "Oct", "total": 14, "premium": "180000.00" },
      { "month": "2026-11", "label": "Nov", "total": 6, "premium": "50000.00" }
    ]
  },
  "portfolio": { "inForce": 210, "expiringSoon": 12, "expired": 8 },
  "requestsByStatus": { "new": 7, "contacted": 14, "closed": 31 },
  "collections": { "pending": 22, "overdue": 5, "rejected": 2 },
  "claimsByStatus": { "pending": 2, "inProgress": 1, "resolved": 9 }
}
```

`401 Unauthorized` — Missing or invalid token

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
| status    | string | No       | `vencidas` \| `rechazadas` \| `pendientes` \| `todas` (default `todas`) |
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
      "riskTypes": ["auto", "home"],
      "licensePlate": "AB123CD",
      "pendingCount": 2,
      "overdueCount": 1,
      "rejectedCount": 0,
      "paidCount": 5,
      "totalDebt": "15420.00",
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
  "clientsWithDebt": 12,
  "clientsWithOverdue": 7,
  "clientsWithRejected": 2,
  "clientsWithPending": 10,
  "overdueInstallments": 18,
  "rejectedInstallments": 3,
  "pendingInstallments": 47,
  "totalDebt": "284500.00"
}
```

`401 Unauthorized` — Missing or invalid JWT

## Admin — Siniestros

Triunfo's API has no claims endpoint, so claims filed through the bot or the client portal are stored locally with `status: "pending"`. The admin reviews them here, files them manually in Triunfo's web, and records the official claim number via `PATCH`.

All endpoints require an employee/admin JWT (`type: "user"`). A client token returns `403`.

### GET /admin/siniestros

Paginated list of the producer's claims, newest first.

**Auth required:** Yes (user JWT)

**Query params**

| Param    | Type   | Required | Constraints                                              |
|----------|--------|----------|----------------------------------------------------------|
| status   | string | No       | `pending`, `in_progress` or `resolved`                   |
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
      "type": "auto",
      "description": "Granizo, daños en capot y techo",
      "occurredAt": "2026-06-11T00:00:00.000Z",
      "status": "pending",
      "insurerClaimNumber": null,
      "attachments": null,
      "createdAt": "2026-06-12T13:05:00.000Z",
      "updatedAt": "2026-06-12T13:05:00.000Z",
      "client": { "id": 3, "firstName": "EVELYN", "lastName": "BENITEZ", "dni": "30123456", "email": "evelyn@example.com", "phone": "5491155556666" },
      "policy": {
        "id": 12,
        "certificateNumber": "334455",
        "company": "triunfo",
        "riskType": "auto",
        "vehicle": { "licensePlate": "AB123CD", "brand": "FIAT", "model": "CRONOS" }
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

Claim counters for the admin dashboard. `withoutInsurerNumber` counts claims not yet filed in Triunfo's web.

**Auth required:** Yes (user JWT)

**Responses**

`200 OK`
```json
{ "pending": 3, "inProgress": 1, "resolved": 14, "withoutInsurerNumber": 4 }
```

### GET /admin/siniestros/:id

Detail of a single claim (same shape as the list items).

**Auth required:** Yes (user JWT)

**Responses**

`200 OK` — Claim object

`404 Not Found` — Claim not found in this tenant

### PATCH /admin/siniestros/:id

Progresses the claim and/or records the official Triunfo number after filing it manually. Sending an empty `insurerClaimNumber` clears it.

**Auth required:** Yes (user JWT)

**Request body**

| Field                | Type   | Required | Constraints                              |
|----------------------|--------|----------|------------------------------------------|
| status               | string | No*      | `pending`, `in_progress` or `resolved`   |
| insurerClaimNumber   | string | No*      | Max 50 chars                             |

*At least one field is required.

```json
{ "status": "in_progress", "insurerClaimNumber": "SIN-884213" }
```

**Responses**

`200 OK` — Updated claim object

`400 Bad Request` — Empty body (nothing to update)

`404 Not Found` — Claim not found in this tenant

## Admin — Bandeja (Inbox)

### GET /admin/inbox

Active conversations for the producer (defaults to `open` + `pending`), pending ones first.

**Auth required:** Yes (user JWT)

**Query params**

| Param  | Type   | Required | Constraints                                                  |
|--------|--------|----------|--------------------------------------------------------------|
| status | string | No       | `open`, `pending` or `closed`                                |
| search | string | No       | Matches client name, DNI, contact name or the WhatsApp number (`waId`) |

**Responses**

`200 OK` — Array of conversation summaries. `contactName` is who writes from this number (name saved in the WhatsApp Business address book, else their WhatsApp profile name). `client` is the last insured they identified with (null if none) and `clientIsContact` says whether that client's stored phone is this WhatsApp number — when it is `false` the writer asked on someone else's behalf. `lastMessage` is the latest message of any role for the list preview (`content` collapsed to one line and cut at 120 characters; `mediaType` is `image`, `audio`, `file` or `null`), or `null` for an empty chat.
```json
[
  {
    "id": 1,
    "waId": "5493411234567",
    "status": "pending",
    "botPaused": false,
    "assignedToUserId": null,
    "assignedTo": null,
    "handedOverAt": null,
    "lastMessageAt": "2026-06-22T19:39:00.000Z",
    "sessionStartedAt": "2026-06-22T19:18:00.000Z",
    "phoneNumberId": "1234567890",
    "contactName": "Evelyn",
    "client": { "id": 3, "firstName": "EVELYN", "lastName": "BENITEZ", "dni": "30123456" },
    "clientIsContact": true,
    "lastMessage": {
      "role": "assistant",
      "content": "Hola Evelyn, ¿en qué te puedo ayudar?",
      "mediaType": null,
      "createdAt": "2026-06-22T19:39:00.000Z"
    }
  }
]
```

`401 Unauthorized` — Missing or invalid JWT

`403 Forbidden` — Token is not an employee/admin token

### PATCH /admin/inbox/:id/contact

Manual fix of who a chat belongs to. `contactName` sets the name shown for whoever writes from this number (it wins over the address book and the WhatsApp profile name, which the bot refreshes on every message); empty or `null` goes back to the automatic name. `unlinkClient: true` removes the linked client — e.g. someone who asked with another person's DNI — and the bot asks for identification again on the next message.

**Auth required:** Yes (user JWT)

**Request body**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| contactName | string \| null | No | ≤ 191 chars; empty or `null` = automatic name |
| unlinkClient | boolean | No | `true` removes the linked client |

```json
{ "contactName": "John Pellegrini", "unlinkClient": true }
```

**Responses**

`200 OK` — The conversation summary, as in `GET /admin/inbox`.

`404 Not Found` — Conversation not found or outside the user's scope

### GET /admin/inbox/:id/messages

Full stored history of a conversation in chronological order — not limited to the current bot session (live messages are kept `MESSAGE_RETENTION_DAYS`, default 30). Capped at the latest 500 messages. Opening the thread clears its unread counter.

**Auth required:** Yes (user JWT)

**Responses**

`200 OK`
```json
[
  { "id": 41, "role": "user", "content": "Hola", "createdAt": "2026-06-12T13:00:00.000Z", "media": null },
  { "id": 42, "role": "assistant", "content": "¡Hola! ¿Sos cliente?", "createdAt": "2026-06-12T13:00:02.000Z", "media": null }
]
```

`404 Not Found` — Conversation not found or outside the user's scope

### POST /admin/inbox/:id/media

Sends a photo or a PDF to the customer from the Whatsapp section, with an optional caption. Same rules as a text reply: the chat must be taken (or human attention active for the whole organization) and the customer must have written in the last 24 hours. The bot uploads the file to Meta and sends it; only after WhatsApp accepts it is the message stored (`role: "agent"`). The file lives in `uploads/inbox`, is served only through signed URLs and is deleted after `AUDIO_RETENTION_DAYS` (default 30) like voice notes. Without a caption the message text is `[foto]` or `[documento <name>]`.

**Auth required:** Yes (user JWT)

**Request body** (`multipart/form-data`)

| Field   | Type   | Required | Constraints |
|---------|--------|----------|-------------|
| file    | file   | Yes      | `image/jpeg` or `image/png` up to 5 MB (WhatsApp's limit for photos), or `application/pdf` up to 16 MB |
| caption | string | No       | Max 1024 characters |

**Responses**

`201 Created`
```json
{
  "id": 87,
  "role": "agent",
  "content": "Tu cupón de octubre",
  "createdAt": "2026-10-13T14:02:00.000Z",
  "media": {
    "url": "https://api.example.com/uploads/inbox/1791900000000-123.pdf?exp=1791986400&sig=…",
    "mimeType": "application/pdf",
    "originalName": "Cupon octubre.pdf",
    "size": 48213,
    "tipo": null
  }
}
```

`400 Bad Request` — No file, a file type other than JPEG/PNG/PDF, a photo over 5 MB, no phone number on the chat, or the 24-hour window expired

`403 Forbidden` — The chat is still attended by the bot

`409 Conflict` — The chat's WhatsApp number was removed in Números, or Meta disconnected it (`"El número de WhatsApp está desconectado de Meta: hay que reconectarlo desde Números. El mensaje no se envió."`). Nothing is sent or stored. The same check and messages apply to `POST /admin/inbox/:id/message`.

`502 Bad Gateway` — WhatsApp rejected the send; `message` says why in the agent's words (number disconnected, 24-hour window closed, …). Nothing is stored.

`413 Payload Too Large` — File over 16 MB

`404 Not Found` — Conversation not found or outside the user's scope

`500 Internal Server Error` — The bot or WhatsApp did not accept the file; nothing is stored

## Admin — Novedades

A notifications feed for the panel. A novedad is created automatically when a new claim is filed (`type: "siniestro"`, `refId` = claim id) or when a customer asks to talk to a human advisor (`type: "handoff"`, `refId` = conversation id). `title`/`body` are denormalized at creation; open the source entity via `refId` for full detail (e.g. `GET /admin/siniestros/:refId` for claims, or the inbox for handoffs).

All endpoints require an employee/admin JWT (`type: "user"`). A client token returns `403`.

### GET /admin/novedades

Paginated list of novedades, unread first then newest.

**Auth required:** Yes (user JWT)

**Query params**

| Param    | Type    | Required | Constraints                          |
|----------|---------|----------|--------------------------------------|
| type     | string  | No       | `siniestro` or `handoff`               |
| unread   | boolean | No       | `true` returns only unread novedades   |
| search   | string  | No       | Matches the linked client's name or DNI |
| clientId | number  | No       | Restrict to a single client's novedades |
| page     | number  | No       | Default 1                              |
| pageSize | number  | No       | Default 20, max 100                    |

**Responses**

`200 OK` — `client` is the linked insured (null for an unidentified handoff).
```json
{
  "data": [
    {
      "id": 8,
      "type": "siniestro",
      "refId": 6,
      "title": "Nuevo siniestro · Evelyn Benitez",
      "body": "Choque de frente, daños en el paragolpes",
      "readAt": null,
      "createdAt": "2026-06-22T19:39:00.000Z",
      "client": { "id": 3, "firstName": "EVELYN", "lastName": "BENITEZ", "dni": "30123456" }
    },
    {
      "id": 7,
      "type": "handoff",
      "refId": 1,
      "title": "Pedido de asesor · Ana Gómez",
      "body": null,
      "readAt": "2026-06-22T18:10:00.000Z",
      "createdAt": "2026-06-22T18:02:00.000Z",
      "client": { "id": 5, "firstName": "Ana", "lastName": "Gómez", "dni": "27888999" }
    }
  ],
  "total": 2,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1
}
```

`401 Unauthorized` — Missing or invalid JWT

`403 Forbidden` — Token is not an employee/admin token

### GET /admin/novedades/stats

Unread counters for the sidebar badge and category filters.

**Auth required:** Yes (user JWT)

**Responses**

`200 OK`
```json
{ "unreadTotal": 3, "unreadClaims": 2, "unreadHandoff": 1 }
```

### PATCH /admin/novedades/read-all

Marks every unread novedad as read. Restrict to one category with `?type=`.

**Auth required:** Yes (user JWT)

**Query params**

| Param | Type   | Required | Constraints              |
|-------|--------|----------|--------------------------|
| type  | string | No       | `siniestro` or `handoff` |

**Responses**

`200 OK`
```json
{ "updated": 3 }
```

### PATCH /admin/novedades/:id/read

Marks a single novedad as read (idempotent — re-marking a read novedad is a no-op).

**Auth required:** Yes (user JWT)

**Responses**

`200 OK` — Updated novedad object

`404 Not Found` — Novedad not found in this tenant

## Admin — Tareas

Internal tasks the office leaves each other, outside the bot ("Tareas" in the panel): a call to return, a document to send. Someone creates a task for a person of the same organization, who works it, moves it between `PENDING`, `IN_PROGRESS` and `DONE`, and can reply in its comments. A task is visible to whoever created it, whoever has it assigned and any SuperAdmin of the organization; tasks are not scoped by producer code. All endpoints require a user JWT.

A task in every response:
```json
{
  "id": 12,
  "title": "Llamar a Pérez por la renovación",
  "description": "Llamó a las 10, quiere cambiar la cobertura del Gol.",
  "status": "PENDING",
  "dueDate": "2026-10-14T00:00:00.000Z",
  "contactName": "Lucas Pérez",
  "contactPhone": "341 555-1234",
  "seenAt": null,
  "completedAt": null,
  "createdAt": "2026-10-13T12:00:00.000Z",
  "updatedAt": "2026-10-13T12:00:00.000Z",
  "createdBy": { "id": 1, "name": "John", "email": "john@example.com" },
  "assignedTo": { "id": 2, "name": "Mili", "email": "mili@example.com" },
  "comments": [
    { "id": 4, "body": "Le dejé mensaje", "createdAt": "2026-10-13T15:00:00.000Z", "user": { "id": 2, "name": "Mili", "email": "mili@example.com" } }
  ]
}
```
`seenAt` is null while the assignee has not seen the task, or when someone else replied after they last looked.

### GET /admin/tasks

**Auth required:** Yes (user JWT)

| Query  | Values | Default | Meaning |
|--------|--------|---------|---------|
| view   | `mine`, `created`, `all` | `mine` | Assigned to me, created by me, or the whole office (`all` returns everything only to a SuperAdmin; anyone else gets the tasks they created or have assigned) |
| status | `open`, `done` | `open` | Pending + in progress (soonest due date first), or the latest 100 finished |

`200 OK` — Array of tasks.

### GET /admin/tasks/stats

`200 OK` — Open tasks assigned to the user and how many of them are unseen, for the menu badge.
```json
{ "open": 3, "unseen": 1 }
```

### GET /admin/tasks/people

People a task can be assigned to: the organization's users (the platform OWNER excluded).

`200 OK`
```json
[{ "id": 2, "name": "Mili", "email": "mili@example.com", "role": "ADMIN" }]
```

### POST /admin/tasks/seen

Marks every task assigned to the user as seen (the panel calls it when the user opens their tasks).

`201 Created`
```json
{ "seen": 2 }
```

### POST /admin/tasks

**Request body**

| Field            | Type   | Required | Constraints |
|------------------|--------|----------|-------------|
| title            | string | Yes      | 1–200 characters |
| description      | string | No       | Max 5000 characters |
| assignedToUserId | number | Yes      | A user of the same organization (not the OWNER) |
| dueDate          | string | No       | `YYYY-MM-DD` |
| contactName      | string | No       | Max 120 characters |
| contactPhone     | string | No       | Max 40 characters |

`201 Created` — The task. A task someone assigns to themselves is created as seen.

`400 Bad Request` — Validation error, or the person is not part of the organization

### PATCH /admin/tasks/:id

Any field of `POST /admin/tasks`, plus `status` (`PENDING`, `IN_PROGRESS`, `DONE`). Allowed to the creator, the assignee and SuperAdmins. Moving to `DONE` sets `completedAt`; leaving it clears it. Reassigning marks the task as unseen for the new person.

`200 OK` — The task.

`403 Forbidden` — The task does not involve the user · `404 Not Found` — No such task in the organization

### DELETE /admin/tasks/:id

Soft-deletes the task. Only its creator or a SuperAdmin.

`200 OK`
```json
{ "ok": true }
```

`403 Forbidden` — Not the creator · `404 Not Found` — No such task

### POST /admin/tasks/:id/comments

**Request body**

| Field | Type   | Required | Constraints |
|-------|--------|----------|-------------|
| body  | string | Yes      | 1–2000 characters |

`201 Created` — The task with its comments. A reply from anyone but the assignee marks the task as unseen for the assignee.

`403 Forbidden` — The task does not involve the user · `404 Not Found` — No such task

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
  "botName": "NICO",
  "botEnabled": true,
  "staffNames": ["Mili", "Milagros"],
  "attentionHours": "Lunes a viernes de 8 a 16 hs",
  "systemPrompt": "Sos el asistente virtual de...",
  "llmEnabled": true
}
```

`404 Not Found` — Phone number not registered or producer inactive

### GET /bot/conversation/:phoneNumberId/:waId

Finds or creates the conversation for a WhatsApp user (`waId`) under the producer that owns `phoneNumberId`. Returns the last 10 messages of the **current session** in chronological order and the linked client (or `null` if the user has not identified yet).

**Inactivity timeout (lazy):** if more than `SESSION_TIMEOUT_MINUTES` (env, default 5) elapsed since the last message, a new session is started — older messages are excluded from the response (they remain in the DB until the retention job) and `newSession` is `true` so the bot can greet the user again. There is no background job: the boundary is evaluated on each inbound message.

**Earlier human replies:** `lastHumanReply` is the last message a person from the office wrote in this chat (inbox reply or WhatsApp Business app) within the last 72 hours, whatever the session, or `null`. It is `null` as well once the bot has replied after that person, since the customer is then talking to the bot. `previousActivityAt` is when the chat had activity before this request, also across sessions (`null` for a brand-new chat or after a reset). The bot uses them to stay out of a conversation a person was having and to skip its full introduction for someone it talked to a few hours ago.

**Linked client:** `client` is returned only while the link applies to whoever is writing: always when the client's stored phone is this `waId`, otherwise only within the session in which they identified. Someone who identified with another person's DNI is treated as unidentified on their next session, so the bot asks again instead of greeting them as that person. The client-scoped endpoints below apply the same rule.

**Phone match:** when there is no linked client and exactly one client of the organization has this `waId` as their cartera phone, `phoneMatch` carries that client's first name (`{ "firstName": "JUAN" }`) so the bot can ask "¿hablo con Juan?" instead of the DNI; otherwise `null`. Nothing is linked until the bot calls `identify-by-phone`.

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
  ],
  "lastHumanReply": { "content": "Pasame las fotos que tenés", "createdAt": "2026-06-12T10:15:00.000Z" },
  "previousActivityAt": "2026-06-12T12:58:00.000Z",
  "phoneMatch": null
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

Every claimed chat is finalized, but a conversation is only **returned** (so the bot sends the goodbye) when the bot was running it and left it waiting on the customer: the organization's bot is on, no advisor has taken the chat (`botPaused` false), the last message is the bot's own (`role: "assistant"`, `source: "live"`, not one the office sent from the WhatsApp app), nothing was passed to the office in the current session (an open `handoff` or `baja_poliza` notification created since `sessionStartedAt`: the customer is waiting for the office) and the silence crossed the timeout within the last 10 minutes. Anything else — chats that piled up while the bot was switched off, chats an advisor handled, chats where the customer wrote last — is finalized silently, so re-enabling the bot never sends a burst of goodbyes. Returned items carry `isOpenNow` so the notice can say the office is closed. Legacy conversations with no stored phone number are skipped until the next inbound message backfills it.

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
| media   | object | No       | Upload metadata (`url`, `originalName`, `mimeType`, `size`, `tipo?`) |
| contactName | string | No   | Sender's WhatsApp profile name (inbound only), max 191 chars; stored on the conversation |
| keepActivity | boolean | No | `true` stores the message for the transcript without counting it as activity (no `lastMessageAt`/`warnedAt`/unread change). Used for the inactivity goodbye. |

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
  "policyCount": 2
}
```

`400 Bad Request` — Neither `dni` nor `plate` provided

`404 Not Found` — No client matches the given dni/plate

### POST /bot/conversation/:conversationId/request-policy-cancellation

Leaves a `baja_poliza` notification for the office with the policy, the client's DNI and, when the bot collected it, the reason the client gave (sale, cost, no longer needed, change of insurer or free text). The policy is never cancelled here; the conversation is flagged `pending` for the office.

**Auth required:** Yes (`x-bot-secret`)

**Request body**

| Field    | Type   | Required | Constraints              |
|----------|--------|----------|--------------------------|
| policyId | number | Yes      | Integer ≥ 1, the client's |
| reason   | string | No       | ≤ 300 chars              |

```json
{ "policyId": 833, "reason": "Vendí el vehículo" }
```

**Responses**

`201 Created`
```json
{ "id": 17 }
```

`400 Bad Request` — The conversation has no identified client

`404 Not Found` — The policy is not the identified client's

### POST /bot/conversation/:conversationId/identify-by-phone

Links the conversation to the one client of the producer whose cartera phone is the number writing (the `phoneMatch` of the conversation), after the person confirmed in the chat that it is them. Same response as `identify`.

**Auth required:** Yes (`x-bot-secret`)

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
    "phone": "341155556666",
    "city": "CABA"
  },
  "policyCount": 2
}
```

`404 Not Found` — Conversation not found, or no single client has this phone number

### GET /bot/conversation/:conversationId/polizas

Policies of the identified client **in force today**, with vehicle summary.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`200 OK`
```json
[
  {
    "id": 12,
    "certificateNumber": "334455",
    "company": "triunfo",
    "riskType": "auto",
    "lastMovement": "REFACTURACION",
    "validFrom": "2026-01-01T00:00:00.000Z",
    "validTo": "2027-01-01T00:00:00.000Z",
    "paymentMethod": "Débito Automático",
    "vehicle": { "licensePlate": "AB123CD", "brand": "FIAT", "model": "CRONOS", "year": 2022, "coverage": "C" }
  }
]
```

`403 Forbidden` — Conversation has no identified client

### GET /bot/conversation/:conversationId/estado-cuenta

Account status per policy: unpaid installments (pending / overdue / rejected), paid count, a `hasRejectedInstallments` flag for debit-rejection detection, the policy's `validTo` and `nextDueDate`: when the installment after the latest one billed is due, estimated from the policy's cadence (`null` without due dates or past `validTo`). Triunfo bills a few installments at a time, so the bot uses it to say when the next one shows up.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`200 OK`
```json
[
  {
    "id": 12,
    "certificateNumber": "334455",
    "riskType": "auto",
    "lastMovement": "REFACTURACION",
    "paymentMethod": "Débito Automático",
    "validTo": "2027-01-01T00:00:00.000Z",
    "vehicle": { "licensePlate": "AB123CD", "brand": "FIAT", "model": "CRONOS" },
    "nextDueDate": "2026-07-10T00:00:00.000Z",
    "paidInstallments": 4,
    "unpaidInstallments": [
      { "number": 5, "amount": "45200.00", "dueDate": "2026-06-10T00:00:00.000Z", "status": "rejected" }
    ],
    "hasRejectedInstallments": true
  }
]
```

`403 Forbidden` — Conversation has no identified client

### GET /bot/conversation/:conversationId/polizas/:polizaId/documentos

Documents of a policy fetched on demand from Triunfo (`RESTDocumentosV2`, see `docs/triunfo-services.md`), most requested first. The policy must belong to the identified client. An empty list means Triunfo has nothing for that policy.

Codes: `1050` Tarjeta verde (Mercosur), `1000` Certificado de cobertura, `1040` Constancia de pago, `1060` Cuponera de pago (only some Plan de Pago policies), `1020` Póliza, `1030` Cláusulas. `url` is Triunfo's link: it opens in a browser, but a server must follow its redirect carrying the session cookies (use the endpoint below).

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`200 OK`
```json
[
  { "code": "1050", "name": "Tarjeta verde (Mercosur)", "url": "https://www.triunfonet.com.ar/gauswebtriunfo/servlet/htarjetaverdec?..." },
  { "code": "1000", "name": "Certificado de cobertura", "url": "https://www.triunfonet.com.ar/gauswebtriunfo/servlet/hcertificadoau?..." }
]
```

`403 Forbidden` — Conversation has no identified client

`404 Not Found` — Policy not found or not owned by the client

### GET /bot/conversation/:conversationId/polizas/:polizaId/documentos/:code

One document of a policy as a PDF, downloaded from Triunfo at the moment, for the bot to send it in the chat. `code` is one of the codes listed above.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`200 OK` — `Content-Type: application/pdf`, `Content-Disposition: inline; filename*=UTF-8''Tarjeta%20verde%20(Mercosur)%20-%20AB123CD.pdf`. The file name carries the plate, or the certificate number when the policy has no vehicle.

`403 Forbidden` — Conversation has no identified client

`404 Not Found` — Policy not found, not owned by the client, or Triunfo has no document with that code for it

`502 Bad Gateway` — Triunfo did not hand over the PDF

### GET /bot/conversation/:conversationId/siniestros

Claims filed by the identified client, newest first, with their internal tracking state.

**Auth required:** Yes (`x-bot-secret`)

**Responses**

`200 OK`
```json
[
  {
    "id": 5,
    "type": "auto",
    "description": "Choque en Av. Corrientes",
    "occurredAt": "2026-06-10T00:00:00.000Z",
    "status": "in_progress",
    "insurerClaimNumber": "SIN-884213",
    "createdAt": "2026-06-10T15:00:00.000Z",
    "policy": { "id": 12, "certificateNumber": "334455", "riskType": "auto" }
  }
]
```

`403 Forbidden` — Conversation has no identified client

### POST /bot/conversation/:conversationId/siniestros

Files a new claim for one of the identified client's policies and notifies the advisor by email. The policy must be in force. Photos can be attached afterwards via `POST /bot/conversation/:conversationId/adjuntos` (the bot forwards images received over WhatsApp).

**Auth required:** Yes (`x-bot-secret`)

**Request body**

| Field       | Type   | Required | Constraints            |
|-------------|--------|----------|------------------------|
| policyId    | number | Yes      | Policy of the client   |
| type        | string | Yes      | Max 50 chars           |
| occurredAt  | string | Yes      | ISO date (incident)    |
| description | string | Yes      | Max 5000 chars         |

```json
{ "policyId": 12, "type": "auto", "occurredAt": "2026-06-11", "description": "Granizo, daños en capot y techo" }
```

**Responses**

`201 Created`
```json
{
  "id": 6,
  "type": "auto",
  "description": "Granizo, daños en capot y techo",
  "occurredAt": "2026-06-11T00:00:00.000Z",
  "status": "pending",
  "insurerClaimNumber": null,
  "createdAt": "2026-06-12T13:05:00.000Z",
  "policy": { "id": 12, "certificateNumber": "334455", "riskType": "auto" }
}
```

`403 Forbidden` — Conversation has no identified client

`404 Not Found` — Policy not found, not owned by the client or not in force

### POST /bot/conversation/:conversationId/adjuntos

Attaches photos (received by the bot over WhatsApp) to the conversation's most
recent open claim — the latest claim of the identified client whose `status`
is not `resolved`. A photo sent without `tipo` (outside the guided claim steps)
only joins a claim filed in the last 48 hours; otherwise it is stored for the
inbox and the response says `attached: false`. With `?hold=true` (the customer
is still filling in a new claim, not filed yet) the photo never joins an earlier
claim: it is only stored for the inbox (`attached: false`). The total per claim
is capped at 5 attachments, keeping the most recent. Sent as `multipart/form-data`.

**Auth required:** Yes (`x-bot-secret`)

**Request body** (`multipart/form-data`)

| Field    | Type   | Required | Constraints                                        |
|----------|--------|----------|----------------------------------------------------|
| adjuntos | file[] | Yes      | 1–5 files, ≤5 MB each, jpeg/png/webp/heic/pdf only |

**Responses**

`201 Created`
```json
{ "claimId": 6, "attachmentCount": 2 }
```

`400 Bad Request` — No files received

`403 Forbidden` — Conversation has no identified client

`404 Not Found` — No open siniestro to attach photos to

### POST /bot/waba/:wabaId/disconnected

The bot forwards an `account_update` webhook that may mean the number left Cloud API (`PARTNER_REMOVED`, `ACCOUNT_OFFBOARDED`, `PARTNER_APP_UNINSTALLED`). `PARTNER_REMOVED` on a stored WABA marks it disconnected right away. Any other event, or a WABA id that is not stored (Meta sent one on 19/10/2026), is checked against Graph: a WABA is only marked when Graph answers definitively (the number no longer exists for our token, the token lost its WhatsApp permission, or the number left `CLOUD_API`). A newly marked WABA sends an email to `WHATSAPP_ALERT_EMAIL` (falls back to `BOT_STATUS_ALERT_EMAIL`, then `ADVISOR_EMAIL`). The same Graph check runs every 30 minutes for every connected number (`WHATSAPP_CONNECTION_CHECK_ENABLED=false` turns it off). Only a new onboarding clears the mark.

**Auth required:** Yes (`x-bot-secret`)

**Request body**

| Field       | Type   | Required | Constraints |
|-------------|--------|----------|-------------|
| event       | string | No       | Meta's event, ≤ 64 chars. Missing = `PARTNER_REMOVED` (older bot builds) |
| reason      | string | No       | `disconnection_info.reason`, e.g. `BUSINESS_DOWNGRADE`, ≤ 64 chars |
| initiatedBy | string | No       | `USER` or `SYSTEM`, ≤ 32 chars |

```json
{ "event": "PARTNER_REMOVED", "reason": "BUSINESS_DOWNGRADE", "initiatedBy": "USER" }
```

**Responses**

`201 Created`
```json
{ "known": false, "checked": 1, "disconnected": 1 }
```

`401 Unauthorized` — Missing or wrong `x-bot-secret`

### Reconnecting a number (`POST /admin/whatsapp/onboard`)

Running Embedded Signup again for a number that Meta dropped reuses its `PhoneNumber` row, so the month's usage, the budget and the producer codes stay with it: the row with the same Meta id is revived (even if it is still listed, instead of answering `409`); on Coexistence, if Meta hands out a new `phone_number_id`, the latest deleted or disconnected row of the same WABA (or with the same display number) is re-pointed and its chats move with it. The response adds `"reconnected": true`. `409 Conflict` is only returned when the number is live in another organization. `GET /admin/phone-numbers` now includes `disconnectedAt`, `disconnectReason` and `disconnectReasonLabel` for each number.

## Cotización — Leads (productos sin cotización online)

Para los productos cuyo precio no se cotiza online (bici, comercio, praxis,
personas) o que tienen plan de precio fijo (bolso, hogar), la web y el bot crean
un `ContactLead`. Aparecen en el panel admin unificado (ver "Admin — Solicitudes").

### POST /leads

Crea un lead desde el cotizador web público (productor por defecto).

**Auth required:** No

**Request body**

| Field          | Type   | Required | Constraints                                            |
|----------------|--------|----------|--------------------------------------------------------|
| productType    | string | Yes      | bici, comercio, praxis, personas, bolso, hogar         |
| contactName    | string | Yes      | 1–120 chars                                            |
| phone          | string | Yes      | 1–30 chars                                             |
| email          | string | No       | email válido, ≤160                                     |
| payload        | object | Yes      | campos específicos del producto (JSON libre)           |
| selectedPlanId | number | No       | sólo bolso/hogar; debe existir y coincidir productType |

**Responses**

`201 Created`
```json
{ "id": 12 }
```

`400 Bad Request` — `selectedPlanId` inexistente o no coincide con `productType`

### POST /bot/conversation/:conversationId/audio

Stores a WhatsApp voice note so the inbox can play it next to its transcription. The bot saves the returned metadata as the message `media`. Files live in `uploads/audios`, are served only through signed URLs (like claim photos) and are deleted after `AUDIO_RETENTION_DAYS` (env, default 30) by the daily retention job; the transcription stays in the message.

**Auth required:** Yes (`x-bot-secret`)

**Request body** (`multipart/form-data`)

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| audio | file | Yes | `audio/ogg`, `audio/mpeg`, `audio/mp4`, `audio/aac`, `audio/amr` or `audio/webm`; max 16 MB |

**Responses**

`201 Created`
```json
{
  "filename": "1791230000000-123.ogg",
  "originalName": "audio.ogg",
  "url": "/uploads/audios/1791230000000-123.ogg",
  "mimeType": "audio/ogg",
  "size": 4200
}
```

`400 Bad Request` — No file, or a format that is not audio

`404 Not Found` — Conversation not found

### POST /bot/conversation/:conversationId/leads

Igual que `POST /leads` pero desde el bot: scope al productor de la conversación,
`channel = WHATSAPP`. Mismo body (sin `channel`). A diferencia de la web, acepta
también `productType` `auto` y `moto`: es el pedido de contratación que el cliente
hace en el chat después de una cotización online (cobertura elegida en `payload`).

**Auth required:** Yes (`x-bot-secret`)

```json
{
  "productType": "moto",
  "contactName": "Lucas Pérez",
  "phone": "5493416956364",
  "payload": { "cobertura": "B1 — Todo Total 1", "vehiculo": "HONDA NAVI 110", "anio": 2025, "codigoPostal": 2000 }
}
```

`201 Created` → `{ "id": 12 }`
`404 Not Found` — Conversation no encontrada

### POST /bot/conversation/:conversationId/leads/:leadId/adjuntos

Adjunta las fotos que el cliente manda por WhatsApp para contratar una cotización
(DNI frente y dorso, tarjeta azul) al lead que creó el bot. Se guardan como WebP en
`uploads/leads` (solo accesibles con URL firmada) y se listan en `payload.adjuntos`
(máximo 10, se conservan las más recientes). `multipart/form-data`.

**Auth required:** Yes (`x-bot-secret`)

**Request body** (`multipart/form-data`)

| Field    | Type   | Required | Constraints                                        |
|----------|--------|----------|----------------------------------------------------|
| adjuntos | file[] | Yes      | 1–5 files, ≤5 MB each, jpeg/png/webp/heic/pdf only |

**Query:** `tipo` (opcional) — `dni_frente` \| `dni_dorso` \| `tarjeta_azul`

**Responses**

`201 Created`
```json
{ "leadId": 12, "attachmentCount": 3 }
```

`400 Bad Request` — No files received

`404 Not Found` — El lead no existe o no pertenece a la conversación

## Pricing — Planes de precio fijo

### GET /pricing/:productType

Planes activos del producto (`bolso` | `hogar`) del productor por defecto, para
el cotizador web público.

**Auth required:** No

**Responses**

`200 OK`
```json
[
  {
    "id": 1,
    "productType": "bolso",
    "name": "Básico",
    "monthlyPrice": 4200,
    "description": "Protección esencial para tus efectos personales.",
    "coverageItems": ["Robo en vía pública", "Hurto en transporte"],
    "isActive": true,
    "sortOrder": 1
  }
]
```

`400 Bad Request` — `productType` inválido

### GET /bot/conversation/:conversationId/pricing/:productType

Igual que `GET /pricing/:productType` pero scope al productor de la conversación.

**Auth required:** Yes (`x-bot-secret`)

## Admin — Solicitudes de cotización

Panel unificado: lista los leads (`ContactLead`) y las solicitudes de cobertura
auto/moto (`QuoteRequest`) en un mismo stream. `UserAuthGuard`, scope al productor.

### GET /admin/solicitudes

**Auth required:** Yes (Bearer, type `user`)

**Query params**

| Field       | Type   | Required | Constraints                                        |
|-------------|--------|----------|----------------------------------------------------|
| status      | string | No       | NEW, CONTACTED, CLOSED                              |
| productType | string | No       | auto, moto, bici, comercio, praxis, personas, bolso, hogar |
| kind        | string | No       | lead, cotizacion                                   |
| search      | string | No       | nombre, teléfono o email (≤120)                    |
| page        | number | No       | ≥1                                                 |
| pageSize    | number | No       | 1–100 (default 20)                                 |

**Responses**

`200 OK`
```json
{
  "data": [
    {
      "id": 12, "kind": "lead", "productType": "hogar",
      "contactName": "María P.", "phone": "3410000000", "email": null,
      "summary": "Plan Hogar Integral", "channel": "WEB",
      "status": "NEW", "createdAt": "2026-06-22T20:00:00.000Z"
    }
  ],
  "total": 1, "page": 1, "pageSize": 20, "totalPages": 1
}
```

### GET /admin/solicitudes/:kind/:id

Detalle de una solicitud. `kind` = `lead` | `cotizacion`.

**Auth required:** Yes (Bearer, type `user`)

`200 OK` — campos completos según `kind` (los datos de tarjeta nunca se devuelven)
`404 Not Found`

### PATCH /admin/solicitudes/:kind/:id

Actualiza el seguimiento de una solicitud.

**Auth required:** Yes (Bearer, type `user`)

**Request body**

| Field  | Type   | Required | Constraints              |
|--------|--------|----------|--------------------------|
| status | string | No       | NEW, CONTACTED, CLOSED   |
| notes  | string | No       | ≤2000                    |

`200 OK` → `{ "ok": true }`
`400 Bad Request` — nada para actualizar

## Admin — Planes de precio fijo

CRUD de `ProductPlan` (bolso, hogar). `UserAuthGuard`, scope al productor.

### GET /admin/pricing

Lista todos los planes (activos e inactivos) del productor.

**Auth required:** Yes (Bearer, type `user`)

### POST /admin/pricing

**Auth required:** Yes (Bearer, type `user`)

**Request body**

| Field         | Type     | Required | Constraints                  |
|---------------|----------|----------|------------------------------|
| productType   | string   | Yes      | bolso, hogar                 |
| name          | string   | Yes      | 1–80                         |
| monthlyPrice  | number   | Yes      | ≥0, 2 decimales              |
| description   | string   | No       | ≤500                         |
| coverageItems | string[] | Yes      | ≤20 items, cada uno ≤120     |
| isActive      | boolean  | No       | default true                 |
| sortOrder     | number   | No       | ≥0, default 0                |

`201 Created` → plan creado

### PATCH /admin/pricing/:id

Igual al body de creación pero todos los campos opcionales (`productType` no es
modificable).

**Auth required:** Yes (Bearer, type `user`)

`200 OK` → plan actualizado
`404 Not Found`

### DELETE /admin/pricing/:id

Soft delete del plan.

**Auth required:** Yes (Bearer, type `user`)

`200 OK` → `{ "ok": true }`
`404 Not Found`

---

## Public

Unauthenticated read-only data shared by the public web and the WhatsApp bot.
Single source of truth so the site and the bot never contradict each other.

### GET /public/products

Canonical product catalog (marketing copy, **no prices**). Prices come from
Triunfo (auto/moto) and `ProductPlan` (bolso/hogar).

**Auth required:** No

`200 OK`
```json
[
  {
    "id": "auto",
    "label": "Auto",
    "sub": "Todo riesgo, terceros completo",
    "summary": "Cobertura para vehículos particulares y comerciales…",
    "includes": ["Responsabilidad civil", "Robo, hurto y daño total"],
    "excludes": ["Conducción sin registro"],
    "flow": "instant"
  }
]
```

### GET /public/producer

Public attention window of the default producer (`DEFAULT_PRODUCER_SLUG`, default
`john`). Falls back to the app default when unset.

**Auth required:** No

`200 OK`
```json
{ "attentionHours": "Lunes a viernes de 8 a 16 hs" }
```

---

## Business hours

Weekly schedule (Mon–Sun, split shifts supported) + temporary closures. Single
source of truth for the bot and the public web. Admin routes are scoped to the
caller's producer; the public route serves the default producer.

Schedule JSON shape: `{ mon: [{ "from": "09:00", "to": "12:00" }], ..., sun: [] }`
(empty array = closed that day).

National holidays are loaded automatically as closures of every active
organization (`HolidaySyncService`: on boot and every Monday 05:00 ART, from
api.argentinadatos.com, which mirrors argentina.gob.ar/feriados). They carry
`source: "holiday"` and reason `feriado nacional: <nombre>`. Deleting one from the
admin screen sticks (the sync does not create it again); an upcoming one that
disappears from its year's calendar is removed. Env: `HOLIDAY_SYNC_ENABLED`
(`false` turns it off), `HOLIDAY_TYPES` (default `inamovible,trasladable`; add
`puente` to also close on días no laborables con fines turísticos).

### GET /admin/business-hours

Current weekly schedule + active/upcoming closures.

**Auth required:** Yes (Bearer, type `user`)

`200 OK`
```json
{
  "weekly": { "mon": [{ "from": "09:00", "to": "12:00" }, { "from": "17:00", "to": "19:30" }], "sat": [], "sun": [] },
  "closures": [{ "id": 3, "startDate": "2026-06-24", "endDate": "2026-06-24", "reason": "Día de la Bandera" }]
}
```

### PATCH /admin/business-hours/schedule

**Auth required:** Yes (Bearer, type `user`)

**Request body**

| Field  | Type   | Required | Constraints |
|--------|--------|----------|-------------|
| weekly | object | Yes      | 7 day keys; each an array of `{from,to}` HH:mm, `from` < `to`, no overlaps |

`200 OK` → `{ "weekly": { ... } }`
`400 Bad Request` → invalid HH:mm / overlapping ranges

### POST /admin/business-hours/closures

Adds a temporary closure (single day → `startDate == endDate`).

**Auth required:** Yes (Bearer, type `user`)

**Request body**

| Field     | Type   | Required | Constraints |
|-----------|--------|----------|-------------|
| startDate | string | Yes      | YYYY-MM-DD |
| endDate   | string | Yes      | YYYY-MM-DD, ≥ startDate |
| reason    | string | Yes      | 1–160 chars |

`201 Created` → `{ "id": 3, "startDate": "...", "endDate": "...", "reason": "..." }`

### DELETE /admin/business-hours/closures/:id

Soft-deletes a closure.

**Auth required:** Yes (Bearer, type `user`)

`200 OK` → `{ "ok": true }`
`404 Not Found`

### GET /public/hours

Live hours for the default producer: formatted week, open-now and ready copy.

**Auth required:** No

`200 OK`
```json
{
  "formatted": "Lunes a viernes de 9 a 12 y de 17 a 19:30 hs · Sábado de 9 a 13 hs",
  "isOpenNow": false,
  "todayClosure": null,
  "message": "Ahora estamos fuera de horario. Nuestro horario es: …. Volvemos a atender hoy a las 17 hs.",
  "closedNote": "_Ahora estamos fuera de horario; te respondemos al reabrir (hoy a las 17 hs)._"
}
```

## Admin — Coberturas

How each Triunfo auto coverage is shown in the quote results.

Rows are never created or deleted by hand: a coverage appears the first time Triunfo quotes its code, with `isConfigured: false`. Which coverages Triunfo quotes for a given vehicle and year is Triunfo's decision and is not configurable — these settings only decide, among the ones it did quote, which are shown, in what order and with what wording.

Codes of the same letter are different products (B includes destrucción total, B1 does not), so wording is never derived from the letter. Each code is described from Triunfo's product manual (A, B0, B, B1, B3, B4, C, C1, C2, C8, D, D2, D3, D4, in `src/coverage-settings/coverage-defaults.ts`); an unconfigured row of those codes reads with that description. A code the manual does not describe (C7 today) is hidden from quotes (`needsReview: true`) until an admin writes what it includes — guessing would promise coverage the policy may not have.

Triunfo quotes up to 14 car coverages for a new car, so an unconfigured row also follows a default visibility: A, B, B1, C2 and D3 are offered, the other described codes are not (`isActive: false` in the listing) until an admin switches them on. Once a row is configured, its own `isActive` decides. The first edit of an unconfigured row, even a visibility toggle, stores the wording and visibility the admin was shown.

In a quote, the coverages recommended for that vehicle year (`highlighted`, within `highlightYearFrom`–`highlightYearTo` when set) come first with the badge, then the rest by `sortOrder`. The web and the WhatsApp bot show them in that order.

### GET /admin/coberturas

Lists every coverage code ever seen for the authenticated user's producer, ordered by `sortOrder`.

**Auth required:** Yes

**Responses**

`200 OK`
```json
[
  {
    "id": 1,
    "code": "A",
    "name": "Responsabilidad Civil",
    "tagline": "La cobertura obligatoria para circular",
    "benefits": ["Daños a terceros, personas y cosas", "Asistencia y defensa legal"],
    "exclusions": ["Robo, incendio o daños de tu propio auto"],
    "needsReview": false,
    "isActive": true,
    "isConfigured": true,
    "highlighted": false,
    "sortOrder": 100,
    "yearFrom": null,
    "yearTo": null,
    "highlightYearFrom": null,
    "highlightYearTo": null,
    "firstSeenAt": "2026-08-04T02:41:00.000Z"
  }
]
```

`401 Unauthorized` — Missing or invalid token

### PATCH /admin/coberturas/:id

Updates one coverage. Any edit sets `isConfigured` to `true`.

**Auth required:** Yes

**Request body**

| Field       | Type     | Required | Constraints                                              |
|-------------|----------|----------|----------------------------------------------------------|
| name        | string   | No       | ≤ 80                                                     |
| tagline     | string   | No       | ≤ 160                                                    |
| benefits    | string[] | No       | ≤ 12 items, each ≤ 150 chars                             |
| exclusions  | string[] | No       | What it does not include; ≤ 12 items, each ≤ 150 chars   |
| isActive    | boolean  | No       | `false` hides the coverage from every quote              |
| highlighted | boolean  | No       | Renders the "La más elegida" badge                       |
| sortOrder   | number   | No       | Integer ≥ 0                                              |
| yearFrom    | number   | No       | Vehicle year 1900–2100, or `null` for no lower bound     |
| yearTo      | number   | No       | Vehicle year 1900–2100, or `null` for no upper bound     |
| highlightYearFrom | number | No | First vehicle year the coverage is recommended for (1900–2100), or `null` |
| highlightYearTo   | number | No | Last vehicle year the coverage is recommended for (1900–2100), or `null` |

```json
{ "name": "Todo Riesgo Premium", "isActive": true, "yearFrom": 2015, "highlighted": true, "highlightYearFrom": 2010 }
```

**Responses**

`200 OK` — The updated coverage, same shape as the list entries.

`400 Bad Request` — Validation error

`401 Unauthorized` — Missing or invalid token

`404 Not Found` — The coverage does not exist for this producer

### PATCH /admin/coberturas/orden

Persists a whole ordering in one call, for a drag-and-drop list.

**Auth required:** Yes

**Request body**

| Field             | Type   | Required | Constraints              |
|-------------------|--------|----------|--------------------------|
| items             | array  | Yes      | 1–100 entries            |
| items[].id        | number | Yes      | Coverage id              |
| items[].sortOrder | number | Yes      | Integer ≥ 0              |

```json
{ "items": [{ "id": 1, "sortOrder": 100 }, { "id": 2, "sortOrder": 200 }] }
```

**Responses**

`200 OK` — The full list in its new order.

`400 Bad Request` — Validation error

`401 Unauthorized` — Missing or invalid token

`404 Not Found` — One of the ids does not belong to this producer


### Eliminar chats de la bandeja

- `DELETE /admin/inbox/:id`: borra un chat accesible al usuario autenticado;
  devuelve 404 si no existe o está fuera de su organización/códigos.
- `DELETE /admin/inbox`: borra todos los chats accesibles, incluidos los cerrados.
  No utiliza los filtros de búsqueda o estado de la pantalla.
- Respuesta: `{ "deletedCount": 1 }` (0 si la bandeja ya estaba vacía).
- En una transacción se borran los mensajes y conversaciones, se desvinculan
  las solicitudes de sus chats y se ocultan las novedades HANDOFF relacionadas.
  Se conservan clientes, pólizas, cotizaciones, solicitudes y siniestros.
- El panel exige confirmación y mantiene el modal abierto si la operación falla.
  No borra las conversaciones de la aplicación de WhatsApp del cliente.


### Limpiar novedades

`DELETE /admin/novedades` requiere autenticación de administración. Limpia todas
las novedades accesibles de la organización y códigos del usuario, sin filtros
por página, estado o categoría. Responde `{ "clearedCount": 15 }`. Aplica borrado
lógico solo a Notification (novedades): conserva chats, siniestros, solicitudes y sus estados.
Las nuevas novedades continúan registrándose. El panel exige confirmación.


## Mejoras

Cambios de la plataforma contados para la oficina. Lumar (OWNER) los escribe y
publica; los usuarios de cada organización los leen en "Mejoras". Una mejora con
`producerId: null` la ven todas las organizaciones. `publishedAt: null` = borrador
(solo lo ve el OWNER). `releasedOn` es la fecha de la mejora que muestra la
tarjeta; si se publica sin fecha, toma la de hoy. Áreas: `BOT`, `BANDEJA`,
`COTIZADOR`, `PANEL`, `PORTAL`.

### GET /admin/improvements

Mejoras publicadas para la organización del usuario (y las de todas), ordenadas
por `releasedOn` descendente (más nuevas primero). Con `page` responde una página;
sin `page` responde el array completo como antes de paginar (compatibilidad con
paneles que todavía no paginan; `area` y `pageSize` se ignoran en ese caso).

**Auth required:** Yes (Bearer, type `user`)

**Query params**

| Param    | Type   | Required | Constraints |
|----------|--------|----------|-------------|
| page     | int    | No       | ≥ 1. Si viene, la respuesta es paginada |
| pageSize | int    | No       | `1..50`. Default 10 |
| area     | string | No       | `BOT` \| `BANDEJA` \| `COTIZADOR` \| `PANEL` \| `PORTAL` |

`200 OK` (con `page`). `total` y `totalPages` cuentan el área filtrada;
`areaCounts` cuenta todas las publicadas por área, sin el filtro (para los chips).
```json
{
  "data": [
    {
      "id": 2,
      "title": "El bot responde lo que le piden desde el primer mensaje",
      "summary": "Si el cliente arranca pidiendo algo concreto, el bot va directo a eso…",
      "beforeText": "Ante cualquier primer mensaje el bot contestaba…",
      "afterText": "El bot entiende qué pide el primer mensaje…",
      "example": "Cliente: Hola, me pasás mi póliza\nNICO: ¡Hola! Soy NICO 👋 …",
      "area": "BOT",
      "releasedOn": "2026-10-09T00:00:00.000Z",
      "publishedAt": "2026-10-12T15:00:00.000Z"
    }
  ],
  "total": 29,
  "page": 1,
  "pageSize": 10,
  "totalPages": 3,
  "areaCounts": { "BOT": 14, "BANDEJA": 6, "COTIZADOR": 2, "PANEL": 7, "PORTAL": 0 }
}
```

`200 OK` (sin `page`) → array con los mismos objetos que `data`.

`400 Bad Request` — Invalid `page`, `pageSize` or `area`

`401 Unauthorized` — Missing or invalid token

### GET /admin/improvements/unseen-count

Cantidad de mejoras publicadas después de la última visita del usuario a
"Mejoras" (todas, si nunca entró).

**Auth required:** Yes (Bearer, type `user`)

`200 OK` → `{ "count": 3 }`

### POST /admin/improvements/visit

Registra que el usuario abrió "Mejoras" y devuelve la visita anterior, para
marcar como nuevas las publicadas desde entonces, y `newCount`: cuántas son
(las publicadas después de la visita anterior; todas si es la primera).

**Auth required:** Yes (Bearer, type `user`)

`201 Created` → `{ "previousVisitAt": "2026-10-10T12:00:00.000Z", "visitedAt": "2026-10-12T15:00:00.000Z", "newCount": 2 }`

### GET /owner/improvements

Todas las mejoras, borradores sin fecha primero, con su organización. Con `page`
responde una página; sin `page`, el array completo como antes de paginar.

**Auth required:** Yes (Bearer, role `OWNER`)

**Query params**

| Param    | Type   | Required | Constraints |
|----------|--------|----------|-------------|
| page     | int    | No       | ≥ 1. Si viene, la respuesta es paginada |
| pageSize | int    | No       | `1..50`. Default 10 |
| filter   | string | No       | `all` (default) \| `drafts` \| `published` |

`200 OK` (con `page`) → `{ data, total, page, pageSize, totalPages, counts }`.
Cada elemento de `data` tiene los campos de `GET /admin/improvements` más
`producerId`, `producer: { id, name } | null`, `createdAt` y `updatedAt`.
`counts` es el tamaño de cada lista, sin el filtro:
```json
{ "data": [], "total": 3, "page": 1, "pageSize": 10, "totalPages": 1, "counts": { "all": 32, "drafts": 3, "published": 29 } }
```

`200 OK` (sin `page`) → array con los mismos objetos que `data`.

`400 Bad Request` — Invalid `page`, `pageSize` or `filter`

`403 Forbidden` — Insufficient role

### POST /owner/improvements

**Auth required:** Yes (Bearer, role `OWNER`)

**Request body**

| Field      | Type           | Required | Constraints |
|------------|----------------|----------|-------------|
| title      | string         | Yes      | 1–140 chars |
| summary    | string         | Yes      | 1–500 chars |
| beforeText | string         | No       | ≤ 5000 chars; vacío = sin "antes" |
| afterText  | string         | No       | ≤ 5000 chars |
| example    | string         | No       | ≤ 5000 chars; una línea por mensaje |
| area       | string         | Yes      | `BOT` \| `BANDEJA` \| `COTIZADOR` \| `PANEL` \| `PORTAL` |
| releasedOn | string \| null | No       | YYYY-MM-DD |
| producerId | number \| null | No       | organización existente; null/omitido = todas |
| published  | boolean        | No       | true = publicar ya; si no, queda en borrador |

```json
{ "title": "Nueva sección Mejoras", "summary": "Acá vamos a ir contando…", "area": "PANEL", "producerId": 1, "published": false }
```

`201 Created` → la mejora (formato de `GET /owner/improvements`)

`400 Bad Request` — Validation error / organization not found

### PATCH /owner/improvements/:id

Mismos campos que el alta, todos opcionales. `published: true` publica (si ya
estaba publicada conserva su `publishedAt`, así una corrección no la vuelve a
mostrar como nueva); `published: false` la pasa a borrador.

**Auth required:** Yes (Bearer, role `OWNER`)

`200 OK` → la mejora actualizada

`400 Bad Request` — Validation error / organization not found

`404 Not Found` — Improvement not found

### DELETE /owner/improvements/:id

Borrado lógico.

**Auth required:** Yes (Bearer, role `OWNER`)

`200 OK` → `{ "ok": true }`

`404 Not Found` — Improvement not found


## Propuestas de mejora

Ideas que los usuarios de una organización le mandan a Lumar desde "Mejoras ›
Propuestas". Todos los usuarios de la organización ven todas sus propuestas
(tablero compartido). Cada propuesta nueva manda un mail a `PROPOSALS_ALERT_EMAIL`
(direcciones separadas por coma) o, si no está configurado, a las cuentas OWNER.
Estados: `NEW` (nueva), `REVIEWING` (en análisis), `PLANNED` (planificada),
`DONE` (hecha), `DISCARDED` (descartada).

### GET /admin/improvement-proposals

Propuestas de la organización del usuario, más nuevas primero. `mine` indica si
la hizo el usuario que consulta. Con `page` responde
`{ data, total, page, pageSize, totalPages }`; sin `page`, el array completo como
antes de paginar.

**Auth required:** Yes (Bearer, type `user`)

**Query params**

| Param    | Type | Required | Constraints |
|----------|------|----------|-------------|
| page     | int  | No       | ≥ 1. Si viene, la respuesta es paginada |
| pageSize | int  | No       | `1..50`. Default 10 |

`200 OK` (sin `page`; con `page`, estos objetos van en `data`)
```json
[
  {
    "id": 3,
    "title": "Avisar al celular cuando piden un asesor",
    "description": "Que me llegue un aviso…",
    "status": "PLANNED",
    "response": "Lo sumamos la semana que viene.",
    "respondedAt": "2026-10-13T12:00:00.000Z",
    "createdAt": "2026-10-12T15:00:00.000Z",
    "author": { "email": "mili@example.com" },
    "mine": true
  }
]
```

### POST /admin/improvement-proposals

**Auth required:** Yes (Bearer, type `user`)

**Request body**

| Field       | Type   | Required | Constraints  |
|-------------|--------|----------|--------------|
| title       | string | Yes      | 1–140 chars  |
| description | string | Yes      | 1–5000 chars |

`201 Created` → la propuesta (formato de `GET /admin/improvement-proposals`)

`400 Bad Request` — Validation error

### GET /owner/improvement-proposals

Todas las propuestas de todas las organizaciones, con `producer: { id, name }`,
más nuevas primero. Con `page` responde una página de las abiertas (ni `DONE` ni
`DISCARDED`) o de todas; sin `page`, el array completo como antes de paginar.

**Auth required:** Yes (Bearer, role `OWNER`)

**Query params**

| Param    | Type   | Required | Constraints |
|----------|--------|----------|-------------|
| page     | int    | No       | ≥ 1. Si viene, la respuesta es paginada |
| pageSize | int    | No       | `1..50`. Default 10 |
| filter   | string | No       | `open` (default) \| `all` |

`200 OK` (con `page`) → `{ data, total, page, pageSize, totalPages, counts }`;
cada elemento con el formato de `GET /admin/improvement-proposals` sin `mine`, más
`producer`. `counts` es el tamaño de cada lista, sin el filtro:
```json
{ "data": [], "total": 4, "page": 1, "pageSize": 10, "totalPages": 1, "counts": { "open": 4, "all": 11 } }
```

`200 OK` (sin `page`) → array con los mismos objetos que `data`.

`400 Bad Request` — Invalid `page`, `pageSize` or `filter`

### GET /owner/improvement-proposals/new-count

Cantidad de propuestas en estado `NEW`.

**Auth required:** Yes (Bearer, role `OWNER`)

`200 OK` → `{ "count": 2 }`

### PATCH /owner/improvement-proposals/:id

**Auth required:** Yes (Bearer, role `OWNER`)

**Request body**

| Field    | Type   | Required | Constraints |
|----------|--------|----------|-------------|
| status   | string | No       | `NEW` \| `REVIEWING` \| `PLANNED` \| `DONE` \| `DISCARDED` |
| response | string | No       | ≤ 5000 chars; vacío = sin respuesta |

`respondedAt` se actualiza solo cuando cambia la respuesta.

`200 OK` → la propuesta actualizada

`404 Not Found` — Proposal not found

## Admin — Rechazos

Sección "Rechazos" del panel: la oficina carga el Excel de Triunfo "Planilla de
rechazos por débito automático" (uno para CBU y otro para tarjetas) y el bot le
avisa a cada cliente por WhatsApp con la plantilla aprobada
`PAYMENT_REJECTION_TEMPLATE` (6 variables: nombre, cuota, póliza, vencimiento,
importe, motivo). El Excel se lee en el navegador; la API recibe sus filas, las
cruza con la póliza (por certificado) y el cliente, y elige el número de
WhatsApp: celular, si no el particular, si no el teléfono del cliente en la
cartera. Cada aviso enviado queda en el chat del cliente como mensaje de la
oficina (`role: "agent"`), así se ve en Whatsapp y el bot lee la respuesta del
cliente como respuesta a ese aviso.

Estados de cada fila: `READY` (para enviar), `SKIPPED` (fuera del envío por
defecto, ver `skipReason`: `NO_PHONE` sin número usable, `ALREADY_PAID` la
cuota ya no está pendiente, `ALREADY_NOTIFIED` ya se avisó en otra carga),
`SENDING`, `SENT`, `FAILED` (con `error`) y `MARKED` (avisado a mano). Un admin
solo ve las filas de sus códigos y las que no tienen código.

### GET /admin/rejections

Últimas 50 cargas de la organización, más nuevas primero, con la cantidad de filas por estado.

**Auth required:** Yes (Bearer, admin)

`200 OK`
```json
{
  "templateReady": true,
  "imports": [
    {
      "id": 3,
      "fileName": "misAlertas-JHONPELL.xls",
      "periodLabel": "Desde: 05/10/2026 Hasta: 20/10/2026",
      "createdAt": "2026-10-20T18:30:00.000Z",
      "createdBy": { "name": "Mili", "email": "mili@example.com" },
      "counts": { "SENT": 4, "SKIPPED": 4 }
    }
  ]
}
```

### POST /admin/rejections

Guarda las filas de un Excel y devuelve la carga como `GET /admin/rejections/:id`.

**Auth required:** Yes (Bearer, admin)

**Request body**

| Field        | Type   | Required | Constraints |
|--------------|--------|----------|-------------|
| fileName     | string | Yes      | ≤ 255 chars |
| periodLabel  | string | No       | ≤ 120 chars (título del Excel) |
| producerCode | string | No       | dígitos; código de "Intermediario: 10484 - …" |
| rows         | array  | Yes      | 1 a 1000 filas |

Cada fila:

| Field             | Type    | Required | Constraints |
|-------------------|---------|----------|-------------|
| rowNumber         | number  | Yes      | entero ≥ 1 (fila del Excel) |
| holderName        | string  | Yes      | ≤ 160 chars |
| branch            | number  | No       | "Art." |
| certificateNumber | string  | Yes      | dígitos |
| endorsementNumber | number  | No       | |
| installmentNumber | number  | Yes      | entero ≥ 0 |
| dueDate           | string  | Yes      | `YYYY-MM-DD` |
| amount            | number  | Yes      | ≥ 0 |
| entity            | string  | Yes      | ≤ 80 chars |
| accountLast4      | string  | No       | hasta 4 dígitos (nunca el CBU o la tarjeta completos) |
| reason            | string  | Yes      | ≤ 120 chars |
| stillPending      | boolean | Yes      | "¿Cuota aún pendiente?" = SI |
| mobilePhone       | string  | No       | ≤ 40 chars |
| homePhone         | string  | No       | ≤ 40 chars |

```json
{
  "fileName": "misAlertas-JHONPELL.xls",
  "periodLabel": "Desde: 05/10/2026 Hasta: 20/10/2026",
  "producerCode": "10484",
  "rows": [
    {
      "rowNumber": 5, "holderName": "PEREZ JUAN", "branch": 465, "certificateNumber": "1234567",
      "endorsementNumber": 0, "installmentNumber": 2, "dueDate": "2026-09-28", "amount": 90315,
      "entity": "NACION ARGENTINA", "accountLast4": "6025", "reason": "FALTA DE FONDOS",
      "stillPending": true, "mobilePhone": "341159990001", "homePhone": "341159990001"
    }
  ]
}
```

`201 Created` → la carga (ver abajo)

`400 Bad Request` — Validation failed

`403 Forbidden` — `No tenés acceso al código 10484 de este Excel.`

### GET /admin/rejections/:id

Una carga con sus filas y el texto exacto que recibe (o recibió) cada cliente.

**Auth required:** Yes (Bearer, admin)

`200 OK`
```json
{
  "id": 3,
  "fileName": "misAlertas-JHONPELL.xls",
  "periodLabel": "Desde: 05/10/2026 Hasta: 20/10/2026",
  "createdAt": "2026-10-20T18:30:00.000Z",
  "createdBy": { "name": "Mili", "email": "mili@example.com" },
  "templateReady": true,
  "rows": [
    {
      "id": 11, "rowNumber": 5, "holderName": "PEREZ JUAN", "branch": 465,
      "certificateNumber": "1234567", "endorsementNumber": 0, "installmentNumber": 2,
      "dueDate": "2026-09-28", "amount": 90315, "entity": "NACION ARGENTINA", "channel": "ACCOUNT",
      "accountLast4": "6025", "reason": "FALTA DE FONDOS", "stillPending": true,
      "phone": "341159990001", "waId": "5493419990001", "status": "READY", "skipReason": null,
      "error": null, "sentAt": null, "conversationId": null,
      "client": { "id": 60, "firstName": "JUAN", "lastName": "PEREZ" }, "sentBy": null,
      "message": "Hola Juan, te escribimos de JP Management Group, …"
    }
  ]
}
```

`404 Not Found` — Rejection import not found

### POST /admin/rejections/:id/send

Pone en `SENDING` las filas elegidas que se pueden enviar (`READY`, `SKIPPED`
con número o `FAILED`) y las manda de a una en segundo plano (1,5 s entre
avisos). El panel consulta la carga hasta que ninguna quede en `SENDING`.

**Auth required:** Yes (Bearer, admin)

**Request body**

| Field | Type     | Required | Constraints |
|-------|----------|----------|-------------|
| ids   | number[] | Yes      | 1 a 1000 ids de filas de la carga |

`201 Created` → la carga, con las filas en `SENDING`

`400 Bad Request` — `Ninguno de los avisos elegidos se puede enviar.`

`404 Not Found` — Rejection import not found

`409 Conflict` — `La plantilla de WhatsApp para avisar rechazos todavía no está habilitada. No se envió ningún aviso.` o `No hay un número de WhatsApp conectado para enviar los avisos. Revisalo en Números.`

### POST /admin/rejections/:id/mark

Marca las filas elegidas como avisadas a mano (`MARKED`): no se vuelven a
ofrecer para enviar, tampoco en cargas posteriores del mismo vencimiento.

**Auth required:** Yes (Bearer, admin)

**Request body:** igual que `send`.

`201 Created` → la carga actualizada

`404 Not Found` — Rejection import not found

### DELETE /admin/rejections/:id

Borra (soft delete) la carga y sus filas. Los avisos ya enviados siguen en los chats.

**Auth required:** Yes (Bearer, admin)

`200 OK` → `{ "ok": true }`

`404 Not Found` — Rejection import not found

`409 Conflict` — `Esperá a que terminen de enviarse los avisos antes de borrar la carga.`
