import { BadRequestException } from '@nestjs/common';

/** Tamaño máximo por defecto de un archivo subido en base64 (ya decodificado).
 *  Debe quedar por debajo de GRAPHQL_BODY_LIMIT (main.ts): base64 infla el payload ~33%. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Decodifica un archivo enviado en base64 (acepta prefijo data URI) validando
 * tamaño y contenido no vacío. `label` se usa para construir el mensaje de error
 * (ej. "El PDF", "El archivo .docx").
 */
export function decodeBase64File(
  base64: string,
  label: string,
  maxBytes: number = MAX_UPLOAD_BYTES,
): Buffer {
  const clean = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  // Estimación previa: 4 caracteres base64 = 3 bytes. Evita materializar buffers enormes.
  if (Math.floor((clean.length * 3) / 4) > maxBytes) {
    throw new BadRequestException(`${label} supera el tamaño máximo de ${maxMb} MB.`);
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(clean, 'base64');
  } catch {
    throw new BadRequestException(`${label} no es un base64 válido.`);
  }

  if (!buffer.length) throw new BadRequestException(`${label} está vacío.`);
  if (buffer.length > maxBytes) {
    throw new BadRequestException(`${label} supera el tamaño máximo de ${maxMb} MB.`);
  }
  return buffer;
}
