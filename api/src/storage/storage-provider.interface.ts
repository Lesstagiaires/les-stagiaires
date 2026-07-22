export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
