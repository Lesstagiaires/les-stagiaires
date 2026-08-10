import { Injectable, NotFoundException } from '@nestjs/common';
import { MinorGatedAction } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertCountryPolicyDto } from './dto/upsert-country-policy.dto';

export interface ResolvedCountryPolicy {
  countryCode: string;
  minInternshipAge: number;
  minParentRequiredAge: number;
  civilMajorityAge: number;
  parentalInfoMaxAge: number;
  // Délais avant qu'une nouvelle demande de consentement soit recevable après
  // un refus parental. Croissants (1er refus, 2e, puis 3e et suivants).
  refusalDelay1Days: number;
  refusalDelay2Days: number;
  refusalDelayFinalDays: number;
  gatedActions: MinorGatedAction[];
  // true si aucune CountryPolicy n'est configurée pour ce pays et que la politique de
  // repli sûre s'applique (CLAUDE.md §5 : jamais d'absence de protection par défaut).
  isFallback: boolean;
}

// Politique de repli si un pays n'a jamais été configuré en administration — la plus
// protectrice possible plutôt que "pas de règle du tout" (CLAUDE.md §5).
//
// ATTENTION lors de l'ajout d'une nouvelle valeur à MinorGatedAction : l'ajouter ici ne
// protège que les pays SANS ligne CountryPolicy en base. Toute CountryPolicy déjà
// configurée garde sa propre liste gatedActions figée — la politique de repli ne
// s'applique jamais tant qu'une ligne existe pour ce pays. Écrire aussi une migration de
// données qui ajoute la nouvelle action aux gatedActions de toutes les CountryPolicy
// existantes qui ne l'ont pas déjà (voir la migration
// 20260728074326_backfill_subscription_org_sponsored_gated_action pour l'exemple) —
// sinon la protection reste silencieusement absente dans tout pays déjà configuré
// (régression détectée en recette finale sur SUBSCRIPTION_ORG_SPONSORED : le compte CM
// de développement avait déjà une CountryPolicy sans cette action).
const FALLBACK_POLICY: Omit<
  ResolvedCountryPolicy,
  'countryCode' | 'isFallback'
> = {
  minInternshipAge: 16,
  minParentRequiredAge: 16,
  civilMajorityAge: 18,
  // Le repli reste PRUDENT : il ne propose aucun champ parent au-delà de la
  // majorité. Un pays non configuré ne doit pas se voir prêter une politique
  // que personne n'a arbitrée pour lui.
  parentalInfoMaxAge: 18,
  // Les valeurs arbitrées le 2026-08-08, reprises telles quelles.
  //
  // Ici le repli ne peut pas être « le plus protecteur possible » sans choisir
  // QUI il protège. Allonger les délais protège la décision du parent ; les
  // raccourcir protège la capacité du mineur à faire valoir son cas. Aucun des
  // deux ne domine l'autre, alors on ne prétend pas trancher : on reprend les
  // délais que le promoteur a effectivement arbitrés, plutôt qu'un extrême que
  // personne n'a demandé.
  refusalDelay1Days: 7,
  refusalDelay2Days: 30,
  refusalDelayFinalDays: 182,
  gatedActions: [
    MinorGatedAction.REGISTRATION,
    MinorGatedAction.APPLICATION_SUBMIT,
    MinorGatedAction.ACCEPT_OFFER,
    MinorGatedAction.SIGN_CONVENTION,
    MinorGatedAction.MOBILITY,
    MinorGatedAction.DIGITAL_SAFE_SHARE,
    MinorGatedAction.SUBSCRIPTION_ORG_SPONSORED,
  ],
};

@Injectable()
export class CountryPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async resolve(countryCode: string): Promise<ResolvedCountryPolicy> {
    const policy = await this.prisma.countryPolicy.findUnique({
      where: { countryCode },
    });
    if (!policy) {
      return { countryCode, ...FALLBACK_POLICY, isFallback: true };
    }
    return {
      countryCode: policy.countryCode,
      minInternshipAge: policy.minInternshipAge,
      minParentRequiredAge: policy.minParentRequiredAge,
      civilMajorityAge: policy.civilMajorityAge,
      parentalInfoMaxAge: policy.parentalInfoMaxAge,
      refusalDelay1Days: policy.refusalDelay1Days,
      refusalDelay2Days: policy.refusalDelay2Days,
      refusalDelayFinalDays: policy.refusalDelayFinalDays,
      gatedActions: policy.gatedActions,
      isFallback: false,
    };
  }

  async list() {
    return this.prisma.countryPolicy.findMany({
      orderBy: { countryCode: 'asc' },
    });
  }

  // Création ou mise à jour complète — un pays n'a qu'une seule politique active à la fois.
  async upsert(
    adminId: string,
    countryCode: string,
    dto: UpsertCountryPolicyDto,
  ) {
    const policy = await this.prisma.countryPolicy.upsert({
      where: { countryCode },
      update: {
        minInternshipAge: dto.minInternshipAge,
        minParentRequiredAge: dto.minParentRequiredAge,
        civilMajorityAge: dto.civilMajorityAge,
        parentalInfoMaxAge: dto.parentalInfoMaxAge,
        refusalDelay1Days: dto.refusalDelay1Days,
        refusalDelay2Days: dto.refusalDelay2Days,
        refusalDelayFinalDays: dto.refusalDelayFinalDays,
        gatedActions: dto.gatedActions,
      },
      create: {
        countryCode,
        minInternshipAge: dto.minInternshipAge,
        minParentRequiredAge: dto.minParentRequiredAge,
        civilMajorityAge: dto.civilMajorityAge,
        parentalInfoMaxAge: dto.parentalInfoMaxAge,
        refusalDelay1Days: dto.refusalDelay1Days,
        refusalDelay2Days: dto.refusalDelay2Days,
        refusalDelayFinalDays: dto.refusalDelayFinalDays,
        gatedActions: dto.gatedActions,
      },
    });
    await this.audit.record('COUNTRY_POLICY_UPSERTED', adminId, {
      countryCode,
    });
    return policy;
  }

  async remove(adminId: string, countryCode: string) {
    const policy = await this.prisma.countryPolicy.findUnique({
      where: { countryCode },
    });
    if (!policy)
      throw new NotFoundException('Politique introuvable pour ce pays.');
    await this.prisma.countryPolicy.delete({ where: { countryCode } });
    await this.audit.record('COUNTRY_POLICY_REMOVED', adminId, { countryCode });
    return {
      message:
        "Politique supprimée — la politique de repli sûre s'applique désormais.",
    };
  }
}
