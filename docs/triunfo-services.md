# Servicios web de Triunfo

Referencia de los servicios de Triunfo Seguros que usa o puede usar la API:
qué hace cada uno, cómo se llama y qué devuelve de verdad.

Fuentes: la respuesta de Triunfo (Martín, mail del 15/10/2026) y pruebas contra
producción del 13 y 15/10/2026. Lo que figura como "probado" se llamó desde el
servidor de producción. Los números de los ejemplos son ficticios.

## Ambientes

| Ambiente | Token (`TRIUNFO_BASE_URL_AUTH`) | Servicios (`TRIUNFO_BASE_URL_SIP`) |
|---|---|---|
| Test | `https://apitest.triunfonet.com.ar/gauswebtriunfotest/rest` | `https://siptest.triunfonet.com.ar/wsv1/rest` |
| Producción | `https://servicios.triunfonet.com.ar/gauswebtriunfosrv/rest` | `https://www.triunfonet.com.ar/sipv1/rest` |

Producción solo acepta llamadas desde IPs habilitadas: las pruebas se hacen
desde el servidor. No tenemos credenciales de test.

## Resumen

| Servicio | Para qué | Estado al 15/10/2026 | ¿Lo usa la API? |
|---|---|---|---|
| `getTokenRest` | JWT para los demás servicios | Funciona | Sí |
| `RESTCotizadorAutV2` | Cotizar autos y motos | Funciona | Sí (`cotizador.service.ts`) |
| `RESTNovedadesCartera` | Cartera: pólizas, cuotas, vehículos | Funciona | Sí (sync 06:00 y 20:00) |
| `RESTDocumentosV2` | PDF de una póliza (certificado, tarjeta, póliza, constancia de pago, cuponera…) | Funciona | Sí (`documentos.service.ts`: portal y bot) |
| `RESTPreInspV2` | Estado de la inspección de un presupuesto | Funciona con el formato nuevo | No |
| `RESTInspeccionPFV2` | Generar una inspección | Formato recibido, sin probar: crea una inspección | No |
| `RESTSolicitudAutomotoresV2` | Emitir una póliza | Sin probar: emite una póliza real | No |
| `RESTConsultaInspV2` | Documentación de una **inspección** | Responde, pero no sirve para las pólizas de la cartera | No (la usó hasta el 15/10/2026) |
| `RESTCotizadorTHV2` | Cotizador de otro ramo, sin identificar | — | No |

Lo que Triunfo **no** ofrece por servicio web:

- La cuponera de las pólizas que pagan por **Convenio**. Según Triunfo, se baja
  desde TriunfoNet.
- Denuncia y consulta de siniestros, endosos y bajas. Triunfo dijo que está
  analizando servicios de anulaciones.

## Autenticación

```json
POST {AUTH}/getTokenRest
{ "SDTProductor": { "Codigo": "10484", "Usuario": "<usuario>", "Password": "<md5 de la clave>" } }
```

- La contraseña va en MD5.
- El token dura unas 24 h, y mientras está vigente Triunfo devuelve el mismo.
  Triunfo avisó que pedirlo en cada llamada puede hacer que bloqueen la IP. Por
  eso la API lo guarda en `IntegrationToken`; ver `TriunfoService.loadOrRenewToken`.
- Los servicios SIP (salvo `RESTNovedadesCartera`) reciben
  `"Autenticacion": { "Productor": "<código>", "JWT": "<token>" }`.
- El token del código maestro (10484) sirve para consultar con cualquiera de los
  códigos dependientes como `Productor` (probado con `RESTDocumentosV2`).

## `RESTDocumentosV2` — documentación de una póliza

```json
POST {SIP}/RESTDocumentosV2
{
  "SDTWSDocumentosIn": {
    "Autenticacion": { "JWT": "<token>", "Productor": "<código de productor de la póliza>" },
    "Empresa": "T",
    "Sucursal": "CC",
    "Articulo": "458",
    "Certificado": "1234567"
  }
}
```

- `Empresa` y `Sucursal` vienen en cada póliza de `RESTNovedadesCartera`
  (`Policy.rawData.Empresa` / `.Sucursal`). En toda la cartera son `T` / `CC`.
- `Productor` tiene que ser el código **al que pertenece la póliza**
  (`ProducerCode.code`), no el maestro. Con otro código responde
  `Estado: "N"`, `Id: "OperacionNoValida"`, "Operación inexistente o no asociada
  al productor".
- Tarda entre 0,1 y 1 s.

Respuesta:

```json
{
  "SDTWSDocumentosOut": {
    "Links": [
      { "Codigo": "1000", "Nombre": "Certificado de Cobertura", "URL": "https://www.triunfonet.com.ar/gauswebtriunfo/servlet/hcertificadoau?<clave>" },
      { "Codigo": "1020", "Nombre": "Poliza", "URL": "https://www.triunfonet.com.ar/gauswebtriunfo/servlet/hpolizap?<clave>" }
    ],
    "Resultado": { "Estado": "S", "Mensajes": [] }
  }
}
```

### Documentos que devuelve

Medido el 15/10/2026 sobre unas 50 pólizas de distintos medios de pago y ramos:

| Código | Nombre | Archivo que baja | Cuándo aparece |
|---|---|---|---|
| 1000 | Certificado de Cobertura | `ocertificadoau` | Autos y motos activos |
| 1020 | Póliza | `opol5001` | Siempre, también en pólizas anuladas |
| 1030 | Cláusulas | `ocla5001` | Siempre |
| 1040 | Constancia de Pago | `avercertificadopagopat` | Casi siempre en refacturaciones; pocas veces en renovaciones o pólizas nuevas (probablemente porque todavía no tienen pagos) |
| 1050 | Tarjeta Mercosur (la "tarjeta verde") | `otarjetaverde_sp` | Autos y motos activos |
| 1060 | Cuponera de Pago | `ocuponeratriunfonet` | Solo Plan de Pago, y no siempre (7 de 15 pólizas). **Nunca en Convenio** (0 de 14) |
| 1070 | Solicitud | — | Viene con la URL rota (`nullcom.sip.agetsolicitudaut?…`): error de Triunfo |

No aparecen:

- El certificado de cobertura de otros riesgos (hogar, comercio, bicicleta). La
  oficina lo baja del portal como `ocertificadoor`.
- La cuponera de Convenio, que la oficina baja como `ocuponerarecibo_`.

### Bajar el PDF

La URL de cada link no es el PDF:

1. Responde `302` hacia el archivo real (`.../servlet/ocertificadoau?<otra clave>`).
2. En esa misma respuesta crea la sesión con las cookies `JSESSIONID` y `GX_SESSION`.
3. Si se sigue la redirección **sin** esas cookies, Triunfo responde `403`. Con
   ellas responde `200` con el PDF (`%PDF-`, entre 2 y 150 KB).

Para bajarlo hay que seguir la redirección a mano y mandar las cookies, por ejemplo
con `fetch(url, { redirect: 'manual' })` y el header `Cookie`. Así lo hace
`TriunfoService.downloadDocumento`, y el bot lo pide por
`GET /bot/conversation/:id/polizas/:polizaId/documentos/:code`.

- Un navegador maneja solo las cookies: abrir el link desde cualquier IP baja el
  PDF (probado el 15/10). Por eso el portal muestra el link directo.
- Cloudflare responde 403 a algunos clientes que no son navegadores, como `curl`.
  Por eso la descarga manda un `User-Agent` de navegador.
- No sabemos cuánto dura cada link: antes de bajar un PDF, la API vuelve a pedir
  la lista sin usar el cache.

## `RESTPreInspV2` — estado de la inspección

```json
POST {SIP}/RESTPreInspV2
{
  "Autenticacion": { "Productor": "10484", "JWT": "<token>" },
  "NroPresupuesto": "<número de presupuesto>"
}
```

Sin envoltorio `SDT...In`. Con un presupuesto inexistente responde:

```json
{ "ExisteInspeccion": "N", "SDTResultado": { "Estado": "Ok verificación", "Mensajes": [] } }
```

Antes del 15/10 se probaba con `TipoOperacion`/`Operacion`/`PresupuestoNro`, y
Triunfo respondía `500 Unrecognized field`.

## `RESTInspeccionPFV2` — generar una inspección

Formato que mandó Triunfo (ejemplo de test; los datos de la persona son ficticios):

```json
POST {SIP}/RESTInspeccionPFV2
{
  "Autenticacion": { "Productor": "10484", "JWT": "<token>" },
  "InspeccionClientName": "PRUEBA 1",
  "InspeccionTipoDoc": "4",
  "InspeccionDoc": "<DNI>",
  "InspeccionLicencePlate": "<patente>",
  "vehicleTypeId": 1,
  "CoberturaId": "B",
  "AccessoryId": [0],
  "NroPresupuesto": "<número de presupuesto>"
}
```

- `InspeccionTipoDoc` 4 = DNI, el mismo código que usa la emisión.
- No sabemos qué valores aceptan `vehicleTypeId` ni `AccessoryId`.
- **No se probó completo**, porque en producción crea una inspección. Con solo
  `Autenticacion` y `NroPresupuesto` responde `500 NullPointerException`: acepta
  los nombres de los campos, pero necesita los demás.
- Para probarlo hacen falta credenciales de test, o un presupuesto real cuando se
  construya el flujo de contratación.

## `RESTConsultaInspV2` — documentación de una inspección

Durante meses se creyó que era el servicio de documentos de las pólizas, porque
el manual de sandbox lo describía así (códigos 1000/1001/1002). En realidad
indexa **inspecciones** de operaciones hechas por API:

- `TipoOperacion` acepta `C` (certificado), `P` (presupuesto) e `I` (inspección).
- Para cualquier póliza de la cartera responde "No se encuentra esa Operación",
  con número de certificado, de póliza o artículo + certificado, y con cualquier
  código de productor. Así se probó en julio, el 8/10 y el 13/10.

Hasta el 15/10/2026 `TriunfoService.getDocumentos` lo usaba, y por eso el bot y
el portal nunca obtenían documentos. Ahora usa `RESTDocumentosV2`.

## `RESTNovedadesCartera` — cartera

```json
POST {SIP}/RESTNovedadesCartera
{
  "SDTWSNovedadesIn": {
    "Articulo": "0",
    "Certificado": "0",
    "FechaDesde": "2026-10-01",
    "FechaHasta": "2026-10-07",
    "Productor": { "Codigo": "10484", "Usuario": "<usuario>", "Password": "<md5 de la clave>" }
  }
}
```

- No usa JWT.
- Hay que pedir ventanas de 7 días como máximo: una semana del código maestro
  son ~225 novedades, ~680 KB y ~15 s, y un pedido de 30 días nunca termina.
- Cuando la respuesta es correcta, `Resultado.Estado` llega vacío (`""`), no como `"S"`.
- Si se pasan `Articulo` y `Certificado` reales, devuelve solo esa póliza en ~0,3 s
  (se probó con hasta 60 días). Pero solo la encuentra si tuvo algún movimiento
  en ese rango y pertenece al `Codigo` consultado. Si no, responde "Operación no
  encontrada".
- No trae links, PDF ni códigos de barras.

## `RESTCotizadorAutV2` — cotización

Ver `src/cotizador/cotizador.service.ts`, y en `production-migration.md` §2
cómo se convierte un modelo de InfoAuto en la marca y el modelo de Triunfo.
`GenerarPresupuesto: false` cotiza sin crear presupuesto: usarlo en las pruebas.

## `RESTSolicitudAutomotoresV2` — emisión

Nunca se llamó: emite una póliza real y facturable. Probablemente necesita un
presupuesto con inspección aprobada. El body de ejemplo está en la colección de
Postman (`documentacion/`, request 3.4), bloqueado por la variable `permitir_emision`.
Falta que Triunfo diga si se puede emitir una póliza de prueba y anularla.
