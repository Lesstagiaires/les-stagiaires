import { IsString, MinLength } from 'class-validator';

export class RejectPayoutDto {
  @IsString()
  @MinLength(10)
  reason: string;
}
