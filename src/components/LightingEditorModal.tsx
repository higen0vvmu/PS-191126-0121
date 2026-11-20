import React, { useEffect, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';
import {
  FurnitureInstance,
  GlbInspectedMaterial,
  ProjectSettings,
} from '../types/plan';
import { computeFurnitureBoundsMm } from '../utils/geometry';
import { loadGlbObjectCached } from '../utils/furnitureRepresentationSync';
import {
  inspectGlbMaterials,
  isFurnitureLightingActive,
} from '../utils/lighting';
import {
  resolveFurnitureMountingFace,
  resolveFurnitureMountingType,
} from '../utils/mounting';
import { InteractiveGlbPreview3D } from './InteractiveGlbPreview3D';
import { UnifiedLightingEditor } from './UnifiedLightingEditor';

interface LightingEditorModalProps {
  furn: FurnitureInstance;
  settings: ProjectSettings;
  onUpdateFurn: (
    patch: Partial<FurnitureInstance>,
    label?: string,
    coalesceKey?: string
  ) => void;
  onClose: () => void;
}

export const LightingEditorModal: React.FC<LightingEditorModalProps> = ({
  furn,
  settings,
  onUpdateFurn,
  onClose,
}) => {
  const isGlbModel = Boolean(furn.glbAssetId || furn.glbDataUrl);
  const [glbMaterials, setGlbMaterials] = useState<GlbInspectedMaterial[]>([]);
  const [glbLoading, setGlbLoading] = useState(false);
  const [selectedMaterialKey, setSelectedMaterialKey] = useState<string | null>(null);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const [focusLightsTabSignal, setFocusLightsTabSignal] = useState(0);
  const [backdropMode, setBackdropMode] = useState<'day' | 'night'>(
    settings.timeOfDay3d === 'night' ? 'night' : 'day'
  );

  const bounds = computeFurnitureBoundsMm(furn.parts);
  const mountingType = resolveFurnitureMountingType(furn);
  const mountingFace = resolveFurnitureMountingFace(furn);
  const isLit = isFurnitureLightingActive(furn);

  useEffect(() => {
    let active = true;
    if (!isGlbModel) {
      setGlbMaterials([]);
      return;
    }
    setGlbLoading(true);
    void loadGlbObjectCached(furn.glbAssetId, furn.glbDataUrl)
      .then((obj) => {
        if (!active) return;
        if (!obj) {
          setGlbMaterials([]);
          setGlbLoading(false);
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
        setGlbLoading(false);
      })
      .catch(() => {
        if (active) {
          setGlbMaterials([]);
          setGlbLoading(false);
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

  const handleLightUpdateFrom3D = (
    lightId: string,
    patch: Partial<import('../types/plan').FurnitureLightSource>,
    label = 'Edit Light Transform',
    coalesceKey?: string
  ) => {
    const currentLights = furn.lights ?? [];
    const baseLights =
      Array.isArray(furn.lights)
        ? currentLights
        : // Materialize legacy lights when dragged directly in 3D
          ((): import('../types/plan').FurnitureLightSource[] => {
            const first = {
              id: lightId,
              name: 'Lamp Light',
              type: 'spot' as const,
              enabled: furn.lightConfig?.enabled ?? true,
              colorMode: 'kelvin' as const,
              colorTempK: furn.lightConfig?.colorTempK ?? 3200,
              colorHex: '#FFBE76',
              intensity: furn.lightConfig?.intensity ?? 0.6,
              rangeMm: 5500,
              decay: 2,
              xMm: 0,
              yMm: 0,
              zMm: 200,
              aimAzimuthDeg: 0,
              aimElevationDeg: -75,
              aimRollDeg: 0,
              coneAngleDeg: 68,
              penumbra: 0.72,
            };
            return [first];
          })();
    const nextLights = baseLights.map((l) => (l.id === lightId ? { ...l, ...patch } : l));
    onUpdateFurn({ lights: nextLights }, label, coalesceKey);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/65 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs">
        <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              Lighting Configuration · {furn.name}
            </h2>
            <p className="text-[11px] text-slate-500">
              Select a material to highlight it in blue, or use the 3D gizmo arrows and rings to position and aim lights.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={furn.locked}
              onClick={() =>
                onUpdateFurn(
                  { lightingEnabled: !isLit },
                  isLit ? 'Turn Object Lighting Off' : 'Turn Object Lighting On'
                )
              }
              className={`px-2.5 py-1.5 rounded-md border text-[11px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                isLit
                  ? 'bg-amber-500/15 border-amber-500/60 text-amber-700 dark:text-amber-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              <span>{isLit ? 'Lit: On' : 'Lit: Off'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close lighting editor"
              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[1.15fr_1fr] flex-1 min-h-0 overflow-hidden">
          {/* Interactive 3D Preview with Light Indicators & 3D Gizmo */}
          <div className="p-4 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 flex flex-col min-h-[300px]">
            <InteractiveGlbPreview3D
              furn={furn}
              mountingType={mountingType}
              mountingFace={mountingFace}
              selectedMaterialKey={selectedMaterialKey}
              backdropMode={backdropMode}
              onBackdropModeChange={setBackdropMode}
              showLightGizmo={true}
              selectedLightId={selectedLightId}
              onSelectLightId={(id) => {
                setSelectedLightId(id);
                if (id) {
                  setSelectedMaterialKey(null);
                  setFocusLightsTabSignal((s) => s + 1);
                }
              }}
              onUpdateLight={handleLightUpdateFrom3D}
              locked={furn.locked}
              className="flex-1 min-h-[280px]"
            />
          </div>

          {/* Unified Materials & Light Sources Panel */}
          <div className="p-4 overflow-y-auto space-y-3">
            <UnifiedLightingEditor
              furn={furn}
              unit={settings.preferredUnit}
              glbMaterials={glbMaterials}
              glbInspectLoading={glbLoading}
              selectedMaterialKey={selectedMaterialKey}
              onSelectMaterialKey={setSelectedMaterialKey}
              selectedLightId={selectedLightId}
              onSelectLightId={setSelectedLightId}
              focusLightsTabSignal={focusLightsTabSignal}
              onChange={(patch, label, coalesceKey) =>
                onUpdateFurn(patch, label, coalesceKey)
              }
              locked={furn.locked}
            />
          </div>
        </div>

        <footer className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end bg-slate-50 dark:bg-slate-950">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 cursor-pointer"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
};
