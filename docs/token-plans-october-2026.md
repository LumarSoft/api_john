# Planes por tokens configurables desde el 29 de octubre de 2026

## Tarifa comercial del servicio: costo fijo por token, planes y precios a medida

Desde el 29 de octubre de 2026 cada número se factura con un plan de tokens
que la organización elige de su propio catálogo, a mes vencido. Reemplaza los
bloques fijos de 1.000 tokens a USD 60 del 27 de octubre.

- 1 token = 1 mensaje que la plataforma envía por WhatsApp: respuestas del bot,
  mensajes de la oficina desde el panel y avisos (rechazos, pólizas vencidas).
  Es el contador `metaMessages`. Los mensajes que escriben los clientes y los
  que se envían desde la app WhatsApp Business del celular no cuentan.
- El costo por token es fijo y lo fija la plataforma:
  `COMMERCIAL_TOKEN_PRICE_USD`, USD 0,05. Un plan le cuesta a la organización
  tokens × costo: 500 tokens = USD 25, 1.000 tokens = USD 50. Es lo que la
  plataforma le factura a la organización por cada número (tarifa A).
- Cada organización arma su catálogo desde Facturación → Planes (SuperAdmin):
  nombre, cantidad de tokens y el precio al que lo vende a sus productores.
  El costo se muestra al lado de cada precio y el precio nunca puede quedar
  por debajo del costo: margen cero sí, pérdida no. Al crearse una organización
  recibe el catálogo inicial a costo: Inicial (500 tokens, USD 25) y
  Profesional (1.000 tokens, USD 50). Un ejemplo de precios con margen
  (tarifa B): Inicial USD 30, Profesional USD 60.
- Cada número tiene un plan. Lo elige el administrador del número o el
  SuperAdmin desde Facturación; un número sin plan está en el más chico del
  catálogo. El cambio rige en el mes en curso.
- El mes se factura en el plan que cubre los tokens: el del número mientras
  alcance; si se pasa, el plan más chico del catálogo que lo cubra; pasado el
  plan más grande, ese plan más bloques de `COMMERCIAL_TOKEN_BLOCK_SIZE`
  (1.000): el costo al costo por token y el precio al precio por token del
  plan más grande. El bot nunca se detiene por tokens.
- Un número activo paga al menos su plan, aunque no envíe mensajes. En su
  primer mes de servicio, sin prueba, ese plan se prorratea desde el día en
  que salió el primer mensaje (el día de inicio cuenta). Si ese mes se pasa de
  su plan, se cobra completo el plan que lo cubre.
- Plan Prueba: los números de una cuenta nueva (organización creada desde
  `COMMERCIAL_TRIAL_FROM`, 29 de octubre de 2026) envían gratis sus primeros
  `COMMERCIAL_TRIAL_TOKENS` (100) del primer mes de servicio, sin costo ni
  precio. Del token 101 en adelante el mes se cobra con la regla anterior, sin
  prorrateo. Las cuentas anteriores no tienen prueba.
- No se factura un número que todavía no envió nada, ni uno inactivo sin
  mensajes en el mes.

Ejemplos con el catálogo inicial. Tarifa A es el costo (USD 0,05 por token,
lo que la organización paga a la plataforma); tarifa B, un precio de reventa
con margen (Inicial USD 30, Profesional USD 60):

| Caso | Tokens del mes | Plan facturado | Tarifa A (costo) | Tarifa B (precio) |
|---|---|---|---|---|
| Cuenta nueva, primer mes, 80 mensajes | 80 | Prueba (100 gratis) | USD 0 | USD 0 |
| Cuenta nueva, primer mes, 350 mensajes | 350 (250 pagos) | Inicial (500) | USD 25 | USD 30 |
| Número en Inicial, mes tranquilo | 180 | Inicial (500) | USD 25 | USD 30 |
| Número en Inicial que se pasa | 900 | Profesional (1.000) | USD 50 | USD 60 |
| Número que supera el plan más grande | 1.430 | Profesional + 1.000 | USD 100 | USD 120 |
| Número que supera el plan más grande | 2.150 | Profesional + 2.000 | USD 150 | USD 180 |
| Número en Inicial que salió el 21 de octubre, 100 mensajes | 100 | Inicial, 11 de 31 días | USD 8,87 | USD 10,65 |

El inicio de servicio es el primer evento de consumo del primer mes con
registros del número (`UsageEvent` dentro del primer `UsageMonthly.period`).
Los meses registrados antes de que existieran eventos toman el día 1.

`COMMERCIAL_TOKEN_PRICE_USD` (0.05), `COMMERCIAL_TOKEN_BLOCK_SIZE` (1000),
`COMMERCIAL_TRIAL_TOKENS` (100) y `COMMERCIAL_TRIAL_FROM` (2026-10-29)
configuran la tarifa. `COMMERCIAL_TOKEN_BLOCK_PRICE_USD` ya no se usa: el
bloque cuesta tokens × costo.

`UsageMonthly.billedUsd` guarda lo que la plataforma le factura a la
organización (el costo). El costo estimado de los proveedores se registra por
separado y se muestra únicamente al propietario, junto con su ganancia: costo
facturado menos costo de proveedores.

Qué ve cada rol (pantallas Facturación y Números):

- Admin (productor): los números facturados a sus códigos, el plan de cada uno
  con su precio, la barra de consumo del mes (tokens usados sobre los del
  plan, más los de prueba en el primer mes) y el importe estimado del mes a los
  precios del catálogo. Puede cambiar el plan de sus números. Nunca ve el
  costo de la organización.
- SuperAdmin: lo mismo para todos los números de la organización, más el
  costo y el margen de cada número y del mes, el catálogo (crear, editar,
  retirar planes; precio y costo lado a lado) y, en Números, los mensajes y
  las llamadas y tokens de OpenAI.
- Owner: además, el costo de los proveedores y su ganancia (detalle de cada
  organización) y el presupuesto de IA.

La barra de consumo se actualiza con cada `delivered` de Meta; el panel la
refresca cada 10 segundos.

El presupuesto por número (`monthlyBudgetUsd`, por defecto
`DEFAULT_MONTHLY_BUDGET_USD`; solo lo fija el Owner) limita solo el gasto de
OpenAI: al alcanzarlo el bot deja de usar el LLM. No tiene relación con el plan.

## Tarifas verificadas el 30 de septiembre

Sin cambios respecto de `monthly-billing-october-2026.md`: Meta cobra USD
0,026 por mensaje de servicio, utilidad o autenticación facturable a
destinatarios de Argentina (los primeros 1.000 por número y mes son
gratuitos) y USD 0,0618 por mensaje de marketing; GPT-5.6 Luna cuesta USD
0,20 de entrada, USD 0,02 en caché y USD 1,20 de salida por millón de tokens.
Al precio de USD 0,05 por token, un mensaje de servicio cobrado por Meta deja
USD 0,024 antes del costo de OpenAI; los mensajes de marketing (USD 0,0618)
superan el precio del token y siguen excluidos de los avisos.

## Registro y actualización

Aplicar la migración `20261029000000_token_plans` antes de iniciar la API con
este código: crea `TokenPlan`, agrega `PhoneNumber.tokenPlanId` y
`PhoneNumber.trialTokens`, y carga el catálogo inicial en cada organización
existente. Los números existentes quedan sin plan asignado (el más chico) y
sin prueba (`trialTokens = 0`): ninguna cuenta actual es nueva.

Actualizar API y frontend juntos: el panel suma la sección Facturación y lee
el plan y el importe de cada número en Números. El bot no cambia. Las
propuestas comerciales con cada tarifa están en `propuestas/` (tarifa A y B).

`billedUsd` de cada `UsageMonthly` se recalcula con cada mensaje registrado y
al leer los reportes, así que un cambio de plan o de catálogo se refleja en
el mes en curso sin tareas adicionales.
