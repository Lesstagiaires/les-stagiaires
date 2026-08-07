import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  EducationLevel,
  OpportunityType,
  WorkMode,
} from '../../../generated/prisma/enums';

// Une compétence attendue par l'offre.
//
// `required` distingue le prérequis du « plus » : le moteur de pertinence fait
// compter double une compétence exigée, parce que manquer un prérequis n'est
// pas la même chose que manquer un atout.
export class OpportunitySkillDto {
  @IsString()
  skillId: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class CreateOpportunityDto {
  @IsString()
  organizationId: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @MaxLength(5000)
  description: string;

  @IsEnum(OpportunityType)
  type: OpportunityType;

  @IsString()
  @MaxLength(100)
  sector: string;

  @IsString()
  @MaxLength(100)
  country: string;

  @IsString()
  @MaxLength(100)
  city: string;

  @IsOptional()
  @IsEnum(WorkMode)
  workMode?: WorkMode;

  @IsOptional()
  @IsBoolean()
  relocationRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  accommodationProvided?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  mobilityBenefits?: string;

  // --- Ce dont le moteur de pertinence a besoin -----------------------------
  //
  // Ces quatre champs existaient au schéma sans qu'aucune route ne permette de
  // les remplir : le classement par pertinence tournait donc sur des offres
  // vides de tout ce qui sert à les rapprocher de quelqu'un. Ajoutés le
  // 2026-08-07 avec le diagnostic de qualité, qui les réclame à l'entreprise.
  //
  // Tous FACULTATIFS : une offre incomplète doit pouvoir être publiée. Le
  // diagnostic dit ce qui manque, il n'interdit rien.

  // Le métier, dans le référentiel commun. 25 points du barème en dépendent.
  @IsOptional()
  @IsString()
  occupationId?: string;

  // Le niveau d'études minimum. Ne PAS le renseigner n'exclut personne et
  // n'abîme pas le classement — c'est un service rendu au candidat, qui saura
  // s'il peut postuler.
  @IsOptional()
  @IsEnum(EducationLevel)
  minEducationLevel?: EducationLevel;

  // Quand le poste commence, comparé à la date de disponibilité du candidat.
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  // Les compétences attendues — 35 points, le critère le plus lourd. La borne
  // haute n'est pas décorative : une offre qui exigerait quarante compétences
  // ne serait jamais satisfaite par personne, et se classerait mal partout.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => OpportunitySkillDto)
  skills?: OpportunitySkillDto[];
}
