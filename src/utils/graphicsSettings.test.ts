import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyGraphicsPreset,
  DEFAULT_GRAPHICS_SETTINGS,
  GRAPHICS_PRESETS,
  GRAPHICS_STORAGE_KEY,
  loadGraphicsSettings,
  normalizeGraphicsSettings,
  saveGraphicsSettings,
  updateGraphicsSetting,
} from './graphicsSettings';

test('Milestone 4 presets and defaults match specification', () => {
  assert.equal(DEFAULT_GRAPHICS_SETTINGS.preset, 'high');
  assert.deepEqual(DEFAULT_GRAPHICS_SETTINGS, GRAPHICS_PRESETS.high);

  for (const id of ['low', 'medium', 'high', 'ultra'] as const) {
    const p = applyGraphicsPreset(id);
    assert.equal(p.preset, id);
    assert.equal(p.depthOfFieldEnabled, false);
  }

  assert.equal(GRAPHICS_PRESETS.low.contactShadows, false);
  assert.equal(GRAPHICS_PRESETS.low.ambientOcclusionQuality, 'off');
  assert.equal(GRAPHICS_PRESETS.low.materialQuality, 'standard');
  assert.equal(GRAPHICS_PRESETS.low.transparentMaterialQuality, 'standard');

  assert.equal(GRAPHICS_PRESETS.medium.contactShadows, false);
  assert.equal(GRAPHICS_PRESETS.medium.ambientOcclusionQuality, 'off');

  assert.equal(GRAPHICS_PRESETS.high.contactShadows, true);
  assert.equal(GRAPHICS_PRESETS.high.ambientOcclusionQuality, 'medium');
  assert.equal(GRAPHICS_PRESETS.high.transparentMaterialQuality, 'high');

  assert.equal(GRAPHICS_PRESETS.ultra.contactShadows, true);
  assert.equal(GRAPHICS_PRESETS.ultra.ambientOcclusionQuality, 'high');
  assert.equal(GRAPHICS_PRESETS.ultra.antiAliasing, 'smaa');
});

test('Manual individual changes switch preset automatically to custom and normalize bounds', () => {
  const start = applyGraphicsPreset('high');

  // No-op update keeps preset intact
  const unchanged = updateGraphicsSetting(start, { bloomIntensity: start.bloomIntensity });
  assert.equal(unchanged.preset, 'high');

  // Changing any individual option switches preset to custom
  const customized = updateGraphicsSetting(start, { shadowSoftness: 4.2 });
  assert.equal(customized.preset, 'custom');
  assert.equal(customized.shadowSoftness, 4.2);

  // Applying a concrete preset clears custom status
  const resetToLow = applyGraphicsPreset('low');
  assert.equal(resetToLow.preset, 'low');

  // Clamping & invalid fallback
  const clamped = normalizeGraphicsSettings({
    renderScale: 99,
    exposure: 0.01,
    maxRealtimeLights: 200,
    shadowResolution: 999 as unknown as 2048,
  });
  assert.equal(clamped.renderScale, 2.0);
  assert.equal(clamped.exposure, 0.6);
  assert.equal(clamped.maxRealtimeLights, 32);
  assert.equal(clamped.shadowResolution, DEFAULT_GRAPHICS_SETTINGS.shadowResolution);
});

test('Graphics settings persist to dedicated localStorage key without project pollution', () => {
  const store = new Map<string, string>();
  const prevStorage = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage: Storage }).localStorage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };

  try {
    const custom = updateGraphicsSetting(applyGraphicsPreset('ultra'), {
      depthOfFieldEnabled: true,
      depthOfFieldFocusM: 8.5,
    });
    saveGraphicsSettings(custom);
    assert.ok(store.has(GRAPHICS_STORAGE_KEY));

    const loaded = loadGraphicsSettings();
    assert.equal(loaded.preset, 'custom');
    assert.equal(loaded.depthOfFieldEnabled, true);
    assert.equal(loaded.depthOfFieldFocusM, 8.5);
    assert.equal(loaded.shadowResolution, 4096);
  } finally {
    if (prevStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as { localStorage: Storage }).localStorage = prevStorage;
    }
  }
});
