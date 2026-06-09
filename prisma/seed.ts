import * as bcrypt from 'bcrypt'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import 'dotenv/config'

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
const prisma = new PrismaClient({ adapter })

async function main() {
  const producer = await prisma.producer.upsert({
    where: { slug: 'john' },
    update: {},
    create: {
      name: 'John',
      slug: 'john',
      systemPrompt:
        'Eres un asistente de seguros de John Pellegrini Management Group. Ayudá a los clientes a obtener cotizaciones y resolver sus consultas.',
      isActive: true,
    },
  })

  const hashedPassword = await bcrypt.hash('admin123', 10)

  await prisma.user.upsert({
    where: { email: 'admin@johnpellegrini.com.ar' },
    update: {},
    create: {
      email: 'admin@johnpellegrini.com.ar',
      password: hashedPassword,
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

  await prisma.phoneNumber.upsert({
    where: { phoneNumberId: 'TEST_META_PHONE_ID' },
    update: {},
    create: {
      phoneNumberId: 'TEST_META_PHONE_ID',
      number: '+54 9 11 0000-0000',
      isActive: true,
      producerId: producer.id,
    },
  })

  console.log('Seed completed.')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
