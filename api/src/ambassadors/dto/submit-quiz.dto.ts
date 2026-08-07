import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

// Une réponse : la question, et l'indice choisi.
export class QuizAnswerDto {
  @IsString()
  @Length(1, 40)
  questionId: string;

  // L'INDICE, jamais le texte. Un texte se compare mal — accents, espaces,
  // casse — et chaque comparaison approximative est une occasion de valider une
  // mauvaise réponse.
  @IsInt()
  @Min(0)
  choiceIndex: number;
}

// Soumission d'une tentative de quiz.
//
// CE QUI N'EST PAS ICI, ET C'EST TOUT LE SUJET : aucun score, aucun décompte de
// tentative, aucun indicateur de réussite. Le client envoie ce qu'il a répondu ;
// le serveur corrige, compte et décide.
//
// « Le frontend ne fait qu'afficher. Le backend décide. » (SKILL SECURITY FIRST
// §5). Accepter un score calculé côté client reviendrait à laisser chacun
// s'attribuer sa note.
export class SubmitQuizDto {
  @IsArray()
  @ArrayMinSize(1)
  // Borne haute : une soumission de dix mille réponses ferait travailler le
  // serveur pour rien. Le quiz réel en compte quelques dizaines.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers: QuizAnswerDto[];
}
