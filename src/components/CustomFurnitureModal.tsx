import React, { useMemo, useState } from 'react';
import { Layers, Plus, Trash2, X } from 'lucide-react';
import {
  CatalogTemplate,
  FurnitureCategory,
  FurniturePart,
  MaterialPreset,
  PartShape,
} from '../types/plan';
import { MATERIAL_CATEGORIES, MATERIAL_PRESETS, SWATCH_PALETTE } from '../data/materials';
import { computeFurnitureBoundsMm } from '../utils/geometry';
import { generateRepresentationFromParts } from '../utils/svgProjection';
import { uid } from '../utils/units';
import { MetricInput, NumberField } from './MetricInput';

interface CustomFurnitureModalProps {
  onClose: () => void;
  onSaveAndPlace: (tpl: CatalogTemplate, placeOnPlan: boolean) => void;
}

const SHAPES: Array<{ id: PartShape; label: string }> = [
  { id: 'box', label: 'Box' },
  { id: 'rounded_rect', label: 'Rounded Box' },
  { id: 'oval', label: 'Oval / Ellipse' },
  { id: 'cylinder', label: 'Cylinder' },
  { id: 'sphere', label: 'Sphere / Dome' },
  { id: 'wedge', label: 'Wedge / Slope' },
  { id: 'l_profile', label: 'L-Profile' },
  { id: 'u_profile', label: 'U-Profile' },
  { id: 'arc', label: 'Arc Segment' },
];

export const CustomFurnitureModal: React.FC<CustomFurnitureModalProps> = ({
  onClose,
  onSaveAndPlace,
}) => {
  const [name, setName] = useState('Custom Console Table');
  const [category, setCategory] = useState<FurnitureCategory>('My Library');
  const [parts, setParts] = useState<FurniturePart[]>([
    {
      id: uid('part'),
      name: 'Top Slab',
      shape: 'box',
      xMm: 0,
      yMm: 0,
      zMm: 720,
      widthMm: 1400,
      depthMm: 450,
      heightMm: 40,
      rotationDeg: 0,
      color: '#FFFFFF',
      material: 'wood',
    },
    {
      id: uid('part'),
      name: 'Left Leg Frame',
      shape: 'box',
      xMm: -620,
      yMm: 0,
      zMm: 0,
      widthMm: 60,
      depthMm: 400,
      heightMm: 720,
      rotationDeg: 0,
      color: '#FFFFFF',
      material: 'metal',
    },
    {
      id: uid('part'),
      name: 'Right Leg Frame',
      shape: 'box',
      xMm: 620,
      yMm: 0,
      zMm: 0,
      widthMm: 60,
      depthMm: 400,
      heightMm: 720,
      rotationDeg: 0,
      color: '#FFFFFF',
      material: 'metal',
    },
  ]);
  const [selectedPartId, setSelectedPartId] = useState<string>(parts[0].id);

  const activePart = parts.find((p) => p.id === selectedPartId) ?? parts[0];
  const bounds = useMemo(() => computeFurnitureBoundsMm(parts), [parts]);

  const updatePart = (id: string, patch: Partial<FurniturePart>) => {
    setParts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const addPrimitive = (shape: PartShape) => {
    const newPart: FurniturePart = {
      id: uid('part'),
      name: `${SHAPES.find((s) => s.id === shape)?.label ?? 'Part'} ${parts.length + 1}`,
      shape,
      xMm: 0,
      yMm: 0,
      zMm: 0,
      widthMm: 400,
      depthMm: 400,
      heightMm: 400,
      rotationDeg: 0,
      color: '#FFFFFF',
      material: 'wood',
    };
    setParts((prev) => [...prev, newPart]);
    setSelectedPartId(newPart.id);
  };

  const removePart = (id: string) => {
    if (parts.length <= 1) return;
    setParts((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (selectedPartId === id && next.length > 0) setSelectedPartId(next[0].id);
      return next;
    });
  };

  const handleSave = (placeOnPlan: boolean) => {
    const tpl: CatalogTemplate = {
      id: uid('custom'),
      name: name.trim() || 'Custom Object',
      category,
      description: `Custom multi-part object (${parts.length} parts)`,
      estimatedCostEur: 350,
      isCustom: true,
      parts,
      representation: generateRepresentationFromParts(parts),
    };
    onSaveAndPlace(tpl, placeOnPlan);
    onClose();
  };

  const planPad = Math.max(bounds.widthMm, bounds.depthMm) * 0.25 + 200;
  const planVb = `${bounds.minX - planPad} ${bounds.minY - planPad} ${bounds.widthMm + planPad * 2} ${bounds.depthMm + planPad * 2}`;
  const elevVb = `${bounds.minX - planPad} ${-bounds.maxZ - 250} ${bounds.widthMm + planPad * 2} ${bounds.heightMm + 400}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs">
        <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Custom Furniture Builder
            </h2>
            <p className="text-[11px] text-slate-500">
              Combine parametric primitives with independent metric dimensions and materials.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close builder"
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 overflow-y-auto">
          {/* Left: Parts List & Metadata */}
          <div className="md:col-span-4 border-r border-slate-200 dark:border-slate-800 p-3 space-y-3 overflow-y-auto">
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Object Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md font-medium"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Add Primitive Part</label>
              <div className="grid grid-cols-2 gap-1">
                {SHAPES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addPrimitive(s.id)}
                    className="px-2 py-1 text-left border border-slate-200 dark:border-slate-700 rounded hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3 text-blue-600" />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <div className="font-semibold text-[11px] text-slate-500 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" /> Parts ({parts.length})
              </div>
              {parts.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between px-2 py-1.5 rounded border cursor-pointer ${
                    activePart?.id === p.id
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedPartId(p.id)}
                    className="flex-1 flex items-center gap-2 text-left truncate cursor-pointer"
                  >
                    <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="truncate font-medium">{p.name}</span>
                  </button>
                  {parts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePart(p.id)}
                      aria-label={`Remove ${p.name}`}
                      className="p-0.5 text-red-500 hover:bg-red-50 rounded cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Center: Dual Preview (Plan Top + Front Elevation) */}
          <div className="md:col-span-4 border-r border-slate-200 dark:border-slate-800 p-3 flex flex-col gap-3 bg-slate-50 dark:bg-slate-950">
            <div className="flex-1 flex flex-col">
              <div className="text-[11px] font-medium text-slate-500 mb-1">
                Top Plan Preview ({Math.round(bounds.widthMm / 10)} × {Math.round(bounds.depthMm / 10)} cm)
              </div>
              <div className="flex-1 min-h-[160px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2">
                <svg viewBox={planVb} className="w-full h-full">
                  <line x1={-2000} y1={0} x2={2000} y2={0} stroke="#CBD5E1" strokeWidth={10} strokeDasharray="30 30" />
                  <line x1={0} y1={-2000} x2={0} y2={2000} stroke="#CBD5E1" strokeWidth={10} strokeDasharray="30 30" />
                  {parts.map((p) => {
                    const isSel = p.id === activePart?.id;
                    return p.shape === 'oval' || p.shape === 'cylinder' || p.shape === 'sphere' ? (
                      <ellipse
                        key={p.id}
                        cx={p.xMm}
                        cy={p.yMm}
                        rx={p.widthMm / 2}
                        ry={p.depthMm / 2}
                        transform={`rotate(${p.rotationDeg} ${p.xMm} ${p.yMm})`}
                        fill={p.color}
                        stroke={isSel ? '#2563EB' : '#334155'}
                        strokeWidth={isSel ? 24 : 10}
                        onClick={() => setSelectedPartId(p.id)}
                        className="cursor-pointer"
                      />
                    ) : (
                      <rect
                        key={p.id}
                        x={p.xMm - p.widthMm / 2}
                        y={p.yMm - p.depthMm / 2}
                        width={p.widthMm}
                        height={p.depthMm}
                        rx={p.shape === 'rounded_rect' ? Math.min(p.widthMm * 0.2, p.depthMm * 0.2, 120) : 12}
                        transform={`rotate(${p.rotationDeg} ${p.xMm} ${p.yMm})`}
                        fill={p.color}
                        stroke={isSel ? '#2563EB' : '#334155'}
                        strokeWidth={isSel ? 24 : 10}
                        onClick={() => setSelectedPartId(p.id)}
                        className="cursor-pointer"
                      />
                    );
                  })}
                </svg>
              </div>
            </div>

            <div className="flex-1 flex flex-col">
              <div className="text-[11px] font-medium text-slate-500 mb-1">
                Front Elevation (Height: {Math.round(bounds.heightMm / 10)} cm)
              </div>
              <div className="flex-1 min-h-[160px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2">
                <svg viewBox={elevVb} className="w-full h-full">
                  <line x1={-3000} y1={0} x2={3000} y2={0} stroke="#64748B" strokeWidth={14} />
                  {parts.map((p) => {
                    const isSel = p.id === activePart?.id;
                    return (
                      <rect
                        key={p.id}
                        x={p.xMm - p.widthMm / 2}
                        y={-(p.zMm + p.heightMm)}
                        width={p.widthMm}
                        height={p.heightMm}
                        fill={p.color}
                        stroke={isSel ? '#2563EB' : '#334155'}
                        strokeWidth={isSel ? 24 : 10}
                        onClick={() => setSelectedPartId(p.id)}
                        className="cursor-pointer"
                      />
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>

          {/* Right: Selected Part Properties */}
          {activePart && (
            <div className="md:col-span-4 p-3 space-y-2.5 overflow-y-auto">
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">Part Name</label>
                <input
                  type="text"
                  value={activePart.name}
                  onChange={(e) => updatePart(activePart.id, { name: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">Shape & Material</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={activePart.shape}
                    onChange={(e) => updatePart(activePart.id, { shape: e.target.value as PartShape })}
                    className="px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md"
                  >
                    {SHAPES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={activePart.material}
                    onChange={(e) =>
                      updatePart(activePart.id, { material: e.target.value as MaterialPreset })
                    }
                    className="px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md"
                  >
                    {MATERIAL_CATEGORIES.map((category) => (
                      <optgroup key={category} label={category}>
                        {MATERIAL_PRESETS.filter((m) => m.category === category).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <MetricInput
                  label="Width"
                  valueMm={activePart.widthMm}
                  unit="cm"
                  minMm={10}
                  onChangeMm={(mm) => updatePart(activePart.id, { widthMm: mm })}
                />
                <MetricInput
                  label="Depth"
                  valueMm={activePart.depthMm}
                  unit="cm"
                  minMm={10}
                  onChangeMm={(mm) => updatePart(activePart.id, { depthMm: mm })}
                />
                <MetricInput
                  label="Height"
                  valueMm={activePart.heightMm}
                  unit="cm"
                  minMm={10}
                  onChangeMm={(mm) => updatePart(activePart.id, { heightMm: mm })}
                />
                <MetricInput
                  label="Offset X"
                  valueMm={activePart.xMm}
                  unit="cm"
                  minMm={-5000}
                  onChangeMm={(mm) => updatePart(activePart.id, { xMm: mm })}
                />
                <MetricInput
                  label="Offset Y"
                  valueMm={activePart.yMm}
                  unit="cm"
                  minMm={-5000}
                  onChangeMm={(mm) => updatePart(activePart.id, { yMm: mm })}
                />
                <MetricInput
                  label="Base Z"
                  valueMm={activePart.zMm}
                  unit="cm"
                  minMm={0}
                  onChangeMm={(mm) => updatePart(activePart.id, { zMm: mm })}
                />
              </div>

              <NumberField
                label="Part Rotation"
                value={activePart.rotationDeg}
                unitLabel="°"
                onChange={(deg) => updatePart(activePart.id, { rotationDeg: deg })}
              />

              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">Part Color</span>
                  <span className="font-mono-nums text-[11px]">{activePart.color}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={activePart.color}
                    onChange={(e) => updatePart(activePart.id, { color: e.target.value.toUpperCase() })}
                    className="w-8 h-7 rounded border border-slate-300 cursor-pointer"
                  />
                  <div className="grid grid-cols-8 gap-1 flex-1">
                    {SWATCH_PALETTE.slice(0, 16).map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => updatePart(activePart.id, { color: hex })}
                        className="h-3.5 rounded-xs border border-slate-300 dark:border-slate-700 cursor-pointer"
                        style={{ backgroundColor: hex }}
                        aria-label={`Color ${hex}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50 dark:bg-slate-950">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 font-medium hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Save to My Library
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            className="px-3.5 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 cursor-pointer"
          >
            Save & Place on Plan
          </button>
        </footer>
      </div>
    </div>
  );
};
