import {
  ArchElement,
  Level,
  Point2D,
  ProjectSettings,
  Room,
} from '../types/plan';
import {
  findConnectedRoomForBalcony,
  getFurnitureSolidFootprintPrimitives,
  getWallCenterlinePoint,
  isCurtainOrBlindFurniture,
  isRugFurniture,
  pointInPolygon,
  wallOffsets,
} from './geometry';

export const PLAYER_HEIGHT_M = 1.75; // 175 cm physical entity height
export const PLAYER_EYE_HEIGHT_M = 1.63; // Eye level inside 175 cm body (12 cm crown above eyes)
export const PLAYER_RADIUS_M = 0.2; // 40 cm body shoulder diameter (fits cleanly through 70+ cm doors)
export const PLAYER_STEP_HEIGHT_M = 0.28; // Max step-up onto thresholds, platforms, and stair treads
export const WALK_SPEED_MPS = 1.9;
export const SPRINT_SPEED_MPS = 3.5;

export interface XZPoint {
  x: number;
  z: number;
}

export interface WalkCollider {
  id: string;
  poly: XZPoint[];
  minY: number;
  maxY: number;
  walkableTop?: boolean;
  ceilingY?: number;
}

export interface WalkState {
  x: number;
  feetY: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number; // Radians, 0 = looking along -Z
  pitch: number; // Radians, clamped [-82°, +82°]
  grounded: boolean;
}

export interface WalkInput {
  forward: number; // -1..+1
  strafe: number; // -1..+1
  sprint: boolean;
  jump: boolean;
  ascend?: boolean;
  descend?: boolean;
}

function makeOrientedBoxPoly(
  cx: number,
  cz: number,
  halfW: number,
  halfD: number,
  ux: number,
  uz: number
): XZPoint[] {
  // Tangent u = (ux, uz), Normal n = (-uz, ux)
  const nx = -uz;
  const nz = ux;
  return [
    { x: cx - ux * halfW - nx * halfD, z: cz - uz * halfW - nz * halfD },
    { x: cx + ux * halfW - nx * halfD, z: cz + uz * halfW - nz * halfD },
    { x: cx + ux * halfW + nx * halfD, z: cz + uz * halfW + nz * halfD },
    { x: cx - ux * halfW + nx * halfD, z: cz - uz * halfW + nz * halfD },
  ];
}

function makeRotatedRectPoly(
  cx: number,
  cz: number,
  halfW: number,
  halfD: number,
  rotationDeg: number
): XZPoint[] {
  const rad = (rotationDeg * Math.PI) / 180;
  return makeOrientedBoxPoly(cx, cz, halfW, halfD, Math.cos(rad), Math.sin(rad));
}

function pointInXZPoly(x: number, z: number, poly: XZPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pushCircleOutOfPoly(
  cx: number,
  cz: number,
  r: number,
  poly: XZPoint[]
): { x: number; z: number } {
  if (poly.length < 3) return { x: cx, z: cz };

  // Quick AABB reject
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  if (cx < minX - r || cx > maxX + r || cz < minZ - r || cz > maxZ + r) {
    return { x: cx, z: cz };
  }

  let bestDistSq = Infinity;
  let bestQx = cx;
  let bestQz = cz;
  let bestEdgeNx = 0;
  let bestEdgeNz = 0;

  // Determine winding sign so outward normal works regardless of CW/CCW vertex order
  let signedArea = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    signedArea += poly[j].x * poly[i].z - poly[i].x * poly[j].z;
  }
  const windingSign = signedArea >= 0 ? 1 : -1;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const lenSq = ex * ex + ez * ez;
    if (lenSq < 1e-10) continue;

    const t = Math.max(0, Math.min(1, ((cx - a.x) * ex + (cz - a.z) * ez) / lenSq));
    const qx = a.x + ex * t;
    const qz = a.z + ez * t;
    const dx = cx - qx;
    const dz = cz - qz;
    const dSq = dx * dx + dz * dz;

    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestQx = qx;
      bestQz = qz;
      const eLen = Math.sqrt(lenSq);
      // Outward normal in XZ
      bestEdgeNx = (ez / eLen) * windingSign;
      bestEdgeNz = (-ex / eLen) * windingSign;
    }
  }

  const inside = pointInXZPoly(cx, cz, poly);
  if (inside) {
    const d = Math.sqrt(bestDistSq);
    const push = d + r + 0.002;
    const dx = bestQx - cx;
    const dz = bestQz - cz;
    const dLen = Math.hypot(dx, dz);
    if (dLen > 1e-5) {
      return { x: cx + (dx / dLen) * push, z: cz + (dz / dLen) * push };
    }
    return { x: cx + bestEdgeNx * push, z: cz + bestEdgeNz * push };
  }

  if (bestDistSq < r * r) {
    const d = Math.sqrt(bestDistSq);
    const push = r - d + 0.001;
    if (d > 1e-6) {
      return {
        x: cx + ((cx - bestQx) / d) * push,
        z: cz + ((cz - bestQz) / d) * push,
      };
    }
    return {
      x: cx + bestEdgeNx * push,
      z: cz + bestEdgeNz * push,
    };
  }

  return { x: cx, z: cz };
}

export function buildWalkColliders(
  level: Level,
  settings: Pick<ProjectSettings, 'cutawayEnabled' | 'cutawayHeightMm'>
): WalkCollider[] {
  const colliders: WalkCollider[] = [];

  // 1. Walls with carved passable doorway / arch spans + upper lintels + lower sills
  if (level.layers.walls) {
    for (const wall of level.walls) {
      if (!wall.visible) continue;
      const maxH = settings.cutawayEnabled
        ? Math.min(wall.heightMm, settings.cutawayHeightMm)
        : wall.heightMm;
      const wallH = Math.max(150, maxH) / 1000;
      const thick = Math.max(0.04, wall.thicknessMm / 1000);
      const { left, right } = wallOffsets(wall.thicknessMm, wall.alignment);
      const centerOffset = (left + right) / 2000;

      const hostOpenings = level.openings
        .filter((o) => o.wallId === wall.id && o.visible)
        .sort((a, b) => a.t - b.t);

      if (wall.isCurved && Math.abs(wall.curveBulgeMm) >= 1) {
        const steps = 14;
        for (let i = 0; i < steps; i++) {
          const tMid = (i + 0.5) / steps;
          const blockingOpening = hostOpenings.find((op) => {
            const wallApproxLen = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1000;
            const halfT = op.widthMm / 2 / wallApproxLen;
            return tMid >= op.t - halfT && tMid <= op.t + halfT;
          });
          if (
            blockingOpening &&
            (blockingOpening.category === 'arch' ||
              (blockingOpening.category === 'door' &&
                (blockingOpening.subtype === 'doorframe' || blockingOpening.openAngleDeg >= 20))) &&
            blockingOpening.sillHeightMm / 1000 <= PLAYER_STEP_HEIGHT_M
          ) {
            const topY = (blockingOpening.sillHeightMm + blockingOpening.heightMm) / 1000;
            if (topY >= wallH - 0.02) continue;
          }

          const p1 = getWallCenterlinePoint(wall, i / steps).point;
          const p2 = getWallCenterlinePoint(wall, (i + 1) / steps).point;
          const segDx = (p2.x - p1.x) / 1000;
          const segDz = (p2.y - p1.y) / 1000;
          const segLen = Math.hypot(segDx, segDz);
          if (segLen < 0.02) continue;
          const ux = segDx / segLen;
          const uz = segDz / segLen;
          colliders.push({
            id: `wall_${wall.id}_c_${i}`,
            poly: makeOrientedBoxPoly(
              (p1.x + p2.x) / 2000,
              (p1.y + p2.y) / 2000,
              segLen / 2 + 0.01,
              thick / 2,
              ux,
              uz
            ),
            minY: 0,
            maxY: wallH,
          });
        }
        continue;
      }

      const dx = (wall.end.x - wall.start.x) / 1000;
      const dz = (wall.end.y - wall.start.y) / 1000;
      const len = Math.hypot(dx, dz);
      if (len < 0.02) continue;
      const ux = dx / len;
      const uz = dz / len;
      const nx = -uz;
      const nz = ux;
      const sx = wall.start.x / 1000 + nx * centerOffset;
      const sz = wall.start.y / 1000 + nz * centerOffset;

      const emitSegment = (u1: number, u2: number, minY: number, maxY: number, suffix: string) => {
        const segLen = u2 - u1;
        if (segLen < 0.015 || maxY - minY < 0.02) return;
        const uMid = (u1 + u2) / 2;
        colliders.push({
          id: `wall_${wall.id}_${suffix}`,
          poly: makeOrientedBoxPoly(sx + ux * uMid, sz + uz * uMid, segLen / 2, thick / 2, ux, uz),
          minY,
          maxY,
        });
      };

      let cursorU = 0;
      for (const op of hostOpenings) {
        const fThick = Math.min(0.08, (op.frameThicknessMm || 45) / 1000);
        const cx = op.t * len;
        const hw = Math.min(len * 0.48, op.widthMm / 2000);
        const rawU1 = Math.max(cursorU, cx - hw);
        const rawU2 = Math.min(len, cx + hw);
        if (rawU2 <= rawU1 + 0.05) continue;

        const isPassableCategory =
          op.category === 'arch' ||
          (op.category === 'door' && (op.subtype === 'doorframe' || op.openAngleDeg >= 20));

        if (!isPassableCategory) {
          // Windows, closed doors, etc. remain solid full-wall barriers
          continue;
        }

        // Solid wall before this opening
        emitSegment(cursorU, rawU1 + fThick * 0.5, 0, wallH, `pre_${op.id}`);

        const sillY = Math.max(0, op.sillHeightMm / 1000);
        const topY = Math.min(wallH, (op.sillHeightMm + op.heightMm) / 1000);

        if (op.category === 'door' && op.subtype === 'sliding') {
          // For sliding doors, one panel covers half the clear span
          const openFrac = Math.min(1, Math.max(0, op.openAngleDeg / 90));
          const panelW = (rawU2 - rawU1) * 0.5;
          if (openFrac < 0.35) {
            emitSegment(rawU1, rawU2, sillY, topY, `slide_${op.id}`);
          } else if (op.swingSide === 'left') {
            emitSegment(rawU1, rawU1 + panelW, sillY, topY, `slideL_${op.id}`);
          } else {
            emitSegment(rawU2 - panelW, rawU2, sillY, topY, `slideR_${op.id}`);
          }
        }

        // Sill wall beneath opening (e.g. high pass-through)
        if (sillY > 0.02) {
          emitSegment(rawU1, rawU2, 0, sillY, `sill_${op.id}`);
        }
        // Upper lintel above door/arch
        if (topY < wallH - 0.02) {
          emitSegment(rawU1, rawU2, topY, wallH, `head_${op.id}`);
        }

        cursorU = rawU2 - fThick * 0.5;
      }

      if (cursorU < len - 0.015) {
        emitSegment(cursorU, len, 0, wallH, 'tail');
      }
    }
  }

  // 2. Furniture colliders (Z-aware per structural part: walk under pendants, block on tables/sofas/walls)
  if (level.layers.furniture) {
    for (const f of level.furniture) {
      if (!f.visible || isRugFurniture(f) || isCurtainOrBlindFurniture(f)) continue;
      const primitives = getFurnitureSolidFootprintPrimitives({ x: f.xMm, y: f.yMm }, f);
      for (let i = 0; i < primitives.length; i++) {
        const pr = primitives[i];
        const minY = pr.minZ / 1000;
        const maxY = pr.maxZ / 1000;
        if (maxY - minY < 0.025) continue;
        colliders.push({
          id: `furn_${f.id}_${i}`,
          poly: pr.poly.map((pt) => ({ x: pt.x / 1000, z: pt.y / 1000 })),
          minY,
          maxY,
          walkableTop: maxY <= 0.35,
        });
      }
    }
  }

  // 3. Architectural elements (columns, chimneys, stairs, platforms, balconies, beams, railings, fireplaces)
  if (level.layers.archElements) {
    for (const el of level.archElements as ArchElement[]) {
      if (!el.visible || el.type === 'niche') continue;
      const cx = el.xMm / 1000;
      const cz = el.yMm / 1000;
      const hw = Math.max(0.05, el.widthMm / 2000);
      const hd = Math.max(0.05, el.depthMm / 2000);
      const elevY = el.elevationMm / 1000;
      const rawH = el.connectToCeiling ? level.ceilingHeightMm - el.elevationMm : el.heightMm;
      const h =
        (settings.cutawayEnabled ? Math.min(rawH, settings.cutawayHeightMm) : rawH) / 1000;

      if (el.type === 'platform' || el.type === 'balcony') {
        const connectedRoom =
          el.type === 'balcony'
            ? findConnectedRoomForBalcony(el, level.rooms, level.walls)
            : null;
        colliders.push({
          id: `arch_${el.id}`,
          poly: makeRotatedRectPoly(cx, cz, hw, hd, el.rotationDeg),
          minY: elevY,
          maxY: elevY + h,
          walkableTop: true,
          ceilingY:
            connectedRoom && connectedRoom.hasCeiling
              ? connectedRoom.ceilingHeightMm / 1000
              : undefined,
        });
      } else if (el.type.startsWith('stairs')) {
        const steps = Math.max(2, el.stepCount ?? 14);
        const treadD = (hd * 2) / steps;
        const riseH = h / steps;
        const rad = (el.rotationDeg * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        for (let s = 0; s < steps; s++) {
          const localZ = hd - (s + 0.5) * treadD;
          const stepCx = cx - localZ * sinR;
          const stepCz = cz + localZ * cosR;
          colliders.push({
            id: `arch_${el.id}_step_${s}`,
            poly: makeRotatedRectPoly(stepCx, stepCz, hw, treadD / 2 + 0.01, el.rotationDeg),
            minY: elevY,
            maxY: elevY + (s + 1) * riseH,
            walkableTop: true,
          });
        }
      } else if (el.type === 'doorframe') {
        const jambW = Math.min(hw * 0.25, Math.max(0.045, Math.min(0.085, hw * 0.14)));
        const rad = (el.rotationDeg * Math.PI) / 180;
        const ux = Math.cos(rad);
        const uz = Math.sin(rad);
        const sideOffset = hw - jambW / 2;
        colliders.push({
          id: `arch_${el.id}_jambL`,
          poly: makeRotatedRectPoly(cx - ux * sideOffset, cz - uz * sideOffset, jambW / 2, hd, el.rotationDeg),
          minY: elevY,
          maxY: elevY + h,
          walkableTop: false,
        });
        colliders.push({
          id: `arch_${el.id}_jambR`,
          poly: makeRotatedRectPoly(cx + ux * sideOffset, cz + uz * sideOffset, jambW / 2, hd, el.rotationDeg),
          minY: elevY,
          maxY: elevY + h,
          walkableTop: false,
        });
        colliders.push({
          id: `arch_${el.id}_header`,
          poly: makeRotatedRectPoly(cx, cz, hw, hd, el.rotationDeg),
          minY: elevY + Math.max(0.1, h - jambW),
          maxY: elevY + h,
          walkableTop: false,
        });
      } else {
        colliders.push({
          id: `arch_${el.id}`,
          poly: makeRotatedRectPoly(cx, cz, hw, hd, el.rotationDeg),
          minY: elevY,
          maxY: elevY + h,
          walkableTop: false,
        });
      }
    }
  }

  // 4. People scale figures
  if (level.layers.people) {
    for (const p of level.people) {
      if (!p.visible) continue;
      const elevY = p.elevationMm / 1000;
      const s = Math.max(0.4, p.heightMm / 1750);
      if (p.pose === 'lying_back' || p.pose === 'lying_side') {
        colliders.push({
          id: `person_${p.id}`,
          poly: makeRotatedRectPoly(p.xMm / 1000, p.yMm / 1000, 0.28 * s, 0.88 * s, p.rotationDeg),
          minY: elevY,
          maxY: elevY + 0.36 * s,
        });
      } else {
        const h = p.heightMm / 1000;
        colliders.push({
          id: `person_${p.id}`,
          poly: makeRotatedRectPoly(p.xMm / 1000, p.yMm / 1000, 0.2 * s, 0.16 * s, p.rotationDeg),
          minY: elevY,
          maxY: elevY + h,
        });
      }
    }
  }

  return colliders;
}

export function getWalkFloorAndCeilingAt(
  xM: number,
  zM: number,
  currentFeetY: number,
  colliders: WalkCollider[],
  rooms: Room[],
  levelCeilingMm: number,
  cutawayEnabled: boolean,
  ceilingOff: boolean
): { floorY: number; ceilingY: number } {
  const ptMm: Point2D = { x: xM * 1000, y: zM * 1000 };
  let floorY = 0;
  let ceilingY = Infinity;

  for (const room of rooms) {
    if (!room.visible || room.polygon.length < 3) continue;
    if (pointInPolygon(ptMm, room.polygon)) {
      floorY = Math.max(floorY, room.floorLevelMm / 1000);
      if (room.hasCeiling && !cutawayEnabled && !ceilingOff) {
        ceilingY = Math.min(ceilingY, room.ceilingHeightMm / 1000);
      }
    }
  }

  // Support walkable platforms, balconies, and stair treads within step-up range
  const reachY = currentFeetY + PLAYER_STEP_HEIGHT_M;
  for (const col of colliders) {
    if (!col.walkableTop) continue;
    if (pointInXZPoly(xM, zM, col.poly)) {
      if (col.maxY <= reachY && col.maxY > floorY) {
        floorY = col.maxY;
      }
      if (col.ceilingY !== undefined && !cutawayEnabled && !ceilingOff) {
        ceilingY = Math.min(ceilingY, col.ceilingY);
      }
    }
  }

  // Fallback ceiling if levelCeilingMm is used in a room without match
  if (!Number.isFinite(ceilingY) && rooms.length === 0 && !cutawayEnabled && !ceilingOff) {
    // Open ground outside any room has open sky
    void levelCeilingMm;
  }

  return { floorY, ceilingY };
}

function resolveHorizontalCollisions(
  x: number,
  z: number,
  feetY: number,
  colliders: WalkCollider[]
): XZPoint {
  let px = x;
  let pz = z;
  const bodyBottom = feetY + PLAYER_STEP_HEIGHT_M;
  const nonWalkBottom = feetY + 0.04;
  const headTop = feetY + PLAYER_HEIGHT_M;

  for (let pass = 0; pass < 3; pass++) {
    for (const col of colliders) {
      const minActiveY = col.walkableTop ? bodyBottom : nonWalkBottom;
      if (col.maxY <= minActiveY || col.minY >= headTop) continue;
      const pushed = pushCircleOutOfPoly(px, pz, PLAYER_RADIUS_M, col.poly);
      px = pushed.x;
      pz = pushed.z;
    }
  }

  return { x: px, z: pz };
}

export function resolveWalkStep(
  state: WalkState,
  input: WalkInput,
  colliders: WalkCollider[],
  rooms: Room[],
  levelCeilingMm: number,
  cutawayEnabled: boolean,
  ceilingOff: boolean,
  dt: number,
  options?: { collisionEnabled?: boolean }
): WalkState {
  const stepDt = Math.min(0.05, Math.max(0.001, dt));
  const speed = input.sprint ? SPRINT_SPEED_MPS : WALK_SPEED_MPS;
  const collisionEnabled = options?.collisionEnabled !== false;

  // Forward in Three.js camera space with YXZ euler: (-sin(yaw), 0, -cos(yaw))
  const fwdX = -Math.sin(state.yaw);
  const fwdZ = -Math.cos(state.yaw);
  const rightX = Math.cos(state.yaw);
  const rightZ = -Math.sin(state.yaw);

  if (!collisionEnabled) {
    // Noclip free-flight mode: pass cleanly through walls, furniture, floors & ceilings
    const cosPitch = Math.cos(state.pitch);
    const sinPitch = Math.sin(state.pitch);
    const lookFwdX = fwdX * cosPitch;
    const lookFwdZ = fwdZ * cosPitch;
    const vertWish =
      sinPitch * input.forward +
      (input.ascend || input.jump ? 1 : 0) -
      (input.descend ? 1 : 0);

    let wishX = lookFwdX * input.forward + rightX * input.strafe;
    let wishY = vertWish;
    let wishZ = lookFwdZ * input.forward + rightZ * input.strafe;
    const wishLen = Math.hypot(wishX, wishY, wishZ);
    const flySpeed = speed * 1.15;
    if (wishLen > 1e-4) {
      wishX = (wishX / wishLen) * flySpeed;
      wishY = (wishY / wishLen) * flySpeed;
      wishZ = (wishZ / wishLen) * flySpeed;
    } else {
      wishX = 0;
      wishY = 0;
      wishZ = 0;
    }
    const accelAlpha = 1 - Math.exp(-15 * stepDt);
    const vx = state.vx + (wishX - state.vx) * accelAlpha;
    const vy = state.vy + (wishY - state.vy) * accelAlpha;
    const vz = state.vz + (wishZ - state.vz) * accelAlpha;
    return {
      x: state.x + vx * stepDt,
      feetY: state.feetY + vy * stepDt,
      z: state.z + vz * stepDt,
      vx: Math.abs(vx) < 0.004 && wishLen < 1e-4 ? 0 : vx,
      vy: Math.abs(vy) < 0.004 && wishLen < 1e-4 ? 0 : vy,
      vz: Math.abs(vz) < 0.004 && wishLen < 1e-4 ? 0 : vz,
      yaw: state.yaw,
      pitch: state.pitch,
      grounded: false,
    };
  }

  let wishX = fwdX * input.forward + rightX * input.strafe;
  let wishZ = fwdZ * input.forward + rightZ * input.strafe;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1e-4) {
    wishX = (wishX / wishLen) * speed;
    wishZ = (wishZ / wishLen) * speed;
  } else {
    wishX = 0;
    wishZ = 0;
  }

  // Smooth exponential damping for responsive yet natural architectural stride
  const accelAlpha = 1 - Math.exp(-15 * stepDt);
  let vx = state.vx + (wishX - state.vx) * accelAlpha;
  let vz = state.vz + (wishZ - state.vz) * accelAlpha;
  if (Math.hypot(vx, vz) < 0.005 && wishLen < 1e-4) {
    vx = 0;
    vz = 0;
  }

  // Sub-step horizontal movement so fast walking never tunnels through thin walls
  const totalMove = Math.hypot(vx * stepDt, vz * stepDt);
  const subSteps = Math.max(1, Math.ceil(totalMove / (PLAYER_RADIUS_M * 0.45)));
  let nextX = state.x;
  let nextZ = state.z;
  for (let s = 0; s < subSteps; s++) {
    const candX = nextX + (vx * stepDt) / subSteps;
    const candZ = nextZ + (vz * stepDt) / subSteps;
    const resolved = resolveHorizontalCollisions(candX, candZ, state.feetY, colliders);
    nextX = resolved.x;
    nextZ = resolved.z;
  }

  // Vertical gravity, step-up & ceiling head-clearance clamping (175 cm entity)
  const { floorY, ceilingY } = getWalkFloorAndCeilingAt(
    nextX,
    nextZ,
    state.feetY,
    colliders,
    rooms,
    levelCeilingMm,
    cutawayEnabled,
    ceilingOff
  );

  let vy = state.vy;
  let grounded = state.grounded;
  if (input.jump && grounded) {
    vy = 3.4;
    grounded = false;
  }
  vy -= 12.5 * stepDt;
  let nextFeetY = state.feetY + vy * stepDt;

  if (nextFeetY <= floorY) {
    nextFeetY = floorY;
    vy = 0;
    grounded = true;
  } else if (nextFeetY - floorY < 0.04 && vy <= 0 && state.grounded) {
    nextFeetY = floorY;
    vy = 0;
    grounded = true;
  } else {
    grounded = false;
  }

  // Enforce 175 cm total entity headroom beneath any active ceiling slab
  const maxFeetUnderCeiling = Number.isFinite(ceilingY)
    ? Math.max(floorY, ceilingY - PLAYER_HEIGHT_M - 0.02)
    : Infinity;
  if (nextFeetY > maxFeetUnderCeiling) {
    nextFeetY = maxFeetUnderCeiling;
    if (vy > 0) vy = 0;
  }

  // Damp residual velocity along blocked axes
  const actualDx = nextX - state.x;
  const actualDz = nextZ - state.z;
  if (stepDt > 1e-4) {
    if (Math.abs(actualDx) < Math.abs(vx * stepDt) * 0.2) vx *= 0.25;
    if (Math.abs(actualDz) < Math.abs(vz * stepDt) * 0.2) vz *= 0.25;
  }

  return {
    x: nextX,
    feetY: nextFeetY,
    z: nextZ,
    vx,
    vy,
    vz,
    yaw: state.yaw,
    pitch: state.pitch,
    grounded,
  };
}

function isSpotClearForEntity(
  x: number,
  z: number,
  feetY: number,
  colliders: WalkCollider[]
): boolean {
  const bodyBottom = feetY + PLAYER_STEP_HEIGHT_M;
  const nonWalkBottom = feetY + 0.04;
  const headTop = feetY + PLAYER_HEIGHT_M;
  for (const col of colliders) {
    const minActiveY = col.walkableTop ? bodyBottom : nonWalkBottom;
    if (col.maxY <= minActiveY || col.minY >= headTop) continue;
    const pushed = pushCircleOutOfPoly(x, z, PLAYER_RADIUS_M + 0.04, col.poly);
    if (Math.hypot(pushed.x - x, pushed.z - z) > 0.004) {
      return false;
    }
  }
  return true;
}

export function findSafeWalkSpawn(
  level: Level,
  colliders: WalkCollider[]
): { x: number; feetY: number; z: number; yaw: number } {
  const candidates: Array<{ x: number; z: number; floorY: number }> = [];

  // Prefer visible rooms ordered largest area first
  const sortedRooms = [...level.rooms]
    .filter((r) => r.visible && r.polygon.length >= 3)
    .sort((a, b) => b.areaM2 - a.areaM2);

  for (const room of sortedRooms) {
    let sx = 0;
    let sz = 0;
    for (const p of room.polygon) {
      sx += p.x / 1000;
      sz += p.y / 1000;
    }
    candidates.push({
      x: sx / room.polygon.length,
      z: sz / room.polygon.length,
      floorY: room.floorLevelMm / 1000,
    });
  }

  // Fallback to wall centroid
  if (level.walls.length > 0) {
    let wx = 0;
    let wz = 0;
    for (const w of level.walls) {
      wx += (w.start.x + w.end.x) / 2000;
      wz += (w.start.y + w.end.y) / 2000;
    }
    candidates.push({
      x: wx / level.walls.length,
      z: wz / level.walls.length,
      floorY: 0,
    });
  } else {
    candidates.push({ x: 0, z: 0, floorY: 0 });
  }

  for (const base of candidates) {
    if (isSpotClearForEntity(base.x, base.z, base.floorY, colliders)) {
      return { x: base.x, feetY: base.floorY, z: base.z, yaw: Math.PI * 0.15 };
    }
    // Spiral search outward up to 3.5m for clear floor space
    for (let r = 0.35; r <= 3.5; r += 0.35) {
      const angles = 16;
      for (let a = 0; a < angles; a++) {
        const ang = (a / angles) * Math.PI * 2;
        const tx = base.x + Math.cos(ang) * r;
        const tz = base.z + Math.sin(ang) * r;
        const insideAnyRoom =
          sortedRooms.length === 0 ||
          sortedRooms.some((rm) => pointInPolygon({ x: tx * 1000, y: tz * 1000 }, rm.polygon));
        if (insideAnyRoom && isSpotClearForEntity(tx, tz, base.floorY, colliders)) {
          return { x: tx, feetY: base.floorY, z: tz, yaw: Math.PI * 0.15 };
        }
      }
    }
  }

  const fb = candidates[0];
  return { x: fb.x, feetY: fb.floorY, z: fb.z, yaw: 0 };
}
