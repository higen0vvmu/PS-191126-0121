import type { Level, Project, ScalePreset } from '../types/plan';
import { bundleProjectAssets } from './assetStore';

function triggerDownload(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function exportProjectJson(project: Project): Promise<void> {
  const bundled = await bundleProjectAssets(project);
  const json = JSON.stringify(bundled, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const safeName = (project.name || 'plan-studio-project')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-');
  triggerDownload(url, `${safeName}.json`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportDataUrlPng(dataUrl: string, filename: string): void {
  if (!dataUrl) return;
  triggerDownload(dataUrl, filename);
}

export function exportSvgFromElement(
  svgEl: SVGSVGElement | null,
  filename: string
): void {
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(clone);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSvgElementAsPng(
  svgEl: SVGSVGElement | null,
  filename: string
): void {
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  const rect = svgEl.getBoundingClientRect();
  const width = Math.max(800, Math.round(rect.width * 2));
  const height = Math.max(600, Math.round(rect.height * 2));
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      exportDataUrlPng(canvas.toDataURL('image/png'), filename);
    }
    URL.revokeObjectURL(svgUrl);
  };
  img.onerror = () => {
    URL.revokeObjectURL(svgUrl);
  };
  img.src = svgUrl;
}

export function printArchitecturalSheet(
  projectName: string,
  level: Level,
  svgEl: SVGSVGElement | null,
  scale: ScalePreset
): void {
  const totalAreaM2 = level.rooms.reduce((sum, r) => sum + r.areaM2, 0);
  const svgMarkup = svgEl ? new XMLSerializer().serializeToString(svgEl) : '';
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${projectName} — ${level.name}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 24px; color: #0f172a; }
      header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 16px; }
      h1 { font-size: 18px; margin: 0; }
      .meta { font-size: 12px; color: #475569; }
      .sheet { width: 100%; height: 75vh; border: 1px solid #cbd5e1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .sheet svg { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <header>
      <h1>${projectName} — ${level.name}</h1>
      <div class="meta">Scale ${scale} · Total Area ${totalAreaM2.toFixed(1)} m² · ${new Date().toLocaleDateString()}</div>
    </header>
    <div class="sheet">${svgMarkup}</div>
  </body>
</html>`);
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (iframe.parentNode) document.body.removeChild(iframe);
    }, 1500);
  }, 150);
}
