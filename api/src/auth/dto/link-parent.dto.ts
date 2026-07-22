import { IsPhoneNumber } from 'class-validator';

export class LinkParentDto {
  @IsPhoneNumber(undefined, {
    message: 'Numéro de téléphone du parent/représentant légal invalide',
  })
  parentPhone: string;
}
