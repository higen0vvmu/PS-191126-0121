import React, { useMemo, useState } from 'react';
import {
  Box,
  Calculator,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Lock,
  Plus,
  Ruler,
  Search,
  Trash2,
  Unlock,
  Upload,
  User,
} from 'lucide-react';
import {
  ArchElementType,
  CatalogTemplate,
  EditorTool,
  FurnitureCategory,
  Level,
  PersonPose,
  Project,
  RailingStyleId,
  SelectionTarget,
} from '../types/plan';
import { BUILTIN_CATALOG } from '../data/catalog';
import { RAILING_STYLES } from '../utils/railings';
import { RailingStyleThumb } from './RailingInspectorSection';
import { computeFurnitureBoundsMm, computeWallSurfaceAreaM2 } from '../utils/geometry';
import { renderPartVector2D } from '../utils/furnitureVectors';
import {
  isValidSvgSource,
  parseSvgSourceToProjectedView,
  resolveEffectiveRepresentationMode,
} from '../utils/svgImport';
import {
  getEffectiveViewElements,
  renderFurnitureRepresentationView,
} from '../utils/svgRepresentationRenderer';
import { formatAreaM2, uid } from '../utils/units';

interface LeftSidebarProps {
  project: Project;
  activeLevel: Level;
  selection: SelectionTarget[];
  onSelect: (targets: SelectionTarget[]) => void;
  onPlaceFurniture: (tpl: CatalogTemplate) => void;
  onPlacePerson: (pose: PersonPose, name: string, heightMm: number) => void;
  onPlaceArchElement: (type: ArchElementType, name: string) => void;
  onPlaceRailingPreset?: (styleId: RailingStyleId) => void;
  onUpdateLevel: (
    updater: (lvl: Level) => Level,
    recomputeRooms?: boolean,
    recordHistory?: boolean,
    label?: string,
    coalesceKey?: string
  ) => void;
  onOpenCustomBuilder: () => void;
  onOpenImporter: () => void;
  onToolChange: (tool: EditorTool) => void;
  onAddLevel: () => void;
  onSwitchLevel: (id: string) => void;
  onDeleteLevel: (id: string) => void;
}

type LeftTab = 'catalog' | 'tree' | 'schedule' | 'trace';
type CatalogSubTab = 'furniture' | 'architecture' | 'people';

interface ArchCatalogItem {
  type: ArchElementType;
  label: string;
  desc: string;
}

const ARCH_CATALOG_ITEMS: ArchCatalogItem[] = [
  { type: 'chimney', label: 'Chimney / Block', desc: 'Solid masonry shaft or chase' },
  { type: 'stairs_straight', label: 'Straight Stairs', desc: 'Linear stair flight with treads' },
  { type: 'stairs_l', label: 'L-Shape Stairs', desc: 'Quarter-turn landing stair' },
  { type: 'stairs_u', label: 'U-Turn Stairs', desc: '180° return landing stair' },
  { type: 'stairs_spiral', label: 'Spiral Stairs', desc: 'Compact helical winder stair' },
  { type: 'column_round', label: 'Round Column', desc: 'Cylindrical structural pillar' },
  { type: 'column_square', label: 'Square Column', desc: 'Square structural pillar' },
  { type: 'beam', label: 'Ceiling Beam', desc: 'Overhead structural beam' },
  { type: 'fireplace', label: 'Fireplace', desc: 'Hearth & firebox surround' },
  { type: 'platform', label: 'Podium / Platform', desc: 'Raised floor stage or plinth' },
  { type: 'balcony', label: 'Balcony Slab', desc: 'Cantilevered slab with railing' },
];

interface PeopleCatalogItem {
  pose: PersonPose;
  label: string;
  detail: string;
  h: number;
}

const PEOPLE_CATALOG_ITEMS: PeopleCatalogItem[] = [
  { pose: 'standing_man', label: 'Adult Man', detail: '178 cm · Standing', h: 1780 },
  { pose: 'standing_woman', label: 'Adult Woman', detail: '166 cm · Standing', h: 1660 },
  { pose: 'child', label: 'Child', detail: '122 cm · Standing', h: 1220 },
  { pose: 'seated', label: 'Seated Person', detail: '132 cm · Chair / Sofa', h: 1320 },
  { pose: 'walking', label: 'Walking Figure', detail: '174 cm · In Stride', h: 1740 },
  { pose: 'lying_back', label: 'Lying Down (Back)', detail: '175 cm · Bed / Lounge', h: 1750 },
  { pose: 'lying_side', label: 'Lying Down (Side)', detail: '172 cm · Bed / Sofa', h: 1720 },
];

const ArchThumb: React.FC<{ type: ArchElementType }> = ({ type }) => {
  return (
    <svg viewBox="0 0 120 56" className="w-full h-11 text-slate-700 dark:text-slate-200">
      {type === 'doorframe' && (
        <g>
          <line x1="8" y1="28" x2="26" y2="28" stroke="#94A3B8" strokeWidth="3" />
          <line x1="94" y1="28" x2="112" y2="28" stroke="#94A3B8" strokeWidth="3" />
          <rect x="26" y="16" width="10" height="24" rx="1" fill="currentColor" />
          <rect x="84" y="16" width="10" height="24" rx="1" fill="currentColor" />
          <line x1="36" y1="18" x2="84" y2="18" stroke="currentColor" strokeWidth="1.8" strokeDasharray="4 3" />
          <line x1="36" y1="38" x2="84" y2="38" stroke="currentColor" strokeWidth="1.8" strokeDasharray="4 3" />
          <line x1="36" y1="28" x2="84" y2="28" stroke="#64748B" strokeWidth="1" />
        </g>
      )}
      {type === 'chimney' && (
        <g>
          <rect x="34" y="12" width="52" height="32" fill="#E2E8F0" stroke="currentColor" strokeWidth="2.5" />
          <line x1="34" y1="12" x2="86" y2="44" stroke="#64748B" strokeWidth="1.2" />
          <line x1="86" y1="12" x2="34" y2="44" stroke="#64748B" strokeWidth="1.2" />
        </g>
      )}
      {type === 'stairs_straight' && (
        <g>
          <rect x="18" y="14" width="84" height="28" fill="#F8FAFC" stroke="currentColor" strokeWidth="2" />
          {[30, 42, 54, 66, 78, 90].map((x) => (
            <line key={x} x1={x} y1="14" x2={x} y2="42" stroke="currentColor" strokeWidth="1.4" />
          ))}
          <path d="M26 28 H94 M87 23 L94 28 L87 33" fill="none" stroke="#2563EB" strokeWidth="2" />
        </g>
      )}
      {type === 'stairs_l' && (
        <g>
          <path d="M20 10 H62 V28 H98 V46 H20 Z" fill="#F8FAFC" stroke="currentColor" strokeWidth="2" />
          <line x1="20" y1="22" x2="62" y2="22" stroke="currentColor" strokeWidth="1.2" />
          <line x1="74" y1="28" x2="74" y2="46" stroke="currentColor" strokeWidth="1.2" />
          <line x1="86" y1="28" x2="86" y2="46" stroke="currentColor" strokeWidth="1.2" />
        </g>
      )}
      {type === 'stairs_u' && (
        <g>
          <rect x="20" y="10" width="80" height="36" fill="#F8FAFC" stroke="currentColor" strokeWidth="2" />
          <line x1="20" y1="28" x2="72" y2="28" stroke="currentColor" strokeWidth="1.8" />
          <line x1="72" y1="10" x2="72" y2="46" stroke="currentColor" strokeWidth="1.2" />
          {[32, 46, 60].map((x) => (
            <g key={x}>
              <line x1={x} y1="10" x2={x} y2="28" stroke="currentColor" strokeWidth="1.2" />
              <line x1={x} y1="28" x2={x} y2="46" stroke="currentColor" strokeWidth="1.2" />
            </g>
          ))}
        </g>
      )}
      {type === 'stairs_spiral' && (
        <g>
          <circle cx="60" cy="28" r="20" fill="#F8FAFC" stroke="currentColor" strokeWidth="2" />
          <circle cx="60" cy="28" r="4" fill="currentColor" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const rad = (a * Math.PI) / 180;
            return (
              <line
                key={a}
                x1={60 + Math.cos(rad) * 4}
                y1={28 + Math.sin(rad) * 4}
                x2={60 + Math.cos(rad) * 20}
                y2={28 + Math.sin(rad) * 20}
                stroke="currentColor"
                strokeWidth="1.2"
              />
            );
          })}
        </g>
      )}
      {type === 'column_round' && (
        <circle cx="60" cy="28" r="16" fill="#E2E8F0" stroke="currentColor" strokeWidth="2.5" />
      )}
      {type === 'column_square' && (
        <rect x="44" y="12" width="32" height="32" fill="#E2E8F0" stroke="currentColor" strokeWidth="2.5" />
      )}
      {type === 'beam' && (
        <rect x="14" y="20" width="92" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 3" />
      )}
      {type === 'fireplace' && (
        <g>
          <rect x="24" y="12" width="72" height="32" fill="#CBD5E1" stroke="currentColor" strokeWidth="2.2" />
          <rect x="38" y="22" width="44" height="22" fill="#475569" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="60" cy="33" r="5" fill="#F97316" />
        </g>
      )}
      {type === 'platform' && (
        <g>
          <rect x="18" y="12" width="84" height="32" fill="#F1F5F9" stroke="currentColor" strokeWidth="2" />
          <rect x="24" y="17" width="72" height="22" fill="none" stroke="#64748B" strokeWidth="1.2" strokeDasharray="4 2" />
        </g>
      )}
      {type === 'balcony' && (
        <g>
          <rect x="18" y="12" width="84" height="32" fill="#F1F5F9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M18 12 V44 H102 V12" fill="none" stroke="#2563EB" strokeWidth="2.8" />
        </g>
      )}
    </svg>
  );
};

const PersonThumb: React.FC<{ pose: PersonPose }> = ({ pose }) => {
  const isLying = pose === 'lying_back' || pose === 'lying_side';
  return (
    <svg viewBox="0 0 120 56" className="w-full h-11 text-slate-700 dark:text-slate-200">
      {isLying ? (
        <g>
          <rect
            x="22"
            y="14"
            width="76"
            height="28"
            rx="12"
            fill="#E2E8F0"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="34" cy="28" r="8" fill="#F8FAFC" stroke="currentColor" strokeWidth="2" />
          {pose === 'lying_side' ? (
            <path d="M46 21 C60 19, 72 24, 90 22 M50 32 C64 35, 76 30, 88 33" stroke="#475569" strokeWidth="2" fill="none" />
          ) : (
            <line x1="46" y1="28" x2="90" y2="28" stroke="#64748B" strokeWidth="1.6" strokeDasharray="4 3" />
          )}
        </g>
      ) : (
        <g>
          <ellipse
            cx="60"
            cy="28"
            rx={pose === 'child' ? 14 : 20}
            ry={pose === 'seated' ? 14 : 11}
            fill="#E2E8F0"
            stroke="currentColor"
            strokeWidth="2"
          />
          {pose === 'walking' && (
            <>
              <circle cx="52" cy="17" r="4.5" fill="currentColor" />
              <circle cx="68" cy="39" r="4.5" fill="currentColor" />
            </>
          )}
          <circle cx="60" cy="28" r={pose === 'child' ? 6.5 : 8} fill="#F8FAFC" stroke="currentColor" strokeWidth="2" />
          <path d="M56 22 Q60 19 64 22" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </g>
      )}
    </svg>
  );
};

const CATEGORIES: Array<'All' | FurnitureCategory> = [
  'All',
  'Sofas & Seating',
  'Tables & Desks',
  'Beds & Bedroom',
  'Storage & Media',
  'Kitchen',
  'Bathroom',
  'Lighting',
  'Decor & Plants',
  'Outdoor',
  'My Library',
];

const CatalogThumb: React.FC<{ tpl: CatalogTemplate }> = ({ tpl }) => {
  const b = computeFurnitureBoundsMm(tpl.parts);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const spanW = Math.max(b.widthMm, 320);
  const spanD = Math.max(b.depthMm, 320);
  const pad = Math.max(spanW, spanD) * 0.16;
  const vb = `${cx - spanW / 2 - pad} ${cy - spanD / 2 - pad} ${spanW + pad * 2} ${spanD + pad * 2}`;
  const sw = Math.max(12, Math.max(spanW, spanD) * 0.014);
  const activeMode = resolveEffectiveRepresentationMode(tpl);
  let rep = tpl.representation;
  if (
    activeMode === 'default' &&
    !rep?.defaultViews?.top?.elements?.length &&
    typeof tpl.svgSource === 'string' &&
    isValidSvgSource(tpl.svgSource)
  ) {
    const parsed = parseSvgSourceToProjectedView(tpl.svgSource, b.widthMm, b.depthMm);
    if (parsed) {
      rep = {
        ...(rep ?? { mode: 'default' }),
        mode: 'default',
        defaultViews: { ...(rep?.defaultViews ?? {}), top: parsed.view },
      };
    }
  }
  const effectiveRep = rep && rep.mode !== activeMode ? { ...rep, mode: activeMode } : rep;
  const effective = getEffectiveViewElements(effectiveRep, 'top');
  if (effective.elements && effective.elements.length > 0 && effectiveRep) {
    const tvb = effective.autoView?.viewBox;
    const rcx = tvb ? tvb.minX + tvb.width / 2 : 0;
    const rcy = tvb ? tvb.minY + tvb.height / 2 : 0;
    const rSpanW = Math.max(tvb?.width ?? b.widthMm, 320);
    const rSpanH = Math.max(tvb?.height ?? b.depthMm, 320);
    const rPad = Math.max(rSpanW, rSpanH) * 0.16;
    const rViewBox = `${rcx - rSpanW / 2 - rPad} ${rcy - rSpanH / 2 - rPad} ${rSpanW + rPad * 2} ${rSpanH + rPad * 2}`;
    return (
      <svg viewBox={rViewBox} className="w-full h-14">
        {renderFurnitureRepresentationView(effectiveRep, 'top')}
      </svg>
    );
  }
  return (
    <svg viewBox={vb} className="w-full h-14">
      {[...tpl.parts]
        .sort((a, b) => a.zMm - b.zMm)
        .map((p) => (
        <g key={p.id} transform={`translate(${p.xMm}, ${p.yMm}) rotate(${p.rotationDeg})`}>
          {renderPartVector2D(p, '#1E293B', sw, { showDetails: true })}
        </g>
      ))}
    </svg>
  );
};

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  project,
  activeLevel,
  selection,
  onSelect,
  onPlaceFurniture,
  onPlacePerson,
  onPlaceArchElement,
  onPlaceRailingPreset,
  onUpdateLevel,
  onOpenCustomBuilder,
  onOpenImporter,
  onToolChange,
  onAddLevel,
  onSwitchLevel,
  onDeleteLevel,
}) => {
  const [tab, setTab] = useState<LeftTab>('catalog');
  const [catalogSubTab, setCatalogSubTab] = useState<CatalogSubTab>('furniture');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<'All' | FurnitureCategory>('All');

  const allCatalog = useMemo(
    () => [...project.customLibrary, ...BUILTIN_CATALOG],
    [project.customLibrary]
  );

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allCatalog.filter((item) => {
      if (cat !== 'All' && item.category !== cat) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [allCatalog, cat, search]);

  const filteredArch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ARCH_CATALOG_ITEMS;
    return ARCH_CATALOG_ITEMS.filter(
      (a) => a.label.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q)
    );
  }, [search]);

  const filteredRailingStyles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return RAILING_STYLES;
    return RAILING_STYLES.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        'railing balustrade handrail'.includes(q)
    );
  }, [search]);

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return PEOPLE_CATALOG_ITEMS;
    return PEOPLE_CATALOG_ITEMS.filter(
      (p) => p.label.toLowerCase().includes(q) || p.detail.toLowerCase().includes(q)
    );
  }, [search]);

  const scheduleData = useMemo(() => {
    const totalRoomM2 = activeLevel.rooms.reduce((s, r) => s + r.areaM2, 0);
    const totalPaintM2 = activeLevel.walls.reduce(
      (s, w) => s + computeWallSurfaceAreaM2(w, activeLevel.openings).netAreaM2 * 2,
      0
    );
    const furnGroups = new Map<string, { name: string; count: number; unitCost: number }>();
    for (const f of activeLevel.furniture) {
      const existing = furnGroups.get(f.name);
      if (existing) {
        existing.count += 1;
      } else {
        furnGroups.set(f.name, {
          name: f.name,
          count: 1,
          unitCost: f.estimatedCostEur ?? 350,
        });
      }
    }
    const items = Array.from(furnGroups.values());
    const totalCost = items.reduce((s, it) => s + it.count * it.unitCost, 0);
    return { totalRoomM2, totalPaintM2, items, totalCost };
  }, [activeLevel]);

  const handleTraceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const aspect = img.width / Math.max(1, img.height);
        const widthMm = 12000;
        const heightMm = Math.round(widthMm / aspect);
        onUpdateLevel(
          (lvl) => ({
            ...lvl,
            backgroundTrace: {
              imageDataUrl: dataUrl,
              xMm: 0,
              yMm: 0,
              widthMm,
              heightMm,
              opacity: 0.45,
              visible: true,
              rotationDeg: 0,
            },
          }),
          false,
          true,
          'Upload Trace Image'
        );
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 text-xs">
      {/* Tab Strip */}
      <div className="grid grid-cols-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
        {(
          [
            { id: 'catalog', label: 'Catalog', Icon: Box },
            { id: 'tree', label: 'Layers', Icon: Layers },
            { id: 'schedule', label: 'Schedule', Icon: Calculator },
            { id: 'trace', label: 'Levels', Icon: ImageIcon },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`py-2.5 flex flex-col items-center gap-1 text-[11px] font-medium border-b-2 transition-colors cursor-pointer ${
              tab === id
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: CATALOG */}
      {tab === 'catalog' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Sub-tabs: Furniture | Architecture | People */}
          <div className="px-2.5 pt-2 pb-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60">
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800/80">
              {(
                [
                  { id: 'furniture', label: 'Furniture' },
                  { id: 'architecture', label: 'Architecture' },
                  { id: 'people', label: 'People' },
                ] as const
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setCatalogSubTab(st.id)}
                  className={`py-1 px-1.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    catalogSubTab === st.id
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2.5 space-y-2 border-b border-slate-200 dark:border-slate-800">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  catalogSubTab === 'furniture'
                    ? 'Search sofas, kitchen, beds...'
                    : catalogSubTab === 'architecture'
                    ? 'Search stairs, chimney, column...'
                    : 'Search standing, seated, lying...'
                }
                aria-label="Search catalog"
                className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {catalogSubTab === 'furniture' && (
              <>
                <select
                  value={cat}
                  onChange={(e) => setCat(e.target.value as 'All' | FurnitureCategory)}
                  aria-label="Filter catalog category"
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={onOpenCustomBuilder}
                    className="py-1.5 px-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded text-[11px] font-medium hover:opacity-90 cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Build
                  </button>
                  <button
                    type="button"
                    onClick={onOpenImporter}
                    className="py-1.5 px-1.5 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Upload className="w-3 h-3" /> Import
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
            {catalogSubTab === 'furniture' && (
              <div className="grid grid-cols-2 gap-2">
                {filteredCatalog.map((tpl) => {
                  const b = computeFurnitureBoundsMm(tpl.parts);
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => onPlaceFurniture(tpl)}
                      className="group text-left p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors cursor-pointer"
                    >
                      <CatalogThumb tpl={tpl} />
                      <div className="mt-1.5 font-medium text-[11px] text-slate-800 dark:text-slate-100 truncate">
                        {tpl.name}
                      </div>
                      <div className="text-[10px] font-mono-nums text-slate-400">
                        {Math.round(b.widthMm / 10)}×{Math.round(b.depthMm / 10)} cm · {tpl.parts.length} parts
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {catalogSubTab === 'architecture' && (
              <div className="space-y-4">
                {/* Railings & Balustrades Section */}
                {filteredRailingStyles.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Railings &amp; Balustrades
                      </span>
                      <button
                        type="button"
                        data-testid="sidebar-draw-railing-btn"
                        onClick={() => onToolChange('railing')}
                        className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium cursor-pointer"
                      >
                        Draw Path
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {filteredRailingStyles.map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          data-testid={`catalog-railing-${st.id}`}
                          onClick={() => {
                            if (onPlaceRailingPreset) {
                              onPlaceRailingPreset(st.id);
                            } else {
                              onPlaceArchElement('railing', `${st.label} Railing`);
                            }
                          }}
                          className="text-left p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors cursor-pointer"
                        >
                          <RailingStyleThumb styleId={st.id} className="w-full h-10 text-slate-700 dark:text-slate-200" />
                          <div className="mt-1 font-medium text-[11px] text-slate-800 dark:text-slate-100 truncate">
                            {st.shortLabel}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {st.description}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {filteredArch.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      Architectural Elements
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {filteredArch.map((a) => (
                        <button
                          key={a.type}
                          type="button"
                          onClick={() => onPlaceArchElement(a.type, a.label)}
                          className="text-left p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors cursor-pointer"
                        >
                          <ArchThumb type={a.type} />
                          <div className="mt-1 font-medium text-[11px] text-slate-800 dark:text-slate-100 truncate">
                            {a.label}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {a.desc}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {catalogSubTab === 'people' && (
              <div className="space-y-2">
                <div className="font-semibold text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1">
                  <User className="w-3.5 h-3.5" /> People Scale Figures
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {filteredPeople.map((p) => (
                    <button
                      key={p.pose}
                      type="button"
                      onClick={() => onPlacePerson(p.pose, p.label, p.h)}
                      className="text-left p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors cursor-pointer"
                    >
                      <PersonThumb pose={p.pose} />
                      <div className="mt-1 font-medium text-[11px] text-slate-800 dark:text-slate-100 truncate">
                        {p.label}
                      </div>
                      <div className="text-[10px] font-mono-nums text-slate-400 truncate">
                        {p.detail}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: LAYERS & OBJECT TREE */}
      {tab === 'tree' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="space-y-1">
            <div className="font-semibold text-[11px] text-slate-500 mb-1.5">Layer Visibility</div>
            {(
              [
                ['walls', 'Walls'],
                ['rooms', 'Rooms & Floors'],
                ['openings', 'Doors, Windows & Arches'],
                ['furniture', 'Furniture'],
                ['curtains', 'Curtains & Blinds'],
                ['people', 'People Figures'],
                ['archElements', 'Stairs, Columns & Beams'],
                ['measurements', 'Measurements'],
                ['annotations', 'Annotations'],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
              >
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={activeLevel.layers[key]}
                  onChange={(e) =>
                    onUpdateLevel(
                      (lvl) => ({
                        ...lvl,
                        layers: { ...lvl.layers, [key]: e.target.checked },
                      }),
                      false,
                      true,
                      `Toggle ${label} Layer`
                    )
                  }
                  className="accent-blue-600"
                />
              </label>
            ))}
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
            <div className="font-semibold text-[11px] text-slate-500">
              Objects ({activeLevel.rooms.length} rooms, {activeLevel.walls.length} walls, {activeLevel.furniture.length} furniture)
            </div>

            {activeLevel.rooms.map((r) => (
              <div
                key={r.id}
                className={`flex items-center justify-between px-2 py-1 rounded ${
                  selection.some((s) => s.kind === 'room' && s.id === r.id)
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    const target = { kind: 'room' as const, id: r.id };
                    if (e.ctrlKey || e.metaKey || e.shiftKey) {
                      const exists = selection.some((s) => s.kind === 'room' && s.id === r.id);
                      onSelect(
                        exists
                          ? selection.filter((s) => !(s.kind === 'room' && s.id === r.id))
                          : [...selection, target]
                      );
                    } else {
                      onSelect([target]);
                    }
                  }}
                  className="flex-1 text-left truncate cursor-pointer"
                >
                  {r.name} · {formatAreaM2(r.areaM2)}
                </button>
              </div>
            ))}

            {activeLevel.furniture.map((f) => {
              const sel = selection.some((s) => s.kind === 'furniture' && s.id === f.id);
              return (
                <div key={f.id} className="space-y-0.5">
                  <div
                    className={`flex items-center justify-between px-2 py-1 rounded ${
                      sel
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        const target = { kind: 'furniture' as const, id: f.id };
                        if (e.ctrlKey || e.metaKey || e.shiftKey) {
                          const exists = selection.some((s) => s.kind === 'furniture' && s.id === f.id);
                          onSelect(
                            exists
                              ? selection.filter((s) => !(s.kind === 'furniture' && s.id === f.id))
                              : [...selection, target]
                          );
                        } else {
                          onSelect([target]);
                        }
                      }}
                      className="flex-1 text-left truncate font-medium cursor-pointer"
                    >
                      {f.name}
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        aria-label={`Toggle visibility for ${f.name}`}
                        onClick={() =>
                          onUpdateLevel(
                            (lvl) => ({
                              ...lvl,
                              furniture: lvl.furniture.map((x) =>
                                x.id === f.id ? { ...x, visible: !x.visible } : x
                              ),
                            }),
                            false,
                            true,
                            `Toggle ${f.name} Visibility`
                          )
                        }
                        className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        {f.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      </button>
                      <button
                        type="button"
                        aria-label={`Toggle lock for ${f.name}`}
                        onClick={() =>
                          onUpdateLevel(
                            (lvl) => ({
                              ...lvl,
                              furniture: lvl.furniture.map((x) =>
                                x.id === f.id ? { ...x, locked: !x.locked } : x
                              ),
                            }),
                            false,
                            true,
                            `${f.locked ? 'Unlock' : 'Lock'} ${f.name}`
                          )
                        }
                        className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        {f.locked ? <Lock className="w-3 h-3 text-amber-500" /> : <Unlock className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                  {sel && f.parts.length > 1 && (
                    <div className="pl-4 space-y-0.5">
                      {f.parts.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={(e) => {
                            const target = { kind: 'furniture' as const, id: f.id, partId: p.id };
                            if (e.ctrlKey || e.metaKey || e.shiftKey) {
                              const exists = selection.some(
                                (s) => s.kind === 'furniture' && s.id === f.id && s.partId === p.id
                              );
                              onSelect(
                                exists
                                  ? selection.filter((s) => !(s.kind === 'furniture' && s.id === f.id && s.partId === p.id))
                                  : [...selection, target]
                              );
                            } else {
                              onSelect([target]);
                            }
                          }}
                          className={`w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] text-left cursor-pointer ${
                            selection.some((s) => s.kind === 'furniture' && s.partId === p.id)
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-xs shrink-0" style={{ backgroundColor: p.color }} />
                          <span className="truncate">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: SCHEDULE & COST */}
      {tab === 'schedule' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] text-slate-500">Total Floor Area</div>
              <div className="font-mono-nums font-semibold text-sm mt-0.5">
                {formatAreaM2(scheduleData.totalRoomM2)}
              </div>
            </div>
            <div className="p-2.5 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] text-slate-500">Wall Surface (Paint)</div>
              <div className="font-mono-nums font-semibold text-sm mt-0.5">
                {scheduleData.totalPaintM2.toFixed(1)} m²
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="font-semibold text-[11px] text-slate-600 dark:text-slate-300">
              Rooms Breakdown
            </div>
            {activeLevel.rooms.map((r) => (
              <div key={r.id} className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                <span className="truncate">{r.name} · {r.floorMaterial}</span>
                <span className="font-mono-nums font-medium">{formatAreaM2(r.areaM2)}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="font-semibold text-[11px] text-slate-600 dark:text-slate-300">
              Furniture & Material Schedule
            </div>
            {scheduleData.items.map((it) => (
              <div key={it.name} className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                <span className="truncate flex-1">{it.count}× {it.name}</span>
                <span className="font-mono-nums text-slate-600 dark:text-slate-300 ml-2">
                  €{(it.count * it.unitCost).toLocaleString()}
                </span>
              </div>
            ))}
            <div className="flex justify-between pt-2 font-semibold text-sm">
              <span>Estimated Fitout</span>
              <span className="font-mono-nums text-blue-600 dark:text-blue-400">
                €{scheduleData.totalCost.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: LEVELS & BACKGROUND TRACE */}
      {tab === 'trace' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[11px] text-slate-600 dark:text-slate-300">
                Floors & Levels
              </span>
              <button
                type="button"
                onClick={onAddLevel}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Add Floor
              </button>
            </div>
            <div className="space-y-1">
              {project.levels.map((lvl) => (
                <div
                  key={lvl.id}
                  className={`flex items-center justify-between px-2 py-1.5 rounded border ${
                    lvl.id === activeLevel.id
                      ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSwitchLevel(lvl.id)}
                    className="flex-1 text-left font-medium truncate cursor-pointer"
                  >
                    {lvl.name}
                  </button>
                  {project.levels.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteLevel(lvl.id)}
                      aria-label={`Delete ${lvl.name}`}
                      className="p-1 text-red-500 hover:bg-red-50 rounded cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2.5">
            <div className="font-semibold text-[11px] text-slate-600 dark:text-slate-300">
              Background Floorplan Trace
            </div>
            <label className="block w-full py-2 px-3 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-md hover:border-blue-500 cursor-pointer font-medium">
              Upload Floorplan Image
              <input type="file" accept="image/*" onChange={handleTraceUpload} className="hidden" />
            </label>

            {activeLevel.backgroundTrace && (
              <div className="space-y-2">
                <label className="flex justify-between text-[11px] text-slate-500">
                  <span>Trace Opacity</span>
                  <span className="font-mono-nums">
                    {Math.round(activeLevel.backgroundTrace.opacity * 100)}%
                  </span>
                </label>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={activeLevel.backgroundTrace.opacity}
                  onChange={(e) =>
                    onUpdateLevel(
                      (lvl) =>
                        lvl.backgroundTrace
                          ? {
                              ...lvl,
                              backgroundTrace: {
                                ...lvl.backgroundTrace,
                                opacity: Number(e.target.value),
                              },
                            }
                          : lvl,
                      false,
                      true,
                      'Change Trace Opacity',
                      'trace-opacity'
                    )
                  }
                  className="w-full accent-blue-600"
                />

                <button
                  type="button"
                  onClick={() => onToolChange('calibrate_trace')}
                  className="w-full py-1.5 px-2.5 bg-blue-600 text-white rounded font-medium flex items-center justify-center gap-1.5 hover:bg-blue-700 cursor-pointer"
                >
                  <Ruler className="w-3.5 h-3.5" />
                  Calibrate Scale (Click 2 Points)
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateLevel(
                      (lvl) => ({ ...lvl, backgroundTrace: null }),
                      false,
                      true,
                      'Remove Trace Image'
                    )
                  }
                  className="w-full py-1.5 px-2.5 border border-red-200 text-red-600 rounded font-medium hover:bg-red-50 cursor-pointer"
                >
                  Remove Trace Image
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
