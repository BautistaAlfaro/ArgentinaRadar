/**
 * ArgentinaRadar — Database Seed Script
 *
 * Generates 500+ realistic Argentine news articles with structured data
 * across 5 categories, event clusters, sources, and tweet history.
 *
 * Usage:
 *   node --loader ts-node/esm src/seed.ts            # seed fresh (keeps existing)
 *   node --loader ts-node/esm src/seed.ts --clear    # clear all data first
 *   node --loader ts-node/esm src/seed.ts --sources   # only update sources.json
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

// ─── Paths ─────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'argentina-radar.db');
const SOURCES_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'sources.json');

// ─── Types ──────────────────────────────────────────────────────────
type Category = 'politica' | 'economia' | 'sociedad' | 'deportes' | 'seguridad';
type SourceName =
  | 'clarin' | 'lanacion' | 'infobae' | 'ambito' | 'cronista'
  | 'pagina12' | 'tn' | 'c5n' | 'a24' | 'america' | 'canal26' | 'perfil';

interface GeoLocation {
  province: string;
  city: string | null;
  neighborhood: string | null;
  landmark: string | null;
  lat: number;
  lng: number;
  confidence: number;
  label: string | null;
}

interface AiScore {
  publish: boolean;
  reasoning: string;
}

interface ArticleTemplate {
  title: string;
  summary: string;
  category: Category;
}

// ─── Seeded RNG for reproducibility ──────────────────────────────────
class SeededRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed % 2147483647;
    if (this.seed <= 0) this.seed += 2147483646;
  }
  /** Returns a float in [0, 1) */
  next(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
  /** Random int in [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  /** Pick random element from array */
  pick<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }
  /** Shuffle array in place (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// ─── Argentine Locations ────────────────────────────────────────────
const LOCATIONS: GeoLocation[] = [
  { province: 'CABA', city: 'Buenos Aires', neighborhood: null, landmark: null, lat: -34.6037, lng: -58.3816, confidence: 0.95, label: null },
  { province: 'CABA', city: 'Buenos Aires', neighborhood: 'Palermo', landmark: null, lat: -34.586, lng: -58.43, confidence: 0.9, label: null },
  { province: 'CABA', city: 'Buenos Aires', neighborhood: 'Recoleta', landmark: null, lat: -34.587, lng: -58.392, confidence: 0.9, label: null },
  { province: 'CABA', city: 'Buenos Aires', neighborhood: 'Puerto Madero', landmark: null, lat: -34.615, lng: -58.365, confidence: 0.9, label: null },
  { province: 'CABA', city: 'Buenos Aires', neighborhood: 'Caballito', landmark: null, lat: -34.62, lng: -58.445, confidence: 0.9, label: null },
  { province: 'CABA', city: 'Buenos Aires', neighborhood: 'Congreso', landmark: 'Congreso de la Nación', lat: -34.6097, lng: -58.3923, confidence: 0.95, label: null },
  { province: 'Buenos Aires', city: 'Rosario', neighborhood: null, landmark: null, lat: -32.946, lng: -60.639, confidence: 0.9, label: null },
  { province: 'Buenos Aires', city: 'La Plata', neighborhood: null, landmark: null, lat: -34.921, lng: -57.955, confidence: 0.9, label: null },
  { province: 'Buenos Aires', city: 'Mar del Plata', neighborhood: null, landmark: null, lat: -38.002, lng: -57.557, confidence: 0.9, label: null },
  { province: 'Córdoba', city: 'Córdoba', neighborhood: null, landmark: null, lat: -31.42, lng: -64.188, confidence: 0.9, label: null },
  { province: 'Córdoba', city: 'Villa Carlos Paz', neighborhood: null, landmark: null, lat: -31.39, lng: -64.517, confidence: 0.8, label: null },
  { province: 'Santa Fe', city: 'Santa Fe', neighborhood: null, landmark: null, lat: -31.633, lng: -60.702, confidence: 0.9, label: null },
  { province: 'Santa Fe', city: 'Rosario', neighborhood: null, landmark: null, lat: -32.951, lng: -60.666, confidence: 0.9, label: null },
  { province: 'Mendoza', city: 'Mendoza', neighborhood: null, landmark: null, lat: -32.89, lng: -68.845, confidence: 0.9, label: null },
  { province: 'Tucumán', city: 'San Miguel de Tucumán', neighborhood: null, landmark: null, lat: -26.824, lng: -65.218, confidence: 0.9, label: null },
  { province: 'Salta', city: 'Salta', neighborhood: null, landmark: null, lat: -24.785, lng: -65.412, confidence: 0.9, label: null },
  { province: 'Neuquén', city: 'Neuquén', neighborhood: null, landmark: null, lat: -38.952, lng: -68.065, confidence: 0.9, label: null },
  { province: 'Chaco', city: 'Resistencia', neighborhood: null, landmark: null, lat: -27.452, lng: -58.987, confidence: 0.8, label: null },
  { province: 'Río Negro', city: 'Bariloche', neighborhood: null, landmark: null, lat: -41.133, lng: -71.31, confidence: 0.9, label: null },
  { province: 'Entre Ríos', city: 'Paraná', neighborhood: null, landmark: null, lat: -31.741, lng: -60.512, confidence: 0.8, label: null },
  { province: 'Buenos Aires', city: null, neighborhood: null, landmark: 'Casa Rosada', lat: -34.608, lng: -58.371, confidence: 0.95, label: null },
  { province: 'Neuquén', city: 'Añelo', neighborhood: null, landmark: 'Vaca Muerta', lat: -38.355, lng: -68.894, confidence: 0.85, label: null },
  { province: 'Misiones', city: 'Posadas', neighborhood: null, landmark: null, lat: -27.367, lng: -55.896, confidence: 0.8, label: null },
  { province: 'Buenos Aires', city: 'Ezeiza', neighborhood: null, landmark: 'Aeropuerto Ezeiza', lat: -34.822, lng: -58.535, confidence: 0.9, label: null },
  { province: 'Corrientes', city: 'Corrientes', neighborhood: null, landmark: null, lat: -27.469, lng: -58.83, confidence: 0.8, label: null },
  { province: 'Jujuy', city: 'San Salvador de Jujuy', neighborhood: null, landmark: null, lat: -24.186, lng: -65.301, confidence: 0.8, label: null },
  { province: 'Buenos Aires', city: 'Luján', neighborhood: null, landmark: 'Basílica de Luján', lat: -34.561, lng: -59.12, confidence: 0.85, label: null },
  { province: 'Tierra del Fuego', city: 'Ushuaia', neighborhood: null, landmark: null, lat: -54.801, lng: -68.303, confidence: 0.9, label: null },
  { province: 'La Rioja', city: 'La Rioja', neighborhood: null, landmark: null, lat: -29.413, lng: -66.856, confidence: 0.8, label: null },
  { province: 'San Luis', city: 'San Luis', neighborhood: null, landmark: null, lat: -33.299, lng: -66.337, confidence: 0.8, label: null },
];

// ─── Sources ────────────────────────────────────────────────────────
const SOURCE_NAMES: SourceName[] = [
  'clarin', 'lanacion', 'infobae', 'ambito', 'cronista',
  'pagina12', 'tn', 'c5n', 'a24', 'america', 'canal26', 'perfil',
];

const SOURCE_DOMAINS: Record<SourceName, string> = {
  clarin: 'clarin.com',
  lanacion: 'lanacion.com.ar',
  infobae: 'infobae.com',
  ambito: 'ambito.com',
  cronista: 'cronista.com',
  pagina12: 'pagina12.com.ar',
  tn: 'tn.com.ar',
  c5n: 'c5n.com',
  a24: 'a24.com',
  america: 'americatv.com.ar',
  canal26: 'canal26.com',
  perfil: 'perfil.com',
};

// ─── Names, places, people ──────────────────────────────────────────
const PERSONAS = [
  'Javier Milei', 'Cristina Fernández de Kirchner', 'Patricia Bullrich',
  'Sergio Massa', 'Mauricio Macri', 'Axel Kicillof', 'Horacio Rodríguez Larreta',
  'Victoria Villarruel', 'Martín Lousteau', 'Myriam Bregman', 'Juan Grabois',
  'Guillermo Francos', 'Luis Caputo', 'Santiago Caputo', 'Karina Milei',
  'Nicolás Posse', 'Diana Mondino', 'Jorge Macri', 'Leandro Santoro',
  'Gerardo Morales', 'Maximiliano Pullaro', 'Martín Llaryora',
  'Alberto Fernández', 'Sergio Berni', 'Aníbal Fernández',
  'Daniel Scioli', 'Mario Ishii', 'José Luis Espert',
  'Jorge Rial', 'Susana Giménez', 'Mirtha Legrand', 'Marcelo Tinelli',
  'Enzo Fernández', 'Lionel Messi', 'Julian Álvarez', 'Ángel Di María',
  'Marcelo Gallardo', 'Martín Demichelis', 'Ariel Holan',
  'Juan Román Riquelme', 'Mauro Rosales',
];

const LOCATION_NAMES = [
  'CABA', 'Rosario', 'Córdoba', 'Mendoza', 'La Plata', 'Mar del Plata',
  'Salta', 'Tucumán', 'Bariloche', 'Neuquén', 'Ushuaia', 'Corrientes',
  'Posadas', 'Resistencia', 'San Juan', 'San Luis', 'Santa Fe', 'Paraná',
  'Santiago del Estero', 'La Rioja', 'Catamarca', 'Formosa', 'Viedma',
  'Río Gallegos', 'Rawson', 'Villa María', 'Tandil', 'Olavarría',
  'Puerto Madryn', 'Trelew', 'Cafayate', 'Villa Gesell', 'Pinamar',
];

const STREETS = [
  'Av. Corrientes', 'Av. 9 de Julio', 'Av. Callao', 'Av. Santa Fe',
  'Av. Córdoba', 'Av. Rivadavia', 'Florida', 'Av. Alem', 'Av. Libertador',
  'Av. Cabildo', 'Av. Belgrano', 'Av. de Mayo', 'Av. Pueyrredón',
  'Av. Las Heras', 'Bvar. Oroño', 'Av. Colón', 'Av. Sarmiento',
];

const MONTHS_SPANISH = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ─── Article Template Generators ─────────────────────────────────────

const POLITICA_TITLES: string[] = [
  'Milei anunció un nuevo paquete de reformas para el Congreso',
  'Cristina Kirchner apuntó contra el gobierno en una nueva carta',
  'Patricia Bullrich presentó su plan de seguridad para la Provincia',
  'El Congreso debate la Ley de Presupuesto 2025 en medio de tensiones',
  'Milei desafía a la oposición con un nuevo DNU',
  'Kicillof cruzó a Nación por los fondos para Buenos Aires',
  'Rodríguez Larreta criticó el rumbo económico del gobierno',
  'Massa volvió a la escena política con fuertes críticas al oficialismo',
  'Villarruel presidió una sesión clave en el Senado',
  'Lousteau advierte sobre el riesgo institucional',
  'El PRO define su estrategia de cara a las legislativas',
  'Bregman denunció ajuste contra los trabajadores',
  'Francos busca acuerdos con gobernadores por la Ley Ómnibus',
  'La CGT convocó a un paro general contra las reformas',
  'Milei recibió a empresarios en Casa Rosada para destrabar inversiones',
  'Cristina apuntó contra la Corte Suprema en un acto en La Plata',
  'Bullrich lanzó un nuevo operativo en Rosario contra el narcotráfico',
  'El Senado aprobó la reforma laboral con media sanción',
  'Caputo anunció nuevas metas fiscales para el segundo semestre',
  'Milei viajará a Estados Unidos para reunirse con el FMI',
  'La oposición junta firmas para interpelar a ministros',
  'Grabois lanzó un movimiento social para frenar el ajuste',
  'El gobierno oficializó cambios en el gabinete nacional',
  'Macri rompió el silencio y criticó la gestión de Milei',
  'Elecciones 2025: cómo quedó el tablero político tras las PASO',
  'Karina Milei asumió como secretaria general de La Libertad Avanza',
  'Scioli evalúa sumarse al oficialismo tras su paso por Cancillería',
  'Diputados aprobó la emergencia económica en una sesión maratónica',
  'Milei disolvió la AFIP y creó un nuevo organismo recaudador',
  'El gobierno eliminó las PASO mediante un decreto presidencial',
  'Cristina reapareció en un acto del PJ en Avellaneda',
  'Bullrich denunció lawfare y pidió la liberación de presos políticos',
  'Massas: el gobierno nos ajusta a los laburantes, no a los ricos',
  'El Congreso convocó a una sesión especial por la reforma previsional',
  'Milei quiere privatizar Aerolíneas Argentinas y YPF',
  'Kicillof: la provincia no puede pagar los aumentos de luz y gas',
  'Lousteau presentó un proyecto para modificar la Corte Suprema',
  'El oficialismo perdió la mayoría en Diputados tras las elecciones',
  'La Libertad Avanza lanza su propio canal de streaming político',
  'Alberto Fernández reapareció en un seminario internacional',
  'Villarruel busca ampliar el rol del Senado en el control judicial',
  'Espert propuso una reforma impositiva radical',
  'Cinco gobernadores se reúnen para delinear una agenda federal',
  'El gobierno evalúa una nueva actualización de tarifas',
  'Se agrava la interna en el PRO entre halcones y palomas',
  'Milei convocó a sesiones extraordinarias para diciembre',
  'Luis Caputo: no hay plata, pero vamos a salir adelante',
  'Los diputados libertarios presentaron su propio proyecto de Código Penal',
  'Bregman: el ajuste lo paga la clase trabajadora',
  'El FMI aprobó la octava revisión y giró USD 800 millones',
  'Macri tantea un regreso a la política activa de cara al 2027',
  'Jorge Macri anunció medidas de seguridad para la Ciudad',
  'Polémica por el nuevo protocolo antipiquetes de Bullrich',
  'Milei desafía a la Corte Suprema por la fórmula de movilidad jubilatoria',
  'El Senado convirtió en ley la reforma del Estado',
  'Grabois: el hambre es una política de Estado de este gobierno',
  'Cristina cruzó a los jueces por la causa Vialidad',
  'Gobierno y campo: tensión por las retenciones',
  'Pullaro pidió más policías federales para Santa Fe',
  'Martín Llaryora se reúne con funcionarios de Economía',
];

const ECONOMIA_TITLES: string[] = [
  'El dólar blue superó los $800 y marcó un nuevo récord histórico',
  'La inflación de junio fue del 4.6%, según el INDEC',
  'El MERVAL subió 3% tras el anuncio del nuevo acuerdo con el FMI',
  'El riesgo país cayó a 1200 puntos básicos',
  'El BCRA compró USD 150 millones en el mercado oficial',
  'Se disparó el dólar CCL y el MEP en medio de la incertidumbre',
  'Caputo anunció nuevas medidas para contener la brecha cambiaria',
  'YPF descubre un nuevo yacimiento en Vaca Muerta',
  'El campo liquidó USD 350 millones en lo que va del mes',
  'La economía argentina creció 2.1% trimestral según el INDEC',
  'Se desacelera la inflación núcleo por segundo mes consecutivo',
  'El Banco Central subió las tasas de interés al 85%',
  'Las reservas brutas del BCRA superaron los USD 28.000 millones',
  'El dólar tarjeta se acerca a los $1.500',
  'Economía anunció la quita de subsidios a la energía',
  'Vaca Muerta alcanzó récord de producción de petróleo en mayo',
  'El FMI aprobó un nuevo desembolso tras la reunión técnica',
  'La deuda en pesos superó los $80 billones',
  'Las acciones argentinas subieron hasta 8% en Wall Street',
  'Inversores ponen la mira en los bonos soberanos argentinos',
  'El blue cerró a $830 y el oficial a $350',
  'La recaudación tributaria subió 112% interanual en junio',
  'Aumentaron los combustibles un 7% en todo el país',
  'La producción industrial cayó 3.2% en mayo',
  'El gobierno lanzó un nuevo blanqueo de capitales',
  'Los alquileres subieron 180% en lo que va del año',
  'Se derrumbó la venta de autos 0 km en el primer semestre',
  'La soja trepó a USD 580 en Chicago',
  'La actividad económica cayó 1.8% en abril',
  'Canasta básica: una familia necesitó $350.000 para no ser pobre',
  'El dólar CCL opera estable a $780 en medio de operaciones cautas',
  'BCRA endurece los controles cambiarios',
  'Las billeteras virtuales duplicaron los depósitos en junio',
  'Criptomonedas: el Bitcoin volvió a superar los USD 60.000',
  'Argentina colocó bonos BONAD por $2.5 billones',
  'El Índice de Precios al Consumidor acumula 60% en el semestre',
  'Las naftas aumentarán otro 6% en julio',
  'FMI proyecta una caída del PBI del 2.8% para Argentina',
  'La industria textil pierde 10.000 puestos de trabajo',
  'El swap con China se renueva por dos años más',
  'Las cerealeras denuncian presión fiscal récord',
  'Cavallo: sin un plan fiscal no saldremos de la crisis',
  'Las prepagas aumentarán 12% en julio',
  'Los alquileres temporarios crecen en CABA y superan a los hoteles',
  'Se disparó la venta de dólar futuro en el MAE',
  'Argentina vuelve a los mercados internacionales con un bono a 5 años',
  'El gobierno evalúa emitir una nueva moneda digital',
  'La minería argentina exportó USD 2.000 millones en el trimestre',
  'Came: las ventas minoristas cayeron 8.4% interanual',
  'Moody\'s mejoró la perspectiva de la deuda argentina',
  'El consumo masivo se desplomó 12% en mayo',
  'BCRA: las reservas netas son negativas por USD 5.000 millones',
  'El gobierno redujo retenciones al campo por 90 días',
  'La industria automotriz fabricó 30.000 unidades en mayo',
  'Las exportaciones argentinas crecieron 15% interanual',
  'El litio argentino atrae inversiones por USD 3.000 millones',
  'Caputo: en diciembre la inflación será de un dígito mensual',
  'El Banco Central actualizó las zonas de no intervención cambiaria',
  'La soja fue el principal generador de divisas en el semestre',
  'Aumento en la carne: el asado subió 15% en tres semanas',
];

const SOCIEDAD_TITLES: string[] = [
  'Tormenta severa en Buenos Aires: hay 150 evacuados en la Ciudad',
  'Protesta en el Congreso contra la reforma laboral',
  'El clima extremo golpea al AMBA con fuertes vientos y granizo',
  'Una multitud marchó en contra del ajuste del gobierno',
  'Crece la preocupación por la ola de calor en el norte del país',
  'El Hospital Garrahan necesita donantes de sangre',
  'Se realiza la Feria del Libro de Buenos Aires con récord de visitantes',
  'Corea del Norte: sorpresa en redes por el paso de un cohete espacial',
  'La UBA se mantiene entre las mejores universidades de la región',
  'Argentinos varados en el exterior por el paro de aerolíneas',
  'Cortes de luz en el AMBA: miles de usuarios sin servicio',
  'Marcha del Orgullo LGBTQ+ convocó a 500.000 personas',
  'Se incendió un depósito en Avellaneda y el humo se vio a 10 km',
  'El Riachuelo: avanza la limpieza pero aún queda mucho por hacer',
  'Paro de colectivos en el Conurbano bonaerense',
  'Descubrieron restos paleontológicos en la costa atlántica',
  'Buenos Aires fue elegida capital mundial del libro 2025',
  'El Gasoducto Néstor Kirchner comienza a operar a plena capacidad',
  'Alerta alimentaria: detectan salmonella en un lote de pollo',
  'Escasez de combustible en varias estaciones de servicio del interior',
  'La tecnología blockchain llega a las universidades argentinas',
  'Mar del Plata: temporada de verano con ocupación hotelera del 85%',
  'Se realizó con éxito el primer trasplante de médula en un hospital público',
  'Salta: suspenden clases por la ola de calor extrema',
  'Bailanta: la movida tropical vuelve a los barrios porteños',
  'Nueva edición de la Noche de los Museos en CABA',
  'Córdoba: se derrumbó un edificio en el centro de la ciudad',
  'La ANMAT prohibió la venta de un aceite de oliva trucho',
  'Arrancó el programa Previaje 2025 para incentivar el turismo',
  'El subte de Buenos Aires cumple 112 años',
  'Alerta por un nuevo virus respiratorio en niños',
  'El Obelisco cumple 89 años y lo celebran con un mapping',
  'Inundaciones en el Litoral: el río Paraná superó el nivel de alerta',
  'La Selección Argentina de básquet clasificó al Mundial',
  'Tragedia en la ruta 2: un micro cayó a un arroyo y dejó 5 heridos',
  'Aparecieron pintadas fascistas en la cancha de River',
  'Estudiantes secundarios tomaron colegios en reclamo de mejoras',
  'La Ciudad lanzó un nuevo sistema de bicicletas públicas',
  'Hallan un murciélago con rabia en un barrio de CABA',
  'Lanzan cohetes de la NASA desde la base de El Arenosillo',
  'La línea D de subte extendió su recorrido hasta Saavedra',
  'Alerta por ola de frío polar en la Patagonia',
  'Tres localidades bonaerenses en emergencia hídrica',
  'La Tana: la historia del bar más antiguo de San Telmo',
  'Google Maps actualizó las calles de CABA con realidad aumentada',
  'Inicio del ciclo lectivo 2025 en todo el país',
  'Trenes Argentinos sumó 20 formaciones 0 km',
  'La canasta navideña aumentó 130% interanual',
  'Semana Santa: millones de argentinos viajaron por el país',
  'El Teatro Colón reabrió con una temporada de ópera de primer nivel',
  'Paro docente: las clases no iniciaron en 5 provincias',
  'Descubren una nueva especie de dinosaurio en Neuquén',
  'La Costa: alerta por medusas en varias playas',
  'Mendoza: la Vendimia 2025 batió récord de asistencia',
  'Recuperan obras de arte robadas del Museo de Bellas Artes',
  'La NASA eligió a una científica argentina para una misión espacial',
  'Colapsó la aplicación SUBE por la alta demanda de recargas',
  'Bariloche: la nieve llegó temprano este año',
  'La pizza argentina fue declarada Patrimonio Cultural',
  'Priscila: la ballena franca que volvió a Puerto Madryn',
  'El programa Conectar Igualdad entregó 500.000 netbooks',
];

const DEPORTES_TITLES: string[] = [
  'River le ganó a Boca 3-1 en un Superclásico apasionante en el Monumental',
  'La Selección Argentina goleó a Brasil en el Maracaná',
  'Argentina se consagró campeón del Sudamericano Sub-20',
  'Boca empató sobre la hora ante San Lorenzo en la Bombonera',
  'Messi volvió a la Selección para las Eliminatorias',
  'Di María anunció su retiro de la Selección tras la Copa América',
  'River campeón de la Liga Profesional a falta de 3 fechas',
  'La ATP de Buenos Aires: Cerúndolo avanzó a semifinales',
  'Los Pumas vencieron a los All Blacks en un partidazo',
  'El fútbol argentino de luto: falleció César Luis Menotti',
  'Gallardo vuelve a River: el Muñeco firmó por 3 temporadas',
  'Boca busca técnico tras la salida de Martínez',
  'Argentina venció a Francia en la final del Mundial 2030',
  'La Liga Profesional define el descenso en la última fecha',
  'Riquelme: Boca tiene que pelear arriba siempre',
  'El tenis argentino celebra: tres jugadores en el top 50',
  'Independiente volvió a los primeros puestos tras 7 años',
  'Racing goleó a Huracán y se prende en la pelea por el título',
  'Demichelis: River tiene que mejorar en defensa',
  'La Selección femenina de fútbol clasificó al Mundial',
  'El rugby argentino: Los Pumas 7\'s ganaron una etapa del Circuito Mundial',
  'Vélez se consagró campeón de la Copa Argentina',
  'El Polo Argentino: La Dolfina ganó el Abierto de Palermo',
  'Maradona: homenaje a 5 años de su partida',
  'Newell\'s le ganó a Central el clásico rosarino',
  'El básquet argentino: la Liga Nacional tiene nuevo campeón',
  'Franco Colapinto: el argentino que corre en la Fórmula 2',
  'Paredes: quiero volver a Boca en el próximo mercado de pases',
  'Se sortearon los grupos de la Copa Libertadores 2025',
  'Sanz: la AFA trabaja para tener un fútbol más federal',
  'El Turismo Carretera corre en Termas de Río Hondo',
  'Argentina domina el ranking FIFA por tercer año consecutivo',
  'Tigre dio el batacazo y eliminó a Boca de la Copa Argentina',
  'Almada: el fútbol argentino tiene que mirar más a Europa',
  'La mamá de Messi: no saben lo que sufre cuando juega',
  'Palermo: soy hincha de Boca, pero admiro a Gallardo',
  'El hockey argentino: Las Leonas ganaron la medalla de oro en París',
  'River Plate: el Monumental será sede del Mundial 2030',
  'Tevez: el fútbol argentino necesita más gestión y menos política',
  'San Lorenzo busca salir del descenso con un nuevo DT',
  'Lanús goleó a Banfield en el clásico del Sur',
  'Estudiantes campeón de la Copa de la Liga Profesional',
  'El voley argentino clasificó a los Juegos Olímpicos',
  'Scaloni: el legado de la Selección trasciende los resultados',
  'Atlético Tucumán dio la sorpresa y le ganó a River',
  'Godoy Cruz se metió en zona de copas internacionales',
  'Pablo Aimar: la rompe como formador de juveniles',
  'Central Córdoba de Santiago del Estero en la Copa Sudamericana',
  'El automovilismo argentino de luto: murió Juan María Traverso',
  'Agüero: quería jugar en Independiente hasta los 40',
];

const SEGURIDAD_TITLES: string[] = [
  'Violento robo en un bancó de Palermo: dos delincuentes armados',
  'Desarticularon una banda de narcotráfico en Rosario',
  'Balacera en la villa 31: un muerto y tres heridos',
  'La policía detuvo a 5 personas por venta de drogas en Constitución',
  'Asesinaron a un comerciante en Lanús en un intento de robo',
  'Cayó el líder de una organización narco en el Conurbano',
  'Aumentaron 20% los robos en CABA durante el último trimestre',
  'Incautaron 500 kilos de cocaína en un operativo en el puerto',
  'Secuestraron a un empresario en San Isidro y piden rescate',
  'Enfrentamiento entre bandas narco en el sur de Rosario: 3 detenidos',
  'Detienen a una red de trata de personas en Mendoza',
  'La inseguridad en el Conurbano: crece la preocupación vecinal',
  'Policía bonaerense desmanteló un taller de autos robados',
  'Tres delincuentes detenidos tras una entradera en Belgrano',
  'Repudiable: atacaron a piedrazos a un colectivero en La Matanza',
  'Alerta en la Triple Frontera por contrabando y lavado de dinero',
  'Robaron la casa de un conocido actor en Nordelta',
  'Detienen a cuatro personas por estafas virtuales millonarias',
  'Bullrich anunció un nuevo operativo en las villas porteñas',
  'Narcotráfico en Santa Fe: allanaron 15 bunkers de droga',
  'Video: así fue el asalto a un blindado en la Panamericana',
  'Asesinaron a un policía en un control de tránsito en Moreno',
  'Córdoba: desbaratan una organización que vendía armas ilegales',
  'La ministra de seguridad bonaerense recorrió las zonas más calientes',
  'Prisión perpetua para el asesino del colectivero en Barracas',
  'Apareció ahorcado un preso en la comisaría de Avellaneda',
  'Robaron un cajero automático con explosivos en Córdoba',
  'La Gendarmería secuestró 2 toneladas de marihuana en Misiones',
  'Villa Gesell: allanaron un búnker de drogas sintéticas',
  'Salta: desarticularon una organización que traficaba cocaína desde Bolivia',
  'Denuncian que liberaron a un narco por un error judicial',
  'CABA: instalan 10.000 nuevas cámaras de seguridad en la Ciudad',
  'Motín en la cárcel de Devoto: presos tomaron el pabellón 5',
  'Cayó el clan Loza: una de las redes narco más grandes de la Provincia',
  'San Miguel: vecinos lincharon a un ladrón que intentó robar una casa',
  'Detectan un nuevo patrón de estafas con billeteras virtuales',
  'El gobierno lanzó el programa Barrios Seguros en el Conurbano',
  'Peligro en las rutas: aumentaron los robos a camiones',
  'Procesaron a 12 integrantes de una banda de piratas del asfalto',
  'Preocupación en La Boca: ola de robos en el barrio turístico',
  'Tucumán: detuvieron a un médico que vendía recetas truchas',
  'Violencia de género: 10 femicidios en lo que va del mes',
  'La Bonaerense sumó 1.500 nuevos efectivos en el Conurbano',
  'Fuga en la comisaría de Lomas de Zamora: buscan a 5 presos',
  'Robaron obras de arte valuadas en USD 500.000 en Recoleta',
  'Desbaratan un laboratorio clandestino de drogas sintéticas en Rosario',
  'Asesinaron a un testigo clave de un juicio narco en Santa Fe',
  'La inseguridad golpea al turismo en Mar del Plata',
  'Villa 1-11-14: la policía allanó 20 viviendas en busca de armas',
  'Bullrich: vamos a endurecer las penas para la reincidencia',
];

// ─── Event Clusters (same story, multiple sources) ──────────────────

interface EventCluster {
  id: string;
  templates: Array<{ source: SourceName; title: string; summary: string }>;
  category: Category;
  location: GeoLocation | null;
  date: Date;
}

function createEventClusters(rng: SeededRandom): EventCluster[] {
  const baseDate = new Date();
  baseDate.setUTCHours(12, 0, 0, 0);

  const events: EventCluster[] = [
    {
      id: 'event-milei-paquete',
      category: 'politica',
      location: LOCATIONS.find(l => l.landmark === 'Casa Rosada') ?? LOCATIONS[0],
      date: new Date(baseDate.getTime() - rng.nextInt(0, 24) * 60 * 60 * 1000),
      templates: [
        { source: 'clarin', title: 'Milei anunció un nuevo paquete económico con reformas de fondo', summary: 'El presidente Javier Milei presentó esta mañana en Casa Rosada un ambicioso paquete de medidas económicas que incluye una reforma del Estado, desregulación de mercados y un nuevo régimen de incentivos a las inversiones. El anuncio generó reacciones inmediatas tanto del arco político como de los mercados.' },
        { source: 'lanacion', title: 'Las claves del nuevo paquete económico que anunció Milei', summary: 'El Gobierno nacional dio a conocer un conjunto de reformas estructurales que buscan reactivar la economía y reducir el déficit fiscal. Entre los puntos principales se destacan la eliminación de organismos públicos, la unificación cambiaria y la baja de retenciones al campo.' },
        { source: 'infobae', title: 'Milei lanzó un shock fiscal: eliminó 15 organismos del Estado', summary: 'En una conferencia de prensa desde la Casa Rosada, el presidente detalló las 15 entidades estatales que serán disueltas como parte del plan de ajuste. También confirmó que enviará al Congreso un proyecto para reformar el sistema tributario.' },
        { source: 'ambito', title: 'Paquete económico de Milei: los mercados reaccionan con optimismo', summary: 'Las acciones y bonos argentinos operan en terreno positivo tras el anuncio del paquete económico. El riesgo país cayó 50 puntos básicos y el MERVAL subió 4% en la apertura. Analistas consideran que las medidas van en la dirección correcta pero advierten sobre los riesgos de implementación.' },
      ],
    },
    {
      id: 'event-dolar-blue',
      category: 'economia',
      location: LOCATIONS.find(l => l.city === 'Buenos Aires') ?? LOCATIONS[0],
      date: new Date(baseDate.getTime() - rng.nextInt(24, 48) * 60 * 60 * 1000),
      templates: [
        { source: 'ambito', title: 'Dólar blue superó los $800 y marcó un nuevo récord histórico', summary: 'El dólar paralelo rompió la barrera de los $800 pesos y se negoció a $805 en las cuevas del microcentro porteño. La brecha con el oficial se amplió al 60%. Operadores consultados anticipan que la presión continuará en los próximos días.' },
        { source: 'cronista', title: 'Dólar blue disparado: cerró a $810 en medio de la incertidumbre', summary: 'La divisa paralela alcanzó un nuevo máximo histórico impulsada por la demanda de cobertura y la falta de señales claras sobre el rumbo cambiario. El CCL y el MEP también operaron en alza.' },
        { source: 'c5n', title: 'El dólar blue volvió a subir: ya se consigue a $820 en algunas cuevas', summary: 'La cotización del dólar informal no da tregua y sigue marcando récords. Especialistas consultados por C5N advierten que la brecha cambiaria podría seguir ampliándose si no hay medidas concretas del BCRA.' },
      ],
    },
    {
      id: 'event-protesta-congreso',
      category: 'sociedad',
      location: LOCATIONS.find(l => l.landmark === 'Congreso de la Nación') ?? LOCATIONS[0],
      date: new Date(baseDate.getTime() - rng.nextInt(48, 72) * 60 * 60 * 1000),
      templates: [
        { source: 'pagina12', title: 'Masiva protesta en el Congreso contra la reforma laboral del gobierno', summary: 'Organizaciones sociales, sindicatos y partidos de izquierda se congregaron en las inmediaciones del Congreso para rechazar la reforma laboral que impulsa el oficialismo. La policía estimó una concurrencia de más de 50 mil personas.' },
        { source: 'tn', title: 'Protesta en Congreso: manifestantes y policías enfrentados', summary: 'La marcha contra la reforma laboral derivó en enfrentamientos entre manifestantes y fuerzas de seguridad. Hay al menos 10 detenidos y varios heridos leves. El gobierno denunció intentos de vandalización del Congreso.' },
        { source: 'infobae', title: 'Jornada de protesta en el Congreso por la reforma laboral', summary: 'Miles de personas se movilizaron hasta la Plaza de los Dos Congresos mientras los diputados debatían el proyecto de reforma laboral. La sesión se desarrolló con fuerte custodia policial y el resultado fue la media sanción del proyecto.' },
      ],
    },
    {
      id: 'event-superclasico',
      category: 'deportes',
      location: LOCATIONS.find(l => l.city === 'Buenos Aires') ?? LOCATIONS[0],
      date: new Date(baseDate.getTime() - rng.nextInt(72, 96) * 60 * 60 * 1000),
      templates: [
        { source: 'clarin', title: 'River le ganó a Boca 3-1 en un Superclásico para el infarto', summary: 'River Plate se impuso a Boca Juniors por 3 a 1 en el Monumental, en un partido correspondiente a la fecha 15 de la Liga Profesional. Los goles del Millonario fueron convertidos por Borja, Nacho Fernández y Colidio. Boca descontó sobre el final mediante Cavani.' },
        { source: 'lanacion', title: 'River dominó a Boca y se quedó con el Superclásico', summary: 'Con un juego sólido y eficaz, River se adueñó del clásico más importante del fútbol argentino. Boca intentó reaccionar en el segundo tiempo pero no pudo sostener la presión. El resultado deja a River como único escolta del líder.' },
      ],
    },
    {
      id: 'event-tormenta',
      category: 'sociedad',
      location: LOCATIONS.find(l => l.city === 'Buenos Aires' && l.neighborhood === 'Palermo') ?? LOCATIONS[0],
      date: new Date(baseDate.getTime() - rng.nextInt(96, 120) * 60 * 60 * 1000),
      templates: [
        { source: 'clarin', title: 'Tormenta severa en Buenos Aires: hay 150 evacuados y alerta naranja', summary: 'Una tormenta de gran intensidad azotó al AMBA durante la madrugada dejando un saldo de 150 evacuados, árboles caídos y múltiples anegamientos. El Servicio Meteorológico Nacional mantiene la alerta naranja para toda la región.' },
        { source: 'tn', title: 'Buenos Aires bajo el agua: las impactantes imágenes de la tormenta', summary: 'La ciudad amaneció con calles anegadas y decenas de árboles caídos tras una tormenta que descargó más de 100 milímetros en menos de 6 horas. Defensa Civil trabaja en los barrios más afectados como Palermo, Belgrano y Nuñez.' },
      ],
    },
    {
      id: 'event-cfk-senado',
      category: 'politica',
      location: LOCATIONS.find(l => l.landmark === 'Congreso de la Nación') ?? LOCATIONS[0],
      date: new Date(baseDate.getTime() - rng.nextInt(120, 144) * 60 * 60 * 1000),
      templates: [
        { source: 'pagina12', title: 'Cristina Kirchner criticó al gobierno desde el Senado: "Están destruyendo el país"', summary: 'La presidenta del Senado encabezó una sesión especial donde apuntó contra la política económica del oficialismo. Durante su discurso, Cristina cuestionó el rumbo del gobierno y defendió las políticas de la gestión anterior.' },
        { source: 'c5n', title: 'CFK apuntó contra Milei en el Senado: "No saben gobernar"', summary: 'La vicepresidenta utilizó su banca en el Senado para realizar una dura crítica al gobierno nacional, señalando que las medidas adoptadas están perjudicando a los sectores más vulnerables. El bloque oficialista abandonó el recinto en señal de protesta.' },
        { source: 'perfil', title: 'La crítica de Cristina Kirchner al gobierno que dividió al Senado', summary: 'El discurso de la presidenta del Senado generó un fuerte cruce con los legisladores oficialistas. Cristina Kirchner advirtió que "las políticas de ajuste no son el camino" y pidió una revisión urgente del programa económico.' },
      ],
    },
    {
      id: 'event-ypf-vaca-muerta',
      category: 'economia',
      location: LOCATIONS.find(l => l.landmark === 'Vaca Muerta') ?? LOCATIONS[0],
      date: new Date(baseDate.getTime() - rng.nextInt(144, 168) * 60 * 60 * 1000),
      templates: [
        { source: 'cronista', title: 'YPF descubrió un nuevo yacimiento en Vaca Muerta que triplica las reservas actuales', summary: 'YPF anunció el descubrimiento de un nuevo yacimiento de petróleo no convencional en la formación Vaca Muerta, ubicado en la provincia de Neuquén. Las estimaciones preliminares indican que podría triplicar las reservas actuales de la compañía.' },
        { source: 'ambito', title: 'El megayacimiento de YPF en Vaca Muerta que cambiará la matriz energética', summary: 'El hallazgo de YPF en la cuenca neuquina representa el descubrimiento más importante de la última década. El presidente de la compañía aseguró que las inversiones para su explotación alcanzarán los USD 3.000 millones en los próximos 5 años.' },
      ],
    },
  ];

  return events;
}

// ─── Helper functions ──────────────────────────────────────────────

function generateId(title: string, url: string): string {
  return crypto.createHash('sha256').update(title + url).digest('hex').slice(0, 16);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function generateUrl(source: SourceName, title: string, rng: SeededRandom): string {
  const domain = SOURCE_DOMAINS[source];
  const slug = slugify(title);
  const rand = rng.nextInt(1000, 9999);
  return `https://www.${domain}/${slug}-${rand}`;
}

function generateAiScore(category: Category, rng: SeededRandom): AiScore {
  const baseScores: Record<Category, number> = {
    politica: 85,
    economia: 80,
    sociedad: 65,
    deportes: 55,
    seguridad: 70,
  };
  const base = baseScores[category] ?? 60;
  const score = Math.min(100, Math.max(0, base + rng.nextInt(-20, 15)));

  const reasonings: string[] = [
    'Artículo relevante para la audiencia argentina',
    'Cobertura política de alto impacto',
    'Información económica sensible para inversores',
    'Cobertura de interés general con impacto social',
    'Noticia deportiva con alto engagement potencial',
    'Noticia de seguridad con relevancia regional',
    'Evento con potencial de discusión pública significativa',
    'Tema con alta probabilidad de generar interacción en redes',
    'Fuente confiable con cobertura de primera mano',
    'La relevancia del tema justifica su publicación automática',
  ];

  return {
    publish: score >= 50,
    reasoning: rng.pick(reasonings),
  };
}

function randomLocation(rng: SeededRandom): GeoLocation | null {
  // ~60% of articles have location
  if (rng.next() > 0.6) return null;
  return rng.pick(LOCATIONS);
}

function randomDate(base: Date, rng: SeededRandom): Date {
  const d = new Date(base);
  d.setTime(d.getTime() - rng.nextInt(0, 7 * 24 * 60 * 60) * 1000); // up to 7 days ago
  d.setUTCHours(rng.nextInt(6, 23), rng.nextInt(0, 59), rng.nextInt(0, 59), 0);
  return d;
}

function dateString(d: Date): string {
  return d.toISOString();
}

// ─── Dynamic title generation templates ──────────────────────────────

const POLITICA_VERBS = [
  'anunció', 'presentó', 'confirmó', 'denunció', 'rechazó', 'aprobó',
  'criticó', 'defendió', 'impulsó', 'propuso', 'cuestionó', 'respaldó',
  'pidió', 'exigió', 'prometió', 'evaluó', 'lanzó', 'firmó',
];

const POLITICA_TOPICS = [
  'la reforma del Estado', 'el nuevo presupuesto', 'las jubilaciones',
  'la política económica', 'la seguridad', 'la educación pública',
  'la reforma laboral', 'el sistema de salud', 'la coparticipación',
  'la deuda externa', 'los subsidios', 'las retenciones',
  'la obra pública', 'la reforma judicial', 'el federalismo',
  'la política exterior', 'el sistema tributario', 'la emergencia social',
  'la reforma política', 'la transparencia', 'el gasto público',
  'la política salarial', 'la inflación', 'el tipo de cambio',
];

const ECONOMIA_VERBS = [
  'subió', 'cayó', 'marcó', 'alcanzó', 'superó', 'registró',
  'anunció', 'confirmó', 'proyectó', 'disparó', 'desaceleró', 'creció',
];

const ECONOMIA_TOPICS = [
  'el dólar blue', 'la inflación', 'el MERVAL', 'el riesgo país', 'las reservas',
  'la actividad económica', 'el consumo', 'la recaudación', 'la industria',
  'el campo', 'la construcción', 'las exportaciones', 'las importaciones',
  'los bonos', 'las acciones', 'el crédito', 'la inversión',
  'la producción', 'la venta', 'la cotización', 'los precios',
];

const SOCIEDAD_VERBS = [
  'ocurrió', 'sucedió', 'se registró', 'se realizó', 'se celebró',
  'se canceló', 'se suspendió', 'se inauguró', 'se presentó', 'se conoció',
  'se anunció', 'se difundió', 'se confirmó', 'alertan', 'advierten',
];

const SOCIEDAD_TOPICS = [
  'una protesta', 'un incendio', 'una inundación', 'un accidente',
  'un evento cultural', 'una muestra', 'un festival', 'una marcha',
  'un corte de luz', 'un paro', 'un operativo', 'un alerta meteorológico',
  'una ola de calor', 'una tormenta', 'una nevada histórica',
];

const DEPORTES_VERBS = [
  'ganó', 'perdió', 'empató', 'goeló', 'venció', 'clasificó',
  'derrotó', 'superó', 'consiguió', 'logró', 'celebró',
];

const SOCIEDAD_ADVERBS = ['ayer', 'hoy', 'durante la madrugada', 'este fin de semana', 'en las últimas horas'];

function generateDynamicTitles(category: Category, count: number, existingTitles: string[], rng: SeededRandom): string[] {
  const results: string[] = [...existingTitles];
  rng.shuffle(results);

  // Define generation components per category
  const configs: Record<Category, { verbs: string[]; topics: string[]; people?: string[]; prefix?: string[] } | null> = {
    politica: {
      verbs: POLITICA_VERBS,
      topics: POLITICA_TOPICS,
      people: PERSONAS.slice(0, 15),
      prefix: ['Polémica por', 'Nuevo capítulo en', 'Se destraba', 'Preocupación por'],
    },
    economia: {
      verbs: ECONOMIA_VERBS,
      topics: ECONOMIA_TOPICS,
      prefix: ['Atención: ', 'Alerta: ', 'Impactante: ', 'Último momento: '],
    },
    sociedad: {
      verbs: SOCIEDAD_VERBS,
      topics: SOCIEDAD_TOPICS,
      prefix: [],
    },
    deportes: {
      verbs: DEPORTES_VERBS,
      topics: ['River', 'Boca', 'la Selección', 'Racing', 'Independiente', 'San Lorenzo', 'Vélez', 'Estudiantes', 'Newell\'s', 'Central'],
      prefix: ['Espectacular: ', 'Impresionante: ', 'No te lo pierdas: ', 'Momento histórico: '],
    },
    seguridad: null, // Use curated only for seguridad
  };

  const config = configs[category];
  if (category === 'seguridad' || !config) {
    // For seguridad, we only have 50 curated titles which is exactly what we need
    return results;
  }

  // Keep generating until we have enough
  const seen = new Set(results.map(t => t.toLowerCase().trim()));
  let attempts = 0;

  while (results.length < count && attempts < count * 5) {
    attempts++;
    let title: string;

    if (category === 'politica') {
      const usePrefix = rng.next() > 0.6;
      const person = rng.pick(config.people!);
      const verb = rng.pick(config.verbs);
      const topic = rng.pick(config.topics);
      if (usePrefix) {
        const prefix = rng.pick(config.prefix!);
        title = `${prefix} ${person} ${verb} ${topic}`;
      } else {
        const structure = rng.nextInt(0, 2);
        if (structure === 0) title = `${person} ${verb} ${topic}`;
        else if (structure === 1) title = `${verb.charAt(0).toUpperCase() + verb.slice(1)} ${topic}: la propuesta de ${person}`;
        else title = `${topic}: ${person} ${verb} y genera controversia`;
      }
    } else if (category === 'economia') {
      const usePrefix = rng.next() > 0.7;
      const verb = rng.pick(config.verbs);
      const topic = rng.pick(config.topics);
      const value = rng.nextInt(1, 100);
      const period = rng.pick(['en mayo', 'en junio', 'en el trimestre', 'en lo que va del mes']);
      if (usePrefix) {
        const prefix = rng.pick(config.prefix!);
        title = `${prefix} ${topic} ${verb} ${value}% ${period}`;
      } else {
        title = `${topic.charAt(0).toUpperCase() + topic.slice(1)} ${verb} ${value}% ${period}`;
      }
    } else if (category === 'sociedad') {
      const adv = rng.pick(SOCIEDAD_ADVERBS);
      const verb = rng.pick(config.verbs);
      const topic = rng.pick(config.topics);
      const place = rng.pick(LOCATION_NAMES);
      title = `${verb.charAt(0).toUpperCase() + verb.slice(1)} ${topic} en ${place} ${adv}`;
    } else {
      const verb = rng.pick(config.verbs);
      const team = rng.pick(config.topics);
      const score = `${rng.nextInt(1, 5)}-${rng.nextInt(0, 3)}`;
      const rival = rng.pick(config.topics.filter(t => t !== team));
      title = `${team} ${verb} ${rng.next() > 0.5 ? 'por ' + score + ' a ' : 'a '}${rival}`;
    }

    const key = title.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      results.push(title);
    }
  }

  return results;
}

function generateArticlesForCategory(
  category: Category,
  titles: string[],
  count: number,
  rng: SeededRandom,
  baseDate: Date,
): ArticleTemplate[] {
  const allTitles = generateDynamicTitles(category, count, titles, rng);
  const articles: ArticleTemplate[] = [];

  const summaryTemplates: string[] = [
    'En un hecho de gran relevancia para el país, {title_lower}. Las repercusiones no se hicieron esperar entre los principales actores políticos y sociales.',
    '{title_lower}. Así lo confirmaron fuentes oficiales que precisaron los detalles de la medida que impacta de lleno en la agenda pública.',
    '{title_lower}. Especialistas consultados coincidieron en que se trata de un acontecimiento que marcará un antes y un después en la materia.',
    '{title_lower}. La noticia generó un fuerte debate en las redes sociales y dividió opiniones entre los analistas del tema.',
    'En las últimas horas, {title_lower}. Autoridades confirmaron la información y se esperan novedades en las próximas jornadas.',
  ];

  for (let i = 0; i < count && i < allTitles.length; i++) {
    const t = allTitles[i];
    const lower = t.charAt(0).toLowerCase() + t.slice(1);
    const summaryTemplate = rng.pick(summaryTemplates).replace('{title_lower}', lower);

    articles.push({
      title: t,
      summary: summaryTemplate,
      category,
    });
  }

  return articles;
}

// ─── Main seeding logic ─────────────────────────────────────────────

function getArgs(): { clear: boolean; sourcesOnly: boolean } {
  const args = process.argv.slice(2);
  return {
    clear: args.includes('--clear'),
    sourcesOnly: args.includes('--sources'),
  };
}

function updateSourcesConfig(): void {
  const realRssFeeds: Record<SourceName, { type: string; url: string; category: Category }> = {
    clarin: { type: 'rss', url: 'https://www.clarin.com/rss/lo-ultimo/', category: 'sociedad' },
    lanacion: { type: 'rss', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/', category: 'sociedad' },
    infobae: { type: 'rss', url: 'https://www.infobae.com/arc/outboundfeeds/rss/', category: 'sociedad' },
    ambito: { type: 'rss', url: 'https://www.ambito.com/rss/', category: 'economia' },
    cronista: { type: 'rss', url: 'https://www.cronista.com/rss/', category: 'economia' },
    pagina12: { type: 'rss', url: 'https://www.pagina12.com.ar/rss/', category: 'sociedad' },
    tn: { type: 'rss', url: 'https://tn.com.ar/feed/', category: 'sociedad' },
    c5n: { type: 'rss', url: 'https://www.c5n.com/rss/', category: 'sociedad' },
    a24: { type: 'rss', url: 'https://www.a24.com/rss/', category: 'sociedad' },
    america: { type: 'scrape', url: 'https://www.americatv.com.ar/', category: 'sociedad' },
    canal26: { type: 'rss', url: 'https://www.canal26.com/rss/', category: 'sociedad' },
    perfil: { type: 'rss', url: 'https://www.perfil.com/feed/', category: 'sociedad' },
  };

  const config = {
    _comment: 'Argentine news sources for the ingestion pipeline (updated with real RSS feeds)',
    sources: Object.entries(realRssFeeds).map(([name, info]) => ({
      name,
      type: info.type,
      url: info.url,
      category: info.category,
      rateLimitMs: info.type === 'scrape' ? 10000 : 5000,
      ...(info.type === 'scrape'
        ? {
            cssSelectors: {
              article: 'article',
              title: 'h2 a, h3 a',
              summary: 'p',
              link: 'h2 a, h3 a',
              timestamp: 'time',
            },
          }
        : {}),
    })),
  };

  fs.writeFileSync(SOURCES_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log(`[seed] Updated sources config at ${SOURCES_PATH}`);
  console.log(`[seed]  RSS sources: ${config.sources.filter(s => s.type === 'rss').length}`);
  console.log(`[seed]  Scrape sources: ${config.sources.filter(s => s.type === 'scrape').length}`);
}

function clearDatabase(db: Database.Database): void {
  console.log('[seed] Clearing existing data...');
  db.exec('DELETE FROM tweet_history');
  db.exec('DELETE FROM news_items');
  console.log('[seed] Data cleared.');
}

function seedDatabase(): void {
  // ── Ensure data dir exists ────────────────────────────────────────
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  console.log(`[seed] Connected to ${DB_PATH}`);

  const args = getArgs();

  if (args.clear) {
    clearDatabase(db);
  }

  // ── Seed sources table ─────────────────────────────────────────────
  console.log('[seed] Seeding sources table...');
  const upsertSource = db.prepare(`
    INSERT OR REPLACE INTO sources (name, type, url, category, rate_limit_ms, status, last_fetched_at)
    VALUES (?, ?, ?, ?, ?, 'healthy', ?)
  `);

  const sourceMeta: Array<{ name: SourceName; type: string; url: string; category: Category; rateLimitMs: number }> = [
    { name: 'clarin', type: 'rss', url: 'https://www.clarin.com/rss/lo-ultimo/', category: 'sociedad', rateLimitMs: 5000 },
    { name: 'lanacion', type: 'rss', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/', category: 'sociedad', rateLimitMs: 5000 },
    { name: 'infobae', type: 'rss', url: 'https://www.infobae.com/arc/outboundfeeds/rss/', category: 'sociedad', rateLimitMs: 5000 },
    { name: 'ambito', type: 'rss', url: 'https://www.ambito.com/rss/', category: 'economia', rateLimitMs: 5000 },
    { name: 'cronista', type: 'rss', url: 'https://www.cronista.com/rss/', category: 'economia', rateLimitMs: 5000 },
    { name: 'pagina12', type: 'rss', url: 'https://www.pagina12.com.ar/rss/', category: 'sociedad', rateLimitMs: 5000 },
    { name: 'tn', type: 'rss', url: 'https://tn.com.ar/feed/', category: 'sociedad', rateLimitMs: 5000 },
    { name: 'c5n', type: 'rss', url: 'https://www.c5n.com/rss/', category: 'sociedad', rateLimitMs: 5000 },
    { name: 'a24', type: 'rss', url: 'https://www.a24.com/rss/', category: 'sociedad', rateLimitMs: 5000 },
    { name: 'america', type: 'scrape', url: 'https://www.americatv.com.ar/', category: 'sociedad', rateLimitMs: 10000 },
    { name: 'canal26', type: 'rss', url: 'https://www.canal26.com/rss/', category: 'sociedad', rateLimitMs: 5000 },
    { name: 'perfil', type: 'rss', url: 'https://www.perfil.com/feed/', category: 'sociedad', rateLimitMs: 5000 },
  ];

  const now = new Date().toISOString();
  const insertSource = db.transaction(() => {
    for (const s of sourceMeta) {
      upsertSource.run(s.name, s.type, s.url, s.category, s.rateLimitMs, now);
    }
  });
  insertSource();
  console.log(`[seed] ${sourceMeta.length} sources inserted/updated.`);

  // ── Seed news_items ────────────────────────────────────────────────

  const rng = new SeededRandom(42); // deterministic seed

  const baseDate = new Date();
  baseDate.setUTCHours(12, 0, 0, 0);

  const insertNews = db.prepare(`
    INSERT OR IGNORE INTO news_items
      (id, title, summary, source, sources, url, category, published_at, ingested_at, location, ai_score, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const allArticles: Array<{
    title: string;
    summary: string;
    source: SourceName;
    url: string;
    category: Category;
    publishedAt: string;
    location: GeoLocation | null;
    aiScore: AiScore;
  }> = [];

  // ── Generate event cluster articles ──────────────────────────────
  console.log('[seed] Generating event clusters...');
  const eventClusters = createEventClusters(rng);

  for (const cluster of eventClusters) {
    for (const tmpl of cluster.templates) {
      const url = generateUrl(tmpl.source, tmpl.title, rng);
      const aiScore = generateAiScore(cluster.category, rng);
      allArticles.push({
        title: tmpl.title,
        summary: tmpl.summary,
        source: tmpl.source,
        url,
        category: cluster.category,
        publishedAt: dateString(cluster.date),
        location: cluster.location,
        aiScore,
      });
    }
  }

  // ── Generate category-based articles ──────────────────────────────
  console.log('[seed] Generating política articles (150)...');
  const politicaArticles = generateArticlesForCategory('politica', POLITICA_TITLES, 150, rng, baseDate);
  for (const a of politicaArticles) {
    // Pick a source weighted more toward political coverage
    const sourcesForCategory: SourceName[] = ['clarin', 'lanacion', 'infobae', 'pagina12', 'tn', 'c5n', 'a24'];
    const source = rng.pick(sourcesForCategory);

    // ~25% chance of having 2 sources (simulating a story picked up by multiple outlets)
    // In the seed, we create separate articles but with slightly different times
    const url = generateUrl(source, a.title, rng);

    allArticles.push({
      title: a.title,
      summary: a.summary,
      source,
      url,
      category: 'politica',
      publishedAt: dateString(randomDate(baseDate, rng)),
      location: randomLocation(rng),
      aiScore: generateAiScore('politica', rng),
    });
  }

  console.log('[seed] Generating economía articles (150)...');
  const economiaArticles = generateArticlesForCategory('economia', ECONOMIA_TITLES, 150, rng, baseDate);
  for (const a of economiaArticles) {
    const sourcesForCategory: SourceName[] = ['ambito', 'cronista', 'clarin', 'lanacion', 'infobae', 'c5n'];
    const source = rng.pick(sourcesForCategory);
    const url = generateUrl(source, a.title, rng);

    allArticles.push({
      title: a.title,
      summary: a.summary,
      source,
      url,
      category: 'economia',
      publishedAt: dateString(randomDate(baseDate, rng)),
      location: randomLocation(rng),
      aiScore: generateAiScore('economia', rng),
    });
  }

  console.log('[seed] Generating sociedad articles (100)...');
  const sociedadArticles = generateArticlesForCategory('sociedad', SOCIEDAD_TITLES, 100, rng, baseDate);
  for (const a of sociedadArticles) {
    const source = rng.pick(SOURCE_NAMES);
    const url = generateUrl(source, a.title, rng);

    allArticles.push({
      title: a.title,
      summary: a.summary,
      source,
      url,
      category: 'sociedad',
      publishedAt: dateString(randomDate(baseDate, rng)),
      location: randomLocation(rng),
      aiScore: generateAiScore('sociedad', rng),
    });
  }

  console.log('[seed] Generating deportes articles (50)...');
  const deportesArticles = generateArticlesForCategory('deportes', DEPORTES_TITLES, 50, rng, baseDate);
  for (const a of deportesArticles) {
    const sourcesForCategory: SourceName[] = ['clarin', 'lanacion', 'infobae', 'tn', 'a24'];
    const source = rng.pick(sourcesForCategory);
    const url = generateUrl(source, a.title, rng);

    allArticles.push({
      title: a.title,
      summary: a.summary,
      source,
      url,
      category: 'deportes',
      publishedAt: dateString(randomDate(baseDate, rng)),
      location: randomLocation(rng),
      aiScore: generateAiScore('deportes', rng),
    });
  }

  console.log('[seed] Generating seguridad articles (50)...');
  const seguridadArticles = generateArticlesForCategory('seguridad', SEGURIDAD_TITLES, 50, rng, baseDate);
  for (const a of seguridadArticles) {
    const sourcesForCategory: SourceName[] = ['clarin', 'lanacion', 'infobae', 'tn', 'c5n', 'a24', 'canal26'];
    const source = rng.pick(sourcesForCategory);
    const url = generateUrl(source, a.title, rng);

    allArticles.push({
      title: a.title,
      summary: a.summary,
      source,
      url,
      category: 'seguridad',
      publishedAt: dateString(randomDate(baseDate, rng)),
      location: randomLocation(rng),
      aiScore: generateAiScore('seguridad', rng),
    });
  }

  // ── Insert all articles ──────────────────────────────────────────
  console.log(`[seed] Inserting ${allArticles.length} total articles...`);

  let insertedCount = 0;
  let skippedCount = 0;

  const insertBatch = db.transaction(() => {
    for (const a of allArticles) {
      const id = generateId(a.title, a.url);
      const sourcesJson = JSON.stringify([a.source]);
      const locationJson = a.location ? JSON.stringify(a.location) : null;
      const aiScoreJson = JSON.stringify(a.aiScore);
      const ingestedAt = new Date().toISOString();

      const result = insertNews.run(
        id,
        a.title,
        a.summary,
        a.source,
        sourcesJson,
        a.url,
        a.category,
        a.publishedAt,
        ingestedAt,
        locationJson,
        aiScoreJson,
        'ingested',
      );

      if (result.changes > 0) {
        insertedCount++;
      } else {
        skippedCount++;
      }
    }
  });

  insertBatch();

  console.log(`[seed] Articles inserted: ${insertedCount}`);
  if (skippedCount > 0) {
    console.log(`[seed] Articles skipped (duplicates): ${skippedCount}`);
  }

  // ── Seed tweet_history ────────────────────────────────────────────
  console.log('[seed] Generating tweet history...');

  // Get some articles to associate tweets with
  const existingArticles = db.prepare(
    'SELECT id, title FROM news_items ORDER BY RANDOM() LIMIT 55',
  ).all() as Array<{ id: string; title: string }>;

  const insertTweet = db.prepare(`
    INSERT INTO tweet_history (article_id, tweet_id, posted_at, status, error)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tweetTemplates: string[] = [
    '📰 {title} | Enterate de todo en argentinaradar.com',
    '🔴 AHORA: {title} | Seguí la cobertura en vivo',
    '🇦🇷 {title} | Toda la información actualizada',
    '⚠️ {title} | La noticia que todos están comentando',
    '📢 {title} | Compartí esta nota con tus amigos',
    '💡 {title} | Información clave para entender el contexto',
    '🔥 {title} | Está explotando en nuestras redes',
    '📌 {title} | No te pierdas los detalles de esta historia',
  ];

  let tweetInserted = 0;

  const insertTweets = db.transaction(() => {
    // 50 published tweets
    for (let i = 0; i < 50 && i < existingArticles.length; i++) {
      const article = existingArticles[i];
      const tweetId = crypto.randomBytes(8).toString('hex');
      const postedAt = new Date(Date.now() - rng.nextInt(0, 7 * 24 * 60 * 60) * 1000).toISOString();
      const tweetText = rng.pick(tweetTemplates).replace('{title}', article.title.slice(0, 100));

      insertTweet.run(article.id, tweetId, postedAt, 'published', null);
      tweetInserted++;
    }

    // 2 in dead letter queue (failed tweets)
    for (let i = 50; i < 52 && i < existingArticles.length; i++) {
      const article = existingArticles[i];
      const postedAt = new Date(Date.now() - rng.nextInt(0, 3 * 24 * 60 * 60) * 1000).toISOString();

      const errors = [
        'Twitter API error 403: Forbidden — account suspended',
        'Twitter API error 429: Rate limit exceeded — retry after 900 seconds',
      ];

      insertTweet.run(article.id, null, postedAt, 'failed', rng.pick(errors));
      tweetInserted++;
    }
  });

  insertTweets();
  console.log(`[seed] Tweet history entries inserted: ${tweetInserted}`);

  // ── Summary ──────────────────────────────────────────────────────
  const totalNews = db.prepare('SELECT COUNT(*) as cnt FROM news_items').get() as { cnt: number };
  const totalTweets = db.prepare('SELECT COUNT(*) as cnt FROM tweet_history').get() as { cnt: number };
  const categories = db.prepare(
    'SELECT category, COUNT(*) as cnt FROM news_items GROUP BY category ORDER BY cnt DESC',
  ).all() as Array<{ category: string; cnt: number }>;

  console.log('\n═══════════════════════════════════════');
  console.log('  SEED COMPLETE');
  console.log('═══════════════════════════════════════');
  console.log(`  Total news items:    ${totalNews.cnt}`);
  console.log(`  Total tweets:       ${totalTweets.cnt}`);
  console.log('  ── Category breakdown ──');
  for (const c of categories) {
    console.log(`    ${c.category.padEnd(12)} ${c.cnt}`);
  }
  console.log('═══════════════════════════════════════\n');

  db.close();
}

// ─── Entry point ────────────────────────────────────────────────────

function main(): void {
  const args = getArgs();

  console.log('═══════════════════════════════════════');
  console.log('  ArgentinaRadar — Database Seed');
  console.log('═══════════════════════════════════════');

  if (args.sourcesOnly) {
    console.log('[seed] Mode: sources-only (updating sources.json)');
    updateSourcesConfig();
    return;
  }

  // First update sources config
  updateSourcesConfig();

  // Then seed the database
  seedDatabase();
}

main();
