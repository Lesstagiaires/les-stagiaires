import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { StorageProvider } from './storage-provider.interface';

// Stockage disque local — développement uniquement. Le dossier est ignoré par git ;
// à remplacer par R2 avant toute donnée réelle (CLAUDE.md §7 : hébergement à valider
// par une personne compétente en infrastructure).
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root = join(process.cwd(), 'storage-data');

  private resolvePath(key: string): string {
    return join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.resolvePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    this.logger.debug(`[STORAGE_PROVIDER=local] Écrit : ${key}`);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolvePath(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }
}
