import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  AccountStatus,
  GuardianChangeStatus,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CountryPolicyService } from './country-policy.service';
import type { MinorPolicyService } from './minor-policy.service';
import { ParentalConsentService } from './parental-consent.service';

// ============================================================================
// LE CYCLE DE REFUS, JOUÉ COMME UN PARCOURS
//
// Les tests du fichier voisin vérifient chaque règle isolément. Ceux-ci jouent
// des SUITES D'ÉVÉNEMENTS et regardent ce que le système fait ensuite —
// demander, refuser, attendre, redemander, changer de tuteur, atteindre la
// majorité.
//
// C'est la seule façon de tenir les garanties qui portent sur un ENCHAÎNEMENT
// et non sur un appel : « une approbation ne sert qu'une fois », « le compteur
// ne redescend jamais », « l'ancien tuteur reste inatteignable ». Aucune de ces
// trois-là n'est observable sur un appel isolé.
//
// PAS DE DOUBLE DE BASE DE DONNÉES GÉNÉRIQUE : un monde en mémoire, minuscule,
// qui garde l'état entre les appels. Un mock qui rend toujours la même chose ne
// peut pas montrer qu'un compteur progresse.
// ============================================================================

const TUTEUR = '+237690001111';
const TUTEUR_AUTRE_ECRITURE = '+237 690 00 11 11';
const NOUVEAU_TUTEUR = '+237690002222';
const MINEUR = '+237690009999';
const CODE = '123456';

const hache = (c: string) => createHash('sha256').update(c).digest('hex');

// --- Le monde -----------------------------------------------------------------
type Lien = {
  id: string;
  childId: string;
  parentPhone: string;
  parentPhoneNormalized: string;
  status: ParentalLinkStatus;
  consentCodeHash: string | null;
  consentExpiresAt: Date | null;
  consentAttempts: number;
  maxConsentAttempts: number;
  declinedAt: Date | null;
  confirmedAt: Date | null;
  flaggedAt: Date | null;
  lastConsentSentAt: Date | null;
  parentId: string | null;
  createdAt: Date;
};

type Autorisation = {
  id: string;
  childId: string;
  requestedParentPhoneNormalized: string;
  status: GuardianChangeStatus;
  consumedAt: Date | null;
  decidedAt: Date | null;
};

function creerMonde() {
  // L'ÉTAT D'ÂGE VIT HORS DE LA FERMETURE, et pas sur l'objet rendu.
  //
  // Le lire depuis `monde.majeur` obligerait les doubles à référencer un objet
  // défini plus bas : TypeScript retombe alors en `any` sur tout le monde, et
  // le fichier entier cesse d'être vérifié — exactement ce qu'un test typé doit
  // éviter.
  const etat = { majeur: false };

  const compte = {
    id: 'mineur_1',
    phone: MINEUR,
    firstName: 'Awa',
    status: AccountStatus.AWAITING_PARENTAL_CONSENT as AccountStatus,
    dateOfBirth: new Date('2010-01-01'),
    countryOfResidence: 'CM',
    parentalRefusalCount: 0,
    lastParentalRefusalAt: null as Date | null,
    parentalRequestBlockedUntil: null as Date | null,
  };
  const liens: Lien[] = [];
  const autorisations: Autorisation[] = [];
  const smsEnvoyes: { to: string; body: string }[] = [];
  const journal: { action: string; meta: Record<string, unknown> }[] = [];

  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ ...compte })),
      findUnique: jest.fn(() => Promise.resolve({ ...compte })),
      update: jest.fn((a: { data: Partial<typeof compte> }) => {
        Object.assign(compte, a.data);
        return Promise.resolve({ ...compte });
      }),
    },
    parentalLink: {
      findUnique: jest.fn((a: { where: Record<string, unknown> }) => {
        const w = a.where as {
          id?: string;
          childId_parentPhoneNormalized?: { parentPhoneNormalized: string };
        };
        if (w.id)
          return Promise.resolve(liens.find((l) => l.id === w.id) ?? null);
        const p = w.childId_parentPhoneNormalized!.parentPhoneNormalized;
        return Promise.resolve(
          liens.find((l) => l.parentPhoneNormalized === p) ?? null,
        );
      }),
      findMany: jest.fn((a?: { where?: { status?: ParentalLinkStatus } }) =>
        Promise.resolve(
          a?.where?.status
            ? liens.filter((l) => l.status === a.where!.status)
            : [...liens],
        ),
      ),
      create: jest.fn((a: { data: Partial<Lien> }) => {
        const l: Lien = {
          id: `lien_${liens.length + 1}`,
          childId: compte.id,
          status: ParentalLinkStatus.PENDING,
          consentAttempts: 0,
          maxConsentAttempts: 5,
          declinedAt: null,
          confirmedAt: null,
          flaggedAt: null,
          parentId: null,
          createdAt: new Date(),
          consentCodeHash: null,
          consentExpiresAt: null,
          lastConsentSentAt: null,
          parentPhone: '',
          parentPhoneNormalized: '',
          ...a.data,
        };
        liens.push(l);
        return Promise.resolve(l);
      }),
      update: jest.fn((a: { where: { id: string }; data: Partial<Lien> }) => {
        const l = liens.find((x) => x.id === a.where.id)!;
        Object.assign(l, a.data);
        return Promise.resolve(l);
      }),
    },
    guardianChangeRequest: {
      findFirst: jest.fn(
        (a: {
          where: {
            requestedParentPhoneNormalized: string;
            status: GuardianChangeStatus;
            consumedAt: null;
          };
        }) =>
          Promise.resolve(
            autorisations.find(
              (x) =>
                x.requestedParentPhoneNormalized ===
                  a.where.requestedParentPhoneNormalized &&
                x.status === a.where.status &&
                x.consumedAt === null,
            ) ?? null,
          ),
      ),
      update: jest.fn(
        (a: { where: { id: string }; data: { consumedAt: Date } }) => {
          const x = autorisations.find((y) => y.id === a.where.id)!;
          x.consumedAt = a.data.consumedAt;
          return Promise.resolve(x);
        },
      ),
    },
  };

  const service = new ParentalConsentService(
    prisma as unknown as PrismaService,
    new ConfigService({ PARENTAL_CONSENT_RESEND_COOLDOWN_MINUTES: '0' }),
    {
      send: jest.fn((to: string, body: string) => {
        smsEnvoyes.push({ to, body });
        return Promise.resolve();
      }),
    },
    {
      record: jest.fn((action: string, _id: string, meta = {}) => {
        journal.push({ action, meta: meta as Record<string, unknown> });
        return Promise.resolve();
      }),
    } as unknown as AuditService,
    {
      // Le palier est RECALCULÉ à chaque appel, comme en production : c'est ce
      // qui permet de faire basculer le monde à la majorité en cours de scénario.
      requiresParentalConsent: jest.fn(() => Promise.resolve(!etat.majeur)),
    } as unknown as MinorPolicyService,
    {
      resolve: jest.fn(() =>
        Promise.resolve({
          refusalDelay1Days: 7,
          refusalDelay2Days: 30,
          refusalDelayFinalDays: 182,
        }),
      ),
    } as unknown as CountryPolicyService,
  );

  // Le lien en attente pour ce numéro. Retrouvé plutôt que supposé : un test
  // qui devine l'identifiant ne prouve pas que le parcours fonctionne.
  function lienEnAttente(numeroNormalise: string) {
    const l = liens.find(
      (x) =>
        x.parentPhoneNormalized === numeroNormalise &&
        x.status === ParentalLinkStatus.PENDING,
    );
    if (!l) throw new Error(`aucun lien en attente pour ${numeroNormalise}`);
    return l;
  }

  const monde = {
    compte,
    liens,
    autorisations,
    smsEnvoyes,
    journal,
    service,

    devenirMajeur() {
      etat.majeur = true;
    },

    refuser: (numeroNormalise = TUTEUR) =>
      service.declineConsent(lienEnAttente(numeroNormalise).id, CODE),
    accepter: (numeroNormalise = TUTEUR) =>
      service.confirmConsent(lienEnAttente(numeroNormalise).id, CODE),

    // Un administrateur approuve un changement vers ce numéro.
    approuverChangement(versNormalise: string) {
      autorisations.push({
        id: `autor_${autorisations.length + 1}`,
        childId: compte.id,
        requestedParentPhoneNormalized: versNormalise,
        status: GuardianChangeStatus.APPROVED,
        consumedAt: null,
        decidedAt: new Date(),
      });
    },

    // Le temps passe : on recule la date de blocage plutôt que d'attendre.
    avancerApresBlocage() {
      compte.parentalRequestBlockedUntil = new Date(Date.now() - 1000);
    },

    actions: () => journal.map((e) => e.action),
  };

  // Le code du SMS n'est pas connu du test : on force celui des liens créés à
  // une valeur connue, exactement comme le service l'aurait haché.
  const creerOriginal = prisma.parentalLink.create;
  prisma.parentalLink.create = jest.fn((a: { data: Partial<Lien> }) =>
    creerOriginal({ data: { ...a.data, consentCodeHash: hache(CODE) } }),
  );
  const majOriginal = prisma.parentalLink.update;
  prisma.parentalLink.update = jest.fn(
    (a: { where: { id: string }; data: Partial<Lien> }) =>
      majOriginal({
        where: a.where,
        data:
          'consentCodeHash' in a.data && a.data.consentCodeHash !== null
            ? { ...a.data, consentCodeHash: hache(CODE) }
            : a.data,
      }),
  );

  return monde;
}

describe('Cycle de refus — scénarios de bout en bout', () => {
  // --------------------------------------------------------------------------
  describe('aucun refus', () => {
    it('laisse demander librement et ne bloque rien', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);

      expect(m.smsEnvoyes).toHaveLength(1);
      expect(m.compte.parentalRefusalCount).toBe(0);
      expect(m.compte.parentalRequestBlockedUntil).toBeNull();

      const vue = await m.service.listForChild(m.compte.id);
      expect(vue.refusal).toMatchObject({ count: 0, canRequestNow: true });
      expect(vue.refusal.blockedUntil).toBeNull();
      expect(vue.links).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  describe('premier refus', () => {
    it('bloque sept jours, garde le compte connectable, et le dit dans listForChild', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);
      await m.refuser();

      expect(m.compte.parentalRefusalCount).toBe(1);
      expect(m.compte.status).toBe(AccountStatus.AWAITING_PARENTAL_CONSENT);

      const jours =
        (m.compte.parentalRequestBlockedUntil!.getTime() - Date.now()) /
        86_400_000;
      expect(jours).toBeCloseTo(7, 1);

      // COHÉRENCE : ce que le compte porte et ce que l'écran reçoit doivent
      // raconter la même chose. Le second est calculé par le serveur, pas par
      // le téléphone.
      const vue = await m.service.listForChild(m.compte.id);
      expect(vue.refusal.count).toBe(1);
      expect(vue.refusal.canRequestNow).toBe(false);
      expect(vue.refusal.blockedUntil).toEqual(
        m.compte.parentalRequestBlockedUntil,
      );
    });

    it('refuse une nouvelle demande au même numéro pendant le délai', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);
      await m.refuser();
      const envoyesAvant = m.smsEnvoyes.length;

      await expect(
        m.service.requestConsent(m.compte.id, TUTEUR),
      ).rejects.toBeInstanceOf(ConflictException);

      // AUCUN SMS : c'est tout l'objet du dispositif. Le parent qui a refusé
      // n'est pas resollicité.
      expect(m.smsEnvoyes).toHaveLength(envoyesAvant);
      expect(m.actions()).toContain('PARENTAL_CONSENT_REQUEST_BLOCKED');
    });

    it('refuse aussi une variation d’écriture du même numéro', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);
      await m.refuser();

      // Sur la forme brute, cette saisie était une clef DIFFÉRENTE et
      // contournait le blocage, le compteur et la détection de changement.
      await expect(
        m.service.requestConsent(m.compte.id, TUTEUR_AUTRE_ECRITURE),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuse un numéro quelconque pendant le délai, pas seulement celui qui a refusé', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);
      await m.refuser();

      // Le blocage porte sur le COMPTE. Sans cela, désigner n'importe quel
      // autre adulte suffirait à repartir immédiatement.
      await expect(
        m.service.requestConsent(m.compte.id, NOUVEAU_TUTEUR),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // --------------------------------------------------------------------------
  describe('délai expiré', () => {
    it('laisse redemander, sans effacer le compteur', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);
      await m.refuser();
      m.avancerApresBlocage();

      await m.service.requestConsent(m.compte.id, TUTEUR);

      expect(m.smsEnvoyes).toHaveLength(2);
      // LE COMPTEUR SURVIT au délai écoulé : c'est lui qui rendra le prochain
      // refus plus coûteux.
      expect(m.compte.parentalRefusalCount).toBe(1);

      const vue = await m.service.listForChild(m.compte.id);
      expect(vue.refusal).toMatchObject({ count: 1, canRequestNow: true });
    });

    it('dit au tuteur qu’il s’agit d’une nouvelle demande après son refus', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);
      await m.refuser();
      m.avancerApresBlocage();
      await m.service.requestConsent(m.compte.id, TUTEUR);

      // Un parent qui reçoit le même message qu'il y a une semaine, sans
      // contexte, croit à un bogue — ou à un contournement.
      expect(m.smsEnvoyes[1].body).toContain('à nouveau');
      expect(m.smsEnvoyes[1].body).toContain('refusé');
    });
  });

  // --------------------------------------------------------------------------
  describe('refus successifs', () => {
    it('fait croître le délai : 7 jours, puis 30, puis 182 réarmés', async () => {
      const m = creerMonde();
      const attendus = [7, 30, 182, 182];

      for (const attendu of attendus) {
        m.compte.parentalRequestBlockedUntil = null;
        await m.service.requestConsent(m.compte.id, TUTEUR);
        await m.refuser();

        const jours =
          (m.compte.parentalRequestBlockedUntil!.getTime() - Date.now()) /
          86_400_000;
        expect(jours).toBeCloseTo(attendu, 1);
      }

      expect(m.compte.parentalRefusalCount).toBe(4);
    });
  });

  // --------------------------------------------------------------------------
  // LE CŒUR DE LA CORRECTION DU 2026-08-09
  // --------------------------------------------------------------------------
  describe('changement de tuteur approuvé', () => {
    async function refuseEtApprouve() {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);
      await m.refuser();
      m.approuverChangement(NOUVEAU_TUTEUR);
      return m;
    }

    it('laisse solliciter le NOUVEAU tuteur malgré le délai en cours', async () => {
      const m = await refuseEtApprouve();

      await m.service.requestConsent(m.compte.id, NOUVEAU_TUTEUR);

      expect(m.smsEnvoyes[1].to).toBe(NOUVEAU_TUTEUR);
      expect(m.actions()).toContain(
        'PARENTAL_CONSENT_REQUESTED_UNDER_AUTHORIZATION',
      );
    });

    it('ne lève JAMAIS le blocage : l’ancien tuteur reste inatteignable', async () => {
      const m = await refuseEtApprouve();

      // C'EST LA FAILLE CORRIGÉE. L'approbation remettait
      // `parentalRequestBlockedUntil` à NULL : l'administrateur croyait
      // autoriser un changement de tuteur, et rouvrait la porte à celui qui
      // venait de refuser.
      expect(m.compte.parentalRequestBlockedUntil).not.toBeNull();
      await expect(
        m.service.requestConsent(m.compte.id, TUTEUR),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('ne vaut pas pour un troisième numéro que personne n’a approuvé', async () => {
      const m = await refuseEtApprouve();

      // Le contournement explicitement visé : obtenir une approbation pour un
      // numéro, puis en soumettre un autre.
      await expect(
        m.service.requestConsent(m.compte.id, '+237690003333'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reconnaît le numéro approuvé écrit autrement', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);
      await m.refuser();
      m.approuverChangement('+237690002222');

      // L'autorisation est indexée sur la forme canonique : une variation
      // d'espacement ne doit pas faire perdre au mineur un droit que
      // l'administration lui a accordé.
      await m.service.requestConsent(m.compte.id, '+237 690 00 22 22');
      expect(m.smsEnvoyes[1].to).toBe(NOUVEAU_TUTEUR);
    });

    it('laisse relancer le nouveau tuteur tant qu’il n’a pas répondu', async () => {
      const m = await refuseEtApprouve();
      await m.service.requestConsent(m.compte.id, NOUVEAU_TUTEUR);

      // Consommée au premier envoi, l'autorisation enfermerait le mineur dès
      // qu'un SMS se perd. Elle vaut « droit d'obtenir une décision ».
      await m.service.requestConsent(m.compte.id, NOUVEAU_TUTEUR);
      expect(m.smsEnvoyes).toHaveLength(3);
      expect(m.autorisations[0].consumedAt).toBeNull();
    });

    it('éteint l’autorisation quand le nouveau tuteur refuse, et rebloque tout', async () => {
      const m = await refuseEtApprouve();
      await m.service.requestConsent(m.compte.id, NOUVEAU_TUTEUR);
      await m.refuser(NOUVEAU_TUTEUR);

      expect(m.compte.parentalRefusalCount).toBe(2);
      expect(m.autorisations[0].consumedAt).not.toBeNull();
      expect(m.actions()).toContain('GUARDIAN_CHANGE_AUTHORIZATION_CONSUMED');

      // Plus aucune exception vivante : il faut repasser devant un
      // administrateur. L'approbation ne s'use donc jamais en droit de
      // contournement répétable.
      await expect(
        m.service.requestConsent(m.compte.id, NOUVEAU_TUTEUR),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('éteint aussi l’autorisation quand le nouveau tuteur accepte', async () => {
      const m = await refuseEtApprouve();
      await m.service.requestConsent(m.compte.id, NOUVEAU_TUTEUR);
      await m.accepter(NOUVEAU_TUTEUR);

      expect(m.compte.status).toBe(AccountStatus.ACTIVE);
      expect(m.autorisations[0].consumedAt).not.toBeNull();
      // L'acceptation ne remet pas le compteur à zéro : l'historique reste.
      expect(m.compte.parentalRefusalCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  describe('majorité atteinte', () => {
    it('refuse une nouvelle demande de consentement', async () => {
      const m = creerMonde();
      m.devenirMajeur();
      await expect(
        m.service.requestConsent(m.compte.id, TUTEUR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse un refus parental tardif, et ne touche pas au cycle', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);

      // L'anniversaire tombe entre la demande et la réponse du parent.
      m.devenirMajeur();

      await expect(m.refuser()).rejects.toBeInstanceOf(BadRequestException);

      // RIEN n'a bougé : ni le compteur, ni le blocage, ni le lien.
      expect(m.compte.parentalRefusalCount).toBe(0);
      expect(m.compte.parentalRequestBlockedUntil).toBeNull();
      expect(m.compte.lastParentalRefusalAt).toBeNull();
      expect(m.liens[0].status).toBe(ParentalLinkStatus.PENDING);
      expect(m.actions()).not.toContain('PARENTAL_CONSENT_DECLINED');
    });

    it('laisse le compteur acquis intact — il devient inerte, pas effacé', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);
      await m.refuser();
      m.devenirMajeur();

      const vue = await m.service.listForChild(m.compte.id);
      // L'historique reste lisible : c'est le journal du compte, pas une
      // sanction en cours.
      expect(vue.refusal.count).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  describe('cohérence listForChild / canRequestNow', () => {
    it('canRequestNow prédit exactement ce que requestConsent accepte', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);
      await m.refuser();

      // Pendant le blocage : l'écran annonce non, le service refuse.
      let vue = await m.service.listForChild(m.compte.id);
      expect(vue.refusal.canRequestNow).toBe(false);
      await expect(
        m.service.requestConsent(m.compte.id, TUTEUR),
      ).rejects.toBeInstanceOf(ConflictException);

      // Après le délai : l'écran annonce oui, le service accepte.
      m.avancerApresBlocage();
      vue = await m.service.listForChild(m.compte.id);
      expect(vue.refusal.canRequestNow).toBe(true);
      await expect(
        m.service.requestConsent(m.compte.id, TUTEUR),
      ).resolves.toBeDefined();
    });

    it('expose declinedAt et le statut du lien après un refus', async () => {
      const m = creerMonde();
      await m.service.requestConsent(m.compte.id, TUTEUR);
      await m.refuser();

      const vue = await m.service.listForChild(m.compte.id);
      expect(vue.links[0].status).toBe(ParentalLinkStatus.DECLINED);
      // Sans `declinedAt`, l'écran ne distingue pas un refus d'un silence.
      expect(vue.links[0].declinedAt).not.toBeNull();
    });
  });
});
