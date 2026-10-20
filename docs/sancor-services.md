# Servicios web de Sancor Seguros

Referencia de las APIs de Sancor Seguros (Grupo Sancor Seguros, "GSS") que usa o
puede usar la API: cómo se accede, qué hace cada una, cómo se llama y qué devuelve.

Fuentes: el manual "API Connect 2026" que mandó Sancor y las specs Swagger/OpenAPI
publicadas en su Developer Portal, leídas el 20/10/2026 con la cuenta de
Lumarsoft. Las specs completas están en [`docs/sancor/specs/`](sancor/specs/)
(una por API, con el número de API del portal al principio del nombre). El portal
pide login para verlas.

Colección de Postman: [`docs/sancor/sancor.postman_collection.json`](sancor/sancor.postman_collection.json).
Pide el token sola. La carpeta 5 (emitir, denunciar, anular) no se envía salvo
que la variable `permitir_destructivo` esté en `true`.

**Estado al 20/10/2026:** la aplicación está registrada y suscripta, y el
gateway acepta la Clave. Falta que Sancor dé el usuario del intermediario (ver
[Acceso](#acceso)) para pedir el token y hacer la primera consulta real. Todo
lo que diga "a confirmar" se aclara con esa primera llamada.

## Ambientes

| Ambiente | Base (`SANCOR_BASE_URL`) |
|---|---|
| Preproducción | `https://external-pre-api.gruposancorseguros.com/apissa/pre-catalog` |
| Producción | A confirmar con Sancor. El portal solo publica el catálogo de preproducción (`pre-catalog`). |

- Developer Portal: https://web-apic-portal.gruposancorseguros.com/apissa/pre-catalog/
- Soporte: Atención Clientes Corporativos, `atencionclientescorporativos@sancorseguros.com`,
  0800-666-2436, de 8 a 15:30 h.
- Cada producto tiene un plan con límite de llamadas por hora, según lo que
  mostró el portal al suscribir: 1000/h Servicios de Autenticación y
  Automotores; 1001/h APIs Generales (cartera, módulos, localidades); 100/h
  Motovehiculos, Siniestro/Denuncia e Impresión documento.

## Acceso

Pasos del manual de Sancor:

1. Crear una cuenta en el Developer Portal y confirmarla desde el mail. **Hecho:
   cuenta de la organización "Lumarsoft" (20/10/2026).**
2. En "Aplicaciones", crear una aplicación con nombre y URL. El portal muestra
   una **Clave** y un **Secreto**: hay que guardarlos en ese momento. La Clave va
   en `SANCOR_CLIENT_ID`. Las specs no usan el Secreto.
3. Suscribir la aplicación al plan ("Default Plan") de cada producto que se use:
   Servicios de Autenticación, Automotores, Motovehiculos, el producto de
   Cartera/Módulos/Localidades, Impresión documento y Siniestro/Denuncia.
4. Pedir a Sancor el **usuario y la contraseña del intermediario**. Lo pide el
   productor con un SOLHDG desde Portal Intermediarios → Contacto → Herramientas
   de Gestión. Van en `SANCOR_USERNAME` y `SANCOR_PASSWORD`.

Variables (`.env.example`): `SANCOR_BASE_URL`, `SANCOR_CLIENT_ID`,
`SANCOR_USERNAME`, `SANCOR_PASSWORD`, `SANCOR_APP_CLIENT` (opcional),
`SANCOR_PRODUCER_CODE` y `SANCOR_ORGANIZER_CODE`. Sin las tres primeras la API
arranca igual y `SancorService` responde 503 si alguien lo usa.

## Resumen

Productos del catálogo que sirven para atender a los asegurados de Sancor. El
número entre paréntesis es el de la API en el portal y en `docs/sancor/specs/`.

| API | Llamada | Para qué | ¿Lo usa la API? |
|---|---|---|---|
| TokenGenerator-V2 (148) | `POST /v2/security/auth0/token` | Token del intermediario | Sí (`SancorService.getToken`) |
| TokenIntrospection-V2 (149) | `GET/POST /v2/security/auth0/token/validate` | Validar un token | No |
| GetAuthESB (157) | `GET /security/generate/authorization/esb` | Token para el ESB, sin uso claro | No |
| Consulta de Cartera de Pólizas (1329) | `GET /policies` | Pólizas por DNI, CUIT, patente o número | Sí (`searchPolicies`) |
| Impresión de Documentos (1299) | `POST /policies/document/file/get` | PDF de una póliza (carátula, Mercosur, factura, certificado de pago…) | Sí (`getPolicyDocuments`) |
| Impresión de Documentos (1299) | `GET /policies/document/file/claim` | Documentos de un siniestro | Sí (`getClaimDocuments`) |
| Cotización Automotores (143) | `POST /quotations/vehicle/automotive` | Cotizar un auto | Sí (`quoteVehicle`) |
| Cotización Motovehículos (159) | `POST /quotations/vehicle/motorcycle` | Cotizar una moto | Sí (`quoteVehicle`) |
| Api cartera de Siniestros (170) | `POST /intermediaries/{producerCode}/claims/list` | Siniestros del productor (último mes) | Sí (`listClaims`) |
| Api detalles de Siniestros (171) | `GET /intermediaries/{producerCode}/claims/{claimNumber}` | Detalle de un siniestro | Sí (`getClaim`) |
| Api Consulta Reclamos Siniestro (615) | `POST /claims/searchexposure/status` | Estado de reclamos | No |
| API de Parametrización de Siniestros (1157) | `GET /parameters/claims/...` | Tablas para denunciar (causas, tipos de vehículo, puntos de impacto…) | No |
| Api Consulta de Localidades (142) | `GET /localities` | Localidad a partir del CP | No |
| Api de Consulta de Módulos (176) | `GET /modules/{producto}` | Módulos (coberturas) válidos para el productor | No |
| Emisión Automotores (144) | `POST /vehicle/automotive/issuance/single` | **Emitir** una póliza de auto | No: emite una póliza real |
| Emisión Motovehículos (158) | `POST /policies/vehicle/motorcycle` | **Emitir** una póliza de moto | No: emite una póliza real |
| Siniestros Automotores (152) | `POST /claims/vehicle/data` | **Denunciar** un siniestro de auto | No: crea una denuncia real |
| Siniestros Motovehículos (160) | `POST /claims/motorcycle/data` | **Denunciar** un siniestro de moto | No: crea una denuncia real |
| Anulación de Póliza (151) | `DELETE /policies/annulment/certificate` | **Anular** una póliza o certificado | No: anula de verdad |
| Adhesión a Despacho Digital (165) | `POST /policies/registers/office` | Adherir a despacho digital | No |
| API de pólizas con mensajes cifrados (1037) | `POST /secure/cipher/issuance` | Emisión con cuerpo cifrado (RSA-OAEP / AES-256-GCM) | No |

El catálogo tiene además ramos que hoy no manejamos: Accidentes Personales,
Combinado Familiar (Hogar Protegido y Premium), Robo (bicicleta, bolso,
tecnología, cajero, movilidad), Riesgos Varios, Salud, Vida Colectivo y Granizo.

Lo que **no** aparece en el catálogo:

- Estado de cuotas o de pagos de una póliza (lo que de Triunfo sale de
  `RESTNovedadesCartera`). La cartera de Sancor devuelve vigencia, ramo y
  número, no cuotas. Para la deuda solo están los documentos `NuevaFacturaCuota`,
  `Factura` y `CertificadoPago`.
- Una "novedades de cartera" por fecha: la consulta de cartera es por cliente,
  patente o número de póliza.

## Autenticación

Todas las llamadas llevan la Clave de la aplicación en un header. Las specs lo
llaman `gss_apiclient_id`; el manual dice `X-IBM-Client-Id`. `SancorService`
manda los dos. Todas menos la del token llevan además el token del intermediario.

```json
POST {BASE}/v2/security/auth0/token
gss_apiclient_id: <Clave>
{ "username": "<usuario del intermediario>", "password": "<contraseña>", "app_client": "<nombre de la app>" }
```

```json
200
{ "access_token": "eyJ…", "id_token": "eyJ…", "scope": "openid", "expires_in": 3600, "token_type": "Bearer" }
```

- Alcanza con la Clave: el Secreto no hace falta (probado el 20/10/2026). Lo que
  contesta el gateway en cada etapa:
  - sin Clave o con una inválida: `401 {"moreInformation":"Invalid client id or secret."}`;
  - con la Clave pero sin suscribir la app al plan del producto:
    `403 {"moreInformation":"Not registered to plan"}`;
  - con la app suscripta y un usuario inexistente:
    `403 {"error":"invalid_grant","error_description":"Usuario o contraseña incorrecta."}`.
- Los demás servicios piden `Authorization: Bearer <access_token>`. La spec de
  Localidades lo describe como "Bearer Token". Que sea el `access_token` y no el
  `id_token` está **a confirmar**.
- `app_client` es opcional en la spec (el ejemplo dice `"Ceibo"`). Qué valor
  espera Sancor está **a confirmar**: por ahora va el de `SANCOR_APP_CLIENT`, o
  nada si está vacío.
- El token dura `expires_in` segundos (3600 en el ejemplo). `SancorService` lo
  guarda en memoria y lo renueva 5 minutos antes de que venza. Si Sancor contesta
  401, lo descarta para que la próxima llamada pida uno nuevo.

## Respuestas y errores

Casi todas las respuestas traen, junto a los datos, `paging` (`offset`, `limit`,
`total`) y una lista de mensajes `{ status, code, text, help }`. Según la API, la
lista se llama `messages`, `message` o `messages[].message`.

| HTTP | Significado según las specs |
|---|---|
| 200 | OK |
| 204 | Sin resultados (`SancorService` lo devuelve como lista vacía) |
| 400 | Parámetro mal escrito o combinación de búsqueda no soportada |
| 401 / 403 | Token o Clave inválidos (las specs alternan cuál es cuál) |
| 415 | Falta un parámetro obligatorio |
| 422 | Parámetro con valor inválido |
| 500 / 504 | El backend de Sancor no respondió |

`SancorService` convierte cualquier error en `502 Bad Gateway`, con el HTTP y
los mensajes de Sancor, sin los datos del pedido.

## `GET /policies` — cartera de pólizas

Pólizas "de intermediario/cliente". Todos los filtros son opcionales y van por
query string: `identificationNumber` (DNI), `cuit`, `licensePlate`,
`officialNumber` (número oficial de póliza), `referenceNumber`, `branchCode`
(ramo) e `isVigent`. Algunas combinaciones dan 400.

```json
200
{
  "policies": [
    {
      "referenceNumber": "…", "certificateNumber": "…", "certificateId": "…",
      "branchCode": "…", "branchName": "…", "policyTypeName": "…", "isVigent": "…",
      "policyGroupTypeCode": "…", "policyGroupTypeName": "…",
      "startDate": "…", "endDate": "…"
    }
  ]
}
```

A confirmar: los códigos de ramo (`branchCode`) de autos y motos, y si
`isVigent` viene como `"S"/"N"` o `"true"/"false"`.

## `POST /policies/document/file/get` — documentos de una póliza

```json
POST {BASE}/policies/document/file/get
{
  "file": {
    "branchCode": "<ramo>",
    "officialNumber": "…",
    "referenceNumber": "…",
    "certificateNumber": 1,
    "reportName": "Mercosur"
  }
}
```

`reportName` es obligatorio en la práctica y acepta: `Carátula`,
`NuevaFacturaCuota`, `NuevaFactura`, `Mercosur`, `ConstanciaDeCoberturaPE`,
`ConstanciaPolizaArgentina`, `Tarjetasplásticas`, `CertificadoIncorporación`,
`MercosurPolizaElectronica`, `ConstanciaCoberturaRC`,
`TarjetaAutomotorPolizaElectronica`, `CaratulaAnulacionDePoliza`, `Factura`,
`CertificadoPago`, `CertificadoSOA` y `DocumentoUnificadoAPF`. El cuerpo acepta
además `postalCode`, `policyMovNumber`, `contractNumber`, `identificationNumber`,
`engineNumber` y `quoteNumber`; cuáles hacen falta para cada documento está **a
confirmar**.

```json
200
{ "files": [ { "reportName": "Mercosur", "urlFile": "https://…", "fileAttachment": "<base64?>" } ] }
```

Cada archivo puede venir como link (`urlFile`), con el contenido adentro
(`fileAttachment`) o con las dos cosas: **a confirmar**. La spec de documentos de
siniestro muestra links a `reporting.gruposancorseguros.com`.

`GET /policies/document/file/claim?claimNumber=…` devuelve los documentos de un
siniestro con la misma forma (`files[].reportName`, `files[].urlFile`).

## Cotización — `POST /quotations/vehicle/automotive` y `/motorcycle`

El vehículo se identifica con el **CODIA de InfoAuto** (`vehicle.vehicleCode`),
el mismo que ya usamos con Triunfo. Para motos es el código de InfoMoto. Según la
spec, para usarlo hay que tener una suscripción vigente a InfoAuto.

Campos obligatorios (auto):

| Campo | Valores |
|---|---|
| `person.identificationType` | `D` DNI, `C` LC, `L` LE, `I` CI, `J` CUIT |
| `person.isJuridicPerson` | `true` / `false` |
| `currencyCode` | `1` en el ejemplo (pesos, a confirmar) |
| `policyPeriodStartEffectiveDate` | Fecha y hora de inicio de vigencia |
| `intermediary.prodProducerCode` / `upperProducerCode` | Código de productor y de organizador (`SANCOR_PRODUCER_CODE`, `SANCOR_ORGANIZER_CODE`) |
| `policyVigencyCode` | `1` anual, `2` semestral, `3` trimestral |
| `policyPaymentPeriodicityCode` | `5` mensual, `7` cuotas |
| `policyQuotas` | Cantidad de cuotas |
| `productCode` | `24` en el ejemplo (a confirmar) |
| `zone.postalCode` | Código postal (`zone.cityCode` opcional: sale de `/localities`) |
| `vehicle.vehicleCode` | CODIA de InfoAuto |
| `vehicle.vehicleYear` | Año |
| `vehicle.yearSuggestedValue` | Valor del vehículo |
| `vehicle.vehicleUseTypeCode` | `2` particular, `4` particular y/o comercial, `7` transporte general rutero |
| `vehicle.vehicleTrackingEquipment` | Tiene equipo de rastreo |
| `vehicle.assistance` | `{ "assistance": "sa_02" \| "sa1_plus" \| "sa2_plus", "assistanceProvider": "ibero" }` |

Opcionales: `person.identificationNumber`, `coverModuleCodes[].offeringCode`
(módulos; sin ellos, ¿cotiza todos?, a confirmar), `discountCustomizations`
(`58` especial, `90` especial NEO, `173` promocional), `conditionCode` (IVA:
`1` Responsable Inscripto … `4` Consumidor Final …), `vehicle.gncInformation`,
`vehicle.zeroKM`, `driversUnder25`, `anualKM` (más de 25.000 km por año) y
`garageParking`.

Diferencias de la API de **motos**:

- El cuerpo va sin el envoltorio `vehicleQuotation`.
- La asistencia se escribe `assistence` / `assistenceProvider`.
- Uso: solo `2` (particular). IVA: solo `1` y `4`.
- Suma `vehicle.vehicleClassCode` e `intermediary.sellerNumber`.

`SancorService.quoteVehicle` recibe siempre la forma de autos y arma la de motos.
También completa productor y organizador si no vienen.

```json
200
{
  "vehicleQuotation": {
    "quotationCode": 123,
    "plans": [
      {
        "module": { "coverageCode": 4, "coverageName": "…", "coverageAbbreviatedName": "…", "observations": "…" },
        "premium": 0,
        "quotaPremiumMonthly": 0,
        "premiumTotals": { "quotaAmount": 0, "quotationPremium": 0 },
        "vehicleInsuredSum": 0,
        "success": true,
        "validationResults": "…",
        "quotes": [ { "policyQuotas": 1, "quotaPremium": 0 } ],
        "details": [ { "chargeDescription": "…", "premium": 0 } ]
      }
    ]
  }
}
```

`premium` es el premio de toda la vigencia y `quotaPremiumMonthly`, el de cada
cuota. `success: false` con `validationResults` indica que ese plan no se puede
ofrecer. Los módulos válidos para el productor salen de
`GET /modules/automotive?organizer=…&producer=…&statistical_code=…`.

## Siniestros

- `POST /intermediaries/{producerCode}/claims/list` con
  `{ "claim": { "branchCode": "<ramo>", "claimReportedDateSince": "2026-10-01" } }`:
  siniestros del productor. `branchCode` es obligatorio y las fechas desde
  (ocurrencia o denuncia, `YYYY-MM-DD`) van como **máximo un mes atrás**.
- `GET /intermediaries/{producerCode}/claims/{claimNumber}`: el detalle completo.
  Trae estado y subestado, causa, fechas, asegurado, tomador, denunciante,
  gestor del siniestro (con teléfonos y mails), peritos, terceros, lesionados y
  órdenes de servicio.
- `POST /claims/searchexposure/status`: estado de reclamos por número de
  siniestro, póliza, patente o fechas.

La spec del listado lo tipa como un solo objeto `claim`, no como una lista.
`SancorService.listClaims` acepta las dos formas.

## Lo que crea o borra datos en Sancor

Están documentados en las specs y en la colección de Postman (marcados
`[DESTRUCTIVO]`), pero `SancorService` **no** los llama:

- **Emisión** de auto (144) y moto (158): crean una póliza real a partir de una
  cotización.
- **Denuncia** de siniestro de auto (152) y moto (160): necesitan certificado,
  fechas, descripción, causa (de `/parameters/claims/automotive/causes`), lugar,
  denunciante, vehículos involucrados y datos de la póliza.
- **Anulación** (151): `DELETE /policies/annulment/certificate` con ramo, número
  y causa (`4` = decisión del tomador/asegurado).

## Pendientes

1. ~~Registrar la aplicación en el portal y guardar Clave y Secreto.~~ Hecho el
   20/10/2026 ("John Pellegrini Management Group").
2. ~~Suscribirla a los planes de los productos de la tabla.~~ Hecho el 20/10/2026.
3. Pedir el usuario del intermediario (SOLHDG) y los códigos de productor y
   organizador en Sancor.
4. Primera llamada real: token, una póliza conocida en `/policies` y sus
   documentos. Aclarar los "a confirmar" de esta guía.
5. Preguntar a Sancor la URL de producción y si hay consulta de cuotas o pagos.
6. Después, recién entonces: sumar Sancor a la cartera, al portal y al bot
   (pólizas, documentos y siniestros), y al cotizador.
