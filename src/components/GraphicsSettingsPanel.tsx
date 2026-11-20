import React from 'react';
import { RotateCcw, X } from 'lucide-react';
import type {
  AnisotropyOption,
  AntiAliasingOption,
  ConcreteGraphicsPresetId,
  GraphicsSettings,
  LightQualityOption,
  MaterialQualityOption,
  QualityTierWithOff,
  ShadowResolutionOption,
  TextureFilterOption,
  TextureResolutionOption,
  TransparentQualityOption,
} from '../utils/graphicsSettings';

interface GraphicsSettingsPanelProps {
  graphics: GraphicsSettings;
  onSelectPreset: (preset: ConcreteGraphicsPresetId) => void;
  onUpdateSetting: (partial: Partial<GraphicsSettings>) => void;
  onReset: () => void;
  variant?: 'popover' | 'modal';
  onClose?: () => void;
}

const PRESET_ITEMS: Array<{ id: ConcreteGraphicsPresetId; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'ultra', label: 'Ultra' },
];

export const GraphicsSettingsPanel: React.FC<GraphicsSettingsPanelProps> = ({
  graphics,
  onSelectPreset,
  onUpdateSetting,
  onReset,
  variant = 'modal',
  onClose,
}) => {
  const isPopover = variant === 'popover';

  return (
    <div
      data-testid={`graphics-panel-${variant}`}
      className={isPopover ? 'flex flex-col max-h-[72vh] text-xs' : 'space-y-5 text-xs'}
    >
      {/* Header / Preset Strip */}
      <div
        className={
          isPopover
            ? 'px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0'
            : 'bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-2.5'
        }
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              3D Graphics Quality
            </span>
            {graphics.preset === 'custom' && (
              <span
                data-testid="graphics-custom-indicator"
                className="text-[11px] font-medium text-blue-600 dark:text-blue-400"
              >
                · Custom
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="graphics-reset-btn"
              onClick={onReset}
              className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
            {isPopover && onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close graphics settings"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div
          role="radiogroup"
          aria-label="Graphics quality preset"
          className={`grid gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 ${
            graphics.preset === 'custom' ? 'grid-cols-5' : 'grid-cols-4'
          }`}
        >
          {PRESET_ITEMS.map((item) => {
            const active = graphics.preset === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`graphics-preset-${item.id}`}
                onClick={() => onSelectPreset(item.id)}
                className={`py-1.5 px-2 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          {graphics.preset === 'custom' && (
            <div
              role="radio"
              aria-checked={true}
              className="py-1.5 px-2 rounded-md text-[11px] font-medium text-center bg-blue-600 text-white"
            >
              Custom
            </div>
          )}
        </div>
      </div>

      {/* Scrollable Sections */}
      <div
        className={
          isPopover
            ? 'flex-1 overflow-y-auto px-3.5 py-3 space-y-4'
            : 'space-y-5'
        }
      >
        {/* Performance & Resolution */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Display &amp; Performance
          </h3>
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
            <div className="px-3.5 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">Render Scale</div>
                  <div className="text-[11px] text-slate-500">
                    Pixel resolution multiplier (higher = sharper edges, higher GPU load)
                  </div>
                </div>
                <span className="font-mono-nums font-semibold text-blue-600 dark:text-blue-400">
                  {graphics.renderScale.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                aria-label="Render Scale"
                min={0.75}
                max={2.0}
                step={0.05}
                value={graphics.renderScale}
                onChange={(e) => onUpdateSetting({ renderScale: Number(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>
          </div>
        </section>

        {/* Lighting & Shadows */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Lighting &amp; Shadows
          </h3>
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
            <div className="px-3.5 py-2.5 grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Global Illumination
                </span>
                <select
                  aria-label="Global Illumination Quality"
                  value={graphics.globalIlluminationQuality}
                  onChange={(e) =>
                    onUpdateSetting({
                      globalIlluminationQuality: e.target.value as QualityTierWithOff,
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
                >
                  <option value="off">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Light Quality
                </span>
                <select
                  aria-label="Light Quality"
                  value={graphics.lightQuality}
                  onChange={(e) =>
                    onUpdateSetting({ lightQuality: e.target.value as LightQualityOption })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
                >
                  <option value="low">Low (Direct Only)</option>
                  <option value="medium">Medium (Balanced)</option>
                  <option value="high">High (Full Portals)</option>
                </select>
              </label>
            </div>

            <div className="px-3.5 py-2.5 grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Shadow Resolution
                </span>
                <select
                  aria-label="Shadow Resolution"
                  value={graphics.shadowResolution}
                  onChange={(e) =>
                    onUpdateSetting({
                      shadowResolution: Number(e.target.value) as ShadowResolutionOption,
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 font-mono-nums"
                >
                  <option value={512}>512 px (Fast)</option>
                  <option value={1024}>1024 px</option>
                  <option value={2048}>2048 px</option>
                  <option value={4096}>4096 px (Crisp)</option>
                </select>
              </label>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    Max Lights
                  </span>
                  <span className="font-mono-nums font-semibold text-slate-900 dark:text-slate-100">
                    {graphics.maxRealtimeLights}
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Max Real-Time Light Sources"
                  min={4}
                  max={32}
                  step={1}
                  value={graphics.maxRealtimeLights}
                  onChange={(e) =>
                    onUpdateSetting({ maxRealtimeLights: Number(e.target.value) })
                  }
                  className="w-full accent-blue-600 mt-1.5"
                />
              </div>
            </div>

            <div className="px-3.5 py-2.5 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    Shadow Softness
                  </span>
                  <span className="font-mono-nums font-semibold text-slate-900 dark:text-slate-100">
                    {graphics.shadowSoftness.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Shadow Softness"
                  min={0}
                  max={5}
                  step={0.2}
                  value={graphics.shadowSoftness}
                  onChange={(e) => onUpdateSetting({ shadowSoftness: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    Shadow Distance
                  </span>
                  <span className="font-mono-nums font-semibold text-slate-900 dark:text-slate-100">
                    {Math.round(graphics.shadowDistanceM)} m
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Shadow Distance"
                  min={12}
                  max={48}
                  step={2}
                  value={graphics.shadowDistanceM}
                  onChange={(e) => onUpdateSetting({ shadowDistanceM: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>
            </div>

            <label className="px-3.5 py-2.5 flex items-center justify-between cursor-pointer">
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  Contact Shadows
                </div>
                <div className="text-[11px] text-slate-500">
                  Soft grounding shadows beneath floor furniture
                </div>
              </div>
              <input
                type="checkbox"
                aria-label="Contact Shadows"
                checked={graphics.contactShadows}
                onChange={(e) => onUpdateSetting({ contactShadows: e.target.checked })}
                className="accent-blue-600 w-4 h-4"
              />
            </label>
          </div>
        </section>

        {/* Materials & Textures */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Materials &amp; Textures
          </h3>
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
            <div className="px-3.5 py-2.5 grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Texture Resolution
                </span>
                <select
                  aria-label="Texture Resolution"
                  value={graphics.textureResolution}
                  onChange={(e) =>
                    onUpdateSetting({
                      textureResolution: Number(e.target.value) as TextureResolutionOption,
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 font-mono-nums"
                >
                  <option value={256}>256 px</option>
                  <option value={512}>512 px</option>
                  <option value={1024}>1024 px</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Texture Filtering
                </span>
                <select
                  aria-label="Texture Filtering"
                  value={graphics.textureFiltering}
                  onChange={(e) =>
                    onUpdateSetting({
                      textureFiltering: e.target.value as TextureFilterOption,
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
                >
                  <option value="nearest">Nearest</option>
                  <option value="bilinear">Bilinear</option>
                  <option value="trilinear">Trilinear</option>
                </select>
              </label>
            </div>

            <div className="px-3.5 py-2.5 grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Anisotropic Filtering
                </span>
                <select
                  aria-label="Anisotropic Filtering"
                  value={graphics.anisotropicFiltering}
                  onChange={(e) =>
                    onUpdateSetting({
                      anisotropicFiltering: Number(e.target.value) as AnisotropyOption,
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 font-mono-nums"
                >
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                  <option value={8}>8x</option>
                  <option value={16}>16x</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Material Quality
                </span>
                <select
                  aria-label="Material Quality"
                  value={graphics.materialQuality}
                  onChange={(e) =>
                    onUpdateSetting({
                      materialQuality: e.target.value as MaterialQualityOption,
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
                >
                  <option value="standard">Standard</option>
                  <option value="physical">Physical PBR</option>
                </select>
              </label>
            </div>

            <div className="px-3.5 py-2.5 grid grid-cols-3 gap-2">
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Reflections
                </span>
                <select
                  aria-label="Reflection Quality"
                  value={graphics.reflectionQuality}
                  onChange={(e) =>
                    onUpdateSetting({
                      reflectionQuality: e.target.value as QualityTierWithOff,
                    })
                  }
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
                >
                  <option value="off">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Env Map
                </span>
                <select
                  aria-label="Environment Map Quality"
                  value={graphics.environmentMapQuality}
                  onChange={(e) =>
                    onUpdateSetting({
                      environmentMapQuality: e.target.value as QualityTierWithOff,
                    })
                  }
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
                >
                  <option value="off">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Glass / Alpha
                </span>
                <select
                  aria-label="Transparent Material Quality"
                  value={graphics.transparentMaterialQuality}
                  onChange={(e) =>
                    onUpdateSetting({
                      transparentMaterialQuality: e.target.value as TransparentQualityOption,
                    })
                  }
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
                >
                  <option value="standard">Standard</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        {/* Post-Processing */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Post-Processing
          </h3>
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
            <div className="px-3.5 py-2.5 grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Anti-Aliasing
                </span>
                <select
                  aria-label="Anti-Aliasing"
                  value={graphics.antiAliasing}
                  onChange={(e) =>
                    onUpdateSetting({ antiAliasing: e.target.value as AntiAliasingOption })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
                >
                  <option value="off">Off</option>
                  <option value="fxaa">FXAA (Fast)</option>
                  <option value="smaa">SMAA (Crisp)</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  Ambient Occlusion
                </span>
                <select
                  aria-label="Ambient Occlusion Quality"
                  value={graphics.ambientOcclusionQuality}
                  onChange={(e) =>
                    onUpdateSetting({
                      ambientOcclusionQuality: e.target.value as QualityTierWithOff,
                      ...(e.target.value !== 'off' && graphics.ambientOcclusionIntensity === 0
                        ? { ambientOcclusionIntensity: 0.65 }
                        : {}),
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
                >
                  <option value="off">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>

            {graphics.ambientOcclusionQuality !== 'off' && (
              <div className="px-3.5 py-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    AO Intensity
                  </span>
                  <span className="font-mono-nums font-semibold text-slate-900 dark:text-slate-100">
                    {Math.round(graphics.ambientOcclusionIntensity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Ambient Occlusion Intensity"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={graphics.ambientOcclusionIntensity}
                  onChange={(e) =>
                    onUpdateSetting({ ambientOcclusionIntensity: Number(e.target.value) })
                  }
                  className="w-full accent-blue-600"
                />
              </div>
            )}

            <div className="px-3.5 py-2.5 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    Bloom Intensity
                  </span>
                  <span className="font-mono-nums font-semibold text-slate-900 dark:text-slate-100">
                    {Math.round(graphics.bloomIntensity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Bloom Intensity"
                  min={0}
                  max={2}
                  step={0.05}
                  value={graphics.bloomIntensity}
                  onChange={(e) => onUpdateSetting({ bloomIntensity: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    Exposure
                  </span>
                  <span className="font-mono-nums font-semibold text-slate-900 dark:text-slate-100">
                    {graphics.exposure.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Exposure"
                  min={0.6}
                  max={1.5}
                  step={0.02}
                  value={graphics.exposure}
                  onChange={(e) => onUpdateSetting({ exposure: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>
            </div>

            <div className="px-3.5 py-2.5 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    Contrast
                  </span>
                  <span className="font-mono-nums font-semibold text-slate-900 dark:text-slate-100">
                    {graphics.contrast.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Contrast"
                  min={0.8}
                  max={1.3}
                  step={0.01}
                  value={graphics.contrast}
                  onChange={(e) => onUpdateSetting({ contrast: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    Vignette
                  </span>
                  <span className="font-mono-nums font-semibold text-slate-900 dark:text-slate-100">
                    {Math.round(graphics.vignetteIntensity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Vignette"
                  min={0}
                  max={0.5}
                  step={0.02}
                  value={graphics.vignetteIntensity}
                  onChange={(e) => onUpdateSetting({ vignetteIntensity: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>
            </div>

            <div className="px-3.5 py-2.5 space-y-2.5">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    Depth of Field
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Optional optical lens blur for architectural close-ups
                  </div>
                </div>
                <input
                  type="checkbox"
                  aria-label="Depth of Field"
                  checked={graphics.depthOfFieldEnabled}
                  onChange={(e) => onUpdateSetting({ depthOfFieldEnabled: e.target.checked })}
                  className="accent-blue-600 w-4 h-4"
                />
              </label>

              {graphics.depthOfFieldEnabled && (
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-300 font-medium">
                        Focus Dist
                      </span>
                      <span className="font-mono-nums font-semibold text-slate-900 dark:text-slate-100">
                        {graphics.depthOfFieldFocusM.toFixed(1)} m
                      </span>
                    </div>
                    <input
                      type="range"
                      aria-label="Depth of Field Focus Distance"
                      min={1.5}
                      max={20}
                      step={0.5}
                      value={graphics.depthOfFieldFocusM}
                      onChange={(e) =>
                        onUpdateSetting({ depthOfFieldFocusM: Number(e.target.value) })
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-300 font-medium">
                        Aperture
                      </span>
                      <span className="font-mono-nums font-semibold text-slate-900 dark:text-slate-100">
                        {graphics.depthOfFieldAperture.toFixed(1)}
                      </span>
                    </div>
                    <input
                      type="range"
                      aria-label="Depth of Field Aperture"
                      min={0.2}
                      max={2.5}
                      step={0.1}
                      value={graphics.depthOfFieldAperture}
                      onChange={(e) =>
                        onUpdateSetting({ depthOfFieldAperture: Number(e.target.value) })
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
