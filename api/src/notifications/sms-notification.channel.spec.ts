import { Language, NotificationType } from '../../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import { CRITICAL_SMS_TYPES } from './critical-sms-types';
import { SmsNotificationChannel } from './sms-notification.channel';

// ============================================================================
// « Les SMS doivent être réservés uniquement aux opérations critiques »
// (décision du promoteur du 2026-07-31, point 3).
//
// Ces tests sont le filet de sécurité de cette règle. Sans eux, elle ne tiendrait
// qu'à la vigilance de la prochaine personne qui ajoutera un type de notification
// — et la facture le dirait avant le code.
// ============================================================================

// NUMÉRO FICTIF, jamais un numéro réel — le préfixe `60` n'est attribué à aucun
// opérateur camerounais (les mobiles y commencent par 62, 65, 66, 67, 68, 69),
// donc cette valeur ne peut désigner personne. Le canal ne valide pas le format :
// c'est une valeur de bouchon, rien d'autre.
const NUMERO_FICTIF = '+237600000002';

describe('SmsNotificationChannel', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let sms: { send: jest.Mock };
  let channel: SmsNotificationChannel;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ phone: NUMERO_FICTIF, language: Language.FR }),
      },
    };
    sms = { send: jest.fn() };
    channel = new SmsNotificationChannel(
      prisma as unknown as PrismaService,
      // Le mock satisfait structurellement SmsProvider : aucune assertion utile.
      sms,
    );
  });

  // La liste est BLANCHE : tout type non listé reste muet par défaut. Ce test
  // parcourt l'énumération complète plutôt qu'un échantillon — c'est ce qui le
  // rend utile le jour où quelqu'un ajoute un type sans y penser.
  it("n'envoie aucun SMS pour un type hors de la liste blanche", async () => {
    const nonCritical = Object.values(NotificationType).filter(
      (type) => !CRITICAL_SMS_TYPES.has(type),
    );
    expect(nonCritical.length).toBeGreaterThan(0);

    for (const type of nonCritical) {
      await channel.send('user-1', {
        type,
        metadata: { organizationName: 'Test Corp' },
      });
    }

    expect(sms.send).not.toHaveBeenCalled();
  });

  // L'ALERTE DE SÉCURITÉ. Elle part SANS métadonnées exploitables, et c'est
  // délibéré : le message ne reprend aucune donnée du dossier, pas même une
  // destination masquée, parce qu'un SMS se lit sur un écran verrouillé.
  //
  // Ce test existe parce que le rendu SMS exige normalement un « sujet » et rend
  // `null` sans lui : sans le traitement des gabarits invariables, cette alerte
  // aurait été silencieusement avalée. Un canal qui se tait sur une alerte de
  // compromission est pire qu'un canal absent — on croit être protégé.
  it('envoie l’alerte de coordonnées modifiées, sans aucune donnée du dossier', async () => {
    await channel.send('user-1', {
      type: NotificationType.AMBASSADOR_PAYMENT_DETAILS_CHANGED,
      metadata: { destinationMasked: 'MTN MoMo — ••••3456' },
    });

    expect(sms.send).toHaveBeenCalledTimes(1);
    const [, message] = sms.send.mock.calls[0] as [string, string];
    expect(message).toContain('signalez-le immédiatement');
    // Même masquée, la destination n'a rien à faire dans un SMS.
    expect(message).not.toContain('3456');
  });

  it('envoie un SMS pour les alertes de portefeuille, explicitement demandées', async () => {
    await channel.send('user-1', {
      type: NotificationType.AMBASSADOR_PORTFOLIO_WARNING_9M,
      metadata: { organizationName: 'Test Corp SARL' },
    });

    expect(sms.send).toHaveBeenCalledWith(
      NUMERO_FICTIF,
      expect.stringContaining('Test Corp SARL'),
    );
  });

  it("compose le message dans la langue de l'utilisateur", async () => {
    prisma.user.findUnique.mockResolvedValue({
      phone: NUMERO_FICTIF,
      language: Language.EN,
    });

    await channel.send('user-1', {
      type: NotificationType.AMBASSADOR_PORTFOLIO_EXPIRED,
      metadata: { organizationName: 'Test Corp' },
    });

    const [[, message]] = sms.send.mock.calls as [[string, string]];
    expect(message).toContain('has left your portfolio');
  });

  // Mieux vaut ne rien envoyer qu'un SMS à trou, qui inquiète sans informer.
  it("n'envoie rien quand les données du message manquent", async () => {
    await channel.send('user-1', {
      type: NotificationType.AMBASSADOR_PORTFOLIO_WARNING_9M,
      metadata: {},
    });

    expect(sms.send).not.toHaveBeenCalled();
  });

  // Un SMS qui ne part pas ne doit jamais faire échouer l'opération métier : la
  // notification interne, elle, est déjà écrite en base.
  it("n'échoue jamais bruyamment si le fournisseur SMS tombe", async () => {
    sms.send.mockRejectedValue(new Error('opérateur injoignable'));

    await expect(
      channel.send('user-1', {
        type: NotificationType.AMBASSADOR_PORTFOLIO_EXPIRED,
        metadata: { organizationName: 'Test Corp' },
      }),
    ).resolves.toBeUndefined();
  });

  it('ne tente rien pour un compte sans numéro de téléphone', async () => {
    prisma.user.findUnique.mockResolvedValue({
      phone: null,
      language: Language.FR,
    });

    await channel.send('user-1', {
      type: NotificationType.AMBASSADOR_PORTFOLIO_EXPIRED,
      metadata: { organizationName: 'Test Corp' },
    });

    expect(sms.send).not.toHaveBeenCalled();
  });
});
