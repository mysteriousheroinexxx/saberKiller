// Smooth Remote Player Snapshot Interpolation
// Buffers incoming network transform packets and applies linear / spherical interpolation

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

export class TransformInterpolator {
  constructor(options = {}) {
    this.buffer = [];
    this.interpolationDelay = options.interpolationDelay || 80; // 80ms render delay (~1.5 packet cycles at 20Hz)
    this.currentPos = { x: 0, y: 0, z: 0 };
    this.currentYaw = 0;
    this.currentPitch = 0;
    this.currentWeapon = 0;
    this.initialized = false;
  }

  clear() {
    this.buffer = [];
    this.initialized = false;
  }

  pushSnapshot(snapshot) {
    const time = snapshot.timestamp || Date.now();
    this.buffer.push({
      time,
      x: snapshot.x,
      y: snapshot.y,
      z: snapshot.z,
      yaw: snapshot.yaw,
      pitch: snapshot.pitch,
      weapon: snapshot.weapon ?? 0
    });

    if (!this.initialized) {
      this.currentPos.x = snapshot.x;
      this.currentPos.y = snapshot.y;
      this.currentPos.z = snapshot.z;
      this.currentYaw = snapshot.yaw;
      this.currentPitch = snapshot.pitch;
      this.currentWeapon = snapshot.weapon ?? 0;
      this.initialized = true;
    }

    // Keep buffer bounded (last 20 snapshots)
    if (this.buffer.length > 20) {
      this.buffer.shift();
    }
  }

  update(dt) {
    if (!this.initialized || this.buffer.length === 0) return this.getCurrentState();

    const renderTime = Date.now() - this.interpolationDelay;

    // Remove obsolete older snapshots, keeping at least 2 for interpolation
    while (this.buffer.length > 2 && this.buffer[1].time <= renderTime) {
      this.buffer.shift();
    }

    if (this.buffer.length >= 2 && this.buffer[0].time <= renderTime && renderTime <= this.buffer[1].time) {
      const p0 = this.buffer[0];
      const p1 = this.buffer[1];
      const totalSpan = p1.time - p0.time;
      const t = totalSpan > 0 ? Math.max(0, Math.min(1, (renderTime - p0.time) / totalSpan)) : 1.0;

      this.currentPos.x = lerp(p0.x, p1.x, t);
      this.currentPos.y = lerp(p0.y, p1.y, t);
      this.currentPos.z = lerp(p0.z, p1.z, t);
      this.currentYaw = lerpAngle(p0.yaw, p1.yaw, t);
      this.currentPitch = lerp(p0.pitch, p1.pitch, t);
      this.currentWeapon = p1.weapon;
    } else {
      // If renderTime is ahead of the buffer (packet lag), extrapolate or catch up smoothly
      const latest = this.buffer[this.buffer.length - 1];
      const catchupFactor = Math.min(1.0, dt * 15.0);
      this.currentPos.x = lerp(this.currentPos.x, latest.x, catchupFactor);
      this.currentPos.y = lerp(this.currentPos.y, latest.y, catchupFactor);
      this.currentPos.z = lerp(this.currentPos.z, latest.z, catchupFactor);
      this.currentYaw = lerpAngle(this.currentYaw, latest.yaw, catchupFactor);
      this.currentPitch = lerp(this.currentPitch, latest.pitch, catchupFactor);
      this.currentWeapon = latest.weapon;
    }

    return this.getCurrentState();
  }

  getCurrentState() {
    return {
      x: this.currentPos.x,
      y: this.currentPos.y,
      z: this.currentPos.z,
      yaw: this.currentYaw,
      pitch: this.currentPitch,
      weapon: this.currentWeapon
    };
  }
}
