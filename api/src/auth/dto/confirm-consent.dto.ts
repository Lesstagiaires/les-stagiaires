import { IsString, Length } from 'class-validator';

export class ConfirmConsentDto {
  @IsString()
  @Length(6, 6)
  code: string;
}
