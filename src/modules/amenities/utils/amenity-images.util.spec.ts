import { diffAmenityImages } from './amenity-images.util';

const A = 'https://files.alternaqj.com/EntryLink/demo/amenities/a.jpg';
const B = 'https://files.alternaqj.com/EntryLink/demo/amenities/b.jpg';
const C = 'https://files.alternaqj.com/EntryLink/demo/amenities/c.jpg';

describe('diffAmenityImages', () => {
  it('reordenar para cambiar la portada no quita ninguna foto', () => {
    expect(diffAmenityImages([A, B, C], [C, A, B])).toEqual([]);
  });

  it('devuelve las fotos que salen de la galería', () => {
    expect(diffAmenityImages([A, B, C], [B])).toEqual([A, C]);
  });

  it('dejar la galería vacía quita todas', () => {
    expect(diffAmenityImages([A, B], [])).toEqual([A, B]);
  });

  it('rechaza una URL que la zona no tenía', () => {
    expect(() =>
      diffAmenityImages([A], [A, 'https://otro-sitio.com/foto.jpg']),
    ).toThrow('Solo se pueden quitar o reordenar fotos');
  });

  it('rechaza fotos repetidas', () => {
    expect(() => diffAmenityImages([A, B], [A, A])).toThrow('repetidas');
  });
});
