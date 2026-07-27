import { IsEnum } from 'class-validator';
import { PartnershipRequestStatus } from '../../../generated/prisma/enums';

export class UpdatePartnershipRequestStatusDto {
  @IsEnum(PartnershipRequestStatus)
  status: PartnershipRequestStatus;
}
