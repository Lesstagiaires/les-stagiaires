import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApplicationStatus } from '../../../generated/prisma/enums';

export class ListReceivedDto {
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  opportunityId?: string;

  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}
