import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { PrismaService } from '../prisma/prisma.service'

interface JwtPayload {
  sub: number
  email: string
  type: 'user' | 'client'
  producerId: number
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET!,
    })
  }

  async validate(payload: JwtPayload) {
    if (payload.type === 'client') {
      const client = await this.prisma.client.findFirst({
        where: { id: payload.sub, deletedAt: null },
      })
      if (!client) throw new UnauthorizedException()
      const { password: _password, ...result } = client
      return { ...result, type: 'client' as const }
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
    })
    if (!user) throw new UnauthorizedException()
    const { password: _password, ...result } = user
    return { ...result, type: 'user' as const }
  }
}
