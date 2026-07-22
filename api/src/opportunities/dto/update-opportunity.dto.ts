import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateOpportunityDto } from './create-opportunity.dto';

export class UpdateOpportunityDto extends PartialType(
  OmitType(CreateOpportunityDto, ['organizationId'] as const),
) {}
