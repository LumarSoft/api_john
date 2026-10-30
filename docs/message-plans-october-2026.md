# Planes de mensajes desde el 30 de octubre de 2026

## Qué cambia

Reemplaza los planes por tokens del 29 de octubre (`token-plans-october-2026.md`):

- **Se habla de mensajes, no de tokens.** 1 mensaje = 1 mensaje que la plataforma envía por WhatsApp: respuestas
  del bot, mensajes de la oficina desde el panel y avisos por plantilla (rechazos, pólizas vencidas). Los mensajes
  que escriben los clientes y los que se mandan desde la app WhatsApp Business del celular no cuentan. Es el
  contador `metaMessages` de `UsageMonthly`.
- **Un solo catálogo, del Owner.** Lumar define los planes para toda la plataforma (nombre, mensajes incluidos,
  precio) desde Facturación → Planes. Es lo que ven y pagan todas las organizaciones. El SuperAdmin ya no arma
  catálogo ni precios. El precio puede ser 0.
- **El SuperAdmin asigna el plan de cada número** (`PATCH /admin/billing/numbers/:id/plan`). Un número sin plan
  asignado está en el plan pago más chico.
- **Subida automática.** Cuando un número envía más mensajes de los que incluye su plan, pasa al plan activo más
  chico que los cubre y **queda en ese plan** (el SuperAdmin lo puede volver a bajar). Se avisa con una novedad en
  Asuntos pendientes (tipo `plan`, abre Facturación) y un mail a los SuperAdmins de la organización.
- **Prueba = un plan más**, de precio 0 y marcado como prueba (`isTrial`). Un número nuevo de una organización creada
  desde `COMMERCIAL_TRIAL_FROM` arranca en ese plan; vale solo en su primer mes de servicio. Si lo supera, sube al
  plan pago que corresponda. Desde el segundo mes queda en el plan pago más chico. Hay un solo plan de prueba activo
  y su precio tiene que ser 0.
- **Meta lo paga siempre Lumar.** El costo real de Meta se registra por mensaje con el `billable` y la categoría del
  webhook de estados (los 1.000 mensajes de servicio gratis de cada número quedan en costo 0; las plantillas se
  cobran desde el primero). OpenAI está precargado: se registra aparte y **no entra en la ganancia**.
- **Tablero del Owner** (`GET /owner/billing`): por mes, organización y número, lo facturado, el costo real de Meta,
  OpenAI aparte y la ganancia (facturado − Meta).

## Reglas de facturación

- Un número activo paga al menos su plan, aunque no envíe mensajes.
- Mientras sus mensajes del mes entran en su plan, el mes se cobra a ese plan.
- Si los supera, el mes se cobra al plan activo más chico que los cubre (y el número queda en ese plan).
- Pasado el plan más grande, el mes se cobra a ese plan más bloques de `COMMERCIAL_TOKEN_BLOCK_SIZE` (1.000)
  mensajes al precio por mensaje del plan más grande. Se avisa una vez, con el primer mensaje que lo supera.
- En su primer mes de servicio, en su propio plan pago y sin superarlo, el plan se prorratea desde el día en que salió
  el primer mensaje (el día de inicio cuenta). Si ese mes sube de plan, se cobra completo.
- No se factura un número que todavía no envió nada, ni uno inactivo sin mensajes en el mes.
- Un plan apagado conserva sus números, pero ningún número sube a él. Un plan retirado manda sus números al plan
  pago más chico. Siempre tiene que quedar al menos un plan pago activo.
- El presupuesto de IA por número (`monthlyBudgetUsd`, solo lo fija el Owner) limita solo el gasto de OpenAI y no
  tiene relación con el plan.

## Ejemplos con el catálogo inicial

Catálogo inicial: Prueba 100 mensajes USD 0, Inicial 500 USD 25, Profesional 1.000 USD 50. Costo de Meta en
Argentina: USD 0,026 por mensaje de servicio pasados los 1.000 gratis del mes, USD 0,0618 por plantilla de
marketing.

| Caso | Plan asignado | Mensajes del mes | Se cobra | Facturado | Meta | Ganancia |
|---|---|---|---|---|---|---|
| Cuenta nueva, primer mes, tranquilo | Prueba | 80 | Prueba | USD 0 | USD 0 | USD 0 |
| Cuenta nueva, primer mes, movido | Prueba | 350 | Inicial (sube) | USD 25 | USD 0 | USD 25 |
| Mes tranquilo | Inicial | 180 | Inicial | USD 25 | USD 0 | USD 25 |
| Supera su plan | Inicial | 900 | Profesional (sube) | USD 50 | USD 0 | USD 50 |
| Pasa los 1.000 gratis de Meta | Profesional | 1.350 | Profesional + 1.000 | USD 100 | USD 9,10 | USD 90,90 |
| Número que salió el 21 de octubre | Inicial | 100 | Inicial, 11 de 31 días | USD 8,87 | USD 0 | USD 8,87 |

## Base de datos

Migración `20261030120000_global_message_plans`, aditiva:

- `TokenPlan` (en Prisma, `MessagePlan`; la columna `tokens` es el campo `messages`): `producerId` pasa a ser
  opcional (null = catálogo de la plataforma) y se agrega `isTrial`. Inserta el catálogo inicial.
- `PhoneNumber`: se agregan `planId` (plan asignado) y `planUpgradedAt` (última subida automática). Los números que
  tenían tokens de prueba (`trialTokens` > 0) quedan en el plan Prueba.
- No borra nada: los catálogos viejos de cada organización y `PhoneNumber.trialTokens` quedan en la base sin uso, así
  la API anterior sigue funcionando si hay que volver atrás. Se pueden borrar más adelante.

## Despliegue

1. Solo después de pasar a JPMG al panel de Polisend (`polisend-panel`): el panel de `front_John` no conoce estos
   endpoints.
2. API: `pnpm exec prisma migrate deploy`, `pnpm exec prisma generate`, build y `pm2 restart john_api --update-env`.
   El bot no cambia.
3. Panel: la rama de Facturación v3 de `polisend-panel`.
4. El Owner revisa el catálogo inicial en Facturación → Planes y los SuperAdmins asignan los planes de sus números.

Variables: `COMMERCIAL_TOKEN_BLOCK_SIZE` (1.000) y `COMMERCIAL_TRIAL_FROM` (2026-10-29). `COMMERCIAL_TOKEN_PRICE_USD`
y `COMMERCIAL_TRIAL_TOKENS` ya no se usan.
