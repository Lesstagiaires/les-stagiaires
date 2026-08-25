import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AccountStatus,
  NotificationType,
  SubscriptionNoticeType,
} from '../../generated/prisma/enums';
import type { MinorPolicyService } from '../auth/minor-policy.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  NATURE_DE_L_AVIS,
  NatureDeLAvis,
  NOTIFICATION_DE_L_AVIS,
  SEUILS_AVANT_ECHEANCE,
  seuilAtteint,
} from './subscription-notice-types';
import { SubscriptionNoticesService } from './subscription-notices.service';
import { FENETRE_RENOUVELLEMENT_JOURS } from './subscriptions.service';

const JOUR = 24 * 60 * 60 * 1000;
const MAINTENANT = new Date('2026-08-25T12:00:00Z');
const dans = (jours: number) => new Date(MAINTENANT.getTime() + jours * JOUR);

// Les arguments réellement passés à Prisma. Typés plutôt que lus en `any` : ces
// tests-ci vérifient la FORME de la requête, et un `any` leur retirerait
// justement ce qu'ils prétendent contrôler.
type ArgumentsPrisma = [
  {
    select?: Record<string, unknown>;
    where?: Record<string, unknown>;
  },
];

describe('Les seuils d’échéance', () => {
  it.each<[string, number, SubscriptionNoticeType | null]>([
    ['bien avant l’échéance', 90, null],
    ['la veille de la fenêtre', 31, null],
    [
      'au jour exact de la fenêtre',
      30,
      SubscriptionNoticeType.RENEWAL_WINDOW_OPEN,
    ],
    ['dans la fenêtre', 12, SubscriptionNoticeType.RENEWAL_WINDOW_OPEN],
    [
      'au jour exact du dernier rappel',
      7,
      SubscriptionNoticeType.EXPIRING_SOON,
    ],
    ['tout près de la fin', 1, SubscriptionNoticeType.EXPIRING_SOON],
  ])('à %s (J-%s)', (_libelle, jours, attendu) => {
    expect(seuilAtteint(dans(jours), MAINTENANT)?.type ?? null).toBe(attendu);
  });

  // L'ÉCHÉANCE PASSÉE N'EST PLUS UNE ANTICIPATION. Sans ce cas, un abonnement
  // que le balayage n'a pas encore fait expirer recevrait « il reste 7 jours »
  // alors que la date est derrière lui.
  it.each([[0], [-1], [-40]])(
    'ne rend aucun seuil quand l’échéance est passée (J+%s)',
    (jours) => {
      expect(seuilAtteint(dans(jours), MAINTENANT)).toBeNull();
    },
  );

  // LE CAS QUI A MOTIVÉ L'ORDRE DES SEUILS.
  //
  // Mesuré le 2026-08-24 : le balayage n'avait pas tourné depuis treize jours.
  // Un abonnement entré dans la fenêtre pendant ce silence a dépassé les DEUX
  // seuils. Il ne doit en recevoir qu'un — le plus avancé — et non « il reste
  // 30 jours » suivi de « il reste 7 jours » dans la même minute.
  it('après un long silence du balayage, ne retient que le seuil le plus avancé', () => {
    const seuil = seuilAtteint(dans(3), MAINTENANT);

    expect(seuil?.type).toBe(SubscriptionNoticeType.EXPIRING_SOON);
    expect(seuil?.type).not.toBe(SubscriptionNoticeType.RENEWAL_WINDOW_OPEN);
  });

  it('est ordonnée du plus urgent au moins urgent', () => {
    const jours = SEUILS_AVANT_ECHEANCE.map((s) => s.joursAvant);
    expect([...jours]).toEqual([...jours].sort((a, b) => a - b));
  });

  // LA FENÊTRE ANNONCÉE EST LA FENÊTRE RÉELLE. Annoncer l'ouverture un jour où
  // `assertRenouvelable` refuse encore produirait un bouton qui échoue.
  it('annonce l’ouverture au jour où la reconduction devient possible', () => {
    const ouverture = SEUILS_AVANT_ECHEANCE.find(
      (s) => s.type === SubscriptionNoticeType.RENEWAL_WINDOW_OPEN,
    );
    expect(ouverture?.joursAvant).toBe(FENETRE_RENOUVELLEMENT_JOURS);
  });

  // ET LA FENÊTRE AFFICHÉE SUR LE TÉLÉPHONE EST LA MÊME.
  //
  // L'écran de détail annonce une date d'ouverture et n'active le bouton que
  // dans la fenêtre. Il ne peut pas importer la constante de l'API — les deux
  // applications ne partagent aucun module — il la recopie donc. Deux valeurs
  // recopiées finissent toujours par diverger, et la divergence se verrait ici
  // sous la pire forme : un écran qui promet une reconduction que le serveur
  // refuse.
  //
  // Le mobile n'a aucun harnais de test ; la vérification vit donc de ce côté-ci,
  // en lisant le fichier plutôt qu'en l'important.
  it('affiche côté mobile exactement la même fenêtre que le serveur', () => {
    const ecran = join(
      __dirname,
      '..',
      '..',
      '..',
      'mobile',
      'app',
      '(app)',
      'subscriptions',
      '[id].tsx',
    );
    const code = readFileSync(ecran, 'utf8');
    const trouve = /const FENETRE_RENOUVELLEMENT_JOURS = (\d+);/.exec(code);

    // Si la constante est renommée ou déplacée, ce test échoue plutôt que de
    // valider silencieusement une absence de vérification.
    expect(trouve).not.toBeNull();
    expect(Number(trouve![1])).toBe(FENETRE_RENOUVELLEMENT_JOURS);
  });
});

describe('La nature des avis', () => {
  it('classe les cinq types sans exception', () => {
    for (const type of Object.values(SubscriptionNoticeType)) {
      expect(NATURE_DE_L_AVIS[type]).toBeDefined();
      expect(NOTIFICATION_DE_L_AVIS[type]).toBeDefined();
    }
  });

  // C'est cette table qui décide de ce qu'un mineur reçoit. Une erreur ici ne se
  // verrait nulle part ailleurs.
  it('ne tient pour sollicitations que les deux rappels d’échéance', () => {
    const sollicitations = Object.values(SubscriptionNoticeType).filter(
      (t) => NATURE_DE_L_AVIS[t] === NatureDeLAvis.SOLLICITATION,
    );
    expect(sollicitations.sort()).toEqual(
      [
        SubscriptionNoticeType.EXPIRING_SOON,
        SubscriptionNoticeType.RENEWAL_WINDOW_OPEN,
      ].sort(),
    );
  });
});

// ============================================================================
// L'ÉMETTEUR
// ============================================================================
interface Abonnement {
  id: string;
  plan: string;
  currentPeriodEnd: Date | null;
  beneficiaryUserId: string | null;
  beneficiaryOrganizationId: string | null;
  beneficiaryUser: {
    dateOfBirth: Date | null;
    countryOfResidence: string | null;
    status: AccountStatus;
  } | null;
}

const MAJEUR: Abonnement = {
  id: 'sub_1',
  plan: 'CARRIERE_PLUS',
  currentPeriodEnd: dans(5),
  beneficiaryUserId: 'u_1',
  beneficiaryOrganizationId: null,
  beneficiaryUser: {
    dateOfBirth: new Date('1995-01-01'),
    countryOfResidence: 'CM',
    status: AccountStatus.ACTIVE,
  },
};

function monter(
  abonnement: Abonnement | null,
  options: { mineur?: boolean; creationEchoue?: unknown } = {},
) {
  const create = options.creationEchoue
    ? jest.fn().mockRejectedValue(options.creationEchoue)
    : jest.fn().mockResolvedValue({ id: 'notice_1' });

  const prisma = {
    subscription: {
      findUnique: jest.fn().mockResolvedValue(abonnement),
      findMany: jest.fn().mockResolvedValue(abonnement ? [abonnement] : []),
    },
    subscriptionNotice: { create, update: jest.fn().mockResolvedValue({}) },
  };
  const notifications = {
    notifyUser: jest.fn().mockResolvedValue(undefined),
    notifyOrganizationLeadership: jest.fn().mockResolvedValue(undefined),
  };
  const minorPolicy = {
    requiresParentalConsent: jest
      .fn()
      .mockResolvedValue(options.mineur ?? false),
  };

  const service = new SubscriptionNoticesService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
    minorPolicy as unknown as MinorPolicyService,
  );
  return { service, prisma, notifications, minorPolicy };
}

describe('SubscriptionNoticesService', () => {
  // --- Le destinataire -------------------------------------------------------
  it('adresse l’avis à la personne couverte', async () => {
    const { service, notifications } = monter(MAJEUR);

    await service.signalerPaiementConfirme('sub_1', true);

    expect(notifications.notifyUser).toHaveBeenCalledWith(
      'u_1',
      NotificationType.SUBSCRIPTION_ACTIVATED,
      expect.objectContaining({ subscriptionId: 'sub_1' }),
    );
    expect(notifications.notifyOrganizationLeadership).not.toHaveBeenCalled();
  });

  // LE PAYEUR N'EST PAS LE DESTINATAIRE. Dans un parrainage, l'organisation
  // paie mais c'est la personne qui est couverte — et c'est son échéance.
  it('n’écrit jamais au parrain d’un abonnement parrainé', async () => {
    const { service, notifications, prisma } = monter(MAJEUR);

    await service.signalerPaiementConfirme('sub_1', true);

    expect(notifications.notifyUser).toHaveBeenCalledWith(
      'u_1',
      expect.anything(),
      expect.anything(),
    );
    // La requête ne demande même pas l'organisation initiatrice : elle ne peut
    // donc pas servir à choisir un destinataire par inadvertance.
    const [[requete]] = prisma.subscription.findUnique.mock
      .calls as ArgumentsPrisma[];
    expect(requete.select).not.toHaveProperty('initiatingOrganizationId');
  });

  it('adresse l’avis à la direction quand l’organisation est la bénéficiaire', async () => {
    const { service, notifications } = monter({
      ...MAJEUR,
      beneficiaryUserId: null,
      beneficiaryUser: null,
      beneficiaryOrganizationId: 'org_1',
    });

    await service.signalerPaiementConfirme('sub_1', true);

    expect(notifications.notifyOrganizationLeadership).toHaveBeenCalledWith(
      'org_1',
      NotificationType.SUBSCRIPTION_ACTIVATED,
      expect.anything(),
    );
    expect(notifications.notifyUser).not.toHaveBeenCalled();
  });

  // --- Activation ou reconduction -------------------------------------------
  it('distingue une activation d’une reconduction', async () => {
    const premiere = monter(MAJEUR);
    await premiere.service.signalerPaiementConfirme('sub_1', true);
    expect(premiere.notifications.notifyUser).toHaveBeenCalledWith(
      'u_1',
      NotificationType.SUBSCRIPTION_ACTIVATED,
      expect.anything(),
    );

    const suivante = monter(MAJEUR);
    await suivante.service.signalerPaiementConfirme('sub_1', false);
    expect(suivante.notifications.notifyUser).toHaveBeenCalledWith(
      'u_1',
      NotificationType.SUBSCRIPTION_RENEWED,
      expect.anything(),
    );
  });

  // --- Mineurs ---------------------------------------------------------------
  //
  // LA QUALITÉ DE MINEUR EST RECALCULÉE, JAMAIS LUE. Ces tests vérifient que le
  // service passe bien par `requiresParentalConsent` — le champ `isMinor`, écrit
  // à l'inscription et jamais mis à jour, a déjà fait envoyer un message au
  // « représentant légal » d'un adulte de vingt-cinq ans dans ce dépôt.
  it.each([
    [SubscriptionNoticeType.RENEWAL_WINDOW_OPEN, 30],
    [SubscriptionNoticeType.EXPIRING_SOON, 3],
  ])('ne sollicite jamais un mineur (%s)', async (_type, joursRestants) => {
    const { service, notifications, prisma, minorPolicy } = monter(
      { ...MAJEUR, currentPeriodEnd: dans(joursRestants) },
      { mineur: true },
    );

    await service.balayerEcheances(MAINTENANT);

    expect(minorPolicy.requiresParentalConsent).toHaveBeenCalled();
    expect(notifications.notifyUser).not.toHaveBeenCalled();
    // Rien n'est même RÉSERVÉ : une ligne posée sans envoi aurait fermé la
    // période, et le jour de sa majorité l'intéressé n'aurait rien reçu non plus.
    expect(prisma.subscriptionNotice.create).not.toHaveBeenCalled();
  });

  it.each([
    [SubscriptionNoticeType.ACTIVATED, true],
    [SubscriptionNoticeType.RENEWED, false],
  ])('informe un mineur de ce qui le concerne (%s)', async (_t, premiere) => {
    const { service, notifications } = monter(MAJEUR, { mineur: true });

    await service.signalerPaiementConfirme('sub_1', premiere);

    expect(notifications.notifyUser).toHaveBeenCalled();
  });

  it('informe un mineur de la fin de sa couverture', async () => {
    const { service, notifications } = monter(MAJEUR, { mineur: true });

    await service.signalerFinDeCouverture(['sub_1']);

    expect(notifications.notifyUser).toHaveBeenCalledWith(
      'u_1',
      NotificationType.SUBSCRIPTION_COVERAGE_ENDED,
      expect.anything(),
    );
  });

  // Une organisation n'a pas d'âge : interroger la politique mineurs à son sujet
  // n'aurait aucun sens, et un abonnement d'organisation n'a pas de bénéficiaire
  // personne à qui appliquer une règle de consentement.
  it('n’interroge pas la politique mineurs pour une organisation', async () => {
    const { service, minorPolicy } = monter({
      ...MAJEUR,
      currentPeriodEnd: dans(3),
      beneficiaryUserId: null,
      beneficiaryUser: null,
      beneficiaryOrganizationId: 'org_1',
    });

    await service.balayerEcheances(MAINTENANT);

    expect(minorPolicy.requiresParentalConsent).not.toHaveBeenCalled();
  });

  // --- Idempotence -----------------------------------------------------------
  it('n’envoie rien quand la base refuse la réservation', async () => {
    const { service, notifications, prisma } = monter(MAJEUR, {
      creationEchoue: { code: 'P2002' },
    });

    await service.signalerPaiementConfirme('sub_1', true);

    expect(notifications.notifyUser).not.toHaveBeenCalled();
    expect(prisma.subscriptionNotice.update).not.toHaveBeenCalled();
  });

  // Une panne de base n'est pas un doublon : la faire passer pour tel
  // masquerait un incident réel derrière un « déjà envoyé ».
  it('laisse remonter une erreur qui n’est pas un doublon', async () => {
    const { service } = monter(MAJEUR, {
      creationEchoue: { code: 'P1001', message: 'base injoignable' },
    });

    await expect(
      service.signalerPaiementConfirme('sub_1', true),
    ).rejects.toMatchObject({ code: 'P1001' });
  });

  // L'ORDRE EST LA GARANTIE. Réserver AVANT d'envoyer est ce qui empêche deux
  // exécutions concurrentes d'envoyer toutes les deux ; confirmer APRÈS est ce
  // qui rend un avis perdu visible plutôt que silencieux.
  it('réserve, puis envoie, puis confirme', async () => {
    const ordre: string[] = [];
    const { service, prisma, notifications } = monter(MAJEUR);
    prisma.subscriptionNotice.create.mockImplementation(() => {
      ordre.push('reserve');
      return Promise.resolve({ id: 'notice_1' });
    });
    notifications.notifyUser.mockImplementation(() => {
      ordre.push('envoie');
      return Promise.resolve();
    });
    prisma.subscriptionNotice.update.mockImplementation(() => {
      ordre.push('confirme');
      return Promise.resolve({});
    });

    await service.signalerPaiementConfirme('sub_1', true);

    expect(ordre).toEqual(['reserve', 'envoie', 'confirme']);
  });

  // LA PÉRIODE EST LA CLÉ. C'est ce qui fait qu'une reconduction rouvre
  // naturellement le droit à un nouvel avis, sans remise à zéro.
  it('réserve l’avis sur la période en cours', async () => {
    const { service, prisma } = monter(MAJEUR);

    await service.signalerPaiementConfirme('sub_1', true);

    const [[appel]] = prisma.subscriptionNotice.create.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    // Égalité EXACTE et non `objectContaining` : la clé d'idempotence est faite
    // de ces trois champs et d'eux seuls. Un quatrième qui s'y glisserait
    // changerait la clé sans que personne ne s'en aperçoive.
    expect(appel.data).toEqual({
      subscriptionId: 'sub_1',
      type: SubscriptionNoticeType.ACTIVATED,
      periodEnd: MAJEUR.currentPeriodEnd,
    });
  });

  // --- Ce que le service ne fait jamais --------------------------------------
  it('n’écrit aucun statut d’abonnement', async () => {
    const { service, prisma } = monter(MAJEUR);

    await service.signalerPaiementConfirme('sub_1', true);
    await service.signalerFinDeCouverture(['sub_1']);
    await service.balayerEcheances(MAINTENANT);

    // Le double n'expose même pas `subscription.update` : un appel lèverait.
    expect(prisma.subscription).not.toHaveProperty('update');
    expect(prisma.subscription).not.toHaveProperty('updateMany');
  });

  it('ne balaie que des abonnements actifs ayant une période', async () => {
    const { service, prisma } = monter(MAJEUR);

    await service.balayerEcheances(MAINTENANT);

    const [[requete]] = prisma.subscription.findMany.mock
      .calls as ArgumentsPrisma[];
    expect(requete.where?.status).toBe('ACTIVE');
    // ONE_TIME a `currentPeriodEnd` nul : le filtre l'écarte à la source.
    expect(requete.where?.currentPeriodEnd).toMatchObject({ not: null });
  });
});
