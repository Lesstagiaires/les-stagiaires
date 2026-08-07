import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PartnershipStatus } from '../../../generated/prisma/enums';

// Pagination et filtrage exigés par le cahier des charges — la file d'attente
// d'administration ne doit jamais renvoyer la table entière.
export class ListPartnershipsQueryDto {
  @IsOptional()
  @IsEnum(PartnershipStatus)
  status?: PartnershipStatus;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

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
