import React, { useEffect, useState } from 'react';
import { Lightbulb, Plus, Sparkles, Sun, Trash2, X } from 'lucide-react';
import {
  FurnitureInstance,
  FurnitureLightSource,
  FurnitureLightType,
  FurniturePart,
  GlbInspectedMaterial,
  GlbMaterialEmissiveOverride,
  UnitDisplay,
} from '../types/plan';
import {
  createDefaultLightSource,
  createMatchingLightForGlbMaterial,
  createMatchingLightForPart,
  resolveEffectiveFurnitureLights,
  resolveLightSourceHex,
} from '../utils/lighting';
import { MetricInput } from './MetricInput';

interface UnifiedLightingEditorProps {
  furn: FurnitureInstance;
  unit: UnitDisplay;
  /** Pre-inspected GLB materials (optional; if omitted, uses parts for procedural lamps) */
  glbMaterials?: GlbInspectedMaterial[];
  glbInspectLoading?: boolean;
  /** Currently highlighted material key (GLB) or part ID (procedural) */
  selectedMaterialKey: string | null;
  onSelectMaterialKey: (key: string | null) => void;
  /** Controlled active light ID synced with the 3D preview gizmo */
  selectedLightId?: string | null;
  onSelectLightId?: (lightId: string | null) => void;
  /** Incrementing signal to switch view to Light Sources (e.g. clicking a light marker in 3D) */
  focusLightsTabSignal?: number;
  /** Mutates lighting fields (`lights`, `glbEmissiveOverrides`, `parts`, `lightConfig`) */
  onChange: (
    patch: Partial<FurnitureInstance>,
    label: string,
    coalesceKey?: string
  ) => void;
  locked?: boolean;
}

const LIGHT_TYPE_LABELS: Record<FurnitureLightType, string> = {
  point: 'Point',
  spot: 'Spot',
  area: 'Area',
  linear: 'Linear',
};

const QUICK_SWATCHES = ['#FF8C42', '#FFB703', '#FFF3C4', '#FFFFFF', '#60A5FA', '#F472B6'];

export const UnifiedLightingEditor: React.FC<UnifiedLightingEditorProps> = ({
  furn,
  unit,
  glbMaterials = [],
  glbInspectLoading = false,
  selectedMaterialKey,
  onSelectMaterialKey,
  selectedLightId: controlledLightId,
  onSelectLightId,
  focusLightsTabSignal = 0,
  onChange,
  locked = false,
}) => {
  const isGlbModel = Boolean(furn.glbAssetId || furn.glbDataUrl);
  const effectiveLights = resolveEffectiveFurnitureLights(furn);

  const [section, setSection] = useState<'materials' | 'lights'>(
    isGlbModel && glbMaterials.length > 0 ? 'materials' : effectiveLights.length > 0 ? 'lights' : 'materials'
  );
  const [internalLightId, setInternalLightId] = useState<string | null>(
    effectiveLights[0]?.id ?? null
  );
  const selectedLightId = controlledLightId !== undefined ? controlledLightId : internalLightId;
  const setSelectedLightId = (nextId: string | null) => {
    setInternalLightId(nextId);
    onSelectLightId?.(nextId);
  };

  useEffect(() => {
    if (focusLightsTabSignal > 0) {
      setSection('lights');
    }
  }, [focusLightsTabSignal]);

  useEffect(() => {
    if (effectiveLights.length === 0) {
      if (selectedLightId !== null) setSelectedLightId(null);
    } else if (!selectedLightId || !effectiveLights.some((l) => l.id === selectedLightId)) {
      setSelectedLightId(effectiveLights[0].id);
    }
  }, [furn.id, effectiveLights, selectedLightId]);

  const activeLight = effectiveLights.find((l) => l.id === selectedLightId) ?? effectiveLights[0] ?? null;

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
    onChange(
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
    setSection('lights');
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

  const upsertGlbOverride = (
    mat: GlbInspectedMaterial,
    patch: Partial<GlbMaterialEmissiveOverride>,
    label = 'Edit Material Glow',
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
      emissiveIntensity: Math.max(1.0, Math.min(2.4, mat.emissiveIntensity || 1.2)),
      bloomBoost: 1.0,
      preserveEmissiveMap: mat.hasEmissiveMap,
    };
    const nextOv = { ...base, ...patch };
    const nextList = [
      ...(furn.glbEmissiveOverrides ?? []).filter((o) => o.materialKey !== mat.materialKey),
      nextOv,
    ];
    onChange({ glbEmissiveOverrides: nextList }, label, coalesceKey);
  };

  const updatePartEmissive = (
    part: FurniturePart,
    patch: Partial<FurniturePart>,
    label = 'Edit Part Glow',
    coalesceKey?: string
  ) => {
    onChange(
      {
        parts: furn.parts.map((p) => (p.id === part.id ? { ...p, ...patch } : p)),
      },
      label,
      coalesceKey
    );
  };

  const selectedGlbMat = isGlbModel
    ? glbMaterials.find((m) => m.materialKey === selectedMaterialKey) ?? null
    : null;
  const selectedPart = !isGlbModel
    ? furn.parts.find((p) => p.id === selectedMaterialKey) ?? null
    : null;

  const materialCount = isGlbModel ? glbMaterials.length : furn.parts.length;

  return (
    <div className="space-y-3 text-xs">
      {/* Unified Top Switcher: Materials & Glow | Light Sources */}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80">
        <button
          type="button"
          onClick={() => setSection('materials')}
          className={`py-1.5 px-2.5 rounded-md font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
            section === 'materials'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span>Materials ({materialCount})</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onSelectMaterialKey(null);
            setSection('lights');
          }}
          className={`py-1.5 px-2.5 rounded-md font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
            section === 'lights'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span>Light Sources ({effectiveLights.length})</span>
        </button>
      </div>

      {/* SECTION 1: UNIFIED MATERIALS & EMISSIVE GLOW */}
      {section === 'materials' && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span>
              {selectedMaterialKey
                ? 'Selected part is highlighted in blue in the 3D preview.'
                : 'Select a material below to highlight it in blue and configure glow.'}
            </span>
            {selectedMaterialKey && (
              <button
                type="button"
                onClick={() => onSelectMaterialKey(null)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                <X className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}
          </div>

          {isGlbModel ? (
            <>
              {glbInspectLoading && (
                <p className="text-[11px] text-slate-500 py-2">Scanning model materials...</p>
              )}
              {!glbInspectLoading && glbMaterials.length === 0 && (
                <p className="text-[11px] text-slate-500 py-2">
                  No inspectable GLB materials were detected on this model.
                </p>
              )}

              {glbMaterials.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1 pr-0.5">
                  {glbMaterials.map((mat) => {
                    const isSel = selectedMaterialKey === mat.materialKey;
                    const ov = (furn.glbEmissiveOverrides ?? []).find(
                      (o) => o.materialKey === mat.materialKey
                    );
                    const glowOn = ov
                      ? ov.enabled
                      : mat.emissiveDetected && !mat.emissiveDisabled;
                    const swatchColor = glowOn
                      ? ov?.emissiveColor ??
                        (mat.emissiveHex !== '#000000' ? mat.emissiveHex : mat.baseColorHex)
                      : mat.baseColorHex;
                    const pairedCount = effectiveLights.filter(
                      (l) => l.sourceRef === mat.materialKey
                    ).length;

                    return (
                      <button
                        key={mat.materialKey}
                        type="button"
                        onClick={() =>
                          onSelectMaterialKey(isSel ? null : mat.materialKey)
                        }
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border text-left transition-colors cursor-pointer ${
                          isSel
                            ? 'border-blue-600 bg-blue-50/90 dark:bg-blue-950/45 text-slate-900 dark:text-white'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3.5 h-3.5 rounded-sm border border-black/20 shrink-0"
                            style={{ backgroundColor: swatchColor }}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-[11px]">
                              {mat.materialName}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              {glowOn ? 'Emissive ON' : mat.emissiveDisabled && !ov ? 'Disabled glow detected' : 'Standard surface'}
                              {pairedCount > 0 ? ` · ${pairedCount} light` : ''}
                            </div>
                          </div>
                        </div>
                        {isSel && (
                          <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap shrink-0">
                            Editing
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Selected GLB Material Emissive Editor */}
              {selectedGlbMat && (() => {
                const ov = (furn.glbEmissiveOverrides ?? []).find(
                  (o) => o.materialKey === selectedGlbMat.materialKey
                );
                const glowOn = ov
                  ? ov.enabled
                  : selectedGlbMat.emissiveDetected && !selectedGlbMat.emissiveDisabled;
                const effColor =
                  ov?.emissiveColor ??
                  (selectedGlbMat.emissiveHex !== '#000000'
                    ? selectedGlbMat.emissiveHex
                    : selectedGlbMat.baseColorHex !== '#000000'
                      ? selectedGlbMat.baseColorHex
                      : '#FF8C42');
                const effIntensity =
                  ov?.emissiveIntensity ??
                  Math.max(0.8, Math.min(2.5, selectedGlbMat.emissiveIntensity || 1.2));

                return (
                  <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900/70 bg-blue-50/40 dark:bg-blue-950/20 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                        {selectedGlbMat.materialName}
                      </span>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={glowOn}
                          onChange={(e) =>
                            upsertGlbOverride(
                              selectedGlbMat,
                              { enabled: e.target.checked },
                              e.target.checked ? 'Enable Emissive Glow' : 'Disable Emissive Glow'
                            )
                          }
                          className="accent-blue-600"
                        />
                        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                          Emit Glow
                        </span>
                      </label>
                    </div>

                    {glowOn && (
                      <div className="space-y-2.5 pt-1.5 border-t border-blue-200/70 dark:border-blue-900/50">
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            disabled={locked}
                            value={effColor}
                            onChange={(e) =>
                              upsertGlbOverride(
                                selectedGlbMat,
                                { enabled: true, emissiveColor: e.target.value.toUpperCase() },
                                'Change Emissive Color',
                                `em_col_${selectedGlbMat.materialKey}`
                              )
                            }
                            aria-label="Emission color"
                            className="w-7 h-6 rounded border border-slate-300 dark:border-slate-700 p-0 cursor-pointer shrink-0"
                          />
                          <div className="flex items-center gap-1">
                            {QUICK_SWATCHES.slice(0, 5).map((sw) => (
                              <button
                                key={sw}
                                type="button"
                                disabled={locked}
                                onClick={() =>
                                  upsertGlbOverride(selectedGlbMat, {
                                    enabled: true,
                                    emissiveColor: sw,
                                  })
                                }
                                aria-label={`Glow swatch ${sw}`}
                                className="w-4 h-4 rounded-sm border border-black/20 cursor-pointer"
                                style={{ backgroundColor: sw }}
                              />
                            ))}
                          </div>
                          <span className="ml-auto font-mono-nums text-[10px] text-slate-500">
                            {effColor}
                          </span>
                        </div>

                        <div>
                          <div className="flex justify-between text-[11px] text-slate-600 dark:text-slate-300 mb-0.5">
                            <span>Emission Intensity</span>
                            <span className="font-mono-nums font-medium">
                              {effIntensity.toFixed(1)}
                            </span>
                          </div>
                          <input
                            type="range"
                            disabled={locked}
                            min={0.1}
                            max={3.5}
                            step={0.1}
                            value={effIntensity}
                            onChange={(e) =>
                              upsertGlbOverride(
                                selectedGlbMat,
                                { enabled: true, emissiveIntensity: Number(e.target.value) },
                                'Adjust Emission Intensity',
                                `em_int_${selectedGlbMat.materialKey}`
                              )
                            }
                            className="w-full accent-blue-600"
                          />
                        </div>

                        {selectedGlbMat.hasEmissiveMap && (
                          <label className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                            <span>Preserve embedded emissive texture</span>
                            <input
                              type="checkbox"
                              disabled={locked}
                              checked={ov?.preserveEmissiveMap ?? true}
                              onChange={(e) =>
                                upsertGlbOverride(selectedGlbMat, {
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

                    <div className="pt-1 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          const matched = createMatchingLightForGlbMaterial(
                            selectedGlbMat,
                            ov,
                            furn
                          );
                          const updated = [...effectiveLights, matched];
                          commitLights(updated, `Add Light for ${selectedGlbMat.materialName}`);
                          setSelectedLightId(matched.id);
                          onSelectMaterialKey(null);
                          setSection('lights');
                        }}
                        className="w-full py-1.5 px-2.5 rounded-md border border-blue-600 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-40"
                      >
                        <Lightbulb className="w-3.5 h-3.5" />
                        <span>Add Matching Light Here</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
            </>
          ) : (
            /* Procedural Parametric Parts Emissive Selection */
            <>
              <div className="max-h-40 overflow-y-auto space-y-1 pr-0.5">
                {furn.parts.map((part) => {
                  const isSel = selectedMaterialKey === part.id;
                  const glowOn = Boolean(part.emissiveEnabled);
                  const swatchColor = glowOn ? part.emissiveColor || part.color : part.color;
                  return (
                    <button
                      key={part.id}
                      type="button"
                      onClick={() => onSelectMaterialKey(isSel ? null : part.id)}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border text-left transition-colors cursor-pointer ${
                        isSel
                          ? 'border-blue-600 bg-blue-50/90 dark:bg-blue-950/45 text-slate-900 dark:text-white'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3.5 h-3.5 rounded-sm border border-black/20 shrink-0"
                          style={{ backgroundColor: swatchColor }}
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-[11px]">{part.name}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            {glowOn ? 'Emissive ON' : 'Standard part'}
                          </div>
                        </div>
                      </div>
                      {isSel && (
                        <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap shrink-0">
                          Editing
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedPart && (() => {
                const glowOn = Boolean(selectedPart.emissiveEnabled);
                const effColor = selectedPart.emissiveColor || selectedPart.color || '#FFBE76';
                const effIntensity = selectedPart.emissiveIntensity ?? 1.2;
                return (
                  <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900/70 bg-blue-50/40 dark:bg-blue-950/20 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                        {selectedPart.name}
                      </span>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={glowOn}
                          onChange={(e) =>
                            updatePartEmissive(
                              selectedPart,
                              {
                                emissiveEnabled: e.target.checked,
                                emissiveColor:
                                  selectedPart.emissiveColor ?? (selectedPart.color || '#FFBE76'),
                                emissiveIntensity: selectedPart.emissiveIntensity ?? 1.2,
                                bloomBoost: selectedPart.bloomBoost ?? 1.0,
                              },
                              e.target.checked ? 'Enable Part Glow' : 'Disable Part Glow'
                            )
                          }
                          className="accent-blue-600"
                        />
                        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                          Emit Glow
                        </span>
                      </label>
                    </div>

                    {glowOn && (
                      <div className="space-y-2 pt-1.5 border-t border-blue-200/70 dark:border-blue-900/50">
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            disabled={locked}
                            value={effColor}
                            onChange={(e) =>
                              updatePartEmissive(
                                selectedPart,
                                { emissiveColor: e.target.value.toUpperCase() },
                                'Change Part Glow Color',
                                `part_em_c_${selectedPart.id}`
                              )
                            }
                            aria-label="Part glow color"
                            className="w-7 h-6 rounded border border-slate-300 dark:border-slate-700 p-0 cursor-pointer"
                          />
                          <span className="font-mono-nums text-[10px] text-slate-500">
                            {effColor}
                          </span>
                        </div>
                        <div>
                          <div className="flex justify-between text-[11px] text-slate-600 dark:text-slate-300 mb-0.5">
                            <span>Emission Intensity</span>
                            <span className="font-mono-nums font-medium">
                              {effIntensity.toFixed(1)}
                            </span>
                          </div>
                          <input
                            type="range"
                            disabled={locked}
                            min={0.1}
                            max={3.5}
                            step={0.1}
                            value={effIntensity}
                            onChange={(e) =>
                              updatePartEmissive(
                                selectedPart,
                                { emissiveIntensity: Number(e.target.value) },
                                'Adjust Part Emission',
                                `part_em_i_${selectedPart.id}`
                              )
                            }
                            className="w-full accent-blue-600"
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        const matched = createMatchingLightForPart(selectedPart, furn);
                        const updated = [...effectiveLights, matched];
                        commitLights(updated, `Add Light for ${selectedPart.name}`);
                        setSelectedLightId(matched.id);
                        onSelectMaterialKey(null);
                        setSection('lights');
                      }}
                      className="w-full py-1.5 px-2.5 rounded-md border border-blue-600 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-40"
                    >
                      <Lightbulb className="w-3.5 h-3.5" />
                      <span>Add Matching Light Here</span>
                    </button>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* SECTION 2: REAL LIGHT SOURCES */}
      {section === 'lights' && (
        <div className="space-y-2.5">
          {/* Quick Add Light Bar */}
          <div className="grid grid-cols-4 gap-1">
            {(['point', 'spot', 'area', 'linear'] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={locked}
                onClick={() => addLight(t)}
                className="py-1.5 px-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-40"
              >
                <Plus className="w-3 h-3" />
                <span>{LIGHT_TYPE_LABELS[t]}</span>
              </button>
            ))}
          </div>

          {effectiveLights.length === 0 ? (
            <p className="p-3 rounded-md border border-dashed border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 text-center">
              No real light sources added yet. Add a Point, Spot, Area, or Linear light above, or pair one from a glowing material.
            </p>
          ) : (
            <>
              <div className="max-h-32 overflow-y-auto space-y-1 pr-0.5">
                {effectiveLights.map((light) => {
                  const isSel = activeLight?.id === light.id;
                  const hex = resolveLightSourceHex(light);
                  return (
                    <div
                      key={light.id}
                      className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-md border transition-colors ${
                        isSel
                          ? 'border-blue-600 bg-blue-50/75 dark:bg-blue-950/35'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedLightId(light.id)}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0"
                          style={{ backgroundColor: light.enabled ? hex : '#64748B' }}
                        />
                        <span className="truncate font-medium text-[11px] text-slate-800 dark:text-slate-100">
                          {light.name}
                        </span>
                        <span className="text-[10px] text-slate-500 shrink-0">
                          {LIGHT_TYPE_LABELS[light.type]}
                        </span>
                      </button>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            updateLight(
                              light.id,
                              { enabled: !light.enabled },
                              light.enabled ? 'Turn Light Off' : 'Turn Light On'
                            )
                          }
                          className={`px-2 py-0.5 rounded text-[10px] font-medium border cursor-pointer ${
                            light.enabled
                              ? 'bg-amber-500/15 border-amber-500/60 text-amber-700 dark:text-amber-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-500'
                          }`}
                        >
                          {light.enabled ? 'On' : 'Off'}
                        </button>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => removeLight(light.id)}
                          aria-label={`Remove ${light.name}`}
                          className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {activeLight && (
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Name</label>
                      <input
                        type="text"
                        disabled={locked}
                        value={activeLight.name}
                        onChange={(e) =>
                          updateLight(
                            activeLight.id,
                            { name: e.target.value },
                            'Rename Light Source',
                            `light_name_${activeLight.id}`
                          )
                        }
                        className="w-full px-2 py-1 text-[11px] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Type</label>
                      <select
                        disabled={locked}
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
                        className="w-full px-2 py-1 text-[11px] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                      >
                        <option value="point">Point Light</option>
                        <option value="spot">Spotlight</option>
                        <option value="area">Area Light</option>
                        <option value="linear">Linear Strip</option>
                      </select>
                    </div>
                  </div>

                  {/* Color Mode + Picker */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-600 dark:text-slate-300">
                        Color
                      </span>
                      <div className="inline-flex rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => updateLight(activeLight.id, { colorMode: 'kelvin' })}
                          className={`px-2 py-0.5 text-[10px] cursor-pointer ${
                            activeLight.colorMode === 'kelvin'
                              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium'
                              : 'bg-white dark:bg-slate-900 text-slate-500'
                          }`}
                        >
                          Warmth (K)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateLight(activeLight.id, {
                              colorMode: 'hex',
                              colorHex: resolveLightSourceHex(activeLight),
                            })
                          }
                          className={`px-2 py-0.5 text-[10px] cursor-pointer ${
                            activeLight.colorMode === 'hex'
                              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium'
                              : 'bg-white dark:bg-slate-900 text-slate-500'
                          }`}
                        >
                          Custom Color
                        </button>
                      </div>
                    </div>

                    {activeLight.colorMode === 'kelvin' ? (
                      <div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
                          <span>Temperature</span>
                          <span className="font-mono-nums font-medium text-slate-700 dark:text-slate-200">
                            {activeLight.colorTempK}K
                          </span>
                        </div>
                        <input
                          type="range"
                          disabled={locked}
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
                          disabled={locked}
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
                        <span className="font-mono-nums text-[10px] text-slate-500">
                          {activeLight.colorHex}
                        </span>
                        <div className="flex items-center gap-1 ml-auto">
                          {QUICK_SWATCHES.map((sw) => (
                            <button
                              key={sw}
                              type="button"
                              onClick={() => updateLight(activeLight.id, { colorHex: sw })}
                              aria-label={`Light color ${sw}`}
                              className="w-4 h-4 rounded-sm border border-black/20 cursor-pointer"
                              style={{ backgroundColor: sw }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Brightness & Range */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                        <span>Intensity</span>
                        <span className="font-mono-nums">
                          {Math.round(activeLight.intensity * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        disabled={locked}
                        min={0.05}
                        max={3.0}
                        step={0.05}
                        value={Math.min(3.0, activeLight.intensity)}
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

                  {/* Local Position (synced with 3D X / Y / Z axis arrows) */}
                  <div className="space-y-1 pt-1 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>Position (3D Axes)</span>
                      <div className="flex items-center gap-2 font-mono-nums text-[10px]">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />X
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Y
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />Z
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <MetricInput
                        label="X"
                        valueMm={activeLight.xMm}
                        unit={unit}
                        minMm={-4000}
                        maxMm={4000}
                        onChangeMm={(mm) =>
                          updateLight(activeLight.id, { xMm: mm }, 'Move Light X')
                        }
                      />
                      <MetricInput
                        label="Y"
                        valueMm={activeLight.yMm}
                        unit={unit}
                        minMm={-4000}
                        maxMm={4000}
                        onChangeMm={(mm) =>
                          updateLight(activeLight.id, { yMm: mm }, 'Move Light Y')
                        }
                      />
                      <MetricInput
                        label="Z"
                        valueMm={activeLight.zMm}
                        unit={unit}
                        minMm={-500}
                        maxMm={4000}
                        onChangeMm={(mm) =>
                          updateLight(activeLight.id, { zMm: mm }, 'Adjust Light Height Z')
                        }
                      />
                    </div>
                  </div>

                  {/* Direction & Orientation (Strictly hidden for Point lights) */}
                  {activeLight.type !== 'point' && (
                    <div className="space-y-2 pt-1.5 border-t border-slate-200 dark:border-slate-800">
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>Orientation</span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() =>
                              updateLight(
                                activeLight.id,
                                { aimElevationDeg: -90, aimRollDeg: 0 },
                                'Aim Down'
                              )
                            }
                            className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40"
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() =>
                              updateLight(
                                activeLight.id,
                                { aimAzimuthDeg: 0, aimElevationDeg: -20, aimRollDeg: 0 },
                                'Aim Forward'
                              )
                            }
                            className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40"
                          >
                            Forward
                          </button>
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() =>
                              updateLight(
                                activeLight.id,
                                { aimElevationDeg: 75, aimRollDeg: 0 },
                                'Aim Up'
                              )
                            }
                            className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40"
                          >
                            Up
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {/* Horizontal Rotation (Yaw) */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-300">
                            <span className="inline-flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                              Yaw (°)
                            </span>
                            <input
                              type="number"
                              disabled={locked}
                              min={-180}
                              max={180}
                              step={1}
                              value={Math.round(activeLight.aimAzimuthDeg)}
                              onChange={(e) => {
                                const raw = Number(e.target.value);
                                if (!Number.isFinite(raw)) return;
                                const clamped = Math.max(-180, Math.min(180, Math.round(raw)));
                                updateLight(
                                  activeLight.id,
                                  { aimAzimuthDeg: clamped },
                                  'Rotate Light Yaw',
                                  `light_az_${activeLight.id}`
                                );
                              }}
                              aria-label="Yaw horizontal rotation degrees"
                              className="w-14 px-1.5 py-0.5 text-right font-mono-nums text-[10px] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                            />
                          </div>
                          <input
                            type="range"
                            disabled={locked}
                            min={-180}
                            max={180}
                            step={1}
                            value={activeLight.aimAzimuthDeg}
                            onChange={(e) =>
                              updateLight(
                                activeLight.id,
                                { aimAzimuthDeg: Number(e.target.value) },
                                'Rotate Light Yaw',
                                `light_az_${activeLight.id}`
                              )
                            }
                            className="w-full accent-amber-500"
                          />
                        </div>

                        {/* Vertical Tilt (Pitch) */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-300">
                            <span className="inline-flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-cyan-500 inline-block" />
                              Pitch (°)
                            </span>
                            <input
                              type="number"
                              disabled={locked}
                              min={-90}
                              max={90}
                              step={1}
                              value={Math.round(activeLight.aimElevationDeg)}
                              onChange={(e) => {
                                const raw = Number(e.target.value);
                                if (!Number.isFinite(raw)) return;
                                const clamped = Math.max(-90, Math.min(90, Math.round(raw)));
                                updateLight(
                                  activeLight.id,
                                  { aimElevationDeg: clamped },
                                  'Tilt Light Pitch',
                                  `light_el_${activeLight.id}`
                                );
                              }}
                              aria-label="Pitch vertical tilt degrees"
                              className="w-14 px-1.5 py-0.5 text-right font-mono-nums text-[10px] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                            />
                          </div>
                          <input
                            type="range"
                            disabled={locked}
                            min={-90}
                            max={90}
                            step={1}
                            value={activeLight.aimElevationDeg}
                            onChange={(e) =>
                              updateLight(
                                activeLight.id,
                                { aimElevationDeg: Number(e.target.value) },
                                'Tilt Light Pitch',
                                `light_el_${activeLight.id}`
                              )
                            }
                            className="w-full accent-cyan-500"
                          />
                        </div>
                      </div>

                      {/* Roll (Only for asymmetric Area / Linear lights) */}
                      {(activeLight.type === 'area' || activeLight.type === 'linear') && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-300">
                            <span className="inline-flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
                              Roll (°)
                            </span>
                            <input
                              type="number"
                              disabled={locked}
                              min={-180}
                              max={180}
                              step={1}
                              value={Math.round(activeLight.aimRollDeg ?? 0)}
                              onChange={(e) => {
                                const raw = Number(e.target.value);
                                if (!Number.isFinite(raw)) return;
                                const clamped = Math.max(-180, Math.min(180, Math.round(raw)));
                                updateLight(
                                  activeLight.id,
                                  { aimRollDeg: clamped },
                                  'Roll Light',
                                  `light_roll_${activeLight.id}`
                                );
                              }}
                              aria-label="Roll degrees"
                              className="w-14 px-1.5 py-0.5 text-right font-mono-nums text-[10px] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                            />
                          </div>
                          <input
                            type="range"
                            disabled={locked}
                            min={-180}
                            max={180}
                            step={1}
                            value={activeLight.aimRollDeg ?? 0}
                            onChange={(e) =>
                              updateLight(
                                activeLight.id,
                                { aimRollDeg: Number(e.target.value) },
                                'Roll Light',
                                `light_roll_${activeLight.id}`
                              )
                            }
                            className="w-full accent-purple-500"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Spot Angle / Softness */}
                  {activeLight.type === 'spot' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>Beam Angle</span>
                          <span className="font-mono-nums">{activeLight.coneAngleDeg ?? 58}°</span>
                        </div>
                        <input
                          type="range"
                          disabled={locked}
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
                          disabled={locked}
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
                        valueMm={
                          activeLight.lengthMm ?? (activeLight.type === 'linear' ? 45 : 400)
                        }
                        unit={unit}
                        minMm={20}
                        maxMm={5000}
                        onChangeMm={(mm) =>
                          updateLight(activeLight.id, { lengthMm: mm }, 'Resize Light Size')
                        }
                      />
                    </div>
                  )}

                  {/* Shadow Casting */}
                  {(activeLight.type === 'point' || activeLight.type === 'spot') && (
                    <label className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-800 text-[11px] cursor-pointer">
                      <span className="text-slate-600 dark:text-slate-300">Cast Shadows</span>
                      <input
                        type="checkbox"
                        disabled={locked}
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
            </>
          )}
        </div>
      )}
    </div>
  );
};
