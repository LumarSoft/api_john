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
| Api Consulta de Localidades (142) | `GET /localities` | Localidad a partir del CP | Sí (`getLocalities`, `resolveLocation`) |
| Api de Consulta de Módulos (176) | `GET /modules/{producto}` | Módulos (coberturas) válidos para el productor | Sí (`getModules`) |
| Cotización Robo Bolso Protegido (168) | `POST /quotations/theft/protectedbag` | Cotizar bolso protegido | Sí (`quoteBag`) |
| Cotización Robo Bicicleta (554) | `POST /quotations/theft/bicycle` | Cotizar robo de bicicleta | Sí (`quoteBicycle`) |
| Cotización Combinado Familiar Hogar Protegido (146) | `POST /quotations/familyCombined/homeProtected` | Cotizar hogar por plan | Sí (`quoteHomeProtected`) |
| Cotización AP 24hs (178) | `POST /quotations/personalAccident/AP24Modulate` | Cotizar accidentes personales | Sí (`quotePersonalAccident`) |
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
{ "access_token": "…", "id_token": "eyJ…", "scope": "openid profile", "expires_in": 86400, "token_type": "Bearer" }
```

- Alcanza con la Clave: el Secreto no hace falta (probado el 20/10/2026). Lo que
  contesta el gateway en cada etapa:
  - sin Clave o con una inválida: `401 {"moreInformation":"Invalid client id or secret."}`;
  - con la Clave pero sin suscribir la app al plan del producto:
    `403 {"moreInformation":"Not registered to plan"}`;
  - con la app suscripta y un usuario inexistente:
    `403 {"error":"invalid_grant","error_description":"Usuario o contraseña incorrecta."}`.
- Los demás servicios piden `Authorization: Bearer <id_token>`. **Confirmado el
  9/11/2026 con las primeras llamadas reales:** con el `access_token` (opaco) la
  cartera, los siniestros y `token/validate` contestan 401; con el `id_token`
  responden. Localidades y Módulos aceptan cualquiera de los dos.
  `SancorService` usa el `id_token` y deja el `access_token` de respaldo.
- **El usuario del intermediario es el mismo de la web** (Portal de
  Intermediarios / Ceibo): no hizo falta el SOLHDG. El login devuelve
  `scope: "openid profile"`, `expires_in: 86400` y un `id_token` con el nombre
  del productor, `officeId` y `upn` (`<usuario>@ProductorA.ceibo.sancorseguros.com`).
- Probado ese día en preproducción con el usuario de John: `GET /localities`
  (200), `GET /modules/automotive|motorcycle|bag|homeProtected` (200, con los
  módulos reales), `GET /policies?licensePlate=…` (200, "No se encontraron
  resultados" con una patente inexistente; sin ningún filtro contesta 401),
  `POST /intermediaries/{producerCode}/claims/list` (422 "Debe informar
  branchCode" con el cuerpo vacío) y `GET /parameters/claims/vehicles/types/data`
  (500 "Could not connect to endpoint": caído del lado de Sancor).
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

## Cotizaciones de bolso, bicicleta, hogar y accidentes personales

`SancorService` las cotiza y devuelve todas con la misma forma
(`SancorProductQuotation`): `quotationId`, `relationQuotationId` y una lista de
planes con `module` (el `offeringCode`), `monthlyPremium` y `termPremium`
(con recargos e impuestos), `coverages` (solo las líneas de tipo "Cobertura",
con su capital) y `lines` (todas). Cada API de Sancor nombra los totales a su
manera (`premiumMonthly`/`premiumVigency`, `premioMensual`/`premioSegunVigencia`,
importes como texto en AP); el servicio los unifica.

Todo lo de esta sección se probó contra preproducción el 9/11/2026 con el
código del servicio, y no coincide del todo con las specs del portal:

- **Fecha de inicio:** siempre la de hoy **en UTC** (`sancorToday()`); después
  de las 21 de Argentina ya es mañana. Bolso, bicicleta y hogar la toman como
  `YYYY-MM-DD`; AP la exige con hora (`YYYY-MM-DDT00:00:00.000Z`) y rechaza la
  fecha sola ("is not a valid value for the dateTime datatype").
- **Localidad:** todas piden `locationRisk { cityId, zipCode }`. `cityId` es el
  de Sancor: `resolveLocation(cp, nombre)` lo busca con `GET /localities` y, si
  varias ciudades comparten el CP (2000 es Rosario y sus barrios), elige la del
  nombre o la primera. Rosario = 1240.
- **Planes:** `getModules(producto)` devuelve los que el productor puede vender
  (`/modules/bag`, `/bicycle`, `/homeProtected`, `/accidentespersonales/24`).
  Localidades y módulos se guardan 6 horas en memoria: los planes de cada
  producto permiten 100 llamadas por hora.
- **Bolso (`quoteBag`):** varios planes en una llamada (`offeringCode` "1,2,3";
  sin plan contesta 415). El organizador va como texto.
- **Bicicleta (`quoteBicycle`):** **no** acepta plan: con `offeringCode`
  contesta 500 "The complex type of element CoverModuleCodes … must not have a
  value". Sin él devuelve los planes estándar (Plan 25.000 a Plan 100.000).
- **Hogar Protegido (`quoteHomeProtected`):** exige al menos un adicional; sin
  `aditionals` contesta 415 "Faltan parámetros de entrada obligatorios
  (undefined)". `{ id: 0, option: 0 }` cotiza el plan solo (7.630 por mes el
  plan 70, contra 9.120 con el adicional 1 opción 3). De los 9 planes que lista
  Sancor, John tiene habilitados los primeros cuatro (módulos 70 a 73): pidiendo
  todos devuelve esos; pidiendo solo uno no habilitado contesta 500 "El producto
  no tiene módulos habilitados para cotizar". Hogar Premium no está: pide datos
  de la construcción que el bot no junta.
- **Accidentes personales (`quotePersonalAccident`):** individual, anual en 12
  cuotas. **Exige el documento del cliente** (`clientIdentify`): sin él Sancor
  falla armando su pedido ("Exception during creation of SOAP envelope"). El
  módulo define el capital de muerte e invalidez (47 = $8.000.000); el
  `deathCoverAmount` se ignora. Pareja (`couple`) cuesta el doble. Mandar
  `statisticCodeIds: 0` agrega la advertencia "El grupo estadístico es
  inexistente": no se manda.
- **Errores:** el motivo de un rechazo viene en el `help` del mensaje de Sancor
  y el servicio lo incluye en el error.
- Los importes de preproducción no son los de venta.

## Catálogo completo del portal (9/11/2026)

Relevado con la cuenta de Lumarsoft el 9/11/2026: 22 productos y 71 APIs, contra
los 6 productos a los que está suscripta la aplicación "John Pellegrini
Management Group" (Servicios de Autenticación, Automotores, Motovehiculos,
Siniestro/Denuncia, Impresión documento, APIs Generales). Las specs nuevas que
sirven para lo que el bot ofrece y Triunfo no cotiza online están en
`docs/sancor/specs/` (17 archivos más). Todo cuelga de
`https://external-pre-api.gruposancorseguros.com/apissa/pre-catalog`; todas
piden `Authorization: Bearer <token del intermediario>` y la Clave en
`X-IBM-Client-Id`. Las cotizaciones comparten la forma: `producerNumber`,
`organizerNumber`, `startEffectiveDate`, `locationRisk {cityId, zipCode}` y un
`offeringCode` (módulo) que se saca de `GET /modules/<producto>` (API 176).

| Producto (portal) | APIs (id) | Qué permite | Lo ofrece el bot hoy |
|---|---|---|---|
| Combinado Familiar - Hogar Premium | Coberturas 1507 `GET /covers/familycombined/premium`; Cotización 1081 `POST /quotations/familyCombined/homePremium`; Emisión 1079 | Cotizar y emitir hogar con datos de la vivienda (tipo de ocupación, calidad y tipo de construcción, m², capital edificio, deducible) | Sí: «Hogar», hoy con precios fijos de la oficina |
| Combinado Familiar - Hogar Protegido | Adicionales 147 `GET /familyCombined/additionals`; Cotización 146 `POST /quotations/familyCombined/homeProtected`; Emisión 145 | Hogar por módulos (`offeringCode` de `GET /modules/homeProtected`) con bienes adicionales | Sí: «Hogar» |
| Robo Bolso | Cotización 168 `POST /quotations/theft/protectedbag`; Emisión 169 | Bolso protegido por módulo (`GET /modules/bag`) y DNI | Sí: «Bolso protegido», hoy con precios fijos |
| Robo - Bicicleta | Cotización 554 `POST /quotations/theft/bicycle`; Emisión 555 | Robo de bicicleta por módulo (`GET /modules/bicycle`) | Sí: «Bici / Monopatín» |
| Robo - Movilidad | Amparos 163; Cotización 162 `POST /quotation/theft/mobility`; Emisión 161 | Monopatines y movilidad eléctrica (specs de 150–175 KB, no descargadas) | Parcial: «Bici / Monopatín» |
| Accidentes Personales/AP24hs | Actividades 181; Cotización 178 `POST /quotations/personalAccident/AP24Modulate`; Emisión 1304 (colectiva + certificados) | AP 24 hs individual o colectiva, por franjas de edad y capital de muerte | Sí: «Personas» (AP), hoy solo a la oficina |
| AP - Ocasion de trabajo (AP 13) | Actividades/tareas 164; Coberturas 177; Cotización 172; Emisión 173 (single y colectiva) | AP en ocasión de trabajo con cláusulas; es lo que piden las nóminas de los contratistas | Solo oficina |
| AP Integro Max | Actividades 183; Coberturas 1458; Cotización 180; Emisión 1463 | AP con sepelio, renta diaria y asistencia farmacéutica | Solo oficina |
| Amparo (Vida colectivo) | Cotización 1810 `POST /quotations/collectivelife/deathgrant`; Emisión 1811 | Vida colectivo / sepelio, individual o familiar, por fecha de nacimiento y capital | Sí: «Personas» (Vida/Sepelio) |
| Salud Max | Cotización 1474 `POST /quotations/health/safemax`; Emisión 1475 | Salud Plan Familia por personas y plan | Sí: «Personas» (salud) |
| Riesgos Varios (Garantía extendida) | Grupos y categorías 1163; Coberturas 1161; Cotización 1162; Emisión 1160 | Garantía extendida de bienes | No |
| Robo Tecnologia | Cotización 154; Emisión 1429; Siniestros 167 | Robo de tecnología (notebooks, celulares) | No |
| Robo Cajero Automático | Cotización 174; Emisión 175 | Robo en cajero | No |
| Granizo | Tasa agro 1091, destino 884, coberturas 534, figuras 525, pagos 524 | Granizo agrícola | No |
| Anulación de poliza | 151 `DELETE /policies/annulment/certificate` | Anular un certificado | Baja de póliza: hoy solo aviso a la oficina |
| Prestadores Siniestros | 1335 `POST /v2/claim/serviceorders/informnovelty`; 1322 `.../fileupload` | Para talleres y prestadores: novedades y archivos de una orden de servicio | No |
| Automotores / Motovehiculos / Siniestro/Denuncia / Impresión documento / APIs Generales / Servicios de Autenticación | ver [Resumen](#resumen) | Ya relevados el 20/10 | Sí |

**Estado al 9/11/2026 (noche):** la aplicación quedó suscripta también a
Combinado Familiar - Hogar Premium, Combinado Familiar - Hogar Protegido, Robo
Bolso, Robo - Bicicleta y Accidentes Personales/AP24hs (11 productos en total;
planes de 100 llamadas por hora, Hogar Protegido 1000 por minuto). Se suscribe
desde el portal: producto → Plans → Select → elegir la aplicación → Next. Sin
eso el gateway contesta 403 "Not registered to plan".

Primera cotización real ese día, con el usuario del intermediario (el mismo de
la web) y sus códigos de productor y organizador:

```json
POST {BASE}/quotations/theft/protectedbag
{ "organizerNumber": "<organizador>", "producerNumber": <productor>,
  "locationRisk": { "cityId": 1240, "zipCode": 2000 },
  "offeringCode": "1", "startEffectiveDate": "2026-11-10" }
```

```json
200
{ "quotation": { "relationQuotationId": 43545582, "quotationId": 1777710952,
    "plans": [ { "coveragesModules": 1, "premiumMonthly": 30, "premiumVigency": 360.23,
        "coverageValues": [ { "capital": 2000, "description": "Objetos Diversos", "detailType": "Cobertura", "monthlyPremium": 21.96 },
                            { "description": "IVA General", "detailType": "Impuesto", "monthlyPremium": 4.69 } ] } ] } }
```

- `startEffectiveDate` va como `YYYY-MM-DD` y **tiene que ser la fecha de hoy
  en UTC**: a las 21:20 de Argentina del 9/11 Sancor rechazó `2026-11-09`
  ("Solo se permite cotizar a la fecha actual") y aceptó `2026-11-10`. Con
  hora (`T00:00:00`) también la rechaza.
- `offeringCode` es el `id` de `GET /modules/bag` (1 = "Plan 2000" … 10 = "Plan 25000").
  `cityId` sale de `GET /localities?zipCode=…&countryCode=AR` (Rosario = 1240).
- Los importes de preproducción no son los de venta: sirven para probar la forma.
- Las demás respondieron con errores de validación, o sea que la suscripción
  anda: `GET /covers/familycombined/premium` y `GET /familyCombined/additionals`
  400 "required API parameters are missing"; `POST /quotations/theft/bicycle`
  con cuerpo vacío 415 "Faltan parametros de entrada obligatorios (locationRisk)";
  `GET /parameters/ap/24/getActivities` 200 con las actividades.

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
