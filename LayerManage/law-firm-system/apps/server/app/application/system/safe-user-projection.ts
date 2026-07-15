import { Prisma } from '@prisma/client';

export const SAFE_USER_SELECT = {
  id: true,
  username: true,
  status: true,
  employeeId: true,
  lastLoginAt: true,
  mustChangePassword: true,
  passwordChangedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;
