import { IsOptional, IsString, MaxLength } from 'class-validator'

/** Multipart fields that go with the file of POST /admin/inbox/:id/media. */
export class SendInboxMediaDto {
  /** Text shown under the photo or document. WhatsApp caps captions at 1024 characters. */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string
}
