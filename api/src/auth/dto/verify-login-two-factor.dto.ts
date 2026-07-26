import { IsString, Length } from 'class-validator';

export class VerifyLoginTwoFactorDto {
  @IsString()
  challengeToken: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
