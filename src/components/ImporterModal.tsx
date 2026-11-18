import React, { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Box, FileCode2, Image as ImageIcon, RotateCcw, Sparkles, Sun, Upload, X } from 'lucide-react';
import {
  CatalogTemplate,
  FurnitureLightSource,
  FurniturePart,
  FurnitureRepresentation,
  GlbInspectedMaterial,
  GlbMaterialEmissiveOverride,
  MountingFace,
  MountingType,
  Point2D,
  RepresentationMode,
} from '../types/plan';
import { putGlbAsset } from '../utils/assetStore';
import {
  createMatchingLightForGlbMaterial,
  inspectGlbMaterials,
} from '../utils/lighting';
import {
  ALL_MOUNTING_FACES,
  ALL_MOUNTING_TYPES,
  MOUNTING_FACE_LABELS,
  MOUNTING_TYPE_LABELS,
  defaultMountingFaceForType,
  inspectGlbForMounting,
  rotateBoundsForMounting,
} from '../utils/mounting';
import {
  generateRepresentationFromObject3D,
  generateRepresentationFromParts,
} from '../utils/svgProjection';
import { isValidSvgSource, parseSvgSourceToProjectedView } from '../utils/svgImport';
import { renderFurnitureRepresentationView } from '../utils/svgRepresentationRenderer';
import { uid } from '../utils/units';

interface ImporterModalProps {
  onClose: () => void;
  onImportTemplate: (tpl: CatalogTemplate, placeOnPlan: boolean) => void;
}

type ImportTab = 'svg' | 'glb' | 'trace';

export const ImporterModal: React.FC<ImporterModalProps> = ({ onClose, onImportTemplate }) => {
  const [tab, setTab] = useState<ImportTab>('svg');
  const [name, setName] = useState('Imported Object');
  const [error, setError] = useState<string | null>(null);

  // SVG extrusion state
  const [svgWidthMm, setSvgWidthMm] = useState(1000);
  const [svgDepthMm, setSvgDepthMm] = useState(600);
  const [svgHeightMm, setSvgHeightMm] = useState(750);
  const [svgColor, setSvgColor] = useState('#64748B');
  const [svgSource, setSvgSource] = useState<string | null>(null);
  const [svgParts, setSvgParts] = useState<FurniturePart[]>([]);

  // GLB state
  const [glbDataUrl, setGlbDataUrl] = useState<string | null>(null);
  const [glbAssetId, setGlbAssetId] = useState<string | null>(null);
  const [glbRawBoundsMm, setGlbRawBoundsMm] = useState<{ w: number; d: number; h: number } | null>(null);
  const [glbBoundsMm, setGlbBoundsMm] = useState<{ w: number; d: number; h: number } | null>(null);
  const [glbMountingType, setGlbMountingType] = useState<MountingType>('floor');
  const [glbMountingFace, setGlbMountingFace] = useState<MountingFace>('bottom');
  const [glbInspectReason, setGlbInspectReason] = useState<string | null>(null);
  const [glbRepMode, setGlbRepMode] = useState<RepresentationMode>('silhouette');
  const [glbPreviewRep, setGlbPreviewRep] = useState<FurnitureRepresentation | null>(null);
  const [glbMaterials, setGlbMaterials] = useState<GlbInspectedMaterial[]>([]);
  const [glbEmissiveOverrides, setGlbEmissiveOverrides] = useState<GlbMaterialEmissiveOverride[]>([]);
  const [glbDefaultLights, setGlbDefaultLights] = useState<FurnitureLightSource[]>([]);
  const [glbBusy, setGlbBusy] = useState(false);
  const glbSceneRef = useRef<THREE.Object3D | null>(null);

  // Image trace-to-footprint state
  const [traceImgUrl, setTraceImgUrl] = useState<string | null>(null);
  const [tracePoints, setTracePoints] = useState<Point2D[]>([]); // normalized 0..1 inside image
  const [traceTargetWidthCm, setTraceTargetWidthCm] = useState(140);
  const [traceHeightCm, setTraceHeightCm] = useState(75);
  const [traceColor, setTraceColor] = useState('#B8895A');

  const svgPreviewRep = useMemo<FurnitureRepresentation | null>(() => {
    if (!svgSource || !isValidSvgSource(svgSource)) return null;
    const parsed = parseSvgSourceToProjectedView(
      svgSource,
      svgWidthMm,
      svgDepthMm,
      svgHeightMm,
      svgColor
    );
    if (!parsed) return null;
    return {
      mode: 'default',
      defaultViews: { top: parsed.view },
    };
  }, [svgSource, svgWidthMm, svgDepthMm, svgHeightMm, svgColor]);

  const handleSvgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setName(file.name.replace(/\.svg$/i, ''));
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const parsed = parseSvgSourceToProjectedView(
          text,
          svgWidthMm,
          svgDepthMm,
          svgHeightMm,
          svgColor
        );
        if (!parsed) {
          setSvgSource(null);
          setSvgParts([]);
          setError('Could not find valid drawable vector shapes in this SVG.');
          return;
        }
        setSvgSource(text);
        setSvgParts(parsed.parts);
      } catch {
        setSvgSource(null);
        setSvgParts([]);
        setError('Failed to parse SVG file.');
      }
    };
    reader.readAsText(file);
  };

  const makeGlbBoundsParts = (w: number, d: number, h: number): FurniturePart[] => [
    {
      id: uid('p'),
      name: 'GLB Bounding Footprint',
      shape: 'box',
      xMm: 0,
      yMm: 0,
      zMm: 0,
      widthMm: w,
      depthMm: d,
      heightMm: h,
      rotationDeg: 0,
      color: '#94A3B8',
      material: 'wood',
    },
  ];

  const regenerateGlbPreview = (
    scene: THREE.Object3D,
    assetId: string,
    dataUrl: string,
    bounds: { w: number; d: number; h: number },
    nextMode: RepresentationMode,
    mType: MountingType,
    mFace: MountingFace
  ) => {
    const rep = generateRepresentationFromObject3D(scene, {
      glbAssetId: assetId,
      glbDataUrl: dataUrl,
      partsForBounds: makeGlbBoundsParts(bounds.w, bounds.d, bounds.h),
      mode: nextMode,
      useMaterialFill: false,
      mountingType: mType,
      mountingFace: mFace,
    });
    setGlbPreviewRep(rep);
  };

  const applyGlbMountingUpdate = (nextType: MountingType, nextFace: MountingFace) => {
    setGlbMountingType(nextType);
    setGlbMountingFace(nextFace);
    if (!glbRawBoundsMm) return;
    const rotated = rotateBoundsForMounting(
      {
        widthMm: glbRawBoundsMm.w,
        depthMm: glbRawBoundsMm.d,
        heightMm: glbRawBoundsMm.h,
      },
      nextType,
      nextFace
    );
    const nextBounds = { w: rotated.widthMm, d: rotated.depthMm, h: rotated.heightMm };
    setGlbBoundsMm(nextBounds);
    if (glbSceneRef.current && glbAssetId && glbDataUrl) {
      regenerateGlbPreview(
        glbSceneRef.current,
        glbAssetId,
        glbDataUrl,
        nextBounds,
        glbRepMode,
        nextType,
        nextFace
      );
      const refreshedMats = inspectGlbMaterials(
        glbSceneRef.current,
        { widthMm: nextBounds.w, depthMm: nextBounds.d, heightMm: nextBounds.h },
        { mountingType: nextType, mountingFace: nextFace }
      );
      setGlbMaterials(refreshedMats);
    }
  };

  const handleGlbUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setName(file.name.replace(/\.(glb|gltf)$/i, ''));
    setGlbBusy(true);
    setGlbPreviewRep(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setGlbDataUrl(dataUrl);
      const loader = new GLTFLoader();
      loader.load(
        dataUrl,
        async (gltf) => {
          try {
            const inspected = inspectGlbForMounting(gltf.scene);
            const rawB = {
              w: inspected.rawBoundsMm.widthMm,
              d: inspected.rawBoundsMm.depthMm,
              h: inspected.rawBoundsMm.heightMm,
            };
            const orientedB = {
              w: inspected.orientedBoundsMm.widthMm,
              d: inspected.orientedBoundsMm.depthMm,
              h: inspected.orientedBoundsMm.heightMm,
            };
            const assetId = await putGlbAsset(dataUrl);
            glbSceneRef.current = gltf.scene;
            setGlbAssetId(assetId);
            setGlbRawBoundsMm(rawB);
            setGlbBoundsMm(orientedB);
            setGlbMountingType(inspected.mountingType);
            setGlbMountingFace(inspected.mountingFace);
            setGlbInspectReason(inspected.reason);
            const mats = inspectGlbMaterials(
              gltf.scene,
              { widthMm: orientedB.w, depthMm: orientedB.d, heightMm: orientedB.h },
              { mountingType: inspected.mountingType, mountingFace: inspected.mountingFace }
            );
            setGlbMaterials(mats);
            setGlbEmissiveOverrides([]);
            setGlbDefaultLights([]);
            regenerateGlbPreview(
              gltf.scene,
              assetId,
              dataUrl,
              orientedB,
              glbRepMode,
              inspected.mountingType,
              inspected.mountingFace
            );
            setGlbBusy(false);
          } catch {
            setError('Could not extract 2D architectural projections from this GLB model.');
            setGlbBusy(false);
          }
        },
        undefined,
        () => {
          setError('Invalid or unsupported GLB/GLTF file.');
          setGlbBusy(false);
        }
      );
    };
    reader.readAsDataURL(file);
  };

  const handleTraceImgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setName(file.name.replace(/\.[^.]+$/, ''));
    const reader = new FileReader();
    reader.onload = () => {
      setTraceImgUrl(String(reader.result));
      setTracePoints([]);
    };
    reader.readAsDataURL(file);
  };

  const handleTraceCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setTracePoints((prev) => [...prev, { x: nx, y: ny }]);
  };

  const commitImport = (placeOnPlan: boolean) => {
    if (tab === 'svg') {
      const hasValidSvg = Boolean(svgSource && isValidSvgSource(svgSource));
      const reparsed = hasValidSvg && svgSource
        ? parseSvgSourceToProjectedView(svgSource, svgWidthMm, svgDepthMm, svgHeightMm, svgColor)
        : null;
      const baseParts = reparsed?.parts ?? svgParts;
      const parts = baseParts.map((p) => ({ ...p, heightMm: svgHeightMm, color: svgColor }));
      const finalParts: FurniturePart[] =
        parts.length > 0
          ? parts
          : [
              {
                id: uid('p'),
                name: 'Extruded Body',
                shape: 'box',
                xMm: 0,
                yMm: 0,
                zMm: 0,
                widthMm: svgWidthMm,
                depthMm: svgDepthMm,
                heightMm: svgHeightMm,
                rotationDeg: 0,
                color: svgColor,
                material: 'wood',
              },
            ];
      const silRep = generateRepresentationFromParts(finalParts, { mode: 'silhouette' });
      const tpl: CatalogTemplate = {
        id: uid('imp_svg'),
        name: name.trim() || 'SVG Extrusion',
        category: 'My Library',
        description: 'Extruded from uploaded SVG',
        svgSource: reparsed && svgSource ? svgSource : undefined,
        isCustom: true,
        parts: finalParts,
        representation: reparsed
          ? {
              ...silRep,
              mode: 'default',
              defaultViews: { top: reparsed.view },
            }
          : silRep,
      };
      onImportTemplate(tpl, placeOnPlan);
      onClose();
      return;
    }

    if (tab === 'glb') {
      if (!glbDataUrl || !glbBoundsMm) return;
      const parts = makeGlbBoundsParts(glbBoundsMm.w, glbBoundsMm.d, glbBoundsMm.h);
      const tpl: CatalogTemplate = {
        id: uid('imp_glb'),
        name: name.trim() || 'GLB Model',
        category: 'My Library',
        description: `Imported GLB/GLTF 3D Asset · ${MOUNTING_TYPE_LABELS[glbMountingType]}`,
        defaultMountingType: glbMountingType,
        defaultMountingFace: glbMountingFace,
        defaultElevationMm: glbMountingType === 'wall' ? 1100 : 0,
        glbAssetId: glbAssetId ?? undefined,
        glbDataUrl,
        glbEmissiveOverrides: glbEmissiveOverrides.length > 0 ? glbEmissiveOverrides : undefined,
        lights: glbDefaultLights.length > 0 ? glbDefaultLights : undefined,
        representation: glbPreviewRep ?? undefined,
        isCustom: true,
        parts,
      };
      onImportTemplate(tpl, placeOnPlan);
      onClose();
      return;
    }

    // Image-to-footprint trace
    if (tracePoints.length < 3) {
      setError('Click at least 3 corner points on the image to define a footprint.');
      return;
    }
    const xs = tracePoints.map((p) => p.x);
    const ys = tracePoints.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(0.05, maxX - minX);
    const targetWidthMm = traceTargetWidthCm * 10;
    const scaleMm = targetWidthMm / spanX;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const footprintPolygon: Point2D[] = tracePoints.map((p) => ({
      x: Math.round((p.x - cx) * scaleMm),
      y: Math.round((p.y - cy) * scaleMm),
    }));
    const depthMm = Math.max(100, Math.round((maxY - minY) * scaleMm));

    const traceParts: FurniturePart[] = [
      {
        id: uid('p'),
        name: 'Traced Volume',
        shape: 'box',
        xMm: 0,
        yMm: 0,
        zMm: 0,
        widthMm: targetWidthMm,
        depthMm,
        heightMm: traceHeightCm * 10,
        rotationDeg: 0,
        color: traceColor,
        material: 'wood',
      },
    ];
    const tpl: CatalogTemplate = {
      id: uid('imp_trace'),
      name: name.trim() || 'Traced Footprint',
      category: 'My Library',
      description: 'Traced from uploaded image',
      imageDataUrl: traceImgUrl ?? undefined,
      footprintPolygon,
      isCustom: true,
      parts: traceParts,
      representation: generateRepresentationFromParts(traceParts),
    };
    onImportTemplate(tpl, placeOnPlan);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs">
        <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Import Furniture to My Library
            </h2>
            <p className="text-[11px] text-slate-500">
              Extrude SVG shapes, import 3D GLB/GLTF models, or trace a footprint from an image.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close importer"
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="grid grid-cols-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
          {(
            [
              { id: 'svg', label: 'SVG Extrusion', Icon: FileCode2 },
              { id: 'glb', label: 'GLB / GLTF 3D', Icon: Box },
              { id: 'trace', label: 'Image Footprint', Icon: ImageIcon },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                setError(null);
              }}
              className={`py-2.5 flex items-center justify-center gap-1.5 font-medium border-b-2 cursor-pointer ${
                tab === id
                  ? 'border-blue-600 text-blue-600 bg-white dark:bg-slate-900'
                  : 'border-transparent text-slate-500'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          <div>
            <label className="block text-[11px] text-slate-500 mb-0.5">Library Item Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md font-medium"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {tab === 'svg' && (
            <div className="space-y-3">
              <label className="flex flex-col items-center justify-center py-6 px-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg hover:border-blue-500 cursor-pointer">
                <Upload className="w-5 h-5 text-slate-400 mb-1" />
                <span className="font-medium">Choose .svg vector file</span>
                <input type="file" accept=".svg,image/svg+xml" onChange={handleSvgUpload} className="hidden" />
              </label>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">Width (mm)</label>
                  <input
                    type="number"
                    value={svgWidthMm}
                    onChange={(e) => setSvgWidthMm(Math.max(50, Number(e.target.value)))}
                    className="w-full px-2 py-1.5 font-mono-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">Depth (mm)</label>
                  <input
                    type="number"
                    value={svgDepthMm}
                    onChange={(e) => setSvgDepthMm(Math.max(50, Number(e.target.value)))}
                    className="w-full px-2 py-1.5 font-mono-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">Extrude H (mm)</label>
                  <input
                    type="number"
                    value={svgHeightMm}
                    onChange={(e) => setSvgHeightMm(Math.max(20, Number(e.target.value)))}
                    className="w-full px-2 py-1.5 font-mono-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">Color</label>
                  <input
                    type="color"
                    value={svgColor}
                    onChange={(e) => setSvgColor(e.target.value.toUpperCase())}
                    className="w-full h-8 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
                  />
                </div>
              </div>
              {svgParts.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    Extracted {svgParts.length} parametric shape(s) ready for 2D & 3D (original SVG preserved as Default).
                  </div>
                  {svgPreviewRep?.defaultViews?.top && (() => {
                    const pv = svgPreviewRep.defaultViews!.top!;
                    const pad = Math.max(pv.viewBox.width, pv.viewBox.height) * 0.14 + 30;
                    const vb = `${pv.viewBox.minX - pad} ${pv.viewBox.minY - pad} ${pv.viewBox.width + pad * 2} ${pv.viewBox.height + pad * 2}`;
                    return (
                      <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white">
                        <div className="text-[10px] font-medium text-slate-500 mb-1">
                          Default 2D Plan (Original SVG)
                        </div>
                        <svg viewBox={vb} className="w-full h-28">
                          {renderFurnitureRepresentationView(svgPreviewRep, 'top')}
                        </svg>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {tab === 'glb' && (
            <div className="space-y-3">
              <label className="flex flex-col items-center justify-center py-6 px-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg hover:border-blue-500 cursor-pointer">
                <Upload className="w-5 h-5 text-slate-400 mb-1" />
                <span className="font-medium">Choose .glb or .gltf 3D file</span>
                <input type="file" accept=".glb,.gltf" onChange={handleGlbUpload} className="hidden" />
              </label>
              {glbBusy && (
                <p className="text-slate-500">
                  Reading 3D mesh geometry and extracting 5 orthographic SVG projections...
                </p>
              )}
              {glbBoundsMm && (
                <div className="space-y-2.5">
                  <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
                      {(glbBoundsMm.w / 10).toFixed(0)} × {(glbBoundsMm.d / 10).toFixed(0)} × {(glbBoundsMm.h / 10).toFixed(0)} cm
                    </span>
                    <div className="flex items-center gap-1 p-0.5 rounded bg-slate-200/70 dark:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          setGlbRepMode('silhouette');
                          if (glbSceneRef.current && glbAssetId && glbDataUrl && glbBoundsMm) {
                            regenerateGlbPreview(
                              glbSceneRef.current,
                              glbAssetId,
                              glbDataUrl,
                              glbBoundsMm,
                              'silhouette',
                              glbMountingType,
                              glbMountingFace
                            );
                          }
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                          glbRepMode === 'silhouette'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Silhouette
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGlbRepMode('hidden_line');
                          if (glbSceneRef.current && glbAssetId && glbDataUrl && glbBoundsMm) {
                            regenerateGlbPreview(
                              glbSceneRef.current,
                              glbAssetId,
                              glbDataUrl,
                              glbBoundsMm,
                              'hidden_line',
                              glbMountingType,
                              glbMountingFace
                            );
                          }
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                          glbRepMode === 'hidden_line'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Hidden-Line
                      </button>
                    </div>
                  </div>

                  {/* Detected Mounting Type & Orientation Presets */}
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        Mounting Type
                      </span>
                      {glbInspectReason && (
                        <span className="text-[10px] text-slate-500 truncate">
                          Auto · {glbInspectReason}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-5 gap-1">
                      {ALL_MOUNTING_TYPES.map((mt) => (
                        <button
                          key={mt}
                          type="button"
                          onClick={() =>
                            applyGlbMountingUpdate(mt, defaultMountingFaceForType(mt))
                          }
                          className={`py-1 px-1.5 rounded text-[11px] font-medium border cursor-pointer ${
                            glbMountingType === mt
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {MOUNTING_TYPE_LABELS[mt]}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        Model Mounting Face
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Source face aligned to {MOUNTING_TYPE_LABELS[glbMountingType].toLowerCase()}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {ALL_MOUNTING_FACES.map((mf) => (
                        <button
                          key={mf}
                          type="button"
                          onClick={() => applyGlbMountingUpdate(glbMountingType, mf)}
                          className={`py-1 px-1.5 rounded text-[11px] font-medium border cursor-pointer ${
                            glbMountingFace === mf
                              ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {MOUNTING_FACE_LABELS[mf]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {glbMaterials.length > 0 && (
                    <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                          Materials &amp; Emissive Glow ({glbMaterials.length})
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {glbDefaultLights.length} light{glbDefaultLights.length === 1 ? '' : 's'} paired
                        </span>
                      </div>
                      <div className="max-h-32 overflow-y-auto space-y-1 pr-0.5">
                        {glbMaterials.map((mat) => {
                          const existingOv = glbEmissiveOverrides.find(
                            (o) => o.materialKey === mat.materialKey
                          );
                          const isGlowOn = existingOv
                            ? existingOv.enabled
                            : mat.emissiveDetected && !mat.emissiveDisabled;
                          const effectiveColor =
                            existingOv?.emissiveColor ??
                            (mat.emissiveHex !== '#000000' ? mat.emissiveHex : mat.baseColorHex);
                          const hasPairedLight = glbDefaultLights.some(
                            (l) => l.sourceRef === mat.materialKey
                          );
                          return (
                            <div
                              key={mat.materialKey}
                              className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className="w-3 h-3 rounded-sm border border-black/20 shrink-0"
                                  style={{ backgroundColor: effectiveColor }}
                                />
                                <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                                  {mat.materialName}
                                </span>
                                {mat.emissiveDisabled && !existingOv && (
                                  <span className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[9px] shrink-0">
                                    Disabled Emissive
                                  </span>
                                )}
                                {mat.hasEmissiveMap && !mat.emissiveDisabled && (
                                  <span className="px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[9px] shrink-0">
                                    Emissive Map
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextEnabled = !isGlowOn;
                                    const nextColor =
                                      mat.emissiveHex !== '#000000'
                                        ? mat.emissiveHex
                                        : mat.baseColorHex !== '#000000'
                                          ? mat.baseColorHex
                                          : '#FF9F43';
                                    const nextOv: GlbMaterialEmissiveOverride = existingOv
                                      ? { ...existingOv, enabled: nextEnabled }
                                      : {
                                          materialKey: mat.materialKey,
                                          materialName: mat.materialName,
                                          meshNames: mat.meshNames,
                                          enabled: nextEnabled,
                                          emissiveColor: nextColor,
                                          emissiveIntensity: Math.max(1.2, mat.emissiveIntensity || 1.4),
                                          bloomBoost: 1.25,
                                          preserveEmissiveMap: mat.hasEmissiveMap,
                                        };
                                    setGlbEmissiveOverrides((prev) => [
                                      ...prev.filter((o) => o.materialKey !== mat.materialKey),
                                      nextOv,
                                    ]);
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-pointer ${
                                    isGlowOn
                                      ? 'bg-amber-500/15 border-amber-500/60 text-amber-700 dark:text-amber-300'
                                      : 'border-slate-200 dark:border-slate-700 text-slate-500'
                                  }`}
                                >
                                  {isGlowOn ? 'Glow ON' : 'Glow OFF'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (hasPairedLight) {
                                      setGlbDefaultLights((prev) =>
                                        prev.filter((l) => l.sourceRef !== mat.materialKey)
                                      );
                                    } else {
                                      const l = createMatchingLightForGlbMaterial(mat, existingOv);
                                      setGlbDefaultLights((prev) => [...prev, l]);
                                    }
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border inline-flex items-center gap-0.5 cursor-pointer ${
                                    hasPairedLight
                                      ? 'bg-blue-600 text-white border-blue-600'
                                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  <Sun className="w-2.5 h-2.5" />
                                  {hasPairedLight ? 'Lit' : '+ Light'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {glbPreviewRep?.autoViews?.top && glbPreviewRep.autoViews.front && (
                    <div className="grid grid-cols-2 gap-2">
                      {(['top', 'front'] as const).map((viewId) => {
                        const pv = glbPreviewRep.autoViews![viewId]!;
                        const pad = Math.max(pv.viewBox.width, pv.viewBox.height) * 0.14 + 30;
                        const vb = `${pv.viewBox.minX - pad} ${pv.viewBox.minY - pad} ${pv.viewBox.width + pad * 2} ${pv.viewBox.height + pad * 2}`;
                        return (
                          <div
                            key={viewId}
                            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white"
                          >
                            <div className="text-[10px] font-medium text-slate-500 mb-1">
                              {viewId === 'top' ? '2D Plan (Top Projection)' : 'Wall View (Front Elevation)'}
                            </div>
                            <svg viewBox={vb} className="w-full h-28">
                              {renderFurnitureRepresentationView(glbPreviewRep, viewId)}
                            </svg>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'trace' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <label className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer font-medium">
                  Upload Photo / Sketch
                  <input type="file" accept="image/*" onChange={handleTraceImgUpload} className="hidden" />
                </label>
                {tracePoints.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTracePoints([])}
                    className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-md flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset Points ({tracePoints.length})
                  </button>
                )}
              </div>

              {traceImgUrl && (
                <div className="relative border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-950 h-56 flex items-center justify-center">
                  <img src={traceImgUrl} alt="Trace reference" className="max-h-full max-w-full object-contain pointer-events-none" />
                  <svg
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    onClick={handleTraceCanvasClick}
                    className="absolute inset-0 w-full h-full cursor-crosshair"
                  >
                    {tracePoints.length >= 2 && (
                      <polygon
                        points={tracePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                        fill="rgba(37,99,235,0.22)"
                        stroke="#2563EB"
                        strokeWidth={0.008}
                      />
                    )}
                    {tracePoints.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={0.014} fill="#2563EB" stroke="#FFFFFF" strokeWidth={0.004} />
                    ))}
                  </svg>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">Real Width (cm)</label>
                  <input
                    type="number"
                    value={traceTargetWidthCm}
                    onChange={(e) => setTraceTargetWidthCm(Math.max(10, Number(e.target.value)))}
                    className="w-full px-2 py-1.5 font-mono-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">Extrude Height (cm)</label>
                  <input
                    type="number"
                    value={traceHeightCm}
                    onChange={(e) => setTraceHeightCm(Math.max(5, Number(e.target.value)))}
                    className="w-full px-2 py-1.5 font-mono-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5">Color</label>
                  <input
                    type="color"
                    value={traceColor}
                    onChange={(e) => setTraceColor(e.target.value.toUpperCase())}
                    className="w-full h-8 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50 dark:bg-slate-950">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => commitImport(true)}
            className="px-3.5 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 cursor-pointer"
          >
            Save to Library & Place
          </button>
        </footer>
      </div>
    </div>
  );
};
