import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { PrismaService } from '../../prisma/prisma.service';
import { RolesGuard } from './roles.guard';

function makeContext(user?: { sub: string }): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: {
    userRole: { findFirst: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    prisma = {
      userRole: { findFirst: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    guard = new RolesGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
    );
  });

  it('allows the request through when the route has no @Roles() decorator', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(makeContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
    expect(prisma.userRole.findFirst).not.toHaveBeenCalled();
  });

  it('rejects when no user is attached to the request (route not actually authenticated)', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);

    await expect(guard.canActivate(makeContext(undefined))).resolves.toBe(
      false,
    );
  });

  it('rejects a user who does not hold any of the required roles', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    prisma.userRole.findFirst.mockResolvedValue(null);

    await expect(guard.canActivate(makeContext({ sub: 'u1' }))).resolves.toBe(
      false,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('re-checks the active role in the database rather than trusting the JWT alone', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    prisma.userRole.findFirst.mockResolvedValue({ id: 'ur1' });
    prisma.user.findUnique.mockResolvedValue({ twoFactorEnabled: true });

    await guard.canActivate(makeContext({ sub: 'u1' }));

    expect(prisma.userRole.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        isActive: true,
        role: { name: { in: ['ADMIN'] } },
      },
    });
  });

  it('rejects an ADMIN-role holder whose account has not enabled 2FA (CLAUDE.md §2)', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    prisma.userRole.findFirst.mockResolvedValue({ id: 'ur1' });
    prisma.user.findUnique.mockResolvedValue({ twoFactorEnabled: false });

    await expect(guard.canActivate(makeContext({ sub: 'u1' }))).resolves.toBe(
      false,
    );
  });

  it('allows an ADMIN-role holder once 2FA is enabled', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    prisma.userRole.findFirst.mockResolvedValue({ id: 'ur1' });
    prisma.user.findUnique.mockResolvedValue({ twoFactorEnabled: true });

    await expect(guard.canActivate(makeContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
  });

  it('does not require 2FA for a role check that does not include ADMIN', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ETABLISSEMENT']);
    prisma.userRole.findFirst.mockResolvedValue({ id: 'ur1' });

    await expect(guard.canActivate(makeContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
