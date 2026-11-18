import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  BookOpen,
  Calendar,
  Clock,
  Copy,
  FilePlus2,
  FolderOpen,
  Keyboard,
  Layers,
  LayoutGrid,
  Moon,
  Pencil,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
} from 'lucide-react';
import { Level, Project } from '../types/plan';
import { computeWallPolygon } from '../utils/geometry';
import { renderPartVector2D } from '../utils/furnitureVectors';
import { formatAreaM2 } from '../utils/units';
import { formatKeyLabel, KeybindMap, TOOL_TUTORIALS, ToolTutorial } from '../utils/keybinds';

interface HomePageProps {
  projects: Project[];
  darkMode: boolean;
  keybinds: KeybindMap;
  onToggleDarkMode: () => void;
  onOpenProject: (id: string) => void;
  onCreateProject: (template: '1br' | 'studio' | '2br' | 'empty') => void;
  onDuplicateProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onImportProjectFile: (file: File) => void;
  onOpenSettings: (tab?: 'general' | 'keybinds') => void;
}

type SortKey = 'updatedAt' | 'createdAt' | 'name';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateSafe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dateFormatter.format(d);
}

const ModelVectorThumbnail: React.FC<{ level: Level; darkMode: boolean }> = ({
  level,
  darkMode,
}) => {
  const bounds = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const w of level.walls) {
      minX = Math.min(minX, w.start.x, w.end.x);
      minY = Math.min(minY, w.start.y, w.end.y);
      maxX = Math.max(maxX, w.start.x, w.end.x);
      maxY = Math.max(maxY, w.start.y, w.end.y);
    }
    for (const f of level.furniture) {
      minX = Math.min(minX, f.xMm - 800);
      minY = Math.min(minY, f.yMm - 800);
      maxX = Math.max(maxX, f.xMm + 800);
      maxY = Math.max(maxY, f.yMm + 800);
    }

    if (!Number.isFinite(minX)) {
      return { x: -1000, y: -1000, w: 8000, h: 6000 };
    }
    const pad = 600;
    return {
      x: minX - pad,
      y: minY - pad,
      w: Math.max(2000, maxX - minX + pad * 2),
      h: Math.max(1500, maxY - minY + pad * 2),
    };
  }, [level]);

  const strokeInk = darkMode ? '#E2E8F0' : '#0F172A';
  const wallFill = darkMode ? '#1E293B' : '#FFFFFF';
  const roomFill = darkMode ? '#0F172A' : '#FFFFFF';

  return (
    <svg
      viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {/* Rooms */}
      {level.rooms.map((room) => {
        if (!room.visible || room.polygon.length < 3) return null;
        return (
          <polygon
            key={room.id}
            points={room.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={room.floorColor === '#FFFFFF' ? roomFill : room.floorColor}
            stroke="none"
          />
        );
      })}

      {/* Furniture Vector Outlines */}
      {level.furniture.map((f) => {
        if (!f.visible) return null;
        return (
          <g
            key={f.id}
            transform={`translate(${f.xMm}, ${f.yMm}) rotate(${f.rotationDeg}) scale(${
              f.mirroredX ? -1 : 1
            }, ${f.mirroredY ? -1 : 1})`}
          >
            {[...f.parts]
              .sort((a, b) => a.zMm - b.zMm)
              .map((part) => (
              <g key={part.id} transform={`translate(${part.xMm}, ${part.yMm}) rotate(${part.rotationDeg})`}>
                {renderPartVector2D(part, strokeInk, 18, { showDetails: true })}
              </g>
            ))}
          </g>
        );
      })}

      {/* Walls — Two-pass seamless corner union */}
      {(() => {
        const wallPolys = level.walls
          .filter((w) => w.visible)
          .map((w) => ({ id: w.id, poly: computeWallPolygon(w, level.walls) }))
          .filter((item) => item.poly.length >= 3);
        return (
          <g>
            {wallPolys.map(({ id, poly }) => (
              <polygon
                key={`ts_${id}`}
                points={poly.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={strokeInk}
                strokeWidth={38}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {wallPolys.map(({ id, poly }) => (
              <polygon
                key={`tf_${id}`}
                points={poly.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={wallFill}
                stroke={wallFill}
                strokeWidth={6}
                strokeLinejoin="round"
              />
            ))}
          </g>
        );
      })()}
    </svg>
  );
};

export const HomePage: React.FC<HomePageProps> = ({
  projects,
  darkMode,
  keybinds,
  onToggleDarkMode,
  onOpenProject,
  onCreateProject,
  onDuplicateProject,
  onRenameProject,
  onDeleteProject,
  onImportProjectFile,
  onOpenSettings,
}) => {
  const [homeTab, setHomeTab] = useState<'models' | 'tutorials'>('models');
  const [tutorialCategory, setTutorialCategory] = useState<'All' | ToolTutorial['category']>('All');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? projects.filter((p) => p.name.toLowerCase().includes(q))
      : projects;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      return new Date(b[sortKey]).getTime() - new Date(a[sortKey]).getTime();
    });
  }, [projects, search, sortKey]);

  return (
    <div className="min-h-screen w-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="h-14 shrink-0 px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center font-bold text-xs tracking-tight">
              PS
            </div>
            <div>
              <h1 className="font-semibold text-sm tracking-tight leading-tight">Plan Studio</h1>
              <p className="text-[11px] text-slate-500">Metric Interior Architecture Models</p>
            </div>
          </div>

          <nav
            aria-label="Main sections"
            className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
          >
            <button
              type="button"
              onClick={() => setHomeTab('models')}
              className={`px-3 py-1 rounded-md flex items-center gap-1.5 font-medium transition-colors cursor-pointer ${
                homeTab === 'models'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Models</span>
            </button>
            <button
              type="button"
              onClick={() => setHomeTab('tutorials')}
              className={`px-3 py-1 rounded-md flex items-center gap-1.5 font-medium transition-colors cursor-pointer ${
                homeTab === 'tutorials'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Tutorials</span>
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Import JSON</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportProjectFile(f);
              e.target.value = '';
            }}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => onCreateProject('empty')}
            className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Blank Model</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenSettings('keybinds')}
            title="Settings & Keybinds"
            aria-label="Open Settings and Keybinds"
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Settings</span>
          </button>

          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {homeTab === 'tutorials' ? (
            <section aria-label="Tool tutorials" className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Tool Tutorials &amp; Metric Workflow Guide
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Every drawing, placement, and inspection tool switches cleanly back to Select when completed.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenSettings('keybinds')}
                  className="self-start sm:self-auto px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  <Keyboard className="w-3.5 h-3.5 text-blue-600" />
                  <span>Customize Keybinds</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    'All',
                    'Navigation',
                    'Structure & Openings',
                    'Measurements & Notes',
                    '3D & Furniture',
                  ] as const
                ).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setTutorialCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      tutorialCategory === cat
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {TOOL_TUTORIALS.filter(
                  (t) => tutorialCategory === 'All' || t.category === tutorialCategory
                ).map((tut) => {
                  const activeShortcut = tut.keybindAction
                    ? formatKeyLabel(keybinds[tut.keybindAction])
                    : null;
                  return (
                    <article
                      key={tut.id}
                      className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                              {tut.category}
                            </span>
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                              {tut.title}
                            </h3>
                          </div>
                          {activeShortcut && (
                            <kbd className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono-nums text-xs font-semibold text-slate-800 dark:text-slate-100 shrink-0">
                              {activeShortcut}
                            </kbd>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300">{tut.summary}</p>
                        <ol className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-decimal list-inside">
                          {tut.steps.map((step, i) => (
                            <li key={i} className="leading-relaxed">
                              {step}
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
                        <strong className="text-slate-700 dark:text-slate-300">Tip:</strong> {tut.tip}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : (
            <>
          {/* Quick-Start Templates */}
          <section aria-label="Quick-start templates" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Start From Template
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(
                [
                  {
                    id: 'empty' as const,
                    title: 'Blank Metric Canvas',
                    subtitle: 'Start fresh in mm / cm / m',
                  },
                  {
                    id: 'studio' as const,
                    title: 'Urban Studio',
                    subtitle: '36 m² · Open living + kitchen',
                  },
                  {
                    id: '1br' as const,
                    title: '1-Bedroom Apartment',
                    subtitle: '70 m² · Living, bedroom, bath',
                  },
                  {
                    id: '2br' as const,
                    title: '2-Bedroom Residence',
                    subtitle: '96 m² · Two suites + dining',
                  },
                ] as const
              ).map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => onCreateProject(tpl.id)}
                  className="text-left p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-colors flex items-start gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-700 dark:text-slate-200">
                    <FilePlus2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {tpl.title}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{tpl.subtitle}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Selectable Models */}
          <section aria-label="Saved models" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Your Models
                </h2>
                <span className="px-2 py-0.5 text-[11px] font-mono-nums rounded-full bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {visibleProjects.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter models..."
                    aria-label="Filter models"
                    className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48 sm:w-56"
                  />
                </div>

                <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1">
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    aria-label="Sort models"
                    className="text-xs bg-transparent focus:outline-none cursor-pointer"
                  >
                    <option value="updatedAt">Last Edited</option>
                    <option value="createdAt">Created Date</option>
                    <option value="name">Name</option>
                  </select>
                </div>
              </div>
            </div>

            {visibleProjects.length === 0 ? (
              <div className="p-10 text-center bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl text-xs text-slate-500">
                No models match &ldquo;{search}&rdquo;. Try clearing your filter or create a new model.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleProjects.map((model) => {
                  const activeLvl =
                    model.levels.find((l) => l.id === model.activeLevelId) ?? model.levels[0];
                  const totalAreaM2 = model.levels.reduce(
                    (sum, l) => sum + l.rooms.reduce((rs, r) => rs + r.areaM2, 0),
                    0
                  );
                  const isRenaming = renamingId === model.id;
                  const isConfirmingDelete = confirmDeleteId === model.id;

                  return (
                    <article
                      key={model.id}
                      data-testid={`model-card-${model.id}`}
                      className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col"
                    >
                      {/* Clickable Vector Preview */}
                      <button
                        type="button"
                        onClick={() => onOpenProject(model.id)}
                        aria-label={`Open ${model.name}`}
                        className="relative h-44 w-full bg-slate-50/70 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 p-4 flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                      >
                        <ModelVectorThumbnail level={activeLvl} darkMode={darkMode} />
                        <span className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 text-[10px] font-mono-nums text-slate-600 dark:text-slate-300">
                          {totalAreaM2 > 0 ? formatAreaM2(totalAreaM2) : 'Blank'} ·{' '}
                          {model.levels.length}{' '}
                          {model.levels.length === 1 ? 'floor' : 'floors'}
                        </span>
                      </button>

                      {/* Card Metadata & Actions */}
                      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                        <div className="space-y-2">
                          {isRenaming ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                onRenameProject(model.id, renameDraft);
                                setRenamingId(null);
                              }}
                              className="flex items-center gap-1.5"
                            >
                              <input
                                type="text"
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                autoFocus
                                aria-label="Model title"
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') setRenamingId(null);
                                }}
                                className="flex-1 px-2 py-1 text-xs font-semibold bg-slate-50 dark:bg-slate-950 border border-blue-500 rounded focus:outline-none"
                              />
                              <button
                                type="submit"
                                className="px-2 py-1 text-[11px] font-medium rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 cursor-pointer"
                              >
                                Save
                              </button>
                            </form>
                          ) : (
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => onOpenProject(model.id)}
                                className="text-left text-sm font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 truncate cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                              >
                                {model.name}
                              </button>
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono-nums text-slate-400 shrink-0 pt-0.5">
                                <Layers className="w-3 h-3" />
                                {model.settings.scale}
                              </span>
                            </div>
                          )}

                          <dl className="grid grid-cols-1 gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-3 h-3 shrink-0 text-slate-400" />
                              <dt className="text-slate-400">Last edited:</dt>
                              <dd className="font-mono-nums text-slate-700 dark:text-slate-200 truncate">
                                {formatDateSafe(model.updatedAt)}
                              </dd>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-3 h-3 shrink-0 text-slate-400" />
                              <dt className="text-slate-400">Created:</dt>
                              <dd className="font-mono-nums text-slate-600 dark:text-slate-300 truncate">
                                {formatDateSafe(model.createdAt)}
                              </dd>
                            </div>
                          </dl>
                        </div>

                        {/* Actions Row */}
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenProject(model.id)}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          >
                            Open Model
                          </button>

                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteProject(model.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="px-2 py-1 rounded text-[11px] font-medium bg-red-600 text-white hover:bg-red-700 cursor-pointer"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 rounded text-[11px] border border-slate-200 dark:border-slate-700 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                title="Rename model"
                                aria-label={`Rename ${model.name}`}
                                onClick={() => {
                                  setRenamingId(model.id);
                                  setRenameDraft(model.name);
                                }}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Duplicate model"
                                aria-label={`Duplicate ${model.name}`}
                                onClick={() => onDuplicateProject(model.id)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Delete model"
                                aria-label={`Delete ${model.name}`}
                                onClick={() => setConfirmDeleteId(model.id)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
};
