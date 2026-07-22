import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class ProposeInterviewDto {
  @IsDateString()
  proposedAt: string;

  @IsString()
  @MaxLength(100)
  mode: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;
}
