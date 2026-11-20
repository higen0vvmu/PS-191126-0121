import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Contrast,
  Eye,
  EyeOff,
  Layers,
  Map as MapIcon,
  Maximize2,
  MousePointerClick,
  Plus,
  Ruler,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ArchElement,
  Curtain,
  FurnitureInstance,
  Level,
  Opening,
  PersonInstance,
  Point2D,
  ProjectSettings,
  SelectionTarget,
  Wall,
} from '../types/plan';
import {
  buildWallDimensionChain,
  computeAttachedChimneyTransform,
  computeChimneyFaceBounds,
  computeWallInnerBounds,
  computeWallPolygon,
  CutThroughProjectedPart,
  dist,
  doesChimneyOverlapWalls,
  getChimneyCornerPin,
  getEnclosingRoomCeilingMm,
  getNonCrossingClearances,
  getWallArcLength,
  getWallCenterlinePoint,
  getWallMountedComponents,
  projectFurnitureForWallCutThrough,
  resolveChimneyFaceColors,
  resolveWallFaces,
  solveChimneyResize,
  solveConnectedWallLengthChange,
  solveWallClearanceEdit,
  solveWallComponentDrag,
  solveWallComponentResize,
  wallOffsets,
  type WallViewFurnitureProjection,
} from '../utils/geometry';
import {
  getEffectiveViewElements,
  hasCustomView,
  renderFurnitureRepresentationView,
} from '../utils/svgRepresentationRenderer';
import { isBuiltinCatalogItem, resolveEffectiveRepresentationMode } from '../utils/svgImport';
import { formatSmartMetric, uid } from '../utils/units';
import { getEffectiveMaterialHex } from '../data/materials';

interface WallMiniSelectorMapProps {
  walls: Wall[];
  activeWallId: string | null;
  onSelectWall: (wallId: string) => void;
  compact?: boolean;
}

const WallMiniSelectorMap: React.FC<WallMiniSelectorMapProps> = ({
  walls,
  activeWallId,
  onSelectWall,
  compact = false,
}) => {
  const [hoverId, setHoverId] = useState<string | null>(null);

  let minX = -2000;
  let maxX = 2000;
  let minY = -2000;
  let maxY = 2000;
  if (walls.length > 0) {
    minX = Infinity;
    maxX = -Infinity;
    minY = Infinity;
    maxY = -Infinity;
    for (const w of walls) {
      minX = Math.min(minX, w.start.x, w.end.x);
      maxX = Math.max(maxX, w.start.x, w.end.x);
      minY = Math.min(minY, w.start.y, w.end.y);
      maxY = Math.max(maxY, w.start.y, w.end.y);
    }
  }
  const pad = compact ? 550 : 800;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = Math.max(1500, maxX - minX + pad * 2);
  const vbH = Math.max(1500, maxY - minY + pad * 2);
  const baseR = Math.max(130, Math.min(320, Math.max(vbW, vbH) * (compact ? 0.042 : 0.025)));

  return (
    <svg
      className="w-full h-full block"
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {walls.map((w, idx) => {
        const poly = computeWallPolygon(w, walls);
        const ptsStr = poly.map((p) => `${p.x},${p.y}`).join(' ');
        const mid = getWallCenterlinePoint(w, 0.5).point;
        const isActive = w.id === activeWallId;
        const isHov = hoverId === w.id;
        return (
          <g
            key={w.id}
            className="cursor-pointer"
            onPointerEnter={() => setHoverId(w.id)}
            onPointerLeave={() => setHoverId((cur) => (cur === w.id ? null : cur))}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSelectWall(w.id);
            }}
          >
            <title>
              {`Wall ${idx + 1} · ${formatSmartMetric(getWallArcLength(w))}`}
            </title>
            <polygon
              points={ptsStr}
              fill={
                isActive
                  ? 'rgba(37, 99, 235, 0.55)'
                  : isHov
                    ? 'rgba(37, 99, 235, 0.34)'
                    : 'rgba(59, 130, 246, 0.16)'
              }
              stroke={isActive ? '#1D4ED8' : isHov ? '#2563EB' : '#60A5FA'}
              strokeWidth={Math.max(24, baseR * (isActive ? 0.2 : 0.14))}
              strokeLinejoin="round"
            />
            {isActive && (
              <circle
                cx={mid.x}
                cy={mid.y}
                r={baseR * 1.48}
                fill="rgba(37, 99, 235, 0.22)"
                stroke="#2563EB"
                strokeWidth={baseR * 0.14}
              />
            )}
            <circle
              cx={mid.x}
              cy={mid.y}
              r={isActive ? baseR * 1.12 : isHov ? baseR * 1.15 : baseR * 0.92}
              fill={isActive ? '#2563EB' : isHov ? '#2563EB' : '#64748B'}
              fillOpacity={0.95}
              stroke="#FFFFFF"
              strokeWidth={baseR * 0.22}
            />
            <circle cx={mid.x} cy={mid.y} r={baseR * 0.32} fill="#FFFFFF" />
          </g>
        );
      })}
    </svg>
  );
};

interface WallCutThroughViewerProps {
  level: Level;
  settings: ProjectSettings;
  selection: SelectionTarget[];
  onSelect: (targets: SelectionTarget[]) => void;
  onUpdateLevel?: (
    updater: (lvl: Level) => Level,
    recomputeRooms?: boolean,
    recordHistory?: boolean,
    label?: string,
    coalesceKey?: string
  ) => void;
  onCommitDrag?: (label: string) => void;
  onCancelDrag?: () => void;
  onConstraintError?: (message: string) => void;
  onToggleBlackAndWhite?: () => void;
}

type ElevDragState =
  | { kind: 'pan'; startClientX: number; startClientY: number; origPanX: number; origPanY: number }
  | {
      kind: 'comp_move';
      compId: string;
      compKind: 'opening' | 'chimney';
      startClientX: number;
      startClientY: number;
      origCenterS: number;
      origSillMm: number;
      label: string;
    }
  | {
      kind: 'comp_edge';
      compId: string;
      compKind: 'opening' | 'chimney';
      visualEdge: 'left' | 'right';
      startClientX: number;
      label: string;
    }
  | {
      kind: 'comp_v';
      compId: string;
      compKind: 'opening' | 'chimney';
      handle: 'top' | 'bottom';
      startClientY: number;
      origSillMm: number;
      origHeightMm: number;
      label: string;
    };

export const WallCutThroughViewer: React.FC<WallCutThroughViewerProps> = ({
  level,
  settings,
  selection,
  onSelect,
  onUpdateLevel,
  onCommitDrag,
  onCancelDrag,
  onConstraintError,
  onToggleBlackAndWhite,
}) => {
  const isBw = !!settings.blackAndWhite2d;
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [faceSide, setFaceSide] = useState<'inner' | 'outer'>('inner');
  const [showObjects, setShowObjects] = useState(true);
  const [maxContextRangeMm, setMaxContextRangeMm] = useState(700);
  const [showDepthEffect, setShowDepthEffect] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [wallMapOpen, setWallMapOpen] = useState(true);
  const [placingChimney, setPlacingChimney] = useState(false);
  const [hoveredDimKey, setHoveredDimKey] = useState<string | null>(null);
  const [hoveredCompId, setHoveredCompId] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffsetPx, setPanOffsetPx] = useState({ x: 0, y: 0 });
  const [elevDrag, setElevDrag] = useState<ElevDragState | null>(null);
  const elevDragMutatedRef = useRef(false);
  const [liveDragBadge, setLiveDragBadge] = useState<string | null>(null);

  const [editingDim, setEditingDim] = useState<{
    key: string;
    kind:
      | 'component_width'
      | 'clearance_left'
      | 'clearance_right'
      | 'wall_length'
      | 'obj_height'
      | 'obj_sill'
      | 'obj_top_gap'
      | 'wall_height';
    wallId: string;
    compId?: string;
    compKind?: 'opening' | 'chimney';
    label: string;
    screenX: number;
    screenY: number;
    valueStr: string;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setSize({
          width: Math.max(240, e.contentRect.width),
          height: Math.max(240, e.contentRect.height),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Resolve active wall strictly from current selection (no auto-fallback when nothing is selected)
  const targetWall = useMemo<Wall | null>(() => {
    const visibleWalls = level.walls.filter((w) => w.visible);
    if (visibleWalls.length === 0) return null;

    const wallSel = selection.find((s) => s.kind === 'wall');
    if (wallSel) {
      const found = visibleWalls.find((w) => w.id === wallSel.id);
      if (found) return found;
    }

    const opSel = selection.find((s) => s.kind === 'opening');
    if (opSel) {
      const op = level.openings.find((o) => o.id === opSel.id);
      if (op) {
        const host = visibleWalls.find((w) => w.id === op.wallId);
        if (host) return host;
      }
    }

    const archSel = selection.find((s) => s.kind === 'arch');
    if (archSel) {
      const el = level.archElements.find((a) => a.id === archSel.id);
      if (el?.attachedWallId) {
        const host = visibleWalls.find((w) => w.id === el.attachedWallId);
        if (host) return host;
      }
    }

    const spatialSel = selection.find(
      (s) => s.kind === 'furniture' || s.kind === 'curtain' || s.kind === 'person' || s.kind === 'arch'
    );
    if (spatialSel) {
      const obj =
        spatialSel.kind === 'furniture'
          ? level.furniture.find((f) => f.id === spatialSel.id)
          : spatialSel.kind === 'curtain'
            ? level.curtains.find((c) => c.id === spatialSel.id)
            : spatialSel.kind === 'person'
              ? level.people.find((p) => p.id === spatialSel.id)
              : level.archElements.find((a) => a.id === spatialSel.id);
      if (obj) {
        let bestW: Wall | null = null;
        let bestD = Infinity;
        for (const w of visibleWalls) {
          const dx = w.end.x - w.start.x;
          const dy = w.end.y - w.start.y;
          const len2 = dx * dx + dy * dy || 1;
          const t = Math.max(
            0,
            Math.min(1, ((obj.xMm - w.start.x) * dx + (obj.yMm - w.start.y) * dy) / len2)
          );
          const px = w.start.x + t * dx;
          const py = w.start.y + t * dy;
          const d = Math.hypot(obj.xMm - px, obj.yMm - py);
          if (d < bestD) {
            bestD = d;
            bestW = w;
          }
        }
        if (bestW) return bestW;
      }
    }

    return null;
  }, [
    level.archElements,
    level.curtains,
    level.furniture,
    level.openings,
    level.people,
    level.walls,
    selection,
  ]);

  const targetWallId = targetWall?.id ?? null;
  useEffect(() => {
    setZoomScale(1);
    setPanOffsetPx({ x: 0, y: 0 });
    setEditingDim(null);
    setPlacingChimney(false);
  }, [targetWallId]);

  const wallFaces = useMemo(
    () => (targetWall ? resolveWallFaces(targetWall, level.rooms) : null),
    [level.rooms, targetWall]
  );
  const viewedFaceInfo = wallFaces ? (faceSide === 'inner' ? wallFaces.primary : wallFaces.secondary) : null;
  const viewedPhysicalSide: 'left' | 'right' =
    viewedFaceInfo?.physicalSide ?? (faceSide === 'inner' ? 'left' : 'right');
  const viewedSlot: 'inner' | 'outer' = viewedFaceInfo?.slot ?? faceSide;
  const isLeftView = viewedPhysicalSide === 'left';

  const wallMetrics = useMemo(() => {
    if (!targetWall) return null;
    const dx = targetWall.end.x - targetWall.start.x;
    const dy = targetWall.end.y - targetWall.start.y;
    const lenMm = Math.max(100, getWallArcLength(targetWall));
    const straightLen = Math.hypot(dx, dy) || 1;
    const ux = dx / straightLen;
    const uy = dy / straightLen;
    const nx = -uy;
    const ny = ux;

    const hasStartCap = level.walls.some(
      (w) =>
        w.id !== targetWall.id &&
        w.visible &&
        (dist(w.start, targetWall.start) < 16 || dist(w.end, targetWall.start) < 16)
    );
    const hasEndCap = level.walls.some(
      (w) =>
        w.id !== targetWall.id &&
        w.visible &&
        (dist(w.start, targetWall.end) < 16 || dist(w.end, targetWall.end) < 16)
    );

    const wallOpenings = level.openings
      .filter((o) => o.wallId === targetWall.id && o.visible)
      .map((op) => {
        const centerS = op.t * lenMm;
        const leftS = Math.max(0, centerS - op.widthMm / 2);
        const rightS = Math.min(lenMm, centerS + op.widthMm / 2);
        return { op, centerS, leftS, rightS };
      })
      .sort((a, b) => a.leftS - b.leftS);

    const projectToWall = (xMm: number, yMm: number) => {
      const rx = xMm - targetWall.start.x;
      const ry = yMm - targetWall.start.y;
      const s = rx * ux + ry * uy;
      const signedPerp = rx * nx + ry * ny;
      return { s, signedPerp };
    };

    const sideTolerance = targetWall.thicknessMm * 0.55;
    let oppositeSideCount = 0;

    // Wall-attached chimneys (directly attached to viewed physical face OR projecting onto the viewed face)
    const wallChimneys: Array<{
      el: ArchElement;
      sCenter: number;
      leftS: number;
      rightS: number;
      effHeightMm: number;
      isDirectlyAttached: boolean;
    }> = [];
    for (const el of level.archElements) {
      if (!el.visible || el.type !== 'chimney') continue;
      const isAttachedHere = el.attachedWallId === targetWall.id;
      if (isAttachedHere) {
        if (el.attachedFace && el.attachedFace !== viewedPhysicalSide) {
          oppositeSideCount += 1;
          continue;
        }
        const sCenter =
          typeof el.attachedT === 'number' ? el.attachedT * lenMm : projectToWall(el.xMm, el.yMm).s;
        const effHeightMm = el.connectToCeiling ? targetWall.heightMm : el.heightMm;
        wallChimneys.push({
          el,
          sCenter,
          leftS: Math.max(0, sCenter - el.widthMm / 2),
          rightS: Math.min(lenMm, sCenter + el.widthMm / 2),
          effHeightMm,
          isDirectlyAttached: true,
        });
      } else {
        const { s, signedPerp } = projectToWall(el.xMm, el.yMm);
        if (s + el.widthMm / 2 < -150 || s - el.widthMm / 2 > lenMm + 150) continue;
        if (Math.abs(signedPerp) > targetWall.thicknessMm / 2 + el.depthMm + 800) continue;
        const onViewedSide = isLeftView
          ? signedPerp >= -sideTolerance
          : signedPerp <= sideTolerance;
        if (!onViewedSide) {
          oppositeSideCount += 1;
          continue;
        }
        wallChimneys.push({
          el,
          sCenter: s,
          leftS: Math.max(0, s - el.widthMm / 2),
          rightS: Math.min(lenMm, s + el.widthMm / 2),
          effHeightMm: el.connectToCeiling ? targetWall.heightMm : el.heightMm,
          isDirectlyAttached: false,
        });
      }
    }

    const faceOffsets = wallOffsets(targetWall.thicknessMm, targetWall.alignment);
    const viewedFacePerp = isLeftView ? faceOffsets.left : faceOffsets.right;
    const wallHalfThick = Math.max(20, targetWall.thicknessMm * 0.5);
    const getFrontDistanceMm = (signedPerp: number, objHalfDepth: number): number | null => {
      // Signed outward distance from the viewed wall face toward the room interior side
      const signedOutFromFace = isLeftView
        ? signedPerp - viewedFacePerp
        : viewedFacePerp - signedPerp;
      const maxOutFromFace = signedOutFromFace + objHalfDepth;
      if (maxOutFromFace <= 4 || (signedOutFromFace < -wallHalfThick && maxOutFromFace <= 15)) {
        return null;
      }
      const frontDistMm = Math.max(0, signedOutFromFace - objHalfDepth);
      if (frontDistMm > maxContextRangeMm) {
        return null;
      }
      return frontDistMm;
    };

    const wallFurniture: Array<{
      item: FurnitureInstance;
      visibleParts: CutThroughProjectedPart[];
      perpDistMm: number;
      projection?: WallViewFurnitureProjection;
    }> = [];

    for (const f of level.furniture) {
      if (!f.visible) continue;
      const effCeilMm = getEnclosingRoomCeilingMm(
        { x: f.xMm, y: f.yMm },
        level.rooms,
        level.ceilingHeightMm
      );
      const proj = projectFurnitureForWallCutThrough(
        targetWall,
        viewedPhysicalSide,
        f,
        effCeilMm,
        maxContextRangeMm
      );
      if (proj.status === 'opposite_side') {
        oppositeSideCount += 1;
        continue;
      }
      if (proj.status !== 'visible') continue;
      wallFurniture.push({
        item: proj.item,
        visibleParts: proj.visibleParts,
        perpDistMm: proj.perpDistMm,
        projection: proj.projection,
      });
    }
    wallFurniture.sort((a, b) => a.perpDistMm - b.perpDistMm);

    const wallCurtains: Array<{ item: Curtain; sCenter: number; perpDistMm: number }> = [];
    for (const c of level.curtains) {
      if (!c.visible) continue;
      const { s, signedPerp } = projectToWall(c.xMm, c.yMm);
      if (s + c.widthMm / 2 <= 0 || s - c.widthMm / 2 >= lenMm) continue;
      const perpDistMm = getFrontDistanceMm(signedPerp, 60);
      if (perpDistMm === null) {
        const signedOut = isLeftView
          ? signedPerp - viewedFacePerp
          : viewedFacePerp - signedPerp;
        if (signedOut + 60 <= 4) {
          oppositeSideCount += 1;
        }
        continue;
      }
      wallCurtains.push({ item: c, sCenter: s, perpDistMm });
    }
    wallCurtains.sort((a, b) => a.perpDistMm - b.perpDistMm);

    const wallPeople: Array<{ item: PersonInstance; sCenter: number; perpDistMm: number }> = [];
    for (const p of level.people) {
      if (!p.visible) continue;
      const { s, signedPerp } = projectToWall(p.xMm, p.yMm);
      if (s + 180 <= 0 || s - 180 >= lenMm) continue;
      const perpDistMm = getFrontDistanceMm(signedPerp, 140);
      if (perpDistMm === null) continue;
      wallPeople.push({ item: p, sCenter: s, perpDistMm });
    }
    wallPeople.sort((a, b) => a.perpDistMm - b.perpDistMm);

    // Non-wall-attached architectural elements (columns, stairs, beams, fireplaces, free blocks)
    const wallContextArch: Array<{ item: ArchElement; sCenter: number; projW: number; perpDistMm: number }> = [];
    for (const el of level.archElements) {
      if (!el.visible) continue;
      if (el.type === 'chimney' && el.attachedWallId === targetWall.id) continue;
      if (el.type === 'chimney' && wallChimneys.some((c) => c.el.id === el.id)) continue;
      const { s, signedPerp } = projectToWall(el.xMm, el.yMm);
      const rad = (el.rotationDeg * Math.PI) / 180;
      const cosA = Math.abs(Math.cos(rad) * ux + Math.sin(rad) * uy);
      const sinA = Math.abs(-Math.sin(rad) * ux + Math.cos(rad) * uy);
      const projW = el.widthMm * cosA + el.depthMm * sinA;
      const projD = el.widthMm * sinA + el.depthMm * cosA;
      if (s + projW / 2 <= 0 || s - projW / 2 >= lenMm) continue;
      const perpDistMm = getFrontDistanceMm(signedPerp, projD / 2);
      if (perpDistMm === null) continue;
      wallContextArch.push({ item: el, sCenter: s, projW, perpDistMm });
    }
    wallContextArch.sort((a, b) => a.perpDistMm - b.perpDistMm);

    const maxContextDistMm = Math.max(100, maxContextRangeMm);

    return {
      lenMm,
      heightMm: targetWall.heightMm,
      hasStartCap,
      hasEndCap,
      wallOpenings,
      wallChimneys,
      wallFurniture,
      wallCurtains,
      wallPeople,
      wallContextArch,
      maxContextDistMm,
      oppositeSideCount,
      ux,
      uy,
    };
  }, [
    isLeftView,
    level.archElements,
    level.ceilingHeightMm,
    level.curtains,
    level.furniture,
    level.openings,
    level.people,
    level.rooms,
    level.walls,
    maxContextRangeMm,
    targetWall,
    viewedPhysicalSide,
  ]);

  const basePxPerMm = useMemo(() => {
    if (!wallMetrics) return 0.1;
    const padX = 120;
    const padY = 135;
    const availW = Math.max(200, size.width - padX * 2);
    const availH = Math.max(180, size.height - padY * 2);
    const totalW = wallMetrics.lenMm + 1150;
    const totalH = wallMetrics.heightMm + 950;
    return Math.min(availW / totalW, availH / totalH);
  }, [size.height, size.width, wallMetrics]);

  const pxPerMm = basePxPerMm * zoomScale;

  const mapX = useCallback(
    (sMm: number) => {
      if (!wallMetrics) return sMm;
      return isLeftView ? sMm : wallMetrics.lenMm - sMm;
    },
    [isLeftView, wallMetrics]
  );

  // Dimension chain & focused clearances shared cleanly with 2D solver
  const wallChain = useMemo(() => {
    if (!targetWall) return null;
    return buildWallDimensionChain(targetWall, level.walls, level.openings, level.archElements);
  }, [level.archElements, level.openings, level.walls, targetWall]);

  const focusedWallComp = useMemo(() => {
    if (!wallChain || !targetWall || selection.length !== 1) return null;
    const sel = selection[0];
    if (sel.kind !== 'opening' && sel.kind !== 'arch') return null;
    return getNonCrossingClearances(sel.id, wallChain.components, wallChain.bounds, targetWall.locked);
  }, [selection, targetWall, wallChain]);

  // Baseboard non-door/non-chimney spans
  const baseboardSpans = useMemo(() => {
    if (!wallMetrics || !targetWall) return [];
    const blocked: Array<[number, number]> = [];
    for (const wo of wallMetrics.wallOpenings) {
      if (wo.op.sillHeightMm < (targetWall.baseboardHeightMm || 80)) {
        const a = mapX(wo.leftS);
        const b = mapX(wo.rightS);
        blocked.push([Math.min(a, b), Math.max(a, b)]);
      }
    }
    blocked.sort((a, b) => a[0] - b[0]);
    const spans: Array<[number, number]> = [];
    let cur = 0;
    for (const [b1, b2] of blocked) {
      if (b1 > cur + 10) spans.push([cur, b1]);
      cur = Math.max(cur, b2);
    }
    if (cur < wallMetrics.lenMm - 10) spans.push([cur, wallMetrics.lenMm]);
    return spans;
  }, [mapX, targetWall, wallMetrics]);

  const worldToScreenElev = useCallback(
    (worldX: number, worldY: number): Point2D => {
      if (!wallMetrics) return { x: size.width / 2, y: size.height / 2 };
      const cxWorld = wallMetrics.lenMm / 2;
      const cyWorld = -wallMetrics.heightMm / 2;
      return {
        x: size.width / 2 + panOffsetPx.x + (worldX - cxWorld) * pxPerMm,
        y: size.height / 2 + panOffsetPx.y + (worldY - cyWorld) * pxPerMm,
      };
    },
    [panOffsetPx.x, panOffsetPx.y, pxPerMm, size.height, size.width, wallMetrics]
  );

  const screenToWorldElev = useCallback(
    (clientX: number, clientY: number): Point2D => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || !wallMetrics) return { x: 0, y: 0 };
      const cxWorld = wallMetrics.lenMm / 2;
      const cyWorld = -wallMetrics.heightMm / 2;
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return {
        x: cxWorld + (sx - (size.width / 2 + panOffsetPx.x)) / pxPerMm,
        y: cyWorld + (sy - (size.height / 2 + panOffsetPx.y)) / pxPerMm,
      };
    },
    [panOffsetPx.x, panOffsetPx.y, pxPerMm, size.height, size.width, wallMetrics]
  );

  // Place chimney directly on the currently viewed parallel wall face in Cut-Through
  const handlePlaceChimneyOnWall = useCallback(
    (clientX: number, clientY: number) => {
      if (!targetWall || !wallMetrics || !onUpdateLevel) return;
      if (targetWall.locked) {
        onConstraintError?.('Wall is locked. Unlock it before placing a chimney.');
        return;
      }
      const wPt = screenToWorldElev(clientX, clientY);
      const rawS = isLeftView ? wPt.x : wallMetrics.lenMm - wPt.x;
      const defaultW = 650;
      const defaultD = 450;
      const face: 'left' | 'right' = viewedPhysicalSide;
      const id = uid('arch');

      const faceBounds = computeChimneyFaceBounds(targetWall, level.walls, face, defaultD, rawS);
      if (faceBounds.maxS - faceBounds.minS < defaultW - 2) {
        onConstraintError?.('Not enough unobstructed wall length on this face for a chimney.');
        return;
      }
      const chimBounds = {
        lengthMm: wallMetrics.lenMm,
        innerStartS: faceBounds.minS,
        innerEndS: faceBounds.maxS,
        leftStartS: faceBounds.minS,
        leftEndS: faceBounds.maxS,
        rightStartS: faceBounds.minS,
        rightEndS: faceBounds.maxS,
      };
      const existing = getWallMountedComponents(targetWall, level.openings, level.archElements);
      const candComps = [
        ...existing,
        {
          id,
          kind: 'chimney' as const,
          name: 'Chimney',
          centerS: rawS,
          widthMm: defaultW,
          leftS: rawS - defaultW / 2,
          rightS: rawS + defaultW / 2,
          t: Math.max(0.05, Math.min(0.95, rawS / wallMetrics.lenMm)),
          locked: false,
          resizeAnchor: 'center' as const,
        },
      ].sort((a, b) => a.centerS - b.centerS);

      const solvedDrag = solveWallComponentDrag(candComps, chimBounds, id, rawS, settings.snapEnabled);
      const xf = computeAttachedChimneyTransform(targetWall, solvedDrag.t, defaultD, face);
      if (doesChimneyOverlapWalls(xf.xMm, xf.yMm, defaultW, defaultD, xf.rotationDeg, level.walls, 6)) {
        onConstraintError?.('Cannot place chimney overlapping an adjacent wall.');
        return;
      }
      const cornerPin = getChimneyCornerPin(
        targetWall,
        level.walls,
        solvedDrag.t,
        defaultW,
        defaultD,
        face
      );
      const faceColor = viewedSlot === 'inner' ? targetWall.innerColor : targetWall.outerColor;
      const faceMat = viewedSlot === 'inner' ? targetWall.innerMaterial : targetWall.outerMaterial;

      const newEl: ArchElement = {
        id,
        name: 'Chimney',
        type: 'chimney',
        xMm: xf.xMm,
        yMm: xf.yMm,
        elevationMm: 0,
        widthMm: defaultW,
        depthMm: defaultD,
        heightMm: targetWall.heightMm,
        rotationDeg: xf.rotationDeg,
        color: faceColor,
        accentColor: '#334155',
        material: faceMat,
        connectToCeiling: true,
        attachedWallId: targetWall.id,
        attachedFace: face,
        attachedT: solvedDrag.t,
        resizeAnchor: cornerPin ?? 'center',
        hasBaseboard: targetWall.hasBaseboard,
        baseboardHeightMm: targetWall.baseboardHeightMm,
        baseboardColor: targetWall.baseboardColor,
        hasCrownMolding: targetWall.hasCrownMolding,
        crownHeightMm: targetWall.crownHeightMm,
        crownColor: targetWall.crownColor,
        visible: true,
        locked: false,
      };

      onUpdateLevel(
        (lvl) => ({ ...lvl, archElements: [...lvl.archElements, newEl] }),
        false,
        true,
        'Add Chimney on Wall'
      );
      onSelect([{ kind: 'arch', id }]);
      setPlacingChimney(false);
    },
    [
      isLeftView,
      level.archElements,
      level.openings,
      level.walls,
      onConstraintError,
      onSelect,
      onUpdateLevel,
      screenToWorldElev,
      settings.snapEnabled,
      targetWall,
      viewedPhysicalSide,
      viewedSlot,
      wallMetrics,
    ]
  );

  // Commit inline dimension edits in Cut-Through
  const commitElevDimEdit = useCallback(() => {
    if (!editingDim || !targetWall || !onUpdateLevel) return;
    const cm = Number(editingDim.valueStr);
    if (!editingDim.valueStr.trim() || !Number.isFinite(cm) || cm < 0) {
      setEditingDim((d) => (d ? { ...d, error: 'Enter a valid dimension in cm.' } : null));
      return;
    }
    const nextMm = Math.round(cm * 10);

    if (editingDim.kind === 'wall_length') {
      const res = solveConnectedWallLengthChange(
        targetWall,
        level.walls,
        level.openings,
        level.archElements,
        nextMm
      );
      if (!res.ok) {
        const err = res.error ?? 'Cannot resize wall.';
        setEditingDim((d) => (d ? { ...d, error: err } : null));
        onConstraintError?.(err);
        return;
      }
      const wallUpdMap = new Map(res.wallUpdates.map((u) => [u.id, u]));
      const opUpdMap = new Map(res.openingUpdates.map((u) => [u.id, u.t]));
      const chimUpdMap = new Map(res.chimneyUpdates.map((u) => [u.id, u]));
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          walls: lvl.walls.map((w) => {
            const u = wallUpdMap.get(w.id);
            return u ? { ...w, start: u.start, end: u.end } : w;
          }),
          openings: lvl.openings.map((o) =>
            opUpdMap.has(o.id) ? { ...o, t: opUpdMap.get(o.id)! } : o
          ),
          archElements: lvl.archElements.map((a) => {
            const c = chimUpdMap.get(a.id);
            return c
              ? {
                  ...a,
                  attachedT: c.attachedT,
                  xMm: c.xMm,
                  yMm: c.yMm,
                  rotationDeg: c.rotationDeg,
                }
              : a;
          }),
        }),
        true,
        true,
        'Resize Wall'
      );
      setEditingDim(null);
      return;
    }

    if (editingDim.kind === 'wall_height') {
      if (targetWall.locked) {
        onConstraintError?.('Wall is locked.');
        return;
      }
      if (nextMm < 300 || nextMm > 10000) {
        setEditingDim((d) => (d ? { ...d, error: 'Wall height must be 30–1000 cm.' } : null));
        return;
      }
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          walls: lvl.walls.map((w) => (w.id === targetWall.id ? { ...w, heightMm: nextMm } : w)),
        }),
        false,
        true,
        'Resize Wall Height'
      );
      setEditingDim(null);
      return;
    }

    if (
      (editingDim.kind === 'component_width' ||
        editingDim.kind === 'clearance_left' ||
        editingDim.kind === 'clearance_right') &&
      editingDim.compId &&
      wallChain
    ) {
      const chimEl =
        editingDim.compKind === 'chimney'
          ? level.archElements.find((a) => a.id === editingDim.compId)
          : undefined;
      const res =
        editingDim.kind === 'component_width'
          ? chimEl
            ? solveChimneyResize(
                targetWall,
                level.walls,
                level.openings,
                level.archElements,
                chimEl.id,
                nextMm,
                chimEl.depthMm
              )
            : solveWallComponentResize(
                targetWall,
                wallChain.components,
                wallChain.bounds,
                editingDim.compId,
                nextMm
              )
          : solveWallClearanceEdit(
              targetWall,
              wallChain.components,
              wallChain.bounds,
              editingDim.compId,
              editingDim.kind === 'clearance_left' ? 'left' : 'right',
              nextMm
            );
      if (!res.ok) {
        const err = res.error ?? 'Constraint violation.';
        setEditingDim((d) => (d ? { ...d, error: err } : null));
        onConstraintError?.(err);
        return;
      }
      const updateMap = new Map(res.updates.map((u) => [u.id, u]));
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          openings: lvl.openings.map((o) => {
            const u = updateMap.get(o.id);
            return u && u.kind === 'opening' ? { ...o, t: u.t, widthMm: u.widthMm } : o;
          }),
          archElements: lvl.archElements.map((a) => {
            const u = updateMap.get(a.id);
            if (!u || u.kind !== 'chimney') return a;
            const xf = computeAttachedChimneyTransform(
              targetWall,
              u.t,
              a.depthMm,
              a.attachedFace ?? 'left'
            );
            const pin = getChimneyCornerPin(
              targetWall,
              lvl.walls,
              u.t,
              u.widthMm,
              a.depthMm,
              a.attachedFace ?? 'left'
            );
            return {
              ...a,
              widthMm: u.widthMm,
              attachedT: u.t,
              xMm: xf.xMm,
              yMm: xf.yMm,
              rotationDeg: xf.rotationDeg,
              resizeAnchor: pin ?? a.resizeAnchor,
            };
          }),
        }),
        false,
        true,
        'Edit Dimension'
      );
      setEditingDim(null);
      return;
    }

    // Vertical object dimensions (obj_height, obj_sill, obj_top_gap)
    if (editingDim.compId && editingDim.compKind === 'opening') {
      const op = level.openings.find((o) => o.id === editingDim.compId);
      if (!op || op.locked || targetWall.locked) {
        onConstraintError?.('Component or wall is locked.');
        return;
      }
      let nextH = op.heightMm;
      let nextSill = op.sillHeightMm;
      if (editingDim.kind === 'obj_height') {
        if (nextMm < 200 || op.sillHeightMm + nextMm > targetWall.heightMm) {
          const maxCm = Math.round((targetWall.heightMm - op.sillHeightMm) / 10);
          setEditingDim((d) =>
            d ? { ...d, error: `Height must be 20–${maxCm} cm (fits below ceiling).` } : null
          );
          return;
        }
        nextH = nextMm;
      } else if (editingDim.kind === 'obj_sill') {
        if (nextMm < 0 || nextMm + op.heightMm > targetWall.heightMm) {
          const maxCm = Math.round((targetWall.heightMm - op.heightMm) / 10);
          setEditingDim((d) =>
            d ? { ...d, error: `Sill height must be 0–${maxCm} cm.` } : null
          );
          return;
        }
        nextSill = nextMm;
      } else if (editingDim.kind === 'obj_top_gap') {
        const nextTop = targetWall.heightMm - nextMm;
        const derivedSill = nextTop - op.heightMm;
        if (nextMm < 0 || derivedSill < 0) {
          setEditingDim((d) =>
            d ? { ...d, error: 'Top gap exceeds remaining wall height above opening.' } : null
          );
          return;
        }
        nextSill = derivedSill;
      }
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          openings: lvl.openings.map((o) =>
            o.id === op.id ? { ...o, heightMm: nextH, sillHeightMm: nextSill } : o
          ),
        }),
        false,
        true,
        'Edit Vertical Dimension'
      );
      setEditingDim(null);
      return;
    }

    if (editingDim.compId && editingDim.compKind === 'chimney') {
      const el = level.archElements.find((a) => a.id === editingDim.compId);
      if (!el || el.locked || targetWall.locked) {
        onConstraintError?.('Chimney or wall is locked.');
        return;
      }
      let nextH = el.heightMm;
      let nextElev = el.elevationMm;
      let connectToCeiling = el.connectToCeiling;
      if (editingDim.kind === 'obj_height') {
        if (nextMm < 100 || el.elevationMm + nextMm > targetWall.heightMm) {
          setEditingDim((d) =>
            d ? { ...d, error: 'Height cannot exceed ceiling height.' } : null
          );
          return;
        }
        nextH = nextMm;
        connectToCeiling = nextMm >= targetWall.heightMm - el.elevationMm;
      } else if (editingDim.kind === 'obj_sill') {
        if (nextMm < 0 || nextMm + el.heightMm > targetWall.heightMm) {
          setEditingDim((d) => (d ? { ...d, error: 'Elevation exceeds wall height.' } : null));
          return;
        }
        nextElev = nextMm;
      } else if (editingDim.kind === 'obj_top_gap') {
        const nextTop = targetWall.heightMm - nextMm;
        if (nextMm < 0 || nextTop - el.elevationMm < 100) {
          setEditingDim((d) => (d ? { ...d, error: 'Invalid top clearance.' } : null));
          return;
        }
        nextH = nextTop - el.elevationMm;
        connectToCeiling = nextMm === 0;
      }
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          archElements: lvl.archElements.map((a) =>
            a.id === el.id
              ? { ...a, heightMm: nextH, elevationMm: nextElev, connectToCeiling }
              : a
          ),
        }),
        false,
        true,
        'Edit Chimney Vertical Dimension'
      );
      setEditingDim(null);
    }
  }, [editingDim, level.archElements, level.openings, onConstraintError, onUpdateLevel, targetWall, wallChain]);

  // Empty or no-wall-selected state → "Select wall" interactive schematic with blue overlay & center circles
  const visibleWallsList = level.walls.filter((w) => w.visible);
  if (!targetWall || !wallMetrics) {
    return (
      <div
        ref={containerRef}
        data-testid="wall-cutthrough-select-wall"
        className={`w-full h-full flex flex-col select-none overflow-hidden ${
          isBw ? 'bg-white text-slate-900' : 'bg-slate-50 dark:bg-slate-950'
        }`}
      >
        <div className="shrink-0 px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MousePointerClick className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Select wall
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Click any highlighted wall or center handle below to open its Wall View elevation
            </span>
          </div>
          <span className="text-[11px] font-mono-nums text-slate-400">
            {visibleWallsList.length} {visibleWallsList.length === 1 ? 'wall' : 'walls'}
          </span>
        </div>

        {visibleWallsList.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500">
            <Layers className="w-10 h-10 mb-3 opacity-35" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Select wall
            </h3>
            <p className="text-xs max-w-sm mt-1">
              Draw a wall in 2D Plan first, then select any wall to inspect its architectural Wall View.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <WallMiniSelectorMap
              walls={visibleWallsList}
              activeWallId={null}
              onSelectWall={(wallId) => onSelect([{ kind: 'wall', id: wallId }])}
            />
          </div>
        )}
      </div>
    );
  }

  const faceColor = viewedSlot === 'inner' ? targetWall.innerColor : targetWall.outerColor;
  const faceMat = viewedSlot === 'inner' ? targetWall.innerMaterial : targetWall.outerMaterial;
  const wallSelected = selection.some((s) => s.kind === 'wall' && s.id === targetWall.id);

  const cxWorld = wallMetrics.lenMm / 2;
  const cyWorld = -wallMetrics.heightMm / 2;
  const worldToScreen = `translate(${size.width / 2 + panOffsetPx.x}, ${
    size.height / 2 + panOffsetPx.y
  }) scale(${pxPerMm}) translate(${-cxWorld}, ${-cyWorld})`;

  const cutThicknessLeft = wallMetrics.hasStartCap ? 180 : 120;
  const cutThicknessRight = wallMetrics.hasEndCap ? 180 : 120;
  const leftCapW = isLeftView ? cutThicknessLeft : cutThicknessRight;
  const rightCapW = isLeftView ? cutThicknessRight : cutThicknessLeft;

  const isSelected = (kind: SelectionTarget['kind'], id: string) =>
    selection.some((s) => s.kind === kind && s.id === id);

  // Dimension appearance helper aligned with 2D plan
  const renderElevDim = (opts: {
    dimKey: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    ext1x?: number;
    ext1y?: number;
    ext2x?: number;
    ext2y?: number;
    valueMm: number;
    locked: boolean;
    vertical?: boolean;
    hoverId?: string;
    onEdit?: () => void;
  }) => {
    const span = Math.hypot(opts.x2 - opts.x1, opts.y2 - opts.y1);
    if (span < 1) return null;
    const midX = (opts.x1 + opts.x2) / 2;
    const midY = (opts.y1 + opts.y2) / 2;
    const ux = (opts.x2 - opts.x1) / span;
    const uy = (opts.y2 - opts.y1) / span;
    const nx = -uy;
    const ny = ux;
    const isHov = hoveredDimKey === opts.dimKey || (opts.hoverId && hoveredCompId === opts.hoverId);
    const lineColor = isBw
      ? opts.locked
        ? '#64748B'
        : isHov
          ? '#0F172A'
          : '#334155'
      : opts.locked
        ? '#94A3B8'
        : isHov
          ? settings.darkMode
            ? '#38BDF8'
            : '#1D4ED8'
          : settings.darkMode
            ? '#CBD5E1'
            : '#0EA5E9';
    const textColor = isBw
      ? opts.locked
        ? '#475569'
        : '#0F172A'
      : opts.locked
        ? '#94A3B8'
        : isHov
          ? settings.darkMode
            ? '#7DD3FC'
            : '#1D4ED8'
          : settings.darkMode
            ? '#F1F5F9'
            : '#0369A1';
    const bgColor = isBw ? '#FFFFFF' : settings.darkMode ? '#020617' : '#F1F5F9';
    const sw = (isHov ? 1.55 : 1.05) / pxPerMm;
    const tickHalf = 4.5 / pxPerMm;
    const arrowLen = Math.min(span * 0.22, 6 / pxPerMm);
    const arrowHalfW = 2.2 / pxPerMm;
    const labelText = formatSmartMetric(opts.valueMm);
    const fontSizeWorld = Math.max(75, Math.min(130, 11 / pxPerMm));
    const maskW = Math.max(fontSizeWorld * 2.1, labelText.length * fontSizeWorld * 0.64 + 50);
    const maskH = fontSizeWorld * 1.25;

    return (
      <g
        key={opts.dimKey}
        className={opts.onEdit ? 'cursor-pointer' : 'pointer-events-none'}
        onPointerEnter={() => {
          setHoveredDimKey(opts.dimKey);
          if (opts.hoverId) setHoveredCompId(opts.hoverId);
        }}
        onPointerLeave={() => {
          setHoveredDimKey((k) => (k === opts.dimKey ? null : k));
          if (opts.hoverId) setHoveredCompId((c) => (c === opts.hoverId ? null : c));
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || !opts.onEdit) return;
          e.stopPropagation();
          opts.onEdit();
        }}
      >
        {opts.ext1x !== undefined && opts.ext1y !== undefined && (
          <line
            x1={opts.ext1x}
            y1={opts.ext1y}
            x2={opts.x1}
            y2={opts.y1}
            stroke={lineColor}
            strokeOpacity={0.45}
            strokeWidth={0.7 / pxPerMm}
            strokeDasharray={`${4 / pxPerMm} ${3 / pxPerMm}`}
          />
        )}
        {opts.ext2x !== undefined && opts.ext2y !== undefined && (
          <line
            x1={opts.ext2x}
            y1={opts.ext2y}
            x2={opts.x2}
            y2={opts.y2}
            stroke={lineColor}
            strokeOpacity={0.45}
            strokeWidth={0.7 / pxPerMm}
            strokeDasharray={`${4 / pxPerMm} ${3 / pxPerMm}`}
          />
        )}
        <line
          x1={opts.x1}
          y1={opts.y1}
          x2={opts.x2}
          y2={opts.y2}
          stroke={lineColor}
          strokeWidth={sw}
          strokeDasharray={opts.locked ? `${4 / pxPerMm} ${3 / pxPerMm}` : undefined}
        />
        <line
          x1={opts.x1 - nx * tickHalf}
          y1={opts.y1 - ny * tickHalf}
          x2={opts.x1 + nx * tickHalf}
          y2={opts.y1 + ny * tickHalf}
          stroke={lineColor}
          strokeWidth={sw * 1.15}
        />
        <line
          x1={opts.x2 - nx * tickHalf}
          y1={opts.y2 - ny * tickHalf}
          x2={opts.x2 + nx * tickHalf}
          y2={opts.y2 + ny * tickHalf}
          stroke={lineColor}
          strokeWidth={sw * 1.15}
        />
        {arrowLen > 2 / pxPerMm && (
          <>
            <polygon
              points={`${opts.x1},${opts.y1} ${opts.x1 + ux * arrowLen + nx * arrowHalfW},${opts.y1 + uy * arrowLen + ny * arrowHalfW} ${opts.x1 + ux * arrowLen - nx * arrowHalfW},${opts.y1 + uy * arrowLen - ny * arrowHalfW}`}
              fill={lineColor}
            />
            <polygon
              points={`${opts.x2},${opts.y2} ${opts.x2 - ux * arrowLen + nx * arrowHalfW},${opts.y2 - uy * arrowLen + ny * arrowHalfW} ${opts.x2 - ux * arrowLen - nx * arrowHalfW},${opts.y2 - uy * arrowLen - ny * arrowHalfW}`}
              fill={lineColor}
            />
          </>
        )}
        <g transform={`translate(${midX}, ${midY}) rotate(${opts.vertical ? -90 : 0})`}>
          <rect
            x={-maskW / 2}
            y={-maskH / 2}
            width={maskW}
            height={maskH}
            rx={maskH * 0.25}
            fill={bgColor}
            fillOpacity={0.95}
            stroke={isHov ? lineColor : 'none'}
            strokeWidth={0.8 / pxPerMm}
          />
          <text
            x={0}
            y={fontSizeWorld * 0.35}
            textAnchor="middle"
            fontSize={fontSizeWorld}
            fontFamily="JetBrains Mono, monospace"
            fontWeight={isHov ? 700 : 600}
            fill={textColor}
          >
            {opts.locked ? `[LOCKED] ${labelText}` : labelText}
          </text>
        </g>
        <line
          x1={opts.x1}
          y1={opts.y1}
          x2={opts.x2}
          y2={opts.y2}
          stroke="transparent"
          strokeWidth={Math.max(160, 18 / pxPerMm)}
        />
      </g>
    );
  };

  const openElevEditor = (
    opts: Omit<NonNullable<typeof editingDim>, 'screenX' | 'screenY' | 'error'> & {
      worldX: number;
      worldY: number;
    }
  ) => {
    const scr = worldToScreenElev(opts.worldX, opts.worldY);
    setEditingDim({
      key: opts.key,
      kind: opts.kind,
      wallId: opts.wallId,
      compId: opts.compId,
      compKind: opts.compKind,
      label: opts.label,
      valueStr: opts.valueStr,
      screenX: scr.x,
      screenY: scr.y,
      error: null,
    });
  };

  return (
    <div
      ref={containerRef}
      data-testid="wall-cutthrough-viewer"
      className={`relative w-full h-full overflow-hidden flex flex-col select-none ${
        isBw ? 'bg-white text-slate-900' : 'bg-slate-100 dark:bg-slate-950'
      }`}
    >
      {/* Wall View Top Control Bar */}
      <div className="shrink-0 px-3 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs z-10">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            Wall View
          </span>

          <select
            value={targetWall.id}
            onChange={(e) => onSelect([{ kind: 'wall', id: e.target.value }])}
            aria-label="Select wall to inspect"
            className="px-2 py-1 text-xs font-mono-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md cursor-pointer"
          >
            {visibleWallsList.map((w, idx) => (
              <option key={w.id} value={w.id}>
                Wall {idx + 1} · {formatSmartMetric(getWallArcLength(w))} × {formatSmartMetric(w.heightMm)}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => onSelect([])}
            title="Switch to interactive wall selector"
            className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer font-medium"
          >
            <MousePointerClick className="w-3.5 h-3.5 text-blue-600" />
            <span>Change Wall</span>
          </button>

          <div
            role="group"
            aria-label="Wall face view selector"
            className="flex items-center border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden"
          >
            <button
              type="button"
              data-testid="wallview-face-primary-btn"
              onClick={() => setFaceSide('inner')}
              title={wallFaces?.primary.subtitle ?? 'Primary Wall Face'}
              className={`px-2 py-1 flex items-center gap-1 cursor-pointer font-medium ${
                faceSide === 'inner'
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <span>{wallFaces?.primary.label ?? 'Inner'}</span>
            </button>
            <button
              type="button"
              data-testid="wallview-face-secondary-btn"
              onClick={() => setFaceSide('outer')}
              title={wallFaces?.secondary.subtitle ?? 'Opposite Wall Face'}
              className={`px-2 py-1 border-l border-slate-200 dark:border-slate-700 flex items-center gap-1 cursor-pointer font-medium ${
                faceSide === 'outer'
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <span>{wallFaces?.secondary.label ?? 'Outer'}</span>
            </button>
          </div>
          {wallMetrics.oppositeSideCount > 0 && (
            <span
              data-testid="wallview-opposite-count"
              title="Items located on the opposite side of this wall are occluded"
              className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-mono-nums"
            >
              {wallMetrics.oppositeSideCount} opposite side hidden
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {onUpdateLevel && (
            <button
              type="button"
              onClick={() => setPlacingChimney((v) => !v)}
              title="Click on the exposed wall face to attach a Chimney / Block flush"
              className={`px-2 py-1 rounded-md border flex items-center gap-1 cursor-pointer font-medium ${
                placingChimney
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{placingChimney ? 'Click Wall to Place' : 'Add Chimney'}</span>
            </button>
          )}
          {/* Visibility Selector: Wall Only vs All Furniture in Front + Conditional Depth Effect Toggle */}
          <div
            role="group"
            aria-label="Wall view context object visibility"
            className="flex items-center border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden"
          >
            <button
              type="button"
              data-testid="cutthrough-wall-only-btn"
              onClick={() => setShowObjects(false)}
              title="Render only the selected wall and its wall-mounted components"
              className={`px-2 py-1 flex items-center gap-1 cursor-pointer font-medium ${
                !showObjects
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Wall Only</span>
            </button>
            <button
              type="button"
              data-testid="cutthrough-context-on-btn"
              onClick={() => setShowObjects(true)}
              title="Show furniture within distance (up to 1.5 m) of the wall, rendering only faces visible from this angle"
              className={`px-2 py-1 border-l border-slate-200 dark:border-slate-700 flex items-center gap-1 cursor-pointer font-medium ${
                showObjects
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>+ Furniture</span>
            </button>
          </div>
          {showObjects && (
            <>
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50"
                title="Maximum distance in front of wall (up to 1.5 m)"
              >
                <input
                  type="range"
                  min={100}
                  max={1500}
                  step={50}
                  value={maxContextRangeMm}
                  onChange={(e) => setMaxContextRangeMm(Math.min(1500, Math.max(100, Number(e.target.value))))}
                  aria-label="Wall view furniture depth range"
                  className="w-16 accent-blue-600 cursor-pointer"
                />
                <span className="text-[11px] font-mono-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                  ≤ {(maxContextRangeMm / 1000).toFixed(2).replace(/0$/, '')} m
                </span>
              </div>
              <button
                type="button"
                data-testid="cutthrough-depth-effect-btn"
                onClick={() => setShowDepthEffect((v) => !v)}
                title="Toggle distance-based greying, darkening, and progressive blur"
                className={`px-2 py-1 rounded-md border flex items-center gap-1 cursor-pointer font-medium ${
                  showDepthEffect
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Depth Effect</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowDimensions((d) => !d)}
            className={`px-2 py-1 rounded-md border flex items-center gap-1 cursor-pointer ${
              showDimensions
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
          >
            <Ruler className="w-3.5 h-3.5" />
            <span>Dims</span>
          </button>
          {onToggleBlackAndWhite && (
            <button
              type="button"
              data-testid="wallview-bw-toggle"
              onClick={onToggleBlackAndWhite}
              title="Toggle print-ready Black & White architectural sheet mode"
              className={`px-2 py-1 rounded-md border flex items-center gap-1 cursor-pointer font-medium ${
                isBw
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Contrast className="w-3.5 h-3.5" />
              <span>B&amp;W</span>
            </button>
          )}

          <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => setZoomScale((z) => Math.max(0.35, +(z * 0.85).toFixed(2)))}
              aria-label="Zoom out elevation"
              className="px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoomScale(1);
                setPanOffsetPx({ x: 0, y: 0 });
              }}
              aria-label="Fit elevation"
              className="px-1.5 py-1 border-x border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomScale((z) => Math.min(4, +(z * 1.15).toFixed(2)))}
              aria-label="Zoom in elevation"
              className="px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Elevation SVG Stage */}
      <svg
        ref={svgRef}
        width={size.width}
        height={Math.max(200, size.height - 44)}
        className={`flex-1 block w-full ${
          placingChimney
            ? 'cursor-crosshair'
            : elevDrag?.kind === 'comp_edge'
              ? 'cursor-ew-resize'
              : elevDrag?.kind === 'comp_v'
                ? 'cursor-ns-resize'
                : elevDrag?.kind === 'comp_move'
                  ? 'cursor-move'
                  : 'cursor-grab active:cursor-grabbing'
        }`}
        onWheel={(e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.12 : 0.89;
          setZoomScale((z) => Math.max(0.35, Math.min(4.5, +(z * factor).toFixed(3))));
        }}
        onPointerDown={(e) => {
          if (placingChimney && e.button === 0) {
            e.stopPropagation();
            handlePlaceChimneyOnWall(e.clientX, e.clientY);
            return;
          }
          if (e.button === 0 || e.button === 1) {
            setElevDrag({
              kind: 'pan',
              startClientX: e.clientX,
              startClientY: e.clientY,
              origPanX: panOffsetPx.x,
              origPanY: panOffsetPx.y,
            });
          }
        }}
        onPointerMove={(e) => {
          if (!elevDrag) return;
          if (elevDrag.kind === 'pan') {
            setPanOffsetPx({
              x: elevDrag.origPanX + (e.clientX - elevDrag.startClientX),
              y: elevDrag.origPanY + (e.clientY - elevDrag.startClientY),
            });
            return;
          }

          if (!onUpdateLevel) return;
          const wPt = screenToWorldElev(e.clientX, e.clientY);

          if (elevDrag.kind === 'comp_move') {
            if (Math.hypot(e.clientX - elevDrag.startClientX, e.clientY - elevDrag.startClientY) < 3) {
              return;
            }
            const deltaX = wPt.x - screenToWorldElev(elevDrag.startClientX, elevDrag.startClientY).x;
            const deltaS = isLeftView ? deltaX : -deltaX;
            const proposedCenterS = elevDrag.origCenterS + deltaS;
            const chimEl =
              elevDrag.compKind === 'chimney'
                ? level.archElements.find((a) => a.id === elevDrag.compId)
                : undefined;
            const bounds = chimEl
              ? (() => {
                  const fb = computeChimneyFaceBounds(
                    targetWall,
                    level.walls,
                    chimEl.attachedFace ?? 'left',
                    chimEl.depthMm,
                    proposedCenterS
                  );
                  return {
                    lengthMm: fb.lengthMm,
                    innerStartS: fb.minS,
                    innerEndS: fb.maxS,
                    leftStartS: fb.minS,
                    leftEndS: fb.maxS,
                    rightStartS: fb.minS,
                    rightEndS: fb.maxS,
                  };
                })()
              : computeWallInnerBounds(targetWall, level.walls);
            const comps = getWallMountedComponents(targetWall, level.openings, level.archElements);
            const solved = solveWallComponentDrag(
              comps,
              bounds,
              elevDrag.compId,
              proposedCenterS,
              settings.snapEnabled
            );

            if (chimEl) {
              const checkXf = computeAttachedChimneyTransform(
                targetWall,
                solved.t,
                chimEl.depthMm,
                chimEl.attachedFace ?? 'left'
              );
              if (
                doesChimneyOverlapWalls(
                  checkXf.xMm,
                  checkXf.yMm,
                  chimEl.widthMm,
                  chimEl.depthMm,
                  checkXf.rotationDeg,
                  level.walls,
                  6
                )
              ) {
                return;
              }
            }

            // Vertical drag for windows/arches/chimneys (unless door on floor unless Shift held)
            const deltaY = -(wPt.y - screenToWorldElev(elevDrag.startClientX, elevDrag.startClientY).y);
            const step = settings.snapEnabled ? 50 : 10;

            elevDragMutatedRef.current = true;
            setLiveDragBadge(
              `Pos: ${formatSmartMetric(Math.max(0, solved.centerS - (comps.find((c) => c.id === elevDrag.compId)?.widthMm ?? 0) / 2))}`
            );

            onUpdateLevel(
              (lvl) => {
                if (elevDrag.compKind === 'opening') {
                  return {
                    ...lvl,
                    openings: lvl.openings.map((o) => {
                      if (o.id !== elevDrag.compId || o.locked) return o;
                      let nextSill = o.sillHeightMm;
                      if (o.category !== 'door' && Math.abs(deltaY) > 15) {
                        const rawSill = Math.round((elevDrag.origSillMm + deltaY) / step) * step;
                        nextSill = Math.max(0, Math.min(targetWall.heightMm - o.heightMm, rawSill));
                      }
                      return { ...o, t: solved.t, sillHeightMm: nextSill };
                    }),
                  };
                }
                const hw = lvl.walls.find((w) => w.id === targetWall.id);
                return {
                  ...lvl,
                  archElements: lvl.archElements.map((a) => {
                    if (a.id !== elevDrag.compId || a.locked || !hw) return a;
                    const xf = computeAttachedChimneyTransform(
                      hw,
                      solved.t,
                      a.depthMm,
                      a.attachedFace ?? 'left'
                    );
                    const pin = getChimneyCornerPin(
                      hw,
                      lvl.walls,
                      solved.t,
                      a.widthMm,
                      a.depthMm,
                      a.attachedFace ?? 'left'
                    );
                    return {
                      ...a,
                      attachedT: solved.t,
                      xMm: xf.xMm,
                      yMm: xf.yMm,
                      rotationDeg: xf.rotationDeg,
                      resizeAnchor: pin ?? a.resizeAnchor,
                    };
                  }),
                };
              },
              false,
              false
            );
            return;
          }

          if (elevDrag.kind === 'comp_edge' && wallChain) {
            let sWorld = isLeftView ? wPt.x : wallMetrics.lenMm - wPt.x;
            const target = wallChain.components.find((c) => c.id === elevDrag.compId);
            if (!target || target.locked || targetWall.locked) return;

            if (settings.snapEnabled) {
              const snapPts = [
                wallChain.bounds.innerStartS,
                wallChain.bounds.innerEndS,
                ...wallChain.components.filter((c) => c.id !== target.id).flatMap((c) => [c.leftS, c.rightS]),
              ];
              const hit = snapPts.find((p) => Math.abs(p - sWorld) < 55);
              if (hit !== undefined) {
                sWorld = hit;
              } else {
                const step = Math.max(10, Math.min(50, settings.gridSizeMm));
                sWorld = Math.round(sWorld / step) * step;
              }
            }

            // Map visual left/right edge to architectural S edge based on viewed wall face
            const archDragSide: 'left' | 'right' = isLeftView
              ? elevDrag.visualEdge
              : elevDrag.visualEdge === 'left'
                ? 'right'
                : 'left';
            const rawWidthMm =
              archDragSide === 'left'
                ? Math.round(target.rightS - sWorld)
                : Math.round(sWorld - target.leftS);
            const anchor = archDragSide === 'left' ? 'right' : 'left';
            const minW = elevDrag.compKind === 'chimney' ? 50 : 150;

            const chimEl =
              elevDrag.compKind === 'chimney'
                ? level.archElements.find((a) => a.id === elevDrag.compId)
                : undefined;

            const solved = chimEl
              ? solveChimneyResize(
                  targetWall,
                  level.walls,
                  level.openings,
                  level.archElements,
                  elevDrag.compId,
                  Math.max(minW, rawWidthMm),
                  chimEl.depthMm,
                  anchor
                )
              : solveWallComponentResize(
                  targetWall,
                  wallChain.components,
                  wallChain.bounds,
                  elevDrag.compId,
                  Math.max(minW, rawWidthMm),
                  anchor
                );
            if (!solved.ok) {
              setLiveDragBadge(solved.error ?? 'Constraint limit');
              onConstraintError?.(solved.error ?? 'Constraint limit');
              return;
            }
            const nextTgt = solved.updates.find((u) => u.id === elevDrag.compId);
            setLiveDragBadge(`Width: ${formatSmartMetric(nextTgt?.widthMm ?? target.widthMm)}`);
            elevDragMutatedRef.current = true;
            const updateMap = new Map(solved.updates.map((u) => [u.id, u]));
            onUpdateLevel(
              (lvl) => ({
                ...lvl,
                openings: lvl.openings.map((o) => {
                  const u = updateMap.get(o.id);
                  return u && u.kind === 'opening' ? { ...o, t: u.t, widthMm: u.widthMm } : o;
                }),
                archElements: lvl.archElements.map((a) => {
                  const u = updateMap.get(a.id);
                  if (!u || u.kind !== 'chimney') return a;
                  const xf = computeAttachedChimneyTransform(
                    targetWall,
                    u.t,
                    a.depthMm,
                    a.attachedFace ?? 'left'
                  );
                  const pin = getChimneyCornerPin(
                    targetWall,
                    lvl.walls,
                    u.t,
                    u.widthMm,
                    a.depthMm,
                    a.attachedFace ?? 'left'
                  );
                  return {
                    ...a,
                    widthMm: u.widthMm,
                    attachedT: u.t,
                    xMm: xf.xMm,
                    yMm: xf.yMm,
                    rotationDeg: xf.rotationDeg,
                    resizeAnchor: pin ?? a.resizeAnchor,
                  };
                }),
              }),
              false,
              false
            );
            return;
          }

          if (elevDrag.kind === 'comp_v') {
            const rawHeightAboveFloor = -wPt.y;
            const step = settings.snapEnabled ? 50 : 10;
            const snappedY = Math.round(rawHeightAboveFloor / step) * step;
            const origTop = elevDrag.origSillMm + elevDrag.origHeightMm;

            let nextSill = elevDrag.origSillMm;
            let nextH = elevDrag.origHeightMm;
            if (elevDrag.handle === 'top') {
              const clampedTop = Math.max(elevDrag.origSillMm + 200, Math.min(targetWall.heightMm, snappedY));
              nextH = clampedTop - elevDrag.origSillMm;
            } else {
              const clampedSill = Math.max(0, Math.min(origTop - 200, snappedY));
              nextSill = clampedSill;
              nextH = origTop - clampedSill;
            }
            setLiveDragBadge(
              `H: ${formatSmartMetric(nextH)} · Sill: ${formatSmartMetric(nextSill)}`
            );
            elevDragMutatedRef.current = true;
            onUpdateLevel(
              (lvl) => {
                if (elevDrag.compKind === 'opening') {
                  return {
                    ...lvl,
                    openings: lvl.openings.map((o) =>
                      o.id === elevDrag.compId && !o.locked
                        ? { ...o, heightMm: nextH, sillHeightMm: nextSill }
                        : o
                    ),
                  };
                }
                return {
                  ...lvl,
                  archElements: lvl.archElements.map((a) =>
                    a.id === elevDrag.compId && !a.locked
                      ? {
                          ...a,
                          heightMm: nextH,
                          elevationMm: nextSill,
                          connectToCeiling: nextSill + nextH >= targetWall.heightMm - 5,
                        }
                      : a
                  ),
                };
              },
              false,
              false
            );
          }
        }}
        onPointerUp={() => {
          if (elevDrag && 'label' in elevDrag && elevDragMutatedRef.current) {
            onCommitDrag?.(elevDrag.label);
          }
          elevDragMutatedRef.current = false;
          setLiveDragBadge(null);
          setElevDrag(null);
        }}
        onPointerCancel={() => {
          if (elevDrag && 'label' in elevDrag && elevDragMutatedRef.current) {
            onCancelDrag?.();
          }
          elevDragMutatedRef.current = false;
          setLiveDragBadge(null);
          setElevDrag(null);
        }}
      >
        <defs>
          <pattern id="cut_hatch" width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="80" height="80" fill={isBw ? '#F1F5F9' : settings.darkMode ? '#1E293B' : '#E2E8F0'} />
            <line x1="0" y1="0" x2="0" y2="80" stroke={isBw ? '#64748B' : settings.darkMode ? '#475569' : '#94A3B8'} strokeWidth="14" />
          </pattern>
          <pattern id="elev_tile" width="300" height="300" patternUnits="userSpaceOnUse">
            <path d="M300 0 L0 0 0 300" stroke="rgba(15,23,42,0.16)" strokeWidth="6" fill="none" />
          </pattern>
          <pattern id="elev_brick" width="240" height="120" patternUnits="userSpaceOnUse">
            <path d="M0 0 H240 M0 60 H240 M0 0 V60 M120 0 V60 M60 60 V120 M180 60 V120" stroke="rgba(15,23,42,0.20)" strokeWidth="5" fill="none" />
          </pattern>
          <pattern id="elev_wood" width="220" height="480" patternUnits="userSpaceOnUse">
            <path d="M0 0 V480 M110 0 V480 M0 240 H110 M110 120 H220" stroke="rgba(15,23,42,0.16)" strokeWidth="5" fill="none" />
          </pattern>
          <pattern id="elev_panel" width="160" height="300" patternUnits="userSpaceOnUse">
            <path d="M0 0 V300 M80 0 V300" stroke="rgba(15,23,42,0.18)" strokeWidth="6" fill="none" />
          </pattern>
          <pattern id="elev_stone" width="320" height="320" patternUnits="userSpaceOnUse">
            <path d="M0 80 Q90 36 190 100 T320 75 M0 220 Q110 185 215 245 T320 215" stroke="rgba(15,23,42,0.12)" strokeWidth="4" fill="none" />
          </pattern>
          <clipPath id="cutthrough_wall_clip">
            <rect x={0} y={-wallMetrics.heightMm} width={wallMetrics.lenMm} height={wallMetrics.heightMm} />
          </clipPath>
          {[0, 1, 2, 3, 4].map((bucket) => {
            const blurPx = isBw ? 0 : [0.35, 0.85, 1.35, 1.85, 2.45][bucket];
            const blurMm = Math.max(0.1, blurPx / Math.max(0.02, pxPerMm));
            const slope = isBw
              ? [1.0, 0.94, 0.88, 0.82, 0.76][bucket]
              : settings.darkMode
                ? [0.78, 0.65, 0.53, 0.41, 0.29][bucket]
                : [0.88, 0.75, 0.62, 0.49, 0.36][bucket];
            const sat = isBw ? 0 : [0.16, 0.1, 0.06, 0.02, 0][bucket];
            return (
              <filter
                key={bucket}
                id={`ct_depth_${bucket}`}
                filterUnits="userSpaceOnUse"
                x={-600}
                y={-wallMetrics.heightMm - 600}
                width={wallMetrics.lenMm + 1200}
                height={wallMetrics.heightMm + 1200}
              >
                <feColorMatrix type="saturate" values={String(sat)} result="gray" />
                <feComponentTransfer in="gray" result="dark">
                  <feFuncR type="linear" slope={slope} />
                  <feFuncG type="linear" slope={slope} />
                  <feFuncB type="linear" slope={slope} />
                </feComponentTransfer>
                {blurPx > 0 && <feGaussianBlur in="dark" stdDeviation={blurMm} />}
              </filter>
            );
          })}
        </defs>

        <g transform={worldToScreen}>
          {/* 1. Wall Elevation Face */}
          <rect
            x={0}
            y={-wallMetrics.heightMm}
            width={wallMetrics.lenMm}
            height={wallMetrics.heightMm}
            fill={isBw ? '#FFFFFF' : faceColor === '#FFFFFF' && settings.darkMode ? '#1E293B' : getEffectiveMaterialHex(faceMat, faceColor)}
            stroke={wallSelected ? '#2563EB' : isBw ? '#0F172A' : settings.darkMode ? '#64748B' : '#0F172A'}
            strokeWidth={(wallSelected ? 2.5 : 1.5) / pxPerMm}
            onPointerDown={(e) => {
              if (placingChimney) return;
              e.stopPropagation();
              onSelect([{ kind: 'wall', id: targetWall.id }]);
            }}
            className={placingChimney ? 'cursor-crosshair' : 'cursor-pointer'}
          />

          {/* Wall Material Surface Pattern */}
          {!isBw &&
            (faceMat === 'brick' ||
              faceMat === 'tile' ||
              faceMat === 'hex_tile' ||
              faceMat === 'checker' ||
              faceMat === 'wood' ||
              faceMat === 'oak' ||
              faceMat === 'walnut' ||
              faceMat === 'teak' ||
              faceMat === 'smoked_oak' ||
              faceMat === 'paneling' ||
              faceMat === 'parquet' ||
              faceMat === 'herringbone' ||
              faceMat === 'marble' ||
              faceMat === 'calacatta_gold' ||
              faceMat === 'nero_marble' ||
              faceMat === 'travertine' ||
              faceMat === 'slate' ||
              faceMat === 'terrazzo') && (
              <rect
                x={0}
                y={-wallMetrics.heightMm}
                width={wallMetrics.lenMm}
                height={wallMetrics.heightMm}
                fill={
                  faceMat === 'brick'
                    ? 'url(#elev_brick)'
                    : faceMat === 'tile' || faceMat === 'hex_tile' || faceMat === 'checker'
                      ? 'url(#elev_tile)'
                      : faceMat === 'paneling'
                        ? 'url(#elev_panel)'
                        : faceMat === 'marble' ||
                            faceMat === 'calacatta_gold' ||
                            faceMat === 'nero_marble' ||
                            faceMat === 'travertine' ||
                            faceMat === 'slate' ||
                            faceMat === 'terrazzo'
                          ? 'url(#elev_stone)'
                          : 'url(#elev_wood)'
                }
                className="pointer-events-none"
              />
            )}

          {/* 2. Architectural Section Slabs */}
          <rect
            x={-leftCapW}
            y={-wallMetrics.heightMm - 180}
            width={wallMetrics.lenMm + leftCapW + rightCapW}
            height={180}
            fill="url(#cut_hatch)"
            stroke={isBw ? '#0F172A' : settings.darkMode ? '#64748B' : '#334155'}
            strokeWidth={1.6 / pxPerMm}
            className="pointer-events-none"
          />
          <rect
            x={-leftCapW}
            y={0}
            width={wallMetrics.lenMm + leftCapW + rightCapW}
            height={180}
            fill="url(#cut_hatch)"
            stroke={isBw ? '#0F172A' : settings.darkMode ? '#64748B' : '#334155'}
            strokeWidth={1.6 / pxPerMm}
            className="pointer-events-none"
          />
          <rect
            x={-leftCapW}
            y={-wallMetrics.heightMm}
            width={leftCapW}
            height={wallMetrics.heightMm}
            fill="url(#cut_hatch)"
            stroke={isBw ? '#0F172A' : settings.darkMode ? '#64748B' : '#334155'}
            strokeWidth={1.6 / pxPerMm}
            className="pointer-events-none"
          />
          <rect
            x={wallMetrics.lenMm}
            y={-wallMetrics.heightMm}
            width={rightCapW}
            height={wallMetrics.heightMm}
            fill="url(#cut_hatch)"
            stroke={isBw ? '#0F172A' : settings.darkMode ? '#64748B' : '#334155'}
            strokeWidth={1.6 / pxPerMm}
            className="pointer-events-none"
          />

          {/* 3. Baseboard & Crown Molding */}
          {targetWall.hasBaseboard && targetWall.baseboardHeightMm > 0 && (
            <g className="pointer-events-none">
              {baseboardSpans.map(([x1, x2], i) => (
                <rect
                  key={`bb_${i}`}
                  x={x1}
                  y={-targetWall.baseboardHeightMm}
                  width={x2 - x1}
                  height={targetWall.baseboardHeightMm}
                  fill={isBw ? '#FFFFFF' : targetWall.baseboardColor || '#F8FAFC'}
                  stroke={isBw ? '#0F172A' : '#94A3B8'}
                  strokeWidth={0.9 / pxPerMm}
                />
              ))}
            </g>
          )}
          {targetWall.hasCrownMolding && targetWall.crownHeightMm > 0 && (
            <rect
              x={0}
              y={-wallMetrics.heightMm}
              width={wallMetrics.lenMm}
              height={targetWall.crownHeightMm}
              fill={isBw ? '#FFFFFF' : targetWall.crownColor || '#F8FAFC'}
              stroke={isBw ? '#0F172A' : '#94A3B8'}
              strokeWidth={0.9 / pxPerMm}
              className="pointer-events-none"
            />
          )}

          {/* 4. Wall-Attached & Parallel-Side Chimneys / Blocks */}
          {wallMetrics.wallChimneys.map(({ el, leftS, rightS, effHeightMm, isDirectlyAttached, sCenter }) => {
            const x1 = Math.min(mapX(leftS), mapX(rightS));
            const x2 = Math.max(mapX(leftS), mapX(rightS));
            const w = Math.max(40, x2 - x1);
            const h = Math.min(effHeightMm, wallMetrics.heightMm - el.elevationMm);
            const yTop = -(el.elevationMm + h);
            const selected = isSelected('arch', el.id);
            const canEdit = isDirectlyAttached && !el.locked && !targetWall.locked;
            const isDimHov = hoveredCompId === el.id || hoveredDimKey === `comp:${el.id}` || hoveredDimKey === `width:${el.id}`;
            const fc = resolveChimneyFaceColors(el);
            const viewedFaceColor = isLeftView ? fc.front : fc.back;
            const chFill = isBw
              ? '#F1F5F9'
              : viewedFaceColor === '#FFFFFF' && settings.darkMode
                ? '#334155'
                : viewedFaceColor;
            return (
              <g
                key={el.id}
                onPointerEnter={() => setHoveredCompId(el.id)}
                onPointerLeave={() => setHoveredCompId((c) => (c === el.id ? null : c))}
                onPointerDown={(e) => {
                  if (placingChimney) return;
                  e.stopPropagation();
                  const alreadySel = isSelected('arch', el.id);
                  onSelect([{ kind: 'arch', id: el.id }]);
                  if (alreadySel && canEdit && e.button === 0) {
                    elevDragMutatedRef.current = false;
                    setElevDrag({
                      kind: 'comp_move',
                      compId: el.id,
                      compKind: 'chimney',
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origCenterS: sCenter,
                      origSillMm: el.elevationMm,
                      label: `Move ${el.name}`,
                    });
                  }
                }}
                className={selected && canEdit ? 'cursor-move' : 'cursor-pointer'}
              >
                <rect
                  x={x1}
                  y={yTop}
                  width={w}
                  height={h}
                  fill={chFill}
                  fillOpacity={isDirectlyAttached ? 0.96 : 0.85}
                  stroke={selected ? '#2563EB' : isDimHov ? '#0EA5E9' : isBw ? '#0F172A' : '#475569'}
                  strokeWidth={(selected ? 2.4 : 1.3) / pxPerMm}
                />
                {/* Inherit wall baseboard across attached chimney */}
                {(el.hasBaseboard ?? targetWall.hasBaseboard) && el.elevationMm === 0 && (
                  <rect
                    x={x1}
                    y={-(el.baseboardHeightMm ?? targetWall.baseboardHeightMm)}
                    width={w}
                    height={el.baseboardHeightMm ?? targetWall.baseboardHeightMm}
                    fill={isBw ? '#FFFFFF' : (el.baseboardColor ?? targetWall.baseboardColor)}
                    stroke={isBw ? '#0F172A' : '#94A3B8'}
                    strokeWidth={0.8 / pxPerMm}
                    className="pointer-events-none"
                  />
                )}
                {/* Edge & Vertical Drag Resize Handles for selected unlocked attached Chimney */}
                {selected && canEdit && (
                  <>
                    {(['left', 'right'] as const).map((edge) => {
                      const hx = edge === 'left' ? x1 : x2;
                      const gw = 10 / pxPerMm;
                      const gh = Math.min(h * 0.6, 36 / pxPerMm);
                      const cy = yTop + h / 2;
                      return (
                        <g
                          key={edge}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            elevDragMutatedRef.current = false;
                            setElevDrag({
                              kind: 'comp_edge',
                              compId: el.id,
                              compKind: 'chimney',
                              visualEdge: edge,
                              startClientX: e.clientX,
                              label: `Resize ${el.name}`,
                            });
                          }}
                          style={{ cursor: 'ew-resize' }}
                        >
                          <rect x={hx - gw * 1.4} y={yTop} width={gw * 2.8} height={h} fill="transparent" />
                          <rect
                            x={hx - gw / 2}
                            y={cy - gh / 2}
                            width={gw}
                            height={gh}
                            rx={3 / pxPerMm}
                            fill="#FFFFFF"
                            stroke="#2563EB"
                            strokeWidth={1.8 / pxPerMm}
                          />
                        </g>
                      );
                    })}
                    {(['top', 'bottom'] as const).map((vh) => {
                      const hy = vh === 'top' ? yTop : -el.elevationMm;
                      const hwBar = Math.min(w * 0.55, 34 / pxPerMm);
                      const hhBar = 9 / pxPerMm;
                      return (
                        <g
                          key={vh}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            elevDragMutatedRef.current = false;
                            setElevDrag({
                              kind: 'comp_v',
                              compId: el.id,
                              compKind: 'chimney',
                              handle: vh,
                              startClientY: e.clientY,
                              origSillMm: el.elevationMm,
                              origHeightMm: h,
                              label: `Resize ${el.name} Height`,
                            });
                          }}
                          style={{ cursor: 'ns-resize' }}
                        >
                          <rect x={x1} y={hy - hhBar * 1.4} width={w} height={hhBar * 2.8} fill="transparent" />
                          <rect
                            x={(x1 + x2) / 2 - hwBar / 2}
                            y={hy - hhBar / 2}
                            width={hwBar}
                            height={hhBar}
                            rx={3 / pxPerMm}
                            fill="#FFFFFF"
                            stroke="#2563EB"
                            strokeWidth={1.8 / pxPerMm}
                          />
                        </g>
                      );
                    })}
                  </>
                )}
                {/* Vertical measurements for selected chimney */}
                {showDimensions && selected && (
                  <>
                    {el.elevationMm + h < wallMetrics.heightMm - 5 &&
                      renderElevDim({
                        dimKey: `v_top_${el.id}`,
                        x1: x1 + w / 2,
                        y1: -wallMetrics.heightMm,
                        x2: x1 + w / 2,
                        y2: yTop,
                        valueMm: wallMetrics.heightMm - (el.elevationMm + h),
                        locked: el.locked || targetWall.locked,
                        vertical: true,
                        onEdit: () => {
                          if (el.locked || targetWall.locked) {
                            onConstraintError?.('Chimney or wall is locked.');
                            return;
                          }
                          openElevEditor({
                            key: `v_top_${el.id}`,
                            kind: 'obj_top_gap',
                            wallId: targetWall.id,
                            compId: el.id,
                            compKind: 'chimney',
                            label: 'Chimney Top to Ceiling',
                            valueStr: String(
                              Math.round(((wallMetrics.heightMm - (el.elevationMm + h)) / 10) * 10) / 10
                            ),
                            worldX: x1 + w / 2,
                            worldY: (-wallMetrics.heightMm + yTop) / 2,
                          });
                        },
                      })}
                    {renderElevDim({
                      dimKey: `v_h_${el.id}`,
                      x1: x2 + 110,
                      y1: yTop,
                      x2: x2 + 110,
                      y2: -el.elevationMm,
                      ext1x: x2,
                      ext1y: yTop,
                      ext2x: x2,
                      ext2y: -el.elevationMm,
                      valueMm: h,
                      locked: el.locked || targetWall.locked,
                      vertical: true,
                      onEdit: () => {
                        if (el.locked || targetWall.locked) {
                          onConstraintError?.('Chimney or wall is locked.');
                          return;
                        }
                        openElevEditor({
                          key: `v_h_${el.id}`,
                          kind: 'obj_height',
                          wallId: targetWall.id,
                          compId: el.id,
                          compKind: 'chimney',
                          label: 'Chimney Height',
                          valueStr: String(Math.round((h / 10) * 10) / 10),
                          worldX: x2 + 110,
                          worldY: (yTop - el.elevationMm) / 2,
                        });
                      },
                    })}
                  </>
                )}
              </g>
            );
          })}

          {/* 5. Wall Openings (Cutouts: Windows, Doors, Arches + Arch Apex Dotted Guides) */}
          {wallMetrics.wallOpenings.map(({ op, leftS, rightS, centerS }) => {
            const x1 = Math.min(mapX(leftS), mapX(rightS));
            const x2 = Math.max(mapX(leftS), mapX(rightS));
            const w = Math.max(40, x2 - x1);
            const h = Math.min(op.heightMm, wallMetrics.heightMm - op.sillHeightMm);
            const yTop = -(op.sillHeightMm + h);
            const yBottom = -op.sillHeightMm;
            const fThick = op.frameThicknessMm;
            const selected = isSelected('opening', op.id);
            const canEditOp = !op.locked && !targetWall.locked;
            const isDimHov =
              hoveredCompId === op.id ||
              hoveredDimKey === `comp:${op.id}` ||
              hoveredDimKey === `width:${op.id}`;
            const skyBg = settings.darkMode ? '#0F172A' : '#E0F2FE';
            const strokeColor = selected ? '#2563EB' : isDimHov ? '#0EA5E9' : op.frameColor;
            const strokeW = (selected ? 2.6 : isDimHov ? 2.1 : 1.45) / pxPerMm;

            // Curved arch spring heights & paths
            const isCurvedArch =
              op.category === 'arch' &&
              (op.subtype === 'round_arch' ||
                op.subtype === 'pointed_arch' ||
                op.subtype === 'segmental_arch');
            const springDrop =
              op.subtype === 'round_arch'
                ? Math.min(w / 2, h * 0.72)
                : op.subtype === 'pointed_arch'
                  ? Math.min(w * 0.65, h * 0.65)
                  : Math.min(w * 0.24, h * 0.35);
            const ySpring = yTop + springDrop;
            const guideColor = settings.darkMode ? '#CBD5E1' : '#0284C7';

            return (
              <g
                key={op.id}
                onPointerEnter={() => setHoveredCompId(op.id)}
                onPointerLeave={() => setHoveredCompId((c) => (c === op.id ? null : c))}
                onPointerDown={(e) => {
                  if (placingChimney) return;
                  e.stopPropagation();
                  const alreadySel = isSelected('opening', op.id);
                  onSelect([{ kind: 'opening', id: op.id }]);
                  if (alreadySel && canEditOp && e.button === 0) {
                    elevDragMutatedRef.current = false;
                    setElevDrag({
                      kind: 'comp_move',
                      compId: op.id,
                      compKind: 'opening',
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origCenterS: centerS,
                      origSillMm: op.sillHeightMm,
                      label: `Move ${op.name}`,
                    });
                  }
                }}
                className={selected && canEditOp ? 'cursor-move' : 'cursor-pointer'}
              >
                {/* Cutout backdrop */}
                {op.category === 'arch' && op.subtype === 'round_arch' ? (
                  <path
                    d={`M ${x1} ${yBottom} L ${x1} ${ySpring} A ${w / 2} ${springDrop} 0 0 1 ${x2} ${ySpring} L ${x2} ${yBottom} Z`}
                    fill={settings.darkMode ? '#090D16' : '#F8FAFC'}
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                  />
                ) : op.category === 'arch' && op.subtype === 'pointed_arch' ? (
                  <path
                    d={`M ${x1} ${yBottom} L ${x1} ${ySpring} Q ${x1} ${yTop + springDrop * 0.18} ${(x1 + x2) / 2} ${yTop} Q ${x2} ${yTop + springDrop * 0.18} ${x2} ${ySpring} L ${x2} ${yBottom} Z`}
                    fill={settings.darkMode ? '#090D16' : '#F8FAFC'}
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                  />
                ) : op.category === 'arch' && op.subtype === 'segmental_arch' ? (
                  <path
                    d={`M ${x1} ${yBottom} L ${x1} ${ySpring} Q ${(x1 + x2) / 2} ${yTop - springDrop * 0.7} ${x2} ${ySpring} L ${x2} ${yBottom} Z`}
                    fill={settings.darkMode ? '#090D16' : '#F8FAFC'}
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                  />
                ) : (
                  <rect
                    x={x1}
                    y={yTop}
                    width={w}
                    height={h}
                    fill={
                      op.category === 'window'
                        ? skyBg
                        : op.category === 'door' && op.subtype === 'doorframe'
                          ? isBw
                            ? '#E2E8F0'
                            : op.frameColor
                          : isBw
                            ? '#F8FAFC'
                            : settings.darkMode
                              ? '#0B1220'
                              : '#F8FAFC'
                    }
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                  />
                )}

                {/* Faint dotted non-physical vertical reference lines ONLY in Cut-Through for curved arches */}
                {isCurvedArch && (
                  <g className="pointer-events-none" opacity={0.42}>
                    <line
                      x1={x1}
                      y1={ySpring}
                      x2={x1}
                      y2={yTop}
                      stroke={guideColor}
                      strokeWidth={0.85 / pxPerMm}
                      strokeDasharray={`${3.5 / pxPerMm} ${4.5 / pxPerMm}`}
                    />
                    <line
                      x1={x2}
                      y1={ySpring}
                      x2={x2}
                      y2={yTop}
                      stroke={guideColor}
                      strokeWidth={0.85 / pxPerMm}
                      strokeDasharray={`${3.5 / pxPerMm} ${4.5 / pxPerMm}`}
                    />
                    {/* Horizontal apex reference ticks */}
                    <line
                      x1={x1 - 45}
                      y1={yTop}
                      x2={x2 + 45}
                      y2={yTop}
                      stroke={guideColor}
                      strokeWidth={0.75 / pxPerMm}
                      strokeDasharray={`${3 / pxPerMm} ${5 / pxPerMm}`}
                    />
                  </g>
                )}

                {op.category === 'window' && (
                  <>
                    <rect
                      x={x1 + fThick}
                      y={yTop + fThick}
                      width={Math.max(10, w - fThick * 2)}
                      height={Math.max(10, h - fThick * 2)}
                      fill={isBw ? '#F8FAFC' : op.glassColor}
                      fillOpacity={isBw ? 0.92 : 0.48}
                      stroke={isBw ? '#0F172A' : op.frameColor}
                      strokeWidth={1.1 / pxPerMm}
                    />
                    <line
                      x1={x1 + w * 0.25}
                      y1={yTop + h * 0.72}
                      x2={x1 + w * 0.42}
                      y2={yTop + h * 0.35}
                      stroke={isBw ? '#94A3B8' : '#FFFFFF'}
                      strokeOpacity={0.75}
                      strokeWidth={2 / pxPerMm}
                    />
                    {(op.subtype === 'double' ||
                      op.subtype === 'triple' ||
                      op.subtype === 'bay' ||
                      op.subtype === 'euro_double' ||
                      op.subtype === 'euro_terrace') && (
                      <line
                        x1={x1 + w / 2}
                        y1={yTop + fThick}
                        x2={x1 + w / 2}
                        y2={yBottom - fThick}
                        stroke={isBw ? '#0F172A' : op.frameColor}
                        strokeWidth={1.6 / pxPerMm}
                      />
                    )}
                    {(op.subtype === 'triple' || op.subtype === 'euro_triple') && (
                      <>
                        <line
                          x1={x1 + w / 3}
                          y1={yTop + fThick}
                          x2={x1 + w / 3}
                          y2={yBottom - fThick}
                          stroke={isBw ? '#0F172A' : op.frameColor}
                          strokeWidth={1.4 / pxPerMm}
                        />
                        <line
                          x1={x1 + (2 * w) / 3}
                          y1={yTop + fThick}
                          x2={x1 + (2 * w) / 3}
                          y2={yBottom - fThick}
                          stroke={isBw ? '#0F172A' : op.frameColor}
                          strokeWidth={1.4 / pxPerMm}
                        />
                      </>
                    )}
                    {(op.subtype === 'euro_single' ||
                      op.subtype === 'euro_double' ||
                      op.subtype === 'euro_triple' ||
                      op.subtype === 'euro_terrace') && (
                      <polyline
                        points={`${x1 + fThick},${yTop + fThick} ${x1 + w / 2},${yBottom - fThick} ${x2 - fThick},${yTop + fThick}`}
                        fill="none"
                        stroke="#64748B"
                        strokeDasharray="45 35"
                        strokeWidth={0.9 / pxPerMm}
                      />
                    )}
                    <rect x={x1 - 35} y={yBottom - 25} width={w + 70} height={45} fill={isBw ? '#E2E8F0' : op.frameColor} stroke={isBw ? '#0F172A' : '#94A3B8'} strokeWidth={0.6 / pxPerMm} />
                  </>
                )}

                {op.category === 'door' && op.subtype === 'doorframe' && (
                  <rect
                    x={x1 + fThick}
                    y={yTop + fThick}
                    width={Math.max(20, w - fThick * 2)}
                    height={Math.max(20, h - fThick)}
                    fill={isBw ? '#FFFFFF' : settings.darkMode ? '#0B1220' : '#F8FAFC'}
                    stroke={isBw ? '#0F172A' : strokeColor}
                    strokeWidth={1.1 / pxPerMm}
                  />
                )}

                {op.category === 'door' && op.subtype !== 'doorframe' && (
                  <>
                    {(op.subtype === 'balcony_single' || op.subtype === 'balcony_double') ? (
                      <>
                        <rect
                          x={x1 + fThick}
                          y={yTop + fThick}
                          width={Math.max(20, w - fThick * 2)}
                          height={Math.max(20, h - fThick)}
                          fill={isBw ? '#FFFFFF' : op.frameColor}
                          stroke={isBw ? '#0F172A' : '#94A3B8'}
                          strokeWidth={1.2 / pxPerMm}
                        />
                        {op.subtype === 'balcony_double' ? (
                          <>
                            <rect
                              x={x1 + fThick + 55}
                              y={yTop + fThick + 65}
                              width={Math.max(15, w / 2 - fThick - 85)}
                              height={Math.max(20, h * 0.72)}
                              fill={isBw ? '#F8FAFC' : op.glassColor}
                              fillOpacity={isBw ? 0.92 : 0.5}
                              stroke={isBw ? '#0F172A' : '#94A3B8'}
                              strokeWidth={0.9 / pxPerMm}
                            />
                            <rect
                              x={x1 + w / 2 + 30}
                              y={yTop + fThick + 65}
                              width={Math.max(15, w / 2 - fThick - 85)}
                              height={Math.max(20, h * 0.72)}
                              fill={isBw ? '#F8FAFC' : op.glassColor}
                              fillOpacity={isBw ? 0.92 : 0.5}
                              stroke={isBw ? '#0F172A' : '#94A3B8'}
                              strokeWidth={0.9 / pxPerMm}
                            />
                            <line
                              x1={x1 + w / 2}
                              y1={yTop + fThick}
                              x2={x1 + w / 2}
                              y2={yBottom}
                              stroke={isBw ? '#0F172A' : op.frameColor}
                              strokeWidth={1.6 / pxPerMm}
                            />
                          </>
                        ) : (
                          <rect
                            x={x1 + fThick + 65}
                            y={yTop + fThick + 65}
                            width={Math.max(20, w - fThick * 2 - 130)}
                            height={Math.max(20, h * 0.74)}
                            fill={isBw ? '#F8FAFC' : op.glassColor}
                            fillOpacity={isBw ? 0.92 : 0.5}
                            stroke={isBw ? '#0F172A' : '#94A3B8'}
                            strokeWidth={0.9 / pxPerMm}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <rect
                          x={x1 + fThick}
                          y={yTop + fThick}
                          width={Math.max(20, w - fThick * 2)}
                          height={Math.max(20, h - fThick)}
                          fill={isBw ? '#FFFFFF' : op.panelColor}
                          stroke={isBw ? '#0F172A' : op.frameColor}
                          strokeWidth={1.2 / pxPerMm}
                        />
                        {(op.subtype === 'double' || op.subtype === 'french') && (
                          <line
                            x1={x1 + w / 2}
                            y1={yTop + fThick}
                            x2={x1 + w / 2}
                            y2={yBottom}
                            stroke={isBw ? '#0F172A' : op.frameColor}
                            strokeWidth={1.5 / pxPerMm}
                          />
                        )}
                      </>
                    )}
                    {op.subtype !== 'double' && op.subtype !== 'french' && op.subtype !== 'balcony_double' && (
                      <polyline
                        points={
                          op.swingSide === 'left'
                            ? `${x1 + fThick},${yTop + fThick} ${x2 - fThick},${(yTop + yBottom) / 2} ${
                                x1 + fThick
                              },${yBottom}`
                            : `${x2 - fThick},${yTop + fThick} ${x1 + fThick},${(yTop + yBottom) / 2} ${
                                x2 - fThick
                              },${yBottom}`
                        }
                        fill="none"
                        stroke="#64748B"
                        strokeDasharray="50 40"
                        strokeWidth={1.1 / pxPerMm}
                      />
                    )}
                    <circle
                      cx={op.swingSide === 'left' ? x2 - fThick - 75 : x1 + fThick + 75}
                      cy={-1050}
                      r={24}
                      fill={isBw ? '#334155' : op.subtype.startsWith('balcony_') ? '#64748B' : op.frameColor}
                    />
                  </>
                )}

                {/* Direct Left/Right & Top/Bottom Edge-Drag Handles for Selected Unlocked Opening */}
                {selected && canEditOp && (
                  <>
                    {(['left', 'right'] as const).map((edge) => {
                      const hx = edge === 'left' ? x1 : x2;
                      const gw = 10 / pxPerMm;
                      const gh = Math.min(h * 0.65, 38 / pxPerMm);
                      const cy = (yTop + yBottom) / 2;
                      return (
                        <g
                          key={edge}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            elevDragMutatedRef.current = false;
                            setElevDrag({
                              kind: 'comp_edge',
                              compId: op.id,
                              compKind: 'opening',
                              visualEdge: edge,
                              startClientX: e.clientX,
                              label: `Resize ${op.name}`,
                            });
                          }}
                          style={{ cursor: 'ew-resize' }}
                        >
                          <rect x={hx - gw * 1.4} y={yTop} width={gw * 2.8} height={h} fill="transparent" />
                          <rect
                            x={hx - gw / 2}
                            y={cy - gh / 2}
                            width={gw}
                            height={gh}
                            rx={3 / pxPerMm}
                            fill="#FFFFFF"
                            stroke="#2563EB"
                            strokeWidth={1.8 / pxPerMm}
                          />
                        </g>
                      );
                    })}
                    {(['top', 'bottom'] as const).map((vh) => {
                      if (vh === 'bottom' && op.category === 'door' && op.sillHeightMm === 0) return null;
                      const hy = vh === 'top' ? yTop : yBottom;
                      const hwBar = Math.min(w * 0.55, 34 / pxPerMm);
                      const hhBar = 9 / pxPerMm;
                      return (
                        <g
                          key={vh}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            elevDragMutatedRef.current = false;
                            setElevDrag({
                              kind: 'comp_v',
                              compId: op.id,
                              compKind: 'opening',
                              handle: vh,
                              startClientY: e.clientY,
                              origSillMm: op.sillHeightMm,
                              origHeightMm: h,
                              label: `Resize ${op.name} Height`,
                            });
                          }}
                          style={{ cursor: 'ns-resize' }}
                        >
                          <rect x={x1} y={hy - hhBar * 1.4} width={w} height={hhBar * 2.8} fill="transparent" />
                          <rect
                            x={(x1 + x2) / 2 - hwBar / 2}
                            y={hy - hhBar / 2}
                            width={hwBar}
                            height={hhBar}
                            rx={3 / pxPerMm}
                            fill="#FFFFFF"
                            stroke="#2563EB"
                            strokeWidth={1.8 / pxPerMm}
                          />
                        </g>
                      );
                    })}
                  </>
                )}

                {/* Vertical Dimensions (Top to Ceiling, Height, Sill to Floor) */}
                {showDimensions && (selected || wallSelected) && (
                  <>
                    {/* Top of Door/Window/Arch to Ceiling */}
                    {wallMetrics.heightMm - (op.sillHeightMm + h) >= 5 &&
                      renderElevDim({
                        dimKey: `v_top_${op.id}`,
                        x1: (x1 + x2) / 2,
                        y1: -wallMetrics.heightMm,
                        x2: (x1 + x2) / 2,
                        y2: yTop,
                        valueMm: wallMetrics.heightMm - (op.sillHeightMm + h),
                        locked: op.locked || targetWall.locked,
                        vertical: true,
                        hoverId: op.id,
                        onEdit: () => {
                          if (op.locked || targetWall.locked) {
                            onConstraintError?.('Opening or wall is locked.');
                            return;
                          }
                          openElevEditor({
                            key: `v_top_${op.id}`,
                            kind: 'obj_top_gap',
                            wallId: targetWall.id,
                            compId: op.id,
                            compKind: 'opening',
                            label: `${op.name} Top to Ceiling`,
                            valueStr: String(
                              Math.round(((wallMetrics.heightMm - (op.sillHeightMm + h)) / 10) * 10) / 10
                            ),
                            worldX: (x1 + x2) / 2,
                            worldY: (-wallMetrics.heightMm + yTop) / 2,
                          });
                        },
                      })}
                    {/* Window Sill / Bottom to Floor */}
                    {op.sillHeightMm >= 5 &&
                      renderElevDim({
                        dimKey: `v_sill_${op.id}`,
                        x1: (x1 + x2) / 2,
                        y1: yBottom,
                        x2: (x1 + x2) / 2,
                        y2: 0,
                        valueMm: op.sillHeightMm,
                        locked: op.locked || targetWall.locked,
                        vertical: true,
                        hoverId: op.id,
                        onEdit: () => {
                          if (op.locked || targetWall.locked) {
                            onConstraintError?.('Opening or wall is locked.');
                            return;
                          }
                          openElevEditor({
                            key: `v_sill_${op.id}`,
                            kind: 'obj_sill',
                            wallId: targetWall.id,
                            compId: op.id,
                            compKind: 'opening',
                            label: `${op.name} Sill to Floor`,
                            valueStr: String(Math.round((op.sillHeightMm / 10) * 10) / 10),
                            worldX: (x1 + x2) / 2,
                            worldY: yBottom / 2,
                          });
                        },
                      })}
                    {/* Opening Height (when selected) */}
                    {selected &&
                      renderElevDim({
                        dimKey: `v_h_${op.id}`,
                        x1: x2 + 115,
                        y1: yTop,
                        x2: x2 + 115,
                        y2: yBottom,
                        ext1x: x2,
                        ext1y: yTop,
                        ext2x: x2,
                        ext2y: yBottom,
                        valueMm: h,
                        locked: op.locked || targetWall.locked,
                        vertical: true,
                        hoverId: op.id,
                        onEdit: () => {
                          if (op.locked || targetWall.locked) {
                            onConstraintError?.('Opening or wall is locked.');
                            return;
                          }
                          openElevEditor({
                            key: `v_h_${op.id}`,
                            kind: 'obj_height',
                            wallId: targetWall.id,
                            compId: op.id,
                            compKind: 'opening',
                            label: `${op.name} Height`,
                            valueStr: String(Math.round((h / 10) * 10) / 10),
                            worldX: x2 + 115,
                            worldY: (yTop + yBottom) / 2,
                          });
                        },
                      })}
                  </>
                )}
              </g>
            );
          })}

          {/* 6. Projected Nearby (<= 0.7m) Furniture & Objects (clipped cleanly at wall edges, angle-visible faces only) */}
          {showObjects && (
            <g
              data-testid="cutthrough-context-objects"
              clipPath="url(#cutthrough_wall_clip)"
              className="pointer-events-none"
            >
              {(() => {
                const depthFilterFor = (perpDistMm: number): string | undefined => {
                  if (!showDepthEffect) return undefined;
                  const ratio = Math.min(1, perpDistMm / Math.max(100, wallMetrics.maxContextDistMm));
                  const bucket = Math.min(4, Math.floor(ratio * 4.99));
                  return `url(#ct_depth_${bucket})`;
                };

                type CombinedCtx =
                  | { kind: 'furn'; perpDistMm: number; entry: (typeof wallMetrics.wallFurniture)[number] }
                  | { kind: 'arch'; perpDistMm: number; entry: (typeof wallMetrics.wallContextArch)[number] }
                  | { kind: 'curtain'; perpDistMm: number; entry: (typeof wallMetrics.wallCurtains)[number] }
                  | { kind: 'person'; perpDistMm: number; entry: (typeof wallMetrics.wallPeople)[number] };

                const combined: CombinedCtx[] = [
                  ...wallMetrics.wallFurniture.map((entry) => ({ kind: 'furn' as const, perpDistMm: entry.perpDistMm, entry })),
                  ...wallMetrics.wallContextArch.map((entry) => ({ kind: 'arch' as const, perpDistMm: entry.perpDistMm, entry })),
                  ...wallMetrics.wallCurtains.map((entry) => ({ kind: 'curtain' as const, perpDistMm: entry.perpDistMm, entry })),
                  ...wallMetrics.wallPeople.map((entry) => ({ kind: 'person' as const, perpDistMm: entry.perpDistMm, entry })),
                ].sort((a, b) => a.perpDistMm - b.perpDistMm);

                return combined.map((node) => {
                  const filterAttr = depthFilterFor(node.perpDistMm);
                  const ctxOpacity = showDepthEffect ? 0.94 : 0.98;

                  if (node.kind === 'furn') {
                    const { item: f, visibleParts, projection } = node.entry;
                    const sw = 1 / pxPerMm;
                    if (projection) {
                      const activeMode = resolveEffectiveRepresentationMode(f);
                      const isCustomElev = hasCustomView(f.representation, projection.viewId);
                      const hasExplicitDefaultElev = Boolean(
                        f.representation?.defaultViews?.[projection.viewId]?.elements?.length
                      );
                      // In Default mode, built-in items render via architectural elevation parts unless custom/defaultViews exist
                      const useSvgRep =
                        isCustomElev ||
                        (activeMode === 'default'
                          ? hasExplicitDefaultElev || !isBuiltinCatalogItem(f)
                          : true);
                      const effectiveRep =
                        useSvgRep &&
                        activeMode === 'default' &&
                        !isCustomElev &&
                        !hasExplicitDefaultElev &&
                        f.representation?.autoViews?.[projection.viewId]
                          ? { ...f.representation, mode: 'silhouette' as const }
                          : f.representation;
                      const resolved = useSvgRep
                        ? getEffectiveViewElements(effectiveRep, projection.viewId)
                        : { elements: null, autoView: undefined };
                      if (resolved.elements && resolved.elements.length > 0) {
                        const baseW = resolved.autoView?.baseWidthMm || projection.elevW;
                        const baseH = resolved.autoView?.baseHeightMm || projection.elevH;
                        const sx = (projection.flipX ? -1 : 1) * (baseW > 0 ? projection.elevW / baseW : 1);
                        const sy = baseH > 0 ? projection.elevH / baseH : 1;
                        return (
                          <g
                            key={f.id}
                            filter={filterAttr}
                            opacity={ctxOpacity}
                            transform={`translate(${projection.viewXCenter}, ${-projection.zBottom}) scale(${sx}, ${sy})`}
                          >
                            {renderFurnitureRepresentationView(effectiveRep, projection.viewId, {
                              baseStrokeMm: Math.max(4, sw),
                              selected: false,
                              useMaterialFill: Boolean(f.representation?.useMaterialFill && !isBw),
                              blackAndWhite: isBw,
                            })}
                          </g>
                        );
                      }
                    }
                    return (
                      <g key={f.id} filter={filterAttr} opacity={ctxOpacity}>
                        {visibleParts.map((vp) => {
                          const p = vp.part;
                          const ds = p.detailStyle;
                          const x0 = vp.viewX - vp.elevW / 2;
                          const y0 = -(vp.zBottom + vp.elevH);
                          const w = vp.elevW;
                          const h = vp.elevH;
                          const cx = vp.viewX;
                          const cy = -(vp.zBottom + h / 2);

                          if (p.shape === 'oval' && ds === 'mirror') {
                            return (
                              <g key={p.id}>
                                <ellipse
                                  cx={cx}
                                  cy={cy}
                                  rx={w / 2}
                                  ry={h / 2}
                                  fill={p.color}
                                  fillOpacity={1}
                                  stroke="#475569"
                                  strokeWidth={sw}
                                />
                                <line
                                  x1={cx - w * 0.22}
                                  y1={cy + h * 0.14}
                                  x2={cx + w * 0.22}
                                  y2={cy - h * 0.18}
                                  stroke="#FFFFFF"
                                  strokeOpacity={0.75}
                                  strokeWidth={sw * 1.4}
                                />
                              </g>
                            );
                          }
                          const rx =
                            p.shape === 'rounded_rect'
                              ? Math.min(24, w * 0.2, h * 0.2)
                              : p.shape === 'oval'
                                ? Math.min(w, h) * 0.28
                                : 0;

                          return (
                            <g key={p.id}>
                              <rect
                                x={x0}
                                y={y0}
                                width={w}
                                height={h}
                                rx={rx}
                                fill={
                                  isBw
                                    ? ds === 'wall_tv' || ds === 'screen'
                                      ? '#1E293B'
                                      : p.material === 'metal' || p.material === 'brass' || p.material === 'chrome'
                                        ? '#E2E8F0'
                                        : '#FFFFFF'
                                    : p.color
                                }
                                fillOpacity={
                                  isBw
                                    ? 1
                                    : p.material === 'glass' ||
                                        (f.templateId === 'curtain_linen_drapes' && ds === 'curtain_pleat')
                                      ? 0.35
                                      : 1
                                }
                                stroke={isBw ? '#0F172A' : '#475569'}
                                strokeWidth={sw}
                              />
                              {(ds === 'oven_front' || ds === 'microwave_front') && (
                                <g stroke="#64748B" strokeWidth={sw * 0.9} fill="none">
                                  <rect
                                    x={x0 + w * 0.08}
                                    y={y0 + h * (ds === 'oven_front' ? 0.26 : 0.14)}
                                    width={w * (ds === 'oven_front' ? 0.84 : 0.62)}
                                    height={h * (ds === 'oven_front' ? 0.6 : 0.72)}
                                    rx={Math.min(10, w * 0.04)}
                                    fill="#0F172A"
                                    fillOpacity={0.85}
                                  />
                                  {ds === 'oven_front' ? (
                                    <>
                                      <line x1={x0 + w * 0.16} y1={y0 + h * 0.2} x2={x0 + w * 0.84} y2={y0 + h * 0.2} stroke="#CBD5E1" strokeWidth={sw * 1.8} />
                                      <circle cx={x0 + w * 0.2} cy={y0 + h * 0.11} r={Math.min(18, w * 0.032)} fill="#CBD5E1" />
                                      <circle cx={x0 + w * 0.8} cy={y0 + h * 0.11} r={Math.min(18, w * 0.032)} fill="#CBD5E1" />
                                      <rect x={x0 + w * 0.38} y={y0 + h * 0.08} width={w * 0.24} height={h * 0.06} fill="#1E293B" />
                                    </>
                                  ) : (
                                    <>
                                      <rect x={x0 + w * 0.75} y={y0 + h * 0.18} width={w * 0.17} height={h * 0.16} fill="#1E293B" />
                                      <line x1={x0 + w * 0.7} y1={y0 + h * 0.2} x2={x0 + w * 0.7} y2={y0 + h * 0.8} stroke="#CBD5E1" strokeWidth={sw * 1.5} />
                                    </>
                                  )}
                                </g>
                              )}
                              {(ds === 'washer_drum' || ds === 'dryer_drum') && (
                                <g stroke="#475569" strokeWidth={sw} fill="none">
                                  <line x1={x0} y1={y0 + h * 0.2} x2={x0 + w} y2={y0 + h * 0.2} />
                                  <rect x={x0 + w * 0.08} y={y0 + h * 0.05} width={w * 0.26} height={h * 0.1} rx={4} />
                                  <circle cx={cx} cy={y0 + h * 0.1} r={Math.min(20, w * 0.04)} fill="#CBD5E1" />
                                  <circle cx={cx} cy={y0 + h * 0.56} r={Math.min(w, h) * 0.28} fill="#0F172A" fillOpacity={0.85} stroke="#94A3B8" strokeWidth={sw * 1.8} />
                                  <circle cx={cx} cy={y0 + h * 0.56} r={Math.min(w, h) * 0.19} stroke="#475569" strokeWidth={sw * 0.7} />
                                </g>
                              )}
                              {(ds === 'fridge_single' || ds === 'fridge_double' || ds === 'fridge_side_by_side' || ds === 'fridge_french') && (
                                <g stroke="#475569" strokeWidth={sw} fill="none">
                                  {ds === 'fridge_double' && (
                                    <line x1={x0} y1={y0 + h * 0.32} x2={x0 + w} y2={y0 + h * 0.32} />
                                  )}
                                  {ds === 'fridge_side_by_side' && (
                                    <>
                                      <line x1={x0 + w * 0.42} y1={y0} x2={x0 + w * 0.42} y2={y0 + h} />
                                      <rect x={x0 + w * 0.1} y={y0 + h * 0.25} width={w * 0.22} height={h * 0.18} fill="#1E293B" />
                                    </>
                                  )}
                                  {ds === 'fridge_french' && (
                                    <>
                                      <line x1={x0} y1={y0 + h * 0.64} x2={x0 + w} y2={y0 + h * 0.64} />
                                      <line x1={cx} y1={y0} x2={cx} y2={y0 + h * 0.64} />
                                      <line x1={x0 + w * 0.16} y1={y0 + h * 0.71} x2={x0 + w * 0.84} y2={y0 + h * 0.71} strokeWidth={sw * 1.6} />
                                    </>
                                  )}
                                  <line
                                    x1={x0 + w * (ds === 'fridge_french' ? 0.44 : ds === 'fridge_side_by_side' ? 0.36 : 0.1)}
                                    y1={y0 + h * 0.18}
                                    x2={x0 + w * (ds === 'fridge_french' ? 0.44 : ds === 'fridge_side_by_side' ? 0.36 : 0.1)}
                                    y2={y0 + h * 0.52}
                                    strokeWidth={sw * 1.6}
                                  />
                                </g>
                              )}
                              {ds === 'wine_cooler' && (
                                <g stroke={isBw ? '#334155' : '#92400E'} strokeWidth={sw} fill="none">
                                  <rect x={x0 + w * 0.1} y={y0 + h * 0.08} width={w * 0.8} height={h * 0.84} fill="#0F172A" fillOpacity={0.82} stroke="#334155" />
                                  {[0.24, 0.4, 0.56, 0.72].map((fY, idx) => (
                                    <line key={idx} x1={x0 + w * 0.14} y1={y0 + h * fY} x2={x0 + w * 0.86} y2={y0 + h * fY} />
                                  ))}
                                </g>
                              )}
                              {(ds === 'wall_tv' || ds === 'screen') && (
                                <g stroke="#475569" strokeWidth={sw * 0.8} fill="none">
                                  <rect x={x0 + w * 0.03} y={y0 + h * 0.04} width={w * 0.94} height={h * 0.92} fill="#0F172A" fillOpacity={0.92} />
                                  <line x1={x0 + w * 0.2} y1={y0 + h * 0.72} x2={x0 + w * 0.44} y2={y0 + h * 0.24} stroke="#94A3B8" strokeOpacity={0.45} strokeWidth={sw * 1.5} />
                                </g>
                              )}
                              {ds === 'curtain_pleat' && (
                                <g stroke={isBw ? '#0F172A' : '#64748B'} strokeOpacity={0.5} strokeWidth={sw * 0.7}>
                                  {Array.from({ length: Math.min(18, Math.max(4, Math.floor(w / 75))) }).map((_, idx, arr) => {
                                    const fx = x0 + ((idx + 1) / (arr.length + 1)) * w;
                                    return <line key={idx} x1={fx} y1={y0 + 10} x2={fx} y2={y0 + h - 10} />;
                                  })}
                                </g>
                              )}
                              {ds === 'blinds_slats' && (
                                <g stroke={isBw ? '#0F172A' : '#64748B'} strokeOpacity={0.65} strokeWidth={sw * 0.75}>
                                  {Array.from({ length: Math.min(24, Math.max(5, Math.floor(h / 55))) }).map((_, idx, arr) => {
                                    const sy = y0 + ((idx + 1) / (arr.length + 1)) * h;
                                    return <line key={idx} x1={x0 + 8} y1={sy} x2={x0 + w - 8} y2={sy} />;
                                  })}
                                </g>
                              )}
                              {ds === 'ac_indoor' && (
                                <g stroke={isBw ? '#0F172A' : '#475569'} strokeWidth={sw * 0.9} fill="none">
                                  <line x1={x0 + w * 0.06} y1={y0 + h * 0.72} x2={x0 + w * 0.94} y2={y0 + h * 0.72} strokeWidth={sw * 1.5} />
                                  <rect x={x0 + w * 0.72} y={y0 + h * 0.36} width={w * 0.14} height={h * 0.16} fill="#0F172A" />
                                </g>
                              )}
                              {ds === 'ac_outdoor' && (
                                <g stroke={isBw ? '#0F172A' : '#475569'} strokeWidth={sw * 0.95} fill="none">
                                  <circle cx={x0 + w * 0.36} cy={cy} r={Math.min(w * 0.28, h * 0.36)} fill="#1E293B" fillOpacity={0.85} />
                                  <circle cx={x0 + w * 0.36} cy={cy} r={Math.min(w * 0.28, h * 0.36) * 0.55} stroke="#94A3B8" />
                                  <line x1={x0 + w * 0.74} y1={y0 + h * 0.12} x2={x0 + w * 0.74} y2={y0 + h * 0.88} />
                                </g>
                              )}
                              {(ds === 'fluted' || ds === 'slatted_wood') && w > 120 && (
                                <g stroke="#64748B" strokeOpacity={0.35} strokeWidth={sw * 0.7}>
                                  {Array.from({ length: Math.min(18, Math.max(4, Math.floor(w / 65))) }).map((_, idx, arr) => {
                                    const fx = x0 + ((idx + 1) / (arr.length + 1)) * w;
                                    return <line key={idx} x1={fx} y1={y0 + 12} x2={fx} y2={y0 + h - 12} />;
                                  })}
                                </g>
                              )}
                              {ds === 'hood_filter' && (
                                <g stroke="#64748B" strokeWidth={sw * 0.8}>
                                  {Array.from({ length: 7 }).map((_, idx) => {
                                    const lx = x0 + ((idx + 1) / 8) * w;
                                    return <line key={idx} x1={lx} y1={y0 + h * 0.15} x2={lx} y2={y0 + h * 0.85} />;
                                  })}
                                </g>
                              )}
                              {ds === 'dishwasher' && (
                                 <g stroke="#475569" strokeWidth={sw} fill="none">
                                   <rect x={x0 + w * 0.02} y={y0 + h * 0.02} width={w * 0.96} height={h * 0.13} fill="#1E293B" />
                                   <rect x={x0 + w * 0.38} y={y0 + h * 0.06} width={w * 0.24} height={h * 0.05} fill="#0F172A" stroke="none" />
                                   <rect x={x0 + w * 0.02} y={y0 + h * 0.16} width={w * 0.96} height={h * 0.72} fill="#CBD5E1" fillOpacity={0.35} />
                                   <line x1={x0 + w * 0.14} y1={y0 + h * 0.22} x2={x0 + w * 0.86} y2={y0 + h * 0.22} stroke="#334155" strokeWidth={sw * 1.8} />
                                   <rect x={x0 + w * 0.04} y={y0 + h * 0.89} width={w * 0.92} height={h * 0.11} fill="#334155" />
                                 </g>
                               )}
                              {ds === 'washer_topload' && (
                                 <g stroke="#475569" strokeWidth={sw} fill="none">
                                   <rect x={x0 + w * 0.02} y={y0} width={w * 0.96} height={h * 0.12} fill="#F1F5F9" />
                                   <circle cx={cx} cy={y0 + h * 0.06} r={Math.min(20, w * 0.04)} fill="#CBD5E1" />
                                   <line x1={x0} y1={y0 + h * 0.13} x2={x0 + w} y2={y0 + h * 0.13} />
                                   <rect x={x0 + w * 0.14} y={y0 + h * 0.15} width={w * 0.72} height={h * 0.03} fill="#0F172A" />
                                 </g>
                               )}
                              {ds === 'stand_mixer' && (
                                 <g stroke="#475569" strokeWidth={sw} fill="none">
                                   <rect x={x0 + w * 0.12} y={y0 + h * 0.06} width={w * 0.76} height={h * 0.28} rx={Math.min(20, h * 0.12)} fill="#F8FAFC" />
                                   <rect x={x0 + w * 0.2} y={y0 + h * 0.34} width={w * 0.42} height={h * 0.46} fill="#CBD5E1" fillOpacity={0.85} />
                                   <rect x={x0 + w * 0.06} y={y0 + h * 0.88} width={w * 0.88} height={h * 0.12} fill="#E2E8F0" />
                                 </g>
                               )}
                              {ds === 'lamp_base' && (
                                 <ellipse
                                   cx={cx}
                                   cy={cy}
                                   rx={w * 0.46}
                                   ry={h * 0.44}
                                   fill="none"
                                   stroke="#94A3B8"
                                   strokeWidth={sw * 0.8}
                                 />
                               )}
                              {ds === 'faucet' && (
                                 <path
                                   d={`M ${cx} ${y0 + h} L ${cx} ${y0 + h * 0.28} Q ${cx + w * 0.18} ${y0 + 6} ${cx + w * 0.34} ${y0 + h * 0.35}`}
                                   fill="none"
                                   stroke="#334155"
                                   strokeWidth={sw * 1.6}
                                 />
                               )}
                            </g>
                          );
                        })}
                      </g>
                    );
                  }

                  if (node.kind === 'arch') {
                    const { item: el, sCenter, projW } = node.entry;
                    const ex = mapX(sCenter);
                    const h = el.connectToCeiling ? wallMetrics.heightMm - el.elevationMm : el.heightMm;
                    return (
                      <rect
                        key={`ctx_arch_${el.id}`}
                        x={ex - projW / 2}
                        y={-(el.elevationMm + h)}
                        width={projW}
                        height={h}
                        fill={isBw ? '#F1F5F9' : el.color}
                        fillOpacity={isBw ? 1 : 0.88}
                        stroke={isBw ? '#0F172A' : '#475569'}
                        strokeWidth={1 / pxPerMm}
                        filter={filterAttr}
                        opacity={ctxOpacity}
                      />
                    );
                  }

                  if (node.kind === 'curtain') {
                    const { item: c, sCenter } = node.entry;
                    const cx = mapX(sCenter);
                    const closedFrac = 1 - c.openPercent / 100;
                    const wingW = Math.max(120, (c.widthMm / 2) * closedFrac);
                    const topY = -(c.elevationMm + c.heightMm);
                    return (
                      <g key={c.id} filter={filterAttr} opacity={ctxOpacity}>
                        <line
                          x1={cx - c.widthMm / 2 - 60}
                          y1={topY}
                          x2={cx + c.widthMm / 2 + 60}
                          y2={topY}
                          stroke={isBw ? '#0F172A' : c.rodColor}
                          strokeWidth={2.5 / pxPerMm}
                        />
                        <rect
                          x={cx - c.widthMm / 2}
                          y={topY}
                          width={wingW}
                          height={c.heightMm}
                          fill={isBw ? '#FFFFFF' : c.color}
                          fillOpacity={isBw ? 1 : c.style === 'drapes' || c.style === 'curtains' ? 0.35 : 0.8}
                          stroke={isBw ? '#0F172A' : '#475569'}
                          strokeWidth={1 / pxPerMm}
                        />
                        <rect
                          x={cx + c.widthMm / 2 - wingW}
                          y={topY}
                          width={wingW}
                          height={c.heightMm}
                          fill={isBw ? '#FFFFFF' : c.color}
                          fillOpacity={isBw ? 1 : c.style === 'drapes' || c.style === 'curtains' ? 0.35 : 0.8}
                          stroke={isBw ? '#0F172A' : '#475569'}
                          strokeWidth={1 / pxPerMm}
                        />
                      </g>
                    );
                  }

                  const { item: person, sCenter } = node.entry;
                  const px = mapX(sCenter);
                  const h = person.heightMm;
                  return (
                    <g
                      key={person.id}
                      transform={`translate(${px}, ${-person.elevationMm})`}
                      filter={filterAttr}
                      opacity={ctxOpacity}
                    >
                      <rect
                        x={-140}
                        y={-h * 0.85}
                        width={280}
                        height={h * 0.85}
                        rx={110}
                        fill={isBw ? '#F1F5F9' : person.color}
                        fillOpacity={isBw ? 1 : 0.82}
                        stroke={isBw ? '#0F172A' : '#475569'}
                        strokeWidth={1.1 / pxPerMm}
                      />
                      <circle
                        cx={0}
                        cy={-h * 0.92}
                        r={h * 0.075}
                        fill={person.color}
                        stroke="#475569"
                        strokeWidth={1.1 / pxPerMm}
                      />
                    </g>
                  );
                });
              })()}
            </g>
          )}

          {/* 7. Interactive Architectural Horizontal & Overall Height Dimensions */}
          {showDimensions && wallChain && (
            <g>
              {focusedWallComp?.target ? (
                <>
                  {/* Object Width Above Object */}
                  {renderElevDim({
                    dimKey: `width:${focusedWallComp.target.id}`,
                    x1: Math.min(mapX(focusedWallComp.target.leftS), mapX(focusedWallComp.target.rightS)),
                    y1: -wallMetrics.heightMm - 280,
                    x2: Math.max(mapX(focusedWallComp.target.leftS), mapX(focusedWallComp.target.rightS)),
                    y2: -wallMetrics.heightMm - 280,
                    ext1x: Math.min(mapX(focusedWallComp.target.leftS), mapX(focusedWallComp.target.rightS)),
                    ext1y: -wallMetrics.heightMm,
                    ext2x: Math.max(mapX(focusedWallComp.target.leftS), mapX(focusedWallComp.target.rightS)),
                    ext2y: -wallMetrics.heightMm,
                    valueMm: focusedWallComp.target.widthMm,
                    locked: targetWall.locked || focusedWallComp.target.locked,
                    hoverId: focusedWallComp.target.id,
                    onEdit: () => {
                      const t = focusedWallComp.target!;
                      if (targetWall.locked || t.locked) {
                        onConstraintError?.('Component or wall is locked.');
                        return;
                      }
                      const mx = (mapX(t.leftS) + mapX(t.rightS)) / 2;
                      openElevEditor({
                        key: `width:${t.id}`,
                        kind: 'component_width',
                        wallId: targetWall.id,
                        compId: t.id,
                        label: `${t.name} Width`,
                        valueStr: String(Math.round((t.widthMm / 10) * 10) / 10),
                        worldX: mx,
                        worldY: -wallMetrics.heightMm - 280,
                      });
                    },
                  })}

                  {/* Non-Crossing Left Clearance */}
                  {focusedWallComp.left && focusedWallComp.left.lengthMm >= 1 &&
                    renderElevDim({
                      dimKey: `clear_left:${focusedWallComp.target.id}`,
                      x1: Math.min(mapX(focusedWallComp.left.startS), mapX(focusedWallComp.left.endS)),
                      y1: 295,
                      x2: Math.max(mapX(focusedWallComp.left.startS), mapX(focusedWallComp.left.endS)),
                      y2: 295,
                      ext1x: Math.min(mapX(focusedWallComp.left.startS), mapX(focusedWallComp.left.endS)),
                      ext1y: 0,
                      ext2x: Math.max(mapX(focusedWallComp.left.startS), mapX(focusedWallComp.left.endS)),
                      ext2y: 0,
                      valueMm: focusedWallComp.left.lengthMm,
                      locked: focusedWallComp.left.locked,
                      hoverId: focusedWallComp.left.neighborId,
                      onEdit: () => {
                        const t = focusedWallComp.target!;
                        const c = focusedWallComp.left!;
                        if (c.locked) {
                          onConstraintError?.('Component or wall is locked.');
                          return;
                        }
                        const mx = (mapX(c.startS) + mapX(c.endS)) / 2;
                        openElevEditor({
                          key: `clear_left:${t.id}`,
                          kind: 'clearance_left',
                          wallId: targetWall.id,
                          compId: t.id,
                          label:
                            c.stopsAt === 'component'
                              ? `Gap to ${c.neighborName}`
                              : 'Distance to Left Corner',
                          valueStr: String(Math.round((c.lengthMm / 10) * 10) / 10),
                          worldX: mx,
                          worldY: 295,
                        });
                      },
                    })}

                  {/* Non-Crossing Right Clearance */}
                  {focusedWallComp.right && focusedWallComp.right.lengthMm >= 1 &&
                    renderElevDim({
                      dimKey: `clear_right:${focusedWallComp.target.id}`,
                      x1: Math.min(mapX(focusedWallComp.right.startS), mapX(focusedWallComp.right.endS)),
                      y1: 295,
                      x2: Math.max(mapX(focusedWallComp.right.startS), mapX(focusedWallComp.right.endS)),
                      y2: 295,
                      ext1x: Math.min(mapX(focusedWallComp.right.startS), mapX(focusedWallComp.right.endS)),
                      ext1y: 0,
                      ext2x: Math.max(mapX(focusedWallComp.right.startS), mapX(focusedWallComp.right.endS)),
                      ext2y: 0,
                      valueMm: focusedWallComp.right.lengthMm,
                      locked: focusedWallComp.right.locked,
                      hoverId: focusedWallComp.right.neighborId,
                      onEdit: () => {
                        const t = focusedWallComp.target!;
                        const c = focusedWallComp.right!;
                        if (c.locked) {
                          onConstraintError?.('Component or wall is locked.');
                          return;
                        }
                        const mx = (mapX(c.startS) + mapX(c.endS)) / 2;
                        openElevEditor({
                          key: `clear_right:${t.id}`,
                          kind: 'clearance_right',
                          wallId: targetWall.id,
                          compId: t.id,
                          label:
                            c.stopsAt === 'component'
                              ? `Gap to ${c.neighborName}`
                              : 'Distance to Right Corner',
                          valueStr: String(Math.round((c.lengthMm / 10) * 10) / 10),
                          worldX: mx,
                          worldY: 295,
                        });
                      },
                    })}
                </>
              ) : (
                <>
                  {/* All Segments along selected wall */}
                  {wallChain.segments.map((seg) => {
                    const xA = Math.min(mapX(seg.startS), mapX(seg.endS));
                    const xB = Math.max(mapX(seg.startS), mapX(seg.endS));
                    return renderElevDim({
                      dimKey: seg.key,
                      x1: xA,
                      y1: 295,
                      x2: xB,
                      y2: 295,
                      ext1x: xA,
                      ext1y: 0,
                      ext2x: xB,
                      ext2y: 0,
                      valueMm: seg.lengthMm,
                      locked: seg.locked,
                      hoverId: seg.componentId,
                      onEdit: () => {
                        if (seg.locked) {
                          onConstraintError?.('Segment is locked.');
                          return;
                        }
                        if (seg.kind === 'component' && seg.componentId) {
                          openElevEditor({
                            key: seg.key,
                            kind: 'component_width',
                            wallId: targetWall.id,
                            compId: seg.componentId,
                            label: `${seg.label} Width`,
                            valueStr: String(Math.round((seg.lengthMm / 10) * 10) / 10),
                            worldX: (xA + xB) / 2,
                            worldY: 295,
                          });
                        } else if (wallChain.components.length > 0) {
                          const nextComp = wallChain.components.find((c) => c.leftS >= seg.endS - 2);
                          const prevComp = [...wallChain.components]
                            .reverse()
                            .find((c) => c.rightS <= seg.startS + 2);
                          const adj = nextComp ?? prevComp;
                          if (!adj) return;
                          if (adj.locked) {
                            onConstraintError?.(`"${adj.name}" is locked.`);
                            return;
                          }
                          openElevEditor({
                            key: seg.key,
                            kind: nextComp ? 'clearance_left' : 'clearance_right',
                            wallId: targetWall.id,
                            compId: adj.id,
                            label: `${adj.name} ${nextComp ? 'Left' : 'Right'} Wall Gap`,
                            valueStr: String(Math.round((seg.lengthMm / 10) * 10) / 10),
                            worldX: (xA + xB) / 2,
                            worldY: 295,
                          });
                        }
                      },
                    });
                  })}

                  {/* Overall Bottom Wall Length */}
                  {renderElevDim({
                    dimKey: `wall_total:${targetWall.id}`,
                    x1: 0,
                    y1: 520,
                    x2: wallMetrics.lenMm,
                    y2: 520,
                    ext1x: 0,
                    ext1y: 180,
                    ext2x: wallMetrics.lenMm,
                    ext2y: 180,
                    valueMm: wallMetrics.lenMm,
                    locked: targetWall.locked || targetWall.anchorMode === 'fixed_length',
                    onEdit: () => {
                      if (targetWall.locked || targetWall.anchorMode === 'fixed_length') {
                        onConstraintError?.(
                          targetWall.locked
                            ? 'Wall is locked.'
                            : 'Wall length is anchored as Fixed Total Length.'
                        );
                        return;
                      }
                      openElevEditor({
                        key: `wall_total:${targetWall.id}`,
                        kind: 'wall_length',
                        wallId: targetWall.id,
                        label: 'Wall Total Length',
                        valueStr: String(Math.round((wallMetrics.lenMm / 10) * 10) / 10),
                        worldX: wallMetrics.lenMm / 2,
                        worldY: 520,
                      });
                    },
                  })}
                </>
              )}

              {/* Left Overall Wall Height */}
              {renderElevDim({
                dimKey: `wall_h:${targetWall.id}`,
                x1: -leftCapW - 150,
                y1: 0,
                x2: -leftCapW - 150,
                y2: -wallMetrics.heightMm,
                ext1x: -leftCapW,
                ext1y: 0,
                ext2x: -leftCapW,
                ext2y: -wallMetrics.heightMm,
                valueMm: wallMetrics.heightMm,
                locked: targetWall.locked,
                vertical: true,
                onEdit: () => {
                  if (targetWall.locked) {
                    onConstraintError?.('Wall is locked.');
                    return;
                  }
                  openElevEditor({
                    key: `wall_h:${targetWall.id}`,
                    kind: 'wall_height',
                    wallId: targetWall.id,
                    label: 'Wall Height',
                    valueStr: String(Math.round((wallMetrics.heightMm / 10) * 10) / 10),
                    worldX: -leftCapW - 150,
                    worldY: -wallMetrics.heightMm / 2,
                  });
                },
              })}
            </g>
          )}
        </g>
      </svg>

      {/* Top-Right Floating Wall Selection Map (only in Cut-Through mode) */}
      <div
        data-testid="cutthrough-floating-wall-selector"
        className="absolute top-14 right-3 z-20 w-[228px] bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden text-xs"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setWallMapOpen((o) => !o)}
          className="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 bg-slate-50/90 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 border-b border-slate-200 dark:border-slate-700 cursor-pointer"
        >
          <span className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
            <MapIcon className="w-3.5 h-3.5 text-blue-600" />
            <span>Select Wall</span>
          </span>
          <span className="flex items-center gap-1 text-[10px] font-mono-nums text-slate-500 dark:text-slate-400">
            <span>
              {visibleWallsList.findIndex((w) => w.id === targetWall.id) + 1}/{visibleWallsList.length}
            </span>
            {wallMapOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        </button>
        {wallMapOpen && (
          <div className="p-2">
            <div className="h-[145px] w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 overflow-hidden">
              <WallMiniSelectorMap
                walls={visibleWallsList}
                activeWallId={targetWall.id}
                compact
                onSelectWall={(wallId) => onSelect([{ kind: 'wall', id: wallId }])}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 px-0.5">
              <span>Click wall dot to switch</span>
              <span className="font-mono-nums font-semibold text-blue-600 dark:text-blue-400">
                {formatSmartMetric(wallMetrics.lenMm)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Live Drag Readout Badge */}
      {liveDragBadge && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-lg bg-slate-900/95 text-white text-xs font-mono-nums shadow-md border border-slate-700">
          {liveDragBadge}
        </div>
      )}

      {/* Inline Cut-Through Dimension Editor */}
      {editingDim && (
        <div
          style={{
            left: `${Math.max(12, Math.min(size.width - 230, editingDim.screenX - 105))}px`,
            top: `${Math.max(52, Math.min(size.height - 96, editingDim.screenY - 24))}px`,
          }}
          className="absolute z-40 w-[216px] bg-white dark:bg-slate-900 border border-blue-500 rounded-lg shadow-xl p-2 text-xs"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1 font-medium">
            <span className="truncate">{editingDim.label}</span>
            <span>Enter · Esc</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              type="number"
              step="0.5"
              value={editingDim.valueStr}
              onChange={(e) =>
                setEditingDim((d) => (d ? { ...d, valueStr: e.target.value, error: null } : null))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  commitElevDimEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingDim(null);
                }
              }}
              className="w-full px-2 py-1 font-mono-nums text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-[11px] font-mono-nums text-slate-500 shrink-0">cm</span>
            <button
              type="button"
              onClick={commitElevDimEdit}
              className="px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 cursor-pointer shrink-0"
            >
              OK
            </button>
          </div>
          {editingDim.error && (
            <p className="mt-1 text-[10px] text-red-600 dark:text-red-400 leading-tight">
              {editingDim.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
