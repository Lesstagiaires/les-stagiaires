import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { OpportunityType } from '../../../generated/prisma/enums';

// Seuls les besoins hors stage classique nécessitent une validation admin préalable
// (SEASONAL/VOLUNTEER/TEMPORARY) — académique/pro/alternance restent directement
// publiables une fois l'organisation vérifiée (FR-M4-002).
const GATED_TYPES = [
  OpportunityType.SEASONAL,
  OpportunityType.VOLUNTEER,
  OpportunityType.TEMPORARY,
];

export class SubmitNeedRequestDto {
  @IsIn(GATED_TYPES)
  type: OpportunityType;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;

  @IsString()
  @MaxLength(2000)
  description: string;
}
