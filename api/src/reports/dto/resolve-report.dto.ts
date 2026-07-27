import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ReportStatus } from '../../../generated/prisma/enums';

export class ResolveReportDto {
  @IsEnum(ReportStatus)
  status: ReportStatus;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;
}
