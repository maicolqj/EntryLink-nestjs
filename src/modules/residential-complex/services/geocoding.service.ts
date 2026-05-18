import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexErrorCode } from '../../shared/constans/error-codes.constants';

interface NominatimResult {
  lat: string;
  lon: string;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

  constructor(private readonly httpService: HttpService) {}

  async geocodeAddress(
    address: string,
    city: string,
    state: string,
    country: string,
  ): Promise<{ lat: number; lng: number }> {
    const query = `${address}, ${city}, ${state}, ${country}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<NominatimResult[]>(this.NOMINATIM_URL, {
          params: {
            q: query,
            format: 'json',
            limit: 1,
            countrycodes: 'co',
          },
          headers: { 'User-Agent': 'entrylink/1.0' },
        }),
      );

      const results = response.data;

      if (!results || results.length === 0) {
        throw new CustomError({
          message: `No se encontraron coordenadas para la dirección: "${query}". Verifica la dirección o ingresa las coordenadas manualmente.`,
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          errorCode: ComplexErrorCode.GEOCODING_ADDRESS_NOT_FOUND,
        });
      }

      const { lat, lon } = results[0];
      this.logger.log(`Geocodificado "${query}" → (${lat}, ${lon})`);
      return { lat: parseFloat(lat), lng: parseFloat(lon) };

    } catch (err) {
      if (err instanceof CustomError) throw err;

      this.logger.error(`Nominatim no disponible para "${query}": ${err.message}`);
      throw new CustomError({
        message: 'El servicio de geocodificación no está disponible en este momento. Intenta de nuevo o ingresa las coordenadas manualmente.',
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        errorCode: ComplexErrorCode.GEOCODING_SERVICE_UNAVAILABLE,
      });
    }
  }
}
