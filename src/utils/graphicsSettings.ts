export type GraphicsPresetId = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type QualityTierWithOff = 'off' | 'low' | 'medium' | 'high';
export type TextureResolutionOption = 256 | 512 | 1024;
export type TextureFilterOption = 'nearest' | 'bilinear' | 'trilinear';
export type AnisotropyOption = 1 | 2 | 4 | 8 | 16;
export type MaterialQualityOption = 'standard' | 'physical';
export type TransparentQualityOption = 'standard' | 'high';
export type ShadowResolutionOption = 512 | 1024 | 2048 | 4096;
export type AntiAliasingOption = 'off' | 'fxaa' | 'smaa';
export type LightQualityOption = 'low' | 'medium' | 'high';

export interface GraphicsSettings {
  preset: GraphicsPresetId;
  renderScale: number;
  // Lighting & Shadows
  globalIlluminationQuality: QualityTierWithOff;
  shadowResolution: ShadowResolutionOption;
  shadowSoftness: number;
  shadowDistanceM: number;
  contactShadows: boolean;
  lightQuality: LightQualityOption;
  maxRealtimeLights: number;
  // Materials & Textures
  textureResolution: TextureResolutionOption;
  textureFiltering: TextureFilterOption;
  anisotropicFiltering: AnisotropyOption;
  materialQuality: MaterialQualityOption;
  reflectionQuality: QualityTierWithOff;
  environmentMapQuality: QualityTierWithOff;
  transparentMaterialQuality: TransparentQualityOption;
  // Post-processing
  bloomIntensity: number;
  exposure: number;
  contrast: number;
  ambientOcclusionQuality: QualityTierWithOff;
  ambientOcclusionIntensity: number;
  antiAliasing: AntiAliasingOption;
  depthOfFieldEnabled: boolean;
  depthOfFieldFocusM: number;
  depthOfFieldAperture: number;
  vignetteIntensity: number;
}

export type ConcreteGraphicsPresetId = Exclude<GraphicsPresetId, 'custom'>;

export const GRAPHICS_STORAGE_KEY = 'plan_studio_graphics_v1';

export const GRAPHICS_PRESETS: Record<ConcreteGraphicsPresetId, GraphicsSettings> = {
  low: {
    preset: 'low',
    renderScale: 0.85,
    globalIlluminationQuality: 'off',
    shadowResolution: 512,
    shadowSoftness: 1.0,
    shadowDistanceM: 14,
    contactShadows: false,
    lightQuality: 'low',
    maxRealtimeLights: 6,
    textureResolution: 256,
    textureFiltering: 'bilinear',
    anisotropicFiltering: 1,
    materialQuality: 'standard',
    reflectionQuality: 'off',
    environmentMapQuality: 'low',
    transparentMaterialQuality: 'standard',
    bloomIntensity: 0,
    exposure: 1.0,
    contrast: 1.0,
    ambientOcclusionQuality: 'off',
    ambientOcclusionIntensity: 0,
    antiAliasing: 'off',
    depthOfFieldEnabled: false,
    depthOfFieldFocusM: 6.0,
    depthOfFieldAperture: 0.8,
    vignetteIntensity: 0,
  },
  medium: {
    preset: 'medium',
    renderScale: 1.0,
    globalIlluminationQuality: 'low',
    shadowResolution: 1024,
    shadowSoftness: 2.0,
    shadowDistanceM: 20,
    contactShadows: false,
    lightQuality: 'medium',
    maxRealtimeLights: 12,
    textureResolution: 512,
    textureFiltering: 'trilinear',
    anisotropicFiltering: 2,
    materialQuality: 'physical',
    reflectionQuality: 'low',
    environmentMapQuality: 'medium',
    transparentMaterialQuality: 'standard',
    bloomIntensity: 0.75,
    exposure: 1.0,
    contrast: 1.0,
    ambientOcclusionQuality: 'off',
    ambientOcclusionIntensity: 0,
    antiAliasing: 'fxaa',
    depthOfFieldEnabled: false,
    depthOfFieldFocusM: 6.0,
    depthOfFieldAperture: 0.8,
    vignetteIntensity: 0,
  },
  high: {
    preset: 'high',
    renderScale: 1.5,
    globalIlluminationQuality: 'medium',
    shadowResolution: 2048,
    shadowSoftness: 2.6,
    shadowDistanceM: 28,
    contactShadows: true,
    lightQuality: 'high',
    maxRealtimeLights: 20,
    textureResolution: 512,
    textureFiltering: 'trilinear',
    anisotropicFiltering: 8,
    materialQuality: 'physical',
    reflectionQuality: 'high',
    environmentMapQuality: 'high',
    transparentMaterialQuality: 'high',
    bloomIntensity: 1.0,
    exposure: 1.0,
    contrast: 1.0,
    ambientOcclusionQuality: 'medium',
    ambientOcclusionIntensity: 0.65,
    antiAliasing: 'fxaa',
    depthOfFieldEnabled: false,
    depthOfFieldFocusM: 6.0,
    depthOfFieldAperture: 0.8,
    vignetteIntensity: 0,
  },
  ultra: {
    preset: 'ultra',
    renderScale: 2.0,
    globalIlluminationQuality: 'high',
    shadowResolution: 4096,
    shadowSoftness: 3.4,
    shadowDistanceM: 40,
    contactShadows: true,
    lightQuality: 'high',
    maxRealtimeLights: 32,
    textureResolution: 1024,
    textureFiltering: 'trilinear',
    anisotropicFiltering: 16,
    materialQuality: 'physical',
    reflectionQuality: 'high',
    environmentMapQuality: 'high',
    transparentMaterialQuality: 'high',
    bloomIntensity: 1.05,
    exposure: 1.0,
    contrast: 1.02,
    ambientOcclusionQuality: 'high',
    ambientOcclusionIntensity: 0.8,
    antiAliasing: 'smaa',
    depthOfFieldEnabled: false,
    depthOfFieldFocusM: 6.0,
    depthOfFieldAperture: 0.8,
    vignetteIntensity: 0.08,
  },
};

export const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  ...GRAPHICS_PRESETS.high,
};

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

function pickOne<T extends string | number>(val: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(val) ? (val as T) : fallback;
}

export function normalizeGraphicsSettings(raw: Partial<GraphicsSettings> | null | undefined): GraphicsSettings {
  const base = DEFAULT_GRAPHICS_SETTINGS;
  if (!raw || typeof raw !== 'object') {
    return { ...base };
  }
  const preset = pickOne(
    raw.preset,
    ['low', 'medium', 'high', 'ultra', 'custom'] as const,
    base.preset
  );
  return {
    preset,
    renderScale: clampNum(raw.renderScale, 0.75, 2.0, base.renderScale),
    globalIlluminationQuality: pickOne(
      raw.globalIlluminationQuality,
      ['off', 'low', 'medium', 'high'] as const,
      base.globalIlluminationQuality
    ),
    shadowResolution: pickOne(
      raw.shadowResolution,
      [512, 1024, 2048, 4096] as const,
      base.shadowResolution
    ),
    shadowSoftness: clampNum(raw.shadowSoftness, 0, 5, base.shadowSoftness),
    shadowDistanceM: clampNum(raw.shadowDistanceM, 12, 48, base.shadowDistanceM),
    contactShadows: typeof raw.contactShadows === 'boolean' ? raw.contactShadows : base.contactShadows,
    lightQuality: pickOne(raw.lightQuality, ['low', 'medium', 'high'] as const, base.lightQuality),
    maxRealtimeLights: Math.round(clampNum(raw.maxRealtimeLights, 4, 32, base.maxRealtimeLights)),
    textureResolution: pickOne(
      raw.textureResolution,
      [256, 512, 1024] as const,
      base.textureResolution
    ),
    textureFiltering: pickOne(
      raw.textureFiltering,
      ['nearest', 'bilinear', 'trilinear'] as const,
      base.textureFiltering
    ),
    anisotropicFiltering: pickOne(
      raw.anisotropicFiltering,
      [1, 2, 4, 8, 16] as const,
      base.anisotropicFiltering
    ),
    materialQuality: pickOne(
      raw.materialQuality,
      ['standard', 'physical'] as const,
      base.materialQuality
    ),
    reflectionQuality: pickOne(
      raw.reflectionQuality,
      ['off', 'low', 'medium', 'high'] as const,
      base.reflectionQuality
    ),
    environmentMapQuality: pickOne(
      raw.environmentMapQuality,
      ['off', 'low', 'medium', 'high'] as const,
      base.environmentMapQuality
    ),
    transparentMaterialQuality: pickOne(
      raw.transparentMaterialQuality,
      ['standard', 'high'] as const,
      base.transparentMaterialQuality
    ),
    bloomIntensity: clampNum(raw.bloomIntensity, 0, 2.0, base.bloomIntensity),
    exposure: clampNum(raw.exposure, 0.6, 1.5, base.exposure),
    contrast: clampNum(raw.contrast, 0.8, 1.3, base.contrast),
    ambientOcclusionQuality: pickOne(
      raw.ambientOcclusionQuality,
      ['off', 'low', 'medium', 'high'] as const,
      base.ambientOcclusionQuality
    ),
    ambientOcclusionIntensity: clampNum(
      raw.ambientOcclusionIntensity,
      0,
      1.5,
      base.ambientOcclusionIntensity
    ),
    antiAliasing: pickOne(raw.antiAliasing, ['off', 'fxaa', 'smaa'] as const, base.antiAliasing),
    depthOfFieldEnabled:
      typeof raw.depthOfFieldEnabled === 'boolean'
        ? raw.depthOfFieldEnabled
        : base.depthOfFieldEnabled,
    depthOfFieldFocusM: clampNum(raw.depthOfFieldFocusM, 1.5, 20, base.depthOfFieldFocusM),
    depthOfFieldAperture: clampNum(raw.depthOfFieldAperture, 0.2, 2.5, base.depthOfFieldAperture),
    vignetteIntensity: clampNum(raw.vignetteIntensity, 0, 0.5, base.vignetteIntensity),
  };
}

export function applyGraphicsPreset(presetId: ConcreteGraphicsPresetId): GraphicsSettings {
  return { ...GRAPHICS_PRESETS[presetId] };
}

export function updateGraphicsSetting(
  current: GraphicsSettings,
  partial: Partial<GraphicsSettings>
): GraphicsSettings {
  const keys = Object.keys(partial) as Array<keyof GraphicsSettings>;
  const hasIndividualChange = keys.some((k) => k !== 'preset' && partial[k] !== current[k]);
  const next = normalizeGraphicsSettings({
    ...current,
    ...partial,
    preset:
      partial.preset !== undefined
        ? partial.preset
        : hasIndividualChange
          ? 'custom'
          : current.preset,
  });
  return next;
}

export function loadGraphicsSettings(): GraphicsSettings {
  try {
    if (typeof localStorage === 'undefined') {
      return { ...DEFAULT_GRAPHICS_SETTINGS };
    }
    const raw = localStorage.getItem(GRAPHICS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GRAPHICS_SETTINGS };
    return normalizeGraphicsSettings(JSON.parse(raw) as Partial<GraphicsSettings>);
  } catch {
    return { ...DEFAULT_GRAPHICS_SETTINGS };
  }
}

export function saveGraphicsSettings(settings: GraphicsSettings): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GRAPHICS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}
