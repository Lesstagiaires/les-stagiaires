import {
  Language,
  NotificationType,
  PartnershipDecisionReason,
} from '../../generated/prisma/enums';
import { renderEmailHtml } from './email-layout';
import { renderEmailContent } from './email-templates';
import { isPartnerSpaceAvailable, partnerSpaceCta } from './partner-space';

// ============================================================================
// LES HUIT CORRECTIONS DU 2026-08-02
//
// Chacune est ici parce que le promoteur a dû la demander : le comportement
// précédent était défendable mais faux. Ces tests empêchent le retour en arrière.
// ============================================================================
describe('Partenariats — corrections du 2026-08-02', () => {
  const languages = Object.values(Language);

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

  // --- 4. NO_PUBLIC_REASON vs NOT_DISCLOSED --------------------------------
  describe('les deux façons de ne pas donner de motif', () => {
    it('NO_PUBLIC_REASON n’affiche AUCUNE ligne sur le motif', () => {
      const rendered = flatten(NotificationType.PARTNERSHIP_REFUSED, {
        organizationName: 'Coopérative Sahel',
        reasonCode: PartnershipDecisionReason.NO_PUBLIC_REASON,
      });
      // Le promoteur a refusé que cette phrase apparaisse automatiquement partout.
      expect(rendered).not.toMatch(/n’est pas communiqué/i);
      expect(rendered).not.toMatch(/motif communiqué/i);
    });

    it('NOT_DISCLOSED l’affiche explicitement — c’est un choix, pas un défaut', () => {
      const rendered = flatten(NotificationType.PARTNERSHIP_REFUSED, {
        organizationName: 'Coopérative Sahel',
        reasonCode: PartnershipDecisionReason.NOT_DISCLOSED,
      });
      expect(rendered).toMatch(/n’est pas communiqué/i);
    });

    it('NO_PUBLIC_REASON laisse tout de même passer le message validé', () => {
      const rendered = flatten(NotificationType.PARTNERSHIP_TERMINATED, {
        organizationName: 'Coopérative Sahel',
        reasonCode: PartnershipDecisionReason.NO_PUBLIC_REASON,
        publicMessage: 'Nos équipes restent à votre disposition.',
      });
      expect(rendered).toContain('Nos équipes restent à votre disposition.');
    });

    it.each(languages)('se tait dans les cinq langues — %s', (language) => {
      const rendered = flatten(
        NotificationType.PARTNERSHIP_SUSPENDED,
        {
          organizationName: 'Coopérative Sahel',
          reasonCode: PartnershipDecisionReason.NO_PUBLIC_REASON,
        },
        language,
      );
      // Aucun libellé de motif ne doit apparaître, quelle que soit la langue.
      expect(rendered).not.toMatch(
        /Motif communiqué|Reason given|Motivo comunicado|السبب المبلَّغ/,
      );
    });
  });

  // --- 5. Phase contradictoire conditionnelle ------------------------------
  describe('la phase contradictoire n’est annoncée que si elle existe', () => {
    const intention = (contradictoryProcedure?: string) => ({
      organizationName: 'Coopérative Sahel',
      recipient: 'ORGANIZATION',
      requestedBy: 'PLATFORM',
      reasonCode: PartnershipDecisionReason.INACTIVITY,
      contradictoryProcedure,
    });

    it('reste muette quand aucune procédure ne la prévoit', () => {
      const rendered = flatten(
        NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
        intention(undefined),
      );
      // Promettre un échange qui n'aura pas lieu créerait une attente opposable.
      expect(rendered).not.toMatch(/échange est ouvert/i);
      // Le reste du message demeure : le partenariat n'est pas résilié.
      expect(rendered).toMatch(/n’est pas résilié à ce jour/i);
    });

    it('l’annonce quand la procédure la prévoit', () => {
      const rendered = flatten(
        NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
        intention('true'),
      );
      expect(rendered).toMatch(/un échange est ouvert entre les parties/i);
    });

    it.each(languages)(
      'même arbitrage dans les cinq langues — %s',
      (language) => {
        const sans = flatten(
          NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
          intention(undefined),
          language,
        );
        const avec = flatten(
          NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
          intention('true'),
          language,
        );
        // La version avec procédure est nécessairement plus longue : la phrase
        // conditionnelle s'y ajoute, et nulle part ailleurs.
        expect(avec.length).toBeGreaterThan(sans.length);
      },
    );
  });

  // --- 6. Verrou contre les boutons morts ----------------------------------
  describe('aucun bouton mort', () => {
    const previous = process.env.PARTNER_SPACE_ENABLED;
    afterEach(() => {
      if (previous === undefined) delete process.env.PARTNER_SPACE_ENABLED;
      else process.env.PARTNER_SPACE_ENABLED = previous;
    });

    it('le défaut est FERMÉ — un oubli de configuration ne produit pas de lien', () => {
      delete process.env.PARTNER_SPACE_ENABLED;
      expect(isPartnerSpaceAvailable()).toBe(false);
      expect(partnerSpaceCta('Ouvrir')).toBeUndefined();
    });

    it('une valeur approximative ne suffit pas à ouvrir le verrou', () => {
      for (const value of ['1', 'yes', 'TRUE', 'oui', '']) {
        process.env.PARTNER_SPACE_ENABLED = value;
        expect(isPartnerSpaceAvailable()).toBe(false);
      }
    });

    it('aucun gabarit de partenariat ne rend de bouton tant que l’espace n’existe pas', () => {
      delete process.env.PARTNER_SPACE_ENABLED;
      const types = [
        NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED,
        NotificationType.PARTNERSHIP_APPROVED,
        NotificationType.PARTNERSHIP_REFUSED,
        NotificationType.PARTNERSHIP_SUSPENDED,
        NotificationType.PARTNERSHIP_TERMINATED,
      ];
      for (const type of types) {
        for (const language of languages) {
          const content = renderEmailContent(
            type,
            { organizationName: 'Coopérative Sahel' },
            language,
          )!;
          expect(content.cta).toBeUndefined();
          const html = renderEmailHtml(content, language, 'https://x.test');
          expect(html).not.toContain('/recruiter/partnership');
        }
      }
    });

    it('le bouton revient dès que l’espace est déclaré disponible', () => {
      process.env.PARTNER_SPACE_ENABLED = 'true';
      const content = renderEmailContent(
        NotificationType.PARTNERSHIP_APPROVED,
        { organizationName: 'Coopérative Sahel' },
        Language.FR,
      )!;
      expect(content.cta?.path).toBe('/recruiter/partnership');
    });

    it('le bouton du back-office, lui, n’est pas conditionné — cet écran existe', () => {
      delete process.env.PARTNER_SPACE_ENABLED;
      const content = renderEmailContent(
        NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
        { organizationName: 'Coopérative Sahel', recipient: 'ADMIN' },
        Language.FR,
      )!;
      expect(content.cta?.path).toBe('/partnerships-admin');
    });
  });

  // --- 8a. Date d'effet inconnue : phrase entièrement omise ----------------
  describe('acceptation sans date d’effet connue', () => {
    it.each(languages)(
      'n’écrit aucune phrase de prise d’effet — %s',
      (language) => {
        const content = renderEmailContent(
          NotificationType.PARTNERSHIP_APPROVED,
          { organizationName: 'Coopérative Sahel' },
          language,
        )!;
        const body = content.paragraphs.join(' ');

        // Ni date vide, ni tiret cadratin en guise de date, ni paragraphe fantôme.
        expect(body).not.toMatch(
          /prise d’effet|effective date|entrada en vigor|بدء السريان|produção de efeitos/i,
        );
        for (const paragraph of content.paragraphs) {
          expect(paragraph.trim().length).toBeGreaterThan(0);
        }
      },
    );

    it('l’écrit dès que la date est connue', () => {
      const body = flatten(NotificationType.PARTNERSHIP_APPROVED, {
        organizationName: 'Coopérative Sahel',
        effectiveDate: '2026-08-10T00:00:00.000Z',
      });
      expect(body).toMatch(/prise d’effet/i);
      expect(body).toContain('10/08/2026');
    });
  });

  // --- 8c / 8d. Le détail opposable reste hors de l'e-mail ----------------
  describe('les obligations ne sont pas détaillées comme si l’e-mail faisait foi', () => {
    it('la suspension renvoie au contrat et à l’espace, sans énumérer', () => {
      const rendered = flatten(NotificationType.PARTNERSHIP_SUSPENDED, {
        organizationName: 'Coopérative Sahel',
        reasonCode: PartnershipDecisionReason.COMPLIANCE_REVIEW,
      });
      expect(rendered).toMatch(
        /régis par le contrat conclu entre les parties/i,
      );
      expect(rendered).toMatch(/espace partenaire/i);
      // Aucune énumération d'obligations dans une suspension.
      expect(rendered).not.toMatch(
        /confidentialité|conservation des documents/i,
      );
    });

    it('la résiliation cite à titre d’exemple et désigne le contrat comme seule référence', () => {
      const rendered = flatten(NotificationType.PARTNERSHIP_TERMINATED, {
        organizationName: 'Coopérative Sahel',
        reasonCode: PartnershipDecisionReason.MUTUAL_AGREEMENT,
      });
      expect(rendered).toMatch(/à titre d’exemple/i);
      expect(rendered).toMatch(/énumération est indicative/i);
      expect(rendered).toMatch(/seul le contrat/i);
    });

    it.each(languages)(
      'la résiliation marque partout le caractère indicatif — %s',
      (language) => {
        const rendered = flatten(
          NotificationType.PARTNERSHIP_TERMINATED,
          {
            organizationName: 'Coopérative Sahel',
            reasonCode: PartnershipDecisionReason.MUTUAL_AGREEMENT,
          },
          language,
        );
        expect(rendered).toMatch(
          /indicative|by way of example|a título de ejemplo|إرشادي|a título de exemplo/i,
        );
      },
    );
  });

  // --- 1. Le gabarit « complément requis » --------------------------------
  describe('complément requis', () => {
    const vars = {
      organizationName: 'Coopérative Sahel',
      reference: 'PART-AB12CD34',
      requestedItems: [
        'Récépissé de déclaration',
        'Attestation fiscale de moins de trois mois',
      ],
      actionDeadline: '2026-09-01T00:00:00.000Z',
      publicMessage: 'Les copies simples suffisent à ce stade.',
    };

    it('dit d’abord qu’aucune décision n’est prise', () => {
      const content = renderEmailContent(
        NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED,
        vars,
        Language.FR,
      )!;
      // La rassurance arrive AVANT le détail : une organisation qui lit « il
      // manque une pièce » et croit son dossier rejeté ne revient pas.
      expect(content.paragraphs[0]).toMatch(/aucune décision n’a été prise/i);
      expect(content.paragraphs[0]).toMatch(/reste ouverte/i);
    });

    it('n’emploie jamais le vocabulaire du refus', () => {
      for (const language of languages) {
        const rendered = flatten(
          NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED,
          vars,
          language,
        );
        expect(rendered).not.toMatch(
          /refus|rejet|rejected|refused|rechaz|مرفوض|recusad/i,
        );
      }
    });

    it('rend chaque pièce attendue sur sa propre ligne', () => {
      const content = renderEmailContent(
        NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED,
        vars,
        Language.FR,
      )!;
      expect(content.paragraphs).toContain('— Récépissé de déclaration');
      expect(content.paragraphs).toContain(
        '— Attestation fiscale de moins de trois mois',
      );
    });

    it('affiche l’échéance d’action mise en forme, jamais une date ISO', () => {
      const rendered = flatten(
        NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED,
        vars,
      );
      expect(rendered).toContain('01/09/2026');
      expect(rendered).not.toContain('2026-09-01');
    });

    it('rappelle que la candidature initiale est conservée', () => {
      const rendered = flatten(
        NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED,
        vars,
      );
      expect(rendered).toMatch(/sans avoir à déposer une nouvelle demande/i);
      expect(rendered).toMatch(/candidature initiale est conservée/i);
    });

    it('se rend proprement sans aucune pièce ni échéance', () => {
      for (const language of languages) {
        const content = renderEmailContent(
          NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED,
          { organizationName: 'Coopérative Sahel' },
          language,
        )!;
        for (const paragraph of content.paragraphs) {
          expect(paragraph.trim().length).toBeGreaterThan(0);
        }
        const html = renderEmailHtml(content, language, 'https://x.test');
        expect(html).not.toContain('undefined');
        // Pas d'intitulé « Éléments attendus : » suivi de rien.
        expect(html).not.toMatch(/attendus\s*:\s*<\/p>/i);
      }
    });

    it('ne laisse pas fuiter la note interne de l’administrateur', () => {
      const leak = 'Société suspectée de complaisance, à surveiller';
      for (const language of languages) {
        const rendered = flatten(
          NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED,
          { ...vars, internalNote: leak },
          language,
        );
        expect(rendered).not.toContain(leak);
      }
    });
  });
});
