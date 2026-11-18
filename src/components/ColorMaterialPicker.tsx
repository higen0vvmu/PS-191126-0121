import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Pipette, Sparkles } from 'lucide-react';
import {
  getMaterialPresetMeta,
  MATERIAL_CATEGORIES,
  MATERIAL_PRESETS,
  MaterialPresetMeta,
  SWATCH_PALETTE,
} from '../data/materials';
import { MaterialPreset } from '../types/plan';

interface ColorMaterialPickerProps {
  label: string;
  color: string;
  material?: MaterialPreset;
  isMixedColor?: boolean;
  isMixedMaterial?: boolean;
  textureScale?: number;
  textureRotDeg?: number;
  recentColors: string[];
  onColorChange: (hex: string) => void;
  onMaterialChange?: (mat: MaterialPreset) => void;
  onTextureScaleChange?: (scale: number) => void;
  onTextureRotChange?: (rotDeg: number) => void;
  onActivateEyedropper?: () => void;
  onApplyToSimilar?: () => void;
  applySimilarLabel?: string;
}

function drawMaterialPreview(ctx: CanvasRenderingContext2D, meta: MaterialPresetMeta, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = meta.previewBase;
  ctx.fillRect(0, 0, w, h);

  const acc = meta.previewAccent;
  const sec = meta.previewSecondary ?? acc;
  const id = meta.id;

  if (id === 'satin_paint' || id === 'plastic_gloss') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, meta.previewBase);
    g.addColorStop(0.45, '#FFFFFF');
    g.addColorStop(0.65, meta.previewAccent);
    g.addColorStop(1, meta.previewBase);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (id === 'paint' || id === 'plastic_matte') {
    ctx.fillStyle = acc;
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 36; i++) {
      const px = ((i * 29) % w);
      const py = ((i * 17) % h);
      ctx.fillRect(px, py, 2, 2);
    }
    ctx.globalAlpha = 1;
    const shade = ctx.createLinearGradient(0, 0, w, h);
    shade.addColorStop(0, 'rgba(255,255,255,0.22)');
    shade.addColorStop(1, 'rgba(15,23,42,0.08)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
  } else if (id === 'plaster') {
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 === 0 ? acc : 'rgba(255,255,255,0.35)';
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.ellipse((i * 19 + 8) % w, (i * 11 + 6) % h, 14, 7, 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (id === 'wallpaper') {
    ctx.strokeStyle = acc;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    for (let x = 3; x < w; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 4; y < h; y += 8) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (id === 'paneling') {
    for (let x = 0; x < w; x += 6) {
      ctx.fillStyle = acc;
      ctx.fillRect(x, 0, 2.2, h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + 2.2, 0, 1, h);
    }
  } else if (id === 'wood' || id === 'oak' || id === 'walnut' || id === 'teak' || id === 'smoked_oak') {
    ctx.strokeStyle = acc;
    ctx.lineWidth = 1.1;
    for (let y = 3; y < h; y += 5) {
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y - 2, w * 0.7, y + 2, w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = acc;
    ctx.fillRect(0, Math.round(h * 0.5), w, 1);
    ctx.globalAlpha = 1;
  } else if (id === 'parquet') {
    const bw = 11;
    const bh = 7;
    ctx.strokeStyle = acc;
    ctx.lineWidth = 0.9;
    for (let row = 0; row * bh < h; row++) {
      for (let col = 0; col * bw < w; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? meta.previewBase : '#BE9464';
        ctx.fillRect(col * bw, row * bh, bw, bh);
        ctx.strokeRect(col * bw, row * bh, bw, bh);
      }
    }
  } else if (id === 'herringbone') {
    ctx.strokeStyle = acc;
    ctx.lineWidth = 1.2;
    for (let x = -h; x < w + h; x += 10) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 12, h * 0.5);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  } else if (id === 'marble' || id === 'calacatta_gold' || id === 'nero_marble') {
    ctx.strokeStyle = acc;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.78;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.82);
    ctx.bezierCurveTo(w * 0.28, h * 0.45, w * 0.62, h * 0.6, w, h * 0.14);
    ctx.stroke();
    ctx.strokeStyle = sec;
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(w * 0.12, h);
    ctx.bezierCurveTo(w * 0.45, h * 0.25, w * 0.75, h * 0.35, w * 0.92, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (id === 'travertine') {
    ctx.fillStyle = acc;
    for (let y = 3; y < h; y += 4) {
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, y, w, 1.3);
      ctx.globalAlpha = 0.65;
      ctx.fillRect((y * 7) % (w - 10), y, 8, 1.4);
    }
    ctx.globalAlpha = 1;
  } else if (id === 'slate') {
    ctx.fillStyle = acc;
    for (let i = 0; i < 6; i++) {
      ctx.globalAlpha = 0.42;
      ctx.beginPath();
      ctx.moveTo(i * 8, (i % 2) * 10);
      ctx.lineTo(i * 8 + 16, ((i + 1) % 3) * 10 + 4);
      ctx.lineTo(i * 8 + 10, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (id === 'concrete') {
    for (let i = 0; i < 55; i++) {
      ctx.fillStyle = i % 2 === 0 ? acc : '#D1D5DB';
      ctx.globalAlpha = 0.5;
      ctx.fillRect((i * 13) % w, (i * 23) % h, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
  } else if (id === 'brick') {
    ctx.fillStyle = acc;
    const bh = 7;
    const bw = 14;
    for (let y = 0; y < h; y += bh) {
      ctx.fillRect(0, y, w, 1.4);
      const offset = Math.floor(y / bh) % 2 === 0 ? 0 : bw / 2;
      for (let x = offset; x < w; x += bw) {
        ctx.fillRect(x, y, 1.4, bh);
        if ((x + y) % 3 === 0) {
          ctx.fillStyle = sec;
          ctx.fillRect(x + 1.4, y + 1.4, bw - 1.4, bh - 1.4);
          ctx.fillStyle = acc;
        }
      }
    }
  } else if (id === 'tile') {
    ctx.strokeStyle = acc;
    ctx.lineWidth = 1.2;
    for (let x = 0; x <= w; x += 11) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 10) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  } else if (id === 'hex_tile') {
    ctx.strokeStyle = acc;
    ctx.lineWidth = 1;
    const r = 5.5;
    const dx = r * 1.6;
    const dy = r * 1.45;
    for (let row = -1; row < 4; row++) {
      for (let col = -1; col < 6; col++) {
        const cx = col * dx + (row % 2 === 0 ? 0 : dx * 0.5);
        const cy = row * dy;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k + Math.PI / 6;
          const px = cx + r * 0.85 * Math.cos(a);
          const py = cy + r * 0.85 * Math.sin(a);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  } else if (id === 'checker') {
    const s = 7.5;
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        ctx.fillStyle = (Math.floor(x / s) + Math.floor(y / s)) % 2 === 0 ? meta.previewBase : acc;
        ctx.fillRect(x, y, s, s);
      }
    }
  } else if (id === 'terrazzo') {
    const chips = [acc, sec, '#334155', '#D97706', '#94A3B8'];
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = chips[i % chips.length];
      const cx = ((i * 19 + 5) % (w - 4)) + 2;
      const cy = ((i * 11 + 4) % (h - 4)) + 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 3, cy + 1);
      ctx.lineTo(cx + 1.5, cy + 3.5);
      ctx.closePath();
      ctx.fill();
    }
  } else if (id === 'fabric') {
    ctx.strokeStyle = acc;
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = 0.5;
    for (let x = 1; x < w; x += 3) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 1; y < h; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (id === 'boucle') {
    ctx.strokeStyle = acc;
    ctx.lineWidth = 1;
    for (let y = 3; y < h; y += 5) {
      for (let x = 3; x < w; x += 5) {
        ctx.beginPath();
        ctx.arc(x + (y % 2), y, 1.8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  } else if (id === 'velvet') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, acc);
    g.addColorStop(0.5, meta.previewBase);
    g.addColorStop(1, acc);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (id === 'leather_cognac' || id === 'leather_black' || id === 'leather_cream') {
    ctx.strokeStyle = acc;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 24; i++) {
      const cx = (i * 13 + 4) % w;
      const cy = (i * 9 + 3) % h;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (id === 'metal' || id === 'brass' || id === 'bronze' || id === 'chrome' || id === 'matte_black_metal') {
    const g = ctx.createLinearGradient(0, 0, w, h * 0.7);
    g.addColorStop(0, acc);
    g.addColorStop(0.32, meta.previewBase);
    g.addColorStop(0.48, '#FFFFFF');
    g.addColorStop(0.68, meta.previewBase);
    g.addColorStop(1, acc);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (id !== 'chrome') {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 0.7;
      for (let y = 2; y < h; y += 3) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }
  } else if (id === 'glass') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#E0F2FE');
    g.addColorStop(0.45, '#FFFFFF');
    g.addColorStop(1, '#BAE6FD');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(6, h);
    ctx.lineTo(w * 0.55, 0);
    ctx.stroke();
  }
}

export const MaterialSwatchPreview: React.FC<{ preset: MaterialPreset; className?: string }> = ({
  preset,
  className = 'w-11 h-7 rounded border border-slate-300 dark:border-slate-600 shrink-0 shadow-xs',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meta = getMaterialPresetMeta(preset);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawMaterialPreview(ctx, meta, canvas.width, canvas.height);
  }, [meta]);

  return <canvas ref={canvasRef} width={44} height={28} className={className} />;
};

export const ColorMaterialPicker: React.FC<ColorMaterialPickerProps> = ({
  label,
  color,
  material,
  isMixedColor = false,
  isMixedMaterial = false,
  textureScale,
  textureRotDeg,
  recentColors,
  onColorChange,
  onMaterialChange,
  onTextureScaleChange,
  onTextureRotChange,
  onActivateEyedropper,
  onApplyToSimilar,
  applySimilarLabel = 'Apply to all similar',
}) => {
  const [hexDraft, setHexDraft] = useState(isMixedColor ? '' : color);
  const [matOpen, setMatOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHexDraft(isMixedColor ? '' : color);
  }, [color, isMixedColor]);

  useEffect(() => {
    if (!matOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMatOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMatOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [matOpen]);

  const commitHex = (val: string) => {
    const cleaned = val.startsWith('#') ? val : `#${val}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(cleaned)) {
      onColorChange(cleaned.toUpperCase());
    }
  };

  const activeMeta = material ? getMaterialPresetMeta(material) : null;

  return (
    <div className="space-y-2.5 border-t border-slate-200 dark:border-slate-800 pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
          <span>{label}</span>
          {isMixedColor && (
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
              Mixed
            </span>
          )}
        </span>
        {onApplyToSimilar && (
          <button
            type="button"
            onClick={onApplyToSimilar}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Sparkles className="w-3 h-3" />
            {applySimilarLabel}
          </button>
        )}
      </div>

      {/* Color input + Hex + Eyedropper */}
      <div className="flex items-center gap-2">
        <label className="relative w-8 h-8 rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden shrink-0 cursor-pointer">
          <input
            type="color"
            value={!isMixedColor && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#CBD5E1'}
            onChange={(e) => onColorChange(e.target.value.toUpperCase())}
            aria-label={`${label} color swatch`}
            className="absolute inset-0 w-12 h-12 -top-2 -left-2 cursor-pointer opacity-100"
          />
        </label>
        <input
          type="text"
          value={hexDraft}
          onChange={(e) => {
            setHexDraft(e.target.value);
            commitHex(e.target.value);
          }}
          aria-label={`${label} hex value`}
          className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 placeholder:text-amber-600/80 dark:placeholder:text-amber-400/80 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={isMixedColor ? 'Mixed colors' : '#FFFFFF'}
        />
        {onActivateEyedropper && (
          <button
            type="button"
            onClick={onActivateEyedropper}
            title="Pick color from plan"
            aria-label={`Eyedropper for ${label}`}
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Pipette className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Recent Colors */}
      {recentColors.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Recent colors</div>
          <div className="flex flex-wrap gap-1">
            {recentColors.slice(0, 8).map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => onColorChange(hex)}
                aria-label={`Use recent color ${hex}`}
                className={`w-5 h-5 rounded border transition-transform hover:scale-110 cursor-pointer ${
                  !isMixedColor && color.toUpperCase() === hex.toUpperCase()
                    ? 'ring-2 ring-blue-500 border-white dark:border-slate-900'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Swatch Palette */}
      <div className="grid grid-cols-8 gap-1">
        {SWATCH_PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => onColorChange(hex)}
            aria-label={`Select color ${hex}`}
            className={`w-full aspect-square rounded border transition-transform hover:scale-110 cursor-pointer ${
              !isMixedColor && color.toUpperCase() === hex.toUpperCase()
                ? 'ring-2 ring-blue-500 border-white dark:border-slate-900'
                : 'border-slate-200 dark:border-slate-700'
            }`}
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>

      {/* Material Preset Visual Dropdown */}
      {(material || isMixedMaterial) && onMaterialChange && (
        <div className="space-y-1.5 relative" ref={dropdownRef}>
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Material finish</span>
            {isMixedMaterial && (
              <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                Mixed
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMatOpen((v) => !v)}
            aria-label={`${label} material`}
            aria-expanded={matOpen}
            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md hover:border-blue-400 dark:hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {!isMixedMaterial && activeMeta ? (
                <>
                  <MaterialSwatchPreview preset={activeMeta.id} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                      {activeMeta.label}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {activeMeta.category} · {activeMeta.finishLabel}
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  Mixed materials (click to unify)
                </div>
              )}
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                matOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {matOpen && (
            <div
              role="listbox"
              aria-label={`${label} material options`}
              className="mt-1 w-full max-h-80 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1.5 space-y-2 z-40"
            >
              {MATERIAL_CATEGORIES.map((category) => {
                const items = MATERIAL_PRESETS.filter((m) => m.category === category);
                return (
                  <div key={category} className="space-y-1">
                    <div className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {category}
                    </div>
                    <div className="space-y-0.5">
                      {items.map((m) => {
                        const isSelected = !isMixedMaterial && material === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                              onMaterialChange(m.id);
                              setMatOpen(false);
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/40'
                                : 'hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <MaterialSwatchPreview preset={m.id} />
                              <div className="min-w-0">
                                <div className="text-[11px] font-medium truncate">{m.label}</div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                  {m.finishLabel} · rough {Math.round(m.roughness * 100)}%
                                </div>
                              </div>
                            </div>
                            {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Texture Scale & Rotation */}
      {onTextureScaleChange && typeof textureScale === 'number' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
              <span>Pattern scale</span>
              <span className="font-mono-nums">{textureScale.toFixed(1)}x</span>
            </label>
            <input
              type="range"
              min={0.4}
              max={4}
              step={0.1}
              value={textureScale}
              onChange={(e) => onTextureScaleChange(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>
          {onTextureRotChange && typeof textureRotDeg === 'number' && (
            <div>
              <label className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                <span>Rotation</span>
                <span className="font-mono-nums">{Math.round(textureRotDeg)}°</span>
              </label>
              <input
                type="range"
                min={0}
                max={180}
                step={15}
                value={textureRotDeg}
                onChange={(e) => onTextureRotChange(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
