import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../prisma/prisma.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterClientDto } from './dto/register-client.dto'
import { LoginClientDto } from './dto/login-client.dto'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (exists) throw new ConflictException('Email already in use')

    const hashed = await bcrypt.hash(dto.password, 10)
    const user = await this.prisma.user.create({
      data: { email: dto.email, password: hashed, producerId: dto.producerId },
      select: { id: true, email: true, role: true, producerId: true, createdAt: true },
    })

    return user
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!user) throw new UnauthorizedException('Invalid credentials')

    const valid = await bcrypt.compare(dto.password, user.password)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    const payload = { sub: user.id, email: user.email, type: 'user', producerId: user.producerId }
    return { access_token: this.jwtService.sign(payload) }
  }

  async registerClient(dto: RegisterClientDto) {
    const exists = await this.prisma.client.findFirst({
      where: { email: dto.email, producerId: dto.producerId, deletedAt: null },
    })
    if (exists) throw new ConflictException('Email already in use')

    // Initial password = DNI (client must change on first login)
    const passwordToHash = dto.password ?? dto.dni
    const hashed = await bcrypt.hash(passwordToHash, 10)
    const client = await this.prisma.client.create({
      data: {
        email: dto.email,
        password: hashed,
        requiresPasswordChange: true,
        producerId: dto.producerId,
        dni: dto.dni,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        city: dto.city,
      },
      select: {
        id: true,
        email: true,
        dni: true,
        firstName: true,
        lastName: true,
        phone: true,
        city: true,
        requiresPasswordChange: true,
        producerId: true,
        createdAt: true,
      },
    })

    return client
  }

  async loginClient(dto: LoginClientDto) {
    const client = await this.prisma.client.findFirst({
      where: { email: dto.email, producerId: dto.producerId, deletedAt: null },
    })
    if (!client) throw new UnauthorizedException('Invalid credentials')

    const valid = await bcrypt.compare(dto.password, client.password)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    const payload = {
      sub: client.id,
      email: client.email,
      type: 'client',
      producerId: client.producerId,
    }
    return {
      access_token: this.jwtService.sign(payload),
      requiresPasswordChange: client.requiresPasswordChange,
    }
  }

  async changeClientPassword(clientId: number, newPassword: string) {
    const hashed = await bcrypt.hash(newPassword, 10)
    await this.prisma.client.update({
      where: { id: clientId },
      data: { password: hashed, requiresPasswordChange: false },
    })
  }
}
