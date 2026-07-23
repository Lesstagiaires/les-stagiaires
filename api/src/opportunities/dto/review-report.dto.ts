import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { InternshipReportStatus } from '../../../generated/prisma/enums';

const REVIEW_OUTCOMES = [
  InternshipReportStatus.VALIDATED,
  InternshipReportStatus.NEEDS_REVISION,
];

export class ReviewReportDto {
  @IsIn(REVIEW_OUTCOMES)
  status: InternshipReportStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
