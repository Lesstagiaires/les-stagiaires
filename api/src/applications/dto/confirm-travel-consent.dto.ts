import { IsString, Length } from 'class-validator';

export class ConfirmTravelConsentDto {
  @IsString()
  @Length(6, 6)
  code: string;
}
