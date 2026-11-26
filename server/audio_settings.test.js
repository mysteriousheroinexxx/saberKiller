import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_CATEGORIES,
  AUDIO_CATEGORY_META,
  DEFAULT_SOUND_DEFINITIONS,
  MultiplayerAudioManager
} from '../js/multiplayer/audio_manager.js';
import { MultiplayerAmbientAudio } from '../js/multiplayer/ambient_audio.js';
import { AudioSettingsUI } from '../js/multiplayer/audio_settings_ui.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function makeFakeElement(tagName, ownerDoc) {
  const attrs = new Map();
  const listeners = new Map();
  const classes = new Set();
  const el = {
    tagName: String(tagName || 'div').toUpperCase(),
    id: '',
    type: '',
    value: '',
    min: '',
    max: '',
    step: '',
    title: '',
    textContent: '',
    _innerHTML: '',
    style: {},
    children: [],
    parentNode: null,
    className: '',
    classList: {
      add: (c) => { classes.add(c); el.className = [...classes].join(' '); },
      remove: (c) => { classes.delete(c); el.className = [...classes].join(' '); },
      toggle: (c, force) => {
        const next = force === undefined ? !classes.has(c) : Boolean(force);
        if (next) classes.add(c); else classes.delete(c);
        el.className = [...classes].join(' ');
        return next;
      },
      contains: (c) => classes.has(c)
    },
    setAttribute(k, v) {
      const val = String(v);
      attrs.set(k, val);
      if (k === 'id') el.id = val;
    },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      if (child.id) ownerDoc._byId.set(child.id, child);
      return child;
    },
    removeChild(child) {
      el.children = el.children.filter(c => c !== child);
      if (child.parentNode === el) child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (list) listeners.set(type, list.filter(f => f !== fn));
    },
    dispatchEvent(evt = {}) {
      const list = listeners.get(evt.type) || [];
      for (const fn of list) fn(evt);
    },
    set innerHTML(val) {
      el._innerHTML = String(val);
      if (val === '') el.children = [];
    },
    get innerHTML() { return el._innerHTML; }
  };

  Object.defineProperty(el, 'className', {
    get: () => [...classes].join(' '),
    set: (val) => {
      classes.clear();
      String(val || '').split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
    }
  });

  return el;
}

function makeFakeDOM() {
  const winListeners = new Map();
  const doc = {
    _byId: new Map(),
    pointerLockElement: { tagName: 'CANVAS' },
    exitPointerLockCalled: 0,
    exitPointerLock() {
      doc.pointerLockElement = null;
      doc.exitPointerLockCalled++;
    },
    createElement(tag) {
      const el = makeFakeElement(tag, doc);
      return new Proxy(el, {
        set(target, prop, value) {
          target[prop] = value;
          if (prop === 'id' && value) doc._byId.set(value, target);
          return true;
        }
      });
    },
    getElementById(id) {
      return doc._byId.get(id) || null;
    }
  };
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');

  const win = {
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = winListeners.get(type);
      if (list) winListeners.set(type, list.filter(f => f !== fn));
    },
    dispatchKeyDown(code) {
      let defaultPrevented = false;
      let stopped = false;
      const evt = {
        code,
        repeat: false,
        preventDefault() { defaultPrevented = true; },
        stopPropagation() { stopped = true; },
        stopImmediatePropagation() { stopped = true; }
      };
      for (const fn of (winListeners.get('keydown') || [])) fn(evt);
      return { defaultPrevented, stopped };
    }
  };

  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    clear: () => store.clear()
  };

  return { doc, win, storage };
}

function makeMockAudioContext() {
  const createGainNode = (init = 1.0) => ({
    gain: {
      value: init,
      setValueAtTime(v) { this.value = v; },
      linearRampToValueAtTime(v) { this.value = v; },
      setTargetAtTime(v) { this.value = v; }
    },
    connect() {},
    disconnect() {}
  });

  return {
    state: 'running',
    currentTime: 2.0,
    destination: {},
    listener: {},
    resume: async () => {},
    createGain: () => createGainNode(1.0)
  };
}

test('1. AudioSettingsUI exposes Master + 6 category sliders, collapsible sound sliders, percentages, and Escape/pointer-lock handling', () => {
  const { doc, win, storage } = makeFakeDOM();
  const ctx = makeMockAudioContext();
  const audioManager = new MultiplayerAudioManager({ audioContext: ctx });
  audioManager.getContext();

  const player = { isAudioSettingsOpen: false, isPointerLocked: true, keys: { KeyW: true } };
  const ui = new AudioSettingsUI(audioManager, {
    document: doc,
    window: win,
    storage,
    player
  });

  // All 7 bus sliders (Master + 6 categories) exist with initial 100% readouts
  assert.equal(ui.masterSlider.value, '100');
  assert.equal(ui.masterValEl.textContent, '100%');
  for (const meta of AUDIO_CATEGORY_META) {
    const ctrl = ui.categoryControls.get(meta.id);
    assert.ok(ctrl, `category control missing for ${meta.id}`);
    assert.equal(ctrl.slider.value, '100');
    assert.equal(ctrl.valEl.textContent, '100%');
    assert.equal(ctrl.toggleBtn.getAttribute('aria-expanded'), 'false');
    assert.equal(ctrl.drawerEl.classList.contains('open'), false);
  }

  // Collapsible category toggles reveal individual sound controls
  const envCtrl = ui.categoryControls.get(AUDIO_CATEGORIES.ENVIRONMENT);
  envCtrl.toggleBtn.dispatchEvent({ type: 'click' });
  assert.equal(envCtrl.toggleBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(envCtrl.drawerEl.classList.contains('open'), true);

  for (const soundDef of Object.values(DEFAULT_SOUND_DEFINITIONS)) {
    const sc = ui.soundControls.get(soundDef.id);
    assert.ok(sc, `individual sound slider missing for ${soundDef.id}`);
    assert.equal(sc.valEl.textContent, `${Math.round(soundDef.defaultVolume * 100)}%`);
  }

  // Opening exits pointer lock & marks player state; Escape closes cleanly
  ui.open();
  assert.equal(ui.isOpen, true);
  assert.equal(player.isAudioSettingsOpen, true);
  assert.equal(doc.exitPointerLockCalled, 1);
  assert.deepEqual(player.keys, {});

  const escRes = win.dispatchKeyDown('Escape');
  assert.equal(escRes.defaultPrevented, true);
  assert.equal(ui.isOpen, false);
  assert.equal(player.isAudioSettingsOpen, false);
});

test('2. Sliders update audio buses immediately, persist across reloads (including ambient hum), and Reset to Defaults restores everything', () => {
  const { doc, win, storage } = makeFakeDOM();
  const ctx1 = makeMockAudioContext();
  const am1 = new MultiplayerAudioManager({ audioContext: ctx1 });
  am1.getContext();
  const ambient1 = new MultiplayerAmbientAudio({ audioManager: am1 });
  const ui1 = new AudioSettingsUI(am1, { document: doc, window: win, storage });

  // Master slider -> immediate bus gain & percentage update
  ui1.masterSlider.value = '45';
  ui1.masterSlider.dispatchEvent({ type: 'input' });
  assert.equal(ui1.masterValEl.textContent, '45%');
  assert.ok(Math.abs(am1.getMasterVolume() - 0.45) < 1e-6);
  assert.ok(Math.abs(am1.masterGain.gain.value - 0.45) < 1e-6);

  // Category slider (weapons) -> immediate category bus gain update
  const weaponsCtrl = ui1.categoryControls.get(AUDIO_CATEGORIES.WEAPONS);
  weaponsCtrl.slider.value = '70';
  weaponsCtrl.slider.dispatchEvent({ type: 'input' });
  assert.equal(weaponsCtrl.valEl.textContent, '70%');
  assert.ok(Math.abs(am1.getCategoryVolume(AUDIO_CATEGORIES.WEAPONS) - 0.70) < 1e-6);
  assert.ok(Math.abs(am1.getCategoryBus(AUDIO_CATEGORIES.WEAPONS).gain.value - 0.70) < 1e-6);

  // Individual sound sliders -> immediate updates (including ambient hum listener)
  const humCtrl = ui1.soundControls.get('level0_hum');
  humCtrl.slider.value = '28';
  humCtrl.slider.dispatchEvent({ type: 'input' });
  assert.equal(humCtrl.valEl.textContent, '28%');
  assert.ok(Math.abs(am1.getSoundVolume('level0_hum') - 0.28) < 1e-6);
  assert.ok(Math.abs(ambient1.getVolume() - 0.28) < 1e-6);

  const pillCtrl = ui1.soundControls.get('interaction_pill_eat');
  pillCtrl.slider.value = '85';
  pillCtrl.slider.dispatchEvent({ type: 'input' });
  assert.equal(am1.getEffectiveVolume('weapon_pistol_fire').toFixed(4), (0.62 * 0.70 * 0.45).toFixed(4));

  // Simulated page reload / new match with fresh DOM + AudioManager + AmbientAudio
  const { doc: doc2, win: win2 } = makeFakeDOM();
  const ctx2 = makeMockAudioContext();
  const am2 = new MultiplayerAudioManager({ audioContext: ctx2 });
  am2.getContext();
  const ui2 = new AudioSettingsUI(am2, { document: doc2, window: win2, storage });
  const ambient2 = new MultiplayerAmbientAudio({ audioManager: am2 });

  assert.equal(ui2.masterSlider.value, '45');
  assert.equal(ui2.categoryControls.get(AUDIO_CATEGORIES.WEAPONS).slider.value, '70');
  assert.equal(ui2.soundControls.get('level0_hum').slider.value, '28');
  assert.equal(ui2.soundControls.get('interaction_pill_eat').slider.value, '85');
  assert.ok(Math.abs(ambient2.getVolume() - 0.28) < 1e-6, 'Ambient hum preserves loaded preference');

  // Reset to Defaults restores Manager, UI, AmbientAudio, and persisted storage
  ui2.handleResetToDefaults();
  assert.equal(ui2.masterSlider.value, '100');
  assert.equal(ui2.masterValEl.textContent, '100%');
  assert.equal(ui2.categoryControls.get(AUDIO_CATEGORIES.WEAPONS).slider.value, '100');
  assert.equal(ui2.soundControls.get('level0_hum').slider.value, '14');
  assert.ok(Math.abs(ambient2.getVolume() - 0.14) < 1e-6);
  assert.equal(am2.exportPreferences().soundVolumes.interaction_pill_eat, DEFAULT_SOUND_DEFINITIONS.interaction_pill_eat.defaultVolume);

  // Confirm multiplayer navigation buttons exist without altering Story Mode
  const mpHtml = fs.readFileSync(path.join(__dirname, '../multiplayer.html'), 'utf8');
  assert.ok(mpHtml.includes('id="btn-lobby-audio-settings"'));
  assert.ok(mpHtml.includes('id="btn-staging-audio-settings"'));
  assert.ok(mpHtml.includes('id="btn-hud-audio-settings"'));
});
