import {
  IsPhoneNumber,
  IsString,
  IsStrongPassword,
  Length,
} from 'class-validator';

export class ResetPasswordDto {
  @IsPhoneNumber(undefined)
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;

  @IsStrongPassword(
    {
      minLength: 10,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 0,
    },
    {
      message:
        'Mot de passe trop faible (10 caractères minimum, majuscule, minuscule, chiffre)',
    },
  )
  newPassword: string;
}
