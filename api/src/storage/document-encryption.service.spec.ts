import type { ConfigService } from '@nestjs/config';
import { DocumentEncryptionService } from './document-encryption.service';

const VALID_KEY_HEX = 'a'.repeat(64); // 32 octets

describe('DocumentEncryptionService', () => {
  let config: { getOrThrow: jest.Mock };
  let service: DocumentEncryptionService;

  beforeEach(() => {
    config = { getOrThrow: jest.fn().mockReturnValue(VALID_KEY_HEX) };
    service = new DocumentEncryptionService(config as unknown as ConfigService);
  });

  it('round-trips arbitrary plaintext through AES-256-GCM', () => {
    const plaintext = Buffer.from('Contenu confidentiel du Digital Safe.');

    const ciphertext = service.encrypt(plaintext);
    const decrypted = service.decrypt(ciphertext);

    expect(decrypted).toEqual(plaintext);
    expect(ciphertext).not.toEqual(plaintext);
  });

  it('produces a different ciphertext each time (random IV), even for identical plaintext', () => {
    const plaintext = Buffer.from('same content');

    const first = service.encrypt(plaintext);
    const second = service.encrypt(plaintext);

    expect(first).not.toEqual(second);
  });

  // CLAUDE.md §4 : intégrité — un blob altéré (au repos ou en transit) ne doit jamais
  // se déchiffrer silencieusement en contenu corrompu.
  it('rejects a tampered ciphertext instead of returning corrupted plaintext', () => {
    const plaintext = Buffer.from('sensitive');
    const ciphertext = service.encrypt(plaintext);
    ciphertext[ciphertext.length - 1] ^= 0xff; // altère le dernier octet du texte chiffré

    expect(() => service.decrypt(ciphertext)).toThrow();
  });

  it('rejects decryption with a mismatched key', () => {
    const plaintext = Buffer.from('sensitive');
    const ciphertext = service.encrypt(plaintext);

    config.getOrThrow.mockReturnValue('b'.repeat(64));
    const otherService = new DocumentEncryptionService(
      config as unknown as ConfigService,
    );

    expect(() => otherService.decrypt(ciphertext)).toThrow();
  });

  it('rejects a misconfigured key that is not exactly 32 bytes', () => {
    config.getOrThrow.mockReturnValue('ab'.repeat(10)); // 10 octets seulement

    expect(() => service.encrypt(Buffer.from('x'))).toThrow(/32 octets/);
  });
});
