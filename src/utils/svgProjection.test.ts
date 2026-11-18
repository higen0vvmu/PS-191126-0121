import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FurnitureInstance,
  FurniturePart,
  FurnitureRepresentation,
  Project,
  ProjectedViewSvg,
  ProjectionViewId,
  SvgVectorElement,
  Wall,
} from '../types/plan';
import {
  bundleProjectAssets,
  hydrateProjectAssets,
  putGlbAsset,
  stripInlineGlbForStorage,
} from './assetStore';
import {
  computeFurnitureBoundsMm,
  resolveWallViewProjectionForFurniture,
} from './geometry';
import { BUILTIN_CATALOG } from '../data/catalog';
import {
  computeFurnitureRepresentationAsync,
  needsRepresentationRegeneration,
} from './furnitureRepresentationSync';
import {
  generateDefaultTopViewFromParts,
  hasValidDefaultSvg,
  isValidSvgSource,
  parseSvgSourceToProjectedView,
  resolveEffectiveRepresentationMode,
} from './svgImport';
import {
  computeFurnitureGeometrySignature,
  generateRepresentationFromObject3D,
  generateRepresentationFromParts,
} from './svgProjection';
import { getEffectiveViewElements, hasCustomView } from './svgRepresentationRenderer';

function makeBoundsPart(w: number, d: number, h: number): FurniturePart[] {
  return [
    {
      id: 'bounds_p',
      name: 'Bounds',
      shape: 'box',
      xMm: 0,
      yMm: 0,
      zMm: 0,
      widthMm: w,
      depthMm: d,
      heightMm: h,
      rotationDeg: 0,
      color: '#94A3B8',
      material: 'wood',
    },
  ];
}

function countSvgSubpaths(d: string): number {
  const matches = d.match(/M\s+/g);
  return matches ? matches.length : 0;
}

function parseFirstPathPoints(d: string): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const firstSub = d.split('Z')[0] ?? d;
  const tokens = firstSub.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === 'M' || tokens[i] === 'L') {
      const x = Number(tokens[i + 1]);
      const y = Number(tokens[i + 2]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        pts.push({ x, y });
      }
      i += 2;
    }
  }
  return pts;
}

function polygonArea2D(pts: Array<{ x: number; y: number }>): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function assertAllFiveViewsClean(
  rep: FurnitureRepresentation,
  expectedMm: { w: number; d: number; h: number },
  label: string
) {
  const views: ProjectionViewId[] = ['top', 'front', 'rear', 'left', 'right'];
  assert.ok(rep.autoViews, `${label}: autoViews must exist`);
  assert.ok(rep.geometrySignature, `${label}: geometrySignature must exist`);

  for (const v of views) {
    const pv: ProjectedViewSvg | undefined = rep.autoViews[v];
    assert.ok(pv, `${label}: missing ${v} view`);
    assert.ok(pv.elements.length >= 1, `${label} ${v}: expected at least 1 SVG element`);
    const sil: SvgVectorElement | undefined = pv.elements.find((e: SvgVectorElement) => e.id === `sil_${v}`);
    assert.ok(sil && sil.kind === 'path', `${label} ${v}: missing silhouette path sil_${v}`);
    assert.ok(sil.d.startsWith('M '), `${label} ${v}: path must start with M`);
    assert.equal(sil.stroke, '#0F172A', `${label} ${v}: black architectural stroke`);
    assert.equal(sil.fill, '#FFFFFF', `${label} ${v}: white architectural fill`);
    assert.equal(sil.fillRule, 'evenodd', `${label} ${v}: evenodd hole rule`);

    const pts = parseFirstPathPoints(sil.d);
    assert.ok(pts.length >= 4, `${label} ${v}: path too sparse (${pts.length} pts)`);

    // Check normalized metric viewBox dimensions match expected size closely
    const expW = v === 'top' ? expectedMm.w : v === 'front' || v === 'rear' ? expectedMm.w : expectedMm.d;
    const expH = v === 'top' ? expectedMm.d : expectedMm.h;
    assert.ok(
      Math.abs(pv.viewBox.width - expW) <= expW * 0.08 + 20,
      `${label} ${v}: viewBox.width=${pv.viewBox.width} expected ~${expW}`
    );
    assert.ok(
      Math.abs(pv.viewBox.height - expH) <= expH * 0.08 + 20,
      `${label} ${v}: viewBox.height=${pv.viewBox.height} expected ~${expH}`
    );
    if (v !== 'top') {
      // Elevation sits grounded near y <= 0 (bottom at y = 0, top near -H)
      assert.ok(pv.viewBox.minY < 0, `${label} ${v}: elevation minY must be negative`);
    }
  }
}

// ==================== ARCHETYPE BUILDERS (TRIANGULATED 3D MESHES) ====================

function buildSwivelChairMesh(): THREE.Group {
  const g = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const fabricMat = new THREE.MeshStandardMaterial({ color: 0x1e6b52 });

  // 5-star spoke base
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.36), baseMat);
    const angle = (i * Math.PI * 2) / 5;
    spoke.position.set(Math.sin(angle) * 0.17, 0.04, Math.cos(angle) * 0.17);
    spoke.rotation.y = angle;
    g.add(spoke);
  }
  // Central stem
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 12), baseMat);
  stem.position.set(0, 0.2, 0);
  g.add(stem);
  // Deep seat cushion
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.14, 0.52), fabricMat);
  seat.position.set(0, 0.4, 0.04);
  g.add(seat);
  // Curved/stepped backrest (taller, narrower toward top, shifted to rear -z)
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.42, 0.14), fabricMat);
  back.position.set(0, 0.62, -0.2);
  g.add(back);
  // Low armrests flanking seat
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.44), fabricMat);
  armL.position.set(-0.29, 0.5, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.44), fabricMat);
  armR.position.set(0.29, 0.5, 0);
  g.add(armL, armR);
  return g;
}

function buildSofaMesh(): THREE.Group {
  const g = new THREE.Group();
  const fabric = new THREE.MeshStandardMaterial({ color: 0x94a3b8 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x334155 });

  // 4 corner legs leaving clearance underneath
  for (const lx of [-0.95, 0.95]) {
    for (const lz of [-0.38, 0.38]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.16, 8), legMat);
      leg.position.set(lx, 0.08, lz);
      g.add(leg);
    }
  }
  // Base deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.22, 0.9), fabric);
  deck.position.set(0, 0.27, 0);
  g.add(deck);
  // Rear backrest (-z)
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.48, 0.22), fabric);
  back.position.set(0, 0.62, -0.34);
  g.add(back);
  // Left and right armrests
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.32, 0.9), fabric);
  armL.position.set(-0.95, 0.54, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.32, 0.9), fabric);
  armR.position.set(0.95, 0.54, 0);
  g.add(armL, armR);
  return g;
}

function buildDiningChairMesh(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xb8895a });

  // 4 legs
  for (const lx of [-0.19, 0.19]) {
    for (const lz of [-0.2, 0.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.44, 0.04), wood);
      leg.position.set(lx, 0.22, lz);
      g.add(leg);
    }
  }
  // Seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.44), wood);
  seat.position.set(0, 0.46, 0);
  g.add(seat);
  // Open backrest frame (2 uprights + top rail -> negative space window in backrest!)
  const upL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.44, 0.04), wood);
  upL.position.set(-0.19, 0.68, -0.2);
  const upR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.44, 0.04), wood);
  upR.position.set(0.19, 0.68, -0.2);
  const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.04), wood);
  topRail.position.set(0, 0.85, -0.2);
  g.add(upL, upR, topRail);
  return g;
}

function buildTableMesh(): THREE.Group {
  const g = new THREE.Group();
  const oak = new THREE.MeshStandardMaterial({ color: 0xc29b6e });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.9), oak);
  top.position.set(0, 0.725, 0);
  g.add(top);

  for (const lx of [-0.82, 0.82]) {
    for (const lz of [-0.37, 0.37]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.7, 0.07), oak);
      leg.position.set(lx, 0.35, lz);
      g.add(leg);
    }
  }
  return g;
}

function buildCabinetMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xe2e8f0 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x334155 });

  // Legs
  for (const lx of [-0.7, 0.7]) {
    for (const lz of [-0.18, 0.18]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05), legMat);
      leg.position.set(lx, 0.09, lz);
      g.add(leg);
    }
  }
  // Left closed cabinet wing
  const leftWing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.64, 0.45), body);
  leftWing.position.set(-0.35, 0.5, 0);
  g.add(leftWing);
  // Right open shelf frame (top, bottom, right side, back panel leaving open niche in front view)
  const rightTop = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.45), body);
  rightTop.position.set(0.45, 0.795, 0);
  const rightBot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.45), body);
  rightBot.position.set(0.45, 0.205, 0);
  const rightSide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.64, 0.45), body);
  rightSide.position.set(0.775, 0.5, 0);
  g.add(rightTop, rightBot, rightSide);
  return g;
}

function buildBedMesh(): THREE.Group {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xd6d3d1 });
  const mattressMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc });
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0 });

  // Frame
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.28, 2.1), frameMat);
  frame.position.set(0, 0.14, 0);
  g.add(frame);
  // Mattress recessed slightly inside frame
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.24, 1.94), mattressMat);
  mattress.position.set(0, 0.4, 0.04);
  g.add(mattress);
  // Tall headboard at rear (-z)
  const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 0.12), frameMat);
  headboard.position.set(0, 0.55, -0.99);
  g.add(headboard);
  // Twin pillows
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 0.4), pillowMat);
  p1.position.set(-0.4, 0.58, -0.68);
  const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 0.4), pillowMat);
  p2.position.set(0.4, 0.58, -0.68);
  g.add(p1, p2);
  return g;
}

function buildDecorativeRingSculptureMesh(): THREE.Group {
  const g = new THREE.Group();
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xf1f5f9 });
  // Vertical torus (donut sculpture sitting upright on a plinth -> obvious central hole in front/rear!)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.055, 12, 28), ceramic);
  ring.position.set(0, 0.28, 0);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.14), ceramic);
  plinth.position.set(0, 0.025, 0);
  g.add(ring, plinth);
  return g;
}

// ==================== TEST SUITE ====================

test('1. Generates accurate 5-view architectural silhouettes & negative space across all 7 furniture archetypes', () => {
  // 1) Swivel chair
  const swivelRep = generateRepresentationFromObject3D(buildSwivelChairMesh(), {
    partsForBounds: makeBoundsPart(670, 670, 830),
    mode: 'silhouette',
  });
  assertAllFiveViewsClean(swivelRep, { w: 670, d: 670, h: 830 }, 'Swivel Chair');
  const swivelTopPts = parseFirstPathPoints((swivelRep.autoViews!.top!.elements[0] as { d: string }).d);
  const swivelTopArea = polygonArea2D(swivelTopPts);
  // Must NOT be a full 670x670 rectangular bounding box (top view has rounded/armrest/spoke profile)
  assert.ok(swivelTopPts.length > 4, 'Swivel chair top silhouette must have >4 vertices (not a bounding box)');
  assert.ok(swivelTopArea < 670 * 670 * 0.92, `Swivel chair top area ${swivelTopArea} should be less than full bbox`);

  // 2) Sofa (elevated on legs: front elevation area << bounding box because of under-sofa clearance & seat dip)
  const sofaRep = generateRepresentationFromObject3D(buildSofaMesh(), {
    partsForBounds: makeBoundsPart(2100, 900, 860),
    mode: 'silhouette',
  });
  assertAllFiveViewsClean(sofaRep, { w: 2100, d: 900, h: 860 }, 'Sofa');
  const sofaFrontPts = parseFirstPathPoints((sofaRep.autoViews!.front!.elements[0] as { d: string }).d);
  assert.ok(sofaFrontPts.length >= 6, 'Sofa front elevation must capture stepped arms/back/legs');

  // 3) Dining chair (open backrest + open leg void -> multiple closed loops or strongly concave silhouette)
  const chairRep = generateRepresentationFromObject3D(buildDiningChairMesh(), {
    partsForBounds: makeBoundsPart(440, 440, 900),
    mode: 'silhouette',
  });
  assertAllFiveViewsClean(chairRep, { w: 440, d: 440, h: 900 }, 'Dining Chair');
  const chairFrontSil = chairRep.autoViews!.front!.elements[0] as { d: string };
  assert.ok(
    countSvgSubpaths(chairFrontSil.d) >= 2 ||
      polygonArea2D(parseFirstPathPoints(chairFrontSil.d)) < 440 * 900 * 0.65,
    'Dining chair front view must preserve negative space between legs / backrest'
  );

  // 4) Table (open under-table clearance in front/left projections!)
  const tableRep = generateRepresentationFromObject3D(buildTableMesh(), {
    partsForBounds: makeBoundsPart(1800, 900, 750),
    mode: 'silhouette',
  });
  assertAllFiveViewsClean(tableRep, { w: 1800, d: 900, h: 750 }, 'Table');
  const tableFrontArea = polygonArea2D(
    parseFirstPathPoints((tableRep.autoViews!.front!.elements[0] as { d: string }).d)
  );
  assert.ok(
    tableFrontArea < 1800 * 750 * 0.45,
    `Table front elevation area (${Math.round(tableFrontArea)}) must be far smaller than bounding box (${1800 * 750})`
  );

  // 5) Cabinet
  const cabRep = generateRepresentationFromObject3D(buildCabinetMesh(), {
    partsForBounds: makeBoundsPart(1600, 450, 820),
    mode: 'silhouette',
  });
  assertAllFiveViewsClean(cabRep, { w: 1600, d: 450, h: 820 }, 'Cabinet');

  // 6) Bed
  const bedRep = generateRepresentationFromObject3D(buildBedMesh(), {
    partsForBounds: makeBoundsPart(1800, 2100, 1100),
    mode: 'silhouette',
  });
  assertAllFiveViewsClean(bedRep, { w: 1800, d: 2100, h: 1100 }, 'Bed');
  const bedSideArea = polygonArea2D(
    parseFirstPathPoints((bedRep.autoViews!.left!.elements[0] as { d: string }).d)
  );
  assert.ok(
    bedSideArea < 2100 * 1100 * 0.72,
    'Bed side elevation must show lower mattress stepping up to tall headboard'
  );

  // 7) Decorative hollow ring sculpture -> preserves central opening via evenodd subpath!
  const decorRep = generateRepresentationFromObject3D(buildDecorativeRingSculptureMesh(), {
    partsForBounds: makeBoundsPart(510, 140, 535),
    mode: 'silhouette',
  });
  assertAllFiveViewsClean(decorRep, { w: 510, d: 140, h: 535 }, 'Decorative Ring Sculpture');
  const decorFrontSil = decorRep.autoViews!.front!.elements[0] as { d: string };
  assert.ok(
    countSvgSubpaths(decorFrontSil.d) >= 2,
    `Decorative ring front view must preserve interior hole subpath (got ${countSvgSubpaths(decorFrontSil.d)})`
  );
});

test('2. Hidden-line mode emits visible internal structural crease edges without flat triangulation clutter', () => {
  const sofaMesh = buildSofaMesh();
  const bounds = makeBoundsPart(2100, 900, 860);

  const silRep = generateRepresentationFromObject3D(sofaMesh, {
    partsForBounds: bounds,
    mode: 'silhouette',
  });
  const hlRep = generateRepresentationFromObject3D(sofaMesh, {
    partsForBounds: bounds,
    mode: 'hidden_line',
  });

  // Top view has recessed seat vs taller backrest/armrests -> hidden_line adds internal crease lines
  const silTopEls = silRep.autoViews!.top!.elements;
  const hlTopEls = hlRep.autoViews!.top!.elements;
  assert.ok(
    hlTopEls.length > silTopEls.length,
    `Hidden-line top view (${hlTopEls.length}) should include more structural edges than silhouette (${silTopEls.length})`
  );

  // Check flat triangulation diagonals are NOT emitted in excess on simple box/sofa surfaces
  // Total elements in sofa front hidden-line view should stay clean & architectural (< 60 paths)
  const hlFrontEls = hlRep.autoViews!.front!.elements;
  assert.ok(
    hlFrontEls.length > 1 && hlFrontEls.length < 60,
    `Hidden-line sofa front should have clean architectural edge count, got ${hlFrontEls.length}`
  );

  // Material fill elements are also extracted cleanly for optional toggle
  assert.ok(
    (hlRep.autoViews!.top!.fillElements?.length ?? 0) >= 1,
    'Optional material fillElements should be generated for multi-color/material models'
  );
});

test('3. Parametric catalog/custom furniture generates 5-view representations via unified pipeline', () => {
  const consoleParts: FurniturePart[] = [
    {
      id: 'top',
      name: 'Tabletop',
      shape: 'rounded_rect',
      xMm: 0,
      yMm: 0,
      zMm: 710,
      widthMm: 1500,
      depthMm: 450,
      heightMm: 40,
      rotationDeg: 0,
      color: '#FFFFFF',
      material: 'oak',
    },
    {
      id: 'leg_l',
      name: 'Leg L',
      shape: 'cylinder',
      xMm: -650,
      yMm: 0,
      zMm: 0,
      widthMm: 60,
      depthMm: 380,
      heightMm: 710,
      rotationDeg: 0,
      color: '#334155',
      material: 'metal',
    },
    {
      id: 'leg_r',
      name: 'Leg R',
      shape: 'cylinder',
      xMm: 650,
      yMm: 0,
      zMm: 0,
      widthMm: 60,
      depthMm: 380,
      heightMm: 710,
      rotationDeg: 0,
      color: '#334155',
      material: 'metal',
    },
  ];
  const rep = generateRepresentationFromParts(consoleParts, { mode: 'hidden_line' });
  const bounds = computeFurnitureBoundsMm(consoleParts);
  assertAllFiveViewsClean(
    rep,
    { w: bounds.widthMm, d: bounds.depthMm, h: bounds.heightMm },
    'Parametric Console Table'
  );
});

test('4. Wall View selects exact directional elevation (front/rear/left/right) and flipX from viewing angle & mirrors', () => {
  // South wall running West -> East:
  // inner normal (into room above wall) = (0, -1) -> viewer looks toward +Y (South), i.e. viewer's viewDir = (0, 1)
  // For a furniture item facing North (rotationDeg=0 -> front points in +Y or -Y? Let's check exact helper behavior):
  const southWall: Wall = {
    id: 'w_south',
    start: { x: 0, y: 4000 },
    end: { x: 5000, y: 4000 },
    isCurved: false,
    curveBulgeMm: 0,
    thicknessMm: 150,
    heightMm: 2800,
    alignment: 'center',
    innerColor: '#FFFFFF',
    outerColor: '#FFFFFF',
    innerMaterial: 'paint',
    outerMaterial: 'paint',
    innerTextureScale: 1,
    outerTextureScale: 1,
    innerTextureRotDeg: 0,
    outerTextureRotDeg: 0,
    hasBaseboard: false,
    baseboardHeightMm: 80,
    baseboardColor: '#FFFFFF',
    hasCrownMolding: false,
    crownHeightMm: 60,
    crownColor: '#FFFFFF',
    locked: false,
    visible: true,
  };

  const makeItem = (rot: number, mirroredX = false, mirroredY = false): FurnitureInstance => ({
    id: 'f1',
    templateId: 'sofa',
    name: 'Sofa',
    category: 'Sofas & Seating',
    xMm: 2500,
    yMm: 3600,
    elevationMm: 0,
    rotationDeg: rot,
    mirroredX,
    mirroredY,
    lockProportions: false,
    parts: makeBoundsPart(2000, 900, 850),
    visible: true,
    locked: false,
  });

  // Rotating item in 90-degree increments against same wall inner face must cycle cleanly through all 4 sides
  const v0 = resolveWallViewProjectionForFurniture(southWall, 'inner', makeItem(0));
  const v90 = resolveWallViewProjectionForFurniture(southWall, 'inner', makeItem(90));
  const v180 = resolveWallViewProjectionForFurniture(southWall, 'inner', makeItem(180));
  const v270 = resolveWallViewProjectionForFurniture(southWall, 'inner', makeItem(270));

  const distinct = new Set([v0.viewId, v90.viewId, v180.viewId, v270.viewId]);
  assert.equal(distinct.size, 4, `90-degree increments must yield all 4 distinct elevation views: ${[...distinct]}`);

  // Opposite wall side ('outer') must flip between opposite views (front <-> rear, left <-> right)
  const v0Outer = resolveWallViewProjectionForFurniture(southWall, 'outer', makeItem(0));
  const opp: Record<string, string> = { front: 'rear', rear: 'front', left: 'right', right: 'left' };
  assert.equal(v0Outer.viewId, opp[v0.viewId]);

  // Mirroring X flips screen X parity and swaps left/right when viewing sides
  const sideMirrored = resolveWallViewProjectionForFurniture(southWall, 'inner', makeItem(90, true, false));
  assert.notEqual(sideMirrored.viewId, v90.viewId === 'left' || v90.viewId === 'right' ? v90.viewId : '');
});

test('5. Geometry signature stays stable on move/2D-rotate/rename/reload and invalidates only on 3D geometry/style changes', () => {
  const rep = generateRepresentationFromParts(makeBoundsPart(1200, 800, 750), { mode: 'silhouette' });
  const base: FurnitureInstance = {
    id: 'tbl_1',
    templateId: 'table',
    name: 'Dining Table',
    category: 'Tables & Desks',
    xMm: 1500,
    yMm: 1800,
    elevationMm: 0,
    rotationDeg: 0,
    rotationXDeg: 0,
    rotationYDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: makeBoundsPart(1200, 800, 750),
    representation: rep,
    visible: true,
    locked: false,
  };

  assert.equal(needsRepresentationRegeneration(base), false);

  // Move, rotate 2D, mirror, rename, zOrder change -> must NOT regenerate
  const movedRotatedRenamed: FurnitureInstance = {
    ...base,
    name: 'Oak Dining Table',
    xMm: 3400,
    yMm: 2900,
    elevationMm: 100,
    rotationDeg: 45,
    mirroredX: true,
    zOrder: 12,
    locked: true,
  };
  assert.equal(
    computeFurnitureGeometrySignature(movedRotatedRenamed, 'silhouette'),
    rep.geometrySignature
  );
  assert.equal(needsRepresentationRegeneration(movedRotatedRenamed), false);

  // Resize parts -> MUST invalidate
  const resized: FurnitureInstance = {
    ...base,
    parts: makeBoundsPart(1600, 800, 750),
  };
  assert.equal(needsRepresentationRegeneration(resized), true);

  // Tilt 3D (rotationXDeg) -> MUST invalidate
  const tilted: FurnitureInstance = {
    ...base,
    rotationXDeg: 15,
  };
  assert.equal(needsRepresentationRegeneration(tilted), true);

  // Mode change -> MUST invalidate if autoViews were for previous mode
  const modeChanged: FurnitureInstance = {
    ...base,
    representation: { ...rep, mode: 'hidden_line' },
  };
  assert.equal(needsRepresentationRegeneration(modeChanged), true);
});

test('6. Custom 2D SVG edits remain per-projection, never mutate 3D geometry, and persist across save/export/reopen', async () => {
  const glbFakePayload = 'data:model/gltf-binary;base64,' + 'A'.repeat(4096);
  const assetId = await putGlbAsset(glbFakePayload);
  const autoRep = generateRepresentationFromObject3D(buildSwivelChairMesh(), {
    glbAssetId: assetId,
    partsForBounds: makeBoundsPart(670, 670, 830),
    mode: 'silhouette',
  });

  // Add independent custom elements ONLY to 'top' and 'front', leaving 'rear'/'left'/'right' auto
  const editedRep: FurnitureRepresentation = {
    ...autoRep,
    customViews: {
      top: [
        ...(autoRep.autoViews?.top?.elements ?? []),
        {
          id: 'custom_swing_arc',
          kind: 'line',
          name: 'Swivel Axis Crosshair',
          x1: -120,
          y1: 0,
          x2: 120,
          y2: 0,
          stroke: '#2563EB',
          strokeWidthMm: 10,
          visible: true,
        },
      ],
      front: [
        ...(autoRep.autoViews?.front?.elements ?? []),
        {
          id: 'custom_label_line',
          kind: 'rect',
          name: 'Custom Cushion Tag',
          x: -80,
          y: -450,
          width: 160,
          height: 50,
          stroke: '#0F172A',
          strokeWidthMm: 8,
          fill: '#FFFFFF',
          fillOpacity: 1,
          visible: true,
        },
      ],
    },
    customViewUpdatedAt: {
      top: new Date().toISOString(),
      front: new Date().toISOString(),
    },
  };

  const chair: FurnitureInstance = {
    id: 'dyvlinge_1',
    templateId: 'imp_glb_dyvlinge',
    name: 'DYVLINGE Swivel Chair',
    category: 'My Library',
    xMm: 2200,
    yMm: 2100,
    elevationMm: 0,
    rotationDeg: 30,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    glbAssetId: assetId,
    glbDataUrl: glbFakePayload,
    parts: makeBoundsPart(670, 670, 830),
    representation: editedRep,
    visible: true,
    locked: false,
  };

  assert.equal(hasCustomView(chair.representation, 'top'), true);
  assert.equal(hasCustomView(chair.representation, 'front'), true);
  assert.equal(hasCustomView(chair.representation, 'rear'), false);

  const effectiveTop = getEffectiveViewElements(chair.representation, 'top');
  assert.equal(effectiveTop.isCustom, true);
  assert.ok(effectiveTop.elements!.some((e) => e.id === 'custom_swing_arc'));

  // 3D parts and asset ID remain strictly unchanged
  assert.equal(chair.glbAssetId, assetId);
  assert.deepEqual(computeFurnitureBoundsMm(chair.parts), {
    minX: -335,
    maxX: 335,
    minY: -335,
    maxY: 335,
    minZ: 0,
    maxZ: 830,
    widthMm: 670,
    depthMm: 670,
    heightMm: 830,
  });

  const project: Project = {
    id: 'proj_rev9_test',
    name: 'Rev 9 Persistence Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    activeLevelId: 'lvl_1',
    customLibrary: [],
    recentColors: [],
    settings: {
      preferredUnit: 'cm',
      scale: '1:50',
      gridSizeMm: 50,
      snapEnabled: true,
      angleSnapDeg: 15,
      orthoMode: false,
      autoDimensions: true,
      showGrid: true,
      cutawayEnabled: false,
      cutawayHeightMm: 1400,
      hideFrontWalls: false,
      fovDeg: 55,
      sunAzimuthDeg: 140,
      sunElevationDeg: 52,
      shadowsEnabled: true,
      darkMode: false,
      timeOfDay3d: 'day',
      blackAndWhite2d: false,
    },
    levels: [
      {
        id: 'lvl_1',
        name: 'Ground Floor',
        elevationMm: 0,
        ceilingHeightMm: 2800,
        walls: [],
        rooms: [],
        openings: [],
        curtains: [],
        furniture: [chair],
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
    ],
  };

  // LocalStorage compact serialization strips inline glbDataUrl while keeping glbAssetId & representation
  const stripped = stripInlineGlbForStorage(project);
  const strippedChair = stripped.levels[0].furniture[0];
  assert.equal(strippedChair.glbDataUrl, undefined);
  assert.equal(strippedChair.glbAssetId, assetId);
  assert.equal(needsRepresentationRegeneration(strippedChair), false);
  assert.ok(strippedChair.representation?.customViews?.top?.some((e) => e.id === 'custom_swing_arc'));

  // Portable JSON export bundles embeddedAssets -> JSON round-trip -> hydrateProjectAssets restores asset
  const bundled = await bundleProjectAssets(stripped);
  assert.equal(bundled.embeddedAssets?.[assetId], glbFakePayload);
  const reopened: Project = JSON.parse(JSON.stringify(bundled));
  await hydrateProjectAssets(reopened);
  const reopenedChair = reopened.levels[0].furniture[0];
  assert.equal(needsRepresentationRegeneration(reopenedChair), false, 'Reopened project must NOT force SVG regeneration');
  assert.ok(reopenedChair.representation?.customViews?.front?.some((e) => e.id === 'custom_label_line'));
});

test('7. Valid imported SVG defaults to Default mode and switching modes never overwrites original SVG; invalid/non-SVG items hide Default', async () => {
  const originalSvg = `<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(10, 5)">
      <rect x="0" y="0" width="80" height="50" fill="#FFFFFF" stroke="#0F172A" stroke-width="2" />
      <circle cx="40" cy="25" r="12" fill="#E2E8F0" stroke="#0F172A" stroke-width="1.5" />
      <path d="M 5 5 L 75 45" stroke="#334155" stroke-width="1" fill="none" />
    </g>
  </svg>`;

  assert.equal(isValidSvgSource(originalSvg), true);
  assert.equal(isValidSvgSource('<svg viewBox="0 0 10 10"></svg>'), false);
  assert.equal(isValidSvgSource('<not-svg><rect width="10" height="10"/></not-svg>'), false);
  assert.equal(isValidSvgSource(''), false);

  const parsed = parseSvgSourceToProjectedView(originalSvg, 1200, 720, 750);
  assert.ok(parsed, 'Valid SVG must parse into projected view & extruded parts');
  assert.equal(parsed.view.elements.length, 3);
  assert.equal(parsed.view.baseWidthMm, 1200);
  assert.equal(parsed.view.baseHeightMm, 720);

  const importedFurn: FurnitureInstance = {
    id: 'imp_svg_1',
    templateId: 'imp_svg_custom_desk',
    name: 'Imported SVG Desk',
    category: 'My Library',
    xMm: 1000,
    yMm: 1000,
    elevationMm: 0,
    rotationDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    svgSource: originalSvg,
    parts: parsed.parts,
    representation: {
      mode: 'default',
      defaultViews: { top: parsed.view },
    },
    visible: true,
    locked: false,
  };

  assert.equal(hasValidDefaultSvg(importedFurn), true);
  assert.equal(resolveEffectiveRepresentationMode(importedFurn), 'default');
  assert.equal(needsRepresentationRegeneration(importedFurn), false);

  const origDefaultSnapshot = JSON.stringify(importedFurn.representation!.defaultViews);

  // Switch Default -> Silhouette -> Hidden-Line -> Default
  const silRep = await computeFurnitureRepresentationAsync(importedFurn, { mode: 'silhouette' });
  assert.equal(silRep.mode, 'silhouette');
  assert.ok(silRep.autoViews?.top?.elements.length);
  assert.equal(JSON.stringify(silRep.defaultViews), origDefaultSnapshot, 'Silhouette must preserve defaultViews untouched');

  const hlRep = await computeFurnitureRepresentationAsync(
    { ...importedFurn, representation: silRep },
    { mode: 'hidden_line' }
  );
  assert.equal(hlRep.mode, 'hidden_line');
  assert.ok(hlRep.autoViews?.top?.elements.length);
  assert.equal(JSON.stringify(hlRep.defaultViews), origDefaultSnapshot, 'Hidden-line must preserve defaultViews untouched');

  const backToDefaultRep = await computeFurnitureRepresentationAsync(
    { ...importedFurn, representation: hlRep },
    { mode: 'default' }
  );
  assert.equal(backToDefaultRep.mode, 'default');
  assert.equal(JSON.stringify(backToDefaultRep.defaultViews), origDefaultSnapshot, 'Returning to Default preserves original SVG exactly');
  assert.equal(importedFurn.svgSource, originalSvg, 'Original svgSource string must never be overwritten');

  const effectiveDefault = getEffectiveViewElements(backToDefaultRep, 'top');
  assert.equal(effectiveDefault.elements?.length, 3);
  assert.equal(effectiveDefault.elements?.[0].id, 'svg_orig_rect_0');

  const effectiveSil = getEffectiveViewElements(silRep, 'top');
  assert.ok(effectiveSil.elements?.some((e) => e.id === 'sil_top'), 'Silhouette renders generated 3D outline');

  // Invalid SVG or non-SVG items (GLB, Custom builder, Image trace) must NOT show Default and must fall back to silhouette
  const invalidSvgItem: FurnitureInstance = {
    ...importedFurn,
    id: 'bad_svg_1',
    svgSource: '<svg></svg>',
    representation: { mode: 'default' },
  };
  assert.equal(hasValidDefaultSvg(invalidSvgItem), false);
  assert.equal(resolveEffectiveRepresentationMode(invalidSvgItem), 'silhouette');

  const glbItem: FurnitureInstance = {
    id: 'glb_only_1',
    templateId: 'imp_glb_chair',
    name: 'GLB Chair',
    category: 'My Library',
    xMm: 0,
    yMm: 0,
    elevationMm: 0,
    rotationDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    glbAssetId: 'glb_hash_123',
    parts: makeBoundsPart(650, 650, 820),
    representation: { mode: 'default' },
    visible: true,
    locked: false,
  };
  assert.equal(hasValidDefaultSvg(glbItem), false);
  assert.equal(resolveEffectiveRepresentationMode(glbItem), 'silhouette');

  const customBuilderItem: FurnitureInstance = {
    id: 'custom_only_1',
    templateId: 'custom_bench',
    name: 'Custom Bench',
    category: 'My Library',
    xMm: 0,
    yMm: 0,
    elevationMm: 0,
    rotationDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: makeBoundsPart(1400, 450, 450),
    visible: true,
    locked: false,
  };
  assert.equal(hasValidDefaultSvg(customBuilderItem), false);
  assert.equal(resolveEffectiveRepresentationMode(customBuilderItem), 'silhouette');
});

test('8. Built-in catalog furniture supports Default/Silhouette/Hidden-line without overwriting original drawing', async () => {
  const tpl = BUILTIN_CATALOG[0];
  assert.ok(tpl, 'BUILTIN_CATALOG must not be empty');

  const builtinFurn: FurnitureInstance = {
    id: 'builtin_1',
    templateId: tpl.id,
    name: tpl.name,
    category: tpl.category,
    xMm: 2000,
    yMm: 2000,
    elevationMm: 0,
    rotationDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: tpl.parts.map((p) => ({ ...p })),
    visible: true,
    locked: false,
  };

  assert.equal(hasValidDefaultSvg(builtinFurn), true, 'Built-in item must expose Default mode');
  assert.equal(resolveEffectiveRepresentationMode(builtinFurn), 'default', 'Built-in item starts in Default mode');
  assert.equal(
    needsRepresentationRegeneration(builtinFurn),
    false,
    'Built-in item in Default mode must NOT be auto-overwritten by 3D silhouette pass'
  );

  // Switch built-in item to Silhouette & Hidden-Line
  const silRep = await computeFurnitureRepresentationAsync(builtinFurn, { mode: 'silhouette' });
  assert.equal(silRep.mode, 'silhouette');
  assertAllFiveViewsClean(
    silRep,
    (() => {
      const b = computeFurnitureBoundsMm(builtinFurn.parts);
      return { w: b.widthMm, d: b.depthMm, h: b.heightMm };
    })(),
    `Built-in ${tpl.name} Silhouette`
  );

  const hlRep = await computeFurnitureRepresentationAsync(
    { ...builtinFurn, representation: silRep },
    { mode: 'hidden_line' }
  );
  assert.equal(hlRep.mode, 'hidden_line');
  assert.ok(hlRep.autoViews?.top?.elements.length);

  // Return to Default -> mode is 'default', autoViews cached cleanly, no custom views injected
  const restoredDefault = await computeFurnitureRepresentationAsync(
    { ...builtinFurn, representation: hlRep },
    { mode: 'default' }
  );
  assert.equal(restoredDefault.mode, 'default');
  assert.equal(restoredDefault.customViews, undefined);
  assert.ok(restoredDefault.autoViews?.top, 'autoViews cache can stay without overwriting default drawing');

  // Verify generateDefaultTopViewFromParts covers arc parts without falling back to triangle
  const arcTopView = generateDefaultTopViewFromParts([
    {
      id: 'arc_1',
      name: 'Curved Sofa Segment',
      shape: 'arc',
      xMm: 0,
      yMm: 0,
      zMm: 0,
      widthMm: 1600,
      depthMm: 800,
      heightMm: 780,
      rotationDeg: 0,
      color: '#FFFFFF',
      material: 'fabric',
    },
  ]);
  assert.ok(arcTopView);
  assert.equal(arcTopView.elements[0]?.kind, 'path');
  assert.ok((arcTopView.elements[0] as { d: string }).d.includes(' A '));
});

