import React, { useState } from 'react';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Layers,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  ArchElement,
  MaterialPreset,
  RailingConfig,
  RailingGlassTint,
  RailingHandrailShape,
  RailingMountingMethod,
  RailingPostShape,
  RailingStyleId,
  UnitDisplay,
} from '../types/plan';
import {
  RAILING_STYLES,
  applyRailingStylePreset,
  computeRailingPathMetrics,
  createDefaultRailingConfig,
  normalizeRailingConfig,
  recenterRailingNodes,
  resolveDeckEdgeToggles,
  resolveRailingConfig,
} from '../utils/railings';
import { formatSmartMetric } from '../utils/units';
import { ColorMaterialPicker } from './ColorMaterialPicker';
import { MetricInput, NumberField } from './MetricInput';

export const RailingStyleThumb: React.FC<{ styleId: RailingStyleId; className?: string }> = ({
  styleId,
  className = 'w-full h-9 text-slate-700 dark:text-slate-200',
}) => {
  return (
    <svg viewBox="0 0 120 48" className={className} aria-hidden="true">
      {/* Baseline deck */}
      <line x1="8" y1="41" x2="112" y2="41" stroke="#94A3B8" strokeWidth="1.4" />

      {styleId === 'glass_panel' && (
        <g>
          <rect x="20" y="13" width="38" height="24" fill="#BAE6FD" fillOpacity="0.48" stroke="#0284C7" strokeWidth="1" />
          <rect x="62" y="13" width="38" height="24" fill="#BAE6FD" fillOpacity="0.48" stroke="#0284C7" strokeWidth="1" />
          <rect x="14" y="10" width="5" height="31" fill="currentColor" />
          <rect x="57.5" y="10" width="5" height="31" fill="currentColor" />
          <rect x="101" y="10" width="5" height="31" fill="currentColor" />
          <rect x="12" y="8" width="96" height="4" rx="1.5" fill="currentColor" />
        </g>
      )}

      {styleId === 'frameless_glass' && (
        <g>
          <rect x="16" y="10" width="43" height="27" fill="#CFFAFE" fillOpacity="0.55" stroke="#0891B2" strokeWidth="1.2" />
          <rect x="61" y="10" width="43" height="27" fill="#CFFAFE" fillOpacity="0.55" stroke="#0891B2" strokeWidth="1.2" />
          <rect x="14" y="36" width="92" height="5" rx="1" fill="#475569" />
          <line x1="14" y1="10" x2="106" y2="10" stroke="#0891B2" strokeWidth="1.6" />
        </g>
      )}

      {styleId === 'traditional_balusters' && (
        <g>
          <rect x="14" y="9" width="6" height="32" fill="currentColor" />
          <circle cx="17" cy="7" r="2.6" fill="currentColor" />
          <rect x="100" y="9" width="6" height="32" fill="currentColor" />
          <circle cx="103" cy="7" r="2.6" fill="currentColor" />
          <rect x="20" y="34" width="80" height="3" fill="currentColor" />
          {[28, 37, 46, 55, 65, 74, 83, 92].map((x) => (
            <line key={x} x1={x} y1="12" x2={x} y2="34" stroke="currentColor" strokeWidth="2" />
          ))}
          <rect x="12" y="8" width="96" height="4.5" rx="1.5" fill="#8B5A2B" />
        </g>
      )}

      {styleId === 'horizontal_metal' && (
        <g>
          <rect x="15" y="10" width="5" height="31" fill="currentColor" />
          <rect x="57.5" y="10" width="5" height="31" fill="currentColor" />
          <rect x="100" y="10" width="5" height="31" fill="currentColor" />
          {[16, 22, 28, 34].map((y) => (
            <line key={y} x1="18" y1={y} x2="102" y2={y} stroke="currentColor" strokeWidth="1.8" />
          ))}
          <rect x="13" y="8" width="94" height="4" rx="1" fill="currentColor" />
        </g>
      )}

      {styleId === 'cable' && (
        <g>
          <rect x="15" y="10" width="5" height="31" fill="currentColor" />
          <rect x="57.5" y="10" width="5" height="31" fill="currentColor" />
          <rect x="100" y="10" width="5" height="31" fill="currentColor" />
          {[15, 19, 23, 27, 31, 35].map((y) => (
            <line key={y} x1="18" y1={y} x2="102" y2={y} stroke="#64748B" strokeWidth="0.9" />
          ))}
          <rect x="13" y="8" width="94" height="4" rx="1" fill="currentColor" />
        </g>
      )}

      {styleId === 'solid_panel' && (
        <g>
          <rect x="20" y="13" width="37" height="24" fill="#CBD5E1" stroke="currentColor" strokeWidth="1" />
          <rect x="63" y="13" width="37" height="24" fill="#CBD5E1" stroke="currentColor" strokeWidth="1" />
          <rect x="14" y="10" width="6" height="31" fill="currentColor" />
          <rect x="57" y="10" width="6" height="31" fill="currentColor" />
          <rect x="100" y="10" width="6" height="31" fill="currentColor" />
          <rect x="12" y="8" width="96" height="4" rx="1" fill="currentColor" />
        </g>
      )}

      {styleId === 'modern_minimalist' && (
        <g>
          <rect x="15" y="10" width="3.2" height="31" fill="currentColor" />
          <rect x="58.4" y="10" width="3.2" height="31" fill="currentColor" />
          <rect x="101.8" y="10" width="3.2" height="31" fill="currentColor" />
          {[26, 36, 46, 70, 80, 90].map((x) => (
            <line key={x} x1={x} y1="11" x2={x} y2="37" stroke="currentColor" strokeWidth="1.2" />
          ))}
          <line x1="16" y1="37" x2="104" y2="37" stroke="currentColor" strokeWidth="1.5" />
          <rect x="13" y="8" width="94" height="3" fill="currentColor" />
        </g>
      )}

      {styleId === 'handrail_only' && (
        <g>
          <line x1="12" y1="16" x2="108" y2="16" stroke="#94A3B8" strokeWidth="0.9" strokeDasharray="3 3" />
          <path d="M28 21 V28 H34" fill="none" stroke="#64748B" strokeWidth="2" />
          <path d="M60 21 V28 H66" fill="none" stroke="#64748B" strokeWidth="2" />
          <path d="M92 21 V28 H98" fill="none" stroke="#64748B" strokeWidth="2" />
          <rect x="14" y="17" width="92" height="5" rx="2.5" fill="currentColor" />
        </g>
      )}
    </svg>
  );
};

const CollapsibleGroup: React.FC<{
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, summary, open, onToggle, children }) => (
  <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-slate-50/60 dark:bg-slate-900/50">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="w-full px-2.5 py-2 flex items-center justify-between gap-2 text-left hover:bg-slate-100/80 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
    >
      <span className="flex items-center gap-1.5 font-semibold text-[11px] text-slate-800 dark:text-slate-100">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        <span>{title}</span>
      </span>
      {summary && (
        <span className="text-[10px] font-mono-nums text-slate-400 truncate max-w-[130px]">
          {summary}
        </span>
      )}
    </button>
    {open && <div className="px-2.5 pb-2.5 pt-1.5 border-t border-slate-200/80 dark:border-slate-800 space-y-2.5 bg-white dark:bg-slate-950/60">{children}</div>}
  </div>
);

interface RailingInspectorSectionProps {
  el: ArchElement;
  unit: UnitDisplay;
  recentColors: string[];
  onUpdateEl: (patch: Partial<ArchElement>, label?: string) => void;
}

export const RailingInspectorSection: React.FC<RailingInspectorSectionProps> = ({
  el,
  unit,
  recentColors,
  onUpdateEl,
}) => {
  const [openStyle, setOpenStyle] = useState(true);
  const [openGeom, setOpenGeom] = useState(true);
  const [openComp, setOpenComp] = useState(false);
  const [openMat, setOpenMat] = useState(false);
  const [openNodes, setOpenNodes] = useState(false);

  const cfg = resolveRailingConfig(el);
  const metrics = computeRailingPathMetrics(cfg);

  const updateRailingCfg = (
    partial: Partial<RailingConfig>,
    label = 'Edit Railing',
    extraElPatch?: Partial<ArchElement>
  ) => {
    const nextCfg = normalizeRailingConfig({ ...cfg, ...partial }, el.widthMm);
    const recentered = recenterRailingNodes(nextCfg.nodes, nextCfg.widthMm);
    onUpdateEl(
      {
        railing: { ...nextCfg, nodes: recentered.nodes },
        heightMm: nextCfg.heightMm,
        depthMm: recentered.depthMm,
        widthMm: recentered.widthMm,
        ...extraElPatch,
      },
      label
    );
  };

  const handleStyleSelect = (nextStyle: RailingStyleId) => {
    const nextCfg = applyRailingStylePreset(cfg, nextStyle);
    const meta = RAILING_STYLES.find((s) => s.id === nextStyle);
    onUpdateEl(
      {
        name: `${meta?.label ?? 'Architectural'} Railing`,
        railing: nextCfg,
        heightMm: nextCfg.heightMm,
        color: meta?.defaultColor ?? el.color,
        accentColor: nextCfg.accentColor,
        material: nextCfg.material,
      },
      `Set Railing Style (${meta?.label ?? nextStyle})`
    );
  };

  const handleSingleSegmentLengthChange = (nextLenMm: number) => {
    if (cfg.nodes.length !== 2) return;
    const n0 = cfg.nodes[0];
    const n1 = cfg.nodes[1];
    const dx = n1.xMm - n0.xMm;
    const dy = n1.yMm - n0.yMm;
    const curLen = Math.hypot(dx, dy) || 1;
    const ux = dx / curLen;
    const uy = dy / curLen;
    const half = Math.max(150, nextLenMm / 2);
    const midX = (n0.xMm + n1.xMm) / 2;
    const midY = (n0.yMm + n1.yMm) / 2;
    updateRailingCfg(
      {
        nodes: [
          { ...n0, xMm: Math.round(midX - ux * half), yMm: Math.round(midY - uy * half) },
          { ...n1, xMm: Math.round(midX + ux * half), yMm: Math.round(midY + uy * half) },
        ],
      },
      'Resize Railing Length'
    );
  };

  const styleMeta = RAILING_STYLES.find((s) => s.id === cfg.style) ?? RAILING_STYLES[0];
  const hasBalusters = cfg.style === 'traditional_balusters' || cfg.style === 'modern_minimalist';
  const hasPanels =
    cfg.style === 'glass_panel' ||
    cfg.style === 'frameless_glass' ||
    cfg.style === 'solid_panel';
  const isGlass = cfg.style === 'glass_panel' || cfg.style === 'frameless_glass';

  return (
    <div className="space-y-2" data-testid="railing-inspector-section">
      {/* Quick Summary Readout */}
      <div className="px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px]">
        <span className="text-slate-500">
          {metrics.segmentCount} {metrics.segmentCount === 1 ? 'run' : 'runs'} · {metrics.postCount} posts
          {metrics.isSloped ? ' · Sloped' : ''}
        </span>
        <span className="font-mono-nums font-semibold text-blue-600 dark:text-blue-400">
          {formatSmartMetric(metrics.totalPlanLengthMm)}
        </span>
      </div>

      {/* 1. Railing Style */}
      <CollapsibleGroup
        title="Railing Style"
        summary={styleMeta.shortLabel}
        open={openStyle}
        onToggle={() => setOpenStyle((v) => !v)}
      >
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Railing style">
          {RAILING_STYLES.map((st) => {
            const active = cfg.style === st.id;
            return (
              <button
                key={st.id}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`railing-style-${st.id}`}
                onClick={() => handleStyleSelect(st.id)}
                title={st.description}
                className={`p-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  active
                    ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100/70 dark:hover:bg-slate-800/60'
                }`}
              >
                <RailingStyleThumb styleId={st.id} className="w-full h-8 text-slate-700 dark:text-slate-200" />
                <div className="mt-1 text-[10px] font-semibold truncate">{st.label}</div>
              </button>
            );
          })}
        </div>
      </CollapsibleGroup>

      {/* 2. Dimensions & Spacing */}
      <CollapsibleGroup
        title="Dimensions & Spacing"
        summary={`${Math.round(cfg.heightMm / 10)} cm H`}
        open={openGeom}
        onToggle={() => setOpenGeom((v) => !v)}
      >
        <div className="grid grid-cols-2 gap-2">
          <MetricInput
            label="Railing Height"
            valueMm={cfg.heightMm}
            unit={unit}
            minMm={400}
            maxMm={2000}
            onChangeMm={(mm) => updateRailingCfg({ heightMm: mm }, 'Edit Railing Height')}
          />
          <MetricInput
            label="Base Elevation"
            valueMm={el.elevationMm}
            unit={unit}
            minMm={0}
            maxMm={15000}
            onChangeMm={(mm) => onUpdateEl({ elevationMm: mm }, 'Edit Railing Elevation')}
          />
          {cfg.nodes.length === 2 && (
            <MetricInput
              label="Run Length"
              valueMm={Math.round(metrics.totalPlanLengthMm)}
              unit={unit}
              minMm={250}
              maxMm={25000}
              onChangeMm={handleSingleSegmentLengthChange}
            />
          )}
          <MetricInput
            label="Assembly Width"
            valueMm={cfg.widthMm}
            unit={unit}
            minMm={25}
            maxMm={250}
            onChangeMm={(mm) => updateRailingCfg({ widthMm: mm }, 'Edit Railing Width')}
          />
          <MetricInput
            label="Post Spacing"
            valueMm={cfg.postSpacingMm}
            unit={unit}
            minMm={300}
            maxMm={3200}
            onChangeMm={(mm) => updateRailingCfg({ postSpacingMm: mm }, 'Edit Post Spacing')}
          />
          {hasBalusters && (
            <MetricInput
              label="Baluster Spacing"
              valueMm={cfg.balusterSpacingMm}
              unit={unit}
              minMm={45}
              maxMm={400}
              onChangeMm={(mm) => updateRailingCfg({ balusterSpacingMm: mm }, 'Edit Baluster Spacing')}
            />
          )}
          {cfg.style === 'horizontal_metal' && (
            <NumberField
              label="Horizontal Bars"
              value={cfg.horizontalRailCount}
              unitLabel="#"
              min={1}
              max={14}
              onChange={(v) =>
                updateRailingCfg({ horizontalRailCount: Math.round(v) }, 'Edit Horizontal Rail Count')
              }
            />
          )}
          {cfg.style === 'cable' && (
            <NumberField
              label="Cable Strands"
              value={cfg.cableCount}
              unitLabel="#"
              min={2}
              max={16}
              onChange={(v) => updateRailingCfg({ cableCount: Math.round(v) }, 'Edit Cable Count')}
            />
          )}
          <NumberField
            label="Rotation"
            value={el.rotationDeg}
            unitLabel="°"
            onChange={(deg) => onUpdateEl({ rotationDeg: deg }, 'Rotate Railing')}
          />
        </div>
      </CollapsibleGroup>

      {/* 3. Components & Mounting */}
      <CollapsibleGroup
        title="Components & Mounting"
        summary={cfg.mountingMethod.replace('_', ' ')}
        open={openComp}
        onToggle={() => setOpenComp((v) => !v)}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 col-span-2">
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
              Mounting Method
            </span>
            <select
              aria-label="Mounting Method"
              value={cfg.mountingMethod}
              onChange={(e) =>
                updateRailingCfg(
                  { mountingMethod: e.target.value as RailingMountingMethod },
                  'Change Railing Mounting'
                )
              }
              className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
            >
              <option value="top_mount">Top Surface Baseplate</option>
              <option value="side_fascia">Side Fascia Bracket</option>
              <option value="embedded">Embedded / Core-Drilled Shoe</option>
              <option value="wall_bracket">Wall Standoff Bracket</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
              Handrail Shape
            </span>
            <select
              aria-label="Handrail Shape"
              value={cfg.handrailShape}
              onChange={(e) =>
                updateRailingCfg(
                  { handrailShape: e.target.value as RailingHandrailShape },
                  'Change Handrail Shape'
                )
              }
              className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
            >
              <option value="round">Round Tube</option>
              <option value="rectangular">Rectangular</option>
              <option value="square">Square</option>
              <option value="oval">Oval Cap</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
              Post Shape
            </span>
            <select
              aria-label="Post Shape"
              value={cfg.postShape}
              onChange={(e) =>
                updateRailingCfg({ postShape: e.target.value as RailingPostShape }, 'Change Post Shape')
              }
              className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
            >
              <option value="square">Square</option>
              <option value="round">Round</option>
              <option value="flat">Flat Blade</option>
            </select>
          </label>

          <NumberField
            label="Rail Width"
            value={cfg.handrailWidthMm}
            unitLabel="mm"
            min={18}
            max={140}
            onChange={(v) => updateRailingCfg({ handrailWidthMm: v }, 'Edit Handrail Width')}
          />
          <NumberField
            label="Rail Thickness"
            value={cfg.handrailThicknessMm}
            unitLabel="mm"
            min={14}
            max={120}
            onChange={(v) => updateRailingCfg({ handrailThicknessMm: v }, 'Edit Handrail Thickness')}
          />
          <NumberField
            label="Post Size"
            value={cfg.postSizeMm}
            unitLabel="mm"
            min={14}
            max={180}
            onChange={(v) => updateRailingCfg({ postSizeMm: v }, 'Edit Post Size')}
          />
          <NumberField
            label="End Post"
            value={cfg.endPostSizeMm ?? cfg.postSizeMm}
            unitLabel="mm"
            min={14}
            max={220}
            onChange={(v) => updateRailingCfg({ endPostSizeMm: v }, 'Edit End Post Size')}
          />
          {hasPanels && (
            <NumberField
              label={isGlass ? 'Glass Thick.' : 'Panel Thick.'}
              value={cfg.panelThicknessMm}
              unitLabel="mm"
              min={6}
              max={60}
              onChange={(v) => updateRailingCfg({ panelThicknessMm: v }, 'Edit Panel Thickness')}
            />
          )}
          {!hasPanels && cfg.style !== 'handrail_only' && (
            <NumberField
              label={cfg.style === 'cable' ? 'Cable Dia.' : 'Bar / Picket'}
              value={cfg.balusterSizeMm}
              unitLabel="mm"
              min={3}
              max={60}
              onChange={(v) => updateRailingCfg({ balusterSizeMm: v }, 'Edit Baluster Size')}
            />
          )}
        </div>

        {cfg.style !== 'handrail_only' && (
          <div className="pt-1 border-t border-slate-200/70 dark:border-slate-800 space-y-2">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-medium text-slate-700 dark:text-slate-300">Bottom Rail / Shoe</span>
              <input
                type="checkbox"
                checked={cfg.bottomRailEnabled}
                onChange={(e) =>
                  updateRailingCfg({ bottomRailEnabled: e.target.checked }, 'Toggle Bottom Rail')
                }
                className="accent-blue-600"
              />
            </label>
            {cfg.bottomRailEnabled && (
              <NumberField
                label="Bottom Clearance"
                value={cfg.bottomRailHeightMm}
                unitLabel="mm"
                min={0}
                max={300}
                onChange={(v) => updateRailingCfg({ bottomRailHeightMm: v }, 'Edit Bottom Rail Height')}
              />
            )}
          </div>
        )}
      </CollapsibleGroup>

      {/* 4. Materials & Finish */}
      <CollapsibleGroup
        title="Materials & Finish"
        summary={cfg.material}
        open={openMat}
        onToggle={() => setOpenMat((v) => !v)}
      >
        <ColorMaterialPicker
          label="Posts & Frame Material"
          color={el.color}
          material={cfg.material}
          recentColors={recentColors}
          onColorChange={(hex) => onUpdateEl({ color: hex }, 'Edit Railing Frame Color')}
          onMaterialChange={(m) => updateRailingCfg({ material: m }, 'Edit Railing Frame Material', { material: m })}
        />

        <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 space-y-2">
          <ColorMaterialPicker
            label="Handrail Cap Material"
            color={cfg.handrailColor ?? el.color}
            material={cfg.handrailMaterial ?? cfg.material}
            recentColors={recentColors}
            onColorChange={(hex) => updateRailingCfg({ handrailColor: hex }, 'Edit Handrail Color')}
            onMaterialChange={(m) =>
              updateRailingCfg({ handrailMaterial: m }, 'Edit Handrail Material')
            }
          />
        </div>

        {isGlass ? (
          <label className="block space-y-1 pt-2 border-t border-slate-200/70 dark:border-slate-800">
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
              Glass Panel Tint
            </span>
            <select
              aria-label="Glass Panel Tint"
              value={cfg.glassTint}
              onChange={(e) =>
                updateRailingCfg({ glassTint: e.target.value as RailingGlassTint }, 'Edit Glass Tint')
              }
              className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
            >
              <option value="clear">Clear Tempered</option>
              <option value="low_iron">Low-Iron Ultra Clear</option>
              <option value="bronze">Warm Bronze Tinted</option>
              <option value="smoke">Architectural Smoke Gray</option>
            </select>
          </label>
        ) : (
          cfg.style !== 'handrail_only' && (
            <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800">
              <ColorMaterialPicker
                label="Infill / Panel Material"
                color={cfg.secondaryColor}
                material={(cfg.secondaryMaterial ?? 'metal') as MaterialPreset}
                recentColors={recentColors}
                onColorChange={(hex) =>
                  updateRailingCfg({ secondaryColor: hex }, 'Edit Infill Color')
                }
                onMaterialChange={(m) =>
                  updateRailingCfg({ secondaryMaterial: m }, 'Edit Infill Material')
                }
              />
            </div>
          )
        )}

        <label className="flex items-center justify-between gap-2 pt-1 cursor-pointer">
          <span className="text-[11px] text-slate-600 dark:text-slate-300">Hardware / Clamp Finish</span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono-nums text-[10px] text-slate-400">{cfg.accentColor}</span>
            <input
              type="color"
              value={cfg.accentColor}
              onChange={(e) =>
                updateRailingCfg(
                  { accentColor: e.target.value.toUpperCase() },
                  'Edit Hardware Color',
                  { accentColor: e.target.value.toUpperCase() }
                )
              }
              aria-label="Hardware Color"
              className="w-6 h-5 rounded border border-slate-300 dark:border-slate-700 cursor-pointer"
            />
          </span>
        </label>
      </CollapsibleGroup>

      {/* 5. Path Nodes & Slope Elevations */}
      <CollapsibleGroup
        title="Path Nodes & Slopes"
        summary={`${cfg.nodes.length} pts`}
        open={openNodes}
        onToggle={() => setOpenNodes((v) => !v)}
      >
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(cfg.closed)}
              disabled={cfg.nodes.length < 3}
              onChange={(e) => updateRailingCfg({ closed: e.target.checked }, 'Toggle Closed Loop')}
              className="accent-blue-600"
            />
            <span className="text-[11px]">Closed Perimeter</span>
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                const reversed = [...cfg.nodes].reverse();
                updateRailingCfg({ nodes: reversed }, 'Reverse Railing Slope');
              }}
              title="Reverse path & slope direction"
              className="px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] inline-flex items-center gap-1 cursor-pointer"
            >
              <ArrowUpDown className="w-3 h-3" />
              Flip
            </button>
            <button
              type="button"
              onClick={() => {
                const flat = cfg.nodes.map((n) => ({ ...n, elevationMm: 0 }));
                updateRailingCfg({ nodes: flat }, 'Flatten Railing Elevation');
              }}
              className="px-1.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] cursor-pointer"
            >
              Level
            </button>
          </div>
        </div>

        <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
          {cfg.nodes.map((node, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            >
              <span className="font-mono-nums text-[10px] font-semibold text-slate-500 w-7 shrink-0">
                P{idx + 1}
              </span>
              <label className="flex items-center gap-1 flex-1 min-w-0">
                <span className="text-[10px] text-slate-400 shrink-0">Elev</span>
                <input
                  type="number"
                  step={5}
                  value={Math.round((node.elevationMm ?? 0) / 10)}
                  onChange={(e) => {
                    const cm = Number(e.target.value);
                    if (!Number.isFinite(cm)) return;
                    const nextNodes = cfg.nodes.map((n, i) =>
                      i === idx ? { ...n, elevationMm: Math.round(cm * 10) } : n
                    );
                    updateRailingCfg({ nodes: nextNodes }, `Edit Node P${idx + 1} Elevation`);
                  }}
                  className="w-full px-1.5 py-0.5 font-mono-nums text-[11px] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                />
                <span className="text-[10px] text-slate-400 shrink-0">cm</span>
              </label>
              {cfg.nodes.length > 2 && (
                <button
                  type="button"
                  onClick={() => {
                    const nextNodes = cfg.nodes.filter((_, i) => i !== idx);
                    updateRailingCfg({ nodes: nextNodes }, `Remove Node P${idx + 1}`);
                  }}
                  aria-label={`Remove node P${idx + 1}`}
                  className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            const last = cfg.nodes[cfg.nodes.length - 1];
            const prev = cfg.nodes[cfg.nodes.length - 2] ?? { xMm: 0, yMm: 0, elevationMm: 0 };
            const dx = last.xMm - prev.xMm;
            const dy = last.yMm - prev.yMm;
            const len = Math.hypot(dx, dy) || 1;
            const extX = Math.round(last.xMm + (dx / len) * 1000);
            const extY = Math.round(last.yMm + (dy / len) * 1000);
            updateRailingCfg(
              { nodes: [...cfg.nodes, { xMm: extX, yMm: extY, elevationMm: last.elevationMm ?? 0 }] },
              'Extend Railing Segment'
            );
          }}
          className="w-full py-1.5 px-2 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium inline-flex items-center justify-center gap-1 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Extend Next Segment (+100 cm)
        </button>
      </CollapsibleGroup>
    </div>
  );
};

interface HostRailingIntegrationSectionProps {
  el: ArchElement;
  unit: UnitDisplay;
  onUpdateEl: (patch: Partial<ArchElement>, label?: string) => void;
  onExtractEditableRailings: () => void;
}

export const HostRailingIntegrationSection: React.FC<HostRailingIntegrationSectionProps> = ({
  el,
  unit,
  onUpdateEl,
  onExtractEditableRailings,
}) => {
  const [open, setOpen] = useState(true);
  const isStairs = el.type.startsWith('stairs');
  const isDeck = el.type === 'balcony' || el.type === 'platform';
  if (!isStairs && !isDeck) return null;

  const hostCfg = normalizeRailingConfig(
    el.railing ?? createDefaultRailingConfig('glass_panel', el.widthMm),
    el.widthMm
  );
  const deckEdges = resolveDeckEdgeToggles(el);

  const patchHostRailing = (partial: Partial<RailingConfig>, label = 'Update Attached Railing') => {
    const nextCfg = normalizeRailingConfig({ ...hostCfg, ...partial }, el.widthMm);
    onUpdateEl({ railing: nextCfg }, label);
  };

  return (
    <CollapsibleGroup
      title={isStairs ? 'Staircase Railings' : 'Perimeter Railings'}
      summary={RAILING_STYLES.find((s) => s.id === hostCfg.style)?.shortLabel}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {isStairs && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex items-center justify-between px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 cursor-pointer">
              <span className="text-[11px]">Left Side</span>
              <input
                type="checkbox"
                checked={
                  el.railingLeft ??
                  (el.type === 'stairs_l' || el.type === 'stairs_u' ? Boolean(el.hasRailing) : false)
                }
                onChange={(e) =>
                  onUpdateEl(
                    {
                      railingLeft: e.target.checked,
                      hasRailing: e.target.checked || (el.railingRight ?? Boolean(el.hasRailing)),
                    },
                    'Toggle Left Stair Railing'
                  )
                }
                className="accent-blue-600"
              />
            </label>
            <label className="flex items-center justify-between px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 cursor-pointer">
              <span className="text-[11px]">Right Side</span>
              <input
                type="checkbox"
                checked={el.railingRight ?? Boolean(el.hasRailing)}
                onChange={(e) =>
                  onUpdateEl(
                    {
                      railingRight: e.target.checked,
                      hasRailing: e.target.checked || Boolean(el.railingLeft),
                    },
                    'Toggle Right Stair Railing'
                  )
                }
                className="accent-blue-600"
              />
            </label>
          </div>

          {(el.type === 'stairs_l' || el.type === 'stairs_u' || el.type === 'stairs_spiral') && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-600 dark:text-slate-300">Turn Direction</span>
              <div className="flex items-center gap-1 p-0.5 rounded bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                {(['left', 'right'] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => onUpdateEl({ stairTurnDirection: dir }, 'Change Stair Turn')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize cursor-pointer ${
                      (el.stairTurnDirection ?? 'right') === dir
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500'
                    }`}
                  >
                    {dir}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isDeck && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-slate-500">Protected Edges</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(['front', 'left', 'right', 'back'] as const).map((edgeKey) => (
              <label
                key={edgeKey}
                className="flex items-center justify-between px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 cursor-pointer"
              >
                <span className="text-[11px] capitalize">{edgeKey}</span>
                <input
                  type="checkbox"
                  checked={deckEdges[edgeKey]}
                  onChange={(e) => {
                    const nextEdges = { ...deckEdges, [edgeKey]: e.target.checked };
                    onUpdateEl(
                      {
                        railingEdges: nextEdges,
                        hasRailing:
                          nextEdges.front || nextEdges.back || nextEdges.left || nextEdges.right,
                      },
                      `Toggle ${edgeKey} Railing`
                    );
                  }}
                  className="accent-blue-600"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
            Railing Style
          </span>
          <select
            aria-label="Integrated Railing Style"
            value={hostCfg.style}
            onChange={(e) =>
              patchHostRailing(
                applyRailingStylePreset(hostCfg, e.target.value as RailingStyleId),
                'Change Host Railing Style'
              )
            }
            className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
          >
            {RAILING_STYLES.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label}
              </option>
            ))}
          </select>
        </label>

        <MetricInput
          label="Rail Height"
          valueMm={hostCfg.heightMm}
          unit={unit}
          minMm={650}
          maxMm={1500}
          onChangeMm={(mm) => patchHostRailing({ heightMm: mm }, 'Edit Host Railing Height')}
        />
      </div>

      <button
        type="button"
        onClick={onExtractEditableRailings}
        className="w-full py-1.5 px-2 rounded border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100/70 dark:hover:bg-blue-950/50 text-[11px] font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer"
      >
        <Layers className="w-3.5 h-3.5" />
        Convert to Editable Railings
      </button>
    </CollapsibleGroup>
  );
};
