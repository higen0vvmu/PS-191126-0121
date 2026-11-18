import React from 'react';
import type { FurniturePart } from '../types/plan';

export interface RenderPartVectorOptions {
  opacity?: number;
  showDetails?: boolean;
  blackAndWhite?: boolean;
}

function resolveArchitecturalPartFill(part: FurniturePart, blackAndWhite?: boolean): string {
  if (!blackAndWhite) {
    return part.material === 'glass' ? 'rgba(186, 230, 253, 0.45)' : part.color;
  }
  if (part.material === 'glass') return '#F8FAFC';
  if (part.detailStyle === 'screen' || part.detailStyle === 'wall_tv' || part.detailStyle === 'electric_hob' || part.detailStyle === 'induction_hob') {
    return '#1E293B';
  }
  if (part.detailStyle === 'foliage' || part.detailStyle === 'leaves_palm' || part.detailStyle === 'leaves_olive') {
    return '#E2E8F0';
  }
  if (part.material === 'metal' || part.material === 'brass' || part.material === 'bronze' || part.material === 'chrome') {
    return '#E2E8F0';
  }
  if (part.material === 'matte_black_metal') return '#475569';
  return '#FFFFFF';
}

export function renderPartVector2D(
  part: FurniturePart,
  stroke: string,
  strokeWidth: number,
  options: RenderPartVectorOptions = {}
): React.ReactNode {
  const { opacity = 1, showDetails = true, blackAndWhite = false } = options;
  const w = Math.max(10, part.widthMm);
  const d = Math.max(10, part.depthMm);
  const hw = w / 2;
  const hd = d / 2;
  const fill = resolveArchitecturalPartFill(part, blackAndWhite);

  const renderShape = () => {
    switch (part.shape) {
      case 'cylinder':
      case 'sphere':
        return (
          <ellipse
            cx={0}
            cy={0}
            rx={hw}
            ry={hd}
            fill={fill}
            fillOpacity={opacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        );
      case 'oval':
        return (
          <ellipse
            cx={0}
            cy={0}
            rx={hw}
            ry={hd}
            fill={fill}
            fillOpacity={opacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        );
      case 'rounded_rect': {
        const r = Math.min(hw, hd) * 0.25;
        return (
          <rect
            x={-hw}
            y={-hd}
            width={w}
            height={d}
            rx={r}
            ry={r}
            fill={fill}
            fillOpacity={opacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        );
      }
      case 'l_profile': {
        const armW = Math.min(w * 0.42, Math.max(w * 0.25, 320));
        const armD = Math.min(d * 0.42, Math.max(d * 0.25, 320));
        const path = `M ${-hw} ${-hd} H ${hw} V ${-hd + armD} H ${-hw + armW} V ${hd} H ${-hw} Z`;
        return (
          <path
            d={path}
            fill={fill}
            fillOpacity={opacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        );
      }
      case 'u_profile': {
        const armW = Math.min(w * 0.3, Math.max(w * 0.2, 260));
        const backD = Math.min(d * 0.35, Math.max(d * 0.22, 260));
        const path = `M ${-hw} ${-hd} H ${hw} V ${hd} H ${hw - armW} V ${-hd + backD} H ${-hw + armW} V ${hd} H ${-hw} Z`;
        return (
          <path
            d={path}
            fill={fill}
            fillOpacity={opacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        );
      }
      case 'arc': {
        const path = `M ${-hw} ${hd} A ${hw} ${d} 0 0 1 ${hw} ${hd} L ${hw * 0.65} ${hd} A ${hw * 0.65} ${d * 0.65} 0 0 0 ${-hw * 0.65} ${hd} Z`;
        return (
          <path
            d={path}
            fill={fill}
            fillOpacity={opacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        );
      }
      case 'wedge': {
        const path = `M ${-hw} ${hd} L ${hw} ${hd} L ${hw} ${-hd} Z`;
        return (
          <path
            d={path}
            fill={fill}
            fillOpacity={opacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        );
      }
      case 'extruded_svg':
      case 'box':
      default:
        return (
          <rect
            x={-hw}
            y={-hd}
            width={w}
            height={d}
            rx={part.bevel ? Math.min(hw, hd) * 0.12 : 0}
            fill={fill}
            fillOpacity={opacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        );
    }
  };

  const renderDetail = () => {
    if (!showDetails || !part.detailStyle) return null;
    const thin = Math.max(strokeWidth * 0.65, 2);
    const isDarkFill = part.color === '#0F172A' || part.color === '#1E293B' || part.color === '#334155';
    const detailInk = isDarkFill ? '#E2E8F0' : stroke;

    switch (part.detailStyle) {
      case 'cushion':
      case 'mattress':
      case 'pillow':
        return (
          <rect
            x={-hw * 0.86}
            y={-hd * 0.84}
            width={w * 0.86}
            height={d * 0.84}
            rx={Math.min(hw, hd) * 0.14}
            fill="none"
            stroke={stroke}
            strokeOpacity={0.35}
            strokeWidth={thin}
          />
        );
      case 'tufted':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.35} strokeWidth={thin}>
            <rect
              x={-hw * 0.88}
              y={-hd * 0.86}
              width={w * 0.88}
              height={d * 0.86}
              rx={Math.min(hw, hd) * 0.12}
            />
            {[-0.5, 0, 0.5].map((fx, i) => (
              <g key={i}>
                <circle cx={hw * fx} cy={-hd * 0.25} r={thin * 1.4} fill={stroke} fillOpacity={0.35} />
                <circle cx={hw * fx} cy={hd * 0.25} r={thin * 1.4} fill={stroke} fillOpacity={0.35} />
              </g>
            ))}
          </g>
        );
      case 'slatted_wood': {
        const count = Math.max(5, Math.min(14, Math.round(w / 90)));
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.35} strokeWidth={thin}>
            {Array.from({ length: count }).map((_, i) => {
              const x = -hw * 0.88 + (i / (count - 1)) * w * 0.88;
              return <line key={i} x1={x} y1={-hd * 0.86} x2={x} y2={hd * 0.86} />;
            })}
          </g>
        );
      }
      case 'basin':
      case 'tub_inner':
        return (
          <g>
            <rect
              x={-hw * 0.78}
              y={-hd * 0.74}
              width={w * 0.78}
              height={d * 0.74}
              rx={Math.min(hw, hd) * 0.22}
              fill="none"
              stroke={stroke}
              strokeOpacity={0.5}
              strokeWidth={thin}
            />
            <circle cx={0} cy={-hd * 0.2} r={Math.min(w, d) * 0.06} fill={stroke} fillOpacity={0.45} />
          </g>
        );
      case 'drainboard':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.48} strokeWidth={thin}>
            {[-0.6, -0.3, 0, 0.3, 0.6].map((fy, idx) => (
              <line key={idx} x1={-hw * 0.8} y1={hd * fy} x2={hw * 0.8} y2={hd * fy} />
            ))}
          </g>
        );
      case 'burner':
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.75} strokeWidth={thin}>
            <circle cx={-hw * 0.42} cy={-hd * 0.4} r={Math.min(w, d) * 0.14} />
            <circle cx={hw * 0.42} cy={-hd * 0.4} r={Math.min(w, d) * 0.11} />
            <circle cx={-hw * 0.42} cy={hd * 0.4} r={Math.min(w, d) * 0.11} />
            <circle cx={hw * 0.42} cy={hd * 0.4} r={Math.min(w, d) * 0.14} />
          </g>
        );
      case 'gas_hob': {
        const burners = [
          { cx: -hw * 0.46, cy: -hd * 0.36, r: Math.min(w, d) * 0.16 },
          { cx: hw * 0.46, cy: -hd * 0.36, r: Math.min(w, d) * 0.13 },
          { cx: -hw * 0.46, cy: hd * 0.3, r: Math.min(w, d) * 0.13 },
          { cx: hw * 0.46, cy: hd * 0.3, r: Math.min(w, d) * 0.17 },
        ];
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.85} strokeWidth={thin}>
            {burners.map((b, i) => (
              <g key={i}>
                <circle cx={b.cx} cy={b.cy} r={b.r} />
                <circle cx={b.cx} cy={b.cy} r={b.r * 0.42} fill={detailInk} fillOpacity={0.55} />
                <line x1={b.cx - b.r * 1.25} y1={b.cy} x2={b.cx + b.r * 1.25} y2={b.cy} />
                <line x1={b.cx} y1={b.cy - b.r * 1.25} x2={b.cx} y2={b.cy + b.r * 1.25} />
              </g>
            ))}
            {/* Front rotary control knobs */}
            {[-0.55, -0.18, 0.18, 0.55].map((fx, i) => (
              <circle key={`k_${i}`} cx={hw * fx} cy={hd * 0.84} r={Math.min(w, d) * 0.032} fill={detailInk} fillOpacity={0.75} />
            ))}
          </g>
        );
      }
      case 'electric_hob': {
        const zones = [
          { cx: -hw * 0.45, cy: -hd * 0.36, r: Math.min(w, d) * 0.16 },
          { cx: hw * 0.45, cy: -hd * 0.36, r: Math.min(w, d) * 0.13 },
          { cx: -hw * 0.45, cy: hd * 0.32, r: Math.min(w, d) * 0.13 },
          { cx: hw * 0.45, cy: hd * 0.32, r: Math.min(w, d) * 0.17 },
        ];
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.85} strokeWidth={thin}>
            {zones.map((z, i) => (
              <g key={i}>
                <circle cx={z.cx} cy={z.cy} r={z.r} />
                <circle cx={z.cx} cy={z.cy} r={z.r * 0.62} strokeDasharray={`${thin * 2} ${thin * 2}`} />
              </g>
            ))}
            <line x1={-hw * 0.5} y1={hd * 0.84} x2={hw * 0.5} y2={hd * 0.84} strokeOpacity={0.6} />
          </g>
        );
      }
      case 'induction_hob': {
        const zones = [
          { cx: -hw * 0.46, cy: -hd * 0.34, r: Math.min(w, d) * 0.16 },
          { cx: hw * 0.46, cy: -hd * 0.34, r: Math.min(w, d) * 0.15 },
          { cx: -hw * 0.46, cy: hd * 0.32, r: Math.min(w, d) * 0.15 },
          { cx: hw * 0.46, cy: hd * 0.32, r: Math.min(w, d) * 0.18 },
        ];
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.88} strokeWidth={thin}>
            {zones.map((z, i) => (
              <g key={i}>
                <circle cx={z.cx} cy={z.cy} r={z.r} strokeOpacity={0.75} />
                <line x1={z.cx - z.r * 0.45} y1={z.cy} x2={z.cx + z.r * 0.45} y2={z.cy} />
                <line x1={z.cx} y1={z.cy - z.r * 0.45} x2={z.cx} y2={z.cy + z.r * 0.45} />
              </g>
            ))}
            <rect x={-hw * 0.35} y={hd * 0.78} width={w * 0.35} height={d * 0.06} rx={thin} strokeOpacity={0.65} />
          </g>
        );
      }
      case 'oven_front':
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.82} strokeWidth={thin}>
            {/* Recessed glass viewing window line + top rotary dial indicators */}
            <line x1={-hw * 0.78} y1={hd * 0.55} x2={hw * 0.78} y2={hd * 0.55} />
            <circle cx={-hw * 0.56} cy={0} r={thin * 1.2} fill={detailInk} fillOpacity={0.75} />
            <circle cx={hw * 0.56} cy={0} r={thin * 1.2} fill={detailInk} fillOpacity={0.75} />
            <rect x={-hw * 0.2} y={-hd * 0.3} width={w * 0.2} height={d * 0.3} strokeOpacity={0.65} />
            {/* Front protruding tubular oven handle bar */}
            <line x1={-hw * 0.78} y1={hd * 1.55} x2={hw * 0.78} y2={hd * 1.55} stroke={stroke} strokeWidth={thin * 1.65} />
            <line x1={-hw * 0.62} y1={hd * 0.85} x2={-hw * 0.62} y2={hd * 1.55} stroke={stroke} />
            <line x1={hw * 0.62} y1={hd * 0.85} x2={hw * 0.62} y2={hd * 1.55} stroke={stroke} />
          </g>
        );
      case 'microwave_front': {
        const isSlim = d <= 80;
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.8} strokeWidth={thin}>
            {isSlim ? (
              <>
                <line x1={-hw * 0.84} y1={hd * 0.6} x2={hw * 0.32} y2={hd * 0.6} strokeWidth={thin * 1.5} />
                <line x1={hw * 0.42} y1={-hd * 0.6} x2={hw * 0.42} y2={hd * 0.6} />
                <line x1={hw * 0.34} y1={hd * 1.4} x2={hw * 0.34} y2={0} stroke={stroke} strokeWidth={thin * 1.4} />
              </>
            ) : (
              <>
                <rect x={-hw * 0.88} y={-hd * 0.8} width={w * 0.64} height={d * 0.8} />
                <circle cx={-hw * 0.16} cy={0} r={Math.min(w, d) * 0.22} strokeOpacity={0.45} />
                <rect x={hw * 0.48} y={-hd * 0.78} width={w * 0.18} height={d * 0.78} />
                <line x1={-hw * 0.82} y1={hd * 0.9} x2={hw * 0.32} y2={hd * 0.9} strokeWidth={thin * 1.6} />
              </>
            )}
          </g>
        );
      }
      case 'fridge_single':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.62} strokeWidth={thin}>
            <line x1={-hw * 0.94} y1={hd * 0.78} x2={hw * 0.94} y2={hd * 0.78} />
            <line x1={-hw * 0.78} y1={hd * 0.92} x2={-hw * 0.78} y2={hd * 1.08} strokeWidth={thin * 1.8} />
            <path d={`M ${-hw * 0.62} ${-hd * 0.55} L 0 0 L ${hw * 0.62} ${-hd * 0.55}`} strokeOpacity={0.28} />
          </g>
        );
      case 'fridge_double':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.65} strokeWidth={thin}>
            <line x1={-hw * 0.94} y1={hd * 0.76} x2={hw * 0.94} y2={hd * 0.76} />
            <line x1={-hw * 0.94} y1={hd * 0.86} x2={hw * 0.94} y2={hd * 0.86} strokeOpacity={0.4} />
            <line x1={-hw * 0.78} y1={hd * 0.92} x2={-hw * 0.78} y2={hd * 1.08} strokeWidth={thin * 1.8} />
            <path d={`M ${-hw * 0.55} ${-hd * 0.48} L 0 ${hd * 0.25} L ${hw * 0.55} ${-hd * 0.48}`} strokeOpacity={0.32} />
          </g>
        );
      case 'fridge_side_by_side': {
        const splitX = -hw * 0.16;
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.68} strokeWidth={thin}>
            <line x1={splitX} y1={-hd * 0.82} x2={splitX} y2={hd * 0.96} />
            <line x1={-hw * 0.94} y1={hd * 0.78} x2={hw * 0.94} y2={hd * 0.78} />
            <rect x={-hw * 0.72} y={hd * 0.56} width={w * 0.18} height={d * 0.18} strokeOpacity={0.75} />
            <line x1={splitX - hw * 0.12} y1={hd * 0.94} x2={splitX - hw * 0.12} y2={hd * 1.1} strokeWidth={thin * 1.8} />
            <line x1={splitX + hw * 0.12} y1={hd * 0.94} x2={splitX + hw * 0.12} y2={hd * 1.1} strokeWidth={thin * 1.8} />
          </g>
        );
      }
      case 'fridge_french':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.68} strokeWidth={thin}>
            <line x1={0} y1={-hd * 0.78} x2={0} y2={hd * 0.96} />
            <line x1={-hw * 0.94} y1={hd * 0.76} x2={hw * 0.94} y2={hd * 0.76} />
            <line x1={-hw * 0.12} y1={hd * 0.92} x2={-hw * 0.12} y2={hd * 1.08} strokeWidth={thin * 1.7} />
            <line x1={hw * 0.12} y1={hd * 0.92} x2={hw * 0.12} y2={hd * 1.08} strokeWidth={thin * 1.7} />
            <line x1={-hw * 0.64} y1={hd * 1.12} x2={hw * 0.64} y2={hd * 1.12} strokeWidth={thin * 1.8} />
          </g>
        );
      case 'wine_cooler':
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.78} strokeWidth={thin}>
            <rect x={-hw * 0.84} y={-hd * 0.74} width={w * 0.84} height={d * 0.74} strokeOpacity={0.45} />
            <line x1={-hw * 0.74} y1={-hd * 0.35} x2={hw * 0.74} y2={-hd * 0.35} />
            <line x1={-hw * 0.74} y1={0} x2={hw * 0.74} y2={0} />
            <line x1={-hw * 0.74} y1={hd * 0.35} x2={hw * 0.74} y2={hd * 0.35} />
            <line x1={-hw * 0.94} y1={hd * 0.78} x2={hw * 0.94} y2={hd * 0.78} />
            <line x1={hw * 0.78} y1={hd * 0.92} x2={hw * 0.78} y2={hd * 1.08} stroke={stroke} strokeWidth={thin * 1.8} />
          </g>
        );
      case 'dishwasher':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.68} strokeWidth={thin}>
            {/* Recessed front door seam & drop-down diagonal architectural symbol */}
            <line x1={-hw * 0.94} y1={hd * 0.78} x2={hw * 0.94} y2={hd * 0.78} />
            <path d={`M ${-hw * 0.78} ${-hd * 0.56} L 0 ${hd * 0.74} L ${hw * 0.78} ${-hd * 0.56}`} strokeOpacity={0.38} />
            {/* Inner dish-rack bar lines */}
            {[-0.45, -0.15, 0.15].map((fy, i) => (
              <line key={i} x1={-hw * 0.56} y1={hd * fy} x2={hw * 0.56} y2={hd * fy} strokeOpacity={0.3} />
            ))}
            {/* Front horizontal bar handle */}
            <line x1={-hw * 0.68} y1={hd * 1.06} x2={hw * 0.68} y2={hd * 1.06} strokeWidth={thin * 1.8} />
          </g>
        );
      case 'washer_topload':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.72} strokeWidth={thin}>
            {/* Rear raised backsplash control console + center dial */}
            <rect x={-hw * 0.92} y={-hd * 0.92} width={w * 0.92} height={d * 0.16} strokeOpacity={0.65} />
            <circle cx={0} cy={-hd * 0.76} r={Math.min(hw, hd) * 0.09} fill={stroke} fillOpacity={0.55} />
            {/* Hinged smoked glass top lid + stainless inner wash basket */}
            <rect x={-hw * 0.78} y={-hd * 0.56} width={w * 0.78} height={d * 0.64} rx={thin * 2} />
            <circle cx={0} cy={hd * 0.08} r={Math.min(hw, hd) * 0.44} strokeOpacity={0.55} />
            <circle cx={0} cy={hd * 0.08} r={Math.min(hw, hd) * 0.14} strokeOpacity={0.45} />
          </g>
        );
      case 'hood_filter':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.55} strokeWidth={thin}>
            <rect
              x={-hw * 0.9}
              y={-hd * 0.86}
              width={w * 0.9}
              height={d * 0.86}
              strokeDasharray={`${thin * 4} ${thin * 2.5}`}
            />
            <rect x={-hw * 0.24} y={-hd * 0.28} width={w * 0.24} height={d * 0.28} strokeOpacity={0.75} />
            {[-0.62, -0.32, 0, 0.32, 0.62].map((fx, i) => (
              <line key={i} x1={hw * fx} y1={-hd * 0.84} x2={hw * fx} y2={hd * 0.84} strokeOpacity={0.35} />
            ))}
          </g>
        );
      case 'coffee_machine':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.75} strokeWidth={thin}>
            <rect x={-hw * 0.82} y={-hd * 0.82} width={w * 0.82} height={d * 0.52} />
            <circle cx={0} cy={hd * 0.42} r={Math.min(w, d) * 0.15} />
            <line x1={0} y1={hd * 0.56} x2={0} y2={hd * 0.96} strokeWidth={thin * 1.8} />
          </g>
        );
      case 'drip_coffee':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.72} strokeWidth={thin}>
            <rect x={-hw * 0.82} y={-hd * 0.86} width={w * 0.82} height={d * 0.44} />
            <circle cx={0} cy={hd * 0.32} r={Math.min(hw, hd) * 0.5} />
            <line x1={0} y1={hd * 0.82} x2={0} y2={hd * 0.98} strokeWidth={thin * 1.6} />
          </g>
        );
      case 'kettle':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.75} strokeWidth={thin}>
            <circle cx={0} cy={0} r={Math.min(hw, hd) * 0.56} />
            <circle cx={0} cy={0} r={Math.min(hw, hd) * 0.16} strokeOpacity={0.45} />
            <line x1={hw * 0.56} y1={0} x2={hw * 0.96} y2={0} strokeWidth={thin * 1.5} />
            <path d={`M ${-hw * 0.56} ${-hd * 0.24} H ${-hw * 0.9} V ${hd * 0.24} H ${-hw * 0.56}`} />
          </g>
        );
      case 'stand_mixer':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.75} strokeWidth={thin}>
            <rect x={-hw * 0.62} y={-hd * 0.84} width={w * 0.62} height={d * 0.52} rx={Math.min(hw, hd) * 0.2} />
            <circle cx={0} cy={hd * 0.28} r={Math.min(hw, hd) * 0.54} />
            <line x1={-hw * 0.16} y1={hd * 0.28} x2={hw * 0.16} y2={hd * 0.28} strokeOpacity={0.5} />
            <line x1={0} y1={hd * 0.12} x2={0} y2={hd * 0.44} strokeOpacity={0.5} />
            <line x1={hw * 0.62} y1={-hd * 0.24} x2={hw * 0.86} y2={-hd * 0.24} strokeWidth={thin * 1.6} />
          </g>
        );
      case 'toaster':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.75} strokeWidth={thin}>
            <rect x={-hw * 0.66} y={-hd * 0.42} width={w * 0.66} height={d * 0.18} rx={thin} />
            <rect x={-hw * 0.66} y={hd * 0.12} width={w * 0.66} height={d * 0.18} rx={thin} />
            <line x1={hw * 0.88} y1={-hd * 0.25} x2={hw * 0.98} y2={-hd * 0.25} strokeWidth={thin * 1.6} />
          </g>
        );
      case 'toilet_bowl':
        return (
          <ellipse
            cx={0}
            cy={hd * 0.08}
            rx={hw * 0.62}
            ry={hd * 0.58}
            fill="none"
            stroke={stroke}
            strokeOpacity={0.5}
            strokeWidth={thin}
          />
        );
      case 'drain':
        return (
          <circle
            cx={0}
            cy={0}
            r={Math.min(hw, hd) * 0.16}
            fill="none"
            stroke={stroke}
            strokeOpacity={0.55}
            strokeWidth={thin}
          />
        );
      case 'washer_drum':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.68} strokeWidth={thin}>
            {/* Top-projected drum circle & central fin + detergent corner + front porthole rim */}
            <circle cx={0} cy={0} r={Math.min(hw, hd) * 0.54} />
            <circle cx={0} cy={0} r={Math.min(hw, hd) * 0.24} strokeOpacity={0.45} />
            <rect x={-hw * 0.86} y={hd * 0.62} width={w * 0.26} height={d * 0.14} strokeOpacity={0.55} />
            <path d={`M ${-hw * 0.45} ${hd} Q 0 ${hd * 1.18} ${hw * 0.45} ${hd}`} strokeWidth={thin * 1.5} />
          </g>
        );
      case 'dryer_drum':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.68} strokeWidth={thin}>
            <circle cx={0} cy={0} r={Math.min(hw, hd) * 0.56} />
            <circle cx={0} cy={0} r={Math.min(hw, hd) * 0.34} strokeDasharray={`${thin * 2} ${thin * 2}`} />
            <line x1={0} y1={-Math.min(hw, hd) * 0.34} x2={0} y2={Math.min(hw, hd) * 0.34} strokeOpacity={0.4} />
            <path d={`M ${-hw * 0.48} ${hd} Q 0 ${hd * 1.18} ${hw * 0.48} ${hd}`} strokeWidth={thin * 1.5} />
          </g>
        );
      case 'foliage':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.42} strokeWidth={thin}>
            <circle cx={0} cy={0} r={Math.min(hw, hd) * 0.42} strokeOpacity={0.22} />
            <line x1={-hw * 0.72} y1={0} x2={hw * 0.72} y2={0} />
            <line x1={0} y1={-hd * 0.72} x2={0} y2={hd * 0.72} />
            <line x1={-hw * 0.52} y1={-hd * 0.52} x2={hw * 0.52} y2={hd * 0.52} />
            <line x1={-hw * 0.52} y1={hd * 0.52} x2={hw * 0.52} y2={-hd * 0.52} />
          </g>
        );
      case 'leaves_palm':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.48} strokeWidth={thin}>
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
              const rad = (deg * Math.PI) / 180;
              const rx = Math.cos(rad) * hw * 0.85;
              const ry = Math.sin(rad) * hd * 0.85;
              return (
                <path
                  key={deg}
                  d={`M 0 0 Q ${rx * 0.55 - ry * 0.18} ${ry * 0.55 + rx * 0.18} ${rx} ${ry}`}
                />
              );
            })}
          </g>
        );
      case 'leaves_olive':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.4} strokeWidth={thin}>
            <circle cx={-hw * 0.3} cy={-hd * 0.22} r={Math.min(hw, hd) * 0.36} />
            <circle cx={hw * 0.32} cy={-hd * 0.18} r={Math.min(hw, hd) * 0.34} />
            <circle cx={0} cy={hd * 0.3} r={Math.min(hw, hd) * 0.38} />
          </g>
        );
      case 'planter_pot':
        return (
          <circle
            cx={0}
            cy={0}
            r={Math.min(hw, hd) * 0.8}
            fill="none"
            stroke={stroke}
            strokeOpacity={0.45}
            strokeWidth={thin}
          />
        );
      case 'rug':
        return (
          <rect
            x={-hw * 0.9}
            y={-hd * 0.9}
            width={w * 0.9}
            height={d * 0.9}
            fill="none"
            stroke={stroke}
            strokeOpacity={0.35}
            strokeDasharray={`${thin * 4} ${thin * 3}`}
            strokeWidth={thin}
          />
        );
      case 'fringe_rug': {
        const steps = 6;
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.45} strokeWidth={thin}>
            <rect x={-hw * 0.86} y={-hd * 0.86} width={w * 0.86} height={d * 0.86} />
            <rect
              x={-hw * 0.72}
              y={-hd * 0.72}
              width={w * 0.72}
              height={d * 0.72}
              strokeOpacity={0.25}
              strokeDasharray={`${thin * 3} ${thin * 3}`}
            />
            {Array.from({ length: steps }).map((_, i) => {
              const fy = -hd * 0.78 + (i / (steps - 1)) * d * 0.78;
              return (
                <g key={i}>
                  <line x1={-hw} y1={fy} x2={-hw - Math.min(w * 0.05, 55)} y2={fy} />
                  <line x1={hw} y1={fy} x2={hw + Math.min(w * 0.05, 55)} y2={fy} />
                </g>
              );
            })}
          </g>
        );
      }
      case 'blanket':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.35} strokeWidth={thin}>
            <line x1={-hw * 0.88} y1={-hd * 0.35} x2={hw * 0.88} y2={-hd * 0.35} />
            <line x1={-hw * 0.88} y1={hd * 0.35} x2={hw * 0.88} y2={hd * 0.35} />
          </g>
        );
      case 'books':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.55} strokeWidth={thin}>
            <line x1={-hw * 0.5} y1={-hd * 0.85} x2={-hw * 0.5} y2={hd * 0.85} />
            <line x1={0} y1={-hd * 0.85} x2={0} y2={hd * 0.85} />
            <line x1={hw * 0.5} y1={-hd * 0.85} x2={hw * 0.5} y2={hd * 0.85} />
          </g>
        );
      case 'vase':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.55} strokeWidth={thin}>
            <circle cx={0} cy={0} r={Math.min(hw, hd) * 0.45} />
            <circle cx={0} cy={0} r={Math.min(hw, hd) * 0.16} fill={stroke} fillOpacity={0.35} />
          </g>
        );
      case 'bowl':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.5} strokeWidth={thin}>
            <circle cx={0} cy={0} r={Math.min(hw, hd) * 0.65} />
            <circle cx={-hw * 0.18} cy={-hd * 0.1} r={Math.min(hw, hd) * 0.18} />
            <circle cx={hw * 0.2} cy={hd * 0.14} r={Math.min(hw, hd) * 0.16} />
          </g>
        );
      case 'sculptural':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.58} strokeWidth={thin}>
            <circle cx={-hw * 0.25} cy={0} r={Math.min(hw, hd) * 0.42} />
            <circle cx={hw * 0.25} cy={0} r={Math.min(hw, hd) * 0.42} />
          </g>
        );
      case 'candle_tray':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.55} strokeWidth={thin}>
            <rect x={-hw * 0.82} y={-hd * 0.82} width={w * 0.82} height={d * 0.82} rx={Math.min(hw, hd) * 0.15} />
            <circle cx={-hw * 0.24} cy={-hd * 0.12} r={Math.min(hw, hd) * 0.2} />
            <circle cx={hw * 0.22} cy={hd * 0.18} r={Math.min(hw, hd) * 0.17} />
          </g>
        );
      case 'faucet':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.72} strokeWidth={thin * 1.2}>
            <circle cx={0} cy={-hd * 0.64} r={Math.min(hw * 0.72, 22)} />
            <line x1={0} y1={-hd * 0.64} x2={0} y2={hd * 0.88} />
            <line x1={0} y1={-hd * 0.64} x2={hw * 0.82} y2={-hd * 0.64} />
          </g>
        );
      case 'caster_base':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.48} strokeWidth={thin}>
            {[0, 72, 144, 216, 288].map((deg) => {
              const rad = (deg * Math.PI) / 180;
              return (
                <line
                  key={deg}
                  x1={0}
                  y1={0}
                  x2={Math.sin(rad) * hw * 0.92}
                  y2={Math.cos(rad) * hd * 0.92}
                />
              );
            })}
          </g>
        );
      case 'towel_rail':
      case 'fluted':
        return (
          <g fill="none" stroke={stroke} strokeOpacity={0.35} strokeWidth={thin}>
            {[-0.6, -0.3, 0, 0.3, 0.6].map((f, idx) => (
              <line key={idx} x1={hw * f} y1={-hd * 0.82} x2={hw * f} y2={hd * 0.82} />
            ))}
          </g>
        );
      case 'lamp_base':
        return (
          <circle
            cx={0}
            cy={0}
            r={Math.min(hw, hd) * 0.52}
            fill="none"
            stroke={stroke}
            strokeOpacity={0.42}
            strokeWidth={thin}
          />
        );
      case 'lamp_shade':
        return (
          <circle
            cx={0}
            cy={0}
            r={Math.min(hw, hd) * 0.35}
            fill="none"
            stroke={stroke}
            strokeOpacity={0.45}
            strokeWidth={thin}
          />
        );
      case 'wall_tv':
        return d <= 24 ? (
          <g fill="none" stroke={detailInk} strokeOpacity={0.9} strokeWidth={thin}>
            {/* Screen display highlight line */}
            <line x1={-hw * 0.94} y1={hd * 0.35} x2={hw * 0.94} y2={hd * 0.35} strokeWidth={thin * 1.8} />
            {/* Short rear VESA bracket connection ticks toward wall mount housing */}
            <line x1={-hw * 0.22} y1={0} x2={-hw * 0.22} y2={-hd * 1.4} stroke={stroke} strokeWidth={thin * 1.2} />
            <line x1={hw * 0.22} y1={0} x2={hw * 0.22} y2={-hd * 1.4} stroke={stroke} strokeWidth={thin * 1.2} />
          </g>
        ) : (
          <g fill="none" stroke={detailInk} strokeOpacity={0.85} strokeWidth={thin}>
            {/* Single-part wall TV: front OLED line + VESA standoff arms + wall cleat inside [-hd, +hd] */}
            <line x1={-hw * 0.92} y1={hd * 0.65} x2={hw * 0.92} y2={hd * 0.65} strokeWidth={thin * 1.8} />
            <line x1={-hw * 0.22} y1={hd * 0.65} x2={-hw * 0.22} y2={-hd * 0.88} stroke={stroke} strokeWidth={thin * 1.3} />
            <line x1={hw * 0.22} y1={hd * 0.65} x2={hw * 0.22} y2={-hd * 0.88} stroke={stroke} strokeWidth={thin * 1.3} />
            <line x1={-hw * 0.4} y1={-hd * 0.88} x2={hw * 0.4} y2={-hd * 0.88} stroke={stroke} strokeWidth={thin * 2} />
          </g>
        );
      case 'curtain_pleat': {
        const pleatCount = Math.max(4, Math.min(22, Math.round(w / 90)));
        const stepX = w / pleatCount;
        let path = `M ${-hw} 0`;
        for (let i = 0; i < pleatCount; i++) {
          const x0 = -hw + i * stepX;
          const xMid = x0 + stepX * 0.5;
          const x1 = x0 + stepX;
          const amp = hd * 0.72 * (i % 2 === 0 ? 1 : -1);
          path += ` Q ${xMid} ${amp} ${x1} 0`;
        }
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.78} strokeWidth={thin}>
            <line x1={-hw * 0.96} y1={0} x2={hw * 0.96} y2={0} strokeOpacity={0.32} />
            <path d={path} strokeWidth={thin * 1.25} />
          </g>
        );
      }
      case 'blinds_slats':
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.75} strokeWidth={thin}>
            <line x1={-hw * 0.94} y1={-hd * 0.45} x2={hw * 0.94} y2={-hd * 0.45} />
            <line x1={-hw * 0.94} y1={0} x2={hw * 0.94} y2={0} />
            <line x1={-hw * 0.94} y1={hd * 0.45} x2={hw * 0.94} y2={hd * 0.45} />
            <circle cx={-hw * 0.85} cy={0} r={thin * 1.1} fill={detailInk} fillOpacity={0.6} />
          </g>
        );
      case 'roller_blind':
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.78} strokeWidth={thin}>
            <line x1={-hw * 0.94} y1={0} x2={hw * 0.94} y2={0} strokeWidth={thin * 1.4} />
            <line x1={-hw * 0.94} y1={hd * 0.65} x2={hw * 0.94} y2={hd * 0.65} strokeDasharray={`${thin * 3} ${thin * 2}`} />
          </g>
        );
      case 'ac_indoor':
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.82} strokeWidth={thin}>
            {/* Top intake vent lines + front supply louver & digital status badge */}
            <line x1={-hw * 0.86} y1={-hd * 0.48} x2={hw * 0.86} y2={-hd * 0.48} strokeOpacity={0.42} />
            <line x1={-hw * 0.86} y1={-hd * 0.22} x2={hw * 0.86} y2={-hd * 0.22} strokeOpacity={0.42} />
            <line x1={-hw * 0.88} y1={hd * 0.68} x2={hw * 0.88} y2={hd * 0.68} strokeWidth={thin * 1.6} />
            <rect x={hw * 0.56} y={hd * 0.12} width={w * 0.14} height={d * 0.22} rx={thin} strokeOpacity={0.7} />
          </g>
        );
      case 'ac_outdoor': {
        const fanCx = -hw * 0.26;
        const fanR = Math.min(hw * 0.46, hd * 0.62);
        return (
          <g fill="none" stroke={detailInk} strokeOpacity={0.82} strokeWidth={thin}>
            {/* Front circular discharge grille projection + rear condenser fin hatching + compressor box divider */}
            <line x1={hw * 0.42} y1={-hd * 0.92} x2={hw * 0.42} y2={hd * 0.92} strokeOpacity={0.55} />
            <line x1={-hw * 0.84} y1={-hd * 0.68} x2={hw * 0.34} y2={-hd * 0.68} strokeOpacity={0.4} />
            <circle cx={fanCx} cy={hd * 0.72} r={fanR * 0.45} strokeOpacity={0.55} />
            <line x1={fanCx - fanR * 0.75} y1={hd * 0.96} x2={fanCx + fanR * 0.75} y2={hd * 0.96} strokeWidth={thin * 1.7} />
          </g>
        );
      }
      case 'art_canvas':
      case 'mirror':
      case 'screen':
        return (
          <line
            x1={-hw * 0.85}
            y1={0}
            x2={hw * 0.85}
            y2={0}
            stroke={detailInk}
            strokeOpacity={0.6}
            strokeWidth={thin * 1.4}
          />
        );
      default:
        return null;
    }
  };

  return (
    <g>
      {renderShape()}
      {renderDetail()}
    </g>
  );
}
