/**
 * Saber Killer — Reusable Interaction Framework
 * Camera-centered raycasting, hover/unhover detection, contextual prompts,
 * and debounced E-key interaction for multiplayer survival gameplay.
 */

import { getItemDefinition, isPickupItem } from './item_catalog.js';

export class InteractionManager {
  constructor(camera, scene, itemManager, options = {}) {
    this.camera = camera;
    this.scene = scene;
    this.itemManager = itemManager;
    this.maxDistance = options.maxDistance || 2.1; // Default 2.1 meters

    this.raycaster = new THREE.Raycaster();
    this.rayOrigin = new THREE.Vector2(0, 0); // Viewport center
    this.currentTarget = null;
    this.eKeyPressed = false;
    this.enabled = true;

    // Interaction callbacks
    this.onInteract = options.onInteract || null;
    this.onHover = options.onHover || null;
    this.onUnhover = options.onUnhover || null;

    // Custom interactables registry (for doors, card readers, vending machines)
    this.customInteractables = new Map();

    // DOM Interaction Prompt
    this._initPromptUI();

    // Bind keyboard events
    this._bindEvents();
  }

  /**
   * Initializes contextual interaction prompt DOM element
   */
  _initPromptUI() {
    this.promptEl = document.getElementById('interaction-prompt');
    if (!this.promptEl) {
      this.promptEl = document.createElement('div');
      this.promptEl.id = 'interaction-prompt';
      this.promptEl.style.position = 'fixed';
      this.promptEl.style.top = '58%';
      this.promptEl.style.left = '50%';
      this.promptEl.style.transform = 'translate(-50%, -50%)';
      this.promptEl.style.display = 'none';
      this.promptEl.style.alignItems = 'center';
      this.promptEl.style.gap = '8px';
      this.promptEl.style.padding = '6px 14px';
      this.promptEl.style.background = 'rgba(15, 15, 12, 0.75)';
      this.promptEl.style.border = '1px solid rgba(237, 236, 230, 0.35)';
      this.promptEl.style.borderRadius = '4px';
      this.promptEl.style.color = '#edece6';
      this.promptEl.style.fontFamily = "'Courier New', Courier, monospace";
      this.promptEl.style.fontSize = '13px';
      this.promptEl.style.fontWeight = '600';
      this.promptEl.style.letterSpacing = '0.5px';
      this.promptEl.style.pointerEvents = 'none';
      this.promptEl.style.zIndex = '900';
      this.promptEl.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)';
      this.promptEl.style.backdropFilter = 'blur(2px)';

      document.body.appendChild(this.promptEl);
    }
  }

  /**
   * Updates prompt DOM element with contextual action and name
   */
  _updatePrompt(target) {
    if (!this.promptEl) return;
    if (!target) {
      this.promptEl.style.display = 'none';
      return;
    }

    const action = target.actionText || 'Take';
    const name = target.name || 'Item';
    this.promptEl.innerHTML = `
      <span style="display:inline-block; padding: 2px 6px; background: rgba(237, 236, 230, 0.2); border: 1px solid #edece6; border-radius: 2px; font-size: 11px;">E</span>
      <span>${action} ${name}</span>
    `;
    this.promptEl.style.display = 'flex';
  }

  _bindEvents() {
    this._onKeyDown = (e) => {
      // Ignore if typing in text inputs or textareas
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }

      // Check if world editor is in active Edit mode
      if (window.worldEditor && window.worldEditor.editorMode === 'edit') {
        return;
      }

      if (e.code === 'KeyE') {
        if (!this.eKeyPressed) {
          this.eKeyPressed = true;
          this.triggerInteraction();
        }
      }
    };

    this._onKeyUp = (e) => {
      if (e.code === 'KeyE') {
        this.eKeyPressed = false;
      }
    };

    window.addEventListener('keydown', this._onKeyDown, { capture: false });
    window.addEventListener('keyup', this._onKeyUp, { capture: false });
  }

  /**
   * Registers custom environmental interactable (e.g. doors, vending machine)
   */
  registerInteractable(id, data) {
    this.customInteractables.set(id, data);
  }

  /**
   * Unregisters custom environmental interactable
   */
  unregisterInteractable(id) {
    this.customInteractables.delete(id);
  }

  /**
   * Performs single-action interaction on current target
   */
  triggerInteraction() {
    if (!this.enabled || !this.currentTarget) return;

    // Proximity guard
    if (this.currentTarget.distance > this.maxDistance) {
      return;
    }

    if (typeof this.onInteract === 'function') {
      try {
        this.onInteract(this.currentTarget);
      } catch (err) {
        console.error('[InteractionManager] Error executing onInteract:', err);
      }
    }
  }

  /**
   * Raycasts from center of camera and updates hovered target
   */
  update() {
    if (!this.enabled || !this.camera || !this.itemManager) {
      if (this.currentTarget) this._clearHoverTarget();
      return;
    }

    // Do not interact when editor is in Edit mode
    if (window.worldEditor && window.worldEditor.editorMode === 'edit') {
      if (this.currentTarget) this._clearHoverTarget();
      return;
    }

    this.raycaster.setFromCamera(this.rayOrigin, this.camera);
    this.raycaster.far = this.maxDistance;

    const candidates = [];
    if (this.itemManager.container && this.itemManager.container.children.length > 0) {
      candidates.push(...this.itemManager.container.children);
    }

    // Include any registered custom interactables meshes
    for (const [, ci] of this.customInteractables) {
      if (ci.object) candidates.push(ci.object);
    }

    if (candidates.length === 0) {
      if (this.currentTarget) this._clearHoverTarget();
      return;
    }

    const intersects = this.raycaster.intersectObjects(candidates, true);

    let foundTarget = null;

    for (const hit of intersects) {
      // Find root wrapper containing metadata
      let curr = hit.object;
      let wrapperId = null;

      while (curr && curr !== this.scene) {
        if (curr.userData && curr.userData.id) {
          wrapperId = curr.userData.id;
          break;
        }
        if (curr.name && this.itemManager && typeof this.itemManager.getItemById === 'function' && this.itemManager.getItemById(curr.name)) {
          wrapperId = curr.name;
          break;
        }
        curr = curr.parent;
      }

      if (wrapperId) {
        // 1. Check if it's an ItemManager item
        const item = this.itemManager.getItemById(wrapperId);
        if (item) {
          const def = getItemDefinition(item.type);
          const isPickup = isPickupItem(item.type);
          const isEnvironmental = def && def.isInteractable;

          if (isPickup || isEnvironmental) {
            foundTarget = {
              id: item.id,
              type: item.type,
              name: def?.name || item.name || 'Item',
              category: def?.category || item.category,
              actionText: isPickup ? 'Take' : (def?.metadata?.promptText || 'Inspect'),
              distance: hit.distance,
              point: hit.point,
              object: item.object,
              itemEntry: item,
              isPickup: isPickup,
              isEnvironmental: !!isEnvironmental
            };
            break;
          }
        }

        // 2. Check if custom interactable
        if (this.customInteractables.has(wrapperId)) {
          const ci = this.customInteractables.get(wrapperId);
          foundTarget = {
            id: wrapperId,
            type: ci.type || 'custom',
            name: ci.name || 'Object',
            category: ci.category || 'interactable',
            actionText: ci.actionText || 'Use',
            distance: hit.distance,
            point: hit.point,
            object: ci.object,
            isPickup: false,
            isEnvironmental: true
          };
          break;
        }
      }
    }

    if (foundTarget) {
      if (!this.currentTarget || this.currentTarget.id !== foundTarget.id) {
        this._setHoverTarget(foundTarget);
      } else {
        // Update distance
        this.currentTarget.distance = foundTarget.distance;
      }
    } else {
      if (this.currentTarget) {
        this._clearHoverTarget();
      }
    }
  }

  _setHoverTarget(target) {
    if (this.currentTarget && this.onUnhover) {
      try { this.onUnhover(this.currentTarget); } catch (e) {}
    }

    this.currentTarget = target;
    this._updatePrompt(target);

    if (this.onHover) {
      try { this.onHover(target); } catch (e) {}
    }
  }

  _clearHoverTarget() {
    if (this.currentTarget && this.onUnhover) {
      try { this.onUnhover(this.currentTarget); } catch (e) {}
    }
    this.currentTarget = null;
    this._updatePrompt(null);
  }

  /**
   * Cleans up DOM and listeners
   */
  destroy() {
    this._clearHoverTarget();
    if (this.promptEl && this.promptEl.parentNode) {
      this.promptEl.parentNode.removeChild(this.promptEl);
    }
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }
}
