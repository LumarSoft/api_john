import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class SaveMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant'

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content: string
}
