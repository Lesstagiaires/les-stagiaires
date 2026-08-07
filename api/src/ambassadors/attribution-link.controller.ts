import { Controller, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { AttributionKitService } from './attribution-kit.service';

// ============================================================================
// LA ROUTE PUBLIQUE DE PARRAINAGE — `/r/:code`
//
// Arbitrage 10 du promoteur, 2026-08-02 : « comportement extérieur identique
// que le code soit valide ou non ; aucune réponse ne doit permettre d'énumérer
// les codes actifs ; un code invalide ne bloque jamais l'inscription ».
//
// UN CONTRÔLEUR À PART, et hors du préfixe `/ambassadors` : ce lien se colle
// dans un groupe WhatsApp, se lit sur une affiche, se tape à la main. Il doit
// être court. `/r/K7RQ4M` tient sur une carte de visite ; une URL de trois
// segments, non.
//
// LIMITATION DE DÉBIT RESSERRÉE. C'est la seule route publique du module, et
// celle qu'un attaquant essaierait de balayer pour découvrir des codes actifs.
// La réponse constante lui retire déjà tout signal ; le débit lui retire le
// volume.
// ============================================================================
@Controller('r')
export class AttributionLinkController {
  constructor(private readonly kit: AttributionKitService) {}

  // 200, TOUJOURS. Ni 404 pour un code inconnu, ni redirection différenciée :
  // un statut HTTP distinct serait un oracle aussi bavard qu'un message.
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Get(':code')
  resolve(@Param('code') code: string) {
    return this.kit.resolvePublicLink(code);
  }
}
