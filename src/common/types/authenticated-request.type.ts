/**
 * Shape of `req.user` after JwtStrategy.validate() for authenticated requests.
 * Use with @Request() in controllers protected by JwtAuthGuard, ClientAuthGuard, or UserAuthGuard.
 */
export interface AuthenticatedRequest {
  user: {
    id: number
    email: string
    producerId: number
    type: 'user' | 'client'
  }
}
