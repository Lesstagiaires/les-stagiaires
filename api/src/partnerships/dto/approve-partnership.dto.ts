import { IsDateString, IsOptional } from 'class-validator';

export class ApprovePartnershipDto {
  // Date de signature du contrat de partenariat, saisissable parce qu'elle peut
  // différer de la date de la décision administrative. Purement informative : aucune
  // date de fin n'en est jamais dérivée (décision du promoteur du 2026-07-31).
  // À défaut, la date du jour est retenue.
  @IsOptional()
  @IsDateString()
  signedAt?: string;
}
