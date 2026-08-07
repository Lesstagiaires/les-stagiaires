import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { OpportunityType } from '../../../generated/prisma/enums';

export class SearchOpportunitiesDto {
  // MOTS-CLÉS. Ils n'existaient pas : on ne pouvait chercher que par listes
  // déroulantes. Le service les échappe avant de les passer à `to_tsquery` —
  // jamais de concaténation, jamais de `$queryRawUnsafe` (SKILL SECURITY
  // FIRST §6, requêtes paramétrées).
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Matches(/^[^<>{}\\]*$/, {
    message: 'La recherche ne peut pas contenir de balisage (< > { } \\).',
  })
  q?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  sector?: string;

  @IsOptional()
  @IsEnum(OpportunityType)
  type?: OpportunityType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
