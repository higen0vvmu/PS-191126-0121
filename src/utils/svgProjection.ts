import * as THREE from 'three';
import type {
  FurnitureInstance,
  FurniturePart,
  FurnitureRepresentation,
  MountingFace,
  MountingType,
  Point2D,
  ProjectedViewSvg,
  ProjectionViewId,
  RepresentationMode,
  SvgPathElementData,
  SvgVectorElement,
} from '../types/plan';
import { fastHashString } from './assetStore';
import { computeFurnitureBoundsMm, computeFurnitureTiltedLocalBoundsMm, rotateThreeYXZ } from './geometry';
import { applyMountingRotationToObject3D, defaultMountingFaceForType } from './mounting';

export interface Triangle3D {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  color: string;
  meshIndex: number;
}

export interface NormalizedMeshData {
  triangles: Triangle3D[];
  boundsMm: {
    widthMm: number;
    depthMm: number;
    heightMm: number;
  };
}

interface ProjectedTri2D {
  u0: number;
  v0: number;
  d0: number;
  u1: number;
  v1: number;
  d1: number;
  u2: number;
  v2: number;
  d2: number;
  colorIdx: number;
}

interface Edge3D {
  u0: number;
  v0: number;
  d0: number;
  u1: number;
  v1: number;
  d1: number;
}

const DEFAULT_STROKE_COLOR = '#0F172A';
const DEFAULT_FILL_COLOR = '#FFFFFF';
const DEFAULT_STROKE_MM = 12;

export const ALL_PROJECTION_VIEWS: ProjectionViewId[] = ['top', 'front', 'rear', 'left', 'right'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function colorToHexString(color: THREE.Color | undefined | null, fallback = '#CBD5E1'): string {
  if (!color) return fallback;
  return `#${color.getHexString().toUpperCase()}`;
}

function extractMaterialColorHex(mat: THREE.Material | THREE.Material[] | undefined): string {
  const m = Array.isArray(mat) ? mat[0] : mat;
  if (!m) return '#CBD5E1';
  const std = m as THREE.MeshStandardMaterial;
  if (std.color && std.color.isColor) {
    return colorToHexString(std.color);
  }
  return '#CBD5E1';
}

/**
 * Normalizes a Three.js Object3D into millimeter space centered in X/Z with bottom at Y=0,
 * optionally scaled to target metric dimensions and tilted by X/Y degrees.
 */
export function extractNormalizedMeshDataFromObject3D(
  root: THREE.Object3D,
  options?: {
    targetSizeMm?: { widthMm: number; depthMm: number; heightMm: number };
    rotationXDeg?: number;
    rotationYDeg?: number;
    mountingType?: MountingType;
    mountingFace?: MountingFace;
    assumeMetersIfSmall?: boolean;
  }
): NormalizedMeshData {
  let workingRoot = root;
  if (options?.mountingType || options?.mountingFace) {
    const mType = options.mountingType ?? 'floor';
    const mFace = options.mountingFace ?? defaultMountingFaceForType(mType);
    workingRoot = root.clone(true);
    applyMountingRotationToObject3D(workingRoot, mType, mFace);
  }
  workingRoot.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(workingRoot);
  const rawSize = new THREE.Vector3();
  const rawCenter = new THREE.Vector3();
  rawBox.getSize(rawSize);
  rawBox.getCenter(rawCenter);

  const maxRaw = Math.max(rawSize.x, rawSize.y, rawSize.z);
  const assumeMeters = options?.assumeMetersIfSmall !== false;
  const unitMult = assumeMeters && maxRaw > 0 && maxRaw <= 30 ? 1000 : 1;

  const naturalW = Math.max(10, rawSize.x * unitMult);
  const naturalH = Math.max(10, rawSize.y * unitMult);
  const naturalD = Math.max(10, rawSize.z * unitMult);

  const targetW = options?.targetSizeMm ? Math.max(10, options.targetSizeMm.widthMm) : naturalW;
  const targetH = options?.targetSizeMm ? Math.max(10, options.targetSizeMm.heightMm) : naturalH;
  const targetD = options?.targetSizeMm ? Math.max(10, options.targetSizeMm.depthMm) : naturalD;

  const sx = targetW / naturalW;
  const sy = targetH / naturalH;
  const sz = targetD / naturalD;

  const rxDeg = options?.rotationXDeg ?? 0;
  const ryDeg = options?.rotationYDeg ?? 0;
  const hasTilt = Math.abs(rxDeg) >= 0.05 || Math.abs(ryDeg) >= 0.05;

  const rawTris: Triangle3D[] = [];
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  let meshCounter = 0;

  const transformVertex = (vx: number, vy: number, vz: number): [number, number, number] => {
    const x0 = (vx - rawCenter.x) * unitMult * sx;
    const y0 = (vy - rawBox.min.y) * unitMult * sy;
    const z0 = (vz - rawCenter.z) * unitMult * sz;
    if (!hasTilt) return [x0, y0, z0];
    // rotateThreeYXZ takes (xPlan, zUp, yPlan) -> returns { x, y (planZ), z (upY) }
    const t = rotateThreeYXZ(x0, y0, z0, rxDeg, ryDeg);
    return [t.x, t.z, t.y];
  };

  workingRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry as THREE.BufferGeometry;
    const pos = geom.getAttribute('position');
    if (!pos) return;
    const index = geom.getIndex();
    const matWorld = mesh.matrixWorld;
    const color = extractMaterialColorHex(mesh.material);
    const meshIndex = meshCounter++;

    const pushTri = (i0: number, i1: number, i2: number) => {
      vA.fromBufferAttribute(pos, i0).applyMatrix4(matWorld);
      vB.fromBufferAttribute(pos, i1).applyMatrix4(matWorld);
      vC.fromBufferAttribute(pos, i2).applyMatrix4(matWorld);
      const [ax, ay, az] = transformVertex(vA.x, vA.y, vA.z);
      const [bx, by, bz] = transformVertex(vB.x, vB.y, vB.z);
      const [cx, cy, cz] = transformVertex(vC.x, vC.y, vC.z);
      rawTris.push({ ax, ay, az, bx, by, bz, cx, cy, cz, color, meshIndex });
    };

    if (index) {
      for (let i = 0; i + 2 < index.count; i += 3) {
        pushTri(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
    } else {
      for (let i = 0; i + 2 < pos.count; i += 3) {
        pushTri(i, i + 1, i + 2);
      }
    }
  });

  if (rawTris.length === 0) {
    return {
      triangles: [],
      boundsMm: {
        widthMm: Math.round(targetW),
        depthMm: Math.round(targetD),
        heightMm: Math.round(targetH),
      },
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const t of rawTris) {
    minX = Math.min(minX, t.ax, t.bx, t.cx);
    maxX = Math.max(maxX, t.ax, t.bx, t.cx);
    minY = Math.min(minY, t.ay, t.by, t.cy);
    maxY = Math.max(maxY, t.ay, t.by, t.cy);
    minZ = Math.min(minZ, t.az, t.bz, t.cz);
    maxZ = Math.max(maxZ, t.az, t.bz, t.cz);
  }

  // Re-center X/Z and ground minY to 0 cleanly after any tilt
  const cxShift = (minX + maxX) / 2;
  const czShift = (minZ + maxZ) / 2;
  const yShift = minY;

  if (Math.abs(cxShift) > 0.01 || Math.abs(czShift) > 0.01 || Math.abs(yShift) > 0.01) {
    for (const t of rawTris) {
      t.ax -= cxShift;
      t.bx -= cxShift;
      t.cx -= cxShift;
      t.az -= czShift;
      t.bz -= czShift;
      t.cz -= czShift;
      t.ay -= yShift;
      t.by -= yShift;
      t.cy -= yShift;
    }
  }

  return {
    triangles: rawTris,
    boundsMm: {
      widthMm: Math.max(10, Math.round(maxX - minX)),
      depthMm: Math.max(10, Math.round(maxZ - minZ)),
      heightMm: Math.max(10, Math.round(maxY - minY)),
    },
  };
}

function roundedRectShapeM(w: number, d: number, r: number): THREE.Shape {
  const hw = w / 2;
  const hd = d / 2;
  const rx = Math.max(0.002, Math.min(r, hw * 0.48, hd * 0.48));
  const s = new THREE.Shape();
  s.moveTo(-hw + rx, -hd);
  s.lineTo(hw - rx, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + rx);
  s.lineTo(hw, hd - rx);
  s.quadraticCurveTo(hw, hd, hw - rx, hd);
  s.lineTo(-hw + rx, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - rx);
  s.lineTo(-hw, -hd + rx);
  s.quadraticCurveTo(-hw, -hd, -hw + rx, -hd);
  return s;
}

function createExtrudeGeometryCentered(shape: THREE.Shape, heightM: number, bevel = false): THREE.BufferGeometry {
  const bev = bevel ? Math.min(heightM * 0.16, 0.014) : 0;
  const useBevel = bev > 0.001 && heightM > bev * 2.4;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: useBevel ? Math.max(0.004, heightM - bev * 2) : heightM,
    bevelEnabled: useBevel,
    bevelThickness: useBevel ? bev : 0,
    bevelSize: useBevel ? bev * 0.75 : 0,
    bevelSegments: useBevel ? 2 : 1,
    curveSegments: 14,
  });
  geo.rotateX(-Math.PI / 2);
  geo.center();
  return geo;
}

function buildGeometryForPart(part: FurniturePart): THREE.BufferGeometry {
  const pw = Math.max(0.01, part.widthMm / 1000);
  const pd = Math.max(0.01, part.depthMm / 1000);
  const ph = Math.max(0.01, part.heightMm / 1000);
  const ds = part.detailStyle;

  if (part.shape === 'cylinder' || part.shape === 'oval') {
    const r = Math.max(0.008, pw / 2);
    const geo = new THREE.CylinderGeometry(r, r, ph, 24);
    if (Math.abs(pd - pw) > 0.002) {
      geo.scale(1, 1, pd / pw);
    }
    return geo;
  }

  if (part.shape === 'sphere') {
    const geo = new THREE.SphereGeometry(0.5, 18, 12);
    geo.scale(pw, ph, pd);
    return geo;
  }

  if (part.shape === 'rounded_rect') {
    const rx = Math.min(pw * 0.22, pd * 0.22, 0.14);
    return createExtrudeGeometryCentered(roundedRectShapeM(pw, pd, rx), ph, !!part.bevel);
  }

  if (part.shape === 'wedge') {
    const s = new THREE.Shape();
    s.moveTo(-pw / 2, -ph / 2);
    s.lineTo(pw / 2, -ph / 2);
    s.lineTo(pw / 2, ph / 2);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: pd, bevelEnabled: false });
    geo.translate(0, 0, -pd / 2);
    return geo;
  }

  if (part.shape === 'l_profile') {
    const armW = Math.min(pw * 0.45, Math.max(0.18, pw * 0.35));
    const armD = Math.min(pd * 0.45, Math.max(0.18, pd * 0.35));
    const s = new THREE.Shape();
    s.moveTo(-pw / 2, -pd / 2);
    s.lineTo(pw / 2, -pd / 2);
    s.lineTo(pw / 2, -pd / 2 + armD);
    s.lineTo(-pw / 2 + armW, -pd / 2 + armD);
    s.lineTo(-pw / 2 + armW, pd / 2);
    s.lineTo(-pw / 2, pd / 2);
    s.closePath();
    return createExtrudeGeometryCentered(s, ph, false);
  }

  if (part.shape === 'u_profile') {
    const armW = Math.min(pw * 0.28, 0.24);
    const backD = Math.min(pd * 0.32, 0.28);
    const s = new THREE.Shape();
    s.moveTo(-pw / 2, -pd / 2);
    s.lineTo(pw / 2, -pd / 2);
    s.lineTo(pw / 2, pd / 2);
    s.lineTo(pw / 2 - armW, pd / 2);
    s.lineTo(pw / 2 - armW, -pd / 2 + backD);
    s.lineTo(-pw / 2 + armW, -pd / 2 + backD);
    s.lineTo(-pw / 2 + armW, pd / 2);
    s.lineTo(-pw / 2, pd / 2);
    s.closePath();
    return createExtrudeGeometryCentered(s, ph, false);
  }

  if (part.shape === 'arc') {
    const outerR = Math.max(0.05, pw / 2);
    const innerR = Math.max(0.02, outerR - Math.min(pw * 0.25, pd * 0.45));
    const s = new THREE.Shape();
    s.absarc(0, 0, outerR, 0, Math.PI, false);
    s.absarc(0, 0, innerR, Math.PI, 0, true);
    s.closePath();
    return createExtrudeGeometryCentered(s, ph, false);
  }

  if (ds === 'cushion' || ds === 'pillow' || ds === 'mattress' || ds === 'blanket') {
    const rad = Math.min(pw * 0.14, pd * 0.14, 0.08);
    return createExtrudeGeometryCentered(roundedRectShapeM(pw, pd, rad), ph, true);
  }

  return new THREE.BoxGeometry(pw, ph, pd);
}

/**
 * Builds a headless Three.js Group from parametric FurnitureParts (safe in Node.js tests & Web browsers)
 * and extracts normalized millimeter-space triangle data.
 */
export function extractNormalizedMeshDataFromParts(
  parts: FurniturePart[],
  options?: { rotationXDeg?: number; rotationYDeg?: number }
): NormalizedMeshData {
  const group = new THREE.Group();
  const bounds = computeFurnitureBoundsMm(parts);
  const cxOffset = (bounds.minX + bounds.maxX) / 2;
  const cyOffset = (bounds.minY + bounds.maxY) / 2;
  const zOffset = bounds.minZ;

  const createdGeos: THREE.BufferGeometry[] = [];
  const createdMats: THREE.Material[] = [];

  for (const part of parts) {
    const geo = buildGeometryForPart(part);
    createdGeos.push(geo);
    const mat = new THREE.MeshBasicMaterial({ color: part.color || '#CBD5E1' });
    createdMats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      (part.xMm - cxOffset) / 1000,
      (part.zMm - zOffset + part.heightMm / 2) / 1000,
      (part.yMm - cyOffset) / 1000
    );
    mesh.rotation.y = (-part.rotationDeg * Math.PI) / 180;
    group.add(mesh);

    // Add recognizable structural detail sub-meshes for caster bases, lamp shades, sinks, etc.
    if (part.detailStyle === 'caster_base') {
      const pw = Math.max(0.05, part.widthMm / 1000);
      const pd = Math.max(0.05, part.depthMm / 1000);
      const ph = Math.max(0.02, part.heightMm / 1000);
      const radius = Math.min(pw, pd) * 0.48;
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        const spokeGeo = new THREE.BoxGeometry(radius, ph * 0.3, 0.028);
        createdGeos.push(spokeGeo);
        const spoke = new THREE.Mesh(spokeGeo, mat);
        spoke.position.set((Math.cos(ang) * radius) / 2, -ph * 0.2, (Math.sin(ang) * radius) / 2);
        spoke.rotation.y = -ang;
        mesh.add(spoke);
      }
    } else if (part.detailStyle === 'lamp_shade') {
      const pw = Math.max(0.05, part.widthMm / 1000);
      const ph = Math.max(0.04, part.heightMm / 1000);
      const coneGeo = new THREE.CylinderGeometry(pw * 0.34, pw * 0.5, ph, 20);
      createdGeos.push(coneGeo);
      mesh.geometry = coneGeo;
    }
  }

  const tiltedBounds = computeFurnitureTiltedLocalBoundsMm(
    parts,
    options?.rotationXDeg ?? 0,
    options?.rotationYDeg ?? 0
  );

  const data = extractNormalizedMeshDataFromObject3D(group, {
    targetSizeMm: {
      widthMm: bounds.widthMm,
      depthMm: bounds.depthMm,
      heightMm: bounds.heightMm,
    },
    rotationXDeg: options?.rotationXDeg ?? 0,
    rotationYDeg: options?.rotationYDeg ?? 0,
    assumeMetersIfSmall: true,
  });

  for (const g of createdGeos) g.dispose();
  for (const m of createdMats) m.dispose();

  if (data.triangles.length === 0) {
    return {
      triangles: [],
      boundsMm: {
        widthMm: Math.round(tiltedBounds.maxX - tiltedBounds.minX),
        depthMm: Math.round(tiltedBounds.maxY - tiltedBounds.minY),
        heightMm: Math.round(tiltedBounds.maxZ - tiltedBounds.minZ),
      },
    };
  }

  return data;
}

function projectTriangleToView(tri: Triangle3D, view: ProjectionViewId, colorIdx: number): ProjectedTri2D {
  switch (view) {
    case 'top':
      return {
        u0: tri.ax, v0: tri.az, d0: tri.ay,
        u1: tri.bx, v1: tri.bz, d1: tri.by,
        u2: tri.cx, v2: tri.cz, d2: tri.cy,
        colorIdx,
      };
    case 'front':
      return {
        u0: tri.ax, v0: -tri.ay, d0: tri.az,
        u1: tri.bx, v1: -tri.by, d1: tri.bz,
        u2: tri.cx, v2: -tri.cy, d2: tri.cz,
        colorIdx,
      };
    case 'rear':
      return {
        u0: -tri.ax, v0: -tri.ay, d0: -tri.az,
        u1: -tri.bx, v1: -tri.by, d1: -tri.bz,
        u2: -tri.cx, v2: -tri.cy, d2: -tri.cz,
        colorIdx,
      };
    case 'left':
      return {
        u0: tri.az, v0: -tri.ay, d0: -tri.ax,
        u1: tri.bz, v1: -tri.by, d1: -tri.bx,
        u2: tri.cz, v2: -tri.cy, d2: -tri.cx,
        colorIdx,
      };
    case 'right':
      return {
        u0: -tri.az, v0: -tri.ay, d0: tri.ax,
        u1: -tri.bz, v1: -tri.by, d1: tri.bx,
        u2: -tri.cz, v2: -tri.cy, d2: tri.cx,
        colorIdx,
      };
  }
}

function getViewBounds(
  boundsMm: { widthMm: number; depthMm: number; heightMm: number },
  view: ProjectionViewId
): { minX: number; minY: number; width: number; height: number } {
  if (view === 'top') {
    return {
      minX: -boundsMm.widthMm / 2,
      minY: -boundsMm.depthMm / 2,
      width: boundsMm.widthMm,
      height: boundsMm.depthMm,
    };
  }
  const elevW = view === 'front' || view === 'rear' ? boundsMm.widthMm : boundsMm.depthMm;
  return {
    minX: -elevW / 2,
    minY: -boundsMm.heightMm,
    width: elevW,
    height: boundsMm.heightMm,
  };
}

interface RasterResult {
  cols: number;
  rows: number;
  cellMm: number;
  originU: number;
  originV: number;
  zBuf: Float32Array;
  colorBuf: Int32Array;
}

function rasterizeProjectedTriangles(
  tris: ProjectedTri2D[],
  viewBox: { minX: number; minY: number; width: number; height: number },
  maxGridRes = 200
): RasterResult {
  const maxSpan = Math.max(10, viewBox.width, viewBox.height);
  const cellMm = maxSpan / maxGridRes;
  const padCells = 2;
  const cols = Math.max(8, Math.ceil(viewBox.width / cellMm) + padCells * 2);
  const rows = Math.max(8, Math.ceil(viewBox.height / cellMm) + padCells * 2);
  const originU = viewBox.minX - padCells * cellMm;
  const originV = viewBox.minY - padCells * cellMm;

  const total = cols * rows;
  const zBuf = new Float32Array(total);
  zBuf.fill(-Infinity);
  const colorBuf = new Int32Array(total);
  colorBuf.fill(-1);

  const sweepEdge = (
    uA: number, vA: number, dA: number,
    uB: number, vB: number, dB: number,
    colorIdx: number
  ) => {
    const pxA = (uA - originU) / cellMm;
    const pyA = (vA - originV) / cellMm;
    const pxB = (uB - originU) / cellMm;
    const pyB = (vB - originV) / cellMm;
    const steps = Math.max(1, Math.ceil(Math.hypot(pxB - pxA, pyB - pyA) * 1.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const c = Math.floor(pxA + (pxB - pxA) * t);
      const r = Math.floor(pyA + (pyB - pyA) * t);
      if (c >= 0 && c < cols && r >= 0 && r < rows) {
        const idx = r * cols + c;
        const d = dA + (dB - dA) * t;
        if (d > zBuf[idx]) {
          zBuf[idx] = d;
          colorBuf[idx] = colorIdx;
        }
      }
    }
  };

  for (const tri of tris) {
    const x0 = (tri.u0 - originU) / cellMm;
    const y0 = (tri.v0 - originV) / cellMm;
    const x1 = (tri.u1 - originU) / cellMm;
    const y1 = (tri.v1 - originV) / cellMm;
    const x2 = (tri.u2 - originU) / cellMm;
    const y2 = (tri.v2 - originV) / cellMm;

    const minC = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxC = Math.min(cols - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minR = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxR = Math.min(rows - 1, Math.ceil(Math.max(y0, y1, y2)));

    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(denom) < 0.25) {
      // Degenerate / edge-on / very thin triangle: sweep its 3 edges so thin chair legs or rims never vanish
      sweepEdge(tri.u0, tri.v0, tri.d0, tri.u1, tri.v1, tri.d1, tri.colorIdx);
      sweepEdge(tri.u1, tri.v1, tri.d1, tri.u2, tri.v2, tri.d2, tri.colorIdx);
      sweepEdge(tri.u2, tri.v2, tri.d2, tri.u0, tri.v0, tri.d0, tri.colorIdx);
      continue;
    }

    const invDenom = 1 / denom;
    for (let r = minR; r <= maxR; r++) {
      const py = r + 0.5;
      for (let c = minC; c <= maxC; c++) {
        const px = c + 0.5;
        const w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) * invDenom;
        const w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) * invDenom;
        const w2 = 1 - w0 - w1;
        if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) {
          const d = w0 * tri.d0 + w1 * tri.d1 + w2 * tri.d2;
          const idx = r * cols + c;
          if (d > zBuf[idx]) {
            zBuf[idx] = d;
            colorBuf[idx] = tri.colorIdx;
          }
        }
      }
    }
  }

  return { cols, rows, cellMm, originU, originV, zBuf, colorBuf };
}

function pointToSegDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdpOpen(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 2) return points;
  let maxDist = -1;
  let maxIdx = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegDist(points[i], start, end);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpOpen(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpOpen(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
}

function simplifyClosedLoop(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 4) return points;
  // Find two farthest points to split closed loop cleanly without endpoint artifacts
  let bestA = 0;
  let bestB = Math.floor(points.length / 2);
  let bestDistSq = -1;
  const step = Math.max(1, Math.floor(points.length / 40));
  for (let i = 0; i < points.length; i += step) {
    for (let j = i + 1; j < points.length; j += step) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 > bestDistSq) {
        bestDistSq = d2;
        bestA = i;
        bestB = j;
      }
    }
  }
  if (bestA > bestB) {
    const tmp = bestA;
    bestA = bestB;
    bestB = tmp;
  }
  const chain1 = points.slice(bestA, bestB + 1);
  const chain2 = [...points.slice(bestB), ...points.slice(0, bestA + 1)];
  const s1 = rdpOpen(chain1, epsilon);
  const s2 = rdpOpen(chain2, epsilon);
  const merged = [...s1.slice(0, -1), ...s2.slice(0, -1)];
  if (merged.length < 3) return points.slice(0, 3);
  return merged;
}

function polygonSignedArea(pts: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

/**
 * Traces all closed outer contours and interior hole loops from a binary occupancy grid
 * using oriented Marching Squares boundary segments and loop chaining.
 */
function traceMaskContours(
  occ: Uint8Array,
  cols: number,
  rows: number,
  originU: number,
  originV: number,
  cellMm: number
): Point2D[][] {
  // Sample points are cell centers: (c + 0.5, r + 0.5).
  // Marching Squares vertices sit at midpoints between adjacent cell centers:
  // Top edge (0): (c + 1, r + 0.5)
  // Right edge (1): (c + 1.5, r + 1)
  // Bottom edge (2): (c + 1, r + 1.5)
  // Left edge (3): (c + 0.5, r + 1)
  const edgeKey = (gx2: number, gy2: number): number => gy2 * (cols * 4 + 4) + gx2;

  const coordFromEdge = (c: number, r: number, e: number): { kx: number; ky: number; pt: Point2D } => {
    // Multiply grid indices by 2 so midpoints are exact integers
    const gx2 = e === 0 || e === 2 ? 2 * c + 2 : e === 1 ? 2 * c + 3 : 2 * c + 1;
    const gy2 = e === 1 || e === 3 ? 2 * r + 2 : e === 0 ? 2 * r + 1 : 2 * r + 3;
    return {
      kx: gx2,
      ky: gy2,
      pt: {
        x: originU + (gx2 * 0.5) * cellMm,
        y: originV + (gy2 * 0.5) * cellMm,
      },
    };
  };

  // Adjacency map from start vertex key -> array of { endKey, endPt, used }
  const segStarts = new Map<number, Array<{ endKey: number; startPt: Point2D; endPt: Point2D; used: boolean }>>();
  const addSeg = (c: number, r: number, eStart: number, eEnd: number) => {
    const a = coordFromEdge(c, r, eStart);
    const b = coordFromEdge(c, r, eEnd);
    const sk = edgeKey(a.kx, a.ky);
    const ek = edgeKey(b.kx, b.ky);
    let list = segStarts.get(sk);
    if (!list) {
      list = [];
      segStarts.set(sk, list);
    }
    list.push({ endKey: ek, startPt: a.pt, endPt: b.pt, used: false });
  };

  const at = (c: number, r: number) => (c >= 0 && c < cols && r >= 0 && r < rows ? occ[r * cols + c] : 0);

  // Standard 16-case Marching Squares table over 2x2 cell corners (TL, TR, BR, BL)
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const tl = at(c, r);
      const tr = at(c + 1, r);
      const br = at(c + 1, r + 1);
      const bl = at(c, r + 1);
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;

      switch (code) {
        case 1: addSeg(c, r, 3, 2); break;
        case 2: addSeg(c, r, 2, 1); break;
        case 3: addSeg(c, r, 3, 1); break;
        case 4: addSeg(c, r, 1, 0); break;
        case 5:
          addSeg(c, r, 3, 0);
          addSeg(c, r, 1, 2);
          break;
        case 6: addSeg(c, r, 2, 0); break;
        case 7: addSeg(c, r, 3, 0); break;
        case 8: addSeg(c, r, 0, 3); break;
        case 9: addSeg(c, r, 0, 2); break;
        case 10:
          addSeg(c, r, 0, 1);
          addSeg(c, r, 2, 3);
          break;
        case 11: addSeg(c, r, 0, 1); break;
        case 12: addSeg(c, r, 1, 3); break;
        case 13: addSeg(c, r, 1, 2); break;
        case 14: addSeg(c, r, 2, 3); break;
      }
    }
  }

  const loops: Point2D[][] = [];
  for (const [startKey, list] of segStarts.entries()) {
    for (const seg of list) {
      if (seg.used) continue;
      seg.used = true;
      const loop: Point2D[] = [seg.startPt];
      let curKey = seg.endKey;
      let guard = 0;
      while (curKey !== startKey && guard < 100000) {
        guard++;
        const nextList = segStarts.get(curKey);
        if (!nextList) break;
        const nextSeg = nextList.find((s) => !s.used);
        if (!nextSeg) break;
        nextSeg.used = true;
        loop.push(nextSeg.startPt);
        curKey = nextSeg.endKey;
      }
      if (curKey === startKey && loop.length >= 3) {
        loops.push(loop);
      }
    }
  }

  return loops;
}

function loopsToSvgPathD(loops: Point2D[][]): string {
  return loops
    .filter((pts) => pts.length >= 3)
    .map((pts) => {
      const head = `M ${round1(pts[0].x)} ${round1(pts[0].y)}`;
      const rest = pts
        .slice(1)
        .map((p) => `L ${round1(p.x)} ${round1(p.y)}`)
        .join(' ');
      return `${head} ${rest} Z`;
    })
    .join(' ');
}

function extractHiddenLineEdges(
  triangles: Triangle3D[],
  view: ProjectionViewId,
  raster: RasterResult
): SvgPathElementData[] {
  // Weld vertices within 0.5mm per meshIndex so coplanar/smooth internal mesh edges are detected accurately
  const weldScale = 2; // 0.5mm precision
  const vKey = (meshIndex: number, x: number, y: number, z: number) =>
    `${meshIndex}:${Math.round(x * weldScale)},${Math.round(y * weldScale)},${Math.round(z * weldScale)}`;

  interface AdjEdge {
    ax: number; ay: number; az: number;
    bx: number; by: number; bz: number;
    normals: Array<{ nx: number; ny: number; nz: number; viewDot: number }>;
  }

  const viewDir: [number, number, number] =
    view === 'top'
      ? [0, 1, 0]
      : view === 'front'
        ? [0, 0, 1]
        : view === 'rear'
          ? [0, 0, -1]
          : view === 'left'
            ? [-1, 0, 0]
            : [1, 0, 0];

  const edgeMap = new Map<string, AdjEdge>();

  for (const t of triangles) {
    const ux = t.bx - t.ax;
    const uy = t.by - t.ay;
    const uz = t.bz - t.az;
    const vx = t.cx - t.ax;
    const vy = t.cy - t.ay;
    const vz = t.cz - t.az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-4) continue;
    const unx = nx / len;
    const uny = ny / len;
    const unz = nz / len;
    const viewDot = unx * viewDir[0] + uny * viewDir[1] + unz * viewDir[2];

    const ka = vKey(t.meshIndex, t.ax, t.ay, t.az);
    const kb = vKey(t.meshIndex, t.bx, t.by, t.bz);
    const kc = vKey(t.meshIndex, t.cx, t.cy, t.cz);

    const verts: Array<[string, number, number, number]> = [
      [ka, t.ax, t.ay, t.az],
      [kb, t.bx, t.by, t.bz],
      [kc, t.cx, t.cy, t.cz],
    ];

    for (let i = 0; i < 3; i++) {
      const p0 = verts[i];
      const p1 = verts[(i + 1) % 3];
      if (p0[0] === p1[0]) continue;
      const eKey = p0[0] < p1[0] ? `${p0[0]}|${p1[0]}` : `${p1[0]}|${p0[0]}`;
      let entry = edgeMap.get(eKey);
      if (!entry) {
        entry = {
          ax: p0[1], ay: p0[2], az: p0[3],
          bx: p1[1], by: p1[2], bz: p1[3],
          normals: [],
        };
        edgeMap.set(eKey, entry);
      }
      entry.normals.push({ nx: unx, ny: uny, nz: unz, viewDot });
    }
  }

  const projectPt = (x: number, y: number, z: number): [number, number, number] => {
    switch (view) {
      case 'top': return [x, z, y];
      case 'front': return [x, -y, z];
      case 'rear': return [-x, -y, -z];
      case 'left': return [z, -y, -x];
      case 'right': return [-z, -y, x];
    }
  };

  // Sharp crease threshold (~28 deg) eliminates coplanar diagonals & smooth tessellation triangles
  const creaseDotThreshold = Math.cos((28 * Math.PI) / 180);
  const candidateEdges: Edge3D[] = [];

  for (const e of edgeMap.values()) {
    const ns = e.normals;
    let keep = false;
    if (ns.length === 1) {
      keep = ns[0].viewDot > -0.05;
    } else {
      let minDot = 1;
      let hasFront = false;
      let hasBack = false;
      for (let i = 0; i < ns.length; i++) {
        if (ns[i].viewDot >= -0.02) hasFront = true;
        if (ns[i].viewDot <= 0.02) hasBack = true;
        for (let j = i + 1; j < ns.length; j++) {
          const d = ns[i].nx * ns[j].nx + ns[i].ny * ns[j].ny + ns[i].nz * ns[j].nz;
          if (d < minDot) minDot = d;
        }
      }
      // Keep sharp structural creases (when at least one side faces camera) or inflection creases
      if (hasFront && (minDot < creaseDotThreshold || (hasBack && minDot < 0.992))) {
        keep = true;
      }
    }

    if (!keep) continue;
    const [u0, v0, d0] = projectPt(e.ax, e.ay, e.az);
    const [u1, v1, d1] = projectPt(e.bx, e.by, e.bz);
    if (Math.hypot(u1 - u0, v1 - v0) < 4) continue;
    candidateEdges.push({ u0, v0, d0, u1, v1, d1 });
  }

  // Visibility test against Z-buffer: extract visible runs along each structural edge
  const { cols, rows, cellMm, originU, originV, zBuf } = raster;
  const depthBias = Math.max(4, cellMm * 1.4);
  const visibleSegments: Array<{ a: Point2D; b: Point2D }> = [];

  const isVisibleAt = (u: number, v: number, d: number): boolean => {
    const c = Math.floor((u - originU) / cellMm);
    const r = Math.floor((v - originV) / cellMm);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return true;
    // Check 3x3 min depth? No — check local cell depth directly (and adjacent cell if edge lies on boundary)
    const bufD = zBuf[r * cols + c];
    if (!Number.isFinite(bufD)) return true;
    if (d + depthBias >= bufD) return true;
    // Slight sub-cell tolerance for grazing silhouette creases
    let minNeighbor = bufD;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= rows) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        if (cc < 0 || cc >= cols) continue;
        const nd = zBuf[rr * cols + cc];
        if (!Number.isFinite(nd)) return true;
        if (nd < minNeighbor) minNeighbor = nd;
      }
    }
    return d + depthBias * 0.75 >= minNeighbor;
  };

  for (const seg of candidateEdges) {
    const len2d = Math.hypot(seg.u1 - seg.u0, seg.v1 - seg.v0);
    const samples = Math.max(2, Math.min(36, Math.ceil(len2d / Math.max(2, cellMm * 0.9))));
    let runStartT: number | null = null;

    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const u = seg.u0 + (seg.u1 - seg.u0) * t;
      const v = seg.v0 + (seg.v1 - seg.v0) * t;
      const d = seg.d0 + (seg.d1 - seg.d0) * t;
      const vis = isVisibleAt(u, v, d);

      if (vis && runStartT === null) {
        runStartT = t;
      } else if (!vis && runStartT !== null) {
        const prevT = Math.max(runStartT, (s - 1) / samples);
        const ax = seg.u0 + (seg.u1 - seg.u0) * runStartT;
        const ay = seg.v0 + (seg.v1 - seg.v0) * runStartT;
        const bx = seg.u0 + (seg.u1 - seg.u0) * prevT;
        const by = seg.v0 + (seg.v1 - seg.v0) * prevT;
        if (Math.hypot(bx - ax, by - ay) >= 5) {
          visibleSegments.push({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
        }
        runStartT = null;
      }
    }

    if (runStartT !== null) {
      const ax = seg.u0 + (seg.u1 - seg.u0) * runStartT;
      const ay = seg.v0 + (seg.v1 - seg.v0) * runStartT;
      const bx = seg.u1;
      const by = seg.v1;
      if (Math.hypot(bx - ax, by - ay) >= 5) {
        visibleSegments.push({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
      }
    }
  }

  // Deduplicate overlapping 2D segments
  const deduped: Array<{ a: Point2D; b: Point2D }> = [];
  const segHashSet = new Set<string>();
  const q = (v: number) => Math.round(v / 2);
  for (const s of visibleSegments) {
    const k1 = `${q(s.a.x)},${q(s.a.y)}-${q(s.b.x)},${q(s.b.y)}`;
    const k2 = `${q(s.b.x)},${q(s.b.y)}-${q(s.a.x)},${q(s.a.y)}`;
    if (segHashSet.has(k1) || segHashSet.has(k2)) continue;
    segHashSet.add(k1);
    deduped.push(s);
  }

  // Chain connected segments into continuous polylines to keep SVG paths compact & clean
  const ptKey = (p: Point2D) => `${q(p.x)},${q(p.y)}`;
  const adj = new Map<string, number[]>();
  for (let i = 0; i < deduped.length; i++) {
    const ka = ptKey(deduped[i].a);
    const kb = ptKey(deduped[i].b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push(i);
    adj.get(kb)!.push(i);
  }

  const used = new Uint8Array(deduped.length);
  const chains: Point2D[][] = [];

  for (let i = 0; i < deduped.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const chain: Point2D[] = [deduped[i].a, deduped[i].b];

    // Extend forward
    while (true) {
      const tail = chain[chain.length - 1];
      const candidates = adj.get(ptKey(tail));
      if (!candidates) break;
      let found = -1;
      for (const idx of candidates) {
        if (!used[idx]) {
          found = idx;
          break;
        }
      }
      if (found === -1) break;
      used[found] = 1;
      const seg = deduped[found];
      const nextPt = ptKey(seg.a) === ptKey(tail) ? seg.b : seg.a;
      chain.push(nextPt);
    }

    // Extend backward
    while (true) {
      const head = chain[0];
      const candidates = adj.get(ptKey(head));
      if (!candidates) break;
      let found = -1;
      for (const idx of candidates) {
        if (!used[idx]) {
          found = idx;
          break;
        }
      }
      if (found === -1) break;
      used[found] = 1;
      const seg = deduped[found];
      const prevPt = ptKey(seg.a) === ptKey(head) ? seg.b : seg.a;
      chain.unshift(prevPt);
    }

    chains.push(rdpOpen(chain, 1.5));
  }

  if (chains.length === 0) return [];

  // Batch into a single crisp structural crease path (or individual paths up to 40)
  const pathD = chains
    .map((pts) => {
      const head = `M ${round1(pts[0].x)} ${round1(pts[0].y)}`;
      const rest = pts
        .slice(1)
        .map((p) => `L ${round1(p.x)} ${round1(p.y)}`)
        .join(' ');
      return `${head} ${rest}`;
    })
    .join(' ');

  return [
    {
      id: `crease_${view}`,
      kind: 'path',
      name: 'Structural Details',
      d: pathD,
      stroke: DEFAULT_STROKE_COLOR,
      strokeWidthMm: Math.round(DEFAULT_STROKE_MM * 0.72),
      fill: 'none',
      fillOpacity: 0,
      visible: true,
    },
  ];
}

function buildFallbackBoxView(
  view: ProjectionViewId,
  viewBox: { minX: number; minY: number; width: number; height: number }
): ProjectedViewSvg {
  const x0 = round1(viewBox.minX);
  const y0 = round1(viewBox.minY);
  const x1 = round1(viewBox.minX + viewBox.width);
  const y1 = round1(viewBox.minY + viewBox.height);
  return {
    view,
    viewBox,
    baseWidthMm: Math.max(10, Math.round(viewBox.width)),
    baseHeightMm: Math.max(10, Math.round(viewBox.height)),
    elements: [
      {
        id: `sil_${view}`,
        kind: 'path',
        name: 'Fallback Silhouette',
        d: `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`,
        stroke: DEFAULT_STROKE_COLOR,
        strokeWidthMm: DEFAULT_STROKE_MM,
        fill: DEFAULT_FILL_COLOR,
        fillOpacity: 1,
        fillRule: 'evenodd',
        visible: true,
      },
    ],
  };
}

/**
 * Generates clean orthographic SVG projections for a single view from normalized 3D mesh data.
 */
export function generateProjectedViewFromMeshData(
  meshData: NormalizedMeshData,
  view: ProjectionViewId,
  mode: RepresentationMode = 'silhouette',
  strokeWidthMm = DEFAULT_STROKE_MM
): ProjectedViewSvg {
  const viewBox = getViewBounds(meshData.boundsMm, view);
  if (meshData.triangles.length === 0) {
    return buildFallbackBoxView(view, viewBox);
  }

  // Group colors for optional Material Fill mode
  const palette: string[] = [];
  const colorToIdx = new Map<string, number>();
  const projectedTris: ProjectedTri2D[] = new Array(meshData.triangles.length);

  for (let i = 0; i < meshData.triangles.length; i++) {
    const t = meshData.triangles[i];
    let cIdx = colorToIdx.get(t.color);
    if (cIdx === undefined) {
      cIdx = palette.length;
      palette.push(t.color);
      colorToIdx.set(t.color, cIdx);
    }
    projectedTris[i] = projectTriangleToView(t, view, cIdx);
  }

  const raster = rasterizeProjectedTriangles(projectedTris, viewBox, 200);
  const totalCells = raster.cols * raster.rows;
  const occ = new Uint8Array(totalCells);
  let activeCount = 0;
  for (let i = 0; i < totalCells; i++) {
    if (Number.isFinite(raster.zBuf[i])) {
      occ[i] = 1;
      activeCount++;
    }
  }

  if (activeCount === 0) {
    return buildFallbackBoxView(view, viewBox);
  }

  const rawLoops = traceMaskContours(occ, raster.cols, raster.rows, raster.originU, raster.originV, raster.cellMm);
  const minAreaMm2 = Math.max(16, raster.cellMm * raster.cellMm * 1.4);
  const rdpEps = Math.max(1.5, raster.cellMm * 1.15);

  const simplifiedLoops = rawLoops
    .filter((pts) => Math.abs(polygonSignedArea(pts)) >= minAreaMm2)
    .map((pts) => simplifyClosedLoop(pts, rdpEps));

  if (simplifiedLoops.length === 0) {
    return buildFallbackBoxView(view, viewBox);
  }

  const silhouetteD = loopsToSvgPathD(simplifiedLoops);
  const elements: SvgVectorElement[] = [
    {
      id: `sil_${view}`,
      kind: 'path',
      name: 'Exterior Silhouette',
      d: silhouetteD,
      stroke: DEFAULT_STROKE_COLOR,
      strokeWidthMm,
      fill: DEFAULT_FILL_COLOR,
      fillOpacity: 1,
      fillRule: 'evenodd',
      visible: true,
    },
  ];

  // Hidden-line mode adds visible structural crease & boundary details with occluded lines culled
  if (mode === 'hidden_line') {
    const creasePaths = extractHiddenLineEdges(meshData.triangles, view, raster);
    for (const cp of creasePaths) {
      elements.push({
        ...cp,
        strokeWidthMm: Math.max(4, Math.round(strokeWidthMm * 0.72)),
      });
    }
  }

  // Extract optional per-color visible fill regions for Material Fill mode
  const fillElements: SvgVectorElement[] = [];
  for (let cIdx = 0; cIdx < palette.length; cIdx++) {
    const colorMask = new Uint8Array(totalCells);
    let colorCells = 0;
    for (let i = 0; i < totalCells; i++) {
      if (raster.colorBuf[i] === cIdx) {
        colorMask[i] = 1;
        colorCells++;
      }
    }
    if (colorCells === 0) continue;
    const cLoops = traceMaskContours(
      colorMask,
      raster.cols,
      raster.rows,
      raster.originU,
      raster.originV,
      raster.cellMm
    )
      .filter((pts) => Math.abs(polygonSignedArea(pts)) >= minAreaMm2)
      .map((pts) => simplifyClosedLoop(pts, rdpEps));

    if (cLoops.length === 0) continue;
    fillElements.push({
      id: `fill_${view}_${cIdx}`,
      kind: 'path',
      name: `Material Region ${cIdx + 1}`,
      d: loopsToSvgPathD(cLoops),
      stroke: 'none',
      strokeWidthMm: 0,
      fill: palette[cIdx],
      fillOpacity: 0.96,
      fillRule: 'evenodd',
      visible: true,
    });
  }

  return {
    view,
    viewBox,
    baseWidthMm: Math.max(10, Math.round(viewBox.width)),
    baseHeightMm: Math.max(10, Math.round(viewBox.height)),
    elements,
    fillElements,
  };
}

/**
 * Generates all 5 canonical orthographic SVG projections (Top, Front, Rear, Left, Right)
 * from a normalized 3D mesh dataset.
 */
export function generateAllFiveProjectionsFromMeshData(
  meshData: NormalizedMeshData,
  mode: RepresentationMode = 'silhouette',
  strokeWidthMm = DEFAULT_STROKE_MM
): Record<ProjectionViewId, ProjectedViewSvg> {
  return {
    top: generateProjectedViewFromMeshData(meshData, 'top', mode, strokeWidthMm),
    front: generateProjectedViewFromMeshData(meshData, 'front', mode, strokeWidthMm),
    rear: generateProjectedViewFromMeshData(meshData, 'rear', mode, strokeWidthMm),
    left: generateProjectedViewFromMeshData(meshData, 'left', mode, strokeWidthMm),
    right: generateProjectedViewFromMeshData(meshData, 'right', mode, strokeWidthMm),
  };
}

/**
 * Computes a deterministic geometry signature so representations only regenerate
 * when underlying 3D geometry, metric scale, 3D tilt, or drawing style actually changes.
 * (2D xMm/yMm position, 2D plan yaw rotationDeg, mirrors, and labels do NOT invalidate cache.)
 */
export function computeFurnitureGeometrySignature(
  furn: Pick<
    FurnitureInstance,
    'glbAssetId' | 'glbDataUrl' | 'parts' | 'rotationXDeg' | 'rotationYDeg'
  > &
    Partial<Pick<FurnitureInstance, 'mountingType' | 'mountingFace'>>,
  mode: RepresentationMode = 'silhouette'
): string {
  const bounds = computeFurnitureBoundsMm(furn.parts);
  const rx = Math.round((furn.rotationXDeg ?? 0) * 100);
  const ry = Math.round((furn.rotationYDeg ?? 0) * 100);

  if (furn.glbAssetId || furn.glbDataUrl) {
    const assetKey = furn.glbAssetId || fastHashString(furn.glbDataUrl || '');
    const mType = furn.mountingType ?? 'floor';
    const mFace = furn.mountingFace ?? defaultMountingFaceForType(mType);
    return `glb|${assetKey}|${Math.round(bounds.widthMm)}x${Math.round(bounds.depthMm)}x${Math.round(bounds.heightMm)}|rx${rx}|ry${ry}|mt:${mType}|mf:${mFace}|${mode}`;
  }

  const partSig = furn.parts
    .map(
      (p) =>
        `${p.shape}:${p.detailStyle ?? ''}:${Math.round(p.xMm)},${Math.round(p.yMm)},${Math.round(p.zMm)}:${Math.round(p.widthMm)}x${Math.round(p.depthMm)}x${Math.round(p.heightMm)}:${Math.round(p.rotationDeg)}:${p.bevel ? 1 : 0}:${p.svgPath ?? ''}`
    )
    .join(';');
  return `parts|${fastHashString(partSig)}|rx${rx}|ry${ry}|${mode}`;
}

/**
 * Synchronously generates a complete FurnitureRepresentation for parametric/native furniture parts.
 */
export function generateRepresentationFromParts(
  parts: FurniturePart[],
  options?: {
    mode?: RepresentationMode;
    useMaterialFill?: boolean;
    strokeWidthMm?: number;
    rotationXDeg?: number;
    rotationYDeg?: number;
    existingDefaultViews?: Partial<Record<ProjectionViewId, ProjectedViewSvg>>;
    existingCustomViews?: Partial<Record<ProjectionViewId, SvgVectorElement[]>>;
    existingCustomViewUpdatedAt?: Partial<Record<ProjectionViewId, string>>;
  }
): FurnitureRepresentation {
  const mode = options?.mode ?? 'silhouette';
  const projectionMode: RepresentationMode = mode === 'default' ? 'silhouette' : mode;
  const strokeWidthMm = options?.strokeWidthMm ?? DEFAULT_STROKE_MM;
  const meshData = extractNormalizedMeshDataFromParts(parts, {
    rotationXDeg: options?.rotationXDeg,
    rotationYDeg: options?.rotationYDeg,
  });
  const autoViews = generateAllFiveProjectionsFromMeshData(meshData, projectionMode, strokeWidthMm);
  const geometrySignature = computeFurnitureGeometrySignature(
    {
      parts,
      rotationXDeg: options?.rotationXDeg,
      rotationYDeg: options?.rotationYDeg,
    },
    projectionMode
  );

  return {
    mode,
    useMaterialFill: options?.useMaterialFill ?? false,
    strokeWidthMm,
    geometrySignature,
    sourceBoundsMm: meshData.boundsMm,
    defaultViews: options?.existingDefaultViews,
    autoViews,
    customViews: options?.existingCustomViews,
    customViewUpdatedAt: options?.existingCustomViewUpdatedAt,
  };
}

/**
 * Generates a complete FurnitureRepresentation directly from a loaded Three.js Object3D (e.g. GLTFLoader scene).
 */
export function generateRepresentationFromObject3D(
  root: THREE.Object3D,
  options: {
    glbAssetId?: string;
    glbDataUrl?: string;
    partsForBounds: FurniturePart[];
    mode?: RepresentationMode;
    useMaterialFill?: boolean;
    strokeWidthMm?: number;
    rotationXDeg?: number;
    rotationYDeg?: number;
    mountingType?: MountingType;
    mountingFace?: MountingFace;
    existingDefaultViews?: Partial<Record<ProjectionViewId, ProjectedViewSvg>>;
    existingCustomViews?: Partial<Record<ProjectionViewId, SvgVectorElement[]>>;
    existingCustomViewUpdatedAt?: Partial<Record<ProjectionViewId, string>>;
  }
): FurnitureRepresentation {
  const mode = options.mode ?? 'silhouette';
  const projectionMode: RepresentationMode = mode === 'default' ? 'silhouette' : mode;
  const strokeWidthMm = options.strokeWidthMm ?? DEFAULT_STROKE_MM;
  const bounds = computeFurnitureBoundsMm(options.partsForBounds);
  const meshData = extractNormalizedMeshDataFromObject3D(root, {
    targetSizeMm: {
      widthMm: bounds.widthMm,
      depthMm: bounds.depthMm,
      heightMm: bounds.heightMm,
    },
    rotationXDeg: options.rotationXDeg,
    rotationYDeg: options.rotationYDeg,
    mountingType: options.mountingType,
    mountingFace: options.mountingFace,
    assumeMetersIfSmall: true,
  });
  const autoViews = generateAllFiveProjectionsFromMeshData(meshData, projectionMode, strokeWidthMm);
  const geometrySignature = computeFurnitureGeometrySignature(
    {
      glbAssetId: options.glbAssetId,
      glbDataUrl: options.glbDataUrl,
      parts: options.partsForBounds,
      rotationXDeg: options.rotationXDeg,
      rotationYDeg: options.rotationYDeg,
      mountingType: options.mountingType,
      mountingFace: options.mountingFace,
    },
    projectionMode
  );

  return {
    mode,
    useMaterialFill: options.useMaterialFill ?? false,
    strokeWidthMm,
    geometrySignature,
    sourceBoundsMm: meshData.boundsMm,
    defaultViews: options.existingDefaultViews,
    autoViews,
    customViews: options.existingCustomViews,
    customViewUpdatedAt: options.existingCustomViewUpdatedAt,
  };
}
