import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Copy,
  FlipHorizontal,
  FlipVertical,
  Grid2x2,
  Layers,
  Lock,
  PenTool,
  Plus,
  RotateCcw,
  Scissors,
  Sun,
  Trash2,
  Unlock,
} from 'lucide-react';
import {
  ArchElement,
  CatalogTemplate,
  Curtain,
  EditorTool,
  FurnitureInstance,
  FurniturePart,
  Level,
  MaterialPreset,
  MountingFace,
  MountingType,
  Opening,
  PartShape,
  PersonInstance,
  ProjectionViewId,
  ProjectSettings,
  RepresentationMode,
  ResizeAnchor,
  Room,
  SelectionTarget,
  Wall,
  WallAlignment,
  WallAnchorMode,
} from '../types/plan';
import {
  buildWallDimensionChain,
  computeAttachedChimneyTransform,
  computeAttachedWallFurnitureTransform,
  computeChimneyFaceBounds,
  computeFurnitureBoundsMm,
  computeSurfaceLocalCoords,
  computeWallInnerBounds,
  computeWallSurfaceAreaM2,
  dist,
  doesChimneyOverlapWalls,
  findNearMissWallGaps,
  findNearestWallAttachmentTarget,
  findSupportingSurfaceForProp,
  flipWallFace,
  getCeilingFixtureOffsetMm,
  getChimneyCornerPin,
  getCommonValue,
  getDefaultChimneyFaceColors,
  getEnclosingRoomCeilingMm,
  getWallArcLength,
  getWallMountedComponents,
  healNearWallGaps,
  isFixedSizeFurniture,
  lerpPoint,
  propagateParentFurnitureTransforms,
  propagateWallAttachments,
  reorderFurnitureZOrder,
  resolveChimneyFaceColors,
  resolveWallFaces,
  ResolvedWallFaceInfo,
  scaleFurnitureParts,
  snapChimneyToWallEdge,
  solveChimneyResize,
  solveConnectedWallLengthChange,
  solveWallComponentResize,
  splitWallAtPoint,
  syncLevelCeilingHeight,
  syncRoomCeilingHeight,
} from '../utils/geometry';
import {
  ALL_MOUNTING_FACES,
  ALL_MOUNTING_TYPES,
  defaultMountingFaceForType,
  MOUNTING_FACE_LABELS,
  MOUNTING_TYPE_LABELS,
  resolveFurnitureMountingFace,
  resolveFurnitureMountingType,
  transformBoundsBetweenMountings,
} from '../utils/mounting';
import { formatAreaM2, formatSmartMetric, uid } from '../utils/units';
import { computeFurnitureRepresentationAsync } from '../utils/furnitureRepresentationSync';
import {
  generateDefaultTopViewFromParts,
  hasValidDefaultSvg,
  isBuiltinCatalogItem,
  resolveEffectiveRepresentationMode,
} from '../utils/svgImport';
import { hasAnyCustomViews } from '../utils/svgRepresentationRenderer';
import { ColorMaterialPicker } from './ColorMaterialPicker';
import { FurnitureLightingPanel } from './FurnitureLightingPanel';
import { MetricInput, NumberField } from './MetricInput';
import {
  cloneLightsWithFreshIds,
  resolveEffectiveFurnitureLights,
  scaleFurnitureLightSources,
} from '../utils/lighting';

interface PropertiesInspectorProps {
  level: Level;
  settings: ProjectSettings;
  selection: SelectionTarget[];
  recentColors: string[];
  onSelect: (targets: SelectionTarget[]) => void;
  onUpdateLevel: (
    updater: (lvl: Level) => Level,
    recomputeRooms?: boolean,
    recordHistory?: boolean,
    label?: string,
    coalesceKey?: string
  ) => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onAddRecentColor: (hex: string) => void;
  onActivateEyedropper: (callback: (hex: string) => void) => void;
  onSaveToLibrary: (tpl: CatalogTemplate) => void;
  onToolChange: (tool: EditorTool) => void;
  onOpenSvgEditor?: (furnitureId: string) => void;
  onConstraintError?: (message: string) => void;
}

const LockToggleButton: React.FC<{
  locked: boolean;
  onToggle: () => void;
  label?: string;
}> = ({ locked, onToggle, label }) => (
  <button
    type="button"
    onClick={onToggle}
    title={locked ? `Unlock ${label ?? 'element'}` : `Lock ${label ?? 'element'} in place`}
    aria-label={locked ? `Unlock ${label ?? 'element'}` : `Lock ${label ?? 'element'}`}
    aria-pressed={locked}
    className={`px-2 py-1 rounded-md border text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer ${
      locked
        ? 'bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25'
        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
    }`}
  >
    {locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
    <span>{locked ? 'Locked' : 'Lock'}</span>
  </button>
);

const LockedBanner: React.FC = () => (
  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-[11px] text-amber-800 dark:text-amber-200">
    <Lock className="w-3.5 h-3.5 shrink-0" />
    <span>Locked in place. Unlock to move, resize, or delete.</span>
  </div>
);

const ResizeAnchorSelector: React.FC<{
  value: ResizeAnchor;
  onChange: (anchor: ResizeAnchor) => void;
}> = ({ value, onChange }) => {
  const options: Array<{ id: ResizeAnchor; label: string; hint: string }> = [
    { id: 'left', label: 'Left Edge', hint: 'Pin Left Edge (expand Right)' },
    { id: 'center', label: 'Middle', hint: 'Expand Equally From Middle (Default)' },
    { id: 'right', label: 'Right Edge', hint: 'Pin Right Edge (expand Left)' },
  ];
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Resize Anchor
        </span>
        <span className="text-[10px] text-slate-400">
          {value === 'left' ? 'Left Edge Fixed' : value === 'right' ? 'Right Edge Fixed' : 'Middle Fixed'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {options.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              title={opt.hint}
              onClick={() => onChange(opt.id)}
              className={`relative py-1.5 px-1.5 rounded-md border text-[11px] font-medium flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                active
                  ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-500 text-blue-700 dark:text-blue-300 shadow-xs'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span className="w-7 h-2 rounded-xs bg-slate-200 dark:bg-slate-700 relative overflow-hidden flex items-center justify-center">
                {opt.id === 'left' && (
                  <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${active ? 'bg-blue-600' : 'bg-slate-400'}`} />
                )}
                {opt.id === 'center' && (
                  <span className={`w-1.5 h-full ${active ? 'bg-blue-600' : 'bg-slate-400'}`} />
                )}
                {opt.id === 'right' && (
                  <span className={`absolute right-0 top-0 bottom-0 w-1.5 ${active ? 'bg-blue-600' : 'bg-slate-400'}`} />
                )}
              </span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ConstraintErrorBanner: React.FC<{ message: string; onDismiss: () => void }> = ({
  message,
  onDismiss,
}) => (
  <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-[11px] text-red-700 dark:text-red-300">
    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
    <span className="flex-1">{message}</span>
    <button
      type="button"
      onClick={onDismiss}
      className="text-[10px] underline shrink-0 cursor-pointer"
    >
      Hide
    </button>
  </div>
);

export const PropertiesInspector: React.FC<PropertiesInspectorProps> = ({
  level,
  settings,
  selection,
  recentColors,
  onSelect,
  onUpdateLevel,
  onDeleteSelected,
  onDuplicateSelected,
  onAddRecentColor,
  onActivateEyedropper,
  onSaveToLibrary,
  onOpenSvgEditor,
  onConstraintError,
}) => {
  const [arrayCols, setArrayCols] = useState(2);
  const [arrayRows, setArrayRows] = useState(2);
  const [arrayGapMm, setArrayGapMm] = useState(300);
  const [constraintError, setConstraintError] = useState<string | null>(null);
  const [repBusy, setRepBusy] = useState(false);
  const [confirmRegenFurnId, setConfirmRegenFurnId] = useState<string | null>(null);

  const primary = selection[0];
  const unit = settings.preferredUnit;

  useEffect(() => {
    setConstraintError(null);
    setConfirmRegenFurnId(null);
  }, [primary?.kind, primary?.id]);

  const reportConstraintError = (msg: string) => {
    setConstraintError(msg);
    onConstraintError?.(msg);
  };

  const applyWallComponentUpdates = (
    hostWall: Wall,
    updates: Array<{ id: string; kind: 'opening' | 'chimney'; t: number; widthMm: number }>,
    label: string,
    chimneyOverride?: { id: string; depthMm?: number; cornerPin?: 'left' | 'right' | null }
  ) => {
    const map = new Map(updates.map((u) => [u.id, u]));
    setConstraintError(null);
    onUpdateLevel(
      (lvl) => ({
        ...lvl,
        openings: lvl.openings.map((o) => {
          const u = map.get(o.id);
          return u && u.kind === 'opening' ? { ...o, t: u.t, widthMm: u.widthMm } : o;
        }),
        archElements: lvl.archElements.map((a) => {
          const u = map.get(a.id);
          if (!u || u.kind !== 'chimney') return a;
          const nextDepthMm =
            chimneyOverride?.id === a.id && typeof chimneyOverride.depthMm === 'number'
              ? chimneyOverride.depthMm
              : a.depthMm;
          const tf = computeAttachedChimneyTransform(
            hostWall,
            u.t,
            nextDepthMm,
            a.attachedFace ?? 'left'
          );
          const nextAnchor =
            chimneyOverride?.id === a.id && chimneyOverride.cornerPin
              ? chimneyOverride.cornerPin
              : a.resizeAnchor;
          return {
            ...a,
            widthMm: u.widthMm,
            depthMm: nextDepthMm,
            attachedT: u.t,
            xMm: tf.xMm,
            yMm: tf.yMm,
            rotationDeg: tf.rotationDeg,
            resizeAnchor: nextAnchor,
          };
        }),
      }),
      false,
      true,
      label
    );
  };

  // Multi-selection shared properties, alignment, grouping & batch editing panel
  if (selection.length > 1) {
    const wallIds = selection.filter((s) => s.kind === 'wall').map((s) => s.id);
    const furnIds = selection.filter((s) => s.kind === 'furniture').map((s) => s.id);
    const openingIds = selection.filter((s) => s.kind === 'opening').map((s) => s.id);
    const roomIds = selection.filter((s) => s.kind === 'room').map((s) => s.id);
    const archIds = selection.filter((s) => s.kind === 'arch').map((s) => s.id);
    const curtainIds = selection.filter((s) => s.kind === 'curtain').map((s) => s.id);
    const personIds = selection.filter((s) => s.kind === 'person').map((s) => s.id);

    const selectedWalls = level.walls.filter((w) => wallIds.includes(w.id));
    const selectedFurn = level.furniture.filter((f) => furnIds.includes(f.id));
    const selectedOpenings = level.openings.filter((o) => openingIds.includes(o.id));
    const selectedRooms = level.rooms.filter((r) => roomIds.includes(r.id));
    const selectedArch = level.archElements.filter((a) => archIds.includes(a.id));
    const selectedCurtains = level.curtains.filter((c) => curtainIds.includes(c.id));
    const selectedPeople = level.people.filter((p) => personIds.includes(p.id));

    const kindsPresent = new Set(selection.map((s) => s.kind));
    const singleKind = kindsPresent.size === 1 ? selection[0].kind : 'mixed';

    const alignFurniture = (mode: 'left' | 'cx' | 'right' | 'top' | 'cy' | 'bottom') => {
      if (selectedFurn.length < 2) return;
      const xs = selectedFurn.map((f) => f.xMm);
      const ys = selectedFurn.map((f) => f.yMm);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const midX = (minX + maxX) / 2;
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const midY = (minY + maxY) / 2;

      onUpdateLevel(
        (lvl) => {
          const movedPairs: Array<{ prev: FurnitureInstance; next: FurnitureInstance }> = [];
          let nextFurn = lvl.furniture.map((f) => {
            if (!furnIds.includes(f.id) || f.locked) return f;
            const nextPos =
              mode === 'left'
                ? { xMm: minX }
                : mode === 'cx'
                  ? { xMm: Math.round(midX) }
                  : mode === 'right'
                    ? { xMm: maxX }
                    : mode === 'top'
                      ? { yMm: minY }
                      : mode === 'cy'
                        ? { yMm: Math.round(midY) }
                        : { yMm: maxY };
            const nf: FurnitureInstance = {
              ...f,
              ...nextPos,
              attachedWallId: undefined,
              attachedFace: undefined,
              attachedT: undefined,
            };
            movedPairs.push({ prev: f, next: nf });
            return nf;
          });
          for (const pair of movedPairs) {
            nextFurn = propagateParentFurnitureTransforms(nextFurn, pair.next.id, pair.prev, pair.next);
          }
          return { ...lvl, furniture: nextFurn };
        },
        false,
        true,
        'Align Furniture'
      );
    };

    const distributeFurniture = (axis: 'x' | 'y') => {
      if (selectedFurn.length < 3) return;
      const sorted = [...selectedFurn].sort((a, b) => (axis === 'x' ? a.xMm - b.xMm : a.yMm - b.yMm));
      const first = axis === 'x' ? sorted[0].xMm : sorted[0].yMm;
      const last = axis === 'x' ? sorted[sorted.length - 1].xMm : sorted[sorted.length - 1].yMm;
      const step = (last - first) / (sorted.length - 1);
      const map = new Map<string, number>();
      sorted.forEach((f, i) => map.set(f.id, Math.round(first + i * step)));
      onUpdateLevel(
        (lvl) => {
          const movedPairs: Array<{ prev: FurnitureInstance; next: FurnitureInstance }> = [];
          let nextFurn = lvl.furniture.map((f) => {
            if (!map.has(f.id) || f.locked) return f;
            const nf: FurnitureInstance = {
              ...f,
              ...(axis === 'x' ? { xMm: map.get(f.id)! } : { yMm: map.get(f.id)! }),
              attachedWallId: undefined,
              attachedFace: undefined,
              attachedT: undefined,
            };
            movedPairs.push({ prev: f, next: nf });
            return nf;
          });
          for (const pair of movedPairs) {
            nextFurn = propagateParentFurnitureTransforms(nextFurn, pair.next.id, pair.prev, pair.next);
          }
          return { ...lvl, furniture: nextFurn };
        },
        false,
        true,
        'Distribute Furniture'
      );
    };

    const groupSelected = () => {
      const gid = uid('grp');
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          furniture: lvl.furniture.map((f) => (furnIds.includes(f.id) ? { ...f, groupId: gid } : f)),
        }),
        false,
        true,
        'Group Furniture'
      );
    };

    const selectedAllLocked = selection.every((s) => {
      if (s.kind === 'wall') return level.walls.find((w) => w.id === s.id)?.locked;
      if (s.kind === 'room') return level.rooms.find((r) => r.id === s.id)?.locked;
      if (s.kind === 'opening') return level.openings.find((o) => o.id === s.id)?.locked;
      if (s.kind === 'curtain') return level.curtains.find((c) => c.id === s.id)?.locked;
      if (s.kind === 'furniture') return level.furniture.find((f) => f.id === s.id)?.locked;
      if (s.kind === 'person') return level.people.find((p) => p.id === s.id)?.locked;
      if (s.kind === 'arch') return level.archElements.find((a) => a.id === s.id)?.locked;
      return false;
    });

    const toggleLockAll = () => {
      const nextLock = !selectedAllLocked;
      const wSet = new Set(wallIds);
      const rSet = new Set(roomIds);
      const oSet = new Set(openingIds);
      const cSet = new Set(curtainIds);
      const fSet = new Set(furnIds);
      const pSet = new Set(personIds);
      const aSet = new Set(archIds);

      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          walls: lvl.walls.map((w) => (wSet.has(w.id) ? { ...w, locked: nextLock } : w)),
          rooms: lvl.rooms.map((r) => (rSet.has(r.id) ? { ...r, locked: nextLock } : r)),
          openings: lvl.openings.map((o) => (oSet.has(o.id) ? { ...o, locked: nextLock } : o)),
          curtains: lvl.curtains.map((c) => (cSet.has(c.id) ? { ...c, locked: nextLock } : c)),
          furniture: lvl.furniture.map((f) => (fSet.has(f.id) ? { ...f, locked: nextLock } : f)),
          people: lvl.people.map((p) => (pSet.has(p.id) ? { ...p, locked: nextLock } : p)),
          archElements: lvl.archElements.map((a) => (aSet.has(a.id) ? { ...a, locked: nextLock } : a)),
        }),
        false,
        true,
        nextLock ? 'Lock Selection' : 'Unlock Selection'
      );
    };

    const summaryParts: string[] = [];
    if (selectedWalls.length) summaryParts.push(`${selectedWalls.length} walls`);
    if (selectedRooms.length) summaryParts.push(`${selectedRooms.length} rooms`);
    if (selectedOpenings.length) summaryParts.push(`${selectedOpenings.length} openings`);
    if (selectedFurn.length) summaryParts.push(`${selectedFurn.length} furniture`);
    if (selectedArch.length) summaryParts.push(`${selectedArch.length} arch`);
    if (selectedCurtains.length) summaryParts.push(`${selectedCurtains.length} curtains`);
    if (selectedPeople.length) summaryParts.push(`${selectedPeople.length} figures`);

    const batchUpdateWalls = (patch: Partial<Wall>, label: string) => {
      const set = new Set(wallIds);
      onUpdateLevel(
        (lvl) => {
          const nextWalls = lvl.walls.map((w) => (set.has(w.id) && !w.locked ? { ...w, ...patch } : w));
          return {
            ...lvl,
            walls: nextWalls,
            furniture: propagateWallAttachments(lvl.furniture, nextWalls, set),
          };
        },
        false,
        true,
        label
      );
    };

    const batchUpdateFurniture = (patch: Partial<FurnitureInstance>, label: string) => {
      const set = new Set(furnIds);
      onUpdateLevel(
        (lvl) => {
          const movedPairs: Array<{ prev: FurnitureInstance; next: FurnitureInstance }> = [];
          let nextFurn = lvl.furniture.map((f) => {
            if (!set.has(f.id) || f.locked) return f;
            const nf = { ...f, ...patch };
            movedPairs.push({ prev: f, next: nf });
            return nf;
          });
          for (const pair of movedPairs) {
            nextFurn = propagateParentFurnitureTransforms(nextFurn, pair.next.id, pair.prev, pair.next);
          }
          return { ...lvl, furniture: nextFurn };
        },
        false,
        true,
        label
      );
    };

    const batchUpdateOpenings = (patch: Partial<Opening>, label: string) => {
      const set = new Set(openingIds);
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          openings: lvl.openings.map((o) => (set.has(o.id) && !o.locked ? { ...o, ...patch } : o)),
        }),
        false,
        true,
        label
      );
    };

    const batchUpdateRooms = (patch: Partial<Room>, label: string) => {
      const set = new Set(roomIds);
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          rooms: lvl.rooms.map((r) => (set.has(r.id) && !r.locked ? { ...r, ...patch } : r)),
        }),
        false,
        true,
        label
      );
    };

    const batchUpdateArch = (patch: Partial<ArchElement>, label: string) => {
      const set = new Set(archIds);
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          archElements: lvl.archElements.map((a) => (set.has(a.id) && !a.locked ? { ...a, ...patch } : a)),
        }),
        false,
        true,
        label
      );
    };

    const batchUpdateCurtains = (patch: Partial<Curtain>, label: string) => {
      const set = new Set(curtainIds);
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          curtains: lvl.curtains.map((c) => (set.has(c.id) && !c.locked ? { ...c, ...patch } : c)),
        }),
        false,
        true,
        label
      );
    };

    const batchUpdatePeople = (patch: Partial<PersonInstance>, label: string) => {
      const set = new Set(personIds);
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          people: lvl.people.map((p) => (set.has(p.id) && !p.locked ? { ...p, ...patch } : p)),
        }),
        false,
        true,
        label
      );
    };

    return (
      <div className="p-3 space-y-4 text-xs overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              {selection.length} Elements Selected
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {summaryParts.join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <LockToggleButton locked={selectedAllLocked} onToggle={toggleLockAll} label="selection" />
            <button
              type="button"
              onClick={onDeleteSelected}
              className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded cursor-pointer"
              aria-label="Delete selected elements"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* WALLS MULTI-SELECTION SHARED PROPERTIES (LENGTH EXCLUDED) */}
        {singleKind === 'wall' && selectedWalls.length > 1 && (() => {
          const cThick = getCommonValue(selectedWalls.map((w) => w.thicknessMm));
          const cHeight = getCommonValue(selectedWalls.map((w) => w.heightMm));
          const cAlign = getCommonValue(selectedWalls.map((w) => w.alignment));
          const cAnchor = getCommonValue(selectedWalls.map((w) => w.anchorMode ?? 'fixed_left'));
          const cBase = getCommonValue(selectedWalls.map((w) => w.hasBaseboard));
          const cCrown = getCommonValue(selectedWalls.map((w) => w.hasCrownMolding));
          const cInColor = getCommonValue(selectedWalls.map((w) => w.innerColor.toUpperCase()));
          const cInMat = getCommonValue(selectedWalls.map((w) => w.innerMaterial));
          const cOutColor = getCommonValue(selectedWalls.map((w) => w.outerColor.toUpperCase()));
          const cOutMat = getCommonValue(selectedWalls.map((w) => w.outerMaterial));

          return (
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="text-[11px] font-medium text-slate-500">
                Shared Wall Properties (wall lengths excluded)
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MetricInput
                  label="Thickness"
                  valueMm={cThick.value}
                  isMixed={cThick.mixed}
                  unit="mm"
                  minMm={40}
                  maxMm={1000}
                  onChangeMm={(mm) => batchUpdateWalls({ thicknessMm: mm }, 'Edit Wall Thickness')}
                />
                <MetricInput
                  label="Height"
                  valueMm={cHeight.value}
                  isMixed={cHeight.mixed}
                  unit="m"
                  minMm={300}
                  maxMm={10000}
                  onChangeMm={(mm) => batchUpdateWalls({ heightMm: mm }, 'Edit Wall Height')}
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 mb-0.5">
                  <span>Wall Anchor</span>
                  {cAnchor.mixed && <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Mixed</span>}
                </div>
                <select
                  value={cAnchor.mixed ? '' : cAnchor.value}
                  onChange={(e) => {
                    if (e.target.value) batchUpdateWalls({ anchorMode: e.target.value as WallAnchorMode }, 'Edit Wall Anchor');
                  }}
                  className="w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
                >
                  {cAnchor.mixed && <option value="" disabled>Mixed anchors</option>}
                  <option value="fixed_left">Fix Left End</option>
                  <option value="fixed_right">Fix Right End</option>
                  <option value="free">Flexible (Center)</option>
                  <option value="fixed_length">Fix Total Length</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                  <span>Wall Thickness Alignment</span>
                  {cAlign.mixed && <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Mixed</span>}
                </div>
                <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-100 dark:bg-slate-900 rounded-md">
                  {(['center', 'inner', 'outer'] as WallAlignment[]).map((al) => (
                    <button
                      key={al}
                      type="button"
                      onClick={() => batchUpdateWalls({ alignment: al }, 'Edit Wall Alignment')}
                      className={`py-1 rounded text-[11px] font-medium capitalize cursor-pointer ${
                        !cAlign.mixed && cAlign.value === al
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      {al}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <span>
                    Baseboard / Skirting{' '}
                    {cBase.mixed && <span className="text-[10px] text-amber-600 dark:text-amber-400">(Mixed)</span>}
                  </span>
                  <input
                    type="checkbox"
                    checked={!cBase.mixed && cBase.value}
                    onChange={(e) => batchUpdateWalls({ hasBaseboard: e.target.checked }, 'Toggle Baseboard')}
                    className="accent-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span>
                    Crown Molding{' '}
                    {cCrown.mixed && <span className="text-[10px] text-amber-600 dark:text-amber-400">(Mixed)</span>}
                  </span>
                  <input
                    type="checkbox"
                    checked={!cCrown.mixed && cCrown.value}
                    onChange={(e) => batchUpdateWalls({ hasCrownMolding: e.target.checked }, 'Toggle Crown Molding')}
                    className="accent-blue-600"
                  />
                </label>
              </div>

              <ColorMaterialPicker
                label="Inner Face Finish"
                color={cInColor.value}
                isMixedColor={cInColor.mixed}
                material={cInMat.value}
                isMixedMaterial={cInMat.mixed}
                recentColors={recentColors}
                onColorChange={(hex) => {
                  batchUpdateWalls({ innerColor: hex }, 'Edit Wall Inner Color');
                  onAddRecentColor(hex);
                }}
                onMaterialChange={(m) => batchUpdateWalls({ innerMaterial: m }, 'Edit Wall Inner Material')}
              />
              <ColorMaterialPicker
                label="Outer Face Finish"
                color={cOutColor.value}
                isMixedColor={cOutColor.mixed}
                material={cOutMat.value}
                isMixedMaterial={cOutMat.mixed}
                recentColors={recentColors}
                onColorChange={(hex) => {
                  batchUpdateWalls({ outerColor: hex }, 'Edit Wall Outer Color');
                  onAddRecentColor(hex);
                }}
                onMaterialChange={(m) => batchUpdateWalls({ outerMaterial: m }, 'Edit Wall Outer Material')}
              />
            </div>
          );
        })()}

        {/* FURNITURE MULTI-SELECTION SHARED PROPERTIES */}
        {singleKind === 'furniture' && selectedFurn.length > 1 && (() => {
          const allBounds = selectedFurn.map((f) => computeFurnitureBoundsMm(f.parts));
          const cW = getCommonValue(allBounds.map((b) => Math.round(b.widthMm)));
          const cD = getCommonValue(allBounds.map((b) => Math.round(b.depthMm)));
          const cH = getCommonValue(allBounds.map((b) => Math.round(b.heightMm)));
          const cElev = getCommonValue(selectedFurn.map((f) => f.elevationMm));
          const cRot = getCommonValue(selectedFurn.map((f) => f.rotationDeg));
          const cColor = getCommonValue(selectedFurn.map((f) => (f.parts[0]?.color ?? '#FFFFFF').toUpperCase()));
          const cMat = getCommonValue(selectedFurn.map((f) => f.parts[0]?.material ?? 'wood'));
          const allLights = selectedFurn.every((f) => f.category === 'Lighting');
          const allFixedSize = selectedFurn.every((f) => isFixedSizeFurniture(f));
          const anyFixedSize = selectedFurn.some((f) => isFixedSizeFurniture(f));

          const resizeAllFurnAxis = (axis: 'w' | 'd' | 'h', targetMm: number) => {
            const set = new Set(furnIds);
            const clamped = Math.max(40, targetMm);
            onUpdateLevel(
              (lvl) => {
                const resizedPairs: Array<{ prev: FurnitureInstance; next: FurnitureInstance }> = [];
                let nextFurn = lvl.furniture.map((f) => {
                  if (!set.has(f.id) || f.locked || isFixedSizeFurniture(f)) return f;
                  const b = computeFurnitureBoundsMm(f.parts);
                  const sx = axis === 'w' ? clamped / Math.max(10, b.widthMm) : 1;
                  const sy = axis === 'd' ? clamped / Math.max(10, b.depthMm) : 1;
                  const sz = axis === 'h' ? clamped / Math.max(10, b.heightMm) : 1;
                  const nf = {
                    ...f,
                    parts: scaleFurnitureParts(f.parts, sx, sy, sz),
                    lights: scaleFurnitureLightSources(f.lights, sx, sy, sz),
                  };
                  resizedPairs.push({ prev: f, next: nf });
                  return nf;
                });
                for (const pair of resizedPairs) {
                  nextFurn = propagateParentFurnitureTransforms(nextFurn, pair.next.id, pair.prev, pair.next);
                }
                return { ...lvl, furniture: nextFurn };
              },
              false,
              true,
              'Resize Selected Furniture'
            );
          };

          return (
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="text-[11px] font-medium text-slate-500">Shared Dimensions & Transform</div>
              {allFixedSize ? (
                <div className="px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                  Fixed real-world dimensions ({cW.mixed ? 'Mixed' : formatSmartMetric(cW.value, unit)} × {cD.mixed ? 'Mixed' : formatSmartMetric(cD.value, unit)} × {cH.mixed ? 'Mixed' : formatSmartMetric(cH.value, unit)})
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-1.5">
                    <MetricInput label="Width" valueMm={cW.value} isMixed={cW.mixed} unit={unit} minMm={40} onChangeMm={(mm) => resizeAllFurnAxis('w', mm)} />
                    <MetricInput label="Depth" valueMm={cD.value} isMixed={cD.mixed} unit={unit} minMm={40} onChangeMm={(mm) => resizeAllFurnAxis('d', mm)} />
                    <MetricInput label="Height" valueMm={cH.value} isMixed={cH.mixed} unit={unit} minMm={20} onChangeMm={(mm) => resizeAllFurnAxis('h', mm)} />
                  </div>
                  {anyFixedSize && (
                    <p className="text-[10px] text-slate-400">
                      Fixed-size decor items keep their real dimensions.
                    </p>
                  )}
                </>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <MetricInput label="Elevation" valueMm={cElev.value} isMixed={cElev.mixed} unit={unit} minMm={0} onChangeMm={(mm) => batchUpdateFurniture({ elevationMm: mm }, 'Edit Furniture Elevation')} />
                <NumberField label="Rotation" value={cRot.value} isMixed={cRot.mixed} unitLabel="°" onChange={(deg) => batchUpdateFurniture({ rotationDeg: deg }, 'Rotate Selected Furniture')} />
              </div>

              {/* Shared 2D Layer Order */}
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-500">2D Stacking Order</div>
                <div className="grid grid-cols-4 gap-1">
                  <button type="button" onClick={() => onUpdateLevel((lvl) => ({ ...lvl, furniture: reorderFurnitureZOrder(lvl.furniture, furnIds, 'forward') }), false, true, 'Bring Forward')} className="py-1 px-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 cursor-pointer" title="Bring Forward">
                    <ArrowUp className="w-3 h-3" /><span>Fwd</span>
                  </button>
                  <button type="button" onClick={() => onUpdateLevel((lvl) => ({ ...lvl, furniture: reorderFurnitureZOrder(lvl.furniture, furnIds, 'backward') }), false, true, 'Send Backward')} className="py-1 px-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 cursor-pointer" title="Send Backward">
                    <ArrowDown className="w-3 h-3" /><span>Back</span>
                  </button>
                  <button type="button" onClick={() => onUpdateLevel((lvl) => ({ ...lvl, furniture: reorderFurnitureZOrder(lvl.furniture, furnIds, 'front') }), false, true, 'Bring to Front')} className="py-1 px-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 cursor-pointer" title="Bring to Front">
                    <ChevronsUp className="w-3 h-3" /><span>Front</span>
                  </button>
                  <button type="button" onClick={() => onUpdateLevel((lvl) => ({ ...lvl, furniture: reorderFurnitureZOrder(lvl.furniture, furnIds, 'back') }), false, true, 'Send to Back')} className="py-1 px-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 cursor-pointer" title="Send to Back">
                    <ChevronsDown className="w-3 h-3" /><span>Bottom</span>
                  </button>
                </div>
              </div>

              {allLights && (() => {
                const cEnabled = getCommonValue(selectedFurn.map((f) => f.lightConfig?.enabled ?? true));
                const cTemp = getCommonValue(selectedFurn.map((f) => f.lightConfig?.colorTempK ?? 3200));
                const cInt = getCommonValue(selectedFurn.map((f) => f.lightConfig?.intensity ?? 1.0));
                const setSet = new Set(furnIds);
                const applyLightPatch = (patch: Partial<NonNullable<FurnitureInstance['lightConfig']>>, label: string) => {
                  onUpdateLevel(
                    (lvl) => ({
                      ...lvl,
                      furniture: lvl.furniture.map((f) => {
                        if (!setSet.has(f.id) || f.locked) return f;
                        const nextConfig = {
                          enabled: true,
                          colorTempK: 3200,
                          intensity: 1.0,
                          ...f.lightConfig,
                          ...patch,
                        };
                        const nextLights = Array.isArray(f.lights)
                          ? f.lights.map((l, idx) =>
                              idx === 0
                                ? {
                                    ...l,
                                    enabled: nextConfig.enabled,
                                    colorTempK: nextConfig.colorTempK,
                                    intensity: nextConfig.intensity,
                                  }
                                : l
                            )
                          : f.lights;
                        return {
                          ...f,
                          lightConfig: nextConfig,
                          ...(nextLights ? { lights: nextLights } : {}),
                        };
                      }),
                    }),
                    false,
                    true,
                    label
                  );
                };
                return (
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold flex items-center gap-1.5"><Sun className="w-3.5 h-3.5 text-amber-500" />Shared Fixture Light</span>
                      <button type="button" onClick={() => applyLightPatch({ enabled: cEnabled.mixed ? true : !cEnabled.value }, 'Toggle Lights')} className="px-2 py-0.5 border border-slate-200 dark:border-slate-700 rounded text-[11px] cursor-pointer">
                        {cEnabled.mixed ? 'Mixed · Turn On' : cEnabled.value ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-500">
                        <span>Warmth</span><span>{cTemp.mixed ? 'Mixed' : `${cTemp.value}K`}</span>
                      </div>
                      <input type="range" min={2200} max={6500} step={100} value={cTemp.value} onChange={(e) => applyLightPatch({ colorTempK: Number(e.target.value) }, 'Light Color Temp')} className="w-full accent-amber-500" />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-500">
                        <span>Brightness</span><span>{cInt.mixed ? 'Mixed' : `${Math.round(cInt.value * 100)}%`}</span>
                      </div>
                      <input type="range" min={0.2} max={2.5} step={0.1} value={cInt.value} onChange={(e) => applyLightPatch({ intensity: Number(e.target.value) }, 'Light Brightness')} className="w-full accent-amber-500" />
                    </div>
                  </div>
                );
              })()}

              <ColorMaterialPicker
                label="Shared Surface Finish"
                color={cColor.value}
                isMixedColor={cColor.mixed}
                material={cMat.value as MaterialPreset}
                isMixedMaterial={cMat.mixed}
                recentColors={recentColors}
                onColorChange={(hex) => {
                  const set = new Set(furnIds);
                  onUpdateLevel(
                    (lvl) => ({
                      ...lvl,
                      furniture: lvl.furniture.map((f) =>
                        set.has(f.id) && !f.locked
                          ? { ...f, parts: f.parts.map((p) => ({ ...p, color: hex })) }
                          : f
                      ),
                    }),
                    false,
                    true,
                    'Color Selected Furniture'
                  );
                  onAddRecentColor(hex);
                }}
                onMaterialChange={(m) => {
                  const set = new Set(furnIds);
                  onUpdateLevel(
                    (lvl) => ({
                      ...lvl,
                      furniture: lvl.furniture.map((f) =>
                        set.has(f.id) && !f.locked
                          ? { ...f, parts: f.parts.map((p) => ({ ...p, material: m })) }
                          : f
                      ),
                    }),
                    false,
                    true,
                    'Material Selected Furniture'
                  );
                }}
              />
            </div>
          );
        })()}

        {/* OPENINGS MULTI-SELECTION SHARED PROPERTIES */}
        {singleKind === 'opening' && selectedOpenings.length > 1 && (() => {
          const cCat = getCommonValue(selectedOpenings.map((o) => o.category));
          const cSub = getCommonValue(selectedOpenings.map((o) => o.subtype));
          const cW = getCommonValue(selectedOpenings.map((o) => o.widthMm));
          const cH = getCommonValue(selectedOpenings.map((o) => o.heightMm));
          const cSill = getCommonValue(selectedOpenings.map((o) => o.sillHeightMm));
          const cFrameT = getCommonValue(selectedOpenings.map((o) => o.frameThicknessMm));
          const cFrameColor = getCommonValue(selectedOpenings.map((o) => o.frameColor.toUpperCase()));
          const cPanelColor = getCommonValue(selectedOpenings.map((o) => o.panelColor.toUpperCase()));
          const cGlassColor = getCommonValue(selectedOpenings.map((o) => o.glassColor.toUpperCase()));
          const cAngle = getCommonValue(selectedOpenings.map((o) => o.openAngleDeg));

          return (
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="text-[11px] font-medium text-slate-500">Shared Opening Properties</div>
              <div className="grid grid-cols-2 gap-2">
                <MetricInput label="Width" valueMm={cW.value} isMixed={cW.mixed} unit={unit} minMm={150} maxMm={6000} onChangeMm={(mm) => batchUpdateOpenings({ widthMm: mm }, 'Edit Opening Width')} />
                <MetricInput label="Height" valueMm={cH.value} isMixed={cH.mixed} unit={unit} minMm={300} maxMm={4500} onChangeMm={(mm) => batchUpdateOpenings({ heightMm: mm }, 'Edit Opening Height')} />
                <MetricInput label="Sill Height" valueMm={cSill.value} isMixed={cSill.mixed} unit={unit} minMm={0} maxMm={2500} onChangeMm={(mm) => batchUpdateOpenings({ sillHeightMm: mm }, 'Edit Sill Height')} />
                <MetricInput label="Frame Thick" valueMm={cFrameT.value} isMixed={cFrameT.mixed} unit="mm" minMm={20} maxMm={200} onChangeMm={(mm) => batchUpdateOpenings({ frameThicknessMm: mm }, 'Edit Frame Thickness')} />
              </div>

              {!cCat.mixed && cCat.value === 'door' && (
                <div>
                  <label className="flex justify-between text-[11px] text-slate-500">
                    <span>Door Open Angle</span>
                    <span className="font-mono-nums">{cAngle.mixed ? 'Mixed' : `${cAngle.value}°`}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={90}
                    value={cAngle.value}
                    onChange={(e) => batchUpdateOpenings({ openAngleDeg: Number(e.target.value) }, 'Edit Door Angle')}
                    className="w-full accent-blue-600"
                  />
                </div>
              )}

              {!cSub.mixed && <div className="text-[11px] text-slate-500">Style: <span className="font-medium text-slate-700 dark:text-slate-200">{cSub.value}</span></div>}
              {cSub.mixed && <div className="text-[11px] text-amber-600 dark:text-amber-400">Mixed opening styles</div>}

              <ColorMaterialPicker
                label="Frame Color"
                color={cFrameColor.value}
                isMixedColor={cFrameColor.mixed}
                recentColors={recentColors}
                onColorChange={(hex) => {
                  batchUpdateOpenings({ frameColor: hex }, 'Edit Opening Frame Color');
                  onAddRecentColor(hex);
                }}
              />
              {!cCat.mixed && cCat.value === 'door' && (
                <ColorMaterialPicker
                  label="Door Leaf Color"
                  color={cPanelColor.value}
                  isMixedColor={cPanelColor.mixed}
                  recentColors={recentColors}
                  onColorChange={(hex) => batchUpdateOpenings({ panelColor: hex }, 'Edit Door Leaf Color')}
                />
              )}
              {!cCat.mixed && cCat.value === 'window' && (
                <ColorMaterialPicker
                  label="Glass Tint"
                  color={cGlassColor.value}
                  isMixedColor={cGlassColor.mixed}
                  recentColors={recentColors}
                  onColorChange={(hex) => batchUpdateOpenings({ glassColor: hex }, 'Edit Window Glass Tint')}
                />
              )}
            </div>
          );
        })()}

        {/* ROOMS MULTI-SELECTION SHARED PROPERTIES */}
        {singleKind === 'room' && selectedRooms.length > 1 && (() => {
          const cCeil = getCommonValue(selectedRooms.map((r) => r.ceilingHeightMm));
          const cFloorLvl = getCommonValue(selectedRooms.map((r) => r.floorLevelMm));
          const cHasCeil = getCommonValue(selectedRooms.map((r) => r.hasCeiling));
          const cFlColor = getCommonValue(selectedRooms.map((r) => r.floorColor.toUpperCase()));
          const cFlMat = getCommonValue(selectedRooms.map((r) => r.floorMaterial));
          const cCeColor = getCommonValue(selectedRooms.map((r) => r.ceilingColor.toUpperCase()));
          const cCeMat = getCommonValue(selectedRooms.map((r) => r.ceilingMaterial));

          return (
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="text-[11px] font-medium text-slate-500">Shared Room Properties</div>
              <div className="grid grid-cols-2 gap-2">
                <MetricInput
                  label="Floor Offset"
                  valueMm={cFloorLvl.value}
                  isMixed={cFloorLvl.mixed}
                  unit="mm"
                  minMm={-1000}
                  maxMm={2000}
                  onChangeMm={(mm) => batchUpdateRooms({ floorLevelMm: mm }, 'Edit Room Floor Offset')}
                />
                <MetricInput
                  label="Ceiling Height"
                  valueMm={cCeil.value}
                  isMixed={cCeil.mixed}
                  unit="m"
                  minMm={1800}
                  maxMm={8000}
                  onChangeMm={(mm) =>
                    onUpdateLevel(
                      (lvl) => {
                        let next = lvl;
                        for (const r of selectedRooms) {
                          if (!r.locked) next = syncRoomCeilingHeight(next, r.id, mm);
                        }
                        return next;
                      },
                      false,
                      true,
                      'Edit Rooms Ceiling Height'
                    )
                  }
                />
              </div>
              <label className="flex items-center justify-between cursor-pointer">
                <span>
                  Show Room Ceiling in 3D{' '}
                  {cHasCeil.mixed && <span className="text-[10px] text-amber-600 dark:text-amber-400">(Mixed)</span>}
                </span>
                <input
                  type="checkbox"
                  checked={!cHasCeil.mixed && cHasCeil.value}
                  onChange={(e) => batchUpdateRooms({ hasCeiling: e.target.checked }, 'Toggle Room Ceiling')}
                  className="accent-blue-600"
                />
              </label>
              <ColorMaterialPicker
                label="Floor Material"
                color={cFlColor.value}
                isMixedColor={cFlColor.mixed}
                material={cFlMat.value}
                isMixedMaterial={cFlMat.mixed}
                recentColors={recentColors}
                onColorChange={(hex) => {
                  batchUpdateRooms({ floorColor: hex }, 'Edit Floor Color');
                  onAddRecentColor(hex);
                }}
                onMaterialChange={(m) => batchUpdateRooms({ floorMaterial: m }, 'Edit Floor Material')}
              />
              <ColorMaterialPicker
                label="Ceiling Finish"
                color={cCeColor.value}
                isMixedColor={cCeColor.mixed}
                material={cCeMat.value}
                isMixedMaterial={cCeMat.mixed}
                recentColors={recentColors}
                onColorChange={(hex) => batchUpdateRooms({ ceilingColor: hex }, 'Edit Ceiling Color')}
                onMaterialChange={(m) => batchUpdateRooms({ ceilingMaterial: m }, 'Edit Ceiling Material')}
              />
            </div>
          );
        })()}

        {/* ARCH ELEMENTS MULTI-SELECTION SHARED PROPERTIES */}
        {singleKind === 'arch' && selectedArch.length > 1 && (() => {
          const cW = getCommonValue(selectedArch.map((a) => a.widthMm));
          const cD = getCommonValue(selectedArch.map((a) => a.depthMm));
          const cH = getCommonValue(selectedArch.map((a) => (a.connectToCeiling ? level.ceilingHeightMm : a.heightMm)));
          const cElev = getCommonValue(selectedArch.map((a) => a.elevationMm));
          const cColor = getCommonValue(selectedArch.map((a) => a.color.toUpperCase()));
          const cMat = getCommonValue(selectedArch.map((a) => a.material));
          const allChimneys = selectedArch.every((a) => a.type === 'chimney');

          return (
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="text-[11px] font-medium text-slate-500">Shared Architectural Properties</div>
              <div className="grid grid-cols-2 gap-2">
                <MetricInput label="Width" valueMm={cW.value} isMixed={cW.mixed} unit={unit} minMm={50} onChangeMm={(mm) => batchUpdateArch({ widthMm: mm }, 'Edit Width')} />
                <MetricInput label="Depth" valueMm={cD.value} isMixed={cD.mixed} unit={unit} minMm={50} onChangeMm={(mm) => batchUpdateArch({ depthMm: mm }, 'Edit Depth')} />
                <MetricInput label="Height" valueMm={cH.value} isMixed={cH.mixed} unit={unit} minMm={50} onChangeMm={(mm) => batchUpdateArch({ heightMm: mm, connectToCeiling: false }, 'Edit Height')} />
                <MetricInput label="Elevation" valueMm={cElev.value} isMixed={cElev.mixed} unit={unit} minMm={0} onChangeMm={(mm) => batchUpdateArch({ elevationMm: mm }, 'Edit Elevation')} />
              </div>
              {allChimneys && (() => {
                const resolved = selectedArch.map((a) => resolveChimneyFaceColors(a));
                const faces: Array<{ key: 'front' | 'back' | 'left' | 'right'; label: string }> = [
                  { key: 'front', label: 'Front Face' },
                  { key: 'back', label: 'Back Face' },
                  { key: 'left', label: 'Left Face' },
                  { key: 'right', label: 'Right Face' },
                ];
                return (
                  <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-2">
                    <div className="text-[11px] font-medium text-slate-500">Shared Chimney Face Colors</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {faces.map(({ key, label }) => {
                        const cFace = getCommonValue(resolved.map((r) => r[key].toUpperCase()));
                        return (
                          <label key={key} className="flex items-center gap-1.5 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 cursor-pointer">
                            <input
                              type="color"
                              value={cFace.mixed ? '#CBD5E1' : cFace.value}
                              onChange={(e) => {
                                const hex = e.target.value.toUpperCase();
                                const set = new Set(archIds);
                                onUpdateLevel(
                                  (lvl) => ({
                                    ...lvl,
                                    archElements: lvl.archElements.map((a) =>
                                      set.has(a.id) && !a.locked
                                        ? { ...a, faceColors: { ...resolveChimneyFaceColors(a), [key]: hex } }
                                        : a
                                    ),
                                  }),
                                  false,
                                  true,
                                  `Edit Chimney ${label}`
                                );
                              }}
                              className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent shrink-0"
                            />
                            <span className="text-[11px] truncate">{label}{cFace.mixed ? ' (Mixed)' : ''}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              <ColorMaterialPicker
                label="Primary Material"
                color={cColor.value}
                isMixedColor={cColor.mixed}
                material={cMat.value}
                isMixedMaterial={cMat.mixed}
                recentColors={recentColors}
                onColorChange={(hex) => batchUpdateArch({ color: hex }, 'Edit Material Color')}
                onMaterialChange={(m) => batchUpdateArch({ material: m }, 'Edit Material')}
              />
            </div>
          );
        })()}

        {/* CURTAINS MULTI-SELECTION */}
        {singleKind === 'curtain' && selectedCurtains.length > 1 && (() => {
          const cW = getCommonValue(selectedCurtains.map((c) => c.widthMm));
          const cH = getCommonValue(selectedCurtains.map((c) => c.heightMm));
          const cElev = getCommonValue(selectedCurtains.map((c) => c.elevationMm));
          const cOpen = getCommonValue(selectedCurtains.map((c) => c.openPercent));
          const cColor = getCommonValue(selectedCurtains.map((c) => c.color.toUpperCase()));
          const cMat = getCommonValue(selectedCurtains.map((c) => c.material));
          return (
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="grid grid-cols-3 gap-1.5">
                <MetricInput label="Width" valueMm={cW.value} isMixed={cW.mixed} unit={unit} minMm={300} onChangeMm={(mm) => batchUpdateCurtains({ widthMm: mm }, 'Edit Width')} />
                <MetricInput label="Height" valueMm={cH.value} isMixed={cH.mixed} unit={unit} minMm={300} onChangeMm={(mm) => batchUpdateCurtains({ heightMm: mm }, 'Edit Height')} />
                <MetricInput label="Elevation" valueMm={cElev.value} isMixed={cElev.mixed} unit={unit} minMm={0} onChangeMm={(mm) => batchUpdateCurtains({ elevationMm: mm }, 'Edit Elevation')} />
              </div>
              <div>
                <label className="flex justify-between text-[11px] text-slate-500">
                  <span>Open State</span>
                  <span>{cOpen.mixed ? 'Mixed' : `${cOpen.value}%`}</span>
                </label>
                <input type="range" min={0} max={95} value={cOpen.value} onChange={(e) => batchUpdateCurtains({ openPercent: Number(e.target.value) }, 'Edit Curtain Open')} className="w-full accent-blue-600" />
              </div>
              <ColorMaterialPicker label="Fabric Color" color={cColor.value} isMixedColor={cColor.mixed} material={cMat.value} isMixedMaterial={cMat.mixed} recentColors={recentColors} onColorChange={(hex) => batchUpdateCurtains({ color: hex }, 'Edit Fabric Color')} onMaterialChange={(m) => batchUpdateCurtains({ material: m }, 'Edit Fabric Material')} />
            </div>
          );
        })()}

        {/* PEOPLE MULTI-SELECTION */}
        {singleKind === 'person' && selectedPeople.length > 1 && (() => {
          const cH = getCommonValue(selectedPeople.map((p) => p.heightMm));
          const cRot = getCommonValue(selectedPeople.map((p) => p.rotationDeg));
          const cColor = getCommonValue(selectedPeople.map((p) => p.color.toUpperCase()));
          return (
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <MetricInput label="Height" valueMm={cH.value} isMixed={cH.mixed} unit="cm" minMm={700} maxMm={2200} onChangeMm={(mm) => batchUpdatePeople({ heightMm: mm }, 'Edit Figure Height')} />
                <NumberField label="Rotation" value={cRot.value} isMixed={cRot.mixed} unitLabel="°" onChange={(deg) => batchUpdatePeople({ rotationDeg: deg }, 'Rotate Figures')} />
              </div>
              <ColorMaterialPicker label="Silhouette Color" color={cColor.value} isMixedColor={cColor.mixed} recentColors={recentColors} onColorChange={(hex) => batchUpdatePeople({ color: hex }, 'Edit Silhouette Color')} />
            </div>
          );
        })()}

        {/* MIXED ELEMENT TYPES SHARED PROPERTIES (e.g. Wall + Furniture, or Curtain + Furniture) */}
        {singleKind === 'mixed' && (() => {
          const hasElevItems =
            selectedWalls.length === 0 &&
            selectedRooms.length === 0 &&
            selectedOpenings.length === 0 &&
            selectedPeople.length === 0 &&
            (selectedFurn.length + selectedArch.length + selectedCurtains.length > 0);
          const allElevValues = [
            ...selectedFurn.map((f) => f.elevationMm),
            ...selectedArch.map((a) => a.elevationMm),
            ...selectedCurtains.map((c) => c.elevationMm),
          ];
          const cSharedElev = hasElevItems ? getCommonValue(allElevValues) : null;

          const allHeightValues = [
            ...selectedWalls.map((w) => w.heightMm),
            ...selectedRooms.map((r) => r.ceilingHeightMm),
            ...selectedOpenings.map((o) => o.heightMm),
            ...selectedFurn
              .filter((f) => !isFixedSizeFurniture(f))
              .map((f) => Math.round(computeFurnitureBoundsMm(f.parts).heightMm)),
            ...selectedArch.map((a) => a.heightMm),
            ...selectedCurtains.map((c) => c.heightMm),
            ...selectedPeople.map((p) => p.heightMm),
          ];
          const cSharedHeight = allHeightValues.length > 0 ? getCommonValue(allHeightValues) : null;

          return (
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="text-[11px] font-medium text-slate-500">
                Common Cross-Type Properties
              </div>
              <div className="grid grid-cols-2 gap-2">
                {cSharedHeight && (
                  <MetricInput
                    label="Height"
                    valueMm={cSharedHeight.value}
                    isMixed={cSharedHeight.mixed}
                    unit={unit}
                    minMm={50}
                    maxMm={10000}
                    onChangeMm={(mm) =>
                      onUpdateLevel(
                        (lvl) => {
                          let next = lvl;
                          const wSet = new Set(wallIds);
                          const oSet = new Set(openingIds);
                          const aSet = new Set(archIds);
                          const cSet = new Set(curtainIds);
                          const pSet = new Set(personIds);
                          const fSet = new Set(furnIds);
                          next = {
                            ...next,
                            walls: next.walls.map((w) => (wSet.has(w.id) && !w.locked ? { ...w, heightMm: mm } : w)),
                            openings: next.openings.map((o) => (oSet.has(o.id) && !o.locked ? { ...o, heightMm: mm } : o)),
                            archElements: next.archElements.map((a) =>
                              aSet.has(a.id) && !a.locked ? { ...a, heightMm: mm, connectToCeiling: false } : a
                            ),
                            curtains: next.curtains.map((c) => (cSet.has(c.id) && !c.locked ? { ...c, heightMm: mm } : c)),
                            people: next.people.map((p) => (pSet.has(p.id) && !p.locked ? { ...p, heightMm: mm } : p)),
                            furniture: next.furniture.map((f) => {
                              if (!fSet.has(f.id) || f.locked || isFixedSizeFurniture(f)) return f;
                              const b = computeFurnitureBoundsMm(f.parts);
                              return { ...f, parts: scaleFurnitureParts(f.parts, 1, 1, mm / Math.max(10, b.heightMm)) };
                            }),
                          };
                          for (const r of selectedRooms) {
                            if (!r.locked) next = syncRoomCeilingHeight(next, r.id, mm);
                          }
                          return next;
                        },
                        false,
                        true,
                        'Edit Shared Height'
                      )
                    }
                  />
                )}
                {cSharedElev && (
                  <MetricInput
                    label="Elevation"
                    valueMm={cSharedElev.value}
                    isMixed={cSharedElev.mixed}
                    unit={unit}
                    minMm={0}
                    onChangeMm={(mm) =>
                      onUpdateLevel(
                        (lvl) => {
                          const fSet = new Set(furnIds);
                          const aSet = new Set(archIds);
                          const cSet = new Set(curtainIds);
                          return {
                            ...lvl,
                            furniture: lvl.furniture.map((f) => (fSet.has(f.id) && !f.locked ? { ...f, elevationMm: mm } : f)),
                            archElements: lvl.archElements.map((a) => (aSet.has(a.id) && !a.locked ? { ...a, elevationMm: mm } : a)),
                            curtains: lvl.curtains.map((c) => (cSet.has(c.id) && !c.locked ? { ...c, elevationMm: mm } : c)),
                          };
                        },
                        false,
                        true,
                        'Edit Shared Elevation'
                      )
                    }
                  />
                )}
              </div>
              {selectedWalls.length > 0 && (
                <p className="text-[11px] text-slate-400">
                  Wall lengths are excluded in multi-selection.
                </p>
              )}
            </div>
          );
        })()}

        {selectedFurn.length >= 2 && (
          <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
            <div className="text-[11px] font-medium text-slate-500">Align & Group Furniture</div>
            <div className="grid grid-cols-6 gap-1">
              <button type="button" onClick={() => alignFurniture('left')} title="Align Left" className="p-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex justify-center"><AlignStartVertical className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => alignFurniture('cx')} title="Align Center X" className="p-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex justify-center"><AlignCenterVertical className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => alignFurniture('right')} title="Align Right" className="p-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex justify-center"><AlignEndVertical className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => alignFurniture('top')} title="Align Top" className="p-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex justify-center"><AlignStartHorizontal className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => alignFurniture('cy')} title="Align Center Y" className="p-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex justify-center"><AlignCenterHorizontal className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => alignFurniture('bottom')} title="Align Bottom" className="p-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex justify-center"><AlignEndHorizontal className="w-3.5 h-3.5" /></button>
            </div>
            {selectedFurn.length >= 3 && (
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => distributeFurniture('x')}
                  className="px-2 py-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Distribute X
                </button>
                <button
                  type="button"
                  onClick={() => distributeFurniture('y')}
                  className="px-2 py-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Distribute Y
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={groupSelected}
              className="w-full py-1.5 px-2.5 bg-slate-100 dark:bg-slate-800 rounded font-medium hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              Group Selected Items
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!primary) {
    const totalArea = level.rooms.reduce((s, r) => s + r.areaM2, 0);
    return (
      <div className="p-3.5 space-y-4 text-xs">
        <div>
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">{level.name}</h3>
          <p className="text-slate-500 dark:text-slate-400 mt-0.5">
            {level.rooms.length} rooms · {formatAreaM2(totalArea)} total
          </p>
        </div>

        <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
          <MetricInput
            label="Default Ceiling Height"
            valueMm={level.ceilingHeightMm}
            unit="m"
            minMm={1800}
            maxMm={8000}
            onChangeMm={(mm) =>
              onUpdateLevel(
                (lvl) => syncLevelCeilingHeight(lvl, mm),
                false,
                true,
                'Change Default Ceiling Height'
              )
            }
          />
          <MetricInput
            label="Level Base Elevation"
            valueMm={level.elevationMm}
            unit="m"
            minMm={-10000}
            maxMm={50000}
            onChangeMm={(mm) =>
              onUpdateLevel((lvl) => ({ ...lvl, elevationMm: mm }))
            }
          />
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
          <div className="font-medium text-slate-700 dark:text-slate-300">Room Area Summary</div>
          {level.rooms.length === 0 ? (
            <p className="text-slate-400">Draw a closed wall loop to auto-detect rooms.</p>
          ) : (
            <div className="space-y-1.5">
              {level.rooms.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelect([{ kind: 'room', id: r.id }])}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-left cursor-pointer"
                >
                  <span className="truncate text-slate-700 dark:text-slate-200">{r.name}</span>
                  <span className="font-mono-nums text-slate-500">{formatAreaM2(r.areaM2)}</span>
                </button>
              ))}
              <div className="flex items-center justify-between px-2 pt-1.5 border-t border-slate-200 dark:border-slate-800 font-semibold">
                <span>Total Area</span>
                <span className="font-mono-nums text-blue-600 dark:text-blue-400">
                  {formatAreaM2(totalArea)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==================== WALL INSPECTOR ====================
  if (primary.kind === 'wall') {
    const wall = level.walls.find((w) => w.id === primary.id);
    if (!wall) return null;
    const lenMm = dist(wall.start, wall.end);
    const arcLenMm = getWallArcLength(wall);
    const surf = computeWallSurfaceAreaM2(wall, level.openings);
    const anchorMode: WallAnchorMode = wall.anchorMode ?? 'fixed_left';
    const dimChain = buildWallDimensionChain(wall, level.walls, level.openings, level.archElements);

    const updateWall = (patch: Partial<Wall>, recompute = false, label = 'Edit Wall') => {
      if (wall.locked && !('locked' in patch)) return;
      onUpdateLevel(
        (lvl) => {
          const nextWalls = lvl.walls.map((w) => (w.id === wall.id ? { ...w, ...patch } : w));
          return {
            ...lvl,
            walls: nextWalls,
            furniture: propagateWallAttachments(lvl.furniture, nextWalls, new Set([wall.id])),
          };
        },
        recompute,
        true,
        label
      );
    };

    const setWallLength = (nextLenMm: number) => {
      const res = solveConnectedWallLengthChange(
        wall,
        level.walls,
        level.openings,
        level.archElements,
        nextLenMm
      );
      if (!res.ok) {
        reportConstraintError(res.error ?? 'Cannot resize wall.');
        return;
      }
      setConstraintError(null);
      const wallUpdMap = new Map(res.wallUpdates.map((u) => [u.id, u]));
      const opUpdMap = new Map(res.openingUpdates.map((u) => [u.id, u.t]));
      const chimUpdMap = new Map(res.chimneyUpdates.map((u) => [u.id, u]));
      onUpdateLevel(
        (lvl) => {
          const nextWalls = lvl.walls.map((w) => {
            const u = wallUpdMap.get(w.id);
            return u ? { ...w, start: u.start, end: u.end } : w;
          });
          const movedIds = new Set(res.wallUpdates.map((u) => u.id));
          return {
            ...lvl,
            walls: nextWalls,
            furniture: propagateWallAttachments(lvl.furniture, nextWalls, movedIds),
            openings: lvl.openings.map((o) =>
              opUpdMap.has(o.id) ? { ...o, t: opUpdMap.get(o.id)! } : o
            ),
            archElements: lvl.archElements.map((a) => {
              const c = chimUpdMap.get(a.id);
              return c
                ? {
                    ...a,
                    attachedT: c.attachedT,
                    xMm: c.xMm,
                    yMm: c.yMm,
                    rotationDeg: c.rotationDeg,
                  }
                : a;
            }),
          };
        },
        true,
        true,
        'Resize Wall'
      );
    };

    const nearWallGaps = findNearMissWallGaps(level.walls, 260, 6).filter(
      (g) => g.wallAId === wall.id || g.wallBId === wall.id
    );

    const toggleSegmentLock = (seg: (typeof dimChain.segments)[number]) => {
      if (wall.locked) return;
      if (seg.kind === 'wall_gap') {
        const current = new Set(wall.lockedSegments ?? []);
        if (current.has(seg.key)) current.delete(seg.key);
        else current.add(seg.key);
        updateWall({ lockedSegments: Array.from(current) }, false, 'Toggle Segment Lock');
      } else if (seg.componentId) {
        if (seg.componentKind === 'opening') {
          onUpdateLevel(
            (lvl) => ({
              ...lvl,
              openings: lvl.openings.map((o) =>
                o.id === seg.componentId ? { ...o, locked: !o.locked } : o
              ),
            }),
            false,
            true,
            'Toggle Component Lock'
          );
        } else {
          onUpdateLevel(
            (lvl) => ({
              ...lvl,
              archElements: lvl.archElements.map((a) =>
                a.id === seg.componentId ? { ...a, locked: !a.locked } : a
              ),
            }),
            false,
            true,
            'Toggle Component Lock'
          );
        }
      }
    };

    return (
      <div className="p-3 space-y-3 text-xs overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Wall</h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={wall.locked}
              title="Split wall at midpoint"
              onClick={() => {
                if (wall.locked) return;
                onUpdateLevel(
                  (lvl) => {
                    const idx = lvl.walls.findIndex((w) => w.id === wall.id);
                    if (idx < 0) return lvl;
                    const split = splitWallAtPoint(wall, lerpPoint(wall.start, wall.end, 0.5), lvl.openings);
                    const nextWalls = [...lvl.walls];
                    nextWalls.splice(idx, 1, split.walls[0], split.walls[1]);
                    const remappedFurn = lvl.furniture.map((f) => {
                      if (f.attachedWallId !== wall.id) return f;
                      const t = f.attachedT ?? 0.5;
                      if (t <= 0.5) {
                        return {
                          ...f,
                          attachedWallId: split.walls[0].id,
                          attachedT: Math.max(0.02, Math.min(0.98, t * 2)),
                        };
                      }
                      return {
                        ...f,
                        attachedWallId: split.walls[1].id,
                        attachedT: Math.max(0.02, Math.min(0.98, (t - 0.5) * 2)),
                      };
                    });
                    return {
                      ...lvl,
                      walls: nextWalls,
                      openings: split.openings,
                      furniture: propagateWallAttachments(
                        remappedFurn,
                        nextWalls,
                        new Set([split.walls[0].id, split.walls[1].id])
                      ),
                    };
                  },
                  true,
                  true,
                  'Split Wall'
                );
              }}
              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              aria-label="Split wall at midpoint"
            >
              <Scissors className="w-3.5 h-3.5" />
            </button>
            <LockToggleButton
              locked={wall.locked}
              onToggle={() => updateWall({ locked: !wall.locked }, false, wall.locked ? 'Unlock Wall' : 'Lock Wall')}
              label="wall"
            />
            <button
              type="button"
              disabled={wall.locked}
              onClick={onDeleteSelected}
              className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-35 rounded cursor-pointer"
              aria-label="Delete wall"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {wall.locked && <LockedBanner />}
        {constraintError && (
          <ConstraintErrorBanner message={constraintError} onDismiss={() => setConstraintError(null)} />
        )}
        {!wall.locked && nearWallGaps.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100">
            <span className="text-[11px] leading-tight">
              {nearWallGaps.length} open corner {nearWallGaps.length === 1 ? 'gap' : 'gaps'} nearby
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdateLevel(
                  (lvl) => ({ ...lvl, walls: healNearWallGaps(lvl.walls, 260).walls }),
                  true,
                  true,
                  'Reconnect Wall Corners'
                )
              }
              className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
            >
              Reconnect
            </button>
          </div>
        )}

        <div
          aria-disabled={wall.locked}
          className={wall.locked ? 'space-y-3 opacity-50 pointer-events-none select-none' : 'space-y-3'}
        >
          <div className="grid grid-cols-2 gap-2">
            <MetricInput
              label="Length"
              valueMm={lenMm}
              unit={unit}
              minMm={100}
              onChangeMm={setWallLength}
            />
            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                Wall Anchor
              </label>
              <select
                value={anchorMode}
                onChange={(e) =>
                  updateWall({ anchorMode: e.target.value as WallAnchorMode }, false, 'Change Wall Anchor')
                }
                className="w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
              >
                <option value="fixed_left">Fix Left End</option>
                <option value="fixed_right">Fix Right End</option>
                <option value="free">Flexible (Center)</option>
                <option value="fixed_length">Fix Total Length</option>
              </select>
            </div>
            <MetricInput
              label="Thickness"
              valueMm={wall.thicknessMm}
              unit="mm"
              minMm={40}
              maxMm={1000}
              onChangeMm={(mm) => updateWall({ thicknessMm: mm })}
            />
            <MetricInput
              label="Height"
              valueMm={wall.heightMm}
              unit="m"
              minMm={300}
              maxMm={10000}
              onChangeMm={(mm) => updateWall({ heightMm: mm })}
            />
          </div>

          {/* Segment Fixed / Flexible Constraints */}
          <div className="border-t border-slate-200 dark:border-slate-800 pt-2 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-medium">Segments ({dimChain.segments.length})</span>
              <span>Click lock to fix</span>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto pr-0.5">
              {dimChain.segments.map((seg) => (
                <div
                  key={seg.key}
                  className="flex items-center justify-between px-2 py-1 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                >
                  <span className="truncate text-slate-700 dark:text-slate-300">
                    {seg.label}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono-nums text-[11px] text-slate-500">
                      {formatSmartMetric(seg.lengthMm)}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleSegmentLock(seg)}
                      title={seg.locked ? 'Fixed segment (click to make flexible)' : 'Flexible segment (click to lock)'}
                      className={`p-1 rounded cursor-pointer ${
                        seg.locked
                          ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                          : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      {seg.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              Wall Thickness Alignment
            </label>
            <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-100 dark:bg-slate-900 rounded-md">
              {(['center', 'inner', 'outer'] as WallAlignment[]).map((al) => (
                <button
                  key={al}
                  type="button"
                  onClick={() => updateWall({ alignment: al })}
                  className={`py-1 rounded text-[11px] font-medium capitalize cursor-pointer ${
                    wall.alignment === al
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {al}
                </button>
              ))}
            </div>
          </div>

          {/* Curved Wall */}
          <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-2">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-medium text-slate-700 dark:text-slate-300">Curved Wall (Arc)</span>
              <input
                type="checkbox"
                checked={wall.isCurved}
                onChange={(e) =>
                  updateWall(
                    { isCurved: e.target.checked, curveBulgeMm: e.target.checked ? wall.curveBulgeMm || 400 : 0 },
                    true
                  )
                }
                className="accent-blue-600"
              />
            </label>
            {wall.isCurved && (
              <MetricInput
                label="Arc Bulge"
                valueMm={wall.curveBulgeMm}
                unit="cm"
                minMm={-4000}
                maxMm={4000}
                onChangeMm={(mm) => updateWall({ curveBulgeMm: mm }, true)}
              />
            )}
          </div>

          {/* Paint Surface Estimation */}
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-2 space-y-1">
            <div className="font-medium text-slate-700 dark:text-slate-300">Paint & Finish Area</div>
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Arc Length</span>
              <span className="font-mono-nums">{formatSmartMetric(arcLenMm)}</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Net Face Area (minus openings)</span>
              <span className="font-mono-nums font-semibold text-slate-800 dark:text-slate-200">
                {surf.netAreaM2.toFixed(2)} m² / side
              </span>
            </div>
          </div>

          {/* Moldings */}
          <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-2">
            <label className="flex items-center justify-between cursor-pointer">
              <span>Baseboard / Skirting ({wall.baseboardHeightMm} mm)</span>
              <input
                type="checkbox"
                checked={wall.hasBaseboard}
                onChange={(e) => updateWall({ hasBaseboard: e.target.checked })}
                className="accent-blue-600"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span>Crown Molding ({wall.crownHeightMm} mm)</span>
              <input
                type="checkbox"
                checked={wall.hasCrownMolding}
                onChange={(e) => updateWall({ hasCrownMolding: e.target.checked })}
                className="accent-blue-600"
              />
            </label>
          </div>

          {(() => {
            const wallFaces = resolveWallFaces(wall, level.rooms);
            const renderFacePicker = (faceInfo: ResolvedWallFaceInfo, allowApplyAll: boolean) => {
              const isInnerSlot = faceInfo.slot === 'inner';
              const faceColor = isInnerSlot ? wall.innerColor : wall.outerColor;
              const faceMat = isInnerSlot ? wall.innerMaterial : wall.outerMaterial;
              const faceScale = isInnerSlot ? wall.innerTextureScale : wall.outerTextureScale;
              const faceRot = isInnerSlot ? wall.innerTextureRotDeg : wall.outerTextureRotDeg;
              const patchFace = (patch: Partial<Wall>) => updateWall(patch);
              const colorKey = isInnerSlot ? 'innerColor' : 'outerColor';
              const matKey = isInnerSlot ? 'innerMaterial' : 'outerMaterial';
              const scaleKey = isInnerSlot ? 'innerTextureScale' : 'outerTextureScale';
              const rotKey = isInnerSlot ? 'innerTextureRotDeg' : 'outerTextureRotDeg';

              return (
                <ColorMaterialPicker
                  key={`${faceInfo.id}_${faceInfo.physicalSide}`}
                  label={`${faceInfo.label} Face · ${faceInfo.subtitle}`}
                  color={faceColor}
                  material={faceMat}
                  textureScale={faceScale}
                  textureRotDeg={faceRot}
                  recentColors={recentColors}
                  onColorChange={(hex) => {
                    patchFace({ [colorKey]: hex } as Partial<Wall>);
                    onAddRecentColor(hex);
                  }}
                  onMaterialChange={(m) => patchFace({ [matKey]: m } as Partial<Wall>)}
                  onTextureScaleChange={(s) => patchFace({ [scaleKey]: s } as Partial<Wall>)}
                  onTextureRotChange={(r) => patchFace({ [rotKey]: r } as Partial<Wall>)}
                  onActivateEyedropper={() =>
                    onActivateEyedropper((hex) => patchFace({ [colorKey]: hex } as Partial<Wall>))
                  }
                  onApplyToSimilar={
                    allowApplyAll
                      ? () =>
                          onUpdateLevel((lvl) => ({
                            ...lvl,
                            walls: lvl.walls.map((w) => {
                              const targetSlot = resolveWallFaces(w, lvl.rooms).primary.slot;
                              return targetSlot === 'inner'
                                ? { ...w, innerColor: faceColor, innerMaterial: faceMat }
                                : { ...w, outerColor: faceColor, outerMaterial: faceMat };
                            }),
                          }))
                      : undefined
                  }
                  applySimilarLabel={allowApplyAll ? 'Apply to all walls' : undefined}
                />
              );
            };

            return (
              <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-700 dark:text-slate-300 truncate">
                      {wallFaces.kind === 'shared'
                        ? `Shared Wall: ${wallFaces.primary.label} ↔ ${wallFaces.secondary.label}`
                        : wallFaces.kind === 'single_room'
                          ? `Room Boundary · ${wallFaces.primary.roomName}`
                          : 'Partition Wall Faces'}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="flip-wall-face-btn"
                    onClick={() => updateWall(flipWallFace(wall), false, 'Flip Wall Face')}
                    title="Reverse wall face orientation and swap Inner/Outer surface materials without moving the wall"
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1 text-[11px] font-medium shrink-0 cursor-pointer"
                  >
                    <ArrowLeftRight className="w-3 h-3 text-blue-600" />
                    Flip Face
                  </button>
                </div>
                {renderFacePicker(wallFaces.primary, true)}
                {renderFacePicker(wallFaces.secondary, false)}
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  // ==================== ROOM INSPECTOR ====================
  if (primary.kind === 'room') {
    const room = level.rooms.find((r) => r.id === primary.id);
    if (!room) return null;
    const updateRoom = (patch: Partial<Room>, label = 'Edit Room', coalesceKey?: string) => {
      if (room.locked && !('locked' in patch)) return;
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          rooms: lvl.rooms.map((r) => (r.id === room.id ? { ...r, ...patch } : r)),
        }),
        false,
        true,
        label,
        coalesceKey
      );
    };

    return (
      <div className="p-3 space-y-3 text-xs overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Room</h3>
          <LockToggleButton
            locked={room.locked}
            onToggle={() => updateRoom({ locked: !room.locked }, room.locked ? 'Unlock Room' : 'Lock Room')}
            label="room"
          />
        </div>
        {room.locked && <LockedBanner />}
        <div
          aria-disabled={room.locked}
          className={room.locked ? 'space-y-3 opacity-50 pointer-events-none select-none' : 'space-y-3'}
        >
          <div>
            <label className="block text-[11px] text-slate-500 mb-0.5">Room Name</label>
            <input
              type="text"
              disabled={room.locked}
              value={room.name}
              onChange={(e) => updateRoom({ name: e.target.value }, 'Rename Room', `room_name_${room.id}`)}
              aria-label="Room Name"
              className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md disabled:opacity-60"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-2">
            <div>
              <div className="text-[11px] text-slate-500">Area</div>
              <div className="font-mono-nums font-semibold text-sm">{formatAreaM2(room.areaM2)}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Perimeter</div>
              <div className="font-mono-nums font-semibold text-sm">{room.perimeterM.toFixed(2)} m</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <MetricInput
              label="Floor Offset"
              valueMm={room.floorLevelMm}
              unit="mm"
              minMm={-1000}
              maxMm={2000}
              onChangeMm={(mm) => updateRoom({ floorLevelMm: mm })}
            />
            <MetricInput
              label="Ceiling Height"
              valueMm={room.ceilingHeightMm}
              unit="m"
              minMm={1800}
              maxMm={8000}
              onChangeMm={(mm) =>
                onUpdateLevel(
                  (lvl) => syncRoomCeilingHeight(lvl, room.id, mm),
                  false,
                  true,
                  'Change Room Ceiling Height'
                )
              }
            />
          </div>

          <label className="flex items-center justify-between cursor-pointer">
            <span>Show Room Ceiling in 3D</span>
            <input
              type="checkbox"
              checked={room.hasCeiling}
              onChange={(e) => updateRoom({ hasCeiling: e.target.checked })}
              className="accent-blue-600"
            />
          </label>

          <ColorMaterialPicker
            label="Floor Material & Pattern"
            color={room.floorColor}
            material={room.floorMaterial}
            textureScale={room.floorTextureScale}
            textureRotDeg={room.floorTextureRotDeg}
            recentColors={recentColors}
            onColorChange={(hex) => {
              updateRoom({ floorColor: hex });
              onAddRecentColor(hex);
            }}
            onMaterialChange={(m) => updateRoom({ floorMaterial: m })}
            onTextureScaleChange={(s) => updateRoom({ floorTextureScale: s })}
            onTextureRotChange={(r) => updateRoom({ floorTextureRotDeg: r })}
            onActivateEyedropper={() => onActivateEyedropper((hex) => updateRoom({ floorColor: hex }))}
            onApplyToSimilar={() =>
              onUpdateLevel((lvl) => ({
                ...lvl,
                rooms: lvl.rooms.map((r) => ({
                  ...r,
                  floorColor: room.floorColor,
                  floorMaterial: room.floorMaterial,
                })),
              }))
            }
            applySimilarLabel="Apply to all rooms"
          />

          <ColorMaterialPicker
            label="Ceiling Finish"
            color={room.ceilingColor}
            material={room.ceilingMaterial}
            recentColors={recentColors}
            onColorChange={(hex) => {
              updateRoom({ ceilingColor: hex });
              onAddRecentColor(hex);
            }}
            onMaterialChange={(m) => updateRoom({ ceilingMaterial: m })}
          />
        </div>
      </div>
    );
  }

  // ==================== OPENING INSPECTOR ====================
  if (primary.kind === 'opening') {
    const op = level.openings.find((o) => o.id === primary.id);
    if (!op) return null;
    const hostWall = level.walls.find((w) => w.id === op.wallId);
    const updateOp = (patch: Partial<Opening>, label?: string, coalesceKey?: string) => {
      if (op.locked && !('locked' in patch)) return;
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          openings: lvl.openings.map((o) => (o.id === op.id ? { ...o, ...patch } : o)),
        }),
        false,
        true,
        label ?? `Edit ${op.category}`,
        coalesceKey
      );
    };

    const handleOpeningWidthChange = (nextMm: number) => {
      if (op.locked) return;
      if (!hostWall) {
        updateOp({ widthMm: nextMm }, `Resize ${op.category}`);
        return;
      }
      const bounds = computeWallInnerBounds(hostWall, level.walls);
      const comps = getWallMountedComponents(hostWall, level.openings, level.archElements);
      const res = solveWallComponentResize(
        hostWall,
        comps,
        bounds,
        op.id,
        nextMm,
        op.resizeAnchor ?? 'center'
      );
      if (!res.ok) {
        reportConstraintError(res.error ?? 'Width exceeds available free wall length.');
        return;
      }
      applyWallComponentUpdates(hostWall, res.updates, `Resize ${op.category}`);
    };

    const subtypeOptions: Record<Opening['category'], Array<{ id: Opening['subtype']; label: string }>> = {
      door: [
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
      ],
      window: [
        { id: 'single', label: 'Single' },
        { id: 'double', label: 'Double' },
        { id: 'triple', label: 'Triple' },
        { id: 'euro_single', label: 'Euro Tilt & Turn (PVC)' },
        { id: 'euro_double', label: 'Euro Double (PVC)' },
        { id: 'euro_triple', label: 'Euro Panoramic 3 (PVC)' },
        { id: 'euro_terrace', label: 'Euro Terrace (PVC)' },
        { id: 'casement', label: 'Casement' },
        { id: 'awning', label: 'Awning' },
        { id: 'clerestory', label: 'Clerestory' },
        { id: 'fixed', label: 'Fixed Picture' },
        { id: 'sliding', label: 'Sliding' },
        { id: 'bay', label: 'Bay Window' },
        { id: 'corner', label: 'Corner' },
        { id: 'floor_to_ceiling', label: 'Floor-to-Ceiling' },
        { id: 'round', label: 'Round / Oriel' },
      ],
      arch: [
        { id: 'round_arch', label: 'Round Arch' },
        { id: 'pointed_arch', label: 'Pointed Arch' },
        { id: 'segmental_arch', label: 'Segmental Arch' },
        { id: 'plain_opening', label: 'Plain Wall Opening' },
        { id: 'frame_only', label: 'Cased Frame Only' },
        { id: 'passthrough', label: 'Serving Passthrough' },
      ],
    };

    return (
      <div className="p-3 space-y-3 text-xs overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm capitalize">{op.category}</h3>
          <div className="flex items-center gap-1">
            <LockToggleButton
              locked={op.locked}
              onToggle={() =>
                updateOp(
                  { locked: !op.locked },
                  op.locked ? `Unlock ${op.category}` : `Lock ${op.category}`
                )
              }
              label={op.category}
            />
            <button
              type="button"
              disabled={op.locked}
              onClick={onDeleteSelected}
              className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-35 rounded cursor-pointer"
              aria-label="Delete opening"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {op.locked && <LockedBanner />}
        {constraintError && (
          <ConstraintErrorBanner message={constraintError} onDismiss={() => setConstraintError(null)} />
        )}

        <div
          aria-disabled={op.locked}
          className={op.locked ? 'space-y-3 opacity-50 pointer-events-none select-none' : 'space-y-3'}
        >
          <div>
            <label className="block text-[11px] text-slate-500 mb-0.5">Type & Style</label>
            <select
              value={op.subtype}
              onChange={(e) => updateOp({ subtype: e.target.value as Opening['subtype'] })}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
            >
              {subtypeOptions[op.category].map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <ResizeAnchorSelector
            value={op.resizeAnchor ?? 'center'}
            onChange={(anchor) => updateOp({ resizeAnchor: anchor }, 'Set Resize Anchor')}
          />

          <div className="grid grid-cols-2 gap-2">
            <MetricInput
              label="Width"
              valueMm={op.widthMm}
              unit={unit}
              minMm={150}
              maxMm={6000}
              onChangeMm={handleOpeningWidthChange}
            />
            <MetricInput
              label="Height"
              valueMm={op.heightMm}
              unit={unit}
              minMm={300}
              maxMm={4500}
              onChangeMm={(mm) => updateOp({ heightMm: mm })}
            />
            <MetricInput
              label="Sill Height"
              valueMm={op.sillHeightMm}
              unit={unit}
              minMm={0}
              maxMm={2500}
              onChangeMm={(mm) => updateOp({ sillHeightMm: mm })}
            />
            <MetricInput
              label="Frame Thick"
              valueMm={op.frameThicknessMm}
              unit="mm"
              minMm={20}
              maxMm={200}
              onChangeMm={(mm) => updateOp({ frameThicknessMm: mm })}
            />
          </div>

          {op.category === 'door' && op.subtype !== 'doorframe' && (
            <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-2">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => updateOp({ swingSide: op.swingSide === 'left' ? 'right' : 'left' })}
                  className="py-1.5 px-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hinge: {op.swingSide === 'left' ? 'Left' : 'Right'}
                </button>
                <button
                  type="button"
                  onClick={() => updateOp({ swingDirection: op.swingDirection === 'in' ? 'out' : 'in' })}
                  className="py-1.5 px-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Swing: {op.swingDirection === 'in' ? 'Inward' : 'Outward'}
                </button>
              </div>
              <div>
                <label className="flex justify-between text-[11px] text-slate-500">
                  <span>Door Open Angle</span>
                  <span className="font-mono-nums">{op.openAngleDeg}°</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={90}
                  value={op.openAngleDeg}
                  onChange={(e) => updateOp({ openAngleDeg: Number(e.target.value) })}
                  className="w-full accent-blue-600"
                />
              </div>
            </div>
          )}

          <ColorMaterialPicker
            label="Frame Color"
            color={op.frameColor}
            recentColors={recentColors}
            onColorChange={(hex) => {
              updateOp({ frameColor: hex });
              onAddRecentColor(hex);
            }}
          />
          {op.category === 'door' && op.subtype !== 'doorframe' && (
            <ColorMaterialPicker
              label="Door Leaf Color"
              color={op.panelColor}
              recentColors={recentColors}
              onColorChange={(hex) => updateOp({ panelColor: hex })}
            />
          )}
          {op.category === 'window' && (
            <ColorMaterialPicker
              label="Glass Tint"
              color={op.glassColor}
              recentColors={recentColors}
              onColorChange={(hex) => updateOp({ glassColor: hex })}
            />
          )}
        </div>
      </div>
    );
  }

  // ==================== CURTAIN INSPECTOR ====================
  if (primary.kind === 'curtain') {
    const c = level.curtains.find((x) => x.id === primary.id);
    if (!c) return null;
    const updateCurtain = (patch: Partial<Curtain>, label = 'Edit Curtain', coalesceKey?: string) => {
      if (c.locked && !('locked' in patch)) return;
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          curtains: lvl.curtains.map((x) => (x.id === c.id ? { ...x, ...patch } : x)),
        }),
        false,
        true,
        label,
        coalesceKey
      );
    };

    return (
      <div className="p-3 space-y-3 text-xs overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm">Curtains & Shades</h3>
          <div className="flex items-center gap-1">
            <LockToggleButton
              locked={c.locked}
              onToggle={() =>
                updateCurtain({ locked: !c.locked }, c.locked ? 'Unlock Curtain' : 'Lock Curtain')
              }
              label="curtain"
            />
            <button
              type="button"
              disabled={c.locked}
              onClick={onDeleteSelected}
              className="p-1.5 text-red-600 disabled:opacity-35 rounded cursor-pointer"
              aria-label="Delete curtain"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {c.locked && <LockedBanner />}
        <div
          aria-disabled={c.locked}
          className={c.locked ? 'space-y-3 opacity-50 pointer-events-none select-none' : 'space-y-3'}
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Style</label>
              <select
                value={c.style}
                onChange={(e) => updateCurtain({ style: e.target.value as Curtain['style'] })}
                className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
              >
                <option value="curtains">Curtains</option>
                <option value="drapes">Full Drapes</option>
                <option value="blinds">Venetian Blinds</option>
                <option value="roller_shade">Roller Shade</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Track / Rod</label>
              <select
                value={c.rodType}
                onChange={(e) => updateCurtain({ rodType: e.target.value as Curtain['rodType'] })}
                className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
              >
                <option value="pole">Pole Rod</option>
                <option value="rail">Track Rail</option>
                <option value="concealed">Concealed Pelmet</option>
              </select>
            </div>
            <MetricInput label="Width" valueMm={c.widthMm} unit={unit} minMm={300} onChangeMm={(mm) => updateCurtain({ widthMm: mm })} />
            <MetricInput label="Height" valueMm={c.heightMm} unit={unit} minMm={300} onChangeMm={(mm) => updateCurtain({ heightMm: mm })} />
            <MetricInput label="Elevation" valueMm={c.elevationMm} unit={unit} minMm={0} onChangeMm={(mm) => updateCurtain({ elevationMm: mm })} />
            <NumberField label="Rotation" value={c.rotationDeg} unitLabel="°" onChange={(deg) => updateCurtain({ rotationDeg: deg })} />
          </div>

          <div>
            <label className="flex justify-between text-[11px] text-slate-500">
              <span>Open State</span>
              <span className="font-mono-nums">{c.openPercent}% open</span>
            </label>
            <input type="range" min={0} max={95} value={c.openPercent} onChange={(e) => updateCurtain({ openPercent: Number(e.target.value) })} className="w-full accent-blue-600" />
          </div>
          <div>
            <label className="flex justify-between text-[11px] text-slate-500">
              <span>Pleat Fullness</span>
              <span className="font-mono-nums">{c.fullness.toFixed(1)}x</span>
            </label>
            <input type="range" min={1} max={2.5} step={0.1} value={c.fullness} onChange={(e) => updateCurtain({ fullness: Number(e.target.value) })} className="w-full accent-blue-600" />
          </div>

          <ColorMaterialPicker
            label="Fabric Color"
            color={c.color}
            material={c.material}
            recentColors={recentColors}
            onColorChange={(hex) => updateCurtain({ color: hex })}
            onMaterialChange={(m) => updateCurtain({ material: m })}
          />
        </div>
      </div>
    );
  }

  // ==================== FURNITURE & MULTI-PART INSPECTOR ====================
  if (primary.kind === 'furniture') {
    const furn = level.furniture.find((f) => f.id === primary.id);
    if (!furn) return null;
    const bounds = computeFurnitureBoundsMm(furn.parts);
    const activePart = primary.partId
      ? furn.parts.find((p) => p.id === primary.partId)
      : undefined;

    const effMountingType: MountingType = resolveFurnitureMountingType(furn);
    const effMountingFace: MountingFace = resolveFurnitureMountingFace(furn);
    const attachedWall = furn.attachedWallId
      ? level.walls.find((w) => w.id === furn.attachedWallId)
      : undefined;
    const surfaceHost = furn.surfaceHostId
      ? level.furniture.find((f) => f.id === furn.surfaceHostId)
      : undefined;

    const updateFurn = (patch: Partial<FurnitureInstance>, label = 'Edit Furniture', coalesceKey?: string) => {
      if (furn.locked && !('locked' in patch)) return;
      onUpdateLevel(
        (lvl) => {
          const prevItem = lvl.furniture.find((f) => f.id === furn.id);
          if (!prevItem) return lvl;
          let nextItem: FurnitureInstance = { ...prevItem, ...patch };
          const manualPosChange =
            ('xMm' in patch && patch.xMm !== prevItem.xMm) ||
            ('yMm' in patch && patch.yMm !== prevItem.yMm);
          const manualRotChange =
            'rotationDeg' in patch &&
            Math.abs((((patch.rotationDeg ?? 0) - prevItem.rotationDeg + 540) % 360) - 180) > 4;
          if ((manualPosChange || manualRotChange) && !('attachedWallId' in patch) && prevItem.attachedWallId) {
            nextItem = {
              ...nextItem,
              attachedWallId: undefined,
              attachedFace: undefined,
              attachedT: undefined,
            };
          }
          if (
            nextItem.attachedWallId &&
            !manualPosChange &&
            !manualRotChange &&
            ('wallOffsetMm' in patch ||
              'parts' in patch ||
              'mirroredX' in patch ||
              'mirroredY' in patch ||
              'rotationXDeg' in patch ||
              'rotationYDeg' in patch)
          ) {
            const w = lvl.walls.find((wallItem) => wallItem.id === nextItem.attachedWallId);
            if (w) {
              const xf = computeAttachedWallFurnitureTransform(
                w,
                nextItem.attachedT ?? 0.5,
                nextItem.attachedFace ?? 'left',
                nextItem
              );
              nextItem = {
                ...nextItem,
                xMm: xf.xMm,
                yMm: xf.yMm,
                rotationDeg: xf.rotationDeg,
                attachedT: xf.attachedT,
              };
            }
          }
          if (nextItem.surfaceHostId && ('xMm' in patch || 'yMm' in patch || 'rotationDeg' in patch)) {
            const host = lvl.furniture.find((h) => h.id === nextItem.surfaceHostId);
            if (host) {
              const local = computeSurfaceLocalCoords(
                { x: nextItem.xMm, y: nextItem.yMm },
                nextItem.rotationDeg,
                host
              );
              nextItem = {
                ...nextItem,
                surfaceLocalXMm: Math.round(local.localXMm * 10) / 10,
                surfaceLocalYMm: Math.round(local.localYMm * 10) / 10,
                surfaceLocalRotDeg: Math.round(local.localRotDeg * 10) / 10,
              };
            }
          }
          let nextFurnList = lvl.furniture.map((f) => (f.id === furn.id ? nextItem : f));
          const transformChanged =
            nextItem.xMm !== prevItem.xMm ||
            nextItem.yMm !== prevItem.yMm ||
            nextItem.rotationDeg !== prevItem.rotationDeg ||
            nextItem.mirroredX !== prevItem.mirroredX ||
            nextItem.mirroredY !== prevItem.mirroredY ||
            nextItem.elevationMm !== prevItem.elevationMm ||
            nextItem.parts !== prevItem.parts;
          if (transformChanged) {
            nextFurnList = propagateParentFurnitureTransforms(nextFurnList, furn.id, prevItem, nextItem);
          }
          return { ...lvl, furniture: nextFurnList };
        },
        false,
        true,
        label,
        coalesceKey
      );
    };

    const updatePart = (partId: string, patch: Partial<FurniturePart>) => {
      updateFurn(
        {
          parts: furn.parts.map((p) => (p.id === partId ? { ...p, ...patch } : p)),
        },
        'Edit Furniture Part'
      );
    };

    const resizeOverall = (axis: 'w' | 'd' | 'h', nextMm: number) => {
      const clamped = Math.max(50, nextMm);
      let sx = 1;
      let sy = 1;
      let sz = 1;
      if (axis === 'w') {
        sx = clamped / bounds.widthMm;
        if (furn.lockProportions) {
          sy = sx;
          sz = sx;
        }
      } else if (axis === 'd') {
        sy = clamped / bounds.depthMm;
        if (furn.lockProportions) {
          sx = sy;
          sz = sy;
        }
      } else {
        sz = clamped / bounds.heightMm;
        if (furn.lockProportions) {
          sx = sz;
          sy = sz;
        }
      }
      updateFurn(
        {
          parts: scaleFurnitureParts(furn.parts, sx, sy, sz),
          ...(Array.isArray(furn.lights)
            ? { lights: scaleFurnitureLightSources(furn.lights, sx, sy, sz) }
            : {}),
        },
        'Resize Furniture'
      );
    };

    const generateArray = () => {
      if (furn.locked) return;
      const copies: FurnitureInstance[] = [];
      for (let r = 0; r < arrayRows; r++) {
        for (let c = 0; c < arrayCols; c++) {
          if (r === 0 && c === 0) continue;
          copies.push({
            ...furn,
            id: uid('furn'),
            xMm: furn.xMm + c * (bounds.widthMm + arrayGapMm),
            yMm: furn.yMm + r * (bounds.depthMm + arrayGapMm),
            parts: furn.parts.map((p) => ({ ...p, id: uid('part') })),
            lights: cloneLightsWithFreshIds(furn.lights),
            glbEmissiveOverrides: furn.glbEmissiveOverrides
              ? furn.glbEmissiveOverrides.map((ov) => ({
                  ...ov,
                  meshNames: [...ov.meshNames],
                }))
              : undefined,
            representation: furn.representation
              ? JSON.parse(JSON.stringify(furn.representation))
              : undefined,
          });
        }
      }
      if (copies.length > 0) {
        onUpdateLevel(
          (lvl) => ({ ...lvl, furniture: [...lvl.furniture, ...copies] }),
          false,
          true,
          'Generate Furniture Array'
        );
      }
    };

    return (
      <div className="p-3 space-y-3 text-xs overflow-y-auto">
        <div className="flex items-center justify-between gap-1.5">
          <input
            type="text"
            disabled={furn.locked}
            value={furn.name}
            onChange={(e) => updateFurn({ name: e.target.value }, 'Rename Furniture', `furn_name_${furn.id}`)}
            aria-label="Furniture name"
            className="flex-1 min-w-0 font-semibold text-sm bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none text-slate-900 dark:text-slate-100 disabled:opacity-60"
          />
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={onDuplicateSelected} title="Duplicate" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" aria-label="Duplicate furniture">
              <Copy className="w-3.5 h-3.5" />
            </button>
            <LockToggleButton
              locked={furn.locked}
              onToggle={() =>
                updateFurn({ locked: !furn.locked }, furn.locked ? 'Unlock Furniture' : 'Lock Furniture')
              }
              label="furniture"
            />
            <button
              type="button"
              disabled={furn.locked}
              onClick={onDeleteSelected}
              className="p-1.5 text-red-600 rounded hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-35 cursor-pointer"
              aria-label="Delete furniture"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {furn.locked && <LockedBanner />}

        <div
          aria-disabled={furn.locked}
          className={furn.locked ? 'space-y-3 opacity-50 pointer-events-none select-none' : 'space-y-3'}
        >
          {/* Overall Dimensions + Lock Proportions */}
          {isFixedSizeFurniture(furn) ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500">Fixed Real-World Dimensions</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                  Predefined Size
                </span>
              </div>
              <div className="px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono-nums text-[11px] text-slate-600 dark:text-slate-300">
                {formatSmartMetric(bounds.widthMm, unit)} × {formatSmartMetric(bounds.depthMm, unit)} × {formatSmartMetric(bounds.heightMm, unit)}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500">Overall Dimensions</span>
                <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={furn.lockProportions}
                    onChange={(e) => updateFurn({ lockProportions: e.target.checked })}
                    className="accent-blue-600"
                  />
                  Lock proportions
                </label>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <MetricInput label="Width" valueMm={bounds.widthMm} unit={unit} minMm={50} onChangeMm={(mm) => resizeOverall('w', mm)} />
                <MetricInput label="Depth" valueMm={bounds.depthMm} unit={unit} minMm={50} onChangeMm={(mm) => resizeOverall('d', mm)} />
                <MetricInput label="Height" valueMm={bounds.heightMm} unit={unit} minMm={20} onChangeMm={(mm) => resizeOverall('h', mm)} />
              </div>
            </div>
          )}

          {/* Transform & Mirror */}
          <div className="grid grid-cols-3 gap-1.5">
            <MetricInput label="Pos X" valueMm={furn.xMm} unit={unit} minMm={-50000} onChangeMm={(mm) => updateFurn({ xMm: mm })} />
            <MetricInput label="Pos Y" valueMm={furn.yMm} unit={unit} minMm={-50000} onChangeMm={(mm) => updateFurn({ yMm: mm })} />
            <MetricInput label="Elevation" valueMm={furn.elevationMm} unit={unit} minMm={0} onChangeMm={(mm) => updateFurn({ elevationMm: mm })} />
          </div>
          <div className="grid grid-cols-3 gap-1.5 items-end">
            <NumberField label="Rotation Z" value={furn.rotationDeg} unitLabel="°" onChange={(deg) => updateFurn({ rotationDeg: deg })} />
            <button
              type="button"
              onClick={() => updateFurn({ mirroredX: !furn.mirroredX })}
              className={`py-1.5 px-2 border rounded flex items-center justify-center gap-1 cursor-pointer ${
                furn.mirroredX ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              Mirror X
            </button>
            <button
              type="button"
              onClick={() => updateFurn({ mirroredY: !furn.mirroredY })}
              className={`py-1.5 px-2 border rounded flex items-center justify-center gap-1 cursor-pointer ${
                furn.mirroredY ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <FlipVertical className="w-3.5 h-3.5" />
              Mirror Y
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5 items-end">
            <NumberField
              label="Tilt X"
              value={furn.rotationXDeg ?? 0}
              min={-180}
              max={180}
              step={5}
              unitLabel="°"
              onChange={(deg) => updateFurn({ rotationXDeg: deg })}
            />
            <NumberField
              label="Roll Y"
              value={furn.rotationYDeg ?? 0}
              min={-180}
              max={180}
              step={5}
              unitLabel="°"
              onChange={(deg) => updateFurn({ rotationYDeg: deg })}
            />
            <button
              type="button"
              disabled={!(furn.rotationXDeg || furn.rotationYDeg)}
              onClick={() => updateFurn({ rotationXDeg: 0, rotationYDeg: 0 }, 'Reset 3D Tilt')}
              title="Reset X & Y 3D tilt angles back to level"
              className="py-1.5 px-2 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
            >
              Reset Tilt
            </button>
          </div>

          {/* 2D Stacking Layer Order (2D floorplan only) */}
          <div className="space-y-1 border-t border-slate-200 dark:border-slate-800 pt-2">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-medium">2D Layer Order</span>
              <span className="font-mono-nums text-[10px]">
                z = {furn.zOrder ?? 0}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() =>
                  onUpdateLevel(
                    (lvl) => ({ ...lvl, furniture: reorderFurnitureZOrder(lvl.furniture, [furn.id], 'forward') }),
                    false,
                    true,
                    'Bring Furniture Forward'
                  )
                }
                title="Bring Forward one step in 2D"
                className="py-1 px-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 cursor-pointer"
              >
                <ArrowUp className="w-3 h-3" />
                <span>Fwd</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateLevel(
                    (lvl) => ({ ...lvl, furniture: reorderFurnitureZOrder(lvl.furniture, [furn.id], 'backward') }),
                    false,
                    true,
                    'Send Furniture Backward'
                  )
                }
                title="Send Backward one step in 2D"
                className="py-1 px-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 cursor-pointer"
              >
                <ArrowDown className="w-3 h-3" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateLevel(
                    (lvl) => ({ ...lvl, furniture: reorderFurnitureZOrder(lvl.furniture, [furn.id], 'front') }),
                    false,
                    true,
                    'Bring Furniture to Front'
                  )
                }
                title="Bring to Top in 2D"
                className="py-1 px-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 cursor-pointer"
              >
                <ChevronsUp className="w-3 h-3" />
                <span>Front</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateLevel(
                    (lvl) => ({ ...lvl, furniture: reorderFurnitureZOrder(lvl.furniture, [furn.id], 'back') }),
                    false,
                    true,
                    'Send Furniture to Back'
                  )
                }
                title="Send to Bottom in 2D"
                className="py-1 px-1.5 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 cursor-pointer"
              >
                <ChevronsDown className="w-3 h-3" />
                <span>Bottom</span>
              </button>
            </div>
          </div>

          {/* MOUNTING & SURFACE ATTACHMENT */}
          {(() => {
            const isGlbModel = Boolean(furn.glbAssetId || furn.glbDataUrl);
            const roomCeilingMm = getEnclosingRoomCeilingMm(
              { x: furn.xMm, y: furn.yMm },
              level.rooms,
              level.ceilingHeightMm
            );

            const applyGlbReorientationIfNeeded = async (
              updatedSnapshot: FurnitureInstance
            ) => {
              if (!isGlbModel) return;
              setRepBusy(true);
              try {
                const nextRep = await computeFurnitureRepresentationAsync(updatedSnapshot, {
                  mode: resolveEffectiveRepresentationMode(updatedSnapshot),
                  useMaterialFill: Boolean(updatedSnapshot.representation?.useMaterialFill),
                  preserveCustomViews: true,
                });
                updateFurn({ representation: nextRep }, 'Refresh 2D Projection');
              } finally {
                setRepBusy(false);
              }
            };

            const handleMountingTypeChange = (nextType: MountingType) => {
              if (nextType === effMountingType) return;
              const nextFace =
                nextType === 'wall' || nextType === 'ceiling'
                  ? defaultMountingFaceForType(nextType)
                  : effMountingType === 'floor' ||
                      effMountingType === 'freestanding' ||
                      effMountingType === 'surface'
                    ? effMountingFace
                    : 'bottom';

              let nextParts = furn.parts;
              if (isGlbModel && (nextFace !== effMountingFace || nextType !== effMountingType)) {
                const nextDims = transformBoundsBetweenMountings(
                  bounds,
                  effMountingType,
                  effMountingFace,
                  nextType,
                  nextFace
                );
                nextParts = scaleFurnitureParts(
                  furn.parts,
                  nextDims.widthMm / Math.max(10, bounds.widthMm),
                  nextDims.depthMm / Math.max(10, bounds.depthMm),
                  nextDims.heightMm / Math.max(10, bounds.heightMm)
                );
              }

              const patch: Partial<FurnitureInstance> = {
                mountingType: nextType,
                mountingFace: nextFace,
                parts: nextParts,
              };

              if (nextType === 'wall') {
                patch.surfaceHostId = undefined;
                patch.surfaceLocalXMm = undefined;
                patch.surfaceLocalYMm = undefined;
                patch.surfaceLocalRotDeg = undefined;
                const nearest = findNearestWallAttachmentTarget(
                  { x: furn.xMm, y: furn.yMm },
                  { ...furn, parts: nextParts },
                  level.walls
                );
                if (nearest) {
                  patch.xMm = nearest.xMm;
                  patch.yMm = nearest.yMm;
                  patch.rotationDeg = nearest.rotationDeg;
                  patch.attachedWallId = nearest.wall.id;
                  patch.attachedFace = nearest.face;
                  patch.attachedT = nearest.t;
                }
              } else if (nextType === 'ceiling') {
                patch.attachedWallId = undefined;
                patch.attachedFace = undefined;
                patch.attachedT = undefined;
                patch.surfaceHostId = undefined;
                patch.surfaceLocalXMm = undefined;
                patch.surfaceLocalYMm = undefined;
                patch.surfaceLocalRotDeg = undefined;
                patch.elevationMm = getCeilingFixtureOffsetMm(
                  { ...furn, parts: nextParts, mountingType: 'ceiling', elevationMm: 0 },
                  roomCeilingMm
                );
              } else if (nextType === 'surface') {
                patch.attachedWallId = undefined;
                patch.attachedFace = undefined;
                patch.attachedT = undefined;
                const hit = findSupportingSurfaceForProp(
                  { x: furn.xMm, y: furn.yMm },
                  { ...furn, parts: nextParts, mountingType: 'surface' },
                  level.furniture
                );
                if (hit) {
                  const local = computeSurfaceLocalCoords(
                    { x: furn.xMm, y: furn.yMm },
                    furn.rotationDeg,
                    hit.host
                  );
                  patch.surfaceHostId = hit.host.id;
                  patch.surfaceLocalXMm = Math.round(local.localXMm * 10) / 10;
                  patch.surfaceLocalYMm = Math.round(local.localYMm * 10) / 10;
                  patch.surfaceLocalRotDeg = Math.round(local.localRotDeg * 10) / 10;
                  patch.elevationMm = hit.deckHeightMm;
                } else {
                  patch.surfaceHostId = undefined;
                  patch.surfaceLocalXMm = undefined;
                  patch.surfaceLocalYMm = undefined;
                  patch.surfaceLocalRotDeg = undefined;
                  if (effMountingType === 'ceiling') {
                    patch.elevationMm = 0;
                  }
                }
              } else {
                // floor or freestanding
                patch.attachedWallId = undefined;
                patch.attachedFace = undefined;
                patch.attachedT = undefined;
                patch.surfaceHostId = undefined;
                patch.surfaceLocalXMm = undefined;
                patch.surfaceLocalYMm = undefined;
                patch.surfaceLocalRotDeg = undefined;
                patch.elevationMm = 0;
              }

              updateFurn(patch, `Mount as ${MOUNTING_TYPE_LABELS[nextType]}`);
              if (isGlbModel && (nextFace !== effMountingFace || nextType !== effMountingType)) {
                void applyGlbReorientationIfNeeded({ ...furn, ...patch });
              }
            };

            const handleMountingFaceChange = (nextFace: MountingFace) => {
              if (nextFace === effMountingFace) return;
              let nextParts = furn.parts;
              if (isGlbModel) {
                const nextDims = transformBoundsBetweenMountings(
                  bounds,
                  effMountingType,
                  effMountingFace,
                  effMountingType,
                  nextFace
                );
                nextParts = scaleFurnitureParts(
                  furn.parts,
                  nextDims.widthMm / Math.max(10, bounds.widthMm),
                  nextDims.depthMm / Math.max(10, bounds.depthMm),
                  nextDims.heightMm / Math.max(10, bounds.heightMm)
                );
              }
              const patch: Partial<FurnitureInstance> = {
                mountingType: effMountingType,
                mountingFace: nextFace,
                parts: nextParts,
              };
              if (attachedWall) {
                const xf = computeAttachedWallFurnitureTransform(
                  attachedWall,
                  furn.attachedT ?? 0.5,
                  furn.attachedFace ?? 'left',
                  { ...furn, parts: nextParts }
                );
                patch.xMm = xf.xMm;
                patch.yMm = xf.yMm;
                patch.rotationDeg = xf.rotationDeg;
                patch.attachedT = xf.attachedT;
              }
              updateFurn(patch, `Orient ${MOUNTING_FACE_LABELS[nextFace]}`);
              if (isGlbModel) {
                void applyGlbReorientationIfNeeded({ ...furn, ...patch });
              }
            };

            const statusText =
              effMountingType === 'wall'
                ? attachedWall
                  ? `Wall (${furn.attachedFace === 'right' ? 'Opposite' : 'Primary'} face)`
                  : 'Wall (Not snapped)'
                : effMountingType === 'ceiling'
                  ? `Ceiling underside (${formatSmartMetric(roomCeilingMm, unit)})`
                  : effMountingType === 'surface'
                    ? surfaceHost
                      ? `On "${surfaceHost.name}"`
                      : 'Surface (No host below)'
                    : MOUNTING_TYPE_LABELS[effMountingType];

            return (
              <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Mounting & Attachment
                  </span>
                  <span className="text-[10px] font-mono-nums text-slate-500 truncate max-w-[165px]" title={statusText}>
                    {statusText}
                  </span>
                </div>

                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Mounting Type</div>
                  <div className="grid grid-cols-5 gap-1">
                    {ALL_MOUNTING_TYPES.map((mt) => (
                      <button
                        key={mt}
                        type="button"
                        onClick={() => handleMountingTypeChange(mt)}
                        className={`py-1 px-1 rounded border text-[10px] font-medium transition-colors cursor-pointer ${
                          effMountingType === mt
                            ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {mt === 'freestanding' ? 'Free' : MOUNTING_TYPE_LABELS[mt]}
                      </button>
                    ))}
                  </div>
                </div>

                {(isGlbModel || effMountingType === 'wall' || effMountingType === 'ceiling') && (
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                      <span>Model Mounting Face</span>
                      <span className="text-[10px] font-mono-nums text-slate-400">
                        {MOUNTING_FACE_LABELS[effMountingFace]}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {ALL_MOUNTING_FACES.map((face) => (
                        <button
                          key={face}
                          type="button"
                          onClick={() => handleMountingFaceChange(face)}
                          className={`py-1 px-1.5 rounded border text-[10px] font-medium capitalize transition-colors cursor-pointer ${
                            effMountingFace === face
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {face}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {attachedWall && (
                  <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="grid grid-cols-2 gap-1.5 items-end">
                      <MetricInput
                        label="Wall Offset"
                        valueMm={furn.wallOffsetMm ?? 0}
                        unit={unit}
                        minMm={-200}
                        maxMm={500}
                        onChangeMm={(mm) => updateFurn({ wallOffsetMm: mm }, 'Edit Wall Offset')}
                      />
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const nextFace = furn.attachedFace === 'right' ? 'left' : 'right';
                            const xf = computeAttachedWallFurnitureTransform(
                              attachedWall,
                              furn.attachedT ?? 0.5,
                              nextFace,
                              furn
                            );
                            updateFurn(
                              {
                                attachedFace: nextFace,
                                xMm: xf.xMm,
                                yMm: xf.yMm,
                                rotationDeg: xf.rotationDeg,
                                attachedT: xf.attachedT,
                              },
                              'Flip Wall Mounting Side'
                            );
                          }}
                          className="flex-1 py-1.5 px-1.5 rounded border border-slate-200 dark:border-slate-700 text-[10px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          Flip Side
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateFurn(
                              {
                                attachedWallId: undefined,
                                attachedFace: undefined,
                                attachedT: undefined,
                              },
                              'Detach from Wall'
                            )
                          }
                          className="py-1.5 px-2 rounded border border-slate-200 dark:border-slate-700 text-[10px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                        >
                          Detach
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {effMountingType === 'wall' && !attachedWall && level.walls.some((w) => w.visible !== false) && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = findNearestWallAttachmentTarget(
                        { x: furn.xMm, y: furn.yMm },
                        furn,
                        level.walls
                      );
                      if (target) {
                        updateFurn(
                          {
                            attachedWallId: target.wall.id,
                            attachedFace: target.face,
                            attachedT: target.t,
                            xMm: target.xMm,
                            yMm: target.yMm,
                            rotationDeg: target.rotationDeg,
                          },
                          'Snap to Nearest Wall'
                        );
                      }
                    }}
                    className="w-full py-1.5 px-2 rounded border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-[11px] font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 cursor-pointer"
                  >
                    Snap Flush to Nearest Wall
                  </button>
                )}

                {furn.surfaceHostId && (
                  <button
                    type="button"
                    onClick={() =>
                      updateFurn(
                        {
                          surfaceHostId: undefined,
                          surfaceLocalXMm: undefined,
                          surfaceLocalYMm: undefined,
                          surfaceLocalRotDeg: undefined,
                          elevationMm: 0,
                        },
                        'Detach from Surface'
                      )
                    }
                    className="w-full py-1.5 px-2 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                  >
                    Detach from "{surfaceHost?.name ?? 'Surface'}"
                  </button>
                )}

                {effMountingType === 'surface' && !furn.surfaceHostId && (
                  <button
                    type="button"
                    onClick={() => {
                      const hit = findSupportingSurfaceForProp(
                        { x: furn.xMm, y: furn.yMm },
                        furn,
                        level.furniture
                      );
                      if (hit) {
                        const local = computeSurfaceLocalCoords(
                          { x: furn.xMm, y: furn.yMm },
                          furn.rotationDeg,
                          hit.host
                        );
                        updateFurn(
                          {
                            surfaceHostId: hit.host.id,
                            surfaceLocalXMm: Math.round(local.localXMm * 10) / 10,
                            surfaceLocalYMm: Math.round(local.localYMm * 10) / 10,
                            surfaceLocalRotDeg: Math.round(local.localRotDeg * 10) / 10,
                            elevationMm: hit.deckHeightMm,
                          },
                          `Attach to ${hit.host.name}`
                        );
                      } else {
                        reportConstraintError('Drag over a desk, table, or countertop to attach.');
                      }
                    }}
                    className="w-full py-1.5 px-2 rounded border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-[11px] font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 cursor-pointer"
                  >
                    Attach to Surface Beneath
                  </button>
                )}
              </div>
            );
          })()}

          {/* 2D ARCHITECTURAL SVG REPRESENTATION */}
          {(() => {
            const canDefault = hasValidDefaultSvg(furn);
            const repMode: RepresentationMode = resolveEffectiveRepresentationMode(furn);
            const useFill = Boolean(furn.representation?.useMaterialFill);
            const customViewNames = (['top', 'front', 'rear', 'left', 'right'] as ProjectionViewId[])
              .filter((v) => Array.isArray(furn.representation?.customViews?.[v]))
              .map((v) => v.charAt(0).toUpperCase() + v.slice(1));
            const hasCustom = hasAnyCustomViews(furn.representation);

            const handleRepModeChange = async (nextMode: RepresentationMode) => {
              if (nextMode === repMode || repBusy) return;
              if (nextMode === 'default' && !canDefault) return;
              setRepBusy(true);
              try {
                const nextRep = await computeFurnitureRepresentationAsync(furn, {
                  mode: nextMode,
                  useMaterialFill: useFill,
                  preserveCustomViews: true,
                });
                updateFurn({ representation: nextRep }, `Switch 2D Mode (${nextMode})`);
              } finally {
                setRepBusy(false);
              }
            };

            const handleMaterialFillToggle = (checked: boolean) => {
              if (furn.representation) {
                updateFurn(
                  { representation: { ...furn.representation, useMaterialFill: checked } },
                  checked ? 'Enable 2D Material Fill' : 'Use Black-on-White 2D Style'
                );
              } else {
                setRepBusy(true);
                void computeFurnitureRepresentationAsync(furn, {
                  mode: repMode,
                  useMaterialFill: checked,
                  preserveCustomViews: true,
                })
                  .then((nextRep) => {
                    updateFurn({ representation: nextRep }, 'Update 2D Style');
                  })
                  .finally(() => setRepBusy(false));
              }
            };

            const executeRegenerate = async (discardCustom: boolean) => {
              setConfirmRegenFurnId(null);
              setRepBusy(true);
              try {
                if (repMode === 'default' && !discardCustom) {
                  const fallbackAuto = await computeFurnitureRepresentationAsync(furn, {
                    mode: 'silhouette',
                    useMaterialFill: useFill,
                    preserveCustomViews: true,
                  });
                  updateFurn(
                    {
                      representation: {
                        ...fallbackAuto,
                        mode: 'default',
                      },
                    },
                    'Refresh Fallback 3D Projections'
                  );
                } else {
                  const nextRep = await computeFurnitureRepresentationAsync(furn, {
                    mode: repMode,
                    useMaterialFill: useFill,
                    preserveCustomViews: !discardCustom,
                  });
                  updateFurn(
                    { representation: nextRep },
                    discardCustom
                      ? repMode === 'default'
                        ? 'Restore Original Default 2D Drawing'
                        : 'Reset 2D Drawing to Auto 3D'
                      : 'Regenerate Auto 2D SVG'
                  );
                }
              } finally {
                setRepBusy(false);
              }
            };

            const modeLabel =
              repMode === 'default'
                ? 'Default'
                : repMode === 'hidden_line'
                  ? 'Hidden-Line'
                  : 'Silhouette';

            return (
              <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <PenTool className="w-3.5 h-3.5 text-blue-600" />
                    2D Representation
                  </span>
                  <span className="text-[11px] text-slate-500 truncate">
                    {modeLabel} ·{' '}
                    {hasCustom
                      ? `Custom (${customViewNames.join(', ')})`
                      : repMode === 'default'
                        ? 'Original SVG'
                        : 'Auto 3D'}
                  </span>
                </div>

                <div
                  className={`grid ${canDefault ? 'grid-cols-3' : 'grid-cols-2'} gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-slate-800`}
                >
                  {canDefault && (
                    <button
                      type="button"
                      data-testid="rep-mode-default"
                      disabled={repBusy}
                      onClick={() => void handleRepModeChange('default')}
                      className={`py-1 px-2 rounded text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                        repMode === 'default'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Default
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="rep-mode-silhouette"
                    disabled={repBusy}
                    onClick={() => void handleRepModeChange('silhouette')}
                    className={`py-1 px-2 rounded text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                      repMode === 'silhouette'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Silhouette
                  </button>
                  <button
                    type="button"
                    data-testid="rep-mode-hidden-line"
                    disabled={repBusy}
                    onClick={() => void handleRepModeChange('hidden_line')}
                    className={`py-1 px-2 rounded text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                      repMode === 'hidden_line'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Hidden-Line
                  </button>
                </div>

                <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useFill}
                    onChange={(e) => handleMaterialFillToggle(e.target.checked)}
                    className="accent-blue-600"
                  />
                  <span>Material fill in 2D views (optional)</span>
                </label>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenSvgEditor?.(furn.id)}
                    className="py-1.5 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <PenTool className="w-3 h-3" />
                    <span>Edit 2D Drawing</span>
                  </button>
                  <button
                    type="button"
                    disabled={repBusy}
                    onClick={() => {
                      if (hasCustom) {
                        setConfirmRegenFurnId(furn.id);
                      } else {
                        void executeRegenerate(false);
                      }
                    }}
                    className="py-1.5 px-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded font-medium flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{repBusy ? 'Updating...' : hasCustom && repMode === 'default' ? 'Restore Default' : 'Regenerate'}</span>
                  </button>
                </div>

                {confirmRegenFurnId === furn.id && (
                  <div className="p-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 space-y-1.5">
                    <p className="text-[11px] text-amber-900 dark:text-amber-200 leading-snug">
                      {repMode === 'default'
                        ? `This item has custom 2D SVG edits (${customViewNames.join(', ')}). Discard them and restore the original default drawing?`
                        : `This item has custom 2D SVG edits (${customViewNames.join(', ')}). Overwrite them with auto-generated 3D projections?`}
                    </p>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmRegenFurnId(null)}
                        className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] cursor-pointer"
                      >
                        Keep Custom
                      </button>
                      <button
                        type="button"
                        onClick={() => void executeRegenerate(true)}
                        className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-medium cursor-pointer"
                      >
                        Overwrite
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ADVANCED MULTI-LIGHT & EMISSIVE GLOW PANEL (All furniture & GLB models) */}
          <FurnitureLightingPanel
            furn={furn}
            settings={settings}
            onUpdateFurn={updateFurn}
          />

        {/* MULTI-PART COMPONENT TREE & INDEPENDENT PART EDITOR (Hidden for fixed-size decor/small appliances) */}
        {isFixedSizeFurniture(furn) ? (
          furn.parts.length > 0 && (
            <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 space-y-2">
              <ColorMaterialPicker
                label="Object Finish"
                color={furn.parts[0].color}
                material={furn.parts[0].material}
                recentColors={recentColors}
                onColorChange={(hex) => {
                  updateFurn({
                    parts: furn.parts.map((p, idx) => (idx === 0 ? { ...p, color: hex } : p)),
                  });
                  onAddRecentColor(hex);
                }}
                onMaterialChange={(m) =>
                  updateFurn({
                    parts: furn.parts.map((p, idx) => (idx === 0 ? { ...p, material: m } : p)),
                  })
                }
                onActivateEyedropper={() =>
                  onActivateEyedropper((hex) =>
                    updateFurn({
                      parts: furn.parts.map((p, idx) => (idx === 0 ? { ...p, color: hex } : p)),
                    })
                  )
                }
              />
            </div>
          )
        ) : (
          <>
            <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  Parts ({furn.parts.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const newPart: FurniturePart = {
                      id: uid('part'),
                      name: `Custom Part ${furn.parts.length + 1}`,
                      shape: 'box',
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
                    updateFurn({ parts: [...furn.parts, newPart] });
                    onSelect([{ kind: 'furniture', id: furn.id, partId: newPart.id }]);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add part
                </button>
              </div>

              <p className="text-[11px] text-slate-500">
                Click any part below (or click it directly on the 2D/3D canvas) to edit its size, position, and color independently.
              </p>

              <div className="max-h-40 overflow-y-auto space-y-1 pr-0.5">
                {furn.parts.map((part) => {
                  const isSel = activePart?.id === part.id;
                  return (
                    <button
                      key={part.id}
                      type="button"
                      onClick={() =>
                        onSelect([{ kind: 'furniture', id: furn.id, partId: isSel ? undefined : part.id }])
                      }
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-left transition-colors cursor-pointer ${
                        isSel
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-sm border border-black/20 shrink-0"
                          style={{ backgroundColor: part.color }}
                        />
                        <span className="truncate font-medium">{part.name}</span>
                      </span>
                      <span className={`font-mono-nums text-[10px] shrink-0 ml-2 ${isSel ? 'text-blue-100' : 'text-slate-400'}`}>
                        {Math.round(part.widthMm / 10)}×{Math.round(part.depthMm / 10)}×{Math.round(part.heightMm / 10)} cm
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SELECTED PART EDITOR */}
            {activePart && (
              <div className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-md p-2.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={activePart.name}
                    onChange={(e) => updatePart(activePart.id, { name: e.target.value })}
                    aria-label="Part name"
                    className="flex-1 min-w-0 font-semibold text-xs bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 rounded px-2 py-1"
                  />
                  {furn.parts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        updateFurn({ parts: furn.parts.filter((p) => p.id !== activePart.id) });
                        onSelect([{ kind: 'furniture', id: furn.id }]);
                      }}
                      aria-label="Delete part"
                      className="p-1 text-red-600 hover:bg-red-100 rounded cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">Part Geometry</label>
                  <select
                    value={activePart.shape}
                    onChange={(e) => updatePart(activePart.id, { shape: e.target.value as PartShape })}
                    className="w-full px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
                  >
                    <option value="box">Box / Panel</option>
                    <option value="rounded_rect">Rounded Box</option>
                    <option value="oval">Oval / Ellipse</option>
                    <option value="cylinder">Cylinder / Round</option>
                    <option value="sphere">Sphere / Dome</option>
                    <option value="wedge">Wedge / Ramp</option>
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <MetricInput
                    label="Part Length"
                    valueMm={activePart.widthMm}
                    unit={unit}
                    minMm={10}
                    onChangeMm={(mm) => updatePart(activePart.id, { widthMm: mm })}
                  />
                  <MetricInput
                    label="Part Depth"
                    valueMm={activePart.depthMm}
                    unit={unit}
                    minMm={10}
                    onChangeMm={(mm) => updatePart(activePart.id, { depthMm: mm })}
                  />
                  <MetricInput
                    label="Part Height"
                    valueMm={activePart.heightMm}
                    unit={unit}
                    minMm={5}
                    onChangeMm={(mm) => updatePart(activePart.id, { heightMm: mm })}
                  />
                  <MetricInput
                    label="Offset X"
                    valueMm={activePart.xMm}
                    unit={unit}
                    minMm={-5000}
                    onChangeMm={(mm) => updatePart(activePart.id, { xMm: mm })}
                  />
                  <MetricInput
                    label="Offset Y"
                    valueMm={activePart.yMm}
                    unit={unit}
                    minMm={-5000}
                    onChangeMm={(mm) => updatePart(activePart.id, { yMm: mm })}
                  />
                  <MetricInput
                    label="Base Z"
                    valueMm={activePart.zMm}
                    unit={unit}
                    minMm={0}
                    onChangeMm={(mm) => updatePart(activePart.id, { zMm: mm })}
                  />
                </div>

                <ColorMaterialPicker
                  label={`Part Finish · ${activePart.name}`}
                  color={activePart.color}
                  material={activePart.material}
                  recentColors={recentColors}
                  onColorChange={(hex) => {
                    updatePart(activePart.id, { color: hex });
                    onAddRecentColor(hex);
                  }}
                  onMaterialChange={(m) => updatePart(activePart.id, { material: m })}
                  onActivateEyedropper={() =>
                    onActivateEyedropper((hex) => updatePart(activePart.id, { color: hex }))
                  }
                  onApplyToSimilar={() =>
                    updateFurn({
                      parts: furn.parts.map((p) => ({
                        ...p,
                        color: activePart.color,
                        material: activePart.material,
                      })),
                    })
                  }
                  applySimilarLabel="Apply to all parts"
                />
              </div>
            )}
          </>
        )}

        {/* Array / Repeat + Save to My Library */}
        <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 space-y-2">
          <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
            <Grid2x2 className="w-3.5 h-3.5" />
            Array / Repeat Grid
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <NumberField label="Cols" value={arrayCols} unitLabel="x" min={1} max={10} onChange={setArrayCols} />
            <NumberField label="Rows" value={arrayRows} unitLabel="y" min={1} max={10} onChange={setArrayRows} />
            <MetricInput label="Gap" valueMm={arrayGapMm} unit="cm" minMm={0} onChangeMm={setArrayGapMm} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={generateArray}
              className="py-1.5 px-2 border border-slate-200 dark:border-slate-700 rounded font-medium hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Generate Array
            </button>
            <button
              type="button"
              onClick={() => {
                const clonedRep = furn.representation
                  ? (JSON.parse(JSON.stringify(furn.representation)) as NonNullable<
                      FurnitureInstance['representation']
                    >)
                  : undefined;
                const builtinTop =
                  !furn.svgSource && !clonedRep?.defaultViews?.top && isBuiltinCatalogItem(furn)
                    ? generateDefaultTopViewFromParts(furn.parts)
                    : null;
                const nextRep = builtinTop
                  ? {
                      ...(clonedRep ?? { mode: 'default' as const }),
                      defaultViews: {
                        ...(clonedRep?.defaultViews ?? {}),
                        top: builtinTop,
                      },
                    }
                  : clonedRep;
                onSaveToLibrary({
                  id: uid('lib'),
                  name: `${furn.name} (Custom)`,
                  category: 'My Library',
                  estimatedCostEur: furn.estimatedCostEur,
                  fixedSize: furn.fixedSize,
                  defaultElevationMm: furn.elevationMm,
                  defaultMountingType: effMountingType,
                  defaultMountingFace: effMountingFace,
                  glbAssetId: furn.glbAssetId,
                  glbDataUrl: furn.glbDataUrl,
                  glbEmissiveOverrides: furn.glbEmissiveOverrides
                    ? furn.glbEmissiveOverrides.map((ov) => ({
                        ...ov,
                        meshNames: [...ov.meshNames],
                      }))
                    : undefined,
                  lights: cloneLightsWithFreshIds(
                    Array.isArray(furn.lights) ? furn.lights : resolveEffectiveFurnitureLights(furn)
                  ),
                  svgSource: furn.svgSource,
                  footprintPolygon: furn.footprintPolygon,
                  representation: nextRep,
                  isCustom: true,
                  parts: furn.parts.map((p) => ({ ...p })),
                });
              }}
              className="py-1.5 px-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded font-medium hover:opacity-90 cursor-pointer"
            >
              Save to Library
            </button>
          </div>
        </div>
        </div>
      </div>
    );
  }

  // ==================== PERSON INSPECTOR ====================
  if (primary.kind === 'person') {
    const person = level.people.find((p) => p.id === primary.id);
    if (!person) return null;
    const updatePerson = (patch: Partial<PersonInstance>, label = 'Edit Figure') => {
      if (person.locked && !('locked' in patch)) return;
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          people: lvl.people.map((p) => (p.id === person.id ? { ...p, ...patch } : p)),
        }),
        false,
        true,
        label
      );
    };

    return (
      <div className="p-3 space-y-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm">Scale Figure</h3>
          <div className="flex items-center gap-1">
            <LockToggleButton
              locked={person.locked}
              onToggle={() =>
                updatePerson({ locked: !person.locked }, person.locked ? 'Unlock Figure' : 'Lock Figure')
              }
              label="figure"
            />
            <button
              type="button"
              disabled={person.locked}
              onClick={onDeleteSelected}
              className="p-1.5 text-red-600 disabled:opacity-35 rounded cursor-pointer"
              aria-label="Delete figure"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {person.locked && <LockedBanner />}
        <div
          aria-disabled={person.locked}
          className={person.locked ? 'space-y-3 opacity-50 pointer-events-none select-none' : 'space-y-3'}
        >
          <div>
            <label className="block text-[11px] text-slate-500 mb-0.5">Pose</label>
            <select
              value={person.pose}
              onChange={(e) => updatePerson({ pose: e.target.value as PersonInstance['pose'] })}
              className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
            >
              <option value="standing_man">Standing Adult (Man)</option>
              <option value="standing_woman">Standing Adult (Woman)</option>
              <option value="child">Standing Child</option>
              <option value="seated">Seated Person</option>
              <option value="walking">Walking Figure</option>
              <option value="lying_back">Lying Down (Supine)</option>
              <option value="lying_side">Lying Down (Side)</option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MetricInput label="Height" valueMm={person.heightMm} unit={unit} minMm={700} maxMm={2200} onChangeMm={(mm) => updatePerson({ heightMm: mm })} />
            <MetricInput label="Elevation" valueMm={person.elevationMm} unit={unit} minMm={0} maxMm={3000} onChangeMm={(mm) => updatePerson({ elevationMm: mm })} />
            <NumberField label="Rotation" value={person.rotationDeg} unitLabel="°" onChange={(deg) => updatePerson({ rotationDeg: deg })} />
          </div>
          {(person.pose === 'lying_back' || person.pose === 'lying_side' || person.pose === 'seated') && (
            <div className="space-y-1">
              <div className="text-[11px] text-slate-500">Quick Elevation Presets</div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: 'Floor 0 cm', mm: 0 },
                  { label: 'Sofa 45 cm', mm: 450 },
                  { label: 'Bed 55 cm', mm: 550 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => updatePerson({ elevationMm: preset.mm }, `Set ${person.name} Elevation`)}
                    className={`px-2 py-1 rounded border text-[11px] font-medium transition-colors cursor-pointer ${
                      Math.abs(person.elevationMm - preset.mm) <= 20
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ColorMaterialPicker
            label="Outfit / Accent Color"
            color={person.color}
            recentColors={recentColors}
            onColorChange={(hex) => updatePerson({ color: hex })}
          />
        </div>
      </div>
    );
  }

  // ==================== ARCHITECTURAL ELEMENT INSPECTOR ====================
  if (primary.kind === 'arch') {
    const el = level.archElements.find((a) => a.id === primary.id);
    if (!el) return null;
    const hostWall = el.attachedWallId
      ? level.walls.find((w) => w.id === el.attachedWallId)
      : undefined;

    const updateEl = (patch: Partial<ArchElement>, label = `Edit ${el.name}`) => {
      if (el.locked && !('locked' in patch)) return;
      onUpdateLevel(
        (lvl) => ({
          ...lvl,
          archElements: lvl.archElements.map((a) => (a.id === el.id ? { ...a, ...patch } : a)),
        }),
        false,
        true,
        label
      );
    };

    const cornerPin =
      el.type === 'chimney' && hostWall && typeof el.attachedT === 'number'
        ? getChimneyCornerPin(
            hostWall,
            level.walls,
            el.attachedT,
            el.widthMm,
            el.depthMm,
            el.attachedFace ?? 'left'
          )
        : null;

    const handleArchWidthChange = (nextMm: number) => {
      if (el.locked) return;
      if (el.type === 'chimney' && hostWall) {
        const res = solveChimneyResize(
          hostWall,
          level.walls,
          level.openings,
          level.archElements,
          el.id,
          nextMm,
          el.depthMm
        );
        if (!res.ok) {
          reportConstraintError(res.error ?? 'Width exceeds available wall length.');
          return;
        }
        applyWallComponentUpdates(hostWall, res.updates, 'Resize Chimney', {
          id: el.id,
          depthMm: res.depthMm,
          cornerPin: res.cornerPin,
        });
        return;
      }
      if (
        el.type === 'chimney' &&
        doesChimneyOverlapWalls(el.xMm, el.yMm, nextMm, el.depthMm, el.rotationDeg, level.walls, 4)
      ) {
        reportConstraintError('Chimney width cannot extend inside a wall.');
        return;
      }
      updateEl({ widthMm: nextMm });
    };

    const handleDepthChange = (nextDepthMm: number) => {
      if (el.locked) return;
      if (el.type === 'chimney' && hostWall) {
        const res = solveChimneyResize(
          hostWall,
          level.walls,
          level.openings,
          level.archElements,
          el.id,
          el.widthMm,
          nextDepthMm
        );
        if (!res.ok) {
          reportConstraintError(res.error ?? 'Depth extends into an adjacent or opposing wall.');
          return;
        }
        applyWallComponentUpdates(hostWall, res.updates, 'Resize Chimney Depth', {
          id: el.id,
          depthMm: res.depthMm,
          cornerPin: res.cornerPin,
        });
        return;
      }
      if (
        el.type === 'chimney' &&
        doesChimneyOverlapWalls(el.xMm, el.yMm, el.widthMm, nextDepthMm, el.rotationDeg, level.walls, 4)
      ) {
        reportConstraintError('Chimney depth cannot extend inside a wall.');
        return;
      }
      updateEl({ depthMm: nextDepthMm });
    };

    return (
      <div className="p-3 space-y-3 text-xs overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm truncate">{el.name}</h3>
          <div className="flex items-center gap-1 shrink-0">
            <LockToggleButton
              locked={el.locked}
              onToggle={() =>
                updateEl({ locked: !el.locked }, el.locked ? `Unlock ${el.name}` : `Lock ${el.name}`)
              }
              label={el.name}
            />
            <button
              type="button"
              disabled={el.locked}
              onClick={onDeleteSelected}
              className="p-1.5 text-red-600 disabled:opacity-35 rounded cursor-pointer"
              aria-label="Delete architectural element"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {el.locked && <LockedBanner />}
        {constraintError && (
          <ConstraintErrorBanner message={constraintError} onDismiss={() => setConstraintError(null)} />
        )}

        <div
          aria-disabled={el.locked}
          className={el.locked ? 'space-y-3 opacity-50 pointer-events-none select-none' : 'space-y-3'}
        >
          {el.type === 'chimney' && hostWall && (
            <div className="space-y-1.5">
              <ResizeAnchorSelector
                value={cornerPin ?? el.resizeAnchor ?? 'center'}
                onChange={(anchor) => updateEl({ resizeAnchor: anchor }, 'Set Chimney Anchor')}
              />
              {cornerPin && (
                <div className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-[10px] text-blue-700 dark:text-blue-300">
                  Corner-glued ({cornerPin} edge): resizing expands away from the corner.
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <MetricInput
              label="Width"
              valueMm={el.widthMm}
              unit={unit}
              minMm={50}
              onChangeMm={handleArchWidthChange}
            />
            <MetricInput
              label="Depth"
              valueMm={el.depthMm}
              unit={unit}
              minMm={50}
              onChangeMm={handleDepthChange}
            />
            <MetricInput
              label="Height"
              valueMm={el.connectToCeiling ? level.ceilingHeightMm : el.heightMm}
              unit={unit}
              minMm={50}
              onChangeMm={(mm) =>
                updateEl({ heightMm: mm, connectToCeiling: false })
              }
            />
            <MetricInput
              label="Elevation"
              valueMm={el.elevationMm}
              unit={unit}
              minMm={0}
              onChangeMm={(mm) => updateEl({ elevationMm: mm })}
            />
            {!(el.type === 'chimney' && hostWall) && (
              <NumberField
                label="Rotation"
                value={el.rotationDeg}
                unitLabel="°"
                onChange={(deg) => {
                  if (
                    el.type === 'chimney' &&
                    doesChimneyOverlapWalls(el.xMm, el.yMm, el.widthMm, el.depthMm, deg, level.walls, 4)
                  ) {
                    reportConstraintError('Rotation would push chimney inside a wall.');
                    return;
                  }
                  updateEl({ rotationDeg: deg });
                }}
              />
            )}
            {el.type.startsWith('stairs') && (
              <NumberField
                label="Steps"
                value={el.stepCount ?? 14}
                unitLabel="#"
                min={3}
                max={40}
                onChange={(s) => updateEl({ stepCount: Math.round(s) })}
              />
            )}
          </div>

          {el.type === 'chimney' && (
            <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-2">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Extend to Ceiling
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(el.connectToCeiling)}
                  onChange={(e) =>
                    updateEl(
                      {
                        connectToCeiling: e.target.checked,
                        heightMm: e.target.checked ? level.ceilingHeightMm : el.heightMm,
                        elevationMm: e.target.checked ? 0 : el.elevationMm,
                      },
                      'Toggle Extend to Ceiling'
                    )
                  }
                  className="accent-blue-600"
                />
              </label>

              {hostWall ? (
                <button
                  type="button"
                  onClick={() => {
                    const nextFace = el.attachedFace === 'right' ? 'left' : 'right';
                    const wallLen = getWallArcLength(hostWall) || 1;
                    const curS = (el.attachedT ?? 0.5) * wallLen;
                    const faceBounds = computeChimneyFaceBounds(
                      hostWall,
                      level.walls,
                      nextFace,
                      el.depthMm,
                      curS
                    );
                    if (faceBounds.maxS - faceBounds.minS < el.widthMm - 2) {
                      reportConstraintError(
                        'Cannot flip face: not enough clearance on the opposite wall face without overlapping a corner wall.'
                      );
                      return;
                    }
                    const clampedS = Math.max(
                      faceBounds.minS + el.widthMm / 2,
                      Math.min(faceBounds.maxS - el.widthMm / 2, curS)
                    );
                    const nextT = Math.max(0.001, Math.min(0.999, clampedS / wallLen));
                    const tf = computeAttachedChimneyTransform(
                      hostWall,
                      nextT,
                      el.depthMm,
                      nextFace
                    );
                    if (
                      doesChimneyOverlapWalls(
                        tf.xMm,
                        tf.yMm,
                        el.widthMm,
                        el.depthMm,
                        tf.rotationDeg,
                        level.walls,
                        6
                      )
                    ) {
                      reportConstraintError(
                        'Cannot flip face: chimney would overlap an adjacent wall.'
                      );
                      return;
                    }
                    const nextPin = getChimneyCornerPin(
                      hostWall,
                      level.walls,
                      nextT,
                      el.widthMm,
                      el.depthMm,
                      nextFace
                    );
                    updateEl(
                      {
                        attachedFace: nextFace,
                        attachedT: nextT,
                        xMm: tf.xMm,
                        yMm: tf.yMm,
                        rotationDeg: tf.rotationDeg,
                        resizeAnchor: nextPin ?? 'center',
                      },
                      'Flip Chimney Wall Face'
                    );
                  }}
                  className="w-full py-1.5 px-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  Flip to Opposite Wall Face
                </button>
              ) : (
                level.walls.some((w) => w.visible !== false) && (
                  <button
                    type="button"
                    onClick={() => {
                      const snap = snapChimneyToWallEdge(
                        { x: el.xMm, y: el.yMm },
                        el.widthMm,
                        el.depthMm,
                        level.walls,
                        level.openings,
                        level.archElements,
                        el.id,
                        settings.snapEnabled
                      );
                      if (!snap) {
                        reportConstraintError('No valid wall edge found for this chimney size.');
                        return;
                      }
                      updateEl(
                        {
                          attachedWallId: snap.wallId,
                          attachedFace: snap.face,
                          attachedT: snap.t,
                          xMm: snap.xMm,
                          yMm: snap.yMm,
                          rotationDeg: snap.rotationDeg,
                          resizeAnchor: snap.cornerPin ?? 'center',
                        },
                        'Snap Chimney to Wall Edge'
                      );
                    }}
                    className="w-full py-1.5 px-2 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 rounded hover:bg-blue-100 dark:hover:bg-blue-950/50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    Snap Flush to Nearest Wall Edge
                  </button>
                )
              )}

              <label className="flex items-center justify-between cursor-pointer">
                <span>Inherit Wall Baseboard</span>
                <input
                  type="checkbox"
                  checked={Boolean(el.hasBaseboard)}
                  onChange={(e) => updateEl({ hasBaseboard: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span>Inherit Crown Molding</span>
                <input
                  type="checkbox"
                  checked={Boolean(el.hasCrownMolding)}
                  onChange={(e) => updateEl({ hasCrownMolding: e.target.checked })}
                  className="accent-blue-600"
                />
              </label>

              {/* 4 Unique Per-Face Colors */}
              {(() => {
                const fc = resolveChimneyFaceColors(el);
                const faceDefs: Array<{ key: 'front' | 'back' | 'left' | 'right'; label: string }> = [
                  { key: 'front', label: 'Front Face' },
                  { key: 'back', label: 'Back Face' },
                  { key: 'left', label: 'Left Face' },
                  { key: 'right', label: 'Right Face' },
                ];
                return (
                  <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                        Face Colors
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateEl({ faceColors: getDefaultChimneyFaceColors(el.id) }, 'Reset Chimney Face Colors')
                        }
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Reset Auto
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {faceDefs.map(({ key, label }) => (
                        <label
                          key={key}
                          className="flex items-center gap-1.5 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 cursor-pointer"
                        >
                          <input
                            type="color"
                            value={fc[key]}
                            onChange={(e) =>
                              updateEl(
                                { faceColors: { ...fc, [key]: e.target.value.toUpperCase() } },
                                `Edit Chimney ${label} Color`
                              )
                            }
                            aria-label={`${label} color`}
                            className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent shrink-0"
                          />
                          <div className="min-w-0 leading-tight">
                            <div className="text-[10px] font-medium text-slate-700 dark:text-slate-200 truncate">
                              {label}
                            </div>
                            <div className="text-[9px] font-mono-nums text-slate-400">
                              {fc[key]}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {el.type.startsWith('stairs') && (
            <label className="flex items-center justify-between cursor-pointer">
              <span>Include Handrail</span>
              <input type="checkbox" checked={Boolean(el.hasRailing)} onChange={(e) => updateEl({ hasRailing: e.target.checked })} className="accent-blue-600" />
            </label>
          )}
          {el.type === 'doorframe' && (
            <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-2">
              <label className="flex items-center justify-between cursor-pointer">
                <span>Include Threshold Sill</span>
                <input
                  type="checkbox"
                  checked={el.hasRailing !== false}
                  onChange={(e) => updateEl({ hasRailing: e.target.checked }, 'Toggle Threshold Sill')}
                  className="accent-blue-600"
                />
              </label>
              {el.hasRailing !== false && (
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="text-[11px] text-slate-600 dark:text-slate-300">Threshold Color</span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono-nums text-[10px] text-slate-400">{el.accentColor}</span>
                    <input
                      type="color"
                      value={el.accentColor}
                      onChange={(e) => updateEl({ accentColor: e.target.value.toUpperCase() }, 'Edit Threshold Color')}
                      aria-label="Threshold Sill Color"
                      className="w-6 h-5 rounded border border-slate-300 dark:border-slate-700 cursor-pointer"
                    />
                  </span>
                </label>
              )}
            </div>
          )}
          <ColorMaterialPicker
            label={el.type === 'doorframe' ? 'Frame Material' : 'Primary Material'}
            color={el.color}
            material={el.material}
            recentColors={recentColors}
            onColorChange={(hex) => updateEl({ color: hex })}
            onMaterialChange={(m) => updateEl({ material: m })}
          />
        </div>
      </div>
    );
  }

  // ==================== MEASUREMENT / ANNOTATION ====================
  if (primary.kind === 'measurement') {
    const m = level.measurements.find((x) => x.id === primary.id);
    if (!m) return null;
    return (
      <div className="p-3 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Measurement</h3>
          <button type="button" onClick={onDeleteSelected} className="p-1.5 text-red-600 rounded cursor-pointer" aria-label="Delete measurement">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="font-mono-nums text-sm font-semibold">
          {m.kind === 'distance' ? formatSmartMetric(dist(m.start, m.end)) : 'Polygon Area'}
        </div>
      </div>
    );
  }

  if (primary.kind === 'annotation') {
    const n = level.annotations.find((x) => x.id === primary.id);
    if (!n) return null;
    const updateNote = (text: string) => {
      onUpdateLevel((lvl) => ({
        ...lvl,
        annotations: lvl.annotations.map((a) => (a.id === n.id ? { ...a, text } : a)),
      }));
    };
    return (
      <div className="p-3 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Annotation</h3>
          <button type="button" onClick={onDeleteSelected} className="p-1.5 text-red-600 rounded cursor-pointer" aria-label="Delete annotation">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        <input
          type="text"
          value={n.text}
          onChange={(e) => updateNote(e.target.value)}
          className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
        />
      </div>
    );
  }

  return null;
};
