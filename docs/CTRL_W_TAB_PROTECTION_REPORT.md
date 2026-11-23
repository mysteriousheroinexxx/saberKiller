# Accidental Ctrl+W Tab Closure Protection & Session Safeguard

## Overview

In multiplayer Survival Mode, players navigate using standard WASD controls. When running, sneaking, or using control combinations, accidental keypresses of `Ctrl+W` (or `Cmd+W` on macOS) can risk terminating the browser tab, severing the network session and losing survival progress.

This update introduces dual-layer protection against accidental session termination while keeping normal controls completely responsive and enabling seamless intentional exits.

---

## Architecture & Implementation

### 1. Capture-Phase Keyboard Interception
File: `js/multiplayer/main.js`

A high-priority `keydown` listener is attached to `window` with `useCapture: true`. This ensures it intercepts the event at the root before any DOM child or bubbling listeners can consume it:

```javascript
function handleCtrlWCapture(e) {
  const isW = (e.key === 'w' || e.key === 'W' || e.code === 'KeyW' || e.keyCode === 87);
  const isCtrlOrCmd = Boolean(e.ctrlKey || e.metaKey);

  if (isCtrlOrCmd && isW) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }
    console.log('[INPUT GUARD] Intercepted Ctrl+W / Cmd+W in capture phase (prevented default & propagation)');
    return false;
  }
}

window.addEventListener('keydown', handleCtrlWCapture, true);
```

### 2. Dynamic `beforeunload` Session Safeguard
File: `js/multiplayer/main.js`

A `beforeunload` listener is attached dynamically **only** when actively connected to a room (`onRoomJoined`), preventing annoying prompts when navigating the lobby or leaving intentionally:

```javascript
let isUnloadGuardActive = false;

function beforeUnloadHandler(e) {
  if (isGameActive && mpManager?.network?.isConnected) {
    e.preventDefault();
    const msg = 'You are currently in an active multiplayer session. Are you sure you want to disconnect?';
    e.returnValue = msg;
    return msg;
  }
}

function enableUnloadGuard() {
  if (isUnloadGuardActive) return;
  window.addEventListener('beforeunload', beforeUnloadHandler);
  isUnloadGuardActive = true;
}

function disableUnloadGuard() {
  if (!isUnloadGuardActive) return;
  window.removeEventListener('beforeunload', beforeUnloadHandler);
  isUnloadGuardActive = false;
}
```

### 3. Intentional Exit Handling
File: `multiplayer.html` and `js/multiplayer/main.js`

- Added `#btn-leave-room` inside `#hud-topbar`.
- Wired both the Leave button and `.back-link` (&larr; Return to Story Mode) to `leaveMultiplayerSession()`.
- Disables the unload guard prior to disconnecting, cleanly restoring the lobby or navigating to `index.html` without prompt.

---

## Browser Behavior & Reserved Accelerators

### OS and Browser Limitations
- Desktop browsers (Chromium, Firefox, Safari) reserve certain OS-level window accelerators (such as `Ctrl+W`, `Ctrl+Shift+W`, `Ctrl+Q`) for user security to prevent malicious pages from indefinitely trapping users.
- In JavaScript DOM dispatch, `e.preventDefault()` successfully intercepts the event. However, native browser application UI may still process the accelerator if pressed physically by the user.
- The standard `beforeunload` dialog provides the authoritative fallback: when triggered while in an active room, the browser pauses tab closure and prompts the user to confirm before disconnecting, preventing inadvertent closure while sprinting or crouching forward.

---

## Verification Summary

Tested with automated headless Chromium suite (`scratch/verify_ctrl_w_prevention.js`):
1. **Lobby State**: Unload guard inactive (`guardActive: false`, `defaultPrevented: false`).
2. **Room Gameplay**: Unload guard active (`guardActive: true`, `defaultPrevented: true`).
3. **Capture Interception**: Synthetic `Ctrl+W` and `Cmd+W` intercepted (`defaultPrevented: true`).
4. **Controls Unaffected**: `W`, `A`, `S`, `D`, `Space`, `Shift` pass unhindered (`defaultPrevented: false`).
5. **Inventory Shortcut**: `Tab` toggles inventory modal cleanly and suppresses weapon fire.
6. **Intentional Leave**: `#btn-leave-room` deactivates guard and restores lobby without unload confirmation.
7. **Story Mode Return**: `.back-link` navigates to `/index.html` cleanly without confirmation prompt.
