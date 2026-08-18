# WhatsApp Coexistence — runbook de salida a producción

Fecha objetivo: 2026-08-19. Este procedimiento conecta el número existente de
WhatsApp Business del cliente con la Cloud API sin desinstalar la app ni borrar
la cuenta del teléfono.

## Criterios de GO / NO-GO

No iniciar el alta del número definitivo si falta cualquiera de estos puntos:

- Confirmar primero el modelo de propiedad. Si la app, el Business Portfolio y
  el número definitivo son todos de JPMG, JPMG actúa como Direct Developer sobre
  activos propios: Standard Access alcanza y el usuario que autoriza debe tener
  rol de administrador/desarrollador en la app. App Review y modo Live pasan a
  ser obligatorios cuando JPMG incorpore WABAs de otras empresas/clientes.
- Organización JPMG verificada y Access Verification / Tech Provider completos.
- Embedded Signup configurado con el dominio HTTPS de producción y el
  `config_id` correcto.
- Webhook HTTPS verificado y suscripto a `messages`, `account_update`, `history`,
  `smb_app_state_sync` y `smb_message_echoes`.
- Migración `20260818223000_waba_accounts_and_message_ids` aplicada con
  `npx prisma migrate deploy`. Nunca usar `migrate dev` contra producción.
- API, bot y frontend desplegados desde el mismo release y builds verdes.
- Variables de la API: `META_APP_ID`, `META_APP_SECRET`, `META_ES_CONFIG_ID`,
  `META_GRAPH_VERSION=v25.0`, `WABA_TOKEN_ENCRYPTION_KEY` (64 hex) y
  `BOT_SECRET`. El `BOT_SECRET` debe coincidir en API y bot.
- WhatsApp Business actualizado (Meta exige al menos 2.24.17), teléfono con
  batería/cargador y buena conexión, y copia de seguridad reciente de la app.

## Qué cuenta usar

- La app de Meta, la organización Tech Provider y la integración son propiedad
  de JPMG. Lumar es el equipo técnico, no el dueño de los activos de Meta.
- El login de Embedded Signup debe hacerlo una persona con control total del
  Business Portfolio de JPMG y rol de administrador/desarrollador en la app de
  JPMG. La cuenta personal de Lucas sólo puede usarse si JPMG le otorgó ese rol;
  no debe quedar como único propietario ni administrador.
- El WABA, número y método de pago deben quedar bajo el Business Portfolio de
  JPMG. Como Tech Provider sin línea de crédito de un Solution Partner, JPMG
  agrega su propio método de pago al WABA.
- Llevar acceso al correo/teléfono de recuperación de esa cuenta y tener otro
  administrador del portfolio como respaldo. No compartir contraseñas.

## Preparación antes de llegar a la oficina

1. Si este número pertenece al propio portfolio de JPMG, confirmar que el
   usuario que hará el alta figura como administrador/desarrollador de la app;
   no publicar la app sólo para completar el checklist. Si JPMG va a incorporar
   portfolios de terceros, entonces sí presentar App Review: para
   `whatsapp_business_management`, Meta pide explicación escrita y video creando
   una plantilla; para `whatsapp_business_messaging`, explicar y mostrar el
   flujo real de envío y recepción.
2. Aplicar la migración y desplegar. Dejar `BOT_AUTOREPLY_ENABLED=false` durante
   la conexión: el webhook seguirá absorbiendo mensajes, pero no responderá de
   forma automática hasta terminar las pruebas.
3. Confirmar desde producción que el panel `/admin/numeros` muestra el botón de
   conexión. No imprimir ni copiar tokens en chats o documentos.
4. Tener tres teléfonos/números: el teléfono comercial, un cliente de prueba y
   un segundo cliente de prueba para verificar conversaciones simultáneas.
5. Avisar al personal: durante el alta se desvinculan los dispositivos
   asociados. Después se pueden volver a vincular los soportados. Grupos no se
   sincronizan; mensajes temporales, ver-una-vez, ubicación en vivo y listas de
   difusión tienen limitaciones en Coexistence.

## Deploy manual en el VPS

Estado confirmado el 2026-08-18:

- App Meta: `john-bot-suc-rosario`, ID completo `1185311790403482`.
- Releases publicados: API `42582ac`, bot `d0c81f6`, frontend `83e75b6`.
- La migración `20260818223000_waba_accounts_and_message_ids` fue aplicada a la
  base configurada. Volver a ejecutar `migrate deploy` es idempotente, pero
  comprobar primero que el proceso apunta a la base correcta.

Los secretos viven únicamente en los `.env` locales/servidor y nunca se
commitean. Antes de reiniciar, copiar de forma segura al VPS los valores nuevos
de `JWT_SECRET`, `BOT_SECRET` y `WABA_TOKEN_ENCRYPTION_KEY`; `BOT_SECRET` debe
ser exactamente el mismo en API y bot. El `WEBHOOK_VERIFY_TOKEN` del bot debe
coincidir con el usado al guardar el callback en Meta.

API:

```bash
cd /ruta/a/api_john
git pull --ff-only origin master
npm ci
npx prisma generate
npx prisma migrate status
npx prisma migrate deploy
npm run build
pm2 restart john_api --update-env
pm2 status
```

Bot, todavía sin respuestas automáticas:

```bash
cd /ruta/a/BOT_JPMG
git pull --ff-only origin master
npm ci
npm run build
# Confirmar BOT_AUTOREPLY_ENABLED=false en .env antes del restart.
pm2 restart john_bot --update-env
pm2 status
```

Verificación inmediata:

```bash
curl -I https://api.jpmanagementgroup.com.ar/
curl -I https://bot.jpmanagementgroup.com.ar/webhook
pm2 logs john_api --lines 100 --nostream
pm2 logs john_bot --lines 100 --nostream
```

El webhook devuelve `403` sin los parámetros de verificación; eso confirma que
el endpoint está protegido y no implica una falla. No habilitar
`BOT_AUTOREPLY_ENABLED=true` hasta completar el smoke test de este documento.

## Alta en la oficina

1. Mantener WhatsApp Business instalado, abierto y conectado. No borrar la
   cuenta, no migrar a WhatsApp normal y no registrar el número manualmente en
   Cloud API.
2. Ingresar al panel de John como SUPERADMIN y pulsar **Conectar número de
   WhatsApp**.
3. El administrador de JPMG inicia sesión en Meta y elige el Business Portfolio
   de JPMG.
4. Elegir la opción de conectar el número existente de WhatsApp Business. Si el
   flujo ofrece crear/reemplazar el número en vez de conectar la app existente,
   cancelar: no se activó el flujo de Coexistence.
5. En el teléfono comercial, abrir el mensaje de la cuenta oficial de Facebook,
   aceptar **Connect to the Business Platform**, permitir compartir el historial
   y copiar el código de verificación.
6. Completar Embedded Signup y esperar la confirmación del panel. No cerrar el
   teléfono durante la sincronización.
7. Verificar en logs:
   - `WABA ... conectada ... coexistence=true`;
   - `historySyncRequested=true` y `contactsSyncRequested=true` en la respuesta;
   - webhooks `history` avanzando hasta 100%;
   - recepción de `smb_message_echoes`.
8. Si Meta no aceptó el sync y todavía estamos dentro de las 24 horas, usar el
   endpoint autenticado `POST /admin/whatsapp/{phone_number_id}/sync`. No
   repetirlo si el primer pedido fue aceptado: la sincronización es one-shot.
9. Confirmar con Graph API que `is_on_biz_app=true` y
   `platform_type=CLOUD_API`.

## Smoke test obligatorio antes de habilitar el bot

Con `BOT_AUTOREPLY_ENABLED=false`:

1. Cliente A envía texto y foto. Ambos deben aparecer en WhatsApp Business y en
   los logs/webhook; no debe salir respuesta automática.
2. Un empleado responde desde WhatsApp Business. Debe llegar
   `smb_message_echoes`, guardarse el mensaje y quedar `botPaused=true` para esa
   conversación.
3. Cliente A vuelve a escribir: el mensaje se guarda y el bot permanece callado.
4. Liberar la conversación desde el inbox, habilitar
   `BOT_AUTOREPLY_ENABLED=true` y reiniciar el servicio del bot.
5. Cliente A escribe de nuevo: debe recibir una sola respuesta, visible también
   en la app comercial.
6. Cliente B escribe al mismo tiempo: su conversación debe avanzar sin quedar
   pausada por la de A.
7. El empleado vuelve a responder a A desde la app: A se pausa; B continúa.
8. Probar una imagen y una respuesta desde el inbox web.

Sólo después de los ocho puntos se declara el número operativo.

## Qué significa “no perder mensajes”

- Coexistence conserva la app comercial como canal de respaldo: si el bot o la
  API fallan, el mensaje debe seguir visible en el teléfono.
- El código recorre todos los `entry[]/changes[]`, deduplica reintentos de echoes
  y usa el token correspondiente al WABA del cliente.
- El historial de hasta 180 días se solicita y se absorbe sin generar respuestas
  antiguas. Actualmente se registra el progreso, pero no se importa ese backlog
  al inbox de John; los chats históricos continúan en WhatsApp Business. Con
  `MESSAGE_RETENTION_DAYS=30`, importar seis meses tampoco tendría sentido sin
  cambiar antes la política de retención.
- No existe garantía absoluta: grupos y ciertos dispositivos/formatos no generan
  los mismos webhooks. Durante el corte debe haber una persona mirando el
  teléfono comercial y otra los logs del bot.

## Rollback

- Si falla una prueba, volver a `BOT_AUTOREPLY_ENABLED=false`; el cliente puede
  seguir atendiendo desde WhatsApp Business mientras se investiga.
- No usar **Disconnect Account** salvo decisión explícita: dispara
  `PARTNER_REMOVED` y corta la integración.
- Guardar hora, `session_id`/código de error de Embedded Signup, WABA ID y
  phone-number ID. Nunca guardar el business token en texto plano.

## Documentación de Meta

- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
