import { Renderer, Program, Mesh, Triangle } from 'https://cdn.jsdelivr.net/npm/ogl/+esm';

const hexToRgb = hex => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255];
};

const detailToSteps = detail => {
  if (detail === 'low') return 40.0;
  if (detail === 'high') return 110.0;
  return 70.0;
};

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaveScale;
uniform float uWaveRatio;
uniform float uSwell;
uniform float uTurbulence;
uniform float uTilt;
uniform float uZoom;
uniform float uHeight;
uniform float uFogDepth;
uniform float uSteps;
uniform float uBrightness;
uniform float uOpacity;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec2 uMouse;
uniform float uParallax;
uniform bool uEnableMouse;
uniform vec3 uHorizonColor;
uniform vec3 uWaveColor;
uniform vec3 uCrestColor;
out vec4 fragColor;

const float MAX_DIST = 20000.0;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float plasma(vec3 r, vec2 freq, vec4 tc) {
  float mx = r.x + tc.x;
  mx += uSwell * sin((r.y + mx) / 20.0 + tc.y);
  float my = r.y - tc.z;
  my += uTurbulence * cos(r.x / 23.0 + tc.w);
  return r.z - (sin(mx * freq.x) * uAmplitude + sin(my * freq.y) * uAmplitude + uHeight);
}

float raymarch(vec3 pos, vec3 dir, vec2 freq, vec4 tc) {
  float dist = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps) break;
    float dscene = plasma(pos + dist * dir, freq, tc);
    if (abs(dscene) < 0.1) break;
    dist += 0.9 * dscene;
    if (!(abs(dist) < MAX_DIST)) return MAX_DIST;
  }
  return dist;
}

void main() {
  float T = iTime * uSpeed;
  vec2 freq = vec2(uWaveScale / 7.0, (uWaveScale * uWaveRatio) / 3.0);
  vec4 tc = vec4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);
  float c, s;
  float vfov = (3.14159 / 2.3) / max(uZoom, 0.05);
  vec3 cam = vec3(0.0, 0.0, 30.0);
  vec2 uv = (gl_FragCoord.xy / iResolution.xy) - 0.5;
  uv.x *= iResolution.x / iResolution.y;
  uv.y *= -1.0;

  vec3 dir = vec3(0.0, 0.0, -1.0);
  float ulen = length(uv);
  float xrot = vfov * ulen;
  c = cos(xrot); s = sin(xrot);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
  c = nuv.x; s = nuv.y;
  dir = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;
  c = cos(uTilt); s = sin(uTilt);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;

  if (uEnableMouse) {
    float yaw = (uMouse.x - 0.5) * uParallax * 0.4;
    float pitch = (uMouse.y - 0.5) * uParallax * 0.4;
    c = cos(yaw); s = sin(yaw);
    dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;
    c = cos(pitch); s = sin(pitch);
    dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  }

  float dist = raymarch(cam, dir, freq, tc);
  vec3 pos = cam + dist * dir;

  float t = clamp(uFogDepth / max(dist, 0.001), 0.0, 1.0);
  vec3 body = mix(uWaveColor, uCrestColor, clamp(pos.z * 0.08 + 0.5, 0.0, 1.0));
  vec3 col = mix(uHorizonColor, body, t);
  col *= uBrightness;
  col = clamp(col, 0.0, 1.0);

  float alpha = clamp(t, 0.0, 1.0) * uOpacity;
  if (uGrain > 0.5) {
    float g = hash21(gl_FragCoord.xy + mod(iTime, 64.0) * 11.0);
    alpha += (g - 0.5) * uGrainIntensity;
  }
  alpha = clamp(alpha, 0.0, 1.0);
  fragColor = vec4(col * alpha, alpha);
}
`;

export default class GradientWaves {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      horizonColor: '#5227FF',
      waveColor: '#FF9FFC',
      crestColor: '#FFFFFF',
      speed: 0.4,
      amplitude: 2.5,
      waveScale: 0.6,
      waveRatio: 0.9,
      swell: 35,
      turbulence: 20,
      tilt: 1.11,
      zoom: 1.0,
      height: 5.5,
      fogDepth: 15,
      detail: 'medium',
      brightness: 1.0,
      opacity: 1.0,
      mouseInteraction: true,
      parallaxStrength: 0.5,
      grain: true,
      grainIntensity: 0.05,
      ...options
    };

    this.init();
  }

  init() {
    this.renderer = new Renderer({
      webgl: 2,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2)
    });

    const gl = this.renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    this.container.appendChild(canvas);

    const geometry = new Triangle(gl);
    
    const h = hexToRgb(this.options.horizonColor);
    const w = hexToRgb(this.options.waveColor);
    const cr = hexToRgb(this.options.crestColor);

    this.program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uSpeed: { value: this.options.speed },
        uAmplitude: { value: this.options.amplitude },
        uWaveScale: { value: this.options.waveScale },
        uWaveRatio: { value: this.options.waveRatio },
        uSwell: { value: this.options.swell },
        uTurbulence: { value: this.options.turbulence },
        uTilt: { value: this.options.tilt },
        uZoom: { value: this.options.zoom },
        uHeight: { value: this.options.height },
        uFogDepth: { value: this.options.fogDepth },
        uSteps: { value: detailToSteps(this.options.detail) },
        uBrightness: { value: this.options.brightness },
        uOpacity: { value: this.options.opacity },
        uGrain: { value: this.options.grain ? 1.0 : 0.0 },
        uGrainIntensity: { value: this.options.grainIntensity },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uParallax: { value: this.options.parallaxStrength },
        uEnableMouse: { value: this.options.mouseInteraction },
        uHorizonColor: { value: new Float32Array(h) },
        uWaveColor: { value: new Float32Array(w) },
        uCrestColor: { value: new Float32Array(cr) }
      }
    });

    this.mesh = new Mesh(gl, { geometry: geometry, program: this.program });

    this.setSize();
    this.ro = new ResizeObserver(() => this.setSize());
    this.ro.observe(this.container);

    this.currentMouse = [0.5, 0.5];
    this.targetMouse = [0.5, 0.5];

    this.onPointerMove = e => {
      const rect = canvas.getBoundingClientRect();
      this.targetMouse[0] = (e.clientX - rect.left) / rect.width;
      this.targetMouse[1] = 1.0 - (e.clientY - rect.top) / rect.height;
    };
    this.onPointerLeave = () => {
      this.targetMouse[0] = 0.5;
      this.targetMouse[1] = 0.5;
    };
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.raf = 0;
    this.isVisible = true;
    this.isPageVisible = !document.hidden;
    this.t0 = performance.now();

    this.io = new IntersectionObserver(
      ([entry]) => {
        this.isVisible = entry.isIntersecting;
        this.isVisible ? this.tryStart() : this.tryStop();
      },
      { threshold: 0 }
    );
    this.io.observe(this.container);

    this.onVisibility = () => {
      this.isPageVisible = !document.hidden;
      this.isPageVisible ? this.tryStart() : this.tryStop();
    };
    document.addEventListener('visibilitychange', this.onVisibility);

    this.tryStart();
  }

  setSize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(w, h);
    const res = this.program.uniforms.iResolution.value;
    res[0] = this.renderer.gl.drawingBufferWidth;
    res[1] = this.renderer.gl.drawingBufferHeight;
    this.renderer.render({ scene: this.mesh });
  }

  loop(t) {
    this.program.uniforms.iTime.value = (t - this.t0) * 0.001;
    const tx = this.options.mouseInteraction ? this.targetMouse[0] : 0.5;
    const ty = this.options.mouseInteraction ? this.targetMouse[1] : 0.5;
    this.currentMouse[0] += 0.05 * (tx - this.currentMouse[0]);
    this.currentMouse[1] += 0.05 * (ty - this.currentMouse[1]);
    this.program.uniforms.uMouse.value[0] = this.currentMouse[0];
    this.program.uniforms.uMouse.value[1] = this.currentMouse[1];
    this.renderer.render({ scene: this.mesh });
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  tryStart() {
    if (this.isVisible && this.isPageVisible && this.raf === 0) {
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }
  }

  tryStop() {
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  destroy() {
    this.tryStop();
    if (this.ro) this.ro.disconnect();
    if (this.io) this.io.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.gl.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.gl.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    try {
      this.container.removeChild(this.renderer.gl.canvas);
    } catch {}
    this.renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
