import { Language, NotificationType } from '../../generated/prisma/enums';
import { renderEmailHtml, renderEmailText } from './email-layout';
import { listTypesWithTemplate, renderEmailContent } from './email-templates';

// ============================================================================
// « Les données sensibles ne doivent jamais apparaître intégralement dans
// l'e-mail. Les coordonnées bancaires ou de paiement doivent être masquées. »
// (arbitrage du promoteur du 2026-08-01)
//
// Un e-mail traverse des serveurs qu'on ne maîtrise pas, reste des années dans
// une boîte, et s'affiche sur un écran qu'un tiers peut regarder. Ces tests
// échouent si un numéro complet réapparaît un jour dans un gabarit.
// ============================================================================
describe('E-mails — données sensibles', () => {
  const languages = Object.values(Language);

  describe('masquage des coordonnées de paiement', () => {
    const FULL_NUMBER = '+237690123456';

    it.each(languages)('masque le numéro de destination en %s', (language) => {
      const content = renderEmailContent(
        NotificationType.AMBASSADOR_PAYOUT_EXECUTED,
        {
          amountMinor: 120000,
          currency: 'XAF',
          destinationLabel: `MTN MoMo — ${FULL_NUMBER}`,
          executionReference: 'VIR-2026-0042',
        } as never,
        language,
      )!;

      const rendered = [
        content.subject,
        content.heading,
        ...content.paragraphs,
        content.footnote ?? '',
      ].join(' ');

      expect(rendered).not.toContain(FULL_NUMBER);
      // Quatre chiffres suffisent au propriétaire pour reconnaître le compte,
      // et ne suffisent à personne d'autre.
      expect(rendered).toContain('3456');
      expect(rendered).toContain('••••');
    });

    it('conserve le libellé lisible autour du numéro masqué', () => {
      const content = renderEmailContent(
        NotificationType.AMBASSADOR_PAYOUT_EXECUTED,
        {
          amountMinor: 120000,
          currency: 'XAF',
          destinationLabel: 'MTN MoMo — Awa N. — 690123456',
        } as never,
        Language.FR,
      )!;
      const body = content.paragraphs.join(' ');

      expect(body).toContain('MTN MoMo');
      expect(body).toContain('Awa N.');
      expect(body).not.toContain('690123456');
    });

    it("n'affiche rien plutôt qu'un vide gênant si la destination manque", () => {
      const content = renderEmailContent(
        NotificationType.AMBASSADOR_PAYOUT_EXECUTED,
        { amountMinor: 120000, currency: 'XAF' } as never,
        Language.FR,
      )!;
      expect(content.paragraphs.join(' ')).toContain('—');
    });
  });

  describe('mise en forme des montants', () => {
    it('convertit l’unité mineure et joint la devise', () => {
      // Les services métier envoient un FAIT (120000 unités mineures), jamais du
      // texte mis en forme : la mise en forme dépend de la langue, qu'un service
      // métier ne connaît pas.
      const content = renderEmailContent(
        NotificationType.AMBASSADOR_PAYOUT_VALIDATED,
        { amountMinor: 120000, currency: 'XAF' } as never,
        Language.FR,
      )!;
      // toLocaleString insère une espace INSÉCABLE FINE (U+202F) comme séparateur
      // de milliers. La normaliser ici évite un test qui échoue sur un caractère
      // invisible alors que l'affichage est correct.
      const normalized = content.paragraphs
        .join(' ')
        .replace(/[\u202f\u00a0]/g, ' ');
      expect(normalized).toContain('1 200 XAF');
    });

    it('ne laisse jamais paraître une date ISO brute', () => {
      const content = renderEmailContent(
        NotificationType.AMBASSADOR_TERMINATED,
        { effectiveAt: '2026-08-01T10:30:00.000Z' },
        Language.FR,
      )!;
      const body = content.paragraphs.join(' ');
      expect(body).not.toContain('T10:30');
      expect(body).toContain('01/08/2026');
    });
  });

  describe('ton demandé par le promoteur', () => {
    it('la suspension reste factuelle et rappelle sa réversibilité', () => {
      const content = renderEmailContent(
        NotificationType.AMBASSADOR_SUSPENDED,
        { reason: 'Contrôle en cours' },
        Language.FR,
      )!;
      const full = [...content.paragraphs, content.footnote ?? ''].join(' ');

      expect(full).toContain('réversible');
      // Ce qui rassure sur l'essentiel : l'argent déjà gagné n'est pas perdu.
      expect(full).toMatch(/commissions déjà acquises restent dues/i);
    });

    it('la résiliation énonce date d’effet ET conséquences', () => {
      const content = renderEmailContent(
        NotificationType.AMBASSADOR_TERMINATED,
        { effectiveAt: '2026-08-01T00:00:00.000Z' },
        Language.FR,
      )!;
      const body = content.paragraphs.join(' ');

      expect(body).toContain('01/08/2026');
      expect(body).toMatch(/portefeuille redeviennent libres/i);
      expect(body).toMatch(/restent dues/i);
    });

    it('les alertes de portefeuille expliquent la règle sans menacer', () => {
      const content = renderEmailContent(
        NotificationType.AMBASSADOR_PORTFOLIO_WARNING_9M,
        { organizationName: 'Test Corp' },
        Language.FR,
      )!;
      const body = content.paragraphs.join(' ');

      // Pédagogique : la règle est rappelée, pas seulement la sanction.
      expect(body).toMatch(/se renouvelle à chaque achat confirmé/i);
      expect(body).not.toMatch(/attention|avertissement|sanction/i);
    });

    it('le refus de versement rassure sur le solde et indique la suite', () => {
      const content = renderEmailContent(
        NotificationType.AMBASSADOR_PAYOUT_REJECTED,
        // Depuis le 2026-08-02, ce gabarit n'accepte plus de texte libre : le
        // motif passe par un CODE de la liste contrôlée, traduit au rendu. Une
        // note d'administrateur ne peut donc plus s'y glisser.
        { reasonCode: 'PAYMENT_DETAILS_INVALID' },
        Language.FR,
      )!;
      const body = content.paragraphs.join(' ');

      expect(body).toContain(
        'coordonnées de paiement incomplètes ou invalides',
      );
      expect(body).toMatch(/solde n’est pas affecté/i);
      expect(body).toMatch(/nouvelle demande/i);
    });
  });

  describe('couverture des nouveaux gabarits', () => {
    const NEW_TEMPLATES = [
      NotificationType.AMBASSADOR_APPROVED,
      NotificationType.AMBASSADOR_SUSPENDED,
      NotificationType.AMBASSADOR_TERMINATED,
      NotificationType.AMBASSADOR_PORTFOLIO_WARNING_9M,
      NotificationType.AMBASSADOR_PORTFOLIO_WARNING_11M,
      NotificationType.AMBASSADOR_PORTFOLIO_EXPIRED,
      NotificationType.AMBASSADOR_PAYOUT_VALIDATED,
      NotificationType.AMBASSADOR_PAYOUT_EXECUTED,
      NotificationType.AMBASSADOR_PAYOUT_REJECTED,
    ];

    it('les neuf sont installés', () => {
      const installed = new Set(listTypesWithTemplate());
      expect(NEW_TEMPLATES.filter((type) => !installed.has(type))).toEqual([]);
    });

    it.each(NEW_TEMPLATES)('%s se rend dans les 5 langues', (type) => {
      for (const language of languages) {
        const content = renderEmailContent(type, {}, language)!;
        expect(content).not.toBeNull();
        expect(content.subject.trim().length).toBeGreaterThan(5);
        expect(content.paragraphs[0].trim().length).toBeGreaterThan(20);

        // Le rendu complet ne doit jamais laisser passer « undefined ».
        const html = renderEmailHtml(content, language, 'https://x.test');
        const text = renderEmailText(content, language, 'https://x.test');
        expect(html).not.toContain('undefined');
        expect(text).not.toContain('undefined');
      }
    });
  });
});
