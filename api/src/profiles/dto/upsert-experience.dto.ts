import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertExperienceDto {
  @IsString()
  @MaxLength(200)
  organization: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
