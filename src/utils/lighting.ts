import * as THREE from 'three';
import type {
  FurnitureInstance,
  FurnitureLightSource,
  FurnitureLightType,
  FurniturePart,
  GlbInspectedMaterial,
  GlbMaterialEmissiveOverride,
  MountingFace,
  MountingType,
} from '../types/plan';
import { computeFurnitureBoundsMm, isCeilingFixture } from './geometry';
import { fitGlbSceneToFurnitureBounds } from './furnitureRepresentationSync';
import { resolveFurnitureMountingType } from './mounting';
import { uid } from './units';

export interface SceneBulbLightEntry {
  light: THREE.PointLight | THREE.SpotLight | THREE.RectAreaLight;
  baseIntensity: number;
  isCeiling: boolean;
  userCastShadow?: boolean;
}

export interface EmissiveTargetEntry {
  mat: THREE.MeshStandardMaterial;
  baseIntensity: number;
  alwaysVisible?: boolean;
}

export function kelvinToColorComponents(kelvin: number): { r: number; g: number; b: number } {
  const temp = Math.min(12000, Math.max(1500, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (temp <= 66) {
    r = 255;
    g = Math.min(255, Math.max(0, 99.4708025861 * Math.log(temp) - 161.1195681661));
    b =
      temp <= 19
        ? 0
        : Math.min(255, Math.max(0, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
  } else {
    r = Math.min(255, Math.max(0, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
    g = Math.min(255, Math.max(0, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
    b = 255;
  }
  return { r: r / 255, g: g / 255, b: b / 255 };
}

export function kelvinToThreeColor(kelvin: number): THREE.Color {
  const { r, g, b } = kelvinToColorComponents(kelvin);
  return new THREE.Color(r, g, b);
}

export function kelvinToHex(kelvin: number): string {
  return `#${kelvinToThreeColor(kelvin).getHexString()}`;
}

export function resolveLightSourceHex(light: Pick<FurnitureLightSource, 'colorMode' | 'colorTempK' | 'colorHex'>): string {
  if (light.colorMode === 'hex' && /^#[0-9a-fA-F]{6}$/.test(light.colorHex)) {
    return light.colorHex;
  }
  return kelvinToHex(light.colorTempK || 3200);
}

export function resolveLightSourceThreeColor(
  light: Pick<FurnitureLightSource, 'colorMode' | 'colorTempK' | 'colorHex'>
): THREE.Color {
  if (light.colorMode === 'hex' && /^#[0-9a-fA-F]{6}$/.test(light.colorHex)) {
    return new THREE.Color(light.colorHex);
  }
  return kelvinToThreeColor(light.colorTempK || 3200);
}

export function computeAimDirectionVectorThree(
  aimAzimuthDeg: number,
  aimElevationDeg: number,
  mirroredX = false,
  mirroredY = false
): THREE.Vector3 {
  const azRad = (aimAzimuthDeg * Math.PI) / 180;
  const elRad = (aimElevationDeg * Math.PI) / 180;
  const cosEl = Math.cos(elRad);
  const dx = cosEl * Math.sin(azRad) * (mirroredX ? -1 : 1);
  const dy = Math.sin(elRad);
  const dz = cosEl * Math.cos(azRad) * (mirroredY ? -1 : 1);
  const v = new THREE.Vector3(dx, dy, dz);
  if (v.lengthSq() < 1e-8) return new THREE.Vector3(0, -1, 0);
  return v.normalize();
}

/**
 * Computes orthonormal Three.js basis & quaternion for oriented lights (Spot, Area, Linear)
 * supporting independent Yaw (`aimAzimuthDeg`), Pitch (`aimElevationDeg`), and Roll (`aimRollDeg`),
 * continuous even at straight-down (-90) and straight-up (+90) pitch.
 * Note: Three.js `RectAreaLight` emits along local `-Z` with `right = +X`, `up = +Y`.
 */
export function computeLightOrientationQuaternionThree(
  aimAzimuthDeg: number,
  aimElevationDeg: number,
  aimRollDeg = 0,
  mirroredX = false,
  mirroredY = false
): {
  quaternion: THREE.Quaternion;
  dir: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
} {
  const mx = mirroredX ? -1 : 1;
  const my = mirroredY ? -1 : 1;
  const dir = computeAimDirectionVectorThree(aimAzimuthDeg, aimElevationDeg, mirroredX, mirroredY);
  const azRad = (aimAzimuthDeg * Math.PI) / 180;

  let u0: THREE.Vector3;
  if (Math.hypot(dir.x, dir.z) < 1e-4) {
    const upSign = dir.y < 0 ? 1 : -1;
    u0 = new THREE.Vector3(Math.sin(azRad) * upSign * mx, 0, Math.cos(azRad) * upSign * my);
  } else {
    u0 = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y);
  }
  if (u0.lengthSq() < 1e-8) {
    u0 = new THREE.Vector3(0, 0, 1);
  } else {
    u0.normalize();
  }

  // Three.js RectAreaLight shines along local -Z -> zAxis = -dir
  const zAxis = dir.clone().negate();
  let xAxis = new THREE.Vector3().crossVectors(u0, zAxis);
  if (xAxis.lengthSq() < 1e-8) {
    xAxis = new THREE.Vector3(1, 0, 0);
  } else {
    xAxis.normalize();
  }
  let yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

  const rollRad = THREE.MathUtils.degToRad((aimRollDeg ?? 0) * (mx * my < 0 ? -1 : 1));
  if (Math.abs(rollRad) > 1e-6) {
    xAxis.applyAxisAngle(dir, rollRad).normalize();
    yAxis.applyAxisAngle(dir, rollRad).normalize();
  }

  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  return { quaternion, dir, up: yAxis, right: xAxis };
}

export function computeFurnitureBulbCenterMm(f: Pick<FurnitureInstance, 'parts' | 'templateId' | 'category'>): {
  xMm: number;
  yMm: number;
  zMm: number;
} {
  const bounds = computeFurnitureBoundsMm(f.parts);
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let count = 0;
  for (const p of f.parts) {
    const isBulb =
      p.material === 'glass' ||
      p.detailStyle === 'lamp_shade' ||
      p.emissiveEnabled ||
      /bulb|shade|diffuser|globe|lamp|panel|tube|ring|lantern|glow|dome/i.test(p.name) ||
      /^#ff|^#fe|^#fa|^#fd/i.test(p.color);
    if (isBulb) {
      sumX += p.xMm;
      sumY += p.yMm;
      sumZ += p.zMm + p.heightMm / 2;
      count += 1;
    }
  }
  if (count > 0) {
    return {
      xMm: Math.round(sumX / count),
      yMm: Math.round(sumY / count),
      zMm: Math.round(sumZ / count),
    };
  }
  const ceilingMounted = isCeilingFixture(f);
  return {
    xMm: Math.round((bounds.minX + bounds.maxX) / 2),
    yMm: Math.round((bounds.minY + bounds.maxY) / 2),
    zMm: ceilingMounted
      ? Math.max(20, Math.round(bounds.minZ - 30))
      : Math.max(80, Math.round((bounds.minZ + bounds.maxZ) * 0.65)),
  };
}

export function createDefaultLightSource(
  type: FurnitureLightType = 'point',
  overrides?: Partial<FurnitureLightSource>,
  f?: Pick<FurnitureInstance, 'parts' | 'templateId' | 'category' | 'mountingType'>
): FurnitureLightSource {
  const center = f ? computeFurnitureBulbCenterMm(f) : { xMm: 0, yMm: 0, zMm: 400 };
  const isCeiling = f ? isCeilingFixture(f) || resolveFurnitureMountingType(f) === 'ceiling' : false;
  const bounds = f ? computeFurnitureBoundsMm(f.parts) : null;
  const labelMap: Record<FurnitureLightType, string> = {
    point: 'Point Light',
    spot: 'Spotlight',
    area: 'Area Light',
    linear: 'Linear Strip',
  };

  return {
    id: overrides?.id ?? uid('light'),
    name: overrides?.name ?? labelMap[type],
    type,
    enabled: overrides?.enabled ?? true,
    colorMode: overrides?.colorMode ?? 'kelvin',
    colorTempK: overrides?.colorTempK ?? 3000,
    colorHex: overrides?.colorHex ?? '#FFBE76',
    intensity: overrides?.intensity ?? (type === 'area' || type === 'linear' ? 1.4 : 1.0),
    rangeMm: overrides?.rangeMm ?? (isCeiling ? 8500 : 5000),
    decay: overrides?.decay ?? 2,
    xMm: overrides?.xMm ?? center.xMm,
    yMm: overrides?.yMm ?? center.yMm,
    zMm: overrides?.zMm ?? center.zMm,
    aimAzimuthDeg: overrides?.aimAzimuthDeg ?? 0,
    aimElevationDeg:
      overrides?.aimElevationDeg ??
      (type === 'spot' || type === 'area' || type === 'linear' ? -75 : 0),
    aimRollDeg: overrides?.aimRollDeg ?? 0,
    coneAngleDeg: overrides?.coneAngleDeg ?? 58,
    penumbra: overrides?.penumbra ?? 0.72,
    widthMm:
      overrides?.widthMm ??
      (type === 'linear'
        ? Math.max(200, Math.round((bounds?.widthMm ?? 900) * 0.8))
        : Math.max(180, Math.round((bounds?.widthMm ?? 500) * 0.55))),
    lengthMm:
      overrides?.lengthMm ??
      (type === 'linear'
        ? 45
        : Math.max(180, Math.round((bounds?.depthMm ?? 500) * 0.55))),
    castShadow: overrides?.castShadow ?? isCeiling,
    sourceRef: overrides?.sourceRef,
  };
}

/**
 * Derives backward-compatible light source(s) for legacy `category === 'Lighting'` fixtures
 * that have no explicit `f.lights` array yet.
 */
export function deriveLegacyLightsForFurniture(f: FurnitureInstance): FurnitureLightSource[] {
  if (f.category !== 'Lighting') return [];
  const cfg = f.lightConfig ?? { enabled: true, colorTempK: 3200, intensity: 0.6 };
  const center = computeFurnitureBulbCenterMm(f);
  const ceilingMounted = isCeilingFixture(f);
  const isSconce = f.templateId.startsWith('light_sconce');
  return [
    {
      id: `legacy_spot_${f.id}`,
      name: ceilingMounted ? 'Ceiling Downlight' : isSconce ? 'Wall Sconce Beam' : 'Lamp Light',
      type: 'spot',
      enabled: cfg.enabled,
      colorMode: 'kelvin',
      colorTempK: cfg.colorTempK,
      colorHex: kelvinToHex(cfg.colorTempK),
      intensity: cfg.intensity,
      rangeMm: ceilingMounted ? 8500 : 5500,
      decay: 2,
      xMm: center.xMm,
      yMm: center.yMm,
      zMm: ceilingMounted ? Math.min(center.zMm, computeFurnitureBoundsMm(f.parts).minZ - 30) : center.zMm,
      aimAzimuthDeg: 0,
      aimElevationDeg: isSconce ? -68 : -90,
      coneAngleDeg: ceilingMounted ? 72 : isSconce ? 62 : 78,
      penumbra: ceilingMounted ? 0.72 : 0.84,
      castShadow: ceilingMounted,
    },
  ];
}

/**
 * Determines whether a furniture item is designated as a light object
 * (either imported with "Is a light" enabled, built-in Lighting category,
 * or legacy objects carrying configured lights/overrides).
 */
export function isFurnitureLightObject(
  f: Pick<FurnitureInstance, 'isLight' | 'category' | 'lights' | 'glbEmissiveOverrides'>
): boolean {
  if (f.isLight === true) return true;
  if (f.isLight === false) return f.category === 'Lighting';
  if (f.category === 'Lighting') return true;
  if (Array.isArray(f.lights) && f.lights.length > 0) return true;
  if (Array.isArray(f.glbEmissiveOverrides) && f.glbEmissiveOverrides.some((ov) => ov.enabled)) {
    return true;
  }
  return false;
}

/**
 * Returns whether the furniture's master "Lit" switch is active.
 * When false, all lights and emissive emission stay off while preserving user settings.
 */
export function isFurnitureLightingActive(
  f: Pick<FurnitureInstance, 'lightingEnabled' | 'isLight' | 'category' | 'lightConfig' | 'lights'>
): boolean {
  if (f.lightingEnabled === false) return false;
  if (f.lightingEnabled === true) return true;
  if (f.category === 'Lighting' && f.lightConfig && !Array.isArray(f.lights)) {
    return f.lightConfig.enabled !== false;
  }
  return true;
}

/**
 * Returns explicit `f.lights` when configured (including an explicit `[]`),
 * otherwise derives legacy Lighting fixture source if `category === 'Lighting'`.
 */
export function resolveEffectiveFurnitureLights(f: FurnitureInstance): FurnitureLightSource[] {
  if (Array.isArray(f.lights)) {
    return f.lights;
  }
  return deriveLegacyLightsForFurniture(f);
}

export function scaleFurnitureLightSources(
  lights: FurnitureLightSource[] | undefined,
  sx: number,
  sy: number,
  sz: number
): FurnitureLightSource[] | undefined {
  if (!lights) return undefined;
  const safeSx = Number.isFinite(sx) && sx > 0 ? sx : 1;
  const safeSy = Number.isFinite(sy) && sy > 0 ? sy : 1;
  const safeSz = Number.isFinite(sz) && sz > 0 ? sz : 1;
  return lights.map((l) => ({
    ...l,
    xMm: Math.round(l.xMm * safeSx * 10) / 10,
    yMm: Math.round(l.yMm * safeSy * 10) / 10,
    zMm: Math.max(0, Math.round(l.zMm * safeSz * 10) / 10),
    widthMm: l.widthMm !== undefined ? Math.max(30, Math.round(l.widthMm * safeSx)) : undefined,
    lengthMm: l.lengthMm !== undefined ? Math.max(20, Math.round(l.lengthMm * safeSy)) : undefined,
  }));
}

export function cloneLightsWithFreshIds(
  lights: FurnitureLightSource[] | undefined
): FurnitureLightSource[] | undefined {
  if (!lights) return undefined;
  return lights.map((l) => ({ ...l, id: uid('light') }));
}

export function createMatchingLightForPart(
  part: FurniturePart,
  f?: Pick<FurnitureInstance, 'parts' | 'templateId' | 'category' | 'mountingType'>
): FurnitureLightSource {
  const colorHex = part.emissiveColor || part.color || '#FFBE76';
  const isLinearShape =
    part.widthMm >= part.depthMm * 2.4 && part.depthMm <= 160 && part.heightMm <= 180;
  const lightType: FurnitureLightType = isLinearShape ? 'linear' : 'point';
  return createDefaultLightSource(
    lightType,
    {
      name: `${part.name} Light`,
      colorMode: 'hex',
      colorHex,
      colorTempK: 3000,
      intensity: Math.max(0.8, Math.min(2.2, (part.emissiveIntensity ?? 1.2) * 0.9)),
      xMm: Math.round(part.xMm),
      yMm: Math.round(part.yMm),
      zMm: Math.round(part.zMm + part.heightMm / 2),
      widthMm: isLinearShape ? Math.max(120, Math.round(part.widthMm * 0.9)) : Math.round(part.widthMm),
      lengthMm: isLinearShape ? Math.max(30, Math.round(part.depthMm * 0.8)) : Math.round(part.depthMm),
      aimAzimuthDeg: 0,
      aimElevationDeg: -75,
      sourceRef: part.id,
    },
    f
  );
}

export function createMatchingLightForGlbMaterial(
  matInfo: GlbInspectedMaterial,
  override?: GlbMaterialEmissiveOverride,
  f?: Pick<FurnitureInstance, 'parts' | 'templateId' | 'category' | 'mountingType'>
): FurnitureLightSource {
  const colorHex =
    override?.emissiveColor && override.emissiveColor !== '#000000'
      ? override.emissiveColor
      : matInfo.emissiveHex !== '#000000'
        ? matInfo.emissiveHex
        : matInfo.baseColorHex !== '#000000'
          ? matInfo.baseColorHex
          : '#FF9F43';
  const maxSpan = Math.max(matInfo.sizeMm.widthMm, matInfo.sizeMm.depthMm);
  const minSpan = Math.min(matInfo.sizeMm.widthMm, matInfo.sizeMm.depthMm);
  const isLinearMat = maxSpan >= minSpan * 2.8 && minSpan <= 180 && matInfo.sizeMm.heightMm <= 180;
  const lightType: FurnitureLightType = isLinearMat ? 'linear' : 'point';
  return createDefaultLightSource(
    lightType,
    {
      name: `${matInfo.materialName || 'Glow'} Light`,
      colorMode: 'hex',
      colorHex,
      colorTempK: 2800,
      intensity: Math.max(
        0.9,
        Math.min(2.4, ((override?.emissiveIntensity ?? matInfo.emissiveIntensity) || 1.2) * 0.9)
      ),
      xMm: Math.round(matInfo.localCenterMm.xMm),
      yMm: Math.round(matInfo.localCenterMm.yMm),
      zMm: Math.round(Math.max(10, matInfo.localCenterMm.zMm)),
      widthMm: Math.max(80, Math.round(matInfo.sizeMm.widthMm * 0.85)),
      lengthMm: isLinearMat
        ? Math.max(30, Math.round(matInfo.sizeMm.depthMm * 0.8))
        : Math.max(80, Math.round(matInfo.sizeMm.depthMm * 0.85)),
      rangeMm: 5200,
      aimAzimuthDeg: 0,
      aimElevationDeg: -75,
      sourceRef: matInfo.materialKey,
    },
    f
  );
}

function buildDeterministicMaterialKey(index: number, mat: THREE.Material, mesh: THREE.Mesh): string {
  const rawName = (mat.name || mesh.name || `material_${index}`).trim();
  const safe = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 36) || `mat_${index}`;
  return `mat_${index}_${safe}`;
}

/**
 * Non-destructively inspects all unique materials inside a GLB Object3D, computing
 * fitted furniture-local millimeter centers so lights placed from a material sit inside
 * the exact target sub-mesh (e.g. an orange glass ring on a VARMBLIXT wall/table lamp).
 */
export function inspectGlbMaterials(
  root: THREE.Object3D,
  targetBoundsMm?: { widthMm: number; depthMm: number; heightMm: number },
  mountingOptions?: { mountingType?: MountingType; mountingFace?: MountingFace }
): GlbInspectedMaterial[] {
  const work = root.clone(true);
  if (targetBoundsMm) {
    fitGlbSceneToFurnitureBounds(work, targetBoundsMm, mountingOptions);
  }
  work.updateMatrixWorld(true);

  interface Accumulator {
    materialKey: string;
    materialName: string;
    meshNames: Set<string>;
    mat: THREE.Material;
    box: THREE.Box3;
  }

  const byMat = new Map<THREE.Material, Accumulator>();
  let idx = 0;

  work.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const meshBox = new THREE.Box3().setFromObject(mesh);

    for (const mat of mats) {
      if (!mat) continue;
      let entry = byMat.get(mat);
      if (!entry) {
        const key = buildDeterministicMaterialKey(idx, mat, mesh);
        idx += 1;
        entry = {
          materialKey: key,
          materialName: mat.name?.trim() || mesh.name?.trim() || `Material ${idx}`,
          meshNames: new Set<string>(),
          mat,
          box: new THREE.Box3(),
        };
        byMat.set(mat, entry);
      }
      if (mesh.name?.trim()) {
        entry.meshNames.add(mesh.name.trim());
      }
      if (!meshBox.isEmpty()) {
        entry.box.union(meshBox);
      }
    }
  });

  const results: GlbInspectedMaterial[] = [];
  for (const acc of byMat.values()) {
    const std = acc.mat as THREE.MeshStandardMaterial;
    const baseColorHex =
      std.color && typeof std.color.getHexString === 'function'
        ? `#${std.color.getHexString()}`
        : '#FFFFFF';
    const hasColorMap = Boolean(std.map);
    const hasEmissiveMap = Boolean(std.emissiveMap);
    const emissiveHex =
      std.emissive && typeof std.emissive.getHexString === 'function'
        ? `#${std.emissive.getHexString()}`
        : '#000000';
    const emissiveIntensity =
      typeof std.emissiveIntensity === 'number' ? std.emissiveIntensity : 0;

    const hasNonBlackEmissive = emissiveHex.toLowerCase() !== '#000000';
    const emissiveDetected = hasEmissiveMap || hasNonBlackEmissive;
    const emissiveDisabled =
      (hasEmissiveMap && (!hasNonBlackEmissive || emissiveIntensity <= 0.001)) ||
      (hasNonBlackEmissive && emissiveIntensity <= 0.001);

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    if (!acc.box.isEmpty()) {
      acc.box.getCenter(center);
      acc.box.getSize(size);
    }

    results.push({
      materialKey: acc.materialKey,
      materialName: acc.materialName,
      meshNames: Array.from(acc.meshNames),
      baseColorHex,
      hasColorMap,
      hasEmissiveMap,
      emissiveHex,
      emissiveIntensity,
      emissiveDetected,
      emissiveDisabled,
      localCenterMm: {
        xMm: Math.round(center.x * 1000),
        yMm: Math.round(center.z * 1000),
        zMm: Math.round(Math.max(0, center.y * 1000)),
      },
      sizeMm: {
        widthMm: Math.max(10, Math.round(size.x * 1000)),
        depthMm: Math.max(10, Math.round(size.z * 1000)),
        heightMm: Math.max(10, Math.round(size.y * 1000)),
      },
    });
  }

  return results;
}

/**
 * Applies non-destructive emissive material overrides to a cloned runtime GLB model
 * without ever mutating cached IndexedDB/in-memory scene materials or stripping diffuse/PBR maps.
 */
export function applyGlbEmissiveOverrides(
  model: THREE.Object3D,
  overrides: GlbMaterialEmissiveOverride[] | undefined,
  nightMix: number,
  clippingPlanes?: THREE.Plane[],
  masterLightingEnabled = true
): EmissiveTargetEntry[] {
  const overrideMap = new Map<string, GlbMaterialEmissiveOverride>();
  for (const ov of overrides ?? []) {
    overrideMap.set(ov.materialKey, ov);
  }

  const origToKey = new Map<THREE.Material, string>();
  const clonedMaterials = new Map<THREE.Material, THREE.Material>();
  const trackedSet = new Set<THREE.Material>();
  const emissiveTargets: EmissiveTargetEntry[] = [];
  let idx = 0;

  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry && !mesh.geometry.attributes.normal) {
      mesh.geometry.computeVertexNormals();
    }
    const isArr = Array.isArray(mesh.material);
    const origMats = isArr ? (mesh.material as THREE.Material[]) : [mesh.material as THREE.Material];
    const nextMats: THREE.Material[] = [];

    for (const origMat of origMats) {
      if (!origMat) continue;
      let key = origToKey.get(origMat);
      if (!key) {
        key = buildDeterministicMaterialKey(idx, origMat, mesh);
        origToKey.set(origMat, key);
        idx += 1;
      }

      let matClone = clonedMaterials.get(origMat);
      if (!matClone) {
        matClone = origMat.clone();
        if (clippingPlanes && clippingPlanes.length > 0) {
          matClone.clippingPlanes = clippingPlanes;
        }
        const ov = overrideMap.get(key);
        const std = matClone as THREE.MeshStandardMaterial;
        if (typeof std.roughness === 'number' && Number.isFinite(std.roughness)) {
          std.roughness = Math.max(0.04, std.roughness);
        }

        if (!masterLightingEnabled) {
          if ('emissive' in std) {
            std.emissive = new THREE.Color(0x000000);
            std.emissiveIntensity = 0;
            std.needsUpdate = true;
          }
        } else if (ov && 'emissive' in std) {
          if (ov.enabled) {
            std.emissive = new THREE.Color(ov.emissiveColor || '#FFFFFF');
            if (ov.preserveEmissiveMap === false) {
              std.emissiveMap = null;
            }
            const baseIntensity =
              Math.max(0, ov.emissiveIntensity) * Math.max(0.25, Math.min(1.6, ov.bloomBoost ?? 1.0));
            std.emissiveIntensity = baseIntensity * THREE.MathUtils.lerp(0.85, 0.94, nightMix);
            std.toneMapped = true;
            std.needsUpdate = true;
            if (!trackedSet.has(std)) {
              trackedSet.add(std);
              emissiveTargets.push({ mat: std, baseIntensity, alwaysVisible: true });
            }
          } else {
            std.emissive = new THREE.Color(0x000000);
            std.emissiveIntensity = 0;
            std.needsUpdate = true;
          }
        } else if (
          !ov &&
          'emissive' in std &&
          std.emissive &&
          std.emissive.getHex() !== 0 &&
          (std.emissiveIntensity ?? 0) > 0.01
        ) {
          const baseIntensity = std.emissiveIntensity;
          std.emissiveIntensity = baseIntensity * THREE.MathUtils.lerp(0.85, 0.94, nightMix);
          if (!trackedSet.has(std)) {
            trackedSet.add(std);
            emissiveTargets.push({ mat: std, baseIntensity, alwaysVisible: true });
          }
        }

        clonedMaterials.set(origMat, matClone);
      }

      nextMats.push(matClone);
    }

    mesh.material = isArr ? nextMats : nextMats[0];
  });

  return emissiveTargets;
}

/**
 * Builds Three.js PointLight / SpotLight / RectAreaLight objects for all enabled lights
 * inside a furniture's `tiltGroup` (above `mirrorGroup` so negative mirror scales never invert
 * spotlight matrices; mirror axes are folded directly into light position and aim).
 */
export function buildThreeLightsForFurniture(
  f: FurnitureInstance,
  tiltGroup: THREE.Group,
  options: {
    nightMix: number;
    isSoftwareGl?: boolean;
    useLegacyFillForUnmigratedLamp?: boolean;
  }
): SceneBulbLightEntry[] {
  if (!isFurnitureLightingActive(f)) return [];
  const effectiveLights = resolveEffectiveFurnitureLights(f);
  if (effectiveLights.length === 0) return [];

  const mx = f.mirroredX ? -1 : 1;
  const my = f.mirroredY ? -1 : 1;
  const nightBoost = THREE.MathUtils.lerp(0.24, 0.62, options.nightMix);
  const ceilingMounted = isCeilingFixture(f) || resolveFurnitureMountingType(f) === 'ceiling';
  const bulbLights: SceneBulbLightEntry[] = [];

  for (const src of effectiveLights) {
    if (!src.enabled || src.intensity <= 0) continue;

    const color = resolveLightSourceThreeColor(src);
    const px = (src.xMm * mx) / 1000;
    const py = src.zMm / 1000;
    const pz = (src.yMm * my) / 1000;
    const rangeM = Math.max(0.3, (src.rangeMm || 5000) / 1000);
    const decay = Math.max(0.5, Math.min(2.5, src.decay ?? 2));
    const dir = computeAimDirectionVectorThree(
      src.aimAzimuthDeg ?? 0,
      src.aimElevationDeg ?? -75,
      f.mirroredX,
      f.mirroredY
    );

    if (src.type === 'point') {
      const baseIntensity = src.intensity * (ceilingMounted ? 1.55 : 1.15);
      const pt = new THREE.PointLight(color, baseIntensity * nightBoost, rangeM, decay);
      pt.position.set(px, py, pz);
      pt.name = `Light_${src.id}`;
      tiltGroup.add(pt);
      bulbLights.push({
        light: pt,
        baseIntensity,
        isCeiling: ceilingMounted,
        userCastShadow: Boolean(src.castShadow),
      });
    } else if (src.type === 'spot') {
      const baseIntensity = src.intensity * (ceilingMounted ? 2.45 : 1.9);
      const halfConeRad = THREE.MathUtils.degToRad(Math.max(8, Math.min(82, src.coneAngleDeg ?? 58)));
      const penumbra = Math.max(0, Math.min(1, src.penumbra ?? 0.72));
      const spot = new THREE.SpotLight(
        color,
        baseIntensity * nightBoost,
        rangeM,
        halfConeRad,
        penumbra,
        decay
      );
      spot.position.set(px, py, pz);
      spot.target.position.set(px + dir.x * 2, py + dir.y * 2, pz + dir.z * 2);
      spot.name = `Light_${src.id}`;
      tiltGroup.add(spot);
      tiltGroup.add(spot.target);
      bulbLights.push({
        light: spot,
        baseIntensity,
        isCeiling: ceilingMounted,
        userCastShadow: Boolean(src.castShadow),
      });
    } else {
      // 'area' or 'linear'
      const widthM = Math.max(0.08, (src.widthMm ?? (src.type === 'linear' ? 800 : 500)) / 1000);
      const heightM =
        src.type === 'linear'
          ? Math.max(0.03, (src.lengthMm ?? 45) / 1000)
          : Math.max(0.08, (src.lengthMm ?? 500) / 1000);

      if (options.isSoftwareGl) {
        // Software WebGL avoids RectAreaLightLTC shader stalls via a clean soft PointLight fill
        const sampleCount = src.type === 'linear' ? 2 : 1;
        const perBase = (src.intensity * (src.type === 'linear' ? 0.95 : 1.15)) / sampleCount;
        for (let i = 0; i < sampleCount; i++) {
          const offsetX = sampleCount === 1 ? 0 : (i === 0 ? -0.28 : 0.28) * widthM;
          const fillPt = new THREE.PointLight(color, perBase * nightBoost, rangeM, decay);
          fillPt.position.set(px + offsetX, py, pz);
          fillPt.name = `Light_${src.id}_sw${i}`;
          tiltGroup.add(fillPt);
          bulbLights.push({
            light: fillPt,
            baseIntensity: perBase,
            isCeiling: ceilingMounted,
            userCastShadow: false,
          });
        }
      } else {
        const baseIntensity = src.intensity * (src.type === 'linear' ? 2.8 : 2.1);
        const rect = new THREE.RectAreaLight(color, baseIntensity * nightBoost, widthM, heightM);
        rect.position.set(px, py, pz);
        const basis = computeLightOrientationQuaternionThree(
          src.aimAzimuthDeg ?? 0,
          src.aimElevationDeg ?? -75,
          src.aimRollDeg ?? 0,
          f.mirroredX,
          f.mirroredY
        );
        rect.quaternion.copy(basis.quaternion);
        rect.name = `Light_${src.id}`;
        tiltGroup.add(rect);
        bulbLights.push({
          light: rect,
          baseIntensity,
          isCeiling: ceilingMounted,
          userCastShadow: false,
        });
      }
    }
  }

  // Optional soft secondary fill light for unmigrated legacy `Lighting` category fixtures
  if (
    options.useLegacyFillForUnmigratedLamp &&
    !Array.isArray(f.lights) &&
    f.category === 'Lighting' &&
    effectiveLights[0]?.enabled
  ) {
    const primary = effectiveLights[0];
    const color = resolveLightSourceThreeColor(primary);
    const fillBase = (ceilingMounted ? 0.62 : 0.44) * primary.intensity;
    const fillPt = new THREE.PointLight(
      color,
      fillBase * nightBoost,
      ceilingMounted ? 5.2 : 3.6,
      2
    );
    fillPt.position.set((primary.xMm * mx) / 1000, primary.zMm / 1000, (primary.yMm * my) / 1000);
    tiltGroup.add(fillPt);
    bulbLights.push({
      light: fillPt,
      baseIntensity: fillBase,
      isCeiling: false,
      userCastShadow: false,
    });
  }

  return bulbLights;
}

/**
 * Evaluates and applies emissive material properties for a procedural furniture part,
 * keeping explicit per-part glow (`part.emissiveEnabled === true`) strictly independent
 * of real light sources while maintaining automatic Lighting-category glow defaults.
 */
export function applyProceduralPartEmissive(
  mat: THREE.MeshStandardMaterial,
  part: FurniturePart,
  context: {
    isLightingCategory: boolean;
    hasAnyActiveLampLight: boolean;
    fallbackLightColor: THREE.Color;
    primaryLightIntensity: number;
    nightMix: number;
    masterLightingEnabled?: boolean;
  }
): EmissiveTargetEntry | null {
  if (context.masterLightingEnabled === false) {
    mat.emissive = new THREE.Color(0x000000);
    mat.emissiveIntensity = 0;
    return null;
  }

  const ds = part.detailStyle;
  const isAutoLampPart =
    context.isLightingCategory &&
    context.hasAnyActiveLampLight &&
    (part.material === 'glass' ||
      ds === 'lamp_shade' ||
      /bulb|shade|diffuser|globe|lamp|panel|tube|ring|lantern|glow|dome/i.test(part.name) ||
      /^#ff|^#fe|^#fa|^#fd/i.test(part.color));

  const hasExplicitPartEmissive = part.emissiveEnabled === true;
  const isEmissivePart =
    part.emissiveEnabled === false ? false : hasExplicitPartEmissive || isAutoLampPart;

  if (!isEmissivePart) return null;

  if (hasExplicitPartEmissive) {
    const baseIntensity =
      Math.max(0, part.emissiveIntensity ?? 1.2) * Math.max(0.25, Math.min(1.6, part.bloomBoost ?? 1.0));
    mat.emissive = new THREE.Color(part.emissiveColor || part.color || '#FFBE76');
    mat.emissiveIntensity = baseIntensity * THREE.MathUtils.lerp(0.85, 0.94, context.nightMix);
    mat.needsUpdate = true;
    return { mat, baseIntensity, alwaysVisible: true };
  }

  const baseIntensity = 0.08 + 0.42 * context.primaryLightIntensity;
  mat.emissive = context.fallbackLightColor.clone();
  mat.emissiveIntensity = baseIntensity * THREE.MathUtils.lerp(0.45, 0.85, context.nightMix);
  mat.needsUpdate = true;
  return { mat, baseIntensity, alwaysVisible: false };
}

/**
 * Enforces an explicit performance-safe shadow budget across interior light sources:
 * at most 3 interior Point/Spot lights cast real-time shadow maps (plus 1 global sun/moon = max 4).
 */
export function assignInteriorShadowBudget(
  bulbLights: SceneBulbLightEntry[],
  globalShadowsEnabled: boolean,
  maxInteriorShadowCasters = 3
): number {
  for (const item of bulbLights) {
    if ('castShadow' in item.light && typeof item.light.castShadow === 'boolean') {
      item.light.castShadow = false;
    }
  }
  if (!globalShadowsEnabled || bulbLights.length === 0) return 0;

  const eligible = bulbLights.filter(
    (item) => item.light instanceof THREE.PointLight || item.light instanceof THREE.SpotLight
  );
  if (eligible.length === 0) return 0;

  const userExplicit = eligible.filter((item) => item.userCastShadow);
  const candidates = (userExplicit.length > 0 ? userExplicit : eligible)
    .slice()
    .sort(
      (a, b) =>
        Number(Boolean(b.userCastShadow)) - Number(Boolean(a.userCastShadow)) ||
        Number(b.isCeiling) - Number(a.isCeiling) ||
        b.baseIntensity - a.baseIntensity
    );

  const limit = userExplicit.length > 0 ? maxInteriorShadowCasters : Math.min(2, maxInteriorShadowCasters);
  let assigned = 0;
  for (const item of candidates.slice(0, limit)) {
    const l = item.light as THREE.PointLight | THREE.SpotLight;
    l.castShadow = true;
    l.shadow.mapSize.set(512, 512);
    l.shadow.bias = -0.0025;
    l.shadow.normalBias = 0.02;
    l.shadow.radius = 3;
    l.shadow.camera.near = 0.15;
    l.shadow.camera.far = Math.min(12, Math.max(4, l.distance || 9.5));
    assigned += 1;
  }
  return assigned;
}
