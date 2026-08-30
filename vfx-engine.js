/* ============================================================
   CUSTOM VFX ENGINE  (vfx-engine.js)  —  v2, extended edition
   A from-scratch particle / floating-text / screen-shake system.
   Nothing here wraps a library — every behavior is hand-written:

   - Weighted archetype registry (spark / ember / shard / dust /
     smoke), each with its own physics profile and render pass.
   - Motion trails per-particle (short position history, drawn
     as fading segments instead of a single dot).
   - Additive-glow layer for sparks/embers so bursts feel hot.
   - Procedural shockwave rings + chromatic-fringe pop text.
   - Eased screen shake (decays smoothly instead of a hard cutoff).
   - Time-based (delta-independent) integration so behavior stays
     consistent even if frame rate dips.
   ============================================================ */

class VFXEngine {
  constructor() {
    this.particles = [];
    this.floatingTexts = [];
    this.shockwaves = [];

    this.shakeDuration = 0;
    this.shakeMaxDuration = 1;
    this.shakeMagnitude = 0;

    this._lastTime = performance.now();

    this.archetypes = {
      spark: {
        weight: 0.28,
        factory: (x, y, color) => this._baseParticle(x, y, color, {
          gravity: 0.10,
          drag: 0.92,
          bounce: 0.15,
          size: 2 + Math.random() * 1.5,
          speedMin: 4,
          speedMax: 10,
          vyBoost: -3.2,
          decayMin: 0.028,
          decayMax: 0.055,
          trail: true,
          trailLength: 6,
          glow: true
        }),
        integrate: (p, dt) => {
          p.vx += Math.sin(p.age * 24 * p.wobbleFreq) * p.wobbleAmp * 0.12 * dt;
        },
        render: (ctx, p) => this._renderSpark(ctx, p)
      },

      ember: {
        weight: 0.20,
        factory: (x, y, color) => this._baseParticle(x, y, color, {
          gravity: 0.06,
          drag: 0.965,
          bounce: 0.45,
          size: 2 + Math.random() * 2.5,
          speedMin: 1,
          speedMax: 4,
          vyBoost: -1.6,
          decayMin: 0.012,
          decayMax: 0.02,
          trail: false,
          glow: true
        }),
        integrate: (p, dt) => {
          p.vx += Math.sin(p.age * 20 * p.wobbleFreq) * p.wobbleAmp * 0.1 * dt;
          p.flicker = 0.6 + Math.random() * 0.4;
        },
        render: (ctx, p) => this._renderEmber(ctx, p)
      },

      shard: {
        weight: 0.28,
        factory: (x, y, color) => this._baseParticle(x, y, color, {
          gravity: 0.28,
          drag: 0.965,
          bounce: 0.5,
          size: 3 + Math.floor(Math.random() * 3),
          speedMin: 1.5,
          speedMax: 6.5,
          vyBoost: -1.5,
          decayMin: 0.014,
          decayMax: 0.03,
          trail: false,
          glow: false,
          spins: true
        }),
        integrate: (p, dt) => { p.rot += p.vRot * dt; },
        render: (ctx, p) => this._renderShard(ctx, p)
      },

      dust: {
        weight: 0.14,
        factory: (x, y, color) => this._baseParticle(x, y, color, {
          gravity: -0.01,
          drag: 0.985,
          bounce: 0,
          size: 4 + Math.random() * 4,
          speedMin: 0.3,
          speedMax: 1.4,
          vyBoost: -0.4,
          decayMin: 0.008,
          decayMax: 0.016,
          trail: false,
          glow: false
        }),
        integrate: (p, dt) => {
          p.vx += Math.sin(p.age * 6 * p.wobbleFreq) * p.wobbleAmp * 0.05 * dt;
        },
        render: (ctx, p) => this._renderDust(ctx, p)
      },

      smoke: {
        weight: 0.10,
        factory: (x, y, color) => this._baseParticle(x, y, color, {
          gravity: -0.03,
          drag: 0.975,
          bounce: 0,
          size: 6 + Math.random() * 6,
          speedMin: 0.2,
          speedMax: 1.2,
          vyBoost: -0.8,
          decayMin: 0.006,
          decayMax: 0.012,
          trail: false,
          glow: false,
          growth: 0.035
        }),
        integrate: (p, dt) => { p.size += p.growth * dt; },
        render: (ctx, p) => this._renderSmoke(ctx, p)
      }
    };

    this.archetypeKeys = Object.keys(this.archetypes);
  }

  _baseParticle(x, y, color, cfg) {
    const angle = Math.random() * Math.PI * 2;
    const speed = cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin);
    return {
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed + cfg.vyBoost,
      gravity: cfg.gravity,
      drag: cfg.drag,
      bounce: cfg.bounce,
      size: cfg.size,
      baseSize: cfg.size,
      color: color,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.35,
      wobbleFreq: 0.1 + Math.random() * 0.25,
      wobbleAmp: Math.random() * 0.8,
      flicker: 1,
      growth: cfg.growth || 0,
      life: 1.0,
      age: 0,
      decay: cfg.decayMin + Math.random() * (cfg.decayMax - cfg.decayMin),
      trail: !!cfg.trail,
      trailLength: cfg.trailLength || 0,
      trailPts: [],
      glow: !!cfg.glow
    };
  }

  _rollArchetype() {
    const r = Math.random();
    let acc = 0;
    for (const key of this.archetypeKeys) {
      acc += this.archetypes[key].weight;
      if (r < acc) return key;
    }
    return this.archetypeKeys[this.archetypeKeys.length - 1];
  }

  triggerShake(magnitude = 2, duration = 12) {
    this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
    this.shakeMaxDuration = Math.max(this.shakeMaxDuration, duration);
  }

  createPixelExplosion(x, y, color) {
    const count = 40 + Math.floor(Math.random() * 20);
    for (let i = 0; i < count; i++) {
      const key = this._rollArchetype();
      const archetype = this.archetypes[key];
      const p = archetype.factory(x, y, color);
      p.type = key;
      this.particles.push(p);
    }
    this.shockwaves.push({
      x, y,
      radius: 2,
      maxRadius: 30 + Math.random() * 12,
      life: 1.0,
      decay: 0.05,
      color
    });
  }

  addFloatingText(text, x, y, color = '#ffea00') {
    this.floatingTexts.push({
      text: text,
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -3.2,
      scale: 0.15,
      targetScale: 1.0,
      overshoot: 0,
      life: 1.0,
      decay: 0.013,
      color: color,
      wobblePhase: Math.random() * Math.PI * 2
    });
  }

  update(canvas) {
    const now = performance.now();
    let dt = (now - this._lastTime) / (1000 / 60);
    dt = Math.max(0.1, Math.min(dt, 3));
    this._lastTime = now;

    if (this.shakeDuration > 0) {
      this.shakeDuration -= dt;
      if (this.shakeDuration < 0) this.shakeDuration = 0;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const archetype = this.archetypes[p.type];

      if (p.trail) {
        p.trailPts.push({ x: p.x, y: p.y });
        if (p.trailPts.length > p.trailLength) p.trailPts.shift();
      }

      p.vx *= Math.pow(p.drag, dt);
      p.vy *= Math.pow(p.drag, dt);
      p.vy += p.gravity * dt;

      if (archetype) archetype.integrate(p, dt);

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.y >= canvas.height - p.size) {
        p.y = canvas.height - p.size;
        p.vy = -p.vy * p.bounce;
        p.vx *= 0.65;
      }
      if (p.x <= 0 || p.x >= canvas.width - p.size) {
        p.vx = -p.vx * p.bounce;
        p.x = Math.max(0, Math.min(canvas.width - p.size, p.x));
      }

      p.age += 0.016 * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.x += (ft.vx + Math.sin(ft.life * 12 + ft.wobblePhase) * 0.35) * dt;
      ft.y += ft.vy * dt;
      ft.vy *= Math.pow(0.93, dt);

      if (ft.scale < ft.targetScale) {
        const diff = ft.targetScale - ft.scale;
        ft.scale += diff * 0.4 * dt;
        if (ft.targetScale - ft.scale < 0.05 && ft.overshoot < 1) {
          ft.overshoot = 1;
          ft.scale = ft.targetScale * 1.08;
        }
      } else if (ft.scale > ft.targetScale) {
        ft.scale += (ft.targetScale - ft.scale) * 0.25 * dt;
      }

      ft.life -= ft.decay * dt;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.radius += (s.maxRadius - s.radius) * 0.25 * dt;
      s.life -= s.decay * dt;
      if (s.life <= 0) this.shockwaves.splice(i, 1);
    }
  }

  getShakeOffset() {
    if (this.shakeDuration <= 0) return { x: 0, y: 0 };
    const t = this.shakeDuration / this.shakeMaxDuration;
    const eased = t * t;
    const mag = this.shakeMagnitude * eased;
    return {
      x: Math.floor((Math.random() - 0.5) * mag * 2),
      y: Math.floor((Math.random() - 0.5) * mag * 2)
    };
  }

  renderShockwaves(ctx) {
    this.shockwaves.forEach(s => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life * 0.5);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  }

  renderParticles(ctx) {
    this.particles.forEach(p => {
      const archetype = this.archetypes[p.type];
      if (archetype && archetype.render) archetype.render(ctx, p);
    });
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
  }

  _renderSpark(ctx, p) {
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const size = Math.max(1, p.size * Math.min(1, p.life * 1.3));

    if (p.trail && p.trailPts.length > 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < p.trailPts.length - 1; i++) {
        const t = i / p.trailPts.length;
        ctx.globalAlpha = Math.max(0, p.life) * t * 0.5;
        ctx.fillStyle = p.color;
        const pt = p.trailPts[i];
        ctx.fillRect(Math.floor(pt.x), Math.floor(pt.y), Math.max(1, size * t), Math.max(1, size * t));
      }
      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px, py, size, size);
    ctx.fillStyle = p.color;
    ctx.fillRect(px - 1, py, 1, size);
    ctx.fillRect(px + size, py, 1, size);
    ctx.restore();
  }

  _renderEmber(ctx, p) {
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const size = Math.max(1, p.size * Math.min(1, p.life * 1.2));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life)) * p.flicker;
    ctx.fillStyle = p.color;
    ctx.fillRect(px, py, size, size);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life)) * p.flicker * 0.4;
    ctx.fillRect(px - 1, py - 1, size + 2, size + 2);
    ctx.restore();
  }

  _renderShard(ctx, p) {
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const size = Math.max(1, Math.floor(p.size * Math.min(1, p.life * 1.2)));

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.translate(px + size / 2, py + size / 2);
    ctx.rotate(p.rot);

    ctx.fillStyle = p.color;
    ctx.fillRect(-size / 2, -size / 2, size, size);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(-size / 2, -size / 2, Math.max(1, size - 1), 1);
    ctx.fillRect(-size / 2, -size / 2, 1, Math.max(1, size - 1));

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(-size / 2, size / 2 - 1, size, 1);
    ctx.fillRect(size / 2 - 1, -size / 2, 1, size);
    ctx.restore();
  }

  _renderDust(ctx, p) {
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const size = p.size;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life)) * 0.35;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(px, py, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _renderSmoke(ctx, p) {
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const size = p.size;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life)) * 0.25;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, size);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  renderFloatingTexts(ctx) {
    this.floatingTexts.forEach(ft => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, ft.life));
      ctx.translate(Math.floor(ft.x), Math.floor(ft.y));
      ctx.scale(ft.scale, ft.scale);

      ctx.font = '900 13px "Courier New", Courier, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = '#000000';
      ctx.fillText(ft.text, 2, 2);
      ctx.fillText(ft.text, 2, 3);

      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(0, Math.min(1, ft.life)) * 0.5;
      ctx.fillStyle = 'rgba(255,0,80,0.6)';
      ctx.fillText(ft.text, -1, 0);
      ctx.fillStyle = 'rgba(0,200,255,0.6)';
      ctx.fillText(ft.text, 1, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.max(0, Math.min(1, ft.life));

      ctx.fillStyle = '#000000';
      ctx.fillText(ft.text, -1, 0);
      ctx.fillText(ft.text, 1, 0);
      ctx.fillText(ft.text, 0, -1);
      ctx.fillText(ft.text, 0, 1);

      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, 0, 0);

      ctx.restore();
    });
  }
}
