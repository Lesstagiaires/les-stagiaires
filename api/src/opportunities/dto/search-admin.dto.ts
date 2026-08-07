import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

// Modification d'une pondération de classement.
//
// LA JUSTIFICATION EST OBLIGATOIRE. C'est le champ le plus important de ce
// fichier : le classement est ce que la plateforme promet de ne pas manipuler,
// et le jour où quelqu'un affirmera qu'un poids a été changé pour favoriser un
// annonceur, la seule réponse acceptable sera l'historique — qui, quand, de
// combien à combien, et POURQUOI.
export class UpdateRankingRuleDto {
  @IsInt()
  @Min(0)
  @Max(100)
  weight: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'Le code pays doit être au format ISO 3166-1 alpha-2.',
  })
  countryCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsString()
  @Length(10, 600)
  reason: string;
}

// Libellés dans les cinq langues — un référentiel qui ne serait qu'en français
// exclurait les utilisateurs anglophones, hispanophones, arabophones et
// lusophones de la recherche par compétence.
class MultilingualLabels {
  @IsString()
  @Length(2, 120)
  labelFr: string;

  @IsString()
  @Length(2, 120)
  labelEn: string;

  @IsString()
  @Length(2, 120)
  labelEs: string;

  @IsString()
  @Length(2, 120)
  labelAr: string;

  @IsString()
  @Length(2, 120)
  labelPt: string;
}

export class CreateSkillDto extends MultilingualLabels {
  @IsString()
  @Length(2, 60)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'Le code d’une compétence s’écrit en majuscules, chiffres et tirets bas (ex. JAVASCRIPT).',
  })
  code: string;

  // Regroupement large (« Numérique », « Gestion », « Artisanat »). Sert aussi
  // à la diversification : deux compétences de la même catégorie signalent des
  // offres qui se ressemblent.
  @IsOptional()
  @IsString()
  @Length(2, 60)
  category?: string;
}

export class CreateOccupationDto extends MultilingualLabels {
  @IsString()
  @Length(2, 60)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'Le code d’un métier s’écrit en majuscules, chiffres et tirets bas.',
  })
  code: string;

  // Rattachement à une famille. Absent = c'est une famille.
  @IsOptional()
  @IsString()
  @Length(2, 60)
  parentCode?: string;
}

// Synonyme ou variante. Couvre les trois cas : « JS » → « JavaScript »,
// « RH » → « Ressources humaines », « stage rémunéré » → « stage ».
export class CreateSynonymDto {
  // Le terme tel qu'on le tape. Le service le normalise avant de l'écrire —
  // sans quoi « R.H. » et « rh » seraient deux entrées pour la même chose.
  @IsString()
  @Length(1, 120)
  term: string;

  @IsString()
  @Length(1, 120)
  canonical: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  skillId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  occupationId?: string;
}
