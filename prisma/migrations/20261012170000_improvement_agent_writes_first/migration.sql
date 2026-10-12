-- "Mejoras" post for JPMG about the bot staying quiet when the office writes first. Published right away.
INSERT INTO `Improvement` (`title`, `summary`, `beforeText`, `afterText`, `example`, `area`, `releasedOn`, `publishedAt`, `createdAt`, `updatedAt`, `producerId`)
SELECT
  'El bot ya no le habla encima a la oficina cuando ella escribe primero',
  'Si alguien de la oficina le escribe primero a un cliente desde el celular, el bot queda en pausa en ese chat y no contesta lo que el cliente le responda a esa persona.',
  'Si el cliente nunca le había escrito al bot, el bot no se enteraba de que la oficina había empezado la charla: cuando el cliente respondía, le contestaba encima con la presentación o con "¡Recibí tu foto!".',
  'El chat queda en manos de la oficina desde su primer mensaje, y esos mensajes ahora también aparecen en la Bandeja. Vuelve al bot con las reglas de siempre.',
  'Oficina: Hola, pasame el DNI así lo cotizamos\nCliente: (manda las fotos del DNI)\n(El bot no responde: el chat sigue con la oficina.)',
  'BOT', '2026-10-12', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), `id`
FROM `Producer` WHERE `slug` = 'john' AND `deletedAt` IS NULL;
