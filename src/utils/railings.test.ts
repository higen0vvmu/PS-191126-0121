import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchElement, Wall } from '../types/plan';
import {
  DEFAULT_RAILING_STYLE,
  RAILING_STYLES,
  applyRailingStylePreset,
  buildRailingArchElementFromWorldPoints,
  computeRailingPathMetrics,
  computeStaircaseGeometrySpec,
  createDefaultRailingConfig,
  extractEditableRailingElementsFromHost,
  localToWorldPoint,
  recenterRailingNodes,
  resolveHostDeckRailings,
  resolveHostStairRailings,
  snapRailingDrawPoint,
} from './railings';

test('default railing style is glass_panel and all 8 architectural styles have distinct defaults', () => {
  assert.equal(DEFAULT_RAILING_STYLE, 'glass_panel');
  assert.equal(RAILING_STYLES.length, 8);
  const styleIds = new Set(RAILING_STYLES.map((s) => s.id));
  assert.deepEqual(
    styleIds,
    new Set([
      'traditional_balusters',
      'horizontal_metal',
      'glass_panel',
      'frameless_glass',
      'cable',
      'solid_panel',
      'modern_minimalist',
      'handrail_only',
    ])
  );

  for (const st of RAILING_STYLES) {
    const cfg = createDefaultRailingConfig(st.id, 2400);
    assert.equal(cfg.style, st.id);
    assert.equal(cfg.nodes.length, 2);
    assert.ok(cfg.heightMm >= 900 && cfg.heightMm <= 1200);
  }
});

test('applyRailingStylePreset preserves user path nodes while switching style characteristics', () => {
  const base = createDefaultRailingConfig('glass_panel', 2000);
  const multi = {
    ...base,
    nodes: [
      { xMm: -1000, yMm: 0, elevationMm: 0 },
      { xMm: 0, yMm: 0, elevationMm: 500 },
      { xMm: 0, yMm: 1200, elevationMm: 500 },
    ],
  };
  const switched = applyRailingStylePreset(multi, 'cable');
  assert.equal(switched.style, 'cable');
  assert.equal(switched.nodes.length, 3);
  assert.equal(switched.nodes[1].elevationMm, 500);
  assert.equal(switched.cableCount >= 6, true);
  assert.equal(switched.handrailShape, 'rectangular');
});

test('multi-segment sloped path metrics compute exact plan length, 3D slope length, and post/baluster counts', () => {
  const cfg = createDefaultRailingConfig('traditional_balusters', 2000);
  cfg.nodes = [
    { xMm: 0, yMm: 0, elevationMm: 0 },
    { xMm: 3000, yMm: 0, elevationMm: 1500 },
    { xMm: 3000, yMm: 1000, elevationMm: 1500 },
  ];
  const metrics = computeRailingPathMetrics(cfg);
  assert.equal(metrics.segmentCount, 2);
  assert.equal(Math.round(metrics.totalPlanLengthMm), 4000);
  assert.equal(metrics.isSloped, true);
  assert.equal(metrics.minElevMm, 0);
  assert.equal(metrics.maxElevMm, 1500);
  assert.ok(metrics.total3dLengthMm > metrics.totalPlanLengthMm);
  assert.ok(metrics.postCount >= 4);
  assert.ok(metrics.balusterCount > 10);
});

test('recenterRailingNodes keeps world positions invariant after origin recentering', () => {
  const el = buildRailingArchElementFromWorldPoints(
    'r1',
    [
      { xMm: 1000, yMm: 2000, elevationMm: 200 },
      { xMm: 3000, yMm: 2000, elevationMm: 1000 },
      { xMm: 3000, yMm: 3400, elevationMm: 1000 },
    ],
    'glass_panel'
  );
  assert.equal(el.elevationMm, 200);
  const cfg = el.railing!;
  const world0 = localToWorldPoint(el.xMm, el.yMm, el.rotationDeg, cfg.nodes[0].xMm, cfg.nodes[0].yMm);
  const world2 = localToWorldPoint(el.xMm, el.yMm, el.rotationDeg, cfg.nodes[2].xMm, cfg.nodes[2].yMm);
  assert.equal(Math.round(world0.x), 1000);
  assert.equal(Math.round(world0.y), 2000);
  assert.equal(Math.round(world2.x), 3000);
  assert.equal(Math.round(world2.y), 3400);

  const rec = recenterRailingNodes(
    [
      { xMm: 0, yMm: 0, elevationMm: 0 },
      { xMm: 800, yMm: 600, elevationMm: 300 },
    ],
    70
  );
  assert.equal(rec.centerLocal.x, 400);
  assert.equal(rec.centerLocal.y, 300);
  assert.equal(rec.nodes[0].xMm, -400);
  assert.equal(rec.nodes[1].xMm, 400);
});

test('staircase geometry & integrated sloped railings support straight, L, U, and spiral flights cleanly', () => {
  const stairTypes: Array<ArchElement['type']> = [
    'stairs_straight',
    'stairs_l',
    'stairs_u',
    'stairs_spiral',
  ];
  for (const sType of stairTypes) {
    const spec = computeStaircaseGeometrySpec(
      {
        type: sType,
        widthMm: 2200,
        depthMm: 2600,
        heightMm: 2800,
        stepCount: 14,
        stairTurnDirection: 'right',
        connectToCeiling: false,
        elevationMm: 0,
      },
      2800
    );
    assert.ok(spec.steps.length >= 14, `${sType} steps generated`);
    assert.ok(spec.leftRailingNodes.length >= 2, `${sType} left rail`);
    assert.ok(spec.rightRailingNodes.length >= 2, `${sType} right rail`);
    const firstE = spec.leftRailingNodes[0].elevationMm ?? 0;
    const lastE = spec.leftRailingNodes[spec.leftRailingNodes.length - 1].elevationMm ?? 0;
    assert.ok(lastE > firstE, `${sType} railing ascends from bottom to top`);
  }

  const hostStair: ArchElement = {
    id: 'st_l',
    name: 'L Stair',
    type: 'stairs_l',
    xMm: 2000,
    yMm: 2000,
    elevationMm: 0,
    rotationDeg: 0,
    widthMm: 2200,
    depthMm: 2400,
    heightMm: 2800,
    color: '#FFFFFF',
    accentColor: '#334155',
    material: 'oak',
    stepCount: 14,
    hasRailing: true,
    railingLeft: true,
    railingRight: true,
    railing: createDefaultRailingConfig('modern_minimalist', 2200),
    visible: true,
    locked: false,
  };
  const resolved = resolveHostStairRailings(hostStair, 2800);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].style, 'modern_minimalist');

  let seq = 0;
  const extracted = extractEditableRailingElementsFromHost(hostStair, () => `r_${++seq}`, 2800);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].type, 'railing');
  assert.equal(extracted[0].railing?.style, 'modern_minimalist');
});

test('balcony and platform edge railings merge contiguous edges and convert cleanly', () => {
  const balcony: ArchElement = {
    id: 'bal_1',
    name: 'Balcony',
    type: 'balcony',
    xMm: 3000,
    yMm: 1500,
    elevationMm: 0,
    rotationDeg: 0,
    widthMm: 3200,
    depthMm: 1400,
    heightMm: 180,
    color: '#CBD5E1',
    accentColor: '#334155',
    material: 'concrete',
    hasRailing: true,
    railingEdges: { front: true, left: true, right: true, back: false },
    railing: createDefaultRailingConfig('frameless_glass', 3200),
    visible: true,
    locked: false,
  };
  const rails = resolveHostDeckRailings(balcony);
  assert.equal(rails.length, 1);
  assert.equal(rails[0].nodes.length, 4); // U-perimeter continuous corner-connected path
  assert.equal(rails[0].closed, false);
  assert.equal(rails[0].nodes[0].elevationMm, 180);
});

test('snapRailingDrawPoint snaps to staircase slope elevation and balcony deck top elevation', () => {
  const stair: ArchElement = {
    id: 'st_s',
    name: 'Straight Stairs',
    type: 'stairs_straight',
    xMm: 1000,
    yMm: 2000,
    elevationMm: 0,
    rotationDeg: 0,
    widthMm: 1000,
    depthMm: 2800,
    heightMm: 2800,
    color: '#FFFFFF',
    accentColor: '#334155',
    material: 'concrete',
    stepCount: 14,
    hasRailing: true,
    visible: true,
    locked: false,
  };
  const balcony: ArchElement = {
    id: 'bal_s',
    name: 'Balcony',
    type: 'balcony',
    xMm: 5000,
    yMm: 2000,
    elevationMm: 1200,
    rotationDeg: 0,
    widthMm: 2400,
    depthMm: 1200,
    heightMm: 200,
    color: '#FFFFFF',
    accentColor: '#334155',
    material: 'concrete',
    hasRailing: true,
    visible: true,
    locked: false,
  };
  const walls: Wall[] = [];

  // Midpoint along right edge of straight stairs (x = 1000 + 500 - 36 = 1464, y = 2000 -> halfway up 2800mm)
  const stairMidSnap = snapRailingDrawPoint(
    { x: 1460, y: 2000 },
    { walls, archElements: [stair, balcony], gridSizeMm: 50, snapEnabled: true, ceilingHeightMm: 2800 }
  );
  assert.equal(stairMidSnap.snappedKind, 'stair_slope');
  assert.ok(stairMidSnap.elevationMm > 1200 && stairMidSnap.elevationMm < 1700);

  // Near front-left corner of balcony (elev = 1200 + 200 = 1400)
  const balSnap = snapRailingDrawPoint(
    { x: 5000 - 1160, y: 2000 + 560 },
    { walls, archElements: [stair, balcony], gridSizeMm: 50, snapEnabled: true }
  );
  assert.equal(balSnap.snappedKind, 'deck_edge');
  assert.equal(balSnap.elevationMm, 1400);
});
