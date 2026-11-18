import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type {
  FurnitureInstance,
  FurnitureRepresentation,
  MountingFace,
  MountingType,
  RepresentationMode,
} from '../types/plan';
import { getGlbAsset, getGlbAssetSync } from './assetStore';
import { computeFurnitureBoundsMm } from './geometry';
import {
  applyMountingRotationToObject3D,
  defaultMountingFaceForType,
  resolveFurnitureMountingFace,
  resolveFurnitureMountingType,
} from './mounting';
import {
  computeFurnitureGeometrySignature,
  generateRepresentationFromObject3D,
  generateRepresentationFromParts,
} from './svgProjection';
import {
  hasValidDefaultSvg,
  isValidSvgSource,
  parseSvgSourceToProjectedView,
  resolveEffectiveRepresentationMode,
} from './svgImport';

const gltfSceneCache = new Map<string, THREE.Object3D>();
const gltfPendingLoads = new Map<string, Promise<THREE.Object3D | null>>();

export function loadGlbObjectCached(
  assetId?: string,
  fallbackDataUrl?: string
): Promise<THREE.Object3D | null> {
  const cacheKey = assetId || (fallbackDataUrl ? `inline_${fallbackDataUrl.length}_${fallbackDataUrl.slice(-24)}` : '');
  if (!cacheKey) return Promise.resolve(null);

  const existing = gltfSceneCache.get(cacheKey);
  if (existing) return Promise.resolve(existing.clone(true));

  const pending = gltfPendingLoads.get(cacheKey);
  if (pending) return pending.then((obj) => (obj ? obj.clone(true) : null));

  const job = (async (): Promise<THREE.Object3D | null> => {
    const dataUrl = (await getGlbAsset(assetId, fallbackDataUrl)) ?? fallbackDataUrl ?? null;
    if (!dataUrl) return null;
    return new Promise<THREE.Object3D | null>((resolve) => {
      const loader = new GLTFLoader();
      loader.load(
        dataUrl,
        (gltf) => {
          gltfSceneCache.set(cacheKey, gltf.scene);
          resolve(gltf.scene.clone(true));
        },
        undefined,
        () => resolve(null)
      );
    });
  })().finally(() => {
    gltfPendingLoads.delete(cacheKey);
  });

  gltfPendingLoads.set(cacheKey, job);
  return job;
}

/**
 * Normalizes a GLB scene in-place so its bounding box is centered on X/Z,
 * grounded at Y = 0, and scaled to exact target millimeter bounds (in meters for Three.js).
 */
export function fitGlbSceneToFurnitureBounds(
  model: THREE.Object3D,
  targetBoundsMm: { widthMm: number; depthMm: number; heightMm: number },
  mountingOptions?: {
    mountingType?: MountingType;
    mountingFace?: MountingFace;
  }
): void {
  if (mountingOptions?.mountingType || mountingOptions?.mountingFace) {
    const mType = mountingOptions.mountingType ?? 'floor';
    const mFace = mountingOptions.mountingFace ?? defaultMountingFaceForType(mType);
    applyMountingRotationToObject3D(model, mType, mFace);
  }
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxRaw = Math.max(size.x, size.y, size.z);
  if (maxRaw <= 1e-6) return;

  const mult = maxRaw > 30 ? 1 : 1000;
  const rawW = Math.max(10, size.x * mult);
  const rawH = Math.max(10, size.y * mult);
  const rawD = Math.max(10, size.z * mult);

  const scaleX = (targetBoundsMm.widthMm / rawW) * (mult / 1000);
  const scaleY = (targetBoundsMm.heightMm / rawH) * (mult / 1000);
  const scaleZ = (targetBoundsMm.depthMm / rawD) * (mult / 1000);

  // Wrap or adjust model local transform so center XZ = 0, min Y = 0
  model.scale.set(model.scale.x * scaleX, model.scale.y * scaleY, model.scale.z * scaleZ);
  model.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(model);
  const scaledCenter = new THREE.Vector3();
  scaledBox.getCenter(scaledCenter);
  model.position.x -= scaledCenter.x;
  model.position.z -= scaledCenter.z;
  model.position.y -= scaledBox.min.y;
}

export function needsRepresentationRegeneration(furn: FurnitureInstance): boolean {
  const mode = resolveEffectiveRepresentationMode(furn);

  if (mode === 'default') {
    // Hydrate defaultViews.top only if an imported svgSource exists and hasn't been parsed yet
    if (typeof furn.svgSource === 'string' && isValidSvgSource(furn.svgSource)) {
      const topDefault = furn.representation?.defaultViews?.top;
      if (!topDefault || !topDefault.elements || topDefault.elements.length === 0) {
        return true;
      }
    }
    return false;
  }

  const expectedSig = computeFurnitureGeometrySignature(furn, mode);
  const av = furn.representation?.autoViews;
  if (!av || !av.top || !av.front || !av.rear || !av.left || !av.right) {
    return true;
  }
  return furn.representation?.geometrySignature !== expectedSig;
}

export async function computeFurnitureRepresentationAsync(
  furn: FurnitureInstance,
  options?: {
    mode?: RepresentationMode;
    useMaterialFill?: boolean;
    strokeWidthMm?: number;
    preserveCustomViews?: boolean;
  }
): Promise<FurnitureRepresentation> {
  const canDefault = hasValidDefaultSvg(furn);
  const requestedMode = options?.mode ?? resolveEffectiveRepresentationMode(furn);
  const mode: RepresentationMode =
    requestedMode === 'default' && !canDefault ? 'silhouette' : requestedMode;

  const useMaterialFill = options?.useMaterialFill ?? furn.representation?.useMaterialFill ?? false;
  const strokeWidthMm = options?.strokeWidthMm ?? furn.representation?.strokeWidthMm ?? 12;
  const preserveCustom = options?.preserveCustomViews !== false;
  const existingCustomViews = preserveCustom ? furn.representation?.customViews : undefined;
  const existingCustomViewUpdatedAt = preserveCustom
    ? furn.representation?.customViewUpdatedAt
    : undefined;

  const bounds = computeFurnitureBoundsMm(furn.parts);

  // Never overwrite existing immutable defaultViews; only hydrate from svgSource if missing
  let nextDefaultViews = furn.representation?.defaultViews;
  if (
    (!nextDefaultViews?.top || nextDefaultViews.top.elements.length === 0) &&
    typeof furn.svgSource === 'string' &&
    isValidSvgSource(furn.svgSource)
  ) {
    const parsed = parseSvgSourceToProjectedView(furn.svgSource, bounds.widthMm, bounds.depthMm);
    if (parsed) {
      nextDefaultViews = {
        ...(nextDefaultViews ?? {}),
        top: parsed.view,
      };
    }
  }

  if (mode === 'default') {
    return {
      mode: 'default',
      useMaterialFill,
      strokeWidthMm,
      geometrySignature: furn.representation?.geometrySignature,
      sourceBoundsMm: furn.representation?.sourceBoundsMm ?? {
        widthMm: bounds.widthMm,
        depthMm: bounds.depthMm,
        heightMm: bounds.heightMm,
      },
      defaultViews: nextDefaultViews,
      autoViews: furn.representation?.autoViews,
      customViews: existingCustomViews,
      customViewUpdatedAt: existingCustomViewUpdatedAt,
    };
  }

  if (furn.glbAssetId || furn.glbDataUrl) {
    const obj = await loadGlbObjectCached(
      furn.glbAssetId,
      furn.glbDataUrl ?? getGlbAssetSync(furn.glbAssetId) ?? undefined
    );
    if (obj) {
      return generateRepresentationFromObject3D(obj, {
        glbAssetId: furn.glbAssetId,
        glbDataUrl: furn.glbDataUrl,
        partsForBounds: furn.parts,
        mode,
        useMaterialFill,
        strokeWidthMm,
        rotationXDeg: furn.rotationXDeg,
        rotationYDeg: furn.rotationYDeg,
        mountingType: resolveFurnitureMountingType(furn),
        mountingFace: resolveFurnitureMountingFace(furn),
        existingDefaultViews: nextDefaultViews,
        existingCustomViews,
        existingCustomViewUpdatedAt,
      });
    }
  }

  return generateRepresentationFromParts(furn.parts, {
    mode,
    useMaterialFill,
    strokeWidthMm,
    rotationXDeg: furn.rotationXDeg,
    rotationYDeg: furn.rotationYDeg,
    existingDefaultViews: nextDefaultViews,
    existingCustomViews,
    existingCustomViewUpdatedAt,
  });
}

export function getFurnitureTargetBoundsMm(furn: FurnitureInstance) {
  return computeFurnitureBoundsMm(furn.parts);
}
