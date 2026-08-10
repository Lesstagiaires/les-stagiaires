// Jest ne charge pas `.env` : les autres tests n'ont jamais eu besoin de base.
// Celui-ci en a besoin, et doit le dire clairement plutôt que d'échouer sur une
// « Invalid URL » que personne ne relie à une variable manquante.
import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import { Client } from 'pg';
import {
  AccountStatus,
  GuardianChangeStatus,
  MinorGatedAction,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CountryPolicyService } from './country-policy.service';
import { GuardianChangeService } from './guardian-change.service';
import { MinorPolicyService } from './minor-policy.service';
import { ParentalConsentService } from './parental-consent.service';

// ============================================================================
// LA JONCTION ENTRE LES DEUX SERVICES — TEST D'INTÉGRATION RÉEL
//
// POURQUOI CE FICHIER EXISTE. Les tests unitaires couvrent chaque moitié :
// `guardian-change.spec.ts` vérifie ce que `decide()` écrit, sur des doubles ;
// `parental-refusal-scenarios.spec.ts` vérifie ce que `requestConsent()` fait
// d'une autorisation, sur un monde en mémoire qui SIMULE l'approbation.
//
// Aucun des deux ne traverse la couture. Si `decide()` écrivait dans une
// colonne que `requestConsent()` ne lit pas — ou l'inverse — les deux fichiers
// resteraient verts et la faille passerait. C'est le défaut que j'ai signalé
// moi-même en présentant la correction, et c'est celui-ci qui le ferme.
//
// CE QUI EST RÉEL ICI : PostgreSQL, les migrations, Prisma, les contraintes,
// les index partiels, les déclencheurs d'ajout seul, et les DEUX vrais services
// avec leurs vraies dépendances. Seul l'envoi de SMS est simulé — parce qu'il
// sort de la machine, et parce que c'est en le capturant qu'on obtient le code
// que le tuteur lirait sur son téléphone.
//
// LA BASE EST JETABLE, créée et supprimée par ce fichier. La base de
// développement n'est jamais écrite : un test qui laisse des lignes derrière
// lui finit toujours par en dépendre.
// ============================================================================

const BASE_JETABLE = 'stagiaires_it_guardian_change';

const TUTEUR_B = '+237690001111';
// TROIS ÉCRITURES DU MÊME NUMÉRO, et c'est délibéré.
//
// La demande de changement est déposée avec l'une, la demande de consentement
// avec une AUTRE, et aucune des deux n'est la forme canonique. Elles ne peuvent
// donc se rejoindre que si la normalisation s'applique DES DEUX CÔTÉS de la
// jonction.
//
// Vérifié : avec un numéro déjà canonique en entrée, ce test restait vert alors
// que la normalisation côté écriture avait été retirée. C'était un trou.
const TUTEUR_C = '+237690002222'; // la forme canonique, attendue en base
const TUTEUR_C_SAISI_CHANGEMENT = '+237 690 00 22 22';
const TUTEUR_C_SAISI_CONSENTEMENT = '+237-690-002-222';
const MINEUR_A = '+237690009999';

function urlDe(base: string): string {
  const u = new URL(process.env.DATABASE_URL_ORIGINE!);
  u.pathname = '/' + base;
  return u.href;
}

async function sqlAdmin(requete: string): Promise<void> {
  const c = new Client({ connectionString: urlDe('postgres') });
  await c.connect();
  try {
    await c.query(requete);
  } finally {
    await c.end();
  }
}

// Le code à six chiffres, tel que le tuteur le lit dans son SMS. Extrait du
// message plutôt que deviné : c'est le seul chemin dont dispose un vrai parent,
// et un test qui court-circuite ce chemin ne prouve pas qu'il fonctionne.
// ANCRÉ SUR LE LIBELLÉ, pas sur « six chiffres quelque part ». Le message
// contient aussi le numéro du mineur, dont `\d{6}` capturait joyeusement les
// six premiers chiffres — le test échouait alors sur « Code invalide » en
// laissant croire à un défaut du service.
function codeDuSms(corps: string): string {
  const m = /votre code\s*:\s*(\d{6})/.exec(corps);
  if (!m) throw new Error(`aucun code lisible dans le SMS : ${corps}`);
  return m[1];
}

describe('Jonction changement de tuteur / consentement parental (base réelle)', () => {
  let prisma: PrismaService;
  let consent: ParentalConsentService;
  let guardianChange: GuardianChangeService;
  const smsEnvoyes: { to: string; body: string }[] = [];

  let mineurId: string;
  let adminId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL absente : ce test d'intégration a besoin d'un PostgreSQL " +
          "joignable (docker compose up -d) et d'un fichier api/.env.",
      );
    }
    process.env.DATABASE_URL_ORIGINE = process.env.DATABASE_URL;

    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE_JETABLE}"`);
    await sqlAdmin(`CREATE DATABASE "${BASE_JETABLE}"`);

    // Les migrations, les vraies. C'est aussi ce qui fait de ce test un contrôle
    // de reproductibilité : si une migration cesse de s'appliquer sur une base
    // vierge, il échoue ici, avant même le premier scénario.
    //
    // `execSync` et non `execFileSync` : depuis Node 20, lancer un `.cmd` sans
    // passer par un interpréteur échoue avec EINVAL sous Windows.
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: urlDe(BASE_JETABLE) },
      stdio: 'pipe',
    });

    // `PrismaService` lit DATABASE_URL à la construction : on bascule avant.
    process.env.DATABASE_URL = urlDe(BASE_JETABLE);
    prisma = new PrismaService();

    const audit = new AuditService(prisma);
    const countryPolicies = new CountryPolicyService(prisma, audit);
    const minorPolicy = new MinorPolicyService(prisma, countryPolicies);

    consent = new ParentalConsentService(
      prisma,
      // Délai de garde à zéro : ce fichier teste le cycle de refus, pas la
      // limitation de débit des relances, qui a ses propres tests.
      new ConfigService({ PARENTAL_CONSENT_RESEND_COOLDOWN_MINUTES: '0' }),
      {
        send: (to: string, body: string) => {
          smsEnvoyes.push({ to, body });
          return Promise.resolve();
        },
      },
      audit,
      minorPolicy,
      countryPolicies,
    );
    guardianChange = new GuardianChangeService(prisma, audit, minorPolicy);

    // UPSERT et non CREATE : une migration antérieure crée déjà la politique du
    // Cameroun sur toute base neuve. Le test énonce donc les seuils dont il
    // dépend, sans supposer qu'il est le premier à écrire cette ligne.
    const politiqueCM = {
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
    };
    await prisma.countryPolicy.upsert({
      where: { countryCode: 'CM' },
      update: politiqueCM,
      create: { countryCode: 'CM', ...politiqueCM },
    });

    // Quinze ans : bien dans la tranche où l'accord parental est obligatoire au
    // Cameroun (14 à 18), et loin des deux bornes pour que le test ne devienne
    // pas faux le jour d'un anniversaire.
    const quinzeAns = new Date();
    quinzeAns.setFullYear(quinzeAns.getFullYear() - 15);

    const mineur = await prisma.user.create({
      data: {
        phone: MINEUR_A,
        password: 'sans-objet-pour-ce-test',
        firstName: 'Awa',
        countryOfResidence: 'CM',
        dateOfBirth: quinzeAns,
        isMinor: true,
        status: AccountStatus.AWAITING_PARENTAL_CONSENT,
      },
    });
    mineurId = mineur.id;

    const admin = await prisma.user.create({
      data: {
        phone: '+237690007777',
        password: 'sans-objet-pour-ce-test',
        firstName: 'Admin',
        countryOfResidence: 'CM',
        status: AccountStatus.ACTIVE,
      },
    });
    adminId = admin.id;
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    process.env.DATABASE_URL = process.env.DATABASE_URL_ORIGINE;
    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE_JETABLE}"`);
  }, 60_000);

  // Le parcours est joué EN UN SEUL TEST, dans l'ordre. Le découper en treize
  // `it` indépendants obligerait soit à rejouer tout le début à chaque fois,
  // soit à faire dépendre les tests de leur ordre d'exécution — deux façons de
  // rendre l'échec illisible. Les assertions restent nommées par leur étape.
  it('déroule le cycle complet A → B refuse → changement vers C → C refuse', async () => {
    // --- 1 & 2. Mineur A demande à B, qui refuse ----------------------------
    const demandeB = await consent.requestConsent(mineurId, TUTEUR_B);
    expect(smsEnvoyes).toHaveLength(1);
    expect(smsEnvoyes[0].to).toBe(TUTEUR_B);

    await consent.declineConsent(
      demandeB.linkId,
      codeDuSms(smsEnvoyes[0].body),
    );

    // --- 3. Le compteur et le délai sont bien EN BASE ------------------------
    const apresRefusB = await prisma.user.findUniqueOrThrow({
      where: { id: mineurId },
    });
    expect(apresRefusB.parentalRefusalCount).toBe(1);
    expect(apresRefusB.lastParentalRefusalAt).not.toBeNull();
    expect(apresRefusB.parentalRequestBlockedUntil).not.toBeNull();
    // Le compte reste RESTREINT, pas désactivé : le mineur doit pouvoir se
    // connecter pour consulter la page destinée à son tuteur.
    expect(apresRefusB.status).toBe(AccountStatus.AWAITING_PARENTAL_CONSENT);

    const joursB =
      (apresRefusB.parentalRequestBlockedUntil!.getTime() - Date.now()) /
      86_400_000;
    expect(joursB).toBeCloseTo(7, 1);

    const lienB = await prisma.parentalLink.findFirstOrThrow({
      where: { childId: mineurId, parentPhoneNormalized: TUTEUR_B },
    });
    expect(lienB.status).toBe(ParentalLinkStatus.DECLINED);

    // --- 4 & 5. Demande de changement vers C, approuvée par l'ADMIN ---------
    // Saisi avec des espaces — comme un mineur le taperait réellement.
    const demandeChangement = await guardianChange.request(
      mineurId,
      TUTEUR_C_SAISI_CHANGEMENT,
      'Mon père est décédé en mars et je vis désormais chez ma tante, qui est ma tutrice légale.',
    );
    await guardianChange.decide(
      adminId,
      demandeChangement.id,
      true,
      'Acte de décès et attestation de tutelle fournis.',
    );

    // --- 6. L'autorisation est liée au numéro E.164 de C --------------------
    const autorisation = await prisma.guardianChangeRequest.findUniqueOrThrow({
      where: { id: demandeChangement.id },
    });
    expect(autorisation.status).toBe(GuardianChangeStatus.APPROVED);
    expect(autorisation.consumedAt).toBeNull();
    // LE POINT CENTRAL : la saisie du mineur comportait des espaces, et c'est
    // la FORME CANONIQUE qui a été stockée — celle sur laquelle
    // `requestConsent` retrouvera l'autorisation.
    expect(autorisation.requestedParentPhoneNormalized).toBe(TUTEUR_C);
    // La saisie brute est conservée à côté, pour l'afficher telle quelle à
    // l'administrateur qui décide.
    expect(autorisation.requestedParentPhone).toBe(TUTEUR_C_SAISI_CHANGEMENT);
    // Le compteur photographié au moment de la demande, pour l'administrateur.
    expect(autorisation.refusalCountAtRequest).toBe(1);

    // --- 7. Le blocage issu du refus de B N'EST PAS supprimé ----------------
    const apresApprobation = await prisma.user.findUniqueOrThrow({
      where: { id: mineurId },
    });
    // C'ÉTAIT LA FAILLE. L'approbation remettait ce champ à NULL, ce qui
    // rouvrait la porte au tuteur qui venait de refuser.
    expect(apresApprobation.parentalRequestBlockedUntil).toEqual(
      apresRefusB.parentalRequestBlockedUntil,
    );
    expect(apresApprobation.parentalRefusalCount).toBe(1);

    // --- 9. Redemander à B reste impossible ---------------------------------
    // Contrôlé AVANT la demande à C : tant que l'autorisation n'est pas
    // consommée, c'est le moment où un contournement serait le plus tentant.
    const envoyesAvant = smsEnvoyes.length;
    await expect(
      consent.requestConsent(mineurId, TUTEUR_B),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(smsEnvoyes).toHaveLength(envoyesAvant);

    // Un troisième numéro, que personne n'a approuvé, est refusé de même.
    await expect(
      consent.requestConsent(mineurId, '+237690003333'),
    ).rejects.toBeInstanceOf(ConflictException);

    // --- 8 & 10. Demander à C fonctionne, dans une TROISIÈME écriture --------
    //
    // Ni la forme canonique, ni celle utilisée pour la demande de changement.
    // Les deux ne peuvent se rejoindre que par la normalisation, appliquée des
    // deux côtés de la jonction.
    const demandeC = await consent.requestConsent(
      mineurId,
      TUTEUR_C_SAISI_CONSENTEMENT,
    );
    expect(smsEnvoyes).toHaveLength(envoyesAvant + 1);
    // Le SMS part sur la forme canonique, pas sur la saisie brute.
    expect(smsEnvoyes.at(-1)!.to).toBe(TUTEUR_C);

    // L'autorisation n'est PAS encore consommée : elle vaut droit d'obtenir une
    // décision, et C n'a pas encore répondu.
    const pendantAttenteC =
      await prisma.guardianChangeRequest.findUniqueOrThrow({
        where: { id: demandeChangement.id },
      });
    expect(pendantAttenteC.consumedAt).toBeNull();

    // --- 11 & 12. C refuse à son tour ---------------------------------------
    await consent.declineConsent(
      demandeC.linkId,
      codeDuSms(smsEnvoyes.at(-1)!.body),
    );

    const apresRefusC = await prisma.user.findUniqueOrThrow({
      where: { id: mineurId },
    });
    expect(apresRefusC.parentalRefusalCount).toBe(2);
    const joursC =
      (apresRefusC.parentalRequestBlockedUntil!.getTime() - Date.now()) /
      86_400_000;
    // Deuxième refus : trente jours, lus dans la CountryPolicy en base.
    expect(joursC).toBeCloseTo(30, 1);

    // --- 13. Plus aucune autorisation exploitable ---------------------------
    const apresRefusAutorisation =
      await prisma.guardianChangeRequest.findUniqueOrThrow({
        where: { id: demandeChangement.id },
      });
    expect(apresRefusAutorisation.consumedAt).not.toBeNull();

    const vivantes = await prisma.guardianChangeRequest.count({
      where: {
        childId: mineurId,
        status: GuardianChangeStatus.APPROVED,
        consumedAt: null,
      },
    });
    expect(vivantes).toBe(0);

    // Et la conséquence, vérifiée pour de bon : redemander à C est désormais
    // refusé comme n'importe quel autre numéro. L'approbation ne s'use pas en
    // droit de contournement répétable.
    await expect(
      consent.requestConsent(mineurId, TUTEUR_C),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      consent.requestConsent(mineurId, TUTEUR_B),
    ).rejects.toBeInstanceOf(ConflictException);

    // --- Le journal permet de reconstituer le cycle -------------------------
    const actions = (
      await prisma.auditLog.findMany({
        where: { userId: { in: [mineurId, adminId] } },
        orderBy: { createdAt: 'asc' },
      })
    ).map((l) => l.action);

    for (const attendue of [
      'PARENTAL_CONSENT_REQUESTED',
      'PARENTAL_CONSENT_DECLINED',
      'PARENTAL_CONSENT_REQUEST_BLOCKED',
      'GUARDIAN_CHANGE_REQUESTED',
      'GUARDIAN_CHANGE_APPROVED',
      'PARENTAL_CONSENT_REQUESTED_UNDER_AUTHORIZATION',
      'GUARDIAN_CHANGE_AUTHORIZATION_CONSUMED',
    ]) {
      expect(actions).toContain(attendue);
    }
  }, 120_000);
});
