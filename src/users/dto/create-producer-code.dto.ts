import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

/** A new branch's Triunfo code and who holds it, created by the SuperAdmin from the onboarding. */
export class CreateProducerCodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @Matches(/^[0-9A-Za-z-]+$/, { message: 'El código solo admite letras, números y guiones' })
  code: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  holderName?: string
}
