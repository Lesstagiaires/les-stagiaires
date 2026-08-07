import { IsString, Length } from 'class-validator';

// Motif obligatoire, partagé par le refus, la suspension et la rupture. Une organisation
// doit toujours pouvoir savoir POURQUOI son badge lui est retiré ou refusé — une décision
// muette est indéfendable et rend toute contestation impossible.
export class PartnershipReasonDto {
  @IsString()
  @Length(10, 1000)
  reason: string;
}
