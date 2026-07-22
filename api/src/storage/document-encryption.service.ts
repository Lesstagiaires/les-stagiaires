import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Chiffrement partagé par tous les documents utilisateur (profil, Digital Safe) —
// AES-256-GCM, une seule implémentation pour ne pas diverger entre modules
// (CLAUDE.md §4 : chiffrement au repos, sans exception).
@Injectable()
export class DocumentEncryptionService {
  constructor(private readonly config: ConfigService) {}

  private getKey(): Buffer {
    const hex = this.config.getOrThrow<string>('DOCUMENT_ENCRYPTION_KEY');
    const key = Buffer.from(hex, 'hex');
    if (key.length !== 32) {
      throw new Error(
        'DOCUMENT_ENCRYPTION_KEY doit faire 32 octets (64 caractères hexadécimaux).',
      );
    }
    return key;
  }

  encrypt(plaintext: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  decrypt(blob: Buffer): Buffer {
    const iv = blob.subarray(0, IV_LENGTH);
    const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', this.getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
