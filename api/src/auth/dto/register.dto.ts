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

  // Requis si l'utilisateur est mineur (vérifié en service, calculé depuis dateOfBirth) —
  // permet le consentement parental actif dès l'inscription (CLAUDE.md §5, FR-AUTH-004a).
  @IsOptional()
  @IsPhoneNumber(undefined, {
    message:
      'Numéro de téléphone du parent/tuteur invalide (format international requis)',
  })
  parentPhone?: string;
}
