import * as THREE from 'three';
import type {
  FurnitureInstance,
  FurniturePart,
  MountingFace,
  MountingType,
} from '../types/plan';

export const ALL_MOUNTING_TYPES: MountingType[] = [
  'floor',
  'wall',
  'ceiling',
  'freestanding',
  'surface',
];

export const ALL_MOUNTING_FACES: MountingFace[] = [
  'bottom',
  'back',
  'front',
  'left',
  'right',
  'top',
];

export const MOUNTING_TYPE_LABELS: Record<MountingType, string> = {
  floor: 'Floor',
  wall: 'Wall',
  ceiling: 'Ceiling',
  freestanding: 'Freestanding',
  surface: 'Surface',
};

export const MOUNTING_FACE_LABELS: Record<MountingFace, string> = {
  bottom: 'Bottom (-Y)',
  back: 'Back (-Z)',
  front: 'Front (+Z)',
  left: 'Left (-X)',
  right: 'Right (+X)',
  top: 'Top (+Y)',
};

function computePartsRawBounds(parts: FurniturePart[]): {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  minZ: number;
  maxZ: number;
} {
  if (!parts || parts.length === 0) {
    return { widthMm: 600, depthMm: 600, heightMm: 750, minZ: 0, maxZ: 750 };
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
    const hw = (p.widthMm * cos + p.depthMm * sin) / 2;
    const hd = (p.widthMm * sin + p.depthMm * cos) / 2;
    minX = Math.min(minX, p.xMm - hw);
    maxX = Math.max(maxX, p.xMm + hw);
    minY = Math.min(minY, p.yMm - hd);
    maxY = Math.max(maxY, p.yMm + hd);
    minZ = Math.min(minZ, p.zMm);
    maxZ = Math.max(maxZ, p.zMm + p.heightMm);
  }
  return {
    widthMm: Math.max(20, maxX - minX),
    depthMm: Math.max(20, maxY - minY),
    heightMm: Math.max(10, maxZ - minZ),
    minZ,
    maxZ,
  };
}

function isLegacyCeilingTemplate(
  f: Pick<FurnitureInstance, 'templateId' | 'category' | 'parts'>
): boolean {
  const tid = f.templateId || '';
  if (
    tid.startsWith('light_pendant') ||
    tid.startsWith('light_ceiling') ||
    tid.startsWith('light_chandelier')
  ) {
    return true;
  }
  if (
    f.category === 'Lighting' &&
    !tid.startsWith('light_sconce') &&
    !tid.startsWith('light_floor') &&
    !tid.startsWith('light_table')
  ) {
    const b = computePartsRawBounds(f.parts);
    return b.minZ >= 1800 && b.maxZ >= 2400;
  }
  return false;
}

function isLegacyTabletopTemplate(
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

function isLegacyWallTemplate(
  f: Pick<FurnitureInstance, 'templateId' | 'parts'> &
    Partial<Pick<FurnitureInstance, 'elevationMm' | 'surfaceHostId'>>
): boolean {
  const tid = f.templateId || '';
  if (
    tid.startsWith('tv_wall_') ||
    f.parts.some((p) => p.detailStyle === 'wall_tv') ||
    (tid === 'tv_screen_stand' && !f.surfaceHostId && (f.elevationMm ?? 0) >= 850)
  ) {
    return true;
  }
  if (
    tid === 'kitchen_wall_cabinet' ||
    tid.startsWith('kitchen_hood') ||
    tid === 'kitchen_oven_microwave_wall' ||
    tid === 'bed_shelf_floating' ||
    tid === 'tv_unit_floating' ||
    tid === 'light_sconce' ||
    tid === 'wall_art' ||
    tid === 'decor_gallery_triptych' ||
    tid === 'mirror_oval' ||
    tid === 'mirror_round_wall' ||
    tid === 'bath_towel_warmer' ||
    tid === 'radiator_panel' ||
    tid === 'ac_european_indoor' ||
    tid === 'ac_european_outdoor' ||
    tid.startsWith('curtain_') ||
    tid.startsWith('blinds_') ||
    f.parts.some(
      (p) =>
        p.detailStyle === 'ac_indoor' ||
        p.detailStyle === 'curtain_pleat' ||
        p.detailStyle === 'blinds_slats' ||
        p.detailStyle === 'roller_blind'
    )
  ) {
    return true;
  }
  return false;
}

function isLegacyFreestandingTemplate(
  f: Pick<FurnitureInstance, 'templateId' | 'category' | 'parts'>
): boolean {
  const tid = f.templateId || '';
  if (
    tid.startsWith('rug_') ||
    f.parts.some((p) => p.detailStyle === 'rug') ||
    f.category === 'Sofas & Seating' ||
    f.category === 'Tables & Desks' ||
    tid.startsWith('light_floor') ||
    (tid.startsWith('plant_') && tid !== 'plant_table_succulent') ||
    tid === 'decor_coat_stand' ||
    f.category === 'Outdoor'
  ) {
    return tid !== 'ac_european_outdoor';
  }
  return false;
}

/**
 * Resolves the authoritative MountingType for any furniture object, falling back
 * deterministically from template metadata if `mountingType` has not yet been stamped.
 */
export function resolveFurnitureMountingType(
  f: Pick<FurnitureInstance, 'templateId' | 'category' | 'parts'> &
    Partial<Pick<FurnitureInstance, 'elevationMm' | 'surfaceHostId' | 'mountingType' | 'attachedWallId'>>
): MountingType {
  if (f.mountingType) return f.mountingType;
  if (f.attachedWallId) return 'wall';
  if (isLegacyCeilingTemplate(f)) return 'ceiling';
  if (isLegacyWallTemplate(f)) return 'wall';
  if (f.surfaceHostId || isLegacyTabletopTemplate(f)) return 'surface';
  if (isLegacyFreestandingTemplate(f)) return 'freestanding';
  return 'floor';
}

export function defaultMountingFaceForType(mountingType: MountingType): MountingFace {
  if (mountingType === 'ceiling') return 'top';
  if (mountingType === 'wall') return 'back';
  return 'bottom';
}

export function resolveFurnitureMountingFace(
  f: Pick<FurnitureInstance, 'templateId' | 'category' | 'parts'> &
    Partial<
      Pick<
        FurnitureInstance,
        'elevationMm' | 'surfaceHostId' | 'mountingType' | 'mountingFace' | 'attachedWallId'
      >
    >
): MountingFace {
  if (f.mountingFace) return f.mountingFace;
  return defaultMountingFaceForType(resolveFurnitureMountingType(f));
}

/**
 * Returns the XYZ Euler angles (radians) that map a raw GLB model's specified `mountingFace`
 * onto the canonical Plan Studio attachment target for `mountingType`:
 * - floor / freestanding / surface -> `-Y` (bottom rests at Y = 0)
 * - ceiling -> `+Y` (top mounts against ceiling)
 * - wall -> `-Z` (back mounts flush against wall, front faces `+Z`)
 */
export function getMountingRotationEulerRad(
  mountingType: MountingType,
  mountingFace: MountingFace
): [number, number, number] {
  const halfPi = Math.PI / 2;

  if (mountingType === 'ceiling') {
    switch (mountingFace) {
      case 'top':
        return [0, 0, 0];
      case 'bottom':
        return [Math.PI, 0, 0];
      case 'back':
        return [halfPi, 0, 0];
      case 'front':
        return [-halfPi, 0, 0];
      case 'left':
        return [0, 0, -halfPi];
      case 'right':
        return [0, 0, halfPi];
    }
  }

  if (mountingType === 'wall') {
    switch (mountingFace) {
      case 'back':
        return [0, 0, 0];
      case 'front':
        return [0, Math.PI, 0];
      case 'left':
        return [0, -halfPi, 0];
      case 'right':
        return [0, halfPi, 0];
      case 'bottom':
        return [halfPi, 0, 0];
      case 'top':
        return [-halfPi, 0, 0];
    }
  }

  // floor, freestanding, surface -> target face is bottom (-Y)
  switch (mountingFace) {
    case 'bottom':
      return [0, 0, 0];
    case 'top':
      return [Math.PI, 0, 0];
    case 'back':
      return [-halfPi, 0, 0];
    case 'front':
      return [halfPi, 0, 0];
    case 'left':
      return [0, 0, halfPi];
    case 'right':
      return [0, 0, -halfPi];
  }
}

export function getMountingRotationQuaternion(
  mountingType: MountingType,
  mountingFace: MountingFace
): THREE.Quaternion {
  const [rx, ry, rz] = getMountingRotationEulerRad(mountingType, mountingFace);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
}

function applyAbsQuaternionToExtents(
  x: number,
  y: number,
  z: number,
  q: THREE.Quaternion
): { x: number; y: number; z: number } {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const e = m.elements;
  const nx = Math.abs(e[0]) * x + Math.abs(e[4]) * y + Math.abs(e[8]) * z;
  const ny = Math.abs(e[1]) * x + Math.abs(e[5]) * y + Math.abs(e[9]) * z;
  const nz = Math.abs(e[2]) * x + Math.abs(e[6]) * y + Math.abs(e[10]) * z;
  return { x: nx, y: ny, z: nz };
}

/**
 * Maps raw GLB bounds `(widthMm=X, depthMm=Z, heightMm=Y)` into post-mounting bounds.
 */
export function rotateBoundsForMounting(
  rawBounds: { widthMm: number; depthMm: number; heightMm: number },
  mountingType: MountingType,
  mountingFace: MountingFace
): { widthMm: number; depthMm: number; heightMm: number } {
  const q = getMountingRotationQuaternion(mountingType, mountingFace);
  const out = applyAbsQuaternionToExtents(
    rawBounds.widthMm,
    rawBounds.heightMm,
    rawBounds.depthMm,
    q
  );
  return {
    widthMm: Math.max(20, Math.round(out.x)),
    depthMm: Math.max(20, Math.round(out.z)),
    heightMm: Math.max(10, Math.round(out.y)),
  };
}

/**
 * Converts existing oriented dimensions from `(prevType, prevFace)` into `(nextType, nextFace)`
 * without losing metric proportions when switching mounting face or type.
 */
export function transformBoundsBetweenMountings(
  curBounds: { widthMm: number; depthMm: number; heightMm: number },
  prevType: MountingType,
  prevFace: MountingFace,
  nextType: MountingType,
  nextFace: MountingFace
): { widthMm: number; depthMm: number; heightMm: number } {
  const qPrevInv = getMountingRotationQuaternion(prevType, prevFace).invert();
  const raw = applyAbsQuaternionToExtents(
    curBounds.widthMm,
    curBounds.heightMm,
    curBounds.depthMm,
    qPrevInv
  );
  return rotateBoundsForMounting(
    { widthMm: raw.x, depthMm: raw.z, heightMm: raw.y },
    nextType,
    nextFace
  );
}

/**
 * Wraps the children of a Three.js Object3D in a clean local pivot bearing the mounting orientation
 * quaternion so original mesh buffers and cached scenes stay intact while axes align to Plan Studio.
 */
export function applyMountingRotationToObject3D(
  model: THREE.Object3D,
  mountingType: MountingType,
  mountingFace: MountingFace
): void {
  const [rx, ry, rz] = getMountingRotationEulerRad(mountingType, mountingFace);
  if (Math.abs(rx) < 1e-5 && Math.abs(ry) < 1e-5 && Math.abs(rz) < 1e-5) {
    return;
  }
  const inner = new THREE.Group();
  inner.position.copy(model.position);
  inner.quaternion.copy(model.quaternion);
  inner.scale.copy(model.scale);
  while (model.children.length > 0) {
    inner.add(model.children[0]);
  }
  const mountPivot = new THREE.Group();
  mountPivot.quaternion.setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  mountPivot.add(inner);

  model.position.set(0, 0, 0);
  model.quaternion.identity();
  model.scale.set(1, 1, 1);
  model.add(mountPivot);
  model.updateMatrixWorld(true);
}

export interface GlbMountingInspection {
  mountingType: MountingType;
  mountingFace: MountingFace;
  rawBoundsMm: { widthMm: number; depthMm: number; heightMm: number };
  orientedBoundsMm: { widthMm: number; depthMm: number; heightMm: number };
  reason: string;
}

/**
 * Inspects an imported 3D scene's vertex distribution, face contact density, and aspect ratios
 * to recommend an appropriate mounting type and mounting face rather than assuming floor-mount.
 */
export function inspectGlbForMounting(root: THREE.Object3D): GlbMountingInspection {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);

  const maxRaw = Math.max(size.x, size.y, size.z, 1e-5);
  const unitMult = maxRaw > 30 ? 1 : 1000;
  const rawW = Math.max(20, Math.round(size.x * unitMult));
  const rawH = Math.max(20, Math.round(size.y * unitMult));
  const rawD = Math.max(20, Math.round(size.z * unitMult));
  const rawBoundsMm = { widthMm: rawW, depthMm: rawD, heightMm: rawH };

  const epsX = Math.max(1e-5, size.x * 0.045);
  const epsY = Math.max(1e-5, size.y * 0.045);
  const epsZ = Math.max(1e-5, size.z * 0.045);

  let totalVerts = 0;
  let bottomCount = 0;
  let topCount = 0;
  let backCount = 0;
  let frontCount = 0;
  let leftCount = 0;
  let rightCount = 0;

  let topBandMinX = Infinity;
  let topBandMaxX = -Infinity;
  let topBandMinZ = Infinity;
  let topBandMaxZ = -Infinity;
  let botBandMinX = Infinity;
  let botBandMaxX = -Infinity;
  let botBandMinZ = Infinity;
  let botBandMaxZ = -Infinity;
  let sumY = 0;

  const v = new THREE.Vector3();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const stride = pos.count > 18000 ? Math.ceil(pos.count / 12000) : 1;
    const mat = mesh.matrixWorld;

    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mat);
      totalVerts++;
      sumY += v.y;
      if (v.y <= box.min.y + epsY) {
        bottomCount++;
        botBandMinX = Math.min(botBandMinX, v.x);
        botBandMaxX = Math.max(botBandMaxX, v.x);
        botBandMinZ = Math.min(botBandMinZ, v.z);
        botBandMaxZ = Math.max(botBandMaxZ, v.z);
      }
      if (v.y >= box.max.y - epsY) {
        topCount++;
        topBandMinX = Math.min(topBandMinX, v.x);
        topBandMaxX = Math.max(topBandMaxX, v.x);
        topBandMinZ = Math.min(topBandMinZ, v.z);
        topBandMaxZ = Math.max(topBandMaxZ, v.z);
      }
      if (v.z <= box.min.z + epsZ) backCount++;
      if (v.z >= box.max.z - epsZ) frontCount++;
      if (v.x <= box.min.x + epsX) leftCount++;
      if (v.x >= box.max.x - epsX) rightCount++;
    }
  });

  if (totalVerts === 0) {
    return {
      mountingType: 'floor',
      mountingFace: 'bottom',
      rawBoundsMm,
      orientedBoundsMm: rawBoundsMm,
      reason: 'Default floor orientation (empty mesh)',
    };
  }

  const bottomFrac = bottomCount / totalVerts;
  const topFrac = topCount / totalVerts;
  const backFrac = backCount / totalVerts;
  const frontFrac = frontCount / totalVerts;
  const leftFrac = leftCount / totalVerts;
  const rightFrac = rightCount / totalVerts;

  const comRelY = (sumY / totalVerts - box.min.y) / Math.max(1e-5, size.y);
  const topFootprintRatio =
    Number.isFinite(topBandMaxX) && size.x > 1e-5 && size.z > 1e-5
      ? ((topBandMaxX - topBandMinX) * (topBandMaxZ - topBandMinZ)) / (size.x * size.z)
      : 1;
  const botFootprintRatio =
    Number.isFinite(botBandMaxX) && size.x > 1e-5 && size.z > 1e-5
      ? ((botBandMaxX - botBandMinX) * (botBandMaxZ - botBandMinZ)) / (size.x * size.z)
      : 1;

  let mountingType: MountingType = 'floor';
  let mountingFace: MountingFace = 'bottom';
  let reason = 'Broad floor base detected';

  // 1. Ceiling-mounted fixtures: flat canopy at +Y with sparse bottom, OR narrow suspension stem at top
  const flatCeilingCanopy =
    topFrac >= 0.16 && topFrac > bottomFrac * 1.75 && comRelY >= 0.48 && rawH <= Math.max(rawW, rawD) * 2.2;
  const hangingPendant =
    topFootprintRatio > 0 &&
    topFootprintRatio < 0.28 &&
    bottomFrac < 0.14 &&
    botFootprintRatio < 0.55 &&
    rawH >= 180;

  if (flatCeilingCanopy || hangingPendant) {
    mountingType = 'ceiling';
    mountingFace = 'top';
    reason = flatCeilingCanopy
      ? 'Flat upper ceiling canopy detected'
      : 'Narrow top suspension canopy with hanging body detected';
  } else {
    // 2. Wall-mounted objects: shallow depth or width relative to height & span
    const thinZ = rawD <= 280 && rawD <= Math.max(rawW, rawH) * 0.36 && rawH >= 180;
    const thinX = rawW <= 280 && rawW <= Math.max(rawD, rawH) * 0.36 && rawH >= 180;
    const flatLyingWallPanel =
      rawH <= 110 &&
      Math.min(rawW, rawD) >= 240 &&
      Math.max(rawW, rawD) <= 1350 &&
      rawW * rawD < 1_350_000 &&
      Math.max(rawW, rawD) / rawH >= 5 &&
      topFrac > bottomFrac * 0.6 &&
      bottomFrac > 0.22 &&
      Math.abs(frontFrac - backFrac) < 0.08 &&
      false; // Conservative: avoid misclassifying flat rugs/tabletops; thin upright shapes detect reliably below

    if (thinZ && (!thinX || rawW >= rawD)) {
      mountingType = 'wall';
      mountingFace = frontFrac > backFrac * 1.35 ? 'front' : 'back';
      reason = `Thin vertical profile (${(rawD / 10).toFixed(0)} cm deep) suggests wall mount`;
    } else if (thinX) {
      mountingType = 'wall';
      mountingFace = rightFrac > leftFrac * 1.35 ? 'right' : 'left';
      reason = `Thin vertical profile (${(rawW / 10).toFixed(0)} cm wide) suggests wall mount`;
    } else if (flatLyingWallPanel) {
      mountingType = 'wall';
      mountingFace = 'bottom';
      reason = 'Flat panel detected';
    } else if (Math.max(rawW, rawD) <= 550 && rawH <= 580 && botFootprintRatio >= 0.08) {
      // 3. Compact objects with stable base fit on desks/counters/tables
      mountingType = 'surface';
      mountingFace = 'bottom';
      reason = 'Compact proportions fit on furniture surfaces';
    } else if (
      (botFootprintRatio < 0.65 && Math.max(rawW, rawD) <= 2200 && rawH <= 1250) ||
      rawH <= 60
    ) {
      mountingType = 'freestanding';
      mountingFace = 'bottom';
      reason = 'Open-floor freestanding proportions detected';
    }
  }

  return {
    mountingType,
    mountingFace,
    rawBoundsMm,
    orientedBoundsMm: rotateBoundsForMounting(rawBoundsMm, mountingType, mountingFace),
    reason,
  };
}
