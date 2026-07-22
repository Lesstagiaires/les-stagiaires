import { IsString, Length } from 'class-validator';

export class CreateRecommendationDto {
  @IsString()
  @Length(10, 2000)
  message: string;
}
