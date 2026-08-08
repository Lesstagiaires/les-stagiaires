import type { PrismaService } from '../prisma/prisma.service';
import type { CountryPolicyService } from './country-policy.service';
import { MinorPolicyService, type AgeTier } from './minor-policy.service';

// ============================================================================
// LES QUATRE PALIERS D'ÂGE
//
// Arbitrage du promoteur du 2026-08-07 : « à coder explicitement, jamais comme
// un booléen mineur/majeur », avec pour le Cameroun 14 / 18 / 21.
//
// CE QUE CES TESTS PROTÈGENT VRAIMENT. Le risque n'est pas de mal classer un
// enfant de 10 ans — cela se verrait. C'est de confondre les DEUX PALIERS DU
// MILIEU : un jeune de 19 ans à qui l'on propose d'indiquer un parent ne doit
// subir aucune conséquence de sa réponse. Avec un booléen mineur/majeur, la
// tentation est constante de lui appliquer le chemin des 14-17 ans.
//
// AUCUN SEUIL N'EST ÉCRIT DANS LE CODE TESTÉ. Ils viennent tous de
// CountryPolicy — c'est pourquoi les tests font varier la politique et non le
// code.
// ============================================================================

const CAMEROUN = {
  countryCode: 'CM',
  minInternshipAge: 14,
  minParentRequiredAge: 14,
  civilMajorityAge: 18,
  parentalInfoMaxAge: 21,
  gatedActions: [],
  isFallback: false,
};

describe('Les quatre paliers d’âge', () => {
  let policies: { resolve: jest.Mock };
  let service: MinorPolicyService;

  // Une date de naissance qui donne exactement l'âge voulu aujourd'hui.
  function neIlYA(ans: number): Date {
    const d = new Date();
    d.setFullYear(d.getFullYear() - ans);
    // Un jour de marge : sans elle, un test lancé le jour anniversaire
    // basculerait au gré du fuseau horaire.
    d.setDate(d.getDate() - 1);
    return d;
  }

  async function palier(ans: number, politique = CAMEROUN): Promise<AgeTier> {
    policies.resolve.mockResolvedValue(politique);
    const classification = await service.classify(neIlYA(ans), 'CM');
    return classification.tier;
  }

  beforeEach(() => {
    policies = { resolve: jest.fn().mockResolvedValue(CAMEROUN) };
    service = new MinorPolicyService(
      {} as unknown as PrismaService,
      policies as unknown as CountryPolicyService,
    );
  });

  // --------------------------------------------------------------------------
  // La configuration camerounaise, palier par palier
  // --------------------------------------------------------------------------
  describe('Cameroun : 14 / 18 / 21', () => {
    it.each([
      [10, 'BELOW_MINIMUM'],
      [13, 'BELOW_MINIMUM'],
      [14, 'PARENTAL_CONSENT_REQUIRED'],
      [16, 'PARENTAL_CONSENT_REQUIRED'],
      [17, 'PARENTAL_CONSENT_REQUIRED'],
      [18, 'PARENTAL_INFO_OPTIONAL'],
      [20, 'PARENTAL_INFO_OPTIONAL'],
      [21, 'NO_PARENTAL_INFO'],
      [35, 'NO_PARENTAL_INFO'],
    ])('%i ans → %s', async (ans, attendu) => {
      expect(await palier(ans)).toBe(attendu);
    });

    // Les bornes sont INCLUSIVES par le bas : « 14 ans : obligation de
    // consentement parental » veut dire dès le jour des 14 ans, pas le
    // lendemain.
    it('bascule exactement aux bornes, jamais un an trop tard', async () => {
      expect(await palier(13)).toBe('BELOW_MINIMUM');
      expect(await palier(14)).toBe('PARENTAL_CONSENT_REQUIRED');
      expect(await palier(17)).toBe('PARENTAL_CONSENT_REQUIRED');
      expect(await palier(18)).toBe('PARENTAL_INFO_OPTIONAL');
      expect(await palier(20)).toBe('PARENTAL_INFO_OPTIONAL');
      expect(await palier(21)).toBe('NO_PARENTAL_INFO');
    });
  });

  // --------------------------------------------------------------------------
  // Ce que chaque palier autorise
  // --------------------------------------------------------------------------
  describe('Conséquences par palier', () => {
    // LE TEST QUI COMPTE LE PLUS. Un majeur de 18 à 20 ans peut se voir
    // proposer un contact parental, mais rien n'en dépend.
    it('n’impose jamais de consentement à un majeur, même s’il déclare un parent', async () => {
      policies.resolve.mockResolvedValue(CAMEROUN);
      const jeune = await service.classify(neIlYA(19), 'CM');

      expect(jeune.tier).toBe('PARENTAL_INFO_OPTIONAL');
      expect(jeune.inParentRequiredRange).toBe(false);
      expect(jeune.isMinor).toBe(false);
      // Le champ est proposé — mais c'est une courtoisie.
      expect(jeune.showsParentalField).toBe(true);
    });

    it('n’affiche plus aucun champ parent à partir de 21 ans', async () => {
      policies.resolve.mockResolvedValue(CAMEROUN);
      const adulte = await service.classify(neIlYA(25), 'CM');

      expect(adulte.tier).toBe('NO_PARENTAL_INFO');
      expect(adulte.showsParentalField).toBe(false);
      expect(adulte.inParentRequiredRange).toBe(false);
    });

    it('exige le consentement, et l’affiche, entre 14 et 17 ans', async () => {
      policies.resolve.mockResolvedValue(CAMEROUN);
      const mineur = await service.classify(neIlYA(15), 'CM');

      expect(mineur.tier).toBe('PARENTAL_CONSENT_REQUIRED');
      expect(mineur.inParentRequiredRange).toBe(true);
      expect(mineur.isMinor).toBe(true);
      expect(mineur.showsParentalField).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // La configurabilité — l'engagement du promoteur
  // --------------------------------------------------------------------------
  describe('Aucun seuil codé en dur', () => {
    // « L'objectif est de conserver une architecture adaptable aux autres pays
    // africains sans redéploiement. » Le même code, une autre politique, un
    // autre découpage.
    it('suit une politique de pays entièrement différente', async () => {
      const autrePays = {
        ...CAMEROUN,
        countryCode: 'SN',
        minInternshipAge: 16,
        minParentRequiredAge: 16,
        civilMajorityAge: 21,
        parentalInfoMaxAge: 25,
      };

      expect(await palier(15, autrePays)).toBe('BELOW_MINIMUM');
      expect(await palier(17, autrePays)).toBe('PARENTAL_CONSENT_REQUIRED');
      // 19 ans est MINEUR dans ce pays — là où il serait majeur au Cameroun.
      expect(await palier(19, autrePays)).toBe('PARENTAL_CONSENT_REQUIRED');
      expect(await palier(22, autrePays)).toBe('PARENTAL_INFO_OPTIONAL');
      expect(await palier(26, autrePays)).toBe('NO_PARENTAL_INFO');
    });

    // Le modèle autorise que l'âge de stage et l'âge d'obligation parentale
    // diffèrent. Il existe alors une bande de MINEURS SANS OBLIGATION : leur
    // imposer un consentement irait contre la politique de leur propre pays.
    it('respecte la bande de mineurs sans obligation quand les deux seuils diffèrent', async () => {
      const seuilsDisjoints = {
        ...CAMEROUN,
        minInternshipAge: 15,
        minParentRequiredAge: 17,
        civilMajorityAge: 18,
        parentalInfoMaxAge: 21,
      };

      expect(await palier(14, seuilsDisjoints)).toBe('BELOW_MINIMUM');
      // 15 et 16 ans : inscrits, mineurs, mais sans obligation parentale.
      expect(await palier(15, seuilsDisjoints)).toBe('PARENTAL_INFO_OPTIONAL');
      expect(await palier(16, seuilsDisjoints)).toBe('PARENTAL_INFO_OPTIONAL');
      expect(await palier(17, seuilsDisjoints)).toBe(
        'PARENTAL_CONSENT_REQUIRED',
      );
    });
  });

  // --------------------------------------------------------------------------
  // Le passage d'anniversaire
  // --------------------------------------------------------------------------
  describe('Anniversaire pendant l’utilisation', () => {
    // Exigence explicite du cahier des charges : « un utilisateur qui passe de
    // 17 à 18 ans doit voir son compte automatiquement débloqué […] sans
    // action requise de sa part ni de son parent ».
    //
    // Rien n'est stocké : le palier se recalcule à chaque appel depuis la date
    // de naissance. C'est ce qui rend le déblocage automatique — il n'y a
    // aucun champ à mettre à jour, donc aucun oubli possible.
    it('bascule tout seul de 17 à 18 ans, sans qu’aucun champ ne soit écrit', async () => {
      policies.resolve.mockResolvedValue(CAMEROUN);

      const naissance = new Date();
      naissance.setFullYear(naissance.getFullYear() - 18);
      naissance.setDate(naissance.getDate() + 1); // 18 ans demain

      const veille = await service.classify(naissance, 'CM');
      expect(veille.tier).toBe('PARENTAL_CONSENT_REQUIRED');

      const lendemain = new Date();
      lendemain.setDate(lendemain.getDate() + 2);
      expect(service.computeAge(naissance, lendemain)).toBe(18);
    });
  });
});
