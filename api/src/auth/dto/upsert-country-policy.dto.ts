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

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(MinorGatedAction, { each: true })
  gatedActions: MinorGatedAction[];
}
