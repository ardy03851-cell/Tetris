/* ============================================================
   CUSTOM VFX ENGINE  (vfx-engine.js)
   A from-scratch particle / floating-text / screen-shake system.
   No external libraries — every behavior below is hand-written:
   archetypes are plain functions plugged into a small dispatch
   table, so new particle types can be added without touching
   the update/render core.
   ============================================================ */

class VFXEngine {
    constructor() {
        this.particles = [];
        this.floatingTexts = [];
        this.shakeDuration = 0;
        this.shakeMagnitude = 0;

        // Archetype registry: each entry defines how a particle of
        // that type is spawned (factory) and how it steps forward
        // in time (integrate). Adding a new FX type later = adding
        // one more entry here, nothing else in the engine changes.
        this.archetypes = {
            spark: {
                weight: 0.35,
                factory: (x, y, color) => this._baseParticle(x, y, color, {
                    gravity: 0.12,
                    drag: 0.93,
                    bounce: 0.2,
                    size: 10,
                    vyBoost: -3.0,
                    decayMin: 0.03,
                    decayMax: 0.07
                }),
                integrate: (p) => { p.vx += Math.sin(p.life * 20 * p.wobbleFreq) * p.wobbleAmp * 0.1; }
            },
            ember: {
                weight: 0.30,
                factory: (x, y, color) => this._baseParticle(x, y, color, {
                    gravity: 0.08,
                    drag: 0.96,
                    bounce: 0.55,
                    size: Math.floor(Math.random() * 2) + 2,
                    vyBoost: -1.5,
                    decayMin: 0.015,
                    decayMax: 0.035
                }),
                integrate: (p) => { p.vx += Math.sin(p.life * 20 * p.wobbleFreq) * p.wobbleAmp * 0.1; }
            },
            block: {
                weight: 0.35,
                factory: (x, y, color) => this._baseParticle(x, y, color, {
                    gravity: 0.26,
                    drag: 0.96,
                    bounce: 0.55,
                    size: Math.floor(Math.random() * 3) + 3,
                    vyBoost: -1.5,
                    decayMin: 0.015,
                    decayMax: 0.035
                }),
                integrate: () => { } // rigid shard, no wobble
            }
        };
    }

    /* ---------- shared particle construction helper ---------- */
    _baseParticle(x, y, color, cfg) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 6.5;
        return {
            x: x + (Math.random() - 0.5) * 8,
            y: y + (Math.random() - 0.5) * 8,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed + cfg.vyBoost,
            gravity: cfg.gravity,
            drag: cfg.drag,
            bounce: cfg.bounce,
            size: cfg.size,
            color: color,
            vRot: (Math.random() - 0.5) * 0.3,
            wobbleFreq: 0.1 + Math.random() * 0.2,
            wobbleAmp: Math.random() * 0.8,
            life: 1.0,
            decay: cfg.decayMin + Math.random() * (cfg.decayMax - cfg.decayMin)
        };
    }

    /* ---------- picks an archetype key by its weight ---------- */
    _rollArchetype() {
        const r = Math.random();
        let acc = 0;
        const keys = Object.keys(this.archetypes);
        for (const key of keys) {
            acc += this.archetypes[key].weight;
            if (r < acc) return key;
        }
        return keys[keys.length - 1];
    }

    /* ---------- public API ---------- */

    triggerShake(magnitude = 2, duration = 12) {
        this.shakeMagnitude = magnitude;
        this.shakeDuration = duration;
    }

    createPixelExplosion(x, y, color) {
        const count = 35 + Math.floor(Math.random() * 15);
        for (let i = 0; i < count; i++) {
            const key = this._rollArchetype();
            const archetype = this.archetypes[key];
            const p = archetype.factory(x, y, color);
            p.type = key;
            this.particles.push(p);
        }
    }

    addFloatingText(text, x, y, color = '#ffea00') {
        this.floatingTexts.push({
            text: text,
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 0.8,
            vy: -3.2,
            scale: 0.2,
            targetScale: 1.0,
            life: 1.0,
            decay: 0.014,
            color: color,
            wobblePhase: Math.random() * Math.PI * 2
        });
    }

    update(canvas) {
        if (this.shakeDuration > 0) this.shakeDuration--;

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            const archetype = this.archetypes[p.type];

            p.vx *= p.drag;
            p.vy *= p.drag;
            p.vy += p.gravity;

            if (archetype) archetype.integrate(p);

            p.x += p.vx;
            p.y += p.vy;

            if (p.y >= canvas.height - p.size) {
                p.y = canvas.height - p.size;
                p.vy = -p.vy * p.bounce;
                p.vx *= 0.65;
            }
            if (p.x <= 0 || p.x >= canvas.width - p.size) {
                p.vx = -p.vx * p.bounce;
                p.x = Math.max(0, Math.min(canvas.width - p.size, p.x));
            }

            p.life -= p.decay;
            if (p.life <= 0) this.particles.splice(i, 1);
        }

        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.x += ft.vx + Math.sin(ft.life * 12 + ft.wobblePhase) * 0.35;
            ft.y += ft.vy;
            ft.vy *= 0.93;

            if (ft.scale < ft.targetScale) {
                ft.scale += (ft.targetScale - ft.scale) * 0.35;
            }

            ft.life -= ft.decay;
            if (ft.life <= 0) this.floatingTexts.splice(i, 1);
        }
    }

    /* ---------- rendering ---------- */

    renderParticles(ctx) {
        this.particles.forEach(p => {
            const px = Math.floor(p.x);
            const py = Math.floor(p.y);
            const currentSize = Math.max(1, Math.floor(p.size * Math.min(1, p.life * 1.2)));
            ctx.globalAlpha = Math.max(0, Math.min(1, p.life));

            if (p.type === 'spark') {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(px, py, currentSize, currentSize);
                ctx.fillStyle = p.color;
                ctx.fillRect(px - 1, py, 1, currentSize);
                ctx.fillRect(px + currentSize, py, 1, currentSize);
            } else if (p.type === 'ember') {
                ctx.fillStyle = p.color;
                ctx.fillRect(px, py, currentSize, currentSize);
            } else {
                ctx.fillStyle = p.color;
                ctx.fillRect(px, py, currentSize, currentSize);

                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.fillRect(px, py, Math.max(1, currentSize - 1), 1);
                ctx.fillRect(px, py, 1, Math.max(1, currentSize - 1));

                ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
                ctx.fillRect(px, py + currentSize - 1, currentSize, 1);
                ctx.fillRect(px + currentSize - 1, py, 1, currentSize);
            }
        });
        ctx.globalAlpha = 1.0;
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
