import * as THREE from 'three';
import { Opening, Room, Wall } from '../types/plan';
import {
  computeWallPolygon,
  getWallArcLength,
  getWallCenterlinePoint,
  resolveWallFaces,
  wallOffsets,
} from './geometry';

export interface BuildWall3DOptions {
  rooms: Room[];
  allWalls: Wall[];
  openings: Opening[];
  cutawayEnabled: boolean;
  cutawayHeightMm: number;
  castShadows: boolean;
  innerMat: THREE.Material;
  outerMat: THREE.Material;
  coreMat: THREE.Material;
  baseboardMat?: THREE.Material;
  crownMat?: THREE.Material;
  onCurvedSegmentGeo?: (geo: THREE.BufferGeometry, segmentIndex: number) => void;
}

export interface BuildWall3DResult {
  wallGroup: THREE.Group;
  normalX: number;
  normalZ: number;
}

interface WallOpeningCutout {
  op: Opening;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  tStart: number;
  tEnd: number;
  slicedTop: boolean;
}

function getCutoutVerticalSpanAtX(
  c: WallOpeningCutout,
  x: number
): [number, number] | null {
  if (x <= c.x1 + 1e-4 || x >= c.x2 - 1e-4) return null;
  const ow = c.x2 - c.x1;
  const oh = c.y2 - c.y1;
  if (ow <= 1e-4 || oh <= 1e-4) return null;

  const cx = (c.x1 + c.x2) / 2;
  const u = Math.max(-1, Math.min(1, (x - cx) / (ow / 2)));

  if (c.op.category === 'window' && c.op.subtype === 'round') {
    const halfArcH = (oh / 2) * Math.sqrt(Math.max(0, 1 - u * u));
    const cy = (c.y1 + c.y2) / 2;
    const yb = Math.max(c.y1, cy - halfArcH);
    const yt = Math.min(c.y2, cy + halfArcH);
    return yt > yb + 0.005 ? [yb, yt] : null;
  }

  if (c.op.category === 'arch') {
    if (c.op.subtype === 'round_arch') {
      const archRise = Math.min(ow / 2, Math.max(0.02, oh - 0.04));
      const springY = c.y2 - archRise;
      const topY = Math.min(c.y2, springY + archRise * Math.sqrt(Math.max(0, 1 - u * u)));
      return topY > c.y1 + 0.005 ? [c.y1, topY] : null;
    }
    if (c.op.subtype === 'pointed_arch') {
      const archRise = Math.min(oh * 0.48, ow * 0.65);
      const springY = Math.max(c.y1 + 0.04, c.y2 - archRise);
      const s = Math.abs(u);
      // Smooth gothic pointed arch approximation matching quadraticCurveTo control at 0.14*ow
      const tCurve = Math.max(0, Math.min(1, 1 - s));
      const topY = Math.min(c.y2, springY + (c.y2 - springY) * Math.pow(tCurve, 0.72));
      return topY > c.y1 + 0.005 ? [c.y1, topY] : null;
    }
    if (c.op.subtype === 'segmental_arch') {
      const archRise = Math.min(oh * 0.25, ow * 0.35);
      const springY = Math.max(c.y1 + 0.04, c.y2 - archRise);
      const topY = Math.min(c.y2, springY + (c.y2 - springY) * (1 - u * u));
      return topY > c.y1 + 0.005 ? [c.y1, topY] : null;
    }
  }

  return [c.y1, c.y2];
}

function isNonRectangularCutout(op: Opening): boolean {
  return (
    (op.category === 'window' && op.subtype === 'round') ||
    (op.category === 'arch' &&
      (op.subtype === 'round_arch' ||
        op.subtype === 'pointed_arch' ||
        op.subtype === 'segmental_arch'))
  );
}

function buildExactSingleCutoutPath(c: WallOpeningCutout): THREE.Path {
  const hole = new THREE.Path();
  const { x1, x2, y1, y2, op } = c;
  const ow = x2 - x1;
  const oh = y2 - y1;

  if (op.category === 'arch' && op.subtype === 'round_arch') {
    const rx = ow / 2;
    const ry = Math.min(rx, Math.max(0.02, oh - 0.04));
    const springY = y2 - ry;
    hole.moveTo(x1, y1);
    hole.lineTo(x1, springY);
    hole.absellipse((x1 + x2) / 2, springY, rx, ry, Math.PI, 0, true, 0);
    hole.lineTo(x2, y1);
  } else if (op.category === 'arch' && op.subtype === 'pointed_arch') {
    const archRise = Math.min(oh * 0.48, ow * 0.65);
    const springY = Math.max(y1 + 0.04, y2 - archRise);
    hole.moveTo(x1, y1);
    hole.lineTo(x1, springY);
    hole.quadraticCurveTo(x1 + ow * 0.14, y2 - archRise * 0.25, (x1 + x2) / 2, y2);
    hole.quadraticCurveTo(x2 - ow * 0.14, y2 - archRise * 0.25, x2, springY);
    hole.lineTo(x2, y1);
  } else if (op.category === 'arch' && op.subtype === 'segmental_arch') {
    const archRise = Math.min(oh * 0.25, ow * 0.35);
    const springY = Math.max(y1 + 0.04, y2 - archRise);
    hole.moveTo(x1, y1);
    hole.lineTo(x1, springY);
    hole.quadraticCurveTo((x1 + x2) / 2, y2 + (y2 - springY), x2, springY);
    hole.lineTo(x2, y1);
  } else if (op.category === 'window' && op.subtype === 'round') {
    const rx = ow / 2;
    const ry = oh / 2;
    hole.absellipse((x1 + x2) / 2, (y1 + y2) / 2, rx, ry, 0, Math.PI * 2, true, 0);
  } else {
    hole.moveTo(x1, y1);
    hole.lineTo(x1, y2);
    hole.lineTo(x2, y2);
    hole.lineTo(x2, y1);
  }
  hole.closePath();
  return hole;
}

/**
 * Computes strictly CW non-intersecting outer boundary loops for a cluster of
 * overlapping or touching cutouts so Earcut triangulation never fails.
 */
function buildMergedClusterHolePaths(cluster: WallOpeningCutout[]): THREE.Path[] {
  const xSet = new Set<number>();
  const ySet = new Set<number>();

  for (const c of cluster) {
    if (isNonRectangularCutout(c.op)) {
      const steps = 16;
      for (let i = 0; i <= steps; i++) {
        const x = c.x1 + ((c.x2 - c.x1) * i) / steps;
        xSet.add(Number(x.toFixed(5)));
        const span = getCutoutVerticalSpanAtX(c, Math.min(c.x2 - 1e-4, Math.max(c.x1 + 1e-4, x)));
        if (span) {
          ySet.add(Number(span[0].toFixed(5)));
          ySet.add(Number(span[1].toFixed(5)));
        }
      }
    } else {
      xSet.add(Number(c.x1.toFixed(5)));
      xSet.add(Number(c.x2.toFixed(5)));
      ySet.add(Number(c.y1.toFixed(5)));
      ySet.add(Number(c.y2.toFixed(5)));
    }
  }

  const xs = Array.from(xSet).sort((a, b) => a - b);
  const ys = Array.from(ySet).sort((a, b) => a - b);
  if (xs.length < 2 || ys.length < 2) return [];

  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const filled: boolean[][] = Array.from({ length: nx }, () => new Array<boolean>(ny).fill(false));

  for (let ix = 0; ix < nx; ix++) {
    const mx = (xs[ix] + xs[ix + 1]) / 2;
    const spans: Array<[number, number]> = [];
    for (const c of cluster) {
      const s = getCutoutVerticalSpanAtX(c, mx);
      if (s) spans.push(s);
    }
    if (spans.length === 0) continue;
    for (let iy = 0; iy < ny; iy++) {
      const my = (ys[iy] + ys[iy + 1]) / 2;
      if (spans.some(([yb, yt]) => my >= yb && my <= yt)) {
        filled[ix][iy] = true;
      }
    }
  }

  // Extract directed boundary edges on the grid keeping filled area on the right (CW hole winding)
  interface Edge {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    used: boolean;
  }
  const edges: Edge[] = [];
  const keyOf = (x: number, y: number) => `${x.toFixed(5)},${y.toFixed(5)}`;

  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      if (!filled[ix][iy]) continue;
      const xL = xs[ix];
      const xR = xs[ix + 1];
      const yB = ys[iy];
      const yT = ys[iy + 1];
      if (ix === 0 || !filled[ix - 1][iy]) {
        edges.push({ x0: xL, y0: yB, x1: xL, y1: yT, used: false });
      }
      if (iy === ny - 1 || !filled[ix][iy + 1]) {
        edges.push({ x0: xL, y0: yT, x1: xR, y1: yT, used: false });
      }
      if (ix === nx - 1 || !filled[ix + 1][iy]) {
        edges.push({ x0: xR, y0: yT, x1: xR, y1: yB, used: false });
      }
      if (iy === 0 || !filled[ix][iy - 1]) {
        edges.push({ x0: xR, y0: yB, x1: xL, y1: yB, used: false });
      }
    }
  }

  const outMap = new Map<string, Edge[]>();
  for (const e of edges) {
    const k = keyOf(e.x0, e.y0);
    const list = outMap.get(k);
    if (list) list.push(e);
    else outMap.set(k, [e]);
  }

  const paths: THREE.Path[] = [];
  for (const startEdge of edges) {
    if (startEdge.used) continue;
    const pts: Array<{ x: number; y: number }> = [];
    let cur: Edge | undefined = startEdge;
    while (cur && !cur.used) {
      cur.used = true;
      pts.push({ x: cur.x0, y: cur.y0 });
      const nextList: Edge[] = outMap.get(keyOf(cur.x1, cur.y1)) ?? [];
      const curDx: number = cur.x1 - cur.x0;
      const curDy: number = cur.y1 - cur.y0;
      // Prefer straight continuation or right-turn to keep outer hole loop simple
      let chosen: Edge | undefined = nextList.find(
        (n) => !n.used && Math.abs((n.x1 - n.x0) * curDy - (n.y1 - n.y0) * curDx) < 1e-6
      );
      if (!chosen) chosen = nextList.find((n) => !n.used);
      cur = chosen;
    }
    if (pts.length < 3) continue;

    // Simplify collinear vertices
    const simplified: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const curr = pts[i];
      const next = pts[(i + 1) % pts.length];
      const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
      if (Math.abs(cross) > 1e-7) {
        simplified.push(curr);
      }
    }
    if (simplified.length < 3) continue;

    let signedArea = 0;
    for (let i = 0; i < simplified.length; i++) {
      const a = simplified[i];
      const b = simplified[(i + 1) % simplified.length];
      signedArea += a.x * b.y - b.x * a.y;
    }
    // Outer cutout loops have negative signedArea (CW). Positive loops would be solid islands.
    if (signedArea >= -1e-6) continue;

    const p = new THREE.Path();
    p.moveTo(simplified[0].x, simplified[0].y);
    for (let i = 1; i < simplified.length; i++) {
      p.lineTo(simplified[i].x, simplified[i].y);
    }
    p.closePath();
    paths.push(p);
  }

  return paths;
}

function subtractSolidIntervals(
  totalLen: number,
  blocked: Array<[number, number]>
): Array<[number, number]> {
  if (totalLen <= 0.005) return [];
  const sorted = blocked
    .map(([a, b]): [number, number] => [Math.max(0, Math.min(totalLen, a)), Math.max(0, Math.min(totalLen, b))])
    .filter(([a, b]) => b > a + 0.005)
    .sort((a, b) => a[0] - b[0]);

  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const [b1, b2] of sorted) {
    if (b1 > cursor + 0.005) {
      spans.push([cursor, b1]);
    }
    cursor = Math.max(cursor, b2);
  }
  if (totalLen > cursor + 0.005) {
    spans.push([cursor, totalLen]);
  }
  return spans;
}

/**
 * Rebuilds a non-indexed ExtrudeGeometry into contiguous face groups:
 *   0 = +Z cap (left physical face, +wall normal)
 *   1 = side / jamb / sill / header reveals (wall core)
 *   2 = -Z cap (right physical face, -wall normal)
 * eliminating duplicate overlapping face skins over openings.
 */
function partitionExtrudedWallFaces(
  rawGeo: THREE.BufferGeometry,
  leftM: number,
  rightM: number
): THREE.BufferGeometry {
  const geo = rawGeo.index ? rawGeo.toNonIndexed() : rawGeo;
  if (geo !== rawGeo) {
    rawGeo.dispose();
  }

  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const vertCount = posAttr.count;
  const triCount = Math.floor(vertCount / 3);

  const leftBucket: number[] = [];
  const coreBucket: number[] = [];
  const rightBucket: number[] = [];

  const leftUvs: number[] = [];
  const coreUvs: number[] = [];
  const rightUvs: number[] = [];

  const tolZ = Math.max(0.0005, Math.abs(leftM - rightM) * 0.05);

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const i1 = i0 + 1;
    const i2 = i0 + 2;

    const x0 = posAttr.getX(i0), y0 = posAttr.getY(i0), z0 = posAttr.getZ(i0);
    const x1 = posAttr.getX(i1), y1 = posAttr.getY(i1), z1 = posAttr.getZ(i1);
    const x2 = posAttr.getX(i2), y2 = posAttr.getY(i2), z2 = posAttr.getZ(i2);

    const ux = x1 - x0, uy = y1 - y0;
    const vx = x2 - x0, vy = y2 - y0;
    const nz = ux * vy - uy * vx;

    const onLeftPlane =
      Math.abs(z0 - leftM) <= tolZ &&
      Math.abs(z1 - leftM) <= tolZ &&
      Math.abs(z2 - leftM) <= tolZ &&
      nz > 0;
    const onRightPlane =
      Math.abs(z0 - rightM) <= tolZ &&
      Math.abs(z1 - rightM) <= tolZ &&
      Math.abs(z2 - rightM) <= tolZ &&
      nz < 0;

    const targetPos = onLeftPlane ? leftBucket : onRightPlane ? rightBucket : coreBucket;
    targetPos.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);

    if (uvAttr) {
      const targetUv = onLeftPlane ? leftUvs : onRightPlane ? rightUvs : coreUvs;
      targetUv.push(
        uvAttr.getX(i0), uvAttr.getY(i0),
        uvAttr.getX(i1), uvAttr.getY(i1),
        uvAttr.getX(i2), uvAttr.getY(i2)
      );
    }
  }

  const orderedPos = new Float32Array(leftBucket.length + coreBucket.length + rightBucket.length);
  orderedPos.set(leftBucket, 0);
  orderedPos.set(coreBucket, leftBucket.length);
  orderedPos.set(rightBucket, leftBucket.length + coreBucket.length);
  geo.setAttribute('position', new THREE.BufferAttribute(orderedPos, 3));

  if (uvAttr) {
    const orderedUvs = new Float32Array(leftUvs.length + coreUvs.length + rightUvs.length);
    orderedUvs.set(leftUvs, 0);
    orderedUvs.set(coreUvs, leftUvs.length);
    orderedUvs.set(rightUvs, leftUvs.length + coreUvs.length);
    geo.setAttribute('uv', new THREE.BufferAttribute(orderedUvs, 2));
  }

  const leftVertCount = leftBucket.length / 3;
  const coreVertCount = coreBucket.length / 3;
  const rightVertCount = rightBucket.length / 3;

  geo.clearGroups();
  if (leftVertCount > 0) geo.addGroup(0, leftVertCount, 0);
  if (coreVertCount > 0) geo.addGroup(leftVertCount, coreVertCount, 1);
  if (rightVertCount > 0) geo.addGroup(leftVertCount + coreVertCount, rightVertCount, 2);

  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds the complete 3D Three.js Group for a wall (straight or curved),
 * binding face materials to their true resolved physical sides and cleanly
 * cutting out openings + splitting trim moldings without overlapping skins.
 */
export function buildWall3DGroup(
  wall: Wall,
  opts: BuildWall3DOptions
): BuildWall3DResult | null {
  const wallGroup = new THREE.Group();
  wallGroup.name = `Wall_${wall.id}`;

  const maxH = opts.cutawayEnabled
    ? Math.min(wall.heightMm, opts.cutawayHeightMm)
    : wall.heightMm;
  const wallH = Math.max(150, maxH) / 1000;
  const thick = wall.thicknessMm / 1000;
  const { left, right } = wallOffsets(wall.thicknessMm, wall.alignment);
  const leftM = left / 1000;
  const rightM = right / 1000;
  const centerOffsetMm = (left + right) / 2;
  const centerOffset = centerOffsetMm / 1000;

  // Bind materials strictly to the true resolved physical wall sides (+normal left vs -normal right)
  const resolvedFaces = resolveWallFaces(wall, opts.rooms);
  const leftMat = resolvedFaces.left.slot === 'inner' ? opts.innerMat : opts.outerMat;
  const rightMat = resolvedFaces.right.slot === 'inner' ? opts.innerMat : opts.outerMat;

  const hostOpenings = opts.openings
    .filter((o) => o.wallId === wall.id && o.visible)
    .sort((a, b) => a.t - b.t);

  // Curved wall builder with true vertical cutouts & trim splits along arc segments
  if (wall.isCurved && Math.abs(wall.curveBulgeMm) >= 1) {
    const arcLenM = Math.max(0.1, getWallArcLength(wall) / 1000);
    const cutouts: WallOpeningCutout[] = [];
    for (const op of hostOpenings) {
      const cx = op.t * arcLenM;
      const hw = Math.min(arcLenM * 0.48, op.widthMm / 2000);
      const x1 = Math.max(0.02, cx - hw);
      const x2 = Math.min(arcLenM - 0.02, cx + hw);
      const rawTop = (op.sillHeightMm + op.heightMm) / 1000;
      const slicedTop = opts.cutawayEnabled && rawTop >= wallH - 0.005;
      const y1 = Math.max(0.001, op.sillHeightMm / 1000);
      const y2 = slicedTop ? wallH : Math.min(wallH - 0.015, rawTop);
      if (x2 > x1 + 0.04 && y2 > y1 + 0.04) {
        cutouts.push({
          op,
          x1,
          x2,
          y1,
          y2,
          tStart: x1 / arcLenM,
          tEnd: x2 / arcLenM,
          slicedTop,
        });
      }
    }

    const baseSteps = 28;
    const priorityBreaks: number[] = [0, 1];
    for (const c of cutouts) {
      const tsC0 = Math.max(0, Math.min(1, c.tStart));
      const tsC1 = Math.max(0, Math.min(1, c.tEnd));
      priorityBreaks.push(tsC0, tsC1);
      if (isNonRectangularCutout(c.op)) {
        const arcSubSteps = 14;
        for (let k = 1; k < arcSubSteps; k++) {
          priorityBreaks.push(tsC0 + ((tsC1 - tsC0) * k) / arcSubSteps);
        }
      }
    }
    const baseBreaks: number[] = [];
    for (let i = 1; i < baseSteps; i++) {
      const t = i / baseSteps;
      if (!priorityBreaks.some((p) => Math.abs(p - t) < 0.002)) {
        baseBreaks.push(t);
      }
    }
    const sortedTs = [...priorityBreaks, ...baseBreaks].sort((a, b) => a - b);
    const ts: number[] = [];
    for (const t of sortedTs) {
      if (ts.length === 0 || t - ts[ts.length - 1] > 0.0005) {
        ts.push(t);
      }
    }
    if (ts.length > 0 && ts[ts.length - 1] < 0.9999) ts.push(1);

    const curvedMats = [opts.coreMat, opts.coreMat, opts.coreMat, opts.coreMat, leftMat, rightMat];
    const bbH = wall.hasBaseboard && wall.baseboardHeightMm > 0 ? Math.min(wallH, wall.baseboardHeightMm / 1000) : 0;
    const crH =
      wall.hasCrownMolding && !opts.cutawayEnabled && wall.crownHeightMm > 0
        ? Math.min(wallH, wall.crownHeightMm / 1000)
        : 0;

    for (let i = 0; i < ts.length - 1; i++) {
      const t0 = ts[i];
      const t1 = ts[i + 1];
      const tMid = (t0 + t1) / 2;

      const c1 = getWallCenterlinePoint(wall, t0);
      const c2 = getWallCenterlinePoint(wall, t1);
      const p1x = (c1.point.x + c1.normal.x * centerOffsetMm) / 1000;
      const p1z = (c1.point.y + c1.normal.y * centerOffsetMm) / 1000;
      const p2x = (c2.point.x + c2.normal.x * centerOffsetMm) / 1000;
      const p2z = (c2.point.y + c2.normal.y * centerOffsetMm) / 1000;

      const segDx = p2x - p1x;
      const segDz = p2z - p1z;
      const segLen = Math.hypot(segDx, segDz);
      if (segLen < 0.004) continue;
      const ang = Math.atan2(segDz, segDx);
      const midX = (p1x + p2x) / 2;
      const midZ = (p1z + p2z) / 2;

      const xMid = tMid * arcLenM;
      const blockedSpans: Array<[number, number]> = [];
      let minHoleBottom = Infinity;
      let maxHoleTop = -Infinity;
      for (const c of cutouts) {
        const span = getCutoutVerticalSpanAtX(c, xMid);
        if (span) {
          blockedSpans.push(span);
          minHoleBottom = Math.min(minHoleBottom, span[0]);
          maxHoleTop = Math.max(maxHoleTop, span[1]);
        }
      }

      const verticalSpans =
        blockedSpans.length > 0 ? subtractSolidIntervals(wallH, blockedSpans) : ([[0, wallH]] as Array<[number, number]>);

      const touchesOpeningEdge = cutouts.some(
        (c) =>
          Math.abs(t0 - c.tStart) < 0.001 ||
          Math.abs(t0 - c.tEnd) < 0.001 ||
          Math.abs(t1 - c.tStart) < 0.001 ||
          Math.abs(t1 - c.tEnd) < 0.001
      );
      const padLen = touchesOpeningEdge ? 0 : 0.004;

      for (const [yA, yB] of verticalSpans) {
        const spanH = yB - yA;
        if (spanH < 0.008) continue;
        const segGeo = new THREE.BoxGeometry(segLen + padLen, spanH, thick);
        opts.onCurvedSegmentGeo?.(segGeo, i);
        const segMesh = new THREE.Mesh(segGeo, curvedMats);
        segMesh.position.set(midX, (yA + yB) / 2, midZ);
        segMesh.rotation.y = -ang;
        segMesh.castShadow = opts.castShadows;
        segMesh.receiveShadow = opts.castShadows;
        wallGroup.add(segMesh);
      }

      if (bbH > 0 && opts.baseboardMat && (blockedSpans.length === 0 || minHoleBottom >= bbH + 0.002)) {
        const bbSeg = new THREE.Mesh(new THREE.BoxGeometry(segLen + padLen, bbH, thick + 0.018), opts.baseboardMat);
        bbSeg.position.set(midX, bbH / 2, midZ);
        bbSeg.rotation.y = -ang;
        bbSeg.receiveShadow = opts.castShadows;
        wallGroup.add(bbSeg);
      }
      if (crH > 0 && opts.crownMat && (blockedSpans.length === 0 || maxHoleTop <= wallH - crH - 0.002)) {
        const crSeg = new THREE.Mesh(new THREE.BoxGeometry(segLen + padLen, crH, thick + 0.025), opts.crownMat);
        crSeg.position.set(midX, wallH - crH / 2, midZ);
        crSeg.rotation.y = -ang;
        wallGroup.add(crSeg);
      }
    }

    const straightDx = (wall.end.x - wall.start.x) / 1000;
    const straightDz = (wall.end.y - wall.start.y) / 1000;
    const straightLen = Math.hypot(straightDx, straightDz) || 1;
    return {
      wallGroup,
      normalX: -straightDz / straightLen,
      normalZ: straightDx / straightLen,
    };
  }

  // Straight wall
  const dx = (wall.end.x - wall.start.x) / 1000;
  const dz = (wall.end.y - wall.start.y) / 1000;
  const len = Math.hypot(dx, dz);
  if (len < 0.02) return null;
  const angle = Math.atan2(dz, dx);
  const ux = dx / len;
  const uz = dz / len;

  // Mitered corner extensions along wall axis so outside & inside 3D corners connect cleanly
  let uStartL = 0;
  let uStartR = 0;
  let uEndL = len;
  let uEndR = len;
  const poly = computeWallPolygon(wall, opts.allWalls);
  if (poly.length === 4) {
    const projU = (pt: { x: number; y: number }) =>
      ((pt.x - wall.start.x) * ux + (pt.y - wall.start.y) * uz) / 1000;
    uStartL = projU(poly[0]);
    uEndL = projU(poly[1]);
    uEndR = projU(poly[2]);
    uStartR = projU(poly[3]);
  }

  const applyMiterSkew = (
    geo: THREE.BufferGeometry,
    zMin: number,
    zMax: number,
    sL: number,
    sR: number,
    eL: number,
    eR: number
  ) => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const spanZ = zMax - zMin;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const tZ = Math.abs(spanZ) > 1e-4 ? Math.max(0, Math.min(1, (z - zMin) / spanZ)) : 0.5;
      if (x <= 0.001) {
        pos.setX(i, sR + tZ * (sL - sR));
      } else if (x >= len - 0.001) {
        pos.setX(i, eR + tZ * (eL - eR));
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };

  const wallWrapper = new THREE.Group();
  wallWrapper.position.set(wall.start.x / 1000, 0, wall.start.y / 1000);
  wallWrapper.rotation.y = -angle;

  const cutouts: WallOpeningCutout[] = [];
  for (const op of hostOpenings) {
    const cx = op.t * len;
    const hw = Math.min(len * 0.48, op.widthMm / 2000);
    const x1 = Math.max(0.02, cx - hw);
    const x2 = Math.min(len - 0.02, cx + hw);
    const rawTop = (op.sillHeightMm + op.heightMm) / 1000;
    const slicedTop = opts.cutawayEnabled && rawTop >= wallH - 0.005;
    const y1 = Math.max(0.001, op.sillHeightMm / 1000);
    const y2 = slicedTop ? wallH : Math.min(wallH - 0.015, rawTop);
    if (x2 > x1 + 0.04 && y2 > y1 + 0.04) {
      cutouts.push({ op, x1, x2, y1, y2, tStart: x1 / len, tEnd: x2 / len, slicedTop });
    }
  }

  // Clamp miter extensions so acute corner miters never fold across an opening cutout
  if (cutouts.length > 0) {
    const minCutX = Math.min(...cutouts.map((c) => c.x1)) - 0.004;
    const maxCutX = Math.max(...cutouts.map((c) => c.x2)) + 0.004;
    uStartL = Math.min(uStartL, minCutX);
    uStartR = Math.min(uStartR, minCutX);
    uEndL = Math.max(uEndL, maxCutX);
    uEndR = Math.max(uEndR, maxCutX);
  }

  // Separate top-edge cutaway notches (which dip the top outer wall contour) from enclosed holes
  const topNotches = cutouts.filter((c) => c.slicedTop);
  const enclosedCutouts = cutouts.filter((c) => !c.slicedTop);

  // Outer perimeter (CCW), dipping down across any cutaway-sliced openings so no lintel bar blocks them
  const wallShape = new THREE.Shape();
  wallShape.moveTo(0, 0);
  wallShape.lineTo(len, 0);
  wallShape.lineTo(len, wallH);

  if (topNotches.length === 0) {
    wallShape.lineTo(0, wallH);
  } else {
    const notchIntervals: Array<[number, number]> = topNotches.map((n) => [n.x1, n.x2]);
    const solidTopSpans = subtractSolidIntervals(len, notchIntervals);
    // Walk top edge right-to-left (x = len -> x = 0)
    const notchBounds: Array<{ x1: number; x2: number }> = [];
    let cur = 0;
    const sortedNotches = [...notchIntervals].sort((a, b) => a[0] - b[0]);
    for (const [a, b] of sortedNotches) {
      if (notchBounds.length === 0 || a > notchBounds[notchBounds.length - 1].x2 + 0.002) {
        notchBounds.push({ x1: a, x2: b });
      } else {
        notchBounds[notchBounds.length - 1].x2 = Math.max(notchBounds[notchBounds.length - 1].x2, b);
      }
      cur = Math.max(cur, b);
    }
    void solidTopSpans;
    for (let i = notchBounds.length - 1; i >= 0; i--) {
      const nb = notchBounds[i];
      wallShape.lineTo(nb.x2, wallH);
      // Sample bottom profile across [nb.x2 -> nb.x1] (supports round/curved bottoms when cutaway slices mid-circle)
      const subSteps = 10;
      for (let s = 0; s <= subSteps; s++) {
        const sx = nb.x2 - ((nb.x2 - nb.x1) * s) / subSteps;
        const probeX = Math.min(nb.x2 - 1e-4, Math.max(nb.x1 + 1e-4, sx));
        let floorY = wallH;
        for (const n of topNotches) {
          const sp = getCutoutVerticalSpanAtX(n, probeX);
          if (sp) floorY = Math.min(floorY, sp[0]);
        }
        wallShape.lineTo(sx, Math.max(0.001, Math.min(wallH - 0.01, floorY)));
      }
      wallShape.lineTo(nb.x1, wallH);
    }
    wallShape.lineTo(0, wallH);
  }
  wallShape.closePath();

  // Cluster overlapping or touching enclosed holes so Earcut never receives intersecting hole paths
  const visited = new Array<boolean>(enclosedCutouts.length).fill(false);
  const clusters: WallOpeningCutout[][] = [];
  const holesTouchOrOverlap = (a: WallOpeningCutout, b: WallOpeningCutout) =>
    a.x1 <= b.x2 + 0.003 &&
    b.x1 <= a.x2 + 0.003 &&
    a.y1 <= b.y2 + 0.003 &&
    b.y1 <= a.y2 + 0.003;

  for (let i = 0; i < enclosedCutouts.length; i++) {
    if (visited[i]) continue;
    visited[i] = true;
    const cluster: WallOpeningCutout[] = [enclosedCutouts[i]];
    const queue = [enclosedCutouts[i]];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (let j = 0; j < enclosedCutouts.length; j++) {
        if (!visited[j] && holesTouchOrOverlap(curr, enclosedCutouts[j])) {
          visited[j] = true;
          cluster.push(enclosedCutouts[j]);
          queue.push(enclosedCutouts[j]);
        }
      }
    }
    clusters.push(cluster);
  }

  for (const cluster of clusters) {
    if (cluster.length === 1) {
      wallShape.holes.push(buildExactSingleCutoutPath(cluster[0]));
    } else {
      for (const path of buildMergedClusterHolePaths(cluster)) {
        wallShape.holes.push(path);
      }
    }
  }

  const rawExtrudeGeo = new THREE.ExtrudeGeometry(wallShape, {
    depth: thick,
    bevelEnabled: false,
  });
  rawExtrudeGeo.translate(0, 0, -thick / 2 + centerOffset);
  const extrudeGeo = partitionExtrudedWallFaces(rawExtrudeGeo, leftM, rightM);
  applyMiterSkew(extrudeGeo, rightM, leftM, uStartL, uStartR, uEndL, uEndR);

  const wallMesh = new THREE.Mesh(extrudeGeo, [leftMat, opts.coreMat, rightMat]);
  wallMesh.castShadow = opts.castShadows;
  wallMesh.receiveShadow = opts.castShadows;
  wallWrapper.add(wallMesh);

  // Split baseboard skirting around openings whose sill dips into the baseboard band
  if (wall.hasBaseboard && wall.baseboardHeightMm > 0 && opts.baseboardMat) {
    const bbH = Math.min(wallH, wall.baseboardHeightMm / 1000);
    const bbBlocked = cutouts
      .filter((c) => c.y1 < bbH + 0.002)
      .map((c): [number, number] => [c.x1, c.x2]);
    for (const [a, b] of subtractSolidIntervals(len, bbBlocked)) {
      const bbGeo = new THREE.BoxGeometry(b - a, bbH, thick + 0.018);
      bbGeo.translate((a + b) / 2, bbH / 2, centerOffset);
      applyMiterSkew(bbGeo, rightM - 0.009, leftM + 0.009, uStartL, uStartR, uEndL, uEndR);
      const bbMesh = new THREE.Mesh(bbGeo, opts.baseboardMat);
      bbMesh.receiveShadow = opts.castShadows;
      wallWrapper.add(bbMesh);
    }
  }

  // Split crown molding around openings whose head reaches into the crown band
  if (wall.hasCrownMolding && !opts.cutawayEnabled && wall.crownHeightMm > 0 && opts.crownMat) {
    const crH = Math.min(wallH, wall.crownHeightMm / 1000);
    const crBlocked = cutouts
      .filter((c) => c.y2 > wallH - crH - 0.002)
      .map((c): [number, number] => [c.x1, c.x2]);
    for (const [a, b] of subtractSolidIntervals(len, crBlocked)) {
      const crGeo = new THREE.BoxGeometry(b - a, crH, thick + 0.025);
      crGeo.translate((a + b) / 2, wallH - crH / 2, centerOffset);
      applyMiterSkew(crGeo, rightM - 0.0125, leftM + 0.0125, uStartL, uStartR, uEndL, uEndR);
      const crMesh = new THREE.Mesh(crGeo, opts.crownMat);
      wallWrapper.add(crMesh);
    }
  }

  wallGroup.add(wallWrapper);

  return {
    wallGroup,
    normalX: -dz / len,
    normalZ: dx / len,
  };
}
