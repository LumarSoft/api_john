# Consumo mensual por número desde octubre de 2026

## Tarifa comercial del servicio

El importe al cliente se calcula con todos los mensajes Meta entregados y la
suma de tokens de entrada y salida, incluidos los tokens en caché:

- USD 0,0375 por cada 1.000 tokens.
- USD 0,078 por cada mensaje Meta, sin excluir mensajes gratuitos del proveedor.
- Mes completo con uso: mínimo USD 50, máximo USD 100 por número.
- Sin tokens, llamadas ni mensajes: USD 0, aun cuando el número esté activo.
- Durante el mes corriente, solo se prorratea el mínimo por el tiempo
  transcurrido en Argentina. El consumo se acumula completo; no se multiplica
  por la fracción del calendario. El máximo siempre es USD 100.

Fórmula: `min(100, max(50 × fracción del mes, tokens / 1000 × 0,0375 + mensajes × 0,078))`.
Los meses cerrados tienen fracción 1. El redondeo a centavos ocurre al final.

Ejemplo: 62.218 tokens diarios durante 30 días suman 1.866.540 tokens,
importe comercial de USD 70,00 sin mensajes Meta. Con 100 mensajes adicionales,
el importe es USD 77,80. Un consumo mayor queda limitado a USD 100.

Las variables `COMMERCIAL_MONTHLY_MIN_USD`, `COMMERCIAL_MONTHLY_MAX_USD`,
`COMMERCIAL_TOKEN_PRICE_PER_1000` y `COMMERCIAL_META_MESSAGE_PRICE_USD`
configuran estos valores. Las antiguas columnas de planes por número no se usan.

El costo estimado de los proveedores se registra por separado y se muestra
únicamente al propietario, junto con la ganancia: importe comercial menos costo.
El panel del cliente muestra la tarifa del servicio y el total de mensajes,
sin detalles de bonificaciones del proveedor. El presupuesto que controla el
acceso al LLM sigue limitando el gasto del proveedor, no el precio comercial.

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
