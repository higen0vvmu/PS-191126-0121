import React, { useEffect, useState } from 'react';
import { UnitDisplay } from '../types/plan';
import { mmToUnitValue, unitValueToMm } from '../utils/units';

interface MetricInputProps {
  label: string;
  valueMm: number;
  unit?: UnitDisplay;
  minMm?: number;
  maxMm?: number;
  stepMm?: number;
  onChangeMm: (nextMm: number) => void;
  disabled?: boolean;
  isMixed?: boolean;
}

export const MetricInput: React.FC<MetricInputProps> = ({
  label,
  valueMm,
  unit = 'cm',
  minMm = 1,
  maxMm = 50000,
  onChangeMm,
  disabled = false,
  isMixed = false,
}) => {
  const [draft, setDraft] = useState(() => (isMixed ? '' : String(mmToUnitValue(valueMm, unit))));

  useEffect(() => {
    setDraft(isMixed ? '' : String(mmToUnitValue(valueMm, unit)));
  }, [valueMm, unit, isMixed]);

  const commit = () => {
    if (isMixed && draft.trim() === '') return;
    const num = Number(draft);
    if (!Number.isFinite(num) || draft.trim() === '') {
      setDraft(isMixed ? '' : String(mmToUnitValue(valueMm, unit)));
      return;
    }
    const mm = Math.max(minMm, Math.min(maxMm, Math.round(unitValueToMm(num, unit))));
    onChangeMm(mm);
    setDraft(String(mmToUnitValue(mm, unit)));
  };

  return (
    <div>
      <label className="flex items-center justify-between gap-1 text-[11px] text-slate-500 dark:text-slate-400 mb-0.5 truncate">
        <span className="truncate">{label}</span>
        {isMixed && (
          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 shrink-0">
            Mixed
          </span>
        )}
      </label>
      <div className="relative flex items-center">
        <input
          type="number"
          step="any"
          disabled={disabled}
          value={draft}
          placeholder={isMixed ? 'Mixed' : undefined}
          aria-label={`${label} (${unit})`}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-full pl-2.5 pr-8 py-1.5 text-xs font-mono-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 placeholder:text-amber-600/80 dark:placeholder:text-amber-400/80 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <span className="absolute right-2 text-[11px] font-mono-nums text-slate-400 pointer-events-none select-none">
          {unit}
        </span>
      </div>
    </div>
  );
};

interface NumberFieldProps {
  label: string;
  value: number;
  unitLabel: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (next: number) => void;
  isMixed?: boolean;
}

export const NumberField: React.FC<NumberFieldProps> = ({
  label,
  value,
  unitLabel,
  min = -100000,
  max = 100000,
  step = 1,
  onChange,
  isMixed = false,
}) => {
  const [draft, setDraft] = useState(() =>
    isMixed ? '' : String(Math.round(value * 100) / 100)
  );

  useEffect(() => {
    setDraft(isMixed ? '' : String(Math.round(value * 100) / 100));
  }, [value, isMixed]);

  const commit = () => {
    if (isMixed && draft.trim() === '') return;
    const num = Number(draft);
    if (!Number.isFinite(num) || draft.trim() === '') {
      setDraft(isMixed ? '' : String(Math.round(value * 100) / 100));
      return;
    }
    const clamped = Math.max(min, Math.min(max, num));
    onChange(clamped);
    setDraft(String(Math.round(clamped * 100) / 100));
  };

  return (
    <div>
      <label className="flex items-center justify-between gap-1 text-[11px] text-slate-500 dark:text-slate-400 mb-0.5 truncate">
        <span className="truncate">{label}</span>
        {isMixed && (
          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 shrink-0">
            Mixed
          </span>
        )}
      </label>
      <div className="relative flex items-center">
        <input
          type="number"
          step={step}
          value={draft}
          placeholder={isMixed ? 'Mixed' : undefined}
          aria-label={`${label} (${unitLabel})`}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-full pl-2.5 pr-8 py-1.5 text-xs font-mono-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 placeholder:text-amber-600/80 dark:placeholder:text-amber-400/80 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="absolute right-2 text-[11px] font-mono-nums text-slate-400 pointer-events-none select-none">
          {unitLabel}
        </span>
      </div>
    </div>
  );
};
