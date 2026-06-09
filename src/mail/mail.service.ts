import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Resend } from 'resend'

export interface SiniestroNotification {
  siniestroId: number
  tipo: string
  descripcion: string
  fecha: Date
  cliente: { firstName: string; lastName: string; dni: string; email: string }
  poliza: { certificado: string; company: string }
  adjuntosCount: number
}

/**
 * Outbound email via Resend.
 *
 * Degrades gracefully: if RESEND_API_KEY is not configured the service logs the
 * message instead of sending, so development is never blocked by missing creds.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private readonly resend: Resend | null
  private readonly from: string
  private readonly advisorEmail: string | undefined

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY')
    this.from = this.configService.get<string>('MAIL_FROM') ?? 'onboarding@resend.dev'
    this.advisorEmail = this.configService.get<string>('ADVISOR_EMAIL')
    this.resend = apiKey ? new Resend(apiKey) : null

    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY not set — emails will be logged, not sent')
    }
  }

  /**
   * Notifies the advisor that a new claim was filed. Never throws: a failed
   * notification must not roll back the claim that was already persisted.
   */
  async sendSiniestroNotification(data: SiniestroNotification): Promise<void> {
    if (!this.advisorEmail) {
      this.logger.warn(`ADVISOR_EMAIL not set — skipping notification for siniestro #${data.siniestroId}`)
      return
    }

    const subject = `Nueva denuncia de siniestro #${data.siniestroId} — ${data.cliente.lastName}, ${data.cliente.firstName}`
    const html = this.buildHtml(data)

    if (!this.resend) {
      this.logger.log(`[MAIL:DRY-RUN] to=${this.advisorEmail} subject="${subject}"`)
      return
    }

    try {
      const { error } = await this.resend.emails.send({
        from: this.from,
        to: this.advisorEmail,
        subject,
        html,
      })
      if (error) {
        this.logger.error(`Resend error for siniestro #${data.siniestroId}: ${error.message}`)
        return
      }
      this.logger.log(`Notification sent for siniestro #${data.siniestroId} to ${this.advisorEmail}`)
    } catch (err) {
      this.logger.error(`Failed to send notification for siniestro #${data.siniestroId}`, err as Error)
    }
  }

  private buildHtml(data: SiniestroNotification): string {
    const fecha = data.fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    return `
      <div style="font-family: Arial, sans-serif; color: #1a1a1a; max-width: 560px;">
        <h2 style="margin: 0 0 12px;">Nueva denuncia de siniestro</h2>
        <p style="margin: 0 0 16px; color: #555;">Se registró una nueva denuncia en el portal del cliente.</p>
        <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
          <tr><td style="padding: 6px 0; color: #888;">N° denuncia</td><td style="padding: 6px 0;">#${data.siniestroId}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Tipo</td><td style="padding: 6px 0;">${data.tipo}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Fecha del hecho</td><td style="padding: 6px 0;">${fecha}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Cliente</td><td style="padding: 6px 0;">${data.cliente.lastName}, ${data.cliente.firstName} (DNI ${data.cliente.dni})</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Email cliente</td><td style="padding: 6px 0;">${data.cliente.email}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Póliza</td><td style="padding: 6px 0;">${data.poliza.certificado} (${data.poliza.company})</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Adjuntos</td><td style="padding: 6px 0;">${data.adjuntosCount}</td></tr>
        </table>
        <div style="margin-top: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px;">
          <strong style="font-size: 13px; color: #888;">Descripción</strong>
          <p style="margin: 6px 0 0; font-size: 14px; white-space: pre-wrap;">${this.escape(data.descripcion)}</p>
        </div>
      </div>
    `
  }

  private escape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
