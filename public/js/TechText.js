const LABEL_FONT = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const FALLOFF_STEPS = 8;
const SPRING = 320;
const DAMPING = 22;

const approach = (current, target, dt, seconds) => current + (target - current) * (1 - Math.exp(-dt / seconds));

const hexToRgb = hex => {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.replace(/./g, c => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? [255, 255, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgba = (hex, alpha) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const noise = (...values) => {
  let h = 2166136261;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
};

const signed = value => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0');

export default class TechText {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      text: 'React Bits',
      fontFamily: '',
      fontWeight: 600,
      fontSize: 150,
      letterSpacing: -0.05,
      color: '#ffffff',
      accentColor: '#ffffff',
      reach: 200,
      softness: 0.7,
      dashLength: 4,
      dashGap: 2,
      strokeWidth: 1.5,
      lineStyle: 'dashed',
      reveal: 'letter',
      specks: 15,
      selection: true,
      labels: true,
      draggable: true,
      sweep: true,
      speed: 1,
      ...options
    };

    this.init();
  }

  init() {
    const s = this.options;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tech-text-canvas';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    
    this.scratch = document.createElement('canvas');
    this.scratchCtx = this.scratch.getContext('2d');
    
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.raf = 0;
    this.last = performance.now();
    this.visible = true;
    this.alive = true;
    this.layoutKey = '';
    this.requestedFont = '';
    this.word = null;
    this.glyphs = [];
    this.presence = 0;
    this.clock = 0;
    this.pulse = 0;
    this.placed = false;
    this.dragging = -1;
    
    this.pointer = { x: 0, y: 0, inside: false };
    this.grab = { x: 0, y: 0 };
    this.lens = { x: 0, y: 0 };
    this.frame = { x1: 0, y1: 0, x2: 0, y2: 0, alpha: 0, index: -1 };

    this.refreshFonts = () => {
      this.layoutKey = '';
      this.wake();
    };

    this.bindEvents();
    this.resize();
  }

  family(s) {
    return s.fontFamily || getComputedStyle(this.container).fontFamily || 'sans-serif';
  }

  fontFor(s, size) {
    return `${s.fontWeight} ${size}px ${this.family(s)}`;
  }

  setFont(target, s, size) {
    target.font = this.fontFor(s, size);
    if ('letterSpacing' in target) target.letterSpacing = `${s.letterSpacing * size}px`;
    target.textAlign = 'left';
    target.textBaseline = 'alphabetic';
  }

  sprite(s, view, glyph, stroke) {
    const pad = Math.ceil(s.strokeWidth * 2 + 4);
    const left = glyph.box.x1 - pad;
    const top = glyph.box.y1 - pad;
    const w = glyph.box.x2 - glyph.box.x1 + pad * 2;
    const h = glyph.box.y2 - glyph.box.y1 + pad * 2;
    const image = document.createElement('canvas');
    image.width = Math.max(1, Math.ceil(w * this.dpr));
    image.height = Math.max(1, Math.ceil(h * this.dpr));
    const c = image.getContext('2d');
    if (!c) return { image, left, top };
    c.setTransform(this.dpr, 0, 0, this.dpr, -left * this.dpr, -top * this.dpr);
    this.setFont(c, s, view.size);
    if (stroke) {
      c.lineJoin = 'round';
      c.lineWidth = s.strokeWidth * 2;
      c.lineCap = 'butt';
      c.strokeStyle = s.color;
      if (s.lineStyle !== 'solid') c.setLineDash([Math.max(1, s.dashLength), Math.max(1, s.dashGap)]);
      c.strokeText(glyph.char, glyph.x, view.baseline);
      c.setLineDash([]);
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000000';
      c.fillText(glyph.char, glyph.x, view.baseline);
      c.globalCompositeOperation = 'source-over';
    } else {
      c.fillStyle = s.color;
      c.fillText(glyph.char, glyph.x, view.baseline);
    }
    return { image, left, top };
  }

  ensureLayout(s) {
    const key = [
      s.text,
      this.family(s),
      s.fontWeight,
      s.fontSize,
      s.letterSpacing,
      s.color,
      s.dashLength,
      s.dashGap,
      s.strokeWidth,
      s.lineStyle,
      this.width,
      this.height,
      this.dpr
    ].join('|');
    if (key === this.layoutKey && this.word) return this.word;
    this.layoutKey = key;
    const wanted = this.fontFor(s, 64);
    if (document.fonts && wanted !== this.requestedFont) {
      this.requestedFont = wanted;
      document.fonts.load(wanted, s.text).then(this.refreshFonts, this.refreshFonts);
    }

    const probe = this.scratchCtx;
    this.setFont(probe, s, s.fontSize);
    let m = probe.measureText(s.text);
    const fit = Math.min(
      1,
      (this.width * 0.9) / Math.max(m.actualBoundingBoxLeft + m.actualBoundingBoxRight, 1),
      (this.height * 0.66) / Math.max(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, 1)
    );
    const size = s.fontSize * fit;
    this.setFont(probe, s, size);
    m = probe.measureText(s.text);
    const inkWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const inkHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const x = (this.width - inkWidth) / 2 + m.actualBoundingBoxLeft;
    const baseline = (this.height - inkHeight) / 2 + m.actualBoundingBoxAscent;
    const next = {
      size,
      baseline,
      left: x - m.actualBoundingBoxLeft,
      right: x + m.actualBoundingBoxRight,
      top: baseline - m.actualBoundingBoxAscent,
      bottom: baseline + m.actualBoundingBoxDescent
    };
    this.word = next;

    const chars = Array.from(s.text);
    const previous = this.glyphs;
    this.glyphs = [];
    let prefix = '';
    chars.forEach((char, i) => {
      prefix += char;
      const own = probe.measureText(char);
      const gx = x + probe.measureText(prefix).width - own.width;
      if (!char.trim()) return;
      const base = {
        char,
        x: gx,
        box: {
          x1: gx - own.actualBoundingBoxLeft,
          y1: baseline - own.actualBoundingBoxAscent,
          x2: gx + own.actualBoundingBoxRight,
          y2: baseline + own.actualBoundingBoxDescent
        }
      };
      const kept = previous[this.glyphs.length];
      this.glyphs.push({
        ...base,
        offset: kept?.char === char ? kept.offset : { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        outline: 0,
        index: i,
        fill: this.sprite(s, next, base, false),
        dashes: this.sprite(s, next, base, true)
      });
    });
    this.dragging = -1;
    this.frame.index = -1;
    return next;
  }

  glyphAt(x, y) {
    if (!this.word || y < this.word.top - 24 || y > this.word.bottom + 24) return -1;
    let best = -1;
    let bestDistance = Infinity;
    this.glyphs.forEach((glyph, i) => {
      const x1 = glyph.box.x1 + glyph.offset.x;
      const x2 = glyph.box.x2 + glyph.offset.x;
      const d = x < x1 ? x1 - x : x > x2 ? x - x2 : 0;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    return bestDistance < 28 ? best : -1;
  }

  falloff(target, cx, cy, radius, strength, softness) {
    const inner = Math.min(1, Math.max(0, 1 - softness));
    const gradient = target.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `rgba(0, 0, 0, ${strength})`);
    if (inner > 0.995) {
      gradient.addColorStop(0.995, `rgba(0, 0, 0, ${strength})`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      return gradient;
    }
    for (let i = 0; i <= FALLOFF_STEPS; i++) {
      const t = i / FALLOFF_STEPS;
      const eased = t * t * (3 - 2 * t);
      gradient.addColorStop(inner + (1 - inner) * t, `rgba(0, 0, 0, ${strength * (1 - eased)})`);
    }
    return gradient;
  }

  blit(target, art, dx, dy, originX, originY) {
    target.drawImage(
      art.image,
      Math.round((art.left + dx) * this.dpr - originX),
      Math.round((art.top + dy) * this.dpr - originY)
    );
  }

  drawReveal(s) {
    const radius = s.reach * this.dpr;
    const cx = this.lens.x * this.dpr;
    const cy = this.lens.y * this.dpr;
    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.fillStyle = this.falloff(this.ctx, cx, cy, radius, this.presence, s.softness);
    this.ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    this.ctx.globalCompositeOperation = 'source-over';

    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.canvas.width, Math.ceil(cx + radius));
    const y1 = Math.min(this.canvas.height, Math.ceil(cy + radius));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0;
    const h = y1 - y0;
    if (this.scratch.width < w || this.scratch.height < h) {
      this.scratch.width = Math.max(this.scratch.width, w);
      this.scratch.height = Math.max(this.scratch.height, h);
    }
    this.scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.scratchCtx.globalCompositeOperation = 'source-over';
    this.scratchCtx.clearRect(0, 0, w, h);
    for (const glyph of this.glyphs) this.blit(this.scratchCtx, glyph.dashes, glyph.offset.x, glyph.offset.y, x0, y0);
    this.scratchCtx.globalCompositeOperation = 'destination-in';
    this.scratchCtx.fillStyle = this.falloff(this.scratchCtx, cx - x0, cy - y0, radius, 1, s.softness);
    this.scratchCtx.fillRect(0, 0, w, h);
    this.scratchCtx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = this.presence;
    this.ctx.drawImage(this.scratch, 0, 0, w, h, x0, y0, w, h);
    this.ctx.globalAlpha = 1;
  }

  crisp(value) {
    return (Math.round(value * this.dpr) + 0.5) / this.dpr;
  }

  perimeterPoint(distance, w, h) {
    let d = ((distance % (2 * (w + h))) + 2 * (w + h)) % (2 * (w + h));
    if (d < w) return [this.frame.x1 + d, this.frame.y1, 0, -1];
    d -= w;
    if (d < h) return [this.frame.x2, this.frame.y1 + d, 1, 0];
    d -= h;
    if (d < w) return [this.frame.x2 - d, this.frame.y2, 0, 1];
    d -= w;
    return [this.frame.x1, this.frame.y2 - d, -1, 0];
  }

  drawSpecks(s, a) {
    const w = this.frame.x2 - this.frame.x1;
    const h = this.frame.y2 - this.frame.y1;
    if (w < 2 || h < 2) return;
    const perimeter = 2 * (w + h);
    const seed = this.frame.index + 1;
    const grid = 3;

    for (let k = 0; k < s.specks; k++) {
      const period = 0.5 + noise(seed, k, 11) * 1.2;
      const t = this.pulse / period + noise(seed, k, 17);
      const cycle = Math.floor(t);
      const life = t - cycle;
      if (life > 0.7) continue;
      const [px, py, nx, ny] = this.perimeterPoint(noise(seed, k, cycle) * perimeter, w, h);
      const pick = noise(seed, k, cycle, 2);
      const size = pick < 0.46 ? 2 : pick < 0.7 ? 3 : pick < 0.84 ? 5 : pick < 0.94 ? 8 : 11;
      const large = size >= 8;
      const out = (large ? 9 : 4) + Math.floor(noise(seed, k, cycle, 1) * 5) * grid;
      const x = this.frame.x1 + Math.round((px + nx * out - this.frame.x1) / grid) * grid;
      const y = this.frame.y1 + Math.round((py + ny * out - this.frame.y1) / grid) * grid;
      const tone = noise(seed, k, cycle, 3);
      const blink = life < 0.06 || (life > 0.32 && life < 0.36) ? 0.35 : 1;
      const alpha = a * (large ? 0.3 + 0.4 * tone : 0.3 + 0.6 * tone) * blink;
      const left = Math.round(x - size / 2);
      const top = Math.round(y - size / 2);
      if (tone < 0.26 || (large && tone < 0.78)) {
        this.ctx.strokeStyle = rgba(s.accentColor, alpha);
        this.ctx.strokeRect(left + 0.5, top + 0.5, size, size);
        if (large && tone > 0.5) {
          this.ctx.fillStyle = rgba(s.accentColor, alpha);
          this.ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
        }
      } else {
        this.ctx.fillStyle = rgba(s.accentColor, alpha);
        this.ctx.fillRect(left, top, size, size);
      }
    }

    for (let j = 0; j < 2; j++) {
      const head = (this.pulse * 0.42 * s.speed + j * 0.5) * perimeter;
      for (let i = 0; i < 4; i++) {
        const [x, y] = this.perimeterPoint(head - i * 6, w, h);
        const size = i === 0 ? 3 : 2;
        this.ctx.fillStyle = rgba(s.accentColor, a * [0.95, 0.55, 0.32, 0.16][i]);
        this.ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
      }
    }
  }

  drawFrame(s) {
    const glyph = this.glyphs[this.frame.index];
    if (!glyph || this.frame.alpha < 0.01) return;
    const a = this.frame.alpha;
    const x1 = this.crisp(this.frame.x1);
    const y1 = this.crisp(this.frame.y1);
    const x2 = this.crisp(this.frame.x2);
    const y2 = this.crisp(this.frame.y2);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const moved = Math.hypot(glyph.offset.x, glyph.offset.y);
    if (moved > 1) {
      const hx = (glyph.box.x1 + glyph.box.x2) / 2;
      const hy = (glyph.box.y1 + glyph.box.y2) / 2;
      this.ctx.beginPath();
      this.ctx.moveTo(hx, hy);
      this.ctx.lineTo(hx + glyph.offset.x, hy + glyph.offset.y);
      this.ctx.setLineDash([3, 4]);
      this.ctx.lineWidth = 1;
      this.ctx.strokeStyle = rgba(s.accentColor, 0.45 * a);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
      this.ctx.beginPath();
      this.ctx.rect(Math.round(hx) - 2, Math.round(hy) - 2, 4, 4);
      this.ctx.fillStyle = rgba(s.accentColor, 0.7 * a);
      this.ctx.fill();
    }

    this.ctx.beginPath();
    this.ctx.rect(x1, y1, x2 - x1, y2 - y1);
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = rgba(s.accentColor, 0.5 * a);
    this.ctx.stroke();

    this.ctx.beginPath();
    for (const [cx, cy] of [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2]
    ]) {
      this.ctx.rect(Math.round(cx) - 2, Math.round(cy) - 2, 5, 5);
    }
    this.ctx.fillStyle = rgba(s.accentColor, 0.95 * a);
    this.ctx.fill();

    if (s.specks > 0) {
      this.ctx.lineWidth = 1;
      this.drawSpecks(s, a);
    }

    if (!s.labels) return;
    this.ctx.font = LABEL_FONT;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'bottom';
    this.ctx.fillStyle = rgba(s.accentColor, 0.62 * a);
    const label =
      moved > 1
        ? `${signed(Math.round(glyph.offset.x))}, ${signed(Math.round(-glyph.offset.y))}`
        : `${glyph.char}  ${Math.round(glyph.box.x2 - glyph.box.x1)} × ${Math.round(glyph.box.y2 - glyph.box.y1)}`;
    this.ctx.fillText(label, Math.round(this.frame.x1), Math.round(this.frame.y1) - 7);
  }

  tick(now) {
    this.raf = 0;
    const s = this.options;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    const view = this.ensureLayout(s);

    const sweeping = s.sweep && !this.reducedMotion && !this.pointer.inside && this.dragging < 0;
    if (sweeping) this.clock += dt * s.speed;
    this.pulse += dt;
    let targetX = this.pointer.x;
    let targetY = this.pointer.y;
    if (sweeping) {
      targetX = view.left + (view.right - view.left) * (0.5 - 0.5 * Math.cos(this.clock * 0.45));
      targetY = view.top + (view.bottom - view.top) * (0.45 + 0.1 * Math.sin(this.clock * 0.8));
    }
    const active = this.pointer.inside || sweeping || this.dragging >= 0;
    if (active && !this.placed) {
      this.lens.x = targetX;
      this.lens.y = targetY;
    }
    if (active) {
      const lag = this.pointer.inside ? 0.05 : 0.22;
      this.lens.x = approach(this.lens.x, targetX, dt, lag);
      this.lens.y = approach(this.lens.y, targetY, dt, lag);
    }
    this.placed = active;
    this.presence = approach(this.presence, s.reveal === 'area' && active && this.dragging < 0 ? 1 : 0, dt, 0.16);

    let moving = false;
    this.glyphs.forEach((glyph, i) => {
      if (i === this.dragging) {
        glyph.offset.x = approach(glyph.offset.x, this.pointer.x - this.grab.x, dt, 0.03);
        glyph.offset.y = approach(glyph.offset.y, this.pointer.y - this.grab.y, dt, 0.03);
        glyph.velocity.x = 0;
        glyph.velocity.y = 0;
        moving = true;
        return;
      }
      const { offset, velocity } = glyph;
      if (Math.abs(offset.x) < 0.05 && Math.abs(offset.y) < 0.05 && Math.hypot(velocity.x, velocity.y) < 0.5) {
        offset.x = 0;
        offset.y = 0;
        velocity.x = 0;
        velocity.y = 0;
        return;
      }
      velocity.x += (-SPRING * offset.x - DAMPING * velocity.x) * dt;
      velocity.y += (-SPRING * offset.y - DAMPING * velocity.y) * dt;
      offset.x += velocity.x * dt;
      offset.y += velocity.y * dt;
      moving = true;
    });

    const focus = this.dragging >= 0 ? this.dragging : active ? this.glyphAt(this.lens.x, this.lens.y) : -1;
    if (focus >= 0 && s.selection) {
      const glyph = this.glyphs[focus];
      const bx1 = glyph.box.x1 + glyph.offset.x - 6;
      const by1 = glyph.box.y1 + glyph.offset.y - 6;
      const bx2 = glyph.box.x2 + glyph.offset.x + 6;
      const by2 = glyph.box.y2 + glyph.offset.y + 6;
      if (this.frame.index < 0 || this.frame.alpha < 0.02) {
        this.frame.x1 = bx1;
        this.frame.y1 = by1;
        this.frame.x2 = bx2;
        this.frame.y2 = by2;
      }
      const glide = focus === this.dragging ? 0.02 : 0.08;
      this.frame.x1 = approach(this.frame.x1, bx1, dt, glide);
      this.frame.y1 = approach(this.frame.y1, by1, dt, glide);
      this.frame.x2 = approach(this.frame.x2, bx2, dt, glide);
      this.frame.y2 = approach(this.frame.y2, by2, dt, glide);
      this.frame.index = focus;
    }
    this.frame.alpha = approach(this.frame.alpha, focus >= 0 && s.selection ? 1 : 0, dt, 0.1);

    this.glyphs.forEach((glyph, i) => {
      const target = s.reveal === 'letter' && i === focus && i !== this.dragging ? 1 : 0;
      glyph.outline = approach(glyph.outline, target, dt, 0.09);
      if (Math.abs(glyph.outline - target) > 0.002) moving = true;
      else glyph.outline = target;
    });

    if (s.draggable) this.container.style.cursor = this.dragging >= 0 ? 'grabbing' : focus >= 0 && this.pointer.inside ? 'grab' : '';

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const glyph of this.glyphs) {
      const moved = Math.hypot(glyph.offset.x, glyph.offset.y);
      if (moved > 1) {
        this.ctx.globalAlpha = Math.min(1, moved / 24) * 0.55;
        this.blit(this.ctx, glyph.dashes, 0, 0, 0, 0);
        this.ctx.globalAlpha = 1;
      }
    }
    for (const glyph of this.glyphs) {
      if (glyph.outline < 0.999) {
        this.ctx.globalAlpha = 1 - glyph.outline;
        this.blit(this.ctx, glyph.fill, glyph.offset.x, glyph.offset.y, 0, 0);
      }
      if (glyph.outline > 0.001) {
        this.ctx.globalAlpha = glyph.outline;
        this.blit(this.ctx, glyph.dashes, glyph.offset.x, glyph.offset.y, 0, 0);
      }
      this.ctx.globalAlpha = 1;
    }
    if (this.presence > 0.001) this.drawReveal(s);
    this.drawFrame(s);

    const settling =
      moving ||
      Math.abs(this.presence - (s.reveal === 'area' && active && this.dragging < 0 ? 1 : 0)) > 0.002 ||
      (this.frame.alpha > 0.01 && this.frame.alpha < 0.99);
    if ((active || settling) && this.visible && this.alive) this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  wake() {
    if (this.raf || !this.visible || !this.alive) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  resize() {
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.layoutKey = '';
    this.wake();
  }

  locate(e) {
    const rect = this.container.getBoundingClientRect();
    this.pointer.x = e.clientX - rect.left;
    this.pointer.y = e.clientY - rect.top;
  }

  bindEvents() {
    this.onMove = e => {
      this.locate(e);
      this.pointer.inside = true;
      this.wake();
    };
    this.onLeave = () => {
      if (this.dragging >= 0) return;
      this.pointer.inside = false;
      this.wake();
    };
    this.onDown = e => {
      this.locate(e);
      this.pointer.inside = true;
      const s = this.options;
      if (s?.draggable && (e.pointerType !== 'mouse' || e.button === 0)) {
        const index = this.glyphAt(this.pointer.x, this.pointer.y);
        if (index >= 0) {
          this.dragging = index;
          this.grab.x = this.pointer.x - this.glyphs[index].offset.x;
          this.grab.y = this.pointer.y - this.glyphs[index].offset.y;
          this.container.setPointerCapture?.(e.pointerId);
        }
      }
      this.wake();
    };
    this.onUp = e => {
      if (this.dragging >= 0) {
        this.dragging = -1;
        this.container.releasePointerCapture?.(e.pointerId);
        const rect = this.container.getBoundingClientRect();
        this.pointer.inside =
          e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      }
      this.wake();
    };

    this.container.addEventListener('pointermove', this.onMove, { passive: true });
    this.container.addEventListener('pointerenter', this.onMove, { passive: true });
    this.container.addEventListener('pointerdown', this.onDown, { passive: true });
    this.container.addEventListener('pointerup', this.onUp, { passive: true });
    this.container.addEventListener('pointercancel', this.onUp, { passive: true });
    this.container.addEventListener('pointerleave', this.onLeave, { passive: true });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.wake();
    });
    this.intersectionObserver.observe(this.container);
    
    if (document.fonts) document.fonts.ready.then(this.refreshFonts, this.refreshFonts);
  }

  destroy() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.container.removeEventListener('pointermove', this.onMove);
    this.container.removeEventListener('pointerenter', this.onMove);
    this.container.removeEventListener('pointerdown', this.onDown);
    this.container.removeEventListener('pointerup', this.onUp);
    this.container.removeEventListener('pointercancel', this.onUp);
    this.container.removeEventListener('pointerleave', this.onLeave);
    try {
      this.container.removeChild(this.canvas);
    } catch {}
  }
}
