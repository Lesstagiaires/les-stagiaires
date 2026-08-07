import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum ApplicationDecision {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export class DecideApplicationDto {
  @IsEnum(ApplicationDecision)
  decision: ApplicationDecision;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  // Dates réelles du stage, déclarées par l'organisation au moment où elle accepte.
  // Facultatives : une acceptation reste possible sans dates arrêtées, mais le
  // rappel de début de stage ne pourra alors pas se déclencher — il ignore les
  // candidatures sans date plutôt que d'en inventer une.
  @IsOptional()
  @IsDateString()
  internshipStartDate?: string;

  @IsOptional()
  @IsDateString()
  internshipEndDate?: string;
}
