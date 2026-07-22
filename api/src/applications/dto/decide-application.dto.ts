import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
