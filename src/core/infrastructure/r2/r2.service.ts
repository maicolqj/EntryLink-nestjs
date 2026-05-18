import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
// import { v4 as uuidv4 } from 'uuid';
import { randomUUID } from 'crypto';
import * as https from 'https';
import * as path from 'path';

export interface StorageUploadResult {
  url: string;
  publicId: string;
  format: string;
  bytes: number;
}

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
};

@Injectable()
export class R2StorageService implements OnModuleInit {
  private readonly logger = new Logger(R2StorageService.name);
  private s3: S3Client;
  private bucketName: string;
  private publicUrl: string;

  constructor(private readonly configService: ConfigService) { }

  onModuleInit() {
    const accountId = this.configService.get<string>('r2.accountId');
    const accessKeyId = this.configService.get<string>('r2.accessKeyId');
    const secretAccessKey = this.configService.get<string>('r2.secretAccessKey');
    this.bucketName = this.configService.get<string>('r2.bucketName');
    const rawPublicUrl = (this.configService.get<string>('r2.publicUrl') ?? '').replace(/\/$/, '');
    this.publicUrl = rawPublicUrl && !rawPublicUrl.startsWith('http')
      ? `https://${rawPublicUrl}`
      : rawPublicUrl;


    this.logger.warn(`accountId ${accountId}`);
    this.logger.warn(`accessKeyId ${accessKeyId}`);
    this.logger.warn(`secretAccessKey ${secretAccessKey}`);
    this.logger.warn(`bucketName ${this.bucketName}`);
    this.logger.warn(`bucketName ${this.publicUrl}`);

    const httpsAgent = new https.Agent({
      keepAlive: true,
      minVersion: 'TLSv1.2',
    });

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      // endpoint: `https://${accountId}.r2.cloudflarestorage.com/entrylink`,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // <--- CAMBIA ESTO DE FALSE A TRUE
      // requestHandler: new NodeHttpHandler({ httpsAgent }), 
    });

    this.logger.log('Cloudflare R2 configurado correctamente');
  }

  buildFolder(module: string, ...subPaths: string[]): string {
    const appName = this.configService.get<string>('r2.appName') ?? 'residash';
    return [appName, module, ...subPaths].filter(Boolean).join('/');
  }

  async uploadBuffer(
    buffer: Buffer,
    folder: string,
    originalName?: string,
    _resourceType: 'image' | 'raw' | 'auto' = 'image',
  ): Promise<StorageUploadResult> {
    const ext = originalName ? path.extname(originalName).toLowerCase() : '';
    const key = `${folder}/${randomUUID()}${ext}`;
    const format = ext.replace('.', '');
    const contentType = EXT_TO_CONTENT_TYPE[format] ?? 'application/octet-stream';

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    this.logger.log(`Archivo subido a R2: ${key}`);

    return {
      url: `${this.publicUrl}/${key}`,
      publicId: key,
      format,
      bytes: buffer.length,
    };
  }

  async deleteByPublicId(publicId: string, _resourceType?: 'image' | 'raw' | 'auto'): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: publicId,
      }),
    );
    this.logger.log(`Archivo eliminado de R2: ${publicId}`);
  }
}
