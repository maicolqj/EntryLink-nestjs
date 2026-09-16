import { MarketplaceCategoryKind } from '../enums/marketplace-category-kind.enum';

export interface DefaultMarketplaceCategory {
  slug: string;
  name: string;
  icon: string;
  kind: MarketplaceCategoryKind;
  sortOrder: number;
}

/**
 * Con qué categorías arranca un conjunto que acaba de encender la vitrina.
 *
 * Se siembran por complejo la primera vez que alguien entra al módulo, y desde
 * ahí son suyas: puede renombrarlas, reordenarlas, apagarlas o agregar las que
 * quiera sin que un despliegue le pise los cambios. El sembrado reconoce lo que
 * ya existe por el `slug`, que no se recalcula al renombrar.
 *
 * La lista sale de lo que de verdad se mueve en un grupo de WhatsApp de
 * conjunto. Lo que NO está es tan deliberado como lo que está: préstamos de
 * dinero, rifas, licor y mascotas en venta no se siembran. Un conjunto que los
 * quiera los crea a mano y asume la decisión; lo contrario es que la plataforma
 * los proponga.
 */
export const DEFAULT_MARKETPLACE_CATEGORIES: DefaultMarketplaceCategory[] = [
  {
    slug: 'muebles-y-hogar',
    name: 'Muebles y hogar',
    icon: 'weekend',
    kind: MarketplaceCategoryKind.CLASSIFIED,
    sortOrder: 10,
  },
  {
    slug: 'electrodomesticos',
    name: 'Electrodomésticos',
    icon: 'kitchen',
    kind: MarketplaceCategoryKind.CLASSIFIED,
    sortOrder: 20,
  },
  {
    slug: 'tecnologia',
    name: 'Tecnología',
    icon: 'devices',
    kind: MarketplaceCategoryKind.CLASSIFIED,
    sortOrder: 30,
  },
  {
    slug: 'bebes-y-ninos',
    name: 'Bebés y niños',
    icon: 'child-care',
    kind: MarketplaceCategoryKind.CLASSIFIED,
    sortOrder: 40,
  },
  {
    slug: 'ropa-y-accesorios',
    name: 'Ropa y accesorios',
    icon: 'checkroom',
    kind: MarketplaceCategoryKind.CLASSIFIED,
    sortOrder: 50,
  },
  {
    slug: 'deportes-y-bicicletas',
    name: 'Deportes y bicicletas',
    icon: 'pedal-bike',
    kind: MarketplaceCategoryKind.CLASSIFIED,
    sortOrder: 60,
  },
  {
    slug: 'comida-casera',
    name: 'Comida casera y repostería',
    icon: 'cake',
    kind: MarketplaceCategoryKind.CLASSIFIED,
    sortOrder: 70,
  },
  {
    slug: 'belleza-y-cuidado',
    name: 'Belleza y cuidado personal',
    icon: 'spa',
    kind: MarketplaceCategoryKind.CLASSIFIED,
    sortOrder: 80,
  },
  {
    slug: 'clases-y-tutorias',
    name: 'Clases y tutorías',
    icon: 'school',
    kind: MarketplaceCategoryKind.CLASSIFIED,
    sortOrder: 90,
  },
  {
    slug: 'parqueaderos',
    name: 'Parqueaderos',
    icon: 'local-parking',
    kind: MarketplaceCategoryKind.CLASSIFIED,
    sortOrder: 100,
  },
  {
    slug: 'otros',
    name: 'Otros',
    icon: 'category',
    kind: MarketplaceCategoryKind.CLASSIFIED,
    sortOrder: 999,
  },
];

/**
 * Condiciones por defecto de la vitrina.
 *
 * El conjunto puede reemplazarlas por las suyas, pero nunca queda sin ninguna:
 * la aceptación con fecha es lo único que sostiene, si un negocio sale mal, que
 * la administración solo prestó el tablero.
 */
export const DEFAULT_MARKETPLACE_TERMS = [
  'La administración solo facilita este espacio de avisos entre vecinos.',
  'No participa en los negocios que se acuerden, no los respalda y no responde por el estado, la calidad, la entrega ni el pago de lo publicado.',
  'Quien publica responde por la veracidad de su aviso y por cumplir el reglamento de propiedad horizontal.',
  'No se permite publicar actividades prohibidas por el reglamento o por la ley.',
  'Los datos de contacto que decidas mostrar quedarán visibles para los residentes del conjunto.',
].join(' ');
