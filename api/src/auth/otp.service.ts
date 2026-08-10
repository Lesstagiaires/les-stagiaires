import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { Prisma } from '../../generated/prisma/client';
import { OtpPurpose } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

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

    // ========================================================================
    // UN NOUVEAU CODE TUE LES PRÉCÉDENTS — ET UN SEUL VIT À LA FOIS
    //
    // `verify` ne retenait déjà que le plus récent, les anciens étaient donc
    // inertes en pratique. Mais « inerte parce que la requête les ignore » et
    // « invalidé » ne sont pas la même garantie : la première tient à l'ordre
    // d'un `orderBy`, que le prochain remaniement peut changer sans y penser.
    //
    // LA CONCURRENCE, mesurée le 2026-08-10 : consommer puis créer en deux
    // temps laissait DEUX codes vivants après trois envois simultanés. D'où
    // deux verrous complémentaires :
    //
    //   — la TRANSACTION, qui rend les deux écritures indivisibles ;
    //   — l'INDEX UNIQUE PARTIEL `OtpCode_un_seul_vivant`, qui rend l'état à
    //     deux codes impossible plutôt qu'improbable.
    //
    // Le perdant d'une course voit sa transaction refusée par l'index. Il
    // n'envoie alors PAS de second SMS : le code du gagnant vient de partir sur
    // le même téléphone, et deux messages pour une seule demande passeraient
    // pour un dysfonctionnement.
    // ========================================================================
    try {
      await this.prisma.$transaction([
        this.prisma.otpCode.updateMany({
          where: { userId, purpose, consumedAt: null },
          data: { consumedAt: new Date() },
        }),
        this.prisma.otpCode.create({
          data: {
            userId,
            codeHash: this.hashCode(code),
            purpose,
            destination,
            maxAttempts,
            expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
          },
        }),
      ]);
    } catch (erreur) {
      // Violation de l'unicité : une demande concurrente a gagné la course et
      // vient d'émettre un code. Rien à faire, et surtout rien à envoyer.
      if (
        erreur instanceof Prisma.PrismaClientKnownRequestError &&
        erreur.code === 'P2002'
      ) {
        this.logger.warn(
          'Deux demandes de code simultanées : la seconde est ignorée.',
        );
        return;
      }
      throw erreur;
    }

    // L'ENVOI VIENT APRÈS L'ÉCRITURE, et jamais l'inverse : un SMS parti pour
    // un code que la base a refusé d'enregistrer serait invérifiable.
    await this.sms.send(
      destination,
      `LES STAGIAIRES — votre code de vérification est ${code}. Il expire dans ${ttlMinutes} minutes.`,
    );
  }

  // ==========================================================================
  // DEPUIS COMBIEN DE TEMPS UN CODE A-T-IL ÉTÉ ENVOYÉ ?
  //
  // Sert au délai de garde du renvoi. Le raisonnement est le même que pour les
  // relances parentales : sans garde-fou, un bouton « renvoyer » devient un
  // outil de harcèlement du numéro visé, et chaque envoi est facturé.
  // ==========================================================================
  async secondesDepuisDernierEnvoi(
    userId: string,
    purpose: OtpPurpose,
  ): Promise<number | null> {
    const dernier = await this.prisma.otpCode.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!dernier) return null;
    return (Date.now() - dernier.createdAt.getTime()) / 1000;
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

    // Comparaison en temps constant — une comparaison de chaîne classique peut fuiter
    // de l'information via le temps de réponse (CLAUDE.md §2 : secrets jamais exposés,
    // même indirectement).
    const isMatch = timingSafeEqual(
      Buffer.from(otp.codeHash),
      Buffer.from(this.hashCode(code)),
    );

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
