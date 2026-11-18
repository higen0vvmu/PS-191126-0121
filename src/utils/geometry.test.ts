import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePolygonAreaM2,
  computeWallPolygon,
  computeWallSurfaceAreaM2,
  detectRoomsFromWalls,
  getPlanCorners,
  snapPointToPlan,
  splitWallAtPoint,
  computeFurnitureBoundsMm,
  scaleFurnitureParts,
  computeWallInnerBounds,
  getWallMountedComponents,
  getNonCrossingClearances,
  solveWallComponentResize,
  solveWallClearanceEdit,
  solveWallLengthChange,
  solveConnectedWallLengthChange,
  findNearMissWallGaps,
  healNearWallGaps,
  computeAttachedChimneyTransform,
  doesChimneyOverlapWalls,
  getChimneyTouchingEdges,
  snapChimneyToWallEdge,
  snapFurnitureToPlan,
  solveChimneyResize,
  isCeilingFixture,
  getEnclosingRoomCeilingMm,
  getCeilingFixtureOffsetMm,
  computeFurnitureElevationSpanMm,
  syncRoomCeilingHeight,
  syncLevelCeilingHeight,
  getDefaultChimneyFaceColors,
  resolveChimneyFaceColors,
  isRugFurniture,
  sortFurnitureByZOrder,
  reorderFurnitureZOrder,
  getCommonValue,
  getFurnitureSolidFootprintPolygons,
  isFixedSizeFurniture,
  isWallMountItem,
  isWallMountedTv,
  projectFurnitureForWallCutThrough,
  solveSolidFurnitureMove,
  pointInPolygon,
  computeFurnitureTiltedLocalBoundsMm,
  computeFurnitureWorldBox,
  flipWallFace,
  isAcIndoorUnit,
  isCurtainOrBlindFurniture,
  resolveWallFaces,
  snapArchElementToPlan,
  canFurnitureCoexist,
  findConnectedRoomForBalcony,
  snapStandaloneCurtainToWall,
} from './geometry';
import * as THREE from 'three';
import { buildWall3DGroup } from './wall3d';
import {
  MATERIAL_CATEGORIES,
  MATERIAL_PRESETS,
  getDefaultTileMeters,
  getEffectiveMaterialHex,
  isPresetPreTinted,
} from '../data/materials';
import {
  buildWalkColliders,
  findSafeWalkSpawn,
  getWalkFloorAndCeilingAt,
  PLAYER_EYE_HEIGHT_M,
  PLAYER_HEIGHT_M,
  resolveWalkStep,
  WalkState,
} from './walkPhysics';
import { BUILTIN_CATALOG } from '../data/catalog';
import { createInitialProject } from '../data/templates';
import { ArchElement, FurnitureInstance, Level, Opening, Wall, FurniturePart } from '../types/plan';

function makeWall(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  alignment: Wall['alignment'] = 'center',
  thicknessMm = 150
): Wall {
  return {
    id,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thicknessMm,
    heightMm: 2800,
    alignment,
    isCurved: false,
    curveBulgeMm: 0,
    innerColor: '#FFFFFF',
    outerColor: '#FFFFFF',
    innerMaterial: 'paint',
    outerMaterial: 'paint',
    innerTextureScale: 1,
    outerTextureScale: 1,
    innerTextureRotDeg: 0,
    outerTextureRotDeg: 0,
    hasBaseboard: true,
    baseboardHeightMm: 80,
    baseboardColor: '#FFFFFF',
    hasCrownMolding: false,
    crownHeightMm: 60,
    crownColor: '#FFFFFF',
    visible: true,
    locked: false,
  };
}

test('detectRoomsFromWalls detects rectangular and L-shaped rooms with exact m² area', () => {
  // 4m x 3m rectangle = 12 m²
  const rectWalls = [
    makeWall('w1', 0, 0, 4000, 0),
    makeWall('w2', 4000, 0, 4000, 3000),
    makeWall('w3', 4000, 3000, 0, 3000),
    makeWall('w4', 0, 3000, 0, 0),
  ];
  const rooms = detectRoomsFromWalls(rectWalls, []);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].areaM2, 12);
  assert.equal(rooms[0].perimeterM, 14);
});

test('detectRoomsFromWalls splits a room when a T-junction partition wall is added', () => {
  const walls = [
    makeWall('w1', 0, 0, 6000, 0),
    makeWall('w2', 6000, 0, 6000, 4000),
    makeWall('w3', 6000, 4000, 0, 4000),
    makeWall('w4', 0, 4000, 0, 0),
    // Partition dividing 6m into 2m + 4m -> 8 m² and 16 m²
    makeWall('w5', 2000, 0, 2000, 4000),
  ];
  const rooms = detectRoomsFromWalls(walls, []);
  assert.equal(rooms.length, 2);
  const areas = rooms.map((r) => r.areaM2).sort((a, b) => a - b);
  assert.deepEqual(areas, [8, 16]);
});

test('computeWallPolygon respects wall alignment and mitres corners', () => {
  const w1 = makeWall('w1', 0, 0, 3000, 0, 'inner', 200);
  const w2 = makeWall('w2', 3000, 0, 3000, 3000, 'inner', 200);
  const poly1 = computeWallPolygon(w1, [w1, w2]);
  assert.equal(poly1.length, 4);
  // Inner face stays on y=0, outer face extends to y=200 (left normal of +X is +Y)
  assert.ok(Math.abs(poly1[2].y - 0) < 1e-3 || Math.abs(poly1[3].y - 0) < 1e-3);
  assert.equal(computePolygonAreaM2(poly1) > 0.5, true);
});

test('splitWallAtPoint splits wall and remaps openings onto respective halves', () => {
  const w = makeWall('w1', 0, 0, 4000, 0);
  const op1: Opening = {
    id: 'op1',
    name: 'Door 1',
    wallId: 'w1',
    t: 0.25,
    category: 'door',
    subtype: 'single',
    widthMm: 900,
    heightMm: 2100,
    sillHeightMm: 0,
    frameThicknessMm: 50,
    frameColor: '#334155',
    panelColor: '#FFFFFF',
    glassColor: '#BAE6FD',
    swingSide: 'left',
    swingDirection: 'in',
    openAngleDeg: 45,
    visible: true,
    locked: false,
  };
  const op2: Opening = { ...op1, id: 'op2', t: 0.75 };
  const res = splitWallAtPoint(w, { x: 2000, y: 0 }, [op1, op2]);
  assert.equal(res.walls[0].end.x, 2000);
  assert.equal(res.walls[1].start.x, 2000);
  assert.equal(res.openings[0].wallId, 'w1');
  assert.ok(Math.abs(res.openings[0].t - 0.5) < 1e-3);
  assert.equal(res.openings[1].wallId, res.walls[1].id);
  assert.ok(Math.abs(res.openings[1].t - 0.5) < 1e-3);
});

test('computeWallSurfaceAreaM2 subtracts opening areas for paint estimation', () => {
  const w = makeWall('w1', 0, 0, 4000, 0); // 4m * 2.8m = 11.2 m²
  const op: Opening = {
    id: 'op1',
    name: 'Window',
    wallId: 'w1',
    t: 0.5,
    category: 'window',
    subtype: 'double',
    widthMm: 2000,
    heightMm: 1200, // 2.4 m²
    sillHeightMm: 900,
    frameThicknessMm: 50,
    frameColor: '#334155',
    panelColor: '#FFFFFF',
    glassColor: '#BAE6FD',
    swingSide: 'left',
    swingDirection: 'in',
    openAngleDeg: 0,
    visible: true,
    locked: false,
  };
  const area = computeWallSurfaceAreaM2(w, [op]);
  assert.equal(area.grossAreaM2, 11.2);
  assert.equal(area.netAreaM2, 8.8);
});

test('multi-part furniture bounds and proportional scaling preserve part structure', () => {
  const parts: FurniturePart[] = [
    {
      id: 'p1',
      name: 'Main Seat',
      shape: 'box',
      xMm: 0,
      yMm: 0,
      zMm: 150,
      widthMm: 2000,
      depthMm: 900,
      heightMm: 300,
      rotationDeg: 0,
      color: '#FFFFFF',
      material: 'fabric',
    },
    {
      id: 'p2',
      name: 'Backrest',
      shape: 'box',
      xMm: 0,
      yMm: -350,
      zMm: 450,
      widthMm: 2000,
      depthMm: 200,
      heightMm: 400,
      rotationDeg: 0,
      color: '#FFFFFF',
      material: 'fabric',
    },
  ];
  const bounds = computeFurnitureBoundsMm(parts);
  assert.equal(bounds.widthMm, 2000);
  assert.equal(bounds.depthMm, 900);
  assert.equal(bounds.heightMm, 700);
  const scaled = scaleFurnitureParts(parts, 1.5, 1, 1);
  assert.equal(scaled[0].widthMm, 3000);
  assert.equal(scaled[1].widthMm, 3000);
});

test('getPlanCorners and snapPointToPlan preferCornersOnly snap to corners and ignore wall midpoints', () => {
  const walls = [makeWall('w1', 0, 0, 4000, 0, 'center', 200)];
  const table: FurnitureInstance = {
    id: 'f1',
    templateId: 'table',
    name: 'Table',
    category: 'Tables & Desks',
    xMm: 2000,
    yMm: 2000,
    elevationMm: 0,
    rotationDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: [
      {
        id: 'p1',
        name: 'Top',
        shape: 'box',
        xMm: 0,
        yMm: 0,
        zMm: 750,
        widthMm: 1000,
        depthMm: 600,
        heightMm: 40,
        rotationDeg: 0,
        color: '#FFFFFF',
        material: 'wood',
      },
    ],
    visible: true,
    locked: false,
  };

  const corners = getPlanCorners(walls, [table]);
  // Should include wall endpoints, wall polygon corners, and 4 table corners (1500,1700), (2500,1700), etc.
  assert.ok(corners.some((c) => Math.abs(c.x - 1500) < 1e-3 && Math.abs(c.y - 1700) < 1e-3));

  // Near wall endpoint (0, 0) -> snaps strictly to vertex (0,0)
  const nearCorner = snapPointToPlan(
    { x: 35, y: 20 },
    {
      walls,
      furniture: [table],
      gridSizeMm: 100,
      snapEnabled: true,
      angleSnapDeg: 0,
      orthoMode: false,
      preferCornersOnly: true,
    }
  );
  assert.equal(nearCorner.snappedKind, 'vertex');
  assert.deepEqual(nearCorner.point, { x: 0, y: 0 });

  // Near middle of wall (2000, 15) -> does NOT snap to wall segment when preferCornersOnly is true
  const nearMiddle = snapPointToPlan(
    { x: 2000, y: 15 },
    {
      walls,
      furniture: [table],
      gridSizeMm: 100,
      snapEnabled: true,
      angleSnapDeg: 0,
      orthoMode: false,
      preferCornersOnly: true,
    }
  );
  assert.notEqual(nearMiddle.snappedKind, 'wall');
  assert.equal(nearMiddle.snappedKind, 'grid');
  assert.deepEqual(nearMiddle.point, { x: 2000, y: 0 });
});

test('computeWallPolygon connects outside and inside corners cleanly for 90deg, 3-wall, and acute corners', () => {
  // 1. 2-wall 90-degree bend (center alignment, 200mm thick -> half = 100mm)
  const w1 = makeWall('w1', 0, 0, 3000, 0, 'center', 200);
  const w2 = makeWall('w2', 3000, 0, 3000, 3000, 'center', 200);
  const p1 = computeWallPolygon(w1, [w1, w2]);
  const p2 = computeWallPolygon(w2, [w1, w2]);
  assert.equal(p1.length, 4);
  assert.equal(p2.length, 4);

  const hasPoint = (poly: { x: number; y: number }[], x: number, y: number) =>
    poly.some((pt) => Math.abs(pt.x - x) < 1e-2 && Math.abs(pt.y - y) < 1e-2);

  // Outside corner (3100, -100) and inside corner (2900, 100) must appear on BOTH walls
  assert.ok(hasPoint(p1, 3100, -100), 'w1 should reach outside corner (3100, -100)');
  assert.ok(hasPoint(p2, 3100, -100), 'w2 should reach outside corner (3100, -100)');
  assert.ok(hasPoint(p1, 2900, 100), 'w1 should reach inside corner (2900, 100)');
  assert.ok(hasPoint(p2, 2900, 100), 'w2 should reach inside corner (2900, 100)');

  // 2. 3-wall intersection at (3000, 0): horizontal continuation + perpendicular branch
  const w3 = makeWall('w3', 3000, 0, 6000, 0, 'center', 200);
  const p1_3 = computeWallPolygon(w1, [w1, w2, w3]);
  const p2_3 = computeWallPolygon(w2, [w1, w2, w3]);
  const p3_3 = computeWallPolygon(w3, [w1, w2, w3]);
  // Top face remains continuous at y = -100 across w1 & w3
  assert.ok(hasPoint(p1_3, 3000, -100));
  assert.ok(hasPoint(p3_3, 3000, -100));
  // Lower corners meet w2 faces cleanly at (2900, 100) and (3100, 100)
  assert.ok(hasPoint(p1_3, 2900, 100) && hasPoint(p2_3, 2900, 100));
  assert.ok(hasPoint(p3_3, 3100, 100) && hasPoint(p2_3, 3100, 100));

  // 3. Acute 60-degree corner at (3000, 0)
  const wAcute = makeWall('wa', 3000, 0, 1500, 2598, 'center', 200);
  const pBase = computeWallPolygon(w1, [w1, wAcute]);
  const pAcute = computeWallPolygon(wAcute, [w1, wAcute]);
  assert.equal(pBase.length, 4);
  assert.equal(pAcute.length, 4);
  assert.ok(computePolygonAreaM2(pBase) > 0.4);
  assert.ok(computePolygonAreaM2(pAcute) > 0.4);
  // Shared corner vertices between w1 end (indices 1 & 2) and wAcute start (indices 0 & 3)
  const sharedCount = [pBase[1], pBase[2]].filter((pt) => hasPoint(pAcute, pt.x, pt.y)).length;
  assert.equal(sharedCount, 2, 'acute corner walls should share both inner and outer miter vertices');
});

test('snapPointToPlan aligns closing wall and dragged wall vertex with translucent X/Y guide to opposite wall point', () => {
  const w1 = makeWall('w1', 0, 0, 10000, 0);
  const w2 = makeWall('w2', 10000, 0, 10000, 10000);

  // Drafting Wall 3 from (10000, 10000) toward (-40, 10000) -> snaps X=0 and emits guide to (0, 0)
  const res = snapPointToPlan(
    { x: -40, y: 10025 },
    {
      walls: [w1, w2],
      gridSizeMm: 100,
      snapEnabled: true,
      angleSnapDeg: 15,
      orthoMode: true,
      anchor: { x: 10000, y: 10000 },
      snapThresholdMm: 150,
    }
  );
  assert.equal(res.snappedKind, 'align');
  assert.deepEqual(res.point, { x: 0, y: 10000 });
  const xGuide = res.guides.find((g) => g.axis === 'x');
  assert.ok(xGuide, 'expected an X alignment guide connecting Wall 3 endpoint to Wall 1 start');
  assert.deepEqual(xGuide.from, { x: 0, y: 10000 });
  assert.deepEqual(xGuide.to, { x: 0, y: 0 });

  // Dragging Wall 3 end vertex toward (-30, 10000) ignores its own original point and aligns cleanly to x=0
  const w3 = makeWall('w3', 10000, 10000, 500, 10000);
  const dragRes = snapPointToPlan(
    { x: -30, y: 10010 },
    {
      walls: [w1, w2, w3],
      gridSizeMm: 100,
      snapEnabled: true,
      angleSnapDeg: 15,
      orthoMode: false,
      anchor: w3.start,
      excludeWallId: 'w3',
      ignoreEndpoints: [w3.end],
      snapThresholdMm: 150,
    }
  );
  assert.equal(dragRes.snappedKind, 'align');
  assert.deepEqual(dragRes.point, { x: 0, y: 10000 });
  assert.ok(dragRes.guides.some((g) => g.axis === 'x' && g.to.x === 0 && g.to.y === 0));
});

test('non-crossing clearances stop at adjacent element instead of passing through to interior corner', () => {
  const walls = [
    makeWall('w_top', 0, 0, 5000, 0, 'center', 200),
    makeWall('w_left', 0, 0, 0, 4000, 'center', 200),
    makeWall('w_right', 5000, 0, 5000, 4000, 'center', 200),
  ];
  // Inner room span on w_top is 100 .. 4900
  const bounds = computeWallInnerBounds(walls[0], walls);
  assert.equal(bounds.innerStartS, 100);
  assert.equal(bounds.innerEndS, 4900);

  const opA: Opening = {
    id: 'opA',
    name: 'Door A',
    wallId: 'w_top',
    t: 0.25, // center=1250, width=800 -> [850, 1650]
    category: 'door',
    subtype: 'single',
    widthMm: 800,
    heightMm: 2100,
    sillHeightMm: 0,
    frameThicknessMm: 50,
    frameColor: '#1E293B',
    panelColor: '#FFFFFF',
    glassColor: '#E0F2FE',
    swingSide: 'left',
    swingDirection: 'in',
    openAngleDeg: 60,
    visible: true,
    locked: false,
  };
  const opB: Opening = {
    ...opA,
    id: 'opB',
    name: 'Window B',
    category: 'window',
    subtype: 'double',
    t: 0.65, // center=3250, width=1000 -> [2750, 3750]
    widthMm: 1000,
  };

  const comps = getWallMountedComponents(walls[0], [opA, opB], []);
  const clearB = getNonCrossingClearances('opB', comps, bounds, false);
  assert.ok(clearB.left && clearB.right);
  assert.equal(clearB.left.stopsAt, 'component');
  assert.equal(clearB.left.neighborId, 'opA');
  assert.equal(clearB.left.lengthMm, 1100); // 2750 - 1650 (stops at opA, does NOT pass through opA to corner!)
  assert.equal(clearB.right.stopsAt, 'corner');
  assert.equal(clearB.right.lengthMm, 1150); // 4900 - 3750
});

test('solveWallComponentResize eats wall segments, pushes unlocked components, and blocks on lock or overflow', () => {
  const walls = [
    makeWall('w_top', 0, 0, 5000, 0, 'center', 200),
    makeWall('w_left', 0, 0, 0, 4000, 'center', 200),
    makeWall('w_right', 5000, 0, 5000, 4000, 'center', 200),
  ];
  const bounds = computeWallInnerBounds(walls[0], walls); // inner 100..4900 (free = 4800)

  const opA: Opening = {
    id: 'opA',
    name: 'Door',
    wallId: 'w_top',
    t: 0.3, // center 1500, width 800 -> [1100, 1900]
    category: 'door',
    subtype: 'single',
    widthMm: 800,
    heightMm: 2100,
    sillHeightMm: 0,
    frameThicknessMm: 50,
    frameColor: '#1E293B',
    panelColor: '#FFFFFF',
    glassColor: '#E0F2FE',
    swingSide: 'left',
    swingDirection: 'in',
    openAngleDeg: 60,
    resizeAnchor: 'center',
    visible: true,
    locked: false,
  };
  const opB: Opening = {
    ...opA,
    id: 'opB',
    name: 'Window',
    t: 0.56, // center 2800, width 800 -> [2400, 3200] (gap between A & B = 500mm)
    widthMm: 800,
  };

  const comps = getWallMountedComponents(walls[0], [opA, opB], []);

  // Expand opB symmetrically to 2200 -> needs [1700, 3900], which eats the 500mm gap and pushes opA left by 200mm!
  const res1 = solveWallComponentResize(walls[0], comps, bounds, 'opB', 2200, 'center');
  assert.equal(res1.ok, true);
  const upA = res1.updates.find((u) => u.id === 'opA')!;
  const upB = res1.updates.find((u) => u.id === 'opB')!;
  assert.equal(upB.widthMm, 2200);
  // opB left edge at 1700, so opA pushed flush to [900, 1700] -> center 1300 / 5000 = 0.26
  assert.ok(Math.abs(upA.t * 5000 - 1300) < 1e-2);

  // Locking opA blocks opB from expanding left edge
  const lockedComps = comps.map((c) => (c.id === 'opA' ? { ...c, locked: true } : c));
  const resLocked = solveWallComponentResize(walls[0], lockedComps, bounds, 'opB', 2000, 'right');
  assert.equal(resLocked.ok, false);
  assert.match(resLocked.error ?? '', /locked/i);

  // Exceeding total free wall length (> 4000mm for opB since opA needs 800mm of 4800mm) fails with clear error
  const resOverflow = solveWallComponentResize(walls[0], comps, bounds, 'opB', 4200, 'center');
  assert.equal(resOverflow.ok, false);
  assert.match(resOverflow.error ?? '', /exceeds/i);
});

test('solveWallClearanceEdit, solveWallLengthChange, and computeAttachedChimneyTransform behave predictably', () => {
  const walls = [makeWall('w1', 0, 0, 4000, 0, 'center', 200)];
  const bounds = computeWallInnerBounds(walls[0], walls); // 0..4000
  const op: Opening = {
    id: 'op1',
    name: 'Door',
    wallId: 'w1',
    t: 0.5, // [1500, 2500]
    category: 'door',
    subtype: 'single',
    widthMm: 1000,
    heightMm: 2100,
    sillHeightMm: 0,
    frameThicknessMm: 50,
    frameColor: '#1E293B',
    panelColor: '#FFFFFF',
    glassColor: '#E0F2FE',
    swingSide: 'left',
    swingDirection: 'in',
    openAngleDeg: 60,
    visible: true,
    locked: false,
  };
  const comps = getWallMountedComponents(walls[0], [op], []);
  // Set left clearance to 500mm -> door shifts to [500, 1500], center = 1000 -> t = 0.25
  const cl = solveWallClearanceEdit(walls[0], comps, bounds, 'op1', 'left', 500);
  assert.equal(cl.ok, true);
  assert.ok(Math.abs(cl.updates[0].t - 0.25) < 1e-3);

  // Wall anchor modes
  const fixedLeftRes = solveWallLengthChange({ ...walls[0], anchorMode: 'fixed_left' }, 5000);
  assert.equal(fixedLeftRes.ok, true);
  assert.deepEqual(fixedLeftRes.start, { x: 0, y: 0 });
  assert.deepEqual(fixedLeftRes.end, { x: 5000, y: 0 });

  const fixedRightRes = solveWallLengthChange({ ...walls[0], anchorMode: 'fixed_right' }, 5000);
  assert.equal(fixedRightRes.ok, true);
  assert.deepEqual(fixedRightRes.start, { x: -1000, y: 0 });
  assert.deepEqual(fixedRightRes.end, { x: 4000, y: 0 });

  const fixedLenRes = solveWallLengthChange({ ...walls[0], anchorMode: 'fixed_length' }, 5000);
  assert.equal(fixedLenRes.ok, false);

  // Chimney flush transform on horizontal wall (thickness 200, depth 400 -> left face y=100, center y=300)
  const chim = computeAttachedChimneyTransform(walls[0], 0.5, 400, 'left');
  assert.equal(chim.xMm, 2000);
  assert.equal(chim.yMm, 300);
  assert.equal(chim.rotationDeg, 0);
});

test('solveConnectedWallLengthChange preserves all corners and room closure when resizing a crooked 4-wall room', () => {
  // Crooked quadrilateral room (none of the 4 walls are 0/90 orthogonal)
  let walls: Wall[] = [
    { ...makeWall('w1', 0, 0, 4000, 300), anchorMode: 'fixed_left' },
    { ...makeWall('w2', 4000, 300, 4300, 3200), anchorMode: 'fixed_left' },
    { ...makeWall('w3', 4300, 3200, -150, 2950), anchorMode: 'fixed_left' },
    { ...makeWall('w4', -150, 2950, 0, 0), anchorMode: 'fixed_left' },
  ];

  const applyLengthEdit = (wallId: string, nextLen: number) => {
    const target = walls.find((w) => w.id === wallId)!;
    const res = solveConnectedWallLengthChange(target, walls, [], [], nextLen);
    assert.equal(res.ok, true, res.error);
    walls = walls.map((w) => {
      const u = res.wallUpdates.find((x) => x.id === w.id);
      return u ? { ...w, start: u.start, end: u.end } : w;
    });
  };

  // Resize all four walls sequentially
  applyLengthEdit('w1', 5000);
  applyLengthEdit('w2', 3600);
  applyLengthEdit('w3', 4700);
  applyLengthEdit('w4', 3300);

  // Every corner must remain tightly joined (0 gaps!)
  assert.equal(findNearMissWallGaps(walls, 300, 2).length, 0);
  const rooms = detectRoomsFromWalls(walls, []);
  assert.equal(rooms.length, 1);
  assert.ok(rooms[0].areaM2 > 5);

  // Locked neighbor blocks resizing a moved corner instead of silently breaking the room
  const lockedWalls = walls.map((w) => (w.id === 'w2' ? { ...w, locked: true } : w));
  const blockedRes = solveConnectedWallLengthChange(lockedWalls[0], lockedWalls, [], [], 5600);
  assert.equal(blockedRes.ok, false);
  assert.match(blockedRes.error ?? '', /locked/i);
});

test('snapPointToPlan preserves neighbor endpoint re-seating via ignoreWallEnd and snaps to angled extensions', () => {
  // Crooked base wall at ~14 deg plus another angled wall
  const w1 = makeWall('w1', 0, 0, 4000, 1000);
  const w2 = makeWall('w2', 4000, 1000, 3000, 4000);

  // Dragging w2.start slightly off (4000, 1000) should snap cleanly back onto w1.end (4000, 1000)
  const reSeat = snapPointToPlan(
    { x: 4045, y: 1030 },
    {
      walls: [w1, w2],
      gridSizeMm: 100,
      snapEnabled: true,
      angleSnapDeg: 15,
      orthoMode: false,
      anchor: w2.end,
      excludeWallId: 'w2',
      ignoreWallEnd: { wallId: 'w2', endpoint: 'start' },
      snapThresholdMm: 180,
    }
  );
  assert.equal(reSeat.snappedKind, 'vertex');
  assert.deepEqual(reSeat.point, { x: 4000, y: 1000 });

  // Extending collinearly past w1.end along its 14-deg angle snaps onto the angled extension guide
  const extSnap = snapPointToPlan(
    { x: 6000, y: 1535 }, // exact collinear is (6000, 1500), 35mm off
    {
      walls: [w1],
      gridSizeMm: 100,
      snapEnabled: true,
      angleSnapDeg: 0,
      orthoMode: false,
      snapThresholdMm: 180,
    }
  );
  assert.equal(extSnap.snappedKind, 'align');
  assert.ok(extSnap.guides.some((g) => g.axis === 'ext'));
  assert.ok(Math.abs(extSnap.point.y - 1500) <= 2);
});

test('healNearWallGaps reconnects separated crooked corners into a watertight room', () => {
  const brokenWalls = [
    makeWall('w1', 0, 0, 4000, 200),
    makeWall('w2', 4090, 260, 4200, 3100), // 108mm gap at corner 2
    makeWall('w3', 4130, 3190, -100, 2950), // 114mm gap at corner 3
    makeWall('w4', -150, 2860, 40, -60), // gaps at corners 4 and 1
  ];
  assert.equal(detectRoomsFromWalls(brokenWalls, []).length, 0);
  const gaps = findNearMissWallGaps(brokenWalls, 260);
  assert.equal(gaps.length, 4);

  const healed = healNearWallGaps(brokenWalls, 260);
  assert.equal(healed.healedCount, 4);
  assert.equal(detectRoomsFromWalls(healed.walls, []).length, 1);
});

test('left and right edge-drag resize anchors pin opposite edge without shifting unrelated walls', () => {
  const walls = [makeWall('w1', 0, 0, 5000, 0, 'center', 200)];
  const bounds = computeWallInnerBounds(walls[0], walls);
  const op: Opening = {
    id: 'op1',
    name: 'Window',
    wallId: 'w1',
    t: 0.5, // [2000, 3000], width 1000
    category: 'window',
    subtype: 'double',
    widthMm: 1000,
    heightMm: 1200,
    sillHeightMm: 900,
    frameThicknessMm: 50,
    frameColor: '#1E293B',
    panelColor: '#FFFFFF',
    glassColor: '#E0F2FE',
    swingSide: 'left',
    swingDirection: 'in',
    openAngleDeg: 0,
    visible: true,
    locked: false,
  };
  const comps = getWallMountedComponents(walls[0], [op], []);

  // Dragging Left Edge outward by 400mm (width -> 1400) pins Right Edge at 3000 -> [1600, 3000], center = 2300
  const leftDrag = solveWallComponentResize(walls[0], comps, bounds, 'op1', 1400, 'right');
  assert.equal(leftDrag.ok, true);
  assert.equal(leftDrag.updates[0].widthMm, 1400);
  assert.ok(Math.abs(leftDrag.updates[0].t * 5000 - 2300) < 1e-2);

  // Dragging Right Edge outward by 400mm (width -> 1400) pins Left Edge at 2000 -> [2000, 3400], center = 2700
  const rightDrag = solveWallComponentResize(walls[0], comps, bounds, 'op1', 1400, 'left');
  assert.equal(rightDrag.ok, true);
  assert.equal(rightDrag.updates[0].widthMm, 1400);
  assert.ok(Math.abs(rightDrag.updates[0].t * 5000 - 2700) < 1e-2);
});

test('chimneys snap flush to wall edges, never overlap walls, detect touching edges, and stay glued in corners when resized', () => {
  // 4m x 3m room (200mm center walls -> inner edges at x=100..3900, y=100..2900)
  const walls = [
    makeWall('w_top', 0, 0, 4000, 0, 'center', 200),
    makeWall('w_right', 4000, 0, 4000, 3000, 'center', 200),
    makeWall('w_bottom', 4000, 3000, 0, 3000, 'center', 200),
    makeWall('w_left', 0, 3000, 0, 0, 'center', 200),
  ];

  // 1. Cursor placed right inside wall centerline at top-left corner -> snaps flush into inner corner [100..750] x [100..550]
  const snapCorner = snapChimneyToWallEdge(
    { x: 120, y: 20 },
    650,
    450,
    walls,
    [],
    [],
    undefined,
    true
  );
  assert.ok(snapCorner, 'expected valid wall-edge snap');
  assert.equal(snapCorner.wallId, 'w_top');
  assert.equal(snapCorner.face, 'left');
  assert.equal(snapCorner.cornerPin, 'left');
  assert.equal(
    doesChimneyOverlapWalls(snapCorner.xMm, snapCorner.yMm, 650, 450, snapCorner.rotationDeg, walls, 4),
    false,
    'snapped chimney must never overlap any wall'
  );
  // Left edge sits at x=100 -> center x = 100 + 325 = 425; top edge at y=100 -> center y = 100 + 225 = 325
  assert.ok(Math.abs(snapCorner.xMm - 425) <= 2);
  assert.ok(Math.abs(snapCorner.yMm - 325) <= 2);

  // 2. Touching edges in corner: both 'top' (host w_top) and 'left' (corner w_left) touch walls; 'bottom' and 'right' stay exposed
  const chimEl: ArchElement = {
    id: 'ch1',
    name: 'Chimney',
    type: 'chimney',
    xMm: snapCorner.xMm,
    yMm: snapCorner.yMm,
    elevationMm: 0,
    rotationDeg: snapCorner.rotationDeg,
    widthMm: 650,
    depthMm: 450,
    heightMm: 2800,
    color: '#FFFFFF',
    accentColor: '#334155',
    material: 'paint',
    attachedWallId: snapCorner.wallId,
    attachedFace: snapCorner.face,
    attachedT: snapCorner.t,
    resizeAnchor: 'center', // Even if anchor was 'center', corner pin must win!
    visible: true,
    locked: false,
  };
  const touching = getChimneyTouchingEdges(chimEl, walls);
  assert.deepEqual(touching, { top: true, bottom: false, left: true, right: false });

  // 3. Growing width in corner (650 -> 1000) keeps left edge glued at x=100 and expands right edge to 1100 (center=600)
  const growW = solveChimneyResize(walls[0], walls, [], [chimEl], 'ch1', 1000, 450);
  assert.equal(growW.ok, true);
  assert.equal(growW.cornerPin, 'left');
  const upGrow = growW.updates.find((u) => u.id === 'ch1')!;
  assert.equal(upGrow.widthMm, 1000);
  assert.ok(Math.abs(upGrow.t * 4000 - 600) <= 2, 'left edge stayed glued at x=100');

  // 4. Shrinking width in corner (650 -> 400) keeps left edge glued at x=100 and shrinks right edge to 500 (center=300)
  const shrinkW = solveChimneyResize(walls[0], walls, [], [chimEl], 'ch1', 400, 450);
  assert.equal(shrinkW.ok, true);
  assert.equal(shrinkW.cornerPin, 'left');
  const upShrink = shrinkW.updates.find((u) => u.id === 'ch1')!;
  assert.equal(upShrink.widthMm, 400);
  assert.ok(Math.abs(upShrink.t * 4000 - 300) <= 2, 'left edge stayed glued at x=100 when shrinking');

  // 5. Changing depth in corner (450 -> 800) keeps glued in corner, and excessive depth (> 2800mm hitting bottom wall) is blocked
  const growD = solveChimneyResize(walls[0], walls, [], [chimEl], 'ch1', 650, 800);
  assert.equal(growD.ok, true);
  assert.equal(growD.depthMm, 800);
  assert.equal(growD.cornerPin, 'left');

  const blockedD = solveChimneyResize(walls[0], walls, [], [chimEl], 'ch1', 650, 2900);
  assert.equal(blockedD.ok, false, 'chimney depth cannot penetrate opposing bottom wall');
});

function makeBoxFurn(
  id: string,
  name: string,
  templateId: string,
  xMm: number,
  yMm: number,
  widthMm: number,
  depthMm: number,
  heightMm = 800,
  elevationMm = 0,
  rotationDeg = 0
): FurnitureInstance {
  return {
    id,
    templateId,
    name,
    category: 'Sofas & Seating',
    xMm,
    yMm,
    elevationMm,
    rotationDeg,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: [
      {
        id: `${id}_p1`,
        name: 'Body',
        shape: 'box',
        xMm: 0,
        yMm: 0,
        zMm: heightMm / 2,
        widthMm,
        depthMm,
        heightMm,
        rotationDeg: 0,
        color: '#FFFFFF',
        material: 'wood',
      },
    ],
    visible: true,
    locked: false,
  };
}

test('snapFurnitureToPlan snaps flush to walls, into room corners, flush to adjacent furniture, and centers over rugs', () => {
  // 4m x 3m room with 200mm center walls -> inner room faces at x=100..3900, y=100..2900
  const walls = [
    makeWall('w_top', 0, 0, 4000, 0, 'center', 200),
    makeWall('w_right', 4000, 0, 4000, 3000, 'center', 200),
    makeWall('w_bottom', 4000, 3000, 0, 3000, 'center', 200),
    makeWall('w_left', 0, 3000, 0, 0, 'center', 200),
  ];

  // 1. Sofa near top wall (2000 x 900 -> halfD = 450, inner face y=100 -> ideal center y=550)
  // Also rotated slightly (5 deg) -> gently straightens to 0 deg flush against wall
  const sofa = makeBoxFurn('f_sofa', 'Sofa', 'sofa_straight_3', 2000, 620, 2000, 900, 820, 0, 5);
  const sofaSnap = snapFurnitureToPlan({ x: 2000, y: 620 }, sofa, walls, [], {
    snapEnabled: true,
    gridSizeMm: 50,
  });
  assert.equal(sofaSnap.snappedKind, 'wall');
  assert.equal(sofaSnap.rotationDeg, 0);
  assert.ok(Math.abs(sofaSnap.yMm - 550) <= 1, `expected sofa center y=550 flush to top wall, got ${sofaSnap.yMm}`);

  // 2. Bookcase near top-left corner (1000 x 400 -> halfW=500, halfD=200 -> corner center (600, 300))
  const bookcase = makeBoxFurn('f_book', 'Bookcase', 'bookcase_tall', 650, 360, 1000, 400, 2000, 0, 0);
  const cornerSnap = snapFurnitureToPlan({ x: 650, y: 360 }, bookcase, walls, [], {
    snapEnabled: true,
    gridSizeMm: 50,
  });
  assert.equal(cornerSnap.snappedKind, 'vertex');
  assert.equal(cornerSnap.snapLabel, 'Corner Flush');
  assert.ok(Math.abs(cornerSnap.xMm - 600) <= 1);
  assert.ok(Math.abs(cornerSnap.yMm - 300) <= 1);

  // 3. Nightstand placed against top wall next to a bed -> snaps flush to BOTH top wall AND bed side edge
  const bed = makeBoxFurn('f_bed', 'Queen Bed', 'bed_queen', 2000, 1150, 1700, 2100, 1000, 0, 0);
  // Bed spans X=[1150..2850], Y=[100..2200]. Nightstand 500x450 dragged near right side X~3140, Y~380
  const nightstand = makeBoxFurn('f_ns', 'Nightstand', 'nightstand_oak', 3140, 380, 500, 450, 550, 0, 0);
  const nsSnap = snapFurnitureToPlan({ x: 3140, y: 380 }, nightstand, walls, [bed], {
    snapEnabled: true,
    gridSizeMm: 50,
  });
  assert.ok(Math.abs(nsSnap.yMm - 325) <= 1, 'nightstand snaps flush to top wall (100 + 225 = 325)');
  assert.ok(Math.abs(nsSnap.xMm - 3100) <= 1, 'nightstand snaps flush against bed right edge (2850 + 250 = 3100)');
  assert.ok(nsSnap.guides.some((g) => g.label === 'FLUSH'));

  // 4. Coffee table over a rug aligns to rug center instead of bumping against rug perimeter
  const rug: FurnitureInstance = {
    ...makeBoxFurn('f_rug', 'Area Rug', 'rug_woven', 2200, 1800, 2400, 1600, 15, 0, 0),
    parts: [
      {
        id: 'rug_p1',
        name: 'Rug',
        shape: 'box',
        detailStyle: 'fringe_rug',
        xMm: 0,
        yMm: 0,
        zMm: 8,
        widthMm: 2400,
        depthMm: 1600,
        heightMm: 15,
        rotationDeg: 0,
        color: '#E7E5E4',
        material: 'fabric',
      },
    ],
  };
  const coffeeTable = makeBoxFurn('f_ct', 'Coffee Table', 'table_coffee', 2235, 1775, 1200, 650, 420, 0, 0);
  const ctSnap = snapFurnitureToPlan({ x: 2235, y: 1775 }, coffeeTable, walls, [rug], {
    snapEnabled: true,
    gridSizeMm: 50,
  });
  assert.equal(ctSnap.xMm, 2200);
  assert.equal(ctSnap.yMm, 1800);
  assert.equal(ctSnap.snappedKind, 'align');

  // 5. Bypassing snap keeps exact pointer coordinates
  const bypass = snapFurnitureToPlan({ x: 1234, y: 1567 }, coffeeTable, walls, [rug], {
    snapEnabled: false,
    gridSizeMm: 50,
  });
  assert.equal(bypass.xMm, 1234);
  assert.equal(bypass.yMm, 1567);
  assert.equal(bypass.snappedKind, 'none');
});

test('ceiling lights mount flush on the underside of the ceiling across all room ceiling heights', () => {
  const walls = [
    makeWall('w1', 0, 0, 4000, 0, 'center', 200),
    makeWall('w2', 4000, 0, 4000, 4000, 'center', 200),
    makeWall('w3', 4000, 4000, 0, 4000, 'center', 200),
    makeWall('w4', 0, 4000, 0, 0, 'center', 200),
  ];
  const rooms = detectRoomsFromWalls(walls, [], 2800).map((r) => ({ ...r, ceilingHeightMm: 2400 }));

  // Default pendant authored near 2800mm (part spans z=2150..2790)
  const pendant: FurnitureInstance = {
    ...makeBoxFurn('f_pendant', 'Pendant Lamp', 'light_pendant_dome', 2000, 2000, 420, 420, 640, 0, 0),
    category: 'Lighting',
    parts: [
      {
        id: 'stem',
        name: 'Stem & Canopy',
        shape: 'cylinder',
        xMm: 0,
        yMm: 0,
        zMm: 2150,
        widthMm: 100,
        depthMm: 100,
        heightMm: 640, // top = 2790
        rotationDeg: 0,
        color: '#334155',
        material: 'metal',
      },
    ],
  };

  assert.equal(isCeilingFixture(pendant), true);
  assert.equal(getEnclosingRoomCeilingMm({ x: 2000, y: 2000 }, rooms, 2800), 2400);

  for (const ceilH of [2400, 2800, 3600]) {
    const offset = getCeilingFixtureOffsetMm(pendant, ceilH);
    const span = computeFurnitureElevationSpanMm(pendant, ceilH);
    assert.equal(offset, ceilH - 1 - 2790);
    assert.equal(span.maxZ, ceilH - 1, `top of fixture must hug underside of ${ceilH}mm ceiling`);
    assert.equal(span.maxZ - span.minZ, 640);
  }
});

test('syncRoomCeilingHeight and syncLevelCeilingHeight keep room perimeter walls and ceiling-connected arches aligned', () => {
  const walls = [
    makeWall('w1', 0, 0, 4000, 0, 'center', 200),
    makeWall('w2', 4000, 0, 4000, 3000, 'center', 200),
    makeWall('w3', 4000, 3000, 0, 3000, 'center', 200),
    makeWall('w4', 0, 3000, 0, 0, 'center', 200),
    // Separate detached wall elsewhere not bordering the room
    makeWall('w_other', 7000, 0, 9000, 0, 'center', 200),
  ];
  const rooms = detectRoomsFromWalls(walls.slice(0, 4), [], 2800);
  assert.equal(rooms.length, 1);

  const chimney: ArchElement = {
    id: 'ch1',
    name: 'Chimney',
    type: 'chimney',
    xMm: 425,
    yMm: 325,
    elevationMm: 0,
    rotationDeg: 0,
    widthMm: 450,
    depthMm: 450,
    heightMm: 2800,
    connectToCeiling: true,
    attachedWallId: 'w1',
    color: '#FFFFFF',
    accentColor: '#334155',
    material: 'paint',
    visible: true,
    locked: false,
  };

  const level: Level = {
    id: 'lvl_1',
    name: 'Ground Floor',
    elevationMm: 0,
    ceilingHeightMm: 2800,
    walls,
    openings: [],
    rooms,
    furniture: [],
    archElements: [chimney],
    curtains: [],
    people: [],
    measurements: [],
    annotations: [],
    sectionLine: null,
    backgroundTrace: null,
    layers: {
      walls: true,
      rooms: true,
      openings: true,
      furniture: true,
      curtains: true,
      people: true,
      archElements: true,
      measurements: true,
      annotations: true,
      autoDimensions: true,
      grid: true,
    },
  };

  const raised = syncRoomCeilingHeight(level, rooms[0].id, 3200);
  assert.equal(raised.rooms[0].ceilingHeightMm, 3200);
  assert.equal(raised.ceilingHeightMm, 3200);
  for (const wid of ['w1', 'w2', 'w3', 'w4']) {
    assert.equal(raised.walls.find((w) => w.id === wid)?.heightMm, 3200);
  }
  assert.equal(raised.walls.find((w) => w.id === 'w_other')?.heightMm, 2800);
  assert.equal(raised.archElements[0].heightMm, 3200);

  const levelSynced = syncLevelCeilingHeight(raised, 2600);
  assert.equal(levelSynced.ceilingHeightMm, 2600);
  assert.equal(levelSynced.rooms[0].ceilingHeightMm, 2600);
  assert.ok(levelSynced.walls.slice(0, 4).every((w) => w.heightMm === 2600));
  assert.equal(levelSynced.archElements[0].heightMm, 2600);
});

test('chimney face colors are deterministic, distinct per face, and respect custom overrides', () => {
  const autoA = getDefaultChimneyFaceColors('chim_abc');
  const autoB = getDefaultChimneyFaceColors('chim_abc');
  assert.deepEqual(autoA, autoB);
  const uniqueAuto = new Set([autoA.front, autoA.back, autoA.left, autoA.right]);
  assert.equal(uniqueAuto.size, 4);

  const resolved = resolveChimneyFaceColors({
    id: 'chim_abc',
    faceColors: { front: '#112233', back: autoA.back, left: autoA.left, right: '#445566' },
  });
  assert.equal(resolved.front, '#112233');
  assert.equal(resolved.right, '#445566');
  assert.equal(resolved.back, autoA.back);
});

test('furniture 2D zOrder defaults rugs underneath furniture and supports Bring Forward / Send Backward', () => {
  const sofa = makeBoxFurn('f_sofa', 'Sofa', 'sofa_straight_3', 1000, 1000, 2000, 900);
  const rug: FurnitureInstance = {
    ...makeBoxFurn('f_rug', 'Area Rug', 'rug_woven', 1000, 1000, 2500, 1800, 15),
    parts: [
      {
        id: 'rp1',
        name: 'Rug',
        shape: 'box',
        detailStyle: 'fringe_rug',
        xMm: 0,
        yMm: 0,
        zMm: 0,
        widthMm: 2500,
        depthMm: 1800,
        heightMm: 15,
        rotationDeg: 0,
        color: '#E7E5E4',
        material: 'fabric',
      },
    ],
  };
  const table = makeBoxFurn('f_table', 'Coffee Table', 'table_coffee', 1000, 1000, 1000, 600, 420);

  // Even when rug was created AFTER sofa, sortFurnitureByZOrder places rug first (underneath)
  assert.equal(isRugFurniture(rug), true);
  const sorted = sortFurnitureByZOrder([sofa, table, rug]);
  assert.deepEqual(sorted.map((f) => f.id), ['f_rug', 'f_sofa', 'f_table']);

  // Bring sofa forward past table, then send rug to front or table backward
  const brought = reorderFurnitureZOrder(sorted, new Set(['f_sofa']), 'bring_forward');
  assert.deepEqual(
    sortFurnitureByZOrder(brought).map((f) => f.id),
    ['f_rug', 'f_table', 'f_sofa']
  );

  const sentBack = reorderFurnitureZOrder(brought, new Set(['f_sofa']), 'send_backward');
  assert.deepEqual(
    sortFurnitureByZOrder(sentBack).map((f) => f.id),
    ['f_rug', 'f_sofa', 'f_table']
  );

  const front = reorderFurnitureZOrder(sentBack, new Set(['f_rug']), 'bring_to_front');
  assert.deepEqual(
    sortFurnitureByZOrder(front).map((f) => f.id),
    ['f_sofa', 'f_table', 'f_rug']
  );
});

test('getCommonValue identifies uniform vs differing shared properties across multi-selected items', () => {
  const walls = [
    { ...makeWall('w1', 0, 0, 4000, 0), heightMm: 2800, thicknessMm: 150 },
    { ...makeWall('w2', 4000, 0, 4000, 3000), heightMm: 2800, thicknessMm: 200 },
  ];
  assert.deepEqual(getCommonValue(walls, (w) => w.heightMm), { mixed: false, value: 2800 });
  assert.equal(getCommonValue(walls, (w) => w.thicknessMm).mixed, true);
});

test('solveSolidFurnitureMove prevents clipping, glides along walls, allows rugs/ceiling lights, and handles logical tabletop stacking', () => {
  // 4m x 3m room with 200mm walls -> interior spans X=[100..3900], Y=[100..2900]
  const walls = [
    makeWall('w_top', 0, 0, 4000, 0, 'center', 200),
    makeWall('w_right', 4000, 0, 4000, 3000, 'center', 200),
    makeWall('w_bottom', 4000, 3000, 0, 3000, 'center', 200),
    makeWall('w_left', 0, 3000, 0, 0, 'center', 200),
  ];

  // 1. Sofa pushed diagonally through top wall (-400mm beyond wall) stays flush at Y=550 and glides horizontally to X=2600
  const sofa = makeBoxFurn('f_sofa', 'Sofa', 'sofa_straight_3', 1800, 550, 2000, 900, 820, 0, 0);
  const glideRes = solveSolidFurnitureMove(
    { x: 1800, y: 550 },
    { x: 2600, y: -300 },
    sofa,
    { walls, furniture: [sofa], archElements: [] },
    { snapEnabled: true, gridSizeMm: 50 }
  );
  assert.ok(glideRes.yMm >= 550 - 2, `sofa must not clip through top wall (got y=${glideRes.yMm})`);
  assert.ok(glideRes.xMm >= 2500, `sofa must glide smoothly along top wall (got x=${glideRes.xMm})`);

  // 2. Sideboard next to sofa blocks horizontal overlap into sofa
  const sideboard = {
    ...makeBoxFurn('f_sb', 'Sideboard', 'sideboard_fluted', 3300, 1200, 1200, 450, 750, 0, 0),
    category: 'Storage & Media' as const,
  };
  const blocked = solveSolidFurnitureMove(
    { x: 3300, y: 1200 },
    { x: 1900, y: 550 },
    sideboard,
    { walls, furniture: [sofa, sideboard], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  // Sideboard should not end up centered inside sofa [800..2800] x [100..1000]
  const overlapsSofaX = blocked.xMm - 600 < 2800 - 10 && blocked.xMm + 600 > 800 + 10;
  const overlapsSofaY = blocked.yMm - 225 < 1000 - 10 && blocked.yMm + 225 > 100 + 10;
  assert.equal(overlapsSofaX && overlapsSofaY, false, 'solid sideboard must not intersect sofa');

  // 3. Rug & Pendant light are freely traversable and do not block solid floor furniture
  const rug: FurnitureInstance = {
    ...makeBoxFurn('f_rug', 'Area Rug', 'rug_woven', 2000, 1800, 2400, 1600, 15),
    parts: [
      {
        id: 'rp1',
        name: 'Rug',
        shape: 'box',
        detailStyle: 'fringe_rug',
        xMm: 0,
        yMm: 0,
        zMm: 0,
        widthMm: 2400,
        depthMm: 1600,
        heightMm: 15,
        rotationDeg: 0,
        color: '#E7E5E4',
        material: 'fabric',
      },
    ],
  };
  const pendant: FurnitureInstance = {
    ...makeBoxFurn('f_pend', 'Pendant', 'light_pendant_dome', 2000, 1800, 400, 400, 500, 0, 0),
    category: 'Lighting',
  };
  const chair = makeBoxFurn('f_chair', 'Chair', 'chair_dining', 2000, 1500, 500, 500, 820, 0, 0);
  const overRugRes = solveSolidFurnitureMove(
    { x: 2000, y: 1500 },
    { x: 2000, y: 1800 },
    chair,
    { walls, furniture: [rug, pendant, chair], archElements: [] },
    { snapEnabled: true, gridSizeMm: 50 }
  );
  assert.equal(overRugRes.xMm, 2000);
  assert.equal(overRugRes.yMm, 1800);

  // 4. TV dragged onto a TV Media Unit automatically sits on top of the console deck, then resets to 0 when moved off
  const mediaUnit: FurnitureInstance = {
    ...makeBoxFurn('f_media', 'TV Media Console', 'tv_unit_media', 2000, 325, 1800, 450, 500, 0, 0),
    category: 'Storage & Media',
    parts: [
      {
        id: 'console',
        name: 'Console',
        shape: 'box',
        detailStyle: 'cabinet',
        xMm: 0,
        yMm: 0,
        zMm: 120,
        widthMm: 1800,
        depthMm: 450,
        heightMm: 380, // deck top = 500mm
        rotationDeg: 0,
        color: '#334155',
        material: 'wood',
      },
    ],
  };
  const tv: FurnitureInstance = {
    ...makeBoxFurn('f_tv', '55" TV', 'tv_screen_stand', 2000, 1500, 1220, 160, 740, 0, 0),
    category: 'Storage & Media',
  };
  const onMedia = solveSolidFurnitureMove(
    { x: 2000, y: 1500 },
    { x: 2000, y: 325 },
    tv,
    { walls, furniture: [mediaUnit, tv], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.equal(onMedia.surfaceHostId, 'f_media');
  assert.equal(onMedia.elevationMm, 500);

  const hostedTv = { ...tv, xMm: onMedia.xMm, yMm: onMedia.yMm, elevationMm: 500, surfaceHostId: 'f_media' };
  const offMedia = solveSolidFurnitureMove(
    { x: onMedia.xMm, y: onMedia.yMm },
    { x: 2000, y: 1600 },
    hostedTv,
    { walls, furniture: [mediaUnit, hostedTv], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.equal(offMedia.surfaceHostId, undefined);
  assert.equal(offMedia.elevationMm, 0);

  // 5. Bookshelf dragged onto TV Media Console is solid floor furniture and CANNOT overlap/sit on top of it
  const bookshelf: FurnitureInstance = {
    ...makeBoxFurn('f_bk', 'Bookshelf', 'bookcase_tall', 2000, 1500, 900, 360, 2000, 0, 0),
    parts: [
      {
        id: 'bk_p1',
        name: 'Body',
        shape: 'box',
        xMm: 0,
        yMm: 0,
        zMm: 0,
        widthMm: 900,
        depthMm: 360,
        heightMm: 2000,
        rotationDeg: 0,
        color: '#FFFFFF',
        material: 'wood',
      },
    ],
  };
  const bkIntoMedia = solveSolidFurnitureMove(
    { x: 2000, y: 1500 },
    { x: 2000, y: 325 },
    bookshelf,
    { walls, furniture: [mediaUnit, bookshelf], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  // Must stop outside media unit (media bottom edge = 325+225 = 550; bookshelf halfD = 180 -> center y >= 730)
  assert.ok(bkIntoMedia.yMm >= 725, `bookshelf must stop solid outside media console (got y=${bkIntoMedia.yMm})`);

  // 6. Wall-mounted raised TV (elevation 1100mm) glides cleanly behind/above low media console (500mm)
  const wallTv = { ...tv, elevationMm: 1100, surfaceHostId: undefined };
  const wallTvRes = solveSolidFurnitureMove(
    { x: 2000, y: 1500 },
    { x: 2000, y: 200 },
    wallTv,
    { walls, furniture: [mediaUnit, wallTv], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.equal(wallTvRes.xMm, 2000);
  assert.equal(wallTvRes.yMm, 200);
});

test('concave L/U sofas allow coffee tables inside their open pockets while blocking solid cushions, and allowOverlap (Shift) lets furniture overlap', () => {
  const walls = [
    makeWall('w_top', 0, 0, 6000, 0, 'center', 200),
    makeWall('w_right', 6000, 0, 6000, 5000, 'center', 200),
    makeWall('w_bottom', 6000, 5000, 0, 5000, 'center', 200),
    makeWall('w_left', 0, 5000, 0, 0, 'center', 200),
  ];

  // Real catalog L-shaped sectional layout centered at (2500, 1800)
  // Main seat: X=[1240..2860], Y=[1010..1870]; Chaise: X=[2860..3760], Y=[1870..2770]
  // Open inner L pocket: X=[1240..2860], Y=[1870..2770]
  const lSofa: FurnitureInstance = {
    ...makeBoxFurn('f_lsofa', 'L-Shaped Sectional Sofa', 'sofa_l_sectional', 2500, 1800, 2700, 1800, 820, 0, 0),
    parts: [
      { id: 'main_seat', name: 'Main Seat', shape: 'rounded_rect', xMm: -450, yMm: -360, zMm: 120, widthMm: 1620, depthMm: 860, heightMm: 310, rotationDeg: 0, color: '#CBD5E1', material: 'fabric', detailStyle: 'cushion' },
      { id: 'corner_seat', name: 'Corner Module', shape: 'rounded_rect', xMm: 810, yMm: -360, zMm: 120, widthMm: 900, depthMm: 860, heightMm: 310, rotationDeg: 0, color: '#CBD5E1', material: 'fabric', detailStyle: 'cushion' },
      { id: 'chaise_seat', name: 'Chaise Lounge', shape: 'rounded_rect', xMm: 810, yMm: 520, zMm: 120, widthMm: 900, depthMm: 900, heightMm: 310, rotationDeg: 0, color: '#CBD5E1', material: 'fabric', detailStyle: 'cushion' },
      { id: 'back_main', name: 'Main Backrest', shape: 'rounded_rect', xMm: -450, yMm: -720, zMm: 430, widthMm: 1620, depthMm: 180, heightMm: 390, rotationDeg: 0, color: '#CBD5E1', material: 'fabric', detailStyle: 'backrest' },
      { id: 'arm_left', name: 'Left Armrest', shape: 'rounded_rect', xMm: -1170, yMm: -360, zMm: 220, widthMm: 180, depthMm: 860, heightMm: 400, rotationDeg: 0, color: '#CBD5E1', material: 'fabric', detailStyle: 'armrest' },
    ],
  };

  const lSofaPolys = getFurnitureSolidFootprintPolygons({ x: 2500, y: 1800 }, lSofa);
  assert.ok(lSofaPolys.length >= 3 && lSofaPolys.length <= 5, `expected decomposed L-parts, got ${lSofaPolys.length}`);

  const coffeeTable: FurnitureInstance = {
    ...makeBoxFurn('f_ct', 'Coffee Table', 'table_coffee', 2050, 3400, 1100, 650, 420, 0, 0),
    category: 'Tables & Desks',
    parts: [
      { id: 'top', name: 'Top', shape: 'rounded_rect', xMm: 0, yMm: 0, zMm: 380, widthMm: 1100, depthMm: 650, heightMm: 40, rotationDeg: 0, color: '#8B5A2B', material: 'wood', detailStyle: 'table_top' },
      { id: 'legs', name: 'Base', shape: 'box', xMm: 0, yMm: 0, zMm: 0, widthMm: 950, depthMm: 520, heightMm: 380, rotationDeg: 0, color: '#334155', material: 'metal' },
    ],
  };

  // 1. Coffee table moves freely into the open L pocket (2050, 2320) without being repelled by the sofa's outer bounding box
  const insideL = solveSolidFurnitureMove(
    { x: 2050, y: 3400 },
    { x: 2050, y: 2320 },
    coffeeTable,
    { walls, furniture: [lSofa, coffeeTable], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.equal(insideL.xMm, 2050);
  assert.equal(insideL.yMm, 2320);

  // 2. Pushing coffee table further up into the main sofa seat cushion (Y=1600) is still blocked at seat edge (1870 + 325 = 2195)
  const hitSeat = solveSolidFurnitureMove(
    { x: 2050, y: 2320 },
    { x: 2050, y: 1600 },
    { ...coffeeTable, xMm: 2050, yMm: 2320 },
    { walls, furniture: [lSofa, coffeeTable], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.ok(hitSeat.yMm >= 2190, `coffee table should stop solid at L-sofa seat front (got y=${hitSeat.yMm})`);

  // 3. Moving L-sofa around stationary coffee table inside its L pocket also succeeds cleanly
  const placedTable = { ...coffeeTable, xMm: 2050, yMm: 2320 };
  const moveSofaAroundTable = solveSolidFurnitureMove(
    { x: 2500, y: 2100 },
    { x: 2500, y: 1800 },
    { ...lSofa, yMm: 2100 },
    { walls, furniture: [lSofa, placedTable], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.equal(moveSofaAroundTable.xMm, 2500);
  assert.equal(moveSofaAroundTable.yMm, 1800);

  // 4. U-shaped sectional leaves its center U pocket open for a coffee table
  const uSofa: FurnitureInstance = {
    ...makeBoxFurn('f_usofa', 'U-Shaped Lounge Sofa', 'sofa_u_sectional', 3000, 2000, 3200, 1700, 810, 0, 0),
    parts: [
      { id: 'center_seat', name: 'Center Seat', shape: 'rounded_rect', xMm: 0, yMm: -400, zMm: 120, widthMm: 1400, depthMm: 900, heightMm: 310, rotationDeg: 0, color: '#CBD5E1', material: 'fabric', detailStyle: 'cushion' },
      { id: 'left_wing', name: 'Left Wing', shape: 'rounded_rect', xMm: -1150, yMm: 0, zMm: 120, widthMm: 900, depthMm: 1700, heightMm: 310, rotationDeg: 0, color: '#CBD5E1', material: 'fabric', detailStyle: 'cushion' },
      { id: 'right_wing', name: 'Right Wing', shape: 'rounded_rect', xMm: 1150, yMm: 0, zMm: 120, widthMm: 900, depthMm: 1700, heightMm: 310, rotationDeg: 0, color: '#CBD5E1', material: 'fabric', detailStyle: 'cushion' },
    ],
  };
  // Open U pocket: X=[2300..3700] (1400mm wide), Y=[2050..2850] (800mm deep)
  const insideU = solveSolidFurnitureMove(
    { x: 3000, y: 3600 },
    { x: 3000, y: 2450 },
    coffeeTable,
    { walls, furniture: [uSofa, coffeeTable], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.equal(insideU.xMm, 3000);
  assert.equal(insideU.yMm, 2450);

  // 5. Shift key (allowOverlap: true) lets furniture freely overlap other solid furniture and walls
  const overlapSeat = solveSolidFurnitureMove(
    { x: 2050, y: 2320 },
    { x: 2050, y: 1450 },
    coffeeTable,
    { walls, furniture: [lSofa, coffeeTable], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50, allowOverlap: true }
  );
  assert.equal(overlapSeat.xMm, 2050);
  assert.equal(overlapSeat.yMm, 1450);

  const overlapWall = solveSolidFurnitureMove(
    { x: 2500, y: 1800 },
    { x: 2500, y: 100 },
    lSofa,
    { walls, furniture: [lSofa], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50, allowOverlap: true }
  );
  assert.equal(overlapWall.xMm, 2500);
  assert.equal(overlapWall.yMm, 100);
});

test('projectFurnitureForWallCutThrough enforces 0.7m distance cap and renders only visible faces from viewing angle', () => {
  // Top horizontal wall y=0, 200mm center -> inner face at y = +100
  const wall = makeWall('w_top', 0, 0, 5000, 0, 'center', 200);

  const wardrobe: FurnitureInstance = {
    ...makeBoxFurn('f_wardrobe', 'Double Wardrobe', 'wardrobe_double', 2000, 400, 1600, 600, 2200, 0, 0),
    category: 'Beds & Bedroom',
    parts: [
      { id: 'carcass', name: 'Carcass', shape: 'box', xMm: 0, yMm: -15, zMm: 60, widthMm: 1600, depthMm: 570, heightMm: 2140, rotationDeg: 0, color: '#FFFFFF', material: 'paint' },
      { id: 'plinth', name: 'Plinth', shape: 'box', xMm: 0, yMm: -15, zMm: 0, widthMm: 1580, depthMm: 550, heightMm: 60, rotationDeg: 0, color: '#E2E8F0', material: 'paint' },
      { id: 'door_l', name: 'Left Door', shape: 'box', xMm: -398, yMm: 285, zMm: 65, widthMm: 792, depthMm: 24, heightMm: 2130, rotationDeg: 0, color: '#F8FAFC', material: 'paint' },
      { id: 'door_r', name: 'Right Door', shape: 'box', xMm: 398, yMm: 285, zMm: 65, widthMm: 792, depthMm: 24, heightMm: 2130, rotationDeg: 0, color: '#F8FAFC', material: 'paint' },
      { id: 'handle_l', name: 'Left Handle', shape: 'box', xMm: -45, yMm: 305, zMm: 950, widthMm: 22, depthMm: 26, heightMm: 240, rotationDeg: 0, color: '#334155', material: 'metal' },
      { id: 'handle_r', name: 'Right Handle', shape: 'box', xMm: 45, yMm: 305, zMm: 950, widthMm: 22, depthMm: 26, heightMm: 240, rotationDeg: 0, color: '#334155', material: 'metal' },
    ],
  };

  // 1. Front facing room (0 deg): doors and handles are closest to camera -> visible and ordered back-to-front
  const frontView = projectFurnitureForWallCutThrough(wall, 'inner', wardrobe, 2800, 700);
  assert.equal(frontView.status, 'visible');
  if (frontView.status === 'visible') {
    const ids = frontView.visibleParts.map((vp) => vp.part.id);
    assert.ok(ids.includes('door_l') && ids.includes('door_r'));
    assert.ok(ids.includes('handle_l') && ids.includes('handle_r'));
    // Handles appear after doors (drawn on top in painter's order)
    assert.ok(ids.indexOf('handle_l') > ids.indexOf('door_l'));
  }

  // 2. Back facing room (180 deg, facing into wall): carcass hides doors & handles completely
  const backWardrobe = { ...wardrobe, rotationDeg: 180 };
  const backView = projectFurnitureForWallCutThrough(wall, 'inner', backWardrobe, 2800, 700);
  assert.equal(backView.status, 'visible');
  if (backView.status === 'visible') {
    const ids = backView.visibleParts.map((vp) => vp.part.id);
    assert.ok(ids.includes('carcass'));
    assert.equal(ids.includes('door_l'), false, 'front doors must be culled when viewing wardrobe from behind');
    assert.equal(ids.includes('door_r'), false, 'front doors must be culled when viewing wardrobe from behind');
    assert.equal(ids.includes('handle_l'), false, 'front handles must be culled when viewing wardrobe from behind');
    assert.equal(ids.includes('handle_r'), false, 'front handles must be culled when viewing wardrobe from behind');
  }

  // 3. Side view (+90 deg clockwise: +x rotates to +y camera side, so door_r/handle_r are near side and door_l/handle_l are far side)
  const sideWardrobe = { ...wardrobe, xMm: 2000, yMm: 900, rotationDeg: 90 };
  const sideView = projectFurnitureForWallCutThrough(wall, 'inner', sideWardrobe, 2800, 700);
  assert.equal(sideView.status, 'visible');
  if (sideView.status === 'visible') {
    const ids = sideView.visibleParts.map((vp) => vp.part.id);
    assert.ok(ids.includes('door_r'), 'near-side door should be visible in side cut-through view');
    assert.ok(ids.includes('handle_r'), 'near-side handle should be visible in side cut-through view');
    assert.equal(ids.includes('door_l'), false, 'far-side door should be occluded in side cut-through view');
    assert.equal(ids.includes('handle_l'), false, 'far-side handle should be occluded in side cut-through view');
  }

  // 4. 0.7m (700mm) distance cutoff & shorter distances
  // Chair 500x500 -> halfD=250. Inner wall face at y=100. Center at y=950 -> gap = 950 - 100 - 250 = 600mm (<= 700mm)
  const nearChair = makeBoxFurn('f_ch_near', 'Chair Near', 'chair_dining', 2000, 950, 500, 500, 820, 0, 0);
  const res700 = projectFurnitureForWallCutThrough(wall, 'inner', nearChair, 2800, 700);
  assert.equal(res700.status, 'visible');
  if (res700.status === 'visible') assert.equal(res700.perpDistMm, 600);

  // Shorter range cap (e.g. 400mm) hides the 600mm chair
  assert.equal(projectFurnitureForWallCutThrough(wall, 'inner', nearChair, 2800, 400).status, 'hidden');

  // Chair at y=1150 -> gap = 1150 - 100 - 250 = 800mm (> 700mm) -> hidden
  const farChair = { ...nearChair, id: 'f_ch_far', yMm: 1150 };
  assert.equal(projectFurnitureForWallCutThrough(wall, 'inner', farChair, 2800, 700).status, 'hidden');

  // 5. Glass door does NOT occlude solid shelves/decor inside a glass vitrine
  const vitrine: FurnitureInstance = {
    ...makeBoxFurn('f_vitrine', 'Vitrine', 'vitrine_glass', 2000, 310, 1000, 420, 1880, 0, 0),
    parts: [
      { id: 'frame', name: 'Frame', shape: 'box', xMm: 0, yMm: 0, zMm: 120, widthMm: 1000, depthMm: 400, heightMm: 1760, rotationDeg: 0, color: '#475569', material: 'wood' },
      { id: 'door_l', name: 'Glass Door L', shape: 'box', xMm: -245, yMm: 205, zMm: 140, widthMm: 480, depthMm: 18, heightMm: 1720, rotationDeg: 0, color: '#BAE6FD', material: 'glass' },
      { id: 'books', name: 'Interior Books', shape: 'box', xMm: -220, yMm: 0, zMm: 1484, widthMm: 300, depthMm: 210, heightMm: 240, rotationDeg: 0, color: '#1E3A5F', material: 'paint' },
    ],
  };
  const vitrineView = projectFurnitureForWallCutThrough(wall, 'inner', vitrine, 2800, 700);
  assert.equal(vitrineView.status, 'visible');
  if (vitrineView.status === 'visible') {
    const ids = vitrineView.visibleParts.map((vp) => vp.part.id);
    assert.ok(ids.includes('books'), 'interior solid books behind transparent glass door must remain visible');
    assert.ok(ids.includes('door_l'));
  }
});

test('catalog overhaul: white furniture palette, unbundled decor with fixedSize locks, and diverse appliances', () => {
  const whiteHexes = new Set(['#FFFFFF', '#F8FAFC', '#F1F5F9', '#E2E8F0', '#FEF9C3']);
  const metallicGlassApplianceStyles = new Set([
    'screen',
    'wall_tv',
    'gas_hob',
    'electric_hob',
    'induction_hob',
    'oven_front',
    'microwave_front',
    'fridge_single',
    'fridge_double',
    'fridge_side_by_side',
    'fridge_french',
    'wine_cooler',
    'hood_filter',
    'coffee_machine',
    'drip_coffee',
    'kettle',
    'toaster',
    'stand_mixer',
    'dishwasher',
    'washer_drum',
    'washer_topload',
    'dryer_drum',
    'faucet',
    'burner',
    'drainboard',
  ]);
  const foliageStyles = new Set(['foliage', 'leaves_palm', 'leaves_olive']);

  // Verify zero non-standalone furniture templates bundle books/vase/bowl/candle_tray decor
  // and no template contains duplicate part IDs
  for (const tpl of BUILTIN_CATALOG) {
    const partIds = new Set<string>();
    const isStandaloneDecor = tpl.category === 'Decor & Plants';
    for (const p of tpl.parts) {
      assert.equal(partIds.has(p.id), false, `Duplicate part ID "${p.id}" in template "${tpl.id}"`);
      partIds.add(p.id);

      if (!isStandaloneDecor) {
        assert.ok(
          p.detailStyle !== 'books' &&
            p.detailStyle !== 'vase' &&
            p.detailStyle !== 'bowl' &&
            p.detailStyle !== 'candle_tray',
          `Furniture template "${tpl.id}" must not bundle decorative part "${p.id}" (${p.detailStyle})`
        );
      }

      // Verify furniture bodies stay crisp white (excluding glass, metal hardware, foliage, screens, appliances, lighting emissives)
      const col = p.color.toUpperCase();
      if (
        p.material === 'glass' ||
        p.material === 'metal' ||
        (p.detailStyle && foliageStyles.has(p.detailStyle)) ||
        (p.detailStyle && metallicGlassApplianceStyles.has(p.detailStyle)) ||
        tpl.category === 'Lighting' ||
        tpl.category === 'Kitchen' ||
        isStandaloneDecor
      ) {
        continue;
      }
      assert.ok(
        whiteHexes.has(col),
        `Furniture template "${tpl.id}" part "${p.id}" has non-white finish ${col}`
      );
    }
  }

  // Verify every templateId referenced across starter project presets exists in BUILTIN_CATALOG
  const catalogIds = new Set(BUILTIN_CATALOG.map((c) => c.id));
  for (const preset of ['1br', 'studio', '2br'] as const) {
    const project = createInitialProject(preset);
    for (const level of project.levels) {
      for (const furn of level.furniture) {
        assert.ok(
          catalogIds.has(furn.templateId),
          `Preset "${preset}" references unknown templateId "${furn.templateId}"`
        );
      }
    }
  }

  // Verify standalone decor & countertop small appliances have fixedSize locked while real furniture remains resizable
  const toInstance = (id: string, elevMm?: number): FurnitureInstance => {
    const tpl = BUILTIN_CATALOG.find((c) => c.id === id);
    assert.ok(tpl, `Missing catalog item ${id}`);
    return {
      id: `inst_${id}`,
      templateId: tpl.id,
      name: tpl.name,
      category: tpl.category,
      xMm: 2000,
      yMm: 2000,
      elevationMm: elevMm ?? tpl.defaultElevationMm ?? 0,
      rotationDeg: 0,
      mirroredX: false,
      mirroredY: false,
      lockProportions: false,
      fixedSize: tpl.fixedSize,
      parts: tpl.parts.map((p) => ({ ...p })),
      visible: true,
      locked: false,
    };
  };

  for (const fixedId of [
    'decor_books_stack',
    'decor_books_row',
    'decor_vase_amphora',
    'decor_bowl_fruit',
    'decor_candle_tray',
    'decor_sculpture',
    'plant_table_succulent',
    'appliance_espresso_machine',
    'appliance_drip_coffee',
    'appliance_kettle',
    'appliance_toaster',
    'appliance_stand_mixer',
    'kitchen_microwave_countertop',
  ]) {
    assert.equal(isFixedSizeFurniture(toInstance(fixedId)), true, `${fixedId} should have locked size`);
  }

  for (const resizableId of [
    'sofa_straight_3',
    'bed_queen_storage',
    'table_dining_6',
    'table_round_coffee',
    'chair_wishbone',
    'chair_dining_arm',
    'wardrobe_open_closet',
    'kitchen_washer_topload',
    'tv_wall_32',
    'tv_wall_55',
    'rug_woven',
    'plant_monstera',
    'mirror_round_wall',
  ]) {
    assert.equal(isFixedSizeFurniture(toInstance(resizableId)), false, `${resizableId} should be resizable`);
  }

  for (const tvId of ['tv_wall_32', 'tv_wall_43', 'tv_wall_55', 'tv_wall_65', 'tv_wall_77']) {
    const inst = toInstance(tvId);
    assert.equal(isWallMountItem(inst), true, `${tvId} must classify as wall_mount`);
    assert.equal(isWallMountedTv(inst), true, `${tvId} must classify as wall-mounted TV`);
  }
});

test('functional seating tuck-under clearance and wall-mounted TV auto-orientation above consoles', () => {
  const walls: Wall[] = [
    makeWall('w_top', 0, 0, 6000, 0, 'center', 200),
    makeWall('w_right', 6000, 0, 6000, 5000, 'center', 200),
    makeWall('w_bottom', 6000, 5000, 0, 5000, 'center', 200),
    makeWall('w_left', 0, 5000, 0, 0, 'center', 200),
  ];

  const mkFromTpl = (
    id: string,
    templateId: string,
    xMm: number,
    yMm: number,
    rotationDeg = 0
  ): FurnitureInstance => {
    const tpl = BUILTIN_CATALOG.find((c) => c.id === templateId)!;
    assert.ok(tpl, `Missing catalog item ${templateId}`);
    return {
      id,
      templateId: tpl.id,
      name: tpl.name,
      category: tpl.category,
      xMm,
      yMm,
      elevationMm: tpl.defaultElevationMm ?? 0,
      rotationDeg,
      mirroredX: false,
      mirroredY: false,
      lockProportions: false,
      fixedSize: tpl.fixedSize,
      parts: tpl.parts.map((p) => ({ ...p })),
      visible: true,
      locked: false,
    };
  };

  const table = mkFromTpl('f_table', 'table_dining_6', 3000, 2600, 0);
  const wishbone = mkFromTpl('f_wishbone', 'chair_wishbone', 2700, 3450, 180);

  // Chair rotated 180° (facing up toward table center from below) tucks underneath tabletop at y=3020
  const tuckedMove = solveSolidFurnitureMove(
    { x: 2700, y: 3450 },
    { x: 2700, y: 3020 },
    wishbone,
    { walls, furniture: [table, wishbone], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.equal(tuckedMove.xMm, 2700);
  assert.equal(tuckedMove.yMm, 3020, 'chair seat & front legs should tuck smoothly under dining tabletop without colliding with elevated top slab');

  // Pushing chair all the way through the tabletop until its tall 780mm backrest hits the 750mm tabletop stops it solidly
  const deepPush = solveSolidFurnitureMove(
    { x: 2700, y: 3020 },
    { x: 2700, y: 2700 },
    { ...wishbone, yMm: 3020 },
    { walls, furniture: [table, wishbone], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.ok(deepPush.yMm > 2700, `chair backrest (z=455..775) should collide with tabletop (z=710..750), stopped at y=${deepPush.yMm}`);

  // Other dining chairs (standard, tub, cantilever, low-armchair) must also tuck cleanly under table_dining_6
  for (const chairTplId of ['chair_dining', 'chair_tub_dining', 'chair_cantilever', 'chair_dining_arm']) {
    const c = mkFromTpl(`f_${chairTplId}`, chairTplId, 2700, 3450, 180);
    const res = solveSolidFurnitureMove(
      { x: 2700, y: 3450 },
      { x: 2700, y: 3020 },
      c,
      { walls, furniture: [table, c], archElements: [] },
      { snapEnabled: false, gridSizeMm: 50 }
    );
    assert.equal(res.yMm, 3020, `${chairTplId} should tuck cleanly under dining table`);
  }

  // Ergonomic office chair must tuck under desk_office knee well without armrest or caster base interference
  const desk = mkFromTpl('f_desk', 'desk_office', 3000, 2600, 0);
  const ergoChair = mkFromTpl('f_ergo', 'chair_office_ergo', 2900, 3400, 180);
  const deskTuck = solveSolidFurnitureMove(
    { x: 2900, y: 3400 },
    { x: 2900, y: 2950 },
    ergoChair,
    { walls, furniture: [desk, ergoChair], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.equal(deskTuck.yMm, 2950, 'ergonomic office chair should tuck cleanly under desk_office knee well');

  // Bar stool must tuck under kitchen_island front seating overhang
  const island = mkFromTpl('f_island', 'kitchen_island', 3000, 2600, 0);
  const barStool = mkFromTpl('f_stool', 'stool_bar', 2700, 3450, 180);
  const stoolTuck = solveSolidFurnitureMove(
    { x: 2700, y: 3450 },
    { x: 2700, y: 3045 },
    barStool,
    { walls, furniture: [island, barStool], archElements: [] },
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.equal(stoolTuck.yMm, 3045, 'bar stool should tuck cleanly under kitchen_island front seating overhang');

  // Wall-mounted TV places at elevated wall height (~1050mm), classifies as wall_mount, and auto-orients perpendicular to top wall
  const mediaUnit = mkFromTpl('f_media', 'tv_unit_media', 3000, 335, 0);
  const wallTv = mkFromTpl('f_walltv', 'tv_wall_55', 3000, 600, 90);
  assert.equal(isWallMountItem(wallTv), true);
  assert.equal(wallTv.elevationMm, 1050);

  // Snap toward bottom wall (y=5000) -> autoRotationDeg=180
  const snappedBottom = snapFurnitureToPlan(
    { x: 3000, y: 4860 },
    wallTv,
    walls,
    [wallTv],
    { snapEnabled: true, gridSizeMm: 50 }
  );
  assert.equal(snappedBottom.rotationDeg, 180, 'wall TV snapping to bottom wall must auto-orient screen toward room interior (180 deg)');

  // Dragging wall TV along top wall right above a 450mm-tall media lowboard should not be blocked by the console below it
  const tvAboveConsole = solveSolidFurnitureMove(
    { x: 2400, y: 145 },
    { x: 3000, y: 145 },
    { ...wallTv, rotationDeg: 0 },
    { walls, furniture: [mediaUnit, wallTv], archElements: [] },
    { snapEnabled: true, gridSizeMm: 50 }
  );
  assert.equal(tvAboveConsole.xMm, 3000);
});

test('175cm physical walk physics enforces entity height, doors/arches, furniture, stairs, and ceiling headroom', () => {
  assert.equal(PLAYER_HEIGHT_M, 1.75);
  assert.equal(PLAYER_EYE_HEIGHT_M, 1.63);

  const mkFurn = (id: string, templateId: string, xMm: number, yMm: number): FurnitureInstance => {
    const tpl = BUILTIN_CATALOG.find((c) => c.id === templateId)!;
    assert.ok(tpl, `Missing catalog template ${templateId}`);
    return {
      id,
      templateId: tpl.id,
      name: tpl.name,
      category: tpl.category,
      xMm,
      yMm,
      elevationMm: tpl.defaultElevationMm ?? 0,
      rotationDeg: 0,
      mirroredX: false,
      mirroredY: false,
      lockProportions: false,
      fixedSize: tpl.fixedSize,
      parts: tpl.parts.map((p) => ({ ...p })),
      visible: true,
      locked: false,
    };
  };

  // Two adjacent 4m x 4m rooms split by a vertical wall at x=4000mm
  const walls: Wall[] = [
    makeWall('w_top', 0, 0, 8000, 0, 'center', 150),
    makeWall('w_right', 8000, 0, 8000, 4000, 'center', 150),
    makeWall('w_bot', 8000, 4000, 0, 4000, 'center', 150),
    makeWall('w_left', 0, 4000, 0, 0, 'center', 150),
    makeWall('w_mid', 4000, 0, 4000, 4000, 'center', 150),
  ];

  const baseOpening: Omit<Opening, 'id' | 'name' | 't' | 'category' | 'subtype' | 'openAngleDeg' | 'heightMm' | 'sillHeightMm'> = {
    wallId: 'w_mid',
    widthMm: 950,
    frameThicknessMm: 45,
    frameColor: '#1E293B',
    panelColor: '#FFFFFF',
    glassColor: '#BAE6FD',
    swingSide: 'left',
    swingDirection: 'in',
    visible: true,
    locked: false,
  };

  // t=0.22 (y=880): Open door (60 deg)
  // t=0.50 (y=2000): Closed door (0 deg)
  // t=0.78 (y=3120): Low arch (1600mm tall < 1750mm entity height!)
  const openings: Opening[] = [
    { ...baseOpening, id: 'op_open_door', name: 'Open Door', t: 0.22, category: 'door', subtype: 'single', openAngleDeg: 60, heightMm: 2100, sillHeightMm: 0 },
    { ...baseOpening, id: 'op_closed_door', name: 'Closed Door', t: 0.50, category: 'door', subtype: 'single', openAngleDeg: 0, heightMm: 2100, sillHeightMm: 0 },
    { ...baseOpening, id: 'op_low_arch', name: 'Low Arch', t: 0.78, category: 'arch', subtype: 'frame_only', openAngleDeg: 90, heightMm: 1600, sillHeightMm: 0 },
  ];

  // Window in outer top wall must block walking straight out through window sill
  const winOpening: Opening = {
    ...baseOpening,
    wallId: 'w_top',
    id: 'op_win',
    name: 'Window',
    t: 0.25,
    category: 'window',
    subtype: 'double',
    openAngleDeg: 0,
    heightMm: 1400,
    sillHeightMm: 900,
  };

  const pendant = mkFurn('f_pendant', 'light_ceiling_woven', 2000, 1200);
  // Ceiling pendant bottom is at 1960mm (> 1750mm entity height)
  const diningTable = mkFurn('f_table', 'table_dining_6', 6000, 2000);
  const lowPlatform: ArchElement = {
    id: 'arch_plat',
    name: 'Low Step Platform',
    type: 'platform',
    xMm: 2000,
    yMm: 3000,
    elevationMm: 0,
    widthMm: 1200,
    depthMm: 1200,
    heightMm: 200,
    rotationDeg: 0,
    color: '#CBD5E1',
    accentColor: '#94A3B8',
    material: 'wood',
    connectToCeiling: false,
    visible: true,
    locked: false,
  };

  const rooms = detectRoomsFromWalls(walls, [], 2800).map((r) => ({ ...r, hasCeiling: true }));
  assert.equal(rooms.length, 2);

  const level: Level = {
    id: 'lvl1',
    name: 'Ground',
    elevationMm: 0,
    ceilingHeightMm: 2800,
    walls,
    openings: [...openings, winOpening],
    curtains: [],
    furniture: [pendant, diningTable],
    people: [],
    rooms,
    archElements: [lowPlatform],
    measurements: [],
    annotations: [],
    sectionLine: null,
    backgroundTrace: null,
    layers: {
      walls: true,
      openings: true,
      curtains: true,
      furniture: true,
      people: true,
      rooms: true,
      archElements: true,
      annotations: true,
      measurements: true,
      autoDimensions: false,
      grid: true,
    },
  };

  const colliders = buildWalkColliders(level, { cutawayEnabled: false, cutawayHeightMm: 1500 });

  const stepForward = (start: WalkState, frames = 55, jump = false): WalkState => {
    let cur = start;
    for (let i = 0; i < frames; i++) {
      cur = resolveWalkStep(
        cur,
        { forward: 1, strafe: 0, sprint: false, jump: jump && i === 0 },
        colliders,
        level.rooms,
        level.ceilingHeightMm,
        false,
        false,
        0.025
      );
    }
    return cur;
  };

  // Yaw = -PI/2 looks & moves toward +X (-sin(-PI/2)=+1, -cos(-PI/2)=0)
  // 1. Walks cleanly through open 2.1m door at z=0.88m from x=3.2m -> x>4.6m
  const afterOpenDoor = stepForward({
    x: 3.2,
    feetY: 0,
    z: 0.88,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: -Math.PI / 2,
    pitch: 0,
    grounded: true,
  });
  assert.ok(afterOpenDoor.x > 4.6, `Should pass through open door into room 2, got x=${afterOpenDoor.x}`);

  // 2. Blocked by closed door at z=2.0m (wall centerline at x=4.0m, thickness 0.15m)
  const afterClosedDoor = stepForward({
    x: 3.2,
    feetY: 0,
    z: 2.0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: -Math.PI / 2,
    pitch: 0,
    grounded: true,
  });
  assert.ok(afterClosedDoor.x < 3.8, `Closed door must block 175cm entity, got x=${afterClosedDoor.x}`);

  // 3. Blocked by 1.60m low arch lintel because entity is 1.75m tall
  const afterLowArch = stepForward({
    x: 3.2,
    feetY: 0,
    z: 3.12,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: -Math.PI / 2,
    pitch: 0,
    grounded: true,
  });
  assert.ok(afterLowArch.x < 3.8, `1.60m arch lintel must block 1.75m entity, got x=${afterLowArch.x}`);

  // 4. Walks freely underneath high ceiling pendant at (2.0, 1.2)
  const underPendant = stepForward(
    {
      x: 1.1,
      feetY: 0,
      z: 1.2,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: -Math.PI / 2,
      pitch: 0,
      grounded: true,
    },
    45
  );
  assert.ok(underPendant.x > 2.5, `1.75m entity should walk under high ceiling pendant, got x=${underPendant.x}`);

  // 5. Blocked by solid dining table at (6.0, 2.0)
  const beforeTable = stepForward(
    {
      x: 4.5,
      feetY: 0,
      z: 2.0,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: -Math.PI / 2,
      pitch: 0,
      grounded: true,
    },
    60
  );
  assert.ok(beforeTable.x < 5.3, `Dining table should block walking straight through at (6.0, 2.0), got x=${beforeTable.x}`);

  // 6. Steps smoothly onto 200mm low platform at (2.0, 3.0) [x span 1.4..2.6m]
  const onPlatform = stepForward(
    {
      x: 1.0,
      feetY: 0,
      z: 3.0,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: -Math.PI / 2,
      pitch: 0,
      grounded: true,
    },
    26
  );
  assert.ok(
    onPlatform.x > 1.5 && onPlatform.x < 2.55 && Math.abs(onPlatform.feetY - 0.2) < 1e-4,
    `Entity should stand on 20cm platform, got x=${onPlatform.x}, y=${onPlatform.feetY}`
  );

  // 7. Jumping cannot exceed ceilingY - 1.75m headroom (even with low 2.0m ceiling)
  const lowCeilRooms = rooms.map((r) => ({ ...r, ceilingHeightMm: 2000 }));
  let jumped: WalkState = {
    x: 2.0,
    feetY: 0,
    z: 2.0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    grounded: true,
  };
  for (let i = 0; i < 20; i++) {
    jumped = resolveWalkStep(
      jumped,
      { forward: 0, strafe: 0, sprint: false, jump: i === 0 },
      colliders,
      lowCeilRooms,
      2000,
      false,
      false,
      0.02
    );
    assert.ok(
      jumped.feetY + PLAYER_HEIGHT_M <= 2.0 + 1e-6,
      `Head top (${jumped.feetY + PLAYER_HEIGHT_M}) must never penetrate 2.0m ceiling`
    );
  }
  const ceilInfo = getWalkFloorAndCeilingAt(2.0, 2.0, 0, colliders, lowCeilRooms, 2000, false, false);
  assert.equal(ceilInfo.ceilingY, 2.0);

  // 8. Safe walk spawn finds clear point inside starter 1br plan
  const starter = createInitialProject('1br').levels[0];
  const starterCols = buildWalkColliders(starter, { cutawayEnabled: false, cutawayHeightMm: 1500 });
  const spawn = findSafeWalkSpawn(starter, starterCols);
  assert.equal(Number.isFinite(spawn.x) && Number.isFinite(spawn.z), true);
  assert.ok(
    starter.rooms.some((rm) => rm.visible && pointInPolygon({ x: spawn.x * 1000, y: spawn.z * 1000 }, rm.polygon)),
    `Spawn (${spawn.x}, ${spawn.z}) should land cleanly inside starter apartment room`
  );
});

test('material library exposes categorized finishes with valid PBR parameters', () => {
  assert.ok(MATERIAL_PRESETS.length >= 30, `Expected expanded material presets, found ${MATERIAL_PRESETS.length}`);
  const categorySet = new Set(MATERIAL_CATEGORIES);
  for (const preset of MATERIAL_PRESETS) {
    assert.ok(categorySet.has(preset.category), `Unknown category ${preset.category} on ${preset.id}`);
    assert.ok(preset.roughness >= 0 && preset.roughness <= 1, `Invalid roughness on ${preset.id}`);
    assert.ok(preset.metalness >= 0 && preset.metalness <= 1, `Invalid metalness on ${preset.id}`);
    assert.ok(preset.label.trim().length > 0, `Empty label on ${preset.id}`);
  }
  const byCategory = new Map<string, number>();
  for (const preset of MATERIAL_PRESETS) {
    byCategory.set(preset.category, (byCategory.get(preset.category) ?? 0) + 1);
  }
  for (const cat of MATERIAL_CATEGORIES) {
    assert.ok((byCategory.get(cat) ?? 0) >= 4, `Expected multiple materials in category ${cat}`);
  }
});

test('doorframe arch element leaves doorway passable while lying-down figures have horizontal bounds', () => {
  const starterRoom = createInitialProject('1br').levels[0].rooms[0];
  const level = createInitialProject('empty').levels[0];
  level.rooms = [
    {
      ...starterRoom,
      id: 'rm-frame',
      name: 'Hall',
      polygon: [
        { x: 0, y: 0 },
        { x: 6000, y: 0 },
        { x: 6000, y: 4000 },
        { x: 0, y: 4000 },
      ],
      areaM2: 24,
      ceilingHeightMm: 2700,
      visible: true,
    },
  ];
  level.archElements = [
    {
      id: 'df-1',
      name: 'Doorframe Only',
      type: 'doorframe',
      xMm: 3000,
      yMm: 2000,
      elevationMm: 0,
      rotationDeg: 0,
      widthMm: 1000,
      depthMm: 180,
      heightMm: 2150,
      color: '#FFFFFF',
      accentColor: '#94A3B8',
      material: 'oak',
      hasRailing: true,
      visible: true,
      locked: false,
    },
  ];
  level.people = [
    {
      id: 'p-lying-back',
      name: 'Sleeper',
      pose: 'lying_back',
      xMm: 1500,
      yMm: 2500,
      elevationMm: 550,
      rotationDeg: 0,
      heightMm: 1750,
      color: '#FFFFFF',
      visible: true,
      locked: false,
    },
    {
      id: 'p-lying-side',
      name: 'Side Sleeper',
      pose: 'lying_side',
      xMm: 4500,
      yMm: 2500,
      elevationMm: 0,
      rotationDeg: 0,
      heightMm: 1720,
      color: '#FFFFFF',
      visible: true,
      locked: false,
    },
  ];

  const cols = buildWalkColliders(level, { cutawayEnabled: false, cutawayHeightMm: 1500 });

  // 1. Walker passes straight through the center of the standalone doorframe (at z=2.0m heading from z=1.2m toward z=2.8m)
  let walkState: WalkState = {
    x: 3.0,
    feetY: 0,
    z: 1.2,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: Math.PI, // forward = -cos(PI) = +1 along +Z
    pitch: 0,
    grounded: true,
  };
  for (let i = 0; i < 40; i++) {
    walkState = resolveWalkStep(
      walkState,
      { forward: 1, strafe: 0, sprint: false, jump: false },
      cols,
      level.rooms,
      level.ceilingHeightMm,
      false,
      false,
      0.04
    );
  }
  assert.ok(walkState.z > 2.6, `175cm entity should walk cleanly through doorframe opening, got z=${walkState.z}`);

  // 2. Lying-down people emit horizontal colliders (~1.76m long, ~0.36m high) rather than vertical standing height
  const personCols = cols.filter((c) => c.id.startsWith('person_'));
  assert.equal(personCols.length, 2, 'Expected horizontal colliders for both lying people');
  const elevatedLying = personCols.find((c) => c.minY > 0.4);
  assert.ok(elevatedLying, 'Expected elevated collider for lying_back figure placed on 55cm bed');
  const zValues = elevatedLying.poly.map((pt) => pt.z);
  const lengthZ = Math.max(...zValues) - Math.min(...zValues);
  assert.ok(
    elevatedLying.maxY - elevatedLying.minY < 0.5 && lengthZ > 1.4,
    `Lying figure collider should be low and elongated, got height=${elevatedLying.maxY - elevatedLying.minY}, lengthZ=${lengthZ}`
  );
});

test('European split AC units, curtains & blinds catalog, and automatic 5cm ceiling positioning', () => {
  const acIndoorTpl = BUILTIN_CATALOG.find((c) => c.id === 'ac_european_indoor');
  const acOutdoorTpl = BUILTIN_CATALOG.find((c) => c.id === 'ac_european_outdoor');
  assert.ok(acIndoorTpl, 'Expected ac_european_indoor in catalog');
  assert.ok(acOutdoorTpl, 'Expected ac_european_outdoor in catalog');

  for (const id of [
    'curtain_linen_drapes',
    'curtain_sheer_wave',
    'blinds_venetian_wood',
    'blinds_roller_shade',
  ]) {
    const tpl = BUILTIN_CATALOG.find((c) => c.id === id);
    assert.ok(tpl, `Expected curtain/blind template ${id} in catalog`);
    assert.equal(
      isCurtainOrBlindFurniture({ templateId: tpl.id, parts: tpl.parts }),
      true,
      `${id} should classify as curtain or blind`
    );
  }

  const acIndoorInst: FurnitureInstance = {
    id: 'ac-in-1',
    templateId: acIndoorTpl.id,
    name: acIndoorTpl.name,
    category: acIndoorTpl.category,
    xMm: 2000,
    yMm: 2000,
    elevationMm: 0,
    rotationDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: acIndoorTpl.parts.map((p) => ({ ...p })),
    visible: true,
    locked: false,
  };
  assert.equal(isAcIndoorUnit(acIndoorInst), true);

  for (const ceilH of [2600, 2800, 3200]) {
    const offset = getCeilingFixtureOffsetMm(acIndoorInst, ceilH);
    const span = computeFurnitureElevationSpanMm(acIndoorInst, ceilH);
    assert.equal(Math.round(span.maxZ), ceilH - 50, `AC indoor top must sit 50mm below ${ceilH}mm ceiling (offset=${offset})`);
  }
});

test('Wall View depth slider supports up to 1.5 m (1500 mm) and 3-axis tilted furniture auto-grounds', () => {
  const wall: Wall = makeWall('w_view', 0, 0, 4000, 0, 'center', 200);
  // Inner face at y=100; chair half-depth=250. Center at y=1550 => gap = 1550 - 100 - 250 = 1200mm (1.2 m)
  const midChair = makeBoxFurn('f_mid', 'Dining Chair', 'chair_dining', 2000, 1550, 500, 500, 820, 0, 0);

  assert.equal(
    projectFurnitureForWallCutThrough(wall, 'inner', midChair, 2800, 700).status,
    'hidden',
    '1.2 m chair stays hidden when slider cap is 0.7 m'
  );
  const res1500 = projectFurnitureForWallCutThrough(wall, 'inner', midChair, 2800, 1500);
  assert.equal(res1500.status, 'visible', '1.2 m chair is visible when Wall View range is raised to 1.5 m');
  if (res1500.status === 'visible') {
    assert.equal(res1500.perpDistMm, 1200);
  }

  // Tilted box resting at elevationMm=0 shifts upwards cleanly so minZ stays grounded at elevationMm
  const boxPart: FurniturePart = {
    id: 'bp',
    name: 'Body',
    shape: 'box',
    xMm: 0,
    yMm: 0,
    zMm: 0,
    widthMm: 1000,
    depthMm: 600,
    heightMm: 400,
    rotationDeg: 0,
    color: '#FFFFFF',
    material: 'paint',
  };
  const tb = computeFurnitureTiltedLocalBoundsMm([boxPart], 30, 0);
  assert.ok(Math.abs(tb.minZ) < 1e-6, `Tilted local bounds should stay grounded at z=0, got minZ=${tb.minZ}`);
  assert.ok(tb.maxZ > 400, `Tilted box height should increase (>400mm), got ${tb.maxZ}`);

  const tiltedChair: FurnitureInstance = {
    ...midChair,
    xMm: 2000,
    yMm: 600,
    rotationXDeg: 25,
    rotationYDeg: 15,
    parts: [boxPart],
  };
  const elevSpan = computeFurnitureElevationSpanMm(tiltedChair);
  assert.equal(Math.round(elevSpan.minZ), 0);
  const projTilted = projectFurnitureForWallCutThrough(wall, 'inner', tiltedChair, 2800, 1500);
  assert.equal(projTilted.status, 'visible');
  if (projTilted.status === 'visible') {
    assert.ok(projTilted.visibleParts[0].elevH > 400);
  }
});

test('architectural blocks snap edge-to-edge against adjacent blocks and walls cleanly', () => {
  const walls: Wall[] = [makeWall('w_top', 0, 0, 5000, 0, 'center', 200)]; // inner face at y = 100
  const hostCol: ArchElement = {
    id: 'col_host',
    name: 'Column A',
    type: 'column_square',
    xMm: 1000,
    yMm: 1000,
    elevationMm: 0,
    rotationDeg: 0,
    widthMm: 400,
    depthMm: 400,
    heightMm: 2800,
    color: '#FFFFFF',
    accentColor: '#334155',
    material: 'concrete',
    visible: true,
    locked: false,
  };
  const movingCol: ArchElement = {
    ...hostCol,
    id: 'col_move',
    name: 'Column B',
    xMm: 1470,
    yMm: 1040,
  };

  // Neighbor block right edge = 1000 + 200 = 1200; moving halfW = 200 => flush center x = 1400, y aligns to 1000
  const blockSnap = snapArchElementToPlan(
    { x: 1470, y: 1040 },
    movingCol,
    walls,
    [hostCol, movingCol],
    { snapEnabled: true, gridSizeMm: 50 }
  );
  assert.equal(blockSnap.xMm, 1400, 'Expected flush edge-to-edge X snap with neighboring block');
  assert.equal(blockSnap.yMm, 1000, 'Expected aligned Y center with neighboring block');

  // Near top wall (inner face y=100, moving halfD=200 => flush wall center y=300)
  const wallSnap = snapArchElementToPlan(
    { x: 2500, y: 345 },
    movingCol,
    walls,
    [hostCol, movingCol],
    { snapEnabled: true, gridSizeMm: 50 }
  );
  assert.equal(wallSnap.yMm, 300, 'Expected flush edge-to-edge snap against wall inner face');
});

test('walk physics allows full 3D movement through walls and flight when collision is disabled (noclip)', () => {
  const walls: Wall[] = [makeWall('w_barrier', 0, 2000, 4000, 2000, 'center', 200)];
  const rooms = [
    {
      id: 'rm1',
      name: 'Room',
      polygon: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 4000 },
        { x: 0, y: 4000 },
      ],
      areaM2: 16,
      perimeterM: 16,
      floorColor: '#FFFFFF',
      floorMaterial: 'oak' as const,
      floorTextureScale: 1,
      floorTextureRotDeg: 0,
      floorLevelMm: 0,
      ceilingColor: '#FFFFFF',
      ceilingMaterial: 'plaster' as const,
      ceilingHeightMm: 2800,
      hasCeiling: true,
      visible: true,
      locked: false,
    },
  ];
  const colliders = buildWalkColliders(
    {
      id: 'lvl',
      name: 'Floor',
      elevationMm: 0,
      ceilingHeightMm: 2800,
      walls,
      rooms,
      openings: [],
      furniture: [],
      curtains: [],
      people: [],
      archElements: [],
      measurements: [],
      annotations: [],
      sectionLine: null,
      backgroundTrace: null,
      layers: {
        walls: true,
        rooms: true,
        openings: true,
        furniture: true,
        curtains: true,
        people: true,
        archElements: true,
        measurements: true,
        annotations: true,
        autoDimensions: true,
        grid: true,
      },
    },
    { cutawayEnabled: false, cutawayHeightMm: 1400 }
  );

  // 1. With collision enabled, walker stops before wall at z = 2.0m
  let blocked: WalkState = {
    x: 2.0,
    feetY: 0,
    z: 1.4,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: Math.PI,
    pitch: 0,
    grounded: true,
  };
  for (let i = 0; i < 40; i++) {
    blocked = resolveWalkStep(
      blocked,
      { forward: 1, strafe: 0, sprint: false, jump: false },
      colliders,
      rooms,
      2800,
      false,
      false,
      0.04,
      { collisionEnabled: true }
    );
  }
  assert.ok(blocked.z < 1.9, `Solid walker should stop in front of wall at z=2.0m, got z=${blocked.z}`);

  // 2. With collision disabled (noclip), camera flies straight through wall and climbs vertically
  let noclip: WalkState = {
    x: 2.0,
    feetY: 0,
    z: 1.4,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: Math.PI,
    pitch: 0,
    grounded: true,
  };
  for (let i = 0; i < 40; i++) {
    noclip = resolveWalkStep(
      noclip,
      { forward: 1, strafe: 0, sprint: false, jump: false, ascend: true },
      colliders,
      rooms,
      2800,
      false,
      false,
      0.04,
      { collisionEnabled: false }
    );
  }
  assert.ok(noclip.z > 2.5, `Noclip walker must pass freely through walls, got z=${noclip.z}`);
  assert.ok(noclip.feetY > 1.0, `Noclip walker should ascend freely above room ceiling, got feetY=${noclip.feetY}`);
});

test('2D/3D material synchronization helpers keep tile scales, pre-tinted hues, and JSON portability intact', () => {
  assert.equal(isPresetPreTinted('oak'), true);
  assert.equal(isPresetPreTinted('paint'), false);
  assert.equal(getEffectiveMaterialHex('oak', '#FFFFFF'), '#D6B992');
  assert.equal(getEffectiveMaterialHex('paint', '#E2E8F0'), '#E2E8F0');
  assert.equal(getDefaultTileMeters('parquet'), 1.35);
  assert.equal(getDefaultTileMeters('terrazzo'), 1.15);

  const proj = createInitialProject('1br');
  proj.settings.blackAndWhite2d = true;
  proj.settings.walkEyeHeightMm = 1750;
  proj.settings.walkCollisionEnabled = false;
  if (proj.levels[0].furniture[0]) {
    proj.levels[0].furniture[0].rotationXDeg = 12;
    proj.levels[0].furniture[0].rotationYDeg = -8;
  }
  const roundtrip = JSON.parse(JSON.stringify(proj));
  assert.equal(roundtrip.settings.blackAndWhite2d, true);
  assert.equal(roundtrip.settings.walkEyeHeightMm, 1750);
  assert.equal(roundtrip.settings.walkCollisionEnabled, false);
  assert.equal(roundtrip.levels[0].furniture[0].rotationXDeg, 12);
  assert.equal(roundtrip.levels[0].furniture[0].rotationYDeg, -8);
});

test('doorframe door subtype is passable without leaf swing even at openAngleDeg=0', () => {
  const wall = makeWall('w1', 0, 2000, 4000, 2000);
  const doorframeOp: Opening = {
    id: 'op_df',
    name: 'Doorframe',
    wallId: 'w1',
    t: 0.5,
    category: 'door',
    subtype: 'doorframe',
    widthMm: 950,
    heightMm: 2100,
    sillHeightMm: 0,
    frameThicknessMm: 55,
    frameColor: '#1E293B',
    panelColor: '#FFFFFF',
    glassColor: '#E0F2FE',
    swingSide: 'left',
    swingDirection: 'in',
    openAngleDeg: 0,
    visible: true,
    locked: false,
  };
  const colliders = buildWalkColliders(
    {
      id: 'lvl',
      name: 'Floor',
      elevationMm: 0,
      ceilingHeightMm: 2800,
      walls: [wall],
      rooms: [],
      openings: [doorframeOp],
      furniture: [],
      curtains: [],
      people: [],
      archElements: [],
      measurements: [],
      annotations: [],
      sectionLine: null,
      backgroundTrace: null,
      layers: {
        walls: true,
        rooms: true,
        openings: true,
        furniture: true,
        curtains: true,
        people: true,
        archElements: true,
        measurements: true,
        annotations: true,
        autoDimensions: true,
        grid: true,
      },
    },
    { cutawayEnabled: false, cutawayHeightMm: 1400 }
  );

  let walkState: WalkState = {
    x: 2.0,
    feetY: 0,
    z: 1.3,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: Math.PI,
    pitch: 0,
    grounded: true,
  };
  for (let i = 0; i < 40; i++) {
    walkState = resolveWalkStep(
      walkState,
      { forward: 1, strafe: 0, sprint: false, jump: false },
      colliders,
      [],
      2800,
      false,
      false,
      0.04
    );
  }
  assert.ok(walkState.z > 2.5, `Doorframe door must be walkable through, got z=${walkState.z}`);
});

test('curtains stick exclusively to walls, overlap solid furniture, and have no 3D walk collision', () => {
  const wall = makeWall('w_north', 0, 0, 5000, 0, 'center', 150);
  const curtainTpl = BUILTIN_CATALOG.find((t) => t.id === 'curtain_linen_drapes')!;
  const sofaTpl = BUILTIN_CATALOG.find((t) => t.id === 'sofa_3seat')!;
  assert.ok(curtainTpl && sofaTpl);

  const sofa: FurnitureInstance = {
    id: 'sofa_1',
    templateId: sofaTpl.id,
    name: sofaTpl.name,
    category: sofaTpl.category,
    xMm: 2500,
    yMm: 550,
    elevationMm: 0,
    rotationDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: sofaTpl.parts.map((p) => ({ ...p })),
    visible: true,
    locked: false,
  };

  const curtain: FurnitureInstance = {
    id: 'curtain_1',
    templateId: curtainTpl.id,
    name: curtainTpl.name,
    category: curtainTpl.category,
    xMm: 2500,
    yMm: 2000,
    elevationMm: 0,
    rotationDeg: 45,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: curtainTpl.parts.map((p) => ({ ...p })),
    visible: true,
    locked: false,
  };

  // Dragging far out in open room still snaps curtain flush to the wall face even with snapEnabled=false
  const snapRes = snapFurnitureToPlan(
    { x: 2500, y: 2200 },
    curtain,
    [wall],
    [sofa],
    { snapEnabled: false, gridSizeMm: 50 }
  );
  assert.equal(snapRes.snappedKind, 'wall');
  assert.ok(Math.abs(snapRes.yMm) < 220, `Curtain must stick onto north wall face, got y=${snapRes.yMm}`);

  // Standalone curtain also sticks onto nearest wall
  const scSnap = snapStandaloneCurtainToWall({ x: 2500, y: 2000 }, { widthMm: 1600, rotationDeg: 45 }, [wall]);
  assert.equal(scSnap.snapped, true);
  assert.ok(Math.abs(scSnap.yMm) < 220);

  // Curtains overlap solid furniture freely in both directions
  assert.equal(canFurnitureCoexist(curtain, sofa), true);
  assert.equal(canFurnitureCoexist(sofa, curtain), true);

  const moveOverSofa = solveSolidFurnitureMove(
    { x: 2500, y: 150 },
    { x: 2500, y: 400 },
    curtain,
    { walls: [wall], furniture: [sofa], archElements: [] },
    { snapEnabled: true, gridSizeMm: 50 }
  );
  assert.ok(Math.abs(moveOverSofa.yMm) < 220, 'Curtain remains stuck on wall while overlapping sofa');

  // Zero 3D walk collision for curtains
  const colliders = buildWalkColliders(
    {
      id: 'lvl',
      name: 'Floor',
      elevationMm: 0,
      ceilingHeightMm: 2800,
      walls: [wall],
      rooms: [],
      openings: [],
      furniture: [{ ...curtain, xMm: moveOverSofa.xMm, yMm: moveOverSofa.yMm, rotationDeg: moveOverSofa.rotationDeg }],
      curtains: [],
      people: [],
      archElements: [],
      measurements: [],
      annotations: [],
      sectionLine: null,
      backgroundTrace: null,
      layers: {
        walls: true,
        rooms: true,
        openings: true,
        furniture: true,
        curtains: true,
        people: true,
        archElements: true,
        measurements: true,
        annotations: true,
        autoDimensions: true,
        grid: true,
      },
    },
    { cutawayEnabled: false, cutawayHeightMm: 1400 }
  );
  assert.equal(
    colliders.some((c) => c.id.startsWith('furn_curtain_1')),
    false,
    'Curtains must have zero 3D walk colliders'
  );
});

test('balcony slabs inherit ceiling only when connected to a room floor with ceiling', () => {
  const walls = [
    makeWall('w_n', 0, 0, 4000, 0, 'center', 150),
    makeWall('w_e', 4000, 0, 4000, 4000, 'center', 150),
    makeWall('w_s', 4000, 4000, 0, 4000, 'center', 150),
    makeWall('w_w', 0, 4000, 0, 0, 'center', 150),
  ];
  const rooms = [
    {
      id: 'room1',
      name: 'Living',
      polygon: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 4000 },
        { x: 0, y: 4000 },
      ],
      areaM2: 16,
      perimeterM: 16,
      floorColor: '#FFFFFF',
      floorMaterial: 'oak' as const,
      floorTextureScale: 1,
      floorTextureRotDeg: 0,
      floorLevelMm: 0,
      ceilingColor: '#FFFFFF',
      ceilingMaterial: 'plaster' as const,
      ceilingHeightMm: 2700,
      hasCeiling: true,
      visible: true,
      locked: false,
    },
  ];

  // Connected balcony abutting the south exterior wall face (gap ~75mm from centerline)
  const connectedBalcony: ArchElement = {
    id: 'balc_conn',
    name: 'Balcony',
    type: 'balcony',
    xMm: 2000,
    yMm: 4675,
    elevationMm: 0,
    rotationDeg: 0,
    widthMm: 3000,
    depthMm: 1200,
    heightMm: 180,
    color: '#CBD5E1',
    accentColor: '#334155',
    material: 'concrete',
    visible: true,
    locked: false,
  };

  // Disconnected floating balcony far away in open space
  const floatingBalcony: ArchElement = {
    ...connectedBalcony,
    id: 'balc_float',
    xMm: 12000,
    yMm: 12000,
  };

  assert.equal(findConnectedRoomForBalcony(connectedBalcony, rooms, walls)?.id, 'room1');
  assert.equal(findConnectedRoomForBalcony(floatingBalcony, rooms, walls), null);

  const colliders = buildWalkColliders(
    {
      id: 'lvl',
      name: 'Floor',
      elevationMm: 0,
      ceilingHeightMm: 2800,
      walls,
      rooms,
      openings: [],
      furniture: [],
      curtains: [],
      people: [],
      archElements: [connectedBalcony, floatingBalcony],
      measurements: [],
      annotations: [],
      sectionLine: null,
      backgroundTrace: null,
      layers: {
        walls: true,
        rooms: true,
        openings: true,
        furniture: true,
        curtains: true,
        people: true,
        archElements: true,
        measurements: true,
        annotations: true,
        autoDimensions: true,
        grid: true,
      },
    },
    { cutawayEnabled: false, cutawayHeightMm: 1400 }
  );

  const connInfo = getWalkFloorAndCeilingAt(2.0, 4.7, 0.2, colliders, rooms, 2800, false, false);
  assert.equal(connInfo.ceilingY, 2.7);

  const floatInfo = getWalkFloorAndCeilingAt(12.0, 12.0, 0.2, colliders, rooms, 2800, false, false);
  assert.equal(floatInfo.ceilingY, Infinity);
});

test('Milestone 1: wall face auto-identification, shared room names, dynamic rename, and zero-move Flip Face', () => {
  const livingRoom = {
    id: 'room_living',
    name: 'Living Room',
    polygon: [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 4000 },
      { x: 0, y: 4000 },
    ],
    areaM2: 16,
    perimeterM: 16,
    floorColor: '#FFFFFF',
    floorMaterial: 'oak' as const,
    floorTextureScale: 1,
    floorTextureRotDeg: 0,
    floorLevelMm: 0,
    ceilingColor: '#FFFFFF',
    ceilingMaterial: 'plaster' as const,
    ceilingHeightMm: 2700,
    hasCeiling: true,
    visible: true,
    locked: false,
  };
  const bedroom = {
    ...livingRoom,
    id: 'room_bed',
    name: 'Bedroom',
    polygon: [
      { x: 4000, y: 0 },
      { x: 8000, y: 0 },
      { x: 8000, y: 4000 },
      { x: 4000, y: 4000 },
    ],
  };

  // Single-room wall drawn clockwise so room lies on +normal ('left') vs reversed endpoints ('right')
  const northWall = makeWall('w_n', 0, 0, 4000, 0, 'center', 150);
  northWall.innerColor = '#FF0000';
  northWall.outerColor = '#0000FF';
  northWall.innerMaterial = 'plaster';
  northWall.outerMaterial = 'brick';

  // Normal of (0,0)->(4000,0) is (0, 1) -> inside livingRoom!
  const singleFaces = resolveWallFaces(northWall, [livingRoom]);
  assert.equal(singleFaces.kind, 'single_room');
  assert.equal(singleFaces.primary.label, 'Inner');
  assert.equal(singleFaces.primary.physicalSide, 'left');
  assert.equal(singleFaces.secondary.label, 'Outer');
  assert.equal(singleFaces.secondary.physicalSide, 'right');

  // Reverse endpoints: now (4000,0)->(0,0) has normal (0,-1) outside room, so room is on physical 'right'!
  const reversedWall = makeWall('w_n_rev', 4000, 0, 0, 0, 'center', 150);
  const revFaces = resolveWallFaces(reversedWall, [livingRoom]);
  assert.equal(revFaces.kind, 'single_room');
  assert.equal(revFaces.primary.label, 'Inner');
  assert.equal(revFaces.primary.physicalSide, 'right');
  assert.equal(revFaces.primary.slot, 'inner');
  assert.equal(revFaces.secondary.label, 'Outer');
  assert.equal(revFaces.secondary.physicalSide, 'left');

  // Shared wall (4000,0)->(4000,4000): normal (-1,0) points to Living Room ('left'), -normal points to Bedroom ('right')
  const sharedWall = makeWall('w_shared', 4000, 0, 4000, 4000, 'center', 150);
  sharedWall.innerColor = '#AAAAAA';
  sharedWall.outerColor = '#BBBBBB';
  sharedWall.innerMaterial = 'wood';
  sharedWall.outerMaterial = 'tile';

  const sharedFaces = resolveWallFaces(sharedWall, [livingRoom, bedroom]);
  assert.equal(sharedFaces.kind, 'shared');
  assert.equal(sharedFaces.left.label, 'Living Room');
  assert.equal(sharedFaces.left.roomId, 'room_living');
  assert.equal(sharedFaces.right.label, 'Bedroom');
  assert.equal(sharedFaces.right.roomId, 'room_bed');

  // Dynamic update on room rename
  const renamedBedroom = { ...bedroom, name: 'Primary Suite' };
  const renamedFaces = resolveWallFaces(sharedWall, [livingRoom, renamedBedroom]);
  assert.equal(renamedFaces.right.label, 'Primary Suite');

  // Flip Face preserves wall coordinates, alignment, thickness, and physical room association while swapping finishes
  const origPoly = computeWallPolygon(sharedWall, [sharedWall]);
  const flipped = flipWallFace(sharedWall);
  assert.deepEqual(flipped.start, sharedWall.start);
  assert.deepEqual(flipped.end, sharedWall.end);
  assert.equal(flipped.thicknessMm, sharedWall.thicknessMm);
  assert.equal(flipped.alignment, sharedWall.alignment);
  assert.deepEqual(computeWallPolygon(flipped, [flipped]), origPoly);
  assert.equal(flipped.innerColor, '#BBBBBB');
  assert.equal(flipped.outerColor, '#AAAAAA');
  assert.equal(flipped.innerMaterial, 'tile');
  assert.equal(flipped.outerMaterial, 'wood');

  const flippedFaces = resolveWallFaces(flipped, [livingRoom, renamedBedroom]);
  assert.equal(flippedFaces.left.roomId, 'room_living');
  assert.equal(flippedFaces.right.roomId, 'room_bed');
  assert.equal(flippedFaces.primary.physicalSide, 'right');
  assert.equal(flippedFaces.primary.label, 'Primary Suite');
});

test('Milestone 1: Wall View occlusion blocks opposite-side items on thin 100mm partitions and thick 300mm exterior walls', () => {
  const thinWall = makeWall('w_thin', 0, 0, 5000, 0, 'center', 100);
  const thickWall = makeWall('w_thick', 0, 0, 5000, 0, 'center', 300);

  const acTpl = BUILTIN_CATALOG.find((t) => t.id === 'ac_european_outdoor')!;
  const cabinetTpl = BUILTIN_CATALOG.find((t) => t.id === 'wardrobe_double')!;
  assert.ok(acTpl && cabinetTpl);

  // Place outdoor unit flush on exterior (-normal / 'right') side of thin 100mm wall
  // Half thickness = 50mm, outdoor AC depth/2 ~ 150mm -> center at y = -200mm
  const acOutside: FurnitureInstance = {
    id: 'ac_out',
    templateId: acTpl.id,
    name: 'AC Outdoor',
    category: acTpl.category,
    xMm: 2000,
    yMm: -200,
    elevationMm: 500,
    rotationDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: acTpl.parts.map((p) => ({ ...p })),
    visible: true,
    locked: false,
  };

  // Viewing interior ('left') face of 100mm wall -> must NOT bleed through!
  const thinResInner = projectFurnitureForWallCutThrough(thinWall, 'left', acOutside, 2800, 1500);
  assert.equal(thinResInner.status, 'opposite_side');

  // Viewing exterior ('right') face of 100mm wall -> MUST be visible!
  const thinResOuter = projectFurnitureForWallCutThrough(thinWall, 'right', acOutside, 2800, 1500);
  assert.equal(thinResOuter.status, 'visible');

  // Cabinet on interior (+normal / 'left') side of thick 300mm wall (face at y = +150mm, cabinet depth ~ 600mm -> center y = 450mm)
  const cabInside: FurnitureInstance = {
    id: 'cab_in',
    templateId: cabinetTpl.id,
    name: 'Tall Cabinet',
    category: cabinetTpl.category,
    xMm: 2500,
    yMm: 450,
    elevationMm: 0,
    rotationDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: cabinetTpl.parts.map((p) => ({ ...p })),
    visible: true,
    locked: false,
  };

  assert.equal(projectFurnitureForWallCutThrough(thickWall, 'left', cabInside, 2800, 1500).status, 'visible');
  assert.equal(projectFurnitureForWallCutThrough(thickWall, 'right', cabInside, 2800, 1500).status, 'opposite_side');
});

test('Milestone 1: rotated, mirrored, and manually tilted furniture bounds match OBB collision hulls', () => {
  const sofaTpl = BUILTIN_CATALOG.find((t) => t.id === 'sofa_l_sectional')!;
  assert.ok(sofaTpl);
  const furn: FurnitureInstance = {
    id: 'f_tilt',
    templateId: sofaTpl.id,
    name: sofaTpl.name,
    category: sofaTpl.category,
    xMm: 2000,
    yMm: 2000,
    elevationMm: 0,
    rotationDeg: 37,
    rotationXDeg: 25,
    rotationYDeg: -15,
    mirroredX: true,
    mirroredY: false,
    lockProportions: false,
    parts: sofaTpl.parts.map((p) => ({ ...p })),
    visible: true,
    locked: false,
  };

  const localBounds = computeFurnitureTiltedLocalBoundsMm(
    furn.parts,
    furn.rotationXDeg,
    furn.rotationYDeg,
    furn.mirroredX,
    furn.mirroredY
  );
  const worldBox = computeFurnitureWorldBox({ x: furn.xMm, y: furn.yMm }, furn);
  const polys = getFurnitureSolidFootprintPolygons({ x: furn.xMm, y: furn.yMm }, furn);
  assert.ok(polys.length > 0 && polys[0].length >= 4);

  // Every polygon corner must lie within worldBox AABB within 2mm tolerance
  for (const poly of polys) {
    for (const pt of poly) {
      assert.ok(pt.x >= worldBox.minX - 2 && pt.x <= worldBox.maxX + 2);
      assert.ok(pt.y >= worldBox.minY - 2 && pt.y <= worldBox.maxY + 2);
    }
  }
  assert.ok(localBounds.maxZ > localBounds.minZ);
});

test('Milestone 1: 3D wall cutouts leave window glass clear without opaque overlapping polygons', () => {
  const matInner = new THREE.MeshStandardMaterial({ color: '#EEEEEE' });
  const matOuter = new THREE.MeshStandardMaterial({ color: '#334455' });
  const matCore = new THREE.MeshStandardMaterial({ color: '#64748B' });
  const matTrim = new THREE.MeshStandardMaterial({ color: '#FFFFFF' });

  const wall = makeWall('w_win', 0, 0, 6000, 0, 'center', 200);
  wall.heightMm = 2800;
  wall.hasBaseboard = true;
  wall.baseboardHeightMm = 120;
  wall.hasCrownMolding = true;
  wall.crownHeightMm = 100;

  const winRect: Opening = {
    id: 'op_rect',
    wallId: wall.id,
    name: 'Window Rect',
    category: 'window',
    subtype: 'double',
    t: 0.25,
    widthMm: 1200,
    heightMm: 1200,
    sillHeightMm: 900,
    frameThicknessMm: 50,
    swingDirection: 'in',
    swingSide: 'left',
    openAngleDeg: 0,
    frameColor: '#FFFFFF',
    panelColor: '#FFFFFF',
    glassColor: '#BAE6FD',
    visible: true,
    locked: false,
  };
  const winRound: Opening = {
    ...winRect,
    id: 'op_round',
    subtype: 'round',
    t: 0.55,
    widthMm: 900,
    heightMm: 900,
    sillHeightMm: 1000,
  };
  const winFull: Opening = {
    ...winRect,
    id: 'op_full',
    subtype: 'floor_to_ceiling',
    t: 0.82,
    widthMm: 1000,
    heightMm: 2780,
    sillHeightMm: 0,
  };

  const built = buildWall3DGroup(wall, {
    rooms: [],
    allWalls: [wall],
    openings: [winRect, winRound, winFull],
    cutawayEnabled: false,
    cutawayHeightMm: 1400,
    castShadows: true,
    innerMat: matInner,
    outerMat: matOuter,
    coreMat: matCore,
    baseboardMat: matTrim,
    crownMat: matTrim,
  });
  assert.ok(built);

  // Verify NO mesh triangle centroid passes through the interior of any window opening
  built.wallGroup.updateMatrixWorld(true);
  const clearRects = [
    { x1: 1.5 - 0.54, x2: 1.5 + 0.54, y1: 0.96, y2: 2.04 }, // rect window
    { x1: 4.92 - 0.44, x2: 4.92 + 0.44, y1: 0.04, y2: 2.72 }, // floor-to-ceiling
  ];

  const meshList: THREE.Mesh[] = [];
  built.wallGroup.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshList.push(obj as THREE.Mesh);
  });
  assert.ok(meshList.length >= 2, 'Expected main wall mesh plus split trim segments');

  const wallMainMesh = meshList[0];
  assert.equal(Array.isArray(wallMainMesh.material), true);
  assert.equal((wallMainMesh.material as THREE.Material[]).length, 3);

  for (const mesh of meshList) {
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const triCount = Math.floor(pos.count / 3);
    for (let t = 0; t < triCount; t++) {
      const i0 = t * 3;
      const v0 = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(mesh.matrixWorld);
      const v1 = new THREE.Vector3(pos.getX(i0 + 1), pos.getY(i0 + 1), pos.getZ(i0 + 1)).applyMatrix4(mesh.matrixWorld);
      const v2 = new THREE.Vector3(pos.getX(i0 + 2), pos.getY(i0 + 2), pos.getZ(i0 + 2)).applyMatrix4(mesh.matrixWorld);
      const cx = (v0.x + v1.x + v2.x) / 3;
      const cy = (v0.y + v1.y + v2.y) / 3;
      for (const r of clearRects) {
        assert.ok(
          !(cx > r.x1 && cx < r.x2 && cy > r.y1 && cy < r.y2),
          `Opaque wall/trim triangle centroid at (${cx.toFixed(3)}, ${cy.toFixed(3)}) covers window opening!`
        );
      }
      assert.ok(
        !(Math.hypot(cx - 3.3, cy - 1.45) < 0.39),
        `Opaque wall/trim triangle centroid at (${cx.toFixed(3)}, ${cy.toFixed(3)}) covers round window opening!`
      );
    }
  }

  // Verify curved wall cutouts also leave window center open
  const curvedWall = makeWall('w_curv', 0, 0, 5000, 0, 'center', 200);
  curvedWall.isCurved = true;
  curvedWall.curveBulgeMm = 450;
  const curvedWin: Opening = { ...winRect, id: 'op_cwin', wallId: curvedWall.id, t: 0.5, widthMm: 1200, sillHeightMm: 900, heightMm: 1100 };
  const builtCurved = buildWall3DGroup(curvedWall, {
    rooms: [],
    allWalls: [curvedWall],
    openings: [curvedWin],
    cutawayEnabled: false,
    cutawayHeightMm: 1400,
    castShadows: false,
    innerMat: matInner,
    outerMat: matOuter,
    coreMat: matCore,
  });
  assert.ok(builtCurved);
  let hasCurvedMiddleObstruction = false;
  builtCurved.wallGroup.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      const box = new THREE.Box3().setFromObject(m);
      if (box.min.x <= 2.5 && box.max.x >= 2.5 && box.min.y < 1.8 && box.max.y > 1.1) {
        hasCurvedMiddleObstruction = true;
      }
    }
  });
  assert.equal(hasCurvedMiddleObstruction, false, 'Curved wall must cut window opening span');
});











