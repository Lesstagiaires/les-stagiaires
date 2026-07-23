import { IsEnum } from 'class-validator';
import { InternshipCampaignStatus } from '../../../generated/prisma/enums';

export class UpdateCampaignStatusDto {
  @IsEnum(InternshipCampaignStatus)
  status: InternshipCampaignStatus;
}
