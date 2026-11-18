import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { FurnitureInstance, FurniturePart, Level, Room, Wall } from '../types/plan';
import {
  applyMountingRotationToObject3D,
  defaultMountingFaceForType,
  getMountingRotationQuaternion,
  inspectGlbForMounting,
  resolveFurnitureMountingFace,
  resolveFurnitureMountingType,
  rotateBoundsForMounting,
  transformBoundsBetweenMountings,
} from './mounting';
import {
  computeAttachedWallFurnitureTransform,
  computeFurnitureWorldBox,
  detachChildrenOnParentDelete,
  findNearestWallAttachmentTarget,
  findSupportingSurfaceForProp,
  getCeilingFixtureOffsetMm,
  propagateParentFurnitureTransforms,
  propagateWallAttachments,
  snapFurnitureToPlan,
  solveSolidFurnitureMove,
  wouldCreateSurfaceCycle,
} from './geometry';

function makeBoxPart(
  id: string,
  widthMm: number,
  depthMm: number,
  heightMm: number,
  zMm = 0
): FurniturePart {
  return {
    id,
    name: id,
    shape: 'box',
    xMm: 0,
    yMm: 0,
    zMm,
    widthMm,
    depthMm,
    heightMm,
    rotationDeg: 0,
    color: '#CCCCCC',
    material: 'wood',
  };
}

function makeFurniture(overrides: Partial<FurnitureInstance> & { id: string }): FurnitureInstance {
  return {
    templateId: 'custom_box',
    name: 'Item',
    category: 'My Library',
    xMm: 1000,
    yMm: 1000,
    elevationMm: 0,
    rotationDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: [makeBoxPart(`${overrides.id}_p`, 600, 400, 500)],
    visible: true,
    locked: false,
    ...overrides,
  };
}

function makeWall(id: string, x1: number, y1: number, x2: number, y2: number, thicknessMm = 200): Wall {
  return {
    id,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thicknessMm,
    heightMm: 2800,
    alignment: 'center',
    isCurved: false,
    curveBulgeMm: 0,
    hasBaseboard: true,
    baseboardHeightMm: 100,
    baseboardColor: '#FFFFFF',
    hasCrownMolding: false,
    crownHeightMm: 80,
    crownColor: '#FFFFFF',
    innerColor: '#FFFFFF',
    outerColor: '#EEEEEE',
    innerMaterial: 'plaster',
    outerMaterial: 'plaster',
    innerTextureScale: 1,
    outerTextureScale: 1,
    innerTextureRotDeg: 0,
    outerTextureRotDeg: 0,
    visible: true,
    locked: false,
  };
}

test('resolveFurnitureMountingType resolves all 5 mounting types explicitly and via catalog defaults', () => {
  assert.equal(
    resolveFurnitureMountingType(makeFurniture({ id: 'a', templateId: 'sofa_straight_3', category: 'Sofas & Seating' })),
    'freestanding'
  );
  assert.equal(
    resolveFurnitureMountingType(makeFurniture({ id: 'b', templateId: 'kitchen_base_cabinet', category: 'Kitchen' })),
    'floor'
  );
  assert.equal(
    resolveFurnitureMountingType(makeFurniture({ id: 'c', templateId: 'wall_art', category: 'Decor & Plants' })),
    'wall'
  );
  assert.equal(
    resolveFurnitureMountingType(makeFurniture({ id: 'd', templateId: 'light_pendant_dome', category: 'Lighting' })),
    'ceiling'
  );
  assert.equal(
    resolveFurnitureMountingType(makeFurniture({ id: 'e', templateId: 'appliance_coffee', category: 'Kitchen' })),
    'surface'
  );
  // Explicit mountingType overrides heuristic
  assert.equal(
    resolveFurnitureMountingType(
      makeFurniture({ id: 'f', templateId: 'sofa_straight_3', mountingType: 'wall' })
    ),
    'wall'
  );
  assert.equal(
    resolveFurnitureMountingFace(
      makeFurniture({ id: 'g', templateId: 'light_pendant_dome', category: 'Lighting' })
    ),
    'top'
  );
  assert.equal(defaultMountingFaceForType('wall'), 'back');
});

test('inspectGlbForMounting detects ceiling, wall, surface, and floor geometries', () => {
  // 1. Ceiling pendant with flat canopy at top (+Y) and thin lower body
  const ceilingGroup = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 24));
  canopy.position.set(0, 0.48, 0);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 8));
  rod.position.set(0, 0.3, 0);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8));
  bulb.position.set(0, 0.09, 0);
  ceilingGroup.add(canopy, rod, bulb);

  const ceilRes = inspectGlbForMounting(ceilingGroup);
  assert.equal(ceilRes.mountingType, 'ceiling');
  assert.equal(ceilRes.mountingFace, 'top');

  // 2. Thin wall-mounted sconce / panel facing +Z (thick in X/Y, shallow in Z)
  const wallGroup = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.06));
  frame.position.set(0, 0.35, 0);
  wallGroup.add(frame);

  const wallRes = inspectGlbForMounting(wallGroup);
  assert.equal(wallRes.mountingType, 'wall');
  assert.ok(['back', 'front'].includes(wallRes.mountingFace));

  // 3. Compact tabletop prop (25cm x 22cm x 30cm)
  const tabletopGroup = new THREE.Group();
  tabletopGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.22)));
  const surfRes = inspectGlbForMounting(tabletopGroup);
  assert.equal(surfRes.mountingType, 'surface');
  assert.equal(surfRes.mountingFace, 'bottom');

  // 4. Broad floor cabinet (1.8m wide, 0.6m deep, 1.5m tall)
  const floorGroup = new THREE.Group();
  floorGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.5, 0.6)));
  const floorRes = inspectGlbForMounting(floorGroup);
  assert.equal(floorRes.mountingType, 'floor');
  assert.equal(floorRes.mountingFace, 'bottom');
});

test('mounting orientation transforms preserve geometry and map faces accurately across all axes', () => {
  const raw = { widthMm: 1200, depthMm: 100, heightMm: 700 };
  // If raw model has front along +X (`right`), orienting onto wall moves X depth into Z depth
  const rotated = rotateBoundsForMounting(raw, 'wall', 'right');
  assert.equal(rotated.widthMm, 100);
  assert.equal(rotated.depthMm, 1200);
  assert.equal(rotated.heightMm, 700);

  // Round-trip back from ('wall', 'right') -> ('floor', 'bottom') recovers raw dimensions
  const backToFloor = transformBoundsBetweenMountings(
    rotated,
    'wall',
    'right',
    'floor',
    'bottom'
  );
  assert.deepEqual(backToFloor, raw);

  // Verify quaternion maps (+1, 0, 0) (`right` face) onto (0, 0, -1) (`wall` target `-Z`)
  const q = getMountingRotationQuaternion('wall', 'right');
  const vec = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  assert.ok(Math.abs(vec.x) < 1e-5);
  assert.ok(Math.abs(vec.y) < 1e-5);
  assert.ok(Math.abs(vec.z - -1) < 1e-5);

  // applyMountingRotationToObject3D wraps via pivot without mutating inner mesh geometry vertices
  const root = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 1.0));
  const posAttr = box.geometry.getAttribute('position');
  const origFirstX = posAttr.getX(0);
  root.add(box);
  applyMountingRotationToObject3D(root, 'floor', 'left');
  assert.equal(posAttr.getX(0), origFirstX);
});

test('wall-mounted objects attach flush to walls without clipping or floating', () => {
  // Horizontal wall from (0,0) to (4000,0), thickness 200 -> normal +Y is left face at y=+100, right face at y=-100
  const wall = makeWall('w1', 0, 0, 4000, 0, 200);
  const tv = makeFurniture({
    id: 'tv1',
    templateId: 'tv_wall_55',
    mountingType: 'wall',
    parts: [makeBoxPart('p', 1200, 80, 700)],
  });

  // Drag near inner (+normal / y > 0) side
  const target = findNearestWallAttachmentTarget({ x: 2000, y: 180 }, tv, [wall]);
  assert.ok(target);
  assert.equal(target.face, 'left');
  assert.equal(target.rotationDeg, 0);
  // Wall bottom edge in +normal is y = +100; TV half-depth = 40 -> center sits at y = 140
  assert.equal(target.yMm, 140);

  const snapRes = snapFurnitureToPlan({ x: 2000, y: 180 }, tv, [wall], [], {
    snapEnabled: true,
    gridSizeMm: 50,
  });
  assert.equal(snapRes.attachedWallId, 'w1');
  assert.equal(snapRes.attachedFace, 'left');
  assert.equal(snapRes.yMm, 140);
});

test('ceiling fixtures attach flush to enclosing room ceiling underside', () => {
  const room: Room = {
    id: 'r1',
    name: 'Living Room',
    polygon: [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 4000 },
      { x: 0, y: 4000 },
    ],
    areaM2: 16,
    perimeterM: 16,
    floorColor: '#EEE',
    floorMaterial: 'wood',
    floorTextureScale: 1,
    floorTextureRotDeg: 0,
    floorLevelMm: 0,
    hasCeiling: true,
    ceilingColor: '#FFF',
    ceilingMaterial: 'plaster',
    ceilingHeightMm: 3000,
    visible: true,
    locked: false,
  };
  const chandelier = makeFurniture({
    id: 'ch1',
    templateId: 'light_chandelier',
    category: 'Lighting',
    mountingType: 'ceiling',
    parts: [makeBoxPart('p', 600, 600, 450, 0)],
  });

  const elev = getCeilingFixtureOffsetMm(chandelier, room.ceilingHeightMm);
  // MaxZ = 450, so offset = 3000 - 1 - 450 = 2549mm
  assert.equal(elev, 2549);
});

test('furniture-to-furniture attachment snaps when dragged over desk, Shift bypasses, and cycles are blocked', () => {
  const desk = makeFurniture({
    id: 'desk1',
    templateId: 'desk_office',
    category: 'Tables & Desks',
    mountingType: 'freestanding',
    xMm: 2000,
    yMm: 2000,
    rotationDeg: 0,
    parts: [makeBoxPart('p_desk', 1600, 800, 750)],
  });
  const lamp = makeFurniture({
    id: 'lamp1',
    templateId: 'light_table_lamp',
    category: 'Lighting',
    mountingType: 'surface',
    xMm: 500,
    yMm: 500,
    parts: [makeBoxPart('p_lamp', 240, 240, 380)],
  });

  // Dragging over desk auto-attaches cleanly at desk top height (750mm)
  const attachMove = solveSolidFurnitureMove(
    { x: lamp.xMm, y: lamp.yMm },
    { x: 2100, y: 2050 },
    lamp,
    { walls: [], furniture: [desk, lamp], archElements: [] },
    { snapEnabled: true, gridSizeMm: 50, allowOverlap: false }
  );
  assert.equal(attachMove.surfaceHostId, 'desk1');
  assert.equal(attachMove.elevationMm, 750);
  assert.ok(attachMove.attachmentPreview?.kind === 'surface');

  // Holding Shift (allowOverlap = true) bypasses surface auto-attachment
  const bypassMove = solveSolidFurnitureMove(
    { x: lamp.xMm, y: lamp.yMm },
    { x: 2100, y: 2050 },
    lamp,
    { walls: [], furniture: [desk, lamp], archElements: [] },
    { snapEnabled: true, gridSizeMm: 50, allowOverlap: true }
  );
  assert.equal(bypassMove.surfaceHostId, undefined);
  assert.equal(bypassMove.elevationMm, 0);

  // Cycle protection prevents A hosting B while B hosts A
  const cycleTestList: FurnitureInstance[] = [
    { ...desk, surfaceHostId: 'lamp1' },
    lamp,
  ];
  assert.equal(wouldCreateSurfaceCycle('lamp1', 'desk1', cycleTestList), true);
  assert.equal(
    findSupportingSurfaceForProp({ x: 2000, y: 2000 }, { ...lamp, id: 'desk1' }, cycleTestList),
    null
  );
});

test('parent move, rotate, mirror, and resize propagate accurately to attached surface children', () => {
  const deskPrev = makeFurniture({
    id: 'desk',
    templateId: 'desk_office',
    category: 'Tables & Desks',
    xMm: 2000,
    yMm: 2000,
    rotationDeg: 0,
    parts: [makeBoxPart('dp', 1600, 800, 750)],
  });
  const monitor = makeFurniture({
    id: 'mon',
    templateId: 'tv_screen_stand',
    mountingType: 'surface',
    surfaceHostId: 'desk',
    xMm: 2400, // +400 local X
    yMm: 2000, // 0 local Y
    elevationMm: 750,
    rotationDeg: 0,
    parts: [makeBoxPart('mp', 550, 180, 420)],
  });

  // 1. Rotate desk 90 deg around its center -> monitor orbits from (+400, 0) to (0, +400) and rotates +90
  const deskRotated: FurnitureInstance = { ...deskPrev, rotationDeg: 90 };
  const afterRotate = propagateParentFurnitureTransforms([deskRotated, monitor], 'desk', deskPrev, deskRotated);
  const monRot = afterRotate.find((f) => f.id === 'mon')!;
  assert.equal(monRot.xMm, 2000);
  assert.equal(monRot.yMm, 2400);
  assert.equal(monRot.rotationDeg, 90);
  assert.equal(monRot.elevationMm, 750);

  // 2. Mirror desk X -> monitor at +400 local X reflects to -400 local X
  const deskMirrored: FurnitureInstance = { ...deskPrev, mirroredX: true };
  const afterMirror = propagateParentFurnitureTransforms([deskMirrored, monitor], 'desk', deskPrev, deskMirrored);
  const monMirror = afterMirror.find((f) => f.id === 'mon')!;
  assert.equal(monMirror.xMm, 1600);
  assert.equal(monMirror.yMm, 2000);

  // 3. Resize desk width 1600->3200 (2x) and height 750->900 -> monitor shifts to +800 local X and climbs to 900mm
  const deskResized: FurnitureInstance = {
    ...deskPrev,
    parts: [makeBoxPart('dp', 3200, 800, 900)],
  };
  const afterResize = propagateParentFurnitureTransforms([deskResized, monitor], 'desk', deskPrev, deskResized);
  const monResized = afterResize.find((f) => f.id === 'mon')!;
  assert.equal(monResized.xMm, 2800);
  assert.equal(monResized.elevationMm, 900);
});

test('wall movement updates wall-mounted furniture and parent deletion detaches children safely', () => {
  const wallOrig = makeWall('w1', 0, 0, 4000, 0, 200);
  const xf = computeAttachedWallFurnitureTransform(
    wallOrig,
    0.5,
    'left',
    {
      parts: [makeBoxPart('p', 1000, 300, 400)],
      mirroredX: false,
      mirroredY: false,
      rotationXDeg: 0,
      rotationYDeg: 0,
      wallOffsetMm: 0,
    }
  );
  const shelf = makeFurniture({
    id: 'shelf1',
    templateId: 'bed_shelf_floating',
    mountingType: 'wall',
    attachedWallId: 'w1',
    attachedFace: 'left',
    attachedT: xf.attachedT,
    xMm: xf.xMm,
    yMm: xf.yMm,
    rotationDeg: xf.rotationDeg,
    elevationMm: 900,
    parts: [makeBoxPart('sp', 1000, 300, 400)],
  });
  const vase = makeFurniture({
    id: 'vase1',
    templateId: 'decor_vase',
    mountingType: 'surface',
    surfaceHostId: 'shelf1',
    xMm: xf.xMm,
    yMm: xf.yMm,
    elevationMm: 1300,
    parts: [makeBoxPart('vp', 160, 160, 250)],
  });

  // Move wall +500mm in Y -> shelf moves +500mm in Y, and vase stacked on shelf moves too
  const wallMoved = makeWall('w1', 0, 500, 4000, 500, 200);
  const afterWallMove = propagateWallAttachments([shelf, vase], [wallMoved], new Set(['w1']));
  const shelfAfter = afterWallMove.find((f) => f.id === 'shelf1')!;
  const vaseAfter = afterWallMove.find((f) => f.id === 'vase1')!;
  assert.equal(shelfAfter.yMm, shelf.yMm + 500);
  assert.equal(vaseAfter.yMm, vase.yMm + 500);

  // Deleting wall detaches shelf cleanly without moving/deleting it; deleting shelf lowers vase safely to floor (elevationMm = 0)
  const detached = detachChildrenOnParentDelete(
    afterWallMove,
    new Set(['w1']),
    new Set(['shelf1'])
  );
  const shelfDetached = detached.find((f) => f.id === 'shelf1')!;
  const vaseDetached = detached.find((f) => f.id === 'vase1')!;
  assert.equal(shelfDetached.attachedWallId, undefined);
  assert.equal(shelfDetached.xMm, shelfAfter.xMm);
  assert.equal(vaseDetached.surfaceHostId, undefined);
  assert.equal(vaseDetached.elevationMm, 0);

  // JSON save/reopen preserves all attachment fields intact
  const json = JSON.stringify({ shelf, vase });
  const parsed = JSON.parse(json) as { shelf: FurnitureInstance; vase: FurnitureInstance };
  assert.equal(parsed.shelf.mountingType, 'wall');
  assert.equal(parsed.shelf.attachedWallId, 'w1');
  assert.equal(parsed.shelf.attachedFace, 'left');
  assert.equal(parsed.vase.mountingType, 'surface');
  assert.equal(parsed.vase.surfaceHostId, 'shelf1');

  // Verify bounding box computes consistent elevation bounds
  const box = computeFurnitureWorldBox({ x: parsed.shelf.xMm, y: parsed.shelf.yMm }, parsed.shelf);
  assert.equal(box.minZ, 900);
  assert.equal(box.maxZ, 1300);
});
