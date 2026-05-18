import { BadRequestException } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];

export const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf'];

export const ALLOWED_FILE_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_DOCUMENT_MIME_TYPES,
];

interface FileInterceptorOptions {
  maxSizeMb?:    number;
  allowedTypes?: string[];
}

function makeFileFilter(allowedTypes: string[]) {
  return (_req: any, file: Express.Multer.File, cb: any) => {
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestException(`Formato no soportado: ${file.mimetype}`), false);
    }
  };
}

export function singleImageInterceptor(
  fieldName = 'file',
  options: FileInterceptorOptions = {},
) {
  const { maxSizeMb = 10, allowedTypes = ALLOWED_IMAGE_MIME_TYPES } = options;
  return FileInterceptor(fieldName, {
    storage:    memoryStorage(),
    limits:     { fileSize: maxSizeMb * 1024 * 1024 },
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
    storage:    memoryStorage(),
    limits:     { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(allowedTypes),
  });
}

export function singleDocumentInterceptor(
  fieldName = 'file',
  options: FileInterceptorOptions = {},
) {
  const { maxSizeMb = 20, allowedTypes = ALLOWED_DOCUMENT_MIME_TYPES } = options;
  return FileInterceptor(fieldName, {
    storage:    memoryStorage(),
    limits:     { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(allowedTypes),
  });
}

export function multipleDocumentsInterceptor(
  fieldName = 'files',
  maxCount = 5,
  options: FileInterceptorOptions = {},
) {
  const { maxSizeMb = 20, allowedTypes = ALLOWED_DOCUMENT_MIME_TYPES } = options;
  return FilesInterceptor(fieldName, maxCount, {
    storage:    memoryStorage(),
    limits:     { fileSize: maxSizeMb * 1024 * 1024 },
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
    storage:    memoryStorage(),
    limits:     { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(allowedTypes),
  });
}
