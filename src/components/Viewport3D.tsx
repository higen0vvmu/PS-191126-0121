import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { Camera, Eye, Compass, Sun, Moon, Layers, SlidersHorizontal } from 'lucide-react';
import {
  ArchElement,
  CameraPreset,
  Curtain,
  FurnitureInstance,
  Level,
  Opening,
  PersonInstance,
  ProjectSettings,
} from '../types/plan';
import {
  computeFurnitureBoundsMm,
  findConnectedRoomForBalcony,
  getCeilingFixtureOffsetMm,
  getChimneyWorldCorners,
  getEnclosingRoomCeilingMm,
  getWallCenterlinePoint,
  isRugFurniture,
  pointInPolygon,
  resolveChimneyFaceColors,
  wallOffsets,
} from '../utils/geometry';
import {
  resolveFurnitureMountingFace,
  resolveFurnitureMountingType,
} from '../utils/mounting';
import {
  fitGlbSceneToFurnitureBounds,
  loadGlbObjectCached,
} from '../utils/furnitureRepresentationSync';
import {
  type ArchitecturalMaterialOptions,
  applyWorldSpaceUVs,
  buildArchitecturalMaterial,
  setTextureReadyCallback,
} from '../utils/textures3d';
import { buildProceduralFurnitureGroup } from '../utils/furniture3d';
import { resolveRailingConfig } from '../utils/railings';
import {
  buildHostDeckRailings3DGroup,
  buildRailing3DGroup,
  buildStaircase3DGroup,
} from '../utils/railings3d';
import {
  applyGlbEmissiveOverrides,
  assignInteriorShadowBudget,
  buildThreeLightsForFurniture,
  type EmissiveTargetEntry,
  isFurnitureLightingActive,
  type SceneBulbLightEntry,
} from '../utils/lighting';
import { buildDetailedPersonGroup } from '../utils/people3d';
import { buildWall3DGroup } from '../utils/wall3d';
import {
  buildWalkColliders,
  findSafeWalkSpawn,
  resolveWalkStep,
  WalkCollider,
  WalkState,
} from '../utils/walkPhysics';
import type {
  ConcreteGraphicsPresetId,
  GraphicsSettings,
} from '../utils/graphicsSettings';
import { GraphicsSettingsPanel } from './GraphicsSettingsPanel';

function getEffectiveFovDeg(preset: CameraPreset, baseFovDeg: number): number {
  return preset === 'walkthrough'
    ? Math.max(68, Math.min(78, baseFovDeg + 18))
    : baseFovDeg;
}

let sharedContactShadowTex: THREE.CanvasTexture | null = null;
function getContactShadowTexture(): THREE.CanvasTexture | null {
  if (sharedContactShadowTex) return sharedContactShadowTex;
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.14, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, 'rgba(15, 23, 42, 0.72)');
  grad.addColorStop(0.55, 'rgba(15, 23, 42, 0.34)');
  grad.addColorStop(1, 'rgba(15, 23, 42, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  sharedContactShadowTex = tex;
  return tex;
}

function getEffectiveDpr(renderScale: number, isSoftwareGl: boolean): number {
  if (isSoftwareGl) return 1;
  return Math.max(0.65, Math.min(2.25, renderScale));
}

function applyInteriorLightAndShadowBudget(
  bulbLights: SceneBulbLightEntry[],
  nightMix: number,
  maxRealtimeLights: number,
  castShadows: boolean,
  lightQuality: GraphicsSettings['lightQuality']
): SceneBulbLightEntry[] {
  const prioritized = bulbLights
    .slice()
    .sort(
      (a, b) =>
        Number(Boolean(b.userCastShadow)) - Number(Boolean(a.userCastShadow)) ||
        Number(b.isCeiling) - Number(a.isCeiling) ||
        b.baseIntensity - a.baseIntensity
    );
  const active = prioritized.slice(0, Math.max(1, maxRealtimeLights));
  const overflow = prioritized.slice(Math.max(1, maxRealtimeLights));
  const boost = THREE.MathUtils.lerp(0.24, 0.62, nightMix);
  for (const entry of active) {
    entry.light.visible = true;
    entry.light.intensity = entry.baseIntensity * boost;
  }
  for (const entry of overflow) {
    entry.light.visible = false;
    entry.light.intensity = 0;
    if ('castShadow' in entry.light && typeof entry.light.castShadow === 'boolean') {
      entry.light.castShadow = false;
    }
  }
  const maxInteriorShadows = lightQuality === 'low' ? 0 : lightQuality === 'medium' ? 1 : 3;
  assignInteriorShadowBudget(active, castShadows && maxInteriorShadows > 0, maxInteriorShadows);
  return active;
}

interface Viewport3DProps {
  level: Level;
  settings: ProjectSettings;
  graphicsSettings: GraphicsSettings;
  cameraPreset: CameraPreset;
  onCameraPresetChange: (preset: CameraPreset) => void;
  onUpdateSettings: (partial: Partial<ProjectSettings>) => void;
  onSelectGraphicsPreset: (preset: ConcreteGraphicsPresetId) => void;
  onUpdateGraphicsSettings: (partial: Partial<GraphicsSettings>) => void;
  onResetGraphicsSettings: () => void;
  onCanvasReady?: (captureFn: () => string | null) => void;
}

const _scratchVec = new THREE.Vector3();

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

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  level,
  settings,
  graphicsSettings,
  cameraPreset,
  onCameraPresetChange,
  onUpdateSettings,
  onSelectGraphicsPreset,
  onUpdateGraphicsSettings,
  onResetGraphicsSettings,
  onCanvasReady,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const graphicsPopoverWrapRef = useRef<HTMLDivElement>(null);
  const [walkHint, setWalkHint] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [ceilingMode, setCeilingMode] = useState<'auto' | 'solid' | 'off'>('auto');
  const [showGraphicsPopover, setShowGraphicsPopover] = useState(false);

  // Refs to keep Three.js loop decoupled from React re-renders
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const gtaoPassRef = useRef<GTAOPass | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const bokehPassRef = useRef<BokehPass | null>(null);
  const smaaPassRef = useRef<SMAAPass | null>(null);
  const colorGradePassRef = useRef<ShaderPass | null>(null);
  const fxaaPassRef = useRef<ShaderPass | null>(null);
  const envTexRef = useRef<THREE.Texture | null>(null);
  const composerRtRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const contentGroupRef = useRef<THREE.Group | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const bounceLightRef = useRef<THREE.DirectionalLight | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const lampLightsRef = useRef<SceneBulbLightEntry[]>([]);
  const activeLampLightsRef = useRef<SceneBulbLightEntry[]>([]);
  const emissiveTargetsRef = useRef<EmissiveTargetEntry[]>([]);
  const windowAreaLightsRef = useRef<Array<{ light: THREE.RectAreaLight; baseIntensity: number }>>([]);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const groundMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const skyMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const sunGroupRef = useRef<THREE.Group | null>(null);
  const moonGroupRef = useRef<THREE.Group | null>(null);
  const starsRef = useRef<THREE.Points | null>(null);
  const nightMixRef = useRef<number>(settings.timeOfDay3d === 'night' ? 1 : 0);
  const targetNightMixRef = useRef<number>(settings.timeOfDay3d === 'night' ? 1 : 0);
  const wallGroupsRef = useRef<Array<{ group: THREE.Group; normalX: number; normalZ: number }>>([]);
  const planBoundsRef = useRef<{ cx: number; cz: number; radius: number }>({ cx: 0, cz: 0, radius: 12 });
  const isSoftwareGlRef = useRef<boolean>(false);
  const requestRenderRef = useRef<() => void>(() => {});
  const graphicsRef = useRef<GraphicsSettings>(graphicsSettings);
  graphicsRef.current = graphicsSettings;

  // 175cm Physical Walk Mode refs
  const walkCollidersRef = useRef<WalkCollider[]>([]);
  const walkStateRef = useRef<WalkState>({
    x: 0,
    feetY: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: -0.02,
    grounded: true,
  });
  const walkKeysRef = useRef<Set<string>>(new Set());
  const isPointerLockedRef = useRef<boolean>(false);
  const programmaticUnlockRef = useRef<boolean>(false);
  const skipLockSpikeRef = useRef<number>(0);
  const hoverMouseLastRef = useRef<{ x: number; y: number } | null>(null);
  const prevCameraPresetRef = useRef<CameraPreset | null>(null);

  // Smooth camera transition target
  const camTransitionRef = useRef<{
    active: boolean;
    pos: THREE.Vector3;
    target: THREE.Vector3;
  }>({
    active: false,
    pos: new THREE.Vector3(7, 8, 9),
    target: new THREE.Vector3(0, 1, 0),
  });

  const presetRef = useRef(cameraPreset);
  presetRef.current = cameraPreset;
  const lastOrbitPresetRef = useRef<CameraPreset>(
    cameraPreset === 'walkthrough' ? 'perspective' : cameraPreset
  );
  if (cameraPreset !== 'walkthrough') {
    lastOrbitPresetRef.current = cameraPreset;
  }
  const onCameraPresetChangeRef = useRef(onCameraPresetChange);
  onCameraPresetChangeRef.current = onCameraPresetChange;
  const onUpdateSettingsRef = useRef(onUpdateSettings);
  onUpdateSettingsRef.current = onUpdateSettings;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const levelRef = useRef(level);
  levelRef.current = level;
  const ceilingModeRef = useRef(ceilingMode);
  ceilingModeRef.current = ceilingMode;

  // 1. Mount Three.js once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    isSoftwareGlRef.current = isSoftwareGl;

    const initGx = graphicsRef.current;
    const initDpr = getEffectiveDpr(initGx.renderScale, isSoftwareGl);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.localClippingEnabled = true;
    renderer.setPixelRatio(initDpr);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type =
      initGx.shadowSoftness <= 0.35 ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const initNight = (settingsRef.current.timeOfDay3d ?? 'day') === 'night';
    renderer.toneMappingExposure = (initNight ? 0.94 : 0.96) * initGx.exposure;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(initNight ? '#060B18' : '#DCE8F5');
    scene.fog = new THREE.Fog(initNight ? '#060B18' : '#DCE8F5', 34, 120);
    sceneRef.current = scene;

    // Studio PBR environment reflections for metallic hardware, mirrors & physical roughness contrast
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    envTexRef.current = envTex;
    scene.environment = initGx.environmentMapQuality === 'off' ? null : envTex;
    scene.environmentIntensity = initNight ? 0.11 : 0.22;
    pmrem.dispose();

    const initW = container.clientWidth || 800;
    const initH = container.clientHeight || 600;
    const camera = new THREE.PerspectiveCamera(
      getEffectiveFovDeg(presetRef.current, settingsRef.current.fovDeg),
      initW / initH,
      0.06,
      300
    );
    camera.position.set(7.5, 8.5, 9.5);
    cameraRef.current = camera;

    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const dpr = renderer.getPixelRatio();
      const rt = new THREE.WebGLRenderTarget(
        Math.max(1, Math.floor(initW * dpr)),
        Math.max(1, Math.floor(initH * dpr)),
        {
          type: THREE.HalfFloatType,
          samples: 0,
        }
      );
      composerRtRef.current = rt;
      const composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(dpr);
      composer.setSize(initW, initH);
      composer.addPass(new RenderPass(scene, camera));

      const gtaoPass = new GTAOPass(scene, camera, initW, initH);
      gtaoPass.output = GTAOPass.OUTPUT.Default;
      gtaoPass.blendIntensity = initGx.ambientOcclusionIntensity;
      gtaoPass.updateGtaoMaterial({
        radius: 0.42,
        distanceExponent: 1.5,
        thickness: 1.2,
        samples:
          initGx.ambientOcclusionQuality === 'high'
            ? 24
            : initGx.ambientOcclusionQuality === 'medium'
              ? 14
              : 8,
      });
      gtaoPass.enabled =
        initGx.ambientOcclusionQuality !== 'off' && initGx.ambientOcclusionIntensity > 0.005;
      composer.addPass(gtaoPass);
      gtaoPassRef.current = gtaoPass;

      // Sanitize NaN, Infinity, and extreme specular fireflies before UnrealBloomPass
      const hdrSanitizePass = new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec3 c = texel.rgb;
            c.r = (c.r >= 0.0 && c.r <= 12.0) ? c.r : (c.r > 12.0 ? 12.0 : 0.0);
            c.g = (c.g >= 0.0 && c.g <= 12.0) ? c.g : (c.g > 12.0 ? 12.0 : 0.0);
            c.b = (c.b >= 0.0 && c.b <= 12.0) ? c.b : (c.b > 12.0 ? 12.0 : 0.0);
            gl_FragColor = vec4(c, clamp(texel.a, 0.0, 1.0));
          }
        `,
      });
      composer.addPass(hdrSanitizePass);

      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(initW, initH),
        (initNight ? 0.12 : 0.055) * initGx.bloomIntensity,
        initNight ? 0.28 : 0.26,
        initNight ? 1.24 : 1.38
      );
      bloomPass.enabled = initGx.bloomIntensity > 0.005;
      composer.addPass(bloomPass);
      bloomPassRef.current = bloomPass;

      const bokehPass = new BokehPass(scene, camera, {
        focus: initGx.depthOfFieldFocusM,
        aperture: initGx.depthOfFieldAperture * 0.0012,
        maxblur: 0.008,
      });
      bokehPass.setSize(initW, initH);
      bokehPass.enabled = initGx.depthOfFieldEnabled;
      composer.addPass(bokehPass);
      bokehPassRef.current = bokehPass;

      // SMAA operates in linear-srgb before OutputPass
      const smaaPass = new SMAAPass();
      smaaPass.setSize(initW * dpr, initH * dpr);
      smaaPass.enabled = initGx.antiAliasing === 'smaa';
      composer.addPass(smaaPass);
      smaaPassRef.current = smaaPass;

      composer.addPass(new OutputPass());

      // Post-tonemap contrast & subtle optical vignette (sRGB space)
      const colorGradePass = new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          uContrast: { value: initGx.contrast },
          uVignette: { value: initGx.vignetteIntensity },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float uContrast;
          uniform float uVignette;
          varying vec2 vUv;
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec3 col = clamp((texel.rgb - 0.5) * uContrast + 0.5, 0.0, 1.0);
            if (uVignette > 0.001) {
              vec2 d = vUv - 0.5;
              float vig = smoothstep(0.9, 0.28, dot(d, d) * 2.2);
              col *= mix(1.0, vig, uVignette);
            }
            gl_FragColor = vec4(col, texel.a);
          }
        `,
      });
      colorGradePass.enabled =
        Math.abs(initGx.contrast - 1.0) > 0.005 || initGx.vignetteIntensity > 0.005;
      composer.addPass(colorGradePass);
      colorGradePassRef.current = colorGradePass;

      // FXAA operates in sRGB after OutputPass
      const fxaaPass = new ShaderPass(FXAAShader);
      fxaaPass.uniforms['resolution'].value.set(
        1 / Math.max(1, initW * dpr),
        1 / Math.max(1, initH * dpr)
      );
      fxaaPass.enabled = initGx.antiAliasing === 'fxaa';
      composer.addPass(fxaaPass);
      fxaaPassRef.current = fxaaPass;

      composerRef.current = composer;
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.target.set(0, 0.8, 0);
    controls.update();
    controlsRef.current = controls;

    // Atmospheric gradient skybox dome (animated smoothly between sunny day & starry night)
    const skyGeo = new THREE.SphereGeometry(140, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTopColor: { value: new THREE.Color(initNight ? '#040814' : '#2563EB') },
        uHorizonColor: { value: new THREE.Color(initNight ? '#0E1A32' : '#D4E6F9') },
        uGroundColor: { value: new THREE.Color(initNight ? '#070C17' : '#CBD5E1') },
        uSunDir: { value: new THREE.Vector3(0.5, 0.65, 0.45).normalize() },
        uSunGlowColor: { value: new THREE.Color(initNight ? '#CBD5E1' : '#FEF3C7') },
      },
      vertexShader: `
        varying vec3 vWorldDir;
        void main() {
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uGroundColor;
        uniform vec3 uSunDir;
        uniform vec3 uSunGlowColor;
        varying vec3 vWorldDir;
        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = dir.y;
          float hUp = max(clamp(h, 0.0, 1.0), 0.0001);
          vec3 col = mix(uHorizonColor, uTopColor, pow(hUp, 0.55));
          if (h < -0.0001) {
            float hDown = max(clamp(-h * 3.0, 0.0, 1.0), 0.0001);
            col = mix(uHorizonColor, uGroundColor, pow(hDown, 0.7));
          }
          float sunAmt = max(dot(dir, normalize(uSunDir)), 0.0);
          if (sunAmt > 0.001) {
            col += uSunGlowColor * pow(sunAmt, 16.0) * 0.24;
            col += uSunGlowColor * pow(sunAmt, 160.0) * 0.42;
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.renderOrder = -2;
    scene.add(skyMesh);
    skyMatRef.current = skyMat;

    // Visible radiant 3D Sun (core sphere + radial corona glow sprite)
    const sunGroup = new THREE.Group();
    const sunCoreGeo = new THREE.SphereGeometry(4.6, 24, 24);
    const sunCoreMat = new THREE.MeshBasicMaterial({
      color: 0xfffef0,
      fog: false,
      toneMapped: false,
      transparent: true,
      opacity: initNight ? 0 : 1,
    });
    const sunCore = new THREE.Mesh(sunCoreGeo, sunCoreMat);
    sunGroup.add(sunCore);

    const coronaCanvas = document.createElement('canvas');
    coronaCanvas.width = 128;
    coronaCanvas.height = 128;
    const cCtx = coronaCanvas.getContext('2d');
    if (cCtx) {
      const grad = cCtx.createRadialGradient(64, 64, 5, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255, 253, 230, 1.0)');
      grad.addColorStop(0.24, 'rgba(254, 240, 138, 0.88)');
      grad.addColorStop(0.58, 'rgba(253, 186, 116, 0.32)');
      grad.addColorStop(1, 'rgba(253, 224, 71, 0.0)');
      cCtx.fillStyle = grad;
      cCtx.fillRect(0, 0, 128, 128);
    }
    const coronaTex = new THREE.CanvasTexture(coronaCanvas);
    coronaTex.colorSpace = THREE.SRGBColorSpace;
    const coronaMat = new THREE.SpriteMaterial({
      map: coronaTex,
      transparent: true,
      opacity: initNight ? 0 : 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const sunCorona = new THREE.Sprite(coronaMat);
    sunCorona.scale.set(34, 34, 1);
    sunGroup.add(sunCorona);
    scene.add(sunGroup);
    sunGroupRef.current = sunGroup;

    // Visible 3D Moon + soft silver halo + Night starfield
    const moonGroup = new THREE.Group();
    const moonGeo = new THREE.SphereGeometry(3.9, 24, 24);
    const moonMat = new THREE.MeshBasicMaterial({
      color: 0xf1f5f9,
      fog: false,
      toneMapped: false,
      transparent: true,
      opacity: initNight ? 1 : 0,
    });
    const moonMesh = new THREE.Mesh(moonGeo, moonMat);
    moonGroup.add(moonMesh);

    const moonHaloCanvas = document.createElement('canvas');
    moonHaloCanvas.width = 128;
    moonHaloCanvas.height = 128;
    const mCtx = moonHaloCanvas.getContext('2d');
    if (mCtx) {
      const grad = mCtx.createRadialGradient(64, 64, 6, 64, 64, 64);
      grad.addColorStop(0, 'rgba(241, 245, 249, 0.95)');
      grad.addColorStop(0.32, 'rgba(186, 230, 253, 0.42)');
      grad.addColorStop(1, 'rgba(148, 163, 184, 0.0)');
      mCtx.fillStyle = grad;
      mCtx.fillRect(0, 0, 128, 128);
    }
    const moonHaloTex = new THREE.CanvasTexture(moonHaloCanvas);
    moonHaloTex.colorSpace = THREE.SRGBColorSpace;
    const moonHaloMat = new THREE.SpriteMaterial({
      map: moonHaloTex,
      transparent: true,
      opacity: initNight ? 0.9 : 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const moonHalo = new THREE.Sprite(moonHaloMat);
    moonHalo.scale.set(24, 24, 1);
    moonGroup.add(moonHalo);
    moonGroup.visible = initNight;
    scene.add(moonGroup);
    moonGroupRef.current = moonGroup;

    const starCount = 420;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      // Deterministic pseudo-random sky stars on upper dome
      const s1 = Math.sin(i * 12.9898) * 43758.5453;
      const s2 = Math.sin(i * 78.233) * 24634.6345;
      const u = s1 - Math.floor(s1);
      const v = s2 - Math.floor(s2);
      const theta = u * Math.PI * 2;
      const phi = Math.acos(0.12 + v * 0.88);
      const r = 126;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xf8fafc,
      size: 1.35,
      sizeAttenuation: true,
      transparent: true,
      opacity: initNight ? 0.9 : 0,
      fog: false,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.visible = initNight;
    scene.add(stars);
    starsRef.current = stars;

    // Crisp multi-face architectural lighting rig (Sky hemisphere + Sun key + Sky fill + Floor-to-ceiling bounce)
    const hemi = new THREE.HemisphereLight(0xd8ecff, 0x475569, 0.36);
    scene.add(hemi);
    hemiLightRef.current = hemi;

    const maxHardwareShadow = renderer.capabilities.maxTextureSize || 2048;
    const shadowMapSize = isSoftwareGl
      ? 512
      : Math.min(maxHardwareShadow, initGx.shadowResolution);
    const keyLight = new THREE.DirectionalLight(0xfffaf0, 1.72);
    keyLight.position.set(10, 14, 9);
    keyLight.castShadow = !isSoftwareGl && settingsRef.current.shadowsEnabled;
    keyLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    keyLight.shadow.camera.left = -14;
    keyLight.shadow.camera.right = 14;
    keyLight.shadow.camera.top = 14;
    keyLight.shadow.camera.bottom = -14;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 65;
    keyLight.shadow.bias = -0.00015;
    keyLight.shadow.normalBias = 0.008;
    keyLight.shadow.radius = initGx.shadowSoftness;
    scene.add(keyLight);
    scene.add(keyLight.target);
    keyLightRef.current = keyLight;

    const rimLight = new THREE.DirectionalLight(0xbfdbfe, 0.32);
    rimLight.position.set(-11, 8, -10);
    scene.add(rimLight);
    rimLightRef.current = rimLight;

    // Upward floor-to-ceiling radiosity bounce fill so enclosed ceilings read with realistic depth
    const bounceLight = new THREE.DirectionalLight(0xf3ede2, 0.16);
    bounceLight.position.set(0, -10, 0);
    bounceLight.target.position.set(0, 2, 0);
    scene.add(bounceLight);
    scene.add(bounceLight.target);
    bounceLightRef.current = bounceLight;

    // Ground slab + metric grid (driven cleanly by 3D timeOfDay3d, never UI darkMode)
    const groundGeo = new THREE.PlaneGeometry(140, 140);
    const groundMat = new THREE.MeshStandardMaterial({
      color: initNight ? 0x0b1222 : 0xe2e8f0,
      roughness: 0.95,
      metalness: 0,
    });
    groundMatRef.current = groundMat;
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = !isSoftwareGl;
    scene.add(ground);

    const gridHelper = new THREE.GridHelper(40, 40, 0x94a3b8, 0xcbd5e1);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);
    gridHelperRef.current = gridHelper;

    const contentGroup = new THREE.Group();
    scene.add(contentGroup);
    contentGroupRef.current = contentGroup;

    // On-demand render scheduler with software-WebGL afterDraw pacing
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastClock = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function updateHideFrontWalls() {
      if (presetRef.current === 'walkthrough' || !settingsRef.current.hideFrontWalls) {
        for (const item of wallGroupsRef.current) item.group.visible = true;
        return;
      }
      _scratchVec.copy(camera.position).sub(controls.target).normalize();
      for (const item of wallGroupsRef.current) {
        const dot = item.normalX * _scratchVec.x + item.normalZ * _scratchVec.z;
        item.group.visible = dot < 0.35;
      }
    }

    function exitWalkMode() {
      if (presetRef.current !== 'walkthrough') return;
      walkKeysRef.current.clear();
      hoverMouseLastRef.current = null;
      if (document.pointerLockElement === renderer.domElement) {
        programmaticUnlockRef.current = true;
        try {
          document.exitPointerLock?.();
        } catch {
          // Ignore pointer lock exit errors
        }
      }
      onCameraPresetChangeRef.current(lastOrbitPresetRef.current || 'perspective');
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        renderDirty = false;
        const dt = Math.min(0.05, Math.max(0.001, (now - lastClock) / 1000));
        lastClock = now;

        let keepAnimating = false;
        if (presetRef.current === 'walkthrough') {
          const keys = walkKeysRef.current;
          const forward =
            (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
            (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
          const strafe =
            (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
            (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
          const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
          const ascend = keys.has('Space');
          const descend = keys.has('KeyQ');
          const eyeHeightM = THREE.MathUtils.clamp(
            (settingsRef.current.walkEyeHeightMm ?? 1630) / 1000,
            1.0,
            2.1
          );
          const collisionEnabled = settingsRef.current.walkCollisionEnabled ?? true;

          const nextWalk = resolveWalkStep(
            walkStateRef.current,
            { forward, strafe, sprint, jump: ascend, ascend, descend },
            walkCollidersRef.current,
            levelRef.current.rooms,
            levelRef.current.ceilingHeightMm,
            settingsRef.current.cutawayEnabled,
            ceilingModeRef.current === 'off',
            dt,
            { collisionEnabled }
          );
          walkStateRef.current = nextWalk;
          camera.position.set(nextWalk.x, nextWalk.feetY + eyeHeightM, nextWalk.z);
          camera.rotation.set(nextWalk.pitch, nextWalk.yaw, 0, 'YXZ');

          const moving =
            forward !== 0 ||
            strafe !== 0 ||
            ascend ||
            descend ||
            Math.hypot(nextWalk.vx, nextWalk.vz) > 0.015 ||
            Math.abs(nextWalk.vy) > 0.015 ||
            (collisionEnabled && !nextWalk.grounded);
          if (moving) keepAnimating = true;
        } else if (camTransitionRef.current.active) {
          if (isSoftwareGl) {
            camera.position.copy(camTransitionRef.current.pos);
            controls.target.copy(camTransitionRef.current.target);
            camTransitionRef.current.active = false;
          } else {
            const k = 7.5;
            camera.position.x = THREE.MathUtils.damp(camera.position.x, camTransitionRef.current.pos.x, k, dt);
            camera.position.y = THREE.MathUtils.damp(camera.position.y, camTransitionRef.current.pos.y, k, dt);
            camera.position.z = THREE.MathUtils.damp(camera.position.z, camTransitionRef.current.pos.z, k, dt);
            controls.target.x = THREE.MathUtils.damp(controls.target.x, camTransitionRef.current.target.x, k, dt);
            controls.target.y = THREE.MathUtils.damp(controls.target.y, camTransitionRef.current.target.y, k, dt);
            controls.target.z = THREE.MathUtils.damp(controls.target.z, camTransitionRef.current.target.z, k, dt);
            if (
              camera.position.distanceTo(camTransitionRef.current.pos) < 0.03 &&
              controls.target.distanceTo(camTransitionRef.current.target) < 0.03
            ) {
              camTransitionRef.current.active = false;
            } else {
              keepAnimating = true;
            }
          }
        }

        // Smooth animated Day <-> Night transition
        const targetMix = targetNightMixRef.current;
        if (Math.abs(nightMixRef.current - targetMix) > 0.004) {
          nightMixRef.current = isSoftwareGl
            ? targetMix
            : THREE.MathUtils.damp(nightMixRef.current, targetMix, 4.5, dt);
          if (Math.abs(nightMixRef.current - targetMix) <= 0.004) {
            nightMixRef.current = targetMix;
          } else {
            keepAnimating = true;
          }
        }

        const m = nightMixRef.current;
        const az = (settingsRef.current.sunAzimuthDeg * Math.PI) / 180;
        const el = (settingsRef.current.sunElevationDeg * Math.PI) / 180;
        const sunDir = new THREE.Vector3(
          Math.cos(el) * Math.cos(az),
          Math.sin(el),
          Math.cos(el) * Math.sin(az)
        ).normalize();
        const moonDir = new THREE.Vector3(
          -sunDir.x * 0.7,
          Math.max(0.32, sunDir.y * 0.85),
          -sunDir.z * 0.7
        ).normalize();
        const lowSunFactor = Math.max(0, 1 - settingsRef.current.sunElevationDeg / 28);

        const dayHorizon = new THREE.Color(lowSunFactor > 0.35 ? '#F4E8D6' : '#D4E6F9');
        const nightHorizon = new THREE.Color('#0E1A32');
        const curHorizon = dayHorizon.clone().lerp(nightHorizon, m);

        if (scene.background instanceof THREE.Color) {
          scene.background.copy(curHorizon);
        }
        if (scene.fog instanceof THREE.Fog) {
          scene.fog.color.copy(curHorizon);
        }
        if (groundMatRef.current) {
          groundMatRef.current.color.setHex(0xe2e8f0).lerp(new THREE.Color(0x0b1222), m);
        }
        if (skyMatRef.current) {
          skyMatRef.current.uniforms.uTopColor.value
            .set('#2563EB')
            .lerp(new THREE.Color('#040814'), m);
          skyMatRef.current.uniforms.uHorizonColor.value.copy(curHorizon);
          skyMatRef.current.uniforms.uGroundColor.value
            .set('#CBD5E1')
            .lerp(new THREE.Color('#070C17'), m);
          skyMatRef.current.uniforms.uSunDir.value
            .copy(sunDir)
            .lerp(moonDir, m)
            .normalize();
          skyMatRef.current.uniforms.uSunGlowColor.value
            .set(lowSunFactor > 0.35 ? '#FDE047' : '#FEF3C7')
            .lerp(new THREE.Color('#94A3B8'), m);
        }

        // Crossfade Sun & Moon + Stars
        sunGroup.visible = m < 0.99;
        sunGroup.position.copy(sunDir).multiplyScalar(95);
        sunGroup.position.y -= m * 38;
        sunCoreMat.opacity = Math.max(0, 1 - m * 1.3);
        coronaMat.opacity = Math.max(0, 1 - m * 1.3);

        moonGroup.visible = m > 0.01;
        moonGroup.position.copy(moonDir).multiplyScalar(95);
        moonGroup.position.y -= (1 - m) * 28;
        moonMat.opacity = Math.min(1, m * 1.25);
        moonHaloMat.opacity = Math.min(0.9, m * 1.15);

        stars.visible = m > 0.05;
        starMat.opacity = Math.max(0, (m - 0.1) / 0.9) * 0.9;

        // Elevation-aware sun color & smoothly interpolated Day/Night IBL + graphics settings
        const gx = graphicsRef.current;
        const envMul =
          gx.environmentMapQuality === 'off'
            ? 0
            : gx.environmentMapQuality === 'low'
              ? 0.45
              : gx.environmentMapQuality === 'medium'
                ? 0.75
                : 1.0;
        const giHemiMul =
          gx.globalIlluminationQuality === 'off'
            ? 0.55
            : gx.globalIlluminationQuality === 'low'
              ? 0.8
              : gx.globalIlluminationQuality === 'medium'
                ? 1.0
                : 1.15;
        const giRimMul =
          gx.globalIlluminationQuality === 'off'
            ? 0.4
            : gx.globalIlluminationQuality === 'low'
              ? 0.75
              : gx.globalIlluminationQuality === 'medium'
                ? 1.0
                : 1.15;
        const giBounceMul =
          gx.globalIlluminationQuality === 'off'
            ? 0
            : gx.globalIlluminationQuality === 'low'
              ? 0.55
              : gx.globalIlluminationQuality === 'medium'
                ? 1.0
                : 1.35;

        scene.environment = gx.environmentMapQuality === 'off' ? null : envTexRef.current;
        scene.environmentIntensity = THREE.MathUtils.lerp(0.22, 0.11, m) * envMul;
        renderer.toneMappingExposure = THREE.MathUtils.lerp(0.96, 0.94, m) * gx.exposure;
        if (bloomPassRef.current) {
          bloomPassRef.current.enabled = gx.bloomIntensity > 0.005;
          bloomPassRef.current.threshold = THREE.MathUtils.lerp(1.38, 1.24, m);
          bloomPassRef.current.strength =
            THREE.MathUtils.lerp(0.055, 0.12, m) * gx.bloomIntensity;
          bloomPassRef.current.radius = THREE.MathUtils.lerp(0.26, 0.28, m);
        }
        if (gtaoPassRef.current) {
          const aoActive =
            !isSoftwareGl &&
            gx.ambientOcclusionQuality !== 'off' &&
            gx.ambientOcclusionIntensity > 0.005;
          gtaoPassRef.current.enabled = aoActive;
          gtaoPassRef.current.blendIntensity = gx.ambientOcclusionIntensity;
        }
        if (bokehPassRef.current) {
          bokehPassRef.current.enabled = !isSoftwareGl && gx.depthOfFieldEnabled;
          const bokehUniforms = bokehPassRef.current.uniforms as Record<string, THREE.IUniform>;
          bokehUniforms.focus.value = gx.depthOfFieldFocusM;
          bokehUniforms.aperture.value = gx.depthOfFieldAperture * 0.0012;
        }
        if (smaaPassRef.current) {
          smaaPassRef.current.enabled = !isSoftwareGl && gx.antiAliasing === 'smaa';
        }
        if (colorGradePassRef.current) {
          colorGradePassRef.current.uniforms['uContrast'].value = gx.contrast;
          colorGradePassRef.current.uniforms['uVignette'].value = gx.vignetteIntensity;
          colorGradePassRef.current.enabled =
            Math.abs(gx.contrast - 1.0) > 0.005 || gx.vignetteIntensity > 0.005;
        }
        if (fxaaPassRef.current) {
          fxaaPassRef.current.enabled = !isSoftwareGl && gx.antiAliasing === 'fxaa';
        }
        if (hemiLightRef.current) {
          hemiLightRef.current.intensity = THREE.MathUtils.lerp(0.36, 0.22, m) * giHemiMul;
          hemiLightRef.current.color.setHex(0xd8ecff).lerp(new THREE.Color(0x1e293b), m);
          hemiLightRef.current.groundColor.setHex(0x475569).lerp(new THREE.Color(0x0f172a), m);
        }
        if (keyLightRef.current) {
          const daySunColor = new THREE.Color(lowSunFactor > 0.4 ? '#FFD8A8' : '#FFF9EF');
          keyLightRef.current.intensity = THREE.MathUtils.lerp(1.72, 0.42, m);
          keyLightRef.current.color.copy(daySunColor).lerp(new THREE.Color('#93C5FD'), m);
          const { cx, cz, radius } = planBoundsRef.current;
          const distR = Math.max(18, radius * 1.9);
          const activeDir = sunDir.clone().lerp(moonDir, m).normalize();
          keyLightRef.current.position.set(
            cx + activeDir.x * distR,
            Math.max(4, activeDir.y * distR),
            cz + activeDir.z * distR
          );
          keyLightRef.current.target.position.set(cx, 0, cz);
          keyLightRef.current.target.updateMatrixWorld();
        }
        if (rimLightRef.current) {
          rimLightRef.current.intensity = THREE.MathUtils.lerp(0.32, 0.18, m) * giRimMul;
          rimLightRef.current.color.setHex(0xbfdbfe).lerp(new THREE.Color(0x60a5fa), m);
        }
        if (bounceLightRef.current) {
          bounceLightRef.current.intensity = THREE.MathUtils.lerp(0.16, 0.06, m) * giBounceMul;
          bounceLightRef.current.color.setHex(0xf3ede2).lerp(new THREE.Color(0x334155), m);
        }
        for (const item of windowAreaLightsRef.current) {
          item.light.intensity = item.baseIntensity * THREE.MathUtils.lerp(0.55, 0.12, m);
          item.light.color.setHex(0xeef6ff).lerp(new THREE.Color(0x60a5fa), m);
        }
        for (const item of activeLampLightsRef.current) {
          item.light.intensity = item.baseIntensity * THREE.MathUtils.lerp(0.24, 0.62, m);
        }
        for (const item of emissiveTargetsRef.current) {
          const dayMul = item.alwaysVisible ? 0.85 : 0.38;
          const nightMul = item.alwaysVisible ? 0.94 : 0.78;
          item.mat.emissiveIntensity = item.baseIntensity * THREE.MathUtils.lerp(dayMul, nightMul, m);
        }

        if (presetRef.current !== 'walkthrough') {
          controls.update();
        }
        updateHideFrontWalls();

        if (composerRef.current && !isSoftwareGl) {
          composerRef.current.render();
        } else {
          renderer.render(scene, camera);
        }

        const done = () => {
          renderBusy = false;
          if (renderDirty || keepAnimating) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    requestRenderRef.current = requestRender;
    setTextureReadyCallback(() => requestRenderRef.current());

    controls.addEventListener('start', () => {
      camTransitionRef.current.active = false;
    });
    controls.addEventListener('change', () => {
      if (presetRef.current !== 'walkthrough') {
        requestRender();
      }
    });

    // 175cm Walk Mode keyboard & mouse-look handlers (no dragging required; Escape exits back to 3D)
    const onKeyDown = (e: KeyboardEvent) => {
      if (presetRef.current !== 'walkthrough') return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exitWalkMode();
        return;
      }

      if (e.code === 'KeyC' && !e.repeat) {
        e.preventDefault();
        const nextVal = !(settingsRef.current.walkCollisionEnabled ?? true);
        onUpdateSettingsRef.current({ walkCollisionEnabled: nextVal });
        requestRender();
        return;
      }

      if (
        e.code === 'KeyW' ||
        e.code === 'KeyS' ||
        e.code === 'KeyA' ||
        e.code === 'KeyD' ||
        e.code === 'KeyQ' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight' ||
        e.code === 'Space' ||
        e.code === 'ShiftLeft' ||
        e.code === 'ShiftRight'
      ) {
        if (e.code.startsWith('Arrow') || e.code === 'Space') {
          e.preventDefault();
        }
        walkKeysRef.current.add(e.code);
        requestRender();
      }
    };

    const onWalkWheel = (e: WheelEvent) => {
      if (presetRef.current !== 'walkthrough') return;
      if (
        document.pointerLockElement !== renderer.domElement &&
        e.target !== renderer.domElement
      ) {
        return;
      }
      if (Math.abs(e.deltaY) < 0.5) return;
      e.preventDefault();
      const curMm = settingsRef.current.walkEyeHeightMm ?? 1630;
      const stepMm = e.deltaY < 0 ? 40 : -40;
      const nextMm = THREE.MathUtils.clamp(Math.round((curMm + stepMm) / 10) * 10, 1000, 2100);
      if (nextMm === curMm) return;
      onUpdateSettingsRef.current({ walkEyeHeightMm: nextMm });
      camera.position.y = walkStateRef.current.feetY + nextMm / 1000;
      requestRender();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (walkKeysRef.current.delete(e.code) && presetRef.current === 'walkthrough') {
        requestRender();
      }
    };

    const onWindowBlur = () => {
      walkKeysRef.current.clear();
      hoverMouseLastRef.current = null;
    };

    const onWalkMouseMove = (e: MouseEvent) => {
      if (presetRef.current !== 'walkthrough') return;
      let dx = 0;
      let dy = 0;

      if (document.pointerLockElement === renderer.domElement) {
        if (skipLockSpikeRef.current > 0) {
          skipLockSpikeRef.current -= 1;
          return;
        }
        const rawDx = e.movementX || 0;
        const rawDy = e.movementY || 0;
        // Guard against browser synthetic pointer-lock warp jumps
        if (Math.abs(rawDx) > 180 || Math.abs(rawDy) > 180) {
          return;
        }
        dx = THREE.MathUtils.clamp(rawDx, -45, 45);
        dy = THREE.MathUtils.clamp(rawDy, -45, 45);
      } else if (e.target === renderer.domElement) {
        // Zero-drag mouse look fallback when cursor moves over canvas without pointer lock
        if (hoverMouseLastRef.current) {
          const rawDx = e.clientX - hoverMouseLastRef.current.x;
          const rawDy = e.clientY - hoverMouseLastRef.current.y;
          dx = THREE.MathUtils.clamp(rawDx, -45, 45);
          dy = THREE.MathUtils.clamp(rawDy, -45, 45);
        }
        hoverMouseLastRef.current = { x: e.clientX, y: e.clientY };
      } else {
        hoverMouseLastRef.current = null;
        return;
      }

      if (dx === 0 && dy === 0) return;
      const sensitivity = 0.0021;
      const ws = walkStateRef.current;
      ws.yaw -= dx * sensitivity;
      ws.pitch = THREE.MathUtils.clamp(ws.pitch - dy * sensitivity, -Math.PI * 0.45, Math.PI * 0.45);
      camera.rotation.set(ws.pitch, ws.yaw, 0, 'YXZ');
      requestRender();
    };

    const onCanvasMouseLeave = () => {
      hoverMouseLastRef.current = null;
    };

    const onCanvasClick = () => {
      if (presetRef.current !== 'walkthrough') return;
      if (document.pointerLockElement !== renderer.domElement) {
        try {
          const maybePromise = renderer.domElement.requestPointerLock?.() as unknown as Promise<void> | undefined;
          if (maybePromise && typeof maybePromise.catch === 'function') {
            maybePromise.catch(() => {});
          }
        } catch {
          // Hover mouse-look remains active if pointer lock is restricted
        }
      }
    };

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      const wasLocked = isPointerLockedRef.current;
      isPointerLockedRef.current = locked;
      setPointerLocked(locked);
      hoverMouseLastRef.current = null;
      if (locked) {
        skipLockSpikeRef.current = 2;
      }

      if (wasLocked && !locked) {
        if (!programmaticUnlockRef.current && presetRef.current === 'walkthrough') {
          // Browser consumed Escape to unlock pointer -> exit walk view back to 3D orbit view
          walkKeysRef.current.clear();
          onCameraPresetChangeRef.current(lastOrbitPresetRef.current || 'perspective');
        }
        programmaticUnlockRef.current = false;
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('wheel', onWalkWheel, { passive: false, capture: true });
    document.addEventListener('mousemove', onWalkMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    renderer.domElement.addEventListener('mouseleave', onCanvasMouseLeave);
    renderer.domElement.addEventListener('click', onCanvasClick);

    // ResizeObserver
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(100, entry.contentRect.width);
        const h = Math.max(100, entry.contentRect.height);
        const dpr = getEffectiveDpr(graphicsRef.current.renderScale, isSoftwareGl);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h);
        if (composerRef.current) {
          composerRef.current.setPixelRatio(dpr);
          composerRef.current.setSize(w, h);
        }
        if (gtaoPassRef.current) {
          gtaoPassRef.current.setSize(w, h);
        }
        if (bloomPassRef.current) {
          bloomPassRef.current.resolution.set(w, h);
        }
        if (bokehPassRef.current) {
          bokehPassRef.current.setSize(w, h);
        }
        if (smaaPassRef.current) {
          smaaPassRef.current.setSize(w * dpr, h * dpr);
        }
        if (fxaaPassRef.current) {
          fxaaPassRef.current.uniforms['resolution'].value.set(
            1 / Math.max(1, w * dpr),
            1 / Math.max(1, h * dpr)
          );
        }
        requestRender();
      }
    });
    ro.observe(container);

    if (onCanvasReady) {
      onCanvasReady(() => {
        if (composerRef.current && !isSoftwareGl) {
          composerRef.current.render();
        } else {
          renderer.render(scene, camera);
        }
        return renderer.domElement.toDataURL('image/png');
      });
    }

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    requestRender();

    return () => {
      setTextureReadyCallback(null);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('wheel', onWalkWheel, { capture: true });
      document.removeEventListener('mousemove', onWalkMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      renderer.domElement.removeEventListener('mouseleave', onCanvasMouseLeave);
      renderer.domElement.removeEventListener('click', onCanvasClick);
      if (document.pointerLockElement === renderer.domElement) {
        programmaticUnlockRef.current = true;
        try {
          document.exitPointerLock?.();
        } catch {
          // Ignore unmount pointer lock release errors
        }
      }
      controls.dispose();
      gtaoPassRef.current?.dispose();
      bokehPassRef.current?.dispose();
      smaaPassRef.current?.dispose();
      bloomPassRef.current?.dispose();
      composerRef.current?.dispose();
      composerRtRef.current?.dispose();
      envTexRef.current?.dispose();
      envTexRef.current = null;
      skyGeo.dispose();
      skyMat.dispose();
      sunCoreGeo.dispose();
      sunCoreMat.dispose();
      coronaTex.dispose();
      coronaMat.dispose();
      moonGeo.dispose();
      moonMat.dispose();
      moonHaloTex.dispose();
      moonHaloMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      gridHelper.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Sync scene settings (3D Day/Night target, sun position, FOV, shadows & lightweight graphics uniforms)
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const keyLight = keyLightRef.current;
    const grid = gridHelperRef.current;
    const container = mountRef.current;
    if (!scene || !camera || !renderer || !keyLight) return;

    targetNightMixRef.current = (settings.timeOfDay3d ?? 'day') === 'night' ? 1 : 0;

    const az = (settings.sunAzimuthDeg * Math.PI) / 180;
    const el = (settings.sunElevationDeg * Math.PI) / 180;
    const sunDir = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).normalize();

    if (grid) grid.visible = settings.showGrid;

    camera.fov = getEffectiveFovDeg(presetRef.current, settings.fovDeg);
    camera.updateProjectionMatrix();

    const dpr = getEffectiveDpr(graphicsSettings.renderScale, isSoftwareGlRef.current);
    const w = container?.clientWidth || 800;
    const h = container?.clientHeight || 600;
    if (Math.abs(renderer.getPixelRatio() - dpr) > 0.01) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h);
      if (composerRef.current) {
        composerRef.current.setPixelRatio(dpr);
        composerRef.current.setSize(w, h);
      }
      if (smaaPassRef.current) {
        smaaPassRef.current.setSize(w * dpr, h * dpr);
      }
    }
    if (fxaaPassRef.current) {
      fxaaPassRef.current.uniforms['resolution'].value.set(
        1 / Math.max(1, w * dpr),
        1 / Math.max(1, h * dpr)
      );
    }

    renderer.shadowMap.enabled = !isSoftwareGlRef.current && settings.shadowsEnabled;
    keyLight.castShadow = !isSoftwareGlRef.current && settings.shadowsEnabled;
    keyLight.shadow.radius = graphicsSettings.shadowSoftness;
    const targetShadowType =
      graphicsSettings.shadowSoftness <= 0.35 ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    if (renderer.shadowMap.type !== targetShadowType) {
      renderer.shadowMap.type = targetShadowType;
      renderer.shadowMap.needsUpdate = true;
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((mat) => {
              mat.needsUpdate = true;
            });
          } else if (mesh.material) {
            mesh.material.needsUpdate = true;
          }
        }
      });
    }

    if (gtaoPassRef.current && graphicsSettings.ambientOcclusionQuality !== 'off') {
      const samples =
        graphicsSettings.ambientOcclusionQuality === 'high'
          ? 24
          : graphicsSettings.ambientOcclusionQuality === 'medium'
            ? 14
            : 8;
      gtaoPassRef.current.updateGtaoMaterial({
        radius: 0.42,
        distanceExponent: 1.5,
        thickness: 1.2,
        samples,
      });
    }

    const { cx, cz, radius } = planBoundsRef.current;
    const distR = Math.max(18, radius * 1.9);
    keyLight.position.set(
      cx + sunDir.x * distR,
      Math.max(4, sunDir.y * distR),
      cz + sunDir.z * distR
    );
    keyLight.target.position.set(cx, 0, cz);
    keyLight.target.updateMatrixWorld();
    const shadowHalf = Math.min(
      graphicsSettings.shadowDistanceM * 0.65,
      Math.max(10, radius + 3)
    );
    keyLight.shadow.camera.left = -shadowHalf;
    keyLight.shadow.camera.right = shadowHalf;
    keyLight.shadow.camera.top = shadowHalf;
    keyLight.shadow.camera.bottom = -shadowHalf;
    keyLight.shadow.camera.far = Math.max(distR * 2.5, graphicsSettings.shadowDistanceM * 2.2);
    keyLight.shadow.camera.updateProjectionMatrix();

    requestRenderRef.current();
  }, [
    settings.timeOfDay3d,
    settings.fovDeg,
    settings.shadowsEnabled,
    settings.showGrid,
    settings.sunAzimuthDeg,
    settings.sunElevationDeg,
    graphicsSettings.renderScale,
    graphicsSettings.globalIlluminationQuality,
    graphicsSettings.shadowSoftness,
    graphicsSettings.shadowDistanceM,
    graphicsSettings.environmentMapQuality,
    graphicsSettings.bloomIntensity,
    graphicsSettings.exposure,
    graphicsSettings.contrast,
    graphicsSettings.ambientOcclusionQuality,
    graphicsSettings.ambientOcclusionIntensity,
    graphicsSettings.antiAliasing,
    graphicsSettings.depthOfFieldEnabled,
    graphicsSettings.depthOfFieldFocusM,
    graphicsSettings.depthOfFieldAperture,
    graphicsSettings.vignetteIntensity,
  ]);

  // Close Graphics popover cleanly on Escape or outside pointerdown
  useEffect(() => {
    if (!showGraphicsPopover) return;
    const onPointerDown = (e: PointerEvent) => {
      const wrap = graphicsPopoverWrapRef.current;
      if (wrap && !wrap.contains(e.target as Node)) {
        setShowGraphicsPopover(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowGraphicsPopover(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showGraphicsPopover]);

  // 3. Camera preset transitions & 175cm Walk Mode entry/exit
  useEffect(() => {
    const isWalk = cameraPreset === 'walkthrough';
    const wasWalk = prevCameraPresetRef.current === 'walkthrough';
    prevCameraPresetRef.current = cameraPreset;
    setWalkHint(isWalk);

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;

    if (camera) {
      camera.fov = getEffectiveFovDeg(cameraPreset, settingsRef.current.fovDeg);
      camera.updateProjectionMatrix();
    }

    if (isWalk) {
      walkCollidersRef.current = buildWalkColliders(level, settingsRef.current);
      camTransitionRef.current.active = false;
      if (controls) {
        controls.enabled = false;
      }
      if (!wasWalk) {
        const spawn = findSafeWalkSpawn(level, walkCollidersRef.current);
        walkStateRef.current = {
          x: spawn.x,
          feetY: spawn.feetY,
          z: spawn.z,
          vx: 0,
          vy: 0,
          vz: 0,
          yaw: spawn.yaw,
          pitch: -0.02,
          grounded: true,
        };
        walkKeysRef.current.clear();
        hoverMouseLastRef.current = null;
        if (camera) {
          const eyeHeightM = THREE.MathUtils.clamp(
            (settingsRef.current.walkEyeHeightMm ?? 1630) / 1000,
            1.0,
            2.1
          );
          camera.rotation.order = 'YXZ';
          camera.position.set(spawn.x, spawn.feetY + eyeHeightM, spawn.z);
          camera.rotation.set(-0.02, spawn.yaw, 0, 'YXZ');
        }
      }
      requestRenderRef.current();
      return;
    }

    // Exiting walk mode back to 3D orbit view
    walkKeysRef.current.clear();
    hoverMouseLastRef.current = null;
    if (renderer && document.pointerLockElement === renderer.domElement) {
      programmaticUnlockRef.current = true;
      try {
        document.exitPointerLock?.();
      } catch {
        // Ignore
      }
    }
    if (camera) {
      camera.rotation.order = 'XYZ';
    }
    if (controls) {
      controls.enabled = true;
    }

    const center = new THREE.Vector3(0, 1.55, 0);
    if (level.walls.length > 0) {
      let sx = 0;
      let sz = 0;
      for (const w of level.walls) {
        sx += w.start.x + w.end.x;
        sz += w.start.y + w.end.y;
      }
      center.set(sx / (level.walls.length * 2000), 1.55, sz / (level.walls.length * 2000));
    }

    let pos = new THREE.Vector3(center.x + 7.5, 3.4, center.z + 9.5);
    let target = center.clone();

    if (cameraPreset === 'isometric') {
      pos = new THREE.Vector3(center.x + 11, 11, center.z + 11);
    } else if (cameraPreset === 'top') {
      pos = new THREE.Vector3(center.x, 16, center.z + 0.15);
      target = new THREE.Vector3(center.x, 0, center.z);
    } else if (cameraPreset === 'front') {
      pos = new THREE.Vector3(center.x, 2.2, center.z + 14);
    } else if (cameraPreset === 'back') {
      pos = new THREE.Vector3(center.x, 2.2, center.z - 14);
    } else if (cameraPreset === 'left') {
      pos = new THREE.Vector3(center.x - 14, 2.2, center.z);
    } else if (cameraPreset === 'right') {
      pos = new THREE.Vector3(center.x + 14, 2.2, center.z);
    } else if (cameraPreset === 'section' && level.sectionLine) {
      const mx = (level.sectionLine.start.x + level.sectionLine.end.x) / 2000;
      const mz = (level.sectionLine.start.y + level.sectionLine.end.y) / 2000;
      const dx = (level.sectionLine.end.x - level.sectionLine.start.x) / 1000;
      const dz = (level.sectionLine.end.y - level.sectionLine.start.y) / 1000;
      const len = Math.hypot(dx, dz) || 1;
      const sign = level.sectionLine.flipDirection ? -1 : 1;
      const nx = (-dz / len) * sign;
      const nz = (dx / len) * sign;
      target = new THREE.Vector3(mx, 1.3, mz);
      pos = new THREE.Vector3(mx + nx * 11, 2.6, mz + nz * 11);
    }

    camTransitionRef.current = { active: true, pos, target };
    requestRenderRef.current();
  }, [cameraPreset, level.sectionLine, level.walls]);

  // 4. Rebuild 3D architectural geometry whenever level/settings/selection changes
  useEffect(() => {
    const contentGroup = contentGroupRef.current;
    const renderer = rendererRef.current;
    if (!contentGroup || !renderer) return;
    let activeBuild = true;

    // Keep physical walk colliders synchronized with current plan geometry
    walkCollidersRef.current = buildWalkColliders(level, settings);

    // Dispose previous children cleanly (including PointLight shadow maps)
    contentGroup.traverse((obj) => {
      if ((obj as THREE.Light).isLight && 'shadow' in obj) {
        (obj as THREE.PointLight | THREE.DirectionalLight | THREE.SpotLight).shadow?.map?.dispose();
      }
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.LineSegments).isLineSegments) {
        const m = obj as THREE.Mesh | THREE.LineSegments;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material?.dispose();
      }
    });
    contentGroup.clear();
    wallGroupsRef.current = [];
    lampLightsRef.current = [];
    activeLampLightsRef.current = [];
    emissiveTargetsRef.current = [];
    windowAreaLightsRef.current = [];

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const isSoft = isSoftwareGlRef.current;
    const castShadows = !isSoft && settings.shadowsEnabled;

    const targetShadowRes = isSoft
      ? 512
      : Math.min(renderer.capabilities.maxTextureSize || 2048, graphicsSettings.shadowResolution);
    const keyLight = keyLightRef.current;
    if (keyLight && keyLight.shadow.mapSize.x !== targetShadowRes) {
      keyLight.shadow.map?.dispose();
      keyLight.shadow.map = null;
      keyLight.shadow.mapSize.set(targetShadowRes, targetShadowRes);
      renderer.shadowMap.needsUpdate = true;
    }

    // Active section clipping plane
    const clippingPlanes: THREE.Plane[] = [];
    if (level.sectionLine?.active) {
      const p1 = new THREE.Vector3(level.sectionLine.start.x / 1000, 0, level.sectionLine.start.y / 1000);
      const p2 = new THREE.Vector3(level.sectionLine.end.x / 1000, 0, level.sectionLine.end.y / 1000);
      const dir = p2.clone().sub(p1).normalize();
      const normal = new THREE.Vector3(-dir.z, 0, dir.x);
      if (level.sectionLine.flipDirection) normal.negate();
      clippingPlanes.push(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p1));
    }

    const matOpts: ArchitecturalMaterialOptions = {
      maxAnisotropy: maxAniso,
      anisotropyLevel: graphicsSettings.anisotropicFiltering,
      textureResolution: graphicsSettings.textureResolution,
      textureFiltering: graphicsSettings.textureFiltering,
      materialQuality: graphicsSettings.materialQuality,
      reflectionQuality: graphicsSettings.reflectionQuality,
      transparentQuality: graphicsSettings.transparentMaterialQuality,
      clippingPlanes,
      isSoftwareGl: isSoft,
    };

    // Update dynamic shadow frustum bounds from plan geometry
    let bMinX = Infinity;
    let bMaxX = -Infinity;
    let bMinZ = Infinity;
    let bMaxZ = -Infinity;
    for (const w of level.walls) {
      bMinX = Math.min(bMinX, w.start.x / 1000, w.end.x / 1000);
      bMaxX = Math.max(bMaxX, w.start.x / 1000, w.end.x / 1000);
      bMinZ = Math.min(bMinZ, w.start.y / 1000, w.end.y / 1000);
      bMaxZ = Math.max(bMaxZ, w.start.y / 1000, w.end.y / 1000);
    }
    if (Number.isFinite(bMinX)) {
      const cx = (bMinX + bMaxX) / 2;
      const cz = (bMinZ + bMaxZ) / 2;
      const rad = Math.max(8, Math.hypot(bMaxX - bMinX, bMaxZ - bMinZ) / 2);
      planBoundsRef.current = { cx, cz, radius: rad };
      const kl = keyLightRef.current;
      if (kl) {
        const az = (settings.sunAzimuthDeg * Math.PI) / 180;
        const el = (settings.sunElevationDeg * Math.PI) / 180;
        const distR = Math.max(18, rad * 1.9);
        kl.position.set(
          cx + Math.cos(el) * Math.cos(az) * distR,
          Math.max(4, Math.sin(el) * distR),
          cz + Math.cos(el) * Math.sin(az) * distR
        );
        kl.target.position.set(cx, 0, cz);
        kl.target.updateMatrixWorld();
        const shadowHalf = Math.min(
          graphicsSettings.shadowDistanceM * 0.65,
          Math.max(10, rad + 3)
        );
        kl.shadow.camera.left = -shadowHalf;
        kl.shadow.camera.right = shadowHalf;
        kl.shadow.camera.top = shadowHalf;
        kl.shadow.camera.bottom = -shadowHalf;
        kl.shadow.camera.far = Math.max(distR * 2.5, graphicsSettings.shadowDistanceM * 2.2);
        kl.shadow.camera.updateProjectionMatrix();
      }
    }

    // A. Rooms (Floors + visible Ceilings)
    if (level.layers.rooms) {
      for (const room of level.rooms) {
        if (!room.visible || room.polygon.length < 3) continue;
        const shape = new THREE.Shape();
        room.polygon.forEach((pt, idx) => {
          const x = pt.x / 1000;
          const y = -pt.y / 1000; // rotated -PI/2 around X maps shape.y -> -z
          if (idx === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
        });
        shape.closePath();

        const floorGeo = new THREE.ShapeGeometry(shape);
        const floorMat = buildArchitecturalMaterial(room.floorMaterial, room.floorColor, {
          ...matOpts,
          scale: room.floorTextureScale * 2.5,
          rotDeg: room.floorTextureRotDeg,
        });
        const floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.y = room.floorLevelMm / 1000 + 0.004;
        floorMesh.receiveShadow = castShadows;
        contentGroup.add(floorMesh);

        // Visible ceiling with full solar shadow blocking (solid slab in walk/solid mode; opaque shadow caster + translucent top in auto orbit)
        if (room.hasCeiling && ceilingMode !== 'off' && !settings.cutawayEnabled && cameraPreset !== 'top') {
          const ceilY = room.ceilingHeightMm / 1000;
          const solidSlabMode = ceilingMode === 'solid' || cameraPreset === 'walkthrough';

          if (solidSlabMode) {
            const slabGeo = new THREE.ExtrudeGeometry(shape, {
              depth: 0.09,
              bevelEnabled: false,
            });
            const slabMat = buildArchitecturalMaterial(room.ceilingMaterial, room.ceilingColor, {
              ...matOpts,
            });
            slabMat.side = THREE.DoubleSide;
            slabMat.shadowSide = THREE.DoubleSide;
            const slabMesh = new THREE.Mesh(slabGeo, slabMat);
            slabMesh.rotation.x = -Math.PI / 2;
            slabMesh.position.y = ceilY - 0.004;
            slabMesh.castShadow = castShadows;
            slabMesh.receiveShadow = castShadows;
            contentGroup.add(slabMesh);
          } else {
            // Auto orbit mode: solid ceiling underside casts opaque shadows to block overhead sunlight cleanly,
            // while semi-transparent roof skin lets orbit cameras look down into the floorplan.
            const ceilDownMat = buildArchitecturalMaterial(room.ceilingMaterial, room.ceilingColor, {
              ...matOpts,
            });
            ceilDownMat.side = THREE.BackSide; // Faces -Y into room
            ceilDownMat.shadowSide = THREE.DoubleSide; // Casts shadows from overhead sun AND interior lamps
            const ceilDownMesh = new THREE.Mesh(floorGeo.clone(), ceilDownMat);
            ceilDownMesh.rotation.x = -Math.PI / 2;
            ceilDownMesh.position.y = ceilY;
            ceilDownMesh.castShadow = castShadows;
            ceilDownMesh.receiveShadow = castShadows;
            contentGroup.add(ceilDownMesh);

            const ceilUpMat = buildArchitecturalMaterial(room.ceilingMaterial, room.ceilingColor, {
              ...matOpts,
            });
            ceilUpMat.side = THREE.FrontSide;
            ceilUpMat.transparent = true;
            ceilUpMat.opacity = 0.28;
            ceilUpMat.depthWrite = false;
            const ceilUpMesh = new THREE.Mesh(floorGeo.clone(), ceilUpMat);
            ceilUpMesh.rotation.x = -Math.PI / 2;
            ceilUpMesh.position.y = ceilY + 0.014;
            ceilUpMesh.castShadow = false;
            ceilUpMesh.receiveShadow = castShadows;
            contentGroup.add(ceilUpMesh);
          }
        }
      }

      // Extend connected room ceilings onto abutting balcony slabs (only if connected to a room with a ceiling)
      if (
        level.layers.archElements &&
        ceilingMode !== 'off' &&
        !settings.cutawayEnabled &&
        cameraPreset !== 'top'
      ) {
        const solidSlabMode = ceilingMode === 'solid' || cameraPreset === 'walkthrough';
        for (const el of level.archElements as ArchElement[]) {
          if (!el.visible || el.type !== 'balcony') continue;
          const connectedRoom = findConnectedRoomForBalcony(el, level.rooms, level.walls);
          if (!connectedRoom || !connectedRoom.hasCeiling) continue;

          const corners = getChimneyWorldCorners(
            el.xMm,
            el.yMm,
            el.widthMm,
            el.depthMm,
            el.rotationDeg
          );
          if (corners.length < 3) continue;
          const bShape = new THREE.Shape();
          corners.forEach((pt, idx) => {
            const x = pt.x / 1000;
            const y = -pt.y / 1000;
            if (idx === 0) bShape.moveTo(x, y);
            else bShape.lineTo(x, y);
          });
          bShape.closePath();

          const ceilY = connectedRoom.ceilingHeightMm / 1000;
          if (solidSlabMode) {
            const slabGeo = new THREE.ExtrudeGeometry(bShape, {
              depth: 0.09,
              bevelEnabled: false,
            });
            const slabMat = buildArchitecturalMaterial(
              connectedRoom.ceilingMaterial,
              connectedRoom.ceilingColor,
              { ...matOpts }
            );
            slabMat.side = THREE.DoubleSide;
            slabMat.shadowSide = THREE.DoubleSide;
            const slabMesh = new THREE.Mesh(slabGeo, slabMat);
            slabMesh.rotation.x = -Math.PI / 2;
            slabMesh.position.y = ceilY - 0.004;
            slabMesh.castShadow = castShadows;
            slabMesh.receiveShadow = castShadows;
            contentGroup.add(slabMesh);
          } else {
            const ceilPlaneGeo = new THREE.ShapeGeometry(bShape);
            const ceilDownMat = buildArchitecturalMaterial(
              connectedRoom.ceilingMaterial,
              connectedRoom.ceilingColor,
              { ...matOpts }
            );
            ceilDownMat.side = THREE.BackSide;
            ceilDownMat.shadowSide = THREE.DoubleSide;
            const ceilDownMesh = new THREE.Mesh(ceilPlaneGeo, ceilDownMat);
            ceilDownMesh.rotation.x = -Math.PI / 2;
            ceilDownMesh.position.y = ceilY;
            ceilDownMesh.castShadow = castShadows;
            ceilDownMesh.receiveShadow = castShadows;
            contentGroup.add(ceilDownMesh);

            const ceilUpMat = buildArchitecturalMaterial(
              connectedRoom.ceilingMaterial,
              connectedRoom.ceilingColor,
              { ...matOpts }
            );
            ceilUpMat.side = THREE.FrontSide;
            ceilUpMat.transparent = true;
            ceilUpMat.opacity = 0.28;
            ceilUpMat.depthWrite = false;
            const ceilUpMesh = new THREE.Mesh(ceilPlaneGeo.clone(), ceilUpMat);
            ceilUpMesh.rotation.x = -Math.PI / 2;
            ceilUpMesh.position.y = ceilY + 0.014;
            ceilUpMesh.castShadow = false;
            ceilUpMesh.receiveShadow = castShadows;
            contentGroup.add(ceilUpMesh);
          }
        }
      }
    }

    // B. Walls with Cutouts for Doors, Windows, Arches & Resolved Physical Inner/Outer Faces
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
          clippingPlanes,
        });
        const baseboardMat =
          wall.hasBaseboard && wall.baseboardHeightMm > 0
            ? new THREE.MeshStandardMaterial({
                color: new THREE.Color(wall.baseboardColor || '#E2E8F0'),
                roughness: 0.6,
                clippingPlanes,
              })
            : undefined;
        const crownMat =
          wall.hasCrownMolding && !settings.cutawayEnabled && wall.crownHeightMm > 0
            ? new THREE.MeshStandardMaterial({
                color: new THREE.Color(wall.crownColor || '#FFFFFF'),
                roughness: 0.5,
                clippingPlanes,
              })
            : undefined;

        const built = buildWall3DGroup(wall, {
          rooms: level.rooms,
          allWalls: level.walls,
          openings: level.openings,
          cutawayEnabled: settings.cutawayEnabled,
          cutawayHeightMm: settings.cutawayHeightMm,
          castShadows,
          innerMat,
          outerMat,
          coreMat,
          baseboardMat,
          crownMat,
          onCurvedSegmentGeo: (segGeo, i) => applyWorldSpaceUVs(segGeo, 1.0, i * 17),
        });
        if (!built) continue;

        contentGroup.add(built.wallGroup);
        wallGroupsRef.current.push({
          group: built.wallGroup,
          normalX: built.normalX,
          normalZ: built.normalZ,
        });
      }
    }

    // C. Openings (Doors, Windows, Arches in 3D)
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
          clippingPlanes,
        });

        // Omit rectangular jambs & header on borderless/curved arches so no square border appears in 3D
        const showRectFrame =
          op.category !== 'arch' ||
          op.subtype === 'frame_only' ||
          op.subtype === 'passthrough';

        if (showRectFrame && !(op.category === 'window' && op.subtype === 'round')) {
          const jambL = new THREE.Mesh(new THREE.BoxGeometry(fThick, h, thick), frameMat);
          jambL.position.set(-w / 2 + fThick / 2, sill + h / 2, 0);
          jambL.castShadow = castShadows;
          jambL.receiveShadow = castShadows;
          opGroup.add(jambL);

          const jambR = new THREE.Mesh(new THREE.BoxGeometry(fThick, h, thick), frameMat);
          jambR.position.set(w / 2 - fThick / 2, sill + h / 2, 0);
          jambR.castShadow = castShadows;
          jambR.receiveShadow = castShadows;
          opGroup.add(jambR);

          if (!isSlicedTop) {
            const head = new THREE.Mesh(new THREE.BoxGeometry(w, fThick, thick), frameMat);
            head.position.set(0, sill + h - fThick / 2, 0);
            head.castShadow = castShadows;
            head.receiveShadow = castShadows;
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
            opGroup.add(ring);
            const disc = new THREE.Mesh(
              new THREE.CylinderGeometry(Math.max(0.06, r - fThick), Math.max(0.06, r - fThick), 0.016, 24),
              glassMat
            );
            disc.rotation.x = Math.PI / 2;
            disc.scale.set(w / (2 * r), 1, h / (2 * r));
            disc.position.set(0, sill + h / 2, 0);
            disc.castShadow = false;
            disc.receiveShadow = false;
            disc.renderOrder = 12;
            opGroup.add(disc);
          } else {
            const isEuroWindow = op.subtype.startsWith('euro_');
            const isFullHeightWindow = op.subtype === 'floor_to_ceiling' || op.subtype === 'euro_terrace';

            if (!isFullHeightWindow) {
              const sillMesh = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, fThick, thick + 0.04), frameMat);
              sillMesh.position.set(0, sill + fThick / 2, 0);
              sillMesh.castShadow = castShadows;
              sillMesh.receiveShadow = castShadows;
              opGroup.add(sillMesh);
            } else if (isEuroWindow) {
              const thresholdMesh = new THREE.Mesh(new THREE.BoxGeometry(w, fThick * 0.7, thick), frameMat);
              thresholdMesh.position.set(0, sill + (fThick * 0.7) / 2, 0);
              thresholdMesh.castShadow = castShadows;
              thresholdMesh.receiveShadow = castShadows;
              opGroup.add(thresholdMesh);
            }

            const glassW = Math.max(0.1, w - fThick * 2);
            const glassH = Math.max(0.1, isSlicedTop ? h - fThick : h - fThick * 2);
            const glassCenterY = isSlicedTop ? sill + fThick + glassH / 2 : sill + h / 2;
            if (op.subtype !== 'casement' && op.subtype !== 'awning') {
              const glass = new THREE.Mesh(new THREE.BoxGeometry(glassW, glassH, 0.016), glassMat);
              glass.position.set(0, glassCenterY, 0);
              glass.castShadow = false;
              glass.receiveShadow = false;
              glass.renderOrder = 12;
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
                mullion.position.set(mx, sill + h / 2, 0);
                mullion.castShadow = castShadows;
                opGroup.add(mullion);
              }
              if (isEuroWindow) {
                // European PVC inner casement sash borders & tilt-turn handles
                const sashMat = new THREE.MeshStandardMaterial({
                  color: new THREE.Color(op.panelColor || op.frameColor || '#F8FAFC'),
                  roughness: 0.35,
                  metalness: 0.05,
                  clippingPlanes,
                });
                const pvcHandleMat = new THREE.MeshStandardMaterial({
                  color: 0xcbd5e1,
                  roughness: 0.25,
                  metalness: 0.85,
                  clippingPlanes,
                });
                const subW = glassW / panelCount;
                const sashThick = 0.036;
                const sashD = 0.055;
                for (let pIdx = 0; pIdx < panelCount; pIdx++) {
                  const cx = -glassW / 2 + subW * (pIdx + 0.5);
                  const topBar = new THREE.Mesh(new THREE.BoxGeometry(subW - 0.02, sashThick, sashD), sashMat);
                  topBar.position.set(cx, sill + fThick + glassH - sashThick / 2, 0);
                  const botBar = new THREE.Mesh(new THREE.BoxGeometry(subW - 0.02, sashThick, sashD), sashMat);
                  botBar.position.set(cx, sill + fThick + sashThick / 2, 0);
                  const leftBar = new THREE.Mesh(new THREE.BoxGeometry(sashThick, glassH, sashD), sashMat);
                  leftBar.position.set(cx - subW / 2 + sashThick / 2 + 0.01, sill + h / 2, 0);
                  const rightBar = new THREE.Mesh(new THREE.BoxGeometry(sashThick, glassH, sashD), sashMat);
                  rightBar.position.set(cx + subW / 2 - sashThick / 2 - 0.01, sill + h / 2, 0);
                  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.11, 0.045), pvcHandleMat);
                  handle.position.set(
                    cx + (pIdx === 0 && panelCount > 1 ? subW / 2 - 0.045 : -subW / 2 + 0.045),
                    sill + h * 0.45,
                    sashD / 2 + 0.015
                  );
                  opGroup.add(topBar, botBar, leftBar, rightBar, handle);
                }
              }
            } else if (op.subtype === 'casement') {
              // Casement angled open sash
              const sashPivot = new THREE.Group();
              sashPivot.position.set(-w / 2 + fThick, sill + h / 2, 0);
              sashPivot.rotation.y = -0.35;
              const sash = new THREE.Mesh(new THREE.BoxGeometry(glassW * 0.96, glassH * 0.96, 0.025), glassMat);
              sash.position.x = glassW / 2;
              sash.castShadow = false;
              sash.receiveShadow = false;
              sash.renderOrder = 12;
              sashPivot.add(sash);
              opGroup.add(sashPivot);
            } else if (op.subtype === 'awning') {
              // Top-hinged tilted sash
              const sashPivot = new THREE.Group();
              sashPivot.position.set(0, sill + h - fThick, 0);
              sashPivot.rotation.x = 0.35;
              const sash = new THREE.Mesh(new THREE.BoxGeometry(glassW * 0.96, glassH * 0.96, 0.025), glassMat);
              sash.position.y = -glassH / 2;
              sash.castShadow = false;
              sash.receiveShadow = false;
              sash.renderOrder = 12;
              sashPivot.add(sash);
              opGroup.add(sashPivot);
            }
          }
        } else if (op.category === 'door' && op.subtype !== 'doorframe') {
          const panelMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(op.panelColor),
            roughness: 0.6,
            metalness: 0.05,
            clippingPlanes,
          });
          const handleMat = new THREE.MeshStandardMaterial({
            color: 0x94a3b8,
            roughness: 0.25,
            metalness: 0.85,
            clippingPlanes,
          });
          const innerW = Math.max(0.2, w - fThick * 2);
          const leafH = Math.max(0.1, h - fThick);
          const openRad = (op.openAngleDeg * Math.PI) / 180;
          const swingSign = op.swingDirection === 'in' ? 1 : -1;
          const dirSign = op.swingSide === 'left' ? 1 : -1;

          const buildLeafWithHandle = (
            lw: number,
            lh: number,
            glazedMode: 'none' | 'french' | 'pvc_balcony',
            handleSideSign: number
          ) => {
            const g = new THREE.Group();
            if (glazedMode !== 'none') {
              const isBalcony = glazedMode === 'pvc_balcony';
              const stileW = isBalcony ? Math.min(0.078, lw * 0.16) : Math.min(0.09, lw * 0.2);
              const railH = isBalcony ? Math.min(0.082, lh * 0.09) : Math.min(0.11, lh * 0.12);
              const botMult = isBalcony ? 1.65 : 1.4;
              const leafDepth = isBalcony ? 0.058 : 0.044;
              const leftStile = new THREE.Mesh(new THREE.BoxGeometry(stileW, lh, leafDepth), panelMat);
              leftStile.position.set(-lw / 2 + stileW / 2, lh / 2, 0);
              const rightStile = new THREE.Mesh(new THREE.BoxGeometry(stileW, lh, leafDepth), panelMat);
              rightStile.position.set(lw / 2 - stileW / 2, lh / 2, 0);
              const topRail = new THREE.Mesh(new THREE.BoxGeometry(lw, railH, leafDepth), panelMat);
              topRail.position.set(0, lh - railH / 2, 0);
              const botRail = new THREE.Mesh(new THREE.BoxGeometry(lw, railH * botMult, leafDepth), panelMat);
              botRail.position.set(0, (railH * botMult) / 2, 0);
              const paneMat = buildArchitecturalMaterial('glass', op.glassColor || '#E0F2FE', matOpts);
              const pane = new THREE.Mesh(
                new THREE.BoxGeometry(
                  Math.max(0.05, lw - stileW * 2),
                  Math.max(0.1, lh - railH * (1 + botMult)),
                  0.016
                ),
                paneMat
              );
              pane.position.set(0, railH * botMult + (lh - railH * (1 + botMult)) / 2, 0);
              pane.renderOrder = 12;
              [leftStile, rightStile, topRail, botRail].forEach((m) => {
                m.castShadow = castShadows;
                m.receiveShadow = castShadows;
                g.add(m);
              });
              g.add(pane);
            } else {
              const leaf = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, 0.044), panelMat);
              leaf.position.set(0, lh / 2, 0);
              leaf.castShadow = castShadows;
              leaf.receiveShadow = castShadows;
              g.add(leaf);
              if (op.subtype === 'entrance') {
                const vision = new THREE.Mesh(
                  new THREE.BoxGeometry(Math.min(0.16, lw * 0.22), lh * 0.58, 0.05),
                  buildArchitecturalMaterial('glass', op.glassColor || '#BAE6FD', matOpts)
                );
                vision.position.set(-handleSideSign * lw * 0.18, lh * 0.54, 0);
                vision.renderOrder = 12;
                g.add(vision);
              }
            }
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.025, 0.09), handleMat);
            handle.position.set(handleSideSign * (lw / 2 - 0.075), Math.min(1.02, lh * 0.48), 0);
            g.add(handle);
            return g;
          };

          if (op.subtype === 'double' || op.subtype === 'french' || op.subtype === 'balcony_double') {
            const glazedMode =
              op.subtype === 'balcony_double'
                ? 'pvc_balcony'
                : op.subtype === 'french'
                  ? 'french'
                  : 'none';
            const halfLeaf = innerW / 2 - 0.004;
            const pivotL = new THREE.Group();
            pivotL.position.set(-w / 2 + fThick, sill, 0);
            pivotL.rotation.y = -swingSign * openRad;
            const leafL = buildLeafWithHandle(halfLeaf, leafH, glazedMode, 1);
            leafL.position.x = halfLeaf / 2;
            pivotL.add(leafL);
            opGroup.add(pivotL);

            const pivotR = new THREE.Group();
            pivotR.position.set(w / 2 - fThick, sill, 0);
            pivotR.rotation.y = swingSign * openRad;
            const leafR = buildLeafWithHandle(halfLeaf, leafH, glazedMode, -1);
            leafR.position.x = -halfLeaf / 2;
            pivotR.add(leafR);
            opGroup.add(pivotR);
          } else if (op.subtype === 'pivot') {
            const pivotOffset = innerW * 0.22;
            const hingeX = op.swingSide === 'left' ? -innerW / 2 + pivotOffset : innerW / 2 - pivotOffset;
            const pivot = new THREE.Group();
            pivot.position.set(hingeX, sill, 0);
            pivot.rotation.y = -swingSign * dirSign * openRad;
            const leaf = buildLeafWithHandle(innerW, leafH, 'none', dirSign);
            leaf.position.x = dirSign * (innerW / 2 - pivotOffset);
            pivot.add(leaf);
            opGroup.add(pivot);
          } else if (op.subtype === 'sliding') {
            const track = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, thick * 0.8), handleMat);
            track.position.set(0, sill + leafH + 0.01, 0);
            opGroup.add(track);
            const panelW = innerW * 0.52;
            const openFrac = op.openAngleDeg / 90;
            const fixedP = buildLeafWithHandle(panelW, leafH, 'french', -dirSign);
            fixedP.position.set(-dirSign * (innerW / 2 - panelW / 2), sill, -0.025);
            const slideP = buildLeafWithHandle(panelW, leafH, 'french', dirSign);
            const closedX = dirSign * (innerW / 2 - panelW / 2);
            const openX = -dirSign * (innerW / 2 - panelW / 2);
            slideP.position.set(closedX + (openX - closedX) * openFrac, sill, 0.025);
            opGroup.add(fixedP, slideP);
          } else if (op.subtype === 'pocket') {
            const openFrac = op.openAngleDeg / 90;
            const leaf = buildLeafWithHandle(innerW, leafH, 'none', dirSign);
            leaf.position.set(dirSign * -innerW * 0.85 * openFrac, sill, 0);
            opGroup.add(leaf);
          } else if (op.subtype === 'bifold') {
            const segW = innerW / 2;
            const foldAngle = Math.min(Math.PI * 0.46, openRad * 1.15);
            const pivot1 = new THREE.Group();
            const hingeX = op.swingSide === 'left' ? -w / 2 + fThick : w / 2 - fThick;
            pivot1.position.set(hingeX, sill, 0);
            pivot1.rotation.y = -swingSign * dirSign * foldAngle;
            const seg1 = new THREE.Mesh(new THREE.BoxGeometry(segW, leafH, 0.036), panelMat);
            seg1.position.set(dirSign * (segW / 2), leafH / 2, 0);
            seg1.castShadow = castShadows;
            pivot1.add(seg1);

            const pivot2 = new THREE.Group();
            pivot2.position.set(dirSign * segW, 0, 0);
            pivot2.rotation.y = swingSign * dirSign * foldAngle * 2;
            const seg2 = buildLeafWithHandle(segW, leafH, 'none', dirSign);
            seg2.position.set(dirSign * (segW / 2), 0, 0);
            pivot2.add(seg2);
            pivot1.add(pivot2);
            opGroup.add(pivot1);
          } else if (op.subtype === 'garage') {
            const openFrac = op.openAngleDeg / 90;
            const slatCount = 4;
            const slatH = leafH / slatCount;
            const liftY = leafH * 0.85 * openFrac;
            const gLeaf = new THREE.Group();
            gLeaf.position.set(0, sill + liftY, openFrac * (leafH * 0.45) * swingSign);
            gLeaf.rotation.x = openFrac * (Math.PI * 0.46) * swingSign;
            for (let s = 0; s < slatCount; s++) {
              const slat = new THREE.Mesh(new THREE.BoxGeometry(innerW, slatH - 0.01, 0.05), panelMat);
              slat.position.set(0, (s + 0.5) * slatH, 0);
              slat.castShadow = castShadows;
              gLeaf.add(slat);
            }
            opGroup.add(gLeaf);
          } else {
            // Single, Entrance & Balcony Single hinged leaf
            const pivot = new THREE.Group();
            const hingeX = op.swingSide === 'left' ? -w / 2 + fThick : w / 2 - fThick;
            pivot.position.set(hingeX, sill, 0);
            pivot.rotation.y = -swingSign * dirSign * openRad;
            const leaf = buildLeafWithHandle(
              innerW,
              leafH,
              op.subtype === 'balcony_single' ? 'pvc_balcony' : 'none',
              dirSign
            );
            leaf.position.set(dirSign * (innerW / 2), 0, 0);
            pivot.add(leaf);
            opGroup.add(pivot);
          }
        }

        // Exterior daylight window/glazed-door RectAreaLight portals (scaled by lightQuality)
        const maxWindowPortals =
          graphicsSettings.lightQuality === 'low'
            ? 0
            : graphicsSettings.lightQuality === 'medium'
              ? 4
              : 8;
        const isGlazedPortal =
          op.category === 'window' ||
          (op.category === 'door' &&
            (op.subtype === 'french' ||
              op.subtype === 'sliding' ||
              op.subtype === 'balcony_single' ||
              op.subtype === 'balcony_double'));
        if (
          !isSoft &&
          isGlazedPortal &&
          windowAreaLightsRef.current.length < maxWindowPortals &&
          level.rooms.length > 0
        ) {
          const tLen = Math.hypot(tangent.x, tangent.y) || 1;
          const nX = -tangent.y / tLen;
          const nY = tangent.x / tLen;
          const plusInside = level.rooms.some(
            (rm) => rm.visible && pointInPolygon({ x: point.x + nX * 360, y: point.y + nY * 360 }, rm.polygon)
          );
          const minusInside = level.rooms.some(
            (rm) => rm.visible && pointInPolygon({ x: point.x - nX * 360, y: point.y - nY * 360 }, rm.polygon)
          );
          if (plusInside !== minusInside) {
            const inwardLocalZ = plusInside ? 1 : -1;
            const areaBaseIntensity = 1.45;
            const mNow = nightMixRef.current;
            const rectLight = new THREE.RectAreaLight(
              0xeef6ff,
              areaBaseIntensity * THREE.MathUtils.lerp(1.0, 0.14, mNow),
              Math.max(0.3, w * 0.88),
              Math.max(0.3, h * 0.86)
            );
            rectLight.position.set(0, sill + h / 2, inwardLocalZ * (thick * 0.55));
            rectLight.lookAt(0, sill + h / 2 - 0.35, inwardLocalZ * 3.0);
            opGroup.add(rectLight);
            windowAreaLightsRef.current.push({ light: rectLight, baseIntensity: areaBaseIntensity });
          }
        }

        contentGroup.add(opGroup);
      }
    }

    // D. Curtains & Blinds
    if (level.layers.curtains) {
      for (const c of level.curtains as Curtain[]) {
        if (!c.visible) continue;
        const cGroup = new THREE.Group();
        cGroup.position.set(c.xMm / 1000, c.elevationMm / 1000, c.yMm / 1000);
        cGroup.rotation.y = (-c.rotationDeg * Math.PI) / 180;

        const w = c.widthMm / 1000;
        const h = Math.min(c.heightMm, settings.cutawayEnabled ? settings.cutawayHeightMm : 4000) / 1000;
        const rodMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(c.rodColor),
          metalness: 0.7,
          roughness: 0.28,
          clippingPlanes,
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
              const pleat = new THREE.Mesh(
                new THREE.CylinderGeometry(0.028, 0.032, h, 8),
                fabricMat
              );
              pleat.position.set(fx, h / 2, (i % 2 === 0 ? 1 : -1) * 0.018);
              pleat.castShadow = castShadows && !isLinenDrape;
              if (isLinenDrape) pleat.renderOrder = 8;
              cGroup.add(pleat);
            }
          }
        }
        contentGroup.add(cGroup);
      }
    }

    // E. Multi-Part Procedural Furniture & Detailed Decor (+ GLB loader support)
    if (level.layers.furniture) {
      const sharedPartEdgeMat = new THREE.LineBasicMaterial({
        color: '#94A3B8',
        transparent: true,
        opacity: 0.28,
        clippingPlanes,
      });

      for (const f of level.furniture as FurnitureInstance[]) {
        if (!f.visible) continue;

        if (f.glbAssetId || f.glbDataUrl) {
          const fGroup = new THREE.Group();
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
          const glbLights = buildThreeLightsForFurniture(f, tiltGroup, {
            nightMix: nightMixRef.current,
            isSoftwareGl: isSoftwareGlRef.current,
            useLegacyFillForUnmigratedLamp: true,
          });
          for (const gl of glbLights) {
            lampLightsRef.current.push(gl);
          }

          const targetBounds = computeFurnitureBoundsMm(f.parts);
          void loadGlbObjectCached(f.glbAssetId, f.glbDataUrl).then((model) => {
            if (!model || !activeBuild) return;
            fitGlbSceneToFurnitureBounds(model, targetBounds, {
              mountingType: mType,
              mountingFace: mFace,
            });
            model.traverse((child) => {
              const mesh = child as THREE.Mesh;
              if (mesh.isMesh) {
                if (mesh.geometry && !mesh.geometry.attributes.normal) {
                  mesh.geometry.computeVertexNormals();
                }
                mesh.castShadow = castShadows;
                mesh.receiveShadow = castShadows;
              }
            });
            const glbEmissives = applyGlbEmissiveOverrides(
              model,
              f.glbEmissiveOverrides,
              nightMixRef.current,
              clippingPlanes,
              isFurnitureLightingActive(f)
            );
            for (const em of glbEmissives) {
              emissiveTargetsRef.current.push(em);
            }
            mirrorGroup.add(model);
            tiltGroup.position.y = 0;
            if (Math.abs(rxRad) > 1e-4 || Math.abs(ryRad) > 1e-4) {
              fGroup.updateMatrixWorld(true);
              const box = new THREE.Box3().setFromObject(tiltGroup);
              if (Number.isFinite(box.min.y)) {
                tiltGroup.position.y += fGroup.position.y - box.min.y;
              }
            }
            activeLampLightsRef.current = applyInteriorLightAndShadowBudget(
              lampLightsRef.current,
              nightMixRef.current,
              graphicsSettings.maxRealtimeLights,
              castShadows,
              graphicsSettings.lightQuality
            );
            requestRenderRef.current();
          });
          contentGroup.add(fGroup);
        } else {
          const built = buildProceduralFurnitureGroup(f, {
            matOpts,
            castShadows,
            clippingPlanes,
            nightMix: nightMixRef.current,
            partEdgeMat: sharedPartEdgeMat,
            kelvinToColor,
            effectiveCeilingMm: getEnclosingRoomCeilingMm(
              { x: f.xMm, y: f.yMm },
              level.rooms,
              level.ceilingHeightMm
            ),
            isSoftwareGl: isSoftwareGlRef.current,
          });
          for (const bl of built.bulbLights) {
            lampLightsRef.current.push(bl);
          }
          for (const em of built.emissiveTargets) {
            emissiveTargetsRef.current.push(em);
          }
          contentGroup.add(built.group);
        }

        // Contact shadow decal beneath grounded floor furniture
        if (graphicsSettings.contactShadows && !isSoft && f.elevationMm === 0 && !isRugFurniture(f)) {
          const mType = resolveFurnitureMountingType(f);
          if (mType === 'floor' || mType === 'freestanding') {
            const contactTex = getContactShadowTexture();
            if (contactTex) {
              const bounds = computeFurnitureBoundsMm(f.parts);
              const wM = Math.max(0.22, bounds.widthMm / 1000) * 1.12;
              const dM = Math.max(0.22, bounds.depthMm / 1000) * 1.12;
              const decalMat = new THREE.MeshBasicMaterial({
                map: contactTex,
                transparent: true,
                opacity: 0.28,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                clippingPlanes,
              });
              const decalGeo = new THREE.PlaneGeometry(wM, dM);
              const decal = new THREE.Mesh(decalGeo, decalMat);
              decal.rotation.x = -Math.PI / 2;
              decal.rotation.z = (-f.rotationDeg * Math.PI) / 180;
              decal.position.set(f.xMm / 1000, 0.007, f.yMm / 1000);
              decal.renderOrder = 1;
              contentGroup.add(decal);
            }
          }
        }
      }
    }

    // F. People Scale Figures (Detailed sculpted human models + lying-down poses)
    if (level.layers.people) {
      for (const person of level.people as PersonInstance[]) {
        if (!person.visible) continue;
        contentGroup.add(
          buildDetailedPersonGroup(person, {
            clippingPlanes,
            castShadows,
            isSoftwareGl: isSoft,
          })
        );
      }
    }

    // G. Architectural Elements (Chimneys, Stairs, Columns, Beams, Platforms, Fireplaces)
    if (level.layers.archElements) {
      for (const el of level.archElements as ArchElement[]) {
        if (!el.visible) continue;
        const aGroup = new THREE.Group();
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
        const rawH = el.connectToCeiling
          ? Math.max(200, targetCeilingMm - el.elevationMm)
          : el.heightMm;
        const h = (settings.cutawayEnabled ? Math.min(rawH, settings.cutawayHeightMm) : rawH) / 1000;

        const effectiveMatName = el.type === 'chimney' ? el.material : el.material;
        const effectiveColor = el.color;

        const mat = buildArchitecturalMaterial(effectiveMatName, effectiveColor, matOpts);
        const accentMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(el.accentColor),
          roughness: 0.4,
          metalness: 0.6,
          clippingPlanes,
        });

        if (el.type === 'chimney') {
          const faceColors = resolveChimneyFaceColors(el);
          const rightMat = buildArchitecturalMaterial(el.material, faceColors.right, matOpts);
          const leftMat = buildArchitecturalMaterial(el.material, faceColors.left, matOpts);
          const frontMat = buildArchitecturalMaterial(el.material, faceColors.front, matOpts);
          const backMat = buildArchitecturalMaterial(el.material, faceColors.back, matOpts);
          const capMat = buildArchitecturalMaterial(el.material, el.color || '#94A3B8', matOpts);
          // BoxGeometry face order: [+X (right), -X (left), +Y (top), -Y (bottom), +Z (front), -Z (back)]
          const chimMaterials = [rightMat, leftMat, capMat, capMat, frontMat, backMat];

          // Slight 0.008m flush overlap into host wall face hides seam cleanly
          const overlap = hostWall ? 0.008 : 0;
          const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d + overlap), chimMaterials);
          const signFace = el.attachedFace === 'right' ? 1 : -1;
          bodyMesh.position.set(0, h / 2, hostWall ? signFace * (overlap / 2) : 0);
          bodyMesh.castShadow = castShadows;
          bodyMesh.receiveShadow = castShadows;
          aGroup.add(bodyMesh);

          const hasBb = el.hasBaseboard ?? hostWall?.hasBaseboard;
          if (hasBb) {
            const bbH = (el.baseboardHeightMm ?? hostWall?.baseboardHeightMm ?? 90) / 1000;
            const bbMat = new THREE.MeshStandardMaterial({
              color: new THREE.Color(el.baseboardColor ?? hostWall?.baseboardColor ?? '#E2E8F0'),
              roughness: 0.6,
              clippingPlanes,
            });
            const bb = new THREE.Mesh(new THREE.BoxGeometry(w + 0.016, Math.min(h, bbH), d + 0.016), bbMat);
            bb.position.set(0, Math.min(h, bbH) / 2, 0);
            aGroup.add(bb);
          }
          const hasCr = (el.hasCrownMolding ?? hostWall?.hasCrownMolding) && !settings.cutawayEnabled;
          if (hasCr) {
            const crH = (el.crownHeightMm ?? hostWall?.crownHeightMm ?? 80) / 1000;
            const crMat = new THREE.MeshStandardMaterial({
              color: new THREE.Color(el.crownColor ?? hostWall?.crownColor ?? '#FFFFFF'),
              roughness: 0.5,
              clippingPlanes,
            });
            const cr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.022, Math.min(h, crH), d + 0.022), crMat);
            cr.position.set(0, h - Math.min(h, crH) / 2, 0);
            aGroup.add(cr);
          }
        } else if (el.type === 'column_round') {
          const shaftGeo = new THREE.CylinderGeometry(w / 2, w / 2, h, 24);
          applyWorldSpaceUVs(shaftGeo, 1.0, 19);
          const shaft = new THREE.Mesh(shaftGeo, mat);
          shaft.position.y = h / 2;
          shaft.castShadow = castShadows;
          shaft.receiveShadow = castShadows;
          const plinthGeo = new THREE.BoxGeometry(w * 1.25, 0.12, w * 1.25);
          applyWorldSpaceUVs(plinthGeo, 1.0, 23);
          const plinth = new THREE.Mesh(plinthGeo, accentMat);
          plinth.position.y = 0.06;
          aGroup.add(shaft, plinth);
        } else if (el.type === 'doorframe') {
          // Architectural Standalone Doorframe Only (left jamb, right jamb, header lintel, architrave trim, stop & threshold)
          const jambW = Math.min(w * 0.25, Math.max(0.045, Math.min(0.085, w * 0.14)));
          const sideX = w / 2 - jambW / 2;
          const clearH = Math.max(0.1, h - jambW);

          const leftJambGeo = new THREE.BoxGeometry(jambW, h, d);
          applyWorldSpaceUVs(leftJambGeo, 1.0, 31, true);
          const leftJamb = new THREE.Mesh(leftJambGeo, mat);
          leftJamb.position.set(-sideX, h / 2, 0);
          leftJamb.castShadow = castShadows;
          leftJamb.receiveShadow = castShadows;

          const rightJambGeo = new THREE.BoxGeometry(jambW, h, d);
          applyWorldSpaceUVs(rightJambGeo, 1.0, 37, true);
          const rightJamb = new THREE.Mesh(rightJambGeo, mat);
          rightJamb.position.set(sideX, h / 2, 0);
          rightJamb.castShadow = castShadows;
          rightJamb.receiveShadow = castShadows;

          const headerGeo = new THREE.BoxGeometry(Math.max(0.04, w - jambW * 2), jambW, d);
          applyWorldSpaceUVs(headerGeo, 1.0, 41, true);
          const header = new THREE.Mesh(headerGeo, mat);
          header.position.set(0, clearH + jambW / 2, 0);
          header.castShadow = castShadows;
          header.receiveShadow = castShadows;

          // Center door-stop rebate strip
          const stopMat = buildArchitecturalMaterial(el.material, el.color, matOpts);
          for (const side of [-1, 1]) {
            const vStopGeo = new THREE.BoxGeometry(0.012, clearH, 0.028);
            applyWorldSpaceUVs(vStopGeo, 1.0, 47, true);
            const vStop = new THREE.Mesh(vStopGeo, stopMat);
            vStop.position.set(side * (w / 2 - jambW - 0.006), clearH / 2, 0);
            aGroup.add(vStop);
          }
          const hStopGeo = new THREE.BoxGeometry(Math.max(0.04, w - jambW * 2), 0.012, 0.028);
          applyWorldSpaceUVs(hStopGeo, 1.0, 53, true);
          const hStop = new THREE.Mesh(hStopGeo, stopMat);
          hStop.position.set(0, clearH - 0.006, 0);

          // Proud front & back architrave casing trim
          const trimW = Math.max(0.04, jambW * 0.92);
          const trimThick = 0.016;
          for (const zSign of [-1, 1]) {
            const zPos = zSign * (d / 2 + trimThick / 2);
            const tH = h + trimW * 0.6;
            for (const xSign of [-1, 1]) {
              const trimJambGeo = new THREE.BoxGeometry(trimW, tH, trimThick);
              applyWorldSpaceUVs(trimJambGeo, 1.0, 59 + zSign + xSign, true);
              const trimJamb = new THREE.Mesh(trimJambGeo, mat);
              trimJamb.position.set(xSign * (w / 2 + trimW * 0.15), tH / 2, zPos);
              trimJamb.castShadow = castShadows;
              trimJamb.receiveShadow = castShadows;
              aGroup.add(trimJamb);
            }
            const trimTopGeo = new THREE.BoxGeometry(w + trimW * 1.22, trimW, trimThick);
            applyWorldSpaceUVs(trimTopGeo, 1.0, 67 + zSign, true);
            const trimTop = new THREE.Mesh(trimTopGeo, mat);
            trimTop.position.set(0, h + trimW * 0.1, zPos);
            trimTop.castShadow = castShadows;
            trimTop.receiveShadow = castShadows;
            aGroup.add(trimTop);
          }

          aGroup.add(leftJamb, rightJamb, header, hStop);

          if (el.hasRailing !== false) {
            const sillGeo = new THREE.BoxGeometry(Math.max(0.06, w - jambW * 1.8), 0.016, d + 0.02);
            applyWorldSpaceUVs(sillGeo, 1.0, 71, true);
            const sill = new THREE.Mesh(sillGeo, accentMat);
            sill.position.set(0, 0.008, 0);
            sill.receiveShadow = castShadows;
            aGroup.add(sill);
          }
        } else if (el.type === 'railing') {
          const rCfg = resolveRailingConfig(el);
          const rGroup = buildRailing3DGroup(
            rCfg,
            el.color || '#334155',
            matOpts,
            castShadows,
            clippingPlanes
          );
          aGroup.add(rGroup);
        } else if (el.type.startsWith('stairs')) {
          const stairGroup = buildStaircase3DGroup(
            el,
            targetCeilingMm,
            rawH / 1000,
            mat,
            accentMat,
            matOpts,
            castShadows,
            clippingPlanes
          );
          aGroup.add(stairGroup);
        } else if (el.type === 'balcony' || el.type === 'platform') {
          const geo = new THREE.BoxGeometry(w, h, d);
          applyWorldSpaceUVs(geo, 1.0, el.id.length * 13, true);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.y = h / 2;
          mesh.castShadow = castShadows;
          mesh.receiveShadow = castShadows;
          aGroup.add(mesh);

          const deckRails = buildHostDeckRailings3DGroup(
            el,
            matOpts,
            castShadows,
            clippingPlanes
          );
          if (deckRails) {
            aGroup.add(deckRails);
          }
        } else if (el.type === 'fireplace') {
          const hearthGeo = new THREE.BoxGeometry(w * 1.1, 0.12, d * 1.1);
          applyWorldSpaceUVs(hearthGeo, 1.0, 17, true);
          const hearth = new THREE.Mesh(hearthGeo, accentMat);
          hearth.position.y = 0.06;
          const surroundGeo = new THREE.BoxGeometry(w, h, d);
          applyWorldSpaceUVs(surroundGeo, 1.0, 29, true);
          const surround = new THREE.Mesh(surroundGeo, mat);
          surround.position.y = h / 2;
          const fireMat = new THREE.MeshStandardMaterial({
            color: 0xf97316,
            emissive: 0xea580c,
            emissiveIntensity: THREE.MathUtils.lerp(0.65, 1.55, nightMixRef.current),
          });
          emissiveTargetsRef.current.push({ mat: fireMat, baseIntensity: 1.4 });
          const firebox = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, h * 0.45, 0.06), fireMat);
          firebox.position.set(0, h * 0.3, d / 2 + 0.01);
          const hearthLight = new THREE.PointLight(
            0xff7a2f,
            1.6 * THREE.MathUtils.lerp(0.28, 1.85, nightMixRef.current),
            5.5,
            2
          );
          hearthLight.position.set(0, h * 0.32, d / 2 + 0.18);
          aGroup.add(hearth, surround, firebox, hearthLight);
          lampLightsRef.current.push({ light: hearthLight, baseIntensity: 1.6, isCeiling: false });
        } else {
          const geo = new THREE.BoxGeometry(w, h, d);
          applyWorldSpaceUVs(geo, 1.0, el.id.length * 13, true);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.y = h / 2;
          mesh.castShadow = castShadows;
          mesh.receiveShadow = castShadows;
          aGroup.add(mesh);
        }
        contentGroup.add(aGroup);
      }
    }

    // Enforce real-time light count budget and interior shadow budget
    activeLampLightsRef.current = applyInteriorLightAndShadowBudget(
      lampLightsRef.current,
      nightMixRef.current,
      graphicsSettings.maxRealtimeLights,
      castShadows,
      graphicsSettings.lightQuality
    );

    requestRenderRef.current();
    return () => {
      activeBuild = false;
    };
  }, [
    level,
    settings.cutawayEnabled,
    settings.cutawayHeightMm,
    settings.shadowsEnabled,
    settings.sunAzimuthDeg,
    settings.sunElevationDeg,
    cameraPreset,
    ceilingMode,
    graphicsSettings.shadowResolution,
    graphicsSettings.shadowDistanceM,
    graphicsSettings.contactShadows,
    graphicsSettings.lightQuality,
    graphicsSettings.maxRealtimeLights,
    graphicsSettings.textureResolution,
    graphicsSettings.textureFiltering,
    graphicsSettings.anisotropicFiltering,
    graphicsSettings.materialQuality,
    graphicsSettings.reflectionQuality,
    graphicsSettings.transparentMaterialQuality,
  ]);

  const handleCapturePng = () => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    if (composerRef.current && !isSoftwareGlRef.current) {
      composerRef.current.render();
    } else {
      renderer.render(scene, camera);
    }
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `plan-studio-3d-${Date.now()}.png`;
    a.click();
  };

  const handleSelectCameraPreset = (preset: CameraPreset) => {
    if (preset === 'walkthrough' && rendererRef.current) {
      try {
        const maybePromise = rendererRef.current.domElement.requestPointerLock?.() as unknown as Promise<void> | undefined;
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch(() => {});
        }
      } catch {
        // Fallback hover mouse-look works seamlessly without pointer lock
      }
    }
    onCameraPresetChange(preset);
  };

  return (
    <div
      data-testid="viewport-3d-container"
      className="relative w-full h-full overflow-hidden bg-slate-100 dark:bg-slate-950"
    >
      {/* Dedicated WebGL Mount Container outside React HUD overlays (Camera-only navigation) */}
      <div
        ref={mountRef}
        className={`w-full h-full ${
          cameraPreset === 'walkthrough'
            ? 'cursor-crosshair'
            : 'cursor-grab active:cursor-grabbing'
        }`}
      />

      {/* Subtle First-Person Reticle in Walk Mode */}
      {walkHint && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center z-10"
        >
          <div className="relative w-4 h-4 opacity-70">
            <span className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-white shadow-[0_0_2px_rgba(15,23,42,0.9)]" />
            <span className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2 bg-white shadow-[0_0_2px_rgba(15,23,42,0.9)]" />
          </div>
        </div>
      )}

      {/* Top Camera & Lighting Bar (solid/rgba surface, no backdrop-filter over WebGL) */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-1.5 pointer-events-none">
        <div className="pointer-events-auto flex flex-wrap items-center gap-0.5 p-1 rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 shadow-sm max-w-full">
          {(
            [
              { id: 'perspective', label: 'Perspective' },
              { id: 'isometric', label: 'Iso' },
              { id: 'top', label: 'Top' },
              { id: 'front', label: 'Front' },
              { id: 'back', label: 'Back' },
              { id: 'left', label: 'Left' },
              { id: 'right', label: 'Right' },
              { id: 'walkthrough', label: 'Walk' },
              { id: 'section', label: 'Section' },
            ] as const
          ).map((cam) => (
            <button
              key={cam.id}
              type="button"
              onClick={() => handleSelectCameraPreset(cam.id)}
              className={`px-1.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                cameraPreset === cam.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {cam.label}
            </button>
          ))}
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 shadow-sm text-[11px] text-slate-700 dark:text-slate-200 max-w-full">
          <label className="flex items-center gap-1">
            <Eye className="w-3.5 h-3.5 text-slate-500" />
            <span>FOV</span>
            <input
              type="range"
              min={25}
              max={85}
              value={settings.fovDeg}
              onChange={(e) => onUpdateSettings({ fovDeg: Number(e.target.value) })}
              className="w-14 accent-blue-600"
            />
            <span className="font-mono-nums w-6">{settings.fovDeg}°</span>
          </label>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <label className="flex items-center gap-1" title="Sun compass azimuth">
            <Compass className="w-3.5 h-3.5 text-slate-500" />
            <span>Sun Az</span>
            <input
              type="range"
              min={0}
              max={360}
              value={settings.sunAzimuthDeg}
              onChange={(e) => onUpdateSettings({ sunAzimuthDeg: Number(e.target.value) })}
              className="w-12 accent-blue-600"
            />
          </label>
          <label className="flex items-center gap-1" title="Sun height / elevation">
            <Sun className="w-3.5 h-3.5 text-amber-500" />
            <span>Elev</span>
            <input
              type="range"
              min={6}
              max={82}
              value={settings.sunElevationDeg}
              onChange={(e) => onUpdateSettings({ sunElevationDeg: Number(e.target.value) })}
              className="w-12 accent-blue-600"
            />
            <span className="font-mono-nums w-6">{settings.sunElevationDeg}°</span>
          </label>
          <button
            type="button"
            onClick={() =>
              setCeilingMode((m) => (m === 'auto' ? 'solid' : m === 'solid' ? 'off' : 'auto'))
            }
            title="Cycle 3D Ceiling Visibility (Auto / Solid / Off)"
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] cursor-pointer ${
              ceilingMode !== 'off'
                ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800'
                : 'border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
          >
            <Layers className="w-3 h-3" />
            Ceiling: {ceilingMode === 'auto' ? 'Auto' : ceilingMode === 'solid' ? 'Solid' : 'Off'}
          </button>
          <button
            type="button"
            onClick={() => onUpdateSettings({ shadowsEnabled: !settings.shadowsEnabled })}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] cursor-pointer ${
              settings.shadowsEnabled
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900'
                : 'border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
          >
            <Sun className="w-3 h-3" />
            Shadows
          </button>
          <div ref={graphicsPopoverWrapRef} className="relative">
            <button
              type="button"
              data-testid="viewport-graphics-btn"
              onClick={() => setShowGraphicsPopover((o) => !o)}
              aria-expanded={showGraphicsPopover}
              title="3D Graphics Quality & Post-Processing Settings"
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] cursor-pointer ${
                showGraphicsPopover
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <SlidersHorizontal className="w-3 h-3" />
              <span>Graphics</span>
              <span className="opacity-75 text-[10px] capitalize">
                · {graphicsSettings.preset}
              </span>
            </button>

            {showGraphicsPopover && (
              <div
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute right-0 top-full mt-2 w-[360px] max-w-[92vw] bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl z-30 overflow-hidden"
              >
                <GraphicsSettingsPanel
                  graphics={graphicsSettings}
                  onSelectPreset={onSelectGraphicsPreset}
                  onUpdateSetting={onUpdateGraphicsSettings}
                  onReset={onResetGraphicsSettings}
                  variant="popover"
                  onClose={() => setShowGraphicsPopover(false)}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleCapturePng}
            title="Capture 3D PNG Screenshot"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Camera className="w-3 h-3" />
            PNG
          </button>
        </div>
      </div>

      {/* Floating Animated Day / Night 3D Sky & Time Toggle (Independent from UI Theme) */}
      <button
        type="button"
        onClick={() =>
          onUpdateSettings({
            timeOfDay3d: (settings.timeOfDay3d ?? 'day') === 'night' ? 'day' : 'night',
          })
        }
        title="Toggle 3D Time of Day (Day / Night)"
        className={`absolute bottom-4 right-4 z-20 flex items-center gap-2 px-3.5 py-2 rounded-full border shadow-lg text-xs font-semibold transition-all duration-300 cursor-pointer ${
          (settings.timeOfDay3d ?? 'day') === 'night'
            ? 'bg-slate-900/95 border-indigo-400/50 text-indigo-100 hover:bg-slate-800'
            : 'bg-white/95 border-amber-300 text-slate-800 hover:bg-amber-50'
        }`}
      >
        <span className="relative w-4 h-4 flex items-center justify-center">
          <Sun
            className={`w-4 h-4 text-amber-500 transition-all duration-500 absolute ${
              (settings.timeOfDay3d ?? 'day') === 'night'
                ? 'opacity-0 rotate-90 scale-50'
                : 'opacity-100 rotate-0 scale-100'
            }`}
          />
          <Moon
            className={`w-4 h-4 text-indigo-300 transition-all duration-500 absolute ${
              (settings.timeOfDay3d ?? 'day') === 'night'
                ? 'opacity-100 rotate-0 scale-100'
                : 'opacity-0 -rotate-90 scale-50'
            }`}
          />
        </span>
        <span>{(settings.timeOfDay3d ?? 'day') === 'night' ? 'Night Sky' : 'Day Sky'}</span>
      </button>

      {walkHint && (
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-wrap items-center justify-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-900/92 border border-slate-700/80 text-white text-xs shadow-lg max-w-[92vw]"
        >
          <label className="flex items-center gap-1.5" title="Adjust first-person camera eye height">
            <span className="text-slate-300 font-medium whitespace-nowrap">Eye Height</span>
            <input
              type="range"
              min={1000}
              max={2100}
              step={10}
              value={settings.walkEyeHeightMm ?? 1630}
              onChange={(e) => {
                const nextMm = Number(e.target.value);
                onUpdateSettings({ walkEyeHeightMm: nextMm });
                if (cameraRef.current) {
                  cameraRef.current.position.y =
                    walkStateRef.current.feetY + THREE.MathUtils.clamp(nextMm / 1000, 1.0, 2.1);
                  requestRenderRef.current();
                }
              }}
              aria-label="Walk eye height"
              className="w-20 accent-blue-500 cursor-pointer"
            />
            <span className="font-mono-nums w-11 text-right text-slate-100">
              {Math.round((settings.walkEyeHeightMm ?? 1630) / 10)} cm
            </span>
          </label>
          <span className="text-slate-600">|</span>
          <button
            type="button"
            data-testid="walk-collision-toggle"
            onClick={() => {
              const nextVal = !(settings.walkCollisionEnabled ?? true);
              onUpdateSettings({ walkCollisionEnabled: nextVal });
              requestRenderRef.current();
            }}
            title="Toggle physical wall & furniture collision (disable for noclip fly-through)"
            className={`px-2 py-0.5 rounded border text-[11px] font-medium cursor-pointer transition-colors ${
              (settings.walkCollisionEnabled ?? true)
                ? 'bg-emerald-600/25 border-emerald-400/50 text-emerald-200 hover:bg-emerald-600/40'
                : 'bg-amber-600/25 border-amber-400/50 text-amber-200 hover:bg-amber-600/40'
            }`}
          >
            Collision: {(settings.walkCollisionEnabled ?? true) ? 'On' : 'Off'}
          </button>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <span className="text-slate-300 whitespace-nowrap">
            {(settings.walkCollisionEnabled ?? true)
              ? 'WASD walk · Mouse look · Scroll height · C collision'
              : 'WASD + Space/Q fly freely · Scroll height · C collision'}
            {!pointerLocked ? ' · Click view to lock cursor' : ''} · Esc exit
          </span>
        </div>
      )}
    </div>
  );
};
