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
      const y1 = Math.max(0.001, op.sillHeightMm / 1000);
      const y2 = Math.min(wallH - 0.02, (op.sillHeightMm + op.heightMm) / 1000);
      if (x2 > x1 + 0.04 && y2 > y1 + 0.04) {
        cutouts.push({
          op,
          x1,
          x2,
          y1,
          y2,
          tStart: x1 / arcLenM,
          tEnd: x2 / arcLenM,
        });
      }
    }

    const baseSteps = 28;
    const tBreaks = new Set<number>();
    for (let i = 0; i <= baseSteps; i++) tBreaks.add(i / baseSteps);
    for (const c of cutouts) {
      tBreaks.add(Math.max(0, Math.min(1, c.tStart)));
      tBreaks.add(Math.max(0, Math.min(1, c.tEnd)));
    }
    const sortedTs = Array.from(tBreaks).sort((a, b) => a - b);
    const ts: number[] = [];
    for (const t of sortedTs) {
      if (ts.length === 0 || t - ts[ts.length - 1] > 0.0015) {
        ts.push(t);
      } else if (t === 1) {
        ts[ts.length - 1] = 1;
      }
    }

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
      if (segLen < 0.008) continue;
      const ang = Math.atan2(segDz, segDx);
      const midX = (p1x + p2x) / 2;
      const midZ = (p1z + p2z) / 2;

      const hit = cutouts.find((c) => tMid > c.tStart + 0.0005 && tMid < c.tEnd - 0.0005);
      let verticalSpans: Array<[number, number]> = [[0, wallH]];
      let holeBottom = Infinity;
      let holeTop = -Infinity;

      if (hit) {
        holeBottom = hit.y1;
        holeTop = hit.y2;
        if (hit.op.category === 'window' && hit.op.subtype === 'round') {
          const tMidNorm = (tMid - (hit.tStart + hit.tEnd) / 2) / Math.max(1e-4, (hit.tEnd - hit.tStart) / 2);
          const halfArcH = ((hit.y2 - hit.y1) / 2) * Math.sqrt(Math.max(0, 1 - tMidNorm * tMidNorm));
          const cy = (hit.y1 + hit.y2) / 2;
          holeBottom = cy - halfArcH;
          holeTop = cy + halfArcH;
        }
        verticalSpans = [];
        if (holeBottom > 0.008) verticalSpans.push([0, holeBottom]);
        if (holeTop < wallH - 0.008) verticalSpans.push([holeTop, wallH]);
      }

      for (const [yA, yB] of verticalSpans) {
        const spanH = yB - yA;
        if (spanH < 0.008) continue;
        const segGeo = new THREE.BoxGeometry(segLen + 0.006, spanH, thick);
        opts.onCurvedSegmentGeo?.(segGeo, i);
        const segMesh = new THREE.Mesh(segGeo, curvedMats);
        segMesh.position.set(midX, (yA + yB) / 2, midZ);
        segMesh.rotation.y = -ang;
        segMesh.castShadow = opts.castShadows;
        segMesh.receiveShadow = opts.castShadows;
        wallGroup.add(segMesh);
      }

      if (bbH > 0 && opts.baseboardMat && (!hit || holeBottom >= bbH + 0.002)) {
        const bbSeg = new THREE.Mesh(new THREE.BoxGeometry(segLen + 0.006, bbH, thick + 0.018), opts.baseboardMat);
        bbSeg.position.set(midX, bbH / 2, midZ);
        bbSeg.rotation.y = -ang;
        bbSeg.receiveShadow = opts.castShadows;
        wallGroup.add(bbSeg);
      }
      if (crH > 0 && opts.crownMat && (!hit || holeTop <= wallH - crH - 0.002)) {
        const crSeg = new THREE.Mesh(new THREE.BoxGeometry(segLen + 0.006, crH, thick + 0.025), opts.crownMat);
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

  // Outer perimeter (CCW) + Cutout holes (strictly CW winding)
  const wallShape = new THREE.Shape();
  wallShape.moveTo(0, 0);
  wallShape.lineTo(len, 0);
  wallShape.lineTo(len, wallH);
  wallShape.lineTo(0, wallH);
  wallShape.closePath();

  const cutouts: WallOpeningCutout[] = [];
  for (const op of hostOpenings) {
    const cx = op.t * len;
    const hw = Math.min(len * 0.48, op.widthMm / 2000);
    const x1 = Math.max(0.02, cx - hw);
    const x2 = Math.min(len - 0.02, cx + hw);
    const y1 = Math.max(0.001, op.sillHeightMm / 1000);
    const y2 = Math.min(wallH - 0.02, (op.sillHeightMm + op.heightMm) / 1000);
    if (x2 > x1 + 0.04 && y2 > y1 + 0.04) {
      cutouts.push({ op, x1, x2, y1, y2, tStart: x1 / len, tEnd: x2 / len });
      const hole = new THREE.Path();
      const ow = x2 - x1;
      const oh = y2 - y1;
      if (op.category === 'arch' && op.subtype === 'round_arch') {
        const radius = ow / 2;
        const springY = Math.max(y1 + 0.05, y2 - radius);
        hole.moveTo(x1, y1);
        hole.lineTo(x1, springY);
        hole.absarc((x1 + x2) / 2, springY, radius, Math.PI, 0, true);
        hole.lineTo(x2, y1);
      } else if (op.category === 'arch' && op.subtype === 'pointed_arch') {
        const archRise = Math.min(oh * 0.48, ow * 0.65);
        const springY = Math.max(y1 + 0.05, y2 - archRise);
        hole.moveTo(x1, y1);
        hole.lineTo(x1, springY);
        hole.quadraticCurveTo(x1 + ow * 0.14, y2 - archRise * 0.25, (x1 + x2) / 2, y2);
        hole.quadraticCurveTo(x2 - ow * 0.14, y2 - archRise * 0.25, x2, springY);
        hole.lineTo(x2, y1);
      } else if (op.category === 'arch' && op.subtype === 'segmental_arch') {
        const archRise = Math.min(oh * 0.25, ow * 0.35);
        const springY = Math.max(y1 + 0.05, y2 - archRise);
        hole.moveTo(x1, y1);
        hole.lineTo(x1, springY);
        hole.quadraticCurveTo((x1 + x2) / 2, y2 + archRise * 0.55, x2, springY);
        hole.lineTo(x2, y1);
      } else if (op.category === 'window' && op.subtype === 'round') {
        const rx = ow / 2;
        const ry = oh / 2;
        hole.absellipse((x1 + x2) / 2, (y1 + y2) / 2, rx, ry, 0, Math.PI * 2, true, 0);
      } else {
        // Explicit CW winding for rectangular cutouts so inner holes stay strictly open
        hole.moveTo(x1, y1);
        hole.lineTo(x1, y2);
        hole.lineTo(x2, y2);
        hole.lineTo(x2, y1);
      }
      hole.closePath();
      wallShape.holes.push(hole);
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
