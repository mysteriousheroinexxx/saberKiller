// Developer Saber AI Observation Interface
// Provides real-time server telemetry cards (Alpha, Beta, Encounter Director),
// visual debug aids toggling (vision cones, heading arrows, LoS rays, sound pulses),
// and diagnostic event logging.

export class SaberObservationUI {
  constructor(mpManager) {
    this.mpManager = mpManager;
    this.panel = document.getElementById('dev-saber-panel');
    this.toggleBtn = document.getElementById('dev-saber-toggle');
    this.isOpen = false;
    this.debugAidsEnabled = true; // Enabled by default when dev panel is active

    this.maxLogs = 30;
    this.logs = [];

    this._initElements();
    this._bindEvents();

    // Sync initial debug aids state with SaberManager
    if (this.mpManager?.saberManager) {
      this.mpManager.saberManager.setDebugAidsVisible(this.debugAidsEnabled);
    }
  }

  _initElements() {
    // Saber Alpha Elements
    this.elAlphaState = document.getElementById('saber-alpha-state');
    this.elAlphaHpVal = document.getElementById('saber-alpha-hp-val');
    this.elAlphaHpFill = document.getElementById('saber-alpha-hp-fill');
    this.elAlphaSpeed = document.getElementById('saber-alpha-speed');
    this.elAlphaTarget = document.getElementById('saber-alpha-target');
    this.elAlphaLos = document.getElementById('saber-alpha-los');
    this.elAlphaSound = document.getElementById('saber-alpha-sound');

    // Saber Beta Elements
    this.elBetaState = document.getElementById('saber-beta-state');
    this.elBetaHpVal = document.getElementById('saber-beta-hp-val');
    this.elBetaHpFill = document.getElementById('saber-beta-hp-fill');
    this.elBetaSpeed = document.getElementById('saber-beta-speed');
    this.elBetaTarget = document.getElementById('saber-beta-target');
    this.elBetaLos = document.getElementById('saber-beta-los');
    this.elBetaSound = document.getElementById('saber-beta-sound');

    // Director Elements
    this.elDirPhase = document.getElementById('saber-dir-phase');
    this.elDirTensionVal = document.getElementById('saber-dir-tension-val');
    this.elDirTensionFill = document.getElementById('saber-dir-tension-fill');
    this.elDirTime = document.getElementById('saber-dir-time');
    this.elDirSectors = document.getElementById('saber-dir-sectors');

    // Action buttons & Log
    this.btnToggleVisuals = document.getElementById('saber-btn-toggle-visuals');
    this.btnSoundPistol = document.getElementById('saber-btn-sound-pistol');
    this.btnSoundShotgun = document.getElementById('saber-btn-sound-shotgun');
    this.logContainer = document.getElementById('saber-events-log');
  }

  _bindEvents() {
    // Toggle button click
    if (this.toggleBtn) {
      this.toggleBtn.style.display = 'block';
      this.toggleBtn.addEventListener('click', () => this.togglePanel());
    }

    // Close button
    const closeBtn = document.getElementById('saber-panel-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.setPanelVisible(false));
    }

    // Hotkey F6
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F6') {
        e.preventDefault();
        this.togglePanel();
      }
    });

    // Visual aids toggle button
    if (this.btnToggleVisuals) {
      this.btnToggleVisuals.addEventListener('click', () => {
        this.debugAidsEnabled = !this.debugAidsEnabled;
        if (this.mpManager?.saberManager) {
          this.mpManager.saberManager.setDebugAidsVisible(this.debugAidsEnabled);
        }
        this.btnToggleVisuals.textContent = `3D Aids [${this.debugAidsEnabled ? 'ON' : 'OFF'}]`;
        this.btnToggleVisuals.classList.toggle('active', this.debugAidsEnabled);
        this.addLog(`Visual debug aids set to ${this.debugAidsEnabled ? 'ON' : 'OFF'}`);
      });
    }

    // Sound test buttons
    if (this.btnSoundPistol) {
      this.btnSoundPistol.addEventListener('click', () => {
        if (this.mpManager?.network) {
          const pos = this.mpManager.localPlayer?.pos || { x: 0, y: 0, z: 0 };
          this.mpManager.network.fireWeapon('PISTOL', pos);
          this.addLog(`[TEST] Emitted PISTOL gunshot stimulus at (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`);
        }
      });
    }

    if (this.btnSoundShotgun) {
      this.btnSoundShotgun.addEventListener('click', () => {
        if (this.mpManager?.network) {
          const pos = this.mpManager.localPlayer?.pos || { x: 0, y: 0, z: 0 };
          this.mpManager.network.fireWeapon('SHOTGUN', pos);
          this.addLog(`[TEST] Emitted SHOTGUN gunshot stimulus at (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`);
        }
      });
    }
  }

  togglePanel() {
    this.setPanelVisible(!this.isOpen);
  }

  setPanelVisible(visible) {
    this.isOpen = Boolean(visible);
    if (this.panel) {
      this.panel.style.display = this.isOpen ? 'block' : 'none';
    }
    if (this.toggleBtn) {
      this.toggleBtn.classList.toggle('active', this.isOpen);
    }
  }

  updateTelemetry(payload) {
    if (!payload) return;

    // 1. Update Saber Alpha
    if (payload.alpha) {
      this._updateSaberCard(payload.alpha, {
        state: this.elAlphaState,
        hpVal: this.elAlphaHpVal,
        hpFill: this.elAlphaHpFill,
        speed: this.elAlphaSpeed,
        target: this.elAlphaTarget,
        los: this.elAlphaLos,
        sound: this.elAlphaSound
      });
    }

    // 2. Update Saber Beta
    if (payload.beta) {
      this._updateSaberCard(payload.beta, {
        state: this.elBetaState,
        hpVal: this.elBetaHpVal,
        hpFill: this.elBetaHpFill,
        speed: this.elBetaSpeed,
        target: this.elBetaTarget,
        los: this.elBetaLos,
        sound: this.elBetaSound
      });
    }

    // 3. Update Encounter Director
    if (payload.director) {
      this._updateDirectorCard(payload.director);
    }
  }

  _updateSaberCard(data, els) {
    if (!data) return;

    if (els.state && data.state) {
      els.state.textContent = data.state;
      els.state.className = `state-badge state-${data.state}`;
    }

    if (els.hpVal && typeof data.health === 'number') {
      const invulnStr = data.isInvulnerable ? ' [INVULN]' : '';
      els.hpVal.textContent = `${data.health} / 100${invulnStr}`;
    }

    if (els.hpFill && typeof data.health === 'number') {
      els.hpFill.style.width = `${Math.max(0, Math.min(100, data.health))}%`;
      els.hpFill.style.background = (data.health <= 25) ? '#ef4444' : (data.health <= 50 ? '#f59e0b' : '#22c55e');
    }

    if (els.speed && typeof data.speed === 'number') {
      els.speed.textContent = `${data.speed.toFixed(2)} m/s`;
    }

    if (els.target) {
      const tId = data.targetId || 'None';
      const dist = (typeof data.targetDistance === 'number') ? ` (${data.targetDistance.toFixed(1)}m)` : '';
      els.target.textContent = `${tId}${dist}`;
    }

    if (els.los) {
      const losText = data.lineOfSight ? 'CLEAR' : (data.losObstructed ? 'WALL OCCLUDED' : 'OUT OF FOV');
      els.los.textContent = losText;
      els.los.className = `diag-box ${data.lineOfSight ? 'vis' : 'invis'}`;
    }

    if (els.sound) {
      if (data.lastSound) {
        const s = data.lastSound;
        const distStr = (typeof s.distance === 'number') ? ` ${s.distance.toFixed(1)}m` : '';
        els.sound.textContent = `${s.soundType || 'SOUND'}${distStr} (${s.fuzzedPosition?.x?.toFixed(0) || 0}, ${s.fuzzedPosition?.z?.toFixed(0) || 0})`;
      } else {
        els.sound.textContent = 'None';
      }
    }
  }

  _updateDirectorCard(dir) {
    if (this.elDirPhase && dir.phase) {
      this.elDirPhase.textContent = dir.phase;
      this.elDirPhase.className = `state-badge state-${dir.phase}`;
    }

    if (this.elDirTensionVal && typeof dir.tension === 'number') {
      this.elDirTensionVal.textContent = dir.tension.toFixed(2);
    }

    if (this.elDirTensionFill && typeof dir.tension === 'number') {
      const pct = Math.max(0, Math.min(100, dir.tension * 100));
      this.elDirTensionFill.style.width = `${pct}%`;
      this.elDirTensionFill.style.background = (dir.tension >= 0.75) ? '#ef4444' : (dir.tension >= 0.4 ? '#f59e0b' : '#a855f7');
    }

    if (this.elDirTime && typeof dir.phaseElapsed === 'number') {
      this.elDirTime.textContent = `${dir.phaseElapsed.toFixed(1)}s`;
    }

    if (this.elDirSectors && dir.playerSectors) {
      const parts = [];
      for (const [pId, sec] of Object.entries(dir.playerSectors)) {
        parts.push(`${pId}: ${sec}`);
      }
      this.elDirSectors.textContent = parts.length > 0 ? parts.join(' | ') : 'Tracking...';
    }
  }

  addLog(msg, type = 'info') {
    const timeStr = new Date().toTimeString().split(' ')[0];
    this.logs.unshift({ time: timeStr, text: msg, type });
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
    this._renderLogs();
  }

  _renderLogs() {
    if (!this.logContainer) return;
    this.logContainer.innerHTML = this.logs
      .map(l => `<div class="saber-log-entry ${l.type}"><span class="log-time">[${l.time}]</span> ${l.text}</div>`)
      .join('');
  }

  destroy() {
    this.panel?.remove();
    this.toggleBtn?.remove();
  }
}
