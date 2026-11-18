import {
  ArchElement,
  Curtain,
  FurnitureInstance,
  Level,
  Opening,
  PersonInstance,
  Project,
  Wall,
} from '../types/plan';
import { BUILTIN_CATALOG } from './catalog';
import { detectRoomsFromWalls } from '../utils/geometry';
import { uid } from '../utils/units';

function cloneParts(templateId: string) {
  const tpl = BUILTIN_CATALOG.find((c) => c.id === templateId);
  if (!tpl) return [];
  return tpl.parts.map((p) => ({ ...p, id: `${p.id}_${Math.random().toString(36).slice(2, 6)}` }));
}

function makeFurniture(
  templateId: string,
  xMm: number,
  yMm: number,
  rotationDeg = 0,
  overrideName?: string,
  overrideElevMm?: number
): FurnitureInstance {
  const tpl = BUILTIN_CATALOG.find((c) => c.id === templateId) ?? BUILTIN_CATALOG[0];
  return {
    id: uid('furn'),
    templateId: tpl.id,
    name: overrideName ?? tpl.name,
    category: tpl.category,
    xMm,
    yMm,
    elevationMm: overrideElevMm ?? tpl.defaultElevationMm ?? 0,
    rotationDeg,
    mirroredX: false,
    mirroredY: false,
    lockProportions: true,
    fixedSize: tpl.fixedSize,
    estimatedCostEur: tpl.estimatedCostEur,
    parts: cloneParts(tpl.id),
    ...(tpl.category === 'Lighting'
      ? { lightConfig: { enabled: true, colorTempK: 3200, intensity: 1.0 } }
      : {}),
    visible: true,
    locked: false,
  };
}

function makeWall(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thicknessMm = 180,
  innerColor = '#FFFFFF',
  outerColor = '#FFFFFF'
): Wall {
  return {
    id,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thicknessMm,
    heightMm: 2800,
    alignment: 'center',
    isCurved: false,
    curveBulgeMm: 0,
    innerColor,
    outerColor,
    innerMaterial: 'paint',
    outerMaterial: 'paint',
    innerTextureScale: 1,
    outerTextureScale: 1,
    innerTextureRotDeg: 0,
    outerTextureRotDeg: 0,
    hasBaseboard: true,
    baseboardHeightMm: 80,
    baseboardColor: '#FFFFFF',
    hasCrownMolding: false,
    crownHeightMm: 60,
    crownColor: '#FFFFFF',
    visible: true,
    locked: false,
  };
}

function makeOpening(
  id: string,
  wallId: string,
  t: number,
  category: Opening['category'],
  subtype: Opening['subtype'],
  widthMm: number,
  heightMm: number,
  sillHeightMm: number,
  swingSide: 'left' | 'right' = 'left',
  swingDirection: 'in' | 'out' = 'in'
): Opening {
  return {
    id,
    name: category === 'door' ? 'Door' : category === 'window' ? 'Window' : 'Archway',
    wallId,
    t,
    category,
    subtype,
    widthMm,
    heightMm,
    sillHeightMm,
    frameThicknessMm: 55,
    frameColor: '#1E293B',
    panelColor: '#FFFFFF',
    glassColor: '#E0F2FE',
    swingSide,
    swingDirection,
    openAngleDeg: category === 'door' ? 60 : 0,
    visible: true,
    locked: false,
  };
}

export function buildOneBedroomLevel(): Level {
  const walls: Wall[] = [
    makeWall('w_top', -5000, -3500, 5000, -3500, 220),
    makeWall('w_right', 5000, -3500, 5000, 3500, 220),
    makeWall('w_bot', 5000, 3500, -5000, 3500, 220),
    makeWall('w_left', -5000, 3500, -5000, -3500, 220),
    makeWall('w_mid_v', 1000, -3500, 1000, 3500, 140),
    makeWall('w_right_h', 1000, 400, 5000, 400, 140),
    makeWall('w_hall_v', -1200, 1400, -1200, 3500, 120),
  ];

  const detected = detectRoomsFromWalls(walls, [], 2800);
  const rooms = detected.map((r) => {
    const cx = r.polygon.reduce((s, p) => s + p.x, 0) / r.polygon.length;
    const cy = r.polygon.reduce((s, p) => s + p.y, 0) / r.polygon.length;
    if (cx < 1000 && cy < 1500) {
      return {
        ...r,
        name: 'Living & Kitchen',
        floorMaterial: 'herringbone' as const,
        floorColor: '#FFFFFF',
      };
    }
    if (cx < 1000 && cy >= 1500) {
      return {
        ...r,
        name: 'Entry Hall',
        floorMaterial: 'checker' as const,
        floorColor: '#FFFFFF',
      };
    }
    if (cx >= 1000 && cy < 400) {
      return {
        ...r,
        name: 'Primary Bedroom',
        floorMaterial: 'parquet' as const,
        floorColor: '#FFFFFF',
      };
    }
    return {
      ...r,
      name: 'Bathroom',
      floorMaterial: 'hex_tile' as const,
      floorColor: '#FFFFFF',
    };
  });

  const openings: Opening[] = [
    makeOpening('op_entry', 'w_bot', 0.87, 'door', 'entrance', 950, 2150, 0, 'right', 'in'),
    makeOpening('op_bed_door', 'w_mid_v', 0.34, 'door', 'single', 880, 2100, 0, 'left', 'in'),
    makeOpening('op_bath_door', 'w_mid_v', 0.78, 'door', 'single', 800, 2100, 0, 'right', 'in'),
    makeOpening('op_arch_hall', 'w_hall_v', 0.5, 'arch', 'round_arch', 1150, 2250, 0),
    makeOpening('op_win_liv1', 'w_top', 0.24, 'window', 'triple', 2400, 1600, 750),
    makeOpening('op_win_liv2', 'w_left', 0.5, 'window', 'floor_to_ceiling', 2200, 2300, 150),
    makeOpening('op_win_bed', 'w_right', 0.28, 'window', 'double', 1800, 1500, 850),
  ];

  const curtains: Curtain[] = [
    {
      id: uid('curt'),
      name: 'Living Room Drapes',
      xMm: -2600,
      yMm: -3280,
      rotationDeg: 0,
      elevationMm: 50,
      widthMm: 2700,
      heightMm: 2600,
      style: 'drapes',
      rodType: 'concealed',
      fullness: 1.8,
      openPercent: 35,
      color: '#FFFFFF',
      rodColor: '#1E293B',
      material: 'fabric',
      visible: true,
      locked: false,
    },
  ];

  const furniture: FurnitureInstance[] = [
    makeFurniture('rug_woven', -2650, -1450, 0, 'Living Area Rug'),
    makeFurniture('sofa_l_sectional', -2900, -1550, 90, 'L-Shaped Living Sofa'),
    makeFurniture('table_oval_coffee', -2050, -1500, 90, 'Oval Coffee Table'),
    makeFurniture('tv_unit_media', -550, -1500, -90, 'Fluted Media Lowboard'),
    makeFurniture('tv_screen_stand', -550, -1500, -90, '55" Living Room TV', 500),
    makeFurniture('light_floor', -4300, -2900, 0, 'Arc Floor Lamp'),
    makeFurniture('plant_fiddle', -4450, 250, 0, 'Fiddle Leaf Fig'),
    makeFurniture('table_oval_dining', -2900, 1450, 0, 'Oval Dining Table'),
    makeFurniture('chair_dining', -3400, 740, 0, 'Dining Chair 1'),
    makeFurniture('chair_dining', -2400, 740, 0, 'Dining Chair 2'),
    makeFurniture('chair_dining', -3400, 2160, 180, 'Dining Chair 3'),
    makeFurniture('chair_dining', -2400, 2160, 180, 'Dining Chair 4'),
    makeFurniture('kitchen_island', -300, 1150, 90, 'Kitchen Island'),
    makeFurniture('stool_bar', -880, 850, 90, 'Island Stool 1'),
    makeFurniture('stool_bar', -880, 1450, 90, 'Island Stool 2'),
    makeFurniture('kitchen_sink', -450, 3050, 180, 'Kitchen Sink Unit'),
    makeFurniture('kitchen_hob', 450, 3050, 180, 'Induction Hob Unit'),
    makeFurniture('kitchen_fridge', 500, 2200, -90, 'Refrigerator'),
    makeFurniture('bed_queen', 3100, -2100, 0, 'Queen Bed'),
    makeFurniture('table_side', 1950, -2950, 0, 'Nightstand L'),
    makeFurniture('table_side', 4250, -2950, 0, 'Nightstand R'),
    makeFurniture('wardrobe_double', 2100, 0, 180, 'Double Wardrobe'),
    makeFurniture('desk_office', 4020, -40, 180, 'Study Desk'),
    makeFurniture('plant_fiddle', 4500, -3000, 0, 'Bedroom Plant'),
    makeFurniture('bath_shower', 4250, 2950, 180, 'Walk-In Shower'),
    makeFurniture('bath_vanity', 2400, 3120, 180, 'Bathroom Vanity'),
    makeFurniture('bath_toilet', 2000, 850, 0, 'Modern WC'),
    makeFurniture('bath_washer', 4520, 900, 0, 'Washing Machine'),
  ];

  const people: PersonInstance[] = [
    {
      id: uid('person'),
      name: 'Architect Scale Figure',
      pose: 'standing_woman',
      xMm: -1350,
      yMm: -400,
      elevationMm: 0,
      rotationDeg: -30,
      heightMm: 1700,
      color: '#FFFFFF',
      visible: true,
      locked: false,
    },
  ];

  const archElements: ArchElement[] = [
    {
      id: uid('arch'),
      name: 'Structural Column',
      type: 'column_round',
      xMm: 1000,
      yMm: 400,
      elevationMm: 0,
      rotationDeg: 0,
      widthMm: 280,
      depthMm: 280,
      heightMm: 2800,
      color: '#FFFFFF',
      accentColor: '#1E293B',
      material: 'concrete',
      visible: true,
      locked: false,
    },
  ];

  return {
    id: uid('level'),
    name: 'Ground Floor (0.00 m)',
    elevationMm: 0,
    ceilingHeightMm: 2800,
    walls,
    rooms,
    openings,
    curtains,
    furniture,
    people,
    archElements,
    measurements: [],
    annotations: [
      {
        id: uid('note'),
        kind: 'text',
        xMm: -3150,
        yMm: -2860,
        text: 'Window Wall',
        color: '#334155',
        fontSizeMm: 150,
      },
    ],
    sectionLine: {
      id: uid('sec'),
      start: { x: -5400, y: -600 },
      end: { x: 5400, y: -600 },
      flipDirection: false,
      active: false,
    },
    backgroundTrace: null,
    layers: {
      walls: true,
      rooms: true,
      openings: true,
      furniture: true,
      curtains: true,
      people: true,
      archElements: true,
      measurements: true,
      annotations: true,
      autoDimensions: false,
      grid: true,
    },
  };
}

export function buildStudioLevel(): Level {
  const walls: Wall[] = [
    makeWall('s_top', -3600, -2800, 3600, -2800, 200),
    makeWall('s_right', 3600, -2800, 3600, 2800, 200),
    makeWall('s_bot', 3600, 2800, -3600, 2800, 200),
    makeWall('s_left', -3600, 2800, -3600, -2800, 200),
    makeWall('s_bath_v', 1300, 300, 1300, 2800, 130),
    makeWall('s_bath_h', 1300, 300, 3600, 300, 130),
  ];
  const rooms = detectRoomsFromWalls(walls, [], 2800).map((r) => {
    const cx = r.polygon.reduce((s, p) => s + p.x, 0) / r.polygon.length;
    if (cx > 1300) {
      return { ...r, name: 'Bath Pod', floorMaterial: 'hex_tile' as const, floorColor: '#FFFFFF' };
    }
    return { ...r, name: 'Open Studio', floorMaterial: 'parquet' as const, floorColor: '#FFFFFF' };
  });
  return {
    id: uid('level'),
    name: 'Studio Level',
    elevationMm: 0,
    ceilingHeightMm: 2800,
    walls,
    rooms,
    openings: [
      makeOpening('op_s_entry', 's_bot', 0.22, 'door', 'entrance', 900, 2100, 0, 'left', 'in'),
      makeOpening('op_s_bath', 's_bath_v', 0.5, 'door', 'single', 780, 2100, 0, 'right', 'in'),
      makeOpening('op_s_win', 's_top', 0.5, 'window', 'triple', 2800, 1600, 750),
    ],
    curtains: [],
    furniture: [
      makeFurniture('bed_queen', 2350, -1450, 0, 'Sleeping Alcove Bed'),
      makeFurniture('sofa_curved_boucle', -1600, -1200, 0, 'Curved Studio Sofa'),
      makeFurniture('table_oval_coffee', -1600, -100, 0),
      makeFurniture('desk_pill', -2600, 1200, 90),
      makeFurniture('kitchen_sink', -600, 2350, 180),
      makeFurniture('kitchen_hob', 300, 2350, 180),
      makeFurniture('bath_shower', 2900, 2250, 180),
      makeFurniture('bath_toilet', 1800, 800, 0),
      makeFurniture('bath_vanity', 2400, 2400, 180),
    ],
    people: [],
    archElements: [],
    measurements: [],
    annotations: [],
    sectionLine: {
      id: uid('sec'),
      start: { x: -4000, y: 0 },
      end: { x: 4000, y: 0 },
      flipDirection: false,
      active: false,
    },
    backgroundTrace: null,
    layers: {
      walls: true,
      rooms: true,
      openings: true,
      furniture: true,
      curtains: true,
      people: true,
      archElements: true,
      measurements: true,
      annotations: true,
      autoDimensions: false,
      grid: true,
    },
  };
}

export function buildTwoBedroomLevel(): Level {
  const walls: Wall[] = [
    makeWall('t_top', -6000, -4000, 6000, -4000, 220),
    makeWall('t_right', 6000, -4000, 6000, 4000, 220),
    makeWall('t_bot', 6000, 4000, -6000, 4000, 220),
    makeWall('t_left', -6000, 4000, -6000, -4000, 220),
    makeWall('t_c1', -1000, -4000, -1000, 4000, 140),
    makeWall('t_c2', 2400, -4000, 2400, 4000, 140),
    makeWall('t_h1', 2400, 0, 6000, 0, 140),
    makeWall('t_h2', -1000, 1200, 2400, 1200, 140),
  ];
  const rooms = detectRoomsFromWalls(walls, [], 2900).map((r, i) => {
    const names = ['Living & Dining', 'Kitchen', 'Hallway', 'Primary Bedroom', 'Bedroom 2'];
    const mats = ['herringbone', 'terrazzo', 'tile', 'parquet', 'wood'] as const;
    return {
      ...r,
      name: names[i] ?? `Room ${i + 1}`,
      floorMaterial: mats[i % mats.length],
      floorColor: '#FFFFFF',
    };
  });
  return {
    id: uid('level'),
    name: 'Level 1',
    elevationMm: 0,
    ceilingHeightMm: 2900,
    walls,
    rooms,
    openings: [
      makeOpening('op_t1', 't_bot', 0.52, 'door', 'entrance', 950, 2150, 0, 'left', 'in'),
      makeOpening('op_t2', 't_c1', 0.3, 'arch', 'segmental_arch', 1400, 2300, 0),
      makeOpening('op_t3', 't_c2', 0.25, 'door', 'single', 880, 2100, 0, 'left', 'in'),
      makeOpening('op_t4', 't_c2', 0.75, 'door', 'single', 880, 2100, 0, 'right', 'in'),
      makeOpening('op_t5', 't_top', 0.2, 'window', 'triple', 2400, 1600, 750),
      makeOpening('op_t6', 't_right', 0.25, 'window', 'double', 1600, 1500, 850),
      makeOpening('op_t7', 't_right', 0.75, 'window', 'double', 1600, 1500, 850),
    ],
    curtains: [],
    furniture: [
      makeFurniture('sofa_u_sectional', -3500, -1800, 0),
      makeFurniture('table_oval_dining', -3500, 1800, 0),
      makeFurniture('kitchen_island', 700, -1500, 0),
      makeFurniture('kitchen_sink', 700, -3500, 0),
      makeFurniture('bed_queen', 4200, -2100, 0),
      makeFurniture('bed_single', 4200, 2100, 0),
      makeFurniture('wardrobe_double', 3400, 350, 0),
    ],
    people: [],
    archElements: [
      {
        id: uid('arch'),
        name: 'Entry Staircase',
        type: 'stairs_straight',
        xMm: 1200,
        yMm: 2600,
        elevationMm: 0,
        rotationDeg: 90,
        widthMm: 1000,
        depthMm: 2200,
        heightMm: 2900,
        color: '#FFFFFF',
        accentColor: '#1E293B',
        material: 'wood',
        stepCount: 14,
        hasRailing: true,
        visible: true,
        locked: false,
      },
    ],
    measurements: [],
    annotations: [],
    sectionLine: {
      id: uid('sec'),
      start: { x: -6400, y: 0 },
      end: { x: 6400, y: 0 },
      flipDirection: false,
      active: false,
    },
    backgroundTrace: null,
    layers: {
      walls: true,
      rooms: true,
      openings: true,
      furniture: true,
      curtains: true,
      people: true,
      archElements: true,
      measurements: true,
      annotations: true,
      autoDimensions: false,
      grid: true,
    },
  };
}

export function buildEmptyLevel(name = 'Ground Floor (0.00 m)', elevationMm = 0): Level {
  return {
    id: uid('level'),
    name,
    elevationMm,
    ceilingHeightMm: 2800,
    walls: [],
    rooms: [],
    openings: [],
    curtains: [],
    furniture: [],
    people: [],
    archElements: [],
    measurements: [],
    annotations: [],
    sectionLine: {
      id: uid('sec'),
      start: { x: -4000, y: 0 },
      end: { x: 4000, y: 0 },
      flipDirection: false,
      active: false,
    },
    backgroundTrace: null,
    layers: {
      walls: true,
      rooms: true,
      openings: true,
      furniture: true,
      curtains: true,
      people: true,
      archElements: true,
      measurements: true,
      annotations: true,
      autoDimensions: false,
      grid: true,
    },
  };
}

export function createInitialProject(
  template: '1br' | 'studio' | '2br' | 'empty' = '1br',
  timestamps?: { createdAt?: string; updatedAt?: string }
): Project {
  const level =
    template === 'studio'
      ? buildStudioLevel()
      : template === '2br'
        ? buildTwoBedroomLevel()
        : template === 'empty'
          ? buildEmptyLevel()
          : buildOneBedroomLevel();

  const names = {
    '1br': '1-Bedroom Modern Apartment',
    studio: 'Compact Urban Studio',
    '2br': '2-Bedroom Family Residence',
    empty: 'Untitled Architectural Plan',
  };

  const now = new Date().toISOString();
  const createdAt = timestamps?.createdAt ?? now;
  const updatedAt = timestamps?.updatedAt ?? createdAt;

  return {
    id: uid('proj'),
    name: names[template],
    createdAt,
    updatedAt,
    activeLevelId: level.id,
    levels: [level],
    customLibrary: [],
    recentColors: ['#FFFFFF', '#F8FAFC', '#E2E8F0', '#D6B992', '#64748B', '#1E293B'],
    settings: {
      preferredUnit: 'cm',
      scale: '1:50',
      gridSizeMm: 100, // 10 cm
      snapEnabled: true,
      angleSnapDeg: 15,
      orthoMode: false,
      autoDimensions: false,
      showGrid: true,
      cutawayEnabled: false,
      cutawayHeightMm: 1600,
      hideFrontWalls: false,
      fovDeg: 56,
      sunAzimuthDeg: 232,
      sunElevationDeg: 12,
      shadowsEnabled: true,
      darkMode: false,
      timeOfDay3d: 'day',
    },
  };
}
