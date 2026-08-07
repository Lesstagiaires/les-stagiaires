import {
  Language,
  NotificationCategory,
  NotificationType,
} from '../../generated/prisma/enums';
import { categoryOf } from '../notifications/notification-categories';
import { renderEmailHtml, renderEmailText } from './email-layout';
import { listTypesWithTemplate, renderEmailContent } from './email-templates';

// ============================================================================
// Deux défauts silencieux à rendre impossibles :
//   — un gabarit écrit dans quatre langues sur cinq : l'utilisateur lusophone
//     reçoit une page blanche, et rien ne le signale ;
//   — une variable non échappée : un nom d'organisation contenant du balisage
//     injecte du HTML dans la boîte de quelqu'un d'autre.
// ============================================================================
describe('Gabarits e-mail', () => {
  const types = listTypesWithTemplate();
  const languages = Object.values(Language);
  const VARS = {
    reference: 'CAND-2026-0042',
    organizationName: 'Test Corp',
    description: 'Une pièce justificative',
  };

  it('couvre tout le parcours candidat rendu obligatoire par le promoteur', () => {
    // L'e-mail est OBLIGATOIRE à chaque changement de statut vu par le candidat.
    // Ce test échoue si l'un de ces moments perd son gabarit.
    const mandatory = [
      NotificationType.APPLICATION_SUBMITTED,
      NotificationType.APPLICATION_DOCUMENT_REQUESTED,
      NotificationType.APPLICATION_INTERVIEW_PROPOSED,
      NotificationType.APPLICATION_ADMISSION_LETTER_ISSUED,
      NotificationType.APPLICATION_REJECTED,
      NotificationType.APPLICATION_ACCEPTED_PENDING_TRAVEL_CONSENT,
      NotificationType.APPLICATION_TRAVEL_CONSENT_CONFIRMED,
      NotificationType.APPLICATION_TRAVEL_CONSENT_EXPIRED,
      NotificationType.APPLICATION_AGREEMENT_FULLY_SIGNED,
      NotificationType.APPLICATION_ESTABLISHMENT_SIGNED,
      NotificationType.APPLICATION_INTERNSHIP_STARTING_SOON,
      NotificationType.APPLICATION_CLOSED,
      NotificationType.APPLICATION_RECOMMENDATION_RECEIVED,
    ];
    const missing = mandatory.filter((type) => !types.includes(type));
    expect(missing).toEqual([]);
  });

  it.each(types)('rend %s dans les 5 langues', (type) => {
    for (const language of languages) {
      const content = renderEmailContent(type, VARS, language);
      expect(content).not.toBeNull();
      expect(content!.subject.trim().length).toBeGreaterThan(5);
      expect(content!.heading.trim().length).toBeGreaterThan(5);
      expect(content!.paragraphs.length).toBeGreaterThan(0);
      expect(content!.paragraphs[0].trim().length).toBeGreaterThan(15);
    }
  });

  it('échappe les variables issues de saisies utilisateur', () => {
    const content = renderEmailContent(
      NotificationType.APPLICATION_RECOMMENDATION_RECEIVED,
      { ...VARS, organizationName: '<script>alert(1)</script>' },
      Language.FR,
    )!;
    const html = renderEmailHtml(content, Language.FR, 'https://exemple.test');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('produit une version texte pour chaque e-mail — jamais du HTML seul', () => {
    for (const type of types) {
      const content = renderEmailContent(type, VARS, Language.FR)!;
      const text = renderEmailText(
        content,
        Language.FR,
        'https://exemple.test',
      );
      expect(text).toContain('LES STAGIAIRES');
      expect(text).toContain(content.heading);
      expect(text).not.toContain('<');
    }
  });

  it("marque l'arabe en écriture de droite à gauche, et pas le portugais", () => {
    const content = renderEmailContent(
      NotificationType.APPLICATION_SUBMITTED,
      VARS,
      Language.AR,
    )!;
    expect(renderEmailHtml(content, Language.AR, 'https://x.test')).toContain(
      'dir="rtl"',
    );

    const pt = renderEmailContent(
      NotificationType.APPLICATION_SUBMITTED,
      VARS,
      Language.PT,
    )!;
    expect(renderEmailHtml(pt, Language.PT, 'https://x.test')).toContain(
      'dir="ltr"',
    );
  });

  it('classe chaque type doté d’un gabarit dans une catégorie réelle', () => {
    for (const type of types) {
      expect(Object.values(NotificationCategory)).toContain(categoryOf(type));
    }
  });
});
