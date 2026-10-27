# Consumo mensual por número desde octubre de 2026

## Tarifa comercial del servicio: planes por tokens

Desde el 27 de octubre de 2026 cada número se factura con planes por tokens,
a mes vencido. Reemplaza la tarifa anterior por tokens de IA + mensajes Meta
con mínimo USD 50 y máximo USD 100.

- 1 token = 1 mensaje que la plataforma envía por WhatsApp: respuestas del bot
  y mensajes de la oficina desde el panel. Es el contador `metaMessages`. Los
  mensajes que escriben los clientes y los que se envían desde la app WhatsApp
  Business del celular no cuentan.
- Los tokens se venden en bloques de 1.000 a USD 50: Inicial (hasta 1.000,
  USD 50), Estándar (hasta 2.000, USD 100), Profesional (hasta 3.000, USD 150),
  Avanzado (hasta 4.000, USD 200) y luego USD 50 por cada 1.000 más.
- El plan se elige cada mes con los tokens de ese mes: si se pasa de su plan,
  ese mes se factura el siguiente; si baja, vuelve al que corresponda.
- Un número activo paga al menos el plan Inicial, aunque no envíe mensajes.
  En su primer mes de servicio ese mínimo se prorratea desde el día en que salió
  el primer mensaje (el día de inicio cuenta). Si ese mes supera los 1.000 tokens,
  se cobra el plan completo.
- No se factura un número que todavía no envió nada, ni uno inactivo sin
  mensajes en el mes.

El inicio de servicio es el primer evento de consumo del primer mes con
registros del número (`UsageEvent` dentro del primer `UsageMonthly.period`).
Los meses registrados antes de que existieran eventos toman el día 1.

`COMMERCIAL_TOKEN_BLOCK_SIZE` (1000) y `COMMERCIAL_TOKEN_BLOCK_PRICE_USD` (50)
configuran los bloques. Las variables `COMMERCIAL_MONTHLY_MIN_USD`,
`COMMERCIAL_MONTHLY_MAX_USD`, `COMMERCIAL_TOKEN_PRICE_PER_1000` y
`COMMERCIAL_META_MESSAGE_PRICE_USD` ya no se usan.

El costo estimado de los proveedores se registra por separado y se muestra
únicamente al propietario, junto con la ganancia: importe comercial menos costo.
El panel del cliente muestra tokens, plan e importe, sin el costo de proveedores.

El presupuesto por número (`monthlyBudgetUsd`, por defecto
`DEFAULT_MONTHLY_BUDGET_USD`) limita solo el gasto de OpenAI: al alcanzarlo el
bot deja de usar el LLM. El costo de Meta ya no cuenta, porque cada mensaje es
un token que paga el cliente; con el criterio anterior un número del plan
Estándar superaba USD 20 de Meta y perdía el LLM.

## Tarifas verificadas el 30 de septiembre

- Meta, destinatarios de Argentina: USD 0,026 por mensaje de servicio, utilidad
  o autenticación facturable; USD 0,0618 por mensaje de marketing.
- Desde el 1 de octubre se cobran los mensajes de servicio. Los primeros 1.000
  por número y mes son gratuitos. El indicador `pricing.billable` de Meta
  determina si corresponde cobrar, incluidas las ventanas gratuitas.
- GPT-5.6 Luna, el modelo configurado en el bot: por millón de tokens,
  USD 0,20 de entrada, USD 0,02 de entrada en caché y USD 1,20 de salida.
  Para solicitudes con más de 272.000 tokens de entrada, se aplican los
  multiplicadores publicados de 2 para entrada y 1,5 para salida.

Fuentes oficiales:

- [Meta: precios y tabla efectiva en octubre](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#rate-cards-effective-october-1-2026)
- [OpenAI: GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

Son estimaciones con tarifas de lista en USD, sin impuestos ni descuentos por
volumen. No son importes reconciliados con las facturas de los proveedores.
Meta cobra según categoría y país del destinatario; `META_DEFAULT_MARKET`
configura el mercado de respaldo para prefijos no contemplados por el mapeo.
Revisar ese mapeo si se incorporan destinatarios de otros países.

La cantidad de llamadas OpenAI se muestra como actividad. Su costo depende de
los tokens de cada llamada, incluidos los tokens en caché. Una respuesta del
bot puede requerir varias llamadas por consultas a herramientas.

## Registro y actualización

Aplicar la migración `20260930140000_monthly_message_billing` antes de iniciar
la API con este código. Actualizar API, bot y frontend juntos: el nuevo
contrato de consumo Meta registra mensajes individuales, no conversaciones.

Los mensajes se registran al recibir `delivered`, con deduplicación persistente
por número y mensaje. El webhook falla si la API no logra persistirlos para que
Meta reintente. Cada llamada OpenAI se registra por ID de completion; el bot
reintenta tres veces y deja un error en el log si falla el registro.

Los meses previos conservan el costo del proveedor registrado; la tarifa comercial se calcula con los contadores disponibles. No se pueden reconstruir sus
conteos exactos de mensajes y llamadas desde los antiguos totales agregados.
Este cambio no aplica migraciones ni despliega servicios en producción.

Este ajuste comercial no agrega tablas ni columnas: no requiere una migración
nueva. La migración anterior de consumo mensual debe estar aplicada.
