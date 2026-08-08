import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import { MinorGatedAction } from '../../../generated/prisma/enums';

export class UpsertCountryPolicyDto {
  @IsInt()
  @Min(0)
  @Max(30)
  minInternshipAge: number;

  @IsInt()
  @Min(0)
  @Max(30)
  minParentRequiredAge: number;

  @IsInt()
  @Min(15)
  @Max(30)
  civilMajorityAge: number;

  // Âge au-delà duquel plus aucun champ parent n'est affiché. Entre la
  // majorité civile et cette valeur, le contact parental est proposé par
  // COURTOISIE — jamais avec un effet fonctionnel.
  @IsInt()
  @Min(15)
  @Max(30)
  parentalInfoMaxAge: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(MinorGatedAction, { each: true })
  gatedActions: MinorGatedAction[];
}
