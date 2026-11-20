# AI_HANDOFF.md — Continuous Agent Context Torch

> **PURPOSE**: Machine-dense architectural memory and continuity ledger strictly for downstream AI Studio agents.
> **PROTOCOL**:
> 1. **READ THIS FILE COMPLETELY FIRST** before editing any code on every turn.
> 2. **APPEND A SEQUENTIAL NUMBERED ENTRY (`#N`)** under `## Change Ledger` before ending any turn that modifies code/docs (never overwrite prior entries; summarize compactly).
> 3. **STRICT BOUNDARIES**:
>    - **3D Viewport (`src/components/Viewport3D.tsx`) IS STRICTLY VIEW-ONLY**: NEVER add drag-to-move, rotation gizmos, tilt handles, resize controls, or object manipulation interactions to 3D mode.
>    - **ALL object editing** occurs in **2D (`src/components/Canvas2D.tsx`)**, **Wall View (`src/components/WallCutThroughViewer.tsx`)**, **Properties Inspector (`src/components/PropertiesInspector.tsx`)**, or the **2D SVG Editor modal**.
>    - **Sequential Milestones Only**: Complete and verify ONLY the currently requested milestone; do NOT implement future milestones unless explicitly instructed.
>    - **Preserve Existing Systems**: Maintain Revision 9 2D–3D parity, IndexedDB binary GLB cache, 5-view SVG pipeline, undo/redo history, constraint solvers, and black-on-white architectural styles.

---

## Project Baseline & Architecture Summary

- **Stack**: React 19 + TypeScript + Vite (`5.4+` / `6`) + Tailwind CSS v4 + Three.js (`three`, `OrbitControls`, `GLTFLoader`, `GLTFExporter`, `OBJExporter`, `STLExporter`, `EffectComposer`). Express server (`server.ts`, port `3000`).
- **Coordinate Conventions**:
  - Plan / 2D CAD coords (`src/types/plan.ts`, `src/utils/geometry.ts`): **millimeters (`mm`)**, `+X` right, `+Y` down (screen top-down). Vertical elevation `elevationMm` / `zMm` up.
  - 3D Three.js (`Viewport3D.tsx`, `export3d.ts`, `wall3d.ts`, `furniture3d.ts`): **meters (`m = mm / 1000`)**, `+X = xMm/1000`, `+Y = zMm/1000` (up), `+Z = yMm/1000`, and plan yaw rotation `rotationDeg` maps to `rotation.y = -deg * Math.PI / 180`.
  - Furniture Euler & Mirror Order (**CRITICAL INVARIANT**): `mirror (scale(mx, 1, my))` -> `tilt (YXZ: X=rotationXDeg, Y=rotationYDeg)` -> `grounding zShift` -> `horizontal Z-rotation (rotationDeg around vertical axis)` -> `world translation (xMm, elevationMm, yMm)`. Enforced identically in `geometry.ts`, `furniture3d.ts`, `Viewport3D.tsx`, `export3d.ts`, and `Canvas2D.tsx`.
- **Key Modules**:
  - `src/types/plan.ts`: Canonical `Wall`, `Room`, `Opening`, `FurnitureInstance`, `FurniturePart`, `ArchElement`, `FurnitureRepresentation`, `Level`, `ProjectPlan`.
  - `src/utils/geometry.ts`: Wall polygons/miters (`computeWallPolygon`, `wallOffsets`, `getWallCenterlinePoint`), room polygon detection (`detectRoomsFromWalls`), wall face identification (`resolveWallFaces`, `flipWallFace`), wall dimension/clearance/chimney solvers, furniture tilted/mirrored bounds (`computeFurnitureTiltedLocalBoundsMm`, `computeFurnitureWorldBox`, `getFurnitureSolidFootprintPolygons`), collision & snap (`snapFurnitureToPlan`, `solveSolidFurnitureMove`), Wall View projection (`projectFurnitureForWallCutThrough`, `resolveWallViewProjectionForFurniture`).
  - `src/utils/wall3d.ts`: Shared Three.js wall builder (`buildWall3DGroup`) used by both `Viewport3D.tsx` and `export3d.ts`.
  - `src/utils/furniture3d.ts`: Shared procedural Three.js furniture builder (`buildProceduralFurnitureGroup`) using `fGroup -> tiltGroup -> mirrorGroup`.
  - `src/utils/assetStore.ts`: Hash-keyed IndexedDB binary store for large imported GLB assets + JSON bundle serialization helpers (`glbAssetId`).
  - `src/utils/svgProjection.ts` / `furnitureRepresentationSync.ts` / `svgRepresentationRenderer.tsx` / `RepresentationEditorModal.tsx`: Revision 9 5-view orthographic SVG silhouette extractor (`top`, `front`, `rear`, `left`, `right`), non-blocking async cache sync, interactive SVG stroke/fill editor modal, architectural black-on-white + optional material fill defaults.
  - `src/utils/textures3d.ts`: Procedural architectural PBR textures (`buildArchitecturalMaterial`, `applyWorldSpaceUVs`).
  - `src/utils/walkPhysics.ts`: 175cm FPS walk mode colliders (`buildWalkColliders`, `resolveWalkStep`).
  - `src/components/Canvas2D.tsx`: Main 2D floorplan editor (walls, openings, rooms, furniture move/mirror/Z-rotate handles, inline editable architectural dimensions, alignment guides).
  - `src/components/WallCutThroughViewer.tsx`: Interactive elevation Wall View with physical face switching, opposite-side occlusion, chimney placement, depth-effect culling, and dimension editing.
  - `src/components/Viewport3D.tsx`: **Strict view-only** Three.js Orbit/Perspective/Walkthrough renderer + bloom/day-night/cutaway.
  - `src/components/PropertiesInspector.tsx`: Contextual inspector (`Wall` face finishes & Flip Face, `Furniture` manual Tilt X / Roll Y / Rotation Z / Mirror / SVG Editor launch, `Room`, `Opening`, `ArchElement`).

---

## Known Upstream Baseline Note

- `src/utils/geometry.test.ts` subtest `curtains stick exclusively to walls...` fails at line ~2529 due to pre-existing fixture lookup `'sofa_3seat'` (`src/data/catalog.ts` defines `'sofa_straight_3'`). Do not alter unrelated catalog IDs unless specifically tasked.

---

## Verification Commands

- Unit tests:
  - `npx tsx --test src/utils/geometry.test.ts`
  - `npx tsx --test src/utils/svgProjection.test.ts`
- Build & Lint:
  - `npm run lint`
  - `npm run build`

---

## Change Ledger

### #1 — Milestone 1: Core Geometry, Wall Systems, 3D Window Cutouts, Wall View Occlusion & 2D Furniture Transforms
- **Types (`src/types/plan.ts`)**: Added `faceFlipped?: boolean` on `Wall`.
- **Wall Face Auto-Identification & Flip (`src/utils/geometry.ts`, `PropertiesInspector.tsx`, `WallCutThroughViewer.tsx`, `Canvas2D.tsx`, `wall3d.ts`)**:
  - Added `resolveWallFaces(wall, rooms)` probing enclosing rooms on physical `+normal` (`left`) vs `-normal` (`right`): single-room walls dynamically label the room-facing physical side `Inner` and exterior `Outer` regardless of CW/CCW endpoint order; shared walls dynamically label each physical side with its bordering room name (reactively updating when rooms are renamed); freestanding partitions respect `faceFlipped`.
  - Added `flipWallFace(wall)` reversing `faceFlipped` and swapping `inner*`/`outer*` color, material, scale, and rotation fields without moving endpoints, changing thickness/alignment, or breaking shared room links. Exposed **Flip Face** button (`data-testid="flip-wall-face-btn"`) in `PropertiesInspector.tsx` plus subtle selected-wall face badges in `Canvas2D.tsx`.
- **3D Window Cutouts Root-Cause Fix (`src/utils/wall3d.ts`, `Viewport3D.tsx`, `export3d.ts`)**:
  - Factored shared `buildWall3DGroup(...)` eliminating the duplicate overlapping `outerSkinGeo` slab that shared hole paths and covered/z-fought across windows; replaced with a single partitioned non-indexed `ExtrudeGeometry` sorted into `[leftMat, coreMat, rightMat]` groups bound via `resolveWallFaces`.
  - Enforced CW hole winding (including `round` ellipse holes), set `castShadow = false` / `receiveShadow = false` on all window glass meshes, split baseboard/crown molding spans cleanly around low/tall openings, and subdivided curved walls (`steps = 28`) with sill/header cutouts around openings.
- **Wall View Visibility & Opposite-Side Occlusion (`src/utils/geometry.ts`, `WallCutThroughViewer.tsx`)**:
  - Updated `projectFurnitureForWallCutThrough` and `resolveWallViewProjectionForFurniture` to accept physical `'left' | 'right'` sides and enforce true wall-thickness occlusion (`maxOut <= 4 || (centerOut < -wallHalfThick && maxOut <= 15)`) plus rear sub-part filtering (`part.outFront > 2`).
  - Fixed directly attached opposite-side chimneys in `WallCutThroughViewer.tsx` (added `continue;` so opposite-side chimneys are hidden and counted) and updated UI face selector to display dynamic room names / `Inner`/`Outer`.
- **Furniture Mirror/Tilt/Rotate Parity & 2D Mouse Rotation (`src/utils/furniture3d.ts`, `geometry.ts`, `Viewport3D.tsx`, `export3d.ts`, `Canvas2D.tsx`)**:
  - Unified mirror-before-tilt-before-Z-rotate across 3D (`fGroup -> tiltGroup -> mirrorGroup` for both procedural furniture composite groups and GLBs), tilted OBB footprints (`getFurnitureSolidFootprintPrimitives` / `Polygons`), `snapFurnitureToPlan`, and `Canvas2D.tsx`.
  - Removed outer `scale(mx, my)` from `Canvas2D.tsx` furniture `<g>`, moved `scale(mx, my)` inside visual/part groups, centered the 2D rotation handle on `(bounds.minX + bounds.maxX) / 2`, implemented mirror-safe relative pointer-angle rotation with `Shift` free-rotate override + configurable `angleSnapDeg` + live upright SVG angle readout badge.
  - Verified `Viewport3D.tsx` remains strictly view-only; `Tilt X` / `Roll Y` remain purely manual in `PropertiesInspector.tsx`.
- **Tests (`src/utils/geometry.test.ts`)**: Added Milestone 1 tests for wall face identification/renaming/flipping, thin/thick wall opposite-side occlusion, mirrored+tilted OBB parity, and 3D straight/round/floor-to-ceiling/curved window cutout triangle verification.

### #2 — Milestone 2: 2D Furniture Drawings (`Default` / `Silhouette` / `Hidden-line`)
- **Types (`src/types/plan.ts`)**: Extended `RepresentationMode` to `'default' | 'silhouette' | 'hidden_line'`, added immutable `defaultViews?: Partial<Record<ProjectionViewId, ProjectedViewSvg>>` to `FurnitureRepresentation`, and added `svgSource?: string` to `FurnitureInstance`.
- **SVG Import, Validation & Default Eligibility (`src/utils/svgImport.ts`)**:
  - Added Node- and browser-safe SVG parser `parseSvgSourceToProjectedView(...)` supporting nested `<g>`, affine `transform` matrices, `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<polygon>`, `<polyline>`, `<line>`, inline styles, and `viewBox`/unit sizing, plus `isValidSvgSource`, `isBuiltinCatalogItem`, `hasValidDefaultSvg`, `resolveEffectiveRepresentationMode`, and `generateDefaultTopViewFromParts` (with accurate `arc`/`l_profile`/`u_profile`/`rounded_rect`/ellipse support).
  - Exposed `Default` strictly when a valid SVG exists (valid imported `svgSource`, preserved `defaultViews.top`, or non-GLB built-in catalog item); GLB imports, image traces, custom-builder objects without SVGs, and empty/invalid SVGs resolve to `'silhouette'` and hide `Default`.
- **Pipeline Preservation (`src/utils/svgProjection.ts`, `furnitureRepresentationSync.ts`, `svgRepresentationRenderer.tsx`, `usePlanState.ts`, `App.tsx`)**:
  - Kept `svgSource` and `defaultViews` strictly immutable across mode switches (`default` ↔ `silhouette` ↔ `hidden_line`), background sync (`needsRepresentationRegeneration` returns `false` for built-in `'default'` items so 3D silhouettes never overwrite original drawings), 2D B&W toggles, and `customViews` edits.
  - Updated `getEffectiveViewElements` priority (`customViews` > `defaultViews` in `'default'` mode > `autoViews`) and added non-mutating `blackAndWhite` color override in `renderFurnitureRepresentationView`.
- **UI & Views (`PropertiesInspector.tsx`, `ImporterModal.tsx`, `Canvas2D.tsx`, `WallCutThroughViewer.tsx`, `LeftSidebar.tsx`, `SvgRepresentationEditorModal.tsx`)**:
  - Conditionally rendered the `Default` toggle button strictly when `hasValidDefaultSvg(...)` is true alongside `Silhouette` and `Hidden-Line`; preserved original SVG / generated `defaultViews.top` on `Save to Library` and inside the 2D SVG Editor modal; added live SVG preview in `ImporterModal.tsx` and architectural part fallback in `Canvas2D`/`WallCutThroughViewer`/`LeftSidebar` for built-in items in `Default` mode. Kept `Viewport3D.tsx` strictly view-only.
- **Tests (`src/utils/svgProjection.test.ts`)**: Added Tests 7–8 verifying SVG parsing/validation, `Default` visibility rules across imported SVG, invalid SVG, GLB, custom, and built-in items, and immutability of original SVGs across mode transitions.

### #3 — Milestone 2: Object Mounting, Surface Attachment & Parent-Child Manipulation
- **Types (`src/types/plan.ts`)**: Added `MountingType` (`'floor' | 'wall' | 'ceiling' | 'freestanding' | 'surface'`) and `MountingFace` (`'bottom' | 'top' | 'back' | 'front' | 'left' | 'right'`), `defaultMountingType` / `defaultMountingFace` on `CatalogTemplate`, and `mountingType`, `mountingFace`, `attachedWallId`, `attachedFace`, `attachedT`, `wallOffsetMm`, `surfaceHostId`, `surfaceLocalXMm`, `surfaceLocalYMm`, `surfaceLocalRotDeg` on `FurnitureInstance`.
- **Mounting Core & GLB Geometry Inspection (`src/utils/mounting.ts`)**:
  - Added deterministic resolution (`resolveFurnitureMountingType`, `resolveFurnitureMountingFace`, `defaultMountingFaceForType`) so all catalog/custom/imported items resolve explicitly across the 5 mounting types.
  - Added `inspectGlbForMounting(root)` analyzing vertex face densities, CoM height, footprint area ratios, and aspect ratios to detect ceiling canopies/pendants, thin vertical wall-mounted profiles (auto-selecting `back`/`front`/`left`/`right`), compact surface items, freestanding objects, or floor objects rather than defaulting everything to floor-mount.
  - Added non-destructive pivot rotation transforms (`getMountingRotationEulerRad`, `getMountingRotationQuaternion`, `rotateBoundsForMounting`, `transformBoundsBetweenMountings`, `applyMountingRotationToObject3D`) so original raw IndexedDB GLB geometry buffers are never altered.
- **Surface Attachment & Hierarchy Solvers (`src/utils/geometry.ts`)**:
  - Added `computeAttachedWallFurnitureTransform`, `findNearestWallAttachmentTarget`, `AttachmentTargetPreview`, and wall-snap flush alignment inside `snapFurnitureToPlan` and `solveSolidFurnitureMove` (wall-mounted items snap cleanly to `'left'`/`'right'` faces without wall clipping or floating; `Shift` / `allowOverlap` bypasses auto-attachment and clears existing bindings).
  - Updated `isCeilingFixture` / `getCeilingFixtureOffsetMm` / `isSurfaceMountable` / `isSupportingSurfaceFurniture` / `wouldCreateSurfaceCycle` / `findSupportingSurfaceForProp` so any floor/freestanding supporting desk/table/cabinet (including custom/GLB flat-top items) hosts surface children cleanly with cycle prevention.
  - Added recursive relationship propagation (`computeSurfaceLocalCoords`, `computeWorldFromSurfaceLocal`, `propagateParentFurnitureTransforms`, `propagateWallAttachments`, `detachChildrenOnParentDelete`). Parent deletion detaches children cleanly and returns orphaned surface children to floor (`elevationMm: 0`).
- **2D/3D Pipelines & Importer (`src/utils/svgProjection.ts`, `furnitureRepresentationSync.ts`, `furniture3d.ts`, `Viewport3D.tsx`, `export3d.ts`, `ImporterModal.tsx`)**:
  - Applied mounting orientation pivots consistently across 3D rendering (`fitGlbSceneToFurnitureBounds`), 3D export, and 2D 5-view projection extraction (`mt:${mType}|mf:${mFace}` cache key), keeping `Viewport3D.tsx` strictly view-only and keeping `defaultViews` / original SVGs intact.
  - Added automatic GLB mounting inspection plus quick **Mounting Type** (5 options) and **Model Mounting Face** (6 presets) selectors in `ImporterModal.tsx` with live dimensions and Top/Front SVG preview updates.
- **2D Editing, Placement, Lifecycle & Inspector (`Canvas2D.tsx`, `PropertiesInspector.tsx`, `usePlanState.ts`, `App.tsx`)**:
  - Added live 2D attachment target highlighting in `Canvas2D.tsx` (wall mounting segment highlight and supporting host footprint dashed blue outline during drag) and wired recursive propagation across 2D furniture move/rotate/edge-resize drags as well as `wall_vertex` and `wall_body` drags.
  - Updated `PropertiesInspector.tsx` with **Mounting & Attachment** controls (5 Mounting Types, 6 Model Mounting Face presets with live GLB re-orientation & async 2D view refresh, Wall Offset / Flip Side / Snap / Detach controls) and wired parent/wall propagation across property edits, alignment, resize, wall length, and wall split.
  - Updated `usePlanState.ts` (`deleteSelected` detaches children on parent delete; `pasteClipboard`/`duplicateSelected` remaps paired parent-child copies) and `App.tsx` (`placeFurnitureTemplate` attaches based on resolved mounting type).
- **Verification**:
  - `npx tsx --test src/utils/mounting.test.ts src/utils/svgProjection.test.ts`: **16/16 passing** (covering all 5 mounting types, `inspectGlbForMounting`, axis transforms, wall/ceiling/floor/surface attachment, `Shift` bypass, cycle prevention, parent move/rotate/mirror/resize, wall move, parent delete detachment, JSON serialization, and 2D Default/Silhouette/Hidden-line preservation).
  - `npx tsx --test src/utils/geometry.test.ts`: 42/43 passing (1 pre-existing baseline failure noted above at line ~2529).
  - `npm run lint` (`tsc --noEmit`) and `npm run build` (`compile_applet`): **0 errors, build succeeded**.
- **Known Issues / Next Recommended Steps**:
  - Pre-existing `geometry.test.ts` `'curtains stick exclusively to walls...'` lookup of `'sofa_3seat'` remains untouched per instructions.
  - GLB orientation auto-detection relies on vertex/face heuristics; unusual raw GLB meshes can be corrected immediately via the 6-face preset selector in `ImporterModal` or `PropertiesInspector`.

### #4 — Milestone 3: Advanced Furniture Lighting & GLB Emissive Glow Support
- **Types (`src/types/plan.ts`)**: Added `FurnitureLightType` (`'point' | 'spot' | 'area' | 'linear'`), `FurnitureLightSource` (id, name, type, enabled, colorMode `'kelvin' | 'hex'`, colorTempK, colorHex, intensity, rangeMm, decay, local `xMm`/`yMm`/`zMm`, aimAzimuthDeg/aimElevationDeg, coneAngleDeg, penumbra, widthMm/lengthMm, castShadow, sourceRef), `GlbMaterialEmissiveOverride`, `GlbInspectedMaterial`, independent per-part emissive fields on `FurniturePart` (`emissiveEnabled`, `emissiveColor`, `emissiveIntensity`, `bloomBoost`), and `lights` / `glbEmissiveOverrides` on `CatalogTemplate` and `FurnitureInstance`.
- **Lighting & GLB Emissive Engine (`src/utils/lighting.ts`)**:
  - Added color conversion/resolution (`kelvinToThreeColor`, `kelvinToHex`, `resolveLightSourceThreeColor`, `resolveLightSourceHex`), vector aiming (`computeAimDirectionVectorThree` with mirror folding), legacy `Lighting` migration/fallback (`resolveEffectiveFurnitureLights`, `deriveLegacyLightsForFurniture`), resize scaling (`scaleFurnitureLightSources`), fresh-ID cloning (`cloneLightsWithFreshIds`), and 1-click matching light generators (`createMatchingLightForPart`, `createMatchingLightForGlbMaterial`).
  - Added deterministic, non-destructive GLB material inspection (`inspectGlbMaterials`) returning fitted local millimeter bounds centers and detecting existing `emissiveMap`s or disabled emissive properties.
  - Added non-destructive runtime material cloning & override application (`applyGlbEmissiveOverrides`) preserving source cached IndexedDB/in-memory GLB assets, diffuse/normal/roughness maps, and optional embedded `emissiveMap`s while emitting HDR glow visible in both day and dark night environments.
  - Added unified procedural emissive evaluator (`applyProceduralPartEmissive`), multi-type Three.js light builder (`buildThreeLightsForFurniture` mounting into `tiltGroup` above `mirrorGroup` so negative mirror scales never invert spotlight matrices, with multi-point fallback for `RectAreaLight` on software WebGL), and hardware shadow budget enforcement (`assignInteriorShadowBudget`, max 3 interior shadow casters prioritized by `userCastShadow` + 1 sun/moon = 4 max).
- **3D Scene, Procedural Builder & Export (`src/utils/furniture3d.ts`, `src/components/Viewport3D.tsx`, `src/utils/export3d.ts`)**:
  - Updated `furniture3d.ts` to support per-part emissive overrides completely independently of category or real lights, plus multi-light emission via `buildThreeLightsForFurniture`.
  - Updated `Viewport3D.tsx` (kept strictly view-only) to build real lights and apply GLB emissive overrides on both procedural and GLB furniture, refine selective `UnrealBloomPass` HDR threshold (`1.38` day / `0.96` night) and `alwaysVisible` emissive scaling (`0.85x–1.22x`), and apply `assignInteriorShadowBudget` across synchronous & async GLB loads with stale-build cancellation guards.
  - Updated `export3d.ts` so exported GLTF/GLB scenes preserve furniture lights and GLB emissive overrides.
- **2D Editor & UI (`src/components/FurnitureLightingPanel.tsx`, `src/components/PropertiesInspector.tsx`, `src/components/ImporterModal.tsx`, `src/components/Canvas2D.tsx`, `src/hooks/usePlanState.ts`, `src/App.tsx`)**:
  - Created modular `FurnitureLightingPanel.tsx` supporting multiple lights per furniture across all categories (and GLB models), full light-type controls, Kelvin vs. Custom RGB swatches, local position/range/aim/cone/softness/shadow controls, GLB material glow toggles & emission/bloom sliders, procedural part glow controls, and 1-click **`+ Matching Light`** pairing.
  - Updated `ImporterModal.tsx` to scan uploaded GLBs for materials and disabled/active emissive properties with optional glow & light pairing during import.
  - Updated `Canvas2D.tsx` to render **selected-only** 2D light source indicators (bulbs, spotlight cones, area panels, linear strips) with draggable local position & horizontal aim handles respecting rotation and mirroring, leaving unselected floorplan furniture uncluttered.
  - Propagated `lights` scaling on overall resize (`PropertiesInspector.tsx`) and deep-cloning on array/duplicate/paste/library-save (`usePlanState.ts`, `App.tsx`, `PropertiesInspector.tsx`).
- **Verification**:
  - `npx tsx --test src/utils/lighting.test.ts src/utils/mounting.test.ts src/utils/svgProjection.test.ts`: **22/22 passing** (6 new Milestone 3 lighting/VARMBLIXT GLB emissive/transform/shadow-budget/JSON tests + 16 Milestone 1–2 regression tests).
  - `npm run lint` (`tsc --noEmit`) & `compile_applet` (`npm run build`): **0 errors, build succeeded**.
- **Known Issues / Next Recommended Steps**:
  - `RectAreaLight` softens via multi-point fallback when running under software WebGL (`isSoftwareGl === true`) to prevent shader stalls; hardware WebGL uses native `THREE.RectAreaLight`.
  - Browser visual check recommended on an imported emissive GLB (such as IKEA VARMBLIXT) to fine-tune preferred default bloom/intensity aesthetic under Night Mode.

### #5 — Lighting System UI/UX Revision & Night-Time Bloom Correction
- **Types & State (`src/types/plan.ts`, `src/utils/lighting.ts`, `src/App.tsx`, `src/components/PropertiesInspector.tsx`)**:
  - Added optional `isLight?: boolean` and `lightingEnabled?: boolean` on `CatalogTemplate` and `FurnitureInstance`, plus `isFurnitureLightObject(f)` and `isFurnitureLightingActive(f)` helpers in `src/utils/lighting.ts`.
  - Designated non-light GLB imports (`isLight: false`) hide lighting UI in `PropertiesInspector.tsx` and save clean metadata (`isLight`, `lightingEnabled`) into catalog templates and placed instances. Built-in `Lighting` category items and `isLight: true` objects remain light-enabled.
  - Added master `lightingEnabled` switch behavior across `buildThreeLightsForFurniture`, `applyGlbEmissiveOverrides`, `applyProceduralPartEmissive`, `Viewport3D.tsx`, `furniture3d.ts`, `export3d.ts`, and `Canvas2D.tsx`: toggling **Lit** off disables all associated light sources and emissive emission while preserving user-configured colors, intensities, and offsets cleanly when toggled back on.
- **Interactive 3D Preview & Unified Lighting Editor (`src/components/InteractiveGlbPreview3D.tsx`, `src/components/UnifiedLightingEditor.tsx`, `src/components/LightingEditorModal.tsx`)**:
  - Created `InteractiveGlbPreview3D.tsx` with OrbitControls (mouse drag rotation + scroll-wheel zoom), camera reset, and Studio (Day) / Night backdrop toggle — leaving the main project 3D viewport (`Viewport3D.tsx`) strictly view-only.
  - Selecting a material (GLB) or procedural part in `UnifiedLightingEditor.tsx` highlights matching meshes on the 3D preview in translucent/emissive blue (`#2563EB`/`#3B82F6`) and reveals inline emissive controls (toggle, color picker/swatches, intensity slider, embedded emissive map option, `+ Add Matching Light Here`), alongside light source configuration (`Point`, `Spot`, `Area`, `Linear`) in the same unified panel.
- **Redesigned GLB Importer & Side Menu Lighting Card (`src/components/ImporterModal.tsx`, `src/components/PropertiesInspector.tsx`)**:
  - Replaced the GLB drag-and-drop card upon file selection with the interactive 3D preview (`InteractiveGlbPreview3D`) + `Replace File`, **`Is a light`** toggle (OFF by default), and `UnifiedLightingEditor` revealed directly when enabled.
  - Replaced verbose per-item inline lighting forms in `PropertiesInspector.tsx` with a compact **Lighting** card for light objects showing the **Lit** toggle and **Edit** button side-by-side; clicking **Edit** opens `LightingEditorModal.tsx` with the live 3D preview and unified materials/lights editor.
- **Night-Time Lighting & Bloom Calibration (`src/components/Viewport3D.tsx`, `src/utils/lighting.ts`, `src/utils/furniture3d.ts`)**:
  - Reduced excessive night bloom and overexposed light stacking without altering daytime appearance: set `toneMappingExposure` to `lerp(0.96, 0.94, m)`, raised `UnrealBloomPass.threshold` to `lerp(1.38, 1.24, m)` (`> 1.0` so lit walls do not bloom), reduced `bloomPass.strength` to `lerp(0.055, 0.12, m)` and radius to `0.28`, calibrated night point/spot multiplier (`lerp(0.24, 0.62, m)` instead of `1.35`), and softened night emissive multipliers (`0.94`).
- **UI Polish (`Canvas2D.tsx`, `WallCutThroughViewer.tsx`)**:
  - Removed emojis (replaced locked labels with `[LOCKED]`) across the UI.
- **Verification**:
  - `npx tsx --test src/utils/lighting.test.ts`: **6/6 passing**.
  - `npm run lint` (`tsc --noEmit`) and `compile_applet` (`npm run build`): verified clean.
- **Remaining Limitations**:
  - Procedural emissive parts on objects whose `category !== 'Lighting'` and have no configured lights still glow visually when `lightingEnabled !== false`, while objects marked `isLight: true` (or built-in `Lighting`) expose the **Lit** card and interactive `LightingEditorModal`.

### #6 — 3D Light Position & Direction Gizmo Controls
- **Types & Orientation Basis (`src/types/plan.ts`, `src/utils/lighting.ts`)**:
  - Added optional `aimRollDeg?: number` to `FurnitureLightSource` (`-180..180`, default `0`) for asymmetric `'area'` and `'linear'` lights.
  - Added `computeLightOrientationQuaternionThree(aimAzimuthDeg, aimElevationDeg, aimRollDeg, mirroredX, mirroredY)` in `src/utils/lighting.ts` so `RectAreaLight` and 3D gizmos share one continuous basis across Yaw, Pitch (including straight-down `-90°`/straight-up `+90°`), and Roll.
- **3D Light Markers & Axis/Orientation Gizmo (`src/components/InteractiveGlbPreview3D.tsx`)**:
  - Decoupled heavy model/GLB loading from lightweight light/marker/gizmo updates (`lightsOverlayGroupRef`) so dragging gizmo handles updates illumination and markers smoothly at interactive frame rates without reloading meshes.
  - Rendered visible 2D-matched markers (`#FFFFFF` rim + light-color core + blue selection ring + soft outer halo) at every light's emission point with `depthTest: false` so internal bulbs remain visible inside shades, plus click-to-select hit targets in 3D when multiple lights exist.
  - Rendered raycasted, camera-plane-projected **3-axis translation arrows** (`X` Red, `Y` Green, `Z` Blue with axis badges) for independent X/Y/Z positioning.
  - Rendered non-point **Yaw** (amber horizontal ring) and **Pitch** (cyan vertical arc) handles for `'spot'`, `'area'`, and `'linear'` lights, plus a **Roll** (violet ring) handle strictly for asymmetric `'area'`/`'linear'` lights. Point lights show only X/Y/Z translation arrows and zero direction handles.
- **Synchronized Numeric Controls (`src/components/UnifiedLightingEditor.tsx`, `LightingEditorModal.tsx`, `ImporterModal.tsx`)**:
  - Synced `selectedLightId` and `onUpdateLight` bi-directionally between `InteractiveGlbPreview3D` and `UnifiedLightingEditor` (clicking a 3D light marker switches the editor to `Light Sources` and selects that light).
  - Exposed color-matched **X / Y / Z** numeric inputs plus independent **Yaw (°)**, **Pitch (°)**, and asymmetric **Roll (°)** sliders + numeric inputs (hidden on `'point'` lights).
- **Verification**:
  - `npx tsx --test src/utils/lighting.test.ts`: **7/7 passing**.
  - `npm run lint` (`tsc --noEmit`) and `compile_applet` (`npm run build`): verified clean.

### #7 — 3D Viewer Camera-Movement White Flash Fix
- **Root Causes Identified & Fixed**:
  1. **Skybox GLSL `pow(0.0, y)` + `HalfFloatType` MSAA `UnrealBloomPass` NaN Explosions (`src/components/Viewport3D.tsx`)**:
     - The skybox shader evaluated `pow(0.0, 0.55)`, `pow(0.0, 0.7)`, `pow(0.0, 16.0)`, and `pow(0.0, 160.0)` on the anti-sun sky hemisphere and horizon (`NaN` on ANGLE/Metal/Intel/NVIDIA WebGL2 drivers), which spread through `UnrealBloomPass`'s Gaussian mips inside the `HalfFloatType` render target into full-screen white flashes whenever moving the camera.
     - Fixed by guarding every `pow(...)` input (`max(..., 0.0001)` and `sunAmt > 0.001`), disabling MSAA on the `HalfFloatType` `EffectComposer` target (`samples: 0`), and adding a pre-bloom `ShaderPass` (`hdrSanitizePass`) that clamps `NaN`, negative, and `> 12.0` HDR specular fireflies before `UnrealBloomPass`.
  2. **GLB Mesh & Roughness Sanitization (`src/utils/lighting.ts`, `src/components/Viewport3D.tsx`, `src/components/InteractiveGlbPreview3D.tsx`)**:
     - Computed missing vertex normals on imported GLB meshes (`computeVertexNormals()`) and clamped cloned `roughness >= 0.04` to prevent GGX/LTC divide-by-zero specular spikes at grazing camera angles.
  3. **3D Preview Buffer & Studio Wall Clipping (`src/components/InteractiveGlbPreview3D.tsx`)**:
     - Enabled `preserveDrawingBuffer: true` and rendered synchronously in `ResizeObserver`, skipped hover state updates while mouse buttons are held during orbit, and removed the near-white vertical `backWall` plane that clipped across the orbit camera path.
- **Verification**:
  - `npx tsx --test src/utils/lighting.test.ts`: passing.
  - `npm run lint` (`tsc --noEmit`) and `compile_applet` (`npm run build`): verified clean.

### #8 — 3D Window Transparency & Non-Rectangular/Cutaway/Export Parity Fix
- **Root Causes Identified & Fixed**:
  1. **Overlapping/Touching Window & Non-Rectangular Hole Cutouts (`src/utils/wall3d.ts`)**:
     - When two openings on the same straight wall overlapped or touched, or when a wide/low `round_arch` (`ow/2 > oh - 0.04`) exited the wall perimeter, `THREE.ExtrudeGeometry` Earcut triangulation failed and filled the window opening back in with solid opaque wall.
     - Fixed by clustering touching/overlapping cutouts via `buildMergedClusterHolePaths(...)` (2D grid boolean union extracting strictly CW non-intersecting outer loops), clamping `round_arch` rise (`ry = Math.min(ow/2, Math.max(0.02, oh - 0.04))`), fixing `segmental_arch` apex control point, and clamping `applyMiterSkew` corner extensions so thick/acute wall corners cannot fold across adjacent windows.
  2. **Cutaway-Sliced Window Top Bars (`src/utils/wall3d.ts`, `src/components/Viewport3D.tsx`, `src/utils/export3d.ts`)**:
     - Cutaway mode previously clamped opening tops `2 cm` below `wallH`, leaving a dark wall-core strip and opaque lintel header across windows sliced by cutaway height.
     - Fixed by carving top-edge cutaway notches directly into `wallShape`'s outer contour and omitting the `head` frame bar + adjusting glazing bounds when `cutawayEnabled` slices the top of an opening.
  3. **Curved-Wall Opening Profiles (`src/utils/wall3d.ts`)**:
     - Added vertical profile evaluation (`getCutoutVerticalSpanAtX`) for `round` windows and `round_arch`/`pointed_arch`/`segmental_arch` openings, preserved exact opening boundary `t` breaks in `baseSteps`, added 14 sub-steps across non-rectangular curved-wall openings, collected multi-cutout vertical spans before `subtractSolidIntervals`, and removed `0.004 m` end-padding on segments touching opening edges.
  4. **Inner/Outer Wall Alignment, Oval Round Glazing, Glass Material & Export Parity (`src/utils/textures3d.ts`, `src/components/Viewport3D.tsx`, `src/utils/export3d.ts`)**:
     - Applied `wallOffsets(wall.thicknessMm, wall.alignment)` normal `centerOffsetM` to `opGroup.position` in both `Viewport3D.tsx` and `export3d.ts` so frames and glass sit inside `'inner'` and `'outer'` walls identically to `'center'` walls.
     - Scaled oval `round` window `disc` glass (`w/(2*r), 1, h/(2*r)`) to match its ring frame, skipped duplicate fixed glass panes behind angled `casement`/`awning` sashes, added missing sills/thresholds/mullions to `export3d.ts`, and tuned `textures3d.ts` `'glass'` material (`metalness: 0`, `opacity: 0.16`, `envMapIntensity: 0.22`, `depthWrite: false`) for clear see-through glazing.
- **Verification**:
  - Raycast checks (`wall3d.ts`): 0 opaque wall hits across overlapping windows, cutaway-sliced openings, acute miter corners, `inner`-aligned walls, and straight/curved `round` & arch openings.
  - `npx tsx --test src/utils/geometry.test.ts`: 42/43 passing (only pre-existing `'sofa_3seat'` failure in test 38).
  - `npm run lint` (`tsc --noEmit`), `compile_applet` (`npm run build`), and live Playwright 3D screenshot inspection: verified unobstructed transparent windows with 0 page errors.

### #9 — Milestone 4: Advanced 3D Graphics Settings
- **Graphics Settings Model & Persistence (`src/utils/graphicsSettings.ts`, `src/hooks/usePlanState.ts`)**:
  - Created `GraphicsSettings`, `GRAPHICS_PRESETS` (`low`, `medium`, `high`, `ultra`), `DEFAULT_GRAPHICS_SETTINGS` (`high`), `applyGraphicsPreset`, `updateGraphicsSetting` (automatically switching `preset` to `'custom'` on any individual override), `normalizeGraphicsSettings`, and device-local persistence under `localStorage` key `'plan_studio_graphics_v1'` (`loadGraphicsSettings`/`saveGraphicsSettings`), keeping user rendering preferences independent from project JSON saves.
  - Wired `graphicsSettings`, `selectGraphicsPreset`, `updateGraphicsSettings`, and `resetGraphicsSettings` into `usePlanState.ts` and `App.tsx`.
- **Dual UI Surfaces (`src/components/GraphicsSettingsPanel.tsx`, `src/components/Viewport3D.tsx`, `src/components/SettingsModal.tsx`, `src/components/HomePage.tsx`)**:
  - Built reusable `GraphicsSettingsPanel.tsx` organized into Preset strip (`Low`, `Medium`, `High`, `Ultra`, auto `Custom` indicator, `Reset`), Display & Performance (`Render Scale`), Lighting & Shadows (`Global Illumination`, `Light Quality`, `Max Lights`, `Shadow Resolution`, `Shadow Softness`, `Shadow Distance`, `Contact Shadows`), Materials & Textures (`Texture Resolution`, `Texture Filtering`, `Anisotropic Filtering`, `Material Quality`, `Reflections`, `Env Map`, `Glass / Alpha`), and Post-Processing (`Anti-Aliasing`, `Ambient Occlusion` + `AO Intensity`, `Bloom Intensity`, `Exposure`, `Contrast`, `Vignette`, optional `Depth of Field` + `Focus Dist` / `Aperture`).
  - Added **Graphics** button + outside-click/Escape-dismissing popover in `Viewport3D.tsx`'s top bar (solid surface over WebGL canvas, strictly view-only) AND a **Graphics** tab in `SettingsModal.tsx`.
- **Textures & Material Quality Tiers (`src/utils/textures3d.ts`)**:
  - Extended `ArchitecturalMaterialOptions` and `getOrCreatePresetTexture` with `textureResolution` (`256`/`512`/`1024`), `textureFiltering` (`nearest`/`bilinear`/`trilinear`), clamped `anisotropyLevel`, `materialQuality` (`standard` vs `physical`), `reflectionQuality` (`off`–`high` scaling `envMapIntensity`/`clearcoat`), and `transparentQuality` (`standard` vs `high`), plus LRU cache eviction (cap `96`, `.dispose()` on eviction). Window glass stays clearly transparent (`opacity: 0.16`, `depthWrite: false`, `DoubleSide`) at every preset.
- **3D Rendering Pipeline & Performance Scaling (`src/components/Viewport3D.tsx`)**:
  - Expanded `EffectComposer` chain (`!isSoftwareGl`): `RenderPass` -> `GTAOPass` (toggled & sampled by `ambientOcclusionQuality`) -> `hdrSanitizePass` (WebGL2 NaN clamp preserved) -> `UnrealBloomPass` -> `BokehPass` (optional DoF) -> `SMAAPass` (linear-srgb, pre-`OutputPass`) -> `OutputPass` -> `colorGradePass` (contrast + vignette) -> `FXAA` `ShaderPass` (sRGB, post-`OutputPass`), with synchronized `ResizeObserver` sizing and unmount disposal.
  - Decoupled lightweight uniform/DPR/GI/shadow-radius/post-processing updates from heavy geometry rebuilds; heavy rebuilds apply shadow map resolution (disposing old shadow targets cleanly), window portal `RectAreaLight` caps (`0`/`4`/`8` by `lightQuality`), interior `PointLight`/`SpotLight`/`RectAreaLight` priority culling (`maxRealtimeLights`) & shadow budget (`0`/`1`/`3`), and grounded floor-furniture contact shadow decals when `contactShadows` is enabled.
- **Verification**:
  - `npx tsx --test src/utils/graphicsSettings.test.ts src/utils/lighting.test.ts`: passing.
  - `npm run lint` (`tsc --noEmit`) and `compile_applet` (`npm run build`): verified clean.
  - Remaining limitation: Software WebGL (`isSoftwareGl === true`) bypasses `EffectComposer` post-processing and hardware shadows for stability, using direct `renderer.render(...)` and material/texture tier scaling.

### #10 — Milestone 5: Architectural Railings and Balustrades
- **Types & Parametric Railing Engine (`src/types/plan.ts`, `src/utils/railings.ts`)**:
  - Added `'railing'` `EditorTool`, `RailingStyleId`, `RailingMountingMethod` (`top_mount`, `side_fascia`, `embedded`, `wall_bracket`), `RailingHandrailShape`, `RailingPostShape`, `RailingGlassTint`, `RailingPathNode` (`{ xMm, yMm, elevationMm }`), `RailingEdgeToggles`, and `RailingConfig` on `ArchElement`.
  - Implemented all 8 architectural railing styles (`glass_panel` default, `frameless_glass`, `traditional_balusters`, `horizontal_metal`, `cable`, `solid_panel`, `modern_minimalist`, `handrail_only`) with `createDefaultRailingConfig`, `applyRailingStylePreset`, `normalizeRailingConfig`, `resolveRailingConfig`, `recenterRailingNodes`, and `computeRailingPathMetrics`.
  - Implemented multi-flight staircase spec & continuous landing-to-flight railing path generator (`computeStaircaseGeometrySpec`, `resolveHostStairRailings`) covering `stairs_straight`, `stairs_l`, `stairs_u`, and `stairs_spiral`, perimeter balcony/platform railing resolver (`resolveHostDeckRailings`), host-to-editable conversion (`extractEditableRailingElementsFromHost`), and 2D slope/edge snapping (`snapRailingDrawPoint` with interpolated stair elevation & balcony deck top elevation).
- **Shared 3D Geometry & Export Parity (`src/utils/railings3d.ts`, `src/components/Viewport3D.tsx`, `src/utils/export3d.ts`)**:
  - Built `buildRailing3DGroup`, `buildStaircase3DGroup`, and `buildHostDeckRailings3DGroup` handling sloped runs, sheared parallelogram tempered glass/solid infill panels (`depthWrite: false`, `renderOrder: 2` glass transparency/tints/reflections), plumb vertical balusters, tensioned cables, horizontal metal bars, shaped handrails with corner/slope elbow joints, and mounting hardware (`top_mount`, `side_fascia`, `embedded`, `wall_bracket`).
  - Wired identically into `Viewport3D.tsx` (strictly view-only; passes full `rawH` for staircases) and `export3d.ts` (GLB/GLTF/OBJ/STL).
- **2D Editor, Catalog, Toolbar & Collapsible Inspector (`src/components/Canvas2D.tsx`, `src/components/FloatingToolbox.tsx`, `src/components/LeftSidebar.tsx`, `src/components/RailingInspectorSection.tsx`, `src/components/PropertiesInspector.tsx`, `src/utils/keybinds.ts`, `src/App.tsx`)**:
  - Added multi-point `'railing'` path tool (keybind `'l'`) with live snapping to staircases/balconies/railings/walls, double-click/Enter/closed-loop completion, interactive node & `+` midpoint editing handles, multi-flight 2D stair/balcony/railing vector rendering, split Railing button + style selector in `FloatingToolbox.tsx`, all 8 railing presets + U-turn/spiral stairs in `LeftSidebar.tsx`, and collapsible accordions + host stair/balcony controls + *Convert to Editable Railings* in `PropertiesInspector.tsx`.
- **Verification**:
  - `npx tsx --test src/utils/railings.test.ts src/utils/graphicsSettings.test.ts src/utils/lighting.test.ts`: 17/17 passing.
  - `npm run lint` (`tsc --noEmit`), `compile_applet` (`npm run build`), and focused live browser sanity check verified clean.
  - Remaining limitation: Railing paths are piecewise-linear polylines (`nodes[]` with per-node elevation); smooth curved Bézier railing segments are not yet modeled separately and are approximated by placing closely spaced corner nodes.






