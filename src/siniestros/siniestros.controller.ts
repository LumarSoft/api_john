import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { ClientAuthGuard } from '../auth/client-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { SiniestrosService } from './siniestros.service'
import { CreateSiniestroDto } from './dto/create-siniestro.dto'
import { MAX_FILES, siniestroMulterOptions } from './siniestro-upload.config'

@Controller('clients')
@UseGuards(ClientAuthGuard)
export class SiniestrosController {
  constructor(private readonly siniestrosService: SiniestrosService) {}

  @Post('me/siniestros')
  @UseInterceptors(FilesInterceptor('adjuntos', MAX_FILES, siniestroMulterOptions))
  create(
    @Body() dto: CreateSiniestroDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.siniestrosService.create(req.user.id, req.user.producerId, dto, files ?? [])
  }

  @Get('me/siniestros')
  findAll(@Request() req: AuthenticatedRequest) {
    return this.siniestrosService.findAll(req.user.id, req.user.producerId)
  }

  @Get('me/siniestros/:id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.siniestrosService.findOne(id, req.user.id, req.user.producerId)
  }
}
