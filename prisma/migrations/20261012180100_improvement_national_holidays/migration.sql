-- "Mejoras" post for JPMG about national holidays loading themselves. Published right away.
INSERT INTO `Improvement` (`title`, `summary`, `beforeText`, `afterText`, `example`, `area`, `releasedOn`, `publishedAt`, `createdAt`, `updatedAt`, `producerId`)
SELECT
  'El bot sabe cuándo es feriado',
  'Los feriados nacionales se cargan solos como días cerrados: el bot avisa que ese día no atendemos y dice cuándo volvemos.',
  'Si nadie cargaba el feriado a mano, el bot respondía como en un día hábil. Un sábado le dijo a una clienta que la oficina le respondía el lunes, y ese lunes era feriado.',
  'Se cargan solos los feriados de este año y del siguiente, incluidos los que decrete el Gobierno más adelante. Si algún feriado la oficina abre, se borra ese día en Configuración › Horarios y no vuelve a aparecer. Y en un feriado, los chats que tenía tomados alguien de la oficina vuelven al bot como fuera de horario.',
  'Cliente: Hola, necesito el cupón de pago\nNICO: Para acceder a tus datos necesito identificarte… Hoy estamos cerrados por feriado nacional: Día de la Soberanía Nacional (20/11); te respondemos al reabrir (mañana a las 8 hs).',
  'BOT', '2026-10-12', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), `id`
FROM `Producer` WHERE `slug` = 'john' AND `deletedAt` IS NULL;
