import { of, throwError } from 'rxjs'
import { TriunfoNotConfiguredException, TriunfoService, type TriunfoPolicyRef } from './triunfo.service'
import type { HttpService } from '@nestjs/axios'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { encryptSecret, resolveKey } from '../common/crypto/secret-crypto'
import type { TriunfoErrorsService } from './triunfo-errors.service'

const ENV: Record<string, string> = {
  TRIUNFO_BASE_URL_AUTH: 'https://auth.test',
  TRIUNFO_BASE_URL_SIP: 'https://sip.test',
  TRIUNFO_PRODUCTOR: '10484',
  TRIUNFO_USUARIO: 'USUARIO',
  TRIUNFO_PASSWORD: 'md5',
}

const REF: TriunfoPolicyRef = {
  producerId: 1,
  productor: '6088',
  empresa: 'T',
  sucursal: 'CC',
  articulo: '458',
  certificado: '1234567',
}
const LINK = 'https://www.triunfonet.com.ar/gauswebtriunfo/servlet/htarjetaverdec?abc'

function fakeErrors() {
  return {
    record: jest.fn().mockResolvedValue(undefined),
    recordException: jest.fn().mockResolvedValue(undefined),
    credentialsAccepted: jest.fn().mockResolvedValue(undefined),
    answered: jest.fn(),
  }
}

function createService(http: Partial<Record<'post' | 'get', jest.Mock>>, errors = fakeErrors()) {
  const config = { getOrThrow: (key: string) => ENV[key], get: (key: string) => ENV[key] } as unknown as ConfigService
  const service = new TriunfoService(
    http as unknown as HttpService,
    config,
    {} as PrismaService,
    errors as unknown as TriunfoErrorsService,
  )
  jest.spyOn(service, 'credentialsFor').mockResolvedValue({ productor: '10484', usuario: 'USUARIO', password: 'md5' })
  jest.spyOn(service, 'getToken').mockResolvedValue('jwt')
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

    expect(await createService({ get }).downloadDocumento(LINK, 1)).toEqual(pdf)
    expect(get).toHaveBeenNthCalledWith(
      2,
      'https://www.triunfonet.com.ar/gauswebtriunfo/servlet/otarjetaverde_sp?def',
      expect.objectContaining({
        maxRedirects: 0,
        headers: expect.objectContaining({ Cookie: 'JSESSIONID=abc; GX_SESSION_ID=xyz' }),
      }),
    )
  })

  it('says on every hop that it comes from TriunfoNet, or the link answers 403', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(
        of({ status: 302, headers: { location: '/gauswebtriunfo/servlet/opol5001?x' }, data: new ArrayBuffer(0) }),
      )
      .mockReturnValueOnce(of({ status: 200, headers: {}, data: pdf }))

    await createService({ get }).downloadDocumento(LINK, 1)
    for (const call of get.mock.calls) {
      expect(call[1].headers).toMatchObject({ Referer: 'https://www.triunfonet.com.ar/' })
    }
  })

  it('fails when Triunfo answers something that is not a PDF', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 403, headers: {}, data: Buffer.from('<html>') }))
    await expect(createService({ get }).downloadDocumento(LINK, 1)).rejects.toMatchObject({ status: 502 })
  })

  it('records the status and the page Triunfo answered instead of the PDF', async () => {
    const errors = fakeErrors()
    const get = jest.fn().mockReturnValue(of({ status: 403, headers: {}, data: Buffer.from('<html>Cloudflare') }))
    await expect(createService({ get }, errors).downloadDocumento(LINK, 7)).rejects.toMatchObject({ status: 502 })
    expect(errors.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'documentDownload',
        producerId: 7,
        kind: 'HTTP_ERROR',
        httpStatus: 403,
        sample: '<html>Cloudflare',
      }),
    )
  })

  it('never follows a link outside triunfonet', async () => {
    const get = jest.fn()
    await expect(createService({ get }).downloadDocumento('https://evil.test/x.pdf', 1)).rejects.toMatchObject({
      status: 502,
    })
    expect(get).not.toHaveBeenCalled()
  })
})

describe('TriunfoService error records', () => {
  it('records an HTTP error of RESTDocumentosV2 against the organization of the policy', async () => {
    const errors = fakeErrors()
    const failure = Object.assign(new Error('Request failed with status code 404'), { isAxiosError: true })
    const post = jest.fn().mockReturnValue(throwError(() => failure))

    await expect(createService({ post }, errors).getDocumentos(REF)).rejects.toBe(failure)
    expect(errors.recordException).toHaveBeenCalledWith('RESTDocumentosV2', 1, failure)
  })

  it('records the reason Triunfo gives for having no documents, and still answers an empty list', async () => {
    const errors = fakeErrors()
    const post = jest.fn().mockReturnValue(
      of({
        data: {
          SDTWSDocumentosOut: {
            Resultado: { Estado: 'N', Mensajes: [{ Description: 'Operación inexistente o no asociada al productor' }] },
          },
        },
      }),
    )

    expect(await createService({ post }, errors).getDocumentos(REF)).toEqual([])
    expect(errors.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'RESTDocumentosV2',
        kind: 'REJECTED',
        message: 'Operación inexistente o no asociada al productor',
      }),
    )
  })

  it('records an answer without SDTWSDocumentosOut as unexpected', async () => {
    const errors = fakeErrors()
    const post = jest.fn().mockReturnValue(of({ data: { Error: 'campo nuevo requerido' } }))

    await expect(createService({ post }, errors).getDocumentos(REF)).rejects.toMatchObject({ status: 502 })
    expect(errors.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'UNEXPECTED_RESPONSE', sample: '{"Error":"campo nuevo requerido"}' }),
    )
  })
})

describe('TriunfoService per-organization credentials', () => {
  const KEY_HEX = 'a'.repeat(64)
  const SECOND_ORG = {
    productor: '20001',
    username: 'OTRAORG',
    password: encryptSecret('clave', resolveKey(KEY_HEX, 'K')),
  }
  const TOKEN = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64')}.y`

  function setup(env: Record<string, string | undefined> = ENV) {
    const producers: Record<number, { slug: string; triunfoCredential: unknown }> = {
      1: { slug: 'john', triunfoCredential: null },
      2: { slug: 'otra-org', triunfoCredential: { ...SECOND_ORG, deletedAt: null } },
      3: { slug: 'sin-triunfo', triunfoCredential: null },
      4: { slug: 'borrada', triunfoCredential: { ...SECOND_ORG, deletedAt: new Date() } },
    }
    const prisma = {
      producer: {
        findFirst: jest.fn(({ where }: { where: { id?: number; slug?: string } }) =>
          Promise.resolve(
            where.id !== undefined ? (producers[where.id] ?? null) : where.slug === 'john' ? { id: 1 } : null,
          ),
        ),
      },
      integrationToken: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    }
    const config = {
      getOrThrow: (key: string) => env[key],
      get: (key: string, fallback?: string) => (key === 'WABA_TOKEN_ENCRYPTION_KEY' ? KEY_HEX : (env[key] ?? fallback)),
    } as unknown as ConfigService
    const post = jest.fn().mockImplementation(() => of({ data: { Token: TOKEN(Date.now() / 1000 + 86_400) } }))
    const errors = fakeErrors()
    const service = new TriunfoService(
      { post } as unknown as HttpService,
      config,
      prisma as unknown as PrismaService,
      errors as unknown as TriunfoErrorsService,
    )
    return { service, post, prisma, errors }
  }

  it('gives an organization its own credentials, decrypted', async () => {
    const { service } = setup()
    await expect(service.credentialsFor(2)).resolves.toEqual({
      productor: '20001',
      usuario: 'OTRAORG',
      password: 'clave',
    })
  })

  it('keeps the default organization on the TRIUNFO_* settings while it has none of its own', async () => {
    const { service } = setup()
    const env = { productor: '10484', usuario: 'USUARIO', password: 'md5' }
    await expect(service.credentialsFor(1)).resolves.toEqual(env)
    await expect(service.credentialsFor(null)).resolves.toEqual(env)
  })

  it("never lends the default organization's credentials to another one", async () => {
    const { service } = setup()
    await expect(service.credentialsFor(3)).rejects.toBeInstanceOf(TriunfoNotConfiguredException)
    await expect(service.credentialsFor(4)).rejects.toBeInstanceOf(TriunfoNotConfiguredException)
  })

  it('reads the stored credentials once and again after they change', async () => {
    const { service, prisma } = setup()
    await service.credentialsFor(2)
    await service.credentialsFor(2)
    expect(prisma.producer.findFirst).toHaveBeenCalledTimes(1)

    service.forgetCredentials(2)
    await service.credentialsFor(2)
    expect(prisma.producer.findFirst).toHaveBeenCalledTimes(2)
  })

  it('reports the default organization as not configured without settings or credentials of its own', async () => {
    const { service } = setup({ TRIUNFO_BASE_URL_AUTH: 'https://auth.test', TRIUNFO_BASE_URL_SIP: 'https://sip.test' })
    await expect(service.credentialsFor(null)).rejects.toBeInstanceOf(TriunfoNotConfiguredException)
  })

  it('keeps one token per credential set, under the key JPMG already has', async () => {
    const { service, post, prisma } = setup()

    const jpmg = await service.getAuth(1)
    await service.getAuth(1)
    const other = await service.getAuth(2)

    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenCalledWith(
      'https://auth.test/getTokenRest',
      { SDTProductor: { Codigo: '20001', Usuario: 'OTRAORG', Password: 'clave' } },
      expect.any(Object),
    )
    expect(jpmg.Productor).toBe('10484')
    expect(other.Productor).toBe('20001')
    expect(prisma.integrationToken.upsert.mock.calls.map(([arg]) => arg.where.key)).toEqual([
      'triunfo:10484:USUARIO',
      'triunfo:20001:OTRAORG',
    ])
  })

  it("asks an organization's cartera with its own user and password", async () => {
    const { service, post } = setup()
    post.mockReturnValue(of({ data: { SDTWSNovedadesCarteraOut: { Resultado: { Estado: 'S' }, Novedades: [] } } }))

    await service.getNovedadesCartera('2026-10-01', '2026-10-05', await service.credentialsFor(2), 2, '20002')

    expect(post).toHaveBeenCalledWith(
      'https://sip.test/RESTNovedadesCartera',
      expect.objectContaining({
        SDTWSNovedadesIn: expect.objectContaining({
          Productor: { Codigo: '20002', Usuario: 'OTRAORG', Password: 'clave' },
        }),
      }),
      expect.any(Object),
    )
  })

  it('checks new credentials with Triunfo itself, skipping the stored token', async () => {
    const { service, post, prisma } = setup()
    prisma.integrationToken.findUnique.mockResolvedValue({ token: 'old', expiresAt: new Date(Date.now() + 86_400_000) })

    await service.verifyCredentials({ productor: '20001', usuario: 'OTRAORG', password: 'nueva' })

    expect(post).toHaveBeenCalledTimes(1)
    expect(prisma.integrationToken.findUnique).not.toHaveBeenCalled()
  })

  it('reports what Triunfo says when it refuses the credentials', async () => {
    const { service, post } = setup()
    post.mockReturnValue(
      of({ data: { SDTResultado: { Mensajes: [{ Description: 'Usuario o contraseña incorrectos' }] } } }),
    )
    await expect(
      service.verifyCredentials({ productor: '20001', usuario: 'OTRAORG', password: 'mala' }),
    ).rejects.toThrow('Usuario o contraseña incorrectos')
  })

  describe('when Triunfo refuses the credentials', () => {
    const REFUSAL = {
      data: { SDTResultado: { Mensajes: [{ Description: 'Error Generando Token - Revisar los datos ingresados' }] } },
    }
    const CARTERA_REFUSAL = {
      data: {
        SDTWSNovedadesCarteraOut: {
          Resultado: { Estado: 'N', Mensajes: [{ Type: 1, Description: 'Datos de productor no válidos' }] },
        },
      },
    }

    it('records the refusal against the organization', async () => {
      const { service, post, errors } = setup()
      post.mockReturnValue(of(REFUSAL))

      await expect(service.getAuth(2)).rejects.toThrow('Error Generando Token - Revisar los datos ingresados')
      expect(errors.record).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'getTokenRest',
          producerId: 2,
          kind: 'CREDENTIALS_REJECTED',
          message: 'Error Generando Token - Revisar los datos ingresados',
        }),
      )
    })

    it('does not ask Triunfo again with the same credentials for a while', async () => {
      const { service, post } = setup()
      post.mockReturnValue(of(REFUSAL))

      await expect(service.getAuth(2)).rejects.toThrow('Error Generando Token')
      await expect(service.getAuth(2)).rejects.toThrow('Error Generando Token')
      await expect(
        service.getNovedadesCartera('2026-10-01', '2026-10-05', await service.credentialsFor(2), 2),
      ).rejects.toThrow('Error Generando Token')
      expect(post).toHaveBeenCalledTimes(1)
      // Another organization's credentials are not paused.
      post.mockImplementation(() => of({ data: { Token: TOKEN(Date.now() / 1000 + 86_400) } }))
      await expect(service.getAuth(1)).resolves.toMatchObject({ Productor: '10484' })
    })

    it('lets new credentials that Triunfo accepts through right away', async () => {
      const { service, post } = setup()
      post.mockReturnValueOnce(of(REFUSAL))
      await expect(service.getAuth(2)).rejects.toThrow('Error Generando Token')

      await service.verifyCredentials({ productor: '20001', usuario: 'OTRAORG', password: 'nueva' })
      service.forgetCredentials(2)
      await expect(service.getAuth(2)).resolves.toMatchObject({ Productor: '20001' })
    })

    it('neither records nor pauses a wrong password typed in the panel', async () => {
      const { service, post, errors } = setup()
      post.mockReturnValueOnce(of(REFUSAL))

      await expect(
        service.verifyCredentials({ productor: '20001', usuario: 'OTRAORG', password: 'mala' }),
      ).rejects.toThrow('Error Generando Token')
      await expect(service.getAuth(2)).resolves.toMatchObject({ Productor: '20001' })
      expect(errors.record).not.toHaveBeenCalled()
    })

    it('ends the outage when a token comes back', async () => {
      const { service, errors } = setup()
      await service.getAuth(2)
      expect(errors.credentialsAccepted).toHaveBeenCalledWith(2)
    })

    it('takes the cartera refusing the master code as the credentials failing, and pauses them', async () => {
      const { service, post, errors } = setup()
      post.mockReturnValue(of(CARTERA_REFUSAL))
      const credentials = await service.credentialsFor(2)

      await expect(service.getNovedadesCartera('2026-10-01', '2026-10-05', credentials, 2)).rejects.toThrow(
        'Datos de productor no válidos',
      )
      expect(errors.record).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'RESTNovedadesCartera', kind: 'CREDENTIALS_REJECTED', producerId: 2 }),
      )
      await expect(service.getNovedadesCartera('2026-10-01', '2026-10-05', credentials, 2, '20002')).rejects.toThrow()
      expect(post).toHaveBeenCalledTimes(1)
    })

    it('takes the same answer for a dependent code as that code failing, not the credentials', async () => {
      const { service, post, errors } = setup()
      post.mockReturnValue(of(CARTERA_REFUSAL))
      const credentials = await service.credentialsFor(2)

      await expect(service.getNovedadesCartera('2026-10-01', '2026-10-05', credentials, 2, '11425')).rejects.toThrow()
      await expect(service.getNovedadesCartera('2026-10-01', '2026-10-05', credentials, 2, '14652')).rejects.toThrow()
      expect(post).toHaveBeenCalledTimes(2)
      expect(errors.record).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'REJECTED', sample: 'Código 11425, 2026-10-01 → 2026-10-05' }),
      )
      expect(errors.credentialsAccepted).not.toHaveBeenCalled()
    })

    it('takes a window without movements as empty, not as the code failing', async () => {
      const { service, post, errors } = setup()
      post.mockReturnValue(
        of({
          data: {
            SDTWSNovedadesCarteraOut: {
              Resultado: {
                Estado: 'N',
                Mensajes: [{ Type: 1, Description: 'No hay operaciones para el período seleccionado.' }],
              },
            },
          },
        }),
      )
      const credentials = await service.credentialsFor(2)

      await expect(service.getNovedadesCartera('2026-08-01', '2026-08-14', credentials, 2, '13909')).resolves.toEqual(
        [],
      )
      // Both 7-day windows were asked: an empty one does not stop the rest.
      expect(post).toHaveBeenCalledTimes(2)
      expect(errors.record).not.toHaveBeenCalled()
    })

    it("ends the outage when the master code's cartera answers", async () => {
      const { service, post, errors } = setup()
      post.mockReturnValue(of({ data: { SDTWSNovedadesCarteraOut: { Resultado: { Estado: 'S' }, Novedades: [] } } }))

      await service.getNovedadesCartera('2026-10-01', '2026-10-05', await service.credentialsFor(2), 2)
      expect(errors.credentialsAccepted).toHaveBeenCalledWith(2)
    })
  })
})
