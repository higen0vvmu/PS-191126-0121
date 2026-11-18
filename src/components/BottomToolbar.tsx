import React, { useEffect, useState } from 'react';
import {
  EyeOff,
  Grid,
  Magnet,
  Maximize2,
  Ruler,
  Scissors,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AngleSnapDeg,
  GridSizeMm,
  Point2D,
  ProjectSettings,
  ScalePreset,
  UnitDisplay,
  ViewMode,
} from '../types/plan';

interface BottomToolbarProps {
  settings: ProjectSettings;
  viewMode: ViewMode;
  zoomMultiplier: number;
  cursorCoordsMm: Point2D;
  onUpdateSettings: (partial: Partial<ProjectSettings>) => void;
  onZoomChange: (nextMult: number) => void;
  onFitToScreen: () => void;
}

const SCALES: ScalePreset[] = ['1:10', '1:20', '1:25', '1:50', '1:100', '1:200'];
const GRID_SIZES: Array<{ mm: GridSizeMm; label: string }> = [
  { mm: 10, label: '1 cm' },
  { mm: 50, label: '5 cm' },
  { mm: 100, label: '10 cm' },
  { mm: 500, label: '50 cm' },
];
const ANGLE_SNAPS: Array<{ deg: AngleSnapDeg; label: string }> = [
  { deg: 15, label: '15°' },
  { deg: 45, label: '45°' },
  { deg: 90, label: '90°' },
  { deg: 0, label: 'Free' },
];
const UNITS: UnitDisplay[] = ['mm', 'cm', 'm'];

export const BottomToolbar: React.FC<BottomToolbarProps> = ({
  settings,
  viewMode,
  zoomMultiplier,
  cursorCoordsMm,
  onUpdateSettings,
  onZoomChange,
  onFitToScreen,
}) => {
  const show3dControls = viewMode === '3d';
  const zoomPct = Math.round(zoomMultiplier * 100);
  const [zoomDraft, setZoomDraft] = useState(String(zoomPct));
  const [zoomFocused, setZoomFocused] = useState(false);

  useEffect(() => {
    if (!zoomFocused) {
      setZoomDraft(String(zoomPct));
    }
  }, [zoomPct, zoomFocused]);

  const commitZoomDraft = () => {
    const parsed = Number(zoomDraft);
    if (Number.isFinite(parsed) && parsed > 0) {
      const clamped = Math.max(15, Math.min(600, Math.round(parsed)));
      onZoomChange(clamped / 100);
      setZoomDraft(String(clamped));
    } else {
      setZoomDraft(String(zoomPct));
    }
    setZoomFocused(false);
  };

  return (
    <footer className="h-10 shrink-0 px-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px] overflow-x-auto">
      {/* Left: Scale, Zoom, Grid, Snap, Angle, Ortho, Units */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Scale</span>
          <select
            value={settings.scale}
            onChange={(e) => onUpdateSettings({ scale: e.target.value as ScalePreset })}
            aria-label="Drawing scale"
            className="px-1.5 py-1 font-mono-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {SCALES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded overflow-hidden bg-white dark:bg-slate-950">
          <button
            type="button"
            onClick={() => onZoomChange(Math.max(0.15, zoomMultiplier * 0.85))}
            title="Zoom out (-)"
            aria-label="Zoom out"
            className="px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <label className="flex items-center px-1 border-x border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 cursor-text">
            <input
              type="number"
              min={15}
              max={600}
              step={5}
              value={zoomDraft}
              aria-label="Zoom percentage"
              title="Click to type zoom percentage (15–600%)"
              onFocus={(e) => {
                setZoomFocused(true);
                e.currentTarget.select();
              }}
              onChange={(e) => setZoomDraft(e.target.value)}
              onBlur={commitZoomDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitZoomDraft();
                  (e.currentTarget as HTMLInputElement).blur();
                } else if (e.key === 'Escape') {
                  setZoomDraft(String(zoomPct));
                  setZoomFocused(false);
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              className="w-10 text-center font-mono-nums text-slate-700 dark:text-slate-200 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-slate-400 font-mono-nums pr-0.5 select-none">%</span>
          </label>
          <button
            type="button"
            onClick={() => onZoomChange(Math.min(6, zoomMultiplier * 1.15))}
            title="Zoom in (+)"
            aria-label="Zoom in"
            className="px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onFitToScreen}
            title="Fit plan to screen (0)"
            aria-label="Fit to screen"
            className="px-1.5 py-1 border-l border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onUpdateSettings({ showGrid: !settings.showGrid })}
            title="Toggle Grid (G)"
            aria-pressed={settings.showGrid}
            className={`px-2 py-1 rounded border flex items-center gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              settings.showGrid
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
          >
            <Grid className="w-3 h-3" />
            <span>Grid</span>
          </button>
          <select
            value={settings.gridSizeMm}
            onChange={(e) => onUpdateSettings({ gridSizeMm: Number(e.target.value) as GridSizeMm })}
            aria-label="Grid spacing"
            className="px-1.5 py-1 font-mono-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {GRID_SIZES.map((g) => (
              <option key={g.mm} value={g.mm}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => onUpdateSettings({ snapEnabled: !settings.snapEnabled })}
          title="Toggle Snap (K)"
          aria-pressed={settings.snapEnabled}
          className={`px-2 py-1 rounded border flex items-center gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            settings.snapEnabled
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
              : 'border-slate-200 dark:border-slate-700 text-slate-500'
          }`}
        >
          <Magnet className="w-3 h-3" />
          <span>Snap</span>
        </button>

        <div className="flex items-center gap-1">
          <span className="text-slate-500">Angle</span>
          <select
            value={settings.angleSnapDeg}
            onChange={(e) => onUpdateSettings({ angleSnapDeg: Number(e.target.value) as AngleSnapDeg })}
            aria-label="Angle snap"
            className="px-1.5 py-1 font-mono-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {ANGLE_SNAPS.map((a) => (
              <option key={a.deg} value={a.deg}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => onUpdateSettings({ orthoMode: !settings.orthoMode })}
          aria-pressed={settings.orthoMode}
          className={`px-2 py-1 rounded border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            settings.orthoMode
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
              : 'border-slate-200 dark:border-slate-700 text-slate-500'
          }`}
        >
          Ortho
        </button>

        <button
          type="button"
          onClick={() => onUpdateSettings({ autoDimensions: !settings.autoDimensions })}
          title="Show automatic wall and opening dimension chains"
          aria-pressed={settings.autoDimensions}
          className={`px-2 py-1 rounded border flex items-center gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            settings.autoDimensions
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
              : 'border-slate-200 dark:border-slate-700 text-slate-500'
          }`}
        >
          <Ruler className="w-3 h-3" />
          <span>Dims</span>
        </button>

        <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded overflow-hidden" role="group" aria-label="Preferred display unit">
          {UNITS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => onUpdateSettings({ preferredUnit: u })}
              aria-pressed={settings.preferredUnit === u}
              className={`px-1.5 py-1 font-mono-nums cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                settings.preferredUnit === u
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* Right: 3D Cutaway controls + Metric Cursor Coordinates */}
      <div className="flex items-center gap-2 shrink-0">
        {show3dControls && (
          <div className="flex items-center gap-2 border-r border-slate-200 dark:border-slate-700 pr-2">
            <button
              type="button"
              onClick={() => onUpdateSettings({ cutawayEnabled: !settings.cutawayEnabled })}
              aria-pressed={settings.cutawayEnabled}
              className={`px-2 py-1 rounded border flex items-center gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                settings.cutawayEnabled
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500'
              }`}
            >
              <Scissors className="w-3 h-3" />
              <span>Cutaway</span>
            </button>
            {settings.cutawayEnabled && (
              <div className="flex items-center gap-1.5">
                <input
                  type="range"
                  min={300}
                  max={2800}
                  step={50}
                  value={settings.cutawayHeightMm}
                  onChange={(e) => onUpdateSettings({ cutawayHeightMm: Number(e.target.value) })}
                  aria-label="Cutaway height"
                  className="w-20 accent-blue-600"
                />
                <span className="font-mono-nums text-slate-600 dark:text-slate-300 w-12">
                  {(settings.cutawayHeightMm / 1000).toFixed(2)} m
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => onUpdateSettings({ hideFrontWalls: !settings.hideFrontWalls })}
              aria-pressed={settings.hideFrontWalls}
              className={`px-2 py-1 rounded border flex items-center gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                settings.hideFrontWalls
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500'
              }`}
            >
              <EyeOff className="w-3 h-3" />
              <span>Auto-Hide Walls</span>
            </button>
          </div>
        )}

        <div
          className="font-mono-nums text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-0.5 min-w-[140px] text-center"
          aria-label="Cursor coordinates"
        >
          X {(cursorCoordsMm.x / 1000).toFixed(2)} m · Y {(cursorCoordsMm.y / 1000).toFixed(2)} m
        </div>
      </div>
    </footer>
  );
};
