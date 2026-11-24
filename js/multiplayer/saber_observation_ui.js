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
    this.elAlphaAnim = document.getElementById('saber-alpha-anim');
    this.elAlphaState = document.getElementById('saber-alpha-state');
    this.elAlphaHpVal = document.getElementById('saber-alpha-hp-val');
    this.elAlphaHpFill = document.getElementById('saber-alpha-hp-fill');
    this.elAlphaShots = document.getElementById('saber-alpha-shots');
    this.elAlphaSpeed = document.getElementById('saber-alpha-speed');
    this.elAlphaStaggerTimer = document.getElementById('saber-alpha-stagger-timer');
    this.elAlphaTarget = document.getElementById('saber-alpha-target');
    this.elAlphaIntuition = document.getElementById('saber-alpha-intuition');
    this.elAlphaPathNodes = document.getElementById('saber-alpha-path-nodes');
    this.elAlphaLos = document.getElementById('saber-alpha-los');
    this.elAlphaSound = document.getElementById('saber-alpha-sound');

    // Saber Beta Elements
    this.elBetaAnim = document.getElementById('saber-beta-anim');
    this.elBetaState = document.getElementById('saber-beta-state');
    this.elBetaHpVal = document.getElementById('saber-beta-hp-val');
    this.elBetaHpFill = document.getElementById('saber-beta-hp-fill');
    this.elBetaShots = document.getElementById('saber-beta-shots');
    this.elBetaSpeed = document.getElementById('saber-beta-speed');
    this.elBetaStaggerTimer = document.getElementById('saber-beta-stagger-timer');
    this.elBetaTarget = document.getElementById('saber-beta-target');
    this.elBetaIntuition = document.getElementById('saber-beta-intuition');
    this.elBetaPathNodes = document.getElementById('saber-beta-path-nodes');
    this.elBetaLos = document.getElementById('saber-beta-los');
    this.elBetaSound = document.getElementById('saber-beta-sound');

    // Director Elements
    this.elDirGen = document.getElementById('saber-dir-gen');
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

    // Hotkey F6 (Deck) and F7 (3D Aids)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F6') {
        e.preventDefault();
        this.togglePanel();
      } else if (e.key === 'F7') {
        e.preventDefault();
        this.toggleDebugVisuals();
      }
    });

    // Visual aids toggle button
    if (this.btnToggleVisuals) {
      this.btnToggleVisuals.addEventListener('click', () => {
        this.toggleDebugVisuals();
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

  toggleDebugVisuals() {
    this.debugAidsEnabled = !this.debugAidsEnabled;
    if (this.mpManager?.saberManager) {
      this.mpManager.saberManager.setDebugAidsVisible(this.debugAidsEnabled);
    }
    if (this.btnToggleVisuals) {
      this.btnToggleVisuals.textContent = `3D Aids [${this.debugAidsEnabled ? 'ON' : 'OFF'}]`;
      this.btnToggleVisuals.classList.toggle('active', this.debugAidsEnabled);
    }
    this.addLog(`Visual debug aids set to ${this.debugAidsEnabled ? 'ON' : 'OFF'}`);
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

    const alphaData = payload.saberAlpha || payload.alpha;
    const betaData = payload.saberBeta || payload.beta;
    const directorData = payload.director;

    const saberManager = this.mpManager?.saberManager;
    const alphaEntity = saberManager?.sabers?.get('saber_alpha');
    const betaEntity = saberManager?.sabers?.get('saber_beta');

    // 1. Update Saber Alpha
    if (alphaData) {
      this._updateSaberCard(alphaData, {
        anim: this.elAlphaAnim,
        state: this.elAlphaState,
        hpVal: this.elAlphaHpVal,
        hpFill: this.elAlphaHpFill,
        shots: this.elAlphaShots,
        speed: this.elAlphaSpeed,
        staggerTimer: this.elAlphaStaggerTimer,
        target: this.elAlphaTarget,
        intuition: this.elAlphaIntuition,
        pathNodes: this.elAlphaPathNodes,
        los: this.elAlphaLos,
        sound: this.elAlphaSound
      }, alphaEntity);

      if (alphaEntity) {
        if (alphaData.currentNavPath) alphaEntity.setPathVisualization(alphaData.currentNavPath);
        if (alphaData.intuitionTarget) alphaEntity.setIntuitionVisualization(alphaData.intuitionTarget);
      }
    }

    // 2. Update Saber Beta
    if (betaData) {
      this._updateSaberCard(betaData, {
        anim: this.elBetaAnim,
        state: this.elBetaState,
        hpVal: this.elBetaHpVal,
        hpFill: this.elBetaHpFill,
        shots: this.elBetaShots,
        speed: this.elBetaSpeed,
        staggerTimer: this.elBetaStaggerTimer,
        target: this.elBetaTarget,
        intuition: this.elBetaIntuition,
        pathNodes: this.elBetaPathNodes,
        los: this.elBetaLos,
        sound: this.elBetaSound
      }, betaEntity);

      if (betaEntity) {
        if (betaData.currentNavPath) betaEntity.setPathVisualization(betaData.currentNavPath);
        if (betaData.intuitionTarget) betaEntity.setIntuitionVisualization(betaData.intuitionTarget);
      }
    }

    // 3. Update Encounter Director
    if (directorData) {
      this._updateDirectorCard(directorData, payload);
    }
  }

  _updateSaberCard(data, els, saberEntity) {
    if (!data) return;

    if (els.state && data.state) {
      els.state.textContent = data.state;
      els.state.className = `state-badge state-${data.state}`;
    }

    if (els.anim) {
      const animName = saberEntity?.currentClipName || saberEntity?.currentActionName || (data.speed > 0.3 ? (data.state === 'CHASE' ? 'chase' : (data.state === 'STALK' ? 'stalk' : 'walk')) : 'idle');
      els.anim.textContent = animName;
    }

    if (els.shots) {
      if (data.state === 'STAGGERED') {
        els.shots.textContent = 'STAGGERED (0 HP)';
        els.shots.style.color = '#ef4444';
      } else if (data.isInvulnerable) {
        els.shots.textContent = 'INVULNERABLE (Grace)';
        els.shots.style.color = '#38bdf8';
      } else {
        const h = typeof data.health === 'number' ? data.health : 100;
        const shotsPistol = Math.ceil(h / 50);
        const shotsShotgun = Math.ceil(h / 100);
        els.shots.textContent = `${shotsPistol} Pistol / ${shotsShotgun} Shotgun`;
        els.shots.style.color = shotsPistol <= 1 ? '#ef4444' : '#f59e0b';
      }
    }

    if (els.staggerTimer) {
      if (data.state === 'STAGGERED') {
        const t = (typeof data.staggerTimer === 'number') ? data.staggerTimer.toFixed(1) : '10.0';
        els.staggerTimer.textContent = `STAGGERED (${t}s left)`;
        els.staggerTimer.style.color = '#ef4444';
      } else if (data.state === 'RECOVER') {
        const t = (typeof data.recoveryTimer === 'number') ? data.recoveryTimer.toFixed(1) : '2.5';
        els.staggerTimer.textContent = `RECOVERING (${t}s left)`;
        els.staggerTimer.style.color = '#38bdf8';
      } else {
        els.staggerTimer.textContent = 'Inactive';
        els.staggerTimer.style.color = '#94a3b8';
      }
    }

    if (els.intuition) {
      if (data.hasDirectorHint && data.intuitionTarget) {
        const ox = data.intuitionTarget.x?.toFixed(1) ?? 0;
        const oz = data.intuitionTarget.z?.toFixed(1) ?? 0;
        const off = (typeof data.intuitionOffset === 'number') ? `${data.intuitionOffset.toFixed(1)}m` : '7.5m';
        els.intuition.textContent = `(${ox}, ${oz}) [${off} offset]`;
        els.intuition.style.color = '#fb923c';
      } else {
        els.intuition.textContent = 'None';
        els.intuition.style.color = '#94a3b8';
      }
    }

    if (els.pathNodes) {
      if (Array.isArray(data.currentNavPath) && data.currentNavPath.length > 0) {
        let totalDist = 0;
        for (let i = 1; i < data.currentNavPath.length; i++) {
          const dx = data.currentNavPath[i].x - data.currentNavPath[i-1].x;
          const dz = data.currentNavPath[i].z - data.currentNavPath[i-1].z;
          totalDist += Math.sqrt(dx * dx + dz * dz);
        }
        els.pathNodes.textContent = `${data.currentNavPath.length} nodes (${totalDist.toFixed(1)}m Dijkstra)`;
        els.pathNodes.style.color = '#38bdf8';
      } else {
        els.pathNodes.textContent = 'Direct LoS (0 nodes)';
        els.pathNodes.style.color = '#4ade80';
      }
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
      const tId = data.targetName || data.targetId || 'None';
      const dist = (typeof data.targetDistance === 'number') ? ` (${data.targetDistance.toFixed(1)}m)` : '';
      els.target.textContent = `${tId}${dist}`;
    }

    if (els.los) {
      const isVisible = Boolean(data.seesPlayer || data.lineOfSight);
      const losText = isVisible ? 'CLEAR' : (data.losObstructed ? 'WALL OCCLUDED' : 'OUT OF FOV');
      els.los.textContent = losText;
      els.los.className = `diag-box ${isVisible ? 'vis' : 'invis'}`;
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

  _updateDirectorCard(dir, payload) {
    if (!dir) return;

    if (this.elDirGen) {
      const gen = dir.matchGeneration || payload?.matchGeneration || 1;
      this.elDirGen.textContent = `Gen #${gen}`;
    }

    if (this.elDirPhase && dir.phase) {
      this.elDirPhase.textContent = dir.phase;
      this.elDirPhase.className = `state-badge state-${dir.phase}`;
    }

    if (this.elDirTensionVal && (typeof dir.tension === 'number' || typeof dir.threatIntensity === 'number')) {
      const tension = typeof dir.tension === 'number' ? dir.tension : ((dir.threatIntensity || 0) / 100);
      this.elDirTensionVal.textContent = tension.toFixed(2);
      if (this.elDirTensionFill) {
        const pct = Math.max(0, Math.min(100, tension * 100));
        this.elDirTensionFill.style.width = `${pct}%`;
        this.elDirTensionFill.style.background = (tension >= 0.75) ? '#ef4444' : (tension >= 0.4 ? '#f59e0b' : '#a855f7');
      }
    }

    if (this.elDirTime && (typeof dir.phaseElapsed === 'number' || typeof dir.phaseTimer === 'number')) {
      const elapsed = typeof dir.phaseElapsed === 'number' ? dir.phaseElapsed : (dir.phaseTimer || 0);
      this.elDirTime.textContent = `${elapsed.toFixed(1)}s`;
    }

    if (this.elDirSectors) {
      if (dir.playerSectors) {
        const parts = [];
        for (const [pId, sec] of Object.entries(dir.playerSectors)) {
          parts.push(`${pId}: ${sec}`);
        }
        this.elDirSectors.textContent = parts.length > 0 ? parts.join(' | ') : 'Tracking...';
      } else if (dir.currentSector || dir.hintTargetSector) {
        this.elDirSectors.textContent = `Active: ${dir.currentSector || 'None'} | Target: ${dir.hintTargetSector || 'None'}`;
      }
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
