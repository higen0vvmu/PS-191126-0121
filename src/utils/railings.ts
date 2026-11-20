import type {
  ArchElement,
  MaterialPreset,
  Point2D,
  RailingConfig,
  RailingEdgeToggles,
  RailingGlassTint,
  RailingHandrailShape,
  RailingMountingMethod,
  RailingPathNode,
  RailingPostShape,
  RailingStyleId,
  Wall,
} from '../types/plan';

export interface RailingStyleMeta {
  id: RailingStyleId;
  label: string;
  shortLabel: string;
  description: string;
  defaultColor: string;
  defaultSecondaryColor: string;
  defaultAccentColor: string;
  defaultMaterial: MaterialPreset;
  defaultHandrailMaterial?: MaterialPreset;
  defaultHandrailColor?: string;
}

export const RAILING_STYLES: RailingStyleMeta[] = [
  {
    id: 'glass_panel',
    label: 'Glass Panel',
    shortLabel: 'Glass Panel',
    description: 'Metal posts with clamped tempered glass panels and top handrail',
    defaultColor: '#334155',
    defaultSecondaryColor: '#BAE6FD',
    defaultAccentColor: '#94A3B8',
    defaultMaterial: 'metal',
  },
  {
    id: 'frameless_glass',
    label: 'Frameless Glass',
    shortLabel: 'Frameless',
    description: 'Structural tempered glass balustrade in base shoe or spigots',
    defaultColor: '#475569',
    defaultSecondaryColor: '#CFFAFE',
    defaultAccentColor: '#CBD5E1',
    defaultMaterial: 'chrome',
  },
  {
    id: 'traditional_balusters',
    label: 'Traditional Balusters',
    shortLabel: 'Balusters',
    description: 'Classic vertical spindles with bottom shoe, newel posts, and wood cap',
    defaultColor: '#1E293B',
    defaultSecondaryColor: '#1E293B',
    defaultAccentColor: '#8B5A2B',
    defaultMaterial: 'matte_black_metal',
    defaultHandrailMaterial: 'oak',
    defaultHandrailColor: '#8B5A2B',
  },
  {
    id: 'horizontal_metal',
    label: 'Horizontal Metal',
    shortLabel: 'Horizontal',
    description: 'Architectural metal posts with parallel horizontal bar infills',
    defaultColor: '#1E293B',
    defaultSecondaryColor: '#475569',
    defaultAccentColor: '#64748B',
    defaultMaterial: 'matte_black_metal',
  },
  {
    id: 'cable',
    label: 'Cable Railing',
    shortLabel: 'Cable',
    description: 'Tensioned stainless steel wire cables with structural end and line posts',
    defaultColor: '#334155',
    defaultSecondaryColor: '#CBD5E1',
    defaultAccentColor: '#94A3B8',
    defaultMaterial: 'metal',
  },
  {
    id: 'solid_panel',
    label: 'Solid Panel',
    shortLabel: 'Solid Panel',
    description: 'Privacy balustrade with framed opaque architectural infill panels',
    defaultColor: '#334155',
    defaultSecondaryColor: '#D6CFC7',
    defaultAccentColor: '#64748B',
    defaultMaterial: 'matte_black_metal',
  },
  {
    id: 'modern_minimalist',
    label: 'Modern Minimalist',
    shortLabel: 'Minimalist',
    description: 'Slim flat blade posts, flush rectangular rail, and fine vertical fins',
    defaultColor: '#0F172A',
    defaultSecondaryColor: '#334155',
    defaultAccentColor: '#475569',
    defaultMaterial: 'matte_black_metal',
  },
  {
    id: 'handrail_only',
    label: 'Handrail Only',
    shortLabel: 'Handrail',
    description: 'Continuous contoured handrail on wall brackets or slim stanchions',
    defaultColor: '#7C5338',
    defaultSecondaryColor: '#94A3B8',
    defaultAccentColor: '#334155',
    defaultMaterial: 'oak',
    defaultHandrailMaterial: 'oak',
    defaultHandrailColor: '#7C5338',
  },
];

export const DEFAULT_RAILING_STYLE: RailingStyleId = 'glass_panel';

export function getRailingStyleMeta(style: RailingStyleId): RailingStyleMeta {
  return RAILING_STYLES.find((s) => s.id === style) ?? RAILING_STYLES[0];
}

export function clampNum(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

export function createDefaultRailingConfig(
  style: RailingStyleId = DEFAULT_RAILING_STYLE,
  lengthMm = 2200
): RailingConfig {
  const halfLen = Math.max(200, Math.round(lengthMm / 2));
  const nodes: RailingPathNode[] = [
    { xMm: -halfLen, yMm: 0, elevationMm: 0 },
    { xMm: halfLen, yMm: 0, elevationMm: 0 },
  ];

  const base: RailingConfig = {
    style,
    nodes,
    closed: false,
    heightMm: 1050,
    widthMm: 70,
    postSpacingMm: 1200,
    balusterSpacingMm: 115,
    horizontalRailCount: 5,
    cableCount: 8,
    handrailShape: 'round',
    handrailWidthMm: 46,
    handrailThicknessMm: 42,
    postShape: 'square',
    postSizeMm: 46,
    endPostSizeMm: 54,
    balusterSizeMm: 16,
    panelThicknessMm: 12,
    bottomRailEnabled: false,
    bottomRailHeightMm: 75,
    mountingMethod: 'top_mount',
    material: 'metal',
    secondaryMaterial: 'glass',
    secondaryColor: '#BAE6FD',
    glassTint: 'clear',
    accentColor: '#94A3B8',
  };

  switch (style) {
    case 'traditional_balusters':
      return {
        ...base,
        heightMm: 1000,
        widthMm: 85,
        postSpacingMm: 1400,
        balusterSpacingMm: 110,
        handrailShape: 'oval',
        handrailWidthMm: 62,
        handrailThicknessMm: 46,
        postShape: 'square',
        postSizeMm: 64,
        endPostSizeMm: 88,
        balusterSizeMm: 22,
        bottomRailEnabled: true,
        bottomRailHeightMm: 85,
        material: 'matte_black_metal',
        handrailMaterial: 'oak',
        handrailColor: '#8B5A2B',
        secondaryMaterial: 'matte_black_metal',
        secondaryColor: '#1E293B',
        accentColor: '#8B5A2B',
      };
    case 'horizontal_metal':
      return {
        ...base,
        heightMm: 1050,
        widthMm: 65,
        postSpacingMm: 1250,
        horizontalRailCount: 5,
        handrailShape: 'rectangular',
        handrailWidthMm: 52,
        handrailThicknessMm: 34,
        postShape: 'square',
        postSizeMm: 45,
        endPostSizeMm: 50,
        balusterSizeMm: 16,
        bottomRailEnabled: false,
        material: 'matte_black_metal',
        secondaryMaterial: 'metal',
        secondaryColor: '#334155',
        accentColor: '#64748B',
      };
    case 'glass_panel':
      return {
        ...base,
        heightMm: 1050,
        widthMm: 70,
        postSpacingMm: 1200,
        handrailShape: 'round',
        handrailWidthMm: 46,
        handrailThicknessMm: 42,
        postShape: 'square',
        postSizeMm: 46,
        endPostSizeMm: 50,
        panelThicknessMm: 12,
        bottomRailEnabled: false,
        material: 'metal',
        secondaryMaterial: 'glass',
        secondaryColor: '#BAE6FD',
        glassTint: 'clear',
        accentColor: '#94A3B8',
      };
    case 'frameless_glass':
      return {
        ...base,
        heightMm: 1080,
        widthMm: 60,
        postSpacingMm: 1100,
        handrailShape: 'rectangular',
        handrailWidthMm: 28,
        handrailThicknessMm: 22,
        postShape: 'round',
        postSizeMm: 40,
        endPostSizeMm: 40,
        panelThicknessMm: 15,
        bottomRailEnabled: false,
        mountingMethod: 'embedded',
        material: 'chrome',
        secondaryMaterial: 'glass',
        secondaryColor: '#CFFAFE',
        glassTint: 'low_iron',
        accentColor: '#CBD5E1',
      };
    case 'cable':
      return {
        ...base,
        heightMm: 1050,
        widthMm: 65,
        postSpacingMm: 1200,
        cableCount: 8,
        handrailShape: 'rectangular',
        handrailWidthMm: 54,
        handrailThicknessMm: 34,
        postShape: 'square',
        postSizeMm: 48,
        endPostSizeMm: 58,
        balusterSizeMm: 6,
        bottomRailEnabled: false,
        material: 'metal',
        secondaryMaterial: 'chrome',
        secondaryColor: '#CBD5E1',
        accentColor: '#94A3B8',
      };
    case 'solid_panel':
      return {
        ...base,
        heightMm: 1050,
        widthMm: 76,
        postSpacingMm: 1250,
        handrailShape: 'rectangular',
        handrailWidthMm: 60,
        handrailThicknessMm: 38,
        postShape: 'square',
        postSizeMm: 55,
        endPostSizeMm: 64,
        panelThicknessMm: 34,
        bottomRailEnabled: true,
        bottomRailHeightMm: 65,
        material: 'matte_black_metal',
        secondaryMaterial: 'wood',
        secondaryColor: '#D6CFC7',
        accentColor: '#475569',
      };
    case 'modern_minimalist':
      return {
        ...base,
        heightMm: 1020,
        widthMm: 56,
        postSpacingMm: 1300,
        balusterSpacingMm: 115,
        handrailShape: 'rectangular',
        handrailWidthMm: 42,
        handrailThicknessMm: 26,
        postShape: 'flat',
        postSizeMm: 50,
        endPostSizeMm: 50,
        balusterSizeMm: 14,
        bottomRailEnabled: true,
        bottomRailHeightMm: 55,
        material: 'matte_black_metal',
        secondaryMaterial: 'matte_black_metal',
        secondaryColor: '#1E293B',
        accentColor: '#334155',
      };
    case 'handrail_only':
      return {
        ...base,
        heightMm: 920,
        widthMm: 75,
        postSpacingMm: 1000,
        handrailShape: 'round',
        handrailWidthMm: 44,
        handrailThicknessMm: 44,
        postShape: 'round',
        postSizeMm: 18,
        endPostSizeMm: 18,
        balusterSizeMm: 12,
        panelThicknessMm: 10,
        bottomRailEnabled: false,
        mountingMethod: 'wall_bracket',
        material: 'oak',
        handrailMaterial: 'oak',
        handrailColor: '#7C5338',
        secondaryMaterial: 'metal',
        secondaryColor: '#94A3B8',
        accentColor: '#334155',
      };
  }
}

export function applyRailingStylePreset(
  current: RailingConfig,
  nextStyle: RailingStyleId
): RailingConfig {
  const fresh = createDefaultRailingConfig(nextStyle);
  return {
    ...fresh,
    nodes: current.nodes.map((n) => ({ ...n })),
    closed: current.closed,
    heightMm: current.heightMm || fresh.heightMm,
  };
}

export function normalizeRailingConfig(
  raw?: Partial<RailingConfig> | null,
  fallbackLengthMm = 2000
): RailingConfig {
  const style: RailingStyleId =
    raw?.style && RAILING_STYLES.some((s) => s.id === raw.style)
      ? raw.style
      : DEFAULT_RAILING_STYLE;
  const def = createDefaultRailingConfig(style, fallbackLengthMm);
  const rawNodes = Array.isArray(raw?.nodes) && raw.nodes.length >= 2 ? raw.nodes : def.nodes;
  const nodes: RailingPathNode[] = rawNodes.map((n) => ({
    xMm: Number.isFinite(n?.xMm) ? n.xMm : 0,
    yMm: Number.isFinite(n?.yMm) ? n.yMm : 0,
    elevationMm: Number.isFinite(n?.elevationMm) ? n.elevationMm : 0,
  }));

  const validMount: RailingMountingMethod[] = ['top_mount', 'side_fascia', 'embedded', 'wall_bracket'];
  const validHrShape: RailingHandrailShape[] = ['round', 'square', 'rectangular', 'oval'];
  const validPostShape: RailingPostShape[] = ['square', 'round', 'flat'];
  const validTint: RailingGlassTint[] = ['clear', 'low_iron', 'bronze', 'smoke'];

  return {
    ...def,
    ...raw,
    style,
    nodes,
    closed: Boolean(raw?.closed),
    heightMm: clampNum(raw?.heightMm ?? def.heightMm, 400, 2000),
    widthMm: clampNum(raw?.widthMm ?? def.widthMm, 25, 300),
    postSpacingMm: clampNum(raw?.postSpacingMm ?? def.postSpacingMm, 300, 3200),
    balusterSpacingMm: clampNum(raw?.balusterSpacingMm ?? def.balusterSpacingMm, 40, 450),
    horizontalRailCount: Math.round(clampNum(raw?.horizontalRailCount ?? def.horizontalRailCount, 1, 14)),
    cableCount: Math.round(clampNum(raw?.cableCount ?? def.cableCount, 2, 18)),
    handrailShape: validHrShape.includes(raw?.handrailShape as RailingHandrailShape)
      ? (raw?.handrailShape as RailingHandrailShape)
      : def.handrailShape,
    handrailWidthMm: clampNum(raw?.handrailWidthMm ?? def.handrailWidthMm, 18, 140),
    handrailThicknessMm: clampNum(raw?.handrailThicknessMm ?? def.handrailThicknessMm, 14, 120),
    postShape: validPostShape.includes(raw?.postShape as RailingPostShape)
      ? (raw?.postShape as RailingPostShape)
      : def.postShape,
    postSizeMm: clampNum(raw?.postSizeMm ?? def.postSizeMm, 14, 180),
    endPostSizeMm: clampNum(raw?.endPostSizeMm ?? def.endPostSizeMm ?? def.postSizeMm, 14, 220),
    balusterSizeMm: clampNum(raw?.balusterSizeMm ?? def.balusterSizeMm, 3, 60),
    panelThicknessMm: clampNum(raw?.panelThicknessMm ?? def.panelThicknessMm, 6, 80),
    bottomRailEnabled: raw?.bottomRailEnabled ?? def.bottomRailEnabled,
    bottomRailHeightMm: clampNum(raw?.bottomRailHeightMm ?? def.bottomRailHeightMm, 0, 350),
    mountingMethod: validMount.includes(raw?.mountingMethod as RailingMountingMethod)
      ? (raw?.mountingMethod as RailingMountingMethod)
      : def.mountingMethod,
    glassTint: validTint.includes(raw?.glassTint as RailingGlassTint)
      ? (raw?.glassTint as RailingGlassTint)
      : def.glassTint,
  };
}

export function resolveRailingConfig(el: Pick<ArchElement, 'widthMm' | 'heightMm' | 'depthMm' | 'color' | 'accentColor' | 'material' | 'railing'>): RailingConfig {
  const normalized = normalizeRailingConfig(el.railing, el.widthMm || 2000);
  return {
    ...normalized,
    heightMm: el.railing?.heightMm ?? el.heightMm ?? normalized.heightMm,
    widthMm: el.railing?.widthMm ?? Math.max(40, el.depthMm || normalized.widthMm),
  };
}

export function recenterRailingNodes(
  nodes: RailingPathNode[],
  fallbackWidthMm = 80
): {
  centerLocal: Point2D;
  nodes: RailingPathNode[];
  widthMm: number;
  depthMm: number;
  minElevMm: number;
  maxElevMm: number;
} {
  if (nodes.length === 0) {
    return {
      centerLocal: { x: 0, y: 0 },
      nodes: [
        { xMm: -500, yMm: 0, elevationMm: 0 },
        { xMm: 500, yMm: 0, elevationMm: 0 },
      ],
      widthMm: 1000,
      depthMm: fallbackWidthMm,
      minElevMm: 0,
      maxElevMm: 0,
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minE = Infinity;
  let maxE = -Infinity;
  for (const n of nodes) {
    if (n.xMm < minX) minX = n.xMm;
    if (n.xMm > maxX) maxX = n.xMm;
    if (n.yMm < minY) minY = n.yMm;
    if (n.yMm > maxY) maxY = n.yMm;
    const e = n.elevationMm ?? 0;
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const centered = nodes.map((n) => ({
    xMm: Math.round(n.xMm - cx),
    yMm: Math.round(n.yMm - cy),
    elevationMm: Math.round(n.elevationMm ?? 0),
  }));
  return {
    centerLocal: { x: cx, y: cy },
    nodes: centered,
    widthMm: Math.max(fallbackWidthMm, Math.round(maxX - minX + fallbackWidthMm)),
    depthMm: Math.max(fallbackWidthMm, Math.round(maxY - minY + fallbackWidthMm)),
    minElevMm: minE,
    maxElevMm: maxE,
  };
}

export function localToWorldPoint(
  originX: number,
  originY: number,
  rotationDeg: number,
  lx: number,
  ly: number
): Point2D {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: originX + lx * c - ly * s,
    y: originY + lx * s + ly * c,
  };
}

export function worldToLocalPoint(
  originX: number,
  originY: number,
  rotationDeg: number,
  wx: number,
  wy: number
): Point2D {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = wx - originX;
  const dy = wy - originY;
  return {
    x: dx * c + dy * s,
    y: -dx * s + dy * c,
  };
}

export function getRailingWorldNodes(
  el: Pick<ArchElement, 'xMm' | 'yMm' | 'elevationMm' | 'rotationDeg' | 'widthMm' | 'depthMm' | 'heightMm' | 'color' | 'accentColor' | 'material' | 'railing'>
): Array<{ xMm: number; yMm: number; elevationMm: number }> {
  const cfg = resolveRailingConfig(el);
  return cfg.nodes.map((n) => {
    const wp = localToWorldPoint(el.xMm, el.yMm, el.rotationDeg, n.xMm, n.yMm);
    return {
      xMm: wp.x,
      yMm: wp.y,
      elevationMm: el.elevationMm + (n.elevationMm ?? 0),
    };
  });
}

export interface RailingSegmentSummary {
  index: number;
  start: RailingPathNode;
  end: RailingPathNode;
  planLengthMm: number;
  slopeDeltaMm: number;
  length3dMm: number;
  postTs: number[];
  balusterTs: number[];
}

export interface RailingPathMetrics {
  totalPlanLengthMm: number;
  total3dLengthMm: number;
  segmentCount: number;
  postCount: number;
  balusterCount: number;
  minElevMm: number;
  maxElevMm: number;
  isSloped: boolean;
  segments: RailingSegmentSummary[];
}

export function computeRailingPathMetrics(config: RailingConfig): RailingPathMetrics {
  const nodes = config.nodes;
  if (nodes.length < 2) {
    return {
      totalPlanLengthMm: 0,
      total3dLengthMm: 0,
      segmentCount: 0,
      postCount: nodes.length,
      balusterCount: 0,
      minElevMm: 0,
      maxElevMm: 0,
      isSloped: false,
      segments: [],
    };
  }

  const segments: RailingSegmentSummary[] = [];
  const segPairs: Array<[RailingPathNode, RailingPathNode]> = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    segPairs.push([nodes[i], nodes[i + 1]]);
  }
  if (config.closed && nodes.length >= 3) {
    segPairs.push([nodes[nodes.length - 1], nodes[0]]);
  }

  let totalPlan = 0;
  let total3d = 0;
  let minE = Infinity;
  let maxE = -Infinity;
  for (const n of nodes) {
    const e = n.elevationMm ?? 0;
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
  }

  const hasVerticalPickets =
    config.style === 'traditional_balusters' || config.style === 'modern_minimalist';

  let totalPosts = nodes.length;
  let totalBalusters = 0;

  segPairs.forEach(([a, b], idx) => {
    const dx = b.xMm - a.xMm;
    const dy = b.yMm - a.yMm;
    const dz = (b.elevationMm ?? 0) - (a.elevationMm ?? 0);
    const planLen = Math.hypot(dx, dy);
    const len3d = Math.hypot(planLen, dz);
    totalPlan += planLen;
    total3d += len3d;

    const postSpans = Math.max(1, Math.ceil(planLen / Math.max(250, config.postSpacingMm)));
    const postTs: number[] = [];
    for (let k = 0; k <= postSpans; k++) {
      postTs.push(k / postSpans);
    }
    totalPosts += Math.max(0, postSpans - 1);

    const balusterTs: number[] = [];
    if (hasVerticalPickets && planLen > 80) {
      const bStep = Math.max(45, config.balusterSpacingMm);
      for (let pIdx = 0; pIdx < postSpans; pIdx++) {
        const t0 = pIdx / postSpans;
        const t1 = (pIdx + 1) / postSpans;
        const spanLen = planLen * (t1 - t0);
        const count = Math.max(1, Math.floor(spanLen / bStep));
        for (let b = 1; b < count; b++) {
          balusterTs.push(t0 + ((t1 - t0) * b) / count);
        }
      }
      totalBalusters += balusterTs.length;
    }

    segments.push({
      index: idx,
      start: a,
      end: b,
      planLengthMm: planLen,
      slopeDeltaMm: dz,
      length3dMm: len3d,
      postTs,
      balusterTs,
    });
  });

  return {
    totalPlanLengthMm: totalPlan,
    total3dLengthMm: total3d,
    segmentCount: segments.length,
    postCount: totalPosts,
    balusterCount: totalBalusters,
    minElevMm: Number.isFinite(minE) ? minE : 0,
    maxElevMm: Number.isFinite(maxE) ? maxE : 0,
    isSloped: Math.abs(maxE - minE) > 5,
    segments,
  };
}

export function buildRailingArchElementFromWorldPoints(
  id: string,
  worldPts: Array<{ xMm: number; yMm: number; elevationMm?: number }>,
  style: RailingStyleId = DEFAULT_RAILING_STYLE,
  options?: {
    name?: string;
    closed?: boolean;
    configOverrides?: Partial<RailingConfig>;
  }
): ArchElement {
  const minElev = worldPts.reduce((m, p) => Math.min(m, p.elevationMm ?? 0), Infinity);
  const baseElev = Number.isFinite(minElev) ? Math.round(minElev) : 0;
  const relNodes: RailingPathNode[] = worldPts.map((p) => ({
    xMm: p.xMm,
    yMm: p.yMm,
    elevationMm: Math.round((p.elevationMm ?? 0) - baseElev),
  }));
  const def = createDefaultRailingConfig(style, 2000);
  const mergedCfg = normalizeRailingConfig(
    {
      ...def,
      ...options?.configOverrides,
      style,
      nodes: relNodes,
      closed: Boolean(options?.closed),
    },
    2000
  );
  const recentered = recenterRailingNodes(mergedCfg.nodes, mergedCfg.widthMm);
  mergedCfg.nodes = recentered.nodes;
  const meta = getRailingStyleMeta(style);

  return {
    id,
    name: options?.name ?? `${meta.label} Railing`,
    type: 'railing',
    xMm: Math.round(recentered.centerLocal.x),
    yMm: Math.round(recentered.centerLocal.y),
    elevationMm: baseElev,
    rotationDeg: 0,
    widthMm: recentered.widthMm,
    depthMm: recentered.depthMm,
    heightMm: mergedCfg.heightMm,
    color: meta.defaultColor,
    accentColor: mergedCfg.accentColor,
    material: mergedCfg.material,
    railing: mergedCfg,
    visible: true,
    locked: false,
  };
}

// ==================== MULTI-FLIGHT STAIRCASE GEOMETRY & INTEGRATED RAILINGS ====================

export interface StairStepBoxSpec {
  centerXMm: number;
  centerYMm: number;
  bottomElevMm: number;
  widthMm: number;
  depthMm: number;
  riseMm: number;
  rotationDeg: number; // local Y rotation in plan (degrees)
  isLanding?: boolean;
  wedgeRadiusMm?: number; // for spiral wedge
  wedgeStartAngleRad?: number;
  wedgeSweepRad?: number;
}

export interface StaircaseGeometrySpec {
  steps: StairStepBoxSpec[];
  leftRailingNodes: RailingPathNode[];
  rightRailingNodes: RailingPathNode[];
  walkLine2D: Point2D[];
  totalHeightMm: number;
  flightWidthMm: number;
}

export function computeStaircaseGeometrySpec(
  el: Pick<
    ArchElement,
    'type' | 'widthMm' | 'depthMm' | 'heightMm' | 'stepCount' | 'stairTurnDirection' | 'connectToCeiling' | 'elevationMm'
  >,
  ceilingHeightMm = 2800
): StaircaseGeometrySpec {
  const totalH = el.connectToCeiling
    ? Math.max(400, ceilingHeightMm - el.elevationMm)
    : Math.max(300, el.heightMm || ceilingHeightMm);
  const w = Math.max(500, el.widthMm);
  const d = Math.max(700, el.depthMm);
  const stepCount = Math.max(4, Math.min(44, Math.round(el.stepCount ?? 14)));
  const hw = w / 2;
  const hd = d / 2;
  const railInset = 36;
  const turnRight = el.stairTurnDirection !== 'left';
  const ts = turnRight ? 1 : -1;

  if (el.type === 'stairs_l') {
    const flightW = Math.min(w * 0.56, d * 0.56, 1150);
    const lowerRun = Math.max(400, d - flightW);
    const upperRun = Math.max(400, w - flightW);
    const lowerSteps = Math.max(2, Math.round(stepCount * (lowerRun / (lowerRun + upperRun))));
    const upperSteps = Math.max(2, stepCount - lowerSteps);
    const totalRises = lowerSteps + 1 + upperSteps;
    const riseH = totalH / totalRises;
    const landingElev = lowerSteps * riseH;

    // Lower flight sits on -X side when turning right (+X), or +X side when turning left
    const lowerX = -ts * (hw - flightW / 2);
    const landingX = lowerX;
    const landingY = -hd + flightW / 2;
    const lowerStartY = hd;
    const lowerEndY = -hd + flightW;
    const upperStartX = lowerX + ts * (flightW / 2);
    const upperEndX = ts * hw;
    const upperY = landingY;

    const steps: StairStepBoxSpec[] = [];
    const tread1 = lowerRun / lowerSteps;
    for (let i = 0; i < lowerSteps; i++) {
      steps.push({
        centerXMm: lowerX,
        centerYMm: lowerStartY - (i + 0.5) * tread1,
        bottomElevMm: i * riseH,
        widthMm: flightW,
        depthMm: tread1 * 1.03,
        riseMm: riseH,
        rotationDeg: 0,
      });
    }
    // Corner landing slab
    steps.push({
      centerXMm: landingX,
      centerYMm: landingY,
      bottomElevMm: landingElev,
      widthMm: flightW,
      depthMm: flightW,
      riseMm: riseH,
      rotationDeg: 0,
      isLanding: true,
    });
    const tread2 = upperRun / upperSteps;
    for (let j = 0; j < upperSteps; j++) {
      steps.push({
        centerXMm: upperStartX + ts * (j + 0.5) * tread2,
        centerYMm: upperY,
        bottomElevMm: (lowerSteps + 1 + j) * riseH,
        widthMm: flightW,
        depthMm: tread2 * 1.03,
        riseMm: riseH,
        rotationDeg: turnRight ? -90 : 90,
      });
    }

    // Outer continuous perimeter railing (left when turnRight, right when turnLeft) & inner corner railing
    const outerX = lowerX - ts * (flightW / 2 - railInset);
    const innerX = lowerX + ts * (flightW / 2 - railInset);
    const outerTurnY = -hd + railInset;
    const innerTurnY = lowerEndY - railInset;
    const landingTopElev = landingElev + riseH;

    const outerRail: RailingPathNode[] = [
      { xMm: outerX, yMm: lowerStartY, elevationMm: riseH * 0.5 },
      { xMm: outerX, yMm: lowerEndY, elevationMm: landingTopElev },
      { xMm: outerX, yMm: outerTurnY, elevationMm: landingTopElev },
      { xMm: upperStartX, yMm: outerTurnY, elevationMm: landingTopElev },
      { xMm: upperEndX, yMm: outerTurnY, elevationMm: totalH },
    ];
    const innerRail: RailingPathNode[] = [
      { xMm: innerX, yMm: lowerStartY, elevationMm: riseH * 0.5 },
      { xMm: innerX, yMm: innerTurnY, elevationMm: landingTopElev },
      { xMm: upperEndX, yMm: innerTurnY, elevationMm: totalH },
    ];

    return {
      steps,
      leftRailingNodes: turnRight ? outerRail : innerRail,
      rightRailingNodes: turnRight ? innerRail : outerRail,
      walkLine2D: [
        { x: lowerX, y: lowerStartY - 80 },
        { x: landingX, y: landingY },
        { x: upperEndX - ts * 80, y: upperY },
      ],
      totalHeightMm: totalH,
      flightWidthMm: flightW,
    };
  }

  if (el.type === 'stairs_u') {
    const gapMm = Math.min(260, w * 0.14);
    const flightW = Math.max(360, (w - gapMm) / 2);
    const landingD = Math.min(d * 0.42, Math.max(700, flightW));
    const runD = Math.max(450, d - landingD);
    const halfSteps = Math.max(2, Math.floor(stepCount / 2));
    const totalRises = halfSteps * 2 + 1;
    const riseH = totalH / totalRises;
    const landingTopElev = (halfSteps + 1) * riseH;

    const lowerX = -ts * (hw - flightW / 2);
    const upperX = ts * (hw - flightW / 2);
    const lowerStartY = hd;
    const lowerEndY = -hd + landingD;
    const tread = runD / halfSteps;

    const steps: StairStepBoxSpec[] = [];
    for (let i = 0; i < halfSteps; i++) {
      steps.push({
        centerXMm: lowerX,
        centerYMm: lowerStartY - (i + 0.5) * tread,
        bottomElevMm: i * riseH,
        widthMm: flightW,
        depthMm: tread * 1.03,
        riseMm: riseH,
        rotationDeg: 0,
      });
    }
    steps.push({
      centerXMm: 0,
      centerYMm: -hd + landingD / 2,
      bottomElevMm: halfSteps * riseH,
      widthMm: w,
      depthMm: landingD,
      riseMm: riseH,
      rotationDeg: 0,
      isLanding: true,
    });
    for (let j = 0; j < halfSteps; j++) {
      steps.push({
        centerXMm: upperX,
        centerYMm: lowerEndY + (j + 0.5) * tread,
        bottomElevMm: (halfSteps + 1 + j) * riseH,
        widthMm: flightW,
        depthMm: tread * 1.03,
        riseMm: riseH,
        rotationDeg: 180,
      });
    }

    const outerLeftX = -hw + railInset;
    const outerRightX = hw - railInset;
    const innerLowerX = lowerX + ts * (flightW / 2 - railInset);
    const innerUpperX = upperX - ts * (flightW / 2 - railInset);
    const backTurnY = -hd + railInset;
    const innerTurnY = lowerEndY - Math.max(45, gapMm * 0.25);

    const outerRail: RailingPathNode[] = [
      {
        xMm: turnRight ? outerLeftX : outerRightX,
        yMm: lowerStartY,
        elevationMm: riseH * 0.5,
      },
      {
        xMm: turnRight ? outerLeftX : outerRightX,
        yMm: lowerEndY,
        elevationMm: landingTopElev,
      },
      {
        xMm: turnRight ? outerLeftX : outerRightX,
        yMm: backTurnY,
        elevationMm: landingTopElev,
      },
      {
        xMm: turnRight ? outerRightX : outerLeftX,
        yMm: backTurnY,
        elevationMm: landingTopElev,
      },
      {
        xMm: turnRight ? outerRightX : outerLeftX,
        yMm: lowerEndY,
        elevationMm: landingTopElev,
      },
      {
        xMm: turnRight ? outerRightX : outerLeftX,
        yMm: lowerStartY,
        elevationMm: totalH,
      },
    ];

    const innerRail: RailingPathNode[] = [
      { xMm: innerLowerX, yMm: lowerStartY, elevationMm: riseH * 0.5 },
      { xMm: innerLowerX, yMm: innerTurnY, elevationMm: landingTopElev },
      { xMm: innerUpperX, yMm: innerTurnY, elevationMm: landingTopElev },
      { xMm: innerUpperX, yMm: lowerStartY, elevationMm: totalH },
    ];

    return {
      steps,
      leftRailingNodes: turnRight ? outerRail : innerRail,
      rightRailingNodes: turnRight ? innerRail : outerRail,
      walkLine2D: [
        { x: lowerX, y: lowerStartY - 80 },
        { x: lowerX, y: -hd + landingD * 0.45 },
        { x: upperX, y: -hd + landingD * 0.45 },
        { x: upperX, y: lowerStartY - 80 },
      ],
      totalHeightMm: totalH,
      flightWidthMm: flightW,
    };
  }

  if (el.type === 'stairs_spiral') {
    const outerR = Math.min(hw, hd);
    const innerR = Math.max(95, outerR * 0.16);
    const sweepTotal = Math.PI * 1.82 * ts;
    const startAngle = Math.PI * 0.5;
    const riseH = totalH / stepCount;
    const deltaAngle = sweepTotal / stepCount;

    const steps: StairStepBoxSpec[] = [];
    const outerRail: RailingPathNode[] = [];
    const innerRail: RailingPathNode[] = [];
    const walkLine2D: Point2D[] = [];
    const railR = outerR - railInset;
    const walkR = (innerR + outerR) * 0.55;

    for (let i = 0; i < stepCount; i++) {
      const a0 = startAngle + i * deltaAngle;
      const aMid = a0 + deltaAngle * 0.5;
      steps.push({
        centerXMm: Math.cos(aMid) * ((innerR + outerR) * 0.5),
        centerYMm: Math.sin(aMid) * ((innerR + outerR) * 0.5),
        bottomElevMm: i * riseH,
        widthMm: outerR - innerR,
        depthMm: Math.max(180, Math.abs(deltaAngle) * ((innerR + outerR) * 0.55)),
        riseMm: riseH,
        rotationDeg: (aMid * 180) / Math.PI,
        wedgeRadiusMm: outerR,
        wedgeStartAngleRad: a0,
        wedgeSweepRad: deltaAngle,
      });
      outerRail.push({
        xMm: Math.cos(a0) * railR,
        yMm: Math.sin(a0) * railR,
        elevationMm: (i + 0.5) * riseH,
      });
      innerRail.push({
        xMm: Math.cos(a0) * (innerR + 28),
        yMm: Math.sin(a0) * (innerR + 28),
        elevationMm: (i + 0.5) * riseH,
      });
      walkLine2D.push({
        x: Math.cos(aMid) * walkR,
        y: Math.sin(aMid) * walkR,
      });
    }
    const endA = startAngle + sweepTotal;
    outerRail.push({
      xMm: Math.cos(endA) * railR,
      yMm: Math.sin(endA) * railR,
      elevationMm: totalH,
    });

    return {
      steps,
      leftRailingNodes: outerRail,
      rightRailingNodes: innerRail,
      walkLine2D,
      totalHeightMm: totalH,
      flightWidthMm: outerR - innerR,
    };
  }

  // Straight staircase (stairs_straight)
  const riseH = totalH / stepCount;
  const treadD = d / stepCount;
  const steps: StairStepBoxSpec[] = [];
  for (let i = 0; i < stepCount; i++) {
    steps.push({
      centerXMm: 0,
      centerYMm: hd - (i + 0.5) * treadD,
      bottomElevMm: i * riseH,
      widthMm: w,
      depthMm: treadD * 1.04,
      riseMm: riseH,
      rotationDeg: 0,
    });
  }
  const leftRail: RailingPathNode[] = [
    { xMm: -hw + railInset, yMm: hd, elevationMm: riseH * 0.5 },
    { xMm: -hw + railInset, yMm: -hd, elevationMm: totalH },
  ];
  const rightRail: RailingPathNode[] = [
    { xMm: hw - railInset, yMm: hd, elevationMm: riseH * 0.5 },
    { xMm: hw - railInset, yMm: -hd, elevationMm: totalH },
  ];

  return {
    steps,
    leftRailingNodes: leftRail,
    rightRailingNodes: rightRail,
    walkLine2D: [
      { x: 0, y: hd - 90 },
      { x: 0, y: -hd + 90 },
    ],
    totalHeightMm: totalH,
    flightWidthMm: w,
  };
}

export function resolveHostStairRailings(
  el: Pick<
    ArchElement,
    | 'type'
    | 'widthMm'
    | 'depthMm'
    | 'heightMm'
    | 'stepCount'
    | 'stairTurnDirection'
    | 'connectToCeiling'
    | 'elevationMm'
    | 'hasRailing'
    | 'railingLeft'
    | 'railingRight'
    | 'railing'
    | 'color'
    | 'accentColor'
    | 'material'
  >,
  ceilingHeightMm = 2800
): RailingConfig[] {
  const spec = computeStaircaseGeometrySpec(el, ceilingHeightMm);
  const wantRight = el.railingRight ?? Boolean(el.hasRailing);
  const wantLeft =
    el.railingLeft ??
    (el.type === 'stairs_spiral'
      ? false
      : el.type === 'stairs_l' || el.type === 'stairs_u'
        ? Boolean(el.hasRailing)
        : false);

  const baseCfg = normalizeRailingConfig(
    {
      ...createDefaultRailingConfig(el.railing?.style ?? DEFAULT_RAILING_STYLE, el.depthMm),
      ...el.railing,
      heightMm: el.railing?.heightMm ?? 960,
    },
    el.depthMm
  );

  const out: RailingConfig[] = [];
  if (wantLeft && spec.leftRailingNodes.length >= 2) {
    out.push({
      ...baseCfg,
      nodes: spec.leftRailingNodes.map((n) => ({ ...n })),
    });
  }
  if (wantRight && spec.rightRailingNodes.length >= 2) {
    out.push({
      ...baseCfg,
      nodes: spec.rightRailingNodes.map((n) => ({ ...n })),
    });
  }
  return out;
}

export function resolveDeckEdgeToggles(
  el: Pick<ArchElement, 'type' | 'hasRailing' | 'railingEdges'>
): Required<RailingEdgeToggles> {
  if (el.railingEdges) {
    return {
      front: Boolean(el.railingEdges.front),
      back: Boolean(el.railingEdges.back),
      left: Boolean(el.railingEdges.left),
      right: Boolean(el.railingEdges.right),
    };
  }
  if (el.type === 'balcony' && el.hasRailing !== false) {
    return { front: true, back: false, left: true, right: true };
  }
  if (el.type === 'platform' && el.hasRailing === true) {
    return { front: true, back: false, left: true, right: true };
  }
  return { front: false, back: false, left: false, right: false };
}

export function resolveHostDeckRailings(
  el: Pick<
    ArchElement,
    'type' | 'widthMm' | 'depthMm' | 'heightMm' | 'hasRailing' | 'railingEdges' | 'railing'
  >
): RailingConfig[] {
  const edges = resolveDeckEdgeToggles(el);
  if (!edges.front && !edges.back && !edges.left && !edges.right) return [];

  const hw = el.widthMm / 2 - 40;
  const hd = el.depthMm / 2 - 40;
  const deckTopY = Math.max(0, el.heightMm);

  const baseCfg = normalizeRailingConfig(
    {
      ...createDefaultRailingConfig(el.railing?.style ?? DEFAULT_RAILING_STYLE, el.widthMm),
      ...el.railing,
      heightMm: el.railing?.heightMm ?? 1050,
    },
    el.widthMm
  );

  // Merge contiguous enabled edges into continuous corner-connected paths
  // Order around perimeter: back (-hd), right (+hw), front (+hd), left (-hw)
  const edgeOrder: Array<{
    key: keyof RailingEdgeToggles;
    a: RailingPathNode;
    b: RailingPathNode;
  }> = [
    { key: 'back', a: { xMm: -hw, yMm: -hd, elevationMm: deckTopY }, b: { xMm: hw, yMm: -hd, elevationMm: deckTopY } },
    { key: 'right', a: { xMm: hw, yMm: -hd, elevationMm: deckTopY }, b: { xMm: hw, yMm: hd, elevationMm: deckTopY } },
    { key: 'front', a: { xMm: hw, yMm: hd, elevationMm: deckTopY }, b: { xMm: -hw, yMm: hd, elevationMm: deckTopY } },
    { key: 'left', a: { xMm: -hw, yMm: hd, elevationMm: deckTopY }, b: { xMm: -hw, yMm: -hd, elevationMm: deckTopY } },
  ];

  const allFour = edges.back && edges.right && edges.front && edges.left;
  if (allFour) {
    return [
      {
        ...baseCfg,
        closed: true,
        nodes: edgeOrder.map((e) => e.a),
      },
    ];
  }

  // Rotate starting index so a gap isn't split across wrap-around
  let startIdx = 0;
  for (let i = 0; i < 4; i++) {
    const prev = edgeOrder[(i + 3) % 4];
    const cur = edgeOrder[i];
    if (edges[cur.key] && !edges[prev.key]) {
      startIdx = i;
      break;
    }
  }

  const runs: RailingPathNode[][] = [];
  let curRun: RailingPathNode[] | null = null;
  for (let k = 0; k < 4; k++) {
    const item = edgeOrder[(startIdx + k) % 4];
    if (edges[item.key]) {
      if (!curRun) {
        curRun = [item.a, item.b];
      } else {
        curRun.push(item.b);
      }
    } else if (curRun) {
      runs.push(curRun);
      curRun = null;
    }
  }
  if (curRun) runs.push(curRun);

  return runs.map((nodes) => ({
    ...baseCfg,
    closed: false,
    nodes,
  }));
}

export function extractEditableRailingElementsFromHost(
  host: ArchElement,
  uidFn: (prefix: string) => string,
  ceilingHeightMm = 2800
): ArchElement[] {
  const configs = host.type.startsWith('stairs')
    ? resolveHostStairRailings(host, ceilingHeightMm)
    : resolveHostDeckRailings(host);

  return configs.map((cfg, idx) => {
    const worldPts = cfg.nodes.map((n) => {
      const wp = localToWorldPoint(host.xMm, host.yMm, host.rotationDeg, n.xMm, n.yMm);
      return {
        xMm: wp.x,
        yMm: wp.y,
        elevationMm: host.elevationMm + (n.elevationMm ?? 0),
      };
    });
    return buildRailingArchElementFromWorldPoints(uidFn('arch'), worldPts, cfg.style, {
      name: `${host.name} Railing ${configs.length > 1 ? idx + 1 : ''}`.trim(),
      closed: cfg.closed,
      configOverrides: cfg,
    });
  });
}

// ==================== 2D DRAWING & PATH SNAPPING ====================

export interface RailingSnapResult {
  point: Point2D;
  elevationMm: number;
  snappedKind: 'railing' | 'stair_slope' | 'deck_edge' | 'wall' | 'grid' | 'none';
  snapLabel?: string;
}

function projectOnSeg2D(
  p: Point2D,
  a: Point2D,
  b: Point2D
): { point: Point2D; t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return { point: { ...a }, t: 0, distance: Math.hypot(p.x - a.x, p.y - a.y) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const q = { x: a.x + dx * t, y: a.y + dy * t };
  return { point: q, t, distance: Math.hypot(p.x - q.x, p.y - q.y) };
}

export function snapRailingDrawPoint(
  rawWorld: Point2D,
  options: {
    walls: Wall[];
    archElements: ArchElement[];
    gridSizeMm: number;
    snapEnabled: boolean;
    snapThresholdMm?: number;
    ceilingHeightMm?: number;
    excludeArchId?: string;
  }
): RailingSnapResult {
  const {
    walls,
    archElements,
    gridSizeMm,
    snapEnabled,
    snapThresholdMm = 170,
    ceilingHeightMm = 2800,
    excludeArchId,
  } = options;

  if (!snapEnabled) {
    return {
      point: { x: Math.round(rawWorld.x), y: Math.round(rawWorld.y) },
      elevationMm: 0,
      snappedKind: 'none',
    };
  }

  let bestDist = snapThresholdMm;
  let bestRes: RailingSnapResult | null = null;

  // 1. Snap to existing railing path nodes (higher priority for continuous chains)
  for (const el of archElements) {
    if (!el.visible || el.type !== 'railing' || el.id === excludeArchId) continue;
    const wNodes = getRailingWorldNodes(el);
    for (const wn of wNodes) {
      const d = Math.hypot(rawWorld.x - wn.xMm, rawWorld.y - wn.yMm);
      if (d < bestDist) {
        bestDist = d;
        bestRes = {
          point: { x: Math.round(wn.xMm), y: Math.round(wn.yMm) },
          elevationMm: Math.round(wn.elevationMm),
          snappedKind: 'railing',
          snapLabel: 'Railing Node',
        };
      }
    }
  }

  // 2. Snap to staircases (automatic sloped elevation interpolation!)
  for (const el of archElements) {
    if (!el.visible || !el.type.startsWith('stairs')) continue;
    const spec = computeStaircaseGeometrySpec(el, ceilingHeightMm);
    for (const railNodes of [spec.leftRailingNodes, spec.rightRailingNodes]) {
      for (let i = 0; i < railNodes.length - 1; i++) {
        const aLocal = railNodes[i];
        const bLocal = railNodes[i + 1];
        const aw = localToWorldPoint(el.xMm, el.yMm, el.rotationDeg, aLocal.xMm, aLocal.yMm);
        const bw = localToWorldPoint(el.xMm, el.yMm, el.rotationDeg, bLocal.xMm, bLocal.yMm);
        const proj = projectOnSeg2D(rawWorld, aw, bw);
        if (proj.distance < bestDist) {
          bestDist = proj.distance;
          const ea = el.elevationMm + (aLocal.elevationMm ?? 0);
          const eb = el.elevationMm + (bLocal.elevationMm ?? 0);
          const interpElev = ea + (eb - ea) * proj.t;
          bestRes = {
            point: { x: Math.round(proj.point.x), y: Math.round(proj.point.y) },
            elevationMm: Math.round(interpElev),
            snappedKind: 'stair_slope',
            snapLabel: `Stair Slope (${Math.round(interpElev / 10)} cm)`,
          };
        }
      }
    }
  }

  // 3. Snap to balcony & platform perimeter edges at deck top elevation
  for (const el of archElements) {
    if (!el.visible || (el.type !== 'balcony' && el.type !== 'platform')) continue;
    const hw = Math.max(40, el.widthMm / 2 - 40);
    const hd = Math.max(40, el.depthMm / 2 - 40);
    const deckTop = el.elevationMm + el.heightMm;
    const cornersLocal = [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: hd },
      { x: -hw, y: hd },
    ];
    const cornersW = cornersLocal.map((c) => localToWorldPoint(el.xMm, el.yMm, el.rotationDeg, c.x, c.y));
    for (let i = 0; i < 4; i++) {
      const cw = cornersW[i];
      const dc = Math.hypot(rawWorld.x - cw.x, rawWorld.y - cw.y);
      if (dc < bestDist) {
        bestDist = dc;
        bestRes = {
          point: { x: Math.round(cw.x), y: Math.round(cw.y) },
          elevationMm: Math.round(deckTop),
          snappedKind: 'deck_edge',
          snapLabel: `${el.type === 'balcony' ? 'Balcony' : 'Platform'} Corner`,
        };
      }
      const nw = cornersW[(i + 1) % 4];
      const proj = projectOnSeg2D(rawWorld, cw, nw);
      if (proj.distance < bestDist) {
        bestDist = proj.distance;
        bestRes = {
          point: { x: Math.round(proj.point.x), y: Math.round(proj.point.y) },
          elevationMm: Math.round(deckTop),
          snappedKind: 'deck_edge',
          snapLabel: `${el.type === 'balcony' ? 'Balcony' : 'Platform'} Edge`,
        };
      }
    }
  }

  // 4. Snap to wall endpoints and faces
  if (!bestRes) {
    for (const w of walls) {
      if (!w.visible) continue;
      for (const endPt of [w.start, w.end]) {
        const d = Math.hypot(rawWorld.x - endPt.x, rawWorld.y - endPt.y);
        if (d < bestDist) {
          bestDist = d;
          bestRes = {
            point: { x: Math.round(endPt.x), y: Math.round(endPt.y) },
            elevationMm: 0,
            snappedKind: 'wall',
            snapLabel: 'Wall Corner',
          };
        }
      }
      const proj = projectOnSeg2D(rawWorld, w.start, w.end);
      if (proj.distance < bestDist) {
        bestDist = proj.distance;
        bestRes = {
          point: { x: Math.round(proj.point.x), y: Math.round(proj.point.y) },
          elevationMm: 0,
          snappedKind: 'wall',
          snapLabel: 'Wall Face',
        };
      }
    }
  }

  if (bestRes) return bestRes;

  const g = Math.max(10, gridSizeMm || 50);
  return {
    point: {
      x: Math.round(rawWorld.x / g) * g,
      y: Math.round(rawWorld.y / g) * g,
    },
    elevationMm: 0,
    snappedKind: 'grid',
  };
}
