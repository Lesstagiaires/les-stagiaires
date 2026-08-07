import { IsString, Length } from 'class-validator';

// Une étape du cycle de versement qui ne communique rien à l'ambassadeur :
// contrôle, approbation, contresignature, confirmation.
//
// UN SEUL CHAMP, et il est interne. Ces étapes n'ont pas de motif communicable
// parce qu'elles n'ont rien à annoncer : l'ambassadeur apprend que son versement
// est validé, puis qu'il est parti — pas le détail de qui a signé quoi.
//
// La note reste OBLIGATOIRE. Sur un flux financier, une signature sans un mot est
// exactement ce qu'on ne saura plus justifier dans un an, et c'est la première
// chose qu'un contrôleur demandera.
export class PayoutStepDto {
  @IsString()
  @Length(10, 1000)
  internalNote: string;
}
