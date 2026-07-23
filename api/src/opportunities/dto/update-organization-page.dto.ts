import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateOrganizationPageDto {
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  website?: string;
}
