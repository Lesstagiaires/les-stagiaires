import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';

// FR-M3-008 : QR Code de partage sécurisé — encode l'URL de partage à jeton, généré à la
// demande (pas stocké, dérivé du jeton déjà émis par SharesService).
@Injectable()
export class QrCodeService {
  constructor(private readonly config: ConfigService) {}

  buildShareUrl(rawToken: string): string {
    const baseUrl = this.config.get<string>(
      'APP_PUBLIC_URL',
      'http://localhost:3000',
    );
    return `${baseUrl}/digital-safe/share/${rawToken}`;
  }

  async generateDataUrl(rawToken: string): Promise<string> {
    return QRCode.toDataURL(this.buildShareUrl(rawToken), {
      errorCorrectionLevel: 'M',
    });
  }
}
