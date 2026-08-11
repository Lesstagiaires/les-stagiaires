import 'dotenv/config';
import { ForbiddenException } from '@nestjs/common';
import { execSync } from 'child_process';
import { Client } from 'pg';
import {
  ProfileSection,
  SectionVisibility,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { CountryPolicyService } from '../auth/country-policy.service';
import { MinorPolicyService } from '../auth/minor-policy.service';
import { PassportService } from '../digital-safe/passport.service';
import { PrismaService } from '../prisma/prisma.service';
import { CvService } from './cv.service';
import { VisibilityService } from './visibility.service';

// ============================================================================
// S-01 — AUCUNE IDENTITÉ NE SORT HORS DU MOTEUR DE VISIBILITÉ
//
// Défaut relevé le 2026-08-09, corrigé le 2026-08-12. `lsId` et `activeRole`
// étaient écrits dans la réponse AVANT toute condition ; le compte de documents
// du Passeport aussi. Un anonyme muni d'un identifiant technique obtenait donc
// l'identité pseudonyme durable d'un profil ENTIÈREMENT PRIVÉ, mineur compris —
// alors que les cinq autres champs, eux, revenaient bien à `null`.
//
// CLAUDE.md §5 exige une confidentialité renforcée par défaut pour les mineurs
// SANS ACTION DE LEUR PART ; §6 interdit d'exposer un champ sans vérification
// explicite. Le moteur existait, il n'était simplement pas consulté.
//
// CE QUE CES TESTS PROTÈGENT VRAIMENT. Les trois champs d'aujourd'hui sont le
// petit problème. Le grand, c'est le quatrième — celui qu'on ajoutera dans six
// mois sans y penser. D'où le test structurel : il ne connaît aucun nom de
// champ, il parcourt TOUTES les clés de la réponse et exige qu'un anonyme n'en
// reçoive aucune renseignée. Un champ ajouté hors rubrique le fait tomber le
// jour même, sans que personne ait eu à y penser.
//
// Base PostgreSQL réelle, vrai moteur de visibilité, vraies règles mineurs.
// ============================================================================

const BASE = 'stagiaires_it_identite_publique';

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

// Une valeur « vide » au sens de ce test : rien n'a été divulgué.
function estVide(valeur: unknown): boolean {
  if (valeur === null || valeur === undefined) return true;
  if (Array.isArray(valeur)) return valeur.length === 0;
  return false;
}

describe("S-01 — l'identité publique reste sous le moteur de visibilité", () => {
  let prisma: PrismaService;
  let visibility: VisibilityService;
  let cv: CvService;
  let passport: PassportService;

  let titulaire = '';
  let inconnu = '';
  let duReseau = '';
  let destinataire = '';
  let mineur = '';

  const LS_ID_TITULAIRE = 'LS-CM-2026-AAAAAA';
  const LS_ID_MINEUR = 'LS-CM-2026-BBBBBB';

  const creerCompte = async (
    phone: string,
    lsId?: string,
    naissance?: Date,
  ) => {
    const u = await prisma.user.create({
      data: {
        phone,
        password: 'sans-objet-pour-ce-test',
        firstName: 'T',
        lsId: lsId ?? null,
        dateOfBirth: naissance ?? null,
        countryOfResidence: 'CM',
      },
    });
    await prisma.profile.create({
      data: { userId: u.id, headline: 'Titre de profil' },
    });
    return u.id;
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL absente.');
    process.env.DATABASE_URL_ORIGINE = process.env.DATABASE_URL;

    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE}"`);
    await sqlAdmin(`CREATE DATABASE "${BASE}"`);
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: urlDe(BASE) },
      stdio: 'pipe',
    });

    process.env.DATABASE_URL = urlDe(BASE);
    prisma = new PrismaService();

    const audit = new AuditService(prisma);
    const pays = new CountryPolicyService(prisma, audit);
    const minor = new MinorPolicyService(prisma, pays);
    visibility = new VisibilityService(prisma, audit, minor);
    cv = new CvService(prisma, visibility);
    passport = new PassportService(prisma, cv, visibility);

    // Un majeur : né il y a trente ans.
    const ilYATrenteAns = new Date();
    ilYATrenteAns.setFullYear(ilYATrenteAns.getFullYear() - 30);

    titulaire = await creerCompte(
      '+237600000010',
      LS_ID_TITULAIRE,
      ilYATrenteAns,
    );
    inconnu = await creerCompte('+237600000011');
    duReseau = await creerCompte('+237600000012');
    destinataire = await creerCompte('+237600000013');

    // Un mineur : quinze ans. La politique de repli est protectrice, donc
    // aucune configuration de pays n'est nécessaire pour qu'il soit reconnu.
    const ilYAQuinzeAns = new Date();
    ilYAQuinzeAns.setFullYear(ilYAQuinzeAns.getFullYear() - 15);
    mineur = await creerCompte('+237600000014', LS_ID_MINEUR, ilYAQuinzeAns);
  }, 240_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    process.env.DATABASE_URL = process.env.DATABASE_URL_ORIGINE;
    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE}"`);
  }, 60_000);

  // --- 1. Le défaut lui-même -------------------------------------------------
  describe("un anonyme sur un profil entièrement privé n'obtient rien", () => {
    it('le CV Vivant ne livre ni LS-ID ni casquette', async () => {
      const r = await cv.getCvVivant(titulaire, undefined);
      expect(r.lsId).toBeNull();
      expect(r.activeRole).toBeNull();
    });

    it('la Carte Professionnelle non plus', async () => {
      const r = await cv.getCarteProfessionnelle(titulaire, undefined);
      expect(r.lsId).toBeNull();
      expect(r.activeRole).toBeNull();
      expect(r.headline).toBeNull();
    });

    it('le Passeport ne livre pas le nombre de documents', async () => {
      // `null`, pas `0` : zéro serait une réponse, et une réponse fausse.
      const r = await passport.getPassport(titulaire, undefined);
      expect(r.lsId).toBeNull();
      expect(r.documentsInDigitalSafe).toBeNull();
    });

    it('aucune règle de visibilité écrite = tout reste fermé', async () => {
      // Le défaut de `canView` est PRIVATE. Ce test tombe si quelqu'un le
      // bascule sur PUBLIC — un changement d'une ligne qui rouvrirait tout,
      // partout, sans toucher au moindre champ.
      const rien = await visibility.canView(
        titulaire,
        ProfileSection.SUMMARY,
        undefined,
      );
      expect(rien).toBe(false);
    });
  });

  // --- 2. Le test structurel -------------------------------------------------
  describe('aucune clé ne peut apparaître dans une réponse anonyme', () => {
    // CE TEST NE CONNAÎT AUCUN NOM DE CHAMP. C'est tout son intérêt : il vaut
    // pour ceux d'aujourd'hui comme pour ceux de l'an prochain.
    it('toutes les clés du CV Vivant sont vides pour un anonyme', async () => {
      const r = await cv.getCvVivant(titulaire, undefined);
      const renseignees = Object.entries(r)
        .filter(([, v]) => !estVide(v))
        .map(([cle]) => cle);
      expect(renseignees).toEqual([]);
    });

    it('toutes les clés de la Carte sont vides pour un anonyme', async () => {
      const r = await cv.getCarteProfessionnelle(titulaire, undefined);
      const renseignees = Object.entries(r)
        .filter(([, v]) => !estVide(v))
        .map(([cle]) => cle);
      expect(renseignees).toEqual([]);
    });

    it('toutes les clés du Passeport sont vides pour un anonyme', async () => {
      const r = await passport.getPassport(titulaire, undefined);
      const renseignees = Object.entries(r)
        .filter(([, v]) => !estVide(v))
        .map(([cle]) => cle);
      expect(renseignees).toEqual([]);
    });
  });

  // --- 3. Ce qui doit continuer de marcher -----------------------------------
  describe('le titulaire voit son propre profil', () => {
    it('le LS-ID et la casquette lui reviennent', async () => {
      const r = await cv.getCvVivant(titulaire, titulaire);
      expect(r.lsId).toBe(LS_ID_TITULAIRE);
      expect(r.headline).toBe('Titre de profil');
    });

    it('et le compte de ses documents aussi', async () => {
      const r = await passport.getPassport(titulaire, titulaire);
      expect(r.documentsInDigitalSafe).toBe(0);
    });
  });

  describe('un compte identifié, selon la règle posée', () => {
    it("NETWORK : le LS-ID revient à qui s'est authentifié", async () => {
      await visibility.setVisibility(titulaire, ProfileSection.SUMMARY, {
        visibility: SectionVisibility.NETWORK,
      });
      const r = await cv.getCvVivant(titulaire, duReseau);
      expect(r.lsId).toBe(LS_ID_TITULAIRE);
    });

    it('NETWORK : mais toujours rien à un anonyme', async () => {
      const r = await cv.getCvVivant(titulaire, undefined);
      expect(r.lsId).toBeNull();
    });

    it('PRIVATE : plus rien, même à un compte identifié', async () => {
      await visibility.setVisibility(titulaire, ProfileSection.SUMMARY, {
        visibility: SectionVisibility.PRIVATE,
      });
      const r = await cv.getCvVivant(titulaire, duReseau);
      expect(r.lsId).toBeNull();
    });

    it('SHARED : le destinataire voit, un tiers non', async () => {
      await visibility.setVisibility(titulaire, ProfileSection.SUMMARY, {
        visibility: SectionVisibility.SHARED,
      });
      await visibility.shareSection(titulaire, ProfileSection.SUMMARY, {
        userId: destinataire,
      });

      const vu = await cv.getCvVivant(titulaire, destinataire);
      expect(vu.lsId).toBe(LS_ID_TITULAIRE);

      const pasVu = await cv.getCvVivant(titulaire, inconnu);
      expect(pasVu.lsId).toBeNull();
    });

    it('SHARED révoqué : le destinataire ne voit plus rien', async () => {
      await visibility.unshareSection(
        titulaire,
        ProfileSection.SUMMARY,
        destinataire,
      );
      const r = await cv.getCvVivant(titulaire, destinataire);
      expect(r.lsId).toBeNull();
    });
  });

  // --- 4. Le mineur ----------------------------------------------------------
  describe('un compte mineur ne peut être exposé, quelle que soit sa configuration', () => {
    it('il lui est interdit de rendre son identité publique', async () => {
      await expect(
        visibility.setVisibility(mineur, ProfileSection.SUMMARY, {
          visibility: SectionVisibility.PUBLIC,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("le refus d'écriture ne suffisait pas — le LS-ID sortait quand même", async () => {
      // LE CŒUR DE S-01. `setVisibility` protégeait déjà le mineur ; le champ
      // ne passait simplement pas par cette porte. Il y passe désormais.
      const r = await cv.getCvVivant(mineur, undefined);
      expect(r.lsId).toBeNull();
      expect(r.activeRole).toBeNull();
    });

    it('même au maximum autorisé (NETWORK), un anonyme ne voit rien', async () => {
      await visibility.setVisibility(mineur, ProfileSection.SUMMARY, {
        visibility: SectionVisibility.NETWORK,
      });
      const anonyme = await cv.getCvVivant(mineur, undefined);
      expect(anonyme.lsId).toBeNull();

      const identifie = await cv.getCvVivant(mineur, inconnu);
      expect(identifie.lsId).toBe(LS_ID_MINEUR);
    });

    it('son Passeport ne dit pas non plus combien de documents il dépose', async () => {
      const r = await passport.getPassport(mineur, undefined);
      expect(r.documentsInDigitalSafe).toBeNull();
    });
  });

  // --- 5. IDOR ---------------------------------------------------------------
  describe('un identifiant deviné ou modifié ne mène à rien', () => {
    it('un identifiant inventé ne renvoie pas de profil', async () => {
      await expect(
        cv.getCvVivant('cmxxxxxxxxxxxxxxxxxxxxxxx', undefined),
      ).rejects.toThrow();
    });

    it("un identifiant réel modifié d'un caractère ne renvoie rien", async () => {
      const altere =
        titulaire.slice(0, -1) + (titulaire.endsWith('a') ? 'b' : 'a');
      await expect(cv.getCvVivant(altere, undefined)).rejects.toThrow();
    });

    it("connaître le LS-ID n'ouvre aucune porte", async () => {
      // Le LS-ID n'est une clé d'entrée nulle part : on ne s'authentifie pas
      // avec, on ne cherche pas avec. Ce test fige cette propriété — si un jour
      // quelqu'un ajoute une recherche par LS-ID, il faudra le regarder en face.
      const parLsId = await prisma.user.findFirst({
        where: { lsId: LS_ID_TITULAIRE },
        select: { id: true },
      });
      expect(parLsId?.id).toBe(titulaire);

      // …et pourtant l'anonyme qui le détiendrait n'obtient toujours rien.
      const r = await cv.getCvVivant(titulaire, undefined);
      expect(r.lsId).toBeNull();
    });
  });
});
