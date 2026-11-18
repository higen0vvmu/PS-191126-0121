import { BUILTIN_CATALOG } from '../data/catalog';
import type {
  CatalogTemplate,
  FurnitureInstance,
  FurniturePart,
  Point2D,
  ProjectedViewSvg,
  RepresentationMode,
  SvgEllipseElementData,
  SvgLineElementData,
  SvgPathElementData,
  SvgPolylineElementData,
  SvgRectElementData,
  SvgVectorElement,
} from '../types/plan';
import { fastHashString } from './assetStore';
import { computeFurnitureBoundsMm } from './geometry';

const BUILTIN_TEMPLATE_IDS = new Set(BUILTIN_CATALOG.map((c) => c.id));

type Matrix2D = [number, number, number, number, number, number]; // [a, b, c, d, e, f]

const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

function mulMatrix(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: Matrix2D, x: number, y: number): Point2D {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseLengthPx(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.endsWith('%')) return null;
  const m = trimmed.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|mm|cm|m|in|pt|pc)?$/i);
  if (!m) return null;
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  const unit = (m[2] ?? 'px').toLowerCase();
  const unitToPx: Record<string, number> = {
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    m: 9600 / 2.54,
  };
  return val * (unitToPx[unit] ?? 1);
}

function parseSvgTransform(attr: string | undefined): Matrix2D {
  if (!attr || !attr.trim()) return IDENTITY_MATRIX;
  let mat: Matrix2D = IDENTITY_MATRIX;
  const fnRe = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = fnRe.exec(attr)) !== null) {
    const fn = match[1].toLowerCase();
    const nums = (match[2].match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    let next: Matrix2D | null = null;
    if (fn === 'matrix' && nums.length >= 6) {
      next = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
    } else if (fn === 'translate' && nums.length >= 1) {
      next = [1, 0, 0, 1, nums[0], nums[1] ?? 0];
    } else if (fn === 'scale' && nums.length >= 1) {
      const sx = nums[0];
      const sy = nums.length >= 2 ? nums[1] : sx;
      next = [sx, 0, 0, sy, 0, 0];
    } else if (fn === 'rotate' && nums.length >= 1) {
      const rad = (nums[0] * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const cx = nums[1] ?? 0;
      const cy = nums[2] ?? 0;
      const rot: Matrix2D = [cos, sin, -sin, cos, 0, 0];
      if (cx !== 0 || cy !== 0) {
        next = mulMatrix([1, 0, 0, 1, cx, cy], mulMatrix(rot, [1, 0, 0, 1, -cx, -cy]));
      } else {
        next = rot;
      }
    } else if (fn === 'skewx' && nums.length >= 1) {
      next = [1, 0, Math.tan((nums[0] * Math.PI) / 180), 1, 0, 0];
    } else if (fn === 'skewy' && nums.length >= 1) {
      next = [1, Math.tan((nums[0] * Math.PI) / 180), 0, 1, 0, 0];
    }
    if (next) {
      mat = mulMatrix(mat, next);
    }
  }
  return mat;
}

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

function parseAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(rawAttrs)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  }
  return attrs;
}

function parseSvgXmlTree(xml: string): XmlNode | null {
  const trimmed = xml.trim();
  if (!trimmed || /<parsererror[\s>]/i.test(trimmed)) return null;
  // Strip XML declarations, DOCTYPE, and comments
  const cleaned = trimmed
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const tagRe = /<\s*(\/?)\s*([a-zA-Z_][\w:.-]*)([^>]*?)(\/?)\s*>/g;
  const stack: XmlNode[] = [];
  let svgRoot: XmlNode | null = null;
  let hasClosingSvg = false;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(cleaned)) !== null) {
    const isClosing = match[1] === '/';
    const rawTag = match[2];
    const tag = rawTag.includes(':') ? rawTag.split(':').pop()!.toLowerCase() : rawTag.toLowerCase();
    const rawAttrs = match[3];
    const isSelfClosing = match[4] === '/';

    if (isClosing) {
      if (tag === 'svg' && stack.some((n) => n.tag === 'svg')) {
        hasClosingSvg = true;
      }
      while (stack.length > 0) {
        const popped = stack.pop()!;
        if (popped.tag === tag) break;
      }
      continue;
    }

    const node: XmlNode = {
      tag,
      attrs: parseAttributes(rawAttrs),
      children: [],
    };
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else if (tag === 'svg' && !svgRoot) {
      svgRoot = node;
    }
    if (!isSelfClosing) {
      stack.push(node);
    } else if (tag === 'svg') {
      // Self-closing <svg ... /> has no geometry
      return null;
    }
  }

  if (!svgRoot || !hasClosingSvg) return null;
  return svgRoot;
}

function parseStyleString(styleAttr: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!styleAttr) return out;
  for (const decl of styleAttr.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const k = decl.slice(0, idx).trim().toLowerCase();
    const v = decl.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

interface InheritedStyle {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  fillRule?: 'evenodd' | 'nonzero';
  hidden: boolean;
}

function resolveStyle(node: XmlNode, parent: InheritedStyle): InheritedStyle {
  const css = parseStyleString(node.attrs.style);
  const getAttr = (k: string): string | undefined => css[k] ?? node.attrs[k];

  const display = getAttr('display')?.toLowerCase();
  const visibility = getAttr('visibility')?.toLowerCase();
  const opacityRaw = getAttr('opacity');
  const opacity = opacityRaw !== undefined ? Number(opacityRaw) : 1;
  const hidden =
    parent.hidden ||
    display === 'none' ||
    visibility === 'hidden' ||
    visibility === 'collapse' ||
    (Number.isFinite(opacity) && opacity <= 0);

  let fill = parent.fill;
  const rawFill = getAttr('fill');
  if (rawFill !== undefined) {
    const trimmed = rawFill.trim();
    if (/^url\(/i.test(trimmed)) {
      fill = '#CBD5E1';
    } else {
      fill = trimmed;
    }
  }

  let fillOpacity = parent.fillOpacity;
  const rawFillOp = getAttr('fill-opacity');
  if (rawFillOp !== undefined) {
    const n = Number(rawFillOp);
    if (Number.isFinite(n)) fillOpacity = Math.max(0, Math.min(1, n));
  }
  if (Number.isFinite(opacity) && opacity < 1) {
    fillOpacity *= Math.max(0, opacity);
  }

  let stroke = parent.stroke;
  const rawStroke = getAttr('stroke');
  if (rawStroke !== undefined) {
    const trimmed = rawStroke.trim();
    stroke = /^url\(/i.test(trimmed) ? '#0F172A' : trimmed;
  }

  let strokeWidth = parent.strokeWidth;
  const rawSw = getAttr('stroke-width');
  if (rawSw !== undefined) {
    const parsed = parseLengthPx(rawSw);
    if (parsed !== null) strokeWidth = parsed;
    else if (Number(rawSw) === 0) strokeWidth = 0;
  }

  const rawRule = getAttr('fill-rule')?.toLowerCase();
  const fillRule =
    rawRule === 'evenodd' || rawRule === 'nonzero' ? rawRule : parent.fillRule;

  return {
    fill,
    fillOpacity,
    stroke,
    strokeWidth,
    fillRule,
    hidden,
  };
}

function parseSvgPathTokens(d: string): string[] {
  return d.match(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
}

function transformPathData(d: string, mat: Matrix2D): { d: string; points: Point2D[] } | null {
  const tokens = parseSvgPathTokens(d);
  if (tokens.length === 0) return null;

  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastC2x = 0;
  let lastC2y = 0;
  let lastQx = 0;
  let lastQy = 0;
  let lastCmd = '';
  const out: string[] = [];
  const pts: Point2D[] = [];

  const isCmd = (t: string) => /^[a-zA-Z]$/.test(t);
  const nextNum = (): number | null => {
    if (i >= tokens.length || isCmd(tokens[i])) return null;
    const v = Number(tokens[i++]);
    return Number.isFinite(v) ? v : null;
  };
  const nextFlag = (): number | null => nextNum();
  const pushPt = (x: number, y: number): Point2D => {
    const p = applyMatrix(mat, x, y);
    const rp = { x: round2(p.x), y: round2(p.y) };
    pts.push(rp);
    return rp;
  };

  const scaleX = Math.hypot(mat[0], mat[1]);
  const scaleY = Math.hypot(mat[2], mat[3]);
  const matAngleDeg = (Math.atan2(mat[1], mat[0]) * 180) / Math.PI;
  const det = mat[0] * mat[3] - mat[1] * mat[2];

  while (i < tokens.length) {
    if (isCmd(tokens[i])) {
      cmd = tokens[i++];
    } else if (!cmd) {
      break;
    }

    const rel = cmd >= 'a' && cmd <= 'z';
    const upper = cmd.toUpperCase();

    if (upper === 'Z') {
      out.push('Z');
      cx = sx;
      cy = sy;
      lastCmd = 'Z';
      cmd = '';
      continue;
    }

    if (upper === 'M') {
      const nx = nextNum();
      const ny = nextNum();
      if (nx === null || ny === null) break;
      cx = rel ? cx + nx : nx;
      cy = rel ? cy + ny : ny;
      sx = cx;
      sy = cy;
      const p = pushPt(cx, cy);
      out.push(`M ${p.x} ${p.y}`);
      lastCmd = 'M';
      cmd = rel ? 'l' : 'L';
    } else if (upper === 'L') {
      const nx = nextNum();
      const ny = nextNum();
      if (nx === null || ny === null) break;
      cx = rel ? cx + nx : nx;
      cy = rel ? cy + ny : ny;
      const p = pushPt(cx, cy);
      out.push(`L ${p.x} ${p.y}`);
      lastCmd = 'L';
    } else if (upper === 'H') {
      const nx = nextNum();
      if (nx === null) break;
      cx = rel ? cx + nx : nx;
      const p = pushPt(cx, cy);
      out.push(`L ${p.x} ${p.y}`);
      lastCmd = 'H';
    } else if (upper === 'V') {
      const ny = nextNum();
      if (ny === null) break;
      cy = rel ? cy + ny : ny;
      const p = pushPt(cx, cy);
      out.push(`L ${p.x} ${p.y}`);
      lastCmd = 'V';
    } else if (upper === 'C') {
      const x1 = nextNum();
      const y1 = nextNum();
      const x2 = nextNum();
      const y2 = nextNum();
      const x = nextNum();
      const y = nextNum();
      if (x1 === null || y1 === null || x2 === null || y2 === null || x === null || y === null) break;
      const ax1 = rel ? cx + x1 : x1;
      const ay1 = rel ? cy + y1 : y1;
      const ax2 = rel ? cx + x2 : x2;
      const ay2 = rel ? cy + y2 : y2;
      const ax = rel ? cx + x : x;
      const ay = rel ? cy + y : y;
      const p1 = pushPt(ax1, ay1);
      const p2 = pushPt(ax2, ay2);
      const p = pushPt(ax, ay);
      out.push(`C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p.x} ${p.y}`);
      lastC2x = ax2;
      lastC2y = ay2;
      cx = ax;
      cy = ay;
      lastCmd = 'C';
    } else if (upper === 'S') {
      const x2 = nextNum();
      const y2 = nextNum();
      const x = nextNum();
      const y = nextNum();
      if (x2 === null || y2 === null || x === null || y === null) break;
      const ax1 = lastCmd === 'C' || lastCmd === 'S' ? 2 * cx - lastC2x : cx;
      const ay1 = lastCmd === 'C' || lastCmd === 'S' ? 2 * cy - lastC2y : cy;
      const ax2 = rel ? cx + x2 : x2;
      const ay2 = rel ? cy + y2 : y2;
      const ax = rel ? cx + x : x;
      const ay = rel ? cy + y : y;
      const p1 = pushPt(ax1, ay1);
      const p2 = pushPt(ax2, ay2);
      const p = pushPt(ax, ay);
      out.push(`C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p.x} ${p.y}`);
      lastC2x = ax2;
      lastC2y = ay2;
      cx = ax;
      cy = ay;
      lastCmd = 'S';
    } else if (upper === 'Q') {
      const x1 = nextNum();
      const y1 = nextNum();
      const x = nextNum();
      const y = nextNum();
      if (x1 === null || y1 === null || x === null || y === null) break;
      const ax1 = rel ? cx + x1 : x1;
      const ay1 = rel ? cy + y1 : y1;
      const ax = rel ? cx + x : x;
      const ay = rel ? cy + y : y;
      const p1 = pushPt(ax1, ay1);
      const p = pushPt(ax, ay);
      out.push(`Q ${p1.x} ${p1.y} ${p.x} ${p.y}`);
      lastQx = ax1;
      lastQy = ay1;
      cx = ax;
      cy = ay;
      lastCmd = 'Q';
    } else if (upper === 'T') {
      const x = nextNum();
      const y = nextNum();
      if (x === null || y === null) break;
      const ax1 = lastCmd === 'Q' || lastCmd === 'T' ? 2 * cx - lastQx : cx;
      const ay1 = lastCmd === 'Q' || lastCmd === 'T' ? 2 * cy - lastQy : cy;
      const ax = rel ? cx + x : x;
      const ay = rel ? cy + y : y;
      const p1 = pushPt(ax1, ay1);
      const p = pushPt(ax, ay);
      out.push(`Q ${p1.x} ${p1.y} ${p.x} ${p.y}`);
      lastQx = ax1;
      lastQy = ay1;
      cx = ax;
      cy = ay;
      lastCmd = 'T';
    } else if (upper === 'A') {
      const rx = nextNum();
      const ry = nextNum();
      const rot = nextNum();
      const largeArc = nextFlag();
      const sweep = nextFlag();
      const x = nextNum();
      const y = nextNum();
      if (
        rx === null ||
        ry === null ||
        rot === null ||
        largeArc === null ||
        sweep === null ||
        x === null ||
        y === null
      ) {
        break;
      }
      const ax = rel ? cx + x : x;
      const ay = rel ? cy + y : y;
      const p = pushPt(ax, ay);
      const trx = round2(Math.abs(rx * scaleX));
      const try_ = round2(Math.abs(ry * scaleY));
      const trot = round2(rot + matAngleDeg);
      const tsweep = det < 0 ? (sweep ? 0 : 1) : sweep ? 1 : 0;
      out.push(`A ${trx} ${try_} ${trot} ${largeArc ? 1 : 0} ${tsweep} ${p.x} ${p.y}`);
      cx = ax;
      cy = ay;
      lastCmd = 'A';
    } else {
      break;
    }
  }

  if (out.length === 0 || pts.length === 0) return null;
  return { d: out.join(' '), points: pts };
}

function parsePointsList(raw: string | undefined): Point2D[] {
  if (!raw) return [];
  const nums = (raw.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
  const pts: Point2D[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) {
      pts.push({ x: nums[i], y: nums[i + 1] });
    }
  }
  return pts;
}

const SKIP_CONTAINERS = new Set([
  'defs',
  'clippath',
  'mask',
  'pattern',
  'symbol',
  'lineargradient',
  'radialgradient',
  'style',
  'title',
  'desc',
  'metadata',
  'script',
]);

interface RawShapeEntry {
  node: XmlNode;
  mat: Matrix2D;
  style: InheritedStyle;
}

function collectRawShapes(
  node: XmlNode,
  parentMat: Matrix2D,
  parentStyle: InheritedStyle,
  out: RawShapeEntry[]
): void {
  if (SKIP_CONTAINERS.has(node.tag)) return;
  const style = resolveStyle(node, parentStyle);
  if (style.hidden) return;
  const localMat = parseSvgTransform(node.attrs.transform);
  const mat = mulMatrix(parentMat, localMat);

  if (
    node.tag === 'path' ||
    node.tag === 'rect' ||
    node.tag === 'circle' ||
    node.tag === 'ellipse' ||
    node.tag === 'polygon' ||
    node.tag === 'polyline' ||
    node.tag === 'line'
  ) {
    out.push({ node, mat, style });
    return;
  }

  for (const child of node.children) {
    collectRawShapes(child, mat, style, out);
  }
}

function computeRawBounds(entries: RawShapeEntry[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const includePt = (p: Point2D) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };

  for (const { node, mat } of entries) {
    if (node.tag === 'rect') {
      const x = Number(node.attrs.x ?? 0);
      const y = Number(node.attrs.y ?? 0);
      const w = Number(node.attrs.width ?? 0);
      const h = Number(node.attrs.height ?? 0);
      if (w > 0 && h > 0 && Number.isFinite(x) && Number.isFinite(y)) {
        includePt(applyMatrix(mat, x, y));
        includePt(applyMatrix(mat, x + w, y));
        includePt(applyMatrix(mat, x + w, y + h));
        includePt(applyMatrix(mat, x, y + h));
      }
    } else if (node.tag === 'circle') {
      const cx = Number(node.attrs.cx ?? 0);
      const cy = Number(node.attrs.cy ?? 0);
      const r = Number(node.attrs.r ?? 0);
      if (r > 0 && Number.isFinite(cx) && Number.isFinite(cy)) {
        includePt(applyMatrix(mat, cx - r, cy - r));
        includePt(applyMatrix(mat, cx + r, cy + r));
        includePt(applyMatrix(mat, cx + r, cy - r));
        includePt(applyMatrix(mat, cx - r, cy + r));
      }
    } else if (node.tag === 'ellipse') {
      const cx = Number(node.attrs.cx ?? 0);
      const cy = Number(node.attrs.cy ?? 0);
      const rx = Number(node.attrs.rx ?? 0);
      const ry = Number(node.attrs.ry ?? 0);
      if (rx > 0 && ry > 0 && Number.isFinite(cx) && Number.isFinite(cy)) {
        includePt(applyMatrix(mat, cx - rx, cy - ry));
        includePt(applyMatrix(mat, cx + rx, cy + ry));
        includePt(applyMatrix(mat, cx + rx, cy - ry));
        includePt(applyMatrix(mat, cx - rx, cy + ry));
      }
    } else if (node.tag === 'line') {
      const x1 = Number(node.attrs.x1 ?? 0);
      const y1 = Number(node.attrs.y1 ?? 0);
      const x2 = Number(node.attrs.x2 ?? 0);
      const y2 = Number(node.attrs.y2 ?? 0);
      if ([x1, y1, x2, y2].every(Number.isFinite)) {
        includePt(applyMatrix(mat, x1, y1));
        includePt(applyMatrix(mat, x2, y2));
      }
    } else if (node.tag === 'polygon' || node.tag === 'polyline') {
      for (const p of parsePointsList(node.attrs.points)) {
        includePt(applyMatrix(mat, p.x, p.y));
      }
    } else if (node.tag === 'path' && node.attrs.d) {
      const parsed = transformPathData(node.attrs.d, mat);
      if (parsed) {
        for (const p of parsed.points) includePt(p);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

export interface ParsedSvgImportResult {
  view: ProjectedViewSvg;
  parts: FurniturePart[];
}

export function parseSvgSourceToProjectedView(
  svgSource: string,
  targetWidthMm: number,
  targetDepthMm: number,
  extrudeHeightMm = 750,
  fallbackColor = '#64748B'
): ParsedSvgImportResult | null {
  const root = parseSvgXmlTree(svgSource);
  if (!root) return null;

  const baseStyle: InheritedStyle = {
    fill: '#000000',
    fillOpacity: 1,
    stroke: 'none',
    strokeWidth: 1,
    fillRule: 'nonzero',
    hidden: false,
  };

  const entries: RawShapeEntry[] = [];
  for (const child of root.children) {
    collectRawShapes(child, IDENTITY_MATRIX, baseStyle, entries);
  }
  if (entries.length === 0) return null;

  let vbMinX = 0;
  let vbMinY = 0;
  let vbW = 0;
  let vbH = 0;

  if (root.attrs.viewbox) {
    const nums = root.attrs.viewbox.trim().split(/[\s,]+/).map(Number);
    if (nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0) {
      [vbMinX, vbMinY, vbW, vbH] = nums;
    }
  }
  if (vbW <= 0 || vbH <= 0) {
    const attrW = parseLengthPx(root.attrs.width);
    const attrH = parseLengthPx(root.attrs.height);
    if (attrW && attrH) {
      vbW = attrW;
      vbH = attrH;
    } else {
      const rawBounds = computeRawBounds(entries);
      if (!rawBounds) return null;
      vbMinX = rawBounds.minX;
      vbMinY = rawBounds.minY;
      vbW = rawBounds.maxX - rawBounds.minX;
      vbH = rawBounds.maxY - rawBounds.minY;
    }
  }

  if (!Number.isFinite(vbW) || !Number.isFinite(vbH) || vbW <= 0 || vbH <= 0) {
    return null;
  }

  const widthMm = Math.max(20, Math.round(targetWidthMm));
  const depthMm = Math.max(20, Math.round(targetDepthMm));
  const sx = widthMm / vbW;
  const sy = depthMm / vbH;
  const vbCx = vbMinX + vbW / 2;
  const vbCy = vbMinY + vbH / 2;
  const viewToMm: Matrix2D = [sx, 0, 0, sy, -vbCx * sx, -vbCy * sy];
  const avgScale = (sx + sy) / 2;

  const elements: SvgVectorElement[] = [];
  const extractedParts: FurniturePart[] = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const { node, mat, style } = entries[idx];
    const totalMat = mulMatrix(viewToMm, mat);
    const hasFill = style.fill.toLowerCase() !== 'none' && style.fillOpacity > 0;
    const hasStroke = style.stroke.toLowerCase() !== 'none' && style.strokeWidth > 0;
    if (!hasFill && !hasStroke) continue;

    const strokeColor = hasStroke ? style.stroke : 'none';
    const strokeWidthMm = hasStroke ? Math.max(2, round2(style.strokeWidth * avgScale)) : 0;
    const fillColor = hasFill ? style.fill : 'none';
    const fillOpacity = hasFill ? round2(style.fillOpacity) : 0;
    const partColor =
      /^#[0-9A-Fa-f]{6}$/.test(style.fill)
        ? style.fill.toUpperCase()
        : /^#[0-9A-Fa-f]{6}$/.test(style.stroke)
          ? style.stroke.toUpperCase()
          : fallbackColor;

    const isAxisAligned = Math.abs(totalMat[1]) < 1e-4 && Math.abs(totalMat[2]) < 1e-4;

    if (node.tag === 'rect') {
      const x = Number(node.attrs.x ?? 0);
      const y = Number(node.attrs.y ?? 0);
      const w = Number(node.attrs.width ?? 0);
      const h = Number(node.attrs.height ?? 0);
      const rxRaw = Number(node.attrs.rx ?? node.attrs.ry ?? 0);
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;

      if (isAxisAligned) {
        const p0 = applyMatrix(totalMat, x, y);
        const p1 = applyMatrix(totalMat, x + w, y + h);
        const minX = Math.min(p0.x, p1.x);
        const minY = Math.min(p0.y, p1.y);
        const rw = Math.abs(p1.x - p0.x);
        const rh = Math.abs(p1.y - p0.y);
        const el: SvgRectElementData = {
          id: `svg_orig_rect_${idx}`,
          kind: 'rect',
          name: `SVG Rect ${idx + 1}`,
          x: round2(minX),
          y: round2(minY),
          width: round2(rw),
          height: round2(rh),
          rx: rxRaw > 0 ? round2(rxRaw * Math.abs(totalMat[0])) : undefined,
          stroke: strokeColor,
          strokeWidthMm,
          fill: fillColor,
          fillOpacity,
          visible: true,
        };
        elements.push(el);
        if (extractedParts.length < 24 && rw >= 10 && rh >= 10) {
          extractedParts.push({
            id: `svgp_${idx}`,
            name: `SVG Shape ${idx + 1}`,
            shape: rxRaw > 0 ? 'rounded_rect' : 'box',
            xMm: Math.round(minX + rw / 2),
            yMm: Math.round(minY + rh / 2),
            zMm: 0,
            widthMm: Math.max(20, Math.round(rw)),
            depthMm: Math.max(20, Math.round(rh)),
            heightMm: extrudeHeightMm,
            rotationDeg: 0,
            color: partColor,
            material: 'wood',
          });
        }
      } else {
        const corners = [
          applyMatrix(totalMat, x, y),
          applyMatrix(totalMat, x + w, y),
          applyMatrix(totalMat, x + w, y + h),
          applyMatrix(totalMat, x, y + h),
        ].map((p) => ({ x: round2(p.x), y: round2(p.y) }));
        const el: SvgPolylineElementData = {
          id: `svg_orig_rect_${idx}`,
          kind: 'polyline',
          name: `SVG Rect ${idx + 1}`,
          points: corners,
          closed: true,
          stroke: strokeColor,
          strokeWidthMm,
          fill: fillColor,
          fillOpacity,
          visible: true,
        };
        elements.push(el);
      }
    } else if (node.tag === 'circle' || node.tag === 'ellipse') {
      const cx = Number(node.attrs.cx ?? 0);
      const cy = Number(node.attrs.cy ?? 0);
      const rx = Number(node.tag === 'circle' ? node.attrs.r ?? 0 : node.attrs.rx ?? node.attrs.ry ?? 0);
      const ry = Number(node.tag === 'circle' ? node.attrs.r ?? 0 : node.attrs.ry ?? node.attrs.rx ?? 0);
      if (![cx, cy, rx, ry].every(Number.isFinite) || rx <= 0 || ry <= 0) continue;
      const center = applyMatrix(totalMat, cx, cy);
      const sxMat = Math.hypot(totalMat[0], totalMat[1]);
      const syMat = Math.hypot(totalMat[2], totalMat[3]);
      const rotDeg = (Math.atan2(totalMat[1], totalMat[0]) * 180) / Math.PI;
      const erx = round2(rx * sxMat);
      const ery = round2(ry * syMat);
      const el: SvgEllipseElementData = {
        id: `svg_orig_ell_${idx}`,
        kind: 'ellipse',
        name: `SVG Ellipse ${idx + 1}`,
        cx: round2(center.x),
        cy: round2(center.y),
        rx: erx,
        ry: ery,
        rotationDeg: Math.abs(rotDeg) > 0.1 ? round2(rotDeg) : undefined,
        stroke: strokeColor,
        strokeWidthMm,
        fill: fillColor,
        fillOpacity,
        visible: true,
      };
      elements.push(el);
      if (extractedParts.length < 24 && erx >= 5 && ery >= 5) {
        extractedParts.push({
          id: `svgp_${idx}`,
          name: `SVG Ellipse ${idx + 1}`,
          shape: 'cylinder',
          xMm: Math.round(center.x),
          yMm: Math.round(center.y),
          zMm: 0,
          widthMm: Math.max(20, Math.round(erx * 2)),
          depthMm: Math.max(20, Math.round(ery * 2)),
          heightMm: extrudeHeightMm,
          rotationDeg: Math.round(rotDeg),
          color: partColor,
          material: 'wood',
        });
      }
    } else if (node.tag === 'line') {
      const x1 = Number(node.attrs.x1 ?? 0);
      const y1 = Number(node.attrs.y1 ?? 0);
      const x2 = Number(node.attrs.x2 ?? 0);
      const y2 = Number(node.attrs.y2 ?? 0);
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
      if (!hasStroke) continue;
      const p1 = applyMatrix(totalMat, x1, y1);
      const p2 = applyMatrix(totalMat, x2, y2);
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 1e-3) continue;
      const el: SvgLineElementData = {
        id: `svg_orig_line_${idx}`,
        kind: 'line',
        name: `SVG Line ${idx + 1}`,
        x1: round2(p1.x),
        y1: round2(p1.y),
        x2: round2(p2.x),
        y2: round2(p2.y),
        stroke: strokeColor,
        strokeWidthMm: Math.max(2, strokeWidthMm),
        visible: true,
      };
      elements.push(el);
    } else if (node.tag === 'polygon' || node.tag === 'polyline') {
      const pts = parsePointsList(node.attrs.points).map((p) => {
        const tp = applyMatrix(totalMat, p.x, p.y);
        return { x: round2(tp.x), y: round2(tp.y) };
      });
      if (pts.length < 2) continue;
      const el: SvgPolylineElementData = {
        id: `svg_orig_poly_${idx}`,
        kind: 'polyline',
        name: `SVG ${node.tag === 'polygon' ? 'Polygon' : 'Polyline'} ${idx + 1}`,
        points: pts,
        closed: node.tag === 'polygon',
        stroke: strokeColor,
        strokeWidthMm,
        fill: node.tag === 'polygon' ? fillColor : 'none',
        fillOpacity: node.tag === 'polygon' ? fillOpacity : 0,
        visible: true,
      };
      elements.push(el);
    } else if (node.tag === 'path' && node.attrs.d) {
      const transformed = transformPathData(node.attrs.d, totalMat);
      if (!transformed) continue;
      const el: SvgPathElementData = {
        id: `svg_orig_path_${idx}`,
        kind: 'path',
        name: `SVG Path ${idx + 1}`,
        d: transformed.d,
        stroke: strokeColor,
        strokeWidthMm,
        fill: fillColor,
        fillOpacity,
        fillRule: style.fillRule,
        visible: true,
      };
      elements.push(el);
    }
  }

  if (elements.length === 0) return null;

  if (extractedParts.length === 0) {
    extractedParts.push({
      id: 'svgp_body',
      name: 'Extruded SVG Body',
      shape: 'box',
      xMm: 0,
      yMm: 0,
      zMm: 0,
      widthMm,
      depthMm,
      heightMm: extrudeHeightMm,
      rotationDeg: 0,
      color: fallbackColor,
      material: 'wood',
    });
  }

  return {
    view: {
      view: 'top',
      viewBox: {
        minX: -widthMm / 2,
        minY: -depthMm / 2,
        width: widthMm,
        height: depthMm,
      },
      baseWidthMm: widthMm,
      baseHeightMm: depthMm,
      elements,
    },
    parts: extractedParts,
  };
}

const svgValidityCache = new Map<string, boolean>();

export function isValidSvgSource(svgSource?: string | null): boolean {
  if (typeof svgSource !== 'string') return false;
  const trimmed = svgSource.trim();
  if (!trimmed || !/<svg[\s>]/i.test(trimmed)) return false;
  const key = `${trimmed.length}_${fastHashString(trimmed)}`;
  const cached = svgValidityCache.get(key);
  if (cached !== undefined) return cached;
  const parsed = parseSvgSourceToProjectedView(trimmed, 1000, 1000);
  const valid = Boolean(parsed && parsed.view.elements.length > 0);
  if (svgValidityCache.size > 256) svgValidityCache.clear();
  svgValidityCache.set(key, valid);
  return valid;
}

export function isBuiltinCatalogItem(
  item: { templateId?: string; id?: string; isCustom?: boolean } | undefined | null
): boolean {
  if (!item) return false;
  if (item.isCustom) return false;
  const tplId = item.templateId ?? item.id;
  return Boolean(tplId && BUILTIN_TEMPLATE_IDS.has(tplId));
}

export type RepresentationTargetItem =
  | (Partial<
      Pick<
        FurnitureInstance,
        'templateId' | 'svgSource' | 'glbAssetId' | 'glbDataUrl' | 'parts' | 'representation'
      >
    > & { id?: string; isCustom?: boolean })
  | (Partial<
      Pick<
        CatalogTemplate,
        'id' | 'isCustom' | 'svgSource' | 'glbAssetId' | 'glbDataUrl' | 'parts' | 'representation'
      >
    > & { templateId?: string });

export function hasValidDefaultSvg(item: RepresentationTargetItem | undefined | null): boolean {
  if (!item) return false;
  // Explicit SVG source (imported or embedded): must validate cleanly
  if (typeof item.svgSource === 'string' && item.svgSource.trim().length > 0) {
    return isValidSvgSource(item.svgSource);
  }
  // Preserved immutable defaultViews on representation (e.g., imported SVG or saved built-in copy)
  const topDefault = item.representation?.defaultViews?.top;
  if (topDefault && Array.isArray(topDefault.elements) && topDefault.elements.length > 0) {
    return true;
  }
  // Built-in catalog furniture (non-GLB) has original architectural 2D vector drawing
  if (!item.glbAssetId && !item.glbDataUrl && isBuiltinCatalogItem(item)) {
    return Array.isArray(item.parts) && item.parts.length > 0;
  }
  return false;
}

export function getDefaultRepresentationMode(item: RepresentationTargetItem | undefined | null): RepresentationMode {
  return hasValidDefaultSvg(item) ? 'default' : 'silhouette';
}

export function resolveEffectiveRepresentationMode(
  item: RepresentationTargetItem | undefined | null
): RepresentationMode {
  if (!item) return 'silhouette';
  const canDefault = hasValidDefaultSvg(item);
  const raw = item.representation?.mode;
  if (!raw) return canDefault ? 'default' : 'silhouette';
  if (raw === 'default' && !canDefault) return 'silhouette';
  return raw;
}

/**
 * Generates an editable top-down vector representation from parametric FurniturePart[]
 * for built-in furniture items when inspected/edited in Default mode inside the 2D SVG Editor
 * or preserved when saved to My Library.
 */
export function generateDefaultTopViewFromParts(parts: FurniturePart[]): ProjectedViewSvg | null {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const bounds = computeFurnitureBoundsMm(parts);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const sorted = [...parts].sort((a, b) => a.zMm - b.zMm);
  const elements: SvgVectorElement[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const w = Math.max(10, p.widthMm);
    const d = Math.max(10, p.depthMm);
    const hw = w / 2;
    const hd = d / 2;
    const px = round2(p.xMm - cx);
    const py = round2(p.yMm - cy);
    const fill = p.material === 'glass' ? '#E0F2FE' : p.color || '#FFFFFF';
    const fillOpacity = p.material === 'glass' ? 0.45 : 1;
    const stroke = '#1E293B';
    const strokeWidthMm = 10;

    if (p.shape === 'cylinder' || p.shape === 'sphere' || p.shape === 'oval') {
      elements.push({
        id: `def_part_${i}`,
        kind: 'ellipse',
        name: p.name,
        cx: px,
        cy: py,
        rx: round2(hw),
        ry: round2(hd),
        rotationDeg: p.rotationDeg || undefined,
        stroke,
        strokeWidthMm,
        fill,
        fillOpacity,
        visible: true,
      });
    } else if (p.shape === 'arc') {
      const rawArcD = `M ${round2(-hw)} ${round2(hd)} A ${round2(hw)} ${round2(d)} 0 0 1 ${round2(hw)} ${round2(hd)} L ${round2(hw * 0.65)} ${round2(hd)} A ${round2(hw * 0.65)} ${round2(d * 0.65)} 0 0 0 ${round2(-hw * 0.65)} ${round2(hd)} Z`;
      const rad = (p.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const transformed = transformPathData(rawArcD, [cos, sin, -sin, cos, px, py]);
      if (transformed) {
        elements.push({
          id: `def_part_${i}`,
          kind: 'path',
          name: p.name,
          d: transformed.d,
          stroke,
          strokeWidthMm,
          fill,
          fillOpacity,
          visible: true,
        });
      }
    } else if (p.shape === 'l_profile' || p.shape === 'u_profile' || p.shape === 'wedge') {
      const rad = (p.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const tx = (lx: number, ly: number) => ({
        x: round2(px + lx * cos - ly * sin),
        y: round2(py + lx * sin + ly * cos),
      });
      let localPts: Point2D[];
      if (p.shape === 'l_profile') {
        const armW = Math.min(w * 0.42, Math.max(w * 0.25, 320));
        const armD = Math.min(d * 0.42, Math.max(d * 0.25, 320));
        localPts = [
          { x: -hw, y: -hd },
          { x: hw, y: -hd },
          { x: hw, y: -hd + armD },
          { x: -hw + armW, y: -hd + armD },
          { x: -hw + armW, y: hd },
          { x: -hw, y: hd },
        ];
      } else if (p.shape === 'u_profile') {
        const armW = Math.min(w * 0.3, Math.max(w * 0.2, 260));
        const backD = Math.min(d * 0.35, Math.max(d * 0.22, 260));
        localPts = [
          { x: -hw, y: -hd },
          { x: hw, y: -hd },
          { x: hw, y: hd },
          { x: hw - armW, y: hd },
          { x: hw - armW, y: -hd + backD },
          { x: -hw + armW, y: -hd + backD },
          { x: -hw + armW, y: hd },
          { x: -hw, y: hd },
        ];
      } else {
        localPts = [
          { x: -hw, y: hd },
          { x: hw, y: hd },
          { x: hw, y: -hd },
        ];
      }
      elements.push({
        id: `def_part_${i}`,
        kind: 'polyline',
        name: p.name,
        points: localPts.map((pt) => tx(pt.x, pt.y)),
        closed: true,
        stroke,
        strokeWidthMm,
        fill,
        fillOpacity,
        visible: true,
      });
    } else {
      elements.push({
        id: `def_part_${i}`,
        kind: 'rect',
        name: p.name,
        x: round2(px - hw),
        y: round2(py - hd),
        width: round2(w),
        height: round2(d),
        rx: p.shape === 'rounded_rect' ? round2(Math.min(hw, hd) * 0.25) : undefined,
        rotationDeg: p.rotationDeg || undefined,
        stroke,
        strokeWidthMm,
        fill,
        fillOpacity,
        visible: true,
      });
    }
  }

  const bw = Math.max(20, Math.round(bounds.widthMm));
  const bd = Math.max(20, Math.round(bounds.depthMm));
  return {
    view: 'top',
    viewBox: {
      minX: -bw / 2,
      minY: -bd / 2,
      width: bw,
      height: bd,
    },
    baseWidthMm: bw,
    baseHeightMm: bd,
    elements,
  };
}
