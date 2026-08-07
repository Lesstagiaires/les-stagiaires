import { IsString, MinLength } from 'class-validator';

// Motif obligatoire : une suspension ou une sortie du programme a des consequences
// financieres directes. L'interesse doit toujours savoir pourquoi, jamais subir une
// decision muette (CLAUDE.md paragraphe 3).
export class AmbassadorReasonDto {
  @IsString()
  @MinLength(10)
  reason: string;
}
