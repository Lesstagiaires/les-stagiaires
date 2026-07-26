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
import { Roles } from './decorators/roles.decorator';
import { UpsertCountryPolicyDto } from './dto/upsert-country-policy.dto';
import type { AccessTokenPayload } from './token.service';

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
    return this.countryPolicies.upsert(admin.sub, countryCode.toUpperCase(), dto);
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
