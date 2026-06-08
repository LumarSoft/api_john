import * as bcrypt from 'bcrypt'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import 'dotenv/config'

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
const prisma = new PrismaClient({ adapter })

async function main() {
  const producer = await prisma.producer.upsert({
    where: { slug: 'john-seguros' },
    update: {},
    create: {
      name: 'John Seguros',
      slug: 'john-seguros',
      systemPrompt:
        'Eres un asistente de seguros. Ayudá a los clientes a obtener cotizaciones y resolver sus consultas.',
      isActive: true,
    },
  })

  const hashedPassword = await bcrypt.hash('admin123', 10)

  await prisma.user.upsert({
    where: { email: 'admin@johnseguros.com' },
    update: {},
    create: {
      email: 'admin@johnseguros.com',
      password: hashedPassword,
      producerId: producer.id,
    },
  })

  console.log('Seed completado.')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
