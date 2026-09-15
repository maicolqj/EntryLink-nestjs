import { BadRequestException } from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];

export const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf'];

/**
 * Video corto de evidencia. La lista es corta a propósito: son los formatos que
 * graban las cámaras de iOS y Android, y aceptar más significa guardar archivos
 * que después ningún navegador reproduce.
 */
export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/3gpp',
];

export const ALLOWED_FILE_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_DOCUMENT_MIME_TYPES,
];

interface FileInterceptorOptions {
  maxSizeMb?: number;
  allowedTypes?: string[];
}

function makeFileFilter(allowedTypes: string[]) {
  return (_req: any, file: Express.Multer.File, cb: any) => {
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(`Formato no soportado: ${file.mimetype}`),
        false,
      );
    }
  };
}

export function singleImageInterceptor(
  fieldName = 'file',
  options: FileInterceptorOptions = {},
) {
  const { maxSizeMb = 10, allowedTypes = ALLOWED_IMAGE_MIME_TYPES } = options;
  return FileInterceptor(fieldName, {
    storage: memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(allowedTypes),
  });
}

export function multipleImagesInterceptor(
  fieldName = 'files',
  maxCount = 10,
  options: FileInterceptorOptions = {},
) {
  const { maxSizeMb = 10, allowedTypes = ALLOWED_IMAGE_MIME_TYPES } = options;
  return FilesInterceptor(fieldName, maxCount, {
    storage: memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(allowedTypes),
  });
}

export function singleDocumentInterceptor(
  fieldName = 'file',
  options: FileInterceptorOptions = {},
) {
  const { maxSizeMb = 20, allowedTypes = ALLOWED_DOCUMENT_MIME_TYPES } =
    options;
  return FileInterceptor(fieldName, {
    storage: memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(allowedTypes),
  });
}

export function multipleDocumentsInterceptor(
  fieldName = 'files',
  maxCount = 5,
  options: FileInterceptorOptions = {},
) {
  const { maxSizeMb = 20, allowedTypes = ALLOWED_DOCUMENT_MIME_TYPES } =
    options;
  return FilesInterceptor(fieldName, maxCount, {
    storage: memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(allowedTypes),
  });
}

export function multipleFilesInterceptor(
  fieldName = 'files',
  maxCount = 10,
  options: FileInterceptorOptions = {},
) {
  const { maxSizeMb = 20, allowedTypes = ALLOWED_FILE_MIME_TYPES } = options;
  return FilesInterceptor(fieldName, maxCount, {
    storage: memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(allowedTypes),
  });
}

/**
 * Fotos y un video corto en la misma petición.
 *
 * Existe para el reporte de daños: quien está frente a la gotera manda dos
 * fotos y diez segundos de video de una sola vez. El tope del video va aparte
 * del de las imágenes porque no se parecen en tamaño.
 */
export function imagesAndVideoInterceptor(
  options: {
    imagesField?: string;
    videoField?: string;
    maxImages?: number;
    maxImageSizeMb?: number;
    maxVideoSizeMb?: number;
  } = {},
) {
  const {
    imagesField = 'photos',
    videoField = 'video',
    maxImages = 5,
    maxImageSizeMb = 10,
    maxVideoSizeMb = 40,
  } = options;

  const allowed = [...ALLOWED_IMAGE_MIME_TYPES, ...ALLOWED_VIDEO_MIME_TYPES];

  return FileFieldsInterceptor(
    [
      { name: imagesField, maxCount: maxImages },
      { name: videoField, maxCount: 1 },
    ],
    {
      storage: memoryStorage(),
      // Multer aplica un solo tope por petición: se usa el mayor de los dos y
      // el controlador rechaza la imagen que se pase de su propio límite.
      limits: {
        fileSize: Math.max(maxImageSizeMb, maxVideoSizeMb) * 1024 * 1024,
      },
      fileFilter: makeFileFilter(allowed),
    },
  );
}
