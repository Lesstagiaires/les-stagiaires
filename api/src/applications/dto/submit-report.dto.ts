import { IsString } from 'class-validator';

export class SubmitReportDto {
  @IsString()
  digitalSafeDocumentId: string;
}
