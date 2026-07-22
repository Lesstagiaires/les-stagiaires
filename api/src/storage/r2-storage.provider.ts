import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageProvider } from './storage-provider.interface';

// Cloudflare R2 est compatible S3 — même client, juste un endpoint différent.
@Injectable()
export class R2StorageProvider implements StorageProvider {
  constructor(private readonly config: ConfigService) {}

  private getClient(): S3Client {
    const accountId = this.config.getOrThrow<string>(
      'CLOUDFLARE_R2_ACCOUNT_ID',
    );
    return new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.config.getOrThrow<string>(
          'CLOUDFLARE_R2_ACCESS_KEY_ID',
        ),
        secretAccessKey: this.config.getOrThrow<string>(
          'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  private getBucket(): string {
    return this.config.getOrThrow<string>('CLOUDFLARE_R2_BUCKET');
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.getClient().send(
      new PutObjectCommand({ Bucket: this.getBucket(), Key: key, Body: data }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.getClient().send(
      new GetObjectCommand({ Bucket: this.getBucket(), Key: key }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.getClient().send(
      new DeleteObjectCommand({ Bucket: this.getBucket(), Key: key }),
    );
  }
}
