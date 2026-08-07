import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsPhoneNumber,
  IsStrongPassword,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { Language, Sex } from '../../../generated/prisma/enums';

export class RegisterDto {
  @IsString()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MaxLength(100)
  lastName: string;

  @IsEnum(Sex)
  sex: Sex;

  @IsPhoneNumber(undefined, {
    message:
      'Numéro de téléphone invalide (format international requis, ex: +237...)',
  })
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MaxLength(100)
  cityOfResidence: string;

  // Code pays ISO 3166-1 alpha-2 (ex: CM, SN, AO) — pilote la résolution de la
  // politique de protection des mineurs applicable (jamais un seuil fixe).
  @IsString()
  @Length(2, 2)
  countryOfResidence: string;

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

  // Requis si l'âge du candidat, croisé avec la politique de son pays de résidence,
  // exige un parent/tuteur — jamais un seuil d'âge fixe (moteur de règles CountryPolicy).
  @IsOptional()
  @IsPhoneNumber(undefined, {
    message:
      'Numéro de téléphone du parent/tuteur invalide (format international requis)',
  })
  parentPhone?: string;

  // Code, lien personnel ou QR d'un ambassadeur (point 10 des arbitrages du
  // 2026-07-31). Volontairement optionnel et sans message d'erreur métier : un
  // code inconnu, expiré ou appartenant à un ambassadeur suspendu est ignoré en
  // silence. Une inscription ne doit JAMAIS échouer à cause d'un code de
  // parrainage — le jeune perdrait son compte pour une raison qui ne le concerne
  // pas.
  @IsOptional()
  @IsString()
  @Length(4, 20)
  ambassadorCode?: string;
}
