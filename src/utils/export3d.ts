import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import type {
  ArchElement,
  Curtain,
  FurnitureInstance,
  Level,
  PersonInstance,
  ProjectSettings,
} from '../types/plan';
import {
  computeFurnitureBoundsMm,
  getCeilingFixtureOffsetMm,
  getEnclosingRoomCeilingMm,
  getWallCenterlinePoint,
  resolveChimneyFaceColors,
  wallOffsets,
} from './geometry';
import {
  resolveFurnitureMountingFace,
  resolveFurnitureMountingType,
} from './mounting';
import {
  fitGlbSceneToFurnitureBounds,
  loadGlbObjectCached,
} from './furnitureRepresentationSync';
import { applyWorldSpaceUVs, buildArchitecturalMaterial } from './textures3d';
import { buildProceduralFurnitureGroup } from './furniture3d';
import {
  applyGlbEmissiveOverrides,
  buildThreeLightsForFurniture,
  isFurnitureLightingActive,
} from './lighting';
import { buildDetailedPersonGroup } from './people3d';
import { buildWall3DGroup } from './wall3d';
import { resolveRailingConfig } from './railings';
import {
  buildHostDeckRailings3DGroup,
  buildRailing3DGroup,
  buildStaircase3DGroup,
} from './railings3d';

export type Export3DFormat = 'glb' | 'gltf' | 'obj' | 'stl';

function kelvinToColor(kelvin: number): THREE.Color {
  const temp = Math.max(1800, Math.min(8000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (temp <= 66) {
    r = 255;
    g = Math.min(255, Math.max(0, 99.4708025861 * Math.log(temp) - 161.1195681661));
    b = temp <= 19 ? 0 : Math.min(255, Math.max(0, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
  } else {
    r = Math.min(255, Math.max(0, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
    g = Math.min(255, Math.max(0, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
    b = 255;
  }
  return new THREE.Color(r / 255, g / 255, b / 255);
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function disposeGroupGeometriesAndMaterials(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((obj) => {
    const anyObj = obj as THREE.Mesh & THREE.Line;
    if (anyObj.geometry) {
      geometries.add(anyObj.geometry);
    }
    if (anyObj.material) {
      if (Array.isArray(anyObj.material)) {
        for (const m of anyObj.material) materials.add(m);
      } else {
        materials.add(anyObj.material);
      }
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

/**
 * Strips Line/Light helper nodes so geometry exporters (GLB/GLTF/OBJ/STL) receive pure 3D meshes.
 */
function stripNonMeshNodes(root: THREE.Object3D): void {
  const toRemove: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Line).isLine || (obj as THREE.Light).isLight) {
      toRemove.push(obj);
    }
  });
  for (const child of toRemove) {
    child.parent?.remove(child);
  }
}

export async function buildLevelExportGroup(
  level: Level,
  settings: ProjectSettings
): Promise<THREE.Group> {
  const root = new THREE.Group();
  root.name = level.name || 'Level';
  const clippingPlanes: THREE.Plane[] = [];
  const matOpts = {
    clippingPlanes,
    isSoftwareGl: false,
  };

  // A. Rooms (Floors)
  if (level.layers.rooms) {
    for (const room of level.rooms) {
      if (!room.visible || room.polygon.length < 3) continue;
      const shape = new THREE.Shape();
      shape.moveTo(room.polygon[0].x / 1000, -room.polygon[0].y / 1000);
      for (let i = 1; i < room.polygon.length; i++) {
        shape.lineTo(room.polygon[i].x / 1000, -room.polygon[i].y / 1000);
      }
      shape.closePath();

      const floorGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
      const floorMat = buildArchitecturalMaterial(room.floorMaterial, room.floorColor, {
        ...matOpts,
        scale: room.floorTextureScale,
        rotDeg: room.floorTextureRotDeg,
      });
      const floorMesh = new THREE.Mesh(floorGeo, floorMat);
      floorMesh.name = `Floor_${room.name || room.id}`;
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.y = -0.02;
      root.add(floorMesh);
    }
  }

  // B. Walls with Cutouts & Resolved Physical Inner/Outer Faces
  if (level.layers.walls) {
    for (const wall of level.walls) {
      if (!wall.visible) continue;

      const innerMat = buildArchitecturalMaterial(wall.innerMaterial, wall.innerColor, {
        ...matOpts,
        scale: wall.innerTextureScale,
        rotDeg: wall.innerTextureRotDeg,
      });
      const outerMat = buildArchitecturalMaterial(wall.outerMaterial, wall.outerColor, {
        ...matOpts,
        scale: wall.outerTextureScale,
        rotDeg: wall.outerTextureRotDeg,
      });
      const coreMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#475569'),
        roughness: 0.78,
      });
      const baseboardMat =
        wall.hasBaseboard && wall.baseboardHeightMm > 0
          ? new THREE.MeshStandardMaterial({
              color: new THREE.Color(wall.baseboardColor || '#E2E8F0'),
              roughness: 0.6,
            })
          : undefined;
      const crownMat =
        wall.hasCrownMolding && !settings.cutawayEnabled && wall.crownHeightMm > 0
          ? new THREE.MeshStandardMaterial({
              color: new THREE.Color(wall.crownColor || '#FFFFFF'),
              roughness: 0.5,
            })
          : undefined;

      const built = buildWall3DGroup(wall, {
        rooms: level.rooms,
        allWalls: level.walls,
        openings: level.openings,
        cutawayEnabled: settings.cutawayEnabled,
        cutawayHeightMm: settings.cutawayHeightMm,
        castShadows: false,
        innerMat,
        outerMat,
        coreMat,
        baseboardMat,
        crownMat,
        onCurvedSegmentGeo: (segGeo, i) => applyWorldSpaceUVs(segGeo, 1.0, i * 17),
      });
      if (!built) continue;
      root.add(built.wallGroup);
    }
  }

  // C. Openings (Doors, Windows, Arches)
  if (level.layers.openings) {
    for (const op of level.openings) {
      if (!op.visible) continue;
      const wall = level.walls.find((w) => w.id === op.wallId);
      if (!wall) continue;

      const { point, tangent, normal } = getWallCenterlinePoint(wall, op.t);
      const angle = Math.atan2(tangent.y, tangent.x);
      const { left: offL, right: offR } = wallOffsets(wall.thicknessMm, wall.alignment);
      const centerOffsetM = (offL + offR) / 2000;
      const opGroup = new THREE.Group();
      opGroup.name = `Opening_${op.id}`;
      opGroup.position.set(
        point.x / 1000 + normal.x * centerOffsetM,
        0,
        point.y / 1000 + normal.y * centerOffsetM
      );
      opGroup.rotation.y = -angle;

      const w = op.widthMm / 1000;
      const maxWallH = settings.cutawayEnabled
        ? Math.min(wall.heightMm, settings.cutawayHeightMm)
        : wall.heightMm;
      const sill = op.sillHeightMm / 1000;
      const isSlicedTop = settings.cutawayEnabled && op.sillHeightMm + op.heightMm >= maxWallH - 5;
      const h = Math.max(0.05, Math.min(op.heightMm, maxWallH - op.sillHeightMm)) / 1000;
      const thick = wall.thicknessMm / 1000 + 0.02;
      const fThick = op.frameThicknessMm / 1000;

      const frameMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(op.frameColor),
        roughness: 0.5,
        metalness: 0.15,
      });

      const showRectFrame =
        op.category !== 'arch' || op.subtype === 'frame_only' || op.subtype === 'passthrough';
      if (showRectFrame && !(op.category === 'window' && op.subtype === 'round')) {
        const jambL = new THREE.Mesh(new THREE.BoxGeometry(fThick, h, thick), frameMat);
        jambL.position.set(-w / 2 + fThick / 2, sill + h / 2, 0);
        const jambR = new THREE.Mesh(new THREE.BoxGeometry(fThick, h, thick), frameMat);
        jambR.position.set(w / 2 - fThick / 2, sill + h / 2, 0);
        opGroup.add(jambL, jambR);
        if (!isSlicedTop) {
          const head = new THREE.Mesh(new THREE.BoxGeometry(w, fThick, thick), frameMat);
          head.position.set(0, sill + h - fThick / 2, 0);
          opGroup.add(head);
        }
      }

      if (op.category === 'window') {
        const glassMat = buildArchitecturalMaterial('glass', op.glassColor, matOpts);
        if (op.subtype === 'round') {
          const r = Math.min(w, h) / 2;
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(Math.max(0.08, r - fThick / 2), fThick / 2, 10, 28),
            frameMat
          );
          ring.position.set(0, sill + h / 2, 0);
          ring.scale.set(w / (2 * r), h / (2 * r), thick / fThick);
          const disc = new THREE.Mesh(
            new THREE.CylinderGeometry(Math.max(0.06, r - fThick), Math.max(0.06, r - fThick), 0.016, 24),
            glassMat
          );
          disc.rotation.x = Math.PI / 2;
          disc.scale.set(w / (2 * r), 1, h / (2 * r));
          disc.position.set(0, sill + h / 2, 0);
          opGroup.add(ring, disc);
        } else {
          const isEuroWindow = op.subtype.startsWith('euro_');
          const isFullHeightWindow = op.subtype === 'floor_to_ceiling' || op.subtype === 'euro_terrace';

          if (!isFullHeightWindow) {
            const sillMesh = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, fThick, thick + 0.04), frameMat);
            sillMesh.position.set(0, sill + fThick / 2, 0);
            opGroup.add(sillMesh);
          } else if (isEuroWindow) {
            const thresholdMesh = new THREE.Mesh(new THREE.BoxGeometry(w, fThick * 0.7, thick), frameMat);
            thresholdMesh.position.set(0, sill + (fThick * 0.7) / 2, 0);
            opGroup.add(thresholdMesh);
          }

          const glassW = Math.max(0.1, w - fThick * 2);
          const glassH = Math.max(0.1, isSlicedTop ? h - fThick : h - fThick * 2);
          const glassCenterY = isSlicedTop ? sill + fThick + glassH / 2 : sill + h / 2;

          if (op.subtype !== 'casement' && op.subtype !== 'awning') {
            const glass = new THREE.Mesh(new THREE.BoxGeometry(glassW, glassH, 0.016), glassMat);
            glass.position.set(0, glassCenterY, 0);
            opGroup.add(glass);
          }

          if (
            op.subtype === 'double' ||
            op.subtype === 'triple' ||
            op.subtype === 'sliding' ||
            isEuroWindow
          ) {
            const panelCount =
              op.subtype === 'triple' || op.subtype === 'euro_triple'
                ? 3
                : op.subtype === 'double' ||
                    op.subtype === 'sliding' ||
                    op.subtype === 'euro_double' ||
                    op.subtype === 'euro_terrace'
                  ? 2
                  : 1;
            for (let m = 1; m < panelCount; m++) {
              const mx = -w / 2 + (w * m) / panelCount;
              const mullion = new THREE.Mesh(
                new THREE.BoxGeometry(isEuroWindow ? 0.065 : 0.04, glassH, thick * 0.6),
                frameMat
              );
              mullion.position.set(mx, glassCenterY, 0);
              opGroup.add(mullion);
            }
          } else if (op.subtype === 'casement') {
            const sashPivot = new THREE.Group();
            sashPivot.position.set(-w / 2 + fThick, sill + h / 2, 0);
            sashPivot.rotation.y = -0.35;
            const sash = new THREE.Mesh(new THREE.BoxGeometry(glassW * 0.96, glassH * 0.96, 0.025), glassMat);
            sash.position.x = glassW / 2;
            sashPivot.add(sash);
            opGroup.add(sashPivot);
          } else if (op.subtype === 'awning') {
            const sashPivot = new THREE.Group();
            sashPivot.position.set(0, sill + h - fThick, 0);
            sashPivot.rotation.x = 0.35;
            const sash = new THREE.Mesh(new THREE.BoxGeometry(glassW * 0.96, glassH * 0.96, 0.025), glassMat);
            sash.position.y = -glassH / 2;
            sashPivot.add(sash);
            opGroup.add(sashPivot);
          }
        }
      } else if (op.category === 'door' && op.subtype !== 'doorframe') {
        const panelMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(op.panelColor),
          roughness: 0.6,
          metalness: 0.05,
        });
        const innerW = Math.max(0.2, w - fThick * 2);
        const leafH = Math.max(0.1, h - fThick);
        const openRad = (op.openAngleDeg * Math.PI) / 180;
        const swingSign = op.swingDirection === 'in' ? 1 : -1;
        const dirSign = op.swingSide === 'left' ? 1 : -1;
        const pivot = new THREE.Group();
        const hingeX = op.swingSide === 'left' ? -w / 2 + fThick : w / 2 - fThick;
        pivot.position.set(hingeX, sill, 0);
        pivot.rotation.y = -swingSign * dirSign * openRad;
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(innerW, leafH, 0.044), panelMat);
        leaf.position.set(dirSign * (innerW / 2), leafH / 2, 0);
        pivot.add(leaf);
        opGroup.add(pivot);
      }

      root.add(opGroup);
    }
  }

  // D. Standalone Curtains
  if (level.layers.curtains) {
    for (const c of level.curtains as Curtain[]) {
      if (!c.visible) continue;
      const cGroup = new THREE.Group();
      cGroup.name = `Curtain_${c.id}`;
      cGroup.position.set(c.xMm / 1000, c.elevationMm / 1000, c.yMm / 1000);
      cGroup.rotation.y = (-c.rotationDeg * Math.PI) / 180;

      const w = c.widthMm / 1000;
      const h = Math.min(c.heightMm, settings.cutawayEnabled ? settings.cutawayHeightMm : 4000) / 1000;
      const rodMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(c.rodColor),
        metalness: 0.7,
        roughness: 0.28,
      });
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, w + 0.16, 12), rodMat);
      rod.rotation.z = Math.PI / 2;
      rod.position.y = h;
      cGroup.add(rod);

      const fabricMat = buildArchitecturalMaterial(c.material, c.color, matOpts);
      const isLinenDrape = c.style === 'drapes' || c.style === 'curtains';
      if (isLinenDrape) {
        fabricMat.transparent = true;
        fabricMat.opacity = 0.35;
        fabricMat.depthWrite = false;
        fabricMat.side = THREE.DoubleSide;
        fabricMat.needsUpdate = true;
      }
      const closedFrac = 1 - c.openPercent / 100;
      if (c.style === 'blinds' || c.style === 'roller_shade') {
        const dropH = Math.max(0.15, h * closedFrac);
        const shade = new THREE.Mesh(new THREE.BoxGeometry(w, dropH, 0.025), fabricMat);
        shade.position.y = h - dropH / 2;
        cGroup.add(shade);
      } else {
        const wingW = Math.max(0.18, (w / 2) * closedFrac);
        const folds = Math.max(3, Math.round(c.fullness * 3));
        for (const side of [-1, 1]) {
          const startX = side < 0 ? -w / 2 : w / 2 - wingW;
          for (let i = 0; i < folds; i++) {
            const fx = startX + ((i + 0.5) * wingW) / folds;
            const pleat = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, h, 8), fabricMat);
            pleat.position.set(fx, h / 2, (i % 2 === 0 ? 1 : -1) * 0.018);
            cGroup.add(pleat);
          }
        }
      }
      root.add(cGroup);
    }
  }

  // E. Furniture (Procedural + GLB Models with full 3-axis rotation)
  if (level.layers.furniture) {
    const sharedPartEdgeMat = new THREE.LineBasicMaterial({ color: '#94A3B8', transparent: true, opacity: 0.28 });
    const glbJobs: Array<Promise<void>> = [];

    for (const f of level.furniture as FurnitureInstance[]) {
      if (!f.visible) continue;
      if (f.glbAssetId || f.glbDataUrl) {
        const fGroup = new THREE.Group();
        fGroup.name = `Furniture_${f.name || f.id}`;
        const effCeilMm = getEnclosingRoomCeilingMm(
          { x: f.xMm, y: f.yMm },
          level.rooms,
          level.ceilingHeightMm
        );
        const mType = resolveFurnitureMountingType(f);
        const mFace = resolveFurnitureMountingFace(f);
        const groupElevMm =
          mType === 'ceiling'
            ? getCeilingFixtureOffsetMm(f, effCeilMm)
            : f.elevationMm;
        fGroup.position.set(f.xMm / 1000, groupElevMm / 1000, f.yMm / 1000);
        fGroup.rotation.y = (-f.rotationDeg * Math.PI) / 180;
        const tiltGroup = new THREE.Group();
        const rxRad = ((f.rotationXDeg ?? 0) * Math.PI) / 180;
        const ryRad = ((f.rotationYDeg ?? 0) * Math.PI) / 180;
        tiltGroup.rotation.set(rxRad, ryRad, 0, 'YXZ');
        const mirrorGroup = new THREE.Group();
        mirrorGroup.scale.set(f.mirroredX ? -1 : 1, 1, f.mirroredY ? -1 : 1);
        tiltGroup.add(mirrorGroup);
        fGroup.add(tiltGroup);
        root.add(fGroup);

        buildThreeLightsForFurniture(f, tiltGroup, {
          nightMix: 0,
          isSoftwareGl: true,
          useLegacyFillForUnmigratedLamp: true,
        });

        const targetBounds = computeFurnitureBoundsMm(f.parts);
        glbJobs.push(
          loadGlbObjectCached(f.glbAssetId, f.glbDataUrl).then((model) => {
            if (!model) return;
            fitGlbSceneToFurnitureBounds(model, targetBounds, {
              mountingType: mType,
              mountingFace: mFace,
            });
            applyGlbEmissiveOverrides(
              model,
              f.glbEmissiveOverrides,
              0,
              clippingPlanes,
              isFurnitureLightingActive(f)
            );
            mirrorGroup.add(model);
            tiltGroup.position.y = 0;
            if (Math.abs(rxRad) > 1e-4 || Math.abs(ryRad) > 1e-4) {
              fGroup.updateMatrixWorld(true);
              const box = new THREE.Box3().setFromObject(tiltGroup);
              if (Number.isFinite(box.min.y)) {
                tiltGroup.position.y += fGroup.position.y - box.min.y;
              }
            }
          })
        );
      } else {
        const built = buildProceduralFurnitureGroup(f, {
          matOpts,
          castShadows: false,
          clippingPlanes,
          nightMix: 0,
          partEdgeMat: sharedPartEdgeMat,
          kelvinToColor,
          effectiveCeilingMm: getEnclosingRoomCeilingMm(
            { x: f.xMm, y: f.yMm },
            level.rooms,
            level.ceilingHeightMm
          ),
        });
        built.group.name = `Furniture_${f.name || f.id}`;
        root.add(built.group);
      }
    }

    if (glbJobs.length > 0) {
      await Promise.all(glbJobs);
    }
    sharedPartEdgeMat.dispose();
  }

  // F. People
  if (level.layers.people) {
    for (const person of level.people as PersonInstance[]) {
      if (!person.visible) continue;
      const pGroup = buildDetailedPersonGroup(person, {
        clippingPlanes,
        castShadows: false,
        isSoftwareGl: false,
      });
      pGroup.name = `Person_${person.name || person.id}`;
      root.add(pGroup);
    }
  }

  // G. Architectural Elements
  if (level.layers.archElements) {
    for (const el of level.archElements as ArchElement[]) {
      if (!el.visible) continue;
      const aGroup = new THREE.Group();
      aGroup.name = `Arch_${el.type}_${el.id}`;
      aGroup.position.set(el.xMm / 1000, el.elevationMm / 1000, el.yMm / 1000);
      aGroup.rotation.y = (-el.rotationDeg * Math.PI) / 180;

      const hostWall =
        el.type === 'chimney' && el.attachedWallId
          ? level.walls.find((wItem) => wItem.id === el.attachedWallId)
          : undefined;
      const targetCeilingMm = hostWall
        ? hostWall.heightMm
        : getEnclosingRoomCeilingMm({ x: el.xMm, y: el.yMm }, level.rooms, level.ceilingHeightMm);
      const w = el.widthMm / 1000;
      const d = el.depthMm / 1000;
      const rawH = el.connectToCeiling ? Math.max(200, targetCeilingMm - el.elevationMm) : el.heightMm;
      const h = (settings.cutawayEnabled ? Math.min(rawH, settings.cutawayHeightMm) : rawH) / 1000;

      const mat = buildArchitecturalMaterial(el.material, el.color, matOpts);
      const accentMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(el.accentColor),
        roughness: 0.4,
        metalness: 0.6,
      });

      if (el.type === 'chimney') {
        const faceColors = resolveChimneyFaceColors(el);
        const chimMaterials = [
          buildArchitecturalMaterial(el.material, faceColors.right, matOpts),
          buildArchitecturalMaterial(el.material, faceColors.left, matOpts),
          buildArchitecturalMaterial(el.material, el.color || '#94A3B8', matOpts),
          buildArchitecturalMaterial(el.material, el.color || '#94A3B8', matOpts),
          buildArchitecturalMaterial(el.material, faceColors.front, matOpts),
          buildArchitecturalMaterial(el.material, faceColors.back, matOpts),
        ];
        const overlap = hostWall ? 0.008 : 0;
        const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d + overlap), chimMaterials);
        const signFace = el.attachedFace === 'right' ? 1 : -1;
        bodyMesh.position.set(0, h / 2, hostWall ? signFace * (overlap / 2) : 0);
        aGroup.add(bodyMesh);
      } else if (el.type === 'column_round') {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 24), mat);
        shaft.position.y = h / 2;
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(w * 1.25, 0.12, w * 1.25), accentMat);
        plinth.position.y = 0.06;
        aGroup.add(shaft, plinth);
      } else if (el.type === 'railing') {
        const rCfg = resolveRailingConfig(el);
        aGroup.add(
          buildRailing3DGroup(rCfg, el.color || '#334155', matOpts, false)
        );
      } else if (el.type.startsWith('stairs')) {
        aGroup.add(
          buildStaircase3DGroup(
            el,
            targetCeilingMm,
            rawH / 1000,
            mat,
            accentMat,
            matOpts,
            false
          )
        );
      } else if (el.type === 'balcony' || el.type === 'platform') {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.y = h / 2;
        aGroup.add(mesh);
        const deckRails = buildHostDeckRailings3DGroup(el, matOpts, false);
        if (deckRails) aGroup.add(deckRails);
      } else {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.y = h / 2;
        aGroup.add(mesh);
      }
      root.add(aGroup);
    }
  }

  stripNonMeshNodes(root);
  root.updateMatrixWorld(true);
  return root;
}

export async function exportLevelAs3D(
  projectName: string,
  level: Level,
  settings: ProjectSettings,
  format: Export3DFormat
): Promise<string> {
  const safeName = `${projectName || 'plan-studio'}-${level.name || 'level'}`
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const filename = `${safeName || 'plan-studio'}.${format}`;

  const group = await buildLevelExportGroup(level, settings);
  try {
    if (format === 'glb' || format === 'gltf') {
      const exporter = new GLTFExporter();
      const binary = format === 'glb';
      const result = await new Promise<ArrayBuffer | Record<string, unknown>>((resolve, reject) => {
        exporter.parse(
          group,
          (res) => resolve(res as ArrayBuffer | Record<string, unknown>),
          (err) => reject(err),
          { binary }
        );
      });
      if (binary && result instanceof ArrayBuffer) {
        triggerBlobDownload(new Blob([result], { type: 'model/gltf-binary' }), filename);
      } else {
        const json = JSON.stringify(result, null, 2);
        triggerBlobDownload(new Blob([json], { type: 'model/gltf+json' }), filename);
      }
    } else if (format === 'obj') {
      const exporter = new OBJExporter();
      const objText = exporter.parse(group);
      triggerBlobDownload(new Blob([objText], { type: 'text/plain;charset=utf-8' }), filename);
    } else {
      const exporter = new STLExporter();
      const stlBuf = exporter.parse(group, { binary: true });
      const blob =
        stlBuf instanceof DataView
          ? new Blob([stlBuf.buffer as ArrayBuffer], { type: 'model/stl' })
          : new Blob([String(stlBuf)], { type: 'model/stl' });
      triggerBlobDownload(blob, filename);
    }
    return filename;
  } finally {
    disposeGroupGeometriesAndMaterials(group);
  }
}
