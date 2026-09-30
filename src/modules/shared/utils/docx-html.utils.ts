import { BadRequestException, Logger } from '@nestjs/common';
import * as mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';

import { decodeBase64File } from './base64-file.utils';

const logger = new Logger('DocxToHtml');

/**
 * Lo que sobrevive de un Word convertido: estructura de texto y tablas, sin
 * estilos, scripts ni imágenes incrustadas. El HTML se pinta tal cual en la web
 * y en el WebView de la app, así que nada ejecutable puede pasar.
 */
export const DOCX_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'br',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'sup',
    'sub',
    'span',
    'div',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    '*': ['id'],
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform(
      'a',
      { rel: 'noopener noreferrer', target: '_blank' },
      true,
    ),
  },
};

/** Convierte un .docx (base64) a HTML sanitizado. */
export async function docxBase64ToHtml(base64: string): Promise<string> {
  const buffer = decodeBase64File(base64, 'El archivo .docx');

  let rawHtml: string;
  try {
    const result = await mammoth.convertToHtml({ buffer });
    rawHtml = result.value;
  } catch (err) {
    logger.error(`Error convirtiendo .docx: ${(err as Error).message}`);
    throw new BadRequestException(
      'No se pudo procesar el archivo .docx. Verifica que sea un Word válido.',
    );
  }

  const html = sanitizeHtml(rawHtml, DOCX_SANITIZE_OPTIONS).trim();
  if (!html) {
    throw new BadRequestException('El documento no contiene texto legible.');
  }
  return html;
}
