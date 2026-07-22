import { IsPhoneNumber } from 'class-validator';

export class ForgotPasswordDto {
  @IsPhoneNumber(undefined)
  phone: string;
}
