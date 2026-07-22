import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'crypto';
import { OtpPurpose } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  async generateAndSend(
    userId: string,
    destination: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ttlMinutes = Number(this.config.get<string>('OTP_TTL_MINUTES', '5'));
    const maxAttempts = Number(
      this.config.get<string>('OTP_MAX_ATTEMPTS', '5'),
    );

    await this.prisma.otpCode.create({
      data: {
        userId,
        codeHash: this.hashCode(code),
        purpose,
        destination,
        maxAttempts,
        expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
      },
    });

    await this.sms.send(
      destination,
      `LES STAGIAIRES — votre code de vérification est ${code}. Il expire dans ${ttlMinutes} minutes.`,
    );
  }

  async verify(
    userId: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<boolean> {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        userId,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp || otp.attempts >= otp.maxAttempts) {
      return false;
    }

    const isMatch = otp.codeHash === this.hashCode(code);

    if (!isMatch) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }
}
