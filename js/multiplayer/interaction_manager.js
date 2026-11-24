/**
 * Saber Killer — Reusable Interaction Framework
 * Camera-centered raycasting, hover/unhover detection, contextual prompts,
 * debounced E-key interaction, and real-time developer diagnostics for multiplayer survival gameplay.
 */

import { getItemDefinition, isPickupItem } from './item_catalog.js';

function isInteractionKey(e) {
  if (!e) return false;
  if (e.code === 'KeyE') return true;
  if (e.key === 'e' || e.key === 'E') return true;
  if (e.keyCode === 69) return true;
  return false;
}

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
    this._lastKeyDownTime = 0;
    this.enabled = true;

    // Request lifecycle management
    this.isPending = false;
    this.pendingRequestId = null;
    this.pendingTargetId = null;
    this.pendingTimeout = null;
    this.completedRequests = new Set();

    // Interaction callbacks
    this.onInteract = options.onInteract || null;
    this.onHover = options.onHover || null;
    this.onUnhover = options.onUnhover || null;
    this.onDiagnosticsChange = options.onDiagnosticsChange || null;

    // Real-time developer pickup pipeline diagnostics state
    this.diagnostics = {
      targetId: null,
      targetType: null,
      targetDistance: null,
      eligibility: 'NOT TARGETED',
      lastKey: 'NONE',
      lastRequest: 'NONE',
      serverResult: 'NONE',
      inventoryResult: '0 / 12 slots',
      lastRejection: 'NONE'
    };

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

  _notifyDiagnostics() {
    if (typeof this.onDiagnosticsChange === 'function') {
      try {
        this.onDiagnosticsChange(this.diagnostics);
      } catch (e) {
        console.warn('[InteractionManager] onDiagnosticsChange error:', e);
      }
    }
  }

  _bindEvents() {
    this._onKeyDown = (e) => {
      // 1. Pointer lock priority: if pointer locked, player is in active first-person view
      const isPointerLocked = (document.pointerLockElement !== null);
      if (!isPointerLocked && e.target) {
        const tag = e.target.tagName;
        const type = (e.target.type || '').toLowerCase();
        const isEditableText = (tag === 'TEXTAREA') || (tag === 'INPUT' && ['text', 'password', 'search', 'email', 'url', 'tel', 'number', ''].includes(type));
        // Only block if actually typing into a visible editable text element
        if (isEditableText && e.target.offsetParent !== null) {
          return;
        }
      }

      // 2. Suppress interaction when World Placement Editor is in active Edit mode
      if (window.worldEditor && window.worldEditor.editorMode === 'edit') {
        return;
      }

      // 3. Multi-layout E-key detection (code, key, and keyCode)
      if (isInteractionKey(e)) {
        const now = Date.now();
        console.log(`[STAGE 2/19] [CLIENT] E key received: code=${e.code || 'n/a'}, key=${e.key || 'n/a'}`);
        // Allow trigger if not currently held OR >300ms safeguard against dropped keyup events
        if (!this.eKeyPressed || (now - this._lastKeyDownTime > 300)) {
          this.eKeyPressed = true;
          this._lastKeyDownTime = now;
          this.diagnostics.lastKey = `E received (code=${e.code || 'n/a'}, key=${e.key || 'n/a'}) at ${new Date(now).toLocaleTimeString()}`;
          this._notifyDiagnostics();
          this.triggerInteraction();
        }
      }
    };

    this._onKeyUp = (e) => {
      if (isInteractionKey(e)) {
        this.eKeyPressed = false;
      }
    };

    this._onBlur = () => {
      this.eKeyPressed = false;
    };

    this._onPointerLockChange = () => {
      this.eKeyPressed = false;
    };

    // Attach in capture phase to guarantee interception before other elements
    window.addEventListener('keydown', this._onKeyDown, { capture: true });
    window.addEventListener('keyup', this._onKeyUp, { capture: true });
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
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
   * Performs single-action interaction on current target with complete request lifecycle management
   */
  triggerInteraction() {
    if (!this.enabled || (window.mpManager && window.mpManager.isInStagingLobby)) {
      this.diagnostics.eligibility = 'DISABLED';
      this._notifyDiagnostics();
      return;
    }

    if (window.inventoryUI && window.inventoryUI.isOpen) {
      return;
    }
    if (!this.currentTarget) {
      this.diagnostics.eligibility = 'NOT TARGETED (No object in crosshair)';
      this._notifyDiagnostics();
      return;
    }

    // Proximity guard
    const maxDist = (this.currentTarget.type === 'revive_teammate')
      ? 2.8
      : (this.currentTarget.maxDistance || (this.currentTarget.type === 'exit_door' ? 3.2 : this.maxDistance));
    if (this.currentTarget.distance > maxDist) {
      this.diagnostics.eligibility = `OUT OF RANGE (${this.currentTarget.distance.toFixed(2)}m > ${maxDist}m)`;
      this._notifyDiagnostics();
      return;
    }

    // Prevent accidental duplicate interaction requests while one is pending
    if (this.isPending) {
      console.warn(`[InteractionManager] Duplicate interaction ignored: request ${this.pendingRequestId} is already pending`);
      this.diagnostics.serverResult = `PENDING (Request ${this.pendingRequestId} in flight, ignoring duplicate)`;
      this._notifyDiagnostics();
      return;
    }

    const target = this.currentTarget;
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    this.isPending = true;
    this.pendingRequestId = requestId;
    this.pendingTargetId = target.id;

    // Safety timeout: clear pending after 3000ms if no server acknowledgement
    if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
    this.pendingTimeout = setTimeout(() => {
      if (this.isPending && this.pendingRequestId === requestId) {
        console.warn(`[InteractionManager] Request ${requestId} for '${target.id}' timed out after 3000ms`);
        this.isPending = false;
        this.pendingRequestId = null;
        this.pendingTargetId = null;
        this.diagnostics.serverResult = 'TIMEOUT (No response from server after 3s)';
        this.diagnostics.lastRejection = 'Request timed out after 3000ms';
        this._notifyDiagnostics();
      }
    }, 3000);

    console.log(`[PICKUP ${requestId}] E received: target=${target.id}`);
    this.diagnostics.lastRequest = `PICKUP_REQUEST created (${target.id}, reqId=${requestId}) at ${new Date().toLocaleTimeString()}`;
    this.diagnostics.serverResult = `PENDING (Awaiting server response for ${requestId}...)`;
    this._notifyDiagnostics();

    if (typeof this.onInteract === 'function') {
      try {
        const result = this.onInteract(target, requestId);
        if (result === false || result?.sent === false) {
          this._finishPickupRequest(requestId);
          this.diagnostics.serverResult = 'NOT SENT (WebSocket is not open)';
          this.diagnostics.lastRejection = 'WebSocket is not connected';
          console.warn(`[PICKUP ${requestId}] WebSocket send failed; request was not transmitted`);
          this._notifyDiagnostics();
        }
      } catch (err) {
        console.error('[InteractionManager] Error executing onInteract:', err);
        this._finishPickupRequest(requestId);
        this.diagnostics.serverResult = `SEND ERROR (${err.message})`;
        this.diagnostics.lastRejection = err.message;
        this._notifyDiagnostics();
      }
    }
  }

  /**
   * Handles explicit server acknowledgement (ITEM_PICKUP_RESPONSE)
   */
  handlePickupResponse(payload) {
    if (!payload) return;
    const { requestId, success, itemId, reason } = payload;
    console.log(`[STAGE 15/19] [CLIENT] Response received: reqId=${requestId}, success=${success}, item=${itemId}`);

    // Ignore duplicate acknowledgements
    if (requestId && this.completedRequests.has(requestId)) {
      console.log(`[InteractionManager] Ignoring duplicate acknowledgement for completed request: ${requestId}`);
      return;
    }

    // Match acknowledgements against original request IDs (or pending target)
    const matches = this.pendingRequestId === requestId;
    if (!matches) {
      console.warn(`[InteractionManager] Unmatched response received (expected reqId=${this.pendingRequestId}, got ${requestId})`);
      return;
    }

    console.log(`[STAGE 16/19] [CLIENT] Request ID matched: expected=${this.pendingRequestId}, received=${requestId}`);

    this._finishPickupRequest(requestId);

    if (requestId) {
      this.completedRequests.add(requestId);
      if (this.completedRequests.size > 50) {
        const oldest = this.completedRequests.values().next().value;
        this.completedRequests.delete(oldest);
      }
    }

    console.log(`[STAGE 17/19] [CLIENT] ${success ? 'Success' : 'Rejection'} processed for item: ${itemId}`);
    console.log(`[STAGE 18/19] [CLIENT] Pending indicator cleared`);

    const timeStr = new Date().toLocaleTimeString();
    if (success) {
      this.diagnostics.serverResult = `ACCEPTED — ${itemId} (${payload.itemType || 'item'}) at ${timeStr}`;
      this.diagnostics.lastRejection = 'NONE';
      this.clearTargetIfId(itemId);
    } else {
      this.diagnostics.serverResult = `REJECTED — ${reason || 'Server rejection'} at ${timeStr}`;
      this.diagnostics.lastRejection = reason || 'Server rejection';
    }
    this._notifyDiagnostics();
  }

  /**
   * Handles server vending machine dispense acknowledgement
   */
  handleVendingDispenseResponse(payload) {
    if (!payload) return;
    const { requestId, success, machineId, reason, remainingStock } = payload;
    console.log(`[InteractionManager] Vending dispense response: reqId=${requestId}, success=${success}, machine=${machineId}, remainingStock=${remainingStock}`);

    if (this.pendingRequestId && (this.pendingRequestId === requestId || this.pendingTargetId === machineId)) {
      this._finishPickupRequest(requestId);
      const timeStr = new Date().toLocaleTimeString();
      if (success) {
        const stockStr = (typeof remainingStock === 'number') ? ` (${remainingStock} left)` : '';
        this.diagnostics.serverResult = `ACCEPTED — Dispensed from ${machineId}${stockStr} at ${timeStr}`;
        this.diagnostics.lastRejection = 'NONE';
      } else {
        this.diagnostics.serverResult = `REJECTED — ${reason || 'Dispense failed'} at ${timeStr}`;
        this.diagnostics.lastRejection = reason || 'Dispense failed';
      }
      this._notifyDiagnostics();
    }
  }

  /**
   * Handles server door unlock response (DOOR_UNLOCK_RESPONSE)
   */
  handleDoorUnlockResponse(payload) {
    if (!payload) return;
    const { requestId, success, doorId, reason } = payload;
    if (this.pendingRequestId && (this.pendingRequestId === requestId || this.pendingTargetId === doorId)) {
      this._finishPickupRequest(requestId);
      const timeStr = new Date().toLocaleTimeString();
      if (success) {
        this.diagnostics.serverResult = `ACCEPTED — Door ${doorId} unlocked at ${timeStr}`;
        this.diagnostics.lastRejection = 'NONE';
      } else {
        this.diagnostics.serverResult = `REJECTED — ${reason || 'Unlock failed'} at ${timeStr}`;
        this.diagnostics.lastRejection = reason || 'Unlock failed';
      }
      this._notifyDiagnostics();
    }
  }

  /**
   * Handles teammate revival response (PLAYER_REVIVE_RESPONSE)
   */
  handleReviveResponse(payload) {
    if (!payload) return;
    const { requestId, success, targetPlayerId, reason } = payload;
    if (this.pendingRequestId && (this.pendingRequestId === requestId || this.pendingTargetId === targetPlayerId || this.pendingTargetId === `revive_${targetPlayerId}`)) {
      this._finishPickupRequest(requestId || this.pendingRequestId);
      const timeStr = new Date().toLocaleTimeString();
      if (success) {
        this.diagnostics.serverResult = `ACCEPTED — Teammate ${targetPlayerId || ''} revived at ${timeStr}`;
        this.diagnostics.lastRejection = 'NONE';
      } else {
        this.diagnostics.serverResult = `REJECTED — ${reason || 'Revival failed'} at ${timeStr}`;
        this.diagnostics.lastRejection = reason || 'Revival failed';
      }
      this._notifyDiagnostics();
    }
  }

  handleReviveRejected(reason) {
    this._finishPickupRequest();
    this.diagnostics.serverResult = `REJECTED — ${reason}`;
    this.diagnostics.lastRejection = reason;
    this._notifyDiagnostics();
  }

  _finishPickupRequest(requestId) {
    if (requestId && this.pendingRequestId && requestId !== this.pendingRequestId) return false;
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    this.isPending = false;
    this.pendingRequestId = null;
    this.pendingTargetId = null;
    return true;
  }

  /**
   * Handles room-wide item collection broadcast (ITEM_COLLECTED)
   */
  handleItemCollected(payload) {
    if (!payload || !payload.itemId) return;
    if (this.itemManager) {
      this.itemManager.hideItem(payload.itemId);
    }
    this.clearTargetIfId(payload.itemId);

    if (this.isPending && (this.pendingRequestId === payload.requestId || this.pendingTargetId === payload.itemId)) {
      this.handlePickupResponse({
        requestId: payload.requestId || this.pendingRequestId,
        success: true,
        itemId: payload.itemId,
        itemType: payload.itemType
      });
    }

    console.log(`[STAGE 19/19] [CLIENT] Inventory and world state updated: item=${payload.itemId} hidden`);
  }

  /**
   * Handles server pickup rejection notification (PICKUP_REJECTED)
   */
  handlePickupRejected(payload) {
    if (!payload) return;
    if (this.isPending && (this.pendingRequestId === payload.requestId || this.pendingTargetId === payload.itemId)) {
      this.handlePickupResponse({
        requestId: payload.requestId || this.pendingRequestId,
        success: false,
        itemId: payload.itemId,
        reason: payload.reason
      });
    }
  }

  /**
   * Handles disconnection event: immediately clear pending state with diagnostic notice
   */
  handleDisconnect() {
    if (this.isPending) {
      console.warn(`[InteractionManager] Disconnected while request ${this.pendingRequestId} was pending`);
      if (this.pendingTimeout) {
        clearTimeout(this.pendingTimeout);
        this.pendingTimeout = null;
      }
      this.isPending = false;
      this.pendingRequestId = null;
      this.pendingTargetId = null;
      this.diagnostics.serverResult = 'DISCONNECTED (Server connection lost while pending)';
      this.diagnostics.lastRejection = 'Connection closed';
      this._notifyDiagnostics();
    }
  }

  /**
   * Records server packet response into diagnostics
   */
  recordServerResponse(type, payload) {
    const timeStr = new Date().toLocaleTimeString();
    if (type === 'ITEM_COLLECTED') {
      this.handleItemCollected(payload);
    } else if (type === 'PICKUP_REJECTED') {
      this.handlePickupRejected(payload);
    } else if (type === 'INVENTORY_UPDATE') {
      const occupied = payload?.inventory?.slots ? payload.inventory.slots.filter(s => s !== null).length : 0;
      this.diagnostics.inventoryResult = `${occupied} / 12 slots (updated at ${timeStr})`;
      this._notifyDiagnostics();
    }
  }

  /**
   * Immediately clears current hover target if matching the collected item ID
   */
  clearTargetIfId(id) {
    if (this.currentTarget && this.currentTarget.id === id) {
      this._clearHoverTarget();
    }
  }

  /**
   * Cleans up pending requests, prompts, and hover state on match start/restart
   */
  reset() {
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    this.isPending = false;
    this.pendingRequestId = null;
    this.pendingTargetId = null;
    this._clearHoverTarget();
    this.hidePrompt();
  }

  hidePrompt() {
    this._updatePrompt(null);
  }

  /**
   * Raycasts from center of camera and updates hovered target
   */
  update() {
    if (!this.enabled || !this.camera || !this.itemManager || (window.mpManager && window.mpManager.isInStagingLobby)) {
      if (this.currentTarget) this._clearHoverTarget();
      return;
    }

    // Do not interact when local player is downed or dead
    if (window.localPlayer && (window.localPlayer.isDowned || window.localPlayer.isDead || window.localPlayer.state !== 'ACTIVE')) {
      if (this.currentTarget) this._clearHoverTarget();
      return;
    }

    // Do not interact when editor is in Edit mode or inventory is open
    if ((window.worldEditor && window.worldEditor.editorMode === 'edit') || (window.inventoryUI && window.inventoryUI.isOpen)) {
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
        if (item && !item.isCollected && (!item.object || item.object.visible !== false)) {
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
            name: (typeof ci.getName === 'function') ? ci.getName() : (ci.name || 'Object'),
            category: ci.category || 'interactable',
            actionText: (typeof ci.getActionText === 'function') ? ci.getActionText() : (ci.actionText || 'Use'),
            maxDistance: ci.maxDistance,
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

    // Check for nearby downed teammates if no item/prop is currently targeted
    if (!foundTarget && window.mpManager && window.mpManager.remotePlayers) {
      for (const [peerId, peer] of window.mpManager.remotePlayers) {
        if (peer.state === 'DOWNED' && peer.group) {
          const pPos = peer.group.position;
          const dx = this.camera.position.x - pPos.x;
          const dy = this.camera.position.y - (pPos.y + 0.25);
          const dz = this.camera.position.z - pPos.z;
          const dist = Math.hypot(dx, dy, dz);
          if (dist <= 2.8) {
            const camDir = new THREE.Vector3();
            this.camera.getWorldDirection(camDir);
            const toPeer = new THREE.Vector3(pPos.x - this.camera.position.x, (pPos.y + 0.25) - this.camera.position.y, pPos.z - this.camera.position.z).normalize();
            if (camDir.dot(toPeer) > 0.4) {
              const hasFirstAid = Boolean(window.mpManager?.inventory?.getCount('first_aid') > 0);
              foundTarget = {
                id: `revive_${peer.id}`,
                type: 'revive_teammate',
                targetPlayerId: peer.id,
                name: hasFirstAid ? 'Teammate (Uses Health Pack)' : 'Teammate (Needs Health Pack)',
                actionText: 'Revive',
                distance: dist,
                point: pPos,
                isPickup: false,
                isEnvironmental: false,
                hasRequiredItem: hasFirstAid
              };
              break;
            }
          }
        }
      }
    }

    if (foundTarget) {
      if (!this.currentTarget || this.currentTarget.id !== foundTarget.id) {
        this._setHoverTarget(foundTarget);
      } else {
        // Update distance and eligibility
        this.currentTarget.distance = foundTarget.distance;
        this.diagnostics.targetDistance = foundTarget.distance;
        const maxDist = (foundTarget.type === 'revive_teammate') ? 2.8 : this.maxDistance;
        this.diagnostics.eligibility = (foundTarget.distance <= maxDist)
          ? `ELIGIBLE (${foundTarget.distance.toFixed(2)}m)`
          : `OUT OF RANGE (${foundTarget.distance.toFixed(2)}m > ${maxDist}m)`;
        this._notifyDiagnostics();
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

    console.log(`[STAGE 1/19] [CLIENT] Interaction target selected: id=${target.id}, type=${target.type}, dist=${target.distance.toFixed(2)}m`);

    const maxDist = (target.type === 'revive_teammate') ? 2.8 : this.maxDistance;
    this.diagnostics.targetId = target.id;
    this.diagnostics.targetType = target.type;
    this.diagnostics.targetDistance = target.distance;
    this.diagnostics.eligibility = (target.distance <= maxDist)
      ? `ELIGIBLE (${target.distance.toFixed(2)}m)`
      : `OUT OF RANGE (${target.distance.toFixed(2)}m > ${maxDist}m)`;
    this._notifyDiagnostics();

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

    this.diagnostics.targetId = null;
    this.diagnostics.targetType = null;
    this.diagnostics.targetDistance = null;
    this.diagnostics.eligibility = 'NOT TARGETED';
    this._notifyDiagnostics();
  }

  /**
   * Cleans up DOM and listeners
   */
  destroy() {
    this._clearHoverTarget();
    if (this.promptEl && this.promptEl.parentNode) {
      this.promptEl.parentNode.removeChild(this.promptEl);
    }
    window.removeEventListener('keydown', this._onKeyDown, { capture: true });
    window.removeEventListener('keyup', this._onKeyUp, { capture: true });
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }
}
