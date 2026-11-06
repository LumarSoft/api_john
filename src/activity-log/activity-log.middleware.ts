import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { ActivityLogService } from './activity-log.service'
import { clientIp, WRITE_METHODS } from './request-origin'

/**
 * Waits for each write request to be answered and hands it to the activity
 * log. By then the guards have identified the user and the status is final
 * (403s and failed logins included).
 */
@Injectable()
export class ActivityLogMiddleware implements NestMiddleware {
  constructor(private readonly activity: ActivityLogService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (WRITE_METHODS.has(req.method)) {
      // Read now: once the response is sent the connection may be gone.
      const ip = clientIp(req)
      res.once('finish', () => this.activity.recordRequest(req, res.statusCode, ip))
    }
    next()
  }
}
