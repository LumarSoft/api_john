import { Type } from 'class-transformer'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator'

export class MessageMediaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  url: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  originalName: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  mimeType: string

  @IsInt()
  @Min(0)
  size: number

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tipo?: string
}

export class SaveMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant'

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content: string

  @IsOptional()
  @ValidateNested()
  @Type(() => MessageMediaDto)
  media?: MessageMediaDto
}
