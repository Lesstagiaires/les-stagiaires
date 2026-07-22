import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;
}
