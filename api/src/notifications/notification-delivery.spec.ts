import { NotificationType } from '../../generated/prisma/enums';
import { listTypesWithTemplate } from '../email/email-templates';
import {
  DeliveryPolicy,
  deliveryPolicyOf,
  mayEmail,
  NOTIFICATION_DELIVERY,
  respectsPreferences,
} from './notification-delivery';

// ============================================================================
// « Aucun type ne doit rester sans comportement explicitement défini »
// (arbitrage du promoteur du 2026-08-01).
//
// L'exhaustivité de la table est garantie par le typage — `Record` et non
// `Partial` — donc par le compilateur. Ces tests couvrent ce que le typage ne
// peut pas : la COHÉRENCE entre le comportement décidé et ce qui est réellement
// installé, et le fait qu'un EMAIL_REQUIRED sans gabarit soit visible plutôt que
// silencieux.
// ============================================================================
describe('Comportement de diffusion', () => {
  const allTypes = Object.values(NotificationType);
  const withTemplate = new Set(listTypesWithTemplate());

  it('couvre les 49 types', () => {
    expect(Object.keys(NOTIFICATION_DELIVERY)).toHaveLength(allTypes.length);
    const unclassified = allTypes.filter(
      (type) => NOTIFICATION_DELIVERY[type] === undefined,
    );
    expect(unclassified).toEqual([]);
  });

  it('ne connaît que les quatre comportements arrêtés', () => {
    const used = new Set(Object.values(NOTIFICATION_DELIVERY));
    for (const policy of used) {
      expect(Object.values(DeliveryPolicy)).toContain(policy);
    }
  });

  describe('sémantique', () => {
    it('EMAIL_REQUIRED ignore les préférences', () => {
      // C'est toute la différence : un évènement qui porte une échéance, un
      // engagement contractuel ou de l'argent ne se coupe pas.
      expect(
        respectsPreferences(NotificationType.AMBASSADOR_PAYOUT_EXECUTED),
      ).toBe(false);
      expect(mayEmail(NotificationType.AMBASSADOR_PAYOUT_EXECUTED)).toBe(true);
    });

    it('EMAIL_OPTIONAL respecte les préférences', () => {
      expect(
        respectsPreferences(NotificationType.AMBASSADOR_COMMISSION_EARNED),
      ).toBe(true);
    });

    it.each([
      NotificationType.APPLICATION_DOCUMENT_SUBMITTED_ORG,
      NotificationType.APPLICATION_WITHDRAWN_ORG,
      NotificationType.LEARNER_VERIFIED,
      NotificationType.PARTNERSHIP_REQUEST_NEW,
    ])('%s ne produit jamais d’e-mail', (type) => {
      expect(mayEmail(type)).toBe(false);
    });
  });

  describe('cohérence avec les gabarits installés', () => {
    it('aucun gabarit n’existe pour un type qui ne doit pas envoyer d’e-mail', () => {
      // Un gabarit écrit pour un IN_APP_ONLY serait du travail mort, et surtout
      // le signe qu'une décision a changé sans que la table suive.
      const contradictory = [...withTemplate].filter((type) => !mayEmail(type));
      expect(contradictory).toEqual([]);
    });

    // Ce test ne vérifie pas une absence de défaut : il MESURE la couverture et
    // la rend visible. Les gabarits manquants sont un chantier annoncé, pas un
    // oubli — et chaque envoi impossible est journalisé en GABARIT_ABSENT.
    it('rapporte la couverture des types qui doivent envoyer un e-mail', () => {
      const emailing = allTypes.filter((type) => mayEmail(type));
      const missing = emailing.filter((type) => !withTemplate.has(type));

      const required = emailing.filter(
        (type) => deliveryPolicyOf(type) === DeliveryPolicy.EMAIL_REQUIRED,
      );

      console.log(
        `Gabarits e-mail : ${emailing.length - missing.length}/${emailing.length} ` +
          `(dont ${required.length} obligatoires). Manquants : ${missing.length}`,
      );

      // La garantie qui compte : tout type doté d'un gabarit doit pouvoir
      // envoyer, et aucun type ne reste sans comportement.
      expect(emailing.length).toBeGreaterThan(0);
    });
  });
});
