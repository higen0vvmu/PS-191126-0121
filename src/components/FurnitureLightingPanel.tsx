import React, { useEffect, useState } from 'react';
import { Plus, Sparkles, Sun, Trash2 } from 'lucide-react';
import {
  FurnitureInstance,
  FurnitureLightSource,
  FurnitureLightType,
  FurniturePart,
  GlbInspectedMaterial,
  GlbMaterialEmissiveOverride,
  ProjectSettings,
} from '../types/plan';
import { computeFurnitureBoundsMm } from '../utils/geometry';
import { loadGlbObjectCached } from '../utils/furnitureRepresentationSync';
import {
  createDefaultLightSource,
  createMatchingLightForGlbMaterial,
  createMatchingLightForPart,
  inspectGlbMaterials,
  resolveEffectiveFurnitureLights,
  resolveLightSourceHex,
} from '../utils/lighting';
import {
  resolveFurnitureMountingFace,
  resolveFurnitureMountingType,
} from '../utils/mounting';
import { MetricInput } from './MetricInput';

interface FurnitureLightingPanelProps {
  furn: FurnitureInstance;
  settings: ProjectSettings;
  onUpdateFurn: (
    patch: Partial<FurnitureInstance>,
    label?: string,
    coalesceKey?: string
  ) => void;
}

const LIGHT_TYPE_LABELS: Record<FurnitureLightType, string> = {
  point: 'Point',
  spot: 'Spot',
  area: 'Area',
  linear: 'Linear',
};

const QUICK_GLOW_SWATCHES = ['#FF8C42', '#FFB703', '#FFF3C4', '#FFFFFF', '#60A5FA', '#F472B6'];

export const FurnitureLightingPanel: React.FC<FurnitureLightingPanelProps> = ({
  furn,
  settings,
  onUpdateFurn,
}) => {
  const unit = settings.preferredUnit;
  const effectiveLights = resolveEffectiveFurnitureLights(furn);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(
    effectiveLights[0]?.id ?? null
  );
  const [glbMaterials, setGlbMaterials] = useState<GlbInspectedMaterial[]>([]);
  const [glbInspectLoading, setGlbInspectLoading] = useState(false);

  const isGlbModel = Boolean(furn.glbAssetId || furn.glbDataUrl);
  const bounds = computeFurnitureBoundsMm(furn.parts);
  const mountingType = resolveFurnitureMountingType(furn);
  const mountingFace = resolveFurnitureMountingFace(furn);

  // Sync selected light when switching furniture or adding/removing lights
  useEffect(() => {
    if (effectiveLights.length === 0) {
      setSelectedLightId(null);
    } else if (!selectedLightId || !effectiveLights.some((l) => l.id === selectedLightId)) {
      setSelectedLightId(effectiveLights[0].id);
    }
  }, [furn.id, effectiveLights.length, selectedLightId]);

  // Async GLB material inspection for emissive detection & controls
  useEffect(() => {
    let active = true;
    if (!isGlbModel) {
      setGlbMaterials([]);
      return;
    }
    setGlbInspectLoading(true);
    void loadGlbObjectCached(furn.glbAssetId, furn.glbDataUrl)
      .then((obj) => {
        if (!active) return;
        if (!obj) {
          setGlbMaterials([]);
          setGlbInspectLoading(false);
          return;
        }
        const inspected = inspectGlbMaterials(
          obj,
          {
            widthMm: bounds.widthMm,
            depthMm: bounds.depthMm,
            heightMm: bounds.heightMm,
          },
          { mountingType, mountingFace }
        );
        setGlbMaterials(inspected);
        setGlbInspectLoading(false);
      })
      .catch(() => {
        if (active) {
          setGlbMaterials([]);
          setGlbInspectLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [
    furn.id,
    furn.glbAssetId,
    furn.glbDataUrl,
    isGlbModel,
    bounds.widthMm,
    bounds.depthMm,
    bounds.heightMm,
    mountingType,
    mountingFace,
  ]);

  const commitLights = (
    nextLights: FurnitureLightSource[],
    label: string,
    coalesceKey?: string
  ) => {
    const primary = nextLights[0];
    const nextLightConfig = primary
      ? {
          enabled: primary.enabled,
          colorTempK: primary.colorTempK || 3200,
          intensity: Math.max(0.1, Math.min(2.5, primary.intensity)),
        }
      : furn.lightConfig
        ? { ...furn.lightConfig, enabled: false }
        : undefined;
    onUpdateFurn(
      {
        lights: nextLights,
        ...(nextLightConfig ? { lightConfig: nextLightConfig } : {}),
      },
      label,
      coalesceKey
    );
  };

  const addLight = (type: FurnitureLightType) => {
    const next = createDefaultLightSource(type, undefined, furn);
    const updated = [...effectiveLights, next];
    commitLights(updated, `Add ${LIGHT_TYPE_LABELS[type]} Light`);
    setSelectedLightId(next.id);
  };

  const updateLight = (
    lightId: string,
    patch: Partial<FurnitureLightSource>,
    label = 'Edit Light Source',
    coalesceKey?: string
  ) => {
    const updated = effectiveLights.map((l) => (l.id === lightId ? { ...l, ...patch } : l));
    commitLights(updated, label, coalesceKey);
  };

  const removeLight = (lightId: string) => {
    const updated = effectiveLights.filter((l) => l.id !== lightId);
    commitLights(updated, 'Remove Light Source');
    if (selectedLightId === lightId) {
      setSelectedLightId(updated[0]?.id ?? null);
    }
  };

  const activeLight = effectiveLights.find((l) => l.id === selectedLightId) ?? effectiveLights[0] ?? null;

  const upsertGlbOverride = (
    mat: GlbInspectedMaterial,
    patch: Partial<GlbMaterialEmissiveOverride>,
    label = 'Edit Emissive Material',
    coalesceKey?: string
  ) => {
    const existing = (furn.glbEmissiveOverrides ?? []).find(
      (o) => o.materialKey === mat.materialKey
    );
    const defaultColor =
      mat.emissiveHex !== '#000000'
        ? mat.emissiveHex
        : mat.baseColorHex !== '#000000'
          ? mat.baseColorHex
          : '#FF8C42';
    const base: GlbMaterialEmissiveOverride = existing ?? {
      materialKey: mat.materialKey,
      materialName: mat.materialName,
      meshNames: mat.meshNames,
      enabled: mat.emissiveDetected && !mat.emissiveDisabled,
      emissiveColor: defaultColor,
      emissiveIntensity: Math.max(1.2, mat.emissiveIntensity || 1.4),
      bloomBoost: 1.25,
      preserveEmissiveMap: mat.hasEmissiveMap,
    };
    const nextOv = { ...base, ...patch };
    const nextList = [
      ...(furn.glbEmissiveOverrides ?? []).filter((o) => o.materialKey !== mat.materialKey),
      nextOv,
    ];
    onUpdateFurn({ glbEmissiveOverrides: nextList }, label, coalesceKey);
  };

  const updatePartEmissive = (
    part: FurniturePart,
    patch: Partial<FurniturePart>,
    label = 'Edit Part Glow',
    coalesceKey?: string
  ) => {
    onUpdateFurn(
      {
        parts: furn.parts.map((p) => (p.id === part.id ? { ...p, ...patch } : p)),
      },
      label,
      coalesceKey
    );
  };

  return (
    <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 space-y-2.5">
      {/* Section Header + Quick Add Multi-Type Light Buttons */}
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
          <Sun className="w-3.5 h-3.5 text-amber-500" />
          Lighting &amp; Emissive Glow
        </span>
        <span className="text-[10px] font-mono-nums text-slate-400">
          {effectiveLights.length} source{effectiveLights.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {(['point', 'spot', 'area', 'linear'] as const).map((t) => (
          <button
            key={t}
            type="button"
            disabled={furn.locked}
            onClick={() => addLight(t)}
            className="py-1 px-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-0.5 cursor-pointer disabled:opacity-40"
          >
            <Plus className="w-2.5 h-2.5" />
            <span>{LIGHT_TYPE_LABELS[t]}</span>
          </button>
        ))}
      </div>

      {/* Light Sources List */}
      {effectiveLights.length > 0 && (
        <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
          {effectiveLights.map((light) => {
            const isSel = activeLight?.id === light.id;
            const hex = resolveLightSourceHex(light);
            return (
              <div
                key={light.id}
                className={`flex items-center justify-between gap-1.5 px-2 py-1 rounded border transition-colors ${
                  isSel
                    ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/35'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedLightId(light.id)}
                  className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0"
                    style={{ backgroundColor: light.enabled ? hex : '#64748B' }}
                  />
                  <span className="truncate font-medium text-[11px] text-slate-800 dark:text-slate-200">
                    {light.name}
                  </span>
                  <span className="px-1 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-[9px] text-slate-600 dark:text-slate-400 uppercase shrink-0">
                    {light.type}
                  </span>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={furn.locked}
                    onClick={() =>
                      updateLight(
                        light.id,
                        { enabled: !light.enabled },
                        light.enabled ? 'Turn Light Off' : 'Turn Light On'
                      )
                    }
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-pointer ${
                      light.enabled
                        ? 'bg-amber-500/15 border-amber-500/60 text-amber-700 dark:text-amber-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-500'
                    }`}
                  >
                    {light.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    type="button"
                    disabled={furn.locked}
                    onClick={() => removeLight(light.id)}
                    aria-label={`Remove ${light.name}`}
                    className="p-0.5 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Light Source Controls */}
      {activeLight && (
        <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">Name</label>
              <input
                type="text"
                disabled={furn.locked}
                value={activeLight.name}
                onChange={(e) =>
                  updateLight(
                    activeLight.id,
                    { name: e.target.value },
                    'Rename Light Source',
                    `light_name_${activeLight.id}`
                  )
                }
                className="w-full px-1.5 py-1 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-0.5">Type</label>
              <select
                disabled={furn.locked}
                value={activeLight.type}
                onChange={(e) => {
                  const nextType = e.target.value as FurnitureLightType;
                  updateLight(
                    activeLight.id,
                    {
                      type: nextType,
                      aimElevationDeg:
                        nextType === 'point'
                          ? 0
                          : activeLight.aimElevationDeg === 0
                            ? -75
                            : activeLight.aimElevationDeg,
                      widthMm:
                        activeLight.widthMm ?? (nextType === 'linear' ? 750 : 400),
                      lengthMm:
                        nextType === 'linear'
                          ? Math.min(80, activeLight.lengthMm ?? 45)
                          : activeLight.lengthMm ?? 400,
                    },
                    'Change Light Type'
                  );
                }}
                className="w-full px-1.5 py-1 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
              >
                <option value="point">Point Light (360°)</option>
                <option value="spot">Spotlight (Cone)</option>
                <option value="area">Area Light (Panel)</option>
                <option value="linear">Linear Light (Strip)</option>
              </select>
            </div>
          </div>

          {/* Color Mode: Temperature (Kelvin) vs Custom Color */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Color</span>
              <div className="inline-flex rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => updateLight(activeLight.id, { colorMode: 'kelvin' })}
                  className={`px-1.5 py-0.5 text-[10px] cursor-pointer ${
                    activeLight.colorMode === 'kelvin'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium'
                      : 'bg-white dark:bg-slate-900 text-slate-500'
                  }`}
                >
                  Kelvin
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateLight(activeLight.id, {
                      colorMode: 'hex',
                      colorHex: resolveLightSourceHex(activeLight),
                    })
                  }
                  className={`px-1.5 py-0.5 text-[10px] cursor-pointer ${
                    activeLight.colorMode === 'hex'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium'
                      : 'bg-white dark:bg-slate-900 text-slate-500'
                  }`}
                >
                  Custom RGB
                </button>
              </div>
            </div>

            {activeLight.colorMode === 'kelvin' ? (
              <div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
                  <span>Warmth ↔ Coolness</span>
                  <span className="font-mono-nums font-medium text-slate-700 dark:text-slate-300">
                    {activeLight.colorTempK}K
                  </span>
                </div>
                <div className="h-1.5 rounded-full mb-1 bg-gradient-to-r from-amber-500 via-amber-100 to-sky-300" />
                <input
                  type="range"
                  disabled={furn.locked}
                  min={1800}
                  max={6500}
                  step={100}
                  value={activeLight.colorTempK}
                  onChange={(e) =>
                    updateLight(
                      activeLight.id,
                      { colorTempK: Number(e.target.value) },
                      'Adjust Light Temp',
                      `light_k_${activeLight.id}`
                    )
                  }
                  className="w-full accent-amber-500"
                />
              </div>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  type="color"
                  disabled={furn.locked}
                  value={activeLight.colorHex}
                  onChange={(e) =>
                    updateLight(
                      activeLight.id,
                      { colorHex: e.target.value.toUpperCase() },
                      'Pick Light Color',
                      `light_hex_${activeLight.id}`
                    )
                  }
                  className="w-7 h-6 rounded border border-slate-300 dark:border-slate-700 p-0 cursor-pointer"
                />
                <span className="font-mono-nums text-[10px] text-slate-600 dark:text-slate-300">
                  {activeLight.colorHex}
                </span>
                <div className="flex items-center gap-1 ml-auto">
                  {QUICK_GLOW_SWATCHES.map((sw) => (
                    <button
                      key={sw}
                      type="button"
                      onClick={() => updateLight(activeLight.id, { colorHex: sw })}
                      aria-label={`Color ${sw}`}
                      className="w-4 h-4 rounded-sm border border-black/20 cursor-pointer"
                      style={{ backgroundColor: sw }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Brightness / Intensity & Decay */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>Intensity</span>
                <span className="font-mono-nums">{Math.round(activeLight.intensity * 100)}%</span>
              </div>
              <input
                type="range"
                disabled={furn.locked}
                min={0.05}
                max={4.0}
                step={0.05}
                value={activeLight.intensity}
                onChange={(e) =>
                  updateLight(
                    activeLight.id,
                    { intensity: Number(e.target.value) },
                    'Adjust Light Intensity',
                    `light_int_${activeLight.id}`
                  )
                }
                className="w-full accent-amber-500"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>Falloff</span>
                <span className="font-mono-nums">{activeLight.decay.toFixed(1)}</span>
              </div>
              <input
                type="range"
                disabled={furn.locked}
                min={1.0}
                max={2.0}
                step={0.1}
                value={activeLight.decay}
                onChange={(e) =>
                  updateLight(
                    activeLight.id,
                    { decay: Number(e.target.value) },
                    'Adjust Light Attenuation',
                    `light_dec_${activeLight.id}`
                  )
                }
                className="w-full accent-blue-600"
              />
            </div>
          </div>

          {/* Local Offsets & Range */}
          <div>
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
              <span>Local Position &amp; Range</span>
              <span className="text-[9px] text-blue-600 dark:text-blue-400">
                Drag dot on 2D plan
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <MetricInput
                label="Offset X"
                valueMm={activeLight.xMm}
                unit={unit}
                minMm={-4000}
                maxMm={4000}
                onChangeMm={(mm) =>
                  updateLight(activeLight.id, { xMm: mm }, 'Move Light Offset X')
                }
              />
              <MetricInput
                label="Offset Y"
                valueMm={activeLight.yMm}
                unit={unit}
                minMm={-4000}
                maxMm={4000}
                onChangeMm={(mm) =>
                  updateLight(activeLight.id, { yMm: mm }, 'Move Light Offset Y')
                }
              />
              <MetricInput
                label="Height Z"
                valueMm={activeLight.zMm}
                unit={unit}
                minMm={-500}
                maxMm={4000}
                onChangeMm={(mm) =>
                  updateLight(activeLight.id, { zMm: mm }, 'Adjust Light Height')
                }
              />
              <MetricInput
                label="Range"
                valueMm={activeLight.rangeMm}
                unit={unit}
                minMm={300}
                maxMm={20000}
                onChangeMm={(mm) =>
                  updateLight(activeLight.id, { rangeMm: mm }, 'Adjust Light Range')
                }
              />
            </div>
          </div>

          {/* Directional Aim Controls for Spot / Area / Linear */}
          {activeLight.type !== 'point' && (
            <div className="space-y-1.5 pt-1 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span>Direction &amp; Aim</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      updateLight(activeLight.id, { aimElevationDeg: -90 }, 'Aim Down')
                    }
                    className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[9px] cursor-pointer"
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateLight(
                        activeLight.id,
                        { aimAzimuthDeg: 0, aimElevationDeg: -20 },
                        'Aim Forward'
                      )
                    }
                    className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[9px] cursor-pointer"
                  >
                    Forward
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateLight(activeLight.id, { aimElevationDeg: 75 }, 'Aim Up')
                    }
                    className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[9px] cursor-pointer"
                  >
                    Up
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Azimuth</span>
                    <span className="font-mono-nums">{activeLight.aimAzimuthDeg}°</span>
                  </div>
                  <input
                    type="range"
                    disabled={furn.locked}
                    min={-180}
                    max={180}
                    step={5}
                    value={activeLight.aimAzimuthDeg}
                    onChange={(e) =>
                      updateLight(
                        activeLight.id,
                        { aimAzimuthDeg: Number(e.target.value) },
                        'Aim Light Azimuth',
                        `light_az_${activeLight.id}`
                      )
                    }
                    className="w-full accent-blue-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Tilt</span>
                    <span className="font-mono-nums">{activeLight.aimElevationDeg}°</span>
                  </div>
                  <input
                    type="range"
                    disabled={furn.locked}
                    min={-90}
                    max={90}
                    step={5}
                    value={activeLight.aimElevationDeg}
                    onChange={(e) =>
                      updateLight(
                        activeLight.id,
                        { aimElevationDeg: Number(e.target.value) },
                        'Aim Light Tilt',
                        `light_el_${activeLight.id}`
                      )
                    }
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Spot Cone & Penumbra */}
          {activeLight.type === 'spot' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>Cone Angle</span>
                  <span className="font-mono-nums">{activeLight.coneAngleDeg ?? 58}°</span>
                </div>
                <input
                  type="range"
                  disabled={furn.locked}
                  min={10}
                  max={82}
                  step={2}
                  value={activeLight.coneAngleDeg ?? 58}
                  onChange={(e) =>
                    updateLight(
                      activeLight.id,
                      { coneAngleDeg: Number(e.target.value) },
                      'Adjust Spot Angle',
                      `light_ang_${activeLight.id}`
                    )
                  }
                  className="w-full accent-amber-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>Softness</span>
                  <span className="font-mono-nums">
                    {Math.round((activeLight.penumbra ?? 0.72) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  disabled={furn.locked}
                  min={0}
                  max={1}
                  step={0.05}
                  value={activeLight.penumbra ?? 0.72}
                  onChange={(e) =>
                    updateLight(
                      activeLight.id,
                      { penumbra: Number(e.target.value) },
                      'Adjust Spot Softness',
                      `light_pen_${activeLight.id}`
                    )
                  }
                  className="w-full accent-amber-500"
                />
              </div>
            </div>
          )}

          {/* Area / Linear Dimensions */}
          {(activeLight.type === 'area' || activeLight.type === 'linear') && (
            <div className="grid grid-cols-2 gap-1.5">
              <MetricInput
                label={activeLight.type === 'linear' ? 'Strip Length' : 'Panel Width'}
                valueMm={activeLight.widthMm ?? 500}
                unit={unit}
                minMm={40}
                maxMm={5000}
                onChangeMm={(mm) =>
                  updateLight(activeLight.id, { widthMm: mm }, 'Resize Light Width')
                }
              />
              <MetricInput
                label={activeLight.type === 'linear' ? 'Strip Width' : 'Panel Height'}
                valueMm={activeLight.lengthMm ?? (activeLight.type === 'linear' ? 45 : 400)}
                unit={unit}
                minMm={20}
                maxMm={5000}
                onChangeMm={(mm) =>
                  updateLight(activeLight.id, { lengthMm: mm }, 'Resize Light Size')
                }
              />
            </div>
          )}

          {/* Shadow Casting (Point & Spot) */}
          {(activeLight.type === 'point' || activeLight.type === 'spot') && (
            <label className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-800 text-[11px] cursor-pointer">
              <span className="text-slate-600 dark:text-slate-300">Cast Shadows (up to 3/scene)</span>
              <input
                type="checkbox"
                disabled={furn.locked}
                checked={Boolean(activeLight.castShadow)}
                onChange={(e) =>
                  updateLight(
                    activeLight.id,
                    { castShadow: e.target.checked },
                    'Toggle Light Shadow'
                  )
                }
                className="accent-blue-600"
              />
            </label>
          )}
        </div>
      )}

      {/* GLB Material Emissive Inspector & Matching Light Generator */}
      {isGlbModel && (
        <div className="p-2 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" />
              GLB Materials &amp; Glow ({glbMaterials.length})
            </span>
            {glbInspectLoading && (
              <span className="text-[10px] text-slate-400">Scanning…</span>
            )}
          </div>

          {!glbInspectLoading && glbMaterials.length === 0 && (
            <p className="text-[10px] text-slate-500">
              No configurable GLB materials found yet.
            </p>
          )}

          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-0.5">
            {glbMaterials.map((mat) => {
              const ov = (furn.glbEmissiveOverrides ?? []).find(
                (o) => o.materialKey === mat.materialKey
              );
              const glowOn = ov
                ? ov.enabled
                : mat.emissiveDetected && !mat.emissiveDisabled;
              const effColor =
                ov?.emissiveColor ??
                (mat.emissiveHex !== '#000000'
                  ? mat.emissiveHex
                  : mat.baseColorHex !== '#000000'
                    ? mat.baseColorHex
                    : '#FF8C42');
              const effIntensity = ov?.emissiveIntensity ?? Math.max(1.2, mat.emissiveIntensity || 1.4);
              const effBloom = ov?.bloomBoost ?? 1.25;

              return (
                <div
                  key={mat.materialKey}
                  className="p-2 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-3 h-3 rounded-sm border border-black/20 shrink-0"
                        style={{ backgroundColor: effColor }}
                      />
                      <span className="truncate font-medium text-[11px] text-slate-800 dark:text-slate-200">
                        {mat.materialName}
                      </span>
                      {mat.emissiveDisabled && !ov && (
                        <span className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[9px] shrink-0">
                          Disabled Glow
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={furn.locked}
                      onClick={() =>
                        upsertGlbOverride(
                          mat,
                          { enabled: !glowOn },
                          glowOn ? 'Disable Material Glow' : 'Enable Material Glow'
                        )
                      }
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-pointer shrink-0 ${
                        glowOn
                          ? 'bg-amber-500/15 border-amber-500/60 text-amber-700 dark:text-amber-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-500'
                      }`}
                    >
                      {glowOn ? 'Glow ON' : 'Glow OFF'}
                    </button>
                  </div>

                  {glowOn && (
                    <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          disabled={furn.locked}
                          value={effColor}
                          onChange={(e) =>
                            upsertGlbOverride(
                              mat,
                              { enabled: true, emissiveColor: e.target.value.toUpperCase() },
                              'Change Emissive Color',
                              `em_col_${mat.materialKey}`
                            )
                          }
                          className="w-6 h-5 rounded border border-slate-300 dark:border-slate-700 p-0 cursor-pointer"
                        />
                        <div className="flex gap-1">
                          {QUICK_GLOW_SWATCHES.slice(0, 5).map((sw) => (
                            <button
                              key={sw}
                              type="button"
                              onClick={() =>
                                upsertGlbOverride(mat, { enabled: true, emissiveColor: sw })
                              }
                              aria-label={`Set glow ${sw}`}
                              className="w-3.5 h-3.5 rounded-sm border border-black/20 cursor-pointer"
                              style={{ backgroundColor: sw }}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          disabled={furn.locked}
                          onClick={() => {
                            const matched = createMatchingLightForGlbMaterial(mat, ov, furn);
                            const nextLights = [...effectiveLights, matched];
                            commitLights(nextLights, `Add Light for ${mat.materialName}`);
                            setSelectedLightId(matched.id);
                          }}
                          className="ml-auto px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-[10px] font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 cursor-pointer"
                        >
                          + Matching Light
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="flex justify-between text-[10px] text-slate-500">
                            <span>Emission</span>
                            <span className="font-mono-nums">{effIntensity.toFixed(1)}</span>
                          </div>
                          <input
                            type="range"
                            disabled={furn.locked}
                            min={0.1}
                            max={4.5}
                            step={0.1}
                            value={effIntensity}
                            onChange={(e) =>
                              upsertGlbOverride(
                                mat,
                                { enabled: true, emissiveIntensity: Number(e.target.value) },
                                'Adjust Emission Intensity',
                                `em_int_${mat.materialKey}`
                              )
                            }
                            className="w-full accent-amber-500"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between text-[10px] text-slate-500">
                            <span>Bloom</span>
                            <span className="font-mono-nums">{effBloom.toFixed(2)}×</span>
                          </div>
                          <input
                            type="range"
                            disabled={furn.locked}
                            min={0.5}
                            max={2.5}
                            step={0.05}
                            value={effBloom}
                            onChange={(e) =>
                              upsertGlbOverride(
                                mat,
                                { enabled: true, bloomBoost: Number(e.target.value) },
                                'Adjust Bloom Contribution',
                                `em_bl_${mat.materialKey}`
                              )
                            }
                            className="w-full accent-amber-500"
                          />
                        </div>
                      </div>

                      {mat.hasEmissiveMap && (
                        <label className="flex items-center justify-between text-[10px] text-slate-500 cursor-pointer">
                          <span>Use embedded emissive map</span>
                          <input
                            type="checkbox"
                            checked={ov?.preserveEmissiveMap ?? true}
                            onChange={(e) =>
                              upsertGlbOverride(mat, {
                                enabled: true,
                                preserveEmissiveMap: e.target.checked,
                              })
                            }
                            className="accent-blue-600"
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Procedural Parts Independent Emissive Surfaces (Non-GLB) */}
      {!isGlbModel && furn.parts.length > 0 && (
        <div className="p-2 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-500" />
            Emissive Parts ({furn.parts.filter((p) => p.emissiveEnabled).length}/{furn.parts.length})
          </div>
          <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
            {furn.parts.map((part) => {
              const glowOn = Boolean(part.emissiveEnabled);
              const emColor = part.emissiveColor || part.color || '#FFBE76';
              const emInt = part.emissiveIntensity ?? 1.3;
              const emBloom = part.bloomBoost ?? 1.2;
              return (
                <div
                  key={part.id}
                  className="p-1.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="flex items-center gap-1.5 min-w-0 text-[11px]">
                      <span
                        className="w-2.5 h-2.5 rounded-sm border border-black/20 shrink-0"
                        style={{ backgroundColor: glowOn ? emColor : part.color }}
                      />
                      <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                        {part.name}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={furn.locked}
                      onClick={() =>
                        updatePartEmissive(
                          part,
                          {
                            emissiveEnabled: !glowOn,
                            emissiveColor: part.emissiveColor ?? (part.color || '#FFBE76'),
                            emissiveIntensity: part.emissiveIntensity ?? 1.3,
                            bloomBoost: part.bloomBoost ?? 1.2,
                          },
                          glowOn ? 'Disable Part Glow' : 'Enable Part Glow'
                        )
                      }
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-pointer shrink-0 ${
                        glowOn
                          ? 'bg-amber-500/15 border-amber-500/60 text-amber-700 dark:text-amber-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-500'
                      }`}
                    >
                      {glowOn ? 'Glow ON' : 'Glow OFF'}
                    </button>
                  </div>

                  {glowOn && (
                    <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          disabled={furn.locked}
                          value={emColor}
                          onChange={(e) =>
                            updatePartEmissive(
                              part,
                              { emissiveColor: e.target.value.toUpperCase() },
                              'Change Part Glow Color',
                              `part_em_c_${part.id}`
                            )
                          }
                          className="w-6 h-5 rounded border border-slate-300 dark:border-slate-700 p-0 cursor-pointer"
                        />
                        <span className="font-mono-nums text-[10px] text-slate-500">
                          {emColor}
                        </span>
                        <button
                          type="button"
                          disabled={furn.locked}
                          onClick={() => {
                            const matched = createMatchingLightForPart(part, furn);
                            const nextLights = [...effectiveLights, matched];
                            commitLights(nextLights, `Add Light for ${part.name}`);
                            setSelectedLightId(matched.id);
                          }}
                          className="ml-auto px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-[10px] font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 cursor-pointer"
                        >
                          + Matching Light
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="flex justify-between text-[10px] text-slate-500">
                            <span>Emission</span>
                            <span className="font-mono-nums">{emInt.toFixed(1)}</span>
                          </div>
                          <input
                            type="range"
                            disabled={furn.locked}
                            min={0.1}
                            max={4.5}
                            step={0.1}
                            value={emInt}
                            onChange={(e) =>
                              updatePartEmissive(
                                part,
                                { emissiveIntensity: Number(e.target.value) },
                                'Adjust Part Emission',
                                `part_em_i_${part.id}`
                              )
                            }
                            className="w-full accent-amber-500"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between text-[10px] text-slate-500">
                            <span>Bloom</span>
                            <span className="font-mono-nums">{emBloom.toFixed(2)}×</span>
                          </div>
                          <input
                            type="range"
                            disabled={furn.locked}
                            min={0.5}
                            max={2.5}
                            step={0.05}
                            value={emBloom}
                            onChange={(e) =>
                              updatePartEmissive(
                                part,
                                { bloomBoost: Number(e.target.value) },
                                'Adjust Part Bloom',
                                `part_em_b_${part.id}`
                              )
                            }
                            className="w-full accent-amber-500"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
