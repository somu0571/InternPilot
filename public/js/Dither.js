import { Renderer, Program, Mesh, Plane, Sphere, Transform, Camera, Texture, Vec2, Vec3 } from 'https://cdn.jsdelivr.net/npm/ogl/+esm';

const hexToRgb = hex => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return [1, 1, 1];
    return [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255];
};

const vertex = `#version 300 es
in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
out vec3 vPos;
void main() {
    vUv = uv;
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    vPos = viewPos.xyz;
    gl_Position = projectionMatrix * viewPos;
}`;

const fragment = `#version 300 es
precision highp float;

uniform sampler2D tMap;
uniform vec2 uResolution;
uniform vec2 uMouse; // Normalized mouse
uniform float uRadius;
uniform float uSoftness;
uniform float uPixelSize;
uniform vec3 uInkColor;
uniform vec3 uPaperColor;
uniform vec3 uRimColor;
uniform float uBurst;
uniform float uTime;

in vec2 vUv;
in vec3 vPos;
out vec4 FragColor;

float bayer2(vec2 a) {
    a = floor(a);
    return fract(dot(a, vec2(0.5, a.y * 0.5)));
}
float bayer4(vec2 a) {
    return bayer2(0.5 * a) * 0.25 + bayer2(a);
}
float bayer8(vec2 a) {
    return bayer4(0.5 * a) * 0.25 + bayer2(a);
}

void main() {
    // Dynamic noise/displacement on UV based on time and mouse
    vec2 displacedUv = vUv;
    displacedUv.x += sin(vUv.y * 10.0 + uTime) * 0.002;
    displacedUv.y += cos(vUv.x * 10.0 + uTime) * 0.002;

    vec4 tex = texture(tMap, displacedUv);
    
    // Use PNG alpha channel for transparency to ensure no rectangular box
    float alpha = tex.a;
    
    // Convert to luma for dither
    float luma = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    
    // Dynamic pixel size for alive feeling
    float pSize = uPixelSize + sin(uTime * 2.0) * 0.5;
    vec2 px = gl_FragCoord.xy / pSize;
    float bayer = bayer8(px);
    
    vec3 dithered = mix(uInkColor, uPaperColor, step(bayer, luma));
    
    // Cursor reveal logic
    vec2 screenUV = gl_FragCoord.xy / uResolution;
    vec2 mouseScreen = uMouse * 0.5 + 0.5; // -1..1 to 0..1
    float aspect = uResolution.x / uResolution.y;
    
    vec2 diff = screenUV - mouseScreen;
    diff.x *= aspect;
    float dist = length(diff) * uResolution.y; // distance in pixels
    
    float reveal = smoothstep(uRadius, uRadius * (1.0 - uSoftness), dist - uBurst * 50.0);
    
    // Rim glow around reveal
    float rim = smoothstep(uRadius + 30.0, uRadius - 10.0, dist) * (1.0 - reveal);
    
    vec3 mixedColor = mix(dithered, tex.rgb, reveal);
    mixedColor += uRimColor * rim * 0.8;
    
    // Premultiply alpha for WebGL transparent canvas
    FragColor = vec4(mixedColor * alpha, alpha);
}`;

// Simple particle shader
const pVertex = `#version 300 es
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const pFragment = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 FragColor;
void main() {
    FragColor = vec4(uColor, 0.6);
}`;

export default class Dither {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            image: options.image || '',
            pixelSize: options.pixelSize || 4,
            inkColor: options.inkColor || '#1e1b4b',
            paperColor: options.paperColor || '#f3e8ff',
            rimColor: options.rimColor || '#7e22ce',
            revealRadius: options.revealRadius || 250,
            softness: options.softness || 0.8,
            clickBurst: options.clickBurst !== undefined ? options.clickBurst : true,
            ...options
        };

        const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.autoAnimate = !isReducedMotion;

        this.renderer = new Renderer({ alpha: true, dpr: Math.min(window.devicePixelRatio || 1, 2) });
        this.gl = this.renderer.gl;
        this.container.appendChild(this.gl.canvas);
        this.gl.canvas.classList.add('dither-canvas');

        this.mouse = new Vec2(-1000, -1000); // Screen pixels
        this.targetMouse = new Vec2(-1000, -1000);
        this.normalizedMouse = new Vec2(0, 0); // -1 to 1
        this.burst = 0;
        this.time = 0;

        this.init();
    }

    async init() {
        this.scene = new Transform();
        this.camera = new Camera(this.gl, { fov: 35 });
        this.camera.position.set(0, 0, 7.5); // Move camera back to prevent frustum clipping

        // Main artwork plane
        const geometry = new Plane(this.gl, { width: 4.2, height: 4.2 }); // Safe scale
        const texture = new Texture(this.gl, { generateMipmaps: true });

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = this.options.image;
        await new Promise(resolve => {
            img.onload = () => {
                texture.image = img;
                // Adjust plane aspect ratio to match image precisely without clipping
                const aspect = img.width / img.height;
                if (aspect > 1) {
                    geometry.width = 4.2;
                    geometry.height = 4.2 / aspect;
                } else {
                    geometry.height = 4.2;
                    geometry.width = 4.2 * aspect;
                }
                resolve();
            };
        });

        this.program = new Program(this.gl, {
            vertex,
            fragment,
            uniforms: {
                tMap: { value: texture },
                uResolution: { value: new Vec2(this.gl.canvas.width, this.gl.canvas.height) },
                uMouse: { value: new Vec2(0, 0) }, // Normalized
                uRadius: { value: this.options.revealRadius },
                uSoftness: { value: this.options.softness },
                uPixelSize: { value: this.options.pixelSize },
                uInkColor: { value: hexToRgb(this.options.inkColor) },
                uPaperColor: { value: hexToRgb(this.options.paperColor) },
                uRimColor: { value: hexToRgb(this.options.rimColor) },
                uBurst: { value: 0 },
                uTime: { value: 0 }
            },
            transparent: true,
            cullFace: null
        });

        this.artworkMesh = new Mesh(this.gl, { geometry, program: this.program });
        this.artworkMesh.setParent(this.scene);

        // Decorative floating particles (background & foreground)
        this.particles = [];
        const pGeo = new Sphere(this.gl, { radius: 0.05, widthSegments: 16 });
        const pColors = ['#a855f7', '#4f46e5', '#818cf8', '#d8b4fe'];
        
        for(let i=0; i<15; i++) {
            const pProg = new Program(this.gl, {
                vertex: pVertex,
                fragment: pFragment,
                uniforms: { uColor: { value: new Vec3(...hexToRgb(pColors[i % 4])) } },
                transparent: true
            });
            const p = new Mesh(this.gl, { geometry: pGeo, program: pProg });
            
            // Random positions in 3D space around the artwork
            const x = (Math.random() - 0.5) * 6;
            const y = (Math.random() - 0.5) * 6;
            const z = (Math.random() - 0.5) * 3; // Depth
            p.position.set(x, y, z);
            
            const scale = 0.5 + Math.random();
            p.scale.set(scale, scale, scale);
            p.setParent(this.scene);
            
            this.particles.push({
                mesh: p,
                speedX: (Math.random() - 0.5) * 0.2,
                speedY: (Math.random() - 0.5) * 0.2 + 0.1,
                baseX: x,
                baseY: y,
                depth: z
            });
        }

        this.resize();
        window.addEventListener('resize', this.resize.bind(this));
        
        this.container.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.container.addEventListener('mouseleave', this.onMouseLeave.bind(this));
        if (this.options.clickBurst) {
            this.container.addEventListener('mousedown', this.onClick.bind(this));
        }

        requestAnimationFrame(this.render.bind(this));
    }

    onMouseMove(e) {
        const rect = this.gl.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Screen pixels for distance calculation
        this.targetMouse.set(x * this.renderer.dpr, (rect.height - y) * this.renderer.dpr);
        
        // Normalized -1 to 1 for parallax
        this.normalizedMouse.set(
            (x / rect.width) * 2 - 1,
            -(y / rect.height) * 2 + 1
        );
    }

    onMouseLeave() {
        this.targetMouse.set(-10000, -10000);
        this.normalizedMouse.set(0, 0);
    }

    onClick() {
        this.burst = 1.0;
    }

    resize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.renderer.setSize(width, height);
        this.camera.perspective({ aspect: width / height });
        
        if (this.program) {
            this.program.uniforms.uResolution.value.set(
                width * this.renderer.dpr,
                height * this.renderer.dpr
            );
        }
    }

    render(t) {
        requestAnimationFrame(this.render.bind(this));
        const dt = 0.016;
        
        this.mouse.lerp(this.targetMouse, 0.1);
        if (this.burst > 0) this.burst *= 0.9;
        
        if (this.autoAnimate) {
            this.time += dt;
            
            // Subtle hover effect on main artwork
            this.artworkMesh.position.y = Math.sin(this.time * 1.5) * 0.05;
            
            // Subtle 3D tilt parallax
            this.artworkMesh.rotation.y += (this.normalizedMouse.x * 0.15 - this.artworkMesh.rotation.y) * 0.05;
            this.artworkMesh.rotation.x += (-this.normalizedMouse.y * 0.1 - this.artworkMesh.rotation.x) * 0.05;
            
            // Move background/foreground particles for depth parallax
            this.particles.forEach(p => {
                // Natural drift
                p.baseX += p.speedX * dt * 0.5;
                p.baseY += p.speedY * dt * 0.5;
                if(p.baseY > 3) p.baseY = -3; // wrap
                
                // Mouse parallax based on depth
                const parallaxX = this.normalizedMouse.x * (p.depth * 0.2);
                const parallaxY = this.normalizedMouse.y * (p.depth * 0.2);
                
                p.mesh.position.set(
                    p.baseX + parallaxX,
                    p.baseY + parallaxY,
                    p.depth
                );
            });
        }

        if (this.program) {
            // Pass normalized mouse 0..1 to shader for reveal logic
            const normX = this.mouse.x / (this.gl.canvas.width || 1);
            const normY = this.mouse.y / (this.gl.canvas.height || 1);
            this.program.uniforms.uMouse.value.set(normX * 2 - 1, normY * 2 - 1);
            
            this.program.uniforms.uBurst.value = this.burst;
            this.program.uniforms.uTime.value = this.time;
            
            this.renderer.render({ scene: this.scene, camera: this.camera });
        }
    }
}
