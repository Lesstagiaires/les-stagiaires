import {
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
} from 'class-validator';

// Facultatif, y compris pour un compte majeur — jamais requis pour un mineur, qui a
// déjà un parent/tuteur rattaché via ParentalLink (cahier des charges).
export class UpdateEmergencyContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsPhoneNumber(undefined, {
    message: 'Numéro de téléphone invalide (format international requis)',
  })
  phone?: string;
}
