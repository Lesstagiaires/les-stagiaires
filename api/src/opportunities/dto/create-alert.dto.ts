import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OpportunityType } from '../../../generated/prisma/enums';

export class CreateAlertDto {
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
}
