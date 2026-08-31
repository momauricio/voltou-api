export const USER_ROLES = {
  OWNER: 'owner',
  STAFF: 'staff',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export function isStaffRole(role?: string | null): boolean {
  return role === USER_ROLES.STAFF;
}
