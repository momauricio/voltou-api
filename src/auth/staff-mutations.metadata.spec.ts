import 'reflect-metadata';
import { ROLES_KEY } from './roles.decorator';
import { USER_ROLES } from './roles';
import { CampaignsController } from '../campaigns/campaigns.controller';
import { CheckoutController } from '../checkout/checkout.controller';
import { StaffController } from '../staff/staff.controller';

function rolesOf(target: object, method: string): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, (target as Record<string, unknown>)[method] as object);
}

describe('staff-only mutation metadata', () => {
  it('blocks campaign create and outreach approval for owner JWT', () => {
    expect(rolesOf(CampaignsController.prototype, 'create')).toEqual([
      USER_ROLES.STAFF,
    ]);
    expect(rolesOf(CampaignsController.prototype, 'approve')).toEqual([
      USER_ROLES.STAFF,
    ]);
    expect(rolesOf(CampaignsController.prototype, 'reject')).toEqual([
      USER_ROLES.STAFF,
    ]);
    expect(rolesOf(CampaignsController.prototype, 'approveAll')).toEqual([
      USER_ROLES.STAFF,
    ]);
  });

  it('does not require staff to list campaigns', () => {
    expect(rolesOf(CampaignsController.prototype, 'list')).toBeUndefined();
    expect(rolesOf(CampaignsController.prototype, 'listMessages')).toBeUndefined();
  });

  it('blocks checkout creation for owner JWT', () => {
    expect(rolesOf(CheckoutController.prototype, 'create')).toEqual([
      USER_ROLES.STAFF,
    ]);
  });

  it('marks staff list/contact routes as staff-only', () => {
    const classRoles = Reflect.getMetadata(ROLES_KEY, StaffController);
    expect(classRoles).toEqual([USER_ROLES.STAFF]);
  });
});
