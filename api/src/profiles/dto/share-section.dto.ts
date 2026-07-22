import { IsString } from 'class-validator';

export class ShareSectionDto {
  @IsString()
  userId: string;
}
