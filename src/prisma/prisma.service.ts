import { Injectable, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from 'generated/prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
    super({ adapter })
  }

  async onModuleInit() {
    try {
      await this.$connect()
      await this.$queryRaw`SELECT 1`
      console.log('✅ Prisma connected to MySQL')
    } catch (error) {
      console.error('❌ Prisma connection error:', error)
      throw error
    }
  }
}
