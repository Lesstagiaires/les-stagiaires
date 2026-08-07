import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

// Enregistre un FAIT verifiable — date et reference du Contrat d'Apporteur
// d'Affaires signe — et non un simple drapeau d'autorisation.
export class SignContractDto {
  // Facultative : le contrat peut avoir ete signe avant son enregistrement, mais
  // le cas courant est la signature du jour. Le service retient alors la date
  // courante — l'exiger ici obligeait a la saisir sans raison.
  @IsOptional()
  @IsDateString()
  signedAt?: string;

  @IsString()
  @MinLength(3)
  contractReference: string;
}
