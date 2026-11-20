import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArchElement,
  CatalogTemplate,
  Curtain,
  FurnitureInstance,
  FurnitureRepresentation,
  Level,
  Opening,
  PersonInstance,
  Project,
  ProjectSettings,
  SelectionTarget,
  Wall,
} from '../types/plan';
import { buildEmptyLevel, createInitialProject } from '../data/templates';
import {
  detachChildrenOnParentDelete,
  detectRoomsFromWalls,
  getEffectiveFurnitureZOrder,
  isRugFurniture,
  resolveChimneyFaceColors,
} from '../utils/geometry';
import { cloneLightsWithFreshIds } from '../utils/lighting';
import { uid } from '../utils/units';
import {
  DEFAULT_KEYBINDS,
  KeybindMap,
  normalizeKeybindMap,
} from '../utils/keybinds';
import {
  applyGraphicsPreset,
  ConcreteGraphicsPresetId,
  DEFAULT_GRAPHICS_SETTINGS,
  GraphicsSettings,
  loadGraphicsSettings,
  saveGraphicsSettings,
  updateGraphicsSetting,
} from '../utils/graphicsSettings';
import { hydrateProjectAssets, stripInlineGlbForStorage } from '../utils/assetStore';
import { useAuth } from '../contexts/AuthContext';

const LEGACY_STORAGE_KEY = 'plan_studio_project_v1';
const PROJECTS_STORAGE_KEY = 'plan_studio_projects_v1';
const ACTIVE_ID_STORAGE_KEY = 'plan_studio_active_id_v1';
const KEYBINDS_STORAGE_KEY = 'plan_studio_keybinds_v1';
const MAX_HISTORY = 100;

export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: number;
  coalesceKey?: string;
  project: Project;
}

interface HistoryState {
  entries: HistoryEntry[];
  index: number;
}

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  preferredUnit: 'cm',
  scale: '1:50',
  gridSizeMm: 50,
  snapEnabled: true,
  angleSnapDeg: 15,
  orthoMode: false,
  autoDimensions: true,
  showGrid: true,
  cutawayEnabled: false,
  cutawayHeightMm: 1400,
  hideFrontWalls: false,
  fovDeg: 55,
  sunAzimuthDeg: 140,
  sunElevationDeg: 52,
  shadowsEnabled: true,
  darkMode: false,
  timeOfDay3d: 'day',
  blackAndWhite2d: false,
  walkEyeHeightMm: 1630,
  walkCollisionEnabled: true,
};

const DEFAULT_LEVEL_LAYERS: Level['layers'] = {
  walls: true,
  rooms: true,
  openings: true,
  furniture: true,
  curtains: true,
  people: true,
  archElements: true,
  measurements: true,
  annotations: true,
  autoDimensions: true,
  grid: true,
};

function normalizeProject(raw: Project): Project {
  const now = new Date().toISOString();
  const baseLevels = Array.isArray(raw.levels) && raw.levels.length > 0 ? raw.levels : [buildEmptyLevel('Ground Floor', 0)];
  const activeLevelId = baseLevels.some((l) => l.id === raw.activeLevelId)
    ? raw.activeLevelId
    : baseLevels[0].id;
  const rawSettings = (raw.settings ?? {}) as Partial<ProjectSettings>;
  return {
    ...raw,
    id: raw.id || uid('proj'),
    name: raw.name || 'Imported Project',
    createdAt: raw.createdAt || raw.updatedAt || now,
    updatedAt: raw.updatedAt || raw.createdAt || now,
    activeLevelId,
    customLibrary: Array.isArray(raw.customLibrary) ? raw.customLibrary : [],
    recentColors: Array.isArray(raw.recentColors) ? raw.recentColors : [],
    settings: {
      ...DEFAULT_PROJECT_SETTINGS,
      ...rawSettings,
      timeOfDay3d: rawSettings.timeOfDay3d ?? 'day',
      blackAndWhite2d: rawSettings.blackAndWhite2d ?? false,
      walkEyeHeightMm: rawSettings.walkEyeHeightMm ?? 1630,
      walkCollisionEnabled: rawSettings.walkCollisionEnabled ?? true,
    },
    levels: baseLevels.map((lvl, lIdx) => ({
      ...lvl,
      id: lvl.id || uid('lvl'),
      name: lvl.name || `Floor ${lIdx + 1}`,
      elevationMm: typeof lvl.elevationMm === 'number' ? lvl.elevationMm : 0,
      ceilingHeightMm: typeof lvl.ceilingHeightMm === 'number' ? lvl.ceilingHeightMm : 2800,
      walls: Array.isArray(lvl.walls) ? lvl.walls : [],
      rooms: Array.isArray(lvl.rooms) ? lvl.rooms : [],
      openings: Array.isArray(lvl.openings) ? lvl.openings : [],
      curtains: Array.isArray(lvl.curtains) ? lvl.curtains : [],
      people: Array.isArray(lvl.people) ? lvl.people : [],
      measurements: Array.isArray(lvl.measurements) ? lvl.measurements : [],
      annotations: Array.isArray(lvl.annotations) ? lvl.annotations : [],
      sectionLine: lvl.sectionLine ?? null,
      backgroundTrace: lvl.backgroundTrace ?? null,
      layers: {
        ...DEFAULT_LEVEL_LAYERS,
        ...((lvl.layers ?? {}) as Partial<Level['layers']>),
      },
      furniture: (lvl.furniture ?? []).map((f, idx) => {
        const withLight =
          f.category === 'Lighting' && !f.lightConfig
            ? { ...f, lightConfig: { enabled: true, colorTempK: 3200, intensity: 0.6 } }
            : f;
        const withRot = {
          ...withLight,
          rotationDeg: withLight.rotationDeg ?? 0,
          rotationXDeg: withLight.rotationXDeg ?? 0,
          rotationYDeg: withLight.rotationYDeg ?? 0,
          lights: Array.isArray(withLight.lights)
            ? withLight.lights.map((l) => ({ ...l }))
            : undefined,
          glbEmissiveOverrides: Array.isArray(withLight.glbEmissiveOverrides)
            ? withLight.glbEmissiveOverrides.map((ov) => ({
                ...ov,
                meshNames: Array.isArray(ov.meshNames) ? [...ov.meshNames] : [],
              }))
            : undefined,
        };
        return typeof withRot.zOrder === 'number'
          ? withRot
          : {
              ...withRot,
              zOrder: isRugFurniture(withRot) ? -1000 + idx : idx,
            };
      }),
      archElements: (lvl.archElements ?? []).map((a) =>
        a.type === 'chimney' && !a.faceColors
          ? { ...a, faceColors: resolveChimneyFaceColors(a) }
          : a
      ),
    })),
  };
}

function seedStarterProjects(): Project[] {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();
  return [
    createInitialProject('1br', {
      createdAt: iso(1000 * 60 * 60 * 24 * 3),
      updatedAt: iso(1000 * 60 * 42),
    }),
    createInitialProject('studio', {
      createdAt: iso(1000 * 60 * 60 * 24 * 6),
      updatedAt: iso(1000 * 60 * 60 * 5),
    }),
    createInitialProject('2br', {
      createdAt: iso(1000 * 60 * 60 * 24 * 12),
      updatedAt: iso(1000 * 60 * 60 * 24 * 2),
    }),
  ];
}

export function loadSavedProjects(): { projects: Project[]; activeId: string } {
  try {
    const rawList = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (rawList) {
      const parsed = JSON.parse(rawList) as Project[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed
          .filter((p) => p && Array.isArray(p.levels) && p.levels.length > 0)
          .map(normalizeProject);
        if (normalized.length > 0) {
          const savedActive = localStorage.getItem(ACTIVE_ID_STORAGE_KEY);
          const validActive =
            savedActive && normalized.some((p) => p.id === savedActive)
              ? savedActive
              : normalized[0].id;
          return { projects: normalized, activeId: validActive };
        }
      }
    }

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Project;
      if (legacy && Array.isArray(legacy.levels) && legacy.levels.length > 0) {
        const migrated = normalizeProject(legacy);
        const seeded = seedStarterProjects().filter((s) => s.id !== migrated.id);
        return { projects: [migrated, ...seeded], activeId: migrated.id };
      }
    }
  } catch {
    // ignore corrupted localStorage and fall back to starter models
  }

  const starters = seedStarterProjects();
  return { projects: starters, activeId: starters[0].id };
}

function loadSavedKeybinds(): KeybindMap {
  try {
    const raw = localStorage.getItem(KEYBINDS_STORAGE_KEY);
    if (raw) {
      return normalizeKeybindMap(JSON.parse(raw) as Record<string, string>);
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_KEYBINDS };
}

export function usePlanState() {
  const { user, getIdToken } = useAuth();
  const [initialState] = useState(() => loadSavedProjects());
  const [projects, setProjects] = useState<Project[]>(initialState.projects);
  const [history, setHistory] = useState<HistoryState>(() => {
    const startProj =
      initialState.projects.find((p) => p.id === initialState.activeId) ??
      initialState.projects[0];
    return {
      entries: [
        {
          id: uid('step'),
          label: 'Open Model',
          timestamp: Date.now(),
          project: startProj,
        },
      ],
      index: 0,
    };
  });
  const [previewProject, setPreviewProject] = useState<Project | null>(null);
  const previewProjectRef = useRef<Project | null>(null);
  const project = previewProject ?? history.entries[history.index].project;
  const [keybinds, setKeybindsState] = useState<KeybindMap>(() => loadSavedKeybinds());
  const [graphicsSettings, setGraphicsSettings] = useState<GraphicsSettings>(() => loadGraphicsSettings());
  const [selection, setSelection] = useState<SelectionTarget[]>([]);
  const [clipboard, setClipboard] = useState<{
    furniture: FurnitureInstance[];
    people: PersonInstance[];
    curtains: Curtain[];
    archElements: ArchElement[];
  } | null>(null);

  const syncedUidRef = useRef<string | null>(null);
  const dirtyProjectIdsRef = useRef<Set<string>>(new Set());

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (project.settings.darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [project.settings.darkMode]);

  // Keep active project synced into projects list
  useEffect(() => {
    setProjects((prev) => {
      const idx = prev.findIndex((p) => p.id === project.id);
      if (idx === -1) return [project, ...prev];
      if (prev[idx] === project) return prev;
      const next = [...prev];
      next[idx] = project;
      return next;
    });
  }, [project]);

  // Hydrate GLB assets from IndexedDB into in-memory cache on startup / project switch
  useEffect(() => {
    void hydrateProjectAssets(project);
  }, [project.id]);

  // Persist locally to localStorage (strip oversized inline GLBs when glbAssetId exists in IndexedDB)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const compactProjects = projects.map(stripInlineGlbForStorage);
        const compactActive = stripInlineGlbForStorage(project);
        localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(compactProjects));
        localStorage.setItem(ACTIVE_ID_STORAGE_KEY, project.id);
        localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(compactActive));
      } catch {
        // ignore quota errors
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [projects, project]);

  useEffect(() => {
    try {
      localStorage.setItem(KEYBINDS_STORAGE_KEY, JSON.stringify(keybinds));
    } catch {
      // ignore
    }
  }, [keybinds]);

  useEffect(() => {
    saveGraphicsSettings(graphicsSettings);
  }, [graphicsSettings]);

  // Helper to make authenticated API calls to PostgreSQL backend
  const authedFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const token = await getIdToken();
      if (!token) return null;
      return fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
    },
    [getIdToken]
  );

  // Sync from PostgreSQL when authenticated user logs in
  useEffect(() => {
    if (!user) {
      syncedUidRef.current = null;
      return;
    }
    if (syncedUidRef.current === user.uid) return;
    syncedUidRef.current = user.uid;

    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/models');
        if (!res || !res.ok || cancelled) return;
        const data = (await res.json()) as {
          models?: Project[];
          keybinds?: Record<string, string> | null;
        };

        if (cancelled) return;

        if (data.keybinds) {
          setKeybindsState(normalizeKeybindMap(data.keybinds));
        }

        if (Array.isArray(data.models) && data.models.length > 0) {
          const remote = data.models.map(normalizeProject);
          remote.forEach((p) => {
            void hydrateProjectAssets(p);
          });
          setProjects(remote);
          setHistory((h) => {
            const cur = h.entries[h.index].project;
            const matched = remote.find((r) => r.id === cur.id) ?? remote[0];
            return {
              entries: [
                {
                  id: uid('step'),
                  label: 'Sync Cloud Model',
                  timestamp: Date.now(),
                  project: matched,
                },
              ],
              index: 0,
            };
          });
          setPreviewProject(null);
        } else {
          // Seed existing local/starter models into user's database on first sign-in
          await authedFetch('/api/models/batch', {
            method: 'POST',
            body: JSON.stringify({ models: projects }),
          });
        }
      } catch {
        // Silent fallback to local cache if network unavailable
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authedFetch, projects]);

  // Debounced auto-save of dirty project to PostgreSQL when signed in
  useEffect(() => {
    if (!user) return;
    dirtyProjectIdsRef.current.add(project.id);
    const timer = window.setTimeout(async () => {
      const ids = Array.from(dirtyProjectIdsRef.current);
      dirtyProjectIdsRef.current.clear();
      for (const id of ids) {
        const target = projects.find((p) => p.id === id) ?? (project.id === id ? project : null);
        if (!target) continue;
        try {
          await authedFetch(`/api/models/${encodeURIComponent(target.id)}`, {
            method: 'PUT',
            body: JSON.stringify({ project: target }),
          });
        } catch {
          // ignore transient save failure; will retry on next edit
        }
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [user, project, projects, authedFetch]);

  const updateKeybinds = useCallback(
    (next: KeybindMap) => {
      const normalized = normalizeKeybindMap(next);
      setKeybindsState(normalized);
      if (user) {
        void authedFetch('/api/user/keybinds', {
          method: 'PUT',
          body: JSON.stringify({ keybinds: normalized }),
        }).catch(() => {});
      }
    },
    [user, authedFetch]
  );

  const selectGraphicsPreset = useCallback((presetId: ConcreteGraphicsPresetId) => {
    setGraphicsSettings(applyGraphicsPreset(presetId));
  }, []);

  const updateGraphicsSettings = useCallback((partial: Partial<GraphicsSettings>) => {
    setGraphicsSettings((prev) => updateGraphicsSetting(prev, partial));
  }, []);

  const resetGraphicsSettings = useCallback(() => {
    setGraphicsSettings({ ...DEFAULT_GRAPHICS_SETTINGS });
  }, []);

  const activeLevel: Level =
    project.levels.find((l) => l.id === project.activeLevelId) ?? project.levels[0];

  const resetHistory = useCallback((nextProject: Project, label = 'Open Model') => {
    setPreviewProject(null);
    setHistory({
      entries: [
        {
          id: uid('step'),
          label,
          timestamp: Date.now(),
          project: nextProject,
        },
      ],
      index: 0,
    });
  }, []);

  const commit = useCallback(
    (
      updater: (prev: Project) => Project,
      recordHistory = true,
      label = 'Edit Model',
      coalesceKey?: string
    ) => {
      if (!recordHistory) {
        setPreviewProject((curPrev) => {
          const base = curPrev ?? history.entries[history.index].project;
          const next = updater(base);
          if (next === base) return curPrev;
          const now = new Date().toISOString();
          const updated = {
            ...next,
            createdAt: next.createdAt || base.createdAt || now,
            updatedAt: now,
          };
          previewProjectRef.current = updated;
          return updated;
        });
        return;
      }

      previewProjectRef.current = null;
      setPreviewProject(null);
      setHistory((h) => {
        const prev = h.entries[h.index].project;
        const rawNext = updater(prev);
        if (rawNext === prev) return h;
        const nowIso = new Date().toISOString();
        const next: Project = {
          ...rawNext,
          createdAt: rawNext.createdAt || prev.createdAt || nowIso,
          updatedAt: nowIso,
        };
        const nowMs = Date.now();
        const curEntry = h.entries[h.index];
        if (
          coalesceKey &&
          h.index > 0 &&
          curEntry.coalesceKey === coalesceKey &&
          nowMs - curEntry.timestamp < 750
        ) {
          const updatedEntries = [...h.entries.slice(0, h.index), {
            ...curEntry,
            label,
            timestamp: nowMs,
            project: next,
          }];
          return { entries: updatedEntries, index: updatedEntries.length - 1 };
        }
        const trimmed = h.entries.slice(0, h.index + 1);
        const nextEntries = [
          ...trimmed,
          { id: uid('step'), label, timestamp: nowMs, coalesceKey, project: next },
        ].slice(-MAX_HISTORY);
        return {
          entries: nextEntries,
          index: nextEntries.length - 1,
        };
      });
    },
    [history.entries, history.index]
  );

  const commitDragStep = useCallback((label = 'Move Object') => {
    const dragged = previewProjectRef.current;
    previewProjectRef.current = null;
    setPreviewProject(null);
    if (!dragged) return;
    setHistory((h) => {
      const base = h.entries[h.index].project;
      if (dragged === base) return h;
      const trimmed = h.entries.slice(0, h.index + 1);
      const nextEntries = [
        ...trimmed,
        { id: uid('step'), label, timestamp: Date.now(), project: dragged },
      ].slice(-MAX_HISTORY);
      return {
        entries: nextEntries,
        index: nextEntries.length - 1,
      };
    });
  }, []);

  const cancelDragPreview = useCallback(() => {
    previewProjectRef.current = null;
    setPreviewProject(null);
  }, []);

  const updateActiveLevel = useCallback(
    (
      updater: (level: Level) => Level,
      recomputeRooms = false,
      recordHistory = true,
      label = 'Edit Plan',
      coalesceKey?: string
    ) => {
      commit(
        (prev) => {
          const idx = prev.levels.findIndex((l) => l.id === prev.activeLevelId);
          const targetIdx = idx >= 0 ? idx : 0;
          const currentLevel = prev.levels[targetIdx];
          let nextLevel = updater(currentLevel);
          if (recomputeRooms) {
            nextLevel = {
              ...nextLevel,
              rooms: detectRoomsFromWalls(
                nextLevel.walls,
                nextLevel.rooms,
                nextLevel.ceilingHeightMm
              ),
            };
          }
          const nextLevels = [...prev.levels];
          nextLevels[targetIdx] = nextLevel;
          return { ...prev, levels: nextLevels };
        },
        recordHistory,
        label,
        coalesceKey
      );
    },
    [commit]
  );

  // Silent in-place cache update for background 3D-to-SVG extraction (does NOT create an undo step and preserves customViews)
  const silentlyPatchFurnitureRepresentations = useCallback(
    (
      levelId: string,
      patches: Array<{ furnitureId: string; representation: FurnitureRepresentation }>
    ) => {
      if (patches.length === 0) return;
      const patchMap = new Map(patches.map((p) => [p.furnitureId, p.representation]));
      const applyToProject = (proj: Project): Project => {
        let projChanged = false;
        const nextLevels = proj.levels.map((lvl) => {
          if (lvl.id !== levelId) return lvl;
          let lvlChanged = false;
          const nextFurn = lvl.furniture.map((f) => {
            const rep = patchMap.get(f.id);
            if (!rep) return f;
            lvlChanged = true;
            // Strictly preserve any existing defaultViews and customViews on the instance
            const mergedRep: FurnitureRepresentation = {
              ...rep,
              defaultViews: f.representation?.defaultViews ?? rep.defaultViews,
              autoViews: rep.autoViews ?? f.representation?.autoViews,
              customViews: f.representation?.customViews ?? rep.customViews,
              customViewUpdatedAt: f.representation?.customViewUpdatedAt ?? rep.customViewUpdatedAt,
              useMaterialFill: f.representation?.useMaterialFill ?? rep.useMaterialFill,
            };
            return { ...f, representation: mergedRep };
          });
          if (!lvlChanged) return lvl;
          projChanged = true;
          return { ...lvl, furniture: nextFurn };
        });
        return projChanged ? { ...proj, levels: nextLevels } : proj;
      };

      setHistory((h) => {
        const curEntry = h.entries[h.index];
        const nextProj = applyToProject(curEntry.project);
        if (nextProj === curEntry.project) return h;
        const nextEntries = [...h.entries];
        nextEntries[h.index] = { ...curEntry, project: nextProj };
        return { ...h, entries: nextEntries };
      });

      setPreviewProject((curPrev) => {
        if (!curPrev) return curPrev;
        const nextPrev = applyToProject(curPrev);
        previewProjectRef.current = nextPrev;
        return nextPrev;
      });
    },
    []
  );

  const undo = useCallback(() => {
    setPreviewProject(null);
    setHistory((h) => (h.index > 0 ? { ...h, index: h.index - 1 } : h));
    setSelection([]);
  }, []);

  const redo = useCallback(() => {
    setPreviewProject(null);
    setHistory((h) => (h.index < h.entries.length - 1 ? { ...h, index: h.index + 1 } : h));
    setSelection([]);
  }, []);

  const jumpToHistoryStep = useCallback((targetIndex: number) => {
    setPreviewProject(null);
    setHistory((h) => {
      if (targetIndex < 0 || targetIndex >= h.entries.length || targetIndex === h.index) return h;
      return { ...h, index: targetIndex };
    });
    setSelection([]);
  }, []);

  const updateSettings = useCallback(
    (partial: Partial<ProjectSettings>, label = 'Change Settings', coalesceKey?: string) => {
      commit(
        (prev) => ({
          ...prev,
          settings: { ...prev.settings, ...partial },
        }),
        true,
        label,
        coalesceKey ?? (Object.keys(partial).length === 1 ? `setting_${Object.keys(partial)[0]}` : undefined)
      );
    },
    [commit]
  );

  const addRecentColor = useCallback(
    (hex: string) => {
      const normalized = hex.toUpperCase();
      commit(
        (prev) => ({
          ...prev,
          recentColors: [normalized, ...prev.recentColors.filter((c) => c !== normalized)].slice(0, 12),
        }),
        false
      );
    },
    [commit]
  );

  const addLevel = useCallback(
    (name?: string) => {
      commit(
        (prev) => {
          const topElev = prev.levels.reduce(
            (max, l) => Math.max(max, l.elevationMm + l.ceilingHeightMm),
            0
          );
          const newLvl = buildEmptyLevel(
            name ?? `Floor ${prev.levels.length + 1} (${(topElev / 1000).toFixed(2)} m)`,
            topElev
          );
          return {
            ...prev,
            levels: [...prev.levels, newLvl],
            activeLevelId: newLvl.id,
          };
        },
        true,
        'Add Floor Level'
      );
      setSelection([]);
    },
    [commit]
  );

  const switchLevel = useCallback(
    (levelId: string) => {
      commit(
        (prev) => {
          if (prev.activeLevelId === levelId) return prev;
          return { ...prev, activeLevelId: levelId };
        },
        true,
        'Switch Floor Level'
      );
      setSelection([]);
    },
    [commit]
  );

  const deleteLevel = useCallback(
    (levelId: string) => {
      commit(
        (prev) => {
          if (prev.levels.length <= 1) return prev;
          const remaining = prev.levels.filter((l) => l.id !== levelId);
          return {
            ...prev,
            levels: remaining,
            activeLevelId:
              prev.activeLevelId === levelId ? remaining[0].id : prev.activeLevelId,
          };
        },
        true,
        'Delete Floor Level'
      );
      setSelection([]);
    },
    [commit]
  );

  const deleteSelected = useCallback(() => {
    if (selection.length === 0) return;
    const wallIds = new Set(selection.filter((s) => s.kind === 'wall').map((s) => s.id));
    const openingIds = new Set(selection.filter((s) => s.kind === 'opening').map((s) => s.id));
    const curtainIds = new Set(selection.filter((s) => s.kind === 'curtain').map((s) => s.id));
    const furnSelections = selection.filter((s) => s.kind === 'furniture');
    const personIds = new Set(selection.filter((s) => s.kind === 'person').map((s) => s.id));
    const archIds = new Set(selection.filter((s) => s.kind === 'arch').map((s) => s.id));
    const measIds = new Set(selection.filter((s) => s.kind === 'measurement').map((s) => s.id));
    const noteIds = new Set(selection.filter((s) => s.kind === 'annotation').map((s) => s.id));

    updateActiveLevel(
      (lvl) => {
        let nextFurniture = lvl.furniture;
        const deletedFurnIds = new Set<string>();
        for (const fs of furnSelections) {
          if (fs.kind !== 'furniture') continue;
          if (fs.partId) {
            nextFurniture = nextFurniture.map((f) => {
              if (f.id !== fs.id || f.locked) return f;
              if (f.parts.length <= 1) return f;
              return { ...f, parts: f.parts.filter((p) => p.id !== fs.partId) };
            });
          } else {
            const target = nextFurniture.find((f) => f.id === fs.id);
            if (target && !target.locked) {
              deletedFurnIds.add(fs.id);
            }
            nextFurniture = nextFurniture.filter((f) => f.id !== fs.id || f.locked);
          }
        }

        const nextWalls = lvl.walls.filter((w) => !wallIds.has(w.id) || w.locked);
        const survivingWallIds = new Set(nextWalls.map((w) => w.id));
        const deletedWallIds = new Set<string>();
        for (const w of lvl.walls) {
          if (wallIds.has(w.id) && !w.locked && !survivingWallIds.has(w.id)) {
            deletedWallIds.add(w.id);
          }
        }
        nextFurniture = detachChildrenOnParentDelete(
          nextFurniture,
          deletedWallIds,
          deletedFurnIds
        );

        return {
          ...lvl,
          walls: nextWalls,
          openings: lvl.openings.filter(
            (o) => (!openingIds.has(o.id) || o.locked) && survivingWallIds.has(o.wallId)
          ),
          curtains: lvl.curtains.filter((c) => !curtainIds.has(c.id) || c.locked),
          furniture: nextFurniture,
          people: lvl.people.filter((p) => !personIds.has(p.id) || p.locked),
          archElements: lvl.archElements.filter((a) => !archIds.has(a.id) || a.locked),
          measurements: lvl.measurements.filter((m) => !measIds.has(m.id)),
          annotations: lvl.annotations.filter((a) => !noteIds.has(a.id)),
        };
      },
      wallIds.size > 0,
      true,
      'Delete Selection'
    );
    setSelection([]);
  }, [selection, updateActiveLevel]);

  const copySelected = useCallback(() => {
    if (selection.length === 0) return;
    const fIds = new Set(selection.filter((s) => s.kind === 'furniture').map((s) => s.id));
    const pIds = new Set(selection.filter((s) => s.kind === 'person').map((s) => s.id));
    const cIds = new Set(selection.filter((s) => s.kind === 'curtain').map((s) => s.id));
    const aIds = new Set(selection.filter((s) => s.kind === 'arch').map((s) => s.id));

    setClipboard({
      furniture: activeLevel.furniture.filter((f) => fIds.has(f.id)),
      people: activeLevel.people.filter((p) => pIds.has(p.id)),
      curtains: activeLevel.curtains.filter((c) => cIds.has(c.id)),
      archElements: activeLevel.archElements.filter((a) => aIds.has(a.id)),
    });
  }, [selection, activeLevel]);

  const pasteClipboard = useCallback(
    (offsetMm = 300) => {
      if (!clipboard) return;
      const newSelection: SelectionTarget[] = [];
      updateActiveLevel((lvl) => {
        const maxZ = lvl.furniture.reduce(
          (m, item, i) => Math.max(m, getEffectiveFurnitureZOrder(item, i)),
          0
        );
        const idMap = new Map<string, string>();
        for (const f of clipboard.furniture) {
          idMap.set(f.id, uid('furn'));
        }
        const newFurn = clipboard.furniture.map((f, i) => {
          const id = idMap.get(f.id)!;
          newSelection.push({ kind: 'furniture', id });
          const remappedHostId =
            f.surfaceHostId && idMap.has(f.surfaceHostId)
              ? idMap.get(f.surfaceHostId)
              : undefined;
          const hadDetachedSurface = Boolean(f.surfaceHostId && !remappedHostId);
          return {
            ...f,
            id,
            xMm: f.xMm + offsetMm,
            yMm: f.yMm + offsetMm,
            zOrder: isRugFurniture(f) ? getEffectiveFurnitureZOrder(f, i) : maxZ + 1 + i,
            attachedWallId: undefined,
            attachedFace: undefined,
            attachedT: undefined,
            surfaceHostId: remappedHostId,
            surfaceLocalXMm: remappedHostId ? f.surfaceLocalXMm : undefined,
            surfaceLocalYMm: remappedHostId ? f.surfaceLocalYMm : undefined,
            surfaceLocalRotDeg: remappedHostId ? f.surfaceLocalRotDeg : undefined,
            elevationMm: hadDetachedSurface ? 0 : f.elevationMm,
            parts: f.parts.map((p) => ({ ...p })),
            lights: cloneLightsWithFreshIds(f.lights),
            glbEmissiveOverrides: f.glbEmissiveOverrides
              ? f.glbEmissiveOverrides.map((ov) => ({
                  ...ov,
                  meshNames: [...ov.meshNames],
                }))
              : undefined,
            representation: f.representation
              ? JSON.parse(JSON.stringify(f.representation))
              : undefined,
          };
        });
        const newPeople = clipboard.people.map((p) => {
          const id = uid('person');
          newSelection.push({ kind: 'person', id });
          return { ...p, id, xMm: p.xMm + offsetMm, yMm: p.yMm + offsetMm };
        });
        const newCurtains = clipboard.curtains.map((c) => {
          const id = uid('curt');
          newSelection.push({ kind: 'curtain', id });
          return { ...c, id, xMm: c.xMm + offsetMm, yMm: c.yMm + offsetMm };
        });
        const newArch = clipboard.archElements.map((a) => {
          const id = uid('arch');
          newSelection.push({ kind: 'arch', id });
          return { ...a, id, xMm: a.xMm + offsetMm, yMm: a.yMm + offsetMm };
        });
        return {
          ...lvl,
          furniture: [...lvl.furniture, ...newFurn],
          people: [...lvl.people, ...newPeople],
          curtains: [...lvl.curtains, ...newCurtains],
          archElements: [...lvl.archElements, ...newArch],
        };
      }, false, true, 'Paste Items');
      if (newSelection.length > 0) setSelection(newSelection);
    },
    [clipboard, updateActiveLevel]
  );

  const duplicateSelected = useCallback(() => {
    const fIds = new Set(selection.filter((s) => s.kind === 'furniture').map((s) => s.id));
    const pIds = new Set(selection.filter((s) => s.kind === 'person').map((s) => s.id));
    const cIds = new Set(selection.filter((s) => s.kind === 'curtain').map((s) => s.id));
    const aIds = new Set(selection.filter((s) => s.kind === 'arch').map((s) => s.id));
    const newSelection: SelectionTarget[] = [];

    updateActiveLevel((lvl) => {
      const maxZ = lvl.furniture.reduce(
        (m, item, i) => Math.max(m, getEffectiveFurnitureZOrder(item, i)),
        0
      );
      const sourceFurn = lvl.furniture.filter((f) => fIds.has(f.id));
      const idMap = new Map<string, string>();
      for (const f of sourceFurn) {
        idMap.set(f.id, uid('furn'));
      }
      const newFurn = sourceFurn.map((f, i) => {
        const id = idMap.get(f.id)!;
        newSelection.push({ kind: 'furniture', id });
        const remappedHostId =
          f.surfaceHostId && idMap.has(f.surfaceHostId)
            ? idMap.get(f.surfaceHostId)
            : undefined;
        const hadDetachedSurface = Boolean(f.surfaceHostId && !remappedHostId);
        return {
          ...f,
          id,
          xMm: f.xMm + 300,
          yMm: f.yMm + 300,
          zOrder: isRugFurniture(f) ? getEffectiveFurnitureZOrder(f, i) : maxZ + 1 + i,
          attachedWallId: undefined,
          attachedFace: undefined,
          attachedT: undefined,
          surfaceHostId: remappedHostId,
          surfaceLocalXMm: remappedHostId ? f.surfaceLocalXMm : undefined,
          surfaceLocalYMm: remappedHostId ? f.surfaceLocalYMm : undefined,
          surfaceLocalRotDeg: remappedHostId ? f.surfaceLocalRotDeg : undefined,
          elevationMm: hadDetachedSurface ? 0 : f.elevationMm,
          parts: f.parts.map((p) => ({ ...p })),
          lights: cloneLightsWithFreshIds(f.lights),
          glbEmissiveOverrides: f.glbEmissiveOverrides
            ? f.glbEmissiveOverrides.map((ov) => ({
                ...ov,
                meshNames: [...ov.meshNames],
              }))
            : undefined,
          representation: f.representation
            ? JSON.parse(JSON.stringify(f.representation))
            : undefined,
        };
      });
      const newPeople = lvl.people
        .filter((p) => pIds.has(p.id))
        .map((p) => {
          const id = uid('person');
          newSelection.push({ kind: 'person', id });
          return { ...p, id, xMm: p.xMm + 300, yMm: p.yMm + 300 };
        });
      const newCurtains = lvl.curtains
        .filter((c) => cIds.has(c.id))
        .map((c) => {
          const id = uid('curt');
          newSelection.push({ kind: 'curtain', id });
          return { ...c, id, xMm: c.xMm + 300, yMm: c.yMm + 300 };
        });
      const newArch = lvl.archElements
        .filter((a) => aIds.has(a.id))
        .map((a) => {
          const id = uid('arch');
          newSelection.push({ kind: 'arch', id });
          return { ...a, id, xMm: a.xMm + 300, yMm: a.yMm + 300 };
        });
      return {
        ...lvl,
        furniture: [...lvl.furniture, ...newFurn],
        people: [...lvl.people, ...newPeople],
        curtains: [...lvl.curtains, ...newCurtains],
        archElements: [...lvl.archElements, ...newArch],
      };
    }, false, true, 'Duplicate Selection');
    if (newSelection.length > 0) setSelection(newSelection);
  }, [selection, updateActiveLevel]);

  const addCustomTemplate = useCallback(
    (tpl: CatalogTemplate) => {
      commit(
        (prev) => ({
          ...prev,
          customLibrary: [tpl, ...prev.customLibrary.filter((c) => c.id !== tpl.id)],
        }),
        true,
        `Save "${tpl.name}" to Library`
      );
    },
    [commit]
  );

  // Multi-project gallery operations (synced to PostgreSQL when signed in)
  const openProject = useCallback(
    (id: string) => {
      const target = projects.find((p) => p.id === id);
      if (!target) return;
      resetHistory(target, `Open "${target.name}"`);
      setSelection([]);
    },
    [projects, resetHistory]
  );

  const createNewProject = useCallback(
    (template: '1br' | 'studio' | '2br' | 'empty', customName?: string): Project => {
      const now = new Date().toISOString();
      const created = createInitialProject(template, { createdAt: now, updatedAt: now });
      if (customName) created.name = customName;
      setProjects((prev) => [created, ...prev]);
      resetHistory(created, 'Create Project');
      setSelection([]);
      if (user) {
        void authedFetch(`/api/models/${encodeURIComponent(created.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ project: created }),
        }).catch(() => {});
      }
      return created;
    },
    [user, authedFetch, resetHistory]
  );

  const duplicateProject = useCallback(
    (id: string) => {
      const src = projects.find((p) => p.id === id);
      if (!src) return;
      const now = new Date().toISOString();
      const copy: Project = {
        ...JSON.parse(JSON.stringify(src)),
        id: uid('proj'),
        name: `${src.name} (Copy)`,
        createdAt: now,
        updatedAt: now,
      };
      setProjects((prev) => [copy, ...prev]);
      if (user) {
        void authedFetch(`/api/models/${encodeURIComponent(copy.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ project: copy }),
        }).catch(() => {});
      }
    },
    [projects, user, authedFetch]
  );

  const renameProject = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const now = new Date().toISOString();
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: trimmed, updatedAt: now } : p))
      );
      if (project.id === id) {
        commit(
          (cur) => ({ ...cur, name: trimmed }),
          true,
          'Rename Project',
          'rename-project'
        );
      }
      const target = projects.find((p) => p.id === id);
      if (user && target) {
        void authedFetch(`/api/models/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify({ project: { ...target, name: trimmed, updatedAt: now } }),
        }).catch(() => {});
      }
    },
    [projects, project.id, commit, user, authedFetch]
  );

  const deleteProject = useCallback(
    (id: string) => {
      if (user) {
        void authedFetch(`/api/models/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        }).catch(() => {});
      }
      setProjects((prev) => {
        const remaining = prev.filter((p) => p.id !== id);
        if (remaining.length === 0) {
          const fresh = createInitialProject('empty');
          resetHistory(fresh, 'New Empty Project');
          setSelection([]);
          if (user) {
            void authedFetch(`/api/models/${encodeURIComponent(fresh.id)}`, {
              method: 'PUT',
              body: JSON.stringify({ project: fresh }),
            }).catch(() => {});
          }
          return [fresh];
        }
        if (project.id === id) {
          resetHistory(remaining[0], `Open "${remaining[0].name}"`);
          setSelection([]);
        }
        return remaining;
      });
    },
    [project.id, user, authedFetch, resetHistory]
  );

  const loadTemplate = useCallback(
    (template: '1br' | 'studio' | '2br' | 'empty') => {
      const created = createInitialProject(template);
      commit(
        () => ({
          ...created,
          id: project.id,
          createdAt: project.createdAt,
        }),
        true,
        `Load Template (${template})`
      );
      setSelection([]);
    },
    [commit, project.id, project.createdAt]
  );

  const importProjectJson = useCallback(
    (imported: Project) => {
      const now = new Date().toISOString();
      const baseNormalized = normalizeProject(imported);
      const normalized: Project = {
        ...baseNormalized,
        id: uid('proj'),
        createdAt: imported.createdAt || now,
        updatedAt: now,
      };
      void hydrateProjectAssets(normalized);
      setProjects((prev) => [normalized, ...prev]);
      resetHistory(normalized, `Import "${normalized.name}"`);
      setSelection([]);
      if (user) {
        void authedFetch(`/api/models/${encodeURIComponent(normalized.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ project: normalized }),
        }).catch(() => {});
      }
    },
    [user, authedFetch, resetHistory]
  );

  const updateWalls = useCallback(
    (
      updater: (walls: Wall[], openings: Opening[]) => { walls: Wall[]; openings?: Opening[] },
      label = 'Update Walls'
    ) => {
      updateActiveLevel(
        (lvl) => {
          const res = updater(lvl.walls, lvl.openings);
          return {
            ...lvl,
            walls: res.walls,
            openings: res.openings ?? lvl.openings,
          };
        },
        true,
        true,
        label
      );
    },
    [updateActiveLevel]
  );

  return {
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
    historyEntries: history.entries,
    historyIndex: history.index,
    canUndo: history.index > 0,
    canRedo: history.index < history.entries.length - 1,
    undo,
    redo,
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
    updateWalls,
  };
}
