import React, { useEffect, useState } from 'react';
import { Keyboard, RotateCcw, Sliders, X } from 'lucide-react';
import { GridSizeMm, ProjectSettings, UnitDisplay } from '../types/plan';
import {
  DEFAULT_KEYBINDS,
  formatKeyLabel,
  KEYBIND_DEFINITIONS,
  KeybindAction,
  KeybindMap,
  rebindKey,
} from '../utils/keybinds';

interface SettingsModalProps {
  initialTab?: 'general' | 'keybinds';
  keybinds: KeybindMap;
  settings: ProjectSettings;
  onChangeKeybinds: (next: KeybindMap) => void;
  onUpdateSettings: (partial: Partial<ProjectSettings>) => void;
  onClose: () => void;
}

const GROUPS = [
  'Drawing & Placement Tools',
  'Measurements & Annotations',
  'Navigation & Quick Actions',
] as const;

export const SettingsModal: React.FC<SettingsModalProps> = ({
  initialTab = 'keybinds',
  keybinds,
  settings,
  onChangeKeybinds,
  onUpdateSettings,
  onClose,
}) => {
  const [tab, setTab] = useState<'general' | 'keybinds'>(initialTab);
  const [listeningAction, setListeningAction] = useState<KeybindAction | null>(null);
  const [conflictNote, setConflictNote] = useState<string | null>(null);

  useEffect(() => {
    if (!listeningAction) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setListeningAction(null);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;

      const { next, swappedWith } = rebindKey(keybinds, listeningAction, e.key);
      onChangeKeybinds(next);
      if (swappedWith) {
        const swappedDef = KEYBIND_DEFINITIONS.find((d) => d.action === swappedWith);
        setConflictNote(
          `Key "${formatKeyLabel(e.key)}" swapped with "${swappedDef?.label ?? swappedWith}".`
        );
      } else {
        setConflictNote(null);
      }
      setListeningAction(null);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [listeningAction, keybinds, onChangeKeybinds]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-full max-w-2xl max-h-[86vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 id="settings-modal-title" className="text-sm font-semibold">
              Settings
            </h2>
            <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setTab('keybinds')}
                className={`px-3 py-1 rounded-md flex items-center gap-1.5 font-medium cursor-pointer ${
                  tab === 'keybinds'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Keyboard className="w-3.5 h-3.5" />
                <span>Keybinds</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('general')}
                className={`px-3 py-1 rounded-md flex items-center gap-1.5 font-medium cursor-pointer ${
                  tab === 'general'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>General</span>
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 text-xs space-y-5">
          {tab === 'keybinds' ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
                <div className="text-slate-600 dark:text-slate-300">
                  Click any shortcut button, then press a single key to rebind. Press{' '}
                  <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono-nums text-[10px]">
                    Esc
                  </kbd>{' '}
                  to cancel.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onChangeKeybinds({ ...DEFAULT_KEYBINDS });
                    setConflictNote('Restored default keybinds.');
                    setListeningAction(null);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 flex items-center gap-1.5 font-medium cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Defaults</span>
                </button>
              </div>

              {conflictNote && (
                <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-[11px]">
                  {conflictNote}
                </div>
              )}

              {GROUPS.map((group) => (
                <div key={group} className="space-y-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {group}
                  </h3>
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                    {KEYBIND_DEFINITIONS.filter((d) => d.group === group).map((def) => {
                      const isListening = listeningAction === def.action;
                      const currentKey = keybinds[def.action];
                      return (
                        <div
                          key={def.action}
                          className="px-3.5 py-2.5 flex items-center justify-between gap-3 bg-white dark:bg-slate-900"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {def.label}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {def.description}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setListeningAction(isListening ? null : def.action)}
                            aria-label={`Change shortcut for ${def.label}`}
                            className={`min-w-[84px] px-3 py-1.5 rounded-lg font-mono-nums font-semibold text-center border transition-colors cursor-pointer ${
                              isListening
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 hover:border-slate-400'
                            }`}
                          >
                            {isListening ? 'Press key...' : formatKeyLabel(currentKey)}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1">
                  <span className="text-slate-500 font-medium">Preferred Metric Unit</span>
                  <select
                    value={settings.preferredUnit}
                    onChange={(e) =>
                      onUpdateSettings({ preferredUnit: e.target.value as UnitDisplay })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
                  >
                    <option value="mm">Millimeters (mm)</option>
                    <option value="cm">Centimeters (cm)</option>
                    <option value="m">Meters (m)</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-slate-500 font-medium">Default Grid Spacing</span>
                  <select
                    value={settings.gridSizeMm}
                    onChange={(e) =>
                      onUpdateSettings({ gridSizeMm: Number(e.target.value) as GridSizeMm })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
                  >
                    <option value={10}>1 cm (10 mm)</option>
                    <option value={50}>5 cm (50 mm)</option>
                    <option value={100}>10 cm (100 mm)</option>
                    <option value={500}>50 cm (500 mm)</option>
                  </select>
                </label>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
                <label className="px-4 py-3 flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="font-medium">Show Metric Grid</div>
                    <div className="text-[11px] text-slate-500">Display 2D floor grid lines</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showGrid}
                    onChange={(e) => onUpdateSettings({ showGrid: e.target.checked })}
                    className="accent-blue-600 w-4 h-4"
                  />
                </label>

                <label className="px-4 py-3 flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="font-medium">Corner & Grid Snapping</div>
                    <div className="text-[11px] text-slate-500">
                      Snap endpoints, corners, and grid increments
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.snapEnabled}
                    onChange={(e) => onUpdateSettings({ snapEnabled: e.target.checked })}
                    className="accent-blue-600 w-4 h-4"
                  />
                </label>

                <label className="px-4 py-3 flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="font-medium">Automatic Wall Dimensions</div>
                    <div className="text-[11px] text-slate-500">
                      Show wall length dimension chains on 2D canvas
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoDimensions}
                    onChange={(e) => onUpdateSettings({ autoDimensions: e.target.checked })}
                    className="accent-blue-600 w-4 h-4"
                  />
                </label>

                <label className="px-4 py-3 flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="font-medium">Black &amp; White Architectural Mode</div>
                    <div className="text-[11px] text-slate-500">
                      Render 2D Plan &amp; Wall View in clean black, white, and grey tones for printing
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.blackAndWhite2d)}
                    onChange={(e) => onUpdateSettings({ blackAndWhite2d: e.target.checked })}
                    className="accent-blue-600 w-4 h-4"
                  />
                </label>

                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">3D Walk Eye Height</div>
                      <div className="text-[11px] text-slate-500">
                        Camera eye elevation in first-person walking view
                      </div>
                    </div>
                    <span className="font-mono-nums font-semibold text-blue-600 dark:text-blue-400">
                      {Math.round((settings.walkEyeHeightMm ?? 1630) / 10)} cm
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1000}
                    max={2100}
                    step={10}
                    value={settings.walkEyeHeightMm ?? 1630}
                    onChange={(e) => onUpdateSettings({ walkEyeHeightMm: Number(e.target.value) })}
                    className="w-full accent-blue-600"
                  />
                </div>

                <label className="px-4 py-3 flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="font-medium">Dark Theme</div>
                    <div className="text-[11px] text-slate-500">
                      Use dark workspace surfaces and twilight 3D sky
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.darkMode}
                    onChange={(e) => onUpdateSettings({ darkMode: e.target.checked })}
                    className="accent-blue-600 w-4 h-4"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
