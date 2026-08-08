import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import { CountryPolicyService } from './country-policy.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { UpsertCountryPolicyDto } from './dto/upsert-country-policy.dto';
import type { AccessTokenPayload } from './token.service';

// ============================================================================
// LES SEUILS D'ÂGE, POUR L'ÉCRAN D'INSCRIPTION
//
// PUBLIQUE, et volontairement. L'application doit savoir, AVANT toute création
// de compte, à partir de quel âge un parent est obligatoire — sinon elle code
// le seuil en dur, ce que le cahier des charges interdit et ce qu'elle faisait
// jusqu'ici avec un « âge < 18 » écrit dans le fichier de l'écran.
//
// ELLE NE PREND PAS LA DATE DE NAISSANCE. C'est le point de conception. On
// pourrait envoyer la date au serveur et recevoir le palier ; ce serait une
// donnée personnelle transmise avant même que l'utilisateur ait accepté quoi
// que ce soit, et elle se retrouverait dans les journaux d'accès HTTP.
//
// On rend donc les SEUILS — des règles publiques, que n'importe qui peut lire
// dans un texte de loi — et le téléphone calcule le palier chez lui. La date de
// naissance ne quitte l'appareil qu'au moment de l'inscription proprement dite.
//
// Ce qui sort ici est réduit aux quatre nombres. La liste des actions bloquées
// (`gatedActions`) reste interne : elle décrit la mécanique de protection, et
// l'écran d'inscription n'en a aucun usage.
// ============================================================================
@Public()
@Controller('auth/age-thresholds')
export class AgeThresholdsController {
  constructor(private readonly countryPolicies: CountryPolicyService) {}

  @Get(':countryCode')
  async forCountry(@Param('countryCode') countryCode: string) {
    const policy = await this.countryPolicies.resolve(
      countryCode.toUpperCase(),
    );
    return {
      countryCode: policy.countryCode,
      minInternshipAge: policy.minInternshipAge,
      minParentRequiredAge: policy.minParentRequiredAge,
      civilMajorityAge: policy.civilMajorityAge,
      parentalInfoMaxAge: policy.parentalInfoMaxAge,
      // Le pays n'est pas encore configuré : l'application peut le signaler
      // plutôt que d'appliquer un repli sans le dire.
      isFallback: policy.isFallback,
    };
  }
}

// Moteur de règles de protection des mineurs configurable par pays (cahier des
// charges) — réservé à un compte ADMIN (2FA obligatoire, cf. RolesGuard), pas
// d'interface self-service pour une organisation ou un candidat.
@Roles('ADMIN')
@Controller('admin/country-policies')
export class CountryPolicyController {
  constructor(private readonly countryPolicies: CountryPolicyService) {}

  @Get()
  list() {
    return this.countryPolicies.list();
  }

  @Get(':countryCode')
  resolve(@Param('countryCode') countryCode: string) {
    return this.countryPolicies.resolve(countryCode.toUpperCase());
  }

  @Put(':countryCode')
  upsert(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('countryCode') countryCode: string,
    @Body() dto: UpsertCountryPolicyDto,
  ) {
    return this.countryPolicies.upsert(
      admin.sub,
      countryCode.toUpperCase(),
      dto,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Delete(':countryCode')
  remove(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('countryCode') countryCode: string,
  ) {
    return this.countryPolicies.remove(admin.sub, countryCode.toUpperCase());
  }
}
