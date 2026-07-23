import { IsPhoneNumber } from 'class-validator';

export class InviteLearnerDto {
  @IsPhoneNumber(undefined, {
    message:
      'Numéro de téléphone invalide (format international requis, ex: +237...)',
  })
  phone: string;
}
