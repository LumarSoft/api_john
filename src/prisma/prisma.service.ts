import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from 'generated/prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

/**
 * Builds the mariadb pool configuration from DATABASE_URL.
 *
 * Passing the bare URL to PrismaMariaDb leaves every pool default in place,
 * which does not hold up when the database lives on a different host: idle
 * connections get dropped by the server's `wait_timeout` (or by a firewall in
 * between) while the pool keeps handing them out, and the next query dies with
 * "socket has unexpectedly been closed" / EPIPE.
 *
 * The cartera sync makes this very likely — it sits ~15 s per Triunfo window
 * without touching the database, dozens of times per producer code.
 *
 * Tunables (env):
 *   DB_POOL_IDLE_TIMEOUT      seconds a connection may sit idle in the pool.
 *                             MUST be lower than the server's `wait_timeout`.
 *   DB_POOL_CONNECTION_LIMIT  max connections held by this process.
 */
function buildPoolConfig(url: string) {
  const parsed = new URL(url)

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),

    connectionLimit: Number(process.env.DB_POOL_CONNECTION_LIMIT ?? 10),

    // Drop idle connections before the server does.
    idleTimeout: Number(process.env.DB_POOL_IDLE_TIMEOUT ?? 60),

    // Ping a connection that has been idle longer than this (ms) before handing
    // it out. This is what stops a dead socket from ever reaching a query.
    minDelayValidation: 500,

    // Fail fast instead of hanging forever when the DB host is unreachable.
    connectTimeout: 10_000,
    acquireTimeout: 30_000,
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static readonly log = new Logger(PrismaService.name)

  constructor() {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    super({ adapter: new PrismaMariaDb(buildPoolConfig(url)) })
  }

  async onModuleInit() {
    try {
      await this.$connect()
      await this.$queryRaw`SELECT 1`
      PrismaService.log.log('Prisma connected to MySQL')
    } catch (error) {
      PrismaService.log.error(`Prisma connection error: ${error instanceof Error ? error.message : error}`)
      throw error
    }
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
