import { IsEnum } from 'class-validator';
import { SectionVisibility } from '../../../generated/prisma/enums';

export class SetVisibilityDto {
  @IsEnum(SectionVisibility)
  visibility: SectionVisibility;
}
