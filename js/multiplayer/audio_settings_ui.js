/**
 * Minimalist Dark-Industrial Audio Settings UI for Multiplayer Survival Mode.
 *
 * Integrates directly with MultiplayerAudioManager:
 *   - Master Volume + 6 category buses (Environment, Player Movement, Weapons,
 *     Interactions, Enemies, UI)
 *   - Collapsible category drawers with individual sound sliders
 *   - Immediate live audio updates during gameplay
 *   - Local preference persistence via exportPreferences() / importPreferences()
 *   - Reset to Defaults via resetPreferences()
 */

import {
  AUDIO_CATEGORY_META,
  AUDIO_PREFERENCES_STORAGE_KEY
} from './audio_manager.js';

function toPercent(gain) {
  if (typeof gain !== 'number' || !Number.isFinite(gain)) return 100;
  return Math.max(0, Math.min(100, Math.round(gain * 100)));
}

function formatSoundLabel(soundDef) {
  if (soundDef?.label) return soundDef.label;
  return String(soundDef?.id || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export class AudioSettingsUI {
  constructor(audioManager, options = {}) {
    this.audioManager = audioManager;
    this.doc = options.document || (typeof document !== 'undefined' ? document : null);
    this.win = options.window || (typeof window !== 'undefined' ? window : null);
    this.parent = options.parent || (this.doc ? this.doc.body : null);
    this.player = options.player || null;
    this.storage = options.storage !== undefined
      ? options.storage
      : (typeof localStorage !== 'undefined' ? localStorage : null);
    this.storageKey = options.storageKey || audioManager?.storageKey || AUDIO_PREFERENCES_STORAGE_KEY;

    this.isOpen = false;
    this.expandedCategories = new Set();
    this.overlayEl = null;
    this.cardEl = null;
    this.categoriesContainerEl = null;
    this.statusEl = null;
    this.masterSlider = null;
    this.masterValEl = null;
    this.categoryControls = new Map(); // catId -> { slider, valEl, drawerEl, toggleBtn, sectionEl }
    this.soundControls = new Map(); // soundId -> { slider, valEl, category }
    this._onKeyDownBound = null;

    this.loadSavedPreferences();

    if (this.doc && this.parent) {
      this._injectStyles();
      this._buildDOM();
      this._bindEvents();
      this.syncFromAudioManager();
    }
  }

  setPlayer(player) {
    this.player = player;
  }

  loadSavedPreferences() {
    if (!this.audioManager || !this.storage || typeof this.storage.getItem !== 'function') {
      return false;
    }
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      if (typeof this.audioManager.importPreferences === 'function') {
        this.audioManager.importPreferences(parsed);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  savePreferences() {
    if (!this.audioManager || !this.storage || typeof this.storage.setItem !== 'function') {
      return false;
    }
    try {
      const prefs = typeof this.audioManager.exportPreferences === 'function'
        ? this.audioManager.exportPreferences()
        : null;
      if (!prefs) return false;
      this.storage.setItem(this.storageKey, JSON.stringify(prefs));
      this._flashStatus('Saved locally');
      return true;
    } catch {
      return false;
    }
  }

  _flashStatus(text) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
  }

  _injectStyles() {
    if (!this.doc || this.doc.getElementById('bb-audio-settings-styles')) return;
    const style = this.doc.createElement('style');
    style.id = 'bb-audio-settings-styles';
    style.textContent = `
      #bb-audio-settings-overlay {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 1200;
        background: rgba(8, 8, 7, 0.76);
        backdrop-filter: blur(8px);
        align-items: center;
        justify-content: center;
        padding: 20px;
        font-family: 'Rubik', -apple-system, BlinkMacSystemFont, sans-serif;
        color: #edece6;
        pointer-events: auto;
      }

      .bb-audio-card {
        width: min(460px, 94vw);
        max-height: min(84vh, 700px);
        display: flex;
        flex-direction: column;
        background: rgba(18, 17, 16, 0.96);
        border: 1px solid rgba(212, 175, 55, 0.4);
        border-radius: 4px;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.85), 0 0 18px rgba(212, 175, 55, 0.08);
        overflow: hidden;
      }

      .bb-audio-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px 14px;
        border-bottom: 1px solid rgba(212, 175, 55, 0.22);
        background: rgba(14, 13, 12, 0.9);
      }

      .bb-audio-kicker {
        font-size: 10px;
        letter-spacing: 2px;
        color: #d4af37;
        text-transform: uppercase;
        margin-bottom: 3px;
      }

      .bb-audio-title {
        font-size: 16px;
        font-weight: 500;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: #edece6;
      }

      .bb-audio-close-btn {
        background: transparent;
        border: 1px solid rgba(156, 154, 146, 0.28);
        color: #9c9a92;
        width: 28px;
        height: 28px;
        border-radius: 3px;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
        flex: 0 0 auto;
        padding: 0;
        transition: border-color 0.15s, color 0.15s, background 0.15s;
      }

      .bb-audio-close-btn:hover {
        border-color: #d4af37;
        color: #edece6;
        background: rgba(212, 175, 55, 0.12);
        box-shadow: none;
      }

      .bb-audio-master-bar {
        padding: 14px 20px;
        background: rgba(24, 22, 20, 0.85);
        border-bottom: 1px solid rgba(156, 154, 146, 0.18);
      }

      .bb-audio-body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 12px 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .bb-audio-body::-webkit-scrollbar {
        width: 6px;
      }
      .bb-audio-body::-webkit-scrollbar-thumb {
        background: rgba(212, 175, 55, 0.3);
        border-radius: 3px;
      }

      .bb-audio-category {
        background: rgba(14, 13, 12, 0.78);
        border: 1px solid rgba(156, 154, 146, 0.2);
        border-radius: 3px;
        padding: 10px 12px;
      }

      .bb-audio-row-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 6px;
      }

      .bb-audio-label-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .bb-audio-collapse-btn {
        background: transparent;
        border: 1px solid rgba(156, 154, 146, 0.22);
        color: #9c9a92;
        width: 20px;
        height: 20px;
        border-radius: 2px;
        font-size: 10px;
        line-height: 1;
        padding: 0;
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: border-color 0.15s, color 0.15s;
      }

      .bb-audio-collapse-btn:hover {
        border-color: #d4af37;
        color: #d4af37;
        background: rgba(212, 175, 55, 0.08);
        box-shadow: none;
      }

      .bb-audio-label {
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0.9px;
        text-transform: uppercase;
        color: #edece6;
        cursor: pointer;
      }

      .bb-audio-label.master {
        color: #d4af37;
        letter-spacing: 1.2px;
      }

      .bb-audio-count {
        font-size: 10px;
        color: #7a7872;
        letter-spacing: 0.4px;
      }

      .bb-audio-pct {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        font-weight: 500;
        color: #d4af37;
        min-width: 40px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .bb-audio-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 4px;
        background: rgba(156, 154, 146, 0.28);
        border-radius: 2px;
        outline: none;
        cursor: pointer;
      }

      .bb-audio-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #d4af37;
        border: 1px solid #181715;
        cursor: pointer;
        transition: transform 0.1s ease, background 0.15s ease;
      }

      .bb-audio-slider::-webkit-slider-thumb:hover {
        transform: scale(1.12);
        background: #e5c352;
      }

      .bb-audio-slider::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #d4af37;
        border: 1px solid #181715;
        cursor: pointer;
      }

      .bb-audio-drawer {
        display: none;
        margin-top: 10px;
        padding: 8px 0 2px 12px;
        border-top: 1px solid rgba(156, 154, 146, 0.14);
        border-left: 2px solid rgba(212, 175, 55, 0.35);
        flex-direction: column;
        gap: 9px;
      }

      .bb-audio-drawer.open {
        display: flex;
      }

      .bb-audio-sound-row .bb-audio-row-head {
        margin-bottom: 4px;
      }

      .bb-audio-sound-label {
        font-size: 11px;
        color: #b8b6ae;
        letter-spacing: 0.4px;
      }

      .bb-audio-sound-row .bb-audio-pct {
        font-size: 11px;
        color: #edece6;
      }

      .bb-audio-empty {
        font-size: 11px;
        color: #7a7872;
        letter-spacing: 0.4px;
        padding: 2px 0;
      }

      .bb-audio-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 20px;
        border-top: 1px solid rgba(212, 175, 55, 0.2);
        background: rgba(14, 13, 12, 0.9);
      }

      .bb-audio-status {
        font-size: 11px;
        color: #7a7872;
        letter-spacing: 0.5px;
      }

      .bb-audio-footer-actions {
        display: flex;
        gap: 8px;
      }

      .bb-audio-btn {
        padding: 8px 14px;
        background: rgba(28, 26, 22, 0.92);
        border: 1px solid rgba(156, 154, 146, 0.35);
        color: #edece6;
        font-family: inherit;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 1.2px;
        text-transform: uppercase;
        border-radius: 3px;
        cursor: pointer;
        flex: 0 0 auto;
        transition: border-color 0.15s, background 0.15s, color 0.15s;
      }

      .bb-audio-btn:hover {
        border-color: #d4af37;
        background: rgba(212, 175, 55, 0.16);
        color: #ffffff;
        box-shadow: none;
      }

      .bb-audio-btn.primary {
        border-color: rgba(212, 175, 55, 0.55);
        color: #fff4cc;
      }
    `;
    (this.doc.head || this.parent).appendChild(style);
  }

  _buildDOM() {
    this.overlayEl = this.doc.createElement('div');
    this.overlayEl.id = 'bb-audio-settings-overlay';
    this.overlayEl.setAttribute('role', 'dialog');
    this.overlayEl.setAttribute('aria-modal', 'true');
    this.overlayEl.setAttribute('aria-labelledby', 'bb-audio-settings-title');

    this.cardEl = this.doc.createElement('div');
    this.cardEl.className = 'bb-audio-card';

    const header = this.doc.createElement('div');
    header.className = 'bb-audio-header';
    const titleWrap = this.doc.createElement('div');
    const kicker = this.doc.createElement('div');
    kicker.className = 'bb-audio-kicker';
    kicker.textContent = 'AUDIO MIXER // LEVEL 0';
    const title = this.doc.createElement('div');
    title.id = 'bb-audio-settings-title';
    title.className = 'bb-audio-title';
    title.textContent = 'Audio Settings';
    titleWrap.appendChild(kicker);
    titleWrap.appendChild(title);

    this.closeBtn = this.doc.createElement('button');
    this.closeBtn.id = 'btn-audio-close';
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'bb-audio-close-btn';
    this.closeBtn.title = 'Close Audio Settings [Esc]';
    this.closeBtn.innerHTML = '&times;';

    header.appendChild(titleWrap);
    header.appendChild(this.closeBtn);

    // Master Volume Pinned Bar
    const masterBar = this.doc.createElement('div');
    masterBar.className = 'bb-audio-master-bar';
    const masterHead = this.doc.createElement('div');
    masterHead.className = 'bb-audio-row-head';
    const masterLbl = this.doc.createElement('label');
    masterLbl.className = 'bb-audio-label master';
    masterLbl.setAttribute('for', 'audio-slider-master');
    masterLbl.textContent = 'Master Volume';
    this.masterValEl = this.doc.createElement('span');
    this.masterValEl.id = 'audio-val-master';
    this.masterValEl.className = 'bb-audio-pct';
    this.masterValEl.textContent = '100%';
    masterHead.appendChild(masterLbl);
    masterHead.appendChild(this.masterValEl);

    this.masterSlider = this.doc.createElement('input');
    this.masterSlider.id = 'audio-slider-master';
    this.masterSlider.type = 'range';
    this.masterSlider.min = '0';
    this.masterSlider.max = '100';
    this.masterSlider.step = '1';
    this.masterSlider.className = 'bb-audio-slider';
    masterBar.appendChild(masterHead);
    masterBar.appendChild(this.masterSlider);

    this.categoriesContainerEl = this.doc.createElement('div');
    this.categoriesContainerEl.id = 'audio-categories-list';
    this.categoriesContainerEl.className = 'bb-audio-body';

    const footer = this.doc.createElement('div');
    footer.className = 'bb-audio-footer';
    this.statusEl = this.doc.createElement('span');
    this.statusEl.id = 'audio-settings-status';
    this.statusEl.className = 'bb-audio-status';
    this.statusEl.textContent = 'Changes apply immediately';

    const actions = this.doc.createElement('div');
    actions.className = 'bb-audio-footer-actions';
    this.resetBtn = this.doc.createElement('button');
    this.resetBtn.id = 'btn-audio-reset';
    this.resetBtn.type = 'button';
    this.resetBtn.className = 'bb-audio-btn';
    this.resetBtn.textContent = 'Reset to Defaults';

    this.doneBtn = this.doc.createElement('button');
    this.doneBtn.id = 'btn-audio-done';
    this.doneBtn.type = 'button';
    this.doneBtn.className = 'bb-audio-btn primary';
    this.doneBtn.textContent = 'Close';

    actions.appendChild(this.resetBtn);
    actions.appendChild(this.doneBtn);
    footer.appendChild(this.statusEl);
    footer.appendChild(actions);

    this.cardEl.appendChild(header);
    this.cardEl.appendChild(masterBar);
    this.cardEl.appendChild(this.categoriesContainerEl);
    this.cardEl.appendChild(footer);
    this.overlayEl.appendChild(this.cardEl);
    this.parent.appendChild(this.overlayEl);

    this._renderCategorySections();
  }

  _renderCategorySections() {
    if (!this.categoriesContainerEl || !this.doc) return;
    this.categoriesContainerEl.innerHTML = '';
    this.categoryControls.clear();
    this.soundControls.clear();

    const grouped = (this.audioManager && typeof this.audioManager.getSoundsByCategory === 'function')
      ? this.audioManager.getSoundsByCategory()
      : {};

    for (const meta of AUDIO_CATEGORY_META) {
      const catId = meta.id;
      const sounds = Array.isArray(grouped[catId]) ? grouped[catId] : [];
      const isExpanded = this.expandedCategories.has(catId);

      const sectionEl = this.doc.createElement('div');
      sectionEl.className = 'bb-audio-category';
      sectionEl.setAttribute('data-category', catId);

      const head = this.doc.createElement('div');
      head.className = 'bb-audio-row-head';

      const left = this.doc.createElement('div');
      left.className = 'bb-audio-label-wrap';

      const toggleBtn = this.doc.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'bb-audio-collapse-btn';
      toggleBtn.setAttribute('data-category-toggle', catId);
      toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      toggleBtn.title = `Toggle ${meta.label} sounds`;
      toggleBtn.textContent = isExpanded ? '▾' : '▸';

      const lbl = this.doc.createElement('label');
      lbl.className = 'bb-audio-label';
      lbl.setAttribute('for', `audio-slider-cat-${catId}`);
      lbl.textContent = meta.label;

      const countBadge = this.doc.createElement('span');
      countBadge.className = 'bb-audio-count';
      countBadge.textContent = sounds.length === 1 ? '(1 sound)' : `(${sounds.length} sounds)`;

      left.appendChild(toggleBtn);
      left.appendChild(lbl);
      left.appendChild(countBadge);

      const valEl = this.doc.createElement('span');
      valEl.id = `audio-val-cat-${catId}`;
      valEl.className = 'bb-audio-pct';
      valEl.textContent = '100%';

      head.appendChild(left);
      head.appendChild(valEl);

      const slider = this.doc.createElement('input');
      slider.id = `audio-slider-cat-${catId}`;
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.step = '1';
      slider.className = 'bb-audio-slider';
      slider.setAttribute('data-category-slider', catId);

      slider.addEventListener('input', () => {
        const pct = Math.max(0, Math.min(100, Math.round(Number(slider.value) || 0)));
        valEl.textContent = `${pct}%`;
        this.audioManager?.setCategoryVolume(catId, pct / 100);
        this.savePreferences();
      });

      const drawerEl = this.doc.createElement('div');
      drawerEl.className = isExpanded ? 'bb-audio-drawer open' : 'bb-audio-drawer';
      drawerEl.setAttribute('data-category-drawer', catId);

      toggleBtn.addEventListener('click', () => {
        const nextOpen = !this.expandedCategories.has(catId);
        if (nextOpen) {
          this.expandedCategories.add(catId);
        } else {
          this.expandedCategories.delete(catId);
        }
        toggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        toggleBtn.textContent = nextOpen ? '▾' : '▸';
        drawerEl.classList.toggle('open', nextOpen);
      });

      if (sounds.length === 0) {
        const emptyEl = this.doc.createElement('div');
        emptyEl.className = 'bb-audio-empty';
        emptyEl.textContent = 'No individual sounds registered yet';
        drawerEl.appendChild(emptyEl);
      } else {
        for (const soundDef of sounds) {
          const soundRow = this.doc.createElement('div');
          soundRow.className = 'bb-audio-sound-row';
          soundRow.setAttribute('data-sound-id', soundDef.id);

          const sHead = this.doc.createElement('div');
          sHead.className = 'bb-audio-row-head';

          const sLbl = this.doc.createElement('label');
          sLbl.className = 'bb-audio-sound-label';
          sLbl.setAttribute('for', `audio-slider-sound-${soundDef.id}`);
          sLbl.textContent = formatSoundLabel(soundDef);

          const sValEl = this.doc.createElement('span');
          sValEl.id = `audio-val-sound-${soundDef.id}`;
          sValEl.className = 'bb-audio-pct';
          sValEl.textContent = `${toPercent(soundDef.defaultVolume)}%`;

          sHead.appendChild(sLbl);
          sHead.appendChild(sValEl);

          const sSlider = this.doc.createElement('input');
          sSlider.id = `audio-slider-sound-${soundDef.id}`;
          sSlider.type = 'range';
          sSlider.min = '0';
          sSlider.max = '100';
          sSlider.step = '1';
          sSlider.className = 'bb-audio-slider';
          sSlider.setAttribute('data-sound-slider', soundDef.id);

          sSlider.addEventListener('input', () => {
            const pct = Math.max(0, Math.min(100, Math.round(Number(sSlider.value) || 0)));
            sValEl.textContent = `${pct}%`;
            this.audioManager?.setSoundVolume(soundDef.id, pct / 100);
            this.savePreferences();
          });

          soundRow.appendChild(sHead);
          soundRow.appendChild(sSlider);
          drawerEl.appendChild(soundRow);
          this.soundControls.set(soundDef.id, {
            slider: sSlider,
            valEl: sValEl,
            category: catId
          });
        }
      }

      sectionEl.appendChild(head);
      sectionEl.appendChild(slider);
      sectionEl.appendChild(drawerEl);
      this.categoriesContainerEl.appendChild(sectionEl);
      this.categoryControls.set(catId, {
        slider,
        valEl,
        drawerEl,
        toggleBtn,
        sectionEl
      });
    }
  }

  _bindEvents() {
    if (this.masterSlider) {
      this.masterSlider.addEventListener('input', () => {
        const pct = Math.max(0, Math.min(100, Math.round(Number(this.masterSlider.value) || 0)));
        if (this.masterValEl) this.masterValEl.textContent = `${pct}%`;
        this.audioManager?.setMasterVolume(pct / 100);
        this.savePreferences();
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }

    if (this.doneBtn) {
      this.doneBtn.addEventListener('click', () => this.close());
    }

    if (this.resetBtn) {
      this.resetBtn.addEventListener('click', () => this.handleResetToDefaults());
    }

    if (this.overlayEl) {
      this.overlayEl.addEventListener('click', (e) => {
        if (e.target === this.overlayEl) {
          this.close();
        }
      });
    }

    if (this.win && typeof this.win.addEventListener === 'function') {
      this._onKeyDownBound = (e) => {
        if (this.isOpen && e.code === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          }
          if (!e.repeat) {
            this.close();
          }
        }
      };
      this.win.addEventListener('keydown', this._onKeyDownBound, { capture: true });
    }
  }

  handleResetToDefaults() {
    if (!this.audioManager) return;
    if (typeof this.audioManager.resetPreferences === 'function') {
      this.audioManager.resetPreferences();
    }
    this.savePreferences();
    this.syncFromAudioManager();
    this._flashStatus('Reset to defaults');
  }

  syncFromAudioManager() {
    if (!this.audioManager) return;
    const masterPct = toPercent(this.audioManager.getMasterVolume?.() ?? 1.0);
    if (this.masterSlider) this.masterSlider.value = String(masterPct);
    if (this.masterValEl) this.masterValEl.textContent = `${masterPct}%`;

    for (const [catId, ctrl] of this.categoryControls) {
      const catPct = toPercent(this.audioManager.getCategoryVolume?.(catId) ?? 1.0);
      if (ctrl.slider) ctrl.slider.value = String(catPct);
      if (ctrl.valEl) ctrl.valEl.textContent = `${catPct}%`;
    }

    for (const [soundId, ctrl] of this.soundControls) {
      const sPct = toPercent(this.audioManager.getSoundVolume?.(soundId) ?? 1.0);
      if (ctrl.slider) ctrl.slider.value = String(sPct);
      if (ctrl.valEl) ctrl.valEl.textContent = `${sPct}%`;
    }
  }

  open() {
    if (!this.overlayEl) return;
    this._renderCategorySections();
    this.syncFromAudioManager();
    this.isOpen = true;
    this.overlayEl.style.display = 'flex';
    this._flashStatus('Changes apply immediately');

    if (this.player) {
      this.player.isAudioSettingsOpen = true;
      this.player.keys = {};
      if ((this.player.isPointerLocked || this.doc?.pointerLockElement) && this.doc?.exitPointerLock) {
        try {
          this.doc.exitPointerLock();
        } catch {}
      }
    } else if (this.doc?.pointerLockElement && this.doc?.exitPointerLock) {
      try {
        this.doc.exitPointerLock();
      } catch {}
    }
  }

  close() {
    this.isOpen = false;
    if (this.overlayEl) {
      this.overlayEl.style.display = 'none';
    }
    if (this.player) {
      this.player.isAudioSettingsOpen = false;
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  dispose() {
    if (this.win && this._onKeyDownBound) {
      this.win.removeEventListener('keydown', this._onKeyDownBound, { capture: true });
      this._onKeyDownBound = null;
    }
    if (this.overlayEl && this.overlayEl.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
    }
  }
}
