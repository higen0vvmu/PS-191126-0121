import * as THREE from 'three';
import type { ArchElement, RailingConfig, RailingPathNode } from '../types/plan';
import {
  ArchitecturalMaterialOptions,
  applyWorldSpaceUVs,
  buildArchitecturalMaterial,
} from './textures3d';
import {
  computeRailingPathMetrics,
  computeStaircaseGeometrySpec,
  getRailingStyleMeta,
  resolveHostDeckRailings,
  resolveHostStairRailings,
} from './railings';

export interface RailingMaterialPalette {
  frameMat: THREE.Material;
  railMat: THREE.Material;
  hardwareMat: THREE.Material;
  infillMat: THREE.Material;
  glassMat: THREE.Material;
}

const GLASS_TINT_HEX: Record<RailingConfig['glassTint'], string> = {
  clear: '#DCEEF8',
  low_iron: '#ECFEFF',
  bronze: '#D6B89C',
  smoke: '#64748B',
};

const GLASS_TINT_OPACITY: Record<RailingConfig['glassTint'], number> = {
  clear: 0.24,
  low_iron: 0.19,
  bronze: 0.34,
  smoke: 0.38,
};

export function createRailingMaterialPalette(
  cfg: RailingConfig,
  primaryColor: string,
  matOpts?: ArchitecturalMaterialOptions,
  clippingPlanes?: THREE.Plane[]
): RailingMaterialPalette {
  const frameMat = buildArchitecturalMaterial(cfg.material, primaryColor, matOpts);

  const hasCustomHandrail =
    Boolean(cfg.handrailMaterial && cfg.handrailMaterial !== cfg.material) ||
    Boolean(cfg.handrailColor && cfg.handrailColor !== primaryColor);
  const railMat = hasCustomHandrail
    ? buildArchitecturalMaterial(
        cfg.handrailMaterial ?? cfg.material,
        cfg.handrailColor ?? primaryColor,
        matOpts
      )
    : frameMat;

  const hardwareMat = buildArchitecturalMaterial('chrome', cfg.accentColor || '#94A3B8', matOpts);
  const infillMat = buildArchitecturalMaterial(
    cfg.secondaryMaterial ?? 'wood',
    cfg.secondaryColor || '#CBD5E1',
    matOpts
  );

  const reflTier = matOpts?.reflectionQuality ?? 'high';
  const transpHigh = (matOpts?.transparentQuality ?? 'high') === 'high';
  const reflScale =
    reflTier === 'off' ? 0.08 : reflTier === 'low' ? 0.35 : reflTier === 'medium' ? 0.72 : 1.05;

  const tintHex = GLASS_TINT_HEX[cfg.glassTint] ?? '#DCEEF8';
  const glassOpacity = GLASS_TINT_OPACITY[cfg.glassTint] ?? 0.24;

  const glassMat =
    transpHigh && matOpts?.materialQuality !== 'standard'
      ? new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(tintHex),
          transparent: true,
          opacity: glassOpacity,
          roughness: 0.06,
          metalness: 0.05,
          clearcoat: 0.9 * reflScale,
          clearcoatRoughness: 0.06,
          reflectivity: 0.9,
          envMapIntensity: 0.85 * reflScale,
          side: THREE.DoubleSide,
          depthWrite: false,
          clippingPlanes,
        })
      : new THREE.MeshStandardMaterial({
          color: new THREE.Color(tintHex),
          transparent: true,
          opacity: glassOpacity,
          roughness: 0.14,
          metalness: 0.08,
          envMapIntensity: 0.55 * reflScale,
          side: THREE.DoubleSide,
          depthWrite: false,
          clippingPlanes,
        });

  return { frameMat, railMat, hardwareMat, infillMat, glassMat };
}

/**
 * Builds a closed, beveled-normal 3D sloped parallelogram slab between p0 and p1
 * with vertical bottom/top offsets above deck (so glass & solid infill panels follow stair slopes).
 */
function createSlopedPanelGeometry(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  yBotOffset: number,
  yTopOffset: number,
  thicknessM: number,
  rightVec: THREE.Vector3
): THREE.BufferGeometry {
  const halfT = thicknessM / 2;
  const off = rightVec.clone().multiplyScalar(halfT);

  const b0 = new THREE.Vector3(p0.x, p0.y + yBotOffset, p0.z);
  const b1 = new THREE.Vector3(p1.x, p1.y + yBotOffset, p1.z);
  const t1 = new THREE.Vector3(p1.x, p1.y + yTopOffset, p1.z);
  const t0 = new THREE.Vector3(p0.x, p0.y + yTopOffset, p0.z);

  const f0 = b0.clone().add(off);
  const f1 = b1.clone().add(off);
  const f2 = t1.clone().add(off);
  const f3 = t0.clone().add(off);

  const k0 = b0.clone().sub(off);
  const k1 = b1.clone().sub(off);
  const k2 = t1.clone().sub(off);
  const k3 = t0.clone().sub(off);

  const positions: number[] = [];
  const pushQuad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    positions.push(
      a.x, a.y, a.z,
      b.x, b.y, b.z,
      c.x, c.y, c.z,
      a.x, a.y, a.z,
      c.x, c.y, c.z,
      d.x, d.y, d.z
    );
  };

  pushQuad(f0, f1, f2, f3); // front
  pushQuad(k1, k0, k3, k2); // back
  pushQuad(f3, f2, k2, k3); // top
  pushQuad(k0, k1, f1, f0); // bottom
  pushQuad(k0, f0, f3, k3); // left edge
  pushQuad(f1, k1, k2, f2); // right edge

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeSegmentBasisQuaternion(pA: THREE.Vector3, pB: THREE.Vector3): {
  dir: THREE.Vector3;
  right: THREE.Vector3;
  upSeg: THREE.Vector3;
  quat: THREE.Quaternion;
  segLen3d: number;
  hLen: number;
} {
  const dx = pB.x - pA.x;
  const dy = pB.y - pA.y;
  const dz = pB.z - pA.z;
  const hLen = Math.hypot(dx, dz);
  const segLen3d = Math.hypot(hLen, dy);
  const dir = new THREE.Vector3(dx, dy, dz);
  if (segLen3d > 1e-5) dir.divideScalar(segLen3d);
  else dir.set(0, 0, 1);

  const right =
    hLen > 1e-5 ? new THREE.Vector3(-dz / hLen, 0, dx / hLen) : new THREE.Vector3(1, 0, 0);
  const upSeg = new THREE.Vector3().crossVectors(dir, right).normalize();
  if (upSeg.y < 0) {
    upSeg.negate();
    right.negate();
  }
  const basisMat = new THREE.Matrix4().makeBasis(right, upSeg, dir);
  const quat = new THREE.Quaternion().setFromRotationMatrix(basisMat);
  return { dir, right, upSeg, quat, segLen3d, hLen };
}

function createPostMesh(
  cfg: RailingConfig,
  pos: THREE.Vector3,
  heightM: number,
  isEndPost: boolean,
  segRight: THREE.Vector3,
  palette: RailingMaterialPalette,
  castShadows: boolean
): THREE.Group {
  const g = new THREE.Group();
  const postS = (isEndPost && cfg.endPostSizeMm ? cfg.endPostSizeMm : cfg.postSizeMm) / 1000;
  const yaw = Math.atan2(segRight.z, segRight.x);

  // Handrail-only stanchion / wall bracket
  if (cfg.style === 'handrail_only') {
    if (cfg.mountingMethod === 'wall_bracket') {
      const bracketArm = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.014, 0.014),
        palette.hardwareMat
      );
      bracketArm.position.set(0, heightM - 0.032, 0);
      const wallPlate = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.026, 0.008, 12),
        palette.hardwareMat
      );
      wallPlate.rotation.z = Math.PI / 2;
      wallPlate.position.set(0.028, heightM - 0.032, 0);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.032, 8),
        palette.hardwareMat
      );
      stem.position.set(0, heightM - 0.016, 0);
      g.add(bracketArm, wallPlate, stem);
      g.position.copy(pos);
      g.rotation.y = -yaw;
      return g;
    }
    const stanchion = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.014, heightM, 10),
      palette.frameMat
    );
    stanchion.position.y = heightM / 2;
    stanchion.castShadow = castShadows;
    const basePlate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.034, 0.01, 12),
      palette.hardwareMat
    );
    basePlate.position.y = 0.005;
    g.add(stanchion, basePlate);
    g.position.copy(pos);
    return g;
  }

  // Structural Post
  const fasciaDrop = cfg.mountingMethod === 'side_fascia' ? 0.13 : 0;
  const totalPostH = heightM + fasciaDrop;
  let postGeo: THREE.BufferGeometry;
  if (cfg.postShape === 'round') {
    postGeo = new THREE.CylinderGeometry(postS / 2, postS / 2, totalPostH, 14);
  } else if (cfg.postShape === 'flat') {
    postGeo = new THREE.BoxGeometry(postS * 0.42, totalPostH, postS);
  } else {
    postGeo = new THREE.BoxGeometry(postS, totalPostH, postS);
  }
  const postMesh = new THREE.Mesh(postGeo, palette.frameMat);
  postMesh.position.y = heightM / 2 - fasciaDrop / 2;
  postMesh.castShadow = castShadows;
  postMesh.receiveShadow = castShadows;
  g.add(postMesh);

  // Decorative finial cap on traditional newel / end posts
  if (cfg.style === 'traditional_balusters' && isEndPost) {
    const neck = new THREE.Mesh(
      new THREE.BoxGeometry(postS * 1.24, 0.022, postS * 1.24),
      palette.railMat
    );
    neck.position.y = heightM + 0.011;
    const finial = new THREE.Mesh(
      new THREE.SphereGeometry(postS * 0.45, 12, 10),
      palette.railMat
    );
    finial.position.y = heightM + 0.022 + postS * 0.38;
    g.add(neck, finial);
  } else {
    const capGeo =
      cfg.postShape === 'round'
        ? new THREE.CylinderGeometry(postS * 0.56, postS * 0.56, 0.01, 14)
        : new THREE.BoxGeometry(
            (cfg.postShape === 'flat' ? postS * 0.42 : postS) * 1.12,
            0.01,
            postS * 1.12
          );
    const cap = new THREE.Mesh(capGeo, palette.hardwareMat);
    cap.position.y = heightM + 0.005;
    g.add(cap);
  }

  // Mounting Method Hardware
  if (cfg.mountingMethod === 'top_mount') {
    const plateW = Math.max(postS * 1.85, 0.08);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(plateW, 0.01, plateW),
      palette.hardwareMat
    );
    plate.position.y = 0.005;
    plate.receiveShadow = castShadows;
    g.add(plate);
  } else if (cfg.mountingMethod === 'side_fascia') {
    const sidePlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.14, Math.max(postS * 1.5, 0.07)),
      palette.hardwareMat
    );
    sidePlate.position.set(postS * 0.6, -0.06, 0);
    g.add(sidePlate);
  } else if (cfg.mountingMethod === 'embedded') {
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(postS * 0.72, postS * 0.76, 0.02, 12),
      palette.hardwareMat
    );
    collar.position.y = 0.01;
    g.add(collar);
  }

  g.position.copy(pos);
  if (cfg.postShape === 'flat' || cfg.mountingMethod === 'side_fascia') {
    g.rotation.y = -yaw;
  }
  return g;
}

export function buildRailing3DGroup(
  cfg: RailingConfig,
  primaryColor: string,
  matOpts?: ArchitecturalMaterialOptions,
  castShadows = true,
  clippingPlanes?: THREE.Plane[]
): THREE.Group {
  const group = new THREE.Group();
  group.name = `Railing_${cfg.style}`;

  const metrics = computeRailingPathMetrics(cfg);
  if (metrics.segments.length === 0) return group;

  const palette = createRailingMaterialPalette(cfg, primaryColor, matOpts, clippingPlanes);

  const heightM = cfg.heightMm / 1000;
  const hrW = cfg.handrailWidthMm / 1000;
  const hrT = cfg.handrailThicknessMm / 1000;
  const postS = cfg.postSizeMm / 1000;
  const endPostS = (cfg.endPostSizeMm ?? cfg.postSizeMm) / 1000;
  const balS = cfg.balusterSizeMm / 1000;
  const panelT = cfg.panelThicknessMm / 1000;
  const bottomRailH = cfg.bottomRailHeightMm / 1000;

  const toVec = (n: RailingPathNode) =>
    new THREE.Vector3(n.xMm / 1000, (n.elevationMm ?? 0) / 1000, n.yMm / 1000);

  // Track placed node posts to avoid double-rendering shared corners
  const renderedPostKeys = new Set<string>();
  const postKey = (v: THREE.Vector3) =>
    `${Math.round(v.x * 1000)}_${Math.round(v.y * 1000)}_${Math.round(v.z * 1000)}`;

  const showFramelessTopCap = cfg.style === 'frameless_glass' && cfg.handrailThicknessMm >= 16;

  metrics.segments.forEach((seg, segIdx) => {
    const pA = toVec(seg.start);
    const pB = toVec(seg.end);
    const { dir, right, quat, segLen3d } = makeSegmentBasisQuaternion(pA, pB);
    if (segLen3d < 0.02) return;

    const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);

    // 1. Handrail (all styles, slim cap U-channel on frameless glass)
    if (cfg.style !== 'frameless_glass' || showFramelessTopCap) {
      let hrGeo: THREE.BufferGeometry;
      if (cfg.handrailShape === 'round') {
        hrGeo = new THREE.CylinderGeometry(hrW / 2, hrW / 2, segLen3d, 14);
        hrGeo.rotateX(Math.PI / 2);
      } else if (cfg.handrailShape === 'oval') {
        hrGeo = new THREE.CylinderGeometry(hrW / 2, hrW / 2, segLen3d, 14);
        hrGeo.rotateX(Math.PI / 2);
        hrGeo.scale(1, hrT / Math.max(0.01, hrW), 1);
      } else if (cfg.handrailShape === 'square') {
        hrGeo = new THREE.BoxGeometry(hrW, hrW, segLen3d);
      } else {
        hrGeo = new THREE.BoxGeometry(hrW, hrT, segLen3d);
      }
      applyWorldSpaceUVs(hrGeo, 1.0, segIdx * 7 + 3, true);
      const hrMesh = new THREE.Mesh(hrGeo, palette.railMat);
      hrMesh.position.set(mid.x, mid.y + heightM - hrT * 0.5, mid.z);
      hrMesh.quaternion.copy(quat);
      hrMesh.castShadow = castShadows;
      hrMesh.receiveShadow = castShadows;
      group.add(hrMesh);
    }

    // Continuous elbow / miter cap at segment endpoints so sloped/angled corners join cleanly
    if (cfg.style !== 'frameless_glass' || showFramelessTopCap) {
      for (const endP of [pA, pB]) {
        const jGeo =
          cfg.handrailShape === 'round' || cfg.handrailShape === 'oval'
            ? new THREE.SphereGeometry(hrW * 0.52, 12, 10)
            : new THREE.BoxGeometry(hrW * 1.02, hrT * 1.02, hrW * 1.02);
        if (cfg.handrailShape === 'oval') {
          jGeo.scale(1, hrT / Math.max(0.01, hrW), 1);
        }
        const jMesh = new THREE.Mesh(jGeo, palette.railMat);
        jMesh.position.set(endP.x, endP.y + heightM - hrT * 0.5, endP.z);
        jMesh.castShadow = castShadows;
        group.add(jMesh);
      }
    }

    // 2. Bottom Rail (optional, or standard on traditional / solid_panel / modern_minimalist)
    const drawBottomRail =
      cfg.style === 'frameless_glass'
        ? cfg.mountingMethod === 'embedded'
        : cfg.bottomRailEnabled && cfg.style !== 'handrail_only';

    if (drawBottomRail) {
      const bW = cfg.style === 'frameless_glass' ? panelT + 0.032 : Math.max(0.026, postS * 0.65);
      const bH = cfg.style === 'frameless_glass' ? 0.085 : 0.032;
      const bCenterY = cfg.style === 'frameless_glass' ? 0.042 : Math.max(0.025, bottomRailH);
      const brGeo = new THREE.BoxGeometry(bW, bH, segLen3d);
      applyWorldSpaceUVs(brGeo, 1.0, segIdx * 11 + 5, true);
      const brMesh = new THREE.Mesh(
        brGeo,
        cfg.style === 'frameless_glass' ? palette.hardwareMat : palette.frameMat
      );
      brMesh.position.set(mid.x, mid.y + bCenterY, mid.z);
      brMesh.quaternion.copy(quat);
      brMesh.castShadow = castShadows;
      brMesh.receiveShadow = castShadows;
      group.add(brMesh);
    }

    // 3. Posts along segment
    const postPositions: Array<{ pos: THREE.Vector3; isEnd: boolean }> = [];
    seg.postTs.forEach((t, idx) => {
      const p = new THREE.Vector3().lerpVectors(pA, pB, t);
      const isGlobalEnd =
        !cfg.closed &&
        ((segIdx === 0 && idx === 0) ||
          (segIdx === metrics.segments.length - 1 && idx === seg.postTs.length - 1));
      postPositions.push({ pos: p, isEnd: isGlobalEnd });

      if (cfg.style !== 'frameless_glass') {
        const pk = postKey(p);
        if (!renderedPostKeys.has(pk)) {
          renderedPostKeys.add(pk);
          const postGrp = createPostMesh(
            cfg,
            p,
            heightM - (cfg.style === 'traditional_balusters' ? 0 : hrT * 0.5),
            isGlobalEnd,
            right,
            palette,
            castShadows
          );
          group.add(postGrp);
        }
      }
    });

    // 4. Infill per Post Span (respects slopes cleanly!)
    for (let sIdx = 0; sIdx < postPositions.length - 1; sIdx++) {
      const spanA = postPositions[sIdx].pos;
      const spanB = postPositions[sIdx + 1].pos;
      const spanVec = new THREE.Vector3().subVectors(spanB, spanA);
      const spanLen3d = spanVec.length();
      if (spanLen3d < 0.06) continue;

      const postInsetA =
        cfg.style === 'frameless_glass'
          ? 0.008
          : (postPositions[sIdx].isEnd ? endPostS : postS) * 0.5 + 0.008;
      const postInsetB =
        cfg.style === 'frameless_glass'
          ? 0.008
          : (postPositions[sIdx + 1].isEnd ? endPostS : postS) * 0.5 + 0.008;

      const usableLen = spanLen3d - postInsetA - postInsetB;
      if (usableLen < 0.04) continue;

      const p0 = spanA.clone().addScaledVector(dir, postInsetA);
      const p1 = spanB.clone().addScaledVector(dir, -postInsetB);
      const spanMid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);

      if (cfg.style === 'glass_panel' || cfg.style === 'frameless_glass') {
        const yBot =
          cfg.style === 'frameless_glass'
            ? cfg.mountingMethod === 'embedded'
              ? 0.055
              : 0.045
            : cfg.bottomRailEnabled
              ? Math.max(0.055, bottomRailH + 0.018)
              : 0.06;
        const yTop =
          cfg.style === 'frameless_glass'
            ? heightM - (showFramelessTopCap ? hrT * 0.7 : 0.004)
            : heightM - hrT - 0.025;

        if (yTop > yBot + 0.08) {
          const panelGeo = createSlopedPanelGeometry(p0, p1, yBot, yTop, panelT, right);
          const panelMesh = new THREE.Mesh(panelGeo, palette.glassMat);
          panelMesh.castShadow = false;
          panelMesh.receiveShadow = false;
          panelMesh.renderOrder = 2;
          group.add(panelMesh);
        }

        // Glass clamps or frameless floor spigots
        if (cfg.style === 'glass_panel') {
          for (const clampY of [yBot + 0.07, yTop - 0.07]) {
            for (const endEdge of [p0, p1]) {
              const clamp = new THREE.Mesh(
                new THREE.BoxGeometry(panelT + 0.024, 0.042, 0.046),
                palette.hardwareMat
              );
              clamp.position.set(endEdge.x, endEdge.y + clampY, endEdge.z);
              clamp.quaternion.copy(quat);
              group.add(clamp);
            }
          }
        } else if (cfg.mountingMethod !== 'embedded') {
          // Stainless floor spigots on frameless glass
          const spanLenH = p0.distanceTo(p1);
          const spigotTs = spanLenH > 0.75 ? [0.22, 0.78] : [0.5];
          for (const st of spigotTs) {
            const spPos = new THREE.Vector3().lerpVectors(p0, p1, st);
            const spigot = new THREE.Mesh(
              new THREE.BoxGeometry(panelT + 0.03, 0.14, 0.048),
              palette.hardwareMat
            );
            spigot.position.set(spPos.x, spPos.y + 0.07, spPos.z);
            spigot.quaternion.copy(quat);
            spigot.castShadow = castShadows;
            const spigotBase = new THREE.Mesh(
              new THREE.BoxGeometry(0.09, 0.012, 0.09),
              palette.hardwareMat
            );
            spigotBase.position.set(spPos.x, spPos.y + 0.006, spPos.z);
            group.add(spigot, spigotBase);
          }
        }
      } else if (cfg.style === 'solid_panel') {
        const yBot = cfg.bottomRailEnabled ? Math.max(0.04, bottomRailH + 0.015) : 0.05;
        const yTop = heightM - hrT - 0.015;
        if (yTop > yBot + 0.08) {
          const panelGeo = createSlopedPanelGeometry(p0, p1, yBot, yTop, panelT, right);
          const panelMesh = new THREE.Mesh(panelGeo, palette.infillMat);
          panelMesh.castShadow = castShadows;
          panelMesh.receiveShadow = castShadows;
          group.add(panelMesh);
        }
      } else if (cfg.style === 'horizontal_metal' || cfg.style === 'cable') {
        const count =
          cfg.style === 'cable'
            ? Math.max(2, cfg.cableCount)
            : Math.max(1, cfg.horizontalRailCount);
        const yStart = cfg.bottomRailEnabled ? Math.max(0.08, bottomRailH + 0.06) : 0.09;
        const yEnd = heightM - hrT - 0.06;
        const barThick = cfg.style === 'cable' ? Math.max(0.004, balS) : Math.max(0.01, balS);
        const barGeo =
          cfg.style === 'cable'
            ? new THREE.CylinderGeometry(barThick / 2, barThick / 2, spanLen3d, 8)
            : new THREE.BoxGeometry(barThick * 1.15, barThick, spanLen3d);
        if (cfg.style === 'cable') barGeo.rotateX(Math.PI / 2);

        for (let r = 0; r < count; r++) {
          const frac = count === 1 ? 0.5 : r / (count - 1);
          const ry = yStart + (yEnd - yStart) * frac;
          const bar = new THREE.Mesh(
            barGeo,
            cfg.style === 'cable' ? palette.hardwareMat : palette.infillMat
          );
          bar.position.set(spanMid.x, spanMid.y + ry, spanMid.z);
          bar.quaternion.copy(quat);
          bar.castShadow = castShadows && cfg.style !== 'cable';
          group.add(bar);
        }

        // Cable mid-span stabilizer bar on wide spans
        if (cfg.style === 'cable' && usableLen > 1.05) {
          const stab = new THREE.Mesh(
            new THREE.BoxGeometry(0.01, yEnd - yStart + 0.04, 0.01),
            palette.hardwareMat
          );
          stab.position.set(spanMid.x, spanMid.y + (yStart + yEnd) / 2, spanMid.z);
          group.add(stab);
        }
      }
    }

    // 5. Vertical Plumb Pickets (Traditional Balusters & Modern Minimalist)
    if (cfg.style === 'traditional_balusters' || cfg.style === 'modern_minimalist') {
      const yBot = cfg.bottomRailEnabled ? Math.max(0.025, bottomRailH) : 0.02;
      const topClear = hrT * 0.55;
      const picketH = Math.max(0.1, heightM - topClear - yBot);

      const picketGeo =
        cfg.style === 'modern_minimalist'
          ? new THREE.BoxGeometry(balS * 0.55, picketH, balS * 1.35)
          : new THREE.BoxGeometry(balS, picketH, balS);

      for (const bt of seg.balusterTs) {
        const bp = new THREE.Vector3().lerpVectors(pA, pB, bt);
        const picket = new THREE.Mesh(picketGeo, palette.infillMat);
        picket.position.set(bp.x, bp.y + yBot + picketH / 2, bp.z);
        if (cfg.style === 'modern_minimalist') {
          picket.rotation.y = -Math.atan2(right.z, right.x);
        }
        picket.castShadow = castShadows;
        picket.receiveShadow = castShadows;
        group.add(picket);

        // Traditional baluster decorative collar knuckle
        if (cfg.style === 'traditional_balusters') {
          const knuckle = new THREE.Mesh(
            new THREE.BoxGeometry(balS * 1.45, 0.026, balS * 1.45),
            palette.hardwareMat
          );
          knuckle.position.set(bp.x, bp.y + yBot + picketH * 0.52, bp.z);
          group.add(knuckle);
        }
      }
    }
  });

  return group;
}

export function buildStaircase3DGroup(
  el: ArchElement,
  ceilingHeightMm: number,
  rawH_M: number,
  mat: THREE.Material,
  accentMat: THREE.Material,
  matOpts: ArchitecturalMaterialOptions | undefined,
  castShadows: boolean,
  clippingPlanes?: THREE.Plane[]
): THREE.Group {
  const group = new THREE.Group();
  const effectiveEl: ArchElement = {
    ...el,
    heightMm: Math.round(rawH_M * 1000),
    connectToCeiling: false,
  };
  const spec = computeStaircaseGeometrySpec(effectiveEl, ceilingHeightMm);

  // 1. Central structural column for spiral staircases
  if (el.type === 'stairs_spiral') {
    const outerR = Math.min(el.widthMm, el.depthMm) / 2000;
    const poleR = Math.max(0.055, outerR * 0.14);
    const poleH = Math.max(0.4, rawH_M + 0.95);
    const poleGeo = new THREE.CylinderGeometry(poleR, poleR, poleH, 20);
    applyWorldSpaceUVs(poleGeo, 1.0, 17, false);
    const pole = new THREE.Mesh(poleGeo, accentMat);
    pole.position.y = poleH / 2;
    pole.castShadow = castShadows;
    pole.receiveShadow = castShadows;
    group.add(pole);
  }

  // 2. Render every tread & landing
  spec.steps.forEach((st, idx) => {
    const wM = st.widthMm / 1000;
    const dM = st.depthMm / 1000;
    const riseM = st.riseMm / 1000;
    const treadThick = st.isLanding ? Math.max(0.11, riseM * 0.92) : Math.max(0.045, riseM * 0.88);

    if (
      el.type === 'stairs_spiral' &&
      st.wedgeRadiusMm !== undefined &&
      st.wedgeStartAngleRad !== undefined &&
      st.wedgeSweepRad !== undefined
    ) {
      const rOut = st.wedgeRadiusMm / 1000;
      const rIn = Math.max(0.06, rOut * 0.14);
      const a0 = st.wedgeStartAngleRad;
      const a1 = a0 + st.wedgeSweepRad * 1.04;
      const shape = new THREE.Shape();
      shape.moveTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);
      shape.lineTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut);
      shape.lineTo(Math.cos(a1) * rOut, Math.sin(a1) * rOut);
      shape.lineTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn);
      shape.closePath();

      const wedgeGeo = new THREE.ExtrudeGeometry(shape, {
        depth: treadThick,
        bevelEnabled: false,
      });
      // Map shape (x, y) to plan (x, z) and extrude upward (+Y)
      wedgeGeo.rotateX(Math.PI / 2);
      const wedge = new THREE.Mesh(wedgeGeo, mat);
      wedge.position.y = st.bottomElevMm / 1000 + riseM;
      wedge.castShadow = castShadows;
      wedge.receiveShadow = castShadows;
      group.add(wedge);
    } else {
      const stepGeo = new THREE.BoxGeometry(wM, treadThick, dM);
      applyWorldSpaceUVs(stepGeo, 1.0, idx * 11 + 3, true);
      const stepMesh = new THREE.Mesh(stepGeo, mat);
      stepMesh.position.set(
        st.centerXMm / 1000,
        st.bottomElevMm / 1000 + riseM - treadThick / 2,
        st.centerYMm / 1000
      );
      stepMesh.rotation.y = (-st.rotationDeg * Math.PI) / 180;
      stepMesh.castShadow = castShadows;
      stepMesh.receiveShadow = castShadows;
      group.add(stepMesh);
    }
  });

  // 3. Integrated Sloped & Landing Stair Railings
  const railConfigs = resolveHostStairRailings(effectiveEl, ceilingHeightMm);
  for (const rCfg of railConfigs) {
    const stylePrimary = getRailingStyleMeta(rCfg.style).defaultColor;
    const rGroup = buildRailing3DGroup(
      rCfg,
      stylePrimary,
      matOpts,
      castShadows,
      clippingPlanes
    );
    group.add(rGroup);
  }

  return group;
}

export function buildHostDeckRailings3DGroup(
  el: ArchElement,
  matOpts: ArchitecturalMaterialOptions | undefined,
  castShadows: boolean,
  clippingPlanes?: THREE.Plane[]
): THREE.Group | null {
  const configs = resolveHostDeckRailings(el);
  if (configs.length === 0) return null;
  const group = new THREE.Group();
  for (const cfg of configs) {
    const stylePrimary = getRailingStyleMeta(cfg.style).defaultColor;
    group.add(
      buildRailing3DGroup(
        cfg,
        stylePrimary,
        matOpts,
        castShadows,
        clippingPlanes
      )
    );
  }
  return group;
}
