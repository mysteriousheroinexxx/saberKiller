/**
 * Saber Killer — Survival Mode Polished HUD
 *
 * Implements the authentic Budget-Backrooms survival horror HUD specifications:
 * - Top-center HUD cluster sitting directly over the game world (no opaque container/card)
 * - Transparent monochromatic vector icons (Apache 2.0 open license, stored locally)
 * - Health indicator: Heart icon + numeric health value
 * - Sanity indicator: Brain icon + dynamic percentage + pulsing pause indicator
 * - Contextual equipment resource indicator:
 *     - Gun equipped (Pistol/Shotgun): Ammunition icon + magazine / reserve count
 *     - Torch equipped: Battery icon + charge level
 *     - Unarmed/none: Automatically hidden
 * - Bottom-center Stamina bar:
 *     - Anchored at bottom: 30px, responsive width min(476px, 80vw) matching W_HUD.uasset
 *     - Smoothly drains when sprinting and regenerates when walking/idle
 * - Authentic dot crosshair using crosshair_smaller.png
 * - Rubik typography with restrained 0.45 base opacity
 */

export class SanityHUD {
  /**
   * @param {import('./sanity_controller.js').SanityController} controller
   * @param {HTMLElement} [parentContainer=document.body]
   * @param {import('./player_controller.js').LocalPlayerController} [player=null]
   */
  constructor(controller, parentContainer = document.body, player = null) {
    this.controller = controller;
    this.parent = parentContainer;
    this.player = player;

    this.root = null;
    this.healthGroup = null;
    this.healthVal = null;
    this.sanityGroup = null;
    this.brainIcon = null;
    this.titleText = null;
    this.percentText = null;
    this.pauseIcon = null;
    this.resourceGroup = null;
    this.resourceIcon = null;
    this.resourceLabel = null;
    this.resourceVal = null;

    this.staminaContainer = null;
    this.staminaFill = null;
    this.staminaIcon = null;

    this.crosshair = null;

    this._unsubscribe = null;

    this._initElements();
    this._bindEvents();
    this.update();
    if (this.player) this.updatePlayer(this.player);
  }

  /**
   * Assign or update player controller reference.
   * @param {import('./player_controller.js').LocalPlayerController} player
   */
  setPlayer(player) {
    this.player = player;
    this.updatePlayer(player);
  }

  /**
   * Builds the DOM hierarchy and injects styles.
   * @private
   */
  _initElements() {
    this._injectStyles();

    // 1. Top-Center HUD Cluster (Transparent, sits directly over game world)
    this.root = document.createElement('div');
    this.root.id = 'bb-sanity-hud';
    this.root.className = 'bb-hud-top-cluster';

    // Group A: Health Indicator
    this.healthGroup = document.createElement('div');
    this.healthGroup.id = 'bb-group-health';
    this.healthGroup.className = 'bb-hud-stat-group';

    const healthIcon = document.createElement('img');
    healthIcon.className = 'bb-hud-icon';
    healthIcon.src = 'assets/ui/icons/hud_health.png';
    healthIcon.onerror = () => { healthIcon.src = 'assets/ui/icons/hud_health.svg'; };
    healthIcon.alt = 'Health';
    healthIcon.draggable = false;

    const healthTextCol = document.createElement('div');
    healthTextCol.className = 'bb-hud-text-col';
    const healthLabel = document.createElement('div');
    healthLabel.className = 'bb-hud-label';
    healthLabel.textContent = 'Health';
    this.healthVal = document.createElement('div');
    this.healthVal.id = 'bb-val-health';
    this.healthVal.className = 'bb-hud-value';
    this.healthVal.textContent = '100';
    healthTextCol.appendChild(healthLabel);
    healthTextCol.appendChild(this.healthVal);

    this.healthGroup.appendChild(healthIcon);
    this.healthGroup.appendChild(healthTextCol);

    // Group B: Sanity Indicator (authentic Brain Graphic + Percentage)
    this.sanityGroup = document.createElement('div');
    this.sanityGroup.id = 'bb-group-sanity';
    this.sanityGroup.className = 'bb-hud-stat-group';

    this.brainIcon = document.createElement('img');
    this.brainIcon.className = 'bb-hud-icon';
    this.brainIcon.src = 'assets/ui/icons/hud_brain.png';
    this.brainIcon.onerror = () => { this.brainIcon.src = 'assets/ui/icons/hud_brain.svg'; };
    this.brainIcon.alt = 'Sanity Indicator';
    this.brainIcon.draggable = false;

    const sanityTextCol = document.createElement('div');
    sanityTextCol.className = 'bb-hud-text-col';
    this.titleText = document.createElement('div');
    this.titleText.className = 'bb-hud-label';
    this.titleText.textContent = 'Sanity';
    this.percentText = document.createElement('div');
    this.percentText.id = 'bb-val-sanity';
    this.percentText.className = 'bb-hud-value';
    this.percentText.textContent = '100%';
    sanityTextCol.appendChild(this.titleText);
    sanityTextCol.appendChild(this.percentText);

    this.pauseIcon = document.createElement('img');
    this.pauseIcon.className = 'bb-hud-pause-icon';
    this.pauseIcon.src = 'assets/ui/icons/hud_pause.png';
    this.pauseIcon.onerror = () => { this.pauseIcon.src = 'assets/ui/icons/hud_pause.svg'; };
    this.pauseIcon.alt = 'Sanity Paused';
    this.pauseIcon.draggable = false;

    this.sanityGroup.appendChild(this.brainIcon);
    this.sanityGroup.appendChild(sanityTextCol);
    this.sanityGroup.appendChild(this.pauseIcon);

    // Group C: Contextual Equipment Resource Indicator (Ammo or Battery)
    this.resourceGroup = document.createElement('div');
    this.resourceGroup.id = 'bb-group-resource';
    this.resourceGroup.className = 'bb-hud-stat-group';

    this.resourceIcon = document.createElement('img');
    this.resourceIcon.id = 'bb-icon-resource';
    this.resourceIcon.className = 'bb-hud-icon';
    this.resourceIcon.src = 'assets/ui/icons/hud_ammo.png';
    this.resourceIcon.onerror = () => { this.resourceIcon.src = 'assets/ui/icons/hud_ammo.svg'; };
    this.resourceIcon.alt = 'Resource';
    this.resourceIcon.draggable = false;

    const resourceTextCol = document.createElement('div');
    resourceTextCol.className = 'bb-hud-text-col';
    this.resourceLabel = document.createElement('div');
    this.resourceLabel.id = 'bb-lbl-resource';
    this.resourceLabel.className = 'bb-hud-label';
    this.resourceLabel.textContent = 'Pistol';
    this.resourceVal = document.createElement('div');
    this.resourceVal.id = 'bb-val-resource';
    this.resourceVal.className = 'bb-hud-value';
    this.resourceVal.textContent = '12 / 36';
    resourceTextCol.appendChild(this.resourceLabel);
    resourceTextCol.appendChild(this.resourceVal);

    this.resourceGroup.appendChild(this.resourceIcon);
    this.resourceGroup.appendChild(resourceTextCol);

    // Assemble top cluster
    this.root.appendChild(this.healthGroup);
    this.root.appendChild(this.sanityGroup);
    this.root.appendChild(this.resourceGroup);
    this.parent.appendChild(this.root);

    // 2. Bottom-Center Stamina Bar (matches W_HUD.uasset ProgressBar_0)
    this.staminaContainer = document.createElement('div');
    this.staminaContainer.id = 'bb-stamina-container';
    this.staminaContainer.className = 'bb-hud-stamina-container';

    this.staminaIcon = document.createElement('img');
    this.staminaIcon.className = 'bb-hud-stamina-icon';
    this.staminaIcon.src = 'assets/ui/icons/hud_stamina.png';
    this.staminaIcon.onerror = () => { this.staminaIcon.src = 'assets/ui/icons/hud_stamina.svg'; };
    this.staminaIcon.alt = 'Stamina';
    this.staminaIcon.draggable = false;

    const track = document.createElement('div');
    track.id = 'bb-stamina-track';
    track.className = 'bb-hud-stamina-track';

    this.staminaFill = document.createElement('div');
    this.staminaFill.id = 'bb-stamina-fill';
    this.staminaFill.className = 'bb-hud-stamina-fill';
    this.staminaFill.style.width = '100%';

    track.appendChild(this.staminaFill);
    this.staminaContainer.appendChild(this.staminaIcon);
    this.staminaContainer.appendChild(track);
    this.parent.appendChild(this.staminaContainer);

    // 3. Center Dot Crosshair
    let ch = document.getElementById('bb-crosshair');
    if (!ch) {
      ch = document.createElement('div');
      ch.id = 'bb-crosshair';
      ch.className = 'bb-dot-crosshair';
      this.parent.appendChild(ch);
    }
    this.crosshair = ch;
  }

  /**
   * Injects CSS styling matching authentic Budget-Backrooms specifications.
   * @private
   */
  _injectStyles() {
    if (document.getElementById('bb-survival-hud-styles')) return;

    const style = document.createElement('style');
    style.id = 'bb-survival-hud-styles';
    style.textContent = `
      @keyframes bb-pause-pulse {
        0% { opacity: 0.35; transform: scale(0.95); }
        50% { opacity: 0.95; transform: scale(1.05); }
        100% { opacity: 0.35; transform: scale(0.95); }
      }

      /* 1. Top-Center Minimalist Cluster */
      .bb-hud-top-cluster {
        position: absolute;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 36px;
        z-index: 100;
        pointer-events: none;
        user-select: none;
        opacity: 0.45; /* Authentic Budget-Backrooms RenderOpacity = 0.45 */
        transition: opacity 0.25s ease, filter 0.3s ease;
        font-family: 'Rubik', -apple-system, BlinkMacSystemFont, sans-serif;
      }

      .bb-hud-top-cluster.bb-panic {
        opacity: 0.85;
        filter: drop-shadow(0 0 10px rgba(220, 60, 60, 0.45));
      }

      .bb-hud-top-cluster.bb-depleted {
        opacity: 0.2;
      }

      .bb-hud-stat-group {
        display: flex;
        align-items: center;
        gap: 10px;
        background: transparent !important; /* Strictly no opaque tiles or card plates */
      }

      .bb-hud-icon {
        width: 32px;
        height: 32px;
        object-fit: contain;
        display: block;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.8));
      }

      .bb-hud-pause-icon {
        width: 24px;
        height: 24px;
        object-fit: contain;
        display: none;
        margin-left: 2px;
        filter: drop-shadow(0 0 6px rgba(212, 175, 55, 0.6));
      }

      .bb-hud-pause-icon.active {
        display: block;
        animation: bb-pause-pulse 1.8s infinite ease-in-out;
      }

      .bb-hud-text-col {
        display: flex;
        flex-direction: column;
        justify-content: center;
        line-height: 1.15;
      }

      .bb-hud-label {
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 1px;
        color: #c8c6bc;
        text-transform: uppercase;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
      }

      .bb-hud-value {
        font-size: 16px;
        font-weight: 500;
        letter-spacing: 0.5px;
        color: #edece6;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
      }

      .bb-hud-value.bb-low {
        color: #e57373;
        text-shadow: 0 0 6px rgba(229, 115, 115, 0.6);
      }

      /* 2. Bottom-Center Stamina Bar (W_HUD.uasset layout: width ~476px, height ~22px) */
      .bb-hud-stamina-container {
        position: absolute;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        width: min(476px, 80vw);
        height: 22px;
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 100;
        pointer-events: none;
        user-select: none;
        opacity: 0.45;
        transition: opacity 0.25s ease;
        font-family: 'Rubik', -apple-system, BlinkMacSystemFont, sans-serif;
      }

      .bb-hud-stamina-container.bb-draining {
        opacity: 0.85;
      }

      .bb-hud-stamina-container.bb-exhausted {
        opacity: 0.3;
      }

      .bb-hud-stamina-icon {
        width: 22px;
        height: 22px;
        object-fit: contain;
        display: block;
        opacity: 0.85;
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.8));
      }

      .bb-hud-stamina-track {
        flex: 1;
        height: 14px;
        background: rgba(14, 13, 12, 0.75);
        border: 1px solid rgba(220, 218, 205, 0.28);
        border-radius: 2px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.65), inset 0 1px 2px rgba(0, 0, 0, 0.5);
        overflow: hidden;
        padding: 2px;
        box-sizing: border-box;
      }

      .bb-hud-stamina-fill {
        height: 100%;
        width: 100%;
        background: rgba(220, 218, 205, 0.72);
        box-shadow: 0 0 6px rgba(220, 218, 205, 0.3);
        border-radius: 1px;
        transition: width 0.06s linear;
      }

      /* 3. Authentic Center Dot Crosshair */
      .bb-dot-crosshair {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 6px;
        height: 6px;
        background: url('assets/ui/icons/crosshair_smaller.png') no-repeat center center;
        background-size: contain;
        opacity: 0.45;
        pointer-events: none;
        z-index: 90;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Binds controller events to HUD updates.
   * @private
   */
  _bindEvents() {
    if (!this.controller) return;
    const onUpdate = () => this.update();
    const u1 = this.controller.on('SANITY_CHANGED', onUpdate);
    const u2 = this.controller.on('SANITY_THRESHOLD_CHANGED', onUpdate);
    const u3 = this.controller.on('SANITY_PAUSED', onUpdate);
    const u4 = this.controller.on('SANITY_RESUMED', onUpdate);
    const u5 = this.controller.on('SANITY_DEPLETED', onUpdate);

    this._unsubscribe = () => {
      u1(); u2(); u3(); u4(); u5();
    };
  }

  /**
   * Synchronizes the DOM elements with current sanity controller state.
   */
  update() {
    if (!this.root || !this.percentText) return;

    if (this.controller) {
      const snap = this.controller.getSnapshot();
      const pct = Math.round(snap.percentage);
      this.percentText.textContent = `${pct}%`;

      if (snap.isPaused) {
        this.pauseIcon.classList.add('active');
      } else {
        this.pauseIcon.classList.remove('active');
      }

      this.root.classList.remove('bb-panic', 'bb-depleted');
      if (snap.state === 'PANIC') {
        this.root.classList.add('bb-panic');
      } else if (snap.state === 'DEPLETED') {
        this.root.classList.add('bb-depleted');
      }
    }

    if (this.player) {
      this.updatePlayer(this.player);
    }
  }

  /**
   * Synchronizes health, equipment resources, and stamina with player state.
   * @param {import('./player_controller.js').LocalPlayerController} player
   */
  updatePlayer(player) {
    if (!player) return;

    // 1. Health
    if (this.healthVal) {
      const hp = Math.max(0, Math.round(player.hp ?? 100));
      this.healthVal.textContent = String(hp);
      this.healthVal.classList.toggle('bb-low', hp <= 25);
    }

    // 2. Contextual Equipment Resource
    if (this.resourceGroup) {
      const w = player.weapon ?? 0;
      if (w === 0) {
        // Pistol
        this.resourceGroup.style.display = 'flex';
        this.resourceIcon.src = 'assets/ui/icons/hud_ammo.png';
        this.resourceIcon.onerror = () => { this.resourceIcon.src = 'assets/ui/icons/hud_ammo.svg'; };
        this.resourceLabel.textContent = 'Pistol';
        const mag = player.mag ? player.mag.bullets ?? 12 : 12;
        const res = player.bullets ?? 36;
        this.resourceVal.textContent = `${mag} / ${res}`;
        this.resourceVal.classList.toggle('bb-low', mag <= 3);
      } else if (w === 1) {
        // Shotgun
        this.resourceGroup.style.display = 'flex';
        this.resourceIcon.src = 'assets/ui/icons/hud_ammo.png';
        this.resourceIcon.onerror = () => { this.resourceIcon.src = 'assets/ui/icons/hud_ammo.svg'; };
        this.resourceLabel.textContent = 'Shotgun';
        const mag = player.mag ? player.mag.shells ?? 6 : 6;
        const res = player.shells ?? 2;
        this.resourceVal.textContent = `${mag} / ${res}`;
        this.resourceVal.classList.toggle('bb-low', mag <= 1);
      } else if (w === 2) {
        // Torch / Battery
        this.resourceGroup.style.display = 'flex';
        this.resourceIcon.src = 'assets/ui/icons/hud_battery.png';
        this.resourceIcon.onerror = () => { this.resourceIcon.src = 'assets/ui/icons/hud_battery.svg'; };
        this.resourceLabel.textContent = 'Battery';
        const bat = Math.max(0, Math.round(player.battery ?? 100));
        this.resourceVal.textContent = `${bat}%`;
        this.resourceVal.classList.toggle('bb-low', bat <= 20);
      } else {
        // Unarmed / other: hide indicator contextually
        this.resourceGroup.style.display = 'none';
      }
    }

    // 3. Stamina Bar
    if (this.staminaFill && this.staminaContainer) {
      const stamina = Math.max(0, Math.min(100, player.stamina ?? 100));
      this.staminaFill.style.width = `${stamina.toFixed(1)}%`;

      if (player.isSprinting) {
        this.staminaContainer.classList.add('bb-draining');
      } else {
        this.staminaContainer.classList.remove('bb-draining');
      }

      if (stamina <= 0 || player._staminaExhausted) {
        this.staminaContainer.classList.add('bb-exhausted');
      } else {
        this.staminaContainer.classList.remove('bb-exhausted');
      }
    }
  }

  /**
   * Show or hide the entire Survival HUD.
   * @param {boolean} visible
   */
  setVisible(visible) {
    if (this.root) {
      this.root.style.display = visible ? 'flex' : 'none';
    }
    if (this.staminaContainer) {
      this.staminaContainer.style.display = visible ? 'flex' : 'none';
    }
    if (this.crosshair) {
      this.crosshair.style.display = visible ? 'block' : 'none';
    }
  }

  /**
   * Cleans up DOM elements and event listeners.
   */
  destroy() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    if (this.staminaContainer && this.staminaContainer.parentNode) {
      this.staminaContainer.parentNode.removeChild(this.staminaContainer);
    }
    if (this.crosshair && this.crosshair.parentNode) {
      this.crosshair.parentNode.removeChild(this.crosshair);
    }
  }
}

// Export alias for SurvivalHUD
export { SanityHUD as SurvivalHUD };
