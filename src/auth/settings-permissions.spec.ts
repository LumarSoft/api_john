import { Role } from 'generated/prisma/client'
import { ROLES_KEY } from './roles.decorator'
import { AdminConfigController } from '../users/admin-config.controller'
import { AdminBusinessHoursController } from '../business-hours/admin-business-hours.controller'
import { AdminCoverageSettingsController } from '../coverage-settings/admin-coverage-settings.controller'
import { AdminPricingController } from '../product-plans/admin-pricing.controller'
import { AdminPhoneNumbersController } from '../phone-numbers/admin-phone-numbers.controller'

const rolesOf = (handler: unknown): Role[] | undefined => Reflect.getMetadata(ROLES_KEY, handler as object) as Role[]

// What applies to the whole organization is read by everyone and changed only
// by the SuperAdmin; a number's own assistant is open to its admins too.
describe('who changes the organization settings', () => {
  it.each([
    ['assistant name and office people', AdminConfigController.prototype.update],
    ['organization profile', AdminConfigController.prototype.updateProfile],
    ['weekly hours', AdminBusinessHoursController.prototype.updateSchedule],
    ['add a closure', AdminBusinessHoursController.prototype.addClosure],
    ['remove a closure', AdminBusinessHoursController.prototype.removeClosure],
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

  it("lets admins read and change a number's own assistant", () => {
    expect(rolesOf(AdminPhoneNumbersController.prototype.getAssistant)).toEqual([Role.SUPERADMIN, Role.ADMIN])
    expect(rolesOf(AdminPhoneNumbersController.prototype.updateAssistant)).toEqual([Role.SUPERADMIN, Role.ADMIN])
  })
})
