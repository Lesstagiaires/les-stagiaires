import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  Language,
  MinorGatedAction,
  Sex,
  UserIntent,
  UserPath,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { createTemporaryPostgres } from '../test-support/temporary-postgres';
import { AuthService } from './auth.service';
import { CountryPolicyService } from './country-policy.service';
import { MemoryLoginThrottle } from './login-throttle/memory-login-throttle';
import { MinorPolicyService } from './minor-policy.service';
import { OtpService } from './otp.service';
import { ParentalConsentService } from './parental-consent.service';
import { TokenService } from './token.service';

// ============================================================================
// V6-1 — INTENTION INITIALE ET PARCOURS, SUR UNE BASE RÉELLE
//
// POURQUOI UNE BASE RÉELLE PLUTÔT QUE DES DOUBLES. Trois propriétés ne se
// prouvent qu'avec de vraies écritures :
//
//   1. LA TABLE DE DÉRIVATION. Le rôle attribué dépend d'une recherche en base
//      filtrée sur `selfAssignable`. Un double répondrait ce qu'on lui dicte ;
//      seule une vraie table de rôles montre ce qui est réellement attribué —
//      et notamment qu'aucune intention n'atteint ADMIN.
//   2. L'IMMUABILITÉ de `initialIntent` : elle se constate en relisant la
//      colonne après des transitions successives.
//   3. LA JOURNALISATION, qui vit dans une table protégée par un déclencheur
//      d'ajout seul.
//
// L'invariant « aucune décision d'autorisation ne lit le parcours » est éprouvé
// ailleurs, par lecture de source : `parcours-non-lu-ailleurs.spec.ts`.
//
// LA BASE EST JETABLE : la base de développement n'est jamais écrite.
// ============================================================================

const BASE_JETABLE = 'stagiaires_it_v6_parcours';

describe('V6-1 : intention et parcours (base réelle)', () => {
  let prisma: PrismaService;
  let database: Awaited<ReturnType<typeof createTemporaryPostgres>>;
  let auth: AuthService;
  let minorPolicy: MinorPolicyService;
  let compteur = 0;

  beforeAll(async () => {
    database = await createTemporaryPostgres(BASE_JETABLE);
    prisma = database.prisma;

    const config = new ConfigService({
      OTP_TTL_MINUTES: '10',
      OTP_RESEND_COOLDOWN_SECONDS: '60',
      PARENTAL_CONSENT_RESEND_COOLDOWN_MINUTES: '0',
      JWT_ACCESS_SECRET: 'secret-de-test-access-suffisamment-long-0123456789',
      JWT_REFRESH_SECRET: 'secret-de-test-refresh-suffisamment-long-0123456789',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '30d',
      LOCKOUT_MAX_ATTEMPTS: '5',
      LOCKOUT_DURATION_MINUTES: '15',
      LS_ID_COUNTRY_CODE: 'CM',
      PARENTAL_CONSENT_TTL_HOURS: '72',
      APP_PUBLIC_URL: 'https://recette.exemple.org',
    });

    const faux = { send: () => Promise.resolve() };
    const audit = new AuditService(prisma);
    const otp = new OtpService(prisma, config, faux);
    const pays = new CountryPolicyService(prisma, audit);
    minorPolicy = new MinorPolicyService(prisma, pays);
    const consent = new ParentalConsentService(
      prisma,
      config,
      faux,
      audit,
      minorPolicy,
      pays,
    );
    const tokens = new TokenService(new JwtService(), config, prisma);

    auth = new AuthService(
      prisma,
      config,
      otp,
      tokens,
      audit,
      consent,
      { attributeUser: () => Promise.resolve(null) } as never,
      minorPolicy,
      faux,
      new MemoryLoginThrottle(),
    );

    // LES RÔLES DU CATALOGUE. Le seed n'est pas joué sur une base jetable : sans
    // eux, la dérivation ne trouverait aucun rôle et les assertions seraient
    // vraies pour la mauvaise raison. ADMIN est créé AVEC `selfAssignable:
    // false`, exactement comme au seed — c'est lui que le test de RBAC doit
    // pouvoir échouer à obtenir.
    for (const [name, selfAssignable] of [
      ['JEUNE', true],
      ['ENTREPRISE', true],
      ['ETABLISSEMENT', true],
      ['PARENT', true],
      ['ADMIN', false],
    ] as const) {
      await prisma.role.create({ data: { name, selfAssignable } });
    }

    // La politique du Cameroun, dont dépend le contrôle mineur.
    await prisma.countryPolicy.upsert({
      where: { countryCode: 'CM' },
      update: {},
      create: {
        countryCode: 'CM',
        minInternshipAge: 14,
        minParentRequiredAge: 14,
        civilMajorityAge: 18,
        parentalInfoMaxAge: 21,
        refusalDelay1Days: 7,
        refusalDelay2Days: 30,
        refusalDelayFinalDays: 182,
        gatedActions: [
          MinorGatedAction.REGISTRATION,
          MinorGatedAction.APPLICATION_SUBMIT,
          MinorGatedAction.SIGN_CONVENTION,
        ],
      },
    });
  }, 180_000);

  afterAll(async () => {
    try {
      // Prisma est la seule ressource spécifique de cette spec.
    } finally {
      await database?.close();
    }
  }, 60_000);

  function inscription(overrides: {
    initialIntent?: UserIntent;
    ageAns?: number;
  }) {
    const naissance = new Date();
    naissance.setFullYear(naissance.getFullYear() - (overrides.ageAns ?? 25));
    compteur += 1;
    return {
      firstName: 'Test',
      lastName: `Compte${compteur}`,
      sex: Sex.FEMALE,
      phone: `+2376900${String(10000 + compteur).slice(-5)}`,
      cityOfResidence: 'Douala',
      countryOfResidence: 'CM',
      password: 'MotDePasseSolide1',
      language: Language.FR,
      dateOfBirth: naissance.toISOString(),
      // Exigé par le moteur de règles dès que l'âge déclaré, croisé avec la
      // politique du pays, place le compte sous accord parental. Le fournir ici
      // ne relâche rien : c'est ce que ferait un vrai mineur à l'inscription.
      parentPhone: (overrides.ageAns ?? 25) < 18 ? '+237690099999' : undefined,
      initialIntent: overrides.initialIntent,
    };
  }

  async function inscrire(overrides: {
    initialIntent?: UserIntent;
    ageAns?: number;
  }) {
    const resultat = await auth.register(inscription(overrides));
    const userId = (resultat as { userId: string }).userId;
    return userId;
  }

  async function etat(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { initialIntent: true, currentPath: true },
    });
    const roles = await prisma.userRole.findMany({
      where: { userId },
      include: { role: { select: { name: true } } },
    });
    return {
      initialIntent: user.initialIntent,
      currentPath: user.currentPath,
      roles: roles.map((r) => r.role.name).sort(),
    };
  }

  // ==========================================================================
  // A. LA TABLE DE DÉRIVATION NORMATIVE, LIGNE PAR LIGNE
  // ==========================================================================
  describe('table de dérivation', () => {
    it('sans intention : aucun rôle, aucun parcours', async () => {
      const id = await inscrire({});
      expect(await etat(id)).toEqual({
        initialIntent: null,
        currentPath: null,
        roles: [],
      });
    }, 60_000);

    it('ACADEMIC_INTERNSHIP_SEARCH → JEUNE + ACADEMIC', async () => {
      const id = await inscrire({
        initialIntent: UserIntent.ACADEMIC_INTERNSHIP_SEARCH,
      });
      expect(await etat(id)).toEqual({
        initialIntent: UserIntent.ACADEMIC_INTERNSHIP_SEARCH,
        currentPath: UserPath.ACADEMIC,
        roles: ['JEUNE'],
      });
    }, 60_000);

    it('PROFESSIONAL_INTERNSHIP_SEARCH → JEUNE + PROFESSIONAL', async () => {
      const id = await inscrire({
        initialIntent: UserIntent.PROFESSIONAL_INTERNSHIP_SEARCH,
      });
      expect(await etat(id)).toEqual({
        initialIntent: UserIntent.PROFESSIONAL_INTERNSHIP_SEARCH,
        currentPath: UserPath.PROFESSIONAL,
        roles: ['JEUNE'],
      });
    }, 60_000);

    it('ORGANIZATION → ENTREPRISE, sans parcours', async () => {
      const id = await inscrire({ initialIntent: UserIntent.ORGANIZATION });
      expect(await etat(id)).toEqual({
        initialIntent: UserIntent.ORGANIZATION,
        currentPath: null,
        roles: ['ENTREPRISE'],
      });
    }, 60_000);

    it('ESTABLISHMENT → ETABLISSEMENT, sans parcours', async () => {
      const id = await inscrire({ initialIntent: UserIntent.ESTABLISHMENT });
      expect(await etat(id)).toEqual({
        initialIntent: UserIntent.ESTABLISHMENT,
        currentPath: null,
        roles: ['ETABLISSEMENT'],
      });
    }, 60_000);

    it('GUARDIAN → PARENT, sans parcours', async () => {
      const id = await inscrire({ initialIntent: UserIntent.GUARDIAN });
      expect(await etat(id)).toEqual({
        initialIntent: UserIntent.GUARDIAN,
        currentPath: null,
        roles: ['PARENT'],
      });
    }, 60_000);

    // Devenir ambassadeur n'est pas une étape de carrière de stagiaire : le
    // compte créé est celui d'une personne physique, le dossier viendra après.
    it('AMBASSADOR → JEUNE, sans parcours', async () => {
      const id = await inscrire({ initialIntent: UserIntent.AMBASSADOR });
      expect(await etat(id)).toEqual({
        initialIntent: UserIntent.AMBASSADOR,
        currentPath: null,
        roles: ['JEUNE'],
      });
    }, 60_000);
  });

  // ==========================================================================
  // B. RBAC — L'INTENTION N'EST PAS UN CHEMIN D'ÉLÉVATION
  // ==========================================================================
  it('aucune intention n’attribue jamais ADMIN', async () => {
    for (const intention of Object.values(UserIntent)) {
      const id = await inscrire({ initialIntent: intention });
      const { roles } = await etat(id);
      expect(roles).not.toContain('ADMIN');
    }

    // Et personne n'a obtenu ADMIN par un autre chemin pendant ce test.
    const admins = await prisma.userRole.count({
      where: { role: { name: 'ADMIN' } },
    });
    expect(admins).toBe(0);
  }, 120_000);

  // ==========================================================================
  // C. LE PARCOURS EST ÉVOLUTIF, SANS ORDRE IMPOSÉ
  // ==========================================================================
  it('accepte les huit transitions, dans les deux sens', async () => {
    const id = await inscrire({});

    const chemin: UserPath[] = [
      UserPath.ACADEMIC,
      UserPath.PROFESSIONAL,
      UserPath.EMPLOYMENT,
      UserPath.PROFESSIONAL,
      UserPath.ACADEMIC,
      UserPath.EMPLOYMENT,
      UserPath.ACADEMIC,
      UserPath.PROFESSIONAL,
    ];

    for (const etape of chemin) {
      const r = await auth.setMyPath(id, etape);
      expect(r.currentPath).toBe(etape);
    }

    const journal = await prisma.auditLog.findMany({
      where: { action: 'USER_PATH_CHANGED', userId: id },
    });
    // Huit déclarations, huit transitions réelles, huit lignes de journal.
    expect(journal).toHaveLength(chemin.length);
  }, 120_000);

  it('ne journalise pas une déclaration identique', async () => {
    const id = await inscrire({
      initialIntent: UserIntent.ACADEMIC_INTERNSHIP_SEARCH,
    });

    const r = await auth.setMyPath(id, UserPath.ACADEMIC);
    expect(r.changed).toBe(false);

    const journal = await prisma.auditLog.count({
      where: { action: 'USER_PATH_CHANGED', userId: id },
    });
    expect(journal).toBe(0);
  }, 60_000);

  // ==========================================================================
  // D. `initialIntent` EST UNE PHOTOGRAPHIE
  // ==========================================================================
  it('l’intention initiale survit à toutes les transitions', async () => {
    const id = await inscrire({
      initialIntent: UserIntent.ACADEMIC_INTERNSHIP_SEARCH,
    });

    await auth.setMyPath(id, UserPath.PROFESSIONAL);
    await auth.setMyPath(id, UserPath.EMPLOYMENT);

    const apres = await etat(id);
    expect(apres.initialIntent).toBe(UserIntent.ACADEMIC_INTERNSHIP_SEARCH);
    expect(apres.currentPath).toBe(UserPath.EMPLOYMENT);
  }, 60_000);

  // ==========================================================================
  // E. LE PARCOURS APPARTIENT À SON TITULAIRE
  // ==========================================================================
  // `setMyPath` ne reçoit QUE l'identifiant du porteur du jeton : il n'existe
  // aucun paramètre de cible, donc aucun chemin — même mal contrôlé — par lequel
  // un recruteur, un établissement, un ambassadeur ou un tuteur pourrait écrire
  // le parcours d'autrui. Ce test constate l'effet de cette absence.
  it('modifier son parcours ne touche celui de personne d’autre', async () => {
    const entreprise = await inscrire({
      initialIntent: UserIntent.ORGANIZATION,
    });
    const jeune = await inscrire({
      initialIntent: UserIntent.ACADEMIC_INTERNSHIP_SEARCH,
    });

    await auth.setMyPath(entreprise, UserPath.PROFESSIONAL);

    // Le titulaire dont le rôle actif est ENTREPRISE a bien pu déclarer son
    // propre parcours : le multi-rôles n'empêche jamais quelqu'un de dire où il
    // en est (gouvernance V6, §5).
    expect((await etat(entreprise)).currentPath).toBe(UserPath.PROFESSIONAL);
    // Et le parcours du jeune n'a pas bougé d'un pouce.
    expect((await etat(jeune)).currentPath).toBe(UserPath.ACADEMIC);
  }, 60_000);

  // ==========================================================================
  // F. MINEURS — DÉCLARER N'EST PAS DÉVERROUILLER
  // ==========================================================================
  it('un mineur peut déclarer PROFESSIONAL sans qu’aucune protection ne cède', async () => {
    const id = await inscrire({ ageAns: 15 });

    const avant = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(avant.isMinor).toBe(true);

    await auth.setMyPath(id, UserPath.PROFESSIONAL);

    const apres = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(apres.currentPath).toBe(UserPath.PROFESSIONAL);

    // LE CŒUR DU TEST : l'action gardée reste gardée. Déclarer un parcours
    // professionnel ne vaut ni consentement parental, ni majorité.
    await expect(
      minorPolicy.assertActionAllowed(
        apres,
        MinorGatedAction.APPLICATION_SUBMIT,
      ),
    ).rejects.toBeDefined();

    // Le statut du compte n'a pas davantage bougé : déclarer un parcours ne
    // fait pas avancer le cycle de vérification d'un compte.
    expect(apres.status).toBe(avant.status);
  }, 60_000);

  // ==========================================================================
  // G. LA LECTURE NE DIVULGUE RIEN D'AUTRE
  // ==========================================================================
  it('la lecture du parcours ne renvoie que les deux champs concernés', async () => {
    const id = await inscrire({
      initialIntent: UserIntent.PROFESSIONAL_INTERNSHIP_SEARCH,
    });

    const lu = await auth.getMyPath(id);

    // Une sélection close : ajouter demain une colonne à `User` ne doit pas la
    // faire apparaître ici par accident.
    expect(Object.keys(lu).sort()).toEqual(['currentPath', 'initialIntent']);
  }, 60_000);
});
