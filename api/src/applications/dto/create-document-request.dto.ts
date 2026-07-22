import { IsString, MaxLength } from 'class-validator';

export class CreateDocumentRequestDto {
  @IsString()
  @MaxLength(500)
  description: string;
}
