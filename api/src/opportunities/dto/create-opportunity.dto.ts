import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { OpportunityType, WorkMode } from '../../../generated/prisma/enums';

export class CreateOpportunityDto {
  @IsString()
  organizationId: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @MaxLength(5000)
  description: string;

  @IsEnum(OpportunityType)
  type: OpportunityType;

  @IsString()
  @MaxLength(100)
  sector: string;

  @IsString()
  @MaxLength(100)
  country: string;

  @IsString()
  @MaxLength(100)
  city: string;

  @IsOptional()
  @IsEnum(WorkMode)
  workMode?: WorkMode;

  @IsOptional()
  @IsBoolean()
  relocationRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  accommodationProvided?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  mobilityBenefits?: string;
}
