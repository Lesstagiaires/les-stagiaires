import { MinorGatedAction } from '../../generated/prisma/enums';
import { AgeThresholdsController } from './country-policy.controller';
import type { CountryPolicyService } from './country-policy.service';

// ============================================================================
// LA ROUTE PUBLIQUE DES SEUILS D'ÂGE
//
// Elle existe pour une raison précise : l'écran d'inscription portait un
// « âge < 18 » codé en dur, ce que le cahier des charges interdit. Il lit
// désormais les seuils du pays.
//
// PUBLIQUE VEUT DIRE QU'IL FAUT REGARDER CE QU'ELLE LAISSE SORTIR. La politique
// d'un pays contient aussi `gatedActions` — la liste des actions bloquées pour
// un mineur, c'est-à-dire la carte du dispositif de protection. Elle n'a rien à
// faire dans une réponse non authentifiée, et l'écran d'inscription n'en a
// aucun usage.
// ============================================================================
describe('Route publique des seuils d’âge', () => {
  const POLITIQUE_CM = {
    countryCode: 'CM',
    minInternshipAge: 14,
    minParentRequiredAge: 14,
    civilMajorityAge: 18,
    parentalInfoMaxAge: 21,
    gatedActions: [
      MinorGatedAction.REGISTRATION,
      MinorGatedAction.APPLICATION_SUBMIT,
      MinorGatedAction.DIGITAL_SAFE_SHARE,
    ],
    isFallback: false,
  };

  let policies: { resolve: jest.Mock };
  let controller: AgeThresholdsController;

  beforeEach(() => {
    policies = { resolve: jest.fn().mockResolvedValue(POLITIQUE_CM) };
    controller = new AgeThresholdsController(
      policies as unknown as CountryPolicyService,
    );
  });

  it('rend les quatre seuils du pays', async () => {
    const seuils = await controller.forCountry('cm');

    expect(seuils).toEqual({
      countryCode: 'CM',
      minInternshipAge: 14,
      minParentRequiredAge: 14,
      civilMajorityAge: 18,
      parentalInfoMaxAge: 21,
      isFallback: false,
    });
  });

  // LE TEST QUI COMPTE. La liste des actions bloquées décrit la mécanique de
  // protection des mineurs ; la publier reviendrait à donner la carte des
  // portes à celui qui cherche à les contourner.
  //
  // La réponse est construite par liste blanche — on décide ce qui sort plutôt
  // que de retirer ce qui ne doit pas sortir — donc un champ ajouté demain à
  // CountryPolicy ne fuitera pas par défaut. Ce test le vérifie.
  it('n’expose jamais la liste des actions bloquées', async () => {
    const seuils = await controller.forCountry('CM');

    expect(seuils).not.toHaveProperty('gatedActions');
    expect(JSON.stringify(seuils)).not.toContain('DIGITAL_SAFE_SHARE');
  });

  it('normalise le code pays en majuscules', async () => {
    await controller.forCountry('cm');
    expect(policies.resolve).toHaveBeenCalledWith('CM');
  });

  // Un pays non configuré reçoit le repli protecteur — et l'application doit
  // pouvoir le dire, plutôt que de laisser croire à une politique arbitrée.
  it('signale qu’un repli s’applique', async () => {
    policies.resolve.mockResolvedValue({
      ...POLITIQUE_CM,
      countryCode: 'ZZ',
      isFallback: true,
    });

    const seuils = await controller.forCountry('ZZ');
    expect(seuils.isFallback).toBe(true);
  });
});
