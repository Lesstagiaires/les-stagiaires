import type { AccessTokenPayload } from '../auth/token.service';
import { EntitlementsController } from './entitlements.controller';
import type { EntitlementsService } from './entitlements.service';

describe('EntitlementsController', () => {
  it('returns the authenticated user active entitlements', async () => {
    const entitlements = {
      actifs: jest.fn().mockResolvedValue({
        plan: 'CARRIERE_SECURISEE',
        entitlements: ['CV_AND_COVER_LETTER_ASSISTANCE'],
      }),
    };
    const controller = new EntitlementsController(
      entitlements as unknown as EntitlementsService,
    );
    const user = { sub: 'user-1' } as AccessTokenPayload;

    await expect(controller.getMine(user)).resolves.toEqual({
      plan: 'CARRIERE_SECURISEE',
      entitlements: ['CV_AND_COVER_LETTER_ASSISTANCE'],
    });
    expect(entitlements.actifs).toHaveBeenCalledWith('user-1');
  });
});
