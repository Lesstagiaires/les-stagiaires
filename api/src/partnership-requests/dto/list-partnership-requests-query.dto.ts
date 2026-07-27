import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PartnershipRequestReason,
  PartnershipRequestStatus,
} from '../../../generated/prisma/enums';

export class ListPartnershipRequestsQueryDto {
  @IsOptional()
  @IsEnum(PartnershipRequestStatus)
  status?: PartnershipRequestStatus;

  @IsOptional()
  @IsEnum(PartnershipRequestReason)
  reason?: PartnershipRequestReason;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
