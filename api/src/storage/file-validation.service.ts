import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { MALWARE_SCANNER } from './malware-scanner.interface';
import type { MalwareScanner } from './malware-scanner.interface';

// Signatures binaires (magic bytes) — le Content-Type déclaré par le client n'est qu'une
// affirmation non vérifiée ; un exécutable renommé avec un Content-Type: image/png la
// franchirait sans ce contrôle (CLAUDE.md §4).
const MAGIC_BYTES: Record<string, Buffer[]> = {
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'application/pdf': [Buffer.from('%PDF')],
};

function matchesDeclaredFormat(buffer: Buffer, mimetype: string): boolean {
  const signatures = MAGIC_BYTES[mimetype];
  if (!signatures) return false; // format sans signature connue : refusé par prudence
  return signatures.some((signature) =>
    buffer.subarray(0, signature.length).equals(signature),
  );
}

export interface FileToValidate {
  buffer: Buffer;
  mimetype: string;
}

// Contrôle de format/taille + analyse anti-malware avant tout enregistrement — commun à
// tous les documents utilisateur, jamais à refaire au cas par cas module par module
// (CLAUDE.md §4).
@Injectable()
export class FileValidationService {
  constructor(
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  async validate(
    file: FileToValidate,
    maxSizeBytes: number,
    allowedMimeTypes: string[],
  ): Promise<void> {
    if (file.buffer.length > maxSizeBytes) {
      throw new BadRequestException('Fichier trop volumineux.');
    }

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`Format non autorisé : ${file.mimetype}`);
    }

    if (!matchesDeclaredFormat(file.buffer, file.mimetype)) {
      throw new BadRequestException(
        'Le contenu du fichier ne correspond pas au format déclaré.',
      );
    }

    const scanResult = await this.scanner.scan(file.buffer);
    if (!scanResult.clean) {
      throw new BadRequestException(
        'Fichier rejeté par le contrôle de sécurité.',
      );
    }
  }
}
