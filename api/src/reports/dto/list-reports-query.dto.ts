import { IsEnum, IsOptional } from 'class-validator';
import { ReportStatus } from '../../../generated/prisma/enums';

export class ListReportsQueryDto {
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}
