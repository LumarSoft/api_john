# Migración a producción — InfoAuto + Triunfo

Estado al **03/08/2026**: **aplicado**. El entorno local apunta a InfoAuto y
Triunfo productivos. Todo lo que dice "verificado" fue probado contra los
servicios reales, no contra documentación.

Colección Postman de referencia:
`../../documentacion/John_Seguros_PRODUCCION.postman_collection.json`

## Verificación end-to-end

`POST /cotizador/auto` con el CODIA 120053 (Chevrolet Corsa 1.6 3P, 2007,
CP 2000) contra producción:

```
Quoting AUTO codia 120053 → Triunfo Marca 12 Modelo 53 (2007) — origen N
presupuesto 19775342, vence 2026-09-02
ValorVehiculo: 6.090.000
coberturas: A 65.976 | B4 69.818 | B1 74.848 | B3 75.427 | B 75.446
```

Ese mismo vehículo está asegurado en la cartera con una `SumaAsegurada` de
**6.590.000** (póliza emitida el 31/07). El valor cotizado queda al **92,4%**
de esa cifra — mismo vehículo, no el mismo número. Las dos explicaciones
plausibles: la póliza se emitió con la tabla del mes anterior (InfoAuto publicó
el 31/07 a las 20:16 UTC), o la suma asegurada de esa póliza incluye el equipo
de GNC declarado. No hace falta resolverlo para operar.

Nota: la cobertura `C1` que tiene esa póliza no aparece entre las cotizadas.
Puede ser una cobertura solo de renovación. A confirmar con Triunfo si se
necesita ofrecerla.

---

## 1. Variables de entorno

### Triunfo

| Variable | Hoy (test) | Producción |
|---|---|---|
| `TRIUNFO_BASE_URL_AUTH` | `https://apitest.triunfonet.com.ar/gauswebtriunfotest/rest` | `https://servicios.triunfonet.com.ar/gauswebtriunfosrv/rest` |
| `TRIUNFO_BASE_URL_SIP` | `https://siptest.triunfonet.com.ar/wsv1/rest` | `https://www.triunfonet.com.ar/sipv1/rest` |
| `TRIUNFO_PRODUCTOR` | `10484` | `10484` — sin cambios |
| `TRIUNFO_USUARIO` | `JHONPELL` | `JHONPELL` — sin cambios |
| `TRIUNFO_PASSWORD` | MD5 de la clave de **test** | MD5 de la clave de **producción** — son distintas |

Dos trampas que costaron tiempo:

1. **El path del SIP cambia**, no solo el host: `/wsv1/rest` en test,
   **`/sipv1/rest`** en producción.
2. **Las contraseñas de test y producción son distintas**, en los dos
   proveedores. El `.env` traía las de test y el síntoma no es obvio:
   Triunfo responde `"Error Generando Token - Revisar los datos ingresados"` e
   InfoAuto un 401 en el login. Si algo devuelve 401/Unauthorized después de
   cambiar las URLs, lo primero a mirar son las credenciales, no la red.

### InfoAuto

| Variable | Hoy (demo) | Producción |
|---|---|---|
| `INFOAUTO_BASE_URL` | `https://demo.api.infoauto.com.ar/cars/pub` | `https://api.infoauto.com.ar/cars/pub` |
| `INFOAUTO_AUTH_URL` | `https://demo.api.infoauto.com.ar/cars/auth` | `https://api.infoauto.com.ar/cars/auth` |
| `INFOAUTO_MOTO_BASE_URL` | `.../motorcycles/pub` | **no disponible** — ver sección 4 |
| `INFOAUTO_MOTO_AUTH_URL` | `.../motorcycles/auth` | **no disponible** |
| `INFOAUTO_PRICES_ENABLED` | — | `false` — la valuación no está contratada |
| `INFOAUTO_EMAIL` | `lumarsoftarg@gmail.com` | mismo — verificado, devuelve 200 |
| `INFOAUTO_PASSWORD` | clave de demo | clave de producción, **distinta**. Rotar: se compartió en texto plano el 03/08 |

El JWT de InfoAuto trae los roles de la cuenta en el payload:
`Desarrollo`, `Extras`, `Modelos`. No hay rol de precios — de ahí los 403.

### Otras

| Variable | Acción |
|---|---|
| `TRIUNFO_CARTERA_SYNC_ENABLED` | ya está en `true`; con URLs productivas empieza a traer la cartera real |
| `TRIUNFO_CARTERA_BACKFILL_MONTHS` | 6 meses = ~26 llamadas por código (ventanas de 7 días). Arrancar con esto y medir |

---

## 2. Lo verificado contra producción

### 2.1 El puente InfoAuto ↔ Triunfo

Triunfo no tiene catálogo propio: con `Catalogo: "IA"` resuelve el vehículo
contra InfoAuto. La correspondencia es:

```
codia    = MarcaIA * 10000 + ModeloIA
MarcaIA  = Math.floor(codia / 10000)
ModeloIA = codia % 10000
```

Ejemplo real de la cartera: una póliza devuelve `MarcaIA: 12`, `ModeloIA: 53`
para un "CHEVROLET CORSA 1.6 3P". En InfoAuto es el CODIA **120053**,
"CORSA 1.6 3 P GL AA DH", comercializado 1997-2008.

**Validado sobre el catálogo completo: 13.082 de 13.082 modelos cumplen la
regla, cero excepciones.** El índice de modelo más alto es 1011 (Volkswagen),
así que hay margen de sobra hasta los 4 dígitos.

Trampa: `ModeloIA` viaja sin ceros a la izquierda (`53`, no `0053`). Hay que
hacer la conversión con aritmética, nunca concatenando strings.

### 2.2 Permisos de la cuenta de InfoAuto

La suscripción incluye el catálogo pero **no la valuación**:

| Endpoint | Prod |
|---|---|
| `/pub/brands/`, `/groups/`, `/models/`, `/models/{codia}` | 200 |
| `/pub/models/{codia}/as_codia`, `/features/` | 200 |
| `/pub/features/`, `/pub/datetime`, `/pub/current_year` | 200 |
| `/pub/brands/{id}/prices/` | 200 — devuelve solo los **años**, no importes |
| `/pub/models/{codia}/list_price` | **403** |
| `/pub/models/{codia}/prices/` | **403** |
| `/pub/models/{codia}/photos/` | **403** |
| `/pub/batch/` | **403** |
| `/pub/archives/...` (todo el histórico) | **403** |

No bloquea la cotización: mandando `Valor: "0"` Triunfo resuelve el valor de
mercado con su propia suscripción y lo devuelve en
`DatosAdicionales.ValorVehiculo`.

Lo que no se puede hoy: mostrar el valor del vehículo antes de cotizar, y
refrescar sumas aseguradas de la cartera por cuenta propia.

### 2.3 El campo `Origen`

Sale del **feature 21 ("Importado")** de InfoAuto:

| feature 21 | Significado | Triunfo `Origen` |
|---|---|---|
| `NO` | Nacional / Mercosur | `"N"` |
| `SI` | Internacional | `"I"` |
| `MX` | México | `"I"` (a confirmar) |
| `CH` | China | `"I"` (a confirmar) |

Contrastado: el Corsa 120053 tiene el feature 21 en `NO` y su póliza en Triunfo
dice `Origen: "N"`.

### 2.4 Límites y cachés

- InfoAuto `access_token`: 1 h. `refresh_token`: 24 h.
- InfoAuto `/brands/download/`: 20 llamadas / 24 h.
- InfoAuto paginación: `page_size` máximo **100** (un 422 si se pide más).
  El catálogo son 153 marcas y 13.082 modelos → 131 páginas.
- Triunfo JWT: ~24 h. **Pedirlo en cada request puede hacer que bloqueen la IP.**
- Triunfo `RESTNovedadesCartera`: ventanas de **7 días** como máximo.
  7 días = 225 novedades, 679 KB, 15,4 s. 30 días nunca completa.
- Triunfo producción hace **whitelisting de IP**: hay que darles la IP del
  servidor antes de desplegar.

---

## 3. Qué matchea y qué no en el código actual

### ✅ Correcto, no tocar

**`CotizadorService.toTriunfoModelCode()`** (`src/cotizador/cotizador.service.ts:280`)
ya implementa `codia - brand * 10000` con guarda de rango. Coincide exactamente
con la regla verificada.

**`TriunfoService.loadOrRenewToken()`** persiste el JWT en `IntegrationToken` y
lo reutiliza entre reinicios. Es justo lo que hace falta para no gatillar el
bloqueo de IP.

**`TriunfoService`** ya contempla que `RESTConsultaInspV2` responde con
`SDTConsultaInsp` + `SDTResultado` (no `...Out` + `Resultado`), que es como se
comporta producción y no como decía el manual de sandbox.

**Ventanas de 7 días** en la cartera sync: ya está resuelto.

### ❌ Se rompe en producción

**`InfoAutoService.getVehicleValue()`** (`src/infoauto/infoauto.service.ts:121`)
Llama a `/prices/` y `/list_price`, ambos **403**. Hoy el `catch` devuelve
`null` y el cotizador cae a `Valor: '0'`, así que *funciona por accidente* —
pero cada cotización gasta dos requests que siempre fallan y ensucia el log con
un warning por cada una.

Además arrastra dos bugs que quedarían latentes si se contratan los precios:

```typescript
const value = data?.price ?? data?.list_price   // `price` no existe en el contrato
return value ? (value * 1000).toFixed(2) : null // el ×1000 nunca se verificó
```

El contrato real es `{ "list_price": number }`. Y si algún día se habilita,
antes hay que confirmar la unidad comparando contra el `ValorVehiculo` de
Triunfo.

**Recomendación:** cortocircuitar el método detrás de un flag
(`INFOAUTO_PRICES_ENABLED=false`) y devolver `null` sin salir a la red. Cuando
se contrate la valuación, se prende y se corrigen los dos bugs de arriba.

**Catálogo de motos** (`src/infoauto/infoauto.service.ts:42`)
`VehicleType.MOTO` apunta a `/motorcycles`. En producción el login devuelve
**401 "Username not found"**: la cuenta no existe en ese catálogo.

El constructor usa `getOrThrow` sobre `INFOAUTO_MOTO_*`, así que si se borran
esas variables **la app no arranca**. Hay que dejarlas apuntando a algo o
hacerlas opcionales, y que cualquier request de motos falle con un error claro
en vez de un 401 de InfoAuto.

### ⚠️ Funciona pero pierde información

**`Origen: 'N'` hardcodeado** (`cotizador.service.ts:109`)
Todos los vehículos se cotizan como nacionales. Un importado va a cotizar mal.
Se resuelve leyendo el feature 21 (sección 2.3).

**`CeroKM: 0` hardcodeado** (`cotizador.service.ts:105`)
No hay forma de cotizar un 0km. El DTO no expone el campo.

**`Vehiculo` no guarda `MarcaIA`/`ModeloIA`**
(`prisma/schema.prisma`, `cartera-sync.service.ts:457`)
La sincronización de cartera recibe esos dos campos en `SDTVehiculoDatos` y los
descarta: solo persiste `marca` y `modelo` como texto. Con eso se pierde la
capacidad de volver a InfoAuto desde una póliza — para refrescar valores,
mostrar la ficha técnica o la foto del auto asegurado.

Es un cambio chico y vale la pena hacerlo antes del backfill, para no tener que
re-sincronizar después:

```prisma
model Vehiculo {
  // ...
  marcaIA  Int?  // InfoAuto brand id
  modeloIA Int?  // InfoAuto model index — codia = marcaIA * 10000 + modeloIA
  codia    Int?  // derived, indexed for lookups
}
```

**`InfoAutoService.getModels()`** solo expone
`/brands/{brandId}/groups/{groupId}/models/`, que obliga a pasar por grupo.
Falta `/pub/search/` (búsqueda libre por texto, con `query_mode=similarity` para
tolerar errores de tipeo) y `/brands/{brandId}/models/`. Para el buscador del
front, `search` es el endpoint natural.

### Endpoints de Triunfo bloqueados

Sin relación con el código, pero condicionan qué se puede construir:

| Endpoint | Estado |
|---|---|
| `RESTCotizadorAutV2` | OK — genera presupuesto con primas reales |
| `RESTNovedadesCartera` | OK — 225 novedades en 7 días |
| `RESTConsultaInspV2` | responde, pero no encuentra ninguna operación de la cartera |
| `RESTInspeccionPFV2` | **500** — `Unrecognized field "Autenticacion"`, contrato desconocido |
| `RESTPreInspV2` | **500** — ídem |
| `RESTSolicitudAutomotoresV2` | sin probar — emite póliza real y facturable |

El circuito de emisión está **cortado en la inspección**: sin `RESTInspeccionPFV2`
ni `RESTPreInspV2` no hay inspección aprobada, y sin eso la emisión
probablemente rebote. Depende de que Triunfo mande el contrato correcto.

---

## 4. Motos

No hay catálogo de motos disponible:

- La cuenta da **401 "Username not found"** en `/motorcycles/auth/login` de
  producción.
- En el portal de InfoAuto la suscripción figura como **AUTOS**.
- El spec productivo declara un solo servidor: `https://api.infoauto.com.ar/cars/pub`.

Triunfo sí tiene el artículo **481 = moto**, así que el circuito existe del lado
de la aseguradora — lo que falta es de dónde sacar los códigos.

Para habilitarlo hay que contratar el catálogo de motos con InfoAuto y después
confirmar con Triunfo que con `Catalogo: "IA"` y artículo 481 espera el mismo
esquema `Marca`/`Modelo` que los autos.

Mientras tanto, `VehicleType.MOTO` no debería quedar expuesto en el front.

---

## 5. Estado de la migración

Hecho el 03/08/2026:

- [x] URLs productivas de Triunfo e InfoAuto en `.env`
- [x] Contraseñas de producción de los dos proveedores
- [x] `INFOAUTO_PRICES_ENABLED=false` — `getVehicleValue()` ya no sale a la red
- [x] Catálogo MOTO desregistrado: un request de motos devuelve 503 con mensaje
      claro en vez de un 401 de InfoAuto
- [x] `Origen` leído del feature 21, con caché en memoria por codia
- [x] `marcaIA` / `modeloIA` / `codia` en `Vehiculo` + migración aplicada
- [x] `cartera-sync` persiste esos códigos
- [x] Verificación end-to-end (ver arriba)

Pendiente antes de desplegar al servidor:

1. **Pedirle a Triunfo el whitelisting de la IP del servidor.** Desde una IP
   nueva el token puede fallar, y es lo que más tarda en gestionarse.
2. **Rotar la contraseña de InfoAuto** — se compartió en texto plano.
3. **Arreglar `npm run start:prod`**: apunta a `dist/main`, pero como
   `prisma.config.ts` vive en la raíz el `rootDir` se corre y Nest compila a
   `dist/src/main`. Hoy el script falla con `MODULE_NOT_FOUND`.
4. Poner `TRIUNFO_CARTERA_SYNC_ENABLED=true` **solo en el servidor** (ver 5.1),
   correr el backfill y medir antes de subir `BACKFILL_MONTHS`.

Puede esperar: exponer `CeroKM` en el DTO de cotización (hoy va fijo en 0, no se
pueden cotizar 0km) y agregar `/pub/search/` y `/brands/{id}/models/` al
servicio de InfoAuto, que hoy obliga a pasar por grupo.

### 5.1 Por qué la sync de cartera queda en `false` en local

`CarteraSyncService` implementa `OnApplicationBootstrap`: arranca una sync en
cada boot. Con las URLs productivas y el watch mode, cada reinicio dispararía un
backfill contra Triunfo real (~26 llamadas de 15 s por código en la primera
corrida). En local se deja en `false` y se corre a mano por el endpoint de admin
cuando haga falta; en el servidor va en `true`.

---

## 6. Pendientes con terceros

**Triunfo** (consultas ya enviadas por mail):
- Contrato correcto de `RESTInspeccionPFV2` y `RESTPreInspV2` (consulta 2).
- Si `RESTConsultaInspV2` puede ver pólizas de cartera o solo operaciones
  nacidas por API (consulta 6).
- Si se puede emitir una póliza de prueba en producción y anularla (consulta 11).
- Qué espera en `Marca`/`Modelo` para el artículo 481 (motos).
- Cómo mapea `MX` y `CH` del feature 21 de InfoAuto.

**InfoAuto:**
- Qué cuesta agregar la valuación (`list_price`, `prices`, `batch`).
- Qué cuesta el catálogo de motos y si va con el mismo usuario.
