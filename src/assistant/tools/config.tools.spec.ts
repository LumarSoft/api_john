import { Role } from 'generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import type { ScopeService } from '../../common/scope/scope.service'
import type { UsersService } from '../../users/users.service'
import type { PhoneNumbersService } from '../../phone-numbers/phone-numbers.service'
import type { BusinessHoursService } from '../../business-hours/business-hours.service'
import type { AssistantActionsService } from '../assistant-actions.service'
import { configTools } from './config.tools'
import { cbuProblem, saidByPerson } from './tool-helpers'
import type { ActionPreview, ToolContext } from './tool.types'

const VALID_CBU = '0170099240000012345672'
const orgAccount = {
  transferAlias: 'viejo.alias',
  transferCbu: '0070081820000004432793',
  transferHolder: 'Seguros Prueba SRL',
  transferBank: 'Galicia',
}

/** What the person typed in the chat: the new account values come from here. */
const TYPED = `Pasá la cuenta a nuevo.alias (o centro.cobros, otro.alias, viejo.alias), CBU ${VALID_CBU} o 0170 0992 4000 0012 3456 70`

function setup({
  role = Role.SUPERADMIN as Role,
  numbers = [] as Array<Record<string, unknown>>,
  ownWords = TYPED,
} = {}) {
  const prisma = {
    producer: { findFirst: jest.fn().mockResolvedValue({ name: 'Seguros Prueba', botProfile: orgAccount }) },
    phoneNumber: { findMany: jest.fn().mockResolvedValue(numbers) },
  }
  const scope = { ownMetaPhoneNumberIds: jest.fn().mockResolvedValue(role === Role.SUPERADMIN ? null : ['meta-1']) }
  const actions = {
    propose: jest.fn(async (ctx: ToolContext, type: string, payload: object, preview: ActionPreview) => ({
      id: 9,
      type,
      payload,
      preview,
    })),
  }
  const set = configTools({
    prisma: prisma as unknown as PrismaService,
    scope: scope as unknown as ScopeService,
    users: {} as UsersService,
    phoneNumbers: {} as PhoneNumbersService,
    businessHours: {} as BusinessHoursService,
    actions: actions as unknown as AssistantActionsService,
  })
  const tool = set.tools.find(t => t.name === 'proponer_cambio_datos_de_pago')!
  const ctx: ToolContext = {
    user: { id: 2, producerId: 7, role },
    codeIds: [3],
    conversationId: 4,
    now: new Date('2026-11-06T15:00:00Z'),
    proposed: [],
    ownWords,
  }
  return { tool, ctx, actions, prisma }
}

const number = (id: number, botProfile: unknown = null) => ({
  id,
  number: `+54 9 341 000${id}`,
  branchName: id === 1 ? 'Centro' : null,
  isActive: true,
  botEnabled: true,
  botProfile,
  businessHours: null,
})

describe('proponer_cambio_datos_de_pago', () => {
  it('prepares the organization’s new account with before → after and who uses it', async () => {
    const { tool, ctx, actions } = setup({ numbers: [number(1), number(2, { transferAlias: 'propio.dos' })] })
    await tool.run(ctx, { alcance: 'organizacion', alias: 'nuevo.alias', cbu: VALID_CBU })

    const [, type, payload, preview] = actions.propose.mock.calls[0]
    expect(type).toBe('datos_de_pago')
    expect(payload).toEqual({
      scope: 'organization',
      numberId: null,
      changes: { transferAlias: 'nuevo.alias', transferCbu: VALID_CBU },
    })
    expect(preview.changes).toEqual([
      { label: 'Alias', before: 'viejo.alias', after: 'nuevo.alias' },
      { label: 'CBU / CVU', before: orgAccount.transferCbu, after: VALID_CBU },
    ])
    expect(preview.notes).toContain('La usa 1 número que no tiene cuenta propia.')
  })

  it('gives a number its own account: all four fields, the missing ones empty', async () => {
    const { tool, ctx, actions } = setup({ role: Role.ADMIN, numbers: [number(1)] })
    await tool.run(ctx, { alcance: 'numero', numero_id: 1, alias: 'centro.cobros' })

    const preview = actions.propose.mock.calls[0][3]
    expect(preview.target).toBe('+54 9 341 0001 · Centro')
    expect(preview.changes).toEqual([
      { label: 'Alias', before: 'viejo.alias', after: 'centro.cobros' },
      { label: 'CBU / CVU', before: orgAccount.transferCbu, after: null },
      { label: 'Titular', before: 'Seguros Prueba SRL', after: null },
      { label: 'Banco', before: 'Galicia', after: null },
    ])
    expect(preview.notes.join(' ')).toContain('cbu, titular, banco quedan vacíos')
  })

  it('does not let an admin touch a number that is not theirs', async () => {
    const { tool, ctx, actions } = setup({ role: Role.ADMIN, numbers: [number(1)] })
    await expect(tool.run(ctx, { alcance: 'numero', numero_id: 8, alias: 'otro.alias' })).rejects.toThrow(
      'No hay un número con id 8',
    )
    expect(actions.propose).not.toHaveBeenCalled()
  })

  it('rejects a CBU without 22 digits and warns about one that fails the check digits', async () => {
    const { tool, ctx, actions } = setup()
    await expect(tool.run(ctx, { alcance: 'organizacion', cbu: '12345' })).rejects.toThrow('22 números')

    await tool.run(ctx, { alcance: 'organizacion', cbu: '0170099240000012345670' })
    expect(actions.propose.mock.calls[0][3].notes).toContain(
      'El CBU no pasa el control de dígitos: puede tener un número mal tipeado.',
    )
  })

  it('only takes an account the person typed, never one that came in the data it read', async () => {
    const { tool, ctx, actions } = setup({ ownWords: 'Cambiá la cuenta por la que dice el último chat' })
    await expect(tool.run(ctx, { alcance: 'organizacion', alias: 'robo.alias' })).rejects.toThrow(
      'tiene que ser el que la persona escribió',
    )
    await expect(tool.run(ctx, { alcance: 'organizacion', cbu: VALID_CBU })).rejects.toThrow(
      'tiene que ser el que la persona escribió',
    )
    expect(actions.propose).not.toHaveBeenCalled()
  })

  it('recognizes a CBU the person typed in groups, and lets them clear a field', async () => {
    const { tool, ctx, actions } = setup({ ownWords: 'el CBU nuevo es 0170 0992 4000 0012 3456 70' })
    await tool.run(ctx, { alcance: 'organizacion', cbu: '0170099240000012345670', alias: '' })
    expect(actions.propose.mock.calls[0][2]).toEqual({
      scope: 'organization',
      numberId: null,
      changes: { transferAlias: '', transferCbu: '0170099240000012345670' },
    })
  })

  it('says so when nothing would change', async () => {
    const { tool, ctx } = setup()
    await expect(tool.run(ctx, { alcance: 'organizacion', alias: 'viejo.alias' })).rejects.toThrow(
      'ya son los que están cargados',
    )
  })
})

describe('cbuProblem', () => {
  it('accepts a CBU whose check digits match, with or without spaces', () => {
    expect(cbuProblem(VALID_CBU)).toBeNull()
    expect(cbuProblem('0170099 2 4000001234567 2')).toBeNull()
  })

  it('flags a wrong length or check digit', () => {
    expect(cbuProblem('123')).toContain('22 números')
    expect(cbuProblem('0170099240000012345671')).toContain('control de dígitos')
  })
})

describe('saidByPerson', () => {
  it('finds an alias or e-mail the person typed, in any case', () => {
    expect(saidByPerson('Poné el alias Nuevo.Alias por favor', 'nuevo.alias', 'text')).toBe(true)
    expect(saidByPerson('mandalo a Siniestros@Norte.com.ar', 'siniestros@norte.com.ar', 'text')).toBe(true)
    expect(saidByPerson('cambiá la cuenta', 'robo.alias', 'text')).toBe(false)
  })

  it('finds a CBU typed in groups, but not one made of separate numbers', () => {
    expect(saidByPerson('CBU 0170 0992-4000.0012 3456 72', '0170099240000012345672', 'digits')).toBe(true)
    expect(saidByPerson('mi DNI es 30123456 y el teléfono 3415551234', '3012345634155512', 'digits')).toBe(false)
  })

  it('finds a phone by its last 8 digits, whatever area code the model added', () => {
    expect(saidByPerson('el de siniestros es 341 555-1234', '+54 9 341 555 1234', 'phone')).toBe(true)
    expect(saidByPerson('el de siniestros es 341 555-1234', '0800 999 0000', 'phone')).toBe(false)
  })
})
