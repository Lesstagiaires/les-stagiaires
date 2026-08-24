import { IsEnum } from 'class-validator';
import { OrganizationCategory } from '../../../generated/prisma/enums';

export class ChangeOrganizationCategoryDto {
  // Un seul champ, et JAMAIS nullable : une fois déclarée, la catégorie ne se
  // reprend pas. `@IsEnum` ferme la porte à `null` comme à toute valeur
  // inventée, et le service vérifie ensuite l'appartenance à la famille — une
  // école peut se dire université, jamais entreprise.
  @IsEnum(OrganizationCategory)
  category: OrganizationCategory;
}
