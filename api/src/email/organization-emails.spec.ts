import { Language, NotificationType } from '../../generated/prisma/enums';
import { renderEmailHtml, renderEmailText } from './email-layout';
import { renderEmailContent } from './email-templates';
import {
  DeliveryPolicy,
  NOTIFICATION_DELIVERY,
} from '../notifications/notification-delivery';
import { listTypesWithTemplate } from './email-templates';

// ============================================================================
// ORGANISATIONS, CANDIDATURES CÔTÉ ORGANISATION, APPRENANTS
//
// Les six derniers gabarits obligatoires. Deux d'entre eux annoncent ou retirent
// un ACCÈS : ils doivent nommer l'organisation concernée, faute de quoi ils se
// lisent comme un hameçonnage — c'est ce que ces tests verrouillent en premier.
// ============================================================================
describe('E-mails — organisations, candidatures et apprenants', () => {
  const languages = Object.values(Language);

  const SIX = [
    NotificationType.ORGANIZATION_INVITATION_RECEIVED,
    NotificationType.ORGANIZATION_ACCESS_REVOKED,
    NotificationType.APPLICATION_ESTABLISHMENT_ASSOCIATION_REQUESTED,
    NotificationType.APPLICATION_ADMISSION_ACCEPTED_ORG,
    NotificationType.APPLICATION_AGREEMENT_FULLY_SIGNED_ORG,
    NotificationType.LEARNER_INVITED,
  ];

  const flatten = (
    type: NotificationType,
    vars: Record<string, unknown>,
    language: Language = Language.FR,
  ) => {
    const content = renderEmailContent(type, vars as never, language)!;
    return [
      content.subject,
      content.heading,
      ...content.paragraphs,
      content.footnote ?? '',
    ].join(' ');
  };

  it('PLUS AUCUN type à e-mail obligatoire n’est sans gabarit', () => {
    const installed = new Set(listTypesWithTemplate());
    const missing = Object.values(NotificationType).filter(
      (type) =>
        NOTIFICATION_DELIVERY[type] === DeliveryPolicy.EMAIL_REQUIRED &&
        !installed.has(type),
    );
    expect(missing).toEqual([]);
  });

  describe('un message qui touche à un accès nomme toujours l’organisation', () => {
    it.each(languages)('invitation — %s', (language) => {
      const rendered = flatten(
        NotificationType.ORGANIZATION_INVITATION_RECEIVED,
        { organizationName: 'Coopérative Sahel', role: 'RECRUITER' },
        language,
      );
      expect(rendered).toContain('Coopérative Sahel');
      // Le code technique du rôle ne s'affiche jamais brut.
      expect(rendered).not.toContain('RECRUITER');
    });

    it.each(languages)('révocation — %s', (language) => {
      const rendered = flatten(
        NotificationType.ORGANIZATION_ACCESS_REVOKED,
        { organizationName: 'Coopérative Sahel' },
        language,
      );
      expect(rendered).toContain('Coopérative Sahel');
    });

    it.each(languages)('invitation d’apprenant — %s', (language) => {
      const rendered = flatten(
        NotificationType.LEARNER_INVITED,
        { establishmentName: 'Lycée technique de Douala' },
        language,
      );
      expect(rendered).toContain('Lycée technique de Douala');
    });
  });

  describe('invitation d’équipe', () => {
    it('traduit le rôle proposé', () => {
      expect(
        flatten(NotificationType.ORGANIZATION_INVITATION_RECEIVED, {
          organizationName: 'Coopérative Sahel',
          role: 'ADMIN',
        }),
      ).toContain('administrateur');
    });

    it('ignore un rôle inconnu plutôt que d’afficher un code', () => {
      const rendered = flatten(
        NotificationType.ORGANIZATION_INVITATION_RECEIVED,
        { organizationName: 'Coopérative Sahel', role: 'ROLE_INVENTE' },
      );
      expect(rendered).not.toContain('ROLE_INVENTE');
      expect(rendered).not.toMatch(/Rôle proposé/);
    });

    it('rassure : tant qu’on n’accepte pas, rien n’est accessible', () => {
      const rendered = flatten(
        NotificationType.ORGANIZATION_INVITATION_RECEIVED,
        { organizationName: 'Coopérative Sahel', role: 'VIEWER' },
      );
      expect(rendered).toMatch(/accepter ou décliner/i);
      expect(rendered).toMatch(/vous n’avez accès à aucune donnée/i);
      // Un e-mail d'invitation est un vecteur d'hameçonnage classique : le
      // destinataire doit savoir que l'ignorer est sans conséquence.
      expect(rendered).toMatch(/ignorez-la/i);
    });
  });

  describe('révocation d’accès', () => {
    it('reste factuelle et n’impute aucune faute', () => {
      const rendered = flatten(NotificationType.ORGANIZATION_ACCESS_REVOKED, {
        organizationName: 'Coopérative Sahel',
      });
      expect(rendered).not.toMatch(/faute|manquement|sanction|comportement/i);
    });

    it('distingue le compte personnel de l’accès retiré', () => {
      const rendered = flatten(NotificationType.ORGANIZATION_ACCESS_REVOKED, {
        organizationName: 'Coopérative Sahel',
      });
      // Sans cette phrase, la personne croit son compte LES STAGIAIRES supprimé.
      expect(rendered).toMatch(/compte personnel .*n’est pas affecté/i);
      expect(rendered).toMatch(/restent les vôtres/i);
    });
  });

  describe('association de l’établissement', () => {
    it('dit que l’association est facultative et ne bloque rien', () => {
      const rendered = flatten(
        NotificationType.APPLICATION_ESTABLISHMENT_ASSOCIATION_REQUESTED,
        { reference: 'CAND-2026-0042' },
      );
      expect(rendered).toContain('CAND-2026-0042');
      // Un établissement qui se croit bloquant retarderait le stage de son
      // apprenant par excès de prudence.
      expect(rendered).toMatch(/facultative/i);
      expect(rendered).toMatch(/ne conditionne ni/i);
    });
  });

  describe('candidatures côté organisation', () => {
    it('l’acceptation dit ce qui est attendu ensuite', () => {
      const rendered = flatten(
        NotificationType.APPLICATION_ADMISSION_ACCEPTED_ORG,
        { reference: 'CAND-2026-0042' },
      );
      expect(rendered).toContain('CAND-2026-0042');
      expect(rendered).toMatch(/convention de stage a été générée/i);
      expect(rendered).toMatch(/signée par toutes les parties/i);
    });

    it('la convention signée annonce le démarrage possible', () => {
      const rendered = flatten(
        NotificationType.APPLICATION_AGREEMENT_FULLY_SIGNED_ORG,
        { reference: 'CAND-2026-0042' },
      );
      expect(rendered).toMatch(/signée par toutes les parties/i);
      expect(rendered).toMatch(/peut démarrer/i);
    });
  });

  describe('invitation d’apprenant — le destinataire peut être mineur', () => {
    it('dit ce que le rattachement change, et ce qu’il ne change pas', () => {
      const rendered = flatten(NotificationType.LEARNER_INVITED, {
        establishmentName: 'Lycée technique de Douala',
      });
      expect(rendered).toMatch(/suivre vos stages et vos conventions/i);
      // La limite est aussi importante que le droit accordé.
      expect(rendered).toMatch(/n’accède ni à vos documents personnels/i);
      expect(rendered).toMatch(/libre d’accepter ou de refuser/i);
    });
  });

  describe('rendu complet dans les cinq langues', () => {
    it.each(SIX)('%s', (type) => {
      for (const language of languages) {
        const content = renderEmailContent(
          type,
          {
            organizationName: 'Coopérative Sahel',
            establishmentName: 'Lycée technique de Douala',
            reference: 'CAND-2026-0042',
            role: 'ADMIN',
          },
          language,
        )!;

        expect(content.subject.trim().length).toBeGreaterThan(5);
        for (const paragraph of content.paragraphs) {
          expect(paragraph.trim().length).toBeGreaterThan(0);
        }

        const html = renderEmailHtml(content, language, 'https://x.test');
        const text = renderEmailText(content, language, 'https://x.test');
        expect(html).not.toContain('undefined');
        expect(text).not.toContain('undefined');
      }
    });

    it('se rend proprement sans aucune métadonnée', () => {
      for (const type of SIX) {
        for (const language of languages) {
          const content = renderEmailContent(type, {}, language)!;
          const html = renderEmailHtml(content, language, 'https://x.test');
          expect(html).not.toContain('undefined');
          expect(html).not.toContain('null');
          // Pas d'espace orpheline laissée par une variable absente.
          for (const paragraph of content.paragraphs) {
            expect(paragraph).not.toMatch(/\s{2,}/);
          }
        }
      }
    });
  });
});
