import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedAmbassadorPolicy {
  countryCode: string;
  portfolioExpiryMonths: number;
  portfolioWarnMonths: number[];
  securityPeriodDays: number;
  minPayoutAmountMinor: number;
  // Au-dela de ce montant, une seule approbation ne suffit plus. NULL = pas de
  // double controle dans ce pays (arbitrage 12 du promoteur).
  doubleApprovalThresholdMinor: number | null;
  // Delai de refroidissement apres modification des coordonnees de versement.
  paymentDetailsCooldownHours: number;
  // Delai avant redepot apres refus, et age minimum — tous deux par pays.
  reapplicationDelayMonths: number;
  minAmbassadorAge: number;
  // Quiz bloquant : seuil de reussite et nombre de tentatives, par pays.
  quizPassScorePercent: number;
  quizMaxAttempts: number;
  currency: string;
  commissionsEnabled: boolean;
  payoutsEnabled: boolean;
}

// ============================================================================
// AVERTISSEMENT — À LIRE AVANT D'AJOUTER UN CHAMP À AmbassadorPolicy
//
// Cette politique de repli ne sert QUE lorsqu'aucune ligne n'existe en base pour
// le pays demandé, ni pour le pays, ni pour le joker "*". Elle ne protège donc
// PAS les pays déjà configurés.
//
// La leçon vient de CountryPolicy, où l'ajout d'une action soumise à accord
// parental avait laissé sans protection tous les pays déjà paramétrés : leur
// ligne existait, la nouvelle colonne y valait « vide », et le repli n'était
// jamais consulté. Le trou n'a été trouvé qu'en cherchant volontairement le
// chemin de sécurité jamais exercé.
//
// Toute nouvelle colonne ici doit donc s'accompagner d'une migration de données
// qui renseigne les lignes EXISTANTES. Ajouter un défaut au schéma ne suffit pas
// à protéger l'existant — cela ne protège que les lignes futures.
// ============================================================================
const FALLBACK_POLICY: Omit<ResolvedAmbassadorPolicy, 'countryCode'> = {
  portfolioExpiryMonths: 12,
  portfolioWarnMonths: [9, 11],
  securityPeriodDays: 30,
  minPayoutAmountMinor: 500000,
  // Un pays non configure n'a pas de seuil : il n'a pas non plus de versements
  // ouverts (payoutsEnabled: false ci-dessous), la question ne se pose donc pas.
  // Inventer ici un seuil serait pretendre connaitre ce qu'est un montant eleve
  // dans un pays dont on ne sait rien.
  doubleApprovalThresholdMinor: null,
  // 72 heures, valeur par defaut arretee par le promoteur. Un pays non
  // configure herite du delai le plus protecteur, pas de son absence.
  paymentDetailsCooldownHours: 72,
  // Un pays non configure herite des valeurs les plus protectrices : six mois
  // avant redepot, et la majorite civile la plus courante.
  reapplicationDelayMonths: 6,
  minAmbassadorAge: 18,
  quizPassScorePercent: 80,
  quizMaxAttempts: 3,
  currency: 'XAF',
  // Un pays inconnu peut accumuler des commissions — ne rien enregistrer priverait
  // définitivement un ambassadeur de droits acquis, ce qui est irrattrapable.
  commissionsEnabled: true,
  // ... mais aucun virement n'y part sans décision explicite. Une commission non
  // versée se verse plus tard ; un virement indu ne se reprend pas.
  payoutsEnabled: false,
};

@Injectable()
export class AmbassadorPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    // Nullable : l'organisation d'une entrée de portefeuille peut avoir été
    // supprimée. On retombe alors sur la politique de repli, exactement comme
    // pour un pays non encore configuré.
    countryCode: string | null,
  ): Promise<ResolvedAmbassadorPolicy> {
    if (!countryCode) return { countryCode: '*', ...FALLBACK_POLICY };

    const rows = await this.prisma.ambassadorPolicy.findMany({
      where: { countryCode: { in: [countryCode, '*'] } },
    });

    // Le pays précis l'emporte toujours sur le joker.
    const row =
      rows.find((candidate) => candidate.countryCode === countryCode) ??
      rows.find((candidate) => candidate.countryCode === '*');

    if (!row) return { countryCode, ...FALLBACK_POLICY };

    return {
      countryCode,
      portfolioExpiryMonths: row.portfolioExpiryMonths,
      portfolioWarnMonths: row.portfolioWarnMonths,
      securityPeriodDays: row.securityPeriodDays,
      minPayoutAmountMinor: row.minPayoutAmountMinor,
      doubleApprovalThresholdMinor: row.doubleApprovalThresholdMinor,
      paymentDetailsCooldownHours: row.paymentDetailsCooldownHours,
      reapplicationDelayMonths: row.reapplicationDelayMonths,
      minAmbassadorAge: row.minAmbassadorAge,
      quizPassScorePercent: row.quizPassScorePercent,
      quizMaxAttempts: row.quizMaxAttempts,
      currency: row.currency,
      commissionsEnabled: row.commissionsEnabled,
      payoutsEnabled: row.payoutsEnabled,
    };
  }
}

// Ajoute un nombre de mois à une date en gérant les mois courts : le 31 janvier
// plus un mois donne le 28 (ou 29) février, jamais le 3 mars. Sans cette
// précaution, `setMonth` déborde silencieusement et l'échéance d'un portefeuille
// se décale de quelques jours — un écart minuscule, mais qui porte sur de l'argent
// et que personne ne saurait expliquer à l'ambassadeur concerné.
// Age revolu en annees. Compte les anniversaires PASSES, pas les annees
// entamees : quelqu un ne du 30 decembre n a pas 18 ans le 2 janvier suivant.
// Un arrondi genereux ici ferait entrer un mineur dans un programme qui verse
// de l argent.
export function yearsBetween(from: Date, to: Date): number {
  let annees = to.getUTCFullYear() - from.getUTCFullYear();
  const moisEcoule = to.getUTCMonth() - from.getUTCMonth();
  if (
    moisEcoule < 0 ||
    (moisEcoule === 0 && to.getUTCDate() < from.getUTCDate())
  ) {
    annees--;
  }
  return annees;
}

export function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const targetMonth = result.getMonth() + months;
  const dayOfMonth = result.getDate();

  result.setDate(1);
  result.setMonth(targetMonth);

  const lastDayOfTargetMonth = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate();
  result.setDate(Math.min(dayOfMonth, lastDayOfTargetMonth));

  return result;
}
