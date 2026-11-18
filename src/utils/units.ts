import type { ScalePreset, UnitDisplay } from '../types/plan';

let uidCounter = 0;

export function uid(prefix = 'id'): string {
  uidCounter = (uidCounter + 1) % 100000;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}_${rand}`;
}

export function mmToUnitValue(mm: number, unit: UnitDisplay): number {
  if (!Number.isFinite(mm)) return 0;
  if (unit === 'mm') return Math.round(mm);
  if (unit === 'cm') return Math.round((mm / 10) * 100) / 100;
  return Math.round((mm / 1000) * 1000) / 1000;
}

export function unitValueToMm(val: number, unit: UnitDisplay): number {
  if (!Number.isFinite(val)) return 0;
  if (unit === 'mm') return val;
  if (unit === 'cm') return val * 10;
  return val * 1000;
}

export function formatSmartMetric(mm: number, preferredUnit?: UnitDisplay): string {
  if (!Number.isFinite(mm)) return '0 mm';
  const abs = Math.abs(mm);
  if (preferredUnit === 'mm' || (preferredUnit === undefined && abs < 10)) {
    return `${Math.round(mm)} mm`;
  }
  if (preferredUnit === 'm' || (preferredUnit === undefined && abs >= 1000)) {
    const meters = mm / 1000;
    return `${meters.toFixed(2)} m`;
  }
  const cm = mm / 10;
  const rounded = Math.abs(cm - Math.round(cm)) < 0.05 ? String(Math.round(cm)) : cm.toFixed(1);
  return `${rounded} cm`;
}

export function formatAreaM2(areaM2: number): string {
  if (!Number.isFinite(areaM2)) return '0.0 m²';
  return `${areaM2.toFixed(areaM2 < 10 ? 2 : 1)} m²`;
}

export function scaleToBaseZoom(scale: ScalePreset): number {
  // Approximate CSS px per mm on standard 96 DPI display (~3.78 px/mm) scaled by architectural ratio
  const ratio = Number(scale.split(':')[1]) || 50;
  return 3.78 / ratio;
}
