import { of } from 'rxjs'
import { TriunfoService, type TriunfoPolicyRef } from './triunfo.service'
import type { HttpService } from '@nestjs/axios'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'

const ENV: Record<string, string> = {
  TRIUNFO_BASE_URL_AUTH: 'https://auth.test',
  TRIUNFO_BASE_URL_SIP: 'https://sip.test',
  TRIUNFO_PRODUCTOR: '10484',
  TRIUNFO_USUARIO: 'USUARIO',
  TRIUNFO_PASSWORD: 'md5',
}

const REF: TriunfoPolicyRef = {
  productor: '6088',
  empresa: 'T',
  sucursal: 'CC',
  articulo: '458',
  certificado: '1234567',
}
const LINK = 'https://www.triunfonet.com.ar/gauswebtriunfo/servlet/htarjetaverdec?abc'

function createService(http: Partial<Record<'post' | 'get', jest.Mock>>) {
  const config = { getOrThrow: (key: string) => ENV[key] } as unknown as ConfigService
  const service = new TriunfoService(http as unknown as HttpService, config, {} as PrismaService)
  jest.spyOn(service, 'getAuth').mockResolvedValue({ Productor: '10484', JWT: 'jwt' })
  return service
}

describe('TriunfoService.getDocumentos', () => {
  it('asks RESTDocumentosV2 with the producer code of the policy', async () => {
    const post = jest
      .fn()
      .mockReturnValue(of({ data: { SDTWSDocumentosOut: { Links: [], Resultado: { Estado: 'S', Mensajes: [] } } } }))
    await createService({ post }).getDocumentos(REF)

    expect(post).toHaveBeenCalledWith(
      'https://sip.test/RESTDocumentosV2',
      {
        SDTWSDocumentosIn: {
          Autenticacion: { JWT: 'jwt', Productor: '6088' },
          Empresa: 'T',
          Sucursal: 'CC',
          Articulo: '458',
          Certificado: '1234567',
        },
      },
      expect.any(Object),
    )
  })

  it('drops the broken links Triunfo returns and accepts a single link object', async () => {
    const broken = { Codigo: '1070', Nombre: 'Solicitud', URL: 'nullcom.sip.agetsolicitudaut?x' }
    const tarjeta = { Codigo: '1050', Nombre: 'Tarjeta Mercosur', URL: LINK }
    const post = jest
      .fn()
      .mockReturnValueOnce(
        of({ data: { SDTWSDocumentosOut: { Links: [tarjeta, broken], Resultado: { Estado: 'S' } } } }),
      )
      .mockReturnValueOnce(of({ data: { SDTWSDocumentosOut: { Links: tarjeta, Resultado: { Estado: 'S' } } } }))
    const service = createService({ post })

    expect(await service.getDocumentos(REF)).toEqual([tarjeta])
    expect(await service.getDocumentos({ ...REF, certificado: '7654321' })).toEqual([tarjeta])
  })

  it('returns no documents when Triunfo does not associate the policy with the producer', async () => {
    const post = jest.fn().mockReturnValue(
      of({
        data: {
          SDTWSDocumentosOut: {
            Links: [],
            Resultado: { Estado: 'N', Mensajes: [{ Id: 'OperacionNoValida', Description: 'Operación inexistente' }] },
          },
        },
      }),
    )
    expect(await createService({ post }).getDocumentos(REF)).toEqual([])
  })

  it('reuses the list for a while unless a fresh one is asked for', async () => {
    const post = jest
      .fn()
      .mockReturnValue(of({ data: { SDTWSDocumentosOut: { Links: [], Resultado: { Estado: 'S' } } } }))
    const service = createService({ post })

    await service.getDocumentos(REF)
    await service.getDocumentos(REF)
    expect(post).toHaveBeenCalledTimes(1)

    await service.getDocumentos(REF, { fresh: true })
    expect(post).toHaveBeenCalledTimes(2)
  })
})

describe('TriunfoService.downloadDocumento', () => {
  const pdf = Buffer.from('%PDF-1.4 fake')

  it('follows the redirect carrying the session cookies it sets', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(
        of({
          status: 302,
          headers: {
            location: '/gauswebtriunfo/servlet/otarjetaverde_sp?def',
            'set-cookie': ['JSESSIONID=abc; Path=/gauswebtriunfo; Secure', 'GX_SESSION_ID=xyz; Path=/'],
          },
          data: new ArrayBuffer(0),
        }),
      )
      .mockReturnValueOnce(of({ status: 200, headers: {}, data: pdf }))

    expect(await createService({ get }).downloadDocumento(LINK)).toEqual(pdf)
    expect(get).toHaveBeenNthCalledWith(
      2,
      'https://www.triunfonet.com.ar/gauswebtriunfo/servlet/otarjetaverde_sp?def',
      expect.objectContaining({
        maxRedirects: 0,
        headers: expect.objectContaining({ Cookie: 'JSESSIONID=abc; GX_SESSION_ID=xyz' }),
      }),
    )
  })

  it('fails when Triunfo answers something that is not a PDF', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 403, headers: {}, data: Buffer.from('<html>') }))
    await expect(createService({ get }).downloadDocumento(LINK)).rejects.toMatchObject({ status: 502 })
  })

  it('never follows a link outside triunfonet', async () => {
    const get = jest.fn()
    await expect(createService({ get }).downloadDocumento('https://evil.test/x.pdf')).rejects.toMatchObject({
      status: 502,
    })
    expect(get).not.toHaveBeenCalled()
  })
})
