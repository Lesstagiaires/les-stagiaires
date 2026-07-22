import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  identifier: string; // téléphone ou email

  @IsString()
  @MinLength(1)
  password: string;
}
