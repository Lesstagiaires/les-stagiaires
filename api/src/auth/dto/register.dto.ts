import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsPhoneNumber,
  IsStrongPassword,
  IsString,
} from 'class-validator';
import { Language } from '../../../generated/prisma/enums';

export class RegisterDto {
  @IsPhoneNumber(undefined, {
    message:
      'Numéro de téléphone invalide (format international requis, ex: +237...)',
  })
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
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
  password: string;

  @IsEnum(Language)
  language: Language;

  @IsDateString()
  dateOfBirth: string;
}
