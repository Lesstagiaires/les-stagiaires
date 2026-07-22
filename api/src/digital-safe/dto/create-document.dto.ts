import { IsEnum, IsString, MaxLength } from 'class-validator';
import { DigitalSafeDocumentCategory } from '../../../generated/prisma/enums';

export class CreateDigitalSafeDocumentDto {
  @IsEnum(DigitalSafeDocumentCategory)
  category: DigitalSafeDocumentCategory;

  @IsString()
  @MaxLength(200)
  title: string;
}
