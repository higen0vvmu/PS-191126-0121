import {
  ArchElement,
  Curtain,
  FurnitureInstance,
  FurniturePart,
  Level,
  Opening,
  Point2D,
  ProjectionViewId,
  ResizeAnchor,
  Room,
  Wall,
  WallAlignment,
} from '../types/plan';
import {
  resolveFurnitureMountingType,
} from './mounting';
import { uid } from './units';

export function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function lerpPoint(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function wallOffsets(thicknessMm: number, alignment: WallAlignment): { left: number; right: number } {
  // Left normal is (-dy/L, dx/L)
  if (alignment === 'inner') {
    return { left: thicknessMm, right: 0 };
  }
  if (alignment === 'outer') {
    return { left: 0, right: -thicknessMm };
  }
  return { left: thicknessMm / 2, right: -thicknessMm / 2 };
}

export function projectPointOnSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D
): { point: Point2D; t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return { point: { ...a }, t: 0, distance: dist(p, a) };
  }
  const rawT = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, rawT));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { point: proj, t, distance: dist(p, proj) };
}

export function lineIntersection(
  p1: Point2D,
  d1: Point2D,
  p2: Point2D,
  d2: Point2D
): Point2D | null {
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-6) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const t = (dx * d2.y - dy * d2.x) / cross;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}

export function segmentIntersection(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D
): { point: Point2D; tA: number; tB: number } | null {
  const dA = { x: a2.x - a1.x, y: a2.y - a1.y };
  const dB = { x: b2.x - b1.x, y: b2.y - b1.y };
  const cross = dA.x * dB.y - dA.y * dB.x;
  if (Math.abs(cross) < 1e-6) return null;
  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const tA = (dx * dB.y - dy * dB.x) / cross;
  const tB = (dx * dA.y - dy * dA.x) / cross;
  if (tA > 0.001 && tA < 0.999 && tB > 0.001 && tB < 0.999) {
    return {
      point: { x: a1.x + tA * dA.x, y: a1.y + tA * dA.y },
      tA,
      tB,
    };
  }
  return null;
}

export function getWallCenterlinePoint(wall: Wall, t: number): {
  point: Point2D;
  tangent: Point2D;
  normal: Point2D;
} {
  if (!wall.isCurved || Math.abs(wall.curveBulgeMm) < 1) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const tangent = { x: dx / len, y: dy / len };
    const normal = { x: -tangent.y, y: tangent.x };
    return {
      point: lerpPoint(wall.start, wall.end, t),
      tangent,
      normal,
    };
  }

  // Quadratic Bezier where control point is midpoint + normal * 2 * curveBulgeMm
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const baseNormal = { x: -dy / len, y: dx / len };
  const mid = lerpPoint(wall.start, wall.end, 0.5);
  const ctrl = {
    x: mid.x + baseNormal.x * wall.curveBulgeMm * 2,
    y: mid.y + baseNormal.y * wall.curveBulgeMm * 2,
  };

  const u = 1 - t;
  const point = {
    x: u * u * wall.start.x + 2 * u * t * ctrl.x + t * t * wall.end.x,
    y: u * u * wall.start.y + 2 * u * t * ctrl.y + t * t * wall.end.y,
  };
  const dxdt = 2 * u * (ctrl.x - wall.start.x) + 2 * t * (wall.end.x - ctrl.x);
  const dydt = 2 * u * (ctrl.y - wall.start.y) + 2 * t * (wall.end.y - ctrl.y);
  const tLen = Math.hypot(dxdt, dydt) || 1;
  const tangent = { x: dxdt / tLen, y: dydt / tLen };
  const normal = { x: -tangent.y, y: tangent.x };
  return { point, tangent, normal };
}

export function getWallArcLength(wall: Wall): number {
  if (!wall.isCurved || Math.abs(wall.curveBulgeMm) < 1) {
    return dist(wall.start, wall.end);
  }
  let total = 0;
  let prev = wall.start;
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    const cur = getWallCenterlinePoint(wall, i / steps).point;
    total += dist(prev, cur);
    prev = cur;
  }
  return total;
}

/**
 * Computes a clean 2D wall polygon with mitered corner joins and T-junction awareness.
 * Ensures wall thickness joins seamlessly without eating into interior space.
 */
export function computeWallPolygon(wall: Wall, allWalls: Wall[]): Point2D[] {
  if (wall.isCurved && Math.abs(wall.curveBulgeMm) >= 1) {
    const steps = 18;
    const { left, right } = wallOffsets(wall.thicknessMm, wall.alignment);
    const leftPts: Point2D[] = [];
    const rightPts: Point2D[] = [];
    for (let i = 0; i <= steps; i++) {
      const { point, normal } = getWallCenterlinePoint(wall, i / steps);
      leftPts.push({ x: point.x + normal.x * left, y: point.y + normal.y * left });
      rightPts.push({ x: point.x + normal.x * right, y: point.y + normal.y * right });
    }
    return [...leftPts, ...rightPts.reverse()];
  }

  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [];

  const u = { x: dx / len, y: dy / len };
  const n = { x: -u.y, y: u.x };
  const { left, right } = wallOffsets(wall.thicknessMm, wall.alignment);

  let sLeft = { x: wall.start.x + n.x * left, y: wall.start.y + n.y * left };
  let sRight = { x: wall.start.x + n.x * right, y: wall.start.y + n.y * right };
  let eLeft = { x: wall.end.x + n.x * left, y: wall.end.y + n.y * left };
  let eRight = { x: wall.end.x + n.x * right, y: wall.end.y + n.y * right };

  const maxMitreDist = Math.max(wall.thicknessMm * 4, 800);
  const joinTolMm = 6;

  const clampMitrePoint = (pt: Point2D | null, vertex: Point2D, fallback: Point2D): Point2D => {
    if (!pt) return fallback;
    const d = dist(pt, vertex);
    if (d <= maxMitreDist) return pt;
    if (d < 1e-3) return fallback;
    const scale = maxMitreDist / d;
    return {
      x: vertex.x + (pt.x - vertex.x) * scale,
      y: vertex.y + (pt.y - vertex.y) * scale,
    };
  };

  const computeMitreAtEndpoint = (
    vertex: Point2D,
    isStart: boolean,
    defaultLeft: Point2D,
    defaultRight: Point2D
  ): { leftPt: Point2D; rightPt: Point2D } => {
    const dirOut = isStart ? u : { x: -u.x, y: -u.y };
    const baseAngle = Math.atan2(dirOut.y, dirOut.x);

    const neighbors: Array<{
      delta: number;
      ou: Point2D;
      plusFacePt: Point2D;
      minusFacePt: Point2D;
    }> = [];

    for (const other of allWalls) {
      if (other.id === wall.id || other.isCurved) continue;
      const startsAtVertex = dist(other.start, vertex) < joinTolMm;
      const endsAtVertex = dist(other.end, vertex) < joinTolMm;
      if (!startsAtVertex && !endsAtVertex) continue;

      const odx = other.end.x - other.start.x;
      const ody = other.end.y - other.start.y;
      const olen = Math.hypot(odx, ody);
      if (olen < 1) continue;

      const ou = { x: odx / olen, y: ody / olen };
      const on = { x: -ou.y, y: ou.x };
      const oOff = wallOffsets(other.thicknessMm, other.alignment);
      const oDirOut = startsAtVertex ? ou : { x: -ou.x, y: -ou.y };

      let delta = Math.atan2(oDirOut.y, oDirOut.x) - baseAngle;
      delta = ((delta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (delta < 0.015 || delta > Math.PI * 2 - 0.015) continue;

      // Relative to oDirOut, +oPerp is left-normal of oDirOut.
      // When other starts at vertex, on === +oPerp (left is +oPerp, right is -oPerp).
      // When other ends at vertex, on === -oPerp (right is +oPerp, left is -oPerp).
      const plusOff = startsAtVertex ? oOff.left : oOff.right;
      const minusOff = startsAtVertex ? oOff.right : oOff.left;

      neighbors.push({
        delta,
        ou,
        plusFacePt: { x: vertex.x + on.x * plusOff, y: vertex.y + on.y * plusOff },
        minusFacePt: { x: vertex.x + on.x * minusOff, y: vertex.y + on.y * minusOff },
      });
    }

    if (neighbors.length >= 1) {
      neighbors.sort((a, b) => a.delta - b.delta);
      const ccwNeighbor = neighbors[0]; // meets wall's +perp(dirOut) face with its -oPerp face
      const cwNeighbor = neighbors[neighbors.length - 1]; // meets wall's -perp(dirOut) face with its +oPerp face

      // At isStart, wall.left is +perp(dirOut) and wall.right is -perp(dirOut).
      // At !isStart, wall.right is +perp(dirOut) and wall.left is -perp(dirOut).
      const leftInt = isStart
        ? lineIntersection(defaultLeft, u, ccwNeighbor.minusFacePt, ccwNeighbor.ou)
        : lineIntersection(defaultLeft, u, cwNeighbor.plusFacePt, cwNeighbor.ou);
      const rightInt = isStart
        ? lineIntersection(defaultRight, u, cwNeighbor.plusFacePt, cwNeighbor.ou)
        : lineIntersection(defaultRight, u, ccwNeighbor.minusFacePt, ccwNeighbor.ou);

      return {
        leftPt: clampMitrePoint(leftInt, vertex, defaultLeft),
        rightPt: clampMitrePoint(rightInt, vertex, defaultRight),
      };
    }

    // Check if endpoint terminates in a T-junction on another wall body
    for (const other of allWalls) {
      if (other.id === wall.id || other.isCurved) continue;
      const proj = projectPointOnSegment(vertex, other.start, other.end);
      if (proj.distance < joinTolMm && proj.t > 0.01 && proj.t < 0.99) {
        const odx = other.end.x - other.start.x;
        const ody = other.end.y - other.start.y;
        const olen = Math.hypot(odx, ody) || 1;
        const ou = { x: odx / olen, y: ody / olen };
        const on = { x: -ou.y, y: ou.x };
        const oOff = wallOffsets(other.thicknessMm, other.alignment);
        const wallMid = lerpPoint(wall.start, wall.end, 0.5);
        const sideSign = (wallMid.x - vertex.x) * on.x + (wallMid.y - vertex.y) * on.y;
        const faceOffset = sideSign >= 0 ? oOff.left : oOff.right;
        const facePt = { x: vertex.x + on.x * faceOffset, y: vertex.y + on.y * faceOffset };

        const intL = lineIntersection(defaultLeft, u, facePt, ou);
        const intR = lineIntersection(defaultRight, u, facePt, ou);
        return {
          leftPt: clampMitrePoint(intL, vertex, defaultLeft),
          rightPt: clampMitrePoint(intR, vertex, defaultRight),
        };
      }
    }

    return { leftPt: defaultLeft, rightPt: defaultRight };
  };

  const startMitre = computeMitreAtEndpoint(wall.start, true, sLeft, sRight);
  const endMitre = computeMitreAtEndpoint(wall.end, false, eLeft, eRight);
  sLeft = startMitre.leftPt;
  sRight = startMitre.rightPt;
  eLeft = endMitre.leftPt;
  eRight = endMitre.rightPt;

  return [sLeft, eLeft, eRight, sRight];
}

export function computePolygonSignedAreaMm2(points: Point2D[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function computePolygonAreaM2(points: Point2D[]): number {
  return Math.abs(computePolygonSignedAreaMm2(points)) / 1_000_000;
}

export function computePolygonPerimeterM(points: Point2D[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    total += dist(points[i], points[(i + 1) % points.length]);
  }
  return total / 1000;
}

export function pointInPolygon(p: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly: Point2D[]): Point2D {
  if (poly.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i];
    const p1 = poly[(i + 1) % poly.length];
    const cross = p0.x * p1.y - p1.x * p0.y;
    sx += (p0.x + p1.x) * cross;
    sy += (p0.y + p1.y) * cross;
    area += cross;
  }
  if (Math.abs(area) < 1e-3) {
    const avgX = poly.reduce((acc, p) => acc + p.x, 0) / poly.length;
    const avgY = poly.reduce((acc, p) => acc + p.y, 0) / poly.length;
    return { x: avgX, y: avgY };
  }
  return { x: sx / (3 * area), y: sy / (3 * area) };
}

/**
 * Splits a wall at point P (or parametric t) and remaps all openings on that wall
 * cleanly onto the resulting two wall segments.
 */
export function splitWallAtPoint(
  wall: Wall,
  splitPt: Point2D,
  openings: Opening[]
): { walls: [Wall, Wall]; openings: Opening[] } {
  const proj = projectPointOnSegment(splitPt, wall.start, wall.end);
  const tSplit = Math.max(0.05, Math.min(0.95, proj.t));
  const splitPoint = lerpPoint(wall.start, wall.end, tSplit);

  const w1: Wall = {
    ...wall,
    id: wall.id,
    end: splitPoint,
    isCurved: false,
    curveBulgeMm: 0,
  };
  const w2: Wall = {
    ...wall,
    id: uid('wall'),
    start: splitPoint,
    isCurved: false,
    curveBulgeMm: 0,
  };

  const updatedOpenings = openings.map((op) => {
    if (op.wallId !== wall.id) return op;
    if (op.t <= tSplit) {
      return { ...op, t: Math.max(0.05, Math.min(0.95, op.t / tSplit)) };
    }
    return {
      ...op,
      wallId: w2.id,
      t: Math.max(0.05, Math.min(0.95, (op.t - tSplit) / (1 - tSplit))),
    };
  });

  return { walls: [w1, w2], openings: updatedOpenings };
}

/**
 * Planar face detection: splits intersecting segments, merges vertices, peels spurs,
 * and extracts all minimal enclosed rooms. Preserves existing room names/styles.
 */
export function detectRoomsFromWalls(
  walls: Wall[],
  existingRooms: Room[],
  defaultCeilingHeightMm = 2800
): Room[] {
  if (walls.length < 3) return [];

  // 1. Sample curved walls as chords and collect raw segments
  interface Seg {
    a: Point2D;
    b: Point2D;
  }
  const rawSegs: Seg[] = [];
  for (const w of walls) {
    if (dist(w.start, w.end) < 20) continue;
    if (w.isCurved && Math.abs(w.curveBulgeMm) >= 1) {
      const steps = 8;
      let prev = w.start;
      for (let i = 1; i <= steps; i++) {
        const cur = getWallCenterlinePoint(w, i / steps).point;
        rawSegs.push({ a: prev, b: cur });
        prev = cur;
      }
    } else {
      rawSegs.push({ a: w.start, b: w.end });
    }
  }

  // 2. Split segments at T-junctions and crossings
  const splitParams: number[][] = rawSegs.map(() => [0, 1]);
  for (let i = 0; i < rawSegs.length; i++) {
    for (let j = i + 1; j < rawSegs.length; j++) {
      const s1 = rawSegs[i];
      const s2 = rawSegs[j];
      const cross = segmentIntersection(s1.a, s1.b, s2.a, s2.b);
      if (cross) {
        splitParams[i].push(cross.tA);
        splitParams[j].push(cross.tB);
      }
      // Check T-junctions (endpoints of s1 on s2 and vice versa)
      for (const pt of [s1.a, s1.b]) {
        const p = projectPointOnSegment(pt, s2.a, s2.b);
        if (p.distance < 6 && p.t > 0.01 && p.t < 0.99) splitParams[j].push(p.t);
      }
      for (const pt of [s2.a, s2.b]) {
        const p = projectPointOnSegment(pt, s1.a, s1.b);
        if (p.distance < 6 && p.t > 0.01 && p.t < 0.99) splitParams[i].push(p.t);
      }
    }
  }

  // 3. Merge close vertices (< 8mm)
  const vertices: Point2D[] = [];
  const getVertexId = (p: Point2D): number => {
    for (let i = 0; i < vertices.length; i++) {
      if (dist(vertices[i], p) < 8) return i;
    }
    vertices.push({ x: p.x, y: p.y });
    return vertices.length - 1;
  };

  const edgeSet = new Set<string>();
  const undirectedEdges: Array<[number, number]> = [];

  for (let i = 0; i < rawSegs.length; i++) {
    const params = Array.from(new Set(splitParams[i].map((t) => Math.round(t * 10000) / 10000))).sort(
      (a, b) => a - b
    );
    for (let k = 0; k < params.length - 1; k++) {
      const p1 = lerpPoint(rawSegs[i].a, rawSegs[i].b, params[k]);
      const p2 = lerpPoint(rawSegs[i].a, rawSegs[i].b, params[k + 1]);
      if (dist(p1, p2) < 15) continue;
      const u = getVertexId(p1);
      const v = getVertexId(p2);
      if (u === v) continue;
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        undirectedEdges.push([u, v]);
      }
    }
  }

  // 4. Peel degree-1 spurs iteratively
  let activeEdges = [...undirectedEdges];
  let changed = true;
  while (changed) {
    changed = false;
    const deg = new Map<number, number>();
    for (const [u, v] of activeEdges) {
      deg.set(u, (deg.get(u) ?? 0) + 1);
      deg.set(v, (deg.get(v) ?? 0) + 1);
    }
    const filtered = activeEdges.filter(([u, v]) => (deg.get(u) ?? 0) >= 2 && (deg.get(v) ?? 0) >= 2);
    if (filtered.length !== activeEdges.length) {
      activeEdges = filtered;
      changed = true;
    }
  }

  if (activeEdges.length < 3) return [];

  // 5. Build half-edge adjacency sorted by angle
  interface HalfEdge {
    id: number;
    u: number;
    v: number;
    angle: number;
    twin: number;
    visited: boolean;
  }

  const halfEdges: HalfEdge[] = [];
  const adj = new Map<number, number[]>();

  for (const [u, v] of activeEdges) {
    const pu = vertices[u];
    const pv = vertices[v];
    const id1 = halfEdges.length;
    const id2 = id1 + 1;
    halfEdges.push({
      id: id1,
      u,
      v,
      angle: Math.atan2(pv.y - pu.y, pv.x - pu.x),
      twin: id2,
      visited: false,
    });
    halfEdges.push({
      id: id2,
      u: v,
      v: u,
      angle: Math.atan2(pu.y - pv.y, pu.x - pv.x),
      twin: id1,
      visited: false,
    });
    if (!adj.has(u)) adj.set(u, []);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(u)!.push(id1);
    adj.get(v)!.push(id2);
  }

  for (const list of adj.values()) {
    list.sort((a, b) => halfEdges[a].angle - halfEdges[b].angle);
  }

  const nextHalfEdge = (heId: number): number => {
    const he = halfEdges[heId];
    const twinId = he.twin;
    const list = adj.get(he.v)!;
    const idx = list.indexOf(twinId);
    // Walk previous in CCW sorted list to get minimal interior face (CCW cycle in screen-Y-down / math-Y-up)
    const nextIdx = (idx - 1 + list.length) % list.length;
    return list[nextIdx];
  };

  const detectedPolys: Point2D[][] = [];
  for (let i = 0; i < halfEdges.length; i++) {
    if (halfEdges[i].visited) continue;
    const cycle: number[] = [];
    let cur = i;
    let guard = 0;
    while (!halfEdges[cur].visited && guard < 200) {
      halfEdges[cur].visited = true;
      cycle.push(halfEdges[cur].u);
      cur = nextHalfEdge(cur);
      guard++;
    }
    if (cur === i && cycle.length >= 3) {
      const poly = cycle.map((vid) => vertices[vid]);
      const signedArea = computePolygonSignedAreaMm2(poly);
      // Interior minimal faces have positive signed area (> 0.05 m² = 50,000 mm²)
      if (signedArea > 50_000) {
        detectedPolys.push(poly);
      }
    }
  }

  // 6. Match with existing rooms to preserve user names & floor/ceiling customization
  const usedExistingIds = new Set<string>();
  return detectedPolys.map((poly, idx) => {
    const centroid = polygonCentroid(poly);
    let matched: Room | undefined;
    for (const er of existingRooms) {
      if (usedExistingIds.has(er.id)) continue;
      if (pointInPolygon(centroid, er.polygon)) {
        matched = er;
        break;
      }
    }
    if (!matched) {
      // Fallback: nearest centroid within 1.5m
      let bestDist = 1500;
      for (const er of existingRooms) {
        if (usedExistingIds.has(er.id)) continue;
        const d = dist(centroid, polygonCentroid(er.polygon));
        if (d < bestDist) {
          bestDist = d;
          matched = er;
        }
      }
    }
    if (matched) usedExistingIds.add(matched.id);

    const areaM2 = Math.round(computePolygonAreaM2(poly) * 100) / 100;
    const perimeterM = Math.round(computePolygonPerimeterM(poly) * 100) / 100;

    return {
      id: matched?.id ?? uid('room'),
      name: matched?.name ?? `Room ${idx + 1}`,
      polygon: poly,
      areaM2,
      perimeterM,
      floorColor: matched?.floorColor ?? '#FFFFFF',
      floorMaterial: matched?.floorMaterial ?? 'parquet',
      floorTextureScale: matched?.floorTextureScale ?? 1,
      floorTextureRotDeg: matched?.floorTextureRotDeg ?? 0,
      floorLevelMm: matched?.floorLevelMm ?? 0,
      hasCeiling: matched?.hasCeiling ?? true,
      ceilingHeightMm: matched?.ceilingHeightMm ?? defaultCeilingHeightMm,
      ceilingColor: matched?.ceilingColor ?? '#FFFFFF',
      ceilingMaterial: matched?.ceilingMaterial ?? 'paint',
      visible: matched?.visible ?? true,
      locked: matched?.locked ?? false,
    };
  });
}

export function computeWallSurfaceAreaM2(wall: Wall, openings: Opening[]): {
  grossAreaM2: number;
  netAreaM2: number;
  lengthM: number;
} {
  const lengthMm = getWallArcLength(wall);
  const grossMm2 = lengthMm * wall.heightMm;
  const hostOpenings = openings.filter((o) => o.wallId === wall.id);
  const openingMm2 = hostOpenings.reduce((sum, o) => sum + o.widthMm * o.heightMm, 0);
  const netMm2 = Math.max(0, grossMm2 - openingMm2);
  return {
    grossAreaM2: Math.round((grossMm2 / 1_000_000) * 100) / 100,
    netAreaM2: Math.round((netMm2 / 1_000_000) * 100) / 100,
    lengthM: Math.round((lengthMm / 1000) * 100) / 100,
  };
}

export function computeFurnitureBoundsMm(parts: FurniturePart[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
} {
  if (parts.length === 0) {
    return {
      minX: -250,
      maxX: 250,
      minY: -250,
      maxY: 250,
      minZ: 0,
      maxZ: 500,
      widthMm: 500,
      depthMm: 500,
      heightMm: 500,
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const p of parts) {
    const rad = (p.rotationDeg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const halfW = (p.widthMm * cos + p.depthMm * sin) / 2;
    const halfD = (p.widthMm * sin + p.depthMm * cos) / 2;
    minX = Math.min(minX, p.xMm - halfW);
    maxX = Math.max(maxX, p.xMm + halfW);
    minY = Math.min(minY, p.yMm - halfD);
    maxY = Math.max(maxY, p.yMm + halfD);
    minZ = Math.min(minZ, p.zMm);
    maxZ = Math.max(maxZ, p.zMm + p.heightMm);
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    widthMm: Math.max(10, Math.round(maxX - minX)),
    depthMm: Math.max(10, Math.round(maxY - minY)),
    heightMm: Math.max(10, Math.round(maxZ - minZ)),
  };
}

export function scaleFurnitureParts(
  parts: FurniturePart[],
  scaleX: number,
  scaleY: number,
  scaleZ: number
): FurniturePart[] {
  return parts.map((p) => ({
    ...p,
    xMm: Math.round(p.xMm * scaleX),
    yMm: Math.round(p.yMm * scaleY),
    zMm: Math.round(p.zMm * scaleZ),
    widthMm: Math.max(10, Math.round(p.widthMm * scaleX)),
    depthMm: Math.max(10, Math.round(p.depthMm * scaleY)),
    heightMm: Math.max(10, Math.round(p.heightMm * scaleZ)),
  }));
}

export function getPlanCorners(
  walls: Wall[],
  furniture: FurnitureInstance[] = []
): Point2D[] {
  const corners: Point2D[] = [];
  for (const w of walls) {
    if (!w.visible) continue;
    corners.push({ ...w.start }, { ...w.end });
    const poly = computeWallPolygon(w, walls);
    for (const p of poly) {
      corners.push({ ...p });
    }
  }
  for (const f of furniture) {
    if (!f.visible) continue;
    const b = computeFurnitureBoundsMm(f.parts);
    const rad = (f.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const mx = f.mirroredX ? -1 : 1;
    const my = f.mirroredY ? -1 : 1;
    const localCorners = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ];
    for (const lc of localCorners) {
      const lx = lc.x * mx;
      const ly = lc.y * my;
      corners.push({
        x: Math.round(f.xMm + lx * cos - ly * sin),
        y: Math.round(f.yMm + lx * sin + ly * cos),
      });
    }
  }
  return corners;
}

export interface AlignmentGuide {
  axis: 'x' | 'y' | 'ext' | 'perp';
  from: Point2D;
  to: Point2D;
  coordMm?: number;
  label?: string;
}

export interface ConnectedWallEndpoint {
  wallId: string;
  endpoint: 'start' | 'end';
  point: Point2D;
}

export interface NearMissWallGap {
  wallAId: string;
  endA: 'start' | 'end';
  pointA: Point2D;
  wallBId: string;
  endB: 'start' | 'end';
  pointB: Point2D;
  distanceMm: number;
}

export function findConnectedWallEndpoints(
  walls: Wall[],
  point: Point2D,
  tolMm = 8,
  excludeWallIds?: Set<string>
): ConnectedWallEndpoint[] {
  const hits: ConnectedWallEndpoint[] = [];
  for (const w of walls) {
    if (w.visible === false) continue;
    if (excludeWallIds?.has(w.id)) continue;
    if (dist(w.start, point) <= tolMm) {
      hits.push({ wallId: w.id, endpoint: 'start', point: { ...w.start } });
    }
    if (dist(w.end, point) <= tolMm) {
      hits.push({ wallId: w.id, endpoint: 'end', point: { ...w.end } });
    }
  }
  return hits;
}

export function findNearMissWallGaps(
  walls: Wall[],
  maxGapMm = 260,
  minGapMm = 6
): NearMissWallGap[] {
  const visible = walls.filter((w) => w.visible !== false && dist(w.start, w.end) >= 10);
  const endpoints: Array<{ wallId: string; end: 'start' | 'end'; pt: Point2D }> = [];
  for (const w of visible) {
    endpoints.push({ wallId: w.id, end: 'start', pt: w.start });
    endpoints.push({ wallId: w.id, end: 'end', pt: w.end });
  }

  const gaps: NearMissWallGap[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < endpoints.length; i++) {
    const a = endpoints[i];
    // Only flag gaps for endpoints that aren't already cleanly joined to another wall
    const alreadyJoined = endpoints.some(
      (o, j) => j !== i && o.wallId !== a.wallId && dist(o.pt, a.pt) < minGapMm
    );
    if (alreadyJoined) continue;

    let bestB: (typeof endpoints)[number] | null = null;
    let bestD = maxGapMm;
    for (let j = 0; j < endpoints.length; j++) {
      if (i === j) continue;
      const b = endpoints[j];
      if (b.wallId === a.wallId) continue;
      const d = dist(a.pt, b.pt);
      if (d >= minGapMm && d <= bestD) {
        bestD = d;
        bestB = b;
      }
    }
    if (bestB) {
      const k1 = `${a.wallId}:${a.end}`;
      const k2 = `${bestB.wallId}:${bestB.end}`;
      const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      if (!seen.has(key)) {
        seen.add(key);
        gaps.push({
          wallAId: a.wallId,
          endA: a.end,
          pointA: { ...a.pt },
          wallBId: bestB.wallId,
          endB: bestB.end,
          pointB: { ...bestB.pt },
          distanceMm: Math.round(bestD),
        });
      }
    }
  }
  return gaps;
}

export function healNearWallGaps(
  walls: Wall[],
  maxGapMm = 260
): { walls: Wall[]; healedCount: number } {
  const nextWalls = walls.map((w) => ({
    ...w,
    start: { ...w.start },
    end: { ...w.end },
  }));
  const eps: Array<{ wallIdx: number; end: 'start' | 'end'; pt: Point2D; locked: boolean }> = [];
  nextWalls.forEach((w, idx) => {
    if (w.visible === false || dist(w.start, w.end) < 10) return;
    eps.push({ wallIdx: idx, end: 'start', pt: w.start, locked: w.locked });
    eps.push({ wallIdx: idx, end: 'end', pt: w.end, locked: w.locked });
  });

  const visited = new Array<boolean>(eps.length).fill(false);
  let healedCount = 0;

  for (let i = 0; i < eps.length; i++) {
    if (visited[i]) continue;
    const cluster: number[] = [i];
    visited[i] = true;
    for (let q = 0; q < cluster.length; q++) {
      const cur = eps[cluster[q]];
      for (let j = 0; j < eps.length; j++) {
        if (visited[j]) continue;
        if (eps[j].wallIdx === cur.wallIdx) continue;
        if (dist(cur.pt, eps[j].pt) <= maxGapMm) {
          visited[j] = true;
          cluster.push(j);
        }
      }
    }
    if (cluster.length < 2) continue;

    // Check if any endpoints in this cluster are actually separated (>= 2mm)
    let maxPairDist = 0;
    for (let a = 0; a < cluster.length; a++) {
      for (let b = a + 1; b < cluster.length; b++) {
        maxPairDist = Math.max(maxPairDist, dist(eps[cluster[a]].pt, eps[cluster[b]].pt));
      }
    }
    if (maxPairDist < 2) continue;

    const lockedNode = cluster.map((ci) => eps[ci]).find((e) => e.locked);
    let targetPt: Point2D;
    if (lockedNode) {
      targetPt = { ...lockedNode.pt };
    } else {
      // Snap to the average cluster coordinate rounded cleanly
      const sum = cluster.reduce(
        (acc, ci) => ({ x: acc.x + eps[ci].pt.x, y: acc.y + eps[ci].pt.y }),
        { x: 0, y: 0 }
      );
      targetPt = {
        x: Math.round(sum.x / cluster.length),
        y: Math.round(sum.y / cluster.length),
      };
    }

    let movedCluster = false;
    for (const ci of cluster) {
      const node = eps[ci];
      if (node.locked) continue;
      if (dist(node.pt, targetPt) >= 1) {
        if (node.end === 'start') {
          nextWalls[node.wallIdx].start = { ...targetPt };
        } else {
          nextWalls[node.wallIdx].end = { ...targetPt };
        }
        movedCluster = true;
      }
    }
    if (movedCluster) healedCount++;
  }

  return { walls: nextWalls, healedCount };
}

export function snapPointToPlan(
  raw: Point2D,
  options: {
    walls: Wall[];
    furniture?: FurnitureInstance[];
    gridSizeMm: number;
    snapEnabled: boolean;
    angleSnapDeg: number;
    orthoMode: boolean;
    anchor?: Point2D | null;
    excludeWallId?: string;
    excludeWallIds?: string[];
    ignoreEndpoints?: Point2D[];
    ignoreWallEnd?: { wallId: string; endpoint: 'start' | 'end' };
    snapThresholdMm?: number;
    preferCornersOnly?: boolean;
    enableAxisAlignment?: boolean;
  }
): {
  point: Point2D;
  snappedKind: 'vertex' | 'wall' | 'align' | 'grid' | 'none';
  snappedWallId?: string;
  isOpenEndpointSnap?: boolean;
  snapLabel?: string;
  guides: AlignmentGuide[];
} {
  const threshold = options.snapThresholdMm ?? 180;
  const ignoreEps = options.ignoreEndpoints ?? [];
  const excludeSet = new Set<string>(options.excludeWallIds ?? []);
  if (options.excludeWallId) excludeSet.add(options.excludeWallId);

  const isIgnoredEp = (ep: Point2D) => ignoreEps.some((ig) => dist(ig, ep) < 6);
  const visibleWalls = options.walls.filter((w) => w.visible !== false);

  // Determine open (unconnected) endpoints across the entire visible plan so reconnection feels magnetic
  const allEndpointList: Array<{ wallId: string; end: 'start' | 'end'; pt: Point2D }> = [];
  for (const w of visibleWalls) {
    allEndpointList.push({ wallId: w.id, end: 'start', pt: w.start });
    allEndpointList.push({ wallId: w.id, end: 'end', pt: w.end });
  }

  const wallEndpoints: Array<{ pt: Point2D; wallId: string; isOpen: boolean }> = [];
  for (const w of visibleWalls) {
    if (excludeSet.has(w.id)) continue;
    for (const endKind of ['start', 'end'] as const) {
      if (
        options.ignoreWallEnd &&
        options.ignoreWallEnd.wallId === w.id &&
        options.ignoreWallEnd.endpoint === endKind
      ) {
        continue;
      }
      const ep = w[endKind];
      if (!options.ignoreWallEnd && isIgnoredEp(ep)) continue;
      const peerCount = allEndpointList.filter(
        (other) => other.wallId !== w.id && dist(other.pt, ep) < 8
      ).length;
      wallEndpoints.push({ pt: ep, wallId: w.id, isOpen: peerCount === 0 });
    }
  }

  const collectGuidesAt = (pt: Point2D): AlignmentGuide[] => {
    if (options.enableAxisAlignment === false) return [];
    const guides: AlignmentGuide[] = [];
    let bestXTarget: Point2D | null = null;
    let bestXDist = Infinity;
    let bestYTarget: Point2D | null = null;
    let bestYDist = Infinity;
    for (const { pt: ep } of wallEndpoints) {
      if (options.anchor && dist(ep, options.anchor) < 6) continue;
      if (Math.abs(pt.x - ep.x) < 2) {
        const dy = Math.abs(pt.y - ep.y);
        if (dy > 8 && dy < bestXDist) {
          bestXDist = dy;
          bestXTarget = ep;
        }
      }
      if (Math.abs(pt.y - ep.y) < 2) {
        const dx = Math.abs(pt.x - ep.x);
        if (dx > 8 && dx < bestYDist) {
          bestYDist = dx;
          bestYTarget = ep;
        }
      }
    }
    if (bestXTarget) {
      guides.push({ axis: 'x', from: pt, to: { ...bestXTarget }, coordMm: bestXTarget.x });
    }
    if (bestYTarget) {
      guides.push({ axis: 'y', from: pt, to: { ...bestYTarget }, coordMm: bestYTarget.y });
    }
    return guides;
  };

  if (options.snapEnabled) {
    // 1. Priority 1: Snap to wall endpoints & corners (magnetic boost for loose/open endpoints)
    if (options.preferCornersOnly) {
      const corners = getPlanCorners(
        visibleWalls.filter((w) => !excludeSet.has(w.id)),
        options.furniture ?? []
      ).filter((c) => !isIgnoredEp(c));
      let bestPt: Point2D | null = null;
      let bestD = threshold;
      for (const c of corners) {
        const d = dist(raw, c);
        if (d < bestD) {
          bestD = d;
          bestPt = { ...c };
        }
      }
      if (bestPt) {
        return {
          point: bestPt,
          snappedKind: 'vertex',
          snapLabel: 'Corner',
          guides: collectGuidesAt(bestPt),
        };
      }
    } else {
      let bestEp: { pt: Point2D; wallId: string; isOpen: boolean } | null = null;
      let bestScore = Infinity;
      for (const item of wallEndpoints) {
        const d = dist(raw, item.pt);
        const cap = item.isOpen ? threshold * 1.25 : threshold;
        if (d < cap) {
          const score = item.isOpen ? d * 0.8 : d;
          if (score < bestScore) {
            bestScore = score;
            bestEp = item;
          }
        }
      }
      if (bestEp) {
        return {
          point: { ...bestEp.pt },
          snappedKind: 'vertex',
          snappedWallId: bestEp.wallId,
          isOpenEndpointSnap: bestEp.isOpen,
          snapLabel: bestEp.isOpen ? 'Connect Open Corner' : 'Corner Joint',
          guides: collectGuidesAt(bestEp.pt),
        };
      }

      // 2. Priority 2: Angled closing intersections (extension/perpendicular intersections of crooked walls)
      if (options.enableAxisAlignment !== false && !options.orthoMode) {
        type RayGuide = {
          wallId: string;
          origin: Point2D;
          dir: Point2D;
          axis: 'ext' | 'perp';
        };
        const rayGuides: RayGuide[] = [];
        for (const w of visibleWalls) {
          if (excludeSet.has(w.id) || w.isCurved) continue;
          const dx = w.end.x - w.start.x;
          const dy = w.end.y - w.start.y;
          const len = Math.hypot(dx, dy);
          if (len < 20) continue;
          const ux = dx / len;
          const uy = dy / len;
          const nx = -uy;
          const ny = ux;
          // Collinear extension ray (origin chosen as endpoint closer to raw)
          const origExt = dist(raw, w.start) <= dist(raw, w.end) ? w.start : w.end;
          rayGuides.push({ wallId: w.id, origin: origExt, dir: { x: ux, y: uy }, axis: 'ext' });
          // Perpendicular rays at non-ignored endpoints
          for (const epKind of ['start', 'end'] as const) {
            if (
              options.ignoreWallEnd &&
              options.ignoreWallEnd.wallId === w.id &&
              options.ignoreWallEnd.endpoint === epKind
            ) {
              continue;
            }
            const ep = w[epKind];
            if (!options.ignoreWallEnd && isIgnoredEp(ep)) continue;
            rayGuides.push({ wallId: w.id, origin: ep, dir: { x: nx, y: ny }, axis: 'perp' });
          }
        }

        let bestInter: {
          pt: Point2D;
          d: number;
          a: RayGuide;
          b: RayGuide;
        } | null = null;
        const interThreshold = threshold * 0.78;
        for (let i = 0; i < rayGuides.length; i++) {
          for (let j = i + 1; j < rayGuides.length; j++) {
            const gA = rayGuides[i];
            const gB = rayGuides[j];
            if (gA.wallId === gB.wallId) continue;
            const inter = lineIntersection(gA.origin, gA.dir, gB.origin, gB.dir);
            if (!inter) continue;
            if (options.anchor && dist(inter, options.anchor) < 30) continue;
            const d = dist(raw, inter);
            if (d < interThreshold && (!bestInter || d < bestInter.d)) {
              bestInter = { pt: inter, d, a: gA, b: gB };
            }
          }
        }
        if (bestInter) {
          const snappedPt = { x: Math.round(bestInter.pt.x), y: Math.round(bestInter.pt.y) };
          return {
            point: snappedPt,
            snappedKind: 'align',
            snapLabel: 'Angled Intersection',
            guides: [
              { axis: bestInter.a.axis, from: bestInter.a.origin, to: snappedPt },
              { axis: bestInter.b.axis, from: bestInter.b.origin, to: snappedPt },
              ...collectGuidesAt(snappedPt),
            ],
          };
        }
      }

      // 3. Priority 3: Snap onto interior of wall segment (T-junction), away from endpoints
      let bestWallPt: Point2D | null = null;
      let bestWallD = threshold * 0.55;
      let bestWallId: string | undefined;
      for (const w of visibleWalls) {
        if (excludeSet.has(w.id)) continue;
        const proj = projectPointOnSegment(raw, w.start, w.end);
        if (proj.t > 0.03 && proj.t < 0.97 && proj.distance < bestWallD) {
          bestWallD = proj.distance;
          bestWallPt = { x: Math.round(proj.point.x), y: Math.round(proj.point.y) };
          bestWallId = w.id;
        }
      }
      if (bestWallPt) {
        return {
          point: bestWallPt,
          snappedKind: 'wall',
          snappedWallId: bestWallId,
          snapLabel: 'Wall Junction',
          guides: collectGuidesAt(bestWallPt),
        };
      }
    }
  }

  let pt = { ...raw };

  // 4a. Apply ortho or angle snap relative to anchor
  let anchorAxisLock: 'x' | 'y' | null = null;
  if (options.anchor) {
    const dx = pt.x - options.anchor.x;
    const dy = pt.y - options.anchor.y;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      const stepDeg = options.orthoMode ? 90 : options.angleSnapDeg;
      if (stepDeg > 0) {
        const ang = Math.atan2(dy, dx);
        const stepRad = (stepDeg * Math.PI) / 180;
        const snappedAng = Math.round(ang / stepRad) * stepRad;
        pt = {
          x: options.anchor.x + Math.cos(snappedAng) * len,
          y: options.anchor.y + Math.sin(snappedAng) * len,
        };
        if (Math.abs(Math.sin(snappedAng)) < 1e-4) {
          anchorAxisLock = 'y';
          pt.y = options.anchor.y;
        }
        if (Math.abs(Math.cos(snappedAng)) < 1e-4) {
          anchorAxisLock = 'x';
          pt.x = options.anchor.x;
        }
      }
    }
  }

  // 4b. Reference Alignment Guides: Collinear Wall Extension, Perpendicular, and X/Y Endpoint Inference
  let alignedX = false;
  let alignedY = false;
  let alignedAngled = false;
  const angledGuides: AlignmentGuide[] = [];
  const guides: AlignmentGuide[] = [];

  if (options.snapEnabled && options.enableAxisAlignment !== false && !options.preferCornersOnly) {
    const alignTol = Math.max(120, threshold * 1.15);

    // Check crooked/angled wall extension and perpendicular guides (when not strictly locked to Ortho 90°)
    let bestAngled: { pt: Point2D; err: number; guide: AlignmentGuide; label: string } | null = null;
    if (!options.orthoMode) {
      for (const w of visibleWalls) {
        if (excludeSet.has(w.id) || w.isCurved) continue;
        const dx = w.end.x - w.start.x;
        const dy = w.end.y - w.start.y;
        const len = Math.hypot(dx, dy);
        if (len < 20) continue;
        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy;
        const ny = ux;
        // Skip purely horizontal/vertical walls here so X/Y guide logic stays canonical for 0/90 walls
        const isCardinal = Math.abs(ux) < 0.015 || Math.abs(uy) < 0.015;
        if (!isCardinal) {
          // Collinear extension outside the wall segment
          const relX = raw.x - w.start.x;
          const relY = raw.y - w.start.y;
          const sProj = relX * ux + relY * uy;
          const perpErr = Math.abs(relX * nx + relY * ny);
          if ((sProj < -10 || sProj > len + 10) && perpErr < alignTol * 0.85) {
            const snapped = { x: w.start.x + ux * sProj, y: w.start.y + uy * sProj };
            const fromEp = sProj < 0 ? w.start : w.end;
            if (!bestAngled || perpErr < bestAngled.err) {
              bestAngled = {
                pt: snapped,
                err: perpErr,
                guide: { axis: 'ext', from: fromEp, to: snapped, label: 'Wall Extension' },
                label: 'Wall Extension',
              };
            }
          }

          // Perpendicular from wall endpoints
          for (const epKind of ['start', 'end'] as const) {
            if (
              options.ignoreWallEnd &&
              options.ignoreWallEnd.wallId === w.id &&
              options.ignoreWallEnd.endpoint === epKind
            ) {
              continue;
            }
            const ep = w[epKind];
            if (!options.ignoreWallEnd && isIgnoredEp(ep)) continue;
            if (options.anchor && dist(ep, options.anchor) < 6) continue;
            const dX = raw.x - ep.x;
            const dY = raw.y - ep.y;
            const alongN = dX * nx + dY * ny;
            const errU = Math.abs(dX * ux + dY * uy);
            if (Math.abs(alongN) > 25 && errU < alignTol * 0.72) {
              const snapped = { x: ep.x + nx * alongN, y: ep.y + ny * alongN };
              if (!bestAngled || errU < bestAngled.err) {
                bestAngled = {
                  pt: snapped,
                  err: errU,
                  guide: { axis: 'perp', from: ep, to: snapped, label: '90° Perpendicular' },
                  label: '90° Perpendicular',
                };
              }
            }
          }
        }
      }
    }

    // X / Y Wall Endpoint Alignment Inference
    let bestAlignX: Point2D | null = null;
    let bestAlignXErr = alignTol;
    let bestAlignY: Point2D | null = null;
    let bestAlignYErr = alignTol;

    for (const { pt: ep } of wallEndpoints) {
      if (options.anchor && dist(ep, options.anchor) < 6) continue;
      if (anchorAxisLock !== 'x') {
        const ex = Math.abs(pt.x - ep.x);
        if (ex < bestAlignXErr) {
          bestAlignXErr = ex;
          bestAlignX = ep;
        }
      }
      if (anchorAxisLock !== 'y') {
        const ey = Math.abs(pt.y - ep.y);
        if (ey < bestAlignYErr) {
          bestAlignYErr = ey;
          bestAlignY = ep;
        }
      }
    }

    const bestXYErr = Math.min(bestAlignXErr, bestAlignYErr);
    if (bestAngled && (!bestAlignX && !bestAlignY || bestAngled.err < bestXYErr * 0.85)) {
      pt = { ...bestAngled.pt };
      alignedAngled = true;
      angledGuides.push({
        ...bestAngled.guide,
        to: { x: Math.round(pt.x), y: Math.round(pt.y) },
      });
    } else {
      if (bestAlignX) {
        pt.x = bestAlignX.x;
        alignedX = true;
      }
      if (bestAlignY) {
        pt.y = bestAlignY.y;
        alignedY = true;
      }
    }
  }

  // 5. Grid snap (never override an axis or point locked by anchor or alignment guide)
  if (options.snapEnabled && options.gridSizeMm > 0 && !alignedAngled) {
    if (!alignedX && anchorAxisLock !== 'x') {
      pt.x = Math.round(pt.x / options.gridSizeMm) * options.gridSizeMm;
    }
    if (!alignedY && anchorAxisLock !== 'y') {
      pt.y = Math.round(pt.y / options.gridSizeMm) * options.gridSizeMm;
    }
  }

  const finalPt = { x: Math.round(pt.x), y: Math.round(pt.y) };
  if (options.snapEnabled && options.enableAxisAlignment !== false && !options.preferCornersOnly) {
    guides.push(...angledGuides, ...collectGuidesAt(finalPt));
  }

  const anyAligned = alignedX || alignedY || alignedAngled;
  const snapLabel = alignedAngled
    ? angledGuides[0]?.label ?? 'Angled Guide'
    : anyAligned
      ? 'Aligned Guide'
      : options.snapEnabled && options.gridSizeMm > 0
        ? 'Grid'
        : undefined;

  if (options.snapEnabled && options.gridSizeMm > 0) {
    return {
      point: finalPt,
      snappedKind: anyAligned ? 'align' : 'grid',
      snapLabel,
      guides,
    };
  }

  return {
    point: finalPt,
    snappedKind: anyAligned ? 'align' : 'none',
    snapLabel,
    guides,
  };
}

// ============================================================================
// Architectural Dimension Chains, Inside-Corner Clearances & Constraint Solver
// ============================================================================

export interface WallInnerBounds {
  lengthMm: number;
  innerStartS: number;
  innerEndS: number;
  leftStartS: number;
  leftEndS: number;
  rightStartS: number;
  rightEndS: number;
}

export interface WallMountedComponent {
  id: string;
  kind: 'opening' | 'chimney';
  name: string;
  centerS: number;
  widthMm: number;
  leftS: number;
  rightS: number;
  t: number;
  locked: boolean;
  resizeAnchor: ResizeAnchor;
}

export interface WallDimensionSegment {
  key: string;
  kind: 'wall_gap' | 'component';
  startS: number;
  endS: number;
  lengthMm: number;
  componentId?: string;
  componentKind?: 'opening' | 'chimney';
  locked: boolean;
  label: string;
}

export interface NonCrossingClearance {
  side: 'left' | 'right';
  startS: number;
  endS: number;
  lengthMm: number;
  stopsAt: 'corner' | 'component';
  neighborId?: string;
  neighborName?: string;
  locked: boolean;
}

export function computeWallInnerBounds(wall: Wall, allWalls: Wall[]): WallInnerBounds {
  const lengthMm = getWallArcLength(wall);
  if (lengthMm < 1 || (wall.isCurved && Math.abs(wall.curveBulgeMm) >= 1)) {
    return {
      lengthMm,
      innerStartS: 0,
      innerEndS: lengthMm,
      leftStartS: 0,
      leftEndS: lengthMm,
      rightStartS: 0,
      rightEndS: lengthMm,
    };
  }

  const poly = computeWallPolygon(wall, allWalls);
  if (poly.length !== 4) {
    return {
      lengthMm,
      innerStartS: 0,
      innerEndS: lengthMm,
      leftStartS: 0,
      leftEndS: lengthMm,
      rightStartS: 0,
      rightEndS: lengthMm,
    };
  }

  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const u = { x: dx / lengthMm, y: dy / lengthMm };
  const projS = (p: Point2D) => (p.x - wall.start.x) * u.x + (p.y - wall.start.y) * u.y;

  // poly = [sLeft, eLeft, eRight, sRight]
  const leftStartS = projS(poly[0]);
  const leftEndS = projS(poly[1]);
  const rightEndS = projS(poly[2]);
  const rightStartS = projS(poly[3]);

  const rawInnerStart = Math.max(leftStartS, rightStartS);
  const rawInnerEnd = Math.min(leftEndS, rightEndS);

  const innerStartS = Math.max(0, Math.min(lengthMm * 0.45, Math.round(rawInnerStart)));
  const innerEndS = Math.min(lengthMm, Math.max(lengthMm * 0.55, Math.round(rawInnerEnd)));

  return {
    lengthMm,
    innerStartS,
    innerEndS: Math.max(innerStartS, innerEndS),
    leftStartS,
    leftEndS,
    rightStartS,
    rightEndS,
  };
}

export function getWallMountedComponents(
  wall: Wall,
  openings: Opening[],
  archElements: ArchElement[]
): WallMountedComponent[] {
  const wallLen = getWallArcLength(wall);
  if (wallLen < 1) return [];

  const list: WallMountedComponent[] = [];

  for (const op of openings) {
    if (op.wallId !== wall.id || !op.visible) continue;
    const centerS = op.t * wallLen;
    list.push({
      id: op.id,
      kind: 'opening',
      name: op.name,
      centerS,
      widthMm: op.widthMm,
      leftS: centerS - op.widthMm / 2,
      rightS: centerS + op.widthMm / 2,
      t: op.t,
      locked: op.locked,
      resizeAnchor: op.resizeAnchor ?? 'center',
    });
  }

  for (const el of archElements) {
    if (el.type !== 'chimney' || el.attachedWallId !== wall.id || !el.visible) continue;
    const t =
      typeof el.attachedT === 'number'
        ? el.attachedT
        : projectPointOnSegment({ x: el.xMm, y: el.yMm }, wall.start, wall.end).t;
    const centerS = t * wallLen;
    list.push({
      id: el.id,
      kind: 'chimney',
      name: el.name,
      centerS,
      widthMm: el.widthMm,
      leftS: centerS - el.widthMm / 2,
      rightS: centerS + el.widthMm / 2,
      t,
      locked: el.locked,
      resizeAnchor: el.resizeAnchor ?? 'center',
    });
  }

  list.sort((a, b) => a.centerS - b.centerS);
  return list;
}

export function buildWallDimensionChain(
  wall: Wall,
  allWalls: Wall[],
  openings: Opening[],
  archElements: ArchElement[]
): {
  bounds: WallInnerBounds;
  components: WallMountedComponent[];
  segments: WallDimensionSegment[];
} {
  const bounds = computeWallInnerBounds(wall, allWalls);
  const components = getWallMountedComponents(wall, openings, archElements);
  const lockedGaps = new Set(wall.lockedSegments ?? []);
  const segments: WallDimensionSegment[] = [];

  let cursor = bounds.innerStartS;
  let prevId = 'start';

  for (const comp of components) {
    const gapStart = cursor;
    const gapEnd = Math.max(gapStart, comp.leftS);
    if (gapEnd - gapStart >= 1) {
      const key = `gap:${prevId}:${comp.id}`;
      segments.push({
        key,
        kind: 'wall_gap',
        startS: gapStart,
        endS: gapEnd,
        lengthMm: gapEnd - gapStart,
        locked: wall.locked || lockedGaps.has(key),
        label: 'Wall',
      });
    }
    segments.push({
      key: `comp:${comp.id}`,
      kind: 'component',
      startS: comp.leftS,
      endS: comp.rightS,
      lengthMm: comp.widthMm,
      componentId: comp.id,
      componentKind: comp.kind,
      locked: wall.locked || comp.locked,
      label: comp.name,
    });
    cursor = Math.max(cursor, comp.rightS);
    prevId = comp.id;
  }

  if (bounds.innerEndS - cursor >= 1 || components.length === 0) {
    const gapStart = cursor;
    const gapEnd = Math.max(gapStart, bounds.innerEndS);
    const key = `gap:${prevId}:end`;
    segments.push({
      key,
      kind: 'wall_gap',
      startS: gapStart,
      endS: gapEnd,
      lengthMm: gapEnd - gapStart,
      locked: wall.locked || lockedGaps.has(key),
      label: 'Wall',
    });
  }

  return { bounds, components, segments };
}

export function getNonCrossingClearances(
  targetId: string,
  components: WallMountedComponent[],
  bounds: WallInnerBounds,
  wallLocked: boolean
): {
  target: WallMountedComponent | null;
  left: NonCrossingClearance | null;
  right: NonCrossingClearance | null;
} {
  const idx = components.findIndex((c) => c.id === targetId);
  if (idx === -1) return { target: null, left: null, right: null };
  const target = components[idx];

  const prev = idx > 0 ? components[idx - 1] : null;
  const leftStart = prev ? prev.rightS : bounds.innerStartS;
  const leftEnd = Math.max(leftStart, target.leftS);

  const next = idx < components.length - 1 ? components[idx + 1] : null;
  const rightEnd = next ? next.leftS : bounds.innerEndS;
  const rightStart = Math.min(rightEnd, target.rightS);

  return {
    target,
    left: {
      side: 'left',
      startS: leftStart,
      endS: leftEnd,
      lengthMm: Math.max(0, leftEnd - leftStart),
      stopsAt: prev ? 'component' : 'corner',
      neighborId: prev?.id,
      neighborName: prev?.name,
      locked: wallLocked || target.locked,
    },
    right: {
      side: 'right',
      startS: rightStart,
      endS: rightEnd,
      lengthMm: Math.max(0, rightEnd - rightStart),
      stopsAt: next ? 'component' : 'corner',
      neighborId: next?.id,
      neighborName: next?.name,
      locked: wallLocked || target.locked,
    },
  };
}

export interface SolveWallComponentsResult {
  ok: boolean;
  error?: string;
  updates: Array<{ id: string; kind: 'opening' | 'chimney'; t: number; widthMm: number }>;
}

function getEffectiveWallBounds(
  components: WallMountedComponent[],
  bounds: WallInnerBounds
): { minBound: number; maxBound: number } {
  let minBound = bounds.innerStartS;
  let maxBound = bounds.innerEndS;
  for (const c of components) {
    if (c.leftS < minBound) minBound = Math.max(0, c.leftS);
    if (c.rightS > maxBound) maxBound = Math.min(bounds.lengthMm, c.rightS);
  }
  return { minBound, maxBound };
}

function computeBarriersForIndex(
  components: WallMountedComponent[],
  targetIdx: number,
  minBound: number,
  maxBound: number
): { minLeftS: number; maxRightS: number; leftBlockedByLock: boolean; rightBlockedByLock: boolean } {
  let leftBlockedByLock = false;
  let leftStartLimit = minBound;
  let leftPushWidthSum = 0;
  for (let k = targetIdx - 1; k >= 0; k--) {
    if (components[k].locked) {
      leftBlockedByLock = true;
      leftStartLimit = components[k].rightS;
      break;
    }
    leftPushWidthSum += components[k].widthMm;
  }
  const minLeftS = leftStartLimit + leftPushWidthSum;

  let rightBlockedByLock = false;
  let rightEndLimit = maxBound;
  let rightPushWidthSum = 0;
  for (let k = targetIdx + 1; k < components.length; k++) {
    if (components[k].locked) {
      rightBlockedByLock = true;
      rightEndLimit = components[k].leftS;
      break;
    }
    rightPushWidthSum += components[k].widthMm;
  }
  const maxRightS = rightEndLimit - rightPushWidthSum;

  return { minLeftS, maxRightS, leftBlockedByLock, rightBlockedByLock };
}

/**
 * Constraint-based component resize along a wall:
 * - Honors resizeAnchor ('center' default, 'left' edge pinned, 'right' edge pinned)
 * - Consumes adjacent wall gaps first, then pushes unlocked neighboring components
 * - Fails with a clear error message if locked barriers or free wall length are exceeded
 */
export function solveWallComponentResize(
  wall: Wall,
  components: WallMountedComponent[],
  bounds: WallInnerBounds,
  targetId: string,
  nextWidthMm: number,
  anchorOverride?: ResizeAnchor
): SolveWallComponentsResult {
  if (wall.locked) {
    return { ok: false, error: 'Host wall is locked and cannot be modified.', updates: [] };
  }
  const idx = components.findIndex((c) => c.id === targetId);
  if (idx === -1) {
    return { ok: false, error: 'Component not found on wall.', updates: [] };
  }
  const target = components[idx];
  if (target.locked) {
    return { ok: false, error: `"${target.name}" is locked.`, updates: [] };
  }

  const minWidth = target.kind === 'chimney' ? 50 : 150;
  if (!Number.isFinite(nextWidthMm) || nextWidthMm < minWidth) {
    return {
      ok: false,
      error: `Width must be at least ${Math.round(minWidth / 10)} cm.`,
      updates: [],
    };
  }

  const { minBound, maxBound } = getEffectiveWallBounds(components, bounds);
  const { minLeftS, maxRightS, leftBlockedByLock, rightBlockedByLock } = computeBarriersForIndex(
    components,
    idx,
    minBound,
    maxBound
  );
  const maxAvailableW = Math.max(0, maxRightS - minLeftS);

  if (nextWidthMm > maxAvailableW + 0.5) {
    const blockerNote =
      leftBlockedByLock || rightBlockedByLock ? ' (blocked by locked component)' : '';
    return {
      ok: false,
      error: `Width exceeds available free wall length${blockerNote}. Maximum: ${(maxAvailableW / 10).toFixed(1)} cm.`,
      updates: [],
    };
  }

  const anchor = anchorOverride ?? target.resizeAnchor;
  let newLeft = target.leftS;
  let newRight = target.rightS;

  if (anchor === 'left') {
    newLeft = target.leftS;
    newRight = newLeft + nextWidthMm;
    if (newRight > maxRightS + 0.5) {
      const maxRightW = Math.max(0, maxRightS - newLeft);
      return {
        ok: false,
        error: rightBlockedByLock
          ? `Cannot expand right edge: blocked by locked component (max ${(maxRightW / 10).toFixed(1)} cm).`
          : `Cannot expand right edge past corner: max ${(maxRightW / 10).toFixed(1)} cm available on right.`,
        updates: [],
      };
    }
  } else if (anchor === 'right') {
    newRight = target.rightS;
    newLeft = newRight - nextWidthMm;
    if (newLeft < minLeftS - 0.5) {
      const maxLeftW = Math.max(0, newRight - minLeftS);
      return {
        ok: false,
        error: leftBlockedByLock
          ? `Cannot expand left edge: blocked by locked component (max ${(maxLeftW / 10).toFixed(1)} cm).`
          : `Cannot expand left edge past corner: max ${(maxLeftW / 10).toFixed(1)} cm available on left.`,
        updates: [],
      };
    }
  } else {
    // 'center': expand/shrink symmetrically from middle; if one side hits its hard stop while total fits, slide minimally
    const mid = (target.leftS + target.rightS) / 2;
    newLeft = mid - nextWidthMm / 2;
    newRight = mid + nextWidthMm / 2;
    if (newLeft < minLeftS) {
      const shift = minLeftS - newLeft;
      newLeft += shift;
      newRight += shift;
    }
    if (newRight > maxRightS) {
      const shift = newRight - maxRightS;
      newLeft -= shift;
      newRight -= shift;
    }
  }

  // Cascade push neighbors outward only when adjacent wall gap reaches zero
  const solved = components.map((c) => ({ ...c }));
  solved[idx].leftS = newLeft;
  solved[idx].rightS = newRight;
  solved[idx].widthMm = nextWidthMm;
  solved[idx].centerS = (newLeft + newRight) / 2;

  for (let j = idx - 1; j >= 0; j--) {
    if (solved[j].rightS > solved[j + 1].leftS) {
      solved[j].rightS = solved[j + 1].leftS;
      solved[j].leftS = solved[j].rightS - solved[j].widthMm;
      solved[j].centerS = (solved[j].leftS + solved[j].rightS) / 2;
    }
  }

  for (let j = idx + 1; j < solved.length; j++) {
    if (solved[j].leftS < solved[j - 1].rightS) {
      solved[j].leftS = solved[j - 1].rightS;
      solved[j].rightS = solved[j].leftS + solved[j].widthMm;
      solved[j].centerS = (solved[j].leftS + solved[j].rightS) / 2;
    }
  }

  const wallLen = bounds.lengthMm || 1;
  return {
    ok: true,
    updates: solved.map((c) => ({
      id: c.id,
      kind: c.kind,
      widthMm: Math.round(c.widthMm),
      t: Math.max(0.001, Math.min(0.999, c.centerS / wallLen)),
    })),
  };
}

/**
 * Edits the left or right clearance dimension of a selected wall-mounted component,
 * repositioning the component without distorting unrelated walls.
 */
export function solveWallClearanceEdit(
  wall: Wall,
  components: WallMountedComponent[],
  bounds: WallInnerBounds,
  targetId: string,
  side: 'left' | 'right',
  nextClearanceMm: number
): SolveWallComponentsResult {
  if (wall.locked) {
    return { ok: false, error: 'Host wall is locked.', updates: [] };
  }
  if (!Number.isFinite(nextClearanceMm) || nextClearanceMm < 0) {
    return { ok: false, error: 'Distance cannot be negative.', updates: [] };
  }
  const idx = components.findIndex((c) => c.id === targetId);
  if (idx === -1) {
    return { ok: false, error: 'Component not found.', updates: [] };
  }
  const target = components[idx];
  if (target.locked) {
    return { ok: false, error: `"${target.name}" is locked.`, updates: [] };
  }

  const { minBound, maxBound } = getEffectiveWallBounds(components, bounds);
  const { minLeftS, maxRightS, leftBlockedByLock, rightBlockedByLock } = computeBarriersForIndex(
    components,
    idx,
    minBound,
    maxBound
  );

  let newLeft = target.leftS;
  let newRight = target.rightS;

  if (side === 'left') {
    const refStart = idx > 0 ? components[idx - 1].rightS : minBound;
    newLeft = refStart + nextClearanceMm;
    newRight = newLeft + target.widthMm;
    if (newRight > maxRightS + 0.5) {
      const maxClear = Math.max(0, maxRightS - target.widthMm - refStart);
      return {
        ok: false,
        error: rightBlockedByLock
          ? `Cannot shift right: blocked by locked component (max ${(maxClear / 10).toFixed(1)} cm).`
          : `Distance exceeds free wall length (max ${(maxClear / 10).toFixed(1)} cm).`,
        updates: [],
      };
    }
  } else {
    const refEnd = idx < components.length - 1 ? components[idx + 1].leftS : maxBound;
    newRight = refEnd - nextClearanceMm;
    newLeft = newRight - target.widthMm;
    if (newLeft < minLeftS - 0.5) {
      const maxClear = Math.max(0, refEnd - target.widthMm - minLeftS);
      return {
        ok: false,
        error: leftBlockedByLock
          ? `Cannot shift left: blocked by locked component (max ${(maxClear / 10).toFixed(1)} cm).`
          : `Distance exceeds free wall length (max ${(maxClear / 10).toFixed(1)} cm).`,
        updates: [],
      };
    }
  }

  const solved = components.map((c) => ({ ...c }));
  solved[idx].leftS = newLeft;
  solved[idx].rightS = newRight;
  solved[idx].centerS = (newLeft + newRight) / 2;

  for (let j = idx - 1; j >= 0; j--) {
    if (solved[j].rightS > solved[j + 1].leftS) {
      solved[j].rightS = solved[j + 1].leftS;
      solved[j].leftS = solved[j].rightS - solved[j].widthMm;
      solved[j].centerS = (solved[j].leftS + solved[j].rightS) / 2;
    }
  }
  for (let j = idx + 1; j < solved.length; j++) {
    if (solved[j].leftS < solved[j - 1].rightS) {
      solved[j].leftS = solved[j - 1].rightS;
      solved[j].rightS = solved[j].leftS + solved[j].widthMm;
      solved[j].centerS = (solved[j].leftS + solved[j].rightS) / 2;
    }
  }

  const wallLen = bounds.lengthMm || 1;
  return {
    ok: true,
    updates: solved.map((c) => ({
      id: c.id,
      kind: c.kind,
      widthMm: Math.round(c.widthMm),
      t: Math.max(0.001, Math.min(0.999, c.centerS / wallLen)),
    })),
  };
}

/**
 * Constrained drag placement along host wall with snapping to neighboring components & inside corners,
 * preventing any overlap between wall-mounted openings/chimneys.
 */
export function solveWallComponentDrag(
  components: WallMountedComponent[],
  bounds: WallInnerBounds,
  targetId: string,
  proposedCenterS: number,
  snapEnabled: boolean,
  snapThresholdMm = 65
): { centerS: number; t: number; snappedTo?: string } {
  const idx = components.findIndex((c) => c.id === targetId);
  if (idx === -1 || bounds.lengthMm < 1) {
    return {
      centerS: proposedCenterS,
      t: Math.max(0.02, Math.min(0.98, proposedCenterS / (bounds.lengthMm || 1))),
    };
  }
  const target = components[idx];
  const halfW = target.widthMm / 2;
  const others = components.filter((c) => c.id !== targetId);
  const { minBound, maxBound } = getEffectiveWallBounds(components, bounds);

  // Collect valid non-overlapping center intervals [slotMin, slotMax]
  const intervals: Array<{ min: number; max: number }> = [];
  let cursor = minBound;
  for (const sib of others) {
    if (sib.leftS - cursor >= target.widthMm - 1) {
      intervals.push({ min: cursor + halfW, max: sib.leftS - halfW });
    }
    cursor = Math.max(cursor, sib.rightS);
  }
  if (maxBound - cursor >= target.widthMm - 1) {
    intervals.push({ min: cursor + halfW, max: maxBound - halfW });
  }

  let bestCenter = proposedCenterS;
  if (intervals.length > 0) {
    let bestDist = Infinity;
    for (const iv of intervals) {
      const clamped = Math.max(iv.min, Math.min(iv.max, proposedCenterS));
      const d = Math.abs(clamped - proposedCenterS);
      if (d < bestDist) {
        bestDist = d;
        bestCenter = clamped;
      }
    }
  } else {
    bestCenter = Math.max(halfW, Math.min(bounds.lengthMm - halfW, proposedCenterS));
  }

  let snappedTo: string | undefined;
  if (snapEnabled && intervals.length > 0) {
    // Check flush edge snaps and wall midpoint snap within active interval
    const activeIv = intervals.find((iv) => bestCenter >= iv.min - 1 && bestCenter <= iv.max + 1);
    if (activeIv) {
      const candidates: Array<{ c: number; label: string }> = [
        { c: activeIv.min, label: 'left_edge' },
        { c: activeIv.max, label: 'right_edge' },
        { c: bounds.lengthMm / 2, label: 'wall_center' },
      ];
      let minSnapErr = snapThresholdMm;
      for (const cand of candidates) {
        if (cand.c < activeIv.min - 0.5 || cand.c > activeIv.max + 0.5) continue;
        const err = Math.abs(bestCenter - cand.c);
        if (err < minSnapErr) {
          minSnapErr = err;
          bestCenter = cand.c;
          snappedTo = cand.label;
        }
      }
    }
  }

  return {
    centerS: bestCenter,
    t: Math.max(0.005, Math.min(0.995, bestCenter / bounds.lengthMm)),
    snappedTo,
  };
}

/**
 * Solves wall total length edit honoring the wall's anchorMode without displacing unrelated walls.
 */
export function solveWallLengthChange(
  wall: Wall,
  nextLengthMm: number
): { ok: boolean; start: Point2D; end: Point2D; error?: string } {
  if (wall.locked) {
    return { ok: false, start: wall.start, end: wall.end, error: 'Wall is locked.' };
  }
  if ((wall.anchorMode ?? 'free') === 'fixed_length') {
    return {
      ok: false,
      start: wall.start,
      end: wall.end,
      error: 'Wall length is anchored as Fixed Total Length.',
    };
  }
  if (!Number.isFinite(nextLengthMm) || nextLengthMm < 100) {
    return {
      ok: false,
      start: wall.start,
      end: wall.end,
      error: 'Wall length must be at least 10 cm.',
    };
  }

  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const curLen = Math.hypot(dx, dy);
  if (curLen < 1) {
    return {
      ok: true,
      start: wall.start,
      end: { x: wall.start.x + nextLengthMm, y: wall.start.y },
    };
  }
  const ux = dx / curLen;
  const uy = dy / curLen;
  const mode = wall.anchorMode ?? 'fixed_left';

  if (mode === 'fixed_right') {
    return {
      ok: true,
      start: {
        x: Math.round(wall.end.x - ux * nextLengthMm),
        y: Math.round(wall.end.y - uy * nextLengthMm),
      },
      end: { ...wall.end },
    };
  }
  if (mode === 'free') {
    const midX = (wall.start.x + wall.end.x) / 2;
    const midY = (wall.start.y + wall.end.y) / 2;
    return {
      ok: true,
      start: {
        x: Math.round(midX - (ux * nextLengthMm) / 2),
        y: Math.round(midY - (uy * nextLengthMm) / 2),
      },
      end: {
        x: Math.round(midX + (ux * nextLengthMm) / 2),
        y: Math.round(midY + (uy * nextLengthMm) / 2),
      },
    };
  }
  // 'fixed_left' (default)
  return {
    ok: true,
    start: { ...wall.start },
    end: {
      x: Math.round(wall.start.x + ux * nextLengthMm),
      y: Math.round(wall.start.y + uy * nextLengthMm),
    },
  };
}

/**
 * Corner-preserving wall length edit:
 * Resizes the target wall according to its anchorMode and updates shared endpoints on
 * connected neighbor walls so closed crooked/angled rooms stay connected without gaps.
 * Refuses with a clear message if a displaced corner joins a locked or fixed_length wall
 * or if resizing shrinks any affected wall below its placed components.
 */
export interface ConnectedWallLengthResult {
  ok: boolean;
  error?: string;
  wallUpdates: Array<{ id: string; start: Point2D; end: Point2D }>;
  openingUpdates: Array<{ id: string; t: number }>;
  chimneyUpdates: Array<{
    id: string;
    attachedT: number;
    xMm: number;
    yMm: number;
    rotationDeg: number;
  }>;
}

export function solveConnectedWallLengthChange(
  wall: Wall,
  allWalls: Wall[],
  openings: Opening[],
  archElements: ArchElement[],
  nextLengthMm: number,
  joinTolMm = 8
): ConnectedWallLengthResult {
  const base = solveWallLengthChange(wall, nextLengthMm);
  if (!base.ok) {
    return {
      ok: false,
      error: base.error,
      wallUpdates: [],
      openingUpdates: [],
      chimneyUpdates: [],
    };
  }

  const startMoved = dist(wall.start, base.start) > 0.5;
  const endMoved = dist(wall.end, base.end) > 0.5;
  const excludeSelf = new Set([wall.id]);

  const startNeighbors = startMoved
    ? findConnectedWallEndpoints(allWalls, wall.start, joinTolMm, excludeSelf)
    : [];
  const endNeighbors = endMoved
    ? findConnectedWallEndpoints(allWalls, wall.end, joinTolMm, excludeSelf)
    : [];

  const updatedWallMap = new Map<string, { start: Point2D; end: Point2D; movedStart: boolean; movedEnd: boolean }>();
  updatedWallMap.set(wall.id, {
    start: { ...base.start },
    end: { ...base.end },
    movedStart: startMoved,
    movedEnd: endMoved,
  });

  for (const hit of startNeighbors) {
    const nw = allWalls.find((w) => w.id === hit.wallId);
    if (!nw) continue;
    if (nw.locked) {
      return {
        ok: false,
        error: 'Cannot shift start corner: connected neighbor wall is locked. Unlock it or pin Start Corner.',
        wallUpdates: [],
        openingUpdates: [],
        chimneyUpdates: [],
      };
    }
    if ((nw.anchorMode ?? 'free') === 'fixed_length') {
      return {
        ok: false,
        error: 'Cannot shift start corner: connected neighbor wall has Fixed Total Length.',
        wallUpdates: [],
        openingUpdates: [],
        chimneyUpdates: [],
      };
    }
    const prev = updatedWallMap.get(nw.id) ?? {
      start: { ...nw.start },
      end: { ...nw.end },
      movedStart: false,
      movedEnd: false,
    };
    if (hit.endpoint === 'start') {
      prev.start = { ...base.start };
      prev.movedStart = true;
    } else {
      prev.end = { ...base.start };
      prev.movedEnd = true;
    }
    updatedWallMap.set(nw.id, prev);
  }

  for (const hit of endNeighbors) {
    const nw = allWalls.find((w) => w.id === hit.wallId);
    if (!nw) continue;
    if (nw.locked) {
      return {
        ok: false,
        error: 'Cannot shift end corner: connected neighbor wall is locked. Unlock it or pin End Corner.',
        wallUpdates: [],
        openingUpdates: [],
        chimneyUpdates: [],
      };
    }
    if ((nw.anchorMode ?? 'free') === 'fixed_length') {
      return {
        ok: false,
        error: 'Cannot shift end corner: connected neighbor wall has Fixed Total Length.',
        wallUpdates: [],
        openingUpdates: [],
        chimneyUpdates: [],
      };
    }
    const prev = updatedWallMap.get(nw.id) ?? {
      start: { ...nw.start },
      end: { ...nw.end },
      movedStart: false,
      movedEnd: false,
    };
    if (hit.endpoint === 'start') {
      prev.start = { ...base.end };
      prev.movedStart = true;
    } else {
      prev.end = { ...base.end };
      prev.movedEnd = true;
    }
    updatedWallMap.set(nw.id, prev);
  }

  // Validate new neighbor lengths and keep mounted openings/chimneys bounded without overlaps
  const openingUpdates: ConnectedWallLengthResult['openingUpdates'] = [];
  const chimneyUpdates: ConnectedWallLengthResult['chimneyUpdates'] = [];
  const wallUpdates: ConnectedWallLengthResult['wallUpdates'] = [];

  for (const [wid, upd] of updatedWallMap.entries()) {
    const oldWall = allWalls.find((w) => w.id === wid);
    if (!oldWall) continue;
    const oldLen = getWallArcLength(oldWall);
    const nextWall: Wall = { ...oldWall, start: upd.start, end: upd.end };
    const newLen = getWallArcLength(nextWall);

    if (newLen < 100) {
      return {
        ok: false,
        error: 'Resizing would collapse a connected wall below 10 cm.',
        wallUpdates: [],
        openingUpdates: [],
        chimneyUpdates: [],
      };
    }

    const comps = getWallMountedComponents(oldWall, openings, archElements);
    if (comps.length > 0 && oldLen > 1) {
      const totalCompWidth = comps.reduce((sum, c) => sum + c.widthMm, 0);
      if (totalCompWidth > newLen - 10) {
        return {
          ok: false,
          error:
            wid === wall.id
              ? `Wall length (${(newLen / 10).toFixed(1)} cm) is smaller than its placed components (${(totalCompWidth / 10).toFixed(1)} cm).`
              : `Connected neighbor wall cannot shrink to ${(newLen / 10).toFixed(1)} cm because of its placed components.`,
          wallUpdates: [],
          openingUpdates: [],
          chimneyUpdates: [],
        };
      }

      // Compute desired center S for each component preserving position from stationary end where possible
      const desired = comps.map((c) => {
        let newCenterS: number;
        if (upd.movedStart && !upd.movedEnd) {
          newCenterS = newLen - (oldLen - c.centerS);
        } else if (!upd.movedStart && upd.movedEnd) {
          newCenterS = c.centerS;
        } else {
          newCenterS = c.t * newLen;
        }
        return {
          ...c,
          leftS: newCenterS - c.widthMm / 2,
          rightS: newCenterS + c.widthMm / 2,
          centerS: newCenterS,
        };
      });

      // Clamp inside [4, newLen - 4] and pack sequentially without overlaps
      const margin = Math.min(40, Math.max(4, (newLen - totalCompWidth) / (comps.length + 1)));
      let cursor = margin;
      for (let i = 0; i < desired.length; i++) {
        if (desired[i].leftS < cursor) {
          desired[i].leftS = cursor;
          desired[i].rightS = cursor + desired[i].widthMm;
        }
        cursor = desired[i].rightS + 4;
      }
      let rightLimit = newLen - margin;
      for (let i = desired.length - 1; i >= 0; i--) {
        if (desired[i].rightS > rightLimit) {
          desired[i].rightS = rightLimit;
          desired[i].leftS = rightLimit - desired[i].widthMm;
        }
        desired[i].centerS = (desired[i].leftS + desired[i].rightS) / 2;
        rightLimit = desired[i].leftS - 4;
      }

      for (const c of desired) {
        const nextT = Math.max(0.002, Math.min(0.998, c.centerS / newLen));
        if (Math.abs(nextT - c.t) > 1e-5 || upd.movedStart || upd.movedEnd) {
          if (c.kind === 'opening') {
            openingUpdates.push({ id: c.id, t: nextT });
          } else {
            const el = archElements.find((a) => a.id === c.id);
            if (el) {
              const tf = computeAttachedChimneyTransform(
                nextWall,
                nextT,
                el.depthMm,
                el.attachedFace ?? 'left'
              );
              chimneyUpdates.push({
                id: c.id,
                attachedT: nextT,
                xMm: tf.xMm,
                yMm: tf.yMm,
                rotationDeg: tf.rotationDeg,
              });
            }
          }
        }
      }
    }

    wallUpdates.push({ id: wid, start: upd.start, end: upd.end });
  }

  return {
    ok: true,
    wallUpdates,
    openingUpdates,
    chimneyUpdates,
  };
}

/**
 * Computes world center (xMm, yMm) and rotationDeg for a wall-attached chimney
 * so it sits strictly flush on the chosen wall face without overlapping or floating.
 */
export function computeAttachedChimneyTransform(
  wall: Wall,
  t: number,
  depthMm: number,
  face: 'left' | 'right'
): { xMm: number; yMm: number; rotationDeg: number } {
  const { point, tangent, normal } = getWallCenterlinePoint(wall, t);
  const { left, right } = wallOffsets(wall.thicknessMm, wall.alignment);
  const offsetDist = face === 'left' ? left + depthMm / 2 : right - depthMm / 2;
  const rotationDeg = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
  return {
    xMm: Math.round(point.x + normal.x * offsetDist),
    yMm: Math.round(point.y + normal.y * offsetDist),
    rotationDeg,
  };
}

export function getChimneyWorldCorners(
  xMm: number,
  yMm: number,
  widthMm: number,
  depthMm: number,
  rotationDeg: number
): [Point2D, Point2D, Point2D, Point2D] {
  const hw = widthMm / 2;
  const hd = depthMm / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xf = (lx: number, ly: number): Point2D => ({
    x: xMm + lx * cos - ly * sin,
    y: yMm + lx * sin + ly * cos,
  });
  return [xf(-hw, -hd), xf(hw, -hd), xf(hw, hd), xf(-hw, hd)];
}

function polygonsOverlapDepth(polyA: Point2D[], polyB: Point2D[]): number {
  if (polyA.length < 3 || polyB.length < 3) return 0;
  let minDepth = Infinity;
  const polys = [polyA, polyB];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      const nx = -ey / len;
      const ny = ex / len;

      let minA = Infinity;
      let maxA = -Infinity;
      for (const p of polyA) {
        const pr = p.x * nx + p.y * ny;
        if (pr < minA) minA = pr;
        if (pr > maxA) maxA = pr;
      }

      let minB = Infinity;
      let maxB = -Infinity;
      for (const p of polyB) {
        const pr = p.x * nx + p.y * ny;
        if (pr < minB) minB = pr;
        if (pr > maxB) maxB = pr;
      }

      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= 0) return 0;
      if (overlap < minDepth) minDepth = overlap;
    }
  }
  return Number.isFinite(minDepth) ? minDepth : 0;
}

function pointToPolygonDistance(pt: Point2D, poly: Point2D[]): number {
  if (poly.length < 3) return Infinity;
  // Inside check via winding / raycast
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  if (inside) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = projectPointOnSegment(pt, poly[i], poly[(i + 1) % poly.length]).distance;
    if (d < best) best = d;
  }
  return best;
}

/**
 * Checks whether a chimney footprint penetrates (> toleranceMm) into any visible wall polygon.
 * Flush edge contact (penetration <= toleranceMm) is allowed.
 */
export function doesChimneyOverlapWalls(
  xMm: number,
  yMm: number,
  widthMm: number,
  depthMm: number,
  rotationDeg: number,
  walls: Wall[],
  toleranceMm = 4
): boolean {
  const chimPoly = getChimneyWorldCorners(xMm, yMm, widthMm, depthMm, rotationDeg);
  for (const w of walls) {
    if (w.visible === false) continue;
    if (w.isCurved && Math.abs(w.curveBulgeMm) >= 1) {
      // Sample curved wall into quad segments
      const steps = 12;
      const { left, right } = wallOffsets(w.thicknessMm, w.alignment);
      const pts: Point2D[] = [];
      const nrms: Point2D[] = [];
      for (let i = 0; i <= steps; i++) {
        const res = getWallCenterlinePoint(w, i / steps);
        pts.push(res.point);
        nrms.push(res.normal);
      }
      for (let i = 0; i < steps; i++) {
        const quad: Point2D[] = [
          { x: pts[i].x + nrms[i].x * left, y: pts[i].y + nrms[i].y * left },
          { x: pts[i + 1].x + nrms[i + 1].x * left, y: pts[i + 1].y + nrms[i + 1].y * left },
          { x: pts[i + 1].x + nrms[i + 1].x * right, y: pts[i + 1].y + nrms[i + 1].y * right },
          { x: pts[i].x + nrms[i].x * right, y: pts[i].y + nrms[i].y * right },
        ];
        if (polygonsOverlapDepth(chimPoly, quad) > toleranceMm) return true;
      }
      continue;
    }
    const wallPoly = computeWallPolygon(w, walls);
    if (polygonsOverlapDepth(chimPoly, wallPoly) > toleranceMm) {
      return true;
    }
  }
  return false;
}

/**
 * Computes exact valid [minS, maxS] along a wall's chosen face ('left' or 'right') for a chimney
 * of given depthMm, accounting for corner miters and any adjacent/perpendicular walls on that face.
 */
export function computeChimneyFaceBounds(
  wall: Wall,
  allWalls: Wall[],
  face: 'left' | 'right',
  depthMm: number,
  refS?: number
): { minS: number; maxS: number; lengthMm: number; hasLeftCornerWall: boolean; hasRightCornerWall: boolean } {
  const lengthMm = getWallArcLength(wall);
  if (lengthMm < 1) {
    return { minS: 0, maxS: 0, lengthMm: 0, hasLeftCornerWall: false, hasRightCornerWall: false };
  }
  const inner = computeWallInnerBounds(wall, allWalls);
  let minS = face === 'left' ? Math.min(inner.leftStartS, inner.leftEndS) : Math.min(inner.rightStartS, inner.rightEndS);
  let maxS = face === 'left' ? Math.max(inner.leftStartS, inner.leftEndS) : Math.max(inner.rightStartS, inner.rightEndS);
  const pivotS = typeof refS === 'number' && Number.isFinite(refS) ? refS : (minS + maxS) / 2;

  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const ux = dx / lengthMm;
  const uy = dy / lengthMm;
  const { left, right } = wallOffsets(wall.thicknessMm, wall.alignment);
  const faceSgn = face === 'left' ? 1 : -1;
  const nx = -uy * faceSgn;
  const ny = ux * faceSgn;
  const faceOriginOffset = face === 'left' ? left : -right;

  let hasLeftCornerWall = Math.abs(minS) > 2 || findConnectedWallEndpoints(allWalls, wall.start, 10, new Set([wall.id])).length > 0;
  let hasRightCornerWall = Math.abs(maxS - lengthMm) > 2 || findConnectedWallEndpoints(allWalls, wall.end, 10, new Set([wall.id])).length > 0;

  // Clip against any other visible wall polygon that protrudes into the outward chimney band (0 < outD < depthMm)
  for (const other of allWalls) {
    if (other.id === wall.id || other.visible === false) continue;
    const oPoly = computeWallPolygon(other, allWalls);
    if (oPoly.length < 3) continue;

    // Collect s-extents of other polygon edges/vertices inside the outward strip (4mm .. depthMm - 4mm)
    const stripS: number[] = [];
    const dMin = 4;
    const dMax = Math.max(dMin + 2, depthMm - 4);
    const toLocal = (p: Point2D) => {
      const vx = p.x - wall.start.x;
      const vy = p.y - wall.start.y;
      return {
        s: vx * ux + vy * uy,
        d: vx * nx + vy * ny - faceOriginOffset,
      };
    };
    const lPts = oPoly.map(toLocal);
    for (const lp of lPts) {
      if (lp.d >= dMin && lp.d <= dMax) {
        stripS.push(lp.s);
      }
    }
    // Also intersect polygon edges with d = dMin and d = dMax
    for (let i = 0; i < lPts.length; i++) {
      const a = lPts[i];
      const b = lPts[(i + 1) % lPts.length];
      for (const dPlane of [dMin, dMax]) {
        if ((a.d < dPlane && b.d > dPlane) || (a.d > dPlane && b.d < dPlane)) {
          const t = (dPlane - a.d) / (b.d - a.d);
          stripS.push(a.s + (b.s - a.s) * t);
        }
      }
    }

    if (stripS.length === 0) continue;
    const oMinS = Math.min(...stripS);
    const oMaxS = Math.max(...stripS);
    if (oMaxS <= pivotS + 5 && oMaxS > minS && oMaxS < maxS - 20) {
      minS = Math.max(minS, Math.round(oMaxS));
      hasLeftCornerWall = true;
    } else if (oMinS >= pivotS - 5 && oMinS < maxS && oMinS > minS + 20) {
      maxS = Math.min(maxS, Math.round(oMinS));
      hasRightCornerWall = true;
    } else if (oMinS < pivotS && oMaxS > pivotS) {
      // Pivot is right over a perpendicular T-wall: keep whichever side of the T-wall has more room or is closer
      const distToRightOfT = Math.abs(pivotS - oMaxS);
      const distToLeftOfT = Math.abs(oMinS - pivotS);
      if (distToRightOfT <= distToLeftOfT && oMaxS < maxS - 20) {
        minS = Math.max(minS, Math.round(oMaxS));
        hasLeftCornerWall = true;
      } else if (oMinS > minS + 20) {
        maxS = Math.min(maxS, Math.round(oMinS));
        hasRightCornerWall = true;
      }
    }
  }

  return {
    minS,
    maxS: Math.max(minS, maxS),
    lengthMm,
    hasLeftCornerWall,
    hasRightCornerWall,
  };
}

/**
 * Determines whether an attached chimney is glued into the left or right corner of its host wall.
 */
export function getChimneyCornerPin(
  wall: Wall,
  allWalls: Wall[],
  t: number,
  widthMm: number,
  depthMm: number,
  face: 'left' | 'right',
  tolMm = 12
): 'left' | 'right' | null {
  const lengthMm = getWallArcLength(wall);
  const centerS = t * lengthMm;
  const bounds = computeChimneyFaceBounds(wall, allWalls, face, depthMm, centerS);
  const leftS = centerS - widthMm / 2;
  const rightS = centerS + widthMm / 2;
  if (bounds.hasLeftCornerWall && Math.abs(leftS - bounds.minS) <= tolMm) {
    return 'left';
  }
  if (bounds.hasRightCornerWall && Math.abs(rightS - bounds.maxS) <= tolMm) {
    return 'right';
  }
  return null;
}

/**
 * Snaps a chimney strictly flush onto the nearest valid wall edge without ever overlapping any wall.
 */
export function snapChimneyToWallEdge(
  worldPt: Point2D,
  widthMm: number,
  depthMm: number,
  walls: Wall[],
  openings: Opening[],
  archElements: ArchElement[],
  excludeChimneyId: string | undefined,
  snapEnabled: boolean,
  preferWallId?: string,
  preferFace?: 'left' | 'right'
): {
  wallId: string;
  face: 'left' | 'right';
  t: number;
  xMm: number;
  yMm: number;
  rotationDeg: number;
  cornerPin: 'left' | 'right' | null;
} | null {
  const visibleWalls = walls.filter((w) => w.visible !== false && getWallArcLength(w) >= 40);
  if (visibleWalls.length === 0) return null;

  type Candidate = {
    wall: Wall;
    face: 'left' | 'right';
    t: number;
    xMm: number;
    yMm: number;
    rotationDeg: number;
    cornerPin: 'left' | 'right' | null;
    score: number;
  };

  let best: Candidate | null = null;

  for (const w of visibleWalls) {
    const wallLen = getWallArcLength(w);
    const proj = projectPointOnSegment(worldPt, w.start, w.end);
    const { normal } = getWallCenterlinePoint(w, proj.t);
    const { left, right } = wallOffsets(w.thicknessMm, w.alignment);

    // Distance from worldPt to the centerline along normal
    const signedPerp = (worldPt.x - proj.point.x) * normal.x + (worldPt.y - proj.point.y) * normal.y;

    for (const face of ['left', 'right'] as const) {
      // Distance from cursor to the target chimney center on this face
      const faceCenterOffset = face === 'left' ? left + depthMm / 2 : right - depthMm / 2;
      const faceSurfaceOffset = face === 'left' ? left : right;

      const faceBounds = computeChimneyFaceBounds(w, walls, face, depthMm, proj.t * wallLen);
      if (faceBounds.maxS - faceBounds.minS < widthMm - 2) continue;

      const existingComps = getWallMountedComponents(w, openings, archElements).filter(
        (c) => c.id !== excludeChimneyId
      );
      const chimBounds: WallInnerBounds = {
        lengthMm: wallLen,
        innerStartS: faceBounds.minS,
        innerEndS: faceBounds.maxS,
        leftStartS: faceBounds.minS,
        leftEndS: faceBounds.maxS,
        rightStartS: faceBounds.minS,
        rightEndS: faceBounds.maxS,
      };
      const minCenterS = faceBounds.minS + widthMm / 2;
      const maxCenterS = faceBounds.maxS - widthMm / 2;
      const candCenterS =
        minCenterS <= maxCenterS
          ? Math.max(minCenterS, Math.min(maxCenterS, proj.t * wallLen))
          : (faceBounds.minS + faceBounds.maxS) / 2;
      const candT = Math.max(0.001, Math.min(0.999, candCenterS / wallLen));

      const tempComps: WallMountedComponent[] = [
        ...existingComps,
        {
          id: excludeChimneyId ?? '__preview__',
          kind: 'chimney' as const,
          name: 'Chimney',
          centerS: candCenterS,
          widthMm,
          leftS: candCenterS - widthMm / 2,
          rightS: candCenterS + widthMm / 2,
          t: candT,
          locked: false,
          resizeAnchor: 'center' as const,
        },
      ].sort((a, b) => a.centerS - b.centerS);

      const solved = solveWallComponentDrag(
        tempComps,
        chimBounds,
        excludeChimneyId ?? '__preview__',
        candCenterS,
        snapEnabled,
        65
      );

      // Snap strongly into corners if close to corner boundary and not blocked by another component
      let finalS = solved.centerS;
      let cornerPin: 'left' | 'right' | null = null;
      const isIntervalBlocked = (leftEdge: number, rightEdge: number) =>
        existingComps.some((c) => c.rightS > leftEdge + 1 && c.leftS < rightEdge - 1);

      if (
        faceBounds.hasLeftCornerWall &&
        Math.abs(finalS - minCenterS) <= 45 &&
        !isIntervalBlocked(faceBounds.minS, faceBounds.minS + widthMm)
      ) {
        finalS = minCenterS;
        cornerPin = 'left';
      } else if (
        faceBounds.hasRightCornerWall &&
        Math.abs(finalS - maxCenterS) <= 45 &&
        !isIntervalBlocked(faceBounds.maxS - widthMm, faceBounds.maxS)
      ) {
        finalS = maxCenterS;
        cornerPin = 'right';
      } else {
        if (faceBounds.hasLeftCornerWall && Math.abs(finalS - minCenterS) <= 10) cornerPin = 'left';
        else if (faceBounds.hasRightCornerWall && Math.abs(finalS - maxCenterS) <= 10) cornerPin = 'right';
      }

      const finalT = Math.max(0.001, Math.min(0.999, finalS / wallLen));
      const xf = computeAttachedChimneyTransform(w, finalT, depthMm, face);

      // Reject any candidate that penetrates another wall polygon
      if (doesChimneyOverlapWalls(xf.xMm, xf.yMm, widthMm, depthMm, xf.rotationDeg, walls, 6)) {
        continue;
      }

      // Compute intuitive distance score:
      // 1. Penalize the opposite side if the cursor is clearly on one side of the wall
      const perpDistToIdealCenter = Math.abs(signedPerp - faceCenterOffset);
      const isCursorOnThisSide =
        face === 'left' ? signedPerp >= faceSurfaceOffset - w.thicknessMm * 0.45 : signedPerp <= faceSurfaceOffset + w.thicknessMm * 0.45;
      const alongDelta = Math.abs(proj.t * wallLen - finalS);
      let score = Math.hypot(perpDistToIdealCenter, alongDelta);
      if (!isCursorOnThisSide) {
        score += w.thicknessMm + depthMm;
      }
      // Small hysteresis bonus for keeping current host wall/face while dragging
      if (preferWallId && w.id === preferWallId) {
        score -= preferFace === face ? 45 : 15;
      }

      if (!best || score < best.score) {
        best = {
          wall: w,
          face,
          t: finalT,
          xMm: xf.xMm,
          yMm: xf.yMm,
          rotationDeg: xf.rotationDeg,
          cornerPin,
          score,
        };
      }
    }
  }

  if (!best) return null;
  return {
    wallId: best.wall.id,
    face: best.face,
    t: best.t,
    xMm: best.xMm,
    yMm: best.yMm,
    rotationDeg: best.rotationDeg,
    cornerPin: best.cornerPin,
  };
}

/**
 * Determines which local edges of a chimney touch a visible wall face
 * so 2D rendering can erase wall-chimney seam lines cleanly.
 */
export function getChimneyTouchingEdges(
  el: Pick<ArchElement, 'xMm' | 'yMm' | 'widthMm' | 'depthMm' | 'rotationDeg' | 'attachedWallId' | 'attachedFace'>,
  walls: Wall[],
  tolMm = 8
): { top: boolean; bottom: boolean; left: boolean; right: boolean } {
  const hw = el.widthMm / 2;
  const hd = el.depthMm / 2;
  const rad = (el.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const toWorld = (lx: number, ly: number): Point2D => ({
    x: el.xMm + lx * cos - ly * sin,
    y: el.yMm + lx * sin + ly * cos,
  });

  const wallPolys = walls
    .filter((w) => w.visible !== false)
    .map((w) => ({ id: w.id, poly: computeWallPolygon(w, walls) }))
    .filter((item) => item.poly.length >= 3);

  const edgeTouchesWall = (a: Point2D, b: Point2D): boolean => {
    // Sample interior points (25%, 50%, 75%) so perpendicular corner intersections at endpoints don't falsely trigger
    const samples = [lerpPoint(a, b, 0.25), lerpPoint(a, b, 0.5), lerpPoint(a, b, 0.75)];
    for (const wp of wallPolys) {
      let hits = 0;
      for (const s of samples) {
        if (pointToPolygonDistance(s, wp.poly) <= tolMm) hits++;
      }
      if (hits >= 2) return true;
    }
    return false;
  };

  let top = edgeTouchesWall(toWorld(-hw, -hd), toWorld(hw, -hd));
  let bottom = edgeTouchesWall(toWorld(-hw, hd), toWorld(hw, hd));
  const left = edgeTouchesWall(toWorld(-hw, -hd), toWorld(-hw, hd));
  const right = edgeTouchesWall(toWorld(hw, -hd), toWorld(hw, hd));

  if (el.attachedWallId) {
    if ((el.attachedFace ?? 'left') === 'left') top = true;
    else bottom = true;
  }

  return { top, bottom, left, right };
}

/**
 * Resizes an attached chimney's width and/or depth while keeping it glued in a corner
 * (adding/removing on the side opposite the corner) and preventing any wall overlap.
 */
export function solveChimneyResize(
  wall: Wall,
  allWalls: Wall[],
  openings: Opening[],
  archElements: ArchElement[],
  chimneyId: string,
  nextWidthMm: number,
  nextDepthMm: number,
  anchorOverride?: ResizeAnchor
): {
  ok: boolean;
  error?: string;
  updates: Array<{ id: string; kind: 'opening' | 'chimney'; t: number; widthMm: number }>;
  depthMm: number;
  cornerPin: 'left' | 'right' | null;
} {
  const el = archElements.find((a) => a.id === chimneyId);
  if (!el) {
    return { ok: false, error: 'Chimney not found.', updates: [], depthMm: nextDepthMm, cornerPin: null };
  }
  if (el.locked) {
    return { ok: false, error: `"${el.name}" is locked.`, updates: [], depthMm: el.depthMm, cornerPin: null };
  }
  if (!Number.isFinite(nextWidthMm) || nextWidthMm < 50) {
    return { ok: false, error: 'Width must be at least 5 cm.', updates: [], depthMm: el.depthMm, cornerPin: null };
  }
  if (!Number.isFinite(nextDepthMm) || nextDepthMm < 50) {
    return { ok: false, error: 'Depth must be at least 5 cm.', updates: [], depthMm: el.depthMm, cornerPin: null };
  }

  const face = el.attachedFace ?? 'left';
  const curT = typeof el.attachedT === 'number'
    ? el.attachedT
    : projectPointOnSegment({ x: el.xMm, y: el.yMm }, wall.start, wall.end).t;
  const wallLengthApprox = getWallArcLength(wall) || 1;
  const curBounds = computeChimneyFaceBounds(wall, allWalls, face, el.depthMm, curT * wallLengthApprox);
  const nextBounds = computeChimneyFaceBounds(wall, allWalls, face, nextDepthMm, curT * wallLengthApprox);
  const wallLen = nextBounds.lengthMm || 1;

  const curPin = getChimneyCornerPin(wall, allWalls, curT, el.widthMm, el.depthMm, face);
  const effectiveAnchor: ResizeAnchor = curPin ?? anchorOverride ?? el.resizeAnchor ?? 'center';

  const comps = getWallMountedComponents(wall, openings, archElements);
  // Ensure the chimney's current center respects curBounds if already in corner
  const chimBounds: WallInnerBounds = {
    lengthMm: wallLen,
    innerStartS: nextBounds.minS,
    innerEndS: nextBounds.maxS,
    leftStartS: nextBounds.minS,
    leftEndS: nextBounds.maxS,
    rightStartS: nextBounds.minS,
    rightEndS: nextBounds.maxS,
  };

  // If depth changed while pinned to an angled corner, keep corner edge aligned to nextBounds
  const adjustedComps = comps.map((c) => {
    if (c.id !== chimneyId) return c;
    if (curPin === 'left' && Math.abs(curBounds.minS - nextBounds.minS) > 0.5) {
      const leftS = nextBounds.minS;
      const rightS = leftS + c.widthMm;
      return { ...c, leftS, rightS, centerS: (leftS + rightS) / 2, t: (leftS + rightS) / 2 / wallLen };
    }
    if (curPin === 'right' && Math.abs(curBounds.maxS - nextBounds.maxS) > 0.5) {
      const rightS = nextBounds.maxS;
      const leftS = rightS - c.widthMm;
      return { ...c, leftS, rightS, centerS: (leftS + rightS) / 2, t: (leftS + rightS) / 2 / wallLen };
    }
    return c;
  });

  const res = solveWallComponentResize(
    wall,
    adjustedComps,
    chimBounds,
    chimneyId,
    Math.round(nextWidthMm),
    effectiveAnchor
  );

  if (!res.ok) {
    return {
      ok: false,
      error: res.error,
      updates: [],
      depthMm: el.depthMm,
      cornerPin: curPin,
    };
  }

  // Verify the resized chimney (with nextDepthMm) does not penetrate ANY visible wall
  const selfUpd = res.updates.find((u) => u.id === chimneyId);
  if (selfUpd) {
    const xf = computeAttachedChimneyTransform(wall, selfUpd.t, nextDepthMm, face);
    if (doesChimneyOverlapWalls(xf.xMm, xf.yMm, selfUpd.widthMm, nextDepthMm, xf.rotationDeg, allWalls, 6)) {
      return {
        ok: false,
        error: 'Chimney cannot extend inside an adjacent or opposing wall.',
        updates: [],
        depthMm: el.depthMm,
        cornerPin: curPin,
      };
    }
  }

  const nextPin = selfUpd
    ? getChimneyCornerPin(wall, allWalls, selfUpd.t, selfUpd.widthMm, nextDepthMm, face)
    : curPin;

  return {
    ok: true,
    updates: res.updates,
    depthMm: Math.round(nextDepthMm),
    cornerPin: nextPin ?? curPin,
  };
}

export interface FurnitureWorldBox {
  id: string;
  name: string;
  cx: number;
  cy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  isOverlay: boolean;
  corners: Point2D[];
}

export function rotateThreeYXZ(
  px: number,
  pz: number,
  py: number,
  rxDeg: number,
  ryDeg: number
): { x: number; y: number; z: number } {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  // Standard YXZ intrinsic Euler matching Three.js tiltGroup.rotation.set(rx, ry, 0, 'YXZ')
  // where Three.js coordinates map as X = planX, Y_up = planZ, Z = planY
  const y1 = pz;
  const z1 = -px * sy + py * cy;
  const x1 = px * cy + py * sy;
  const y2 = y1 * cx - z1 * sx;
  const z2 = y1 * sx + z1 * cx;
  return { x: x1, y: z2, z: y2 };
}

export function computeFurnitureTiltedLocalBoundsMm(
  parts: FurniturePart[],
  rotationXDeg = 0,
  rotationYDeg = 0,
  mirroredX = false,
  mirroredY = false
): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  zShift: number;
} {
  const b = computeFurnitureBoundsMm(parts);
  const mx = mirroredX ? -1 : 1;
  const my = mirroredY ? -1 : 1;
  if (Math.abs(rotationXDeg) < 0.05 && Math.abs(rotationYDeg) < 0.05) {
    const xs = [b.minX * mx, b.maxX * mx];
    const ys = [b.minY * my, b.maxY * my];
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      minZ: b.minZ,
      maxZ: b.maxZ,
      zShift: 0,
    };
  }
  const corners = [
    [b.minX * mx, b.minY * my, b.minZ],
    [b.maxX * mx, b.minY * my, b.minZ],
    [b.minX * mx, b.maxY * my, b.minZ],
    [b.maxX * mx, b.maxY * my, b.minZ],
    [b.minX * mx, b.minY * my, b.maxZ],
    [b.maxX * mx, b.minY * my, b.minZ === b.maxZ ? b.maxZ + 10 : b.maxZ],
    [b.minX * mx, b.maxY * my, b.maxZ],
    [b.maxX * mx, b.maxY * my, b.maxZ],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [cx, cy, cz] of corners) {
    const r = rotateThreeYXZ(cx, cz, cy, rotationXDeg, rotationYDeg);
    if (r.x < minX) minX = r.x;
    if (r.x > maxX) maxX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.y > maxY) maxY = r.y;
    if (r.z < minZ) minZ = r.z;
    if (r.z > maxZ) maxZ = r.z;
  }
  // Keep bottom grounded on floor/elevation when tilted relative to original minZ
  const zShift = b.minZ - minZ;
  return { minX, maxX, minY, maxY, minZ: b.minZ, maxZ: maxZ + zShift, zShift };
}

function getFurnitureOrientedOffsets(
  parts: FurniturePart[],
  rotationDeg: number,
  mirroredX = false,
  mirroredY = false,
  rotationXDeg = 0,
  rotationYDeg = 0
): Point2D[] {
  const tb = computeFurnitureTiltedLocalBoundsMm(parts, rotationXDeg, rotationYDeg, mirroredX, mirroredY);
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local = [
    { x: tb.minX, y: tb.minY },
    { x: tb.maxX, y: tb.minY },
    { x: tb.maxX, y: tb.maxY },
    { x: tb.minX, y: tb.maxY },
  ];
  return local.map((pt) => ({
    x: pt.x * cos - pt.y * sin,
    y: pt.x * sin + pt.y * cos,
  }));
}

export function computeFurnitureWorldBox(
  pos: Point2D,
  furn: Pick<
    FurnitureInstance,
    | 'id'
    | 'name'
    | 'templateId'
    | 'category'
    | 'elevationMm'
    | 'parts'
    | 'rotationDeg'
    | 'rotationXDeg'
    | 'rotationYDeg'
    | 'mirroredX'
    | 'mirroredY'
  >
): FurnitureWorldBox {
  const tb = computeFurnitureTiltedLocalBoundsMm(
    furn.parts,
    furn.rotationXDeg ?? 0,
    furn.rotationYDeg ?? 0,
    furn.mirroredX,
    furn.mirroredY
  );
  const offsets = getFurnitureOrientedOffsets(
    furn.parts,
    furn.rotationDeg,
    furn.mirroredX,
    furn.mirroredY,
    furn.rotationXDeg ?? 0,
    furn.rotationYDeg ?? 0
  );
  const corners = offsets.map((o) => ({ x: pos.x + o.x, y: pos.y + o.y }));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = (furn.elevationMm ?? 0) + tb.minZ;
  const maxZ = (furn.elevationMm ?? 0) + tb.maxZ;
  const isRug =
    furn.templateId.startsWith('rug_') ||
    (furn.parts.length > 0 &&
      furn.parts.every((p) => p.detailStyle === 'rug' || p.detailStyle === 'fringe_rug')) ||
    maxZ <= 60;
  const isCeiling = minZ >= 1750;
  return {
    id: furn.id,
    name: furn.name,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    isOverlay: isRug || isCeiling,
    corners,
  };
}

export interface AttachmentTargetPreview {
  kind: 'wall' | 'surface';
  label: string;
  wallId?: string;
  wallFace?: 'left' | 'right';
  wallT?: number;
  wallSegment?: { from: Point2D; to: Point2D };
  surfaceHostId?: string;
  surfacePolygon?: Point2D[];
}

export interface FurnitureSnapResult {
  xMm: number;
  yMm: number;
  rotationDeg: number;
  snappedKind: 'vertex' | 'wall' | 'align' | 'grid' | 'none';
  snapLabel?: string;
  guides: AlignmentGuide[];
  attachedWallId?: string;
  attachedFace?: 'left' | 'right';
  attachedT?: number;
  attachmentPreview?: AttachmentTargetPreview;
}

/**
 * Snaps furniture seamlessly flush against wall faces & room corners,
 * flush edge-to-edge against adjacent furniture pieces, and aligns
 * centers / front / back / side edges with neighboring objects.
 */
export function snapFurnitureToPlan(
  targetPos: Point2D,
  furn: Pick<
    FurnitureInstance,
    'id' | 'name' | 'templateId' | 'category' | 'elevationMm' | 'parts' | 'rotationDeg' | 'mirroredX' | 'mirroredY'
  > &
    Partial<
      Pick<
        FurnitureInstance,
        'rotationXDeg' | 'rotationYDeg' | 'mountingType' | 'mountingFace' | 'attachedWallId' | 'wallOffsetMm' | 'surfaceHostId'
      >
    >,
  walls: Wall[],
  otherFurniture: FurnitureInstance[],
  options: {
    snapEnabled: boolean;
    gridSizeMm: number;
    wallSnapTolMm?: number;
    furnSnapTolMm?: number;
    alignTolMm?: number;
  }
): FurnitureSnapResult {
  const isCurtain = isCurtainOrBlindFurniture(furn);
  const mountingType = resolveFurnitureMountingType(furn);
  const visibleWalls = walls.filter((w) => w.visible !== false && !w.isCurved && getWallArcLength(w) >= 40);

  // Curtains & blinds must stick exclusively onto walls (and freely overlap furniture)
  if (isCurtain && visibleWalls.length > 0) {
    let bestCurtainSnap: {
      x: number;
      y: number;
      rot: number;
      distToTarget: number;
      guide: AlignmentGuide;
      wallId: string;
      wallFace: 'left' | 'right';
      wallT: number;
      segFrom: Point2D;
      segTo: Point2D;
    } | null = null;

    for (const w of visibleWalls) {
      const wallLen = getWallArcLength(w);
      const ux = (w.end.x - w.start.x) / wallLen;
      const uy = (w.end.y - w.start.y) / wallLen;
      const nx = -uy;
      const ny = ux;
      const { left, right } = wallOffsets(w.thicknessMm, w.alignment);
      const wallMid = (left + right) / 2;
      const dNormCur = (targetPos.x - w.start.x) * nx + (targetPos.y - w.start.y) * ny;
      const onLeft = dNormCur >= wallMid;
      const wallAngleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
      const candRot = Math.round(((onLeft ? wallAngleDeg : wallAngleDeg + 180) % 360 + 360) % 360);

      const rotOffsets = getFurnitureOrientedOffsets(
        furn.parts,
        candRot,
        furn.mirroredX,
        furn.mirroredY,
        furn.rotationXDeg ?? 0,
        furn.rotationYDeg ?? 0
      );
      const tVals = rotOffsets.map((o) => o.x * ux + o.y * uy);
      const nVals = rotOffsets.map((o) => o.x * nx + o.y * ny);
      const tMin = Math.min(...tVals);
      const tMax = Math.max(...tVals);
      const nMin = Math.min(...nVals);
      const nMax = Math.max(...nVals);

      const wallOff = furn.wallOffsetMm ?? 0;
      const faceOffset = onLeft ? left : right;
      const idealDNorm = onLeft ? faceOffset + wallOff - nMin : faceOffset - wallOff - nMax;

      const sRaw = (targetPos.x - w.start.x) * ux + (targetPos.y - w.start.y) * uy;
      const spanMin = tMax - tMin <= wallLen ? Math.max(0, -tMin) : 0;
      const spanMax = tMax - tMin <= wallLen ? Math.min(wallLen, wallLen - tMax) : wallLen;
      const clampedS = Math.max(spanMin, Math.min(spanMax, sRaw));

      const sx = w.start.x + ux * clampedS + nx * idealDNorm;
      const sy = w.start.y + uy * clampedS + ny * idealDNorm;
      const dTarget = Math.hypot(sx - targetPos.x, sy - targetPos.y);

      if (!bestCurtainSnap || dTarget < bestCurtainSnap.distToTarget) {
        const s1 = Math.max(0, Math.min(wallLen, clampedS + tMin));
        const s2 = Math.max(0, Math.min(wallLen, clampedS + tMax));
        const segFrom = {
          x: w.start.x + ux * s1 + nx * faceOffset,
          y: w.start.y + uy * s1 + ny * faceOffset,
        };
        const segTo = {
          x: w.start.x + ux * s2 + nx * faceOffset,
          y: w.start.y + uy * s2 + ny * faceOffset,
        };
        bestCurtainSnap = {
          x: sx,
          y: sy,
          rot: candRot,
          distToTarget: dTarget,
          wallId: w.id,
          wallFace: onLeft ? 'left' : 'right',
          wallT: Math.max(0, Math.min(1, clampedS / wallLen)),
          segFrom,
          segTo,
          guide: {
            axis: Math.abs(ux) > Math.abs(uy) ? 'y' : 'x',
            from: segFrom,
            to: segTo,
            label: 'WALL MOUNTED',
          },
        };
      }
    }

    if (bestCurtainSnap) {
      return {
        xMm: Math.round(bestCurtainSnap.x),
        yMm: Math.round(bestCurtainSnap.y),
        rotationDeg: bestCurtainSnap.rot,
        snappedKind: 'wall',
        snapLabel: 'Wall Mounted',
        guides: [bestCurtainSnap.guide],
        attachedWallId: bestCurtainSnap.wallId,
        attachedFace: bestCurtainSnap.wallFace,
        attachedT: bestCurtainSnap.wallT,
        attachmentPreview: {
          kind: 'wall',
          label: 'Wall Mounted',
          wallId: bestCurtainSnap.wallId,
          wallFace: bestCurtainSnap.wallFace,
          wallT: bestCurtainSnap.wallT,
          wallSegment: { from: bestCurtainSnap.segFrom, to: bestCurtainSnap.segTo },
        },
      };
    }
  }

  if (!options.snapEnabled) {
    return {
      xMm: Math.round(targetPos.x),
      yMm: Math.round(targetPos.y),
      rotationDeg: furn.rotationDeg,
      snappedKind: 'none',
      guides: [],
    };
  }

  const baseWallTol = options.wallSnapTolMm ?? 135;
  const wallTol = mountingType === 'wall' ? Math.max(baseWallTol, 175) : baseWallTol;
  const furnTol = options.furnSnapTolMm ?? 95;
  const alignTol = options.alignTolMm ?? 70;
  const guides: AlignmentGuide[] = [];

  let curRot = furn.rotationDeg;
  let curPos: Point2D = { x: targetPos.x, y: targetPos.y };

  // --- 1. Wall-Face & Room-Corner Snapping ---
  interface WallSnapCandidate {
    wall: Wall;
    u: Point2D;
    n: Point2D;
    onLeft: boolean;
    idealDNorm: number;
    faceOffset: number;
    deltaSigned: number;
    absDelta: number;
    tMin: number;
    tMax: number;
    sCenter: number;
    wallLen: number;
    wallAngleDeg: number;
    wallDeltaMod90: number;
  }

  const wallCands: WallSnapCandidate[] = [];
  const wallOff = mountingType === 'wall' ? (furn.wallOffsetMm ?? 0) : 0;
  const offsetsBase = getFurnitureOrientedOffsets(
    furn.parts,
    curRot,
    furn.mirroredX,
    furn.mirroredY,
    furn.rotationXDeg ?? 0,
    furn.rotationYDeg ?? 0
  );

  for (const w of visibleWalls) {
    const wallLen = getWallArcLength(w);
    const ux = (w.end.x - w.start.x) / wallLen;
    const uy = (w.end.y - w.start.y) / wallLen;
    const nx = -uy;
    const ny = ux;
    const { left, right } = wallOffsets(w.thicknessMm, w.alignment);
    const wallMid = (left + right) / 2;

    const sCenter = (curPos.x - w.start.x) * ux + (curPos.y - w.start.y) * uy;
    const dNorm = (curPos.x - w.start.x) * nx + (curPos.y - w.start.y) * ny;

    const tVals = offsetsBase.map((o) => o.x * ux + o.y * uy);
    const nVals = offsetsBase.map((o) => o.x * nx + o.y * ny);
    const tMin = Math.min(...tVals);
    const tMax = Math.max(...tVals);
    const nMin = Math.min(...nVals);
    const nMax = Math.max(...nVals);

    // Must overlap the wall span (with small 45mm corner grace)
    if (sCenter + tMax < -45 || sCenter + tMin > wallLen + 45) continue;

    const onLeft = dNorm >= wallMid;
    const faceOffset = onLeft ? left : right;
    const idealDNorm = onLeft ? faceOffset + wallOff - nMin : faceOffset - wallOff - nMax;
    const deltaSigned = idealDNorm - dNorm;
    const absDelta = Math.abs(deltaSigned);

    // Also detect slight push into wall face (from the outside toward center)
    const pushingIntoWall = onLeft
      ? dNorm < idealDNorm && dNorm >= wallMid - 20
      : dNorm > idealDNorm && dNorm <= wallMid + 20;

    if (absDelta <= wallTol || pushingIntoWall) {
      const wallAngleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
      let diff = ((curRot - wallAngleDeg) % 90 + 90) % 90;
      if (diff > 45) diff -= 90;
      wallCands.push({
        wall: w,
        u: { x: ux, y: uy },
        n: { x: nx, y: ny },
        onLeft,
        idealDNorm,
        faceOffset,
        deltaSigned,
        absDelta,
        tMin,
        tMax,
        sCenter,
        wallLen,
        wallAngleDeg,
        wallDeltaMod90: diff,
      });
    }
  }

  wallCands.sort((a, b) => a.absDelta - b.absDelta);

  let wallLockedX = false;
  let wallLockedY = false;
  let snappedKind: FurnitureSnapResult['snappedKind'] = 'none';
  let snapLabel: string | undefined;
  let attachedWallId: string | undefined;
  let attachedFace: 'left' | 'right' | undefined;
  let attachedT: number | undefined;
  let wallAttachmentPreview: AttachmentTargetPreview | undefined;

  if (wallCands.length > 0) {
    const primary = wallCands[0];
    const isAutoOrientWallMount = mountingType === 'wall';

    // Gently straighten rotation if nearly aligned (within 12 deg), or auto-orient wall-mounted items
    // so their front (+Y) faces the room interior perpendicular to the snapped wall.
    let nextRot: number | null = null;
    if (isAutoOrientWallMount) {
      const { left, right } = wallOffsets(primary.wall.thicknessMm, primary.wall.alignment);
      const wallMid = (left + right) / 2;
      const dNormCur =
        (curPos.x - primary.wall.start.x) * primary.n.x +
        (curPos.y - primary.wall.start.y) * primary.n.y;
      const onLeftSide = dNormCur >= wallMid;
      const targetRot = Math.round(((onLeftSide ? primary.wallAngleDeg : primary.wallAngleDeg + 180) % 360 + 360) % 360);
      const curNorm = ((curRot % 360) + 360) % 360;
      if (Math.abs(targetRot - curNorm) > 0.5) {
        nextRot = targetRot;
      }
    } else if (Math.abs(primary.wallDeltaMod90) > 0.2 && Math.abs(primary.wallDeltaMod90) <= 12) {
      nextRot = Math.round(curRot - primary.wallDeltaMod90);
    }

    if (nextRot !== null) {
      curRot = nextRot;
      const rotOffsets = getFurnitureOrientedOffsets(
        furn.parts,
        curRot,
        furn.mirroredX,
        furn.mirroredY,
        furn.rotationXDeg ?? 0,
        furn.rotationYDeg ?? 0
      );
      const { left, right } = wallOffsets(primary.wall.thicknessMm, primary.wall.alignment);
      const wallMid = (left + right) / 2;
      const dNorm = (curPos.x - primary.wall.start.x) * primary.n.x + (curPos.y - primary.wall.start.y) * primary.n.y;
      const onLeft = dNorm >= wallMid;
      const nVals = rotOffsets.map((o) => o.x * primary.n.x + o.y * primary.n.y);
      const tVals = rotOffsets.map((o) => o.x * primary.u.x + o.y * primary.u.y);
      primary.onLeft = onLeft;
      primary.tMin = Math.min(...tVals);
      primary.tMax = Math.max(...tVals);
      primary.faceOffset = onLeft ? left : right;
      primary.idealDNorm = onLeft
        ? primary.faceOffset + wallOff - Math.min(...nVals)
        : primary.faceOffset - wallOff - Math.max(...nVals);
      primary.deltaSigned = primary.idealDNorm - dNorm;
    }

    // Check for a secondary non-parallel intersecting wall (Room Corner Snap)
    let cornerCand: WallSnapCandidate | null = null;
    for (let i = 1; i < wallCands.length; i++) {
      const c = wallCands[i];
      const cross = Math.abs(primary.n.x * c.n.y - primary.n.y * c.n.x);
      if (cross > 0.35) {
        cornerCand = c;
        break;
      }
    }

    if (cornerCand) {
      // Solve n1.(p - w1.start) = d1  and  n2.(p - w2.start) = d2
      const n1 = primary.n;
      const n2 = cornerCand.n;
      const c1 = n1.x * primary.wall.start.x + n1.y * primary.wall.start.y + primary.idealDNorm;
      const c2 = n2.x * cornerCand.wall.start.x + n2.y * cornerCand.wall.start.y + cornerCand.idealDNorm;
      const det = n1.x * n2.y - n1.y * n2.x;
      if (Math.abs(det) > 0.2) {
        const solvedX = (c1 * n2.y - c2 * n1.y) / det;
        const solvedY = (n1.x * c2 - n2.x * c1) / det;
        if (Math.hypot(solvedX - curPos.x, solvedY - curPos.y) <= wallTol * 2.1) {
          curPos = { x: solvedX, y: solvedY };
          wallLockedX = true;
          wallLockedY = true;
          snappedKind = 'vertex';
          snapLabel = 'Corner Flush';

          for (const wc of [primary, cornerCand]) {
            const s = (curPos.x - wc.wall.start.x) * wc.u.x + (curPos.y - wc.wall.start.y) * wc.u.y;
            const s1 = Math.max(0, Math.min(wc.wallLen, s + wc.tMin));
            const s2 = Math.max(0, Math.min(wc.wallLen, s + wc.tMax));
            guides.push({
              axis: Math.abs(wc.u.x) > Math.abs(wc.u.y) ? 'y' : 'x',
              from: {
                x: wc.wall.start.x + wc.u.x * s1 + wc.n.x * wc.faceOffset,
                y: wc.wall.start.y + wc.u.y * s1 + wc.n.y * wc.faceOffset,
              },
              to: {
                x: wc.wall.start.x + wc.u.x * s2 + wc.n.x * wc.faceOffset,
                y: wc.wall.start.y + wc.u.y * s2 + wc.n.y * wc.faceOffset,
              },
              label: 'CORNER',
            });
          }
        }
      }
    }

    if (!wallLockedX && !wallLockedY) {
      curPos = {
        x: curPos.x + primary.n.x * primary.deltaSigned,
        y: curPos.y + primary.n.y * primary.deltaSigned,
      };
      if (Math.abs(primary.n.x) > 0.85) wallLockedX = true;
      if (Math.abs(primary.n.y) > 0.85) wallLockedY = true;
      if (!wallLockedX && !wallLockedY) {
        // Angled wall locks both components along normal
        wallLockedX = true;
        wallLockedY = true;
      }
      snappedKind = 'wall';
      snapLabel = mountingType === 'wall' ? 'Wall Mounted' : 'Wall Flush';
      const s = (curPos.x - primary.wall.start.x) * primary.u.x + (curPos.y - primary.wall.start.y) * primary.u.y;
      const s1 = Math.max(0, Math.min(primary.wallLen, s + primary.tMin));
      const s2 = Math.max(0, Math.min(primary.wallLen, s + primary.tMax));
      const segFrom = {
        x: primary.wall.start.x + primary.u.x * s1 + primary.n.x * primary.faceOffset,
        y: primary.wall.start.y + primary.u.y * s1 + primary.n.y * primary.faceOffset,
      };
      const segTo = {
        x: primary.wall.start.x + primary.u.x * s2 + primary.n.x * primary.faceOffset,
        y: primary.wall.start.y + primary.u.y * s2 + primary.n.y * primary.faceOffset,
      };
      guides.push({
        axis: Math.abs(primary.u.x) > Math.abs(primary.u.y) ? 'y' : 'x',
        from: segFrom,
        to: segTo,
        label: mountingType === 'wall' ? 'WALL MOUNTED' : 'WALL FLUSH',
      });
      if (mountingType === 'wall') {
        attachedWallId = primary.wall.id;
        attachedFace = primary.onLeft ? 'left' : 'right';
        attachedT = Math.max(0.01, Math.min(0.99, s / Math.max(1, primary.wallLen)));
        wallAttachmentPreview = {
          kind: 'wall',
          label: 'Wall Mounted',
          wallId: attachedWallId,
          wallFace: attachedFace,
          wallT: attachedT,
          wallSegment: { from: segFrom, to: segTo },
        };
      }
    } else if (mountingType === 'wall') {
      const s = (curPos.x - primary.wall.start.x) * primary.u.x + (curPos.y - primary.wall.start.y) * primary.u.y;
      const s1 = Math.max(0, Math.min(primary.wallLen, s + primary.tMin));
      const s2 = Math.max(0, Math.min(primary.wallLen, s + primary.tMax));
      attachedWallId = primary.wall.id;
      attachedFace = primary.onLeft ? 'left' : 'right';
      attachedT = Math.max(0.01, Math.min(0.99, s / Math.max(1, primary.wallLen)));
      wallAttachmentPreview = {
        kind: 'wall',
        label: 'Wall Mounted (Corner)',
        wallId: attachedWallId,
        wallFace: attachedFace,
        wallT: attachedT,
        wallSegment: {
          from: {
            x: primary.wall.start.x + primary.u.x * s1 + primary.n.x * primary.faceOffset,
            y: primary.wall.start.y + primary.u.y * s1 + primary.n.y * primary.faceOffset,
          },
          to: {
            x: primary.wall.start.x + primary.u.x * s2 + primary.n.x * primary.faceOffset,
            y: primary.wall.start.y + primary.u.y * s2 + primary.n.y * primary.faceOffset,
          },
        },
      };
    }
  }

  // --- 2. Adjacent Furniture Flush Contact & Center / Edge Alignment ---
  const selfBox = computeFurnitureWorldBox(curPos, { ...furn, rotationDeg: curRot });
  const visibleOtherFurn = otherFurniture.filter((o) => o.id !== furn.id && o.visible !== false);
  const otherBoxes = visibleOtherFurn.map((o) => ({
    item: o,
    box: computeFurnitureWorldBox({ x: o.xMm, y: o.yMm }, o),
  }));
  const selfIsSeating = isSeatingItem(furn);

  let lockedX = wallLockedX;
  let lockedY = wallLockedY;

  let bestFlushDx: { delta: number; dist: number; guide: AlignmentGuide; name: string } | null = null;
  let bestFlushDy: { delta: number; dist: number; guide: AlignmentGuide; name: string } | null = null;

  for (const { item: otherItem, box: ob } of otherBoxes) {
    if (selfBox.isOverlay || ob.isOverlay || isCurtainOrBlindFurniture(otherItem)) continue;
    // Allow chairs/stools/benches to tuck smoothly underneath tables, desks & islands without catching on the outer tabletop lip
    if (selfIsSeating && isSupportingSurfaceFurniture(otherItem)) continue;
    const zOverlap = selfBox.minZ < ob.maxZ - 20 && selfBox.maxZ > ob.minZ + 20;
    if (!zOverlap) continue;

    // X-axis flush contact when vertically adjacent or overlapping in Y
    const yOverlap = Math.min(selfBox.maxY, ob.maxY) - Math.max(selfBox.minY, ob.minY);
    const yNear =
      yOverlap >= -220; // Touching or close along Y band
    if (!lockedX && yNear) {
      const candidates = [
        { delta: ob.maxX - selfBox.minX, seamX: ob.maxX },
        { delta: ob.minX - selfBox.maxX, seamX: ob.minX },
      ];
      for (const c of candidates) {
        const d = Math.abs(c.delta);
        if (d <= furnTol && (!bestFlushDx || d < bestFlushDx.dist)) {
          const y1 = Math.min(selfBox.minY, ob.minY);
          const y2 = Math.max(selfBox.maxY, ob.maxY);
          bestFlushDx = {
            delta: c.delta,
            dist: d,
            name: ob.name,
            guide: {
              axis: 'x',
              from: { x: c.seamX, y: y1 },
              to: { x: c.seamX, y: y2 },
              coordMm: c.seamX,
              label: 'FLUSH',
            },
          };
        }
      }
    }

    // Y-axis flush contact when horizontally adjacent or overlapping in X
    const xOverlap = Math.min(selfBox.maxX, ob.maxX) - Math.max(selfBox.minX, ob.minX);
    const xNear = xOverlap >= -220;
    if (!lockedY && xNear) {
      const candidates = [
        { delta: ob.maxY - selfBox.minY, seamY: ob.maxY },
        { delta: ob.minY - selfBox.maxY, seamY: ob.minY },
      ];
      for (const c of candidates) {
        const d = Math.abs(c.delta);
        if (d <= furnTol && (!bestFlushDy || d < bestFlushDy.dist)) {
          const x1 = Math.min(selfBox.minX, ob.minX);
          const x2 = Math.max(selfBox.maxX, ob.maxX);
          bestFlushDy = {
            delta: c.delta,
            dist: d,
            name: ob.name,
            guide: {
              axis: 'y',
              from: { x: x1, y: c.seamY },
              to: { x: x2, y: c.seamY },
              coordMm: c.seamY,
              label: 'FLUSH',
            },
          };
        }
      }
    }
  }

  if (bestFlushDx && !lockedX) {
    curPos.x += bestFlushDx.delta;
    lockedX = true;
    guides.push(bestFlushDx.guide);
    if (snappedKind === 'none') snappedKind = 'align';
    snapLabel = snapLabel ? `${snapLabel} · Flush w/ ${bestFlushDx.name}` : `Flush w/ ${bestFlushDx.name}`;
  }
  if (bestFlushDy && !lockedY) {
    curPos.y += bestFlushDy.delta;
    lockedY = true;
    guides.push(bestFlushDy.guide);
    if (snappedKind === 'none') snappedKind = 'align';
    snapLabel = snapLabel ? `${snapLabel} · Flush w/ ${bestFlushDy.name}` : `Flush w/ ${bestFlushDy.name}`;
  }

  // Edge & Center Alignment on any remaining free axes (including rugs & ceiling lights for centering!)
  const updatedSelf = computeFurnitureWorldBox(curPos, { ...furn, rotationDeg: curRot });
  let bestAlignX: { delta: number; dist: number; guide: AlignmentGuide; text: string } | null = null;
  let bestAlignY: { delta: number; dist: number; guide: AlignmentGuide; text: string } | null = null;

  for (const { box: ob } of otherBoxes) {
    if (!lockedX) {
      const xSpecs: Array<{ delta: number; coord: number; text: string }> = [
        { delta: ob.cx - updatedSelf.cx, coord: ob.cx, text: 'CENTER' },
        { delta: ob.minX - updatedSelf.minX, coord: ob.minX, text: 'ALIGN' },
        { delta: ob.maxX - updatedSelf.maxX, coord: ob.maxX, text: 'ALIGN' },
      ];
      for (const s of xSpecs) {
        const d = Math.abs(s.delta);
        const priorityBias = s.text === 'CENTER' ? 0 : 8;
        if (d <= alignTol && (!bestAlignX || d + priorityBias < bestAlignX.dist)) {
          bestAlignX = {
            delta: s.delta,
            dist: d + priorityBias,
            text: s.text,
            guide: {
              axis: 'x',
              from: { x: s.coord, y: updatedSelf.cy },
              to: { x: s.coord, y: ob.cy },
              coordMm: s.coord,
              label: s.text,
            },
          };
        }
      }
    }

    if (!lockedY) {
      const ySpecs: Array<{ delta: number; coord: number; text: string }> = [
        { delta: ob.cy - updatedSelf.cy, coord: ob.cy, text: 'CENTER' },
        { delta: ob.minY - updatedSelf.minY, coord: ob.minY, text: 'ALIGN' },
        { delta: ob.maxY - updatedSelf.maxY, coord: ob.maxY, text: 'ALIGN' },
      ];
      for (const s of ySpecs) {
        const d = Math.abs(s.delta);
        const priorityBias = s.text === 'CENTER' ? 0 : 8;
        if (d <= alignTol && (!bestAlignY || d + priorityBias < bestAlignY.dist)) {
          bestAlignY = {
            delta: s.delta,
            dist: d + priorityBias,
            text: s.text,
            guide: {
              axis: 'y',
              from: { x: updatedSelf.cx, y: s.coord },
              to: { x: ob.cx, y: s.coord },
              coordMm: s.coord,
              label: s.text,
            },
          };
        }
      }
    }
  }

  if (bestAlignX && !lockedX) {
    curPos.x += bestAlignX.delta;
    lockedX = true;
    guides.push(bestAlignX.guide);
    if (snappedKind === 'none') snappedKind = 'align';
    if (!snapLabel) snapLabel = bestAlignX.text === 'CENTER' ? 'Align Center' : 'Align Edge';
  }
  if (bestAlignY && !lockedY) {
    curPos.y += bestAlignY.delta;
    lockedY = true;
    guides.push(bestAlignY.guide);
    if (snappedKind === 'none') snappedKind = 'align';
    if (!snapLabel) snapLabel = bestAlignY.text === 'CENTER' ? 'Align Center' : 'Align Edge';
  }

  // --- 3. Grid Snap Fallback on Remaining Unlocked Axes ---
  const g = Math.max(10, options.gridSizeMm || 50);
  if (!lockedX) {
    curPos.x = Math.round(curPos.x / g) * g;
    if (snappedKind === 'none') snappedKind = 'grid';
  }
  if (!lockedY) {
    curPos.y = Math.round(curPos.y / g) * g;
    if (snappedKind === 'none') snappedKind = 'grid';
  }

  return {
    xMm: Math.round(curPos.x),
    yMm: Math.round(curPos.y),
    rotationDeg: curRot,
    snappedKind,
    snapLabel,
    guides,
    attachedWallId,
    attachedFace,
    attachedT,
    attachmentPreview: wallAttachmentPreview,
  };
}

// ============================================================================
// CEILING LIGHT UNDERSIDE MOUNTING & ELEVATION HELPERS
// ============================================================================

export function isCeilingFixture(
  f: Pick<FurnitureInstance, 'templateId' | 'category' | 'parts'> &
    Partial<Pick<FurnitureInstance, 'mountingType' | 'attachedWallId' | 'surfaceHostId' | 'elevationMm'>>
): boolean {
  return resolveFurnitureMountingType(f) === 'ceiling';
}

export function getEnclosingRoomCeilingMm(
  pos: Point2D,
  rooms: Room[],
  levelCeilingMm: number
): number {
  let bestArea = Infinity;
  let bestCeiling = levelCeilingMm || 2800;
  for (const r of rooms) {
    if (r.visible === false || r.polygon.length < 3) continue;
    if (pointInPolygon(pos, r.polygon)) {
      const area = r.areaM2 > 0 ? r.areaM2 : Math.abs(computePolygonAreaM2(r.polygon));
      if (area < bestArea) {
        bestArea = area;
        bestCeiling = r.ceilingHeightMm || levelCeilingMm || 2800;
      }
    }
  }
  return bestCeiling;
}

export function isAcIndoorUnit(
  f: Pick<FurnitureInstance, 'templateId' | 'parts'>
): boolean {
  const tid = f.templateId || '';
  return tid === 'ac_european_indoor' || f.parts.some((p) => p.detailStyle === 'ac_indoor');
}

export function isCurtainOrBlindFurniture(
  f: Pick<FurnitureInstance, 'templateId' | 'parts'>
): boolean {
  const tid = f.templateId || '';
  return (
    tid.startsWith('curtain_') ||
    tid.startsWith('blinds_') ||
    f.parts.some(
      (p) =>
        p.detailStyle === 'curtain_pleat' ||
        p.detailStyle === 'blinds_slats' ||
        p.detailStyle === 'roller_blind'
    )
  );
}

/**
 * Returns the vertical translation offset (mm) needed so a ceiling-mounted
 * fixture sits 1 mm below the ceiling, or a European split AC indoor unit sits
 * automatically 5 cm (50 mm) below the room's ceiling height.
 */
export function getCeilingFixtureOffsetMm(
  f: Pick<FurnitureInstance, 'templateId' | 'category' | 'parts' | 'elevationMm'> &
    Partial<Pick<FurnitureInstance, 'mountingType' | 'attachedWallId' | 'surfaceHostId'>>,
  effectiveCeilingMm: number
): number {
  const b = computeFurnitureBoundsMm(f.parts);
  const mType = resolveFurnitureMountingType(f);
  if (isAcIndoorUnit(f) && mType === 'wall') {
    const targetTopOffset = effectiveCeilingMm - 50 - b.maxZ;
    return Math.max(1200 - b.minZ, targetTopOffset);
  }
  if (mType !== 'ceiling') {
    return f.elevationMm ?? 0;
  }
  const dropOffset = effectiveCeilingMm - 1 - b.maxZ;
  const minSafeOffset = 150 - b.minZ;
  return Math.max(minSafeOffset, dropOffset);
}

export function computeFurnitureElevationSpanMm(
  f: Pick<FurnitureInstance, 'templateId' | 'category' | 'parts' | 'elevationMm'> &
    Partial<Pick<FurnitureInstance, 'rotationXDeg' | 'rotationYDeg' | 'mirroredX' | 'mirroredY' | 'mountingType' | 'attachedWallId' | 'surfaceHostId'>>,
  effectiveCeilingMm?: number
): { minZ: number; maxZ: number } {
  const tb = computeFurnitureTiltedLocalBoundsMm(
    f.parts,
    f.rotationXDeg ?? 0,
    f.rotationYDeg ?? 0,
    f.mirroredX ?? false,
    f.mirroredY ?? false
  );
  const mType = resolveFurnitureMountingType(f);
  const offsetMm =
    (mType === 'ceiling' || (isAcIndoorUnit(f) && mType === 'wall')) &&
    typeof effectiveCeilingMm === 'number'
      ? getCeilingFixtureOffsetMm(f, effectiveCeilingMm)
      : f.elevationMm ?? 0;
  return {
    minZ: offsetMm + tb.minZ,
    maxZ: offsetMm + tb.maxZ,
  };
}

// ============================================================================
// ROOM & LEVEL CEILING HEIGHT <-> PERIMETER WALL HEIGHT SYNCHRONIZATION
// ============================================================================

export function findRoomPerimeterWallIds(
  room: Pick<Room, 'polygon'>,
  walls: Wall[],
  tolMm = 260
): Set<string> {
  const matched = new Set<string>();
  const poly = room.polygon;
  if (poly.length < 3) return matched;

  for (const w of walls) {
    if (w.visible === false) continue;
    const len = getWallArcLength(w);
    if (len < 10) continue;

    // Sample wall centerline & inner/outer faces at 25%, 50%, 75%
    const { left, right } = wallOffsets(w.thicknessMm, w.alignment);
    const faceOffsets = [left, 0, right];
    let edgeHits = 0;

    for (const t of [0.25, 0.5, 0.75]) {
      const { point, normal } = getWallCenterlinePoint(w, t);
      let sampleNearBoundary = false;
      for (const off of faceOffsets) {
        const probe = { x: point.x + normal.x * off, y: point.y + normal.y * off };
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          if (projectPointOnSegment(probe, a, b).distance <= Math.max(tolMm, w.thicknessMm * 0.75)) {
            sampleNearBoundary = true;
            break;
          }
        }
        if (sampleNearBoundary) break;
      }
      if (sampleNearBoundary) edgeHits++;
    }

    if (edgeHits >= 2) {
      matched.add(w.id);
    }
  }
  return matched;
}

export function syncRoomCeilingHeight(
  lvl: Level,
  roomId: string,
  nextCeilingMm: number
): Level {
  const clamped = Math.max(1800, Math.min(8000, Math.round(nextCeilingMm)));
  const targetRoom = lvl.rooms.find((r) => r.id === roomId);
  if (!targetRoom) return lvl;

  const prevDefault = lvl.ceilingHeightMm;
  const perimeterWallIds = findRoomPerimeterWallIds(targetRoom, lvl.walls);

  // Also keep any arch elements (e.g., chimneys, columns) connected to ceiling inside room synced
  const updatedWalls = lvl.walls.map((w) => {
    if (!perimeterWallIds.has(w.id) || w.locked) return w;
    return { ...w, heightMm: clamped };
  });

  const updatedArch = lvl.archElements.map((a) => {
    if (!a.connectToCeiling || a.locked) return a;
    if (a.attachedWallId && perimeterWallIds.has(a.attachedWallId)) {
      return { ...a, heightMm: clamped };
    }
    if (pointInPolygon({ x: a.xMm, y: a.yMm }, targetRoom.polygon)) {
      return { ...a, heightMm: clamped };
    }
    return a;
  });

  const updatedRooms = lvl.rooms.map((r) =>
    r.id === roomId ? { ...r, ceilingHeightMm: clamped } : r
  );

  // Sync level default if all rooms match or if this room previously matched level default
  const allMatchTarget = updatedRooms.every((r) => r.ceilingHeightMm === clamped);
  const matchedOldDefault = Math.abs(targetRoom.ceilingHeightMm - prevDefault) <= 1;

  return {
    ...lvl,
    ceilingHeightMm: allMatchTarget || matchedOldDefault ? clamped : prevDefault,
    rooms: updatedRooms,
    walls: updatedWalls,
    archElements: updatedArch,
  };
}

export function syncLevelCeilingHeight(lvl: Level, nextCeilingMm: number): Level {
  const clamped = Math.max(1800, Math.min(8000, Math.round(nextCeilingMm)));
  const prevDefault = lvl.ceilingHeightMm;

  const updatedRooms = lvl.rooms.map((r) =>
    r.locked
      ? r
      : Math.abs(r.ceilingHeightMm - prevDefault) <= 1 || !r.ceilingHeightMm
        ? { ...r, ceilingHeightMm: clamped }
        : r
  );

  const updatedWalls = lvl.walls.map((w) =>
    w.locked
      ? w
      : Math.abs(w.heightMm - prevDefault) <= 1
        ? { ...w, heightMm: clamped }
        : w
  );

  const updatedArch = lvl.archElements.map((a) =>
    a.locked || !a.connectToCeiling
      ? a
      : Math.abs(a.heightMm - prevDefault) <= 1
        ? { ...a, heightMm: clamped }
        : a
  );

  return {
    ...lvl,
    ceilingHeightMm: clamped,
    rooms: updatedRooms,
    walls: updatedWalls,
    archElements: updatedArch,
  };
}

// ============================================================================
// DETERMINISTIC CHIMNEY 4-FACE COLORS
// ============================================================================

const CHIMNEY_FACE_PALETTES: Array<{ front: string; back: string; left: string; right: string }> = [
  { front: '#E07A5F', back: '#3D405B', left: '#81B29A', right: '#F2CC8F' },
  { front: '#2A9D8F', back: '#264653', left: '#E9C46A', right: '#E76F51' },
  { front: '#457B9D', back: '#1D3557', left: '#A8DADC', right: '#E63946' },
  { front: '#6D597A', back: '#355070', left: '#B56576', right: '#EAAC8B' },
  { front: '#588157', back: '#344E41', left: '#A3B18A', right: '#DDA15E' },
  { front: '#BC6C25', back: '#283618', left: '#DDA15E', right: '#606C38' },
];

export function getDefaultChimneyFaceColors(seed: string): {
  front: string;
  back: string;
  left: string;
  right: string;
} {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const palette = CHIMNEY_FACE_PALETTES[hash % CHIMNEY_FACE_PALETTES.length];
  return { ...palette };
}

export function resolveChimneyFaceColors(
  el: Pick<ArchElement, 'id' | 'faceColors'>
): { front: string; back: string; left: string; right: string } {
  const defaults = getDefaultChimneyFaceColors(el.id);
  return {
    front: el.faceColors?.front || defaults.front,
    back: el.faceColors?.back || defaults.back,
    left: el.faceColors?.left || defaults.left,
    right: el.faceColors?.right || defaults.right,
  };
}

// ============================================================================
// 2D FURNITURE Z-ORDER (VISUAL STACKING ONLY)
// ============================================================================

export function isRugFurniture(
  f: Pick<FurnitureInstance, 'templateId' | 'parts'>
): boolean {
  if (f.templateId?.startsWith('rug_')) return true;
  if (
    f.parts.length > 0 &&
    f.parts.every((p) => p.detailStyle === 'rug' || p.detailStyle === 'fringe_rug')
  ) {
    return true;
  }
  return false;
}

export function getEffectiveFurnitureZOrder(
  f: Pick<FurnitureInstance, 'templateId' | 'parts' | 'zOrder'>,
  fallbackIndex = 0
): number {
  if (typeof f.zOrder === 'number' && Number.isFinite(f.zOrder)) {
    return f.zOrder;
  }
  return isRugFurniture(f) ? -1000 + fallbackIndex : fallbackIndex;
}

export function sortFurnitureByZOrder<T extends Pick<FurnitureInstance, 'templateId' | 'parts' | 'zOrder'>>(
  items: T[]
): T[] {
  return items
    .map((item, idx) => ({ item, idx, z: getEffectiveFurnitureZOrder(item, idx) }))
    .sort((a, b) => (a.z !== b.z ? a.z - b.z : a.idx - b.idx))
    .map((entry) => entry.item);
}

export type ZOrderAction =
  | 'bring_forward'
  | 'send_backward'
  | 'bring_to_front'
  | 'send_to_back'
  | 'forward'
  | 'backward'
  | 'front'
  | 'back';

export function reorderFurnitureZOrder(
  furniture: FurnitureInstance[],
  targets: Set<string> | string[],
  action: ZOrderAction
): FurnitureInstance[] {
  const targetIds = targets instanceof Set ? targets : new Set(targets);
  if (furniture.length === 0 || targetIds.size === 0) return furniture;

  const sorted = furniture
    .map((item, idx) => ({
      item,
      origIdx: idx,
      z: getEffectiveFurnitureZOrder(item, idx),
    }))
    .sort((a, b) => (a.z !== b.z ? a.z - b.z : a.origIdx - b.origIdx));

  const order = sorted.map((e) => e.item);
  const len = order.length;

  if (action === 'bring_to_front' || action === 'front') {
    const rest = order.filter((f) => !targetIds.has(f.id));
    const moved = order.filter((f) => targetIds.has(f.id));
    const nextOrder = [...rest, ...moved];
    const rankMap = new Map(nextOrder.map((f, i) => [f.id, i]));
    return furniture.map((f) => ({ ...f, zOrder: rankMap.get(f.id) ?? 0 }));
  }

  if (action === 'send_to_back' || action === 'back') {
    const moved = order.filter((f) => targetIds.has(f.id));
    const rest = order.filter((f) => !targetIds.has(f.id));
    const nextOrder = [...moved, ...rest];
    const rankMap = new Map(nextOrder.map((f, i) => [f.id, i]));
    return furniture.map((f) => ({ ...f, zOrder: rankMap.get(f.id) ?? 0 }));
  }

  const nextOrder = [...order];
  if (action === 'bring_forward' || action === 'forward') {
    for (let i = len - 2; i >= 0; i--) {
      if (targetIds.has(nextOrder[i].id) && !targetIds.has(nextOrder[i + 1].id)) {
        const tmp = nextOrder[i];
        nextOrder[i] = nextOrder[i + 1];
        nextOrder[i + 1] = tmp;
      }
    }
  } else {
    // send_backward / backward
    for (let i = 1; i < len; i++) {
      if (targetIds.has(nextOrder[i].id) && !targetIds.has(nextOrder[i - 1].id)) {
        const tmp = nextOrder[i];
        nextOrder[i] = nextOrder[i - 1];
        nextOrder[i - 1] = tmp;
      }
    }
  }

  const rankMap = new Map(nextOrder.map((f, i) => [f.id, i]));
  return furniture.map((f) => ({ ...f, zOrder: rankMap.get(f.id) ?? 0 }));
}

// ============================================================================
// MULTI-SELECT COMMON PROPERTY RESOLUTION
// ============================================================================

export function getCommonValue<V>(values: V[]): { mixed: boolean; value: V };
export function getCommonValue<T, V>(
  items: T[],
  getter: (item: T) => V,
  eq?: (a: V, b: V) => boolean
): { mixed: boolean; value: V };
export function getCommonValue<T, V>(
  items: T[],
  getter?: (item: T) => V,
  eq: (a: V, b: V) => boolean = (a, b) => a === b
): { mixed: boolean; value: V } {
  const resolve = getter ?? ((x: T) => x as unknown as V);
  if (items.length === 0) return { mixed: true, value: undefined as unknown as V };
  const first = resolve(items[0]);
  for (let i = 1; i < items.length; i++) {
    if (!eq(first, resolve(items[i]))) {
      return { mixed: true, value: first };
    }
  }
  return { mixed: false, value: first };
}

// ============================================================================
// LOGICAL OVERLAP, SOLID COLLISION & SMOOTH WALL/OBSTACLE GLIDING
// ============================================================================

export type FurnitureRole =
  | 'rug'
  | 'ceiling'
  | 'tabletop_prop'
  | 'wall_mount'
  | 'supporting_surface'
  | 'solid';

const FIXED_SIZE_TEMPLATE_IDS = new Set([
  'decor_books_stack',
  'decor_books_row',
  'decor_vase_amphora',
  'decor_vase_bud',
  'decor_bowl_fruit',
  'decor_candle_tray',
  'decor_sculpture',
  'decor_books_vase_set',
  'plant_table_succulent',
  'appliance_espresso_machine',
  'appliance_drip_coffee',
  'appliance_kettle',
  'appliance_toaster',
  'appliance_stand_mixer',
  'kitchen_microwave_countertop',
]);

export function isFixedSizeFurniture(
  f: Pick<FurnitureInstance, 'templateId' | 'fixedSize'>
): boolean {
  if (typeof f.fixedSize === 'boolean') return f.fixedSize;
  const tid = f.templateId || '';
  if (tid.startsWith('decor_') && tid !== 'decor_gallery_triptych' && tid !== 'decor_coat_stand') {
    return true;
  }
  return FIXED_SIZE_TEMPLATE_IDS.has(tid);
}

export function isSeatingItem(
  f: Pick<FurnitureInstance, 'templateId' | 'category' | 'parts'>
): boolean {
  const tid = f.templateId || '';
  if (
    tid.startsWith('chair_') ||
    tid.startsWith('stool_') ||
    tid.startsWith('bench_') ||
    tid === 'ottoman_round' ||
    tid === 'armchair_lounge'
  ) {
    return true;
  }
  return (
    f.category === 'Sofas & Seating' &&
    !tid.startsWith('sofa_') &&
    f.parts.some((p) => p.detailStyle === 'chair_seat')
  );
}

export function isWallMountedTv(
  f: Pick<FurnitureInstance, 'templateId' | 'parts' | 'elevationMm' | 'surfaceHostId'>
): boolean {
  const tid = f.templateId || '';
  if (tid.startsWith('tv_wall_') || f.parts.some((p) => p.detailStyle === 'wall_tv')) {
    return true;
  }
  return tid === 'tv_screen_stand' && !f.surfaceHostId && (f.elevationMm ?? 0) >= 850;
}

export function isTabletopProp(
  f: Pick<FurnitureInstance, 'templateId' | 'parts'>
): boolean {
  const tid = f.templateId || '';
  return (
    tid.startsWith('light_table_') ||
    tid === 'tv_screen_stand' ||
    tid === 'plant_table_succulent' ||
    tid.startsWith('decor_books') ||
    tid.startsWith('decor_vase') ||
    tid.startsWith('decor_bowl') ||
    tid === 'decor_candle_tray' ||
    tid === 'decor_sculpture' ||
    tid.startsWith('appliance_') ||
    tid === 'kitchen_microwave_countertop'
  );
}

export function isWallMountItem(
  f: Pick<FurnitureInstance, 'templateId' | 'parts' | 'elevationMm' | 'surfaceHostId'> &
    Partial<Pick<FurnitureInstance, 'category' | 'mountingType' | 'attachedWallId'>>
): boolean {
  return (
    resolveFurnitureMountingType({
      category: f.category ?? 'Decor & Plants',
      ...f,
    }) === 'wall'
  );
}

export function isSurfaceMountable(
  f: Pick<FurnitureInstance, 'templateId' | 'parts'> &
    Partial<Pick<FurnitureInstance, 'category' | 'elevationMm' | 'surfaceHostId' | 'mountingType' | 'attachedWallId'>>
): boolean {
  return (
    resolveFurnitureMountingType({
      category: f.category ?? 'Decor & Plants',
      elevationMm: f.elevationMm ?? 0,
      ...f,
    }) === 'surface' || isTabletopProp(f)
  );
}

const SUPPORTING_SURFACE_IDS = new Set([
  'sideboard_fluted',
  'dresser_3drawer_wide',
  'dresser_4drawer',
  'dresser_6drawer_double',
  'dresser_tallboy',
  'tv_unit_media',
  'tv_unit_floating',
  'nightstand_oak',
  'bedside_fluted',
  'console_entryway',
  'vanity_makeup',
  'credenza_low_locker',
  'shoe_cabinet_slim',
  'kitchen_base_cabinet',
  'kitchen_island',
  'kitchen_dishwasher',
  'kitchen_dishwasher_freestanding',
  'kitchen_corner_base',
  'kitchen_coffee_bar',
  'kitchen_wine_cooler',
  'kitchen_washing_machine',
  'kitchen_dryer',
  'bath_washer',
  'bath_vanity',
  'bath_double_vanity',
  'outdoor_table',
  'outdoor_coffee_table',
]);

export function isSupportingSurfaceFurniture(
  f: Pick<FurnitureInstance, 'templateId' | 'category' | 'parts'> &
    Partial<Pick<FurnitureInstance, 'mountingType' | 'glbAssetId' | 'glbDataUrl'>>
): boolean {
  const tid = f.templateId || '';
  if (f.mountingType === 'wall' || f.mountingType === 'ceiling') {
    return false;
  }
  if (
    isRugFurniture(f) ||
    isCeilingFixture(f) ||
    isTabletopProp(f) ||
    tid.startsWith('tv_wall_') ||
    tid.startsWith('light_') ||
    tid.startsWith('plant_') ||
    tid.startsWith('sofa_') ||
    tid.startsWith('chair_') ||
    tid.startsWith('stool_') ||
    tid.startsWith('bench_') ||
    tid === 'armchair_lounge' ||
    tid === 'ottoman_round' ||
    tid.startsWith('bed_') ||
    tid.startsWith('wardrobe_') ||
    tid.startsWith('bookcase_') ||
    tid === 'vitrine_glass' ||
    tid.startsWith('bath_toilet') ||
    tid === 'bath_bidet' ||
    tid === 'bath_bathtub' ||
    tid === 'bath_oval_tub' ||
    tid.startsWith('bath_shower') ||
    tid.startsWith('kitchen_sink') ||
    tid.startsWith('kitchen_hob') ||
    tid.startsWith('kitchen_cooktop') ||
    tid.startsWith('kitchen_range_cooker') ||
    tid.startsWith('kitchen_fridge') ||
    tid.startsWith('kitchen_oven_tower') ||
    tid.startsWith('kitchen_pantry') ||
    tid.startsWith('kitchen_hood') ||
    tid === 'kitchen_washer_dryer_tower' ||
    tid === 'kitchen_wall_cabinet'
  ) {
    return false;
  }
  if (f.category === 'Tables & Desks' || SUPPORTING_SURFACE_IDS.has(tid)) {
    return true;
  }
  if (f.parts.some((p) => p.detailStyle === 'table_top' && p.zMm + p.heightMm <= 1300)) {
    return true;
  }
  // Allow imported GLB or custom floor/freestanding flat-top furniture (tables, desks, consoles)
  if (f.glbAssetId || f.glbDataUrl || tid.startsWith('imp_')) {
    const b = computeFurnitureBoundsMm(f.parts);
    const mType = resolveFurnitureMountingType({
      ...f,
      elevationMm: 0,
    });
    if (
      (mType === 'floor' || mType === 'freestanding') &&
      b.widthMm >= 350 &&
      b.depthMm >= 300 &&
      b.heightMm >= 280 &&
      b.heightMm <= 1250
    ) {
      return true;
    }
  }
  return false;
}

export function classifyFurnitureRole(
  f: Pick<FurnitureInstance, 'templateId' | 'category' | 'parts' | 'elevationMm' | 'surfaceHostId'> &
    Partial<Pick<FurnitureInstance, 'mountingType' | 'attachedWallId'>>
): FurnitureRole {
  if (isRugFurniture(f)) return 'rug';
  const mType = resolveFurnitureMountingType(f);
  if (mType === 'ceiling') return 'ceiling';
  if (mType === 'wall') return 'wall_mount';
  if (mType === 'surface' || isTabletopProp(f)) return 'tabletop_prop';
  if (isSupportingSurfaceFurniture(f)) return 'supporting_surface';
  return 'solid';
}

export function getSupportingDeckHeightMm(
  host: Pick<FurnitureInstance, 'templateId' | 'elevationMm' | 'parts'>
): number {
  const baseElev = host.elevationMm ?? 0;
  if (host.templateId === 'tv_unit_media' || host.templateId === 'tv_unit_floating') {
    const consolePart = host.parts.find((p) => p.id === 'console' || p.detailStyle === 'cabinet');
    if (consolePart) return Math.round(baseElev + consolePart.zMm + consolePart.heightMm);
  }
  if (host.templateId === 'nightstand_oak' || host.templateId === 'bedside_fluted') {
    const carcass = host.parts.find((p) => p.id === 'carcass' || p.detailStyle === 'cabinet');
    if (carcass) return Math.round(baseElev + carcass.zMm + carcass.heightMm);
  }
  const tableTops = host.parts.filter((p) => p.detailStyle === 'table_top');
  if (tableTops.length > 0) {
    const maxTop = Math.max(...tableTops.map((p) => p.zMm + p.heightMm));
    return Math.round(baseElev + maxTop);
  }
  const cabinets = host.parts.filter((p) => p.detailStyle === 'cabinet');
  if (cabinets.length > 0) {
    const maxCab = Math.max(...cabinets.map((p) => p.zMm + p.heightMm));
    return Math.round(baseElev + maxCab);
  }
  const b = computeFurnitureBoundsMm(host.parts);
  return Math.round(baseElev + b.maxZ);
}

export function getFurnitureOrientedCorners(
  pos: Point2D,
  furn: Pick<
    FurnitureInstance,
    'parts' | 'rotationDeg' | 'rotationXDeg' | 'rotationYDeg' | 'mirroredX' | 'mirroredY'
  >
): Point2D[] {
  const offsets = getFurnitureOrientedOffsets(
    furn.parts,
    furn.rotationDeg,
    furn.mirroredX,
    furn.mirroredY,
    furn.rotationXDeg ?? 0,
    furn.rotationYDeg ?? 0
  );
  return offsets.map((o) => ({ x: pos.x + o.x, y: pos.y + o.y }));
}

function buildPartLocalConvexPolygons(part: FurniturePart): Point2D[][] {
  const w = Math.max(10, part.widthMm);
  const d = Math.max(10, part.depthMm);
  const hw = w / 2;
  const hd = d / 2;

  if (part.shape === 'l_profile') {
    const armW = Math.min(w * 0.42, Math.max(w * 0.25, 320));
    const armD = Math.min(d * 0.42, Math.max(d * 0.25, 320));
    return [
      // Top horizontal wing
      [
        { x: -hw, y: -hd },
        { x: hw, y: -hd },
        { x: hw, y: -hd + armD },
        { x: -hw, y: -hd + armD },
      ],
      // Left vertical wing
      [
        { x: -hw, y: -hd + armD },
        { x: -hw + armW, y: -hd + armD },
        { x: -hw + armW, y: hd },
        { x: -hw, y: hd },
      ],
    ];
  }

  if (part.shape === 'u_profile') {
    const armW = Math.min(w * 0.3, Math.max(w * 0.2, 260));
    const backD = Math.min(d * 0.35, Math.max(d * 0.22, 260));
    return [
      // Back bar
      [
        { x: -hw, y: -hd },
        { x: hw, y: -hd },
        { x: hw, y: -hd + backD },
        { x: -hw, y: -hd + backD },
      ],
      // Left arm
      [
        { x: -hw, y: -hd + backD },
        { x: -hw + armW, y: -hd + backD },
        { x: -hw + armW, y: hd },
        { x: -hw, y: hd },
      ],
      // Right arm
      [
        { x: hw - armW, y: -hd + backD },
        { x: hw, y: -hd + backD },
        { x: hw, y: hd },
        { x: hw - armW, y: hd },
      ],
    ];
  }

  if (part.shape === 'arc') {
    // Decompose curved crescent / wraparound shell into convex quads matching furnitureVectors.tsx
    const segs = 8;
    const polys: Point2D[][] = [];
    for (let i = 0; i < segs; i++) {
      const t0 = (i / segs) * Math.PI;
      const t1 = ((i + 1) / segs) * Math.PI;
      polys.push([
        { x: Math.cos(t0) * hw, y: hd - Math.sin(t0) * d },
        { x: Math.cos(t1) * hw, y: hd - Math.sin(t1) * d },
        { x: Math.cos(t1) * hw * 0.65, y: hd - Math.sin(t1) * d * 0.65 },
        { x: Math.cos(t0) * hw * 0.65, y: hd - Math.sin(t0) * d * 0.65 },
      ]);
    }
    return polys;
  }

  if (part.shape === 'wedge') {
    return [[{ x: -hw, y: hd }, { x: hw, y: hd }, { x: hw, y: -hd }]];
  }

  if ((part.shape === 'oval' || part.shape === 'cylinder') && (w >= 140 || d >= 140)) {
    const pts: Point2D[] = [];
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const a = (i * 2 * Math.PI) / segs;
      pts.push({ x: Math.cos(a) * hw, y: Math.sin(a) * hd });
    }
    return [pts];
  }

  return [
    [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: hd },
      { x: -hw, y: hd },
    ],
  ];
}

export interface SolidFootprintPrimitive {
  poly: Point2D[];
  minZ: number;
  maxZ: number;
}

/**
 * Returns Z-bounded convex 2D collision primitives representing every structural part of a
 * furniture piece in world coordinates so concave shapes (L/U-sofas, corner desks) AND
 * elevated overhangs (dining tabletops above floor-level legs/pedestals) resolve physically
 * — letting chairs tuck cleanly underneath tables while still stopping on legs & backrests.
 */
export function getFurnitureSolidFootprintPrimitives(
  pos: Point2D,
  furn: Pick<FurnitureInstance, 'parts' | 'rotationDeg' | 'mirroredX' | 'mirroredY' | 'elevationMm'> &
    Partial<Pick<FurnitureInstance, 'rotationXDeg' | 'rotationYDeg'>>
): SolidFootprintPrimitive[] {
  const baseElev = furn.elevationMm ?? 0;
  if (!furn.parts || furn.parts.length === 0) {
    return [{ poly: getFurnitureOrientedCorners(pos, furn), minZ: baseElev, maxZ: baseElev + 700 }];
  }

  const activeParts = furn.parts.filter((p) => Math.max(p.widthMm, p.depthMm) >= 24 && p.heightMm >= 8);
  const partsToUse = activeParts.length > 0 ? activeParts : furn.parts;

  const fullRectCovers = partsToUse
    .filter((p) => (p.shape === 'box' || p.shape === 'rounded_rect') && Math.abs(p.rotationDeg) < 0.5)
    .map((p) => ({
      id: p.id,
      minX: p.xMm - p.widthMm / 2,
      maxX: p.xMm + p.widthMm / 2,
      minY: p.yMm - p.depthMm / 2,
      maxY: p.yMm + p.depthMm / 2,
      minZ: p.zMm,
      maxZ: p.zMm + p.heightMm,
      area: p.widthMm * p.depthMm,
    }));

  const isSubsumedByLargerRect = (p: FurniturePart): boolean => {
    const radP = (p.rotationDeg * Math.PI) / 180;
    const cosP = Math.abs(Math.cos(radP));
    const sinP = Math.abs(Math.sin(radP));
    const hw = (p.widthMm * cosP + p.depthMm * sinP) / 2;
    const hd = (p.widthMm * sinP + p.depthMm * cosP) / 2;
    const areaP = p.widthMm * p.depthMm;
    const pMinZ = p.zMm;
    const pMaxZ = p.zMm + p.heightMm;
    return fullRectCovers.some((cov) => {
      if (cov.id === p.id || cov.area < areaP) return false;
      const xyInside =
        p.xMm - hw >= cov.minX - 1 &&
        p.xMm + hw <= cov.maxX + 1 &&
        p.yMm - hd >= cov.minY - 1 &&
        p.yMm + hd <= cov.maxY + 1;
      if (!xyInside) return false;
      const zCovered = cov.minZ <= pMinZ + 25 && cov.maxZ >= pMaxZ - 25;
      const lowCabinetLegCovered = cov.minZ <= 280 && pMaxZ <= cov.minZ + 40;
      return zCovered || lowCabinetLegCovered;
    });
  };

  const radF = (furn.rotationDeg * Math.PI) / 180;
  const cosF = Math.cos(radF);
  const sinF = Math.sin(radF);
  const mx = furn.mirroredX ? -1 : 1;
  const my = furn.mirroredY ? -1 : 1;
  const rotXDeg = furn.rotationXDeg ?? 0;
  const rotYDeg = furn.rotationYDeg ?? 0;
  const hasTilt = Math.abs(rotXDeg) >= 0.05 || Math.abs(rotYDeg) >= 0.05;
  const tb = hasTilt
    ? computeFurnitureTiltedLocalBoundsMm(furn.parts, rotXDeg, rotYDeg, furn.mirroredX, furn.mirroredY)
    : null;

  const primitives: SolidFootprintPrimitive[] = [];
  for (const p of partsToUse) {
    if (partsToUse.length > 1 && isSubsumedByLargerRect(p)) continue;

    const radP = (p.rotationDeg * Math.PI) / 180;
    const cosP = Math.cos(radP);
    const sinP = Math.sin(radP);

    for (const localPoly of buildPartLocalConvexPolygons(p)) {
      if (!hasTilt || !tb) {
        const worldPoly = localPoly.map((pt) => {
          const rx = pt.x * cosP - pt.y * sinP + p.xMm;
          const ry = pt.x * sinP + pt.y * cosP + p.yMm;
          const sx = rx * mx;
          const sy = ry * my;
          return {
            x: pos.x + sx * cosF - sy * sinF,
            y: pos.y + sx * sinF + sy * cosF,
          };
        });
        primitives.push({
          poly: worldPoly,
          minZ: baseElev + p.zMm,
          maxZ: baseElev + p.zMm + p.heightMm,
        });
      } else {
        // Project extruded tilted polygon onto local XY plane and wrap in tight convex hull
        const pts3d: Point2D[] = [];
        let pMinZ = Infinity;
        let pMaxZ = -Infinity;
        for (const pt of localPoly) {
          const rx = (pt.x * cosP - pt.y * sinP + p.xMm) * mx;
          const ry = (pt.x * sinP + pt.y * cosP + p.yMm) * my;
          for (const zVal of [p.zMm, p.zMm + p.heightMm]) {
            const tilted = rotateThreeYXZ(rx, zVal, ry, rotXDeg, rotYDeg);
            const wx = pos.x + tilted.x * cosF - tilted.y * sinF;
            const wy = pos.y + tilted.x * sinF + tilted.y * cosF;
            const wz = baseElev + tilted.z + tb.zShift;
            pts3d.push({ x: wx, y: wy });
            if (wz < pMinZ) pMinZ = wz;
            if (wz > pMaxZ) pMaxZ = wz;
          }
        }
        const hull = computeConvexHull2D(pts3d);
        if (hull.length >= 3) {
          primitives.push({
            poly: hull,
            minZ: pMinZ,
            maxZ: pMaxZ,
          });
        }
      }
    }
  }

  return primitives.length > 0
    ? primitives
    : [{ poly: getFurnitureOrientedCorners(pos, furn), minZ: baseElev, maxZ: baseElev + 700 }];
}

function computeConvexHull2D(points: Point2D[]): Point2D[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

export function getFurnitureSolidFootprintPolygons(
  pos: Point2D,
  furn: Pick<FurnitureInstance, 'parts' | 'rotationDeg' | 'mirroredX' | 'mirroredY' | 'elevationMm'> &
    Partial<Pick<FurnitureInstance, 'rotationXDeg' | 'rotationYDeg'>>
): Point2D[][] {
  return getFurnitureSolidFootprintPrimitives(pos, furn).map((pr) => pr.poly);
}

export function computePolygonOverlapMTV(
  polyA: Point2D[],
  polyB: Point2D[]
): { nx: number; ny: number; depth: number } | null {
  if (polyA.length < 3 || polyB.length < 3) return null;

  const projectPoly = (poly: Point2D[], ax: number, ay: number) => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of poly) {
      const d = p.x * ax + p.y * ay;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return { min, max };
  };

  let minDepth = Infinity;
  let bestNx = 0;
  let bestNy = 0;

  for (const poly of [polyA, polyB]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      const ex = p2.x - p1.x;
      const ey = p2.y - p1.y;
      const len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      const ax = -ey / len;
      const ay = ex / len;

      const projA = projectPoly(polyA, ax, ay);
      const projB = projectPoly(polyB, ax, ay);
      const overlap = Math.min(projA.max, projB.max) - Math.max(projA.min, projB.min);
      if (overlap <= 0) return null;

      if (overlap < minDepth) {
        minDepth = overlap;
        bestNx = ax;
        bestNy = ay;
      }
    }
  }

  // Ensure normal points from polyB center toward polyA center (pushing A out of B)
  const cA = {
    x: polyA.reduce((s, p) => s + p.x, 0) / polyA.length,
    y: polyA.reduce((s, p) => s + p.y, 0) / polyA.length,
  };
  const cB = {
    x: polyB.reduce((s, p) => s + p.x, 0) / polyB.length,
    y: polyB.reduce((s, p) => s + p.y, 0) / polyB.length,
  };
  if ((cA.x - cB.x) * bestNx + (cA.y - cB.y) * bestNy < 0) {
    bestNx = -bestNx;
    bestNy = -bestNy;
  }

  return { nx: bestNx, ny: bestNy, depth: minDepth };
}

export function wouldCreateSurfaceCycle(
  childId: string,
  candidateHostId: string,
  allFurniture: Array<Pick<FurnitureInstance, 'id' | 'surfaceHostId'>>
): boolean {
  if (childId === candidateHostId) return true;
  const byId = new Map(allFurniture.map((f) => [f.id, f]));
  const visited = new Set<string>([childId]);
  let cur: string | undefined = candidateHostId;
  while (cur) {
    if (visited.has(cur)) return true;
    visited.add(cur);
    cur = byId.get(cur)?.surfaceHostId;
  }
  return false;
}

export function findSupportingSurfaceForProp(
  pos: Point2D,
  prop: Pick<FurnitureInstance, 'id' | 'templateId' | 'parts'> &
    Partial<Pick<FurnitureInstance, 'category' | 'elevationMm' | 'surfaceHostId' | 'mountingType' | 'attachedWallId'>>,
  allFurniture: FurnitureInstance[]
): { host: FurnitureInstance; deckHeightMm: number } | null {
  if (!isSurfaceMountable(prop)) return null;

  let best: { host: FurnitureInstance; deckHeightMm: number; area: number } | null = null;
  for (const cand of allFurniture) {
    if (cand.id === prop.id || cand.visible === false) continue;
    if (wouldCreateSurfaceCycle(prop.id, cand.id, allFurniture)) continue;
    if (!isSupportingSurfaceFurniture(cand)) continue;
    const polys = getFurnitureSolidFootprintPolygons({ x: cand.xMm, y: cand.yMm }, cand);
    if (polys.some((poly) => pointInPolygon(pos, poly))) {
      const deckHeightMm = getSupportingDeckHeightMm(cand);
      const b = computeFurnitureBoundsMm(cand.parts);
      const area = b.widthMm * b.depthMm;
      if (!best || deckHeightMm > best.deckHeightMm || (deckHeightMm === best.deckHeightMm && area < best.area)) {
        best = { host: cand, deckHeightMm, area };
      }
    }
  }
  return best ? { host: best.host, deckHeightMm: best.deckHeightMm } : null;
}

export function canFurnitureCoexist(
  moving: Pick<FurnitureInstance, 'id' | 'templateId' | 'category' | 'parts' | 'elevationMm' | 'surfaceHostId'> &
    Partial<Pick<FurnitureInstance, 'mountingType' | 'attachedWallId'>>,
  other: FurnitureInstance,
  candidateHostId?: string
): boolean {
  if (other.id === moving.id || other.visible === false) return true;
  if (isRugFurniture(moving) || isRugFurniture(other)) return true;
  if (isCeilingFixture(moving) || isCeilingFixture(other)) return true;
  if (isCurtainOrBlindFurniture(moving) || isCurtainOrBlindFurniture(other)) return true;
  if (other.surfaceHostId === moving.id) return true;

  // Surface-mountable item sitting ON or dragged onto its supporting host is naturally allowed
  if (isSurfaceMountable(moving) && candidateHostId && other.id === candidateHostId) {
    return true;
  }
  // Supporting surface sliding under a prop already hosted on it shouldn't block
  if (moving.surfaceHostId === other.id && isSurfaceMountable(moving)) {
    return true;
  }

  // Respect 3D vertical separation (e.g., wall cabinet above base cabinet, or raised wall-mounted TV above lowboard)
  const spanA = computeFurnitureElevationSpanMm(moving);
  const spanB = computeFurnitureElevationSpanMm(other);
  const zOverlap = spanA.minZ < spanB.maxZ - 25 && spanA.maxZ > spanB.minZ + 25;
  return !zOverlap;
}

function getSolidWallAndArchPrimitives(
  walls: Wall[],
  archElements: ArchElement[],
  furnMinZ: number,
  furnMaxZ: number
): SolidFootprintPrimitive[] {
  const prims: SolidFootprintPrimitive[] = [];

  for (const w of walls) {
    if (w.visible === false) continue;
    if (furnMinZ >= w.heightMm - 10) continue;

    if (w.isCurved && Math.abs(w.curveBulgeMm) >= 1) {
      const steps = 12;
      const { left, right } = wallOffsets(w.thicknessMm, w.alignment);
      const pts: Point2D[] = [];
      const nrms: Point2D[] = [];
      for (let i = 0; i <= steps; i++) {
        const res = getWallCenterlinePoint(w, i / steps);
        pts.push(res.point);
        nrms.push(res.normal);
      }
      for (let i = 0; i < steps; i++) {
        prims.push({
          poly: [
            { x: pts[i].x + nrms[i].x * left, y: pts[i].y + nrms[i].y * left },
            { x: pts[i + 1].x + nrms[i + 1].x * left, y: pts[i + 1].y + nrms[i + 1].y * left },
            { x: pts[i + 1].x + nrms[i + 1].x * right, y: pts[i + 1].y + nrms[i + 1].y * right },
            { x: pts[i].x + nrms[i].x * right, y: pts[i].y + nrms[i].y * right },
          ],
          minZ: 0,
          maxZ: w.heightMm,
        });
      }
    } else {
      const wallPoly = computeWallPolygon(w, walls);
      if (wallPoly.length >= 3) {
        prims.push({ poly: wallPoly, minZ: 0, maxZ: w.heightMm });
      }
    }
  }

  for (const el of archElements) {
    if (el.visible === false) continue;
    if (
      el.type !== 'chimney' &&
      el.type !== 'column_round' &&
      el.type !== 'column_square' &&
      el.type !== 'fireplace'
    ) {
      continue;
    }
    const elMinZ = el.elevationMm ?? 0;
    const elMaxZ = elMinZ + el.heightMm;
    if (furnMinZ >= elMaxZ - 15 || furnMaxZ <= elMinZ + 15) continue;
    prims.push({
      poly: getChimneyWorldCorners(el.xMm, el.yMm, el.widthMm, el.depthMm, el.rotationDeg),
      minZ: elMinZ,
      maxZ: elMaxZ,
    });
  }

  return prims;
}

export interface SolidFurnitureMoveResult {
  xMm: number;
  yMm: number;
  rotationDeg: number;
  elevationMm: number;
  surfaceHostId?: string;
  attachedWallId?: string;
  attachedFace?: 'left' | 'right';
  attachedT?: number;
  zOrder?: number;
  snappedKind: FurnitureSnapResult['snappedKind'];
  snapLabel?: string;
  guides: AlignmentGuide[];
  attachmentPreview?: AttachmentTargetPreview;
}

/**
 * Resolves solid-body furniture placement with:
 * - Flush wall & corner snapping + adjacent furniture edge snapping
 * - Smooth parallel wall gliding & sliding around solid furniture/columns/chimneys
 * - Continuous sweep preventing fast cursor drags from tunneling through walls
 * - Logical vertical/overlap exceptions (rugs, ceiling lights, Z-separated wall mounts,
 *   chairs tucking cleanly beneath elevated tabletops while colliding with table legs/backrests,
 *   and surface-mountable items automatically attaching atop supporting furniture decks).
 */
export function solveSolidFurnitureMove(
  prevPos: Point2D,
  targetPos: Point2D,
  furn: FurnitureInstance,
  level: Pick<Level, 'walls' | 'furniture' | 'archElements'>,
  options: {
    snapEnabled: boolean;
    gridSizeMm: number;
    wallSnapTolMm?: number;
    furnSnapTolMm?: number;
    alignTolMm?: number;
    allowOverlap?: boolean;
  }
): SolidFurnitureMoveResult {
  const otherFurniture = level.furniture.filter((o) => o.id !== furn.id && o.visible !== false);

  const wallMountedTv = isWallMountedTv(furn);
  const mountingType = resolveFurnitureMountingType(furn);

  const evaluateHostAt = (pos: Point2D) => {
    if (options.allowOverlap) {
      return {
        elevationMm: furn.surfaceHostId ? 0 : (furn.elevationMm ?? 0),
        surfaceHostId: undefined,
      };
    }
    if (wallMountedTv || !isSurfaceMountable(furn)) {
      return { elevationMm: furn.elevationMm ?? 0, surfaceHostId: furn.surfaceHostId };
    }
    const hit = findSupportingSurfaceForProp(pos, furn, otherFurniture);
    if (hit) {
      return { elevationMm: hit.deckHeightMm, surfaceHostId: hit.host.id };
    }
    if (furn.surfaceHostId) {
      return { elevationMm: 0, surfaceHostId: undefined };
    }
    return { elevationMm: furn.elevationMm ?? 0, surfaceHostId: undefined };
  };

  const initialHost = evaluateHostAt(targetPos);
  const furnForSnap: FurnitureInstance = {
    ...furn,
    elevationMm: initialHost.elevationMm,
    surfaceHostId: initialHost.surfaceHostId,
  };

  const snap = snapFurnitureToPlan(
    targetPos,
    furnForSnap,
    level.walls,
    otherFurniture,
    {
      snapEnabled: options.allowOverlap ? false : options.snapEnabled,
      gridSizeMm: options.gridSizeMm,
      wallSnapTolMm: options.wallSnapTolMm ?? (mountingType === 'wall' ? 175 : 115),
      furnSnapTolMm: options.furnSnapTolMm ?? 75,
      alignTolMm: options.alignTolMm ?? 55,
    }
  );

  const curRot = snap.rotationDeg;
  const resolvedHost = evaluateHostAt({ x: snap.xMm, y: snap.yMm });
  const furnWithElev: FurnitureInstance = {
    ...furn,
    rotationDeg: curRot,
    elevationMm: resolvedHost.elevationMm,
    surfaceHostId: resolvedHost.surfaceHostId,
  };

  const nextAttachedWallId =
    options.allowOverlap
      ? undefined
      : mountingType === 'wall'
        ? snap.attachedWallId
        : undefined;
  const nextAttachedFace = nextAttachedWallId ? snap.attachedFace : undefined;
  const nextAttachedT = nextAttachedWallId ? snap.attachedT : undefined;

  // Rugs, ceiling fixtures, curtains/blinds, or Shift-override free drags allow overlapping without collision blocking
  if (
    options.allowOverlap ||
    isRugFurniture(furnWithElev) ||
    isCeilingFixture(furnWithElev) ||
    isCurtainOrBlindFurniture(furnWithElev)
  ) {
    return {
      xMm: snap.xMm,
      yMm: snap.yMm,
      rotationDeg: curRot,
      elevationMm: resolvedHost.elevationMm,
      surfaceHostId: resolvedHost.surfaceHostId,
      attachedWallId: nextAttachedWallId,
      attachedFace: nextAttachedFace,
      attachedT: nextAttachedT,
      zOrder: furn.zOrder,
      snappedKind: snap.snappedKind,
      snapLabel: options.allowOverlap ? 'Free Overlap (Shift)' : snap.snapLabel,
      guides: snap.guides,
      attachmentPreview: options.allowOverlap ? undefined : snap.attachmentPreview,
    };
  }

  const span = computeFurnitureElevationSpanMm(furnWithElev);
  const wallAndArchPrims = getSolidWallAndArchPrimitives(
    level.walls,
    level.archElements,
    span.minZ,
    span.maxZ
  );

  const solidOtherPrims: SolidFootprintPrimitive[] = [];
  for (const other of otherFurniture) {
    if (canFurnitureCoexist(furnWithElev, other, resolvedHost.surfaceHostId)) continue;
    solidOtherPrims.push(
      ...getFurnitureSolidFootprintPrimitives({ x: other.xMm, y: other.yMm }, other)
    );
  }

  const allObstacles: SolidFootprintPrimitive[] = [...wallAndArchPrims, ...solidOtherPrims];

  const getSelfPrims = (pos: Point2D, rotDeg: number): SolidFootprintPrimitive[] =>
    getFurnitureSolidFootprintPrimitives(pos, { ...furnWithElev, rotationDeg: rotDeg });

  const resolvePenetrations = (pos: Point2D, rotDeg: number): Point2D => {
    let p = { x: pos.x, y: pos.y };
    for (let iter = 0; iter < 12; iter++) {
      let pushed = false;
      const selfPrims = getSelfPrims(p, rotDeg);
      for (const sPrim of selfPrims) {
        for (const obsPrim of allObstacles) {
          // Only resolve collisions between parts that overlap in vertical Z elevation
          if (sPrim.minZ >= obsPrim.maxZ - 20 || sPrim.maxZ <= obsPrim.minZ + 20) continue;
          const mtv = computePolygonOverlapMTV(sPrim.poly, obsPrim.poly);
          if (mtv && mtv.depth > 0.5) {
            p = {
              x: p.x + mtv.nx * mtv.depth,
              y: p.y + mtv.ny * mtv.depth,
            };
            pushed = true;
            break;
          }
        }
        if (pushed) break;
      }
      if (!pushed) break;
    }
    return p;
  };

  const maxPenetrationDepth = (pos: Point2D, rotDeg: number): number => {
    const selfPrims = getSelfPrims(pos, rotDeg);
    let worst = 0;
    for (const sPrim of selfPrims) {
      for (const obsPrim of allObstacles) {
        if (sPrim.minZ >= obsPrim.maxZ - 20 || sPrim.maxZ <= obsPrim.minZ + 20) continue;
        const mtv = computePolygonOverlapMTV(sPrim.poly, obsPrim.poly);
        if (mtv && mtv.depth > worst) worst = mtv.depth;
      }
    }
    return worst;
  };

  // Sweep incrementally from curPos toward goal so a drag beyond a wall glides
  // smoothly along the near face and never teleports past the wall centerline
  const goal = { x: snap.xMm, y: snap.yMm };
  const travel = dist(prevPos, goal);
  const substeps = Math.max(1, Math.min(250, Math.ceil(travel / 30)));
  const stepX = (goal.x - prevPos.x) / substeps;
  const stepY = (goal.y - prevPos.y) / substeps;
  const dirX = Math.sign(goal.x - prevPos.x);
  const dirY = Math.sign(goal.y - prevPos.y);
  let curPos: Point2D = { x: prevPos.x, y: prevPos.y };

  for (let s = 1; s <= substeps; s++) {
    const dx = dirX !== 0 ? dirX * Math.min(Math.abs(stepX), Math.max(0, (goal.x - curPos.x) * dirX)) : 0;
    const dy = dirY !== 0 ? dirY * Math.min(Math.abs(stepY), Math.max(0, (goal.y - curPos.y) * dirY)) : 0;
    if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) break;

    const probe = { x: curPos.x + dx, y: curPos.y + dy };
    const resolved = resolvePenetrations(probe, curRot);
    if (maxPenetrationDepth(resolved, curRot) <= 6) {
      curPos = resolved;
    } else {
      // Try axis-independent slides if squeezed near a corner or tight passage
      const slideX = Math.abs(dx) > 1e-4 ? resolvePenetrations({ x: curPos.x + dx, y: curPos.y }, curRot) : null;
      const slideY = Math.abs(dy) > 1e-4 ? resolvePenetrations({ x: curPos.x, y: curPos.y + dy }, curRot) : null;
      if (slideX && maxPenetrationDepth(slideX, curRot) <= 6) {
        curPos = slideX;
      } else if (slideY && maxPenetrationDepth(slideY, curRot) <= 6) {
        curPos = slideY;
      } else {
        // Reached an immovable barrier; remain cleanly slid against it
        break;
      }
    }
  }

  // Final host re-evaluation at resolved position
  const finalHost = evaluateHostAt(curPos);
  let nextZOrder = furn.zOrder;
  let finalLabel = snap.snapLabel;
  let attachmentPreview: AttachmentTargetPreview | undefined = snap.attachmentPreview;

  if (finalHost.surfaceHostId) {
    const hostObj = otherFurniture.find((o) => o.id === finalHost.surfaceHostId);
    if (hostObj) {
      const hostIdx = level.furniture.findIndex((o) => o.id === hostObj.id);
      const hostZ = getEffectiveFurnitureZOrder(hostObj, hostIdx >= 0 ? hostIdx : 0);
      const curIdx = level.furniture.findIndex((o) => o.id === furn.id);
      const curZ = getEffectiveFurnitureZOrder(furn, curIdx >= 0 ? curIdx : level.furniture.length);
      if (curZ <= hostZ) {
        nextZOrder = hostZ + 1;
      }
      finalLabel = finalLabel ? `${finalLabel} · On ${hostObj.name}` : `On ${hostObj.name}`;
      attachmentPreview = {
        kind: 'surface',
        label: `On ${hostObj.name}`,
        surfaceHostId: hostObj.id,
        surfacePolygon: getFurnitureOrientedCorners({ x: hostObj.xMm, y: hostObj.yMm }, hostObj),
      };
    }
  }

  return {
    xMm: Math.round(curPos.x),
    yMm: Math.round(curPos.y),
    rotationDeg: curRot,
    elevationMm: finalHost.elevationMm,
    surfaceHostId: finalHost.surfaceHostId,
    attachedWallId: nextAttachedWallId,
    attachedFace: nextAttachedFace,
    attachedT: nextAttachedT,
    zOrder: nextZOrder,
    snappedKind: snap.snappedKind,
    snapLabel: finalLabel,
    guides: snap.guides,
    attachmentPreview,
  };
}

export interface CutThroughProjectedPart {
  part: FurniturePart;
  viewX: number;
  elevW: number;
  elevH: number;
  zBottom: number;
  outCenter: number;
  outBack: number;
  outFront: number;
}

export interface WallViewFurnitureProjection {
  viewId: Exclude<ProjectionViewId, 'top'>;
  flipX: boolean;
  viewXCenter: number;
  elevW: number;
  elevH: number;
  zBottom: number;
}

export type CutThroughFurnitureResult =
  | { status: 'hidden' }
  | { status: 'opposite_side' }
  | {
      status: 'visible';
      item: FurnitureInstance;
      perpDistMm: number;
      visibleParts: CutThroughProjectedPart[];
      projection?: WallViewFurnitureProjection;
    };

interface ElevRect {
  x1: number;
  x2: number;
  z1: number;
  z2: number;
}

function subtractElevRect(rects: ElevRect[], cut: ElevRect): ElevRect[] {
  const out: ElevRect[] = [];
  for (const r of rects) {
    const ix1 = Math.max(r.x1, cut.x1);
    const ix2 = Math.min(r.x2, cut.x2);
    const iz1 = Math.max(r.z1, cut.z1);
    const iz2 = Math.min(r.z2, cut.z2);
    if (ix1 >= ix2 - 0.1 || iz1 >= iz2 - 0.1) {
      out.push(r);
      continue;
    }
    if (r.x1 < ix1 - 0.1) out.push({ x1: r.x1, x2: ix1, z1: r.z1, z2: r.z2 });
    if (r.x2 > ix2 + 0.1) out.push({ x1: ix2, x2: r.x2, z1: r.z1, z2: r.z2 });
    if (r.z1 < iz1 - 0.1) out.push({ x1: ix1, x2: ix2, z1: r.z1, z2: iz1 });
    if (r.z2 > iz2 + 0.1) out.push({ x1: ix1, x2: ix2, z1: iz2, z2: r.z2 });
  }
  return out;
}

/**
 * Projects a furniture item onto a wall's Cut-Through elevation plane within maxDistMm
 * (default 700 mm / 0.7 m) and culls back/interior parts occluded from the viewing angle.
 */
export function projectFurnitureForWallCutThrough(
  wall: Wall,
  faceSide: 'inner' | 'outer' | 'left' | 'right',
  furn: FurnitureInstance,
  roomCeilingHeightMm: number,
  maxDistMm = 700
): CutThroughFurnitureResult {
  if (!furn.visible || furn.parts.length === 0) return { status: 'hidden' };

  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lenMm = Math.max(100, getWallArcLength(wall));
  const straightLen = Math.hypot(dx, dy) || 1;
  const ux = dx / straightLen;
  const uy = dy / straightLen;
  const nx = -uy;
  const ny = ux;

  const isLeftView = faceSide === 'inner' || faceSide === 'left';
  const faceOffsets = wallOffsets(wall.thicknessMm, wall.alignment);
  const viewedFacePerp = isLeftView ? faceOffsets.left : faceOffsets.right;
  const outN = isLeftView ? { x: nx, y: ny } : { x: -nx, y: -ny };

  const mx = furn.mirroredX ? -1 : 1;
  const my = furn.mirroredY ? -1 : 1;
  const radF = (furn.rotationDeg * Math.PI) / 180;
  const cosF = Math.cos(radF);
  const sinF = Math.sin(radF);
  const rotXDeg = furn.rotationXDeg ?? 0;
  const rotYDeg = furn.rotationYDeg ?? 0;
  const hasTilt = Math.abs(rotXDeg) >= 0.05 || Math.abs(rotYDeg) >= 0.05;

  const tb = computeFurnitureTiltedLocalBoundsMm(furn.parts, rotXDeg, rotYDeg, furn.mirroredX, furn.mirroredY);
  const { minZ: furnFloorOffsetMm } = computeFurnitureElevationSpanMm(furn, roomCeilingHeightMm);
  const baseElevationMm = furnFloorOffsetMm - tb.minZ;

  let minS = Infinity;
  let maxS = -Infinity;
  let minOut = Infinity;
  let maxOut = -Infinity;
  let minSignedPerp = Infinity;
  let maxSignedPerp = -Infinity;

  const projectedAll: Array<CutThroughProjectedPart & { canOcclude: boolean }> = [];

  for (const p of furn.parts) {
    let wx = 0;
    let wy = 0;
    let partS = 0;
    let signedPerp = 0;
    let partOut = 0;
    let halfElevW = 0;
    let halfOutD = 0;
    let zBottom = baseElevationMm + p.zMm;
    let elevH = Math.max(15, p.heightMm);

    if (!hasTilt) {
      const lx = p.xMm * mx;
      const ly = p.yMm * my;
      wx = furn.xMm + lx * cosF - ly * sinF;
      wy = furn.yMm + lx * sinF + ly * cosF;

      const rx = wx - wall.start.x;
      const ry = wy - wall.start.y;
      partS = rx * ux + ry * uy;
      signedPerp = rx * nx + ry * ny;
      partOut =
        isLeftView ? signedPerp - viewedFacePerp : viewedFacePerp - signedPerp;

      const radP = (p.rotationDeg * Math.PI) / 180;
      const cosP = Math.cos(radP);
      const sinP = Math.sin(radP);

      const axX = {
        x: mx * cosP * cosF - my * sinP * sinF,
        y: mx * cosP * sinF + my * sinP * cosF,
      };
      const axY = {
        x: -mx * sinP * cosF - my * cosP * sinF,
        y: -mx * sinP * sinF + my * cosP * cosF,
      };

      halfElevW =
        0.5 *
        (p.widthMm * Math.abs(axX.x * ux + axX.y * uy) +
          p.depthMm * Math.abs(axY.x * ux + axY.y * uy));
      halfOutD =
        0.5 *
        (p.widthMm * Math.abs(axX.x * outN.x + axX.y * outN.y) +
          p.depthMm * Math.abs(axY.x * outN.x + axY.y * outN.y));
    } else {
      // Exact 8-corner 3D projection when X/Y tilt is non-zero
      const radP = (p.rotationDeg * Math.PI) / 180;
      const cosP = Math.cos(radP);
      const sinP = Math.sin(radP);
      const hw = p.widthMm / 2;
      const hd = p.depthMm / 2;
      let pMinS = Infinity;
      let pMaxS = -Infinity;
      let pMinOut = Infinity;
      let pMaxOut = -Infinity;
      let pMinSigned = Infinity;
      let pMaxSigned = -Infinity;
      let pMinZ = Infinity;
      let pMaxZ = -Infinity;
      for (const sx of [-hw, hw]) {
        for (const sy of [-hd, hd]) {
          for (const sz of [p.zMm, p.zMm + p.heightMm]) {
            const lx = (p.xMm + sx * cosP - sy * sinP) * mx;
            const ly = (p.yMm + sx * sinP + sy * cosP) * my;
            const tilted = rotateThreeYXZ(lx, sz, ly, rotXDeg, rotYDeg);
            const px = furn.xMm + tilted.x * cosF - tilted.y * sinF;
            const py = furn.yMm + tilted.x * sinF + tilted.y * cosF;
            const pz = baseElevationMm + tilted.z + tb.zShift;
            const rx = px - wall.start.x;
            const ry = py - wall.start.y;
            const cS = rx * ux + ry * uy;
            const cSigned = rx * nx + ry * ny;
            const cOut = isLeftView ? cSigned - viewedFacePerp : viewedFacePerp - cSigned;
            if (cS < pMinS) pMinS = cS;
            if (cS > pMaxS) pMaxS = cS;
            if (cOut < pMinOut) pMinOut = cOut;
            if (cOut > pMaxOut) pMaxOut = cOut;
            if (cSigned < pMinSigned) pMinSigned = cSigned;
            if (cSigned > pMaxSigned) pMaxSigned = cSigned;
            if (pz < pMinZ) pMinZ = pz;
            if (pz > pMaxZ) pMaxZ = pz;
          }
        }
      }
      partS = (pMinS + pMaxS) / 2;
      halfElevW = Math.max(8, (pMaxS - pMinS) / 2);
      partOut = (pMinOut + pMaxOut) / 2;
      halfOutD = Math.max(5, (pMaxOut - pMinOut) / 2);
      signedPerp = (pMinSigned + pMaxSigned) / 2;
      zBottom = pMinZ;
      elevH = Math.max(15, pMaxZ - pMinZ);
    }

    minS = Math.min(minS, partS - halfElevW);
    maxS = Math.max(maxS, partS + halfElevW);
    minOut = Math.min(minOut, partOut - halfOutD);
    maxOut = Math.max(maxOut, partOut + halfOutD);
    minSignedPerp = Math.min(minSignedPerp, signedPerp - halfOutD);
    maxSignedPerp = Math.max(maxSignedPerp, signedPerp + halfOutD);

    const viewX = isLeftView ? partS : lenMm - partS;
    const elevW = Math.max(16, halfElevW * 2);

    const canOcclude =
      p.material !== 'glass' &&
      p.shape !== 'arc' &&
      p.shape !== 'wedge' &&
      p.heightMm >= 5 &&
      p.widthMm >= 10 &&
      p.depthMm >= 10;

    projectedAll.push({
      part: p,
      viewX,
      elevW,
      elevH,
      zBottom,
      outCenter: partOut,
      outBack: partOut - halfOutD,
      outFront: partOut + halfOutD,
      canOcclude,
    });
  }

  // Must overlap horizontally along the wall segment
  if (maxS <= 0 || minS >= lenMm) return { status: 'hidden' };

  // True geometric wall-thickness occlusion: anything behind the viewed wall face surface
  // (never emerging past the viewed surface toward the camera, or centered behind the wall core
  // without extending substantially into the viewed room) is occluded by the opaque wall.
  const centerOut = (minOut + maxOut) * 0.5;
  const wallHalfThick = Math.max(20, wall.thicknessMm * 0.5);
  const behindViewedFace = maxOut <= 4 || (centerOut < -wallHalfThick && maxOut <= 15);
  if (behindViewedFace) {
    return centerOut < -wallHalfThick * 0.4 ? { status: 'opposite_side' } : { status: 'hidden' };
  }

  const perpDistMm = Math.max(0, minOut);
  if (perpDistMm > maxDistMm) {
    return { status: 'hidden' };
  }

  // Filter out individual parts completely behind the viewed face so rear appendages cannot bleed through
  const unoccludedParts = projectedAll.filter((part) => part.outFront > 2);
  if (unoccludedParts.length === 0) {
    return { status: 'opposite_side' };
  }

  // Cull parts whose entire projected elevation face is hidden behind closer opaque parts
  const frontToBack = [...unoccludedParts].sort(
    (a, b) => b.outCenter - a.outCenter || b.outFront - a.outFront || b.zBottom - a.zBottom
  );

  const visibleParts: CutThroughProjectedPart[] = [];
  for (let i = 0; i < frontToBack.length; i++) {
    const cand = frontToBack[i];
    const insetX = Math.min(3, cand.elevW * 0.15);
    const insetZ = Math.min(3, cand.elevH * 0.15);
    const candRect: ElevRect = {
      x1: cand.viewX - cand.elevW / 2 + insetX,
      x2: cand.viewX + cand.elevW / 2 - insetX,
      z1: cand.zBottom + insetZ,
      z2: cand.zBottom + cand.elevH - insetZ,
    };
    const candArea = Math.max(1, (candRect.x2 - candRect.x1) * (candRect.z2 - candRect.z1));
    let uncovered: ElevRect[] = [candRect];

    for (let j = 0; j < i && uncovered.length > 0; j++) {
      const blocker = frontToBack[j];
      if (!blocker.canOcclude) continue;
      // Blocker must sit genuinely in front of candidate relative to the cut-through angle
      if (blocker.outCenter <= cand.outCenter + 2 || blocker.outFront < cand.outFront - 2) {
        continue;
      }
      uncovered = subtractElevRect(uncovered, {
        x1: blocker.viewX - blocker.elevW / 2,
        x2: blocker.viewX + blocker.elevW / 2,
        z1: blocker.zBottom,
        z2: blocker.zBottom + blocker.elevH,
      });
    }

    const remArea = uncovered.reduce((s, r) => s + Math.max(0, r.x2 - r.x1) * Math.max(0, r.z2 - r.z1), 0);
    if (remArea / candArea > 0.02) {
      visibleParts.push({
        part: cand.part,
        viewX: cand.viewX,
        elevW: cand.elevW,
        elevH: cand.elevH,
        zBottom: cand.zBottom,
        outCenter: cand.outCenter,
        outBack: cand.outBack,
        outFront: cand.outFront,
      });
    }
  }

  // Render strictly back-to-front (painter's order from cut-through viewing angle)
  visibleParts.sort(
    (a, b) => a.outCenter - b.outCenter || a.outFront - b.outFront || a.zBottom - b.zBottom
  );

  const dirMatch = resolveWallViewProjectionForFurniture(wall, faceSide, furn);
  const elevW = Math.max(16, maxS - minS);
  const viewXCenter = isLeftView ? (minS + maxS) / 2 : lenMm - (minS + maxS) / 2;
  const minPartZ = unoccludedParts.reduce((m, p) => Math.min(m, p.zBottom), Infinity);
  const maxPartZ = unoccludedParts.reduce((m, p) => Math.max(m, p.zBottom + p.elevH), -Infinity);

  return {
    status: 'visible',
    item: furn,
    perpDistMm,
    visibleParts,
    projection: {
      viewId: dirMatch.viewId,
      flipX: dirMatch.flipX,
      viewXCenter,
      elevW,
      elevH: Math.max(15, maxPartZ - minPartZ),
      zBottom: Number.isFinite(minPartZ) ? minPartZ : furnFloorOffsetMm,
    },
  };
}

/**
 * Selects which canonical vertical elevation ('front' | 'rear' | 'left' | 'right')
 * faces the Wall View camera and whether it should be horizontally flipped due to mirroring.
 */
export function resolveWallViewProjectionForFurniture(
  wall: Wall,
  faceSide: 'inner' | 'outer' | 'left' | 'right',
  furn: Pick<FurnitureInstance, 'rotationDeg' | 'mirroredX' | 'mirroredY'>
): { viewId: Exclude<ProjectionViewId, 'top'>; flipX: boolean } {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const straightLen = Math.hypot(dx, dy) || 1;
  const ux = dx / straightLen;
  const uy = dy / straightLen;
  const nx = -uy;
  const ny = ux;

  const isLeftView = faceSide === 'inner' || faceSide === 'left';
  // Outward normal from viewed wall face toward camera
  const outN = isLeftView ? { x: nx, y: ny } : { x: -nx, y: -ny };
  // Screen right vector in Wall View coordinates
  const screenRight = isLeftView ? { x: ux, y: uy } : { x: -ux, y: -uy };

  const radF = (furn.rotationDeg * Math.PI) / 180;
  const cosF = Math.cos(radF);
  const sinF = Math.sin(radF);
  const mx = furn.mirroredX ? -1 : 1;
  const my = furn.mirroredY ? -1 : 1;

  // Furniture local axes in 2D world coordinates
  const localX = { x: mx * cosF, y: mx * sinF };
  const localY = { x: -my * sinF, y: my * cosF };

  const candidates: Array<{
    viewId: Exclude<ProjectionViewId, 'top'>;
    normal: Point2D;
    rightAxis: Point2D;
  }> = [
    { viewId: 'front', normal: localY, rightAxis: localX },
    { viewId: 'rear', normal: { x: -localY.x, y: -localY.y }, rightAxis: { x: -localX.x, y: -localX.y } },
    { viewId: 'left', normal: { x: -localX.x, y: -localX.y }, rightAxis: localY },
    { viewId: 'right', normal: localX, rightAxis: { x: -localY.x, y: -localY.y } },
  ];

  let best = candidates[0];
  let bestDot = -Infinity;
  for (const c of candidates) {
    const d = c.normal.x * outN.x + c.normal.y * outN.y;
    if (d > bestDot) {
      bestDot = d;
      best = c;
    }
  }

  const rightDot = best.rightAxis.x * screenRight.x + best.rightAxis.y * screenRight.y;
  return {
    viewId: best.viewId,
    flipX: rightDot < 0,
  };
}

// ============================================================================
// ARCHITECTURAL BLOCK EDGE-TO-EDGE FLUSH SNAPPING
// ============================================================================

export interface ArchElementSnapResult {
  xMm: number;
  yMm: number;
  snappedKind: 'wall' | 'align' | 'grid' | 'none';
  snapLabel?: string;
  guides: AlignmentGuide[];
}

function getArchWorldAabb(
  xMm: number,
  yMm: number,
  widthMm: number,
  depthMm: number,
  rotationDeg: number
): { minX: number; maxX: number; minY: number; maxY: number; cx: number; cy: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  const hw = widthMm / 2;
  const hd = depthMm / 2;
  const extX = hw * Math.abs(Math.cos(rad)) + hd * Math.abs(Math.sin(rad));
  const extY = hw * Math.abs(Math.sin(rad)) + hd * Math.abs(Math.cos(rad));
  return {
    minX: xMm - extX,
    maxX: xMm + extX,
    minY: yMm - extY,
    maxY: yMm + extY,
    cx: xMm,
    cy: yMm,
  };
}

/**
 * Snaps architectural blocks (platforms, balconies, columns, beams, fireplaces, stairs, etc.)
 * cleanly edge-to-edge flush against neighboring architectural blocks and wall faces.
 */
export function snapArchElementToPlan(
  targetPos: Point2D,
  el: Pick<ArchElement, 'id' | 'name' | 'widthMm' | 'depthMm' | 'rotationDeg'>,
  walls: Wall[],
  otherArchElements: ArchElement[],
  options: { snapEnabled: boolean; gridSizeMm: number; blockTolMm?: number; wallTolMm?: number }
): ArchElementSnapResult {
  let curX = Math.round(targetPos.x);
  let curY = Math.round(targetPos.y);
  const guides: AlignmentGuide[] = [];

  if (!options.snapEnabled) {
    return { xMm: curX, yMm: curY, snappedKind: 'none', guides };
  }

  const blockTol = options.blockTolMm ?? 95;
  const wallTol = options.wallTolMm ?? 85;
  const self = getArchWorldAabb(curX, curY, el.widthMm, el.depthMm, el.rotationDeg);
  const others = otherArchElements.filter((a) => a.id !== el.id && a.visible !== false);

  let lockedX = false;
  let lockedY = false;
  let snappedKind: ArchElementSnapResult['snappedKind'] = 'none';
  let snapLabel: string | undefined;

  let bestX: { delta: number; dist: number; guide: AlignmentGuide; text: string; name: string } | null = null;
  let bestY: { delta: number; dist: number; guide: AlignmentGuide; text: string; name: string } | null = null;

  for (const ob of others) {
    const obBox = getArchWorldAabb(ob.xMm, ob.yMm, ob.widthMm, ob.depthMm, ob.rotationDeg);
    const yOverlap = Math.min(self.maxY, obBox.maxY) - Math.max(self.minY, obBox.minY);
    const xOverlap = Math.min(self.maxX, obBox.maxX) - Math.max(self.minX, obBox.minX);

    // X-axis edge-to-edge flush or edge/center alignment
    if (yOverlap >= -350) {
      const specsX: Array<{ delta: number; coord: number; text: string; bias: number }> = [
        { delta: obBox.maxX - self.minX, coord: obBox.maxX, text: 'FLUSH', bias: 0 },
        { delta: obBox.minX - self.maxX, coord: obBox.minX, text: 'FLUSH', bias: 0 },
        { delta: obBox.minX - self.minX, coord: obBox.minX, text: 'ALIGN', bias: 14 },
        { delta: obBox.maxX - self.maxX, coord: obBox.maxX, text: 'ALIGN', bias: 14 },
        { delta: obBox.cx - self.cx, coord: obBox.cx, text: 'CENTER', bias: 18 },
      ];
      for (const s of specsX) {
        const d = Math.abs(s.delta);
        if (d <= blockTol && (!bestX || d + s.bias < bestX.dist)) {
          bestX = {
            delta: s.delta,
            dist: d + s.bias,
            text: s.text,
            name: ob.name,
            guide: {
              axis: 'x',
              from: { x: s.coord, y: Math.min(self.minY, obBox.minY) },
              to: { x: s.coord, y: Math.max(self.maxY, obBox.maxY) },
              coordMm: s.coord,
              label: s.text,
            },
          };
        }
      }
    }

    // Y-axis edge-to-edge flush or edge/center alignment
    if (xOverlap >= -350) {
      const specsY: Array<{ delta: number; coord: number; text: string; bias: number }> = [
        { delta: obBox.maxY - self.minY, coord: obBox.maxY, text: 'FLUSH', bias: 0 },
        { delta: obBox.minY - self.maxY, coord: obBox.minY, text: 'FLUSH', bias: 0 },
        { delta: obBox.minY - self.minY, coord: obBox.minY, text: 'ALIGN', bias: 14 },
        { delta: obBox.maxY - self.maxY, coord: obBox.maxY, text: 'ALIGN', bias: 14 },
        { delta: obBox.cy - self.cy, coord: obBox.cy, text: 'CENTER', bias: 18 },
      ];
      for (const s of specsY) {
        const d = Math.abs(s.delta);
        if (d <= blockTol && (!bestY || d + s.bias < bestY.dist)) {
          bestY = {
            delta: s.delta,
            dist: d + s.bias,
            text: s.text,
            name: ob.name,
            guide: {
              axis: 'y',
              from: { x: Math.min(self.minX, obBox.minX), y: s.coord },
              to: { x: Math.max(self.maxX, obBox.maxX), y: s.coord },
              coordMm: s.coord,
              label: s.text,
            },
          };
        }
      }
    }
  }

  if (bestX) {
    curX = Math.round(curX + bestX.delta);
    lockedX = true;
    guides.push(bestX.guide);
    snappedKind = 'align';
    snapLabel = `${bestX.text === 'FLUSH' ? 'Flush' : 'Aligned'} w/ ${bestX.name}`;
  }
  if (bestY) {
    curY = Math.round(curY + bestY.delta);
    lockedY = true;
    guides.push(bestY.guide);
    snappedKind = 'align';
    snapLabel = snapLabel
      ? `${snapLabel} · Corner`
      : `${bestY.text === 'FLUSH' ? 'Flush' : 'Aligned'} w/ ${bestY.name}`;
  }

  // Also check orthogonal wall face flush on any remaining free axes
  if (!lockedX || !lockedY) {
    const updated = getArchWorldAabb(curX, curY, el.widthMm, el.depthMm, el.rotationDeg);
    let bestWallX: { delta: number; coord: number; w: Wall } | null = null;
    let bestWallY: { delta: number; coord: number; w: Wall } | null = null;
    for (const w of walls) {
      if (w.visible === false || w.isCurved) continue;
      const dx = w.end.x - w.start.x;
      const dy = w.end.y - w.start.y;
      const { left, right } = wallOffsets(w.thicknessMm, w.alignment);
      // Horizontal wall (along X) -> snaps Y face
      if (Math.abs(dy) < 5 && !lockedY) {
        const wMinX = Math.min(w.start.x, w.end.x);
        const wMaxX = Math.max(w.start.x, w.end.x);
        if (updated.maxX >= wMinX - 150 && updated.minX <= wMaxX + 150) {
          const sign = dx >= 0 ? 1 : -1;
          const facesY = [w.start.y + left * sign, w.start.y + right * sign];
          for (const fy of facesY) {
            for (const delta of [fy - updated.minY, fy - updated.maxY]) {
              if (Math.abs(delta) <= wallTol && (!bestWallY || Math.abs(delta) < Math.abs(bestWallY.delta))) {
                bestWallY = { delta, coord: fy, w };
              }
            }
          }
        }
      }
      // Vertical wall (along Y) -> snaps X face
      if (Math.abs(dx) < 5 && !lockedX) {
        const wMinY = Math.min(w.start.y, w.end.y);
        const wMaxY = Math.max(w.start.y, w.end.y);
        if (updated.maxY >= wMinY - 150 && updated.minY <= wMaxY + 150) {
          const sign = dy >= 0 ? -1 : 1;
          const facesX = [w.start.x + left * sign, w.start.x + right * sign];
          for (const fx of facesX) {
            for (const delta of [fx - updated.minX, fx - updated.maxX]) {
              if (Math.abs(delta) <= wallTol && (!bestWallX || Math.abs(delta) < Math.abs(bestWallX.delta))) {
                bestWallX = { delta, coord: fx, w };
              }
            }
          }
        }
      }
    }
    if (bestWallX && !lockedX) {
      curX = Math.round(curX + bestWallX.delta);
      lockedX = true;
      guides.push({
        axis: 'x',
        from: { x: bestWallX.coord, y: updated.minY },
        to: { x: bestWallX.coord, y: updated.maxY },
        coordMm: bestWallX.coord,
        label: 'WALL FLUSH',
      });
      if (snappedKind === 'none') snappedKind = 'wall';
      if (!snapLabel) snapLabel = 'Wall Flush';
    }
    if (bestWallY && !lockedY) {
      curY = Math.round(curY + bestWallY.delta);
      lockedY = true;
      guides.push({
        axis: 'y',
        from: { x: updated.minX, y: bestWallY.coord },
        to: { x: updated.maxX, y: bestWallY.coord },
        coordMm: bestWallY.coord,
        label: 'WALL FLUSH',
      });
      if (snappedKind === 'none') snappedKind = 'wall';
      if (!snapLabel) snapLabel = 'Wall Flush';
    }
  }

  const g = Math.max(10, options.gridSizeMm || 50);
  if (!lockedX) {
    curX = Math.round(curX / g) * g;
    if (snappedKind === 'none') snappedKind = 'grid';
  }
  if (!lockedY) {
    curY = Math.round(curY / g) * g;
    if (snappedKind === 'none') snappedKind = 'grid';
  }

  return { xMm: curX, yMm: curY, snappedKind, snapLabel, guides };
}

/**
 * Snaps a standalone Curtain object exclusively onto the nearest straight wall face.
 */
export function snapStandaloneCurtainToWall(
  targetPos: Point2D,
  curtain: Pick<Curtain, 'widthMm' | 'rotationDeg'>,
  walls: Wall[]
): { xMm: number; yMm: number; rotationDeg: number; wallId?: string; snapped: boolean } {
  const visibleWalls = walls.filter((w) => w.visible !== false && !w.isCurved && getWallArcLength(w) >= 40);
  if (visibleWalls.length === 0) {
    return {
      xMm: Math.round(targetPos.x),
      yMm: Math.round(targetPos.y),
      rotationDeg: curtain.rotationDeg,
      snapped: false,
    };
  }

  let best: { x: number; y: number; rot: number; wallId: string; dist: number } | null = null;
  const hw = Math.max(100, curtain.widthMm / 2);
  const standOff = 55;

  for (const w of visibleWalls) {
    const wallLen = getWallArcLength(w);
    const ux = (w.end.x - w.start.x) / wallLen;
    const uy = (w.end.y - w.start.y) / wallLen;
    const nx = -uy;
    const ny = ux;
    const { left, right } = wallOffsets(w.thicknessMm, w.alignment);
    const wallMid = (left + right) / 2;
    const dNorm = (targetPos.x - w.start.x) * nx + (targetPos.y - w.start.y) * ny;
    const onLeft = dNorm >= wallMid;
    const faceOffset = onLeft ? left + standOff : right - standOff;

    const sRaw = (targetPos.x - w.start.x) * ux + (targetPos.y - w.start.y) * uy;
    const spanMin = hw * 2 <= wallLen ? hw : 0;
    const spanMax = hw * 2 <= wallLen ? wallLen - hw : wallLen;
    const clampedS = Math.max(spanMin, Math.min(spanMax, sRaw));

    const sx = w.start.x + ux * clampedS + nx * faceOffset;
    const sy = w.start.y + uy * clampedS + ny * faceOffset;
    const dTarget = Math.hypot(sx - targetPos.x, sy - targetPos.y);
    const wallAngleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
    const rot = Math.round(((onLeft ? wallAngleDeg : wallAngleDeg + 180) % 360 + 360) % 360);

    if (!best || dTarget < best.dist) {
      best = { x: sx, y: sy, rot, wallId: w.id, dist: dTarget };
    }
  }

  if (!best) {
    return {
      xMm: Math.round(targetPos.x),
      yMm: Math.round(targetPos.y),
      rotationDeg: curtain.rotationDeg,
      snapped: false,
    };
  }

  return {
    xMm: Math.round(best.x),
    yMm: Math.round(best.y),
    rotationDeg: best.rot,
    wallId: best.wallId,
    snapped: true,
  };
}

function pointToPolygonEdgeDistanceMm(pt: Point2D, poly: Point2D[]): number {
  if (poly.length < 3) return Infinity;
  if (pointInPolygon(pt, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const proj = projectPointOnSegment(pt, a, b);
    if (proj.distance < best) best = proj.distance;
  }
  return best;
}

/**
 * Returns the room connected to a balcony slab (overlapping or touching within exterior-wall tolerance).
 * Returns null if the balcony is placed standalone in open space without touching any main floor room.
 */
export function findConnectedRoomForBalcony(
  balcony: Pick<ArchElement, 'type' | 'xMm' | 'yMm' | 'widthMm' | 'depthMm' | 'rotationDeg' | 'visible'>,
  rooms: Room[],
  walls: Wall[] = [],
  tolMm = 320
): Room | null {
  if (balcony.type !== 'balcony' || balcony.visible === false || rooms.length === 0) {
    return null;
  }

  const maxWallThick = walls.reduce(
    (mx, w) => (w.visible !== false ? Math.max(mx, w.thicknessMm) : mx),
    200
  );
  const effectiveTol = Math.max(tolMm, maxWallThick + 80);

  const corners = getChimneyWorldCorners(
    balcony.xMm,
    balcony.yMm,
    balcony.widthMm,
    balcony.depthMm,
    balcony.rotationDeg
  );
  const samplePts: Point2D[] = [...corners];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    samplePts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  samplePts.push({ x: balcony.xMm, y: balcony.yMm });

  let bestRoom: Room | null = null;
  let bestDist = Infinity;

  for (const room of rooms) {
    if (!room.visible || room.polygon.length < 3) continue;
    let minD = Infinity;
    for (const sp of samplePts) {
      const d = pointToPolygonEdgeDistanceMm(sp, room.polygon);
      if (d < minD) minD = d;
      if (minD === 0) break;
    }
    if (minD > 0) {
      for (const rv of room.polygon) {
        const d = pointToPolygonEdgeDistanceMm(rv, corners);
        if (d < minD) minD = d;
        if (minD === 0) break;
      }
    }
    if (minD <= effectiveTol) {
      const betterDistance = minD < bestDist - 1;
      const sameDistPreferCeiling =
        Math.abs(minD - bestDist) <= 1 && !!room.hasCeiling && !bestRoom?.hasCeiling;
      if (!bestRoom || betterDistance || sameDistPreferCeiling) {
        bestRoom = room;
        bestDist = minD;
      }
    }
  }

  return bestRoom;
}

// ============================================================================
// AUTOMATIC WALL FACE IDENTIFICATION, ROOM ASSOCIATION & FLIP FACE
// ============================================================================

export interface ResolvedWallFaceInfo {
  id: 'inner' | 'outer';
  physicalSide: 'left' | 'right';
  slot: 'inner' | 'outer';
  label: string;
  subtitle: string;
  roomId?: string;
  roomName?: string;
  isRoomFacing: boolean;
}

export interface ResolvedWallFaces {
  kind: 'single_room' | 'shared' | 'freestanding';
  orientationFlipped: boolean;
  /** Physical +normal ('left') face */
  left: ResolvedWallFaceInfo;
  /** Physical -normal ('right') face */
  right: ResolvedWallFaceInfo;
  /** Primary editable/viewable face (room-facing Inner for single-room walls) */
  primary: ResolvedWallFaceInfo;
  /** Secondary editable/viewable face */
  secondary: ResolvedWallFaceInfo;
}

function findContainingRoomForPoint(pt: Point2D, visibleRooms: Room[]): Room | null {
  let best: Room | null = null;
  let bestArea = Infinity;
  for (const r of visibleRooms) {
    if (pointInPolygon(pt, r.polygon)) {
      const area = r.areaM2 > 0 ? r.areaM2 : Math.abs(computePolygonAreaM2(r.polygon));
      if (area < bestArea) {
        bestArea = area;
        best = r;
      }
    }
  }
  return best;
}

/**
 * Automatically identifies which physical side (+normal left vs -normal right) borders
 * enclosing room(s), dynamically resolving room names for shared walls and Inner/Outer
 * for single-room or freestanding walls without mutating geometry.
 */
export function resolveWallFaces(wall: Wall, rooms: Room[]): ResolvedWallFaces {
  const visibleRooms = rooms.filter((r) => r.visible !== false && r.polygon.length >= 3);
  const { left: offLeft, right: offRight } = wallOffsets(wall.thicknessMm, wall.alignment);
  const primaryProbe = Math.max(85, Math.min(240, wall.thicknessMm * 0.55));
  const probeDists = [primaryProbe, 42];
  const sampleTs = [0.22, 0.36, 0.5, 0.64, 0.78];

  const leftVotes = new Map<string, { room: Room; count: number }>();
  const rightVotes = new Map<string, { room: Room; count: number }>();

  if (visibleRooms.length > 0 && getWallArcLength(wall) >= 20) {
    for (const t of sampleTs) {
      const { point, normal } = getWallCenterlinePoint(wall, t);
      for (const pDist of probeDists) {
        const lPt = {
          x: point.x + normal.x * (offLeft + pDist),
          y: point.y + normal.y * (offLeft + pDist),
        };
        const rPt = {
          x: point.x + normal.x * (offRight - pDist),
          y: point.y + normal.y * (offRight - pDist),
        };
        const lRoom = findContainingRoomForPoint(lPt, visibleRooms);
        if (lRoom) {
          const prev = leftVotes.get(lRoom.id);
          leftVotes.set(lRoom.id, { room: lRoom, count: (prev?.count ?? 0) + (pDist === primaryProbe ? 2 : 1) });
        }
        const rRoom = findContainingRoomForPoint(rPt, visibleRooms);
        if (rRoom) {
          const prev = rightVotes.get(rRoom.id);
          rightVotes.set(rRoom.id, { room: rRoom, count: (prev?.count ?? 0) + (pDist === primaryProbe ? 2 : 1) });
        }
      }
    }
  }

  const pickBest = (votes: Map<string, { room: Room; count: number }>): Room | null => {
    let best: { room: Room; count: number } | null = null;
    for (const v of votes.values()) {
      if (!best || v.count > best.count) best = v;
    }
    return best?.room ?? null;
  };

  const leftRoom = pickBest(leftVotes);
  const rightRoom = pickBest(rightVotes);
  const flipped = Boolean(wall.faceFlipped);

  // Shared wall separating two distinct rooms
  if (leftRoom && rightRoom && leftRoom.id !== rightRoom.id) {
    const leftName = leftRoom.name.trim() || 'Room A';
    const rightName = rightRoom.name.trim() || 'Room B';
    const leftInfo: ResolvedWallFaceInfo = {
      id: 'inner',
      physicalSide: 'left',
      slot: 'inner',
      label: leftName,
      subtitle: `Shared · Facing ${leftName}`,
      roomId: leftRoom.id,
      roomName: leftName,
      isRoomFacing: true,
    };
    const rightInfo: ResolvedWallFaceInfo = {
      id: 'outer',
      physicalSide: 'right',
      slot: 'outer',
      label: rightName,
      subtitle: `Shared · Facing ${rightName}`,
      roomId: rightRoom.id,
      roomName: rightName,
      isRoomFacing: true,
    };
    return {
      kind: 'shared',
      orientationFlipped: flipped,
      left: leftInfo,
      right: rightInfo,
      primary: flipped ? rightInfo : leftInfo,
      secondary: flipped ? leftInfo : rightInfo,
    };
  }

  // Single-room wall (one side faces room, opposite side is exterior/outside)
  if ((leftRoom && !rightRoom) || (rightRoom && !leftRoom)) {
    const roomOnLeft = Boolean(leftRoom && !rightRoom);
    const room = (roomOnLeft ? leftRoom : rightRoom)!;
    const roomName = room.name.trim() || 'Room';
    const innerInfo: ResolvedWallFaceInfo = {
      id: 'inner',
      physicalSide: roomOnLeft ? 'left' : 'right',
      slot: 'inner',
      label: 'Inner',
      subtitle: `Facing ${roomName}`,
      roomId: room.id,
      roomName,
      isRoomFacing: true,
    };
    const outerInfo: ResolvedWallFaceInfo = {
      id: 'outer',
      physicalSide: roomOnLeft ? 'right' : 'left',
      slot: 'outer',
      label: 'Outer',
      subtitle: 'Exterior / Opposite Side',
      isRoomFacing: false,
    };
    return {
      kind: 'single_room',
      orientationFlipped: flipped,
      left: roomOnLeft ? innerInfo : outerInfo,
      right: roomOnLeft ? outerInfo : innerInfo,
      primary: innerInfo,
      secondary: outerInfo,
    };
  }

  // Freestanding partition (0 rooms or identical room polygon on both sides)
  const sharedRoomName = leftRoom && rightRoom && leftRoom.id === rightRoom.id ? leftRoom.name.trim() : '';
  const innerPhysSide: 'left' | 'right' = flipped ? 'right' : 'left';
  const leftInfo: ResolvedWallFaceInfo = {
    id: innerPhysSide === 'left' ? 'inner' : 'outer',
    physicalSide: 'left',
    slot: 'inner',
    label: innerPhysSide === 'left' ? 'Inner' : 'Outer',
    subtitle: sharedRoomName
      ? `Inside ${sharedRoomName} (+Normal)`
      : innerPhysSide === 'left'
        ? 'Primary Face (+Normal)'
        : 'Opposite Face (+Normal)',
    roomId: sharedRoomName ? leftRoom?.id : undefined,
    roomName: sharedRoomName || undefined,
    isRoomFacing: innerPhysSide === 'left',
  };
  const rightInfo: ResolvedWallFaceInfo = {
    id: innerPhysSide === 'right' ? 'inner' : 'outer',
    physicalSide: 'right',
    slot: 'outer',
    label: innerPhysSide === 'right' ? 'Inner' : 'Outer',
    subtitle: sharedRoomName
      ? `Inside ${sharedRoomName} (-Normal)`
      : innerPhysSide === 'right'
        ? 'Primary Face (-Normal)'
        : 'Opposite Face (-Normal)',
    roomId: sharedRoomName ? rightRoom?.id : undefined,
    roomName: sharedRoomName || undefined,
    isRoomFacing: innerPhysSide === 'right',
  };
  return {
    kind: 'freestanding',
    orientationFlipped: flipped,
    left: leftInfo,
    right: rightInfo,
    primary: innerPhysSide === 'left' ? leftInfo : rightInfo,
    secondary: innerPhysSide === 'left' ? rightInfo : leftInfo,
  };
}

/**
 * Reverses a wall's physical face orientation and exchanges face-specific materials,
 * colors, and texture mappings without moving the wall, resizing it, altering alignment,
 * or breaking shared room associations.
 */
export function flipWallFace(wall: Wall): Wall {
  return {
    ...wall,
    faceFlipped: !wall.faceFlipped,
    innerColor: wall.outerColor,
    outerColor: wall.innerColor,
    innerMaterial: wall.outerMaterial,
    outerMaterial: wall.innerMaterial,
    innerTextureScale: wall.outerTextureScale,
    outerTextureScale: wall.innerTextureScale,
    innerTextureRotDeg: wall.outerTextureRotDeg,
    outerTextureRotDeg: wall.innerTextureRotDeg,
  };
}

// ============================================================================
// WALL-MOUNTED FURNITURE ATTACHMENT & PARENT-CHILD HIERARCHY PROPAGATION
// ============================================================================

/**
 * Computes exact flush world position (xMm, yMm) and room-facing rotationDeg
 * for any furniture item mounted on `wall` at parametric position `t` and physical `face`.
 */
export function computeAttachedWallFurnitureTransform(
  wall: Wall,
  t: number,
  face: 'left' | 'right',
  furn: Pick<
    FurnitureInstance,
    'parts' | 'mirroredX' | 'mirroredY' | 'rotationXDeg' | 'rotationYDeg' | 'wallOffsetMm'
  >,
  overrideOffsetMm?: number
): { xMm: number; yMm: number; rotationDeg: number; attachedT: number } {
  const clampedT = Math.max(0.01, Math.min(0.99, Number.isFinite(t) ? t : 0.5));
  const { point, tangent, normal } = getWallCenterlinePoint(wall, clampedT);
  const { left, right } = wallOffsets(wall.thicknessMm, wall.alignment);
  const wallAngleDeg = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
  const rotationDeg = Math.round(((face === 'left' ? wallAngleDeg : wallAngleDeg + 180) % 360 + 360) % 360);

  const rotOffsets = getFurnitureOrientedOffsets(
    furn.parts,
    rotationDeg,
    furn.mirroredX,
    furn.mirroredY,
    furn.rotationXDeg ?? 0,
    furn.rotationYDeg ?? 0
  );
  const nVals = rotOffsets.map((o) => o.x * normal.x + o.y * normal.y);
  const nMin = Math.min(...nVals);
  const nMax = Math.max(...nVals);
  const faceOffset = face === 'left' ? left : right;
  const off = overrideOffsetMm ?? furn.wallOffsetMm ?? 0;
  const idealDNorm = face === 'left' ? faceOffset + off - nMin : faceOffset - off - nMax;

  return {
    xMm: Math.round(point.x + normal.x * idealDNorm),
    yMm: Math.round(point.y + normal.y * idealDNorm),
    rotationDeg,
    attachedT: clampedT,
  };
}

/**
 * Finds the nearest visible wall & physical face to snap and attach a wall-mounted item.
 */
export function findNearestWallAttachmentTarget(
  pos: Point2D,
  furn: Pick<
    FurnitureInstance,
    'parts' | 'mirroredX' | 'mirroredY' | 'rotationXDeg' | 'rotationYDeg' | 'wallOffsetMm'
  >,
  walls: Wall[],
  maxDistMm = Infinity
): {
  wall: Wall;
  face: 'left' | 'right';
  t: number;
  xMm: number;
  yMm: number;
  rotationDeg: number;
  distanceMm: number;
} | null {
  let best: {
    wall: Wall;
    face: 'left' | 'right';
    t: number;
    xMm: number;
    yMm: number;
    rotationDeg: number;
    distanceMm: number;
  } | null = null;

  for (const w of walls) {
    if (w.visible === false || getWallArcLength(w) < 40) continue;
    let t = 0.5;
    if (!w.isCurved || Math.abs(w.curveBulgeMm) < 1) {
      t = projectPointOnSegment(pos, w.start, w.end).t;
    } else {
      let minD = Infinity;
      for (let i = 0; i <= 20; i++) {
        const ti = i / 20;
        const pt = getWallCenterlinePoint(w, ti).point;
        const d = dist(pos, pt);
        if (d < minD) {
          minD = d;
          t = ti;
        }
      }
    }
    const clampedT = Math.max(0.03, Math.min(0.97, t));
    const { point, normal } = getWallCenterlinePoint(w, clampedT);
    const { left, right } = wallOffsets(w.thicknessMm, w.alignment);
    const wallMid = (left + right) / 2;
    const dNorm = (pos.x - point.x) * normal.x + (pos.y - point.y) * normal.y;
    const face: 'left' | 'right' = dNorm >= wallMid ? 'left' : 'right';
    const xf = computeAttachedWallFurnitureTransform(w, clampedT, face, furn);
    const distanceMm = Math.hypot(xf.xMm - pos.x, xf.yMm - pos.y);
    if (distanceMm <= maxDistMm && (!best || distanceMm < best.distanceMm)) {
      best = { wall: w, face, t: xf.attachedT, xMm: xf.xMm, yMm: xf.yMm, rotationDeg: xf.rotationDeg, distanceMm };
    }
  }
  return best;
}

/**
 * Converts a child furniture world position & rotation into host-local unmirrored coordinates.
 */
export function computeSurfaceLocalCoords(
  worldPos: Point2D,
  childRotDeg: number,
  host: Pick<FurnitureInstance, 'xMm' | 'yMm' | 'rotationDeg' | 'mirroredX' | 'mirroredY'>
): { localXMm: number; localYMm: number; localRotDeg: number } {
  const dx = worldPos.x - host.xMm;
  const dy = worldPos.y - host.yMm;
  const rad = (-host.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return {
    localXMm: rx * (host.mirroredX ? -1 : 1),
    localYMm: ry * (host.mirroredY ? -1 : 1),
    localRotDeg: (((childRotDeg - host.rotationDeg) % 360) + 360) % 360,
  };
}

/**
 * Projects host-local coordinates back into world space after host move, rotate, mirror, or resize.
 */
export function computeWorldFromSurfaceLocal(
  localXMm: number,
  localYMm: number,
  localRotDeg: number,
  host: Pick<FurnitureInstance, 'xMm' | 'yMm' | 'rotationDeg' | 'mirroredX' | 'mirroredY'>
): { xMm: number; yMm: number; rotationDeg: number } {
  const mx = localXMm * (host.mirroredX ? -1 : 1);
  const my = localYMm * (host.mirroredY ? -1 : 1);
  const rad = (host.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    xMm: Math.round(host.xMm + mx * cos - my * sin),
    yMm: Math.round(host.yMm + mx * sin + my * cos),
    rotationDeg: Math.round((((host.rotationDeg + localRotDeg) % 360) + 360) % 360 * 100) / 100,
  };
}

/**
 * Propagates parent move, rotation, mirror, and resize transformations recursively to all
 * surface-hosted descendant furniture items so attachments never drift, detach, or float.
 */
export function propagateParentFurnitureTransforms(
  furnitureList: FurnitureInstance[],
  parentId: string,
  prevParent: FurnitureInstance,
  nextParent: FurnitureInstance
): FurnitureInstance[] {
  const prevBounds = computeFurnitureBoundsMm(prevParent.parts);
  const nextBounds = computeFurnitureBoundsMm(nextParent.parts);
  const scaleX = nextBounds.widthMm / Math.max(10, prevBounds.widthMm);
  const scaleY = nextBounds.depthMm / Math.max(10, prevBounds.depthMm);
  const resized = Math.abs(scaleX - 1) > 1e-4 || Math.abs(scaleY - 1) > 1e-4;
  const nextDeckZ = getSupportingDeckHeightMm(nextParent);

  let updated = furnitureList;
  const directChildren = furnitureList.filter((f) => f.surfaceHostId === parentId);
  if (directChildren.length === 0) return updated;

  const childMap = new Map<string, FurnitureInstance>();
  for (const child of directChildren) {
    if (child.locked) continue;
    const local = computeSurfaceLocalCoords(
      { x: child.xMm, y: child.yMm },
      child.rotationDeg,
      prevParent
    );
    let lx = local.localXMm;
    let ly = local.localYMm;
    if (resized) {
      lx = Math.max(-nextBounds.widthMm * 0.48, Math.min(nextBounds.widthMm * 0.48, lx * scaleX));
      ly = Math.max(-nextBounds.depthMm * 0.48, Math.min(nextBounds.depthMm * 0.48, ly * scaleY));
    }
    const world = computeWorldFromSurfaceLocal(lx, ly, local.localRotDeg, nextParent);
    const nextChild: FurnitureInstance = {
      ...child,
      xMm: world.xMm,
      yMm: world.yMm,
      rotationDeg: world.rotationDeg,
      elevationMm: nextDeckZ,
      surfaceLocalXMm: Math.round(lx * 10) / 10,
      surfaceLocalYMm: Math.round(ly * 10) / 10,
      surfaceLocalRotDeg: Math.round(local.localRotDeg * 10) / 10,
    };
    childMap.set(child.id, nextChild);
  }

  updated = updated.map((f) => childMap.get(f.id) ?? f);
  for (const child of directChildren) {
    const nextChild = childMap.get(child.id);
    if (nextChild) {
      updated = propagateParentFurnitureTransforms(updated, child.id, child, nextChild);
    }
  }
  return updated;
}

/**
 * Recomputes wall-attached furniture positions & room-facing rotations when walls move,
 * resize, or flip, and propagates to any items stacked on floating consoles.
 */
export function propagateWallAttachments(
  furnitureList: FurnitureInstance[],
  walls: Wall[],
  movedWallIds?: Set<string>
): FurnitureInstance[] {
  const wallById = new Map(walls.map((w) => [w.id, w]));
  let updated = [...furnitureList];
  const movedParents: Array<{ prev: FurnitureInstance; next: FurnitureInstance }> = [];

  updated = updated.map((f) => {
    if (!f.attachedWallId || f.locked) return f;
    if (movedWallIds && !movedWallIds.has(f.attachedWallId)) return f;
    const w = wallById.get(f.attachedWallId);
    if (!w) {
      return {
        ...f,
        attachedWallId: undefined,
        attachedFace: undefined,
        attachedT: undefined,
      };
    }
    const face = f.attachedFace ?? 'left';
    const xf = computeAttachedWallFurnitureTransform(w, f.attachedT ?? 0.5, face, f);
    if (xf.xMm === f.xMm && xf.yMm === f.yMm && xf.rotationDeg === f.rotationDeg) {
      return f;
    }
    const nextItem: FurnitureInstance = {
      ...f,
      xMm: xf.xMm,
      yMm: xf.yMm,
      rotationDeg: xf.rotationDeg,
      attachedT: xf.attachedT,
    };
    movedParents.push({ prev: f, next: nextItem });
    return nextItem;
  });

  for (const pair of movedParents) {
    updated = propagateParentFurnitureTransforms(updated, pair.next.id, pair.prev, pair.next);
  }
  return updated;
}

/**
 * Safely detaches child furniture when their parent wall or supporting furniture is deleted,
 * clearing attachment links and lowering orphaned surface children back to the floor cleanly.
 */
export function detachChildrenOnParentDelete(
  furnitureList: FurnitureInstance[],
  deletedWallIds: Set<string>,
  deletedFurnIds: Set<string>
): FurnitureInstance[] {
  if (deletedWallIds.size === 0 && deletedFurnIds.size === 0) return furnitureList;
  return furnitureList.map((f) => {
    let changed = false;
    let next = f;
    if (f.attachedWallId && deletedWallIds.has(f.attachedWallId)) {
      next = {
        ...next,
        attachedWallId: undefined,
        attachedFace: undefined,
        attachedT: undefined,
      };
      changed = true;
    }
    if (f.surfaceHostId && deletedFurnIds.has(f.surfaceHostId)) {
      next = {
        ...next,
        surfaceHostId: undefined,
        surfaceLocalXMm: undefined,
        surfaceLocalYMm: undefined,
        surfaceLocalRotDeg: undefined,
        elevationMm: 0,
      };
      changed = true;
    }
    return changed ? next : f;
  });
}









