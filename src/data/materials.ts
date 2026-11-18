import type { MaterialPreset } from '../types/plan';

export type MaterialCategory =
  | 'Paint & Wall'
  | 'Wood & Timber'
  | 'Stone & Brick'
  | 'Tile & Terrazzo'
  | 'Textiles & Leather'
  | 'Metals & Plastics';

export interface MaterialPresetMeta {
  id: MaterialPreset;
  label: string;
  category: MaterialCategory;
  finishLabel: string;
  roughness: number;
  metalness: number;
  previewBase: string;
  previewAccent: string;
  previewSecondary?: string;
}

export const MATERIAL_CATEGORIES: MaterialCategory[] = [
  'Paint & Wall',
  'Wood & Timber',
  'Stone & Brick',
  'Tile & Terrazzo',
  'Textiles & Leather',
  'Metals & Plastics',
];

export const MATERIAL_PRESETS: MaterialPresetMeta[] = [
  // Paint & Wall Finishes
  {
    id: 'paint',
    label: 'Matte Paint',
    category: 'Paint & Wall',
    finishLabel: 'Matte',
    roughness: 0.86,
    metalness: 0.0,
    previewBase: '#F1F5F9',
    previewAccent: '#CBD5E1',
  },
  {
    id: 'satin_paint',
    label: 'Satin Lacquer',
    category: 'Paint & Wall',
    finishLabel: 'Satin',
    roughness: 0.36,
    metalness: 0.0,
    previewBase: '#F8FAFC',
    previewAccent: '#94A3B8',
  },
  {
    id: 'plaster',
    label: 'Limewash Plaster',
    category: 'Paint & Wall',
    finishLabel: 'Troweled',
    roughness: 0.84,
    metalness: 0.0,
    previewBase: '#E9E4DC',
    previewAccent: '#C8BFB2',
  },
  {
    id: 'wallpaper',
    label: 'Textured Wallpaper',
    category: 'Paint & Wall',
    finishLabel: 'Embossed',
    roughness: 0.80,
    metalness: 0.0,
    previewBase: '#ECEAE4',
    previewAccent: '#B8B2A6',
  },
  {
    id: 'paneling',
    label: 'Fluted Paneling',
    category: 'Paint & Wall',
    finishLabel: 'Slatted',
    roughness: 0.56,
    metalness: 0.02,
    previewBase: '#D9C3A5',
    previewAccent: '#7C5A3A',
  },

  // Wood & Timber
  {
    id: 'wood',
    label: 'Whitewashed Ash',
    category: 'Wood & Timber',
    finishLabel: 'Natural',
    roughness: 0.62,
    metalness: 0.0,
    previewBase: '#EDE5D8',
    previewAccent: '#B59E82',
  },
  {
    id: 'oak',
    label: 'European White Oak',
    category: 'Wood & Timber',
    finishLabel: 'Oiled',
    roughness: 0.58,
    metalness: 0.0,
    previewBase: '#D6B992',
    previewAccent: '#9A744B',
  },
  {
    id: 'walnut',
    label: 'American Walnut',
    category: 'Wood & Timber',
    finishLabel: 'Satin',
    roughness: 0.48,
    metalness: 0.0,
    previewBase: '#6B462B',
    previewAccent: '#3D2414',
  },
  {
    id: 'teak',
    label: 'Warm Golden Teak',
    category: 'Wood & Timber',
    finishLabel: 'Oiled',
    roughness: 0.52,
    metalness: 0.0,
    previewBase: '#A96E3B',
    previewAccent: '#693E1B',
  },
  {
    id: 'smoked_oak',
    label: 'Smoked Dark Oak',
    category: 'Wood & Timber',
    finishLabel: 'Brushed',
    roughness: 0.60,
    metalness: 0.0,
    previewBase: '#4A3B31',
    previewAccent: '#271E18',
  },
  {
    id: 'parquet',
    label: 'Oak Parquet',
    category: 'Wood & Timber',
    finishLabel: 'Satin',
    roughness: 0.46,
    metalness: 0.0,
    previewBase: '#CFA97A',
    previewAccent: '#7D5832',
  },
  {
    id: 'herringbone',
    label: 'Herringbone Oak',
    category: 'Wood & Timber',
    finishLabel: 'Satin',
    roughness: 0.44,
    metalness: 0.0,
    previewBase: '#D7B78E',
    previewAccent: '#865F38',
  },

  // Stone & Brick
  {
    id: 'marble',
    label: 'Carrara Marble',
    category: 'Stone & Brick',
    finishLabel: 'Polished',
    roughness: 0.18,
    metalness: 0.02,
    previewBase: '#F7F7F6',
    previewAccent: '#8F969E',
  },
  {
    id: 'calacatta_gold',
    label: 'Calacatta Gold',
    category: 'Stone & Brick',
    finishLabel: 'Polished',
    roughness: 0.18,
    metalness: 0.02,
    previewBase: '#FBF8F3',
    previewAccent: '#B89558',
    previewSecondary: '#8A8680',
  },
  {
    id: 'nero_marble',
    label: 'Nero Marquina',
    category: 'Stone & Brick',
    finishLabel: 'Polished',
    roughness: 0.16,
    metalness: 0.02,
    previewBase: '#1C1F24',
    previewAccent: '#E2E8F0',
  },
  {
    id: 'travertine',
    label: 'Roman Travertine',
    category: 'Stone & Brick',
    finishLabel: 'Honed',
    roughness: 0.64,
    metalness: 0.0,
    previewBase: '#E5D8C3',
    previewAccent: '#B59F82',
  },
  {
    id: 'slate',
    label: 'Charcoal Slate',
    category: 'Stone & Brick',
    finishLabel: 'Cleft',
    roughness: 0.72,
    metalness: 0.02,
    previewBase: '#3A3F45',
    previewAccent: '#1E2226',
  },
  {
    id: 'concrete',
    label: 'Architectural Concrete',
    category: 'Stone & Brick',
    finishLabel: 'Raw',
    roughness: 0.86,
    metalness: 0.0,
    previewBase: '#9FA4AA',
    previewAccent: '#6C7279',
  },
  {
    id: 'brick',
    label: 'Exposed Clay Brick',
    category: 'Stone & Brick',
    finishLabel: 'Masonry',
    roughness: 0.90,
    metalness: 0.0,
    previewBase: '#A64B33',
    previewAccent: '#D1CBC3',
    previewSecondary: '#73301E',
  },

  // Tile & Terrazzo
  {
    id: 'tile',
    label: 'Ceramic Tile',
    category: 'Tile & Terrazzo',
    finishLabel: 'Glazed',
    roughness: 0.24,
    metalness: 0.03,
    previewBase: '#F3F5F7',
    previewAccent: '#94A3B8',
  },
  {
    id: 'hex_tile',
    label: 'Hex Mosaic Tile',
    category: 'Tile & Terrazzo',
    finishLabel: 'Satin',
    roughness: 0.28,
    metalness: 0.03,
    previewBase: '#ECEFF2',
    previewAccent: '#7E8A98',
  },
  {
    id: 'checker',
    label: 'Checkerboard Stone',
    category: 'Tile & Terrazzo',
    finishLabel: 'Honed',
    roughness: 0.30,
    metalness: 0.02,
    previewBase: '#F8FAFC',
    previewAccent: '#334155',
  },
  {
    id: 'terrazzo',
    label: 'Venetian Terrazzo',
    category: 'Tile & Terrazzo',
    finishLabel: 'Honed',
    roughness: 0.34,
    metalness: 0.02,
    previewBase: '#E8E2D7',
    previewAccent: '#5C5852',
    previewSecondary: '#A88C6D',
  },

  // Textiles & Leather
  {
    id: 'fabric',
    label: 'Woven Linen',
    category: 'Textiles & Leather',
    finishLabel: 'Textile',
    roughness: 0.88,
    metalness: 0.0,
    previewBase: '#EFECE6',
    previewAccent: '#A9A295',
  },
  {
    id: 'boucle',
    label: 'Cream Bouclé',
    category: 'Textiles & Leather',
    finishLabel: 'Looped Wool',
    roughness: 0.94,
    metalness: 0.0,
    previewBase: '#F3EFE6',
    previewAccent: '#C5BBA8',
  },
  {
    id: 'velvet',
    label: 'Plush Velvet',
    category: 'Textiles & Leather',
    finishLabel: 'Soft Nap',
    roughness: 0.78,
    metalness: 0.0,
    previewBase: '#CBD5E1',
    previewAccent: '#64748B',
  },
  {
    id: 'leather_cognac',
    label: 'Cognac Leather',
    category: 'Textiles & Leather',
    finishLabel: 'Aniline',
    roughness: 0.44,
    metalness: 0.0,
    previewBase: '#A65E2E',
    previewAccent: '#6B3817',
  },
  {
    id: 'leather_black',
    label: 'Black Grain Leather',
    category: 'Textiles & Leather',
    finishLabel: 'Semi-Matte',
    roughness: 0.46,
    metalness: 0.0,
    previewBase: '#26292E',
    previewAccent: '#111316',
  },
  {
    id: 'leather_cream',
    label: 'Ivory Saddle Leather',
    category: 'Textiles & Leather',
    finishLabel: 'Supple',
    roughness: 0.44,
    metalness: 0.0,
    previewBase: '#F2ECE1',
    previewAccent: '#C9BCA6',
  },

  // Metals & Plastics
  {
    id: 'metal',
    label: 'Brushed Steel',
    category: 'Metals & Plastics',
    finishLabel: 'Metallic',
    roughness: 0.30,
    metalness: 0.90,
    previewBase: '#CBD5E1',
    previewAccent: '#64748B',
  },
  {
    id: 'brass',
    label: 'Brushed Brass',
    category: 'Metals & Plastics',
    finishLabel: 'Metallic',
    roughness: 0.32,
    metalness: 0.92,
    previewBase: '#D4AE5E',
    previewAccent: '#8C6A24',
  },
  {
    id: 'bronze',
    label: 'Oil-Rubbed Bronze',
    category: 'Metals & Plastics',
    finishLabel: 'Metallic',
    roughness: 0.38,
    metalness: 0.88,
    previewBase: '#5A4636',
    previewAccent: '#2C2118',
  },
  {
    id: 'chrome',
    label: 'Polished Chrome',
    category: 'Metals & Plastics',
    finishLabel: 'Mirror Metal',
    roughness: 0.08,
    metalness: 0.98,
    previewBase: '#E2E8F0',
    previewAccent: '#475569',
  },
  {
    id: 'matte_black_metal',
    label: 'Matte Black Steel',
    category: 'Metals & Plastics',
    finishLabel: 'Powder Coat',
    roughness: 0.50,
    metalness: 0.72,
    previewBase: '#272B30',
    previewAccent: '#0F1215',
  },
  {
    id: 'plastic_matte',
    label: 'Matte Polymer ABS',
    category: 'Metals & Plastics',
    finishLabel: 'Matte',
    roughness: 0.58,
    metalness: 0.0,
    previewBase: '#E2E8F0',
    previewAccent: '#94A3B8',
  },
  {
    id: 'plastic_gloss',
    label: 'Gloss Acrylic',
    category: 'Metals & Plastics',
    finishLabel: 'High Gloss',
    roughness: 0.14,
    metalness: 0.02,
    previewBase: '#F8FAFC',
    previewAccent: '#CBD5E1',
  },
  {
    id: 'glass',
    label: 'Clear Glass',
    category: 'Metals & Plastics',
    finishLabel: 'Transparent',
    roughness: 0.06,
    metalness: 0.08,
    previewBase: '#E0F2FE',
    previewAccent: '#7DD3FC',
  },
];

export function getMaterialPresetMeta(id: MaterialPreset): MaterialPresetMeta {
  return MATERIAL_PRESETS.find((m) => m.id === id) ?? MATERIAL_PRESETS[0];
}

export function isPresetPreTinted(preset: MaterialPreset): boolean {
  switch (preset) {
    case 'oak':
    case 'walnut':
    case 'teak':
    case 'smoked_oak':
    case 'parquet':
    case 'herringbone':
    case 'calacatta_gold':
    case 'nero_marble':
    case 'travertine':
    case 'slate':
    case 'concrete':
    case 'brick':
    case 'terrazzo':
    case 'leather_cognac':
    case 'leather_black':
    case 'brass':
    case 'bronze':
    case 'matte_black_metal':
      return true;
    default:
      return false;
  }
}

export function getDefaultTileMeters(preset: MaterialPreset): number {
  switch (preset) {
    case 'wood':
    case 'oak':
    case 'walnut':
    case 'teak':
    case 'smoked_oak':
      return 1.1;
    case 'parquet':
    case 'herringbone':
      return 1.35;
    case 'marble':
    case 'calacatta_gold':
    case 'nero_marble':
    case 'travertine':
    case 'slate':
      return 1.6;
    case 'concrete':
    case 'plaster':
      return 2.0;
    case 'brick':
      return 1.4;
    case 'tile':
    case 'hex_tile':
    case 'checker':
      return 0.95;
    case 'terrazzo':
      return 1.15;
    case 'fabric':
    case 'boucle':
    case 'velvet':
    case 'wallpaper':
      return 0.48;
    case 'leather_cognac':
    case 'leather_black':
    case 'leather_cream':
      return 0.65;
    case 'paneling':
      return 1.0;
    case 'metal':
    case 'brass':
    case 'bronze':
    case 'chrome':
    case 'matte_black_metal':
      return 0.65;
    default:
      return 1.0;
  }
}

/**
 * Resolves the unified base hex color displayed across both 2D and 3D views:
 * pre-tinted presets keep their characteristic wood/stone base tone unless a custom
 * tint is chosen, while paint/fabric/default white uses the assigned color directly.
 */
export function getEffectiveMaterialHex(preset: MaterialPreset, colorHex?: string): string {
  const norm = (colorHex || '#FFFFFF').toUpperCase();
  const meta = getMaterialPresetMeta(preset);
  if (norm !== '#FFFFFF') {
    return norm;
  }
  if (isPresetPreTinted(preset)) {
    return meta.previewBase.toUpperCase();
  }
  return norm;
}

export const SWATCH_PALETTE: string[] = [
  '#FFFFFF',
  '#F8FAFC',
  '#E2E8F0',
  '#CBD5E1',
  '#94A3B8',
  '#475569',
  '#1E293B',
  '#0F172A',
  '#F5F0E6',
  '#E6D5B8',
  '#C8A97E',
  '#9C6B3F',
  '#7C4D2B',
  '#5C3A21',
  '#D97706',
  '#B45309',
  '#DBEAFE',
  '#93C5FD',
  '#3B82F6',
  '#1D4ED8',
  '#D1FAE5',
  '#6EE7B7',
  '#10B981',
  '#047857',
];
