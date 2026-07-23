import { IsDateString, IsString, MaxLength } from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
