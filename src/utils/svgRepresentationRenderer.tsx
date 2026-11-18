import React from 'react';
import type {
  FurnitureInstance,
  FurnitureRepresentation,
  ProjectedViewSvg,
  ProjectionViewId,
  SvgVectorElement,
} from '../types/plan';

export interface RenderSvgElementsOptions {
  baseStrokeMm: number;
  selected?: boolean;
  selectedStrokeColor?: string;
  useMaterialFill?: boolean;
  darkMode?: boolean;
  blackAndWhite?: boolean;
  ghostMode?: boolean;
  /** Optional scaleX/scaleY if live object dimensions changed relative to baseWidthMm/baseHeightMm */
  scaleX?: number;
  scaleY?: number;
}

export function hasCustomView(rep: FurnitureRepresentation | undefined, view: ProjectionViewId): boolean {
  return Boolean(rep?.customViews && Array.isArray(rep.customViews[view]));
}

export function hasAnyCustomViews(rep: FurnitureRepresentation | undefined): boolean {
  if (!rep?.customViews) return false;
  return (['top', 'front', 'rear', 'left', 'right'] as ProjectionViewId[]).some(
    (v) => Array.isArray(rep.customViews?.[v])
  );
}

export function getEffectiveViewElements(
  rep: FurnitureRepresentation | undefined,
  view: ProjectionViewId
): {
  elements: SvgVectorElement[] | null;
  fillElements: SvgVectorElement[] | null;
  autoView: ProjectedViewSvg | undefined;
  isCustom: boolean;
} {
  if (!rep) {
    return { elements: null, fillElements: null, autoView: undefined, isCustom: false };
  }
  const defaultView = rep.defaultViews?.[view];
  const autoView = rep.autoViews?.[view];
  const activeMeta = rep.mode === 'default' ? (defaultView ?? autoView) : autoView;
  const customEls = rep.customViews?.[view];
  if (Array.isArray(customEls)) {
    return {
      elements: customEls,
      fillElements: null,
      autoView: activeMeta,
      isCustom: true,
    };
  }
  if (rep.mode === 'default') {
    if (defaultView && Array.isArray(defaultView.elements) && defaultView.elements.length > 0) {
      return {
        elements: defaultView.elements,
        fillElements: defaultView.fillElements ?? null,
        autoView: defaultView,
        isCustom: false,
      };
    }
    return { elements: null, fillElements: null, autoView, isCustom: false };
  }
  if (autoView && Array.isArray(autoView.elements)) {
    return {
      elements: autoView.elements,
      fillElements: autoView.fillElements ?? null,
      autoView,
      isCustom: false,
    };
  }
  return { elements: null, fillElements: null, autoView, isCustom: false };
}

export function renderSingleSvgVectorElement(
  el: SvgVectorElement,
  opts: {
    baseStrokeMm: number;
    selected?: boolean;
    selectedStrokeColor?: string;
    overrideFill?: string;
    overrideStroke?: string;
    ghostMode?: boolean;
  }
): React.ReactNode {
  if (!el.visible) return null;

  const strokeFactor = el.strokeWidthMm > 0 ? el.strokeWidthMm / 12 : 0;
  const sw = el.stroke === 'none' || strokeFactor === 0 ? 0 : Math.max(2, opts.baseStrokeMm * strokeFactor);
  const stroke =
    el.stroke === 'none'
      ? 'none'
      : opts.ghostMode
        ? '#94A3B8'
        : opts.selected
          ? opts.selectedStrokeColor ?? '#2563EB'
          : opts.overrideStroke ?? el.stroke;

  const key = el.id;

  switch (el.kind) {
    case 'path': {
      const fill = opts.ghostMode
        ? 'none'
        : opts.overrideFill !== undefined
          ? opts.overrideFill
          : el.fill;
      const fillOpacity = opts.ghostMode ? 0 : el.fill === 'none' ? 0 : el.fillOpacity;
      return (
        <path
          key={key}
          d={el.d}
          fill={fill}
          fillOpacity={fillOpacity}
          fillRule={el.fillRule ?? 'evenodd'}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={opts.ghostMode ? 0.35 : 1}
        />
      );
    }
    case 'line':
      return (
        <line
          key={key}
          x1={el.x1}
          y1={el.y1}
          x2={el.x2}
          y2={el.y2}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          opacity={opts.ghostMode ? 0.35 : 1}
        />
      );
    case 'rect': {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const rot = el.rotationDeg ? `rotate(${el.rotationDeg}, ${cx}, ${cy})` : undefined;
      return (
        <rect
          key={key}
          x={el.x}
          y={el.y}
          width={Math.max(1, el.width)}
          height={Math.max(1, el.height)}
          rx={el.rx ?? 0}
          transform={rot}
          fill={opts.ghostMode ? 'none' : opts.overrideFill !== undefined ? opts.overrideFill : el.fill}
          fillOpacity={opts.ghostMode ? 0 : el.fill === 'none' ? 0 : el.fillOpacity}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          opacity={opts.ghostMode ? 0.35 : 1}
        />
      );
    }
    case 'ellipse': {
      const rot = el.rotationDeg ? `rotate(${el.rotationDeg}, ${el.cx}, ${el.cy})` : undefined;
      return (
        <ellipse
          key={key}
          cx={el.cx}
          cy={el.cy}
          rx={Math.max(1, el.rx)}
          ry={Math.max(1, el.ry)}
          transform={rot}
          fill={opts.ghostMode ? 'none' : opts.overrideFill !== undefined ? opts.overrideFill : el.fill}
          fillOpacity={opts.ghostMode ? 0 : el.fill === 'none' ? 0 : el.fillOpacity}
          stroke={stroke}
          strokeWidth={sw}
          opacity={opts.ghostMode ? 0.35 : 1}
        />
      );
    }
    case 'polyline': {
      const pts = el.points.map((p) => `${p.x},${p.y}`).join(' ');
      if (el.closed) {
        return (
          <polygon
            key={key}
            points={pts}
            fill={opts.ghostMode ? 'none' : opts.overrideFill !== undefined ? opts.overrideFill : el.fill}
            fillOpacity={opts.ghostMode ? 0 : el.fill === 'none' ? 0 : el.fillOpacity}
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={opts.ghostMode ? 0.35 : 1}
          />
        );
      }
      return (
        <polyline
          key={key}
          points={pts}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={opts.ghostMode ? 0.35 : 1}
        />
      );
    }
  }
}

export function renderFurnitureRepresentationView(
  furnOrRep: Pick<FurnitureInstance, 'representation'> | FurnitureRepresentation | undefined,
  view: ProjectionViewId,
  opts: Partial<RenderSvgElementsOptions> = {}
): React.ReactNode | null {
  const rep =
    furnOrRep && 'representation' in furnOrRep
      ? furnOrRep.representation
      : (furnOrRep as FurnitureRepresentation | undefined);
  const resolved = getEffectiveViewElements(rep, view);
  if (!resolved.elements || resolved.elements.length === 0) return null;

  const baseStrokeMm = opts.baseStrokeMm ?? 10;
  const isDefaultMode = rep?.mode === 'default' && !resolved.isCustom;
  const useMatFill = Boolean(opts.useMaterialFill && !resolved.isCustom && resolved.fillElements?.length);
  const sx = opts.scaleX ?? 1;
  const sy = opts.scaleY ?? 1;
  const needsScale = Math.abs(sx - 1) > 0.005 || Math.abs(sy - 1) > 0.005;

  const content = (
    <>
      {useMatFill &&
        resolved.fillElements!.map((fe) =>
          renderSingleSvgVectorElement(fe, {
            baseStrokeMm,
            selected: false,
            ghostMode: opts.ghostMode,
          })
        )}
      {resolved.elements.map((el) => {
        // When rendering material fills underneath auto silhouette, make silhouette fill transparent so color fills show through
        const isSilhouetteWithFill = useMatFill && el.id === `sil_${view}`;
        const elHasFill = 'fill' in el && el.fill !== 'none';
        const bwFillOverride =
          opts.blackAndWhite && isDefaultMode && elHasFill ? '#FFFFFF' : undefined;
        const bwStrokeOverride =
          opts.blackAndWhite && isDefaultMode && el.stroke !== 'none' ? '#0F172A' : undefined;
        return renderSingleSvgVectorElement(el, {
          baseStrokeMm,
          selected: opts.selected,
          selectedStrokeColor: opts.selectedStrokeColor,
          overrideFill: isSilhouetteWithFill ? 'none' : bwFillOverride,
          overrideStroke: bwStrokeOverride,
          ghostMode: opts.ghostMode,
        });
      })}
    </>
  );

  if (needsScale) {
    return <g transform={`scale(${sx}, ${sy})`}>{content}</g>;
  }
  return <>{content}</>;
}
