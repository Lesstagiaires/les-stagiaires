import {
  Language,
  NotificationType,
  PartnershipDecisionReason,
} from '../../generated/prisma/enums';
import { renderEmailHtml, renderEmailText } from './email-layout';
import { listTypesWithTemplate, renderEmailContent } from './email-templates';

// ============================================================================
// REGISTRE INSTITUTIONNEL DES PARTENARIATS — arbitrage du promoteur du 2026-08-02
//
// « Le message doit porter sur la demande, le partenariat ou la décision
// administrative, et non attaquer l'organisation elle-même. »
//
// Ces tests verrouillent ce qui, dans un e-mail adressé à une institution, ne se
// rattrape pas : une note d'administration recopiée, un jugement de valeur, une
// suspension lue comme une rupture, ou l'affirmation que toutes les obligations
// s'éteignent.
// ============================================================================
describe('E-mails — partenariats', () => {
  const languages = Object.values(Language);

  const PARTNERSHIP_TYPES = [
    NotificationType.PARTNERSHIP_APPROVED,
    NotificationType.PARTNERSHIP_REFUSED,
    NotificationType.PARTNERSHIP_SUSPENDED,
    NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
    NotificationType.PARTNERSHIP_TERMINATED,
  ];

  const render = (
    type: NotificationType,
    vars: Record<string, string>,
    language: Language = Language.FR,
  ) => {
    const content = renderEmailContent(type, vars, language)!;
    expect(content).not.toBeNull();
    return [
      content.subject,
      content.heading,
      ...content.paragraphs,
      content.footnote ?? '',
    ].join(' ');
  };

  it('les cinq gabarits sont installés', () => {
    const installed = new Set(listTypesWithTemplate());
    expect(PARTNERSHIP_TYPES.filter((type) => !installed.has(type))).toEqual(
      [],
    );
  });

  describe('la note interne ne franchit jamais la frontière', () => {
    // La note libre de l'administrateur n'a AUCUNE variable de gabarit. Ce test
    // la fournit malgré tout, sous tous les noms plausibles : si un gabarit la
    // reprenait un jour, elle apparaîtrait.
    const LEAK = 'Dirigeant injoignable, société probablement fictive';

    it.each(PARTNERSHIP_TYPES)('%s', (type) => {
      for (const language of languages) {
        const rendered = render(
          type,
          {
            organizationName: 'Coopérative Sahel',
            reference: 'PART-AB12CD34',
            reasonCode: PartnershipDecisionReason.INCOMPLETE_FILE,
            // Les trois noms sous lesquels une note interne pourrait fuiter.
            internalNote: LEAK,
            reason: LEAK,
            decisionReason: LEAK,
          },
          language,
        );
        expect(rendered).not.toContain(LEAK);
      }
    });
  });

  describe('aucun jugement porté sur l’organisation', () => {
    // Les formulations que le promoteur a explicitement proscrites.
    const FORBIDDEN =
      /votre comportement|vous avez échoué|ne vous faisons plus confiance|ne correspond pas à nos valeurs/i;

    it.each(PARTNERSHIP_TYPES)('%s', (type) => {
      const rendered = render(type, {
        organizationName: 'Coopérative Sahel',
        reasonCode: PartnershipDecisionReason.CONDITIONS_NOT_MET,
      });
      expect(rendered).not.toMatch(FORBIDDEN);
    });
  });

  describe('acceptation', () => {
    it('ne présente pas l’acceptation comme la signature d’un contrat', () => {
      const rendered = render(NotificationType.PARTNERSHIP_APPROVED, {
        organizationName: 'Coopérative Sahel',
        reference: 'PART-AB12CD34',
        decisionDate: '2026-08-02T09:00:00.000Z',
      });

      expect(rendered).toContain('Coopérative Sahel');
      expect(rendered).toContain('02/08/2026');
      expect(rendered).toMatch(/ne vaut pas signature d’une convention/i);
      expect(rendered).toMatch(/espace partenaire/i);
    });
  });

  describe('refus', () => {
    it('emploie la formule institutionnelle et préserve la relation', () => {
      const rendered = render(NotificationType.PARTNERSHIP_REFUSED, {
        organizationName: 'Coopérative Sahel',
        reference: 'PART-AB12CD34',
        reasonCode: PartnershipDecisionReason.INCOMPLETE_FILE,
      });

      expect(rendered).toMatch(/pas en mesure d’y donner une suite favorable/i);
      expect(rendered).toContain('dossier incomplet');
      // La phrase qui empêche un refus de dossier de se lire comme un verdict
      // sur l'organisation.
      expect(rendered).toMatch(
        /ne constitue pas une appréciation générale de votre organisation/i,
      );
      expect(rendered).toMatch(/nouvelle demande/i);
    });

    it('dit franchement qu’un motif n’est pas communiqué, plutôt que de se taire', () => {
      const rendered = render(NotificationType.PARTNERSHIP_REFUSED, {
        organizationName: 'Coopérative Sahel',
        reasonCode: PartnershipDecisionReason.NOT_DISCLOSED,
      });
      expect(rendered).toMatch(/n’est pas communiqué/i);
    });

    it('ignore un code inconnu plutôt que d’afficher un identifiant brut', () => {
      const rendered = render(NotificationType.PARTNERSHIP_REFUSED, {
        organizationName: 'Coopérative Sahel',
        reasonCode: 'CODE_AJOUTE_SANS_TRADUCTION',
      });
      expect(rendered).not.toContain('CODE_AJOUTE_SANS_TRADUCTION');
    });

    it('joint le message complémentaire validé lorsqu’il existe', () => {
      const rendered = render(NotificationType.PARTNERSHIP_REFUSED, {
        organizationName: 'Coopérative Sahel',
        reasonCode: PartnershipDecisionReason.INCOMPLETE_FILE,
        publicMessage: 'Le récépissé de dépôt légal reste à fournir.',
      });
      expect(rendered).toContain(
        'Le récépissé de dépôt légal reste à fournir.',
      );
    });
  });

  describe('suspension', () => {
    it('affirme le caractère temporaire et écarte la lecture d’une rupture', () => {
      const rendered = render(NotificationType.PARTNERSHIP_SUSPENDED, {
        organizationName: 'Coopérative Sahel',
        effectiveDate: '2026-08-02T00:00:00.000Z',
        reasonCode: PartnershipDecisionReason.COMPLIANCE_REVIEW,
      });

      expect(rendered).toMatch(/temporairement suspendu/i);
      expect(rendered).toContain('02/08/2026');
      // Sans cette phrase, une organisation lit une rupture là où il n'y a qu'un gel.
      expect(rendered).toMatch(
        /ne constitue pas, à elle seule, une résiliation/i,
      );
      expect(rendered).toMatch(/réexamen/i);
      // Ton non accusatoire : aucune faute n'est imputée.
      expect(rendered).not.toMatch(/faute|manquement grave|sanction/i);
    });

    it('énonce ce qui reste applicable pendant la suspension', () => {
      const rendered = render(NotificationType.PARTNERSHIP_SUSPENDED, {
        organizationName: 'Coopérative Sahel',
        reasonCode: PartnershipDecisionReason.COMPLIANCE_REVIEW,
      });
      expect(rendered).toMatch(
        /engagements contractuels en cours restent régis par le contrat/i,
      );
      // Le detail opposable n'est PAS dans l'e-mail : il est derriere
      // l'authentification.
      expect(rendered).toMatch(/espace partenaire/i);
    });
  });

  describe('demande de résiliation — trois destinataires, trois textes', () => {
    it('accuse réception auprès de l’organisation qui demande', () => {
      const rendered = render(
        NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
        {
          organizationName: 'Coopérative Sahel',
          reference: 'PART-AB12CD34',
          recipient: 'ORGANIZATION',
          requestedBy: 'ORGANIZATION',
          requestedAt: '2026-08-02T08:00:00.000Z',
        },
      );

      expect(rendered).toMatch(/confirmons la réception/i);
      expect(rendered).toContain('02/08/2026');
      expect(rendered).toMatch(/en cours de traitement/i);
      // LE point du gabarit : ne surtout pas laisser croire à une résiliation déjà
      // acquise. Le partenariat court encore.
      expect(rendered).toMatch(/demeure soumis à ses conditions actuelles/i);
      expect(rendered).toMatch(/retirée/i);
    });

    it('annonce une intention, pas une décision, quand la plateforme est à l’origine', () => {
      const rendered = render(
        NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
        {
          organizationName: 'Coopérative Sahel',
          recipient: 'ORGANIZATION',
          requestedBy: 'PLATFORM',
          reasonCode: PartnershipDecisionReason.INACTIVITY,
        },
      );

      expect(rendered).toMatch(/intention de résiliation/i);
      expect(rendered).toMatch(/n’est pas résilié à ce jour/i);
      expect(rendered).toContain('absence d’activité');
    });

    it('informe l’administration sans lui servir le texte destiné au partenaire', () => {
      const rendered = render(
        NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
        {
          organizationName: 'Coopérative Sahel',
          recipient: 'ADMIN',
          requestedBy: 'ORGANIZATION',
          publicMessage: 'Réorientation de notre politique de recrutement.',
        },
      );

      expect(rendered).toMatch(/a déposé une demande de résiliation/i);
      // Les mots de l'organisation circulent vers la plateforme : c'est le seul
      // sens autorisé pour un champ libre.
      expect(rendered).toContain('Réorientation de notre politique');
      expect(rendered).toMatch(/reste en vigueur/i);
    });
  });

  describe('résiliation', () => {
    it('énonce la date d’effet, les accès désactivés et les obligations survivantes', () => {
      const rendered = render(NotificationType.PARTNERSHIP_TERMINATED, {
        organizationName: 'Coopérative Sahel',
        reference: 'PART-AB12CD34',
        effectiveDate: '2026-08-02T00:00:00.000Z',
        reasonCode: PartnershipDecisionReason.ORGANIZATION_REQUEST,
      });

      expect(rendered).toMatch(/a pris fin/i);
      expect(rendered).toContain('02/08/2026');
      expect(rendered).toMatch(/accès liés au programme sont désactivés/i);
      expect(rendered).toMatch(/confidentialité/i);
      expect(rendered).toMatch(/protection des données/i);
      expect(rendered).toMatch(/sommes éventuellement dues/i);
      expect(rendered).toMatch(/conservation des documents/i);
    });

    it('n’écrit jamais que toutes les obligations prennent fin', () => {
      for (const language of languages) {
        const rendered = render(
          NotificationType.PARTNERSHIP_TERMINATED,
          {
            organizationName: 'Coopérative Sahel',
            reasonCode: PartnershipDecisionReason.MUTUAL_AGREEMENT,
          },
          language,
        );
        expect(rendered).not.toMatch(
          /toutes? les obligations (prennent fin|cessent)|all obligations (end|cease)|todas las obligaciones (finalizan|cesan)|todas as obrigações (terminam|cessam)/i,
        );
      }
    });
  });

  describe('rendu complet dans les cinq langues', () => {
    it.each(PARTNERSHIP_TYPES)('%s', (type) => {
      for (const language of languages) {
        const content = renderEmailContent(
          type,
          {
            organizationName: 'Coopérative Sahel',
            reference: 'PART-AB12CD34',
            reasonCode: PartnershipDecisionReason.CONDITIONS_NOT_MET,
            effectiveDate: '2026-08-02T00:00:00.000Z',
          },
          language,
        )!;

        expect(content.subject.trim().length).toBeGreaterThan(5);
        expect(content.paragraphs.length).toBeGreaterThan(0);
        for (const paragraph of content.paragraphs) {
          expect(paragraph.trim().length).toBeGreaterThan(0);
        }

        const html = renderEmailHtml(content, language, 'https://x.test');
        const text = renderEmailText(content, language, 'https://x.test');
        expect(html).not.toContain('undefined');
        expect(text).not.toContain('undefined');
      }
    });

    it('se rend intégralement même sans aucune métadonnée', () => {
      for (const type of PARTNERSHIP_TYPES) {
        for (const language of languages) {
          const content = renderEmailContent(type, {}, language)!;
          const html = renderEmailHtml(content, language, 'https://x.test');
          expect(html).not.toContain('undefined');
          expect(html).not.toContain('null');
        }
      }
    });
  });
});
