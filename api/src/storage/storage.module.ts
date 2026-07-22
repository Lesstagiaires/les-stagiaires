import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevMalwareScanner } from './dev-malware-scanner';
import { LocalStorageProvider } from './local-storage.provider';
import { MALWARE_SCANNER } from './malware-scanner.interface';
import { R2StorageProvider } from './r2-storage.provider';
import { STORAGE_PROVIDER } from './storage-provider.interface';

@Module({
  providers: [
    LocalStorageProvider,
    R2StorageProvider,
    DevMalwareScanner,
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
      provide: MALWARE_SCANNER,
      useExisting: DevMalwareScanner,
    },
  ],
  exports: [STORAGE_PROVIDER, MALWARE_SCANNER],
})
export class StorageModule {}
