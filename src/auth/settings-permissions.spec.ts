import { Role } from 'generated/prisma/client'
import { ROLES_KEY } from './roles.decorator'
import { AdminConfigController } from '../users/admin-config.controller'
import { AdminBusinessHoursController } from '../business-hours/admin-business-hours.controller'
import { AdminCoverageSettingsController } from '../coverage-settings/admin-coverage-settings.controller'
import { AdminPricingController } from '../product-plans/admin-pricing.controller'
import { AdminPhoneNumbersController } from '../phone-numbers/admin-phone-numbers.controller'

const rolesOf = (handler: unknown): Role[] | undefined => Reflect.getMetadata(ROLES_KEY, handler as object) as Role[]

// What applies to the whole organization is read by everyone and changed only
// by the SuperAdmin (the OWNER passes every gate). From 28/10 to 10/11 any admin
// could change it, and twice a branch's admin saved their branch's name, people
// and bank account as the whole organization's. A branch's admin changes their
// own number's assistant, bot switch and holidays instead; since 29/10 there is
// no organization-wide bot switch nor shared holidays.
describe('who changes the organization settings', () => {
  it.each([
    ['assistant name and office people', AdminConfigController.prototype.update],
    ['organization profile', AdminConfigController.prototype.updateProfile],
    ['weekly hours', AdminBusinessHoursController.prototype.updateSchedule],
    ['coverage', AdminCoverageSettingsController.prototype.update],
    ['coverage order', AdminCoverageSettingsController.prototype.reorder],
    ['create a price', AdminPricingController.prototype.create],
    ['change a price', AdminPricingController.prototype.update],
    ['remove a price', AdminPricingController.prototype.remove],
  ])('only the SuperAdmin changes the %s', (_, handler) => {
    expect(rolesOf(handler)).toEqual([Role.SUPERADMIN])
  })

  it.each([
    ['assistant config', AdminConfigController.prototype.get],
    ['hours', AdminBusinessHoursController.prototype.get],
    ['coverages', AdminCoverageSettingsController.prototype.findAll],
    ['prices', AdminPricingController.prototype.findAll],
  ])('everyone reads the %s', (_, handler) => {
    expect(rolesOf(handler)).toBeUndefined()
  })

  it("lets admins read and change a number's own assistant, bot switch and holidays", () => {
    expect(rolesOf(AdminPhoneNumbersController.prototype.getAssistant)).toEqual([Role.SUPERADMIN, Role.ADMIN])
    expect(rolesOf(AdminPhoneNumbersController.prototype.updateAssistant)).toEqual([Role.SUPERADMIN, Role.ADMIN])
    expect(rolesOf(AdminPhoneNumbersController.prototype.setBotStatus)).toEqual([Role.SUPERADMIN, Role.ADMIN])
    expect(rolesOf(AdminPhoneNumbersController.prototype.addClosure)).toEqual([Role.SUPERADMIN, Role.ADMIN])
    expect(rolesOf(AdminPhoneNumbersController.prototype.removeClosure)).toEqual([Role.SUPERADMIN, Role.ADMIN])
  })

  it('has no organization-wide bot switch nor organization holidays', () => {
    expect(AdminConfigController.prototype).not.toHaveProperty('setBotStatus')
    expect(AdminBusinessHoursController.prototype).not.toHaveProperty('addClosure')
  })
})
