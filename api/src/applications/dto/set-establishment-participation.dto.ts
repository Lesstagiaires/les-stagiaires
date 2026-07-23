import { IsBoolean } from 'class-validator';

export class SetEstablishmentParticipationDto {
  @IsBoolean()
  requested: boolean;
}
