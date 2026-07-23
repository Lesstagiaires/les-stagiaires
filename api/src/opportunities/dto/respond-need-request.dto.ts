import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum NeedRequestDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class RespondNeedRequestDto {
  @IsEnum(NeedRequestDecision)
  decision: NeedRequestDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
