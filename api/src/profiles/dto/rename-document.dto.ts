import { IsString, MaxLength } from 'class-validator';

export class RenameDocumentDto {
  @IsString()
  @MaxLength(200)
  fileName: string;
}
