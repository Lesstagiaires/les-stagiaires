import { IsString, MaxLength } from 'class-validator';

export class RenameDigitalSafeDocumentDto {
  @IsString()
  @MaxLength(200)
  title: string;
}
