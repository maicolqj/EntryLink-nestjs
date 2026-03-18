import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';

export interface CloudinaryUploadResult {
  url:      string;
  publicId: string;
  format:   string;
  bytes:    number;
}

@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    cloudinary.config({
      cloud_name: this.configService.get<string>('cloudinary.cloudName'),
      api_key:    this.configService.get<string>('cloudinary.apiKey'),
      api_secret: this.configService.get<string>('cloudinary.apiSecret'),
      secure:     true,
    });
    this.logger.log('Cloudinary configurado correctamente');
  }

  /**
   * Sube un buffer de imagen a Cloudinary en la carpeta indicada.
   * Ruta: entryLink/{complexSlug}/notas
   */
  async uploadBuffer(
    buffer: Buffer,
    folder: string,
    originalName?: string,
  ): Promise<CloudinaryUploadResult> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          use_filename:  false,
          unique_filename: true,
          overwrite: false,
          transformation: [
            { quality: 'auto:good' },
            { fetch_format: 'auto' },
          ],
        },
        (error, result: UploadApiResponse) => {
          if (error) {
            this.logger.error(`Error subiendo imagen a Cloudinary: ${error.message}`);
            return reject(error);
          }
          resolve({
            url:      result.secure_url,
            publicId: result.public_id,
            format:   result.format,
            bytes:    result.bytes,
          });
        },
      );

      Readable.from(buffer).pipe(uploadStream);
    });
  }

  /**
   * Elimina un asset de Cloudinary por su publicId.
   */
  async deleteByPublicId(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
    this.logger.log(`Imagen eliminada de Cloudinary: ${publicId}`);
  }
}
