import { IsIn } from 'class-validator'

/** The office's answer when a number reaches its plan: continue on the next plan, or stay paused this month. */
export class ResolveLimitDto {
  @IsIn(['continue', 'pause'])
  choice: 'continue' | 'pause'
}
