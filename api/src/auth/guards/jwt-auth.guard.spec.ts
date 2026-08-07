import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: JwtAuthGuard;
  let parentCanActivate: jest.SpyInstance;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new JwtAuthGuard(reflector as unknown as Reflector);
    // AuthGuard('jwt')'s real canActivate would try to run the passport strategy —
    // irrelevant to what this test verifies (the @Public() bypass), so it's stubbed.
    parentCanActivate = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockReturnValue(true);
  });

  afterEach(() => {
    parentCanActivate.mockRestore();
  });

  it('bypasses JWT verification entirely for a route marked @Public()', () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    const result = guard.canActivate(makeContext());

    expect(result).toBe(true);
    expect(parentCanActivate).not.toHaveBeenCalled();
  });

  it('delegates to the passport JWT strategy for a route without @Public()', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    void guard.canActivate(makeContext());

    expect(parentCanActivate).toHaveBeenCalled();
  });
});
