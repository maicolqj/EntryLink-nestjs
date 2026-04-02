import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { HttpStatus } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { GeocodingService } from './geocoding.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexErrorCode } from '../../shared/constans/error-codes.constants';

const mockHttpService = () => ({
  get: jest.fn(),
});

describe('GeocodingService.geocodeAddress', () => {
  let service: GeocodingService;
  let httpService: ReturnType<typeof mockHttpService>;

  beforeEach(async () => {
    httpService = mockHttpService();

    const module = await Test.createTestingModule({
      providers: [
        GeocodingService,
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get(GeocodingService);
  });

  it('retorna lat/lng cuando Nominatim encuentra la dirección', async () => {
    httpService.get.mockReturnValue(
      of({ data: [{ lat: '4.711', lon: '-74.072' }] }),
    );

    const result = await service.geocodeAddress(
      'Calle 100 # 15-20', 'Bogotá', 'Cundinamarca', 'Colombia',
    );

    expect(result).toEqual({ lat: 4.711, lng: -74.072 });
  });

  it('lanza GEOCODING_ADDRESS_NOT_FOUND cuando Nominatim retorna array vacío', async () => {
    httpService.get.mockReturnValue(of({ data: [] }));

    const err = await service
      .geocodeAddress('Dirección Inexistente', 'Ciudad', 'Depto', 'Colombia')
      .catch(e => e);

    expect(err).toBeInstanceOf(CustomError);
    expect((err as CustomError).errorCode).toBe(ComplexErrorCode.GEOCODING_ADDRESS_NOT_FOUND);
    expect((err as CustomError).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('lanza GEOCODING_SERVICE_UNAVAILABLE cuando Nominatim falla con error de red', async () => {
    httpService.get.mockReturnValue(throwError(() => new Error('timeout')));

    const err = await service
      .geocodeAddress('Calle 1', 'Bogotá', 'Cundinamarca', 'Colombia')
      .catch(e => e);

    expect(err).toBeInstanceOf(CustomError);
    expect((err as CustomError).errorCode).toBe(ComplexErrorCode.GEOCODING_SERVICE_UNAVAILABLE);
    expect((err as CustomError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
