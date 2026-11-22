# Saber Killer — Survival Mode HUD Icons

This directory contains the monochromatic, transparent icon assets used by the Survival Mode HUD in `multiplayer.html` (`js/multiplayer/sanity_hud.js`). Both scalable vector (`.svg`) and high-resolution raster (`.png`) formats are provided locally.

## Sourced Assets & Licenses

| Icon Assets | Source / Origin | Author / Project | License | Usage in HUD |
|---|---|---|---|---|
| `hud_brain.png` / `hud_brain.svg` | `brain` (MDI) | Pictogrammers (Austin Andrews et al.) | Apache License 2.0 | Sanity Indicator (authentic Budget-Backrooms brain graphic) |
| `hud_health.png` / `hud_health.svg` | `favorite` (Two-Tone) | Google Material Design Icons | Apache License 2.0 | Health Indicator (heart contour with translucent inner fill) |
| `hud_ammo.png` / `hud_ammo.svg` | `ammunition` (MDI) | Pictogrammers | Apache License 2.0 | Contextual Gun Equipment Indicator (Pistol / Shotgun ammo) |
| `hud_battery.png` / `hud_battery.svg` | `battery_full` (Two-Tone) | Google Material Design Icons | Apache License 2.0 | Contextual Torch Equipment Indicator (Flashlight battery charge) |
| `hud_stamina.png` / `hud_stamina.svg` | `directions_run` (Two-Tone) | Google Material Design Icons | Apache License 2.0 | Bottom-Center Stamina Bar runner icon |
| `hud_pause.png` / `hud_pause.svg` | `pause_circle` (Two-Tone) | Google Material Design Icons | Apache License 2.0 | Sanity Decay Paused pulsing indicator |

## Characteristics
- **Formats:** 
  - Native 96x96 transparent PNGs (`image/png`) with true alpha transparency (zero square background plate, zero rectangular artifacts).
  - Scalable Vector Graphics (`image/svg+xml`) with transparent background (`fill="none"` root with alpha-composited vector paths).
- **Monochromatic Styling:** Base off-white `#edece6` matching the aged Budget-Backrooms aesthetic (`rgba(237, 236, 230)`).
- **Two-Tone Depth:** Secondary accent fills rendered at `0.35` opacity with solid structural contours for visual clarity against both light and dark Backrooms geometry.
- **Local Storage:** All assets are stored locally in the project repository. Zero runtime external URL hotlinking.
- **Server Serving:** `server/index.js` explicitly defines `image/svg+xml` for `.svg` and `image/png` for `.png` to ensure full browser decoding compliance.
