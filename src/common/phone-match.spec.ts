import { isSamePhone } from './phone-match'

describe('isSamePhone', () => {
  it('matches a WhatsApp id against the cartera mobile format with 15', () => {
    expect(isSamePhone('5493413404951', '341153404951')).toBe(true)
    expect(isSamePhone('5491131081308', '111531081308')).toBe(true)
    expect(isSamePhone('5492477123456', '2477 15 123456')).toBe(true)
  })

  it('matches national numbers with a leading 0 or punctuation', () => {
    expect(isSamePhone('5493413404951', '0341-3404951')).toBe(true)
    expect(isSamePhone('5493413404951', '+54 9 341 340-4951')).toBe(true)
  })

  it('does not match a different line or a missing phone', () => {
    expect(isSamePhone('5493413404951', '341156930749')).toBe(false)
    expect(isSamePhone('5493413404951', null)).toBe(false)
    expect(isSamePhone('5493413404951', '')).toBe(false)
    expect(isSamePhone('', '341153404951')).toBe(false)
  })
})
