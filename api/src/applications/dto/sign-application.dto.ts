import { IsString, MaxLength, MinLength } from 'class-validator';

export class SignApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;
}
