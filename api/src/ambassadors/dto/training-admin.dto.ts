import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

// Création ou remplacement d'un module de formation (back-office ADMIN).
export class CreateTrainingModuleDto {
  // Identifiant STABLE à travers les versions : le module « Déontologie » garde
  // son code quand son contenu change. C'est lui qui fait la lignée.
  @IsString()
  @Length(2, 40)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'Le code d’un module s’écrit en majuscules, chiffres et tirets bas (ex. DEONTOLOGIE).',
  })
  code: string;

  @IsString()
  @Length(3, 200)
  title: string;

  // Contenu pédagogique. Niveau « Public » : un module de formation n'a rien de
  // confidentiel. Le balisage est refusé à la frontière — ce texte s'affiche.
  @IsString()
  @Length(20, 20000)
  @Matches(/^[^<>]*$/, {
    message: 'Le contenu ne peut pas contenir de balisage (< >).',
  })
  body: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  // Absent = tous pays.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'Le code pays doit être au format ISO 3166-1 alpha-2.',
  })
  countryCode?: string;
}

// Création d'une question de quiz (back-office ADMIN).
//
// `correctIndex` figure ici, et ne peut pas ne pas y figurer : quelqu'un doit
// bien écrire les réponses. Ce niveau relève de l'« Interne » (CLAUDE.md §1) —
// accès par rôle, ADMIN avec double authentification. La garantie qui compte
// reste celle du service candidat : ce champ ne franchit jamais la frontière
// vers un non-administrateur.
export class CreateQuizQuestionDto {
  @IsOptional()
  @IsString()
  @Length(1, 40)
  moduleId?: string;

  @IsString()
  @Length(10, 500)
  @Matches(/^[^<>]*$/, {
    message: 'L’énoncé ne peut pas contenir de balisage (< >).',
  })
  prompt: string;

  // Deux propositions au minimum : une question à choix unique n'en est pas une.
  // Six au maximum — au-delà, l'énoncé est mal découpé, pas plus exigeant.
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @Length(1, 300, { each: true })
  choices: string[];

  // Le service ET la base vérifient qu'il désigne une proposition existante.
  @IsInt()
  @Min(0)
  correctIndex: number;
}
