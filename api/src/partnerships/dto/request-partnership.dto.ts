import { IsString, Length, Matches } from 'class-validator';

export class RequestPartnershipDto {
  // Nature du partenariat demandé — code du catalogue `PartnershipType`, pas une
  // énumération : la liste s'étend depuis le back-office. L'existence et l'activité
  // du code sont vérifiées en service, contre la base ; ici on ne contrôle que la
  // forme, pour rejeter tout de suite ce qui ne peut pas être un code.
  //
  // Obligatoire : demander « un partenariat » sans dire lequel n'a plus de sens
  // depuis qu'une organisation peut en avoir plusieurs.
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,49}$/, {
    message: 'Le type de partenariat doit être un code du catalogue.',
  })
  typeCode: string;

  // Longueur minimale volontaire : une candidature au programme engage l'organisation et
  // sera lue par un humain. Un champ vide ou d'un mot ne permet pas de décider.
  @IsString()
  @Length(40, 2000)
  motivation: string;
}
