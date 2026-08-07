import { Language, NotificationType } from '../../generated/prisma/enums';
import { CRITICAL_SMS_TYPES } from './critical-sms-types';
import { renderCriticalSms } from './sms-templates';

// ============================================================================
// GARDE-FOU D'EXHAUSTIVITÉ
//
// Deux oublis sont possibles et tous deux silencieux :
//   — inscrire un type sur la liste blanche SMS sans écrire son gabarit : le SMS
//     ne part jamais, et personne ne s'en aperçoit avant qu'un candidat rate son
//     entretien ;
//   — écrire un gabarit en oubliant une langue : un utilisateur lusophone
//     recevrait un message vide, ou pire, rien du tout.
//
// Ces tests transforment les deux en échec de build.
// ============================================================================
describe('Gabarits SMS critiques', () => {
  // Sujet plausible pour chaque famille d'évènement — le rendu retourne null si
  // aucun sujet exploitable n'est trouvé, ce qui ferait passer le test à tort.
  const METADATA_BY_TYPE: Partial<Record<NotificationType, object>> = {
    [NotificationType.AMBASSADOR_PORTFOLIO_WARNING_9M]: {
      organizationName: 'Test Corp',
    },
    [NotificationType.AMBASSADOR_PORTFOLIO_WARNING_11M]: {
      organizationName: 'Test Corp',
    },
    [NotificationType.AMBASSADOR_PORTFOLIO_EXPIRED]: {
      organizationName: 'Test Corp',
    },
    [NotificationType.AMBASSADOR_PAYOUT_EXECUTED]: {
      amountMinor: 120000,
      currency: 'XAF',
    },
    // Alerte de sécurité : aucune donnée n'y est reprise, pas même masquée. Un
    // SMS lu sur un écran verrouillé ne doit rien apprendre à personne. Le
    // gabarit est donc invariable, et ce jeu de métadonnées volontairement vide.
    [NotificationType.AMBASSADOR_PAYMENT_DETAILS_CHANGED]: {},
    [NotificationType.APPLICATION_ADMISSION_LETTER_ISSUED]: {
      reference: 'CAND-2026-0042',
    },
    [NotificationType.APPLICATION_INTERVIEW_PROPOSED]: {
      reference: 'CAND-2026-0042',
    },
    [NotificationType.APPLICATION_INTERNSHIP_STARTING_SOON]: {
      reference: 'CAND-2026-0042',
    },
  };

  const criticalTypes = [...CRITICAL_SMS_TYPES];
  const languages = Object.values(Language);

  it('couvre TOUS les types de la liste blanche', () => {
    const orphans = criticalTypes.filter(
      (type) => METADATA_BY_TYPE[type] === undefined,
    );
    // Un type ajouté à la liste blanche sans jeu de métadonnées ici est un type
    // qu'on n'a pas fini de câbler.
    expect(orphans).toEqual([]);
  });

  it.each(criticalTypes)('rend %s dans toutes les langues', (type) => {
    const metadata = METADATA_BY_TYPE[type];
    for (const language of languages) {
      const message = renderCriticalSms({ type, metadata }, language);
      expect(message).not.toBeNull();
      expect(message!.length).toBeGreaterThan(20);
      // La marque doit figurer : un SMS anonyme est ignoré, ou pris pour une
      // tentative d'hameçonnage.
      expect(message).toContain('LES STAGIAIRES');
    }
  });

  it('ne rend rien pour un type hors liste blanche', () => {
    const message = renderCriticalSms(
      {
        type: NotificationType.APPLICATION_CLOSED,
        metadata: { reference: 'CAND-2026-0042' },
      },
      Language.FR,
    );
    expect(message).toBeNull();
  });

  it("ne rend rien plutôt qu'un message à trou quand le sujet manque", () => {
    // Un SMS « votre candidature  est acceptée » inquiète sans informer.
    const message = renderCriticalSms(
      { type: NotificationType.APPLICATION_INTERVIEW_PROPOSED, metadata: {} },
      Language.FR,
    );
    expect(message).toBeNull();
  });

  it('tient dans un segment SMS unique en arabe', () => {
    // L'arabe passe en UCS-2 : 70 caractères par segment contre 160 en GSM-7.
    // Dépasser triple le coût d'envoi sans prévenir.
    for (const type of criticalTypes) {
      const message = renderCriticalSms(
        { type, metadata: METADATA_BY_TYPE[type] },
        Language.AR,
      );
      expect(message!.length).toBeLessThanOrEqual(160);
    }
  });
});
