/**
 * How the admin panel works, as the AI assistant reads it to explain a task
 * (tool como_usar_el_panel). Written from the panel's code on 2026-11-04: when
 * a section, tab or button changes, change it here too, or the assistant will
 * explain steps that no longer exist. Same text for Polisend and the JPMG
 * panel (they are level); who sets the plans is "el soporte de la plataforma".
 */
export const PANEL_GUIDE = `# Guía del panel

## Roles y cosas generales
- Administrador: ve solo los datos de sus códigos de productor y de sus números. SuperAdmin: ve toda la organización y además maneja Usuarios, el alta y la baja de números y los planes. El dueño de la plataforma tiene su propio panel (Organizaciones y el catálogo de planes), que no se explica acá.
- Filtro de número o productor: está en Inicio, Asuntos pendientes, Solicitudes, Whatsapp, Siniestros, Asegurados, Cobranzas y Campañas. El SuperAdmin elige entre "Todos", "Números / Sucursales" y "Productores". Arranca en el número principal de la oficina, así que para ver todo hay que elegir "Todos". Al administrador le aparece solo si tiene dos o más códigos.
- Los contadores del menú lateral marcan pendientes: asuntos por atender, tareas abiertas, solicitudes nuevas, chats que piden una persona, mejoras sin ver y servicios con falla. Cuando entra un mensaje nuevo suena un aviso.
- Abajo del menú, "Mensajes de <mes>" muestra cuánto se usó del plan y lleva a Facturación.
- Si arriba aparece un cartel rojo de que Triunfo rechaza las credenciales, mientras dure no se puede cotizar, no se pueden traer pólizas ni documentos y la cartera no se actualiza. La nueva contraseña de TriunfoNet se le pasa al soporte de la plataforma.
- El botón "Asistente" de la barra de arriba abre este asistente desde cualquier sección.

## Inicio
- Es un resumen en vivo con cuatro tarjetas: Asegurados, Solicitudes nuevas, Deuda por cobrar (con la cantidad de cuotas vencidas) y Siniestros abiertos.
- Tiene estos gráficos: Próximas renovaciones (6 meses, con la prima en riesgo), Cartera de clientes, Solicitudes por estado, Cobranzas y Siniestros.
- Si el asistente de un número se pausó por llegar al límite del plan, aparece un aviso con dos botones: "Pasar a <plan> · USD … por mes" o "Dejarlo en pausa hasta el <día>". Mientras está en pausa los mensajes se guardan y se puede contestar desde Whatsapp.

## Asuntos pendientes
- Junta lo que necesita atención del equipo: clientes que pidieron un asesor, pedidos de baja, siniestros, solicitudes, avisos de plan y caídas de Triunfo. Leer la conversación no resuelve el asunto: hay que cambiarle el estado.
- Arriba hay una tarjeta por categoría (Bajas, Pagos y cobranza, Cotizaciones y contratación, Siniestros, Documentación y cambios, Por clasificar). Tocar una filtra la lista.
- Filtros: "Todos los asuntos", estado ("Por atender" por defecto, "Todos los estados", Pendiente, En atención, Resuelto), número o productor, "Desde mi última visita" y un buscador por cliente, teléfono o motivo.
- En cada asunto se cambian la categoría y el estado con los desplegables. El botón dice "Ver chat", "Ver facturación" o "Ver detalle" según el tipo, y el DNI abre la ficha del asegurado.
- "Limpiar todas" quita todas las novedades a las que tenés acceso, no solo las filtradas. Chats, clientes, pólizas y siniestros se conservan, pero no se puede deshacer desde el panel.

## Tareas
- Son pendientes internos del equipo que no pasan por el bot: llamados para devolver, envíos y demás.
- Vistas: "Para mí", "Las que asigné" y "Todo el equipo" (esta solo la ve el SuperAdmin), cada una con "Por hacer" o "Hechas". Fuera de "Para mí" se puede filtrar por persona.
- Para crear una: "Nueva tarea", completar Para, Qué hay que hacer, Detalle, Para cuándo (Hoy, Mañana, Sin fecha o una fecha) y "Si viene de un llamado" (quién llamó y su teléfono), y tocar "Crear tarea".
- En cada tarea: el círculo la marca como hecha, el desplegable cambia el estado (Pendiente, En curso, Hecha) y "Responder" deja comentarios. El menú ⋮ tiene "Editar" y "Eliminar". Eliminar solo puede quien la creó o un SuperAdmin.
- La etiqueta "Nueva" o "Novedad" marca tareas sin ver o con respuesta nueva. En las que asignaste aparece "todavía no la vio" si la persona no la abrió.

## Solicitudes
- Son los pedidos de cotización de la web y del bot.
- Pestañas: Todas, Nuevas, Contactadas y Cerradas. Filtros: buscador (nombre, teléfono o email), "Todos los productos", origen ("Cotización online" o "Lead / asesor") y número o productor.
- Al abrir una solicitud, la pestaña "Datos" muestra el contacto, la cobertura, los precios cotizados y los documentos que mandó por WhatsApp. Ahí están "Hablar por WhatsApp", el Estado (Nueva, Contactada, Cerrada) y las "Notas internas", y se guarda con "Guardar cambios".
- La pestaña "Chat" muestra la conversación de WhatsApp de donde salió la solicitud, solo para leer. Para responder: "Abrir en Whatsapp". Los mensajes se borran a los 30 días y las solicitudes de la web no tienen chat.

## Whatsapp
- Es la bandeja de chats ("Chats"). Tiene un buscador por nombre, DNI o teléfono, los filtros Todos, No leídos, Pendientes y Tomados, y un filtro de números. El administrador ve solo los chats de sus números.
- Para escribirle a un cliente: abrir el chat y tocar "Tomar" (o "Tomar la conversación para escribir"). Desde ahí el bot deja de responder en ese chat. Para devolverlo: menú ⋮ y "Devolver al bot". Si el bot está apagado en ese número, se responde sin tomar el chat.
- Se pueden mandar textos, emojis, fotos JPG o PNG de hasta 5 MB y PDF de hasta 16 MB. Los archivos se adjuntan con el clip, pegándolos o arrastrándolos.
- Regla de las 24 horas: si el cliente no escribió en las últimas 24 horas, WhatsApp no deja mandarle un mensaje libre hasta que vuelva a escribir.
- El menú ⋮ del chat tiene "Ver ficha del asegurado" y "Editar contacto". En "Editar contacto" se puede desvincular al cliente si el chat quedó asociado a otra persona, y el bot le vuelve a pedir el DNI. La lupa busca dentro de la conversación.
- "Borrar chat" (en la flecha de cada chat) y "Borrar todos los chats" (en el ⋮ de la lista) eliminan los mensajes y reinician el bot para esos chats. No se puede deshacer.

## Siniestros
- Muestra las denuncias de la cartera. Arriba están los totales: Pendientes, En proceso, Resueltos y Sin N° compañía.
- Filtros: Pendientes (por defecto), En proceso, Resueltos o Todos, un buscador por nombre, DNI, certificado o número, y número o productor.
- Para gestionar uno: tocar la fila. Se ven el asegurado, la póliza, la descripción y los adjuntos. En "Gestión del reclamo" se elige el Estado, se carga el "N° de siniestro de la compañía" después de presentarlo en Triunfo y se toca "Guardar cambios".

## Asegurados
- Es la cartera, con estos totales: Asegurados, Pólizas vigentes, Por vencer (30d), Pólizas vencidas y Cuotas vencidas. Tocar vigentes, por vencer o vencidas filtra la lista.
- Filtros: buscador (nombre, DNI, email o patente), ramo (Automotor, Hogar, AP y sepelio, Comercial), orden (Apellido A–Z, Apellido Z–A, Más recientes), "Limpiar" y número o productor.
- La ficha tiene los botones WhatsApp ("Recordar pago por WhatsApp" si el cliente debe), "Llamar" y "Enviar email". WhatsApp abre tu propio WhatsApp con el mensaje armado; no sale por la bandeja del panel.
- La ficha tiene tres pestañas: Pólizas, Pagos (estado de las cuotas, deuda y "Recordar por WhatsApp") y Documentos.
- En Documentos, "Triunfo" trae los documentos de cada póliza con un botón "Descargar". "Credenciales" y "Certificados" se arman en el panel, y "Descargar PDF" abre la impresión del navegador para guardarlos.

## Cobranzas
- Sirve para seguir la deuda. Arriba, y para las dos pestañas, están el filtro de número o productor, "Todos los medios de pago" y el buscador.
- Pestaña "Cuotas": muestra Deuda total, Clientes con deuda, Cuotas vencidas y Cuotas rechazadas. Filtros: Vencidas (por defecto), Rechazadas, Pendientes y Toda la deuda. Cada fila tiene recordar por WhatsApp, llamar y enviar email.
- Pestaña "Pólizas vencidas": pólizas que vencieron en el último año y no se renovaron. Para avisar: tildarlas y tocar "Enviar aviso (n)", que sale desde el número con el que el cliente habla con la oficina, o "Avisados a mano (n)". La columna Aviso dice Avisado, Avisado a mano o No se envió.
- "Enviar aviso" queda bloqueado si el plan de tus números no incluye estos avisos o si la plantilla de WhatsApp todavía está en revisión de Meta.
- "Ocultar: no se renueva" saca una póliza de la lista con un motivo. Se recupera desde "Ocultas (n)".

## Rechazos
- Sirve para avisar débitos rechazados. Para cargar uno: "Cargar Excel" con el archivo de Triunfo (el de CBU o el de tarjetas).
- Cada carga muestra Para enviar, Avisados, Ya pagadas, Ya avisados antes, Sin WhatsApp y No se enviaron. Las filas "Para enviar" ya vienen tildadas.
- "Enviar avisos (n)": el bot escribe de a uno y, si el cliente contesta, sigue la charla sabiendo que es por el rechazo. "Marcar como avisados a mano (n)" no manda nada, y esas filas no se vuelven a ofrecer aunque lleguen en otro Excel.
- Para enviar, el plan tiene que incluir avisos de rechazos y Meta tiene que haber aprobado la plantilla. Mientras tanto se puede cargar el Excel y marcar a mano.
- "Eliminar carga" borra la lista; los avisos que ya salieron quedan en los chats.

## Campañas
- El sistema busca en la cartera a quién ofrecerle algo y la oficina elige a quién escribirle. Hay cinco: Mejora de coberturas, Cotizaciones sin cerrar, Renovaciones, Bajas y anulaciones, y Venta cruzada. Cada campaña es una tarjeta con su interruptor de prendido, la cantidad de clientes, el porcentaje de beneficio y el estado ante Meta.
- Para enviar, la campaña tiene que estar incluida en el plan, prendida y con el mensaje aprobado por Meta. Si falta algo, un cartel dice qué.
- Pestaña "Clientes": tildar clientes y elegir "Enviar (n)" (Meta cobra cada mensaje como marketing), "Ya lo contactamos (n)" o "No escribirle más (n)". Este último corta las campañas para ese cliente, pero no los avisos de rechazos ni de vencidas.
- Pestaña "Mensaje": se edita el texto con "Insertar dato", el "Beneficio (%)" y los ajustes de la campaña, y se toca "Guardar". Si cambiás el texto vuelve a revisión de Meta (de minutos a un día). "Consultar a Meta" actualiza el estado.

## Usuarios (solo SuperAdmin)
- Lista de administradores con su rol, sus códigos y la fecha de alta.
- "Nuevo usuario" pregunta primero el tipo de sucursal. Con "Sucursal existente" se cargan nombre, correo, contraseña (mínimo 6 caracteres), rol y, si es Administrador, los "Códigos asignados".
- "Sucursal nueva" es un paso a paso: Sucursal (código de Triunfo), Usuario, WhatsApp, Asistente y Plan.
- El menú ⋯ de cada usuario tiene "Editar" y "Eliminar". No te podés eliminar a vos mismo.

## Números
- La pantalla se llama "Números y consumo" y muestra los mensajes del mes de cada número, con selector de "Mes de consumo". El administrador ve solo sus números; el SuperAdmin ve todos y además el "Uso de IA".
- Etiquetas posibles: Desconectado de WhatsApp, Inactivo, IA en pausa, En pausa por el plan, Bot apagado, o el nombre de su asistente propio.
- Para sumar un número: "Conectar número de WhatsApp". El número tiene que estar activo en WhatsApp Business. El administrador conecta números para sus propios códigos.
- Si Meta desconecta un número: "Reconectar número". No hay que darlo de baja.
- El botón "Asistente" de cada número permite apagar o prender el bot solo en ese número ("Apagar en este número" o "Encender") y cambiar nombre, personas, horario, "Feriados y pausas", datos y coberturas. Solo lo cambia un SuperAdmin o un administrador del código de ese número.
- Solo el SuperAdmin ve "Registrar número", "Editar" y dar de baja.

## Facturación
- Cada número tiene un plan de mensajes por mes, que cuenta lo que mandan el asistente, la oficina y los avisos. Se factura a mes vencido y los planes los define el soporte de la plataforma.
- Cada tarjeta muestra el plan del mes, los mensajes usados y los que quedan, y el precio. El selector "Mes" muestra meses anteriores.
- Al llegar al límite del plan: "Pasar a <plan>" o "Dejarlo en pausa hasta el <día>".
- El SuperAdmin tiene la pestaña "Consumo", donde elige el plan de cada número en "Plan asignado" (solo para el mes actual), y la pestaña "Planes", con el catálogo para leer. El administrador no puede cambiar el plan.
- Qué funciones incluye cada plan (avisos, campañas, este asistente) lo define el soporte de la plataforma. Si una función está bloqueada, el panel dice desde qué plan está.

## Mejoras
- Pestaña "Mejoras": los cambios que se hicieron en el bot y en el panel, con filtro por área. La marca "Nueva" indica lo publicado desde tu última visita.
- Pestaña "Propuestas": para pedir un cambio, completar "¿Qué te gustaría que cambie?" y "Contanos el detalle" y tocar "Enviar propuesta". Todo el equipo ve las propuestas, su estado (Nueva, En análisis, Planificada, Hecha, Descartada) y la respuesta. Este asistente también puede ayudar a escribirla y enviarla.

## Status
- Muestra cómo responden Triunfo, InfoAuto y los números de WhatsApp. Cuando uno falla, dice desde cuándo, de quién es el problema, qué afecta y qué hace falta para que vuelva a andar.
- "Historial" muestra las fallas de los últimos 30 días y "Actualizar" vuelve a consultar.

## Configuración
- Todo, salvo la pestaña "Cuenta", vale para toda la organización. Lo pueden cambiar tanto un Administrador como un SuperAdmin, menos "Logo", que solo cambia el SuperAdmin. En "Cuenta" cada uno cambia su nombre (es el que se ve en Tareas), su correo y su contraseña.
- "Asistente": el nombre con el que se presenta el bot, las "Personas de la oficina" (si un cliente nombra a alguien, se le avisa en Asuntos pendientes) y los "Datos de la productora". Aplica a los números que no tienen configuración propia.
- "Logo" acepta PNG, JPG o WebP de hasta 2 MB. "Horarios" carga el horario de lunes a domingo, con hasta dos turnos por día; los feriados y pausas se cargan en cada número.
- "Precios": los planes de Bolso protegido y Hogar, con "Coberturas del producto" y "Nuevo plan".
- "Coberturas": las coberturas de auto que ve el cliente. Se ordenan, se muestran u ocultan y se edita su texto. Aparecen solas cuando Triunfo las cotiza y no se ofrecen hasta cargar qué incluyen.

## Menú de usuario
- Se abre tocando tu correo, abajo a la izquierda.
- "Apariencia" tiene el Modo (Claro, Oscuro, Automático) y los Colores (Azul, Dorado, Turquesa, Violeta, Rosa, Grafito). Se guarda solo en ese navegador.
- "Cerrar sesión".

## Cosas que el panel no hace
- No crea ni edita asegurados, pólizas ni cuotas: vienen de Triunfo, que actualiza la cartera a las 06:00 y a las 20:00.
- No permite cargar siniestros, solicitudes ni coberturas a mano.
- Desde el chat no se puede mandar un mensaje libre pasadas las 24 horas, y tampoco hay opción para enviar plantillas.
- No cambia la contraseña de TriunfoNet ni los precios de los planes de mensajes.
`
