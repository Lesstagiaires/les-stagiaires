import { IsInt, Min } from 'class-validator';

// Demande de versement.
//
// NI `method` NI `destinationLabel` DEPUIS LE 2026-08-04. La destination est lue
// sur les COORDONNÉES ENREGISTRÉES de l'ambassadeur, jamais sur la demande.
//
// Ce n'est pas une simplification, c'est ce qui rend le délai de refroidissement
// possible (arbitrage 13 du promoteur). Tant qu'un numéro se saisissait à chaque
// demande, « modifier ses coordonnées » n'était pas un acte datable — et il
// aurait suffi d'en taper un autre pour contourner n'importe quel délai. Laisser
// ces deux champs ici, c'eût été poser un verrou en laissant la porte à côté
// grande ouverte.
export class RequestPayoutDto {
  @IsInt()
  @Min(1)
  amountMinor: number;
}
