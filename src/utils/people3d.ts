import * as THREE from 'three';
import type { PersonInstance } from '../types/plan';

export interface People3DBuildOptions {
  clippingPlanes: THREE.Plane[];
  castShadows: boolean;
  isSoftwareGl?: boolean;
}

const SKIN_TONES = ['#F4CDBA', '#E6B796', '#D1976F', '#A36D49', '#70472F'];
const HAIR_TONES = ['#1E1815', '#462E1F', '#7C5432', '#B78947', '#646B75', '#2E231D'];
const TOP_PALETTE = ['#3B5268', '#6B7F6E', '#8F5B4A', '#4B5563', '#A68868', '#334155', '#5C4D6E'];
const BOTTOM_PALETTE = ['#1F2937', '#334155', '#473D35', '#27303F', '#52525B'];
const SHOE_PALETTE = ['#18181B', '#452C1E', '#E2E8F0', '#27272A'];

type HairStyle = 'short' | 'parted' | 'bob' | 'bun' | 'curly';

function hashPersonId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function makeMat(
  color: string,
  roughness: number,
  clippingPlanes: THREE.Plane[],
  metalness = 0
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness,
    clippingPlanes,
  });
}

function createLimb(
  rTop: number,
  rBot: number,
  len: number,
  mat: THREE.Material
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(rTop, rBot, len, 12);
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

function createJoint(radius: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), mat);
}

function buildHeadGroup(
  skinMat: THREE.Material,
  hairMat: THREE.Material,
  darkMat: THREE.Material,
  scleraMat: THREE.Material,
  hairStyle: HairStyle,
  headScale = 1
): THREE.Group {
  const headGroup = new THREE.Group();
  headGroup.scale.setScalar(headScale);

  // Cranium + tapered jaw silhouette
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.098, 18, 16), skinMat);
  cranium.scale.set(0.88, 1.08, 0.94);
  cranium.position.set(0, 0.012, 0);
  headGroup.add(cranium);

  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.072, 14, 12), skinMat);
  jaw.scale.set(0.84, 0.88, 0.88);
  jaw.position.set(0, -0.042, 0.015);
  headGroup.add(jaw);

  // Ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), skinMat);
    ear.scale.set(0.45, 0.95, 0.65);
    ear.position.set(side * 0.084, -0.005, -0.006);
    headGroup.add(ear);
  }

  // Facial features (+Z faces forward)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.036, 8), skinMat);
  nose.rotation.x = Math.PI * 0.42;
  nose.position.set(0, -0.006, 0.095);
  headGroup.add(nose);

  for (const side of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), scleraMat);
    eyeWhite.scale.set(1.1, 0.78, 0.55);
    eyeWhite.position.set(side * 0.03, 0.014, 0.084);
    headGroup.add(eyeWhite);

    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 8, 8), darkMat);
    iris.position.set(side * 0.03, 0.014, 0.089);
    headGroup.add(iris);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.0055, 0.008), hairMat);
    brow.position.set(side * 0.031, 0.03, 0.086);
    brow.rotation.z = side * -0.06;
    headGroup.add(brow);
  }

  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.0045, 0.006), makeMat('#9E635A', 0.65, []));
  mouth.position.set(0, -0.042, 0.079);
  headGroup.add(mouth);

  // Hair styles
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.104, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hairMat
  );
  cap.scale.set(0.9, 1.05, 0.96);
  cap.rotation.x = -0.22;
  cap.position.set(0, 0.022, -0.008);
  headGroup.add(cap);

  if (hairStyle === 'short' || hairStyle === 'parted') {
    const backHair = new THREE.Mesh(new THREE.SphereGeometry(0.096, 14, 12), hairMat);
    backHair.scale.set(0.9, 0.88, 0.75);
    backHair.position.set(0, 0.01, -0.028);
    headGroup.add(backHair);
    if (hairStyle === 'parted') {
      const crest = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 10), hairMat);
      crest.scale.set(1.5, 0.55, 1.25);
      crest.position.set(-0.015, 0.098, 0.025);
      headGroup.add(crest);
    }
  } else if (hairStyle === 'bob') {
    const bobBack = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.104, 0.17, 16), hairMat);
    bobBack.scale.set(0.94, 1, 0.84);
    bobBack.position.set(0, -0.025, -0.025);
    headGroup.add(bobBack);
    for (const side of [-1, 1]) {
      const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.11, 4, 8), hairMat);
      lock.position.set(side * 0.082, -0.03, 0.012);
      headGroup.add(lock);
    }
  } else if (hairStyle === 'bun') {
    const backHair = new THREE.Mesh(new THREE.SphereGeometry(0.096, 14, 12), hairMat);
    backHair.scale.set(0.9, 0.88, 0.78);
    backHair.position.set(0, 0.01, -0.026);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), hairMat);
    bun.position.set(0, 0.052, -0.106);
    headGroup.add(backHair, bun);
  } else {
    // curly volume
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 8), hairMat);
      puff.position.set(
        Math.cos(ang) * 0.068,
        0.055 + ((i % 3) - 1) * 0.022,
        Math.sin(ang) * 0.064 - 0.015
      );
      headGroup.add(puff);
    }
  }

  return headGroup;
}

/**
 * Builds an articulated, naturally clothed architectural human figure.
 * Canonical standing model is ~1.75 m tall, scaled smoothly by `person.heightMm / 1750`.
 * Supports standing_man, standing_woman, child, seated, walking, lying_back, lying_side.
 */
export function buildDetailedPersonGroup(
  person: PersonInstance,
  opts: People3DBuildOptions
): THREE.Group {
  const root = new THREE.Group();
  root.position.set(person.xMm / 1000, person.elevationMm / 1000, person.yMm / 1000);
  root.rotation.y = (-person.rotationDeg * Math.PI) / 180;
  const s = Math.max(0.4, person.heightMm / 1750);
  root.scale.setScalar(s);

  const seed = hashPersonId(person.id);
  const pose = person.pose;
  const isWoman = pose === 'standing_woman' || pose === 'lying_side';
  const isChild = pose === 'child';

  const skinColor = SKIN_TONES[seed % SKIN_TONES.length];
  const hairColor = HAIR_TONES[(seed >> 2) % HAIR_TONES.length];
  const hairStyles: HairStyle[] = isWoman
    ? ['bob', 'bun', 'parted', 'curly']
    : isChild
      ? ['short', 'curly', 'parted']
      : ['short', 'parted', 'curly', 'bun'];
  const hairStyle = hairStyles[(seed >> 4) % hairStyles.length];

  const userHex = (person.color || '#FFFFFF').toUpperCase();
  const topColor =
    userHex !== '#FFFFFF' ? userHex : TOP_PALETTE[(seed >> 3) % TOP_PALETTE.length];
  const bottomColor = BOTTOM_PALETTE[(seed >> 5) % BOTTOM_PALETTE.length];
  const shoeColor = SHOE_PALETTE[(seed >> 7) % SHOE_PALETTE.length];

  const skinMat = makeMat(skinColor, 0.56, opts.clippingPlanes);
  const hairMat = makeMat(hairColor, 0.72, opts.clippingPlanes);
  const topMat = makeMat(topColor, 0.82, opts.clippingPlanes);
  const bottomMat = makeMat(bottomColor, 0.85, opts.clippingPlanes);
  const shoeMat = makeMat(shoeColor, 0.48, opts.clippingPlanes);
  const beltMat = makeMat('#29221C', 0.45, opts.clippingPlanes, 0.15);
  const darkMat = makeMat('#111827', 0.28, opts.clippingPlanes);
  const scleraMat = makeMat('#F8FAFC', 0.25, opts.clippingPlanes);

  // Inner articulated body rig built around pelvis at origin (or grounded automatically)
  const rig = new THREE.Group();

  const shoulderHalf = isWoman ? 0.175 : isChild ? 0.165 : 0.205;
  const waistRadius = isWoman ? 0.112 : 0.132;
  const hipHalf = isWoman ? 0.095 : 0.096;
  const thighLen = 0.41;
  const calfLen = 0.41;
  const upperArmLen = 0.27;
  const foreArmLen = 0.25;
  const headScale = isChild ? 1.18 : 1.0;

  // Pelvis / Hips block
  const pelvis = new THREE.Mesh(
    new THREE.CylinderGeometry(waistRadius * 0.96, waistRadius * 1.04, 0.16, 16),
    bottomMat
  );
  pelvis.scale.set(1.12, 1, 0.74);
  pelvis.position.set(0, 0.04, 0);
  rig.add(pelvis);

  const belt = new THREE.Mesh(
    new THREE.CylinderGeometry(waistRadius * 0.99, waistRadius * 0.99, 0.032, 16),
    beltMat
  );
  belt.scale.set(1.14, 1, 0.76);
  belt.position.set(0, 0.115, 0);
  rig.add(belt);

  // Upper torso / jacket / shirt
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(shoulderHalf * 0.78, waistRadius * 0.98, 0.42, 18),
    topMat
  );
  torso.scale.set(1.06, 1, 0.64);
  torso.position.set(0, 0.33, 0);
  rig.add(torso);

  // Subtle shoulder cap mass so coat/shirt drapes organically
  const shoulderBar = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.068, shoulderHalf * 1.45, 6, 12),
    topMat
  );
  shoulderBar.rotation.z = Math.PI / 2;
  shoulderBar.scale.set(1, 0.95, 0.78);
  shoulderBar.position.set(0, 0.505, 0);
  rig.add(shoulderBar);

  // Subtle shirt collar detail
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.064, 0.014, 8, 16), scleraMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0.555, 0.008);
  rig.add(collar);

  // Neck & sculpted head
  const neck = createLimb(0.046, 0.052, 0.095, skinMat);
  neck.position.set(0, 0.59, 0.004);
  rig.add(neck);

  const head = buildHeadGroup(skinMat, hairMat, darkMat, scleraMat, hairStyle, headScale);
  head.position.set(0, 0.715, 0.01);
  rig.add(head);

  // Helper to assemble an articulated arm hanging from shoulder pivot (side = -1 left, +1 right)
  const buildArm = (
    side: -1 | 1,
    pitchShoulder: number,
    rollShoulder: number,
    elbowFlex: number
  ) => {
    const shPivot = new THREE.Group();
    shPivot.position.set(side * (shoulderHalf + 0.015), 0.505, 0);
    shPivot.rotation.set(pitchShoulder, 0, rollShoulder);

    const sleeveCap = createJoint(0.052, topMat);
    const upperArm = createLimb(0.048, 0.042, upperArmLen, topMat);
    upperArm.position.set(0, -upperArmLen / 2, 0);
    shPivot.add(sleeveCap, upperArm);

    const elbowPivot = new THREE.Group();
    elbowPivot.position.set(0, -upperArmLen, 0);
    elbowPivot.rotation.set(elbowFlex, 0, 0);

    const elbowJoint = createJoint(0.039, topMat);
    const forearm = createLimb(0.039, 0.031, foreArmLen, skinMat);
    forearm.position.set(0, -foreArmLen / 2, 0);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 10), skinMat);
    hand.scale.set(0.72, 1.28, 0.92);
    hand.position.set(0, -foreArmLen - 0.028, 0);

    elbowPivot.add(elbowJoint, forearm, hand);
    shPivot.add(elbowPivot);
    rig.add(shPivot);
  };

  // Helper to assemble an articulated leg from hip pivot
  const buildLeg = (
    side: -1 | 1,
    hipPitch: number,
    hipRoll: number,
    kneeBend: number,
    anklePitch = 0
  ) => {
    const hipPivot = new THREE.Group();
    hipPivot.position.set(side * hipHalf, -0.015, 0);
    hipPivot.rotation.set(hipPitch, 0, hipRoll);

    const hipJoint = createJoint(0.068, bottomMat);
    const thigh = createLimb(0.068, 0.054, thighLen, bottomMat);
    thigh.position.set(0, -thighLen / 2, 0);
    hipPivot.add(hipJoint, thigh);

    const kneePivot = new THREE.Group();
    kneePivot.position.set(0, -thighLen, 0);
    kneePivot.rotation.set(kneeBend, 0, 0);

    const kneeJoint = createJoint(0.051, bottomMat);
    const calf = createLimb(0.051, 0.04, calfLen, bottomMat);
    calf.position.set(0, -calfLen / 2, 0);

    // Foot + shoe
    const footPivot = new THREE.Group();
    footPivot.position.set(0, -calfLen, 0);
    footPivot.rotation.set(anklePitch, 0, 0);

    const heel = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.056, 0.115), shoeMat);
    heel.position.set(0, -0.025, 0.015);
    const toeCap = new THREE.Mesh(new THREE.SphereGeometry(0.044, 10, 8), shoeMat);
    toeCap.scale.set(1.0, 0.62, 1.48);
    toeCap.position.set(0, -0.029, 0.095);
    footPivot.add(heel, toeCap);

    kneePivot.add(kneeJoint, calf, footPivot);
    hipPivot.add(kneePivot);
    rig.add(hipPivot);
  };

  // Apply pose articulations and grounded placement inside root
  if (pose === 'seated') {
    buildLeg(-1, -Math.PI * 0.48, 0.04, Math.PI * 0.48, 0);
    buildLeg(1, -Math.PI * 0.48, -0.04, Math.PI * 0.48, 0);
    buildArm(-1, -0.45, 0.12, -0.78);
    buildArm(1, -0.45, -0.12, -0.78);
    rig.position.set(0, 0.48, -0.12);
    head.rotation.x = 0.08;
  } else if (pose === 'walking') {
    buildLeg(-1, -0.34, 0, 0.24, 0.12);
    buildLeg(1, 0.3, 0, 0.18, -0.18);
    buildArm(-1, 0.34, 0.1, -0.24);
    buildArm(1, -0.36, -0.1, -0.32);
    rig.position.set(0, 0.875, 0);
    rig.rotation.x = 0.04;
    head.rotation.x = -0.04;
  } else if (pose === 'lying_back') {
    // Relaxed supine posture resting flat along local Z axis
    buildLeg(-1, 0.04, 0.05, 0.12, 0.36);
    buildLeg(1, -0.02, -0.04, 0.04, 0.32);
    buildArm(-1, 0.05, 0.22, -0.2);
    buildArm(1, -0.04, -0.18, -0.15);
    rig.rotation.x = -Math.PI / 2;
    head.rotation.x = 0.22; // Slight pillow lift
    rig.position.set(0, 0.135, 0.02);
  } else if (pose === 'lying_side') {
    // Relaxed side-sleeping posture facing +X with knees gently bent
    buildLeg(-1, -0.38, 0.08, 0.56, 0.25);
    buildLeg(1, -0.18, -0.04, 0.34, 0.22);
    buildArm(-1, -0.42, 0.22, -0.68);
    buildArm(1, -0.24, -0.15, -0.52);
    rig.rotation.order = 'YXZ';
    rig.rotation.x = -Math.PI / 2;
    rig.rotation.z = -Math.PI * 0.42;
    head.rotation.y = 0.18;
    rig.position.set(0, 0.185, 0.02);
  } else {
    // Standing poses (man, woman, child)
    const armSpread = isWoman ? 0.07 : 0.11;
    buildLeg(-1, -0.03, 0.025, 0.04, 0);
    buildLeg(1, 0.03, -0.025, 0.02, 0);
    buildArm(-1, 0.04, armSpread, -0.16);
    buildArm(1, -0.04, -armSpread, -0.18);
    rig.position.set(0, 0.885, 0);
  }

  // Enable shadow casting & receiving cleanly on every figure limb/garment
  rig.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      obj.castShadow = opts.castShadows;
      obj.receiveShadow = opts.castShadows;
    }
  });

  root.add(rig);
  return root;
}
