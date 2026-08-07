import { readFileSync } from 'fs';
import { join } from 'path';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OpportunityStatus } from '../../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import {
  OfferQualityService,
  QualityCheck,
  type DiagnosableOffer,
} from './offer-quality.service';
import type { OrganizationAccessService } from './organization-access.service';

// ============================================================================
// DIAGNOSTIC DE QUALITÉ D'UNE OFFRE
//
// Deux familles de tests, et la première compte davantage que la seconde :
//
//   1. CE QUE LE DIAGNOSTIC NE DIT PAS. Ni score, ni rang, ni comparaison.
//      C'est l'engagement du promoteur — « le score numérique ne doit être
//      affiché ni aux candidats ni aux entreprises » — et un diagnostic qui
//      situerait l'offre par rapport aux autres transformerait le classement
//      par pertinence en jeu d'optimisation.
//   2. CE QU'IL DIT, point par point.
// ============================================================================
// Le CODE d'un fichier, ses commentaires retirés.
//
// Les tests structurels ci-dessous cherchent des symboles interdits. Sans ce
// nettoyage, ils attraperaient les commentaires qui EXPLIQUENT pourquoi ces
// symboles sont absents — et la seule façon de les faire passer serait de
// cesser d'expliquer. Un test qui punit la documentation est un mauvais test.
function codeSansCommentaires(fichier: string): string {
  return readFileSync(join(__dirname, fichier), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('Diagnostic de qualité d’une offre', () => {
  let prisma: { opportunity: { findUnique: jest.Mock } };
  let access: { getAccess: jest.Mock };
  let service: OfferQualityService;

  const MAINTENANT = new Date('2026-08-07T12:00:00Z');

  // Une offre COMPLÈTE : tous les points au vert. Chaque test dégrade un seul
  // champ à partir d'elle, pour qu'on voie exactement ce qui cause quoi.
  const OFFRE_COMPLETE: DiagnosableOffer = {
    id: 'opp_1',
    title: 'Stage développeur web junior',
    description: 'x'.repeat(250),
    city: 'Douala',
    workMode: 'ON_SITE',
    status: OpportunityStatus.ACTIVE,
    publishedAt: new Date('2026-08-01T12:00:00Z'),
    startsAt: new Date('2026-09-01T12:00:00Z'),
    occupationId: 'occ_dev',
    minEducationLevel: 'BAC_PLUS_2',
    _count: { skills: 3 },
  };

  function diagnostic(modifications: Partial<DiagnosableOffer> = {}) {
    return service.evaluate(
      { ...OFFRE_COMPLETE, ...modifications },
      MAINTENANT,
    );
  }

  function verdictDe(
    rapport: ReturnType<OfferQualityService['evaluate']>,
    check: QualityCheck,
  ) {
    return rapport.points.find((p) => p.check === check)?.verdict;
  }

  beforeEach(() => {
    prisma = { opportunity: { findUnique: jest.fn() } };
    access = { getAccess: jest.fn().mockResolvedValue('OWNER') };
    service = new OfferQualityService(
      prisma as unknown as PrismaService,
      access as unknown as OrganizationAccessService,
    );
  });

  // --------------------------------------------------------------------------
  // 1. CE QUE LE DIAGNOSTIC NE DIT PAS
  // --------------------------------------------------------------------------
  describe('Aucun score, aucun rang', () => {
    it('ne rend aucun nombre dans sa réponse', () => {
      const rapport = diagnostic({ _count: { skills: 0 } });

      // On sérialise et on cherche des nombres : plus robuste qu'énumérer des
      // noms de champs, parce qu'un champ ajouté demain serait pris aussi.
      const serialise = JSON.stringify(rapport);
      const nombres = serialise.match(/:\s*-?\d+(\.\d+)?/g);
      expect(nombres).toBeNull();
    });

    it('ne rend ni score, ni rang, ni total, ni comparaison', () => {
      const rapport = diagnostic();
      const cles = new Set<string>();
      JSON.stringify(rapport, (cle, valeur) => {
        if (cle) cles.add(cle.toLowerCase());
        return valeur as unknown;
      });

      for (const interdit of [
        'score',
        'rank',
        'rang',
        'position',
        'percentile',
        'total',
        'note',
        'stars',
        'etoiles',
        'competitors',
        'concurrents',
      ]) {
        expect(cles.has(interdit)).toBe(false);
      }
    });

    // LA GARANTIE STRUCTURELLE. Le service ne peut pas parler du classement
    // parce qu'il n'a pas de quoi le connaître : ni le moteur de pertinence en
    // dépendance, ni la moindre lecture d'une autre offre.
    it('n’a aucun accès au moteur de pertinence ni aux autres offres', () => {
      const source = codeSansCommentaires('offer-quality.service.ts');

      expect(source).not.toContain('RelevanceScoringService');
      expect(source).not.toContain('weightsFor');
      expect(source).not.toContain('findMany');
      expect(source).not.toContain('diversify');
      // Une seule lecture, et c'est celle de l'offre diagnostiquée.
      expect(source.match(/findUnique/g)).toHaveLength(1);
    });

    it('ne compte pas les candidatures reçues', () => {
      const source = codeSansCommentaires('offer-quality.service.ts');
      expect(source).not.toContain('applications');
    });
  });

  // --------------------------------------------------------------------------
  // 2. LE CONTRÔLE D'ACCÈS
  // --------------------------------------------------------------------------
  describe('Accès', () => {
    beforeEach(() => {
      prisma.opportunity.findUnique.mockResolvedValue({
        ...OFFRE_COMPLETE,
        organizationId: 'org_1',
      });
    });

    it('refuse un tiers à l’organisation', async () => {
      access.getAccess.mockResolvedValue(null);

      await expect(
        service.diagnose('opp_1', 'user_etranger'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // Le diagnostic est une LECTURE : un consultant qui peut déjà lire l'offre
    // ne gagne rien à ignorer ce qui lui manque.
    it('accepte un membre en lecture seule', async () => {
      access.getAccess.mockResolvedValue('VIEWER');

      const rapport = await service.diagnose('opp_1', 'user_viewer');
      expect(rapport.opportunityId).toBe('opp_1');
    });

    it('refuse une offre inexistante avant tout contrôle de rôle', async () => {
      prisma.opportunity.findUnique.mockResolvedValue(null);

      await expect(
        service.diagnose('opp_fantome', 'user_1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // --------------------------------------------------------------------------
  // 3. LES POINTS EXAMINÉS
  // --------------------------------------------------------------------------
  describe('Points examinés', () => {
    it('déclare une offre complète COMPLETE, sans aucune recommandation', () => {
      const rapport = diagnostic();

      expect(rapport.level).toBe('COMPLETE');
      expect(rapport.points.every((p) => p.verdict === 'OK')).toBe(true);
      expect(rapport.points.every((p) => p.recommendation === undefined)).toBe(
        true,
      );
    });

    // 35 points du barème. Le manque le plus lourd.
    it('signale l’absence de compétences comme un MANQUE', () => {
      const rapport = diagnostic({ _count: { skills: 0 } });

      expect(verdictDe(rapport, QualityCheck.SKILLS_DECLARED)).toBe('MANQUANT');
      expect(rapport.level).toBe('INCOMPLETE');
    });

    // 25 points.
    it('signale l’absence de métier comme un MANQUE', () => {
      const rapport = diagnostic({ occupationId: null });

      expect(verdictDe(rapport, QualityCheck.OCCUPATION_LINKED)).toBe(
        'MANQUANT',
      );
      expect(rapport.level).toBe('INCOMPLETE');
    });

    it('signale une description trop courte, sans la refuser', () => {
      const rapport = diagnostic({ description: 'Stage de trois mois.' });

      expect(verdictDe(rapport, QualityCheck.DESCRIPTION_SUBSTANTIAL)).toBe(
        'A_AMELIORER',
      );
      expect(rapport.level).toBe('PERFECTIBLE');
    });

    it('signale un intitulé de moins de trois mots', () => {
      const rapport = diagnostic({ title: 'Stage' });

      expect(verdictDe(rapport, QualityCheck.TITLE_INFORMATIVE)).toBe(
        'A_AMELIORER',
      );
    });

    it('signale l’absence de date de début', () => {
      const rapport = diagnostic({ startsAt: null });

      expect(verdictDe(rapport, QualityCheck.START_DATE_SET)).toBe(
        'A_AMELIORER',
      );
    });

    it('signale une offre publiée depuis plus de soixante jours', () => {
      const rapport = diagnostic({
        publishedAt: new Date('2026-05-01T12:00:00Z'),
      });

      expect(verdictDe(rapport, QualityCheck.STILL_FRESH)).toBe('A_AMELIORER');
    });

    // Un brouillon n'a pas d'ancienneté à lui reprocher : le lui reprocher
    // découragerait le travail préparatoire que la plateforme veut encourager.
    it('ne reproche pas son ancienneté à un brouillon', () => {
      const rapport = diagnostic({
        status: OpportunityStatus.DRAFT,
        publishedAt: null,
      });

      expect(verdictDe(rapport, QualityCheck.STILL_FRESH)).toBe('OK');
    });

    // Une offre à distance est partout : lui réclamer une ville n'a pas de sens.
    it('n’exige pas de ville pour une offre à distance', () => {
      const rapport = diagnostic({ workMode: 'REMOTE', city: '' });

      expect(verdictDe(rapport, QualityCheck.LOCATION_USABLE)).toBe('OK');
    });

    it('signale une offre sur site sans ville', () => {
      const rapport = diagnostic({ workMode: 'ON_SITE', city: '   ' });

      expect(verdictDe(rapport, QualityCheck.LOCATION_USABLE)).toBe('MANQUANT');
    });

    // Chaque point à corriger porte son code de recommandation ; les points au
    // vert n'en portent pas. C'est ce qui permet à l'interface d'afficher un
    // conseil sans que le service écrive une phrase — l'application existe en
    // cinq langues.
    it('n’attache une recommandation qu’aux points à corriger', () => {
      const rapport = diagnostic({ _count: { skills: 0 }, title: 'Stage' });

      for (const point of rapport.points) {
        if (point.verdict === 'OK') {
          expect(point.recommendation).toBeUndefined();
        } else {
          expect(point.recommendation).toBe(point.check);
        }
      }
    });

    // Un manque l'emporte sur un point perfectible : les deux points qui
    // peuvent manquer valent 60 des 100 points du barème.
    it('classe INCOMPLETE dès qu’un point manque, même si d’autres sont bons', () => {
      const rapport = diagnostic({
        occupationId: null,
        title: 'Stage',
      });

      expect(rapport.level).toBe('INCOMPLETE');
    });
  });
});
