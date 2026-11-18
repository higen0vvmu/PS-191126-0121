import * as THREE from 'three';
import type { MaterialPreset } from '../types/plan';
import {
  getDefaultTileMeters,
  getMaterialPresetMeta,
  isPresetPreTinted,
} from '../data/materials';

import oakTexUrl from '../assets/images/oak_wood_tex_1794957035530.jpg';
import walnutTexUrl from '../assets/images/walnut_wood_tex_1794957036232.jpg';
import carraraTexUrl from '../assets/images/carrara_marble_tex_1794957035647.jpg';
import travertineTexUrl from '../assets/images/travertine_stone_tex_1794957036064.jpg';
import concreteTexUrl from '../assets/images/concrete_surface_tex_1794957037740.jpg';
import brickTexUrl from '../assets/images/red_brick_tex_1794957037947.jpg';
import leatherTexUrl from '../assets/images/cognac_leather_tex_1794957039190.jpg';
import linenTexUrl from '../assets/images/linen_weave_tex_1794957054268.jpg';
import terrazzoTexUrl from '../assets/images/terrazzo_stone_tex_1794957056077.jpg';
import boucleTexUrl from '../assets/images/boucle_wool_tex_1794957070945.jpg';
import slateTexUrl from '../assets/images/slate_stone_tex_1794957071075.jpg';

type TexRole = 'albedo' | 'bump' | 'roughness';

const TEXTURE_CACHE = new Map<string, THREE.CanvasTexture>();
const IMAGE_CACHE = new Map<string, HTMLImageElement>();
const PENDING_DRAWS = new Map<string, Array<() => void>>();

let onTextureReadyCallback: (() => void) | null = null;

export function setTextureReadyCallback(cb: (() => void) | null): void {
  onTextureReadyCallback = cb;
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function makeCanvas(size = 512): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function getSourceImageUrl(preset: MaterialPreset): string | null {
  switch (preset) {
    case 'wood':
    case 'oak':
    case 'teak':
    case 'smoked_oak':
    case 'parquet':
    case 'herringbone':
    case 'paneling':
      return oakTexUrl;
    case 'walnut':
      return walnutTexUrl;
    case 'marble':
    case 'calacatta_gold':
    case 'nero_marble':
      return carraraTexUrl;
    case 'travertine':
      return travertineTexUrl;
    case 'slate':
      return slateTexUrl;
    case 'concrete':
    case 'plaster':
      return concreteTexUrl;
    case 'brick':
      return brickTexUrl;
    case 'terrazzo':
      return terrazzoTexUrl;
    case 'fabric':
    case 'wallpaper':
    case 'velvet':
      return linenTexUrl;
    case 'boucle':
      return boucleTexUrl;
    case 'leather_cognac':
    case 'leather_black':
    case 'leather_cream':
      return leatherTexUrl;
    default:
      return null;
  }
}

function requestImage(url: string, onReady: () => void): HTMLImageElement | null {
  const existing = IMAGE_CACHE.get(url);
  if (existing && existing.complete && existing.naturalWidth > 0) {
    return existing;
  }
  const waiters = PENDING_DRAWS.get(url);
  if (waiters) {
    waiters.push(onReady);
    return null;
  }

  PENDING_DRAWS.set(url, [onReady]);
  if (typeof Image !== 'undefined') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      IMAGE_CACHE.set(url, img);
      const list = PENDING_DRAWS.get(url) ?? [];
      PENDING_DRAWS.delete(url);
      for (const fn of list) fn();
      onTextureReadyCallback?.();
    };
    img.onerror = () => {
      PENDING_DRAWS.delete(url);
    };
    img.src = url;
  }
  return null;
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

/**
 * Draws a rich procedural fallback or vector pattern (tiles, hex, checker, paneling, brushed metal)
 */
function drawFallbackOrPattern(
  ctx: CanvasRenderingContext2D,
  size: number,
  preset: MaterialPreset,
  role: TexRole
) {
  const isBump = role === 'bump';
  const isRough = role === 'roughness';

  if (preset === 'tile' || preset === 'hex_tile' || preset === 'checker') {
    ctx.fillStyle = isBump ? '#EAEAEA' : isRough ? '#555555' : '#F8FAFC';
    ctx.fillRect(0, 0, size, size);

    if (preset === 'tile') {
      const cells = 4;
      const step = size / cells;
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          const j = ((r * 7 + c * 11) % 9) - 4;
          const v = isBump ? 236 + j : isRough ? 58 + j * 3 : 246 + j;
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(c * step + 3, r * step + 3, step - 6, step - 6);
        }
      }
      ctx.strokeStyle = isBump ? '#323232' : isRough ? '#E0E0E0' : 'rgba(148,163,184,0.52)';
      ctx.lineWidth = 5;
      for (let i = 0; i <= cells; i++) {
        ctx.beginPath();
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * step);
        ctx.lineTo(size, i * step);
        ctx.stroke();
      }
      return;
    }

    if (preset === 'hex_tile') {
      const r = 46;
      const dx = r * 1.5;
      const dy = r * Math.sqrt(3);
      ctx.strokeStyle = isBump ? '#383838' : isRough ? '#DCDCDC' : 'rgba(148,163,184,0.48)';
      ctx.lineWidth = 4;
      for (let col = -1; col < 10; col++) {
        for (let row = -1; row < 10; row++) {
          const cx = col * dx;
          const cy = row * dy + (col % 2 === 0 ? 0 : dy / 2);
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const ang = (Math.PI / 3) * k;
            const hx = cx + r * Math.cos(ang);
            const hy = cy + r * Math.sin(ang);
            if (k === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
          }
          ctx.closePath();
          const alt = (col + row * 2) % 3;
          const v = isBump ? 234 + alt * 5 : isRough ? 62 + alt * 8 : 244 + alt * 4;
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fill();
          ctx.stroke();
        }
      }
      return;
    }

    // checker
    const cells = 4;
    const step = size / cells;
    ctx.strokeStyle = isBump ? '#3A3A3A' : isRough ? '#D8D8D8' : 'rgba(100,116,139,0.45)';
    ctx.lineWidth = 3.5;
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        const even = (r + c) % 2 === 0;
        ctx.fillStyle = isBump
          ? even
            ? '#EEEEEE'
            : '#D8D8D8'
          : isRough
            ? even
              ? '#5E5E5E'
              : '#787878'
            : even
              ? '#F8FAFC'
              : '#334155';
        ctx.fillRect(c * step, r * step, step, step);
        ctx.strokeRect(c * step, r * step, step, step);
      }
    }
    return;
  }

  // Brushed metal anisotropic micro-streaks
  if (
    preset === 'metal' ||
    preset === 'brass' ||
    preset === 'bronze' ||
    preset === 'chrome' ||
    preset === 'matte_black_metal'
  ) {
    const baseHex =
      preset === 'brass'
        ? '#D6B162'
        : preset === 'bronze'
          ? '#654F3D'
          : preset === 'matte_black_metal'
            ? '#333840'
            : preset === 'chrome'
              ? '#F1F5F9'
              : '#DDE3EA';
    ctx.fillStyle = isBump ? '#C8C8C8' : isRough ? '#787878' : baseHex;
    ctx.fillRect(0, 0, size, size);
    const streakCount = preset === 'chrome' ? 180 : 550;
    for (let i = 0; i < streakCount; i++) {
      const y = (i * 197 + 13) % size;
      const x = (i * 313 + 7) % size;
      const w = 60 + (i % 180);
      const light = i % 2 === 0;
      ctx.fillStyle = isBump
        ? light
          ? 'rgba(255,255,255,0.14)'
          : 'rgba(40,40,40,0.14)'
        : isRough
          ? light
            ? 'rgba(200,200,200,0.16)'
            : 'rgba(70,70,70,0.16)'
          : light
            ? 'rgba(255,255,255,0.10)'
            : 'rgba(15,23,42,0.08)';
      ctx.fillRect(x, y, w, 1.5);
    }
    return;
  }

  // Fallback high-key tone for plaster / paint / wood / stone before image finishes decoding
  const meta = getMaterialPresetMeta(preset);
  ctx.fillStyle = isBump ? '#C8C8C8' : isRough ? '#B8B8B8' : isPresetPreTinted(preset) ? meta.previewBase : '#F7F7F5';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = (i * 173 + 19) % size;
    const y = (i * 257 + 41) % size;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.045)';
    ctx.fillRect(x, y, 4 + (i % 6), 2);
  }
}

/**
 * Draws the loaded photo into the canvas and applies calibrated grading / derived PBR bump & roughness
 */
function renderPhotoDerivedTexture(
  ctx: CanvasRenderingContext2D,
  size: number,
  img: HTMLImageElement,
  preset: MaterialPreset,
  role: TexRole
) {
  // Always pre-fill opaque oak base so no transparent black pixels can ever appear
  ctx.fillStyle = getMaterialPresetMeta(preset).previewBase;
  ctx.fillRect(0, 0, size, size);

  if (preset === 'parquet') {
    // 4-plank wood floor strips seamlessly wrapped horizontally & vertically across all PBR maps
    const planks = 4;
    const pw = size / planks;
    for (let i = 0; i < planks; i++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(i * pw, 0, pw, size);
      ctx.clip();
      const shiftX = ((i % 2) * size) / 2;
      const shiftY = (i * 137) % size;
      // Tile 2x2 around offsets so every pixel inside [i*pw..(i+1)*pw] has 100% photo coverage
      for (const ox of [shiftX - size, shiftX]) {
        for (const oy of [shiftY - size, shiftY]) {
          ctx.drawImage(img, ox, oy, size, size);
        }
      }
      ctx.restore();

      const grooveColor =
        role === 'bump'
          ? 'rgba(20,20,20,0.45)'
          : role === 'roughness'
            ? 'rgba(220,220,220,0.35)'
            : 'rgba(42,26,14,0.28)';
      ctx.strokeStyle = grooveColor;
      ctx.lineWidth = role === 'albedo' ? 2.2 : 2.5;
      ctx.beginPath();
      ctx.moveTo(i * pw, 0);
      ctx.lineTo(i * pw, size);
      ctx.stroke();
      const crossY = (i * 156 + 70) % size;
      ctx.beginPath();
      ctx.moveTo(i * pw, crossY);
      ctx.lineTo((i + 1) * pw, crossY);
      ctx.stroke();
    }
  } else if (preset === 'herringbone') {
    // Rich photographic herringbone mosaic from oak photo
    const cols = 4;
    const colW = size / cols;
    const blkH = size / 4;
    ctx.drawImage(img, 0, 0, size, size);
    for (let r = -1; r < 5; r++) {
      for (let c = 0; c < cols; c++) {
        const y = r * blkH + (c % 2 === 0 ? 0 : blkH * 0.5);
        ctx.save();
        ctx.translate(c * colW + colW / 2, y + blkH / 2);
        ctx.rotate(c % 2 === 0 ? Math.PI * 0.25 : -Math.PI * 0.25);
        ctx.drawImage(img, -colW * 0.7, -blkH * 0.45, colW * 1.4, blkH * 0.9);
        ctx.strokeStyle = role === 'bump' ? 'rgba(20,20,20,0.4)' : 'rgba(38,24,12,0.30)';
        ctx.lineWidth = 2.0;
        ctx.strokeRect(-colW * 0.68, -blkH * 0.42, colW * 1.36, blkH * 0.84);
        ctx.restore();
      }
    }
  } else {
    ctx.drawImage(img, 0, 0, size, size);
  }

  const imgData = ctx.getImageData(0, 0, size, size);
  const d = imgData.data;

  // Pixel-level realistic color grading & PBR height/roughness synthesis
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    if (role === 'bump') {
      // High-contrast local relief heightmap
      let h = lum;
      if (preset === 'brick' || preset === 'tile') {
        h = lum < 165 ? lum * 0.72 : Math.min(255, lum * 1.05);
      } else {
        h = 128 + (lum - 128) * 1.45;
      }
      const vb = clampByte(h);
      d[i] = vb;
      d[i + 1] = vb;
      d[i + 2] = vb;
      continue;
    }

    if (role === 'roughness') {
      // Micro-roughness variation centered around mid-tone so material.roughness controls global scale
      let rough = 215 - (lum - 128) * 0.35;
      if (preset === 'marble' || preset === 'calacatta_gold' || preset === 'nero_marble') {
        rough = lum < 185 ? 210 : 145; // veins slightly more matte than calcite matrix
      } else if (preset === 'travertine' || preset === 'concrete' || preset === 'brick') {
        rough = 228 - (lum - 120) * 0.45;
      } else if (preset === 'terrazzo') {
        rough = 188 + (lum < 170 ? -25 : 15);
      }
      const vr = clampByte(rough);
      d[i] = vr;
      d[i + 1] = vr;
      d[i + 2] = vr;
      continue;
    }

    // Albedo color calibration per preset
    switch (preset) {
      case 'wood': {
        // Whitewashed Ash — bright tintable grain
        const gNorm = 226 + (lum - 160) * 0.42;
        d[i] = clampByte(gNorm + 5);
        d[i + 1] = clampByte(gNorm + 2);
        d[i + 2] = clampByte(gNorm - 4);
        break;
      }
      case 'teak': {
        // Warm golden honey teak
        d[i] = clampByte(r * 0.92 + 24);
        d[i + 1] = clampByte(g * 0.72 + 12);
        d[i + 2] = clampByte(b * 0.46 + 4);
        break;
      }
      case 'smoked_oak': {
        // Deep espresso-charcoal smoked oak
        d[i] = clampByte(r * 0.44 + 8);
        d[i + 1] = clampByte(g * 0.39 + 6);
        d[i + 2] = clampByte(b * 0.36 + 5);
        break;
      }
      case 'paneling': {
        // Warm oak fluted architectural paneling
        d[i] = clampByte(r * 0.96 + 10);
        d[i + 1] = clampByte(g * 0.92 + 6);
        d[i + 2] = clampByte(b * 0.85 + 2);
        break;
      }
      case 'marble': {
        // Clean luminous Carrara marble (preserves dark veining while bright & tintable)
        const v = 240 + (lum - 210) * 0.65;
        d[i] = clampByte(v);
        d[i + 1] = clampByte(v);
        d[i + 2] = clampByte(v + 2);
        break;
      }
      case 'calacatta_gold': {
        // Warm ivory marble with golden-amber mineral veining
        const veinStrength = Math.max(0, Math.min(1, (222 - lum) / 85));
        d[i] = clampByte(248 * (1 - veinStrength) + 178 * veinStrength);
        d[i + 1] = clampByte(244 * (1 - veinStrength) + 142 * veinStrength);
        d[i + 2] = clampByte(236 * (1 - veinStrength) + 84 * veinStrength);
        break;
      }
      case 'nero_marble': {
        // Deep obsidian black marble with crisp white/silver veins
        const vein = Math.max(0, Math.min(1, (225 - lum) / 72));
        d[i] = clampByte(24 + vein * 208);
        d[i + 1] = clampByte(26 + vein * 208);
        d[i + 2] = clampByte(30 + vein * 212);
        break;
      }
      case 'plaster': {
        // Soft luminous mineral limewash plaster (neutral tintable)
        const v = 236 + (lum - 140) * 0.24;
        d[i] = clampByte(v + 2);
        d[i + 1] = clampByte(v + 1);
        d[i + 2] = clampByte(v - 2);
        break;
      }
      case 'fabric':
      case 'velvet': {
        // Neutralized crisp woven textile so white renders off-white and color swatches tint accurately
        const v = preset === 'velvet' ? 236 + (lum - 190) * 0.22 : 242 + (lum - 195) * 0.45;
        d[i] = clampByte(v);
        d[i + 1] = clampByte(v);
        d[i + 2] = clampByte(v);
        break;
      }
      case 'wallpaper': {
        // Fine architectural linen-grasscloth wallcovering
        const v = 238 + (lum - 195) * 0.35;
        d[i] = clampByte(v + 1);
        d[i + 1] = clampByte(v);
        d[i + 2] = clampByte(v - 2);
        break;
      }
      case 'leather_black': {
        d[i] = clampByte(lum * 0.22 + 12);
        d[i + 1] = clampByte(lum * 0.23 + 13);
        d[i + 2] = clampByte(lum * 0.25 + 16);
        break;
      }
      case 'leather_cream': {
        const v = 236 + (lum - 115) * 0.26;
        d[i] = clampByte(v + 4);
        d[i + 1] = clampByte(v);
        d[i + 2] = clampByte(v - 8);
        break;
      }
      default:
        break;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Add subtle architectural fluted slat shadow lines for paneling
  if (preset === 'paneling') {
    const slatW = 24;
    for (let x = 0; x < size; x += slatW) {
      ctx.fillStyle = role === 'bump' ? '#363636' : 'rgba(20,14,10,0.34)';
      ctx.fillRect(x, 0, 5, size);
      ctx.fillStyle = role === 'bump' ? '#ECECEC' : 'rgba(255,255,255,0.14)';
      ctx.fillRect(x + 5, 0, 3, size);
    }
  }
}

function getOrCreatePresetTexture(
  preset: MaterialPreset,
  role: TexRole,
  scale = 1,
  rotDeg = 0,
  maxAnisotropy = 4
): THREE.CanvasTexture {
  const key = `${role}_${preset}_${scale.toFixed(2)}_${Math.round(rotDeg)}`;
  const existing = TEXTURE_CACHE.get(key);
  if (existing) return existing;

  const size = 512;
  const [canvas, ctx] = makeCanvas(size);

  const tex = new THREE.CanvasTexture(canvas);
  if (role === 'albedo') {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  const repeat = Math.max(0.15, scale);
  tex.repeat.set(repeat, repeat);
  tex.center.set(0.5, 0.5);
  tex.rotation = (rotDeg * Math.PI) / 180;
  tex.anisotropy = maxAnisotropy;

  const photoUrl = getSourceImageUrl(preset);
  if (photoUrl) {
    const loaded = requestImage(photoUrl, () => {
      const cachedImg = IMAGE_CACHE.get(photoUrl);
      if (cachedImg) {
        renderPhotoDerivedTexture(ctx, size, cachedImg, preset, role);
        tex.needsUpdate = true;
      }
    });
    if (loaded) {
      renderPhotoDerivedTexture(ctx, size, loaded, preset, role);
    } else {
      drawFallbackOrPattern(ctx, size, preset, role);
    }
  } else {
    drawFallbackOrPattern(ctx, size, preset, role);
  }

  tex.needsUpdate = true;
  TEXTURE_CACHE.set(key, tex);
  return tex;
}

/**
 * Recomputes seamless world-meter triplanar/box UVs on a BufferGeometry so PBR textures
 * never look stretched or artificially tiled across varying part dimensions.
 */
export function applyWorldSpaceUVs(
  geo: THREE.BufferGeometry,
  tileMeters = 1.0,
  seed = 0,
  alignLongestHorizontal = false
): void {
  const posAttr = geo.getAttribute('position');
  if (!posAttr) return;

  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  }
  const normAttr = geo.getAttribute('normal');
  if (!normAttr) return;

  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const sizeX = bb ? bb.max.x - bb.min.x : 1;
  const sizeZ = bb ? bb.max.z - bb.min.z : 1;
  const swapXZ = alignLongestHorizontal && sizeZ > sizeX * 1.15;

  const offsetU = ((seed * 0.371) % 1 + 1) % 1;
  const offsetV = ((seed * 0.619) % 1 + 1) % 1;
  const invTile = 1 / Math.max(0.15, tileMeters);

  const uvArray = new Float32Array(posAttr.count * 2);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const nx = Math.abs(normAttr.getX(i));
    const ny = Math.abs(normAttr.getY(i));
    const nz = Math.abs(normAttr.getZ(i));

    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      // Top / bottom horizontal surface
      u = (swapXZ ? z : x) * invTile + offsetU;
      v = (swapXZ ? x : z) * invTile + offsetV;
    } else if (nx >= ny && nx >= nz) {
      // Left / right vertical surface
      u = z * invTile + offsetU;
      v = y * invTile + offsetV;
    } else {
      // Front / back vertical surface
      u = x * invTile + offsetU;
      v = y * invTile + offsetV;
    }
    uvArray[i * 2] = u;
    uvArray[i * 2 + 1] = v;
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
}

export interface ArchitecturalMaterialOptions {
  scale?: number;
  rotDeg?: number;
  maxAnisotropy?: number;
  clippingPlanes?: THREE.Plane[];
  isSoftwareGl?: boolean;
  roughness?: number;
  metalness?: number;
  clearcoat?: number;
  sheen?: number;
  envMapIntensity?: number;
}

const artTextureCache = new Map<string, THREE.CanvasTexture>();
const rugTextureCache = new Map<string, THREE.CanvasTexture>();

export function createArtCanvasTexture(seedKey: string, tintHex = '#D97757'): THREE.CanvasTexture {
  const key = `${seedKey}_${tintHex}`;
  const cached = artTextureCache.get(key);
  if (cached) return cached;

  const size = 512;
  const [canvas, ctx] = makeCanvas(size);
  const seed = hashString(key);
  const variant = seed % 3;

  ctx.fillStyle = '#F7F3EB';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 1400; i++) {
    const x = (i * 173 + seed) % size;
    const y = (i * 251 + seed * 3) % size;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.22)';
    ctx.fillRect(x, y, 2, 2);
  }

  const accent = tintHex && tintHex !== '#FFFFFF' ? tintHex : '#C26D4E';

  if (variant === 0) {
    ctx.fillStyle = '#E5DEC9';
    ctx.fillRect(48, 48, size - 96, size - 96);

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.52, size * 0.24, Math.PI, 0);
    ctx.lineTo(size * 0.74, size * 0.84);
    ctx.lineTo(size * 0.26, size * 0.84);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#EAB308';
    ctx.beginPath();
    ctx.arc(size * 0.66, size * 0.3, size * 0.085, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.56, size * 0.16, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  } else if (variant === 1) {
    ctx.fillStyle = '#DCE6DF';
    ctx.fillRect(46, 54, size * 0.44, size * 0.62);
    ctx.fillStyle = '#2F4858';
    ctx.beginPath();
    ctx.arc(size * 0.62, size * 0.66, size * 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(size * 0.46, size * 0.85);
    ctx.quadraticCurveTo(size * 0.44, size * 0.45, size * 0.56, size * 0.22);
    ctx.stroke();

    ctx.fillStyle = '#4A6B53';
    for (let i = 0; i < 6; i++) {
      const t = (i + 1) / 7;
      const lx = size * (0.46 + t * 0.08);
      const ly = size * (0.8 - t * 0.52);
      const dir = i % 2 === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.ellipse(lx + dir * 28, ly, 34, 14, dir * -0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.ellipse(size * 0.38, size * 0.44, size * 0.22, size * 0.28, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.ellipse(size * 0.64, size * 0.58, size * 0.2, size * 0.22, 0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#F7F3EB';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(size * 0.24, size * 0.68);
    ctx.bezierCurveTo(size * 0.4, size * 0.34, size * 0.6, size * 0.72, size * 0.78, size * 0.34);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  artTextureCache.set(key, tex);
  return tex;
}

export function createRugPatternTexture(seedKey: string): THREE.CanvasTexture {
  const cached = rugTextureCache.get(seedKey);
  if (cached) return cached;

  const size = 512;
  const [canvas, ctx] = makeCanvas(size);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.08)';
  ctx.lineWidth = 2;
  for (let i = 0; i < size; i += 6) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.055)';
  for (let j = 0; j < size; j += 8) {
    ctx.beginPath();
    ctx.moveTo(0, j);
    ctx.lineTo(size, j);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.16)';
  ctx.lineWidth = 3.5;
  const step = 128;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + step / 2, y + 8);
      ctx.lineTo(x + step - 8, y + step / 2);
      ctx.lineTo(x + step / 2, y + step - 8);
      ctx.lineTo(x + 8, y + step / 2);
      ctx.closePath();
      ctx.stroke();
    }
  }

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
  ctx.lineWidth = 10;
  ctx.strokeRect(18, 18, size - 36, size - 36);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  rugTextureCache.set(seedKey, tex);
  return tex;
}

export function buildArchitecturalMaterial(
  preset: MaterialPreset,
  colorHex: string,
  options: ArchitecturalMaterialOptions = {}
): THREE.MeshStandardMaterial {
  const userScale = options.scale ?? 1;
  const tileM = getDefaultTileMeters(preset);
  const scale = userScale / tileM;
  const rotDeg = options.rotDeg ?? 0;
  const maxAniso = options.maxAnisotropy ?? 4;

  if (preset === 'glass') {
    if (!options.isSoftwareGl) {
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(colorHex || '#E0F2FE'),
        roughness: options.roughness ?? 0.05,
        metalness: options.metalness ?? 0.05,
        clearcoat: 0.35,
        clearcoatRoughness: 0.06,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
        clippingPlanes: options.clippingPlanes,
      });
    }
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex || '#E0F2FE'),
      roughness: options.roughness ?? 0.06,
      metalness: options.metalness ?? 0.08,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
      clippingPlanes: options.clippingPlanes,
    });
  }

  const meta = getMaterialPresetMeta(preset);
  const baseRoughness = options.roughness ?? meta.roughness;
  const baseMetalness = options.metalness ?? meta.metalness;

  const isPlainFlat =
    preset === 'paint' ||
    preset === 'satin_paint' ||
    preset === 'plastic_matte' ||
    preset === 'plastic_gloss';

  const hasPhotoOrPattern = !isPlainFlat;
  const map = hasPhotoOrPattern
    ? getOrCreatePresetTexture(preset, 'albedo', scale, rotDeg, maxAniso)
    : null;
  const bumpMap = hasPhotoOrPattern
    ? getOrCreatePresetTexture(preset, 'bump', scale, rotDeg, maxAniso)
    : null;
  const roughnessMap =
    hasPhotoOrPattern && !options.isSoftwareGl && getSourceImageUrl(preset)
      ? getOrCreatePresetTexture(preset, 'roughness', scale, rotDeg, maxAniso)
      : null;

  const bumpScaleMap: Partial<Record<MaterialPreset, number>> = {
    brick: 0.036,
    tile: 0.024,
    hex_tile: 0.024,
    checker: 0.02,
    wood: 0.015,
    oak: 0.017,
    walnut: 0.016,
    teak: 0.016,
    smoked_oak: 0.018,
    parquet: 0.02,
    herringbone: 0.02,
    paneling: 0.028,
    concrete: 0.02,
    plaster: 0.014,
    travertine: 0.022,
    slate: 0.028,
    terrazzo: 0.01,
    fabric: 0.016,
    boucle: 0.026,
    velvet: 0.012,
    leather_cognac: 0.016,
    leather_black: 0.016,
    leather_cream: 0.015,
    wallpaper: 0.014,
    marble: 0.006,
    calacatta_gold: 0.006,
    nero_marble: 0.006,
    metal: 0.005,
    brass: 0.005,
    bronze: 0.006,
    matte_black_metal: 0.007,
  };

  // Pre-tinted materials keep white tint at #FFFFFF so the rich photograph shines cleanly without washing out.
  // Neutral / white materials accept colorHex directly (allowing pure white or painted hues).
  const normalizedHex = (colorHex || '#FFFFFF').toUpperCase();
  const effectiveColorHex =
    isPresetPreTinted(preset) && normalizedHex === '#FFFFFF' ? '#FFFFFF' : normalizedHex;

  if (!options.isSoftwareGl) {
    const clearcoat =
      options.clearcoat ??
      (preset === 'marble' ||
      preset === 'calacatta_gold' ||
      preset === 'nero_marble' ||
      preset === 'tile' ||
      preset === 'satin_paint' ||
      preset === 'plastic_gloss'
        ? 0.42
        : preset === 'parquet' || preset === 'herringbone' || preset === 'walnut'
          ? 0.16
          : 0);

    const isTextile = preset === 'fabric' || preset === 'boucle' || preset === 'velvet';
    const sheen = options.sheen ?? (preset === 'velvet' ? 0.85 : isTextile ? 0.55 : 0);
    const isMetal =
      preset === 'metal' ||
      preset === 'brass' ||
      preset === 'bronze' ||
      preset === 'chrome' ||
      preset === 'matte_black_metal';

    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(effectiveColorHex),
      map,
      bumpMap,
      bumpScale: bumpScaleMap[preset] ?? 0,
      roughnessMap,
      envMapIntensity: options.envMapIntensity ?? (isMetal ? 0.82 : 0.34),
      roughness: baseRoughness,
      metalness: baseMetalness,
      clearcoat,
      clearcoatRoughness:
        preset === 'plastic_gloss' || preset === 'marble' || preset === 'calacatta_gold' || preset === 'nero_marble'
          ? 0.12
          : 0.3,
      sheen,
      sheenRoughness: preset === 'velvet' ? 0.55 : 0.82,
      sheenColor: new THREE.Color('#F8FAFC'),
      anisotropy: isMetal && preset !== 'chrome' ? 0.35 : 0,
      clippingPlanes: options.clippingPlanes,
      clipShadows: true,
    });
  }

  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(effectiveColorHex),
    map,
    bumpMap,
    bumpScale: bumpScaleMap[preset] ?? 0,
    envMapIntensity: options.envMapIntensity ?? 0.32,
    roughness: baseRoughness,
    metalness: baseMetalness,
    clippingPlanes: options.clippingPlanes,
    clipShadows: false,
  });
}
