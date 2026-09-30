# Consumo mensual por número desde octubre de 2026

El importe estimado al cliente es `(costo Meta + costo OpenAI) × 3`, redondeado
a centavos al final del cálculo mensual. La ganancia estimada es el importe
menos ambos costos. No hay piso, techo ni prorrateo por días transcurridos.
El mes se determina en `America/Argentina/Cordoba`, según la fecha del evento.

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

Ejemplo: 3.000 mensajes de servicio en Argentina, con 1.000 gratuitos,
1 millón de tokens de entrada sin caché y 100.000 de salida:
Meta USD 52,00 + OpenAI USD 0,32 = costo USD 52,32;
importe al cliente USD 156,96; ganancia USD 104,64.

## Registro y actualización

Aplicar la migración `20260930140000_monthly_message_billing` antes de iniciar
la API con este código. Actualizar API, bot y frontend juntos: el nuevo
contrato de consumo Meta registra mensajes individuales, no conversaciones.

Los mensajes se registran al recibir `delivered`, con deduplicación persistente
por número y mensaje. El webhook falla si la API no logra persistirlos para que
Meta reintente. Cada llamada OpenAI se registra por ID de completion; el bot
reintenta tres veces y deja un error en el log si falla el registro.

Los meses previos conservan el costo registrado. No se pueden reconstruir sus
conteos exactos de mensajes y llamadas desde los antiguos totales agregados.
Este cambio no aplica migraciones ni despliega servicios en producción.
