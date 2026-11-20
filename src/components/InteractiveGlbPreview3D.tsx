import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Moon, RotateCcw, Sun } from 'lucide-react';
import {
  FurnitureInstance,
  FurnitureLightSource,
  GlbMaterialEmissiveOverride,
  MountingFace,
  MountingType,
} from '../types/plan';
import {
  fitGlbSceneToFurnitureBounds,
  loadGlbObjectCached,
} from '../utils/furnitureRepresentationSync';
import { buildProceduralFurnitureGroup } from '../utils/furniture3d';
import {
  applyGlbEmissiveOverrides,
  buildThreeLightsForFurniture,
  computeLightOrientationQuaternionThree,
  isFurnitureLightingActive,
  kelvinToThreeColor,
  resolveEffectiveFurnitureLights,
  resolveLightSourceHex,
} from '../utils/lighting';
import { computeFurnitureBoundsMm } from '../utils/geometry';

interface InteractiveGlbPreview3DProps {
  furn: FurnitureInstance;
  /** Optional already-parsed THREE.Object3D (used during GLB import before reload) */
  glbScene?: THREE.Object3D | null;
  mountingType: MountingType;
  mountingFace: MountingFace;
  /** Material key (GLB) or Part ID (procedural) currently selected -> highlighted in blue */
  selectedMaterialKey?: string | null;
  /** Optional studio backdrop override; if omitted, uses internal Studio/Night toggle */
  backdropMode?: 'day' | 'night';
  onBackdropModeChange?: (mode: 'day' | 'night') => void;
  /** Interactive 3D light markers & 3-axis + Yaw/Pitch/Roll gizmo */
  showLightGizmo?: boolean;
  selectedLightId?: string | null;
  onSelectLightId?: (lightId: string | null) => void;
  onUpdateLight?: (
    lightId: string,
    patch: Partial<FurnitureLightSource>,
    label?: string,
    coalesceKey?: string
  ) => void;
  locked?: boolean;
  className?: string;
}

type GizmoHandleMeta =
  | {
      kind: 'select_light';
      lightId: string;
    }
  | {
      kind: 'axis';
      lightId: string;
      axisField: 'xMm' | 'yMm' | 'zMm';
      axisLabel: 'X' | 'Y' | 'Z';
      localDir: THREE.Vector3;
      baseColor: number;
      hoverColor: number;
      visualMats: THREE.MeshBasicMaterial[];
    }
  | {
      kind: 'yaw';
      lightId: string;
      baseColor: number;
      hoverColor: number;
      visualMats: THREE.MeshBasicMaterial[];
    }
  | {
      kind: 'pitch';
      lightId: string;
      baseColor: number;
      hoverColor: number;
      visualMats: THREE.MeshBasicMaterial[];
    }
  | {
      kind: 'roll';
      lightId: string;
      baseColor: number;
      hoverColor: number;
      visualMats: THREE.MeshBasicMaterial[];
    };

type ActiveGizmoDrag =
  | {
      kind: 'axis';
      lightId: string;
      axisField: 'xMm' | 'yMm' | 'zMm';
      axisLabel: 'X' | 'Y' | 'Z';
      originWorld: THREE.Vector3;
      axisWorld: THREE.Vector3;
      dragPlane: THREE.Plane;
      startT: number;
      startValMm: number;
      screenDirX: number;
      screenDirY: number;
      startClientX: number;
      startClientY: number;
      useScreenFallback: boolean;
      worldUnitsPerPx: number;
    }
  | {
      kind: 'yaw';
      lightId: string;
      originWorld: THREE.Vector3;
      plane: THREE.Plane;
      mx: number;
      my: number;
      startAzimuthDeg: number;
      startPointerAngleDeg: number;
      startClientX: number;
      useScreenFallback: boolean;
    }
  | {
      kind: 'pitch';
      lightId: string;
      originWorld: THREE.Vector3;
      plane: THREE.Plane;
      horizWorld: THREE.Vector3;
      upWorld: THREE.Vector3;
      startElevationDeg: number;
      startPointerElevDeg: number;
      startClientY: number;
      useScreenFallback: boolean;
    }
  | {
      kind: 'roll';
      lightId: string;
      originWorld: THREE.Vector3;
      plane: THREE.Plane;
      rightWorld: THREE.Vector3;
      upWorld: THREE.Vector3;
      mirrorFlip: number;
      startRollDeg: number;
      startPointerAngleDeg: number;
      startClientX: number;
      useScreenFallback: boolean;
    };

function deterministicMatKey(index: number, mat: THREE.Material, mesh: THREE.Mesh): string {
  const rawName = (mat.name || mesh.name || `material_${index}`).trim();
  const safe =
    rawName
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 36) || `mat_${index}`;
  return `mat_${index}_${safe}`;
}

function normalizeDeg180(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  return Math.round(d);
}

function makeAxisLabelSprite(label: string, colorHex: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 64, 64);
    ctx.beginPath();
    ctx.arc(32, 32, 23, 0, Math.PI * 2);
    ctx.fillStyle = colorHex;
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.font = '700 28px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, 32, 33);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 960;
  return sprite;
}

function disposeGroupContents(group: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (mat) {
      const arr = Array.isArray(mat) ? mat : [mat];
      for (const m of arr) {
        materials.add(m);
        const sm = m as THREE.SpriteMaterial;
        if (sm.map) textures.add(sm.map);
      }
    }
  });

  while (group.children.length > 0) {
    group.remove(group.children[0]);
  }
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  for (const t of textures) t.dispose();
}

export const InteractiveGlbPreview3D: React.FC<InteractiveGlbPreview3DProps> = ({
  furn,
  glbScene,
  mountingType,
  mountingFace,
  selectedMaterialKey = null,
  backdropMode,
  onBackdropModeChange,
  showLightGizmo = false,
  selectedLightId = null,
  onSelectLightId,
  onUpdateLight,
  locked = false,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [internalBackdrop, setInternalBackdrop] = useState<'day' | 'night'>('day');
  const activeBackdrop = backdropMode ?? internalBackdrop;
  const setBackdrop = (next: 'day' | 'night') => {
    setInternalBackdrop(next);
    onBackdropModeChange?.(next);
  };

  const [webglError, setWebglError] = useState(false);
  const [modelReadyTick, setModelReadyTick] = useState(0);
  const [dragReadout, setDragReadout] = useState<string | null>(null);
  const [hoveredKind, setHoveredKind] = useState<string | null>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const subjectRootRef = useRef<THREE.Group | null>(null);
  const tiltGroupRef = useRef<THREE.Group | null>(null);
  const lightsOverlayGroupRef = useRef<THREE.Group | null>(null);
  const stageGroupRef = useRef<THREE.Group | null>(null);
  const backdropRefs = useRef<{
    hemi: THREE.HemisphereLight;
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
    floorMat: THREE.MeshStandardMaterial;
    wallMat: THREE.MeshStandardMaterial;
  } | null>(null);

  const hasFramedRef = useRef(false);
  const resetCamRef = useRef<() => void>(() => {});
  const requestRenderRef = useRef<() => void>(() => {});
  const gizmoScaleRef = useRef<number>(0.24);
  const interactiveHandlesRef = useRef<THREE.Object3D[]>([]);
  const billboardObjectsRef = useRef<THREE.Object3D[]>([]);
  const activeDragRef = useRef<ActiveGizmoDrag | null>(null);
  const hoveredHandleRef = useRef<GizmoHandleMeta | null>(null);

  // Latest props refs for zero-stale pointer handlers
  const furnRef = useRef(furn);
  furnRef.current = furn;
  const showLightGizmoRef = useRef(showLightGizmo);
  showLightGizmoRef.current = showLightGizmo;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const onSelectLightIdRef = useRef(onSelectLightId);
  onSelectLightIdRef.current = onSelectLightId;
  const onUpdateLightRef = useRef(onUpdateLight);
  onUpdateLightRef.current = onUpdateLight;

  // 1. Initialize WebGLRenderer, OrbitControls, Three-Point Studio Rig, Stage & Gizmo Pointer Handling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
    } catch {
      setWebglError(true);
      return;
    }

    RectAreaLightUniformsLib.init();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const initW = Math.max(240, el.clientWidth || 360);
    const initH = Math.max(220, el.clientHeight || 300);
    renderer.setSize(initW, initH, false);
    el.innerHTML = '';
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#F1F5F9');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, initW / initH, 0.02, 80);
    camera.position.set(1.4, 1.0, 1.6);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.enablePan = false;
    controls.minDistance = 0.25;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controlsRef.current = controls;

    // Studio three-point rig (key warm, fill cool, rim separation + ambient hemi)
    const hemi = new THREE.HemisphereLight(0xf8fafc, 0x94a3b8, 0.55);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfffaf0, 1.35);
    key.position.set(2.5, 3.8, 2.8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.01;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xdbeafe, 0.45);
    fill.position.set(-2.6, 1.6, 2.0);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xe2e8f0, 0.4);
    rim.position.set(-1.5, 2.6, -2.8);
    scene.add(rim);

    // Architectural studio plinth floor (open 360° orbit with zero near-clipping vertical walls)
    const stageGroup = new THREE.Group();
    const floorGeo = new THREE.CircleGeometry(4.5, 48);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.9,
      metalness: 0.02,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    floor.receiveShadow = true;
    stageGroup.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.92,
      metalness: 0,
    });

    const grid = new THREE.GridHelper(4.8, 24, 0xcbd5e1, 0xe2e8f0);
    grid.position.y = 0.001;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    stageGroup.add(grid);

    scene.add(stageGroup);
    stageGroupRef.current = stageGroup;

    backdropRefs.current = { hemi, key, fill, rim, floorMat, wallMat };

    const subjectRoot = new THREE.Group();
    scene.add(subjectRoot);
    subjectRootRef.current = subjectRoot;

    // Gizmo Raycasting & Axis-Constrained Drag Handlers
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const tmpHit = new THREE.Vector3();
    const tmpCamDir = new THREE.Vector3();
    const tmpProj0 = new THREE.Vector3();
    const tmpProj1 = new THREE.Vector3();
    const tmpAxisVec = new THREE.Vector3();

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    };

    const setHoverColor = (meta: GizmoHandleMeta | null, highlighted: boolean) => {
      if (!meta || meta.kind === 'select_light') return;
      const colorVal = highlighted ? meta.hoverColor : meta.baseColor;
      for (const m of meta.visualMats) {
        m.color.setHex(colorVal);
        m.opacity = highlighted ? 1.0 : 0.88;
      }
    };

    const findGizmoMeta = (clientX: number, clientY: number): { meta: GizmoHandleMeta; point: THREE.Vector3 } | null => {
      if (!showLightGizmoRef.current || interactiveHandlesRef.current.length === 0) return null;
      updateNdc(clientX, clientY);
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(interactiveHandlesRef.current, false);
      if (hits.length === 0) return null;

      // Prioritize gizmo manipulation handles over generic light-select orbs
      const prioritized =
        hits.find((h) => (h.object.userData?.gizmoMeta as GizmoHandleMeta | undefined)?.kind !== 'select_light') ??
        hits[0];
      const meta = prioritized.object.userData?.gizmoMeta as GizmoHandleMeta | undefined;
      return meta ? { meta, point: prioritized.point.clone() } : null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !showLightGizmoRef.current) return;
      const picked = findGizmoMeta(e.clientX, e.clientY);
      if (!picked) return;

      const { meta } = picked;
      const currentFurn = furnRef.current;
      const lights = resolveEffectiveFurnitureLights(currentFurn);
      const targetLight = lights.find((l) => l.id === meta.lightId);
      if (!targetLight) return;

      if (meta.kind === 'select_light') {
        e.stopPropagation();
        onSelectLightIdRef.current?.(targetLight.id);
        return;
      }

      if (lockedRef.current) return;

      const tiltGroup = tiltGroupRef.current;
      if (!tiltGroup) return;
      tiltGroup.updateMatrixWorld(true);

      const mx = currentFurn.mirroredX ? -1 : 1;
      const my = currentFurn.mirroredY ? -1 : 1;
      const originLocal = new THREE.Vector3(
        (targetLight.xMm * mx) / 1000,
        targetLight.zMm / 1000,
        (targetLight.yMm * my) / 1000
      );
      const originWorld = originLocal.clone().applyMatrix4(tiltGroup.matrixWorld);
      const worldRotQuat = new THREE.Quaternion();
      tiltGroup.getWorldQuaternion(worldRotQuat);

      updateNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(pointerNdc, camera);
      camera.getWorldDirection(tmpCamDir);

      if (meta.kind === 'axis') {
        const axisWorld = meta.localDir.clone().applyQuaternion(worldRotQuat).normalize();
        let planeNormal = new THREE.Vector3().crossVectors(axisWorld, tmpCamDir);
        if (planeNormal.lengthSq() < 1e-5) {
          planeNormal = new THREE.Vector3().crossVectors(axisWorld, new THREE.Vector3(0, 1, 0));
          if (planeNormal.lengthSq() < 1e-5) planeNormal.set(1, 0, 0);
        }
        planeNormal.cross(axisWorld).normalize();
        const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, originWorld);

        const rayHit = raycaster.ray.intersectPlane(dragPlane, tmpHit);
        const startT = rayHit ? tmpHit.clone().sub(originWorld).dot(axisWorld) : 0;
        const useScreenFallback = !rayHit || Math.abs(raycaster.ray.direction.dot(planeNormal)) < 0.08;

        // Compute screen-space axis projection for fallback if camera views edge-on
        const rect = renderer.domElement.getBoundingClientRect();
        tmpProj0.copy(originWorld).project(camera);
        tmpProj1.copy(originWorld).addScaledVector(axisWorld, 0.25).project(camera);
        const sdx = ((tmpProj1.x - tmpProj0.x) * rect.width) / 2;
        const sdy = -((tmpProj1.y - tmpProj0.y) * rect.height) / 2;
        const sLen = Math.hypot(sdx, sdy) || 1;
        const distToCam = camera.position.distanceTo(originWorld);
        const worldUnitsPerPx =
          (2 * distToCam * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) /
          Math.max(1, rect.height);

        activeDragRef.current = {
          kind: 'axis',
          lightId: targetLight.id,
          axisField: meta.axisField,
          axisLabel: meta.axisLabel,
          originWorld,
          axisWorld,
          dragPlane,
          startT,
          startValMm: targetLight[meta.axisField],
          screenDirX: sdx / sLen,
          screenDirY: sdy / sLen,
          startClientX: e.clientX,
          startClientY: e.clientY,
          useScreenFallback,
          worldUnitsPerPx,
        };
        setDragReadout(`${meta.axisLabel}: ${Math.round(targetLight[meta.axisField])} mm`);
      } else if (meta.kind === 'yaw') {
        const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(worldRotQuat).normalize();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(upWorld, originWorld);
        const rayHit = raycaster.ray.intersectPlane(plane, tmpHit);
        const useScreenFallback = !rayHit || Math.abs(raycaster.ray.direction.dot(upWorld)) < 0.09;
        let startPointerAngleDeg = targetLight.aimAzimuthDeg ?? 0;
        if (rayHit) {
          const invWorld = tiltGroup.matrixWorld.clone().invert();
          const localHit = tmpHit.clone().applyMatrix4(invWorld).sub(originLocal);
          startPointerAngleDeg = THREE.MathUtils.radToDeg(
            Math.atan2(localHit.x * mx, localHit.z * my)
          );
        }
        activeDragRef.current = {
          kind: 'yaw',
          lightId: targetLight.id,
          originWorld,
          plane,
          mx,
          my,
          startAzimuthDeg: targetLight.aimAzimuthDeg ?? 0,
          startPointerAngleDeg,
          startClientX: e.clientX,
          useScreenFallback,
        };
        setDragReadout(`Yaw: ${Math.round(targetLight.aimAzimuthDeg ?? 0)}°`);
      } else if (meta.kind === 'pitch') {
        const azRad = THREE.MathUtils.degToRad(targetLight.aimAzimuthDeg ?? 0);
        const horizLocal = new THREE.Vector3(Math.sin(azRad) * mx, 0, Math.cos(azRad) * my).normalize();
        const upLocal = new THREE.Vector3(0, 1, 0);
        const horizWorld = horizLocal.applyQuaternion(worldRotQuat).normalize();
        const upWorld = upLocal.applyQuaternion(worldRotQuat).normalize();
        const planeNormal = new THREE.Vector3().crossVectors(horizWorld, upWorld).normalize();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, originWorld);
        const rayHit = raycaster.ray.intersectPlane(plane, tmpHit);
        const useScreenFallback = !rayHit || Math.abs(raycaster.ray.direction.dot(planeNormal)) < 0.09;
        let startPointerElevDeg = targetLight.aimElevationDeg ?? -75;
        if (rayHit) {
          const rel = tmpHit.clone().sub(originWorld);
          const fComp = Math.max(1e-4, rel.dot(horizWorld));
          const uComp = rel.dot(upWorld);
          startPointerElevDeg = THREE.MathUtils.radToDeg(Math.atan2(uComp, fComp));
        }
        activeDragRef.current = {
          kind: 'pitch',
          lightId: targetLight.id,
          originWorld,
          plane,
          horizWorld,
          upWorld,
          startElevationDeg: targetLight.aimElevationDeg ?? -75,
          startPointerElevDeg,
          startClientY: e.clientY,
          useScreenFallback,
        };
        setDragReadout(`Pitch: ${Math.round(targetLight.aimElevationDeg ?? -75)}°`);
      } else if (meta.kind === 'roll') {
        const basis = computeLightOrientationQuaternionThree(
          targetLight.aimAzimuthDeg ?? 0,
          targetLight.aimElevationDeg ?? -75,
          0,
          currentFurn.mirroredX,
          currentFurn.mirroredY
        );
        const dirWorld = basis.dir.clone().applyQuaternion(worldRotQuat).normalize();
        const rightWorld = basis.right.clone().applyQuaternion(worldRotQuat).normalize();
        const upWorld = basis.up.clone().applyQuaternion(worldRotQuat).normalize();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dirWorld, originWorld);
        const rayHit = raycaster.ray.intersectPlane(plane, tmpHit);
        const useScreenFallback = !rayHit || Math.abs(raycaster.ray.direction.dot(dirWorld)) < 0.09;
        let startPointerAngleDeg = targetLight.aimRollDeg ?? 0;
        if (rayHit) {
          const rel = tmpHit.clone().sub(originWorld);
          startPointerAngleDeg = THREE.MathUtils.radToDeg(
            Math.atan2(rel.dot(upWorld), rel.dot(rightWorld))
          );
        }
        activeDragRef.current = {
          kind: 'roll',
          lightId: targetLight.id,
          originWorld,
          plane,
          rightWorld,
          upWorld,
          mirrorFlip: mx * my < 0 ? -1 : 1,
          startRollDeg: targetLight.aimRollDeg ?? 0,
          startPointerAngleDeg,
          startClientX: e.clientX,
          useScreenFallback,
        };
        setDragReadout(`Roll: ${Math.round(targetLight.aimRollDeg ?? 0)}°`);
      }

      if (activeDragRef.current) {
        e.stopImmediatePropagation();
        e.preventDefault();
        controls.enabled = false;
        renderer.domElement.setPointerCapture?.(e.pointerId);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = activeDragRef.current;
      if (drag) {
        e.preventDefault();
        const currentFurn = furnRef.current;
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);

        if (drag.kind === 'axis') {
          let deltaM = 0;
          if (!drag.useScreenFallback && raycaster.ray.intersectPlane(drag.dragPlane, tmpHit)) {
            const currentT = tmpAxisVec.copy(tmpHit).sub(drag.originWorld).dot(drag.axisWorld);
            deltaM = currentT - drag.startT;
          } else {
            const pxDelta =
              (e.clientX - drag.startClientX) * drag.screenDirX +
              (e.clientY - drag.startClientY) * drag.screenDirY;
            deltaM = pxDelta * drag.worldUnitsPerPx;
          }
          const deltaMm = Math.round(deltaM * 1000);
          const minMm = drag.axisField === 'zMm' ? -500 : -4000;
          const nextMm = Math.max(minMm, Math.min(4000, Math.round(drag.startValMm + deltaMm)));
          setDragReadout(`${drag.axisLabel}: ${nextMm} mm`);
          onUpdateLightRef.current?.(
            drag.lightId,
            { [drag.axisField]: nextMm },
            `Move Light ${drag.axisLabel}`,
            `gizmo_${drag.axisField}_${drag.lightId}`
          );
        } else if (drag.kind === 'yaw') {
          let nextAz = drag.startAzimuthDeg;
          const tiltGroup = tiltGroupRef.current;
          if (!drag.useScreenFallback && tiltGroup && raycaster.ray.intersectPlane(drag.plane, tmpHit)) {
            const invWorld = tiltGroup.matrixWorld.clone().invert();
            const invOrigin = drag.originWorld.clone().applyMatrix4(invWorld);
            const localHit = tmpHit.clone().applyMatrix4(invWorld).sub(invOrigin);
            if (Math.hypot(localHit.x, localHit.z) > 0.008) {
              const curAngleDeg = THREE.MathUtils.radToDeg(
                Math.atan2(localHit.x * drag.mx, localHit.z * drag.my)
              );
              const delta = curAngleDeg - drag.startPointerAngleDeg;
              nextAz = normalizeDeg180(drag.startAzimuthDeg + delta);
            }
          } else {
            const deltaDeg = (e.clientX - drag.startClientX) * 0.9;
            nextAz = normalizeDeg180(drag.startAzimuthDeg + deltaDeg);
          }
          setDragReadout(`Yaw: ${nextAz}°`);
          onUpdateLightRef.current?.(
            drag.lightId,
            { aimAzimuthDeg: nextAz },
            'Rotate Light Yaw',
            `gizmo_yaw_${drag.lightId}`
          );
        } else if (drag.kind === 'pitch') {
          let nextEl = drag.startElevationDeg;
          if (!drag.useScreenFallback && raycaster.ray.intersectPlane(drag.plane, tmpHit)) {
            const rel = tmpHit.clone().sub(drag.originWorld);
            const fComp = Math.max(1e-4, rel.dot(drag.horizWorld));
            const uComp = rel.dot(drag.upWorld);
            const curElevDeg = THREE.MathUtils.radToDeg(Math.atan2(uComp, fComp));
            nextEl = Math.max(-90, Math.min(90, Math.round(drag.startElevationDeg + (curElevDeg - drag.startPointerElevDeg))));
          } else {
            const deltaDeg = -(e.clientY - drag.startClientY) * 0.8;
            nextEl = Math.max(-90, Math.min(90, Math.round(drag.startElevationDeg + deltaDeg)));
          }
          setDragReadout(`Pitch: ${nextEl}°`);
          onUpdateLightRef.current?.(
            drag.lightId,
            { aimElevationDeg: nextEl },
            'Tilt Light Pitch',
            `gizmo_pitch_${drag.lightId}`
          );
        } else if (drag.kind === 'roll') {
          let nextRoll = drag.startRollDeg;
          if (!drag.useScreenFallback && raycaster.ray.intersectPlane(drag.plane, tmpHit)) {
            const rel = tmpHit.clone().sub(drag.originWorld);
            const xProj = rel.dot(drag.rightWorld);
            const yProj = rel.dot(drag.upWorld);
            if (Math.hypot(xProj, yProj) > 0.008) {
              const curAngle = THREE.MathUtils.radToDeg(Math.atan2(yProj, xProj));
              const delta = (curAngle - drag.startPointerAngleDeg) * drag.mirrorFlip;
              nextRoll = normalizeDeg180(drag.startRollDeg + delta);
            }
          } else {
            const deltaDeg = (e.clientX - drag.startClientX) * 0.9;
            nextRoll = normalizeDeg180(drag.startRollDeg + deltaDeg);
          }
          setDragReadout(`Roll: ${nextRoll}°`);
          onUpdateLightRef.current?.(
            drag.lightId,
            { aimRollDeg: nextRoll },
            'Roll Light',
            `gizmo_roll_${drag.lightId}`
          );
          void currentFurn;
        }
        return;
      }

      // Hover feedback only when pointer buttons are not held (prevents React churn during camera orbit)
      if (e.buttons !== 0) return;
      const picked = findGizmoMeta(e.clientX, e.clientY);
      const prevHover = hoveredHandleRef.current;
      if (prevHover !== (picked?.meta ?? null)) {
        if (prevHover) setHoverColor(prevHover, false);
        if (picked?.meta) setHoverColor(picked.meta, true);
        hoveredHandleRef.current = picked?.meta ?? null;
        if (!picked) {
          setHoveredKind(null);
        } else if (picked.meta.kind === 'axis') {
          setHoveredKind(`Move ${picked.meta.axisLabel}`);
        } else if (picked.meta.kind === 'yaw') {
          setHoveredKind('Yaw (Horizontal)');
        } else if (picked.meta.kind === 'pitch') {
          setHoveredKind('Pitch (Vertical Tilt)');
        } else if (picked.meta.kind === 'roll') {
          setHoveredKind('Roll');
        } else {
          setHoveredKind('Select Light');
        }
        requestRenderRef.current();
      }
    };

    const endDrag = (e: PointerEvent) => {
      if (activeDragRef.current) {
        activeDragRef.current = null;
        controls.enabled = true;
        setDragReadout(null);
        try {
          renderer.domElement.releasePointerCapture?.(e.pointerId);
        } catch {
          // ignore if capture already released
        }
        requestRenderRef.current();
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    let rafId = 0;
    let alive = true;
    let needsRender = true;

    const tick = () => {
      if (!alive) return;
      rafId = requestAnimationFrame(tick);
      if (controls.update() || needsRender) {
        for (const obj of billboardObjectsRef.current) {
          obj.quaternion.copy(camera.quaternion);
        }
        renderer.render(scene, camera);
        needsRender = false;
      }
    };
    requestRenderRef.current = () => {
      needsRender = true;
    };
    rafId = requestAnimationFrame(tick);

    const onChange = () => {
      needsRender = true;
    };
    controls.addEventListener('change', onChange);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(180, Math.round(entry.contentRect.width));
        const h = Math.max(180, Math.round(entry.contentRect.height));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        renderer.render(scene, camera);
        needsRender = false;
      }
    });
    ro.observe(el);

    const onContextLost = (e: Event) => {
      e.preventDefault();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.removeEventListener('change', onChange);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      controls.dispose();
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      subjectRootRef.current = null;
      tiltGroupRef.current = null;
      lightsOverlayGroupRef.current = null;
    };
  }, []);

  // 2. Sync Studio (Day) / Night backdrop lighting cleanly
  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const refs = backdropRefs.current;
    if (!scene || !renderer || !refs) return;

    const isNight = activeBackdrop === 'night';
    scene.background = new THREE.Color(isNight ? '#0B1220' : '#F1F5F9');
    renderer.toneMappingExposure = isNight ? 0.94 : 0.98;

    refs.hemi.intensity = isNight ? 0.14 : 0.58;
    refs.hemi.color.setHex(isNight ? 0x1e293b : 0xf8fafc);
    refs.hemi.groundColor.setHex(isNight ? 0x090d16 : 0x94a3b8);

    refs.key.intensity = isNight ? 0.16 : 1.32;
    refs.key.color.setHex(isNight ? 0x93c5fd : 0xfffaf0);

    refs.fill.intensity = isNight ? 0.08 : 0.45;
    refs.rim.intensity = isNight ? 0.14 : 0.38;

    refs.floorMat.color.setHex(isNight ? 0x111827 : 0xe2e8f0);
    refs.wallMat.color.setHex(isNight ? 0x162033 : 0xf1f5f9);
    requestRenderRef.current();
  }, [activeBackdrop]);

  // 3. Rebuild Model Geometry, Materials & Blue Selection Highlight (decoupled from furn.lights drag updates)
  useEffect(() => {
    const subjectRoot = subjectRootRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const stageGroup = stageGroupRef.current;
    if (!subjectRoot || !camera || !controls) return;

    let active = true;
    const nightMix = activeBackdrop === 'night' ? 1 : 0;
    const lightingActive = isFurnitureLightingActive(furn);
    const bounds = computeFurnitureBoundsMm(furn.parts);

    // Clear previous subject children cleanly
    while (subjectRoot.children.length > 0) {
      subjectRoot.remove(subjectRoot.children[0]);
    }
    tiltGroupRef.current = null;
    lightsOverlayGroupRef.current = null;

    const frameSubject = (obj: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      if (box.isEmpty()) {
        size.set(
          Math.max(0.2, bounds.widthMm / 1000),
          Math.max(0.2, bounds.heightMm / 1000),
          Math.max(0.2, bounds.depthMm / 1000)
        );
        center.set(0, size.y / 2, 0);
      } else {
        box.getSize(size);
        box.getCenter(center);
      }
      if (stageGroup) {
        const minY = Number.isFinite(box.min.y) ? box.min.y : 0;
        stageGroup.position.set(0, minY, 0);
      }
      const radius = Math.max(0.22, size.length() * 0.55);
      gizmoScaleRef.current = Math.max(0.55, Math.min(1.65, radius * 1.15));
      const fovRad = (camera.fov * Math.PI) / 180;
      const distCam = Math.max(0.45, (radius / Math.sin(fovRad / 2)) * 1.18);

      const applyFraming = () => {
        controls.target.copy(center);
        camera.position.set(
          center.x + distCam * 0.65,
          center.y + distCam * 0.42,
          center.z + distCam * 0.72
        );
        controls.minDistance = Math.max(0.18, radius * 0.55);
        controls.maxDistance = Math.max(6, distCam * 3.8);
        controls.update();
        requestRenderRef.current();
      };

      resetCamRef.current = applyFraming;
      if (!hasFramedRef.current) {
        hasFramedRef.current = true;
        applyFraming();
      }
    };

    const applyBlueHighlightToGlb = (model: THREE.Object3D, keyToHighlight: string | null) => {
      if (!keyToHighlight) return;
      const origToKey = new Map<THREE.Material, string>();
      const highlightedMats = new Set<THREE.Material>();
      let idx = 0;
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (!m) continue;
          let key = origToKey.get(m);
          if (!key) {
            key = deterministicMatKey(idx, m, mesh);
            origToKey.set(m, key);
            idx += 1;
          }
          if (key === keyToHighlight && !highlightedMats.has(m)) {
            highlightedMats.add(m);
            const std = m as THREE.MeshStandardMaterial;
            if ('color' in std && std.color) {
              std.color.lerp(new THREE.Color('#3B82F6'), 0.52);
            }
            if ('emissive' in std) {
              std.emissive = new THREE.Color('#2563EB');
              std.emissiveIntensity = 0.72;
            }
            std.needsUpdate = true;
          }
        }
      });
    };

    const isGlb = Boolean(glbScene || furn.glbAssetId || furn.glbDataUrl);
    if (isGlb) {
      const loadModel = async () => {
        const source = glbScene
          ? glbScene.clone(true)
          : await loadGlbObjectCached(furn.glbAssetId, furn.glbDataUrl);
        if (!active || !source) return;

        const tiltGroup = new THREE.Group();
        const mirrorGroup = new THREE.Group();
        mirrorGroup.scale.set(furn.mirroredX ? -1 : 1, 1, furn.mirroredY ? -1 : 1);
        tiltGroup.add(mirrorGroup);

        fitGlbSceneToFurnitureBounds(source, bounds, { mountingType, mountingFace });
        source.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            if (mesh.geometry && !mesh.geometry.attributes.normal) {
              mesh.geometry.computeVertexNormals();
            }
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });

        applyGlbEmissiveOverrides(
          source,
          furn.glbEmissiveOverrides as GlbMaterialEmissiveOverride[] | undefined,
          nightMix,
          undefined,
          lightingActive
        );
        applyBlueHighlightToGlb(source, selectedMaterialKey);

        mirrorGroup.add(source);

        const lightsOverlay = new THREE.Group();
        lightsOverlay.name = 'PreviewLightsAndGizmo';
        tiltGroup.add(lightsOverlay);

        subjectRoot.add(tiltGroup);
        tiltGroupRef.current = tiltGroup;
        lightsOverlayGroupRef.current = lightsOverlay;
        frameSubject(mirrorGroup);
        setModelReadyTick((t) => t + 1);
        requestRenderRef.current();
      };
      void loadModel();
    } else {
      const built = buildProceduralFurnitureGroup(furn, {
        matOpts: { maxAnisotropy: 4, isSoftwareGl: false },
        castShadows: true,
        clippingPlanes: [],
        nightMix,
        partEdgeMat: new THREE.LineBasicMaterial({
          color: '#94A3B8',
          transparent: true,
          opacity: 0.25,
        }),
        kelvinToColor: kelvinToThreeColor,
        effectiveCeilingMm: bounds.heightMm + 600,
        isSoftwareGl: false,
      });

      // Reset world placement to local origin for inspection preview
      built.group.position.set(0, 0, 0);
      built.group.rotation.set(0, 0, 0);

      // Highlight selected parametric part in blue if chosen
      if (selectedMaterialKey) {
        const partIdx = furn.parts.findIndex((p) => p.id === selectedMaterialKey);
        if (partIdx >= 0) {
          const targetPart = furn.parts[partIdx];
          built.group.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh) return;
            const px = targetPart.xMm / 1000;
            const pz = targetPart.yMm / 1000;
            const py = (targetPart.zMm + targetPart.heightMm / 2) / 1000;
            if (
              Math.abs(mesh.position.x - px) < 0.025 &&
              Math.abs(mesh.position.y - py) < 0.025 &&
              Math.abs(mesh.position.z - pz) < 0.025
            ) {
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const rawMat of mats) {
                if (!rawMat) continue;
                const std = (rawMat as THREE.MeshStandardMaterial).clone();
                if (std.color) std.color.lerp(new THREE.Color('#3B82F6'), 0.52);
                if ('emissive' in std) {
                  std.emissive = new THREE.Color('#2563EB');
                  std.emissiveIntensity = 0.72;
                }
                mesh.material = std;
              }
            }
          });
        }
      }

      const tiltGroup = (built.group.children[0] as THREE.Group | undefined) ?? built.group;
      // Strip lights created by buildProceduralFurnitureGroup so Effect #4 owns live light + gizmo updates cleanly
      const toRemove: THREE.Object3D[] = [];
      for (const ch of tiltGroup.children) {
        if ((ch as THREE.Light).isLight || ch.name.startsWith('Light_') || ch.type === 'Object3D') {
          toRemove.push(ch);
        }
      }
      for (const r of toRemove) tiltGroup.remove(r);

      const lightsOverlay = new THREE.Group();
      lightsOverlay.name = 'PreviewLightsAndGizmo';
      tiltGroup.add(lightsOverlay);

      subjectRoot.add(built.group);
      tiltGroupRef.current = tiltGroup;
      lightsOverlayGroupRef.current = lightsOverlay;
      frameSubject(built.group);
      setModelReadyTick((t) => t + 1);
      requestRenderRef.current();
    }

    return () => {
      active = false;
    };
  }, [
    glbScene,
    furn.id,
    furn.templateId,
    furn.category,
    furn.glbAssetId,
    furn.glbDataUrl,
    furn.parts,
    furn.glbEmissiveOverrides,
    furn.lightingEnabled,
    furn.lightConfig,
    furn.mirroredX,
    furn.mirroredY,
    furn.rotationXDeg,
    furn.rotationYDeg,
    mountingType,
    mountingFace,
    selectedMaterialKey,
    activeBackdrop,
  ]);

  // 4. Lightweight Real-Time Sync for Real Lights, Visible Light Markers & 3D Positioning/Orientation Gizmo
  useEffect(() => {
    const overlay = lightsOverlayGroupRef.current;
    if (!overlay) return;

    disposeGroupContents(overlay);
    interactiveHandlesRef.current = [];
    billboardObjectsRef.current = [];

    const nightMix = activeBackdrop === 'night' ? 1 : 0;
    const lightingActive = isFurnitureLightingActive(furn);

    // Real Three.js lights
    buildThreeLightsForFurniture(furn, overlay, {
      nightMix,
      isSoftwareGl: false,
      useLegacyFillForUnmigratedLamp: true,
    });

    if (!showLightGizmo) {
      requestRenderRef.current();
      return;
    }

    const effectiveLights = resolveEffectiveFurnitureLights(furn);
    const activeLight =
      effectiveLights.find((l) => l.id === selectedLightId) ?? effectiveLights[0] ?? null;

    const mx = furn.mirroredX ? -1 : 1;
    const my = furn.mirroredY ? -1 : 1;
    const scale = gizmoScaleRef.current;
    const camera = cameraRef.current;

    // A. Visible Light Markers (for every light source)
    for (const src of effectiveLights) {
      const isSelected = activeLight?.id === src.id;
      const px = (src.xMm * mx) / 1000;
      const py = src.zMm / 1000;
      const pz = (src.yMm * my) / 1000;
      const markerHex = lightingActive && src.enabled ? resolveLightSourceHex(src) : '#94A3B8';

      const markerGroup = new THREE.Group();
      markerGroup.position.set(px, py, pz);

      // Soft outer halo (matching 2D marker translucent halo)
      const haloMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.024 * scale * (isSelected ? 1.35 : 1.0), 18, 14),
        new THREE.MeshBasicMaterial({
          color: isSelected ? '#3B82F6' : markerHex,
          transparent: true,
          opacity: isSelected ? 0.28 : 0.16,
          depthTest: false,
          depthWrite: false,
        })
      );
      haloMesh.renderOrder = 900;
      markerGroup.add(haloMesh);

      // White crisp border sphere + Colored emitter core sphere
      const rimMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.0155 * scale * (isSelected ? 1.2 : 1.0), 16, 12),
        new THREE.MeshBasicMaterial({
          color: '#FFFFFF',
          transparent: true,
          opacity: 0.96,
          depthTest: false,
          depthWrite: false,
        })
      );
      rimMesh.renderOrder = 901;
      markerGroup.add(rimMesh);

      const coreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.0115 * scale * (isSelected ? 1.2 : 1.0), 16, 12),
        new THREE.MeshBasicMaterial({
          color: markerHex,
          depthTest: false,
          depthWrite: false,
        })
      );
      coreMesh.renderOrder = 902;
      markerGroup.add(coreMesh);

      // Billboarded outer selection ring (blue for selected, muted for unselected)
      const ringMesh = new THREE.Mesh(
        new THREE.RingGeometry(
          0.022 * scale * (isSelected ? 1.22 : 0.96),
          0.0275 * scale * (isSelected ? 1.24 : 0.98),
          32
        ),
        new THREE.MeshBasicMaterial({
          color: isSelected ? '#2563EB' : markerHex,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: isSelected ? 0.98 : 0.45,
          depthTest: false,
          depthWrite: false,
        })
      );
      ringMesh.renderOrder = 903;
      if (camera) ringMesh.quaternion.copy(camera.quaternion);
      billboardObjectsRef.current.push(ringMesh);
      markerGroup.add(ringMesh);

      // Clickable hit sphere for selecting this light inside 3D preview
      const hitOrb = new THREE.Mesh(
        new THREE.SphereGeometry(0.042 * scale, 12, 10),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
        })
      );
      hitOrb.renderOrder = 899;
      hitOrb.userData.gizmoMeta = {
        kind: 'select_light',
        lightId: src.id,
      } satisfies GizmoHandleMeta;
      interactiveHandlesRef.current.push(hitOrb);
      markerGroup.add(hitOrb);

      // Directional beam & emitter-shape indicator ONLY for non-point lights
      if (src.type !== 'point') {
        const basis = computeLightOrientationQuaternionThree(
          src.aimAzimuthDeg ?? 0,
          src.aimElevationDeg ?? -75,
          src.aimRollDeg ?? 0,
          furn.mirroredX,
          furn.mirroredY
        );
        const dir = basis.dir;
        const beamLen = Math.max(0.18, Math.min(0.55, 0.34 * scale));

        if (src.type === 'spot') {
          const halfConeRad = THREE.MathUtils.degToRad(
            Math.max(8, Math.min(82, src.coneAngleDeg ?? 58))
          );
          const coneR = Math.tan(halfConeRad) * beamLen;
          const coneGeo = new THREE.ConeGeometry(coneR, beamLen, 24, 1, true);
          // Position apex at (0,0,0) pointing along +Y, then align +Y -> -dir
          coneGeo.translate(0, -beamLen / 2, 0);
          const coneGroup = new THREE.Group();
          coneGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);

          const coneFill = new THREE.Mesh(
            coneGeo,
            new THREE.MeshBasicMaterial({
              color: markerHex,
              transparent: true,
              opacity: isSelected ? 0.12 : 0.05,
              side: THREE.DoubleSide,
              depthWrite: false,
            })
          );
          coneFill.renderOrder = 880;
          coneGroup.add(coneFill);

          const rimCirclePts: THREE.Vector3[] = [];
          for (let i = 0; i <= 32; i++) {
            const a = (i / 32) * Math.PI * 2;
            rimCirclePts.push(new THREE.Vector3(Math.cos(a) * coneR, -beamLen, Math.sin(a) * coneR));
          }
          const rimGeo = new THREE.BufferGeometry().setFromPoints(rimCirclePts);
          const rimLine = new THREE.Line(
            rimGeo,
            new THREE.LineBasicMaterial({
              color: markerHex,
              transparent: true,
              opacity: isSelected ? 0.72 : 0.3,
              depthWrite: false,
            })
          );
          coneGroup.add(rimLine);
          markerGroup.add(coneGroup);
        } else {
          // Area or Linear rectangular emission frame
          const widthM = Math.max(0.06, (src.widthMm ?? (src.type === 'linear' ? 800 : 500)) / 1000);
          const heightM =
            src.type === 'linear'
              ? Math.max(0.025, (src.lengthMm ?? 45) / 1000)
              : Math.max(0.06, (src.lengthMm ?? 500) / 1000);
          const frameGroup = new THREE.Group();
          frameGroup.quaternion.copy(basis.quaternion);

          const planeGeo = new THREE.PlaneGeometry(widthM, heightM);
          const planeMesh = new THREE.Mesh(
            planeGeo,
            new THREE.MeshBasicMaterial({
              color: markerHex,
              transparent: true,
              opacity: isSelected ? 0.16 : 0.07,
              side: THREE.DoubleSide,
              depthWrite: false,
            })
          );
          planeMesh.renderOrder = 881;
          frameGroup.add(planeMesh);

          const rectEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(planeGeo),
            new THREE.LineBasicMaterial({
              color: markerHex,
              transparent: true,
              opacity: isSelected ? 0.88 : 0.42,
              depthWrite: false,
            })
          );
          frameGroup.add(rectEdges);
          markerGroup.add(frameGroup);
        }

        // Aim beam vector ray + small arrowhead
        const rayLen = beamLen * 0.92;
        const rayLineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          dir.clone().multiplyScalar(rayLen),
        ]);
        const rayLine = new THREE.Line(
          rayLineGeo,
          new THREE.LineBasicMaterial({
            color: markerHex,
            transparent: true,
            opacity: isSelected ? 0.95 : 0.45,
            depthTest: false,
            depthWrite: false,
          })
        );
        rayLine.renderOrder = 910;
        markerGroup.add(rayLine);

        const tipCone = new THREE.Mesh(
          new THREE.ConeGeometry(0.008 * scale, 0.024 * scale, 12),
          new THREE.MeshBasicMaterial({
            color: markerHex,
            transparent: true,
            opacity: isSelected ? 0.95 : 0.45,
            depthTest: false,
            depthWrite: false,
          })
        );
        tipCone.position.copy(dir).multiplyScalar(rayLen);
        tipCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        tipCone.renderOrder = 911;
        markerGroup.add(tipCone);
      }

      overlay.add(markerGroup);
    }

    // B. Conventional 3-Axis Positioning + Orientation Gizmo on the Selected Light
    if (activeLight && !locked) {
      const gx = (activeLight.xMm * mx) / 1000;
      const gy = activeLight.zMm / 1000;
      const gz = (activeLight.yMm * my) / 1000;
      const gizmoRoot = new THREE.Group();
      gizmoRoot.position.set(gx, gy, gz);

      const axisLen = Math.max(0.15, Math.min(0.42, 0.25 * scale));

      const addAxisArrow = (
        axisField: 'xMm' | 'yMm' | 'zMm',
        axisLabel: 'X' | 'Y' | 'Z',
        localDir: THREE.Vector3,
        baseColor: number,
        hoverColor: number,
        badgeHex: string
      ) => {
        const dirNorm = localDir.clone().normalize();
        const arrowGroup = new THREE.Group();
        const qAlign = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirNorm);
        arrowGroup.quaternion.copy(qAlign);

        const shaftLen = axisLen * 0.78;
        const coneLen = axisLen * 0.22;

        const shaftMat = new THREE.MeshBasicMaterial({
          color: baseColor,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          depthWrite: false,
        });
        const coneMat = new THREE.MeshBasicMaterial({
          color: baseColor,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
          depthWrite: false,
        });

        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0034 * scale, 0.0034 * scale, shaftLen, 12),
          shaftMat
        );
        shaft.position.y = shaftLen / 2 + 0.016 * scale;
        shaft.renderOrder = 950;
        arrowGroup.add(shaft);

        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.0115 * scale, coneLen, 16),
          coneMat
        );
        cone.position.y = shaftLen + coneLen / 2 + 0.016 * scale;
        cone.renderOrder = 951;
        arrowGroup.add(cone);

        // Generous invisible raycast hit tube along the axis
        const hitTube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.022 * scale, 0.022 * scale, axisLen + 0.04 * scale, 10),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
          })
        );
        hitTube.position.y = (axisLen + 0.03 * scale) / 2;
        hitTube.userData.gizmoMeta = {
          kind: 'axis',
          lightId: activeLight.id,
          axisField,
          axisLabel,
          localDir: dirNorm,
          baseColor,
          hoverColor,
          visualMats: [shaftMat, coneMat],
        } satisfies GizmoHandleMeta;
        interactiveHandlesRef.current.push(hitTube);
        arrowGroup.add(hitTube);

        gizmoRoot.add(arrowGroup);

        // Crisp axis label badge just beyond tip
        const badge = makeAxisLabelSprite(axisLabel, badgeHex);
        badge.position.copy(dirNorm).multiplyScalar(axisLen + 0.038 * scale);
        const spriteSize = 0.038 * scale;
        badge.scale.set(spriteSize, spriteSize, 1);
        gizmoRoot.add(badge);
      };

      // Three independent orthogonal translation arrows matching Pos X / Pos Y / Pos Z
      addAxisArrow('xMm', 'X', new THREE.Vector3(mx, 0, 0), 0xef4444, 0xfca5a5, '#EF4444');
      addAxisArrow('yMm', 'Y', new THREE.Vector3(0, 0, my), 0x22c55e, 0x86efac, '#22C55E');
      addAxisArrow('zMm', 'Z', new THREE.Vector3(0, 1, 0), 0x3b82f6, 0x93c5fd, '#3B82F6');

      // Orientation handles strictly for non-point lights (Spot, Area, Linear)
      if (activeLight.type !== 'point') {
        const azDeg = activeLight.aimAzimuthDeg ?? 0;
        const elDeg = activeLight.aimElevationDeg ?? -75;
        const azRad = THREE.MathUtils.degToRad(azDeg);
        const elRad = THREE.MathUtils.degToRad(elDeg);

        // 1. Horizontal Rotation (Yaw) ring & directional handle (Amber)
        const yawRadius = axisLen * 0.86;
        const yawRingMat = new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.72,
          depthTest: false,
          depthWrite: false,
        });
        const yawKnobMat = new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.98,
          depthTest: false,
          depthWrite: false,
        });
        const yawRing = new THREE.Mesh(
          new THREE.TorusGeometry(yawRadius, 0.0024 * scale, 10, 48),
          yawRingMat
        );
        yawRing.rotation.x = Math.PI / 2;
        yawRing.renderOrder = 945;
        gizmoRoot.add(yawRing);

        const yawKnobPos = new THREE.Vector3(
          Math.sin(azRad) * mx * yawRadius,
          0,
          Math.cos(azRad) * my * yawRadius
        );
        const yawKnob = new THREE.Mesh(
          new THREE.SphereGeometry(0.011 * scale, 14, 12),
          yawKnobMat
        );
        yawKnob.position.copy(yawKnobPos);
        yawKnob.renderOrder = 952;
        gizmoRoot.add(yawKnob);

        const yawMeta: GizmoHandleMeta = {
          kind: 'yaw',
          lightId: activeLight.id,
          baseColor: 0xf59e0b,
          hoverColor: 0xfde68a,
          visualMats: [yawRingMat, yawKnobMat],
        };
        const yawHitRing = new THREE.Mesh(
          new THREE.TorusGeometry(yawRadius, 0.02 * scale, 8, 32),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
          })
        );
        yawHitRing.rotation.x = Math.PI / 2;
        yawHitRing.userData.gizmoMeta = yawMeta;
        interactiveHandlesRef.current.push(yawHitRing);
        gizmoRoot.add(yawHitRing);

        const yawHitKnob = new THREE.Mesh(
          new THREE.SphereGeometry(0.028 * scale, 10, 8),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
          })
        );
        yawHitKnob.position.copy(yawKnobPos);
        yawHitKnob.userData.gizmoMeta = yawMeta;
        interactiveHandlesRef.current.push(yawHitKnob);
        gizmoRoot.add(yawHitKnob);

        // 2. Vertical Tilt (Pitch) semicircle arc & handle (Cyan) in current Yaw plane
        const pitchRadius = axisLen * 0.7;
        const horizDir = new THREE.Vector3(Math.sin(azRad) * mx, 0, Math.cos(azRad) * my).normalize();
        const upVec = new THREE.Vector3(0, 1, 0);
        const pitchNormal = new THREE.Vector3().crossVectors(horizDir, upVec).normalize();
        const pitchBasis = new THREE.Matrix4().makeBasis(horizDir, upVec, pitchNormal);
        const pitchQuat = new THREE.Quaternion().setFromRotationMatrix(pitchBasis);

        const pitchArcMat = new THREE.MeshBasicMaterial({
          color: 0x06b6d4,
          transparent: true,
          opacity: 0.78,
          depthTest: false,
          depthWrite: false,
        });
        const pitchKnobMat = new THREE.MeshBasicMaterial({
          color: 0x06b6d4,
          transparent: true,
          opacity: 0.98,
          depthTest: false,
          depthWrite: false,
        });

        const pitchArc = new THREE.Mesh(
          new THREE.TorusGeometry(pitchRadius, 0.0024 * scale, 10, 32, Math.PI),
          pitchArcMat
        );
        pitchArc.quaternion.copy(pitchQuat);
        // Torus arc sweeps 0..PI in XY starting from +X; rotate -PI/2 around Z so sweep runs -Y (-90°) -> +X (0°) -> +Y (+90°)
        pitchArc.rotateZ(-Math.PI / 2);
        pitchArc.renderOrder = 946;
        gizmoRoot.add(pitchArc);

        const pitchKnobPos = horizDir
          .clone()
          .multiplyScalar(Math.cos(elRad) * pitchRadius)
          .addScaledVector(upVec, Math.sin(elRad) * pitchRadius);
        const pitchKnob = new THREE.Mesh(
          new THREE.SphereGeometry(0.011 * scale, 14, 12),
          pitchKnobMat
        );
        pitchKnob.position.copy(pitchKnobPos);
        pitchKnob.renderOrder = 953;
        gizmoRoot.add(pitchKnob);

        const pitchMeta: GizmoHandleMeta = {
          kind: 'pitch',
          lightId: activeLight.id,
          baseColor: 0x06b6d4,
          hoverColor: 0xa5f3fc,
          visualMats: [pitchArcMat, pitchKnobMat],
        };
        const pitchHitArc = new THREE.Mesh(
          new THREE.TorusGeometry(pitchRadius, 0.02 * scale, 8, 24, Math.PI),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
          })
        );
        pitchHitArc.quaternion.copy(pitchQuat);
        pitchHitArc.rotateZ(-Math.PI / 2);
        pitchHitArc.userData.gizmoMeta = pitchMeta;
        interactiveHandlesRef.current.push(pitchHitArc);
        gizmoRoot.add(pitchHitArc);

        const pitchHitKnob = new THREE.Mesh(
          new THREE.SphereGeometry(0.028 * scale, 10, 8),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
          })
        );
        pitchHitKnob.position.copy(pitchKnobPos);
        pitchHitKnob.userData.gizmoMeta = pitchMeta;
        interactiveHandlesRef.current.push(pitchHitKnob);
        gizmoRoot.add(pitchHitKnob);

        // 3. Roll ring & handle (Violet) ONLY for asymmetric Area & Linear lights
        if (activeLight.type === 'area' || activeLight.type === 'linear') {
          const basis = computeLightOrientationQuaternionThree(
            azDeg,
            elDeg,
            activeLight.aimRollDeg ?? 0,
            furn.mirroredX,
            furn.mirroredY
          );
          const rollRadius = axisLen * 0.48;
          const rollOffset = basis.dir.clone().multiplyScalar(axisLen * 0.28);

          const rollRingMat = new THREE.MeshBasicMaterial({
            color: 0xa855f7,
            transparent: true,
            opacity: 0.78,
            depthTest: false,
            depthWrite: false,
          });
          const rollKnobMat = new THREE.MeshBasicMaterial({
            color: 0xa855f7,
            transparent: true,
            opacity: 0.98,
            depthTest: false,
            depthWrite: false,
          });

          const rollRing = new THREE.Mesh(
            new THREE.TorusGeometry(rollRadius, 0.0022 * scale, 10, 36),
            rollRingMat
          );
          rollRing.position.copy(rollOffset);
          rollRing.quaternion.copy(basis.quaternion);
          rollRing.renderOrder = 947;
          gizmoRoot.add(rollRing);

          const rollKnobPos = rollOffset.clone().addScaledVector(basis.right, rollRadius);
          const rollKnob = new THREE.Mesh(
            new THREE.SphereGeometry(0.01 * scale, 14, 12),
            rollKnobMat
          );
          rollKnob.position.copy(rollKnobPos);
          rollKnob.renderOrder = 954;
          gizmoRoot.add(rollKnob);

          const rollMeta: GizmoHandleMeta = {
            kind: 'roll',
            lightId: activeLight.id,
            baseColor: 0xa855f7,
            hoverColor: 0xe9d5ff,
            visualMats: [rollRingMat, rollKnobMat],
          };
          const rollHitRing = new THREE.Mesh(
            new THREE.TorusGeometry(rollRadius, 0.02 * scale, 8, 28),
            new THREE.MeshBasicMaterial({
              transparent: true,
              opacity: 0,
              depthTest: false,
              depthWrite: false,
            })
          );
          rollHitRing.position.copy(rollOffset);
          rollHitRing.quaternion.copy(basis.quaternion);
          rollHitRing.userData.gizmoMeta = rollMeta;
          interactiveHandlesRef.current.push(rollHitRing);
          gizmoRoot.add(rollHitRing);

          const rollHitKnob = new THREE.Mesh(
            new THREE.SphereGeometry(0.026 * scale, 10, 8),
            new THREE.MeshBasicMaterial({
              transparent: true,
              opacity: 0,
              depthTest: false,
              depthWrite: false,
            })
          );
          rollHitKnob.position.copy(rollKnobPos);
          rollHitKnob.userData.gizmoMeta = rollMeta;
          interactiveHandlesRef.current.push(rollHitKnob);
          gizmoRoot.add(rollHitKnob);
        }
      }

      overlay.add(gizmoRoot);
    }

    requestRenderRef.current();
  }, [
    furn,
    showLightGizmo,
    selectedLightId,
    locked,
    activeBackdrop,
    modelReadyTick,
  ]);

  if (webglError) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-6 text-center text-xs text-slate-500 ${className}`}
      >
        <p className="font-medium text-slate-700 dark:text-slate-200">3D Preview Unavailable</p>
        <p className="mt-1 text-[11px]">WebGL context could not be initialized in this browser.</p>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 select-none ${className}`}
    >
      <div
        ref={containerRef}
        className={`w-full h-full ${
          dragReadout ? 'cursor-grabbing' : hoveredKind ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
        }`}
      />

      {/* Top-left live gizmo readout or hover indicator */}
      {(dragReadout || hoveredKind) && (
        <div className="pointer-events-none absolute top-2.5 left-2.5 z-10 px-2 py-1 rounded bg-slate-900/90 text-white font-mono-nums text-[11px] font-medium border border-white/15 shadow-xs">
          {dragReadout ?? hoveredKind}
        </div>
      )}

      {/* Top-right HUD: Studio / Night backdrop toggle + Reset View */}
      <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5">
        <div className="flex items-center p-0.5 rounded-md bg-white/95 dark:bg-slate-900/95 border border-slate-200/80 dark:border-slate-700/80 shadow-xs">
          <button
            type="button"
            onClick={() => setBackdrop('day')}
            className={`px-2 py-1 rounded text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeBackdrop === 'day'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Sun className="w-3 h-3" />
            <span>Studio</span>
          </button>
          <button
            type="button"
            onClick={() => setBackdrop('night')}
            className={`px-2 py-1 rounded text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeBackdrop === 'night'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Moon className="w-3 h-3" />
            <span>Night</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            hasFramedRef.current = false;
            resetCamRef.current();
          }}
          title="Reset camera framing"
          aria-label="Reset camera framing"
          className="p-1.5 rounded-md bg-white/95 dark:bg-slate-900/95 border border-slate-200/80 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white shadow-xs cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Subtle bottom-left orbit / gizmo hint */}
      <div className="pointer-events-none absolute bottom-2 left-2.5 z-10 px-2 py-1 rounded bg-white/85 dark:bg-slate-900/85 border border-slate-200/70 dark:border-slate-800/70 text-[10px] text-slate-600 dark:text-slate-300">
        {showLightGizmo
          ? 'Click orb to select · Drag arrows/rings to adjust · Drag scene to orbit · Scroll to zoom'
          : 'Drag to rotate · Scroll to zoom'}
      </div>
    </div>
  );
};
