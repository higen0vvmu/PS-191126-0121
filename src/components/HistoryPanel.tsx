import React, { useEffect, useRef } from 'react';
import {
  History as HistoryIcon,
  Redo2,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react';
import { HistoryEntry } from '../hooks/usePlanState';

interface HistoryPanelProps {
  entries: HistoryEntry[];
  activeIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onJumpToStep: (index: number) => void;
  onClose: () => void;
}

function formatStepTime(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  entries,
  activeIndex,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onJumpToStep,
  onClose,
}) => {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, entries.length]);

  return (
    <div
      role="dialog"
      aria-label="History Steps"
      className="absolute top-3 right-3 z-40 w-72 max-h-[68vh] flex flex-col bg-white/98 dark:bg-slate-900/98 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden text-xs select-none"
    >
      {/* Header */}
      <div className="px-3 py-2 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
          <HistoryIcon className="w-3.5 h-3.5 text-blue-600" />
          <span>History</span>
          <span className="font-mono-nums text-[10px] font-normal text-slate-400">
            ({activeIndex + 1}/{entries.length})
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close History window"
          className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Steps List (Photoshop style: oldest at top, active highlighted, future dimmed) */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {entries.map((entry, idx) => {
          const isCurrent = idx === activeIndex;
          const isFuture = idx > activeIndex;
          return (
            <button
              key={entry.id}
              ref={isCurrent ? activeRef : undefined}
              type="button"
              onClick={() => onJumpToStep(idx)}
              className={`w-full px-2.5 py-1.5 rounded-md flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                isCurrent
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : isFuture
                    ? 'text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/70 italic'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={`font-mono-nums text-[10px] w-4 shrink-0 ${
                    isCurrent ? 'text-blue-100' : 'text-slate-400'
                  }`}
                >
                  {idx === 0 ? '•' : idx}
                </span>
                <span className="truncate">{entry.label}</span>
              </span>
              <span
                className={`font-mono-nums text-[10px] shrink-0 ${
                  isCurrent ? 'text-blue-100' : 'text-slate-400'
                }`}
              >
                {formatStepTime(entry.timestamp)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer Undo / Redo / Reset */}
      <div className="px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            title="Step Backward (Ctrl+Z)"
            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
          >
            <Undo2 className="w-3 h-3" />
            <span>Undo</span>
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            title="Step Forward (Ctrl+Y)"
            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
          >
            <Redo2 className="w-3 h-3" />
            <span>Redo</span>
          </button>
        </div>
        <button
          type="button"
          disabled={activeIndex === 0}
          onClick={() => onJumpToStep(0)}
          title="Jump back to initial open state"
          className="px-2 py-1 rounded text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 disabled:opacity-35 flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Initial</span>
        </button>
      </div>
    </div>
  );
};
