import { AmbassadorStatus } from '../../generated/prisma/enums';
import {
  ALL_CLASSIFIED_STATUSES,
  APPLICATION_STATUSES,
  ATTRIBUTION_ELIGIBLE_STATUSES,
  OPERATIONAL_STATUSES,
  PAYMENT_ELIGIBLE_STATUSES,
  TERMINAL_STATUSES,
  canBePaid,
  canReceiveAttribution,
  isApplicationStage,
  isTerminal,
} from './ambassador-status-groups';

// ============================================================================
// GARDE-FOU D'EXHAUSTIVITÉ
//
// Un statut ajouté à l'énumération sans être classé traverserait tous les
// contrôles sans que personne ne le voie : il ne serait ni « en instruction »,
// ni « terminal », et répondrait `false` à chaque question. Ce test transforme
// cet oubli silencieux en échec de build.
// ============================================================================
describe('Groupes de statuts d’ambassadeur', () => {
  const tous = Object.values(AmbassadorStatus);

  it('classe TOUS les statuts de l’énumération', () => {
    const nonClasses = tous.filter(
      (statut) =>
        !(ALL_CLASSIFIED_STATUSES as readonly AmbassadorStatus[]).includes(
          statut,
        ),
    );
    expect(nonClasses).toEqual([]);
  });

  it('ne classe aucun statut dans deux groupes structurants à la fois', () => {
    // Un statut à la fois « en instruction » et « terminal » rendrait toute
    // question ambiguë, et la réponse dépendrait de l'ordre des tests.
    const doublons = tous.filter((statut) => {
      const appartenances = [
        APPLICATION_STATUSES,
        OPERATIONAL_STATUSES,
        TERMINAL_STATUSES,
      ].filter((groupe) =>
        (groupe as readonly AmbassadorStatus[]).includes(statut),
      );
      return appartenances.length > 1;
    });
    expect(doublons).toEqual([]);
  });

  // --- LA RÈGLE QUI COÛTE DE L'ARGENT ---------------------------------------
  describe('percevoir', () => {
    it('SEUL un ambassadeur ACTIF peut percevoir', () => {
      expect(PAYMENT_ELIGIBLE_STATUSES).toEqual([AmbassadorStatus.ACTIVE]);
    });

    it.each([
      AmbassadorStatus.SUSPENDED,
      AmbassadorStatus.TERMINATED,
      AmbassadorStatus.REJECTED,
      AmbassadorStatus.APPROVED,
      AmbassadorStatus.CONTRACT_PENDING,
      AmbassadorStatus.TRAINING_PENDING,
    ])('%s ne peut PAS percevoir', (statut) => {
      expect(canBePaid(statut)).toBe(false);
    });

    it('un dossier en instruction ne perçoit jamais', () => {
      for (const statut of APPLICATION_STATUSES) {
        expect(canBePaid(statut)).toBe(false);
      }
    });
  });

  describe('attribution', () => {
    it('seul un ambassadeur ACTIF reçoit une attribution', () => {
      expect(ATTRIBUTION_ELIGIBLE_STATUSES).toEqual([AmbassadorStatus.ACTIVE]);
    });

    it('un suspendu ne reçoit plus d’attribution', () => {
      // Le portefeuille déjà constitué lui reste ; ce sont les NOUVEAUX
      // rattachements qui s'arrêtent.
      expect(canReceiveAttribution(AmbassadorStatus.SUSPENDED)).toBe(false);
    });
  });

  describe('instruction et fin de parcours', () => {
    it('SUBMITTED est en instruction', () => {
      expect(isApplicationStage(AmbassadorStatus.SUBMITTED)).toBe(true);
    });

    it('ACTIVE n’est plus en instruction', () => {
      expect(isApplicationStage(AmbassadorStatus.ACTIVE)).toBe(false);
    });

    it('REJECTED et TERMINATED sont terminaux', () => {
      expect(isTerminal(AmbassadorStatus.REJECTED)).toBe(true);
      expect(isTerminal(AmbassadorStatus.TERMINATED)).toBe(true);
    });

    it('SUSPENDED n’est PAS terminal', () => {
      // Une suspension s'arrête ; une résiliation, non. Les confondre
      // interdirait toute réintégration.
      expect(isTerminal(AmbassadorStatus.SUSPENDED)).toBe(false);
    });
  });
});
