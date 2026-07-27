import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClamAvMalwareScanner } from './clamav-malware-scanner';
import { DevMalwareScanner } from './dev-malware-scanner';
import { DocumentEncryptionService } from './document-encryption.service';
import { FileValidationService } from './file-validation.service';
import { LocalStorageProvider } from './local-storage.provider';
import { MALWARE_SCANNER } from './malware-scanner.interface';
import { R2StorageProvider } from './r2-storage.provider';
import { STORAGE_PROVIDER } from './storage-provider.interface';

@Module({
  providers: [
    LocalStorageProvider,
    R2StorageProvider,
    DevMalwareScanner,
    ClamAvMalwareScanner,
    DocumentEncryptionService,
    FileValidationService,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (
        config: ConfigService,
        local: LocalStorageProvider,
        r2: R2StorageProvider,
      ) => {
        return config.get<string>('STORAGE_PROVIDER') === 'r2' ? r2 : local;
      },
      inject: [ConfigService, LocalStorageProvider, R2StorageProvider],
    },
    {
      // "dev" par défaut (aucune analyse réelle) pour ne pas bloquer le développement
      // local sans clamd ; "clamav" doit être configuré explicitement avant tout
      // déploiement recevant de vrais fichiers utilisateur (CLAUDE.md §4).
      provide: MALWARE_SCANNER,
      useFactory: (
        config: ConfigService,
        dev: DevMalwareScanner,
        clamav: ClamAvMalwareScanner,
      ) => {
        return config.get<string>('MALWARE_SCANNER_PROVIDER') === 'clamav'
          ? clamav
          : dev;
      },
      inject: [ConfigService, DevMalwareScanner, ClamAvMalwareScanner],
    },
  ],
  exports: [
    STORAGE_PROVIDER,
    MALWARE_SCANNER,
    DocumentEncryptionService,
    FileValidationService,
  ],
})
export class StorageModule {}
