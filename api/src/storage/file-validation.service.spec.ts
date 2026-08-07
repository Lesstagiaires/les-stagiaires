import { BadRequestException } from '@nestjs/common';
import { FileValidationService } from './file-validation.service';

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_HEADER = Buffer.from('%PDF-1.4\n...');

describe('FileValidationService', () => {
  let scanner: { scan: jest.Mock };
  let service: FileValidationService;

  beforeEach(() => {
    scanner = { scan: jest.fn().mockResolvedValue({ clean: true }) };
    service = new FileValidationService(scanner);
  });

  it('rejects a file larger than the configured maximum size', async () => {
    const buffer = Buffer.concat([PNG_HEADER, Buffer.alloc(100)]);

    await expect(
      service.validate({ buffer, mimetype: 'image/png' }, 50, ['image/png']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(scanner.scan).not.toHaveBeenCalled();
  });

  it('rejects a MIME type not in the allow-list', async () => {
    const buffer = Buffer.concat([PDF_HEADER, Buffer.alloc(10)]);

    await expect(
      service.validate({ buffer, mimetype: 'application/pdf' }, 1_000_000, [
        'image/png',
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // CLAUDE.md §4 : le Content-Type déclaré par le client n'est qu'une affirmation non
  // vérifiée — un exécutable renommé en image/png doit être détecté par les magic bytes.
  it('rejects content whose magic bytes do not match the declared MIME type', async () => {
    const fakeImage = Buffer.concat([
      Buffer.from('MZ'), // en-tête d'un exécutable Windows, pas une image
      Buffer.alloc(10),
    ]);

    await expect(
      service.validate(
        { buffer: fakeImage, mimetype: 'image/png' },
        1_000_000,
        ['image/png'],
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(scanner.scan).not.toHaveBeenCalled();
  });

  it('rejects a format with no known magic-byte signature, even if allow-listed', async () => {
    const buffer = Buffer.from('plain text content');

    await expect(
      service.validate({ buffer, mimetype: 'text/plain' }, 1_000_000, [
        'text/plain',
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a well-formed PNG within size and passes it to the malware scanner', async () => {
    const buffer = Buffer.concat([PNG_HEADER, Buffer.alloc(10)]);

    await service.validate({ buffer, mimetype: 'image/png' }, 1_000_000, [
      'image/png',
    ]);

    expect(scanner.scan).toHaveBeenCalledWith(buffer);
  });

  it('accepts a well-formed JPEG', async () => {
    const buffer = Buffer.concat([JPEG_HEADER, Buffer.alloc(10)]);

    await expect(
      service.validate({ buffer, mimetype: 'image/jpeg' }, 1_000_000, [
        'image/jpeg',
      ]),
    ).resolves.toBeUndefined();
  });

  it('accepts a well-formed PDF', async () => {
    const buffer = Buffer.concat([PDF_HEADER, Buffer.alloc(10)]);

    await expect(
      service.validate({ buffer, mimetype: 'application/pdf' }, 1_000_000, [
        'application/pdf',
      ]),
    ).resolves.toBeUndefined();
  });

  it('rejects a file the malware scanner flags, even with a valid format', async () => {
    scanner.scan.mockResolvedValue({
      clean: false,
      reason: 'Eicar-Signature FOUND',
    });
    const buffer = Buffer.concat([PNG_HEADER, Buffer.alloc(10)]);

    await expect(
      service.validate({ buffer, mimetype: 'image/png' }, 1_000_000, [
        'image/png',
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
