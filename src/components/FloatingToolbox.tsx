import React, { useEffect, useRef, useState } from 'react';
import {
  AppWindow,
  ArchiveRestore,
  Box,
  ChevronUp,
  DoorOpen,
  Hand,
  Hexagon,
  MousePointer,
  MoveUpRight,
  PenTool,
  Ruler,
  Scissors,
  SlidersHorizontal,
  Spline,
  Type,
} from 'lucide-react';
import { DoorSubtype, EditorTool, Opening, RailingStyleId, WindowSubtype } from '../types/plan';
import { formatKeyLabel, KeybindMap } from '../utils/keybinds';
import { RAILING_STYLES } from '../utils/railings';

interface FloatingToolboxProps {
  activeTool: EditorTool;
  pendingOpeningSpec: { category: Opening['category']; subtype: Opening['subtype'] };
  activeRailingStyle: RailingStyleId;
  keybinds: KeybindMap;
  onSelectTool: (tool: EditorTool) => void;
  onSelectOpeningSpec: (spec: { category: Opening['category']; subtype: Opening['subtype'] }) => void;
  onSelectRailingStyle: (style: RailingStyleId) => void;
}

const DOOR_SUBTYPES: Array<{ id: DoorSubtype; label: string }> = [
  { id: 'single', label: 'Single Swing' },
  { id: 'double', label: 'Double Swing' },
  { id: 'french', label: 'French Double' },
  { id: 'balcony_single', label: 'Balcony Single (PVC)' },
  { id: 'balcony_double', label: 'Balcony Double (PVC)' },
  { id: 'pivot', label: 'Pivot Door' },
  { id: 'sliding', label: 'Sliding' },
  { id: 'pocket', label: 'Pocket' },
  { id: 'bifold', label: 'Bifold' },
  { id: 'entrance', label: 'Entrance' },
  { id: 'garage', label: 'Garage' },
  { id: 'doorframe', label: 'Doorframe Only' },
];

const WINDOW_SUBTYPES: Array<{ id: WindowSubtype; label: string }> = [
  { id: 'single', label: 'Single' },
  { id: 'double', label: 'Double' },
  { id: 'triple', label: 'Triple' },
  { id: 'euro_single', label: 'Euro Tilt & Turn' },
  { id: 'euro_double', label: 'Euro Double (PVC)' },
  { id: 'euro_triple', label: 'Euro Panoramic 3' },
  { id: 'euro_terrace', label: 'Euro Terrace (PVC)' },
  { id: 'casement', label: 'Casement' },
  { id: 'awning', label: 'Awning' },
  { id: 'clerestory', label: 'Clerestory' },
  { id: 'fixed', label: 'Fixed' },
  { id: 'sliding', label: 'Sliding' },
  { id: 'bay', label: 'Bay' },
  { id: 'corner', label: 'Corner' },
  { id: 'floor_to_ceiling', label: 'Full Height' },
  { id: 'round', label: 'Round' },
];

const ARCH_SUBTYPES: Array<{ id: Opening['subtype']; label: string }> = [
  { id: 'round_arch', label: 'Round Arch' },
  { id: 'pointed_arch', label: 'Pointed Arch' },
  { id: 'segmental_arch', label: 'Segmental Arch' },
  { id: 'plain_opening', label: 'Plain Opening' },
  { id: 'frame_only', label: 'Cased Frame' },
  { id: 'passthrough', label: 'Passthrough' },
];

type PopoverGroup = 'wall' | 'door' | 'window' | 'arch' | 'railing' | 'annotate' | null;

const RailingToolIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
    <path d="M3 7h18" />
    <path d="M3 19h18" />
    <path d="M5 7v12" />
    <path d="M12 7v12" />
    <path d="M19 7v12" />
  </svg>
);

const KeyBadge: React.FC<{ keyText: string; active?: boolean }> = ({ keyText, active }) => (
  <kbd
    className={`hidden xl:inline-flex items-center justify-center min-w-[14px] h-3.5 px-1 rounded text-[9px] font-mono-nums font-semibold leading-none ${
      active
        ? 'bg-white/20 text-white dark:bg-slate-900/15 dark:text-slate-900'
        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
    }`}
  >
    {keyText}
  </kbd>
);

export const FloatingToolbox: React.FC<FloatingToolboxProps> = ({
  activeTool,
  pendingOpeningSpec,
  activeRailingStyle,
  keybinds,
  onSelectTool,
  onSelectOpeningSpec,
  onSelectRailingStyle,
}) => {
  const [openMenu, setOpenMenu] = useState<PopoverGroup>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (dockRef.current && !dockRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const isWallGroup =
    activeTool === 'wall' || activeTool === 'wall_arc' || activeTool === 'split_wall';
  const isAnnotateGroup =
    activeTool === 'text' || activeTool === 'arrow' || activeTool === 'section_line';

  const wallGroupKey =
    activeTool === 'wall_arc'
      ? formatKeyLabel(keybinds.wall_arc)
      : activeTool === 'split_wall'
        ? formatKeyLabel(keybinds.split_wall)
        : formatKeyLabel(keybinds.wall);

  const annotateGroupKey =
    activeTool === 'arrow'
      ? formatKeyLabel(keybinds.arrow)
      : activeTool === 'section_line'
        ? formatKeyLabel(keybinds.section_line)
        : formatKeyLabel(keybinds.text);

  const buttonClass = (active: boolean) =>
    `h-7 px-2 rounded-lg flex items-center gap-1 text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
      active
        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
    }`;

  const chevronButtonClass = (active: boolean) =>
    `h-7 w-4 rounded-r-lg flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
      active
        ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
        : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'
    }`;

  return (
    <div
      ref={dockRef}
      role="toolbar"
      aria-label="Drawing and measurement tools"
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-24px)] flex flex-nowrap items-center gap-0.5 px-1.5 py-1 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg shadow-slate-900/10 dark:shadow-black/50 select-none"
    >
      {/* Select */}
      <button
        type="button"
        title={`Select (${formatKeyLabel(keybinds.select)})`}
        aria-label={`Select tool (${formatKeyLabel(keybinds.select)})`}
        aria-pressed={activeTool === 'select'}
        onClick={() => {
          onSelectTool('select');
          setOpenMenu(null);
        }}
        className={buttonClass(activeTool === 'select')}
      >
        <MousePointer className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Select</span>
        <KeyBadge keyText={formatKeyLabel(keybinds.select)} active={activeTool === 'select'} />
      </button>

      {/* Pan */}
      <button
        type="button"
        title={`Pan (${formatKeyLabel(keybinds.pan)}) — or hold Middle Mouse button anywhere`}
        aria-label={`Pan tool (${formatKeyLabel(keybinds.pan)})`}
        aria-pressed={activeTool === 'pan'}
        onClick={() => {
          onSelectTool('pan');
          setOpenMenu(null);
        }}
        className={buttonClass(activeTool === 'pan')}
      >
        <Hand className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Pan</span>
        <KeyBadge keyText={formatKeyLabel(keybinds.pan)} active={activeTool === 'pan'} />
      </button>

      <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 shrink-0" />

      {/* Wall Group */}
      <div className="relative flex items-center">
        <button
          type="button"
          title={`Draw Wall (${wallGroupKey})`}
          aria-label={`Wall tool (${wallGroupKey})`}
          aria-pressed={isWallGroup}
          onClick={() => {
            onSelectTool(isWallGroup ? activeTool : 'wall');
            setOpenMenu(null);
          }}
          className={`${buttonClass(isWallGroup)} rounded-r-none pr-1.5`}
        >
          {activeTool === 'wall_arc' ? (
            <Spline className="w-3.5 h-3.5 shrink-0" />
          ) : activeTool === 'split_wall' ? (
            <Scissors className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <PenTool className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="hidden sm:inline">
            {activeTool === 'wall_arc'
              ? 'Arc'
              : activeTool === 'split_wall'
                ? 'Split'
                : 'Wall'}
          </span>
          <KeyBadge keyText={wallGroupKey} active={isWallGroup} />
        </button>
        <button
          type="button"
          aria-label="Wall options"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'wall'}
          onClick={() => setOpenMenu((m) => (m === 'wall' ? null : 'wall'))}
          className={chevronButtonClass(isWallGroup)}
        >
          <ChevronUp className="w-3 h-3" />
        </button>

        {openMenu === 'wall' && (
          <div
            role="menu"
            className="absolute bottom-full left-0 mb-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 text-xs z-40"
          >
            {[
              { id: 'wall' as const, label: 'Straight Wall', key: keybinds.wall, Icon: PenTool },
              { id: 'wall_arc' as const, label: 'Curved Arc Wall', key: keybinds.wall_arc, Icon: Spline },
              { id: 'split_wall' as const, label: 'Split Wall Point', key: keybinds.split_wall, Icon: Scissors },
            ].map(({ id, label, key, Icon }) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={activeTool === id}
                onClick={() => {
                  onSelectTool(id);
                  setOpenMenu(null);
                }}
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${
                  activeTool === id ? 'font-semibold text-blue-600 dark:text-blue-400' : ''
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{label}</span>
                </span>
                <kbd className="text-[10px] font-mono-nums text-slate-400">{formatKeyLabel(key)}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Door Group */}
      <div className="relative flex items-center">
        <button
          type="button"
          title={`Place Door (${formatKeyLabel(keybinds.door)})`}
          aria-label={`Door tool (${formatKeyLabel(keybinds.door)})`}
          aria-pressed={activeTool === 'door'}
          onClick={() => {
            if (pendingOpeningSpec.category !== 'door') {
              onSelectOpeningSpec({ category: 'door', subtype: 'single' });
            }
            onSelectTool('door');
            setOpenMenu(null);
          }}
          className={`${buttonClass(activeTool === 'door')} rounded-r-none pr-1.5`}
        >
          <DoorOpen className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">Door</span>
          <KeyBadge keyText={formatKeyLabel(keybinds.door)} active={activeTool === 'door'} />
        </button>
        <button
          type="button"
          aria-label="Door type options"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'door'}
          onClick={() => setOpenMenu((m) => (m === 'door' ? null : 'door'))}
          className={chevronButtonClass(activeTool === 'door')}
        >
          <ChevronUp className="w-3 h-3" />
        </button>

        {openMenu === 'door' && (
          <div
            role="menu"
            className="absolute bottom-full left-0 mb-2 w-40 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 text-xs z-40"
          >
            {DOOR_SUBTYPES.map((d) => {
              const selected =
                activeTool === 'door' &&
                pendingOpeningSpec.category === 'door' &&
                pendingOpeningSpec.subtype === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onSelectOpeningSpec({ category: 'door', subtype: d.id });
                    onSelectTool('door');
                    setOpenMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${
                    selected ? 'font-semibold text-blue-600 dark:text-blue-400' : ''
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Window Group */}
      <div className="relative flex items-center">
        <button
          type="button"
          title={`Place Window (${formatKeyLabel(keybinds.window)})`}
          aria-label={`Window tool (${formatKeyLabel(keybinds.window)})`}
          aria-pressed={activeTool === 'window'}
          onClick={() => {
            if (pendingOpeningSpec.category !== 'window') {
              onSelectOpeningSpec({ category: 'window', subtype: 'double' });
            }
            onSelectTool('window');
            setOpenMenu(null);
          }}
          className={`${buttonClass(activeTool === 'window')} rounded-r-none pr-1.5`}
        >
          <AppWindow className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">Window</span>
          <KeyBadge keyText={formatKeyLabel(keybinds.window)} active={activeTool === 'window'} />
        </button>
        <button
          type="button"
          aria-label="Window type options"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'window'}
          onClick={() => setOpenMenu((m) => (m === 'window' ? null : 'window'))}
          className={chevronButtonClass(activeTool === 'window')}
        >
          <ChevronUp className="w-3 h-3" />
        </button>

        {openMenu === 'window' && (
          <div
            role="menu"
            className="absolute bottom-full left-0 mb-2 w-40 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 text-xs z-40"
          >
            {WINDOW_SUBTYPES.map((w) => {
              const selected =
                activeTool === 'window' &&
                pendingOpeningSpec.category === 'window' &&
                pendingOpeningSpec.subtype === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onSelectOpeningSpec({ category: 'window', subtype: w.id });
                    onSelectTool('window');
                    setOpenMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${
                    selected ? 'font-semibold text-blue-600 dark:text-blue-400' : ''
                  }`}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Arch Group */}
      <div className="relative flex items-center">
        <button
          type="button"
          title={`Place Arch / Wall Opening (${formatKeyLabel(keybinds.arch)})`}
          aria-label={`Arch tool (${formatKeyLabel(keybinds.arch)})`}
          aria-pressed={activeTool === 'arch'}
          onClick={() => {
            if (pendingOpeningSpec.category !== 'arch') {
              onSelectOpeningSpec({ category: 'arch', subtype: 'round_arch' });
            }
            onSelectTool('arch');
            setOpenMenu(null);
          }}
          className={`${buttonClass(activeTool === 'arch')} rounded-r-none pr-1.5`}
        >
          <ArchiveRestore className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden lg:inline">Arch</span>
          <KeyBadge keyText={formatKeyLabel(keybinds.arch)} active={activeTool === 'arch'} />
        </button>
        <button
          type="button"
          aria-label="Arch type options"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'arch'}
          onClick={() => setOpenMenu((m) => (m === 'arch' ? null : 'arch'))}
          className={chevronButtonClass(activeTool === 'arch')}
        >
          <ChevronUp className="w-3 h-3" />
        </button>

        {openMenu === 'arch' && (
          <div
            role="menu"
            className="absolute bottom-full left-0 mb-2 w-40 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 text-xs z-40"
          >
            {ARCH_SUBTYPES.map((a) => {
              const selected =
                activeTool === 'arch' &&
                pendingOpeningSpec.category === 'arch' &&
                pendingOpeningSpec.subtype === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onSelectOpeningSpec({ category: 'arch', subtype: a.id });
                    onSelectTool('arch');
                    setOpenMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${
                    selected ? 'font-semibold text-blue-600 dark:text-blue-400' : ''
                  }`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Chimney / Wall-Attached Parallelepiped Tool */}
      <button
        type="button"
        title={`Place Chimney / Box (${formatKeyLabel(keybinds.chimney)}) — snaps flush to walls`}
        aria-label={`Chimney tool (${formatKeyLabel(keybinds.chimney)})`}
        aria-pressed={activeTool === 'chimney'}
        onClick={() => {
          onSelectTool('chimney');
          setOpenMenu(null);
        }}
        className={buttonClass(activeTool === 'chimney')}
      >
        <Box className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden lg:inline">Chimney</span>
        <KeyBadge keyText={formatKeyLabel(keybinds.chimney)} active={activeTool === 'chimney'} />
      </button>

      {/* Railing / Balustrade Multi-Point Path Group */}
      <div className="relative flex items-center">
        <button
          type="button"
          data-testid="toolbox-railing-btn"
          title={`Draw Railing (${formatKeyLabel(keybinds.railing)}) — click points or stair edges`}
          aria-label={`Railing tool (${formatKeyLabel(keybinds.railing)})`}
          aria-pressed={activeTool === 'railing'}
          onClick={() => {
            onSelectTool('railing');
            setOpenMenu(null);
          }}
          className={`${buttonClass(activeTool === 'railing')} rounded-r-none pr-1.5`}
        >
          <RailingToolIcon />
          <span className="hidden lg:inline">Railing</span>
          <KeyBadge keyText={formatKeyLabel(keybinds.railing)} active={activeTool === 'railing'} />
        </button>
        <button
          type="button"
          aria-label="Railing style options"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'railing'}
          onClick={() => setOpenMenu((m) => (m === 'railing' ? null : 'railing'))}
          className={chevronButtonClass(activeTool === 'railing')}
        >
          <ChevronUp className="w-3 h-3" />
        </button>

        {openMenu === 'railing' && (
          <div
            role="menu"
            className="absolute bottom-full left-0 mb-2 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 text-xs z-40"
          >
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Railing Drawing Style
            </div>
            {RAILING_STYLES.map((st) => {
              const selected = activeRailingStyle === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onSelectRailingStyle(st.id);
                    onSelectTool('railing');
                    setOpenMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex items-center justify-between gap-2 ${
                    selected ? 'font-semibold text-blue-600 dark:text-blue-400' : ''
                  }`}
                >
                  <span className="truncate">{st.label}</span>
                  {st.id === 'glass_panel' && (
                    <span className="text-[9px] text-slate-400 shrink-0">Default</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 shrink-0" />

      {/* Corner-to-Corner Distance Measurement */}
      <button
        type="button"
        title={`Measure Distance between corners (${formatKeyLabel(keybinds.measure_distance)})`}
        aria-label={`Distance measurement tool (${formatKeyLabel(keybinds.measure_distance)})`}
        aria-pressed={activeTool === 'measure_distance'}
        onClick={() => {
          onSelectTool('measure_distance');
          setOpenMenu(null);
        }}
        className={buttonClass(activeTool === 'measure_distance')}
      >
        <Ruler className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Distance</span>
        <KeyBadge
          keyText={formatKeyLabel(keybinds.measure_distance)}
          active={activeTool === 'measure_distance'}
        />
      </button>

      {/* Transient Area Finder */}
      <button
        type="button"
        title={`Area Finder — click room or trace polygon (${formatKeyLabel(keybinds.measure_area)})`}
        aria-label={`Area finder tool (${formatKeyLabel(keybinds.measure_area)})`}
        aria-pressed={activeTool === 'measure_area'}
        onClick={() => {
          onSelectTool('measure_area');
          setOpenMenu(null);
        }}
        className={buttonClass(activeTool === 'measure_area')}
      >
        <Hexagon className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Area</span>
        <KeyBadge
          keyText={formatKeyLabel(keybinds.measure_area)}
          active={activeTool === 'measure_area'}
        />
      </button>

      <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 shrink-0" />

      {/* Annotate Group */}
      <div className="relative flex items-center">
        <button
          type="button"
          title={`Annotate (${annotateGroupKey})`}
          aria-label={`Annotation tool (${annotateGroupKey})`}
          aria-pressed={isAnnotateGroup}
          onClick={() => {
            onSelectTool(isAnnotateGroup ? activeTool : 'text');
            setOpenMenu(null);
          }}
          className={`${buttonClass(isAnnotateGroup)} rounded-r-none pr-1.5`}
        >
          {activeTool === 'arrow' ? (
            <MoveUpRight className="w-3.5 h-3.5 shrink-0" />
          ) : activeTool === 'section_line' ? (
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Type className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="hidden lg:inline">
            {activeTool === 'arrow'
              ? 'Arrow'
              : activeTool === 'section_line'
                ? 'Section'
                : 'Note'}
          </span>
          <KeyBadge keyText={annotateGroupKey} active={isAnnotateGroup} />
        </button>
        <button
          type="button"
          aria-label="Annotation options"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'annotate'}
          onClick={() => setOpenMenu((m) => (m === 'annotate' ? null : 'annotate'))}
          className={chevronButtonClass(isAnnotateGroup)}
        >
          <ChevronUp className="w-3 h-3" />
        </button>

        {openMenu === 'annotate' && (
          <div
            role="menu"
            className="absolute bottom-full right-0 mb-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 text-xs z-40"
          >
            {[
              { id: 'text' as const, label: 'Text Note', key: keybinds.text, Icon: Type },
              { id: 'arrow' as const, label: 'Arrow Callout', key: keybinds.arrow, Icon: MoveUpRight },
              { id: 'section_line' as const, label: 'Section Cut', key: keybinds.section_line, Icon: SlidersHorizontal },
            ].map(({ id, label, key, Icon }) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={activeTool === id}
                onClick={() => {
                  onSelectTool(id);
                  setOpenMenu(null);
                }}
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${
                  activeTool === id ? 'font-semibold text-blue-600 dark:text-blue-400' : ''
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{label}</span>
                </span>
                <kbd className="text-[10px] font-mono-nums text-slate-400">{formatKeyLabel(key)}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
