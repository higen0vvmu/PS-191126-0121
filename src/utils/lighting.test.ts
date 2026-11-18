import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { FurnitureInstance, FurniturePart, Project } from '../types/plan';
import {
  applyGlbEmissiveOverrides,
  applyProceduralPartEmissive,
  assignInteriorShadowBudget,
  buildThreeLightsForFurniture,
  cloneLightsWithFreshIds,
  computeAimDirectionVectorThree,
  createDefaultLightSource,
  createMatchingLightForGlbMaterial,
  createMatchingLightForPart,
  inspectGlbMaterials,
  kelvinToThreeColor,
  resolveEffectiveFurnitureLights,
  resolveLightSourceHex,
  scaleFurnitureLightSources,
} from './lighting';

function makePart(overrides: Partial<FurniturePart> = {}): FurniturePart {
  return {
    id: 'p1',
    name: 'Body',
    shape: 'box',
    xMm: 0,
    yMm: 0,
    zMm: 0,
    widthMm: 1000,
    depthMm: 600,
    heightMm: 750,
    rotationDeg: 0,
    color: '#D6D3D1',
    material: 'wood',
    ...overrides,
  };
}

function makeFurn(overrides: Partial<FurnitureInstance> = {}): FurnitureInstance {
  return {
    id: 'furn_1',
    templateId: 'desk_oak',
    name: 'Desk',
    category: 'Tables & Desks',
    xMm: 2000,
    yMm: 2000,
    elevationMm: 0,
    rotationDeg: 0,
    rotationXDeg: 0,
    rotationYDeg: 0,
    mirroredX: false,
    mirroredY: false,
    lockProportions: false,
    parts: [makePart()],
    visible: true,
    locked: false,
    ...overrides,
  };
}

test('Multiple independent lights per furniture maintain separate properties and types', () => {
  const desk = makeFurn();
  const pt = createDefaultLightSource('point', {
    id: 'l_pt',
    name: 'Warm Accent',
    colorMode: 'kelvin',
    colorTempK: 2700,
    intensity: 1.4,
    xMm: -350,
    yMm: 100,
    zMm: 820,
  }, desk);
  const spot = createDefaultLightSource('spot', {
    id: 'l_sp',
    name: 'Task Spot',
    colorMode: 'hex',
    colorHex: '#60A5FA',
    intensity: 2.1,
    coneAngleDeg: 36,
    penumbra: 0.45,
    aimAzimuthDeg: 90,
    aimElevationDeg: -60,
    castShadow: true,
  }, desk);
  const linear = createDefaultLightSource('linear', {
    id: 'l_lin',
    name: 'Under-desk LED',
    colorMode: 'hex',
    colorHex: '#FF8C42',
    widthMm: 900,
    lengthMm: 35,
    intensity: 1.6,
  }, desk);
  const area = createDefaultLightSource('area', {
    id: 'l_ar',
    name: 'Diffuser Panel',
    widthMm: 450,
    lengthMm: 300,
    intensity: 1.1,
  }, desk);

  const configured = makeFurn({ lights: [pt, spot, linear, area] });
  const effective = resolveEffectiveFurnitureLights(configured);
  assert.equal(effective.length, 4);
  assert.equal(resolveLightSourceHex(effective[1]), '#60A5FA');
  assert.equal(resolveLightSourceHex(effective[2]), '#FF8C42');
  assert.notEqual(resolveLightSourceHex(effective[0]), resolveLightSourceHex(effective[1]));

  const tiltGroup = new THREE.Group();
  const builtHw = buildThreeLightsForFurniture(configured, tiltGroup, {
    nightMix: 1,
    isSoftwareGl: false,
  });
  assert.equal(builtHw.length, 4);
  assert.ok(builtHw[0].light instanceof THREE.PointLight);
  assert.ok(builtHw[1].light instanceof THREE.SpotLight);
  assert.ok(builtHw[2].light instanceof THREE.RectAreaLight);
  assert.ok(builtHw[3].light instanceof THREE.RectAreaLight);

  // Software GL falls back RectAreaLight cleanly without dropping light output
  const swTiltGroup = new THREE.Group();
  const builtSw = buildThreeLightsForFurniture(configured, swTiltGroup, {
    nightMix: 1,
    isSoftwareGl: true,
  });
  assert.ok(builtSw.length >= 4);
  assert.ok(builtSw.every((entry) => !(entry.light instanceof THREE.RectAreaLight)));
});

test('Legacy Lighting category derives default light until explicitly overridden or emptied', () => {
  const legacyLamp = makeFurn({
    id: 'lamp_1',
    templateId: 'light_pendant',
    category: 'Lighting',
    lightConfig: { enabled: true, colorTempK: 2800, intensity: 0.9 },
  });
  const derived = resolveEffectiveFurnitureLights(legacyLamp);
  assert.equal(derived.length, 1);
  assert.equal(derived[0].type, 'spot');
  assert.equal(derived[0].colorTempK, 2800);

  const silencedLamp = makeFurn({ ...legacyLamp, lights: [] });
  assert.equal(resolveEffectiveFurnitureLights(silencedLamp).length, 0);
});

test('Procedural emissive parts glow independently without requiring real light sources', () => {
  const glassPart = makePart({
    id: 'ring_1',
    name: 'Glowing Glass Strip',
    material: 'glass',
    color: '#FF8C42',
    emissiveEnabled: true,
    emissiveColor: '#FF6B1A',
    emissiveIntensity: 1.8,
    bloomBoost: 1.4,
  });
  const framePart = makePart({ id: 'frame', name: 'Frame' });
  const shelf = makeFurn({
    category: 'Storage & Media',
    lights: [], // Zero real illumination lights
    parts: [framePart, glassPart],
  });

  const frameMat = new THREE.MeshStandardMaterial({ color: framePart.color });
  const glassMat = new THREE.MeshStandardMaterial({ color: glassPart.color });
  const ctx = {
    isLightingCategory: false,
    hasAnyActiveLampLight: false,
    fallbackLightColor: kelvinToThreeColor(3200),
    primaryLightIntensity: 0,
    nightMix: 1,
  };

  assert.equal(applyProceduralPartEmissive(frameMat, framePart, ctx), null);
  const emEntry = applyProceduralPartEmissive(glassMat, glassPart, ctx);
  assert.ok(emEntry, 'Manual emissive part registers for glow/bloom');
  assert.equal(emEntry.alwaysVisible, true);
  assert.equal(emEntry.mat.emissive.getHexString(), 'ff6b1a');
  assert.ok(emEntry.mat.emissiveIntensity > 2.0);

  const realLights = buildThreeLightsForFurniture(shelf, new THREE.Group(), { nightMix: 1 });
  assert.equal(realLights.length, 0, 'Emissive surface does not force a real light source');

  // One-click Add Matching Light pairs a matching real light centered on the part
  const matchedLight = createMatchingLightForPart(glassPart, shelf);
  assert.equal(matchedLight.colorMode, 'hex');
  assert.equal(matchedLight.colorHex, '#FF6B1A');
  assert.equal(matchedLight.sourceRef, glassPart.id);
});

test('GLB material inspection detects disabled emissives, applies non-destructive overrides, and pairs matching illumination (VARMBLIXT scenario)', () => {
  // Build synthetic VARMBLIXT-like GLB: black housing + orange torus ring with disabled emissive map
  const glbRoot = new THREE.Group();
  const housingMat = new THREE.MeshStandardMaterial({
    name: 'Backplate_Black',
    color: new THREE.Color('#1F2937'),
    roughness: 0.5,
  });
  const housingMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.04), housingMat);
  housingMesh.name = 'Housing_Mesh';

  const dummyDataTex = new THREE.DataTexture(new Uint8Array([255, 140, 60, 255]), 1, 1);
  dummyDataTex.needsUpdate = true;
  const ringMat = new THREE.MeshStandardMaterial({
    name: 'Varmblixt_Orange_Glass',
    color: new THREE.Color('#FF7A29'),
    emissive: new THREE.Color('#000000'), // Disabled in source GLB!
    emissiveIntensity: 0,
    emissiveMap: dummyDataTex,
  });
  const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 12, 24), ringMat);
  ringMesh.name = 'Glass_Ring_Mesh';
  ringMesh.position.set(0, 0.08, 0.05);

  glbRoot.add(housingMesh, ringMesh);

  const inspected = inspectGlbMaterials(
    glbRoot,
    { widthMm: 300, depthMm: 120, heightMm: 300 },
    { mountingType: 'wall', mountingFace: 'back' }
  );

  assert.equal(inspected.length, 2);
  const ringInfo = inspected.find((m) => m.materialName === 'Varmblixt_Orange_Glass')!;
  const frameInfo = inspected.find((m) => m.materialName === 'Backplate_Black')!;
  assert.ok(ringInfo);
  assert.ok(frameInfo);
  assert.equal(ringInfo.hasEmissiveMap, true);
  assert.equal(ringInfo.emissiveDetected, true);
  assert.equal(ringInfo.emissiveDisabled, true);
  assert.equal(frameInfo.emissiveDetected, false);

  // Clone model and enable orange glow override + pair matching light
  const runtimeClone = glbRoot.clone(true);
  const override = {
    materialKey: ringInfo.materialKey,
    materialName: ringInfo.materialName,
    meshNames: ringInfo.meshNames,
    enabled: true,
    emissiveColor: '#FF6E1A',
    emissiveIntensity: 1.6,
    bloomBoost: 1.35,
    preserveEmissiveMap: true,
  };
  const emissiveTargets = applyGlbEmissiveOverrides(runtimeClone, [override], 1.0);
  assert.equal(emissiveTargets.length, 1);
  assert.equal(emissiveTargets[0].alwaysVisible, true);
  assert.equal(emissiveTargets[0].mat.emissive.getHexString(), 'ff6e1a');
  assert.ok(emissiveTargets[0].mat.emissiveIntensity > 2.0);
  assert.ok(emissiveTargets[0].mat.emissiveMap, 'Preserved embedded emissive map');

  // Original cached GLB material must remain completely unmutated!
  assert.equal(ringMat.emissive.getHexString(), '000000');
  assert.equal(ringMat.emissiveIntensity, 0);

  // Pair matching light -> orange point light positioned at ring local center
  const matched = createMatchingLightForGlbMaterial(ringInfo, override);
  assert.equal(matched.colorHex, '#FF6E1A');
  assert.equal(matched.xMm, ringInfo.localCenterMm.xMm);
  assert.equal(matched.yMm, ringInfo.localCenterMm.yMm);
  assert.equal(matched.zMm, Math.max(10, ringInfo.localCenterMm.zMm));

  const varmblixtFurn = makeFurn({
    templateId: 'glb_varmblixt',
    mountingType: 'wall',
    mountingFace: 'back',
    glbAssetId: 'glb_test_varmblixt',
    glbEmissiveOverrides: [override],
    lights: [matched],
  });
  const tiltGroup = new THREE.Group();
  const realLights = buildThreeLightsForFurniture(varmblixtFurn, tiltGroup, { nightMix: 1 });
  assert.equal(realLights.length, 1);
  assert.equal(realLights[0].light.color.getHexString(), 'ff6e1a');
});

test('Transformations (mirroring, resizing, aim) and shadow budget preserve light integrity', () => {
  const lightA = createDefaultLightSource('spot', {
    id: 'la',
    xMm: 200,
    yMm: -100,
    zMm: 500,
    aimAzimuthDeg: 45,
    aimElevationDeg: -45,
    widthMm: 600,
    lengthMm: 100,
    castShadow: true,
  });

  // Resize scaling
  const scaled = scaleFurnitureLightSources([lightA], 2, 0.5, 1.5)!;
  assert.equal(scaled[0].xMm, 400);
  assert.equal(scaled[0].yMm, -50);
  assert.equal(scaled[0].zMm, 750);
  assert.equal(scaled[0].widthMm, 1200);
  assert.equal(scaled[0].lengthMm, 50);

  // Mirroring folds into aim direction and position while keeping tiltGroup scale positive
  const mirroredAim = computeAimDirectionVectorThree(90, 0, true, false);
  assert.ok(mirroredAim.x < -0.99, 'Mirror X flips +90° right aim to -X');

  const mirroredFurn = makeFurn({
    mirroredX: true,
    mirroredY: true,
    lights: [lightA],
  });
  const tiltGroup = new THREE.Group();
  const builtMirrored = buildThreeLightsForFurniture(mirroredFurn, tiltGroup, { nightMix: 0.5 });
  assert.ok(Math.abs(builtMirrored[0].light.position.x - -0.2) < 1e-5);
  assert.ok(Math.abs(builtMirrored[0].light.position.z - 0.1) < 1e-5);

  // Shadow budget caps interior casters at 3 while prioritizing userCastShadow
  const manyLights = Array.from({ length: 6 }, (_, i) =>
    createDefaultLightSource('point', {
      id: `m_${i}`,
      intensity: 1 + i * 0.2,
      castShadow: i >= 2, // 4 lights request shadows -> top 3 should get castShadow=true
    })
  );
  const fMany = makeFurn({ lights: manyLights });
  const budgetGroup = new THREE.Group();
  const entries = buildThreeLightsForFurniture(fMany, budgetGroup, { nightMix: 1 });
  const assignedCount = assignInteriorShadowBudget(entries, true, 3);
  assert.equal(assignedCount, 3);
  assert.equal(entries.filter((e) => e.light.castShadow).length, 3);
  assert.equal(entries[0].light.castShadow, false);
  assert.equal(entries[5].light.castShadow, true);

  // Fresh IDs on clone/duplicate
  const cloned = cloneLightsWithFreshIds([lightA])!;
  assert.notEqual(cloned[0].id, lightA.id);
});

test('Light sources and GLB emissive overrides survive JSON save/reopen serialization', () => {
  const light = createDefaultLightSource('linear', {
    id: 'l_ser',
    name: 'Warm Strip',
    colorMode: 'hex',
    colorHex: '#FF9944',
    intensity: 1.75,
    widthMm: 1100,
    lengthMm: 40,
  });
  const proj: Pick<Project, 'id' | 'levels'> = {
    id: 'proj_ser',
    levels: [
      {
        id: 'lvl1',
        name: 'Floor 1',
        elevationMm: 0,
        ceilingHeightMm: 2800,
        walls: [],
        rooms: [],
        openings: [],
        curtains: [],
        furniture: [
          makeFurn({
            lights: [light],
            glbEmissiveOverrides: [
              {
                materialKey: 'mat_0_Glass',
                materialName: 'Glass',
                meshNames: ['Shade'],
                enabled: true,
                emissiveColor: '#FF9944',
                emissiveIntensity: 2.0,
                bloomBoost: 1.3,
              },
            ],
          }),
        ],
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
          curtains: true,
          furniture: true,
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

  const rawJson = JSON.stringify(proj);
  const restored = JSON.parse(rawJson) as typeof proj;
  const f = restored.levels[0].furniture[0];
  assert.equal(f.lights?.length, 1);
  assert.equal(f.lights?.[0].type, 'linear');
  assert.equal(f.lights?.[0].colorHex, '#FF9944');
  assert.equal(f.lights?.[0].widthMm, 1100);
  assert.equal(f.glbEmissiveOverrides?.[0].enabled, true);
  assert.equal(f.glbEmissiveOverrides?.[0].emissiveIntensity, 2.0);
});
