import { ForbiddenException } from '@nestjs/common'
import type { BillingService } from './billing.service'
import { AdminBillingController } from './admin-billing.controller'

describe("Facturación's old catalog routes (front_John's panel)", () => {
  const controller = new AdminBillingController({} as unknown as BillingService)

  it("refuses to create, change or remove plans: the catalog is the owner's now", () => {
    expect(() => controller.legacyCreatePlan()).toThrow(ForbiddenException)
    expect(() => controller.legacyUpdatePlan()).toThrow(ForbiddenException)
    expect(() => controller.legacyRemovePlan()).toThrow(ForbiddenException)
  })
})
