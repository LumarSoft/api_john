import { Controller, Post, Patch, Body, UseGuards, Request } from '@nestjs/common'
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterClientDto } from './dto/register-client.dto'
import { LoginClientDto } from './dto/login-client.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { ClientAuthGuard } from './client-auth.guard'

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  @Post('client/register')
  registerClient(@Body() dto: RegisterClientDto) {
    return this.authService.registerClient(dto)
  }

  @Post('client/login')
  loginClient(@Body() dto: LoginClientDto) {
    return this.authService.loginClient(dto)
  }

  @Patch('client/change-password')
  @UseGuards(ClientAuthGuard)
  changePassword(@Request() req: { user: { id: number } }, @Body() dto: ChangePasswordDto) {
    return this.authService.changeClientPassword(req.user.id, dto.newPassword)
  }
}
