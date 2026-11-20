import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  ChevronDown,
  Columns,
  Download,
  FileJson,
  FileText,
  FolderOpen,
  History,
  Home,
  Image as ImageIcon,
  Layers,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Printer,
  Redo2,
  Settings,
  Sun,
  Undo2,
} from 'lucide-react';
import {
  ArchElementType,
  CameraPreset,
  CatalogTemplate,
  EditorTool,
  Opening,
  PersonPose,
  Point2D,
  Project,
  RailingStyleId,
  ViewMode,
} from './types/plan';
import { usePlanState } from './hooks/usePlanState';
import { HomePage } from './components/HomePage';
import { LeftSidebar } from './components/LeftSidebar';
import { PropertiesInspector } from './components/PropertiesInspector';
import { Canvas2D } from './components/Canvas2D';
import { Viewport3D } from './components/Viewport3D';
import { WallCutThroughViewer } from './components/WallCutThroughViewer';
import { HistoryPanel } from './components/HistoryPanel';
import { FloatingToolbox } from './components/FloatingToolbox';
import { BottomToolbar } from './components/BottomToolbar';
import { CustomFurnitureModal } from './components/CustomFurnitureModal';
import { ImporterModal } from './components/ImporterModal';
import { SettingsModal } from './components/SettingsModal';
import { SvgRepresentationEditorModal } from './components/SvgRepresentationEditorModal';
import {
  exportDataUrlPng,
  exportProjectJson,
  exportSvgElementAsPng,
  exportSvgFromElement,
  printArchitecturalSheet,
} from './utils/exportProject';
import { exportLevelAs3D, Export3DFormat } from './utils/export3d';
import { matchKeybindAction } from './utils/keybinds';
import { subscribeAssetLoaded } from './utils/assetStore';
import {
  computeFurnitureRepresentationAsync,
  needsRepresentationRegeneration,
} from './utils/furnitureRepresentationSync';
import { cloneLightsWithFreshIds } from './utils/lighting';
import { resolveEffectiveRepresentationMode } from './utils/svgImport';
import {
  computeSurfaceLocalCoords,
  findNearestWallAttachmentTarget,
  findSupportingSurfaceForProp,
  getCeilingFixtureOffsetMm,
  getDefaultChimneyFaceColors,
  getEffectiveFurnitureZOrder,
  getEnclosingRoomCeilingMm,
  isAcIndoorUnit,
  isCurtainOrBlindFurniture,
  isRugFurniture,
  snapChimneyToWallEdge,
  snapFurnitureToPlan,
} from './utils/geometry';
import {
  resolveFurnitureMountingFace,
  resolveFurnitureMountingType,
} from './utils/mounting';
import {
  DEFAULT_RAILING_STYLE,
  buildRailingArchElementFromWorldPoints,
  createDefaultRailingConfig,
} from './utils/railings';
import { uid } from './utils/units';

export default function App() {
  const {
    projects,
    project,
    activeLevel,
    keybinds,
    updateKeybinds,
    graphicsSettings,
    selectGraphicsPreset,
    updateGraphicsSettings,
    resetGraphicsSettings,
    selection,
    setSelection,
    canUndo,
    canRedo,
    undo,
    redo,
    historyEntries,
    historyIndex,
    jumpToHistoryStep,
    commit,
    commitDragStep,
    cancelDragPreview,
    updateActiveLevel,
    silentlyPatchFurnitureRepresentations,
    updateSettings,
    addRecentColor,
    addLevel,
    switchLevel,
    deleteLevel,
    deleteSelected,
    copySelected,
    pasteClipboard,
    duplicateSelected,
    addCustomTemplate,
    openProject,
    createNewProject,
    duplicateProject,
    renameProject,
    deleteProject,
    loadTemplate,
    importProjectJson,
  } = usePlanState();

  const [showHome, setShowHome] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [pendingOpeningSpec, setPendingOpeningSpec] = useState<{
    category: Opening['category'];
    subtype: Opening['subtype'];
  }>({ category: 'door', subtype: 'single' });
  const [activeRailingStyle, setActiveRailingStyle] = useState<RailingStyleId>(DEFAULT_RAILING_STYLE);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('perspective');
  const [zoomMultiplier, setZoomMultiplier] = useState(1);
  const [fitSignal, setFitSignal] = useState(0);
  const [cursorCoordsMm, setCursorCoordsMm] = useState<Point2D>({ x: 0, y: 0 });

  const [showCustomBuilder, setShowCustomBuilder] = useState(false);
  const [showImporter, setShowImporter] = useState(false);
  const [editingSvgFurnId, setEditingSvgFurnId] = useState<string | null>(null);
  const [assetVersion, setAssetVersion] = useState(0);
  const [settingsTab, setSettingsTab] = useState<'general' | 'keybinds' | 'graphics' | null>(null);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Trace calibration modal state (replaces window.prompt)
  const [calibrateMeasuredMm, setCalibrateMeasuredMm] = useState<number | null>(null);
  const [calibrateRealMeters, setCalibrateRealMeters] = useState('4.00');

  // Eyedropper callback ref
  const eyedropperCallbackRef = useRef<((hex: string) => void) | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const capture3dFnRef = useRef<(() => string | null) | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);

  const notify = useCallback((msg: string) => {
    setStatusNotice(msg);
    window.setTimeout(() => {
      setStatusNotice((cur) => (cur === msg ? null : cur));
    }, 2800);
  }, []);

  // Re-trigger SVG extraction checks once IndexedDB assets finish hydrating
  useEffect(() => {
    return subscribeAssetLoaded(() => {
      setAssetVersion((v) => v + 1);
    });
  }, []);

  // Background automatic 3D-to-SVG projection generator:
  // Only regenerates items missing autoViews or whose geometrySignature changed.
  // Never runs on move/2D rotation/rename/reload when cached geometrySignature matches,
  // and never overwrites user customViews.
  useEffect(() => {
    const stale = activeLevel.furniture.filter((f) => needsRepresentationRegeneration(f));
    if (stale.length === 0) return;

    let cancelled = false;
    const targetLevelId = activeLevel.id;
    const timer = window.setTimeout(async () => {
      const patches: Array<{ furnitureId: string; representation: NonNullable<typeof stale[number]['representation']> }> = [];
      for (const item of stale) {
        if (cancelled) return;
        try {
          const rep = await computeFurnitureRepresentationAsync(item, {
            mode: resolveEffectiveRepresentationMode(item),
            useMaterialFill: item.representation?.useMaterialFill ?? false,
            preserveCustomViews: true,
          });
          patches.push({ furnitureId: item.id, representation: rep });
        } catch {
          // Ignore individual extraction errors; fallback stays clean
        }
      }
      if (!cancelled && patches.length > 0) {
        silentlyPatchFurnitureRepresentations(targetLevelId, patches);
      }
    }, 60);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeLevel.id, activeLevel.furniture, assetVersion, silentlyPatchFurnitureRepresentations]);

  // Keyboard shortcuts & accessibility
  useEffect(() => {
    if (showHome || settingsTab !== null) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (viewMode === '3d' && cameraPreset === 'walkthrough') return;
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isInput) return;

      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((meta && e.key.toLowerCase() === 'y') || (meta && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        redo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copySelected();
        notify('Copied selection');
        return;
      }
      if (meta && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (
        e.key === 'Delete' ||
        (e.key === 'Backspace' &&
          activeTool !== 'wall' &&
          activeTool !== 'wall_arc' &&
          activeTool !== 'railing')
      ) {
        e.preventDefault();
        deleteSelected();
        return;
      }

      // Zoom keyboard shortcuts: +, =, -, _
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoomMultiplier((z) => Math.min(6, +(z * 1.15).toFixed(3)));
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoomMultiplier((z) => Math.max(0.15, +(z * 0.85).toFixed(3)));
        return;
      }

      // Arrow key nudging of selected elements (50 mm, or 10 mm with Shift)
      if (
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight') &&
        selection.length > 0
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 50;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;

        const furnIds = new Set(selection.filter((s) => s.kind === 'furniture').map((s) => s.id));
        const personIds = new Set(selection.filter((s) => s.kind === 'person').map((s) => s.id));
        const curtainIds = new Set(selection.filter((s) => s.kind === 'curtain').map((s) => s.id));
        const archIds = new Set(selection.filter((s) => s.kind === 'arch').map((s) => s.id));
        const wallIds = new Set(selection.filter((s) => s.kind === 'wall').map((s) => s.id));

        updateActiveLevel(
          (lvl) => ({
            ...lvl,
            furniture: lvl.furniture.map((f) =>
              furnIds.has(f.id) && !f.locked ? { ...f, xMm: f.xMm + dx, yMm: f.yMm + dy } : f
            ),
            people: lvl.people.map((p) =>
              personIds.has(p.id) && !p.locked ? { ...p, xMm: p.xMm + dx, yMm: p.yMm + dy } : p
            ),
            curtains: lvl.curtains.map((c) =>
              curtainIds.has(c.id) && !c.locked ? { ...c, xMm: c.xMm + dx, yMm: c.yMm + dy } : c
            ),
            archElements: lvl.archElements.map((a) =>
              archIds.has(a.id) && !a.locked ? { ...a, xMm: a.xMm + dx, yMm: a.yMm + dy } : a
            ),
            walls: lvl.walls.map((w) =>
              wallIds.has(w.id) && !w.locked
                ? {
                    ...w,
                    start: { x: w.start.x + dx, y: w.start.y + dy },
                    end: { x: w.end.x + dx, y: w.end.y + dy },
                  }
                : w
            ),
          }),
          wallIds.size > 0,
          true,
          'Nudge Selection',
          'nudge'
        );
        return;
      }

      if (!meta && !e.altKey) {
        const action = matchKeybindAction(e.key, keybinds);
        if (!action) return;
        if (action === 'select') setActiveTool('select');
        else if (action === 'pan') setActiveTool('pan');
        else if (action === 'wall') setActiveTool('wall');
        else if (action === 'wall_arc') setActiveTool('wall_arc');
        else if (action === 'split_wall') setActiveTool('split_wall');
        else if (action === 'chimney') setActiveTool('chimney');
        else if (action === 'door') {
          setPendingOpeningSpec({ category: 'door', subtype: 'single' });
          setActiveTool('door');
        } else if (action === 'window') {
          setPendingOpeningSpec({ category: 'window', subtype: 'double' });
          setActiveTool('window');
        } else if (action === 'arch') {
          setPendingOpeningSpec({ category: 'arch', subtype: 'round_arch' });
          setActiveTool('arch');
        } else if (action === 'railing') setActiveTool('railing');
        else if (action === 'measure_distance') setActiveTool('measure_distance');
        else if (action === 'measure_area') setActiveTool('measure_area');
        else if (action === 'text') setActiveTool('text');
        else if (action === 'arrow') setActiveTool('arrow');
        else if (action === 'section_line') setActiveTool('section_line');
        else if (action === 'fit_screen') {
          e.preventDefault();
          setFitSignal((s) => s + 1);
        } else if (action === 'toggle_grid') {
          updateSettings({ showGrid: !project.settings.showGrid }, 'Toggle Grid');
        } else if (action === 'toggle_snap') {
          updateSettings({ snapEnabled: !project.settings.snapEnabled }, 'Toggle Snap');
        } else if (action === 'rotate_cw' && selection.length > 0) {
          const delta = e.shiftKey ? -15 : 15;
          const furnIds = new Set(selection.filter((s) => s.kind === 'furniture').map((s) => s.id));
          const personIds = new Set(selection.filter((s) => s.kind === 'person').map((s) => s.id));
          const curtainIds = new Set(selection.filter((s) => s.kind === 'curtain').map((s) => s.id));
          const archIds = new Set(selection.filter((s) => s.kind === 'arch').map((s) => s.id));
          updateActiveLevel(
            (lvl) => ({
              ...lvl,
              furniture: lvl.furniture.map((f) =>
                furnIds.has(f.id) && !f.locked
                  ? { ...f, rotationDeg: (f.rotationDeg + delta + 360) % 360 }
                  : f
              ),
              people: lvl.people.map((p) =>
                personIds.has(p.id) && !p.locked
                  ? { ...p, rotationDeg: (p.rotationDeg + delta + 360) % 360 }
                  : p
              ),
              curtains: lvl.curtains.map((c) =>
                curtainIds.has(c.id) && !c.locked
                  ? { ...c, rotationDeg: (c.rotationDeg + delta + 360) % 360 }
                  : c
              ),
              archElements: lvl.archElements.map((a) =>
                archIds.has(a.id) && !a.locked
                  ? { ...a, rotationDeg: (a.rotationDeg + delta + 360) % 360 }
                  : a
              ),
            }),
            false,
            true,
            'Rotate Selection',
            'rotate-kbd'
          );
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    showHome,
    settingsTab,
    activeTool,
    keybinds,
    undo,
    redo,
    copySelected,
    pasteClipboard,
    duplicateSelected,
    deleteSelected,
    notify,
    selection,
    updateActiveLevel,
    updateSettings,
    project.settings.showGrid,
    project.settings.snapEnabled,
    viewMode,
    cameraPreset,
  ]);

  const placeFurnitureTemplate = useCallback(
    (tpl: CatalogTemplate) => {
      let cx = 2500;
      let cy = 2000;
      if (activeLevel.rooms.length > 0) {
        const pts = activeLevel.rooms[0].polygon;
        if (pts.length > 0) {
          cx = Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length);
          cy = Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length);
        }
      }
      const idx = activeLevel.furniture.length;
      if (idx > 0) {
        const angle = (idx * 137.5 * Math.PI) / 180;
        const radius = 140 + (idx % 4) * 90;
        cx = Math.round(cx + Math.cos(angle) * radius);
        cy = Math.round(cy + Math.sin(angle) * radius);
      }
      const id = uid('furn');
      updateActiveLevel(
        (lvl) => {
          const parts = tpl.parts.map((p) => ({ ...p, id: uid('part') }));
          const resolvedMountingType =
            tpl.defaultMountingType ??
            resolveFurnitureMountingType({
              templateId: tpl.id,
              category: tpl.category,
              parts,
              elevationMm: tpl.defaultElevationMm ?? 0,
            });
          const resolvedMountingFace =
            tpl.defaultMountingFace ??
            resolveFurnitureMountingFace({
              templateId: tpl.id,
              category: tpl.category,
              parts,
              elevationMm: tpl.defaultElevationMm ?? 0,
              mountingType: resolvedMountingType,
            });
          const isRug = isRugFurniture({ templateId: tpl.id, parts });
          const zValues = lvl.furniture.map((item, i) => getEffectiveFurnitureZOrder(item, i));
          const initialZOrder = isRug
            ? Math.min(-1000, ...zValues) - 1
            : Math.max(-1, ...zValues) + 1;
          const supportHit =
            resolvedMountingType === 'surface' || resolvedMountingType === 'freestanding'
              ? findSupportingSurfaceForProp(
                  { x: cx, y: cy },
                  { id, templateId: tpl.id, category: tpl.category, parts, mountingType: resolvedMountingType },
                  lvl.furniture
                )
              : null;
          const isAcIndoor = isAcIndoorUnit({ templateId: tpl.id, parts });
          const targetCeilingMm = getEnclosingRoomCeilingMm(
            { x: cx, y: cy },
            lvl.rooms,
            lvl.ceilingHeightMm
          );
          const ceilingOffset =
            resolvedMountingType === 'ceiling'
              ? getCeilingFixtureOffsetMm(
                  {
                    templateId: tpl.id,
                    category: tpl.category,
                    parts,
                    elevationMm: tpl.defaultElevationMm ?? 0,
                    mountingType: 'ceiling',
                  },
                  targetCeilingMm
                )
              : 0;
          const initialElevationMm =
            isAcIndoor && resolvedMountingType === 'wall'
              ? getCeilingFixtureOffsetMm(
                  { templateId: tpl.id, category: tpl.category, parts, elevationMm: 0 },
                  targetCeilingMm
                )
              : resolvedMountingType === 'ceiling'
                ? ceilingOffset
                : supportHit
                  ? supportHit.deckHeightMm
                  : (tpl.defaultElevationMm ?? 0);
          const localSurface = supportHit
            ? computeSurfaceLocalCoords({ x: cx, y: cy }, 0, supportHit.host)
            : null;
          const draftItem: import('./types/plan').FurnitureInstance = {
            id,
            templateId: tpl.id,
            name: tpl.name,
            category: tpl.category,
            mountingType: resolvedMountingType,
            mountingFace: resolvedMountingFace,
            xMm: cx,
            yMm: cy,
            elevationMm: initialElevationMm,
            surfaceHostId:
              resolvedMountingType === 'wall' || resolvedMountingType === 'ceiling' || isAcIndoor
                ? undefined
                : supportHit?.host.id,
            surfaceLocalXMm:
              resolvedMountingType === 'wall' || resolvedMountingType === 'ceiling' || isAcIndoor
                ? undefined
                : localSurface
                  ? Math.round(localSurface.localXMm * 10) / 10
                  : undefined,
            surfaceLocalYMm:
              resolvedMountingType === 'wall' || resolvedMountingType === 'ceiling' || isAcIndoor
                ? undefined
                : localSurface
                  ? Math.round(localSurface.localYMm * 10) / 10
                  : undefined,
            surfaceLocalRotDeg:
              resolvedMountingType === 'wall' || resolvedMountingType === 'ceiling' || isAcIndoor
                ? undefined
                : localSurface
                  ? Math.round(localSurface.localRotDeg * 10) / 10
                  : undefined,
            zOrder: initialZOrder,
            rotationDeg: 0,
            rotationXDeg: 0,
            rotationYDeg: 0,
            mirroredX: false,
            mirroredY: false,
            lockProportions: false,
            fixedSize: tpl.fixedSize,
            estimatedCostEur: tpl.estimatedCostEur,
            parts,
            glbAssetId: tpl.glbAssetId,
            glbDataUrl: tpl.glbDataUrl,
            svgSource: tpl.svgSource,
            footprintPolygon: tpl.footprintPolygon,
            representation: tpl.representation
              ? JSON.parse(JSON.stringify(tpl.representation))
              : undefined,
            lightConfig:
              tpl.category === 'Lighting'
                ? { enabled: true, colorTempK: 3200, intensity: 0.6 }
                : undefined,
            isLight: tpl.isLight ?? (tpl.category === 'Lighting' ? true : undefined),
            lightingEnabled:
              tpl.isLight || tpl.category === 'Lighting'
                ? (tpl.lightingEnabled ?? true)
                : undefined,
            lights: cloneLightsWithFreshIds(tpl.lights),
            glbEmissiveOverrides: tpl.glbEmissiveOverrides
              ? tpl.glbEmissiveOverrides.map((ov) => ({
                  ...ov,
                  meshNames: [...ov.meshNames],
                }))
              : undefined,
            visible: true,
            locked: false,
          };
          if (resolvedMountingType === 'wall' && lvl.walls.some((w) => w.visible !== false)) {
            if (isCurtainOrBlindFurniture(draftItem)) {
              const wallSnap = snapFurnitureToPlan(
                { x: cx, y: cy },
                draftItem,
                lvl.walls,
                lvl.furniture,
                { snapEnabled: true, gridSizeMm: project.settings.gridSizeMm }
              );
              draftItem.xMm = wallSnap.xMm;
              draftItem.yMm = wallSnap.yMm;
              draftItem.rotationDeg = wallSnap.rotationDeg;
              draftItem.attachedWallId = wallSnap.attachedWallId;
              draftItem.attachedFace = wallSnap.attachedFace;
              draftItem.attachedT = wallSnap.attachedT;
            } else {
              const wallTarget = findNearestWallAttachmentTarget(
                { x: cx, y: cy },
                draftItem,
                lvl.walls
              );
              if (wallTarget) {
                draftItem.xMm = wallTarget.xMm;
                draftItem.yMm = wallTarget.yMm;
                draftItem.rotationDeg = wallTarget.rotationDeg;
                draftItem.attachedWallId = wallTarget.wall.id;
                draftItem.attachedFace = wallTarget.face;
                draftItem.attachedT = wallTarget.t;
              }
            }
          }
          return {
            ...lvl,
            furniture: [...lvl.furniture, draftItem],
          };
        },
        false,
        true,
        `Place ${tpl.name}`
      );
      setSelection([{ kind: 'furniture', id }]);
      setActiveTool('select');
    },
    [activeLevel.furniture.length, activeLevel.rooms, project.settings.gridSizeMm, updateActiveLevel, setSelection]
  );

  const handlePlacePerson = useCallback(
    (pose: PersonPose, name: string, heightMm: number) => {
      const id = uid('person');
      updateActiveLevel(
        (lvl) => ({
          ...lvl,
          people: [
            ...lvl.people,
            {
              id,
              name,
              pose,
              xMm: 2200,
              yMm: 2200,
              elevationMm: 0,
              rotationDeg: 0,
              heightMm,
              color: '#FFFFFF',
              visible: true,
              locked: false,
            },
          ],
        }),
        false,
        true,
        `Add ${name}`
      );
      setSelection([{ kind: 'person', id }]);
      setActiveTool('select');
    },
    [updateActiveLevel, setSelection]
  );

  const handlePlaceArchElement = useCallback(
    (type: ArchElementType, name: string) => {
      const id = uid('arch');
      const defaults: Record<ArchElementType, { w: number; d: number; h: number; elev: number }> = {
        chimney: { w: 650, d: 450, h: activeLevel.ceilingHeightMm, elev: 0 },
        column_round: { w: 320, d: 320, h: activeLevel.ceilingHeightMm, elev: 0 },
        column_square: { w: 320, d: 320, h: activeLevel.ceilingHeightMm, elev: 0 },
        beam: { w: 3200, d: 280, h: 300, elev: activeLevel.ceilingHeightMm - 300 },
        stairs_straight: { w: 1000, d: 2800, h: activeLevel.ceilingHeightMm, elev: 0 },
        stairs_l: { w: 2000, d: 2200, h: activeLevel.ceilingHeightMm, elev: 0 },
        stairs_u: { w: 2100, d: 2600, h: activeLevel.ceilingHeightMm, elev: 0 },
        stairs_spiral: { w: 1600, d: 1600, h: activeLevel.ceilingHeightMm, elev: 0 },
        railing: { w: 1800, d: 80, h: 1000, elev: 0 },
        niche: { w: 900, d: 150, h: 1100, elev: 900 },
        platform: { w: 2400, d: 1800, h: 200, elev: 0 },
        balcony: { w: 3200, d: 1400, h: 180, elev: 0 },
        fireplace: { w: 1200, d: 520, h: 1100, elev: 0 },
        doorframe: { w: 960, d: 180, h: 2150, elev: 0 },
      };
      const dim = defaults[type] ?? { w: 1000, d: 1000, h: 1000, elev: 0 };
      let placed = false;
      updateActiveLevel(
        (lvl) => {
          if (type === 'chimney') {
            const hasWalls = lvl.walls.some((w) => w.visible !== false);
            if (hasWalls) {
              const snap = snapChimneyToWallEdge(
                { x: 2600, y: 2600 },
                dim.w,
                dim.d,
                lvl.walls,
                lvl.openings,
                lvl.archElements,
                undefined,
                project.settings.snapEnabled
              );
              if (!snap) {
                return lvl;
              }
              placed = true;
              const hostWall = lvl.walls.find((w) => w.id === snap.wallId);
              const faceColor = hostWall
                ? snap.face === 'left'
                  ? hostWall.innerColor
                  : hostWall.outerColor
                : '#FFFFFF';
              const faceMat = hostWall
                ? snap.face === 'left'
                  ? hostWall.innerMaterial
                  : hostWall.outerMaterial
                : 'paint';
              return {
                ...lvl,
                archElements: [
                  ...lvl.archElements,
                  {
                    id,
                    name,
                    type,
                    xMm: snap.xMm,
                    yMm: snap.yMm,
                    elevationMm: dim.elev,
                    rotationDeg: snap.rotationDeg,
                    widthMm: dim.w,
                    depthMm: dim.d,
                    heightMm: dim.h,
                    color: faceColor,
                    accentColor: '#334155',
                    material: faceMat,
                    stepCount: 14,
                    hasRailing: true,
                    connectToCeiling: true,
                    attachedWallId: snap.wallId,
                    attachedFace: snap.face,
                    attachedT: snap.t,
                    resizeAnchor: snap.cornerPin ?? 'center',
                    hasBaseboard: hostWall?.hasBaseboard ?? true,
                    baseboardHeightMm: hostWall?.baseboardHeightMm ?? 80,
                    baseboardColor: hostWall?.baseboardColor ?? '#FFFFFF',
                    hasCrownMolding: hostWall?.hasCrownMolding ?? false,
                    crownHeightMm: hostWall?.crownHeightMm ?? 60,
                    crownColor: hostWall?.crownColor ?? '#FFFFFF',
                    faceColors: getDefaultChimneyFaceColors(id),
                    visible: true,
                    locked: false,
                  },
                ],
              };
            }
          }
          if (type === 'railing') {
            placed = true;
            const railEl = buildRailingArchElementFromWorldPoints(
              id,
              [
                { xMm: 1500, yMm: 2600, elevationMm: 0 },
                { xMm: 3700, yMm: 2600, elevationMm: 0 },
              ],
              activeRailingStyle,
              { closed: false, name }
            );
            return {
              ...lvl,
              archElements: [...lvl.archElements, railEl],
            };
          }
          placed = true;
          const isStairOrDeck =
            type.startsWith('stairs') || type === 'balcony' || type === 'platform';
          return {
            ...lvl,
            archElements: [
              ...lvl.archElements,
              {
                id,
                name,
                type,
                xMm: 2600,
                yMm: 2600,
                elevationMm: dim.elev,
                rotationDeg: 0,
                widthMm: dim.w,
                depthMm: dim.d,
                heightMm: dim.h,
                color: '#FFFFFF',
                accentColor: type === 'doorframe' ? '#94A3B8' : '#334155',
                material: type === 'chimney' ? 'paint' : type === 'doorframe' ? 'oak' : 'concrete',
                faceColors: type === 'chimney' ? getDefaultChimneyFaceColors(id) : undefined,
                stepCount: 14,
                hasRailing: type !== 'platform',
                ...(type.startsWith('stairs')
                  ? {
                      railingLeft: type === 'stairs_l' || type === 'stairs_u',
                      railingRight: true,
                      stairTurnDirection: 'right' as const,
                    }
                  : {}),
                ...(type === 'balcony'
                  ? { railingEdges: { front: true, left: true, right: true, back: false } }
                  : {}),
                ...(isStairOrDeck
                  ? { railing: createDefaultRailingConfig(activeRailingStyle, dim.w) }
                  : {}),
                connectToCeiling: type === 'chimney',
                visible: true,
                locked: false,
              },
            ],
          };
        },
        false,
        true,
        `Add ${name}`
      );
      if (placed) {
        setSelection([{ kind: 'arch', id }]);
      } else {
        notify('No wall edge with enough clearance to place chimney without overlapping a wall.');
      }
      setActiveTool('select');
    },
    [
      activeLevel.ceilingHeightMm,
      activeRailingStyle,
      notify,
      project.settings.snapEnabled,
      updateActiveLevel,
      setSelection,
    ]
  );

  const handlePlaceRailingPreset = useCallback(
    (styleId: RailingStyleId) => {
      setActiveRailingStyle(styleId);
      const id = uid('rail');
      const railEl = buildRailingArchElementFromWorldPoints(
        id,
        [
          { xMm: 1500, yMm: 2600, elevationMm: 0 },
          { xMm: 3700, yMm: 2600, elevationMm: 0 },
        ],
        styleId,
        { closed: false }
      );
      updateActiveLevel(
        (lvl) => ({
          ...lvl,
          archElements: [...lvl.archElements, railEl],
        }),
        false,
        true,
        `Add ${railEl.name}`
      );
      setSelection([{ kind: 'arch', id }]);
      setActiveTool('select');
    },
    [updateActiveLevel, setSelection]
  );

  const handleActivateEyedropper = useCallback(
    (cb: (hex: string) => void) => {
      eyedropperCallbackRef.current = cb;
      setActiveTool('eyedropper');
      notify('Click any wall, room floor, or furniture piece to sample its color');
    },
    [notify]
  );

  const handlePickEyedropperColor = useCallback(
    (hex: string) => {
      if (eyedropperCallbackRef.current) {
        eyedropperCallbackRef.current(hex);
        addRecentColor(hex);
        eyedropperCallbackRef.current = null;
      }
      setActiveTool('select');
    },
    [addRecentColor]
  );

  const importJsonFileObject = useCallback(
    (file: File, openAfter = false) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as Project;
          if (!parsed || !Array.isArray(parsed.levels) || parsed.levels.length === 0) {
            notify('Invalid Plan Studio JSON file');
            return;
          }
          importProjectJson(parsed);
          if (openAfter) {
            setShowHome(false);
            setFitSignal((s) => s + 1);
          }
          notify(`Imported "${parsed.name}"`);
        } catch {
          notify('Could not parse JSON project file');
        }
      };
      reader.readAsText(file);
    },
    [importProjectJson, notify]
  );

  const handleImportJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importJsonFileObject(file);
    e.target.value = '';
  };

  const handleExport3DModel = useCallback(
    async (format: Export3DFormat) => {
      setShowExportMenu(false);
      try {
        notify(`Generating ${format.toUpperCase()} 3D model...`);
        const file = await exportLevelAs3D(project.name, activeLevel, project.settings, format);
        notify(`Exported ${file}`);
      } catch {
        notify(`Could not export ${format.toUpperCase()} 3D model`);
      }
    },
    [activeLevel, notify, project.name, project.settings]
  );

  const applyTraceCalibration = () => {
    const realM = Number(calibrateRealMeters);
    if (!calibrateMeasuredMm || !Number.isFinite(realM) || realM <= 0) {
      setCalibrateMeasuredMm(null);
      return;
    }
    const realMm = realM * 1000;
    const factor = realMm / calibrateMeasuredMm;
    updateActiveLevel(
      (lvl) =>
        lvl.backgroundTrace
          ? {
              ...lvl,
              backgroundTrace: {
                ...lvl.backgroundTrace,
                widthMm: Math.round(lvl.backgroundTrace.widthMm * factor),
                heightMm: Math.round(lvl.backgroundTrace.heightMm * factor),
              },
            }
          : lvl,
      false,
      true,
      'Calibrate Trace Scale'
    );
    setCalibrateMeasuredMm(null);
    setActiveTool('select');
    notify('Background trace scale calibrated');
  };

  const settingsModalEl = settingsTab !== null && (
    <SettingsModal
      initialTab={settingsTab}
      keybinds={keybinds}
      settings={project.settings}
      graphicsSettings={graphicsSettings}
      onChangeKeybinds={updateKeybinds}
      onUpdateSettings={updateSettings}
      onSelectGraphicsPreset={selectGraphicsPreset}
      onUpdateGraphicsSettings={updateGraphicsSettings}
      onResetGraphicsSettings={resetGraphicsSettings}
      onClose={() => setSettingsTab(null)}
    />
  );

  if (showHome) {
    return (
      <>
        <HomePage
          projects={projects}
          darkMode={project.settings.darkMode}
          keybinds={keybinds}
          onToggleDarkMode={() => updateSettings({ darkMode: !project.settings.darkMode })}
          onOpenProject={(id) => {
            openProject(id);
            setShowHome(false);
            setActiveTool('select');
            setFitSignal((s) => s + 1);
          }}
          onCreateProject={(tpl) => {
            createNewProject(tpl);
            setShowHome(false);
            setActiveTool('select');
            setFitSignal((s) => s + 1);
          }}
          onDuplicateProject={duplicateProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          onImportProjectFile={(file) => importJsonFileObject(file, true)}
          onOpenSettings={(tab = 'keybinds') => setSettingsTab(tab)}
        />
        {settingsModalEl}
      </>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* TOP BAR */}
      <header className="h-12 shrink-0 px-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 z-30">
        {/* Left: Home/Models, Sidebar toggle, Brand, Project Name, Level Switcher */}
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => setShowHome(true)}
            title="Back to Models Homepage"
            aria-label="Back to Models Homepage"
            className="px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Home className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Models</span>
          </button>

          <button
            type="button"
            onClick={() => setLeftOpen((o) => !o)}
            aria-label={leftOpen ? 'Collapse left sidebar' : 'Expand left sidebar'}
            className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {leftOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </button>

          <div className="flex items-center gap-2 pr-2 border-r border-slate-200 dark:border-slate-800 shrink-0">
            <div className="w-6 h-6 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center font-bold text-xs tracking-tight">
              PS
            </div>
            <span className="font-semibold text-sm tracking-tight hidden lg:inline">Plan Studio</span>
          </div>

          <input
            type="text"
            value={project.name}
            onChange={(e) =>
              commit((prev) => ({ ...prev, name: e.target.value }), true, 'Rename Project', 'rename-project')
            }
            aria-label="Project name"
            className="w-32 sm:w-44 px-2 py-1 text-xs font-medium bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-950 border border-transparent focus:border-blue-500 rounded focus:outline-none truncate"
          />

          <div className="hidden md:flex items-center gap-1 pl-2 border-l border-slate-200 dark:border-slate-800">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={activeLevel.id}
              onChange={(e) => switchLevel(e.target.value)}
              aria-label="Active floor level"
              className="px-2 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {project.levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Center: 2D / Wall View / 3D Switcher */}
        <div
          className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg shrink-0"
          role="tablist"
          aria-label="Viewport mode"
        >
          {(
            [
              { id: '2d', label: '2D Plan', title: '2D Floorplan Editor' },
              { id: 'split', label: 'Wall View', Icon: Columns, title: 'Wall View Elevation Viewer' },
              { id: '3d', label: '3D View', title: '3D Perspective & Walkthrough' },
            ] as const
          ).map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              title={v.title}
              aria-selected={viewMode === v.id}
              onClick={() => setViewMode(v.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                viewMode === v.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {'Icon' in v && v.Icon && <v.Icon className="w-3.5 h-3.5" />}
              <span>{v.label}</span>
            </button>
          ))}
        </div>

        {/* Right: Undo/Redo, History Steps, Templates, Export/Import, Theme, Right Panel */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden">
            <button
              type="button"
              disabled={!canUndo}
              onClick={undo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={redo}
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
              className="p-1.5 border-l border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowHistoryPanel((o) => !o)}
              title="Open History Steps Window"
              aria-label="Open History Steps"
              aria-pressed={showHistoryPanel}
              className={`px-2 py-1.5 border-l border-slate-200 dark:border-slate-700 flex items-center gap-1 text-[11px] font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                showHistoryPanel
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">History</span>
              <span className="font-mono-nums text-[10px] opacity-75">{historyIndex + 1}</span>
            </button>
          </div>

          {/* Templates Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowTemplateMenu((o) => !o);
                setShowExportMenu(false);
              }}
              aria-expanded={showTemplateMenu}
              className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <span>Templates</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {showTemplateMenu && (
              <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 z-50 text-xs">
                {(
                  [
                    { id: '1br', label: '1-Bedroom Apartment (70 m²)' },
                    { id: 'studio', label: 'Modern Studio (36 m²)' },
                    { id: '2br', label: '2-Bedroom Family Flat (96 m²)' },
                    { id: 'empty', label: 'Blank Metric Canvas' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      loadTemplate(t.id);
                      setShowTemplateMenu(false);
                      setFitSignal((s) => s + 1);
                      notify(`Loaded ${t.label}`);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Export / Import Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowExportMenu((o) => !o);
                setShowTemplateMenu(false);
              }}
              aria-expanded={showExportMenu}
              className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 z-50 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    void exportProjectJson(project).then(() =>
                      notify(`Exported ${project.name} JSON`)
                    );
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <FileJson className="w-3.5 h-3.5 text-blue-600" /> Export Project JSON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    jsonInputRef.current?.click();
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-amber-600" /> Import Project JSON
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <button
                  type="button"
                  onClick={() => {
                    exportSvgFromElement(svgRef.current, 'plan-studio-2d.svg');
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-emerald-600" /> Export 2D Plan SVG
                </button>
                <button
                  type="button"
                  onClick={() => {
                    exportSvgElementAsPng(svgRef.current, 'plan-studio-2d.png');
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-indigo-600" /> Export 2D Plan PNG
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const snap = capture3dFnRef.current?.();
                    if (snap) {
                      exportDataUrlPng(snap, 'plan-studio-3d.png');
                    } else {
                      notify('Switch to 3D view to capture a 3D PNG');
                    }
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-blue-600" /> Capture 3D View PNG
                </button>
                <button
                  type="button"
                  onClick={() => {
                    printArchitecturalSheet(
                      project.name,
                      activeLevel,
                      svgRef.current,
                      project.settings.scale
                    );
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-600" /> Print / Save PDF Sheet
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  3D Model Exports
                </div>
                {(
                  [
                    { format: 'glb', label: 'Export 3D Model (.GLB)' },
                    { format: 'gltf', label: 'Export 3D Scene (.GLTF)' },
                    { format: 'obj', label: 'Export 3D Mesh (.OBJ)' },
                    { format: 'stl', label: 'Export 3D Print (.STL)' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.format}
                    type="button"
                    data-testid={`export-3d-${item.format}`}
                    onClick={() => handleExport3DModel(item.format)}
                    className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                  >
                    <Box className="w-3.5 h-3.5 text-violet-600" /> {item.label}
                  </button>
                ))}
              </div>
            )}
            <input
              ref={jsonInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportJsonFile}
              className="hidden"
            />
          </div>

          <button
            type="button"
            onClick={() => setSettingsTab('keybinds')}
            title="Settings & Keybinds"
            aria-label="Open Settings and Keybinds"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => updateSettings({ darkMode: !project.settings.darkMode })}
            aria-label={project.settings.darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {project.settings.darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setRightOpen((o) => !o)}
            aria-label={rightOpen ? 'Collapse properties panel' : 'Expand properties panel'}
            className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {rightOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex min-h-0 relative">
        {/* LEFT SIDEBAR */}
        {leftOpen && (
          <aside className="w-[272px] shrink-0 h-full overflow-hidden z-10">
            <LeftSidebar
              project={project}
              activeLevel={activeLevel}
              selection={selection}
              onSelect={setSelection}
              onPlaceFurniture={placeFurnitureTemplate}
              onPlacePerson={handlePlacePerson}
              onPlaceArchElement={handlePlaceArchElement}
              onPlaceRailingPreset={handlePlaceRailingPreset}
              onUpdateLevel={updateActiveLevel}
              onOpenCustomBuilder={() => setShowCustomBuilder(true)}
              onOpenImporter={() => setShowImporter(true)}
              onToolChange={setActiveTool}
              onAddLevel={() => addLevel()}
              onSwitchLevel={switchLevel}
              onDeleteLevel={deleteLevel}
            />
          </aside>
        )}

        {/* CENTER VIEWPORT(S) */}
        <main className="flex-1 flex min-w-0 min-h-0 relative">
          {/* 2D CANVAS */}
          {viewMode === '2d' && (
            <div className="relative w-full h-full min-w-0 overflow-hidden">
              <Canvas2D
                level={activeLevel}
                settings={project.settings}
                activeTool={activeTool}
                pendingOpeningSpec={pendingOpeningSpec}
                activeRailingStyle={activeRailingStyle}
                selection={selection}
                zoomMultiplier={zoomMultiplier}
                fitSignal={fitSignal}
                svgRefExternal={svgRef}
                onSelect={setSelection}
                onToolChange={setActiveTool}
                onCursorCoords={setCursorCoordsMm}
                onZoomChange={setZoomMultiplier}
                onUpdateLevel={updateActiveLevel}
                onCommitDrag={commitDragStep}
                onCancelDrag={cancelDragPreview}
                onPickEyedropperColor={handlePickEyedropperColor}
                onCalibrateDistance={(measuredMm) => setCalibrateMeasuredMm(measuredMm)}
                onConstraintError={notify}
                onToggleBlackAndWhite={() =>
                  updateSettings({ blackAndWhite2d: !project.settings.blackAndWhite2d })
                }
              />

              <FloatingToolbox
                activeTool={activeTool}
                pendingOpeningSpec={pendingOpeningSpec}
                activeRailingStyle={activeRailingStyle}
                keybinds={keybinds}
                onSelectTool={setActiveTool}
                onSelectOpeningSpec={setPendingOpeningSpec}
                onSelectRailingStyle={setActiveRailingStyle}
              />
            </div>
          )}

          {/* WALL VIEW TAB: ARCHITECTURAL WALL ELEVATION VIEWER */}
          {viewMode === 'split' && (
            <div className="relative w-full h-full min-w-0 overflow-hidden">
              <WallCutThroughViewer
                level={activeLevel}
                settings={project.settings}
                selection={selection}
                onSelect={setSelection}
                onUpdateLevel={updateActiveLevel}
                onCommitDrag={commitDragStep}
                onCancelDrag={cancelDragPreview}
                onConstraintError={notify}
                onToggleBlackAndWhite={() =>
                  updateSettings({ blackAndWhite2d: !project.settings.blackAndWhite2d })
                }
              />
            </div>
          )}

          {/* 3D VIEWPORT (Camera & viewing only) */}
          {viewMode === '3d' && (
            <div className="relative w-full h-full min-w-0 overflow-hidden">
              <Viewport3D
                level={activeLevel}
                settings={project.settings}
                graphicsSettings={graphicsSettings}
                cameraPreset={cameraPreset}
                onCameraPresetChange={setCameraPreset}
                onUpdateSettings={updateSettings}
                onSelectGraphicsPreset={selectGraphicsPreset}
                onUpdateGraphicsSettings={updateGraphicsSettings}
                onResetGraphicsSettings={resetGraphicsSettings}
                onCanvasReady={(fn) => {
                  capture3dFnRef.current = fn;
                }}
              />
            </div>
          )}

          {/* Photoshop-Style History / Steps Floating Window */}
          {showHistoryPanel && (
            <HistoryPanel
              entries={historyEntries}
              activeIndex={historyIndex}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={undo}
              onRedo={redo}
              onJumpToStep={jumpToHistoryStep}
              onClose={() => setShowHistoryPanel(false)}
            />
          )}

          {/* Subtle Transient Notice Toast */}
          {statusNotice && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs shadow-lg pointer-events-none">
              {statusNotice}
            </div>
          )}
        </main>

        {/* RIGHT INSPECTOR */}
        {rightOpen && (
          <aside className="w-[296px] shrink-0 h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 overflow-y-auto z-10">
            <PropertiesInspector
              level={activeLevel}
              settings={project.settings}
              selection={selection}
              recentColors={project.recentColors}
              onSelect={setSelection}
              onUpdateLevel={updateActiveLevel}
              onDeleteSelected={deleteSelected}
              onDuplicateSelected={duplicateSelected}
              onAddRecentColor={addRecentColor}
              onActivateEyedropper={handleActivateEyedropper}
              onSaveToLibrary={(tpl) => {
                addCustomTemplate(tpl);
                notify(`Saved "${tpl.name}" to My Library`);
              }}
              onToolChange={setActiveTool}
              onOpenSvgEditor={(id) => setEditingSvgFurnId(id)}
              onConstraintError={notify}
            />
          </aside>
        )}
      </div>

      {/* BOTTOM METRIC TOOLBAR */}
      <BottomToolbar
        settings={project.settings}
        viewMode={viewMode}
        zoomMultiplier={zoomMultiplier}
        cursorCoordsMm={cursorCoordsMm}
        onUpdateSettings={updateSettings}
        onZoomChange={setZoomMultiplier}
        onFitToScreen={() => setFitSignal((s) => s + 1)}
      />

      {/* MODALS */}
      {showCustomBuilder && (
        <CustomFurnitureModal
          onClose={() => setShowCustomBuilder(false)}
          onSaveAndPlace={(tpl, place) => {
            addCustomTemplate(tpl);
            if (place) placeFurnitureTemplate(tpl);
            notify(`Saved "${tpl.name}" to My Library`);
          }}
        />
      )}

      {showImporter && (
        <ImporterModal
          onClose={() => setShowImporter(false)}
          onImportTemplate={(tpl, place) => {
            addCustomTemplate(tpl);
            if (place) placeFurnitureTemplate(tpl);
            notify(`Imported "${tpl.name}" to My Library`);
          }}
        />
      )}

      {editingSvgFurnId && (() => {
        const editingFurn = activeLevel.furniture.find((f) => f.id === editingSvgFurnId);
        if (!editingFurn) return null;
        return (
          <SvgRepresentationEditorModal
            furniture={editingFurn}
            onClose={() => setEditingSvgFurnId(null)}
            onSaveRepresentation={(nextRep) => {
              updateActiveLevel(
                (lvl) => ({
                  ...lvl,
                  furniture: lvl.furniture.map((f) =>
                    f.id === editingFurn.id ? { ...f, representation: nextRep } : f
                  ),
                }),
                false,
                true,
                `Edit 2D SVG (${editingFurn.name})`
              );
              notify(`Saved 2D SVG representation for "${editingFurn.name}"`);
            }}
          />
        );
      })()}

      {calibrateMeasuredMm !== null && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-4 space-y-3 text-xs">
            <h3 className="font-semibold text-sm">Calibrate Background Trace Scale</h3>
            <p className="text-slate-500">
              Enter the real-world length in meters (m) between the two points you just clicked.
            </p>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Real-World Length (m)</label>
              <input
                type="number"
                step="0.01"
                min="0.1"
                value={calibrateRealMeters}
                onChange={(e) => setCalibrateRealMeters(e.target.value)}
                className="w-full px-2.5 py-1.5 font-mono-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setCalibrateMeasuredMm(null);
                  setActiveTool('select');
                }}
                className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyTraceCalibration}
                className="px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium cursor-pointer"
              >
                Apply Scale
              </button>
            </div>
          </div>
        </div>
      )}
      {settingsModalEl}
    </div>
  );
}
