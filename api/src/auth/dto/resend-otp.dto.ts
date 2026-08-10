import { IsPhoneNumber } from 'class-validator';

// Le numéro seul. Aucun mot de passe, aucun jeton : la route sert précisément
// aux comptes qui ne peuvent pas encore se connecter.
export class ResendOtpDto {
  @IsPhoneNumber(undefined)
  phone: string;
}
