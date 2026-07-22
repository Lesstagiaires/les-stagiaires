import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ConfirmConsentDto } from './dto/confirm-consent.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LinkParentDto } from './dto/link-parent.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SwitchRoleDto } from './dto/switch-role.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ParentalConsentService } from './parental-consent.service';
import type { AccessTokenPayload } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly parentalConsent: ParentalConsentService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyRegistrationOtp(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  // --- Mineurs / consentement parental actif (FR-AUTH-004a/b/c) ---

  // Renvoi manuel si le SMS initial n'est jamais arrivé, ou pour corriger un numéro —
  // le mineur est déjà authentifiable en mode restreint dès l'inscription.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('minors/request-consent')
  requestConsent(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: LinkParentDto,
  ) {
    return this.parentalConsent.requestConsent(user.sub, dto.parentPhone);
  }

  // Public : le parent/tuteur n'a pas forcément de compte pour consentir — seule la
  // connaissance du code envoyé par SMS fait foi (CLAUDE.md §5).
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('minors/consent/:linkId')
  confirmConsent(
    @Param('linkId') linkId: string,
    @Body() dto: ConfirmConsentDto,
  ) {
    return this.parentalConsent.confirmConsent(linkId, dto.code);
  }

  @Get('minors/parental-links')
  listParentalLinks(@CurrentUser() user: AccessTokenPayload) {
    return this.parentalConsent.listForChild(user.sub);
  }

  // --- Rôles multiples et historique (FR-AUTH-005 / 007) ---

  @Post('roles')
  assignRole(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: SwitchRoleDto,
  ) {
    return this.auth.assignRole(user.sub, dto.roleId);
  }

  @Delete('roles/:userRoleId')
  revokeRole(
    @CurrentUser() user: AccessTokenPayload,
    @Param('userRoleId') userRoleId: string,
  ) {
    return this.auth.revokeRole(user.sub, userRoleId);
  }

  @Get('roles/history')
  roleHistory(@CurrentUser() user: AccessTokenPayload) {
    return this.auth.getRoleHistory(user.sub);
  }

  // --- Export et suppression du compte (FR-AUTH-009 / 010) ---

  @Get('export')
  exportData(@CurrentUser() user: AccessTokenPayload) {
    return this.auth.exportUserData(user.sub);
  }

  @HttpCode(HttpStatus.OK)
  @Post('deactivate')
  deactivate(@CurrentUser() user: AccessTokenPayload) {
    return this.auth.deactivateAccount(user.sub);
  }

  @HttpCode(HttpStatus.OK)
  @Post('request-deletion')
  requestDeletion(@CurrentUser() user: AccessTokenPayload) {
    return this.auth.requestDeletion(user.sub);
  }
}
