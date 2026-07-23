import { Controller, Get, Param } from '@nestjs/common';
import { LegalDocumentService } from '../services/legal-document.service';

/**
 * Lectura pública de documentos legales (sin autenticación).
 * Consumido por las páginas /legal del frontend (server-side fetch).
 */
@Controller('legal')
export class LegalDocumentController {
  constructor(private readonly service: LegalDocumentService) {}

  @Get()
  async list() {
    const docs = await this.service.findAllPublished();
    return docs.map((d) => ({
      slug: d.slug,
      title: d.title,
      description: d.description ?? null,
      updatedAt: d.updatedAt,
    }));
  }

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    const d = await this.service.findPublishedBySlug(slug);
    return {
      slug: d.slug,
      title: d.title,
      description: d.description ?? null,
      contentHtml: d.contentHtml ?? null,
      version: d.version,
      updatedAt: d.updatedAt,
    };
  }
}
