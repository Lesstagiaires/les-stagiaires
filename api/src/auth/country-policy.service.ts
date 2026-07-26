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
  gatedActions: MinorGatedAction[];
  // true si aucune CountryPolicy n'est configurée pour ce pays et que la politique de
  // repli sûre s'applique (CLAUDE.md §5 : jamais d'absence de protection par défaut).
  isFallback: boolean;
}

// Politique de repli si un pays n'a jamais été configuré en administration — la plus
// protectrice possible plutôt que "pas de règle du tout" (CLAUDE.md §5).
const FALLBACK_POLICY: Omit<ResolvedCountryPolicy, 'countryCode' | 'isFallback'> = {
  minInternshipAge: 16,
  minParentRequiredAge: 16,
  civilMajorityAge: 18,
  gatedActions: [
    MinorGatedAction.REGISTRATION,
    MinorGatedAction.APPLICATION_SUBMIT,
    MinorGatedAction.ACCEPT_OFFER,
    MinorGatedAction.SIGN_CONVENTION,
    MinorGatedAction.MOBILITY,
    MinorGatedAction.DIGITAL_SAFE_SHARE,
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
      gatedActions: policy.gatedActions,
      isFallback: false,
    };
  }

  async list() {
    return this.prisma.countryPolicy.findMany({ orderBy: { countryCode: 'asc' } });
  }

  // Création ou mise à jour complète — un pays n'a qu'une seule politique active à la fois.
  async upsert(adminId: string, countryCode: string, dto: UpsertCountryPolicyDto) {
    const policy = await this.prisma.countryPolicy.upsert({
      where: { countryCode },
      update: {
        minInternshipAge: dto.minInternshipAge,
        minParentRequiredAge: dto.minParentRequiredAge,
        civilMajorityAge: dto.civilMajorityAge,
        gatedActions: dto.gatedActions,
      },
      create: {
        countryCode,
        minInternshipAge: dto.minInternshipAge,
        minParentRequiredAge: dto.minParentRequiredAge,
        civilMajorityAge: dto.civilMajorityAge,
        gatedActions: dto.gatedActions,
      },
    });
    await this.audit.record('COUNTRY_POLICY_UPSERTED', adminId, { countryCode });
    return policy;
  }

  async remove(adminId: string, countryCode: string) {
    const policy = await this.prisma.countryPolicy.findUnique({ where: { countryCode } });
    if (!policy) throw new NotFoundException('Politique introuvable pour ce pays.');
    await this.prisma.countryPolicy.delete({ where: { countryCode } });
    await this.audit.record('COUNTRY_POLICY_REMOVED', adminId, { countryCode });
    return { message: 'Politique supprimée — la politique de repli sûre s\'applique désormais.' };
  }
}
