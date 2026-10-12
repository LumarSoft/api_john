import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { ProposalStatus } from 'generated/prisma/client'

export class CreateProposalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  title: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string
}

export class UpdateProposalDto {
  @IsOptional()
  @IsEnum(ProposalStatus)
  status?: ProposalStatus

  /** Lumar's answer, visible to the whole organization. Empty = no answer. */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  response?: string
}
