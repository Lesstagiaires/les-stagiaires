import { IsBoolean, IsOptional, IsString } from 'class-validator';

// L'un de organizationId (candidature spontanée, FR-M5-010/FR-M4-011) ou opportunityId
// (candidature sur offre publiée) doit être fourni — jamais les deux, validé en service.
export class CreateApplicationDto {
  @IsOptional()
  @IsString()
  opportunityId?: string;

  @IsOptional()
  @IsString()
  organizationId?: string;

  // FR-M4-005 : recueillie seulement si l'offre exige une relocalisation — ignorée sinon.
  @IsOptional()
  @IsBoolean()
  willingToRelocate?: boolean;
}
