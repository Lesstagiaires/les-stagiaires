import { IsString, Length } from 'class-validator';

export class AddPartnershipRequestNoteDto {
  @IsString()
  @Length(1, 2000)
  content: string;
}
