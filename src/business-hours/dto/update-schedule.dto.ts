import { IsObject } from 'class-validator'

export class UpdateScheduleDto {
  /** Weekly schedule { mon: [{from,to}], ..., sun: [] }. Validated in the service
   * (HH:mm format, from < to, no overlaps) so the rules stay in one place. */
  @IsObject()
  weekly!: Record<string, unknown>
}
