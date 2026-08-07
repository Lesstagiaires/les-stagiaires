import { IsString, MinLength } from 'class-validator';

export class ExecutePayoutDto {
  // Reference du virement reellement passe, saisie par l'administration apres coup.
  @IsString()
  @MinLength(3)
  executionReference: string;
}
