import { IsEnum, IsString, Length } from 'class-validator';
import { ReportCategory } from '../../../generated/prisma/enums';

export class CreateReportDto {
  @IsEnum(ReportCategory)
  category: ReportCategory;

  @IsString()
  @Length(10, 2000)
  description: string;
}
