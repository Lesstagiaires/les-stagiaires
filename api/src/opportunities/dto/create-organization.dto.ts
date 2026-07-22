import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sector?: string;

  @IsString()
  @MaxLength(100)
  country: string;

  @IsString()
  @MaxLength(100)
  city: string;
}
