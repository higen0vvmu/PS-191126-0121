import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Grid3X3,
  Layers,
  Minus,
  MousePointer2,
  PenTool,
  Redo2,
  RotateCcw,
  Slash,
  Square,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  FurnitureInstance,
  FurnitureRepresentation,
  Point2D,
  ProjectedViewSvg,
  ProjectionViewId,
  RepresentationMode,
  SvgEllipseElementData,
  SvgLineElementData,
  SvgPathElementData,
  SvgPolylineElementData,
  SvgRectElementData,
  SvgVectorElement,
} from '../types/plan';
import { computeFurnitureBoundsMm } from '../utils/geometry';
import { computeFurnitureRepresentationAsync } from '../utils/furnitureRepresentationSync';
import {
  generateDefaultTopViewFromParts,
  hasValidDefaultSvg,
  isBuiltinCatalogItem,
  isValidSvgSource,
  parseSvgSourceToProjectedView,
  resolveEffectiveRepresentationMode,
} from '../utils/svgImport';
import { renderSingleSvgVectorElement } from '../utils/svgRepresentationRenderer';
import { uid } from '../utils/units';

interface SvgRepresentationEditorModalProps {
  furniture: FurnitureInstance;
  onClose: () => void;
  onSaveRepresentation: (nextRepresentation: FurnitureRepresentation) => void;
}

type EditorDrawTool = 'select' | 'line' | 'polyline' | 'rect' | 'ellipse' | 'arc';

const PROJECTION_TABS: Array<{ id: ProjectionViewId; label: string }> = [
  { id: 'top', label: 'Top (Plan)' },
  { id: 'front', label: 'Front' },
  { id: 'rear', label: 'Rear' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
];

const QUICK_COLORS = ['#0F172A', '#334155', '#64748B', '#2563EB', '#DC2626', '#FFFFFF', '#E2E8F0'];

function cloneElements(els: SvgVectorElement[] | undefined): SvgVectorElement[] {
  if (!els) return [];
  return els.map((e) =>
    e.kind === 'polyline'
      ? { ...e, points: e.points.map((p) => ({ ...p })) }
      : { ...e }
  );
}

function getFallbackBoxForView(
  bounds: { widthMm: number; depthMm: number; heightMm: number },
  view: ProjectionViewId
): { minX: number; minY: number; width: number; height: number } {
  if (view === 'top') {
    return {
      minX: -bounds.widthMm / 2,
      minY: -bounds.depthMm / 2,
      width: bounds.widthMm,
      height: bounds.depthMm,
    };
  }
  const w = view === 'front' || view === 'rear' ? bounds.widthMm : bounds.depthMm;
  return {
    minX: -w / 2,
    minY: -bounds.heightMm,
    width: w,
    height: bounds.heightMm,
  };
}

function getElementBBox(el: SvgVectorElement): { minX: number; minY: number; maxX: number; maxY: number } {
  switch (el.kind) {
    case 'line':
      return {
        minX: Math.min(el.x1, el.x2),
        minY: Math.min(el.y1, el.y2),
        maxX: Math.max(el.x1, el.x2),
        maxY: Math.max(el.y1, el.y2),
      };
    case 'rect':
      return {
        minX: el.x,
        minY: el.y,
        maxX: el.x + el.width,
        maxY: el.y + el.height,
      };
    case 'ellipse':
      return {
        minX: el.cx - el.rx,
        minY: el.cy - el.ry,
        maxX: el.cx + el.rx,
        maxY: el.cy + el.ry,
      };
    case 'polyline': {
      if (el.points.length === 0) return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of el.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY };
    }
    case 'path': {
      const tokens = el.d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
      if (!tokens) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let cmd = '';
      let argIdx = 0;
      let curX = 0;
      let curY = 0;
      let arcRx = 0;
      let arcRy = 0;
      const expandPt = (px: number, py: number) => {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      };
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (/^[a-zA-Z]$/.test(tok)) {
          cmd = tok;
          argIdx = 0;
          continue;
        }
        const val = Number(tok);
        if (!Number.isFinite(val)) continue;
        const upper = cmd.toUpperCase();
        if (upper === 'Z') continue;
        if (upper === 'H') {
          curX = cmd === 'h' ? curX + val : val;
          expandPt(curX, curY);
        } else if (upper === 'V') {
          curY = cmd === 'v' ? curY + val : val;
          expandPt(curX, curY);
        } else if (upper === 'A') {
          const mod = argIdx % 7;
          if (mod === 0) arcRx = val;
          else if (mod === 1) arcRy = val;
          else if (mod === 5) curX = cmd === 'a' ? curX + val : val;
          else if (mod === 6) {
            curY = cmd === 'a' ? curY + val : val;
            expandPt(curX, curY);
            // Expand to approximate arc bulge envelope
            expandPt(curX - arcRx, curY - arcRy);
            expandPt(curX + arcRx, curY + arcRy);
          }
        } else {
          if (argIdx % 2 === 0) {
            curX = cmd === cmd.toLowerCase() ? curX + val : val;
          } else {
            curY = cmd === cmd.toLowerCase() ? curY + val : val;
            expandPt(curX, curY);
          }
        }
        argIdx++;
      }
      if (!Number.isFinite(minX)) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
      return { minX, minY, maxX, maxY };
    }
  }
}

function translatePathD(d: string, dx: number, dy: number): string {
  // Parse SVG path tokens (commands + arguments) for clean translation of M/L/C/Q/H/V/A/Z paths
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return d;
  const out: string[] = [];
  let cmd = '';
  let coordIdx = 0;
  for (const tok of tokens) {
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok;
      coordIdx = 0;
      out.push(tok);
      continue;
    }
    const val = Number(tok);
    const isRel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();
    if (isRel || upper === 'Z') {
      out.push(tok);
      continue;
    }
    if (upper === 'H') {
      out.push(String(Math.round((val + dx) * 10) / 10));
    } else if (upper === 'V') {
      out.push(String(Math.round((val + dy) * 10) / 10));
    } else if (upper === 'A') {
      const mod = coordIdx % 7;
      if (mod === 5) out.push(String(Math.round((val + dx) * 10) / 10));
      else if (mod === 6) out.push(String(Math.round((val + dy) * 10) / 10));
      else out.push(tok);
    } else {
      const shifted = coordIdx % 2 === 0 ? val + dx : val + dy;
      out.push(String(Math.round(shifted * 10) / 10));
    }
    coordIdx++;
  }
  return out.join(' ');
}

function transformPathD(d: string, cx: number, cy: number, sx: number, sy: number, rotDeg = 0): string {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return d;
  const rad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out: string[] = [];
  let cmd = '';
  let pair: number[] = [];
  let arcArgs: number[] = [];

  const flushPair = () => {
    if (pair.length === 2) {
      const lx = (pair[0] - cx) * sx;
      const ly = (pair[1] - cy) * sy;
      const rx = cx + lx * cos - ly * sin;
      const ry = cy + lx * sin + ly * cos;
      out.push(String(Math.round(rx * 10) / 10), String(Math.round(ry * 10) / 10));
      pair = [];
    }
  };

  const flushArc = () => {
    if (arcArgs.length === 7) {
      const [rx0, ry0, xrot0, largeFlag, sweepFlag, px, py] = arcArgs;
      const rx1 = Math.max(1, Math.round(rx0 * Math.abs(sx) * 10) / 10);
      const ry1 = Math.max(1, Math.round(ry0 * Math.abs(sy) * 10) / 10);
      const xrot1 = Math.round(((xrot0 + rotDeg) % 360) * 10) / 10;
      const lx = (px - cx) * sx;
      const ly = (py - cy) * sy;
      const tx = cx + lx * cos - ly * sin;
      const ty = cy + lx * sin + ly * cos;
      out.push(
        String(rx1),
        String(ry1),
        String(xrot1),
        String(largeFlag),
        String(sweepFlag),
        String(Math.round(tx * 10) / 10),
        String(Math.round(ty * 10) / 10)
      );
      arcArgs = [];
    }
  };

  for (const tok of tokens) {
    if (/^[a-zA-Z]$/.test(tok)) {
      flushPair();
      flushArc();
      cmd = tok;
      out.push(tok);
      continue;
    }
    const val = Number(tok);
    const upper = cmd.toUpperCase();
    if (upper === 'Z' || cmd === cmd.toLowerCase()) {
      out.push(tok);
      continue;
    }
    if (upper === 'A') {
      arcArgs.push(val);
      if (arcArgs.length === 7) flushArc();
      continue;
    }
    if (upper === 'H') {
      const tx = cx + (val - cx) * sx;
      out.push(String(Math.round(tx * 10) / 10));
      continue;
    }
    if (upper === 'V') {
      const ty = cy + (val - cy) * sy;
      out.push(String(Math.round(ty * 10) / 10));
      continue;
    }
    pair.push(val);
    if (pair.length === 2) {
      flushPair();
    }
  }
  flushPair();
  flushArc();
  return out.join(' ');
}

function translateVectorElement(el: SvgVectorElement, dx: number, dy: number): SvgVectorElement {
  switch (el.kind) {
    case 'line':
      return { ...el, x1: Math.round(el.x1 + dx), y1: Math.round(el.y1 + dy), x2: Math.round(el.x2 + dx), y2: Math.round(el.y2 + dy) };
    case 'rect':
      return { ...el, x: Math.round(el.x + dx), y: Math.round(el.y + dy) };
    case 'ellipse':
      return { ...el, cx: Math.round(el.cx + dx), cy: Math.round(el.cy + dy) };
    case 'polyline':
      return { ...el, points: el.points.map((p) => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) })) };
    case 'path':
      return { ...el, d: translatePathD(el.d, dx, dy) };
  }
}

function scaleOrRotateVectorElement(
  el: SvgVectorElement,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  rotDegDelta = 0
): SvgVectorElement {
  switch (el.kind) {
    case 'rect': {
      const ncx = cx + (el.x + el.width / 2 - cx) * sx;
      const ncy = cy + (el.y + el.height / 2 - cy) * sy;
      const nw = Math.max(8, Math.round(el.width * sx));
      const nh = Math.max(8, Math.round(el.height * sy));
      return {
        ...el,
        x: Math.round(ncx - nw / 2),
        y: Math.round(ncy - nh / 2),
        width: nw,
        height: nh,
        rotationDeg: ((el.rotationDeg ?? 0) + rotDegDelta) % 360,
      };
    }
    case 'ellipse':
      return {
        ...el,
        cx: Math.round(cx + (el.cx - cx) * sx),
        cy: Math.round(cy + (el.cy - cy) * sy),
        rx: Math.max(5, Math.round(el.rx * sx)),
        ry: Math.max(5, Math.round(el.ry * sy)),
        rotationDeg: ((el.rotationDeg ?? 0) + rotDegDelta) % 360,
      };
    case 'line': {
      const rad = (rotDegDelta * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const mapPt = (px: number, py: number) => {
        const lx = (px - cx) * sx;
        const ly = (py - cy) * sy;
        return {
          x: Math.round(cx + lx * cos - ly * sin),
          y: Math.round(cy + lx * sin + ly * cos),
        };
      };
      const a = mapPt(el.x1, el.y1);
      const b = mapPt(el.x2, el.y2);
      return { ...el, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case 'polyline': {
      const rad = (rotDegDelta * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return {
        ...el,
        points: el.points.map((p) => {
          const lx = (p.x - cx) * sx;
          const ly = (p.y - cy) * sy;
          return {
            x: Math.round(cx + lx * cos - ly * sin),
            y: Math.round(cy + lx * sin + ly * cos),
          };
        }),
      };
    }
    case 'path':
      return { ...el, d: transformPathD(el.d, cx, cy, sx, sy, rotDegDelta) };
  }
}

export const SvgRepresentationEditorModal: React.FC<SvgRepresentationEditorModalProps> = ({
  furniture,
  onClose,
  onSaveRepresentation,
}) => {
  const bounds = useMemo(() => computeFurnitureBoundsMm(furniture.parts), [furniture.parts]);
  const allowDefault = useMemo(() => hasValidDefaultSvg(furniture), [furniture]);
  const [activeView, setActiveView] = useState<ProjectionViewId>('top');
  const [mode, setMode] = useState<RepresentationMode>(() => resolveEffectiveRepresentationMode(furniture));
  const [useMaterialFill, setUseMaterialFill] = useState<boolean>(
    Boolean(furniture.representation?.useMaterialFill)
  );
  const [defaultViews] = useState<Partial<Record<ProjectionViewId, ProjectedViewSvg>>>(() => {
    const existing = furniture.representation?.defaultViews ?? {};
    if (!existing.top && typeof furniture.svgSource === 'string' && isValidSvgSource(furniture.svgSource)) {
      const parsed = parseSvgSourceToProjectedView(
        furniture.svgSource,
        bounds.widthMm,
        bounds.depthMm
      );
      if (parsed) {
        return { ...existing, top: parsed.view };
      }
    }
    return existing;
  });
  const builtinDefaultTopView = useMemo(() => {
    if (defaultViews.top || typeof furniture.svgSource === 'string' || !isBuiltinCatalogItem(furniture)) {
      return null;
    }
    return generateDefaultTopViewFromParts(furniture.parts);
  }, [defaultViews.top, furniture]);
  const [autoViews, setAutoViews] = useState<Partial<Record<ProjectionViewId, ProjectedViewSvg>>>(
    () => furniture.representation?.autoViews ?? {}
  );
  const [geometrySignature, setGeometrySignature] = useState<string | undefined>(
    () => furniture.representation?.geometrySignature
  );
  const [customViews, setCustomViews] = useState<Partial<Record<ProjectionViewId, SvgVectorElement[]>>>(
    () => {
      const src = furniture.representation?.customViews ?? {};
      const out: Partial<Record<ProjectionViewId, SvgVectorElement[]>> = {};
      for (const tab of PROJECTION_TABS) {
        if (Array.isArray(src[tab.id])) {
          out[tab.id] = cloneElements(src[tab.id]);
        }
      }
      return out;
    }
  );
  const [customUpdatedAt, setCustomUpdatedAt] = useState<Partial<Record<ProjectionViewId, string>>>(
    () => ({ ...(furniture.representation?.customViewUpdatedAt ?? {}) })
  );

  // History for modal undo/redo
  const [undoStack, setUndoStack] = useState<Array<Partial<Record<ProjectionViewId, SvgVectorElement[]>>>>([]);
  const [redoStack, setRedoStack] = useState<Array<Partial<Record<ProjectionViewId, SvgVectorElement[]>>>>([]);

  const [tool, setTool] = useState<EditorDrawTool>('select');
  const [selectedElId, setSelectedElId] = useState<string | null>(null);
  const [showAutoGhost, setShowAutoGhost] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [snapGridMm, setSnapGridMm] = useState(10);
  const [zoom, setZoom] = useState(1);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRestoreScope, setConfirmRestoreScope] = useState<'current' | 'all' | 'mode_change' | null>(null);
  const [pendingModeChange, setPendingModeChange] = useState<RepresentationMode | null>(null);

  // Interactive drawing / dragging states
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draftStart, setDraftStart] = useState<Point2D | null>(null);
  const [draftCurrent, setDraftCurrent] = useState<Point2D | null>(null);
  const [polyPoints, setPolyPoints] = useState<Point2D[]>([]);
  const [dragOp, setDragOp] = useState<{
    kind: 'move' | 'resize' | 'rotate';
    elId: string;
    startPt: Point2D;
    origEl: SvgVectorElement;
    origBBox: { minX: number; minY: number; maxX: number; maxY: number };
    handle?: string;
  } | null>(null);

  // Generate autoViews if missing initially (keep 'default' mode intact; compute 'silhouette' fallback for 3D elevation tabs)
  useEffect(() => {
    if (autoViews.top && autoViews.front && autoViews.rear && autoViews.left && autoViews.right) {
      return;
    }
    let cancelled = false;
    setRegenerating(true);
    const computeMode: RepresentationMode = mode === 'default' ? 'silhouette' : mode;
    void computeFurnitureRepresentationAsync(furniture, { mode: computeMode }).then((rep) => {
      if (cancelled) return;
      if (rep.autoViews) {
        setAutoViews(rep.autoViews);
      }
      if (rep.geometrySignature) {
        setGeometrySignature(rep.geometrySignature);
      }
      setRegenerating(false);
    });
    return () => {
      cancelled = true;
    };
  }, [furniture, mode, autoViews.top, autoViews.front, autoViews.rear, autoViews.left, autoViews.right]);

  const activeAutoView = useMemo(() => {
    if (mode === 'default') {
      const def = defaultViews[activeView];
      if (def) return def;
      if (activeView === 'top' && builtinDefaultTopView) return builtinDefaultTopView;
    }
    return autoViews[activeView];
  }, [mode, defaultViews, activeView, builtinDefaultTopView, autoViews]);
  const viewBox = useMemo(() => {
    return activeAutoView?.viewBox ?? getFallbackBoxForView(bounds, activeView);
  }, [activeAutoView, bounds, activeView]);

  const activeElements: SvgVectorElement[] = useMemo(() => {
    const c = customViews[activeView];
    if (Array.isArray(c)) return c;
    return activeAutoView?.elements ?? [];
  }, [customViews, activeView, activeAutoView]);

  const isCurrentViewCustomized = Array.isArray(customViews[activeView]);
  const selectedEl = activeElements.find((e) => e.id === selectedElId) ?? null;

  const pushHistorySnapshot = useCallback((snapshot: Partial<Record<ProjectionViewId, SvgVectorElement[]>>) => {
    setUndoStack((prev) => [...prev.slice(-39), snapshot]);
    setRedoStack([]);
  }, []);

  const mutateActiveElements = useCallback(
    (updater: (prev: SvgVectorElement[]) => SvgVectorElement[], recordHistory = true) => {
      setCustomViews((prev) => {
        if (recordHistory) {
          pushHistorySnapshot(prev);
        }
        const currentBase = Array.isArray(prev[activeView])
          ? cloneElements(prev[activeView])
          : cloneElements(activeAutoView?.elements ?? []);
        return {
          ...prev,
          [activeView]: updater(currentBase),
        };
      });
      setCustomUpdatedAt((prev) => ({ ...prev, [activeView]: new Date().toISOString() }));
    },
    [activeView, activeAutoView, pushHistorySnapshot]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prevSnap = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, customViews]);
    setUndoStack((u) => u.slice(0, -1));
    setCustomViews(prevSnap);
  }, [customViews, undoStack]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextSnap = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, customViews]);
    setRedoStack((r) => r.slice(0, -1));
    setCustomViews(nextSnap);
  }, [customViews, redoStack]);

  const executeRestore = async (scope: 'current' | 'all' | 'mode_change', nextMode?: RepresentationMode) => {
    setRegenerating(true);
    const targetMode = nextMode ?? mode;
    if (targetMode !== 'default') {
      const rep = await computeFurnitureRepresentationAsync(furniture, {
        mode: targetMode,
        useMaterialFill,
        preserveCustomViews: false,
      });
      if (rep.autoViews) {
        setAutoViews(rep.autoViews);
      }
      if (rep.geometrySignature) {
        setGeometrySignature(rep.geometrySignature);
      }
    }
    if (scope === 'current') {
      pushHistorySnapshot(customViews);
      setCustomViews((prev) => {
        const next = { ...prev };
        delete next[activeView];
        return next;
      });
      setSelectedElId(null);
    } else {
      pushHistorySnapshot(customViews);
      setCustomViews({});
      setCustomUpdatedAt({});
      setSelectedElId(null);
      if (nextMode) setMode(nextMode);
    }
    setRegenerating(false);
    setConfirmRestoreScope(null);
    setPendingModeChange(null);
  };

  const handleModeSwitch = async (nextMode: RepresentationMode) => {
    if (nextMode === mode) return;
    if (nextMode === 'default') {
      if (!allowDefault) return;
      setMode('default');
      return;
    }
    const hasAnyCustom = PROJECTION_TABS.some((t) => Array.isArray(customViews[t.id]));
    setMode(nextMode);
    setRegenerating(true);
    const rep = await computeFurnitureRepresentationAsync(furniture, {
      mode: nextMode,
      useMaterialFill,
      preserveCustomViews: hasAnyCustom,
    });
    if (rep.autoViews) setAutoViews(rep.autoViews);
    if (rep.geometrySignature) setGeometrySignature(rep.geometrySignature);
    setRegenerating(false);
  };

  const snapCoord = useCallback(
    (v: number) => (snapGridMm > 0 ? Math.round(v / snapGridMm) * snapGridMm : Math.round(v)),
    [snapGridMm]
  );

  const clientToSvgMm = useCallback(
    (clientX: number, clientY: number): Point2D => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const pad = Math.max(viewBox.width, viewBox.height) * 0.25 + 60;
      const vbW = (viewBox.width + pad * 2) / zoom;
      const vbH = (viewBox.height + pad * 2) / zoom;
      const cx = viewBox.minX + viewBox.width / 2;
      const cy = viewBox.minY + viewBox.height / 2;
      const vbMinX = cx - vbW / 2;
      const vbMinY = cy - vbH / 2;
      const nx = (clientX - rect.left) / Math.max(1, rect.width);
      const ny = (clientY - rect.top) / Math.max(1, rect.height);
      return {
        x: snapCoord(vbMinX + nx * vbW),
        y: snapCoord(vbMinY + ny * vbH),
      };
    },
    [snapCoord, viewBox, zoom]
  );

  const pad = Math.max(viewBox.width, viewBox.height) * 0.25 + 60;
  const zoomedVbW = (viewBox.width + pad * 2) / zoom;
  const zoomedVbH = (viewBox.height + pad * 2) / zoom;
  const vbCenterX = viewBox.minX + viewBox.width / 2;
  const vbCenterY = viewBox.minY + viewBox.height / 2;
  const zoomedMinX = vbCenterX - zoomedVbW / 2;
  const zoomedMinY = vbCenterY - zoomedVbH / 2;

  const commitPolyline = useCallback(
    (pts: Point2D[], closed = false) => {
      if (pts.length < 2) {
        setPolyPoints([]);
        return;
      }
      const newPoly: SvgPolylineElementData = {
        id: uid('svg_poly'),
        kind: 'polyline',
        name: closed ? 'Custom Polygon' : 'Custom Path',
        points: pts,
        closed,
        stroke: '#0F172A',
        strokeWidthMm: 10,
        fill: closed ? '#FFFFFF' : 'none',
        fillOpacity: closed ? 1 : 0,
        visible: true,
      };
      mutateActiveElements((els) => [...els, newPoly]);
      setSelectedElId(newPoly.id);
      setPolyPoints([]);
      setTool('select');
    },
    [mutateActiveElements]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElId) {
        e.preventDefault();
        mutateActiveElements((els) => els.filter((x) => x.id !== selectedElId));
        setSelectedElId(null);
      } else if (e.key === 'Enter' && tool === 'polyline' && polyPoints.length >= 2) {
        e.preventDefault();
        commitPolyline(polyPoints, false);
      } else if (e.key === 'Escape') {
        setPolyPoints([]);
        setDraftStart(null);
        setDraftCurrent(null);
        setDragOp(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commitPolyline, handleRedo, handleUndo, mutateActiveElements, polyPoints, selectedElId, tool]);

  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const pt = clientToSvgMm(e.clientX, e.clientY);

    if (tool === 'polyline') {
      setPolyPoints((prev) => [...prev, pt]);
      return;
    }

    if (tool === 'arc') {
      const r = Math.max(80, Math.round(Math.min(viewBox.width, viewBox.height) * 0.28));
      const arcEl: SvgPathElementData = {
        id: uid('svg_arc'),
        kind: 'path',
        name: 'Architectural Arc',
        d: `M ${pt.x - r} ${pt.y} A ${r} ${r} 0 0 1 ${pt.x + r} ${pt.y}`,
        stroke: '#0F172A',
        strokeWidthMm: 10,
        fill: 'none',
        fillOpacity: 0,
        visible: true,
      };
      mutateActiveElements((els) => [...els, arcEl]);
      setSelectedElId(arcEl.id);
      setTool('select');
      return;
    }

    if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      setDraftStart(pt);
      setDraftCurrent(pt);
      return;
    }

    // Deselect when clicking empty space in select mode
    setSelectedElId(null);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pt = clientToSvgMm(e.clientX, e.clientY);
    if (draftStart) {
      setDraftCurrent(pt);
      return;
    }
    if (dragOp) {
      const dx = pt.x - dragOp.startPt.x;
      const dy = pt.y - dragOp.startPt.y;
      const b = dragOp.origBBox;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;

      setCustomViews((prev) => {
        const baseList = Array.isArray(prev[activeView])
          ? prev[activeView]!
          : cloneElements(activeAutoView?.elements ?? []);
        return {
          ...prev,
          [activeView]: baseList.map((el) => {
            if (el.id !== dragOp.elId) return el;
            if (dragOp.kind === 'move') {
              return translateVectorElement(dragOp.origEl, dx, dy);
            }
            if (dragOp.kind === 'resize') {
              const origW = Math.max(20, b.maxX - b.minX);
              const origH = Math.max(20, b.maxY - b.minY);
              const sx = Math.max(0.15, (origW + (dragOp.handle?.includes('w') ? -dx : dx) * 2) / origW);
              const sy = Math.max(0.15, (origH + (dragOp.handle?.includes('n') ? -dy : dy) * 2) / origH);
              return scaleOrRotateVectorElement(dragOp.origEl, cx, cy, sx, sy, 0);
            }
            if (dragOp.kind === 'rotate') {
              const ang0 = Math.atan2(dragOp.startPt.y - cy, dragOp.startPt.x - cx);
              const ang1 = Math.atan2(pt.y - cy, pt.x - cx);
              const deltaDeg = Math.round(((ang1 - ang0) * 180) / Math.PI);
              return scaleOrRotateVectorElement(dragOp.origEl, cx, cy, 1, 1, deltaDeg);
            }
            return el;
          }),
        };
      });
    }
  };

  const handleCanvasPointerUp = () => {
    if (dragOp) {
      setCustomUpdatedAt((prev) => ({ ...prev, [activeView]: new Date().toISOString() }));
      setDragOp(null);
      return;
    }
    if (draftStart && draftCurrent) {
      const distMoved = Math.hypot(draftCurrent.x - draftStart.x, draftCurrent.y - draftStart.y);
      if (distMoved >= 10) {
        if (tool === 'line') {
          const newLine: SvgLineElementData = {
            id: uid('svg_line'),
            kind: 'line',
            name: 'Line',
            x1: draftStart.x,
            y1: draftStart.y,
            x2: draftCurrent.x,
            y2: draftCurrent.y,
            stroke: '#0F172A',
            strokeWidthMm: 10,
            visible: true,
          };
          mutateActiveElements((els) => [...els, newLine]);
          setSelectedElId(newLine.id);
        } else if (tool === 'rect') {
          const newRect: SvgRectElementData = {
            id: uid('svg_rect'),
            kind: 'rect',
            name: 'Rectangle',
            x: Math.min(draftStart.x, draftCurrent.x),
            y: Math.min(draftStart.y, draftCurrent.y),
            width: Math.max(15, Math.abs(draftCurrent.x - draftStart.x)),
            height: Math.max(15, Math.abs(draftCurrent.y - draftStart.y)),
            stroke: '#0F172A',
            strokeWidthMm: 10,
            fill: '#FFFFFF',
            fillOpacity: 1,
            visible: true,
          };
          mutateActiveElements((els) => [...els, newRect]);
          setSelectedElId(newRect.id);
        } else if (tool === 'ellipse') {
          const newEllipse: SvgEllipseElementData = {
            id: uid('svg_ell'),
            kind: 'ellipse',
            name: 'Ellipse / Circle',
            cx: Math.round((draftStart.x + draftCurrent.x) / 2),
            cy: Math.round((draftStart.y + draftCurrent.y) / 2),
            rx: Math.max(10, Math.round(Math.abs(draftCurrent.x - draftStart.x) / 2)),
            ry: Math.max(10, Math.round(Math.abs(draftCurrent.y - draftStart.y) / 2)),
            stroke: '#0F172A',
            strokeWidthMm: 10,
            fill: '#FFFFFF',
            fillOpacity: 1,
            visible: true,
          };
          mutateActiveElements((els) => [...els, newEllipse]);
          setSelectedElId(newEllipse.id);
        }
        setTool('select');
      }
      setDraftStart(null);
      setDraftCurrent(null);
    }
  };

  const updateSelectedElement = (updater: (el: SvgVectorElement) => SvgVectorElement) => {
    if (!selectedElId) return;
    mutateActiveElements((els) => els.map((e) => (e.id === selectedElId ? updater(e) : e)));
  };

  const moveElementOrder = (elId: string, dir: 'up' | 'down') => {
    mutateActiveElements((els) => {
      const idx = els.findIndex((e) => e.id === elId);
      if (idx === -1) return els;
      const target = dir === 'up' ? idx + 1 : idx - 1;
      if (target < 0 || target >= els.length) return els;
      const next = [...els];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleSave = () => {
    const cleanedCustom: Partial<Record<ProjectionViewId, SvgVectorElement[]>> = {};
    for (const tab of PROJECTION_TABS) {
      if (Array.isArray(customViews[tab.id])) {
        cleanedCustom[tab.id] = cloneElements(customViews[tab.id]);
      }
    }
    onSaveRepresentation({
      mode,
      useMaterialFill,
      strokeWidthMm: furniture.representation?.strokeWidthMm ?? 12,
      geometrySignature: geometrySignature ?? furniture.representation?.geometrySignature,
      sourceBoundsMm: furniture.representation?.sourceBoundsMm ?? bounds,
      defaultViews:
        Object.keys(defaultViews).length > 0
          ? defaultViews
          : furniture.representation?.defaultViews,
      autoViews,
      customViews: Object.keys(cleanedCustom).length > 0 ? cleanedCustom : undefined,
      customViewUpdatedAt:
        Object.keys(cleanedCustom).length > 0 ? customUpdatedAt : undefined,
    });
    onClose();
  };

  const selectedBBox = selectedEl ? getElementBBox(selectedEl) : null;
  const strokeBasisMm = Math.max(4, zoomedVbW / 180);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-6xl h-[90vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs">
        {/* TOP MODAL HEADER */}
        <header className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              2D SVG Representation Editor — {furniture.name}
            </h2>
            <p className="text-[11px] text-slate-500">
              Edit 2D plan and elevation drawings independently. Underlying 3D geometry and materials remain unchanged.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden">
              <button
                type="button"
                disabled={undoStack.length === 0}
                onClick={handleUndo}
                title="Undo (Ctrl+Z)"
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={redoStack.length === 0}
                onClick={handleRedo}
                title="Redo (Ctrl+Y)"
                className="p-1.5 border-l border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 cursor-pointer"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              disabled={regenerating}
              onClick={() => {
                if (isCurrentViewCustomized) {
                  setConfirmRestoreScope('current');
                } else {
                  void executeRestore('current');
                }
              }}
              className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{mode === 'default' ? 'Restore Default View' : 'Restore Auto View'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save to Object</span>
            </button>
          </div>
        </header>

        {/* PROJECTION TABS + STYLE BAR */}
        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-lg" role="tablist">
            {PROJECTION_TABS.map((tab) => {
              const isCustomTab = Array.isArray(customViews[tab.id]);
              const active = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setActiveView(tab.id);
                    setSelectedElId(null);
                    setPolyPoints([]);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                  {isCustomTab ? ' *' : ''}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-md">
              {allowDefault && (
                <button
                  type="button"
                  onClick={() => void handleModeSwitch('default')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                    mode === 'default'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Default
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleModeSwitch('silhouette')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                  mode === 'silhouette'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Silhouette
              </button>
              <button
                type="button"
                onClick={() => void handleModeSwitch('hidden_line')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                  mode === 'hidden_line'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Hidden-Line
              </button>
            </div>

            <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={useMaterialFill}
                onChange={(e) => setUseMaterialFill(e.target.checked)}
                className="accent-blue-600"
              />
              Material Fill
            </label>

            <span className="font-mono tabular-nums text-slate-500 whitespace-nowrap">
              {Math.round(viewBox.width)} × {Math.round(viewBox.height)} mm
            </span>
          </div>
        </div>

        {/* MAIN 3-PANE WORKSPACE */}
        <div className="flex-1 grid grid-cols-12 min-h-0">
          {/* LEFT TOOL STRIP */}
          <div className="col-span-2 lg:col-span-2 border-r border-slate-200 dark:border-slate-800 p-3 flex flex-col justify-between gap-3 overflow-y-auto">
            <div className="space-y-3">
              <div className="text-[11px] font-semibold text-slate-500">Drawing Tools</div>
              <div className="grid grid-cols-1 gap-1">
                {(
                  [
                    { id: 'select', label: 'Select / Edit', Icon: MousePointer2 },
                    { id: 'line', label: 'Line', Icon: Slash },
                    { id: 'polyline', label: 'Path / Polyline', Icon: PenTool },
                    { id: 'rect', label: 'Rectangle', Icon: Square },
                    { id: 'ellipse', label: 'Ellipse / Circle', Icon: Circle },
                    { id: 'arc', label: 'Arc Symbol', Icon: Minus },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTool(item.id);
                      setPolyPoints([]);
                    }}
                    className={`px-2.5 py-1.5 rounded-md border text-left flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                      tool === item.id
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 font-medium'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <item.Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>

              {tool === 'polyline' && polyPoints.length > 0 && (
                <div className="p-2 rounded-md border border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/30 space-y-1.5">
                  <div className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                    {polyPoints.length} points placed
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={polyPoints.length < 2}
                      onClick={() => commitPolyline(polyPoints, false)}
                      className="flex-1 py-1 px-2 bg-blue-600 text-white rounded text-[11px] cursor-pointer disabled:opacity-40"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      disabled={polyPoints.length < 3}
                      onClick={() => commitPolyline(polyPoints, true)}
                      className="flex-1 py-1 px-2 bg-slate-800 text-white rounded text-[11px] cursor-pointer disabled:opacity-40"
                    >
                      Closed
                    </button>
                  </div>
                </div>
              )}

              <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
                <div className="text-[11px] font-semibold text-slate-500">Drafting Aids</div>
                <label className="flex items-center gap-2 cursor-pointer text-[11px]">
                  <input
                    type="checkbox"
                    checked={showAutoGhost}
                    onChange={(e) => setShowAutoGhost(e.target.checked)}
                    className="accent-blue-600"
                  />
                  Auto Ghost Underlay
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-[11px]">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                    className="accent-blue-600"
                  />
                  Show Metric Grid
                </label>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Snap Step</label>
                  <select
                    value={snapGridMm}
                    onChange={(e) => setSnapGridMm(Number(e.target.value))}
                    className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-mono tabular-nums"
                  >
                    <option value={0}>Free (1 mm)</option>
                    <option value={5}>5 mm</option>
                    <option value={10}>10 mm</option>
                    <option value={25}>25 mm</option>
                    <option value={50}>50 mm</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 pt-2 flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.4, z * 0.85))}
                className="p-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono tabular-nums text-[11px] text-slate-500">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(4, z * 1.18))}
                className="p-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* CENTER INTERACTIVE SVG CANVAS */}
          <div className="col-span-7 lg:col-span-7 bg-slate-100 dark:bg-slate-950 relative flex items-center justify-center p-4 overflow-hidden">
            <div className="w-full h-full bg-white rounded-lg border border-slate-200 shadow-inner relative overflow-hidden">
              {regenerating && (
                <div className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded bg-slate-900/85 text-white text-[11px]">
                  Computing orthographic projection...
                </div>
              )}
              <svg
                ref={svgRef}
                viewBox={`${zoomedMinX} ${zoomedMinY} ${zoomedVbW} ${zoomedVbH}`}
                className={`w-full h-full select-none ${tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onDoubleClick={() => {
                  if (tool === 'polyline' && polyPoints.length >= 2) {
                    commitPolyline(polyPoints, false);
                  }
                }}
              >
                {/* Crisp white drafting paper background */}
                <rect
                  x={zoomedMinX}
                  y={zoomedMinY}
                  width={zoomedVbW}
                  height={zoomedVbH}
                  fill="#FFFFFF"
                />

                {/* Metric Grid */}
                {showGrid && (
                  <g stroke="#E2E8F0" strokeWidth={strokeBasisMm * 0.35}>
                    {(() => {
                      const step = 100;
                      const startX = Math.floor(zoomedMinX / step) * step;
                      const endX = Math.ceil((zoomedMinX + zoomedVbW) / step) * step;
                      const startY = Math.floor(zoomedMinY / step) * step;
                      const endY = Math.ceil((zoomedMinY + zoomedVbH) / step) * step;
                      const lines: React.ReactNode[] = [];
                      for (let x = startX; x <= endX; x += step) {
                        lines.push(
                          <line
                            key={`gx_${x}`}
                            x1={x}
                            y1={zoomedMinY}
                            x2={x}
                            y2={zoomedMinY + zoomedVbH}
                            stroke={x === 0 ? '#CBD5E1' : '#F1F5F9'}
                          />
                        );
                      }
                      for (let y = startY; y <= endY; y += step) {
                        lines.push(
                          <line
                            key={`gy_${y}`}
                            x1={zoomedMinX}
                            y1={y}
                            x2={zoomedMinX + zoomedVbW}
                            y2={y}
                            stroke={y === 0 ? '#CBD5E1' : '#F1F5F9'}
                          />
                        );
                      }
                      return lines;
                    })()}
                  </g>
                )}

                {/* Reference Object Bounds Frame */}
                <rect
                  x={viewBox.minX}
                  y={viewBox.minY}
                  width={viewBox.width}
                  height={viewBox.height}
                  fill="none"
                  stroke="#CBD5E1"
                  strokeDasharray={`${strokeBasisMm * 3} ${strokeBasisMm * 2}`}
                  strokeWidth={strokeBasisMm * 0.5}
                />

                {/* Optional Ghost Underlay of Auto-Generated 3D Silhouette */}
                {showAutoGhost && isCurrentViewCustomized && activeAutoView?.elements && (
                  <g className="pointer-events-none">
                    {activeAutoView.elements.map((ge) =>
                      renderSingleSvgVectorElement(ge, {
                        baseStrokeMm: strokeBasisMm,
                        ghostMode: true,
                      })
                    )}
                  </g>
                )}

                {/* Optional Material Fill Underlay */}
                {useMaterialFill && !isCurrentViewCustomized && activeAutoView?.fillElements && (
                  <g className="pointer-events-none">
                    {activeAutoView.fillElements.map((fe) =>
                      renderSingleSvgVectorElement(fe, {
                        baseStrokeMm: strokeBasisMm,
                      })
                    )}
                  </g>
                )}

                {/* Active Editable SVG Elements */}
                {activeElements.map((el) => {
                  const isSel = el.id === selectedElId;
                  const useFillClear =
                    useMaterialFill &&
                    !isCurrentViewCustomized &&
                    Boolean(activeAutoView?.fillElements?.length) &&
                    el.id === `sil_${activeView}`;
                  return (
                    <g
                      key={el.id}
                      onPointerDown={(e) => {
                        if (tool !== 'select') return;
                        e.stopPropagation();
                        setSelectedElId(el.id);
                        const pt = clientToSvgMm(e.clientX, e.clientY);
                        pushHistorySnapshot(customViews);
                        setDragOp({
                          kind: 'move',
                          elId: el.id,
                          startPt: pt,
                          origEl: el.kind === 'polyline' ? { ...el, points: el.points.map((p) => ({ ...p })) } : { ...el },
                          origBBox: getElementBBox(el),
                        });
                      }}
                      className={tool === 'select' ? 'cursor-move' : 'cursor-crosshair'}
                    >
                      {renderSingleSvgVectorElement(el, {
                        baseStrokeMm: strokeBasisMm,
                        selected: isSel,
                        overrideFill: useFillClear ? 'none' : undefined,
                      })}
                    </g>
                  );
                })}

                {/* Selection Bounding Box + Resize & Rotate Handles */}
                {selectedEl && selectedBBox && tool === 'select' && (
                  <g>
                    <rect
                      x={selectedBBox.minX - strokeBasisMm}
                      y={selectedBBox.minY - strokeBasisMm}
                      width={Math.max(10, selectedBBox.maxX - selectedBBox.minX + strokeBasisMm * 2)}
                      height={Math.max(10, selectedBBox.maxY - selectedBBox.minY + strokeBasisMm * 2)}
                      fill="none"
                      stroke="#2563EB"
                      strokeDasharray={`${strokeBasisMm * 2.5} ${strokeBasisMm * 1.5}`}
                      strokeWidth={strokeBasisMm * 0.65}
                      className="pointer-events-none"
                    />
                    {/* Corner resize handles */}
                    {[
                      { h: 'nw', x: selectedBBox.minX - strokeBasisMm, y: selectedBBox.minY - strokeBasisMm },
                      { h: 'ne', x: selectedBBox.maxX + strokeBasisMm, y: selectedBBox.minY - strokeBasisMm },
                      { h: 'se', x: selectedBBox.maxX + strokeBasisMm, y: selectedBBox.maxY + strokeBasisMm },
                      { h: 'sw', x: selectedBBox.minX - strokeBasisMm, y: selectedBBox.maxY + strokeBasisMm },
                    ].map((corner) => (
                      <rect
                        key={corner.h}
                        x={corner.x - strokeBasisMm * 1.8}
                        y={corner.y - strokeBasisMm * 1.8}
                        width={strokeBasisMm * 3.6}
                        height={strokeBasisMm * 3.6}
                        fill="#FFFFFF"
                        stroke="#2563EB"
                        strokeWidth={strokeBasisMm * 0.7}
                        className="cursor-nwse-resize"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          const pt = clientToSvgMm(e.clientX, e.clientY);
                          pushHistorySnapshot(customViews);
                          setDragOp({
                            kind: 'resize',
                            elId: selectedEl.id,
                            handle: corner.h,
                            startPt: pt,
                            origEl:
                              selectedEl.kind === 'polyline'
                                ? { ...selectedEl, points: selectedEl.points.map((p) => ({ ...p })) }
                                : { ...selectedEl },
                            origBBox: selectedBBox,
                          });
                        }}
                      />
                    ))}
                    {/* Rotate Handle */}
                    <line
                      x1={(selectedBBox.minX + selectedBBox.maxX) / 2}
                      y1={selectedBBox.minY - strokeBasisMm}
                      x2={(selectedBBox.minX + selectedBBox.maxX) / 2}
                      y2={selectedBBox.minY - strokeBasisMm * 10}
                      stroke="#2563EB"
                      strokeWidth={strokeBasisMm * 0.65}
                      className="pointer-events-none"
                    />
                    <circle
                      cx={(selectedBBox.minX + selectedBBox.maxX) / 2}
                      cy={selectedBBox.minY - strokeBasisMm * 10}
                      r={strokeBasisMm * 2.2}
                      fill="#FFFFFF"
                      stroke="#2563EB"
                      strokeWidth={strokeBasisMm * 0.75}
                      className="cursor-grab"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const pt = clientToSvgMm(e.clientX, e.clientY);
                        pushHistorySnapshot(customViews);
                        setDragOp({
                          kind: 'rotate',
                          elId: selectedEl.id,
                          startPt: pt,
                          origEl:
                            selectedEl.kind === 'polyline'
                              ? { ...selectedEl, points: selectedEl.points.map((p) => ({ ...p })) }
                              : { ...selectedEl },
                          origBBox: selectedBBox,
                        });
                      }}
                    />
                  </g>
                )}

                {/* Draft shape preview while drawing */}
                {draftStart && draftCurrent && (
                  <g className="pointer-events-none" opacity={0.7}>
                    {tool === 'line' && (
                      <line
                        x1={draftStart.x}
                        y1={draftStart.y}
                        x2={draftCurrent.x}
                        y2={draftCurrent.y}
                        stroke="#2563EB"
                        strokeWidth={strokeBasisMm}
                      />
                    )}
                    {tool === 'rect' && (
                      <rect
                        x={Math.min(draftStart.x, draftCurrent.x)}
                        y={Math.min(draftStart.y, draftCurrent.y)}
                        width={Math.abs(draftCurrent.x - draftStart.x)}
                        height={Math.abs(draftCurrent.y - draftStart.y)}
                        fill="#2563EB"
                        fillOpacity={0.12}
                        stroke="#2563EB"
                        strokeWidth={strokeBasisMm}
                      />
                    )}
                    {tool === 'ellipse' && (
                      <ellipse
                        cx={(draftStart.x + draftCurrent.x) / 2}
                        cy={(draftStart.y + draftCurrent.y) / 2}
                        rx={Math.abs(draftCurrent.x - draftStart.x) / 2}
                        ry={Math.abs(draftCurrent.y - draftStart.y) / 2}
                        fill="#2563EB"
                        fillOpacity={0.12}
                        stroke="#2563EB"
                        strokeWidth={strokeBasisMm}
                      />
                    )}
                  </g>
                )}

                {/* Draft polyline preview */}
                {tool === 'polyline' && polyPoints.length > 0 && (
                  <g className="pointer-events-none">
                    <polyline
                      points={polyPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke="#2563EB"
                      strokeWidth={strokeBasisMm}
                    />
                    {polyPoints.map((p, idx) => (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r={strokeBasisMm * 1.5}
                        fill="#FFFFFF"
                        stroke="#2563EB"
                        strokeWidth={strokeBasisMm * 0.6}
                      />
                    ))}
                  </g>
                )}
              </svg>
            </div>
          </div>

          {/* RIGHT ELEMENT & STYLE INSPECTOR */}
          <div className="col-span-3 lg:col-span-3 border-l border-slate-200 dark:border-slate-800 p-3 flex flex-col gap-3 overflow-y-auto">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  Elements ({activeElements.length})
                </span>
                <span className="text-[11px] text-slate-500">
                  {isCurrentViewCustomized ? 'Custom 2D' : mode === 'default' ? 'Default SVG' : 'Auto 3D'}
                </span>
              </div>

              <div className="max-h-44 overflow-y-auto space-y-1 pr-0.5">
                {activeElements.map((el, idx) => {
                  const isSel = el.id === selectedElId;
                  return (
                    <div
                      key={el.id}
                      onClick={() => setSelectedElId(el.id)}
                      className={`px-2 py-1.5 rounded flex items-center justify-between gap-1 cursor-pointer ${
                        isSel
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span className="truncate font-medium">
                        {el.name || `${el.kind} ${idx + 1}`}
                      </span>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            mutateActiveElements((els) =>
                              els.map((item) =>
                                item.id === el.id ? { ...item, visible: !item.visible } : item
                              )
                            );
                          }}
                          className="p-1 rounded hover:bg-black/10 cursor-pointer"
                          title={el.visible ? 'Hide element' : 'Show element'}
                        >
                          {el.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 opacity-60" />}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveElementOrder(el.id, 'up');
                          }}
                          className="p-1 rounded hover:bg-black/10 cursor-pointer"
                          title="Bring forward"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveElementOrder(el.id, 'down');
                          }}
                          className="p-1 rounded hover:bg-black/10 cursor-pointer"
                          title="Send backward"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {selectedEl ? (
              <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Selected Element
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const copy = translateVectorElement(selectedEl, 25, 25);
                        copy.id = uid('svg_dup');
                        mutateActiveElements((els) => [...els, copy]);
                        setSelectedElId(copy.id);
                      }}
                      title="Duplicate Element"
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        mutateActiveElements((els) => els.filter((x) => x.id !== selectedEl.id));
                        setSelectedElId(null);
                      }}
                      title="Delete Element"
                      className="p-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Stroke Width */}
                <div>
                  <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                    <span>Line Thickness</span>
                    <span className="font-mono tabular-nums">{selectedEl.strokeWidthMm} mm</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    step={1}
                    value={selectedEl.strokeWidthMm}
                    onChange={(e) =>
                      updateSelectedElement((el) => ({
                        ...el,
                        strokeWidthMm: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-blue-600"
                  />
                </div>

                {/* Stroke Color */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Stroke Color</span>
                    <input
                      type="color"
                      value={selectedEl.stroke === 'none' ? '#0F172A' : selectedEl.stroke}
                      onChange={(e) =>
                        updateSelectedElement((el) => ({ ...el, stroke: e.target.value }))
                      }
                      className="w-6 h-5 p-0 border border-slate-200 rounded cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {QUICK_COLORS.map((hex) => (
                      <button
                        key={`sc_${hex}`}
                        type="button"
                        onClick={() => updateSelectedElement((el) => ({ ...el, stroke: hex }))}
                        style={{ backgroundColor: hex }}
                        className={`w-5 h-5 rounded border cursor-pointer ${
                          selectedEl.stroke === hex ? 'border-blue-600 ring-1 ring-blue-600' : 'border-slate-300'
                        }`}
                        title={hex}
                      />
                    ))}
                  </div>
                </div>

                {/* Fill Color & Opacity (for fillable elements) */}
                {selectedEl.kind !== 'line' && (
                  <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Fill</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateSelectedElement((el) =>
                              el.kind === 'line'
                                ? el
                                : {
                                    ...el,
                                    fill: el.fill === 'none' ? '#FFFFFF' : 'none',
                                    fillOpacity: el.fill === 'none' ? 1 : 0,
                                  }
                            )
                          }
                          className="px-1.5 py-0.5 border border-slate-200 dark:border-slate-700 rounded text-[10px] cursor-pointer"
                        >
                          {selectedEl.fill === 'none' ? 'Enable Fill' : 'No Fill'}
                        </button>
                        <input
                          type="color"
                          value={selectedEl.fill === 'none' ? '#FFFFFF' : selectedEl.fill}
                          onChange={(e) =>
                            updateSelectedElement((el) =>
                              el.kind === 'line' ? el : { ...el, fill: e.target.value, fillOpacity: Math.max(0.2, el.fillOpacity || 1) }
                            )
                          }
                          className="w-6 h-5 p-0 border border-slate-200 rounded cursor-pointer"
                        />
                      </div>
                    </div>

                    {selectedEl.fill !== 'none' && (
                      <div>
                        <div className="flex justify-between text-[11px] text-slate-500">
                          <span>Fill Opacity</span>
                          <span className="font-mono tabular-nums">
                            {Math.round(selectedEl.fillOpacity * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={selectedEl.fillOpacity}
                          onChange={(e) =>
                            updateSelectedElement((el) =>
                              el.kind === 'line' ? el : { ...el, fillOpacity: Number(e.target.value) }
                            )
                          }
                          className="w-full accent-blue-600"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Numeric Geometry Controls for Rect / Ellipse / Line */}
                {selectedEl.kind === 'rect' && (
                  <div className="grid grid-cols-2 gap-1.5 border-t border-slate-200 dark:border-slate-800 pt-2">
                    <label className="text-[11px] text-slate-500">
                      X (mm)
                      <input
                        type="number"
                        value={Math.round(selectedEl.x)}
                        onChange={(e) =>
                          updateSelectedElement((el) =>
                            el.kind === 'rect' ? { ...el, x: Number(e.target.value) } : el
                          )
                        }
                        className="mt-0.5 w-full px-1.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded font-mono tabular-nums"
                      />
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Y (mm)
                      <input
                        type="number"
                        value={Math.round(selectedEl.y)}
                        onChange={(e) =>
                          updateSelectedElement((el) =>
                            el.kind === 'rect' ? { ...el, y: Number(e.target.value) } : el
                          )
                        }
                        className="mt-0.5 w-full px-1.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded font-mono tabular-nums"
                      />
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Width (mm)
                      <input
                        type="number"
                        min={5}
                        value={Math.round(selectedEl.width)}
                        onChange={(e) =>
                          updateSelectedElement((el) =>
                            el.kind === 'rect' ? { ...el, width: Math.max(5, Number(e.target.value)) } : el
                          )
                        }
                        className="mt-0.5 w-full px-1.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded font-mono tabular-nums"
                      />
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Height (mm)
                      <input
                        type="number"
                        min={5}
                        value={Math.round(selectedEl.height)}
                        onChange={(e) =>
                          updateSelectedElement((el) =>
                            el.kind === 'rect' ? { ...el, height: Math.max(5, Number(e.target.value)) } : el
                          )
                        }
                        className="mt-0.5 w-full px-1.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded font-mono tabular-nums"
                      />
                    </label>
                  </div>
                )}

                {selectedEl.kind === 'ellipse' && (
                  <div className="grid grid-cols-2 gap-1.5 border-t border-slate-200 dark:border-slate-800 pt-2">
                    <label className="text-[11px] text-slate-500">
                      Radius X (mm)
                      <input
                        type="number"
                        min={5}
                        value={Math.round(selectedEl.rx)}
                        onChange={(e) =>
                          updateSelectedElement((el) =>
                            el.kind === 'ellipse' ? { ...el, rx: Math.max(5, Number(e.target.value)) } : el
                          )
                        }
                        className="mt-0.5 w-full px-1.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded font-mono tabular-nums"
                      />
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Radius Y (mm)
                      <input
                        type="number"
                        min={5}
                        value={Math.round(selectedEl.ry)}
                        onChange={(e) =>
                          updateSelectedElement((el) =>
                            el.kind === 'ellipse' ? { ...el, ry: Math.max(5, Number(e.target.value)) } : el
                          )
                        }
                        className="mt-0.5 w-full px-1.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded font-mono tabular-nums"
                      />
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="border-t border-slate-200 dark:border-slate-800 pt-3 text-[11px] text-slate-500 space-y-1.5">
                <p>Click any SVG element on the sheet to move, resize, rotate, or restyle it.</p>
                <p>Or pick a drawing tool on the left to add lines, paths, rectangles, circles, or arcs.</p>
              </div>
            )}
          </div>
        </div>

        {/* EXPLICIT OVERWRITE CONFIRMATION DIALOG */}
        {confirmRestoreScope && (
          <div className="fixed inset-0 z-60 bg-slate-950/60 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-4 space-y-3 text-xs">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Overwrite Custom 2D Drawing?
                  </h3>
                  <p className="mt-1 text-slate-500">
                    This projection contains manual SVG customizations. Restoring the automatically generated 3D projection will discard your custom edits for this view.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmRestoreScope(null);
                    setPendingModeChange(null);
                  }}
                  className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Keep Custom Edits
                </button>
                <button
                  type="button"
                  onClick={() => void executeRestore(confirmRestoreScope, pendingModeChange ?? undefined)}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-md cursor-pointer"
                >
                  Overwrite & Restore
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
