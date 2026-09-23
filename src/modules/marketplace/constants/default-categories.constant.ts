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
 * Oficios con los que arranca el directorio de servicios.
 *
 * Van en la misma tabla con `kind = SERVICE`; el índice único incluye `kind`,
 * así que un slug repetido con clasificados (clases, belleza) no choca.
 */
export const DEFAULT_SERVICE_CATEGORIES: DefaultMarketplaceCategory[] = [
  {
    slug: 'plomeria',
    name: 'Plomería',
    icon: 'plumbing',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 10,
  },
  {
    slug: 'electricidad',
    name: 'Electricidad',
    icon: 'electrical-services',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 20,
  },
  {
    slug: 'aseo-del-hogar',
    name: 'Aseo del hogar',
    icon: 'cleaning-services',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 30,
  },
  {
    slug: 'reparaciones-y-mantenimiento',
    name: 'Reparaciones y arreglos',
    icon: 'handyman',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 40,
  },
  {
    slug: 'tecnicos-de-electrodomesticos',
    name: 'Técnico de electrodomésticos',
    icon: 'home-repair-service',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 50,
  },
  {
    slug: 'cuidado-de-ninos',
    name: 'Cuidado de niños',
    icon: 'child-care',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 60,
  },
  {
    slug: 'cuidado-de-adultos-mayores',
    name: 'Cuidado de adultos mayores',
    icon: 'elderly',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 70,
  },
  {
    slug: 'clases-y-tutorias',
    name: 'Clases y tutorías',
    icon: 'school',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 80,
  },
  {
    slug: 'belleza-y-cuidado',
    name: 'Belleza y cuidado personal',
    icon: 'content-cut',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 90,
  },
  {
    slug: 'mascotas',
    name: 'Paseo y cuidado de mascotas',
    icon: 'pets',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 100,
  },
  {
    slug: 'mudanzas-y-acarreos',
    name: 'Mudanzas y acarreos',
    icon: 'local-shipping',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 110,
  },
  {
    slug: 'comida-por-encargo',
    name: 'Comida por encargo',
    icon: 'restaurant',
    kind: MarketplaceCategoryKind.SERVICE,
    sortOrder: 120,
  },
  {
    slug: 'otros',
    name: 'Otros servicios',
    icon: 'miscellaneous-services',
    kind: MarketplaceCategoryKind.SERVICE,
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
