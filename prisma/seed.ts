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
  const producer = await prisma.producer.upsert({
    where: { slug: 'john' },
    // Keep name/tone in sync on re-seed (this update used to be a no-op).
    update: { botName: BOT_NAME, systemPrompt: PRODUCER_TONE, businessHours: BUSINESS_HOURS },
    create: {
      name: 'John',
      slug: 'john',
      botName: BOT_NAME,
      systemPrompt: PRODUCER_TONE,
      businessHours: BUSINESS_HOURS,
      isActive: true,
    },
  })

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

  // ── Admin users ─────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'admin@johnpellegrini.com.ar' },
    update: {},
    create: {
      email: 'admin@johnpellegrini.com.ar',
      password: await bcrypt.hash('admin123', 10),
      role: 'admin',
      producerId: producer.id,
    },
  })

  await prisma.user.upsert({
    where: { email: 'test@gmail.com' },
    update: {},
    create: {
      email: 'test@gmail.com',
      password: await bcrypt.hash('test123', 10),
      role: 'admin',
      producerId: producer.id,
    },
  })

  // ── Phone number ────────────────────────────────────────
  // The Meta phone_number_id must match what arrives in the webhook, or the bot
  // can't resolve the producer. Set SEED_PHONE_NUMBER_ID to your dev number.
  const phoneNumberId = process.env.SEED_PHONE_NUMBER_ID ?? 'TEST_META_PHONE_ID'
  await prisma.phoneNumber.upsert({
    where: { phoneNumberId },
    update: {},
    create: {
      phoneNumberId,
      number: '+54 9 11 0000-0000',
      isActive: true,
      producerId: producer.id,
    },
  })

  // ── Test client (Lucas) ─────────────────────────────────
  const clientDni = '44765283'
  const clientPassword = await bcrypt.hash(clientDni, 10)

  const client = await prisma.client.upsert({
    where: { dni_producerId: { dni: clientDni, producerId: producer.id } },
    update: {},
    create: {
      dni: clientDni,
      firstName: 'Lucas',
      lastName: 'Quaroni',
      email: 'lucas.quaroni@gmail.com',
      password: clientPassword,
      requiresPasswordChange: false, // password already set to DNI for testing
      producerId: producer.id,
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

  console.log('✅ Seed completed.')
  console.log(`   Producer: ${producer.slug} (id=${producer.id})`)
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
