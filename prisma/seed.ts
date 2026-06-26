import * as bcrypt from 'bcrypt'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import 'dotenv/config'

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
const prisma = new PrismaClient({ adapter })

async function main() {
  // ── Producer ────────────────────────────────────────────
  // Bot display name (configurable later from the admin "Configuración" screen).
  const BOT_NAME = 'NICO'
  // Optional per-producer tone (no name here — the name comes from botName).
  const PRODUCER_TONE =
    'Atendé con calidez y cercanía, como alguien del equipo de la productora: voseo argentino, respuestas breves y humanas.'
  // Weekly hours shown by the bot and the public web (Mon–Fri 8–16, weekend
  // closed). Edited later from the admin "Horarios" screen.
  const BUSINESS_HOURS = {
    mon: [{ from: '08:00', to: '16:00' }],
    tue: [{ from: '08:00', to: '16:00' }],
    wed: [{ from: '08:00', to: '16:00' }],
    thu: [{ from: '08:00', to: '16:00' }],
    fri: [{ from: '08:00', to: '16:00' }],
    sat: [],
    sun: [],
  }
  // Organization principal Triunfo code (the "intermediario" in the Excel).
  const MASTER_CODE = '11425'
  const producer = await prisma.producer.upsert({
    where: { slug: 'john' },
    // Keep name/tone in sync on re-seed (this update used to be a no-op).
    update: {
      botName: BOT_NAME,
      systemPrompt: PRODUCER_TONE,
      businessHours: BUSINESS_HOURS,
      masterCode: MASTER_CODE,
    },
    create: {
      name: 'John',
      slug: 'john',
      botName: BOT_NAME,
      systemPrompt: PRODUCER_TONE,
      businessHours: BUSINESS_HOURS,
      masterCode: MASTER_CODE,
      isActive: true,
    },
  })

  // ── ProducerCodes (Triunfo agent codes under the organization) ──────────
  // Source: "solicitudes MARTIN JPMG.xlsx" — the org master code (11425) plus
  // every dependent code. Seeded idempotently by (producerId, code).
  const PRODUCER_CODES: Array<{ code: string; holderName: string; isMaster?: boolean }> = [
    { code: '11425', holderName: 'JOHN PELLEGRINI MANAGEMENT GROUP SRL', isMaster: true },
    { code: '10484', holderName: 'JOHN PELLEGRINI M.G. SRL' },
    { code: '11663', holderName: 'JOHN PELLEGRINI M.G. SRL' },
    { code: '10856', holderName: 'JOHN PELLEGRINI M.G. SRL' },
    { code: '11389', holderName: 'JOHN PELLEGRINI M.G. SRL' },
    { code: '14831', holderName: 'CANARELLI ADRIANA' },
    { code: '7310', holderName: 'CORIA IVAN MAXIMILIANO' },
    { code: '7430', holderName: 'AGUILAR VANESA' },
    { code: '7774', holderName: 'PELLEGRINI VALERIA' },
    { code: '8074', holderName: 'PELLEGRINI JOHN' },
    { code: '8709', holderName: 'VENERONI AGUSTIN' },
    { code: '9377', holderName: 'MORA ROXANA BEATRIZ' },
    { code: '10228', holderName: 'TORELLI ROLLAN MAURO' },
    { code: '13462', holderName: 'PELLEGRINI AGUSTIN' },
    { code: '13872', holderName: 'PELLEGRINI JOHN' },
    { code: '12633', holderName: 'PELLEGRINI MARIA CLAUDIA' },
    { code: '14832', holderName: 'GAETA LUCAS JOEL' },
    { code: '11944', holderName: 'CORBASCIO GUSTAVO ADRIAN' },
    { code: '15426', holderName: 'KAUFMANN CECILIA RAQUEL' },
    { code: '16180', holderName: 'CORTES CARVAJAL EDUARDO' },
    { code: '16301', holderName: 'TROVATO SEBASTIAN' },
    { code: '14571', holderName: 'LEGUIZAMON FERNANDO ARIEL' },
    { code: '6088', holderName: 'MONDINO ANA A' },
    { code: '13909', holderName: 'BOTTO LISIA BARBARA' },
    { code: '14652', holderName: 'CANTINI JUAN PABLO' },
    { code: '14563', holderName: 'PANIAGUA MARCELA B' },
  ]

  const codeIdByCode = new Map<string, number>()
  for (const pc of PRODUCER_CODES) {
    const row = await prisma.producerCode.upsert({
      where: { producerId_code: { producerId: producer.id, code: pc.code } },
      update: { holderName: pc.holderName, isMaster: pc.isMaster ?? false },
      create: {
        code: pc.code,
        holderName: pc.holderName,
        isMaster: pc.isMaster ?? false,
        producerId: producer.id,
      },
      select: { id: true },
    })
    codeIdByCode.set(pc.code, row.id)
  }
  const masterCodeId = codeIdByCode.get(MASTER_CODE)!

  // ── Fixed-price plans (bolso, hogar) ────────────────────
  // ProductPlan has no natural unique key, so seed idempotently by
  // (producerId, productType, name): create only when missing.
  // coverageItems carry the insured sum per coverage row; rows with the same
  // label/category align across a product's plans in the comparison table.
  const SEED_PLANS = [
    {
      productType: 'bolso',
      name: 'Bolso Base',
      monthlyPrice: 4200,
      description: 'Protección esencial para tus efectos personales.',
      coverageItems: [
        { label: 'Robo en vía pública', category: 'ROBO', amount: 300000 },
        { label: 'Hurto en transporte', category: 'HURTO', amount: 150000 },
        { label: 'Reposición de documentación', category: 'DOCUMENTACIÓN', amount: 50000 },
      ],
      sortOrder: 1,
    },
    {
      productType: 'bolso',
      name: 'Bolso Plus',
      monthlyPrice: 6900,
      description: 'Suma asegurada ampliada e incluye electrónica.',
      coverageItems: [
        { label: 'Robo en vía pública', category: 'ROBO', amount: 500000 },
        { label: 'Hurto en transporte', category: 'HURTO', amount: 300000 },
        { label: 'Reposición de documentación', category: 'DOCUMENTACIÓN', amount: 80000 },
        { label: 'Notebook y celular', category: 'ELECTRÓNICA', amount: 400000 },
      ],
      sortOrder: 2,
    },
    {
      productType: 'hogar',
      name: 'Hogar Base',
      monthlyPrice: 10632,
      description: 'Cobertura esencial para tu vivienda.',
      coverageItems: [
        { label: 'Incendio', category: 'EDIFICIO', amount: 9000000 },
        { label: 'Robo y daño a electrodomésticos', category: 'CONTENIDO GENERAL', amount: 900000 },
        { label: 'Responsabilidad Civil privada', category: 'HECHOS PRIVADOS', amount: 900000 },
        { label: 'Cristales', category: 'CRISTALES', amount: 225000 },
      ],
      sortOrder: 1,
    },
    {
      productType: 'hogar',
      name: 'Hogar Plus',
      monthlyPrice: 13117,
      description: 'Más cobertura para edificio y contenido.',
      coverageItems: [
        { label: 'Incendio', category: 'EDIFICIO', amount: 12000000 },
        { label: 'Robo y daño a electrodomésticos', category: 'CONTENIDO GENERAL', amount: 1200000 },
        { label: 'Responsabilidad Civil privada', category: 'HECHOS PRIVADOS', amount: 1200000 },
        { label: 'Cristales', category: 'CRISTALES', amount: 300000 },
      ],
      sortOrder: 2,
    },
    {
      productType: 'hogar',
      name: 'Hogar Premium',
      monthlyPrice: 18086,
      description: 'Máxima tranquilidad para tu hogar.',
      coverageItems: [
        { label: 'Incendio', category: 'EDIFICIO', amount: 18000000 },
        { label: 'Robo y daño a electrodomésticos', category: 'CONTENIDO GENERAL', amount: 1800000 },
        { label: 'Responsabilidad Civil privada', category: 'HECHOS PRIVADOS', amount: 1800000 },
        { label: 'Cristales', category: 'CRISTALES', amount: 450000 },
      ],
      sortOrder: 3,
    },
  ] as const

  for (const plan of SEED_PLANS) {
    const existing = await prisma.productPlan.findFirst({
      where: { producerId: producer.id, productType: plan.productType, name: plan.name, deletedAt: null },
      select: { id: true },
    })
    if (!existing) {
      await prisma.productPlan.create({
        data: {
          producerId: producer.id,
          productType: plan.productType,
          name: plan.name,
          monthlyPrice: plan.monthlyPrice,
          description: plan.description,
          coverageItems: plan.coverageItems.map(c => ({ ...c })),
          sortOrder: plan.sortOrder,
        },
      })
    }
  }

  // ── Platform OWNER (Lumar) ──────────────────────────────────────────────
  // Static super-superadmin that logs into the same admin panel and can both
  // operate as a SuperAdmin AND provision new organizations from "Organizaciones".
  // Homed at the John org for convenience (it is not bound by org-management).
  await prisma.user.upsert({
    where: { email: 'lumarsoftarg@gmail.com' },
    update: { role: 'OWNER', producerId: producer.id },
    create: {
      email: 'lumarsoftarg@gmail.com',
      password: await bcrypt.hash('LucasMarceRosario1!', 10),
      role: 'OWNER',
      producerId: producer.id,
    },
  })

  // ── Users: 1 SuperAdmin (sees all codes) + 1 Admin (1 code) ─────────────
  // SuperAdmin = the organization owner (master code 11425). Sees every code.
  await prisma.user.upsert({
    where: { email: 'admin@johnpellegrini.com.ar' },
    update: { role: 'SUPERADMIN' },
    create: {
      email: 'admin@johnpellegrini.com.ar',
      password: await bcrypt.hash('admin123', 10),
      role: 'SUPERADMIN',
      producerId: producer.id,
    },
  })

  // Admin example = a single agent that should only see their own code's cartera.
  const adminUser = await prisma.user.upsert({
    where: { email: 'test@gmail.com' },
    update: { role: 'ADMIN' },
    create: {
      email: 'test@gmail.com',
      password: await bcrypt.hash('test123', 10),
      role: 'ADMIN',
      producerId: producer.id,
    },
    select: { id: true },
  })

  // Grant the example admin visibility over one code (14831 — CANARELLI ADRIANA).
  const grantedCodeId = codeIdByCode.get('14831')!
  const existingGrant = await prisma.userProducerCode.findUnique({
    where: { userId_producerCodeId: { userId: adminUser.id, producerCodeId: grantedCodeId } },
    select: { id: true },
  })
  if (!existingGrant) {
    await prisma.userProducerCode.create({
      data: { userId: adminUser.id, producerCodeId: grantedCodeId },
    })
  }

  // ── Phone number ────────────────────────────────────────
  // The Meta phone_number_id must match what arrives in the webhook, or the bot
  // can't resolve the producer. Set SEED_PHONE_NUMBER_ID to your dev number.
  const phoneNumberId = process.env.SEED_PHONE_NUMBER_ID ?? 'TEST_META_PHONE_ID'
  const phone = await prisma.phoneNumber.upsert({
    where: { phoneNumberId },
    update: { responsibleProducerCodeId: masterCodeId },
    create: {
      phoneNumberId,
      number: '+54 9 11 0000-0000',
      isActive: true,
      producerId: producer.id,
      // Billing attribution: this number is invoiced to the master code.
      responsibleProducerCodeId: masterCodeId,
    },
    select: { id: true },
  })
  // The number serves the master code (extend with more codes for shared lines).
  const servedExists = await prisma.phoneNumberProducerCode.findUnique({
    where: { phoneNumberId_producerCodeId: { phoneNumberId: phone.id, producerCodeId: masterCodeId } },
    select: { id: true },
  })
  if (!servedExists) {
    await prisma.phoneNumberProducerCode.create({
      data: { phoneNumberId: phone.id, producerCodeId: masterCodeId },
    })
  }

  // ── Test client (Lucas) ─────────────────────────────────
  const clientDni = '44765283'
  const clientPassword = await bcrypt.hash(clientDni, 10)

  const client = await prisma.client.upsert({
    where: { dni_producerId: { dni: clientDni, producerId: producer.id } },
    update: { producerCodeId: masterCodeId },
    create: {
      dni: clientDni,
      firstName: 'Lucas',
      lastName: 'Quaroni',
      email: 'lucas.quaroni@gmail.com',
      password: clientPassword,
      requiresPasswordChange: false, // password already set to DNI for testing
      producerId: producer.id,
      producerCodeId: masterCodeId,
    },
  })

  // ── Test polizas ────────────────────────────────────────
  const today = new Date()
  const oneYearAgo = new Date(today)
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const oneYearFromNow = new Date(today)
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1)
  const sixMonthsAgo = new Date(today)
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  // Poliza 1 — Auto vigente (Ford Focus)
  const polizaAuto = await prisma.poliza.upsert({
    where: { certificado_producerId: { certificado: 'TEST-001', producerId: producer.id } },
    update: {},
    create: {
      certificado: 'TEST-001',
      suplemento: 0,
      company: 'triunfo',
      riskType: 'auto',
      status: 'Vigente',
      vigenciaDesde: oneYearAgo,
      vigenciaHasta: oneYearFromNow,
      premio: '62450.00',
      paymentMethod: 'Débito Automático',
      rawData: {
        Articulo: '458',
        Certificado: 'TEST-001',
        Estado: 'Vigente',
        Asegurado: 'Lucas Quaroni',
        DocNumero: clientDni,
        Patente: 'AB123CD',
        Premio: '62450.00',
        Cobertura: 'A',
        FechaVigDesde: oneYearAgo.toISOString().slice(0, 10),
        FechaVigHasta: oneYearFromNow.toISOString().slice(0, 10),
      },
      clientId: client.id,
      producerId: producer.id,
      producerCodeId: masterCodeId,
    },
  })

  await prisma.vehiculo.upsert({
    where: { polizaId: polizaAuto.id },
    update: {},
    create: {
      polizaId: polizaAuto.id,
      dominio: 'AB123CD',
      marca: 'FORD',
      modelo: 'FOCUS',
      subModelo: 'TITANIUM 2.0',
      anio: 2022,
      tipo: 'AUTOMOVIL',
      uso: 'PARTICULAR',
      cobertura: 'A',
      sumaAsegurada: '8500000.00',
      ceroKm: false,
    },
  })

  // Cuotas for polizaAuto (last 6 months paid, next 6 pending)
  for (let i = 1; i <= 12; i++) {
    const dueDate = new Date(oneYearAgo)
    dueDate.setMonth(dueDate.getMonth() + i - 1)
    const isPast = dueDate < today
    await prisma.cuota.upsert({
      where: { polizaId_numeroCuota: { polizaId: polizaAuto.id, numeroCuota: i } },
      update: {},
      create: {
        polizaId: polizaAuto.id,
        numeroCuota: i,
        amount: '62450.00',
        dueDate,
        status: isPast ? 'paid' : 'pending',
      },
    })
  }

  // Poliza 2 — Auto vigente (Volkswagen Gol) — mismo cliente, distinto auto
  const polizaMoto = await prisma.poliza.upsert({
    where: { certificado_producerId: { certificado: 'TEST-002', producerId: producer.id } },
    update: {},
    create: {
      certificado: 'TEST-002',
      suplemento: 0,
      company: 'triunfo',
      riskType: 'auto',
      status: 'Vigente',
      vigenciaDesde: sixMonthsAgo,
      vigenciaHasta: oneYearFromNow,
      premio: '28900.00',
      paymentMethod: 'Contado',
      rawData: {
        Articulo: '481',
        Certificado: 'TEST-002',
        Estado: 'Vigente',
        Asegurado: 'Lucas Quaroni',
        DocNumero: clientDni,
        Patente: 'XZ789YW',
        Premio: '28900.00',
        Cobertura: 'B',
        FechaVigDesde: sixMonthsAgo.toISOString().slice(0, 10),
        FechaVigHasta: oneYearFromNow.toISOString().slice(0, 10),
      },
      clientId: client.id,
      producerId: producer.id,
      producerCodeId: masterCodeId,
    },
  })

  await prisma.vehiculo.upsert({
    where: { polizaId: polizaMoto.id },
    update: {},
    create: {
      polizaId: polizaMoto.id,
      dominio: 'XZ789YW',
      marca: 'VOLKSWAGEN',
      modelo: 'GOL',
      subModelo: 'TREND 1.6',
      anio: 2019,
      tipo: 'AUTOMOVIL',
      uso: 'PARTICULAR',
      cobertura: 'B',
      sumaAsegurada: '4200000.00',
      ceroKm: false,
    },
  })

  // Poliza 3 — Vencida (mismo auto que TEST-001, patente AB123CD — deduplication test)
  const polizaVencida = await prisma.poliza.upsert({
    where: { certificado_producerId: { certificado: 'TEST-000', producerId: producer.id } },
    update: {},
    create: {
      certificado: 'TEST-000',
      suplemento: 0,
      company: 'triunfo',
      riskType: 'auto',
      status: 'Vencida',
      vigenciaDesde: new Date('2024-01-01'),
      vigenciaHasta: oneYearAgo,
      premio: '48200.00',
      paymentMethod: 'Débito Automático',
      rawData: {
        Articulo: '458',
        Certificado: 'TEST-000',
        Estado: 'Vencida',
        Asegurado: 'Lucas Quaroni',
        DocNumero: clientDni,
        Patente: 'AB123CD',
        Premio: '48200.00',
        Cobertura: 'A',
      },
      clientId: client.id,
      producerId: producer.id,
      producerCodeId: masterCodeId,
    },
  })

  await prisma.vehiculo.upsert({
    where: { polizaId: polizaVencida.id },
    update: {},
    create: {
      polizaId: polizaVencida.id,
      dominio: 'AB123CD', // same plate as TEST-001 — deduplication should hide this one
      marca: 'FORD',
      modelo: 'FOCUS',
      anio: 2022,
      tipo: 'AUTOMOVIL',
      uso: 'PARTICULAR',
      cobertura: 'A',
      sumaAsegurada: '6000000.00',
      ceroKm: false,
    },
  })

  // ── Back-fill: existing rows with no producerCode → master code ─────────
  // Any cartera created before this migration (or imported by an older cartera
  // sync) is attributed to the master code so the SuperAdmin sees it and the
  // data is never "orphaned" from scoping. Refined later per Triunfo code.
  const backfill = { producerCodeId: masterCodeId }
  await prisma.client.updateMany({ where: { producerId: producer.id, producerCodeId: null }, data: backfill })
  await prisma.poliza.updateMany({ where: { producerId: producer.id, producerCodeId: null }, data: backfill })
  await prisma.cotizacion.updateMany({ where: { producerId: producer.id, producerCodeId: null }, data: backfill })
  await prisma.siniestro.updateMany({ where: { producerId: producer.id, producerCodeId: null }, data: backfill })
  await prisma.contactLead.updateMany({ where: { producerId: producer.id, producerCodeId: null }, data: backfill })
  await prisma.novedad.updateMany({ where: { producerId: producer.id, producerCodeId: null }, data: backfill })
  await prisma.conversation.updateMany({ where: { producerId: producer.id, producerCodeId: null }, data: backfill })

  console.log('✅ Seed completed.')
  console.log(`   Producer: ${producer.slug} (id=${producer.id}) masterCode=${MASTER_CODE}`)
  console.log(`   ProducerCodes: ${PRODUCER_CODES.length} (1 master + ${PRODUCER_CODES.length - 1} dependientes)`)
  console.log(`   Owner:      lumarsoftarg@gmail.com / LucasMarceRosario1! (Lumar — gestiona organizaciones)`)
  console.log(`   SuperAdmin: admin@johnpellegrini.com.ar / admin123 (ve todos los códigos)`)
  console.log(`   Admin:      test@gmail.com / test123 (solo código 14831 — CANARELLI)`)
  console.log(`   Client: ${client.email} — login: ${clientDni} / ${clientDni}`)
  console.log(`   Polizas: TEST-000 (vencida), TEST-001 (Ford Focus vigente), TEST-002 (VW Gol vigente)`)
  console.log(`   Dashboard should show 2 cards (TEST-001 hides TEST-000 by deduplication)`)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
