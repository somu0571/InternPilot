/*
 * The InternPilot paper plane in 3D (#211).
 *
 * A 3D take on the logo, built with Three.js from code (no model files): the
 * paper plane rides its flight path toward the guidance star.
 *
 * It's decoration, so it must never cost people on phones and slow networks
 * anything. Each [data-plane-3d] element shows the static logo first. The 3D
 * version only loads when the element scrolls into view, WebGL works, Data
 * Saver is off, the connection is 4G or better and the person hasn't asked
 * for reduced motion. Rendering pauses when it's off screen or the tab is
 * hidden. Three.js is pinned and integrity-checked before it runs.
 */

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
const THREE_SRI = 'sha384-IDC7sAMAIMB/TZ6dgKKPPAKZ2bXXXP8+FBMBC8cU319eBhKITx+PaalhfDkDNH28';

/** Whether this device and connection should get the 3D version. */
export function canRender3d({ reduceMotion = false, saveData = false, effectiveType = '4g', webgl = false } = {}) {
    if (reduceMotion || saveData || !webgl) return false;
    return !['slow-2g', '2g', '3g'].includes(String(effectiveType));
}

function toBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

/** Loads Three.js, checking it like Subresource Integrity before running it. */
async function loadThree() {
    const response = await fetch(THREE_URL, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error('Three.js could not be loaded');
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-384', bytes);
    if (`sha384-${toBase64(digest)}` !== THREE_SRI) throw new Error('Three.js failed its integrity check');
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    try {
        return await import(url);
    } finally {
        URL.revokeObjectURL(url);
    }
}

function hasWebGL() {
    try {
        const canvas = document.createElement('canvas');
        return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
    } catch (err) {
        return false;
    }
}

function environment() {
    const connection = navigator.connection || {};
    return {
        reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        saveData: Boolean(connection.saveData),
        effectiveType: connection.effectiveType || '4g',
        webgl: hasWebGL()
    };
}

function buildScene(THREE, canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    // Framed so the whole flight path, from its low curve to the star, stays in view.
    camera.position.set(0, -0.3, 7);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6366f1, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x818cf8, 1.4);
    rim.position.set(-4, -2, -3);
    scene.add(rim);

    // The paper plane: two wings folded along a keel, nose pointing along +x,
    // in the logo's white and indigo shades.
    const face = (points, color) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        geometry.computeVertexNormals();
        return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.05, flatShading: true }));
    };
    const nose = [1.35, 0, 0];
    const tail = [-1.15, 0, 0];
    const keel = [-0.95, -0.38, 0];
    const plane = new THREE.Group();
    plane.add(face([...nose, ...tail, -1.2, 0.08, 0.95], 0xffffff));
    plane.add(face([...nose, -1.2, 0.08, -0.95, ...tail], 0xc7d2fe));
    plane.add(face([...nose, ...keel, ...tail], 0x6366f1));
    plane.add(face([...nose, ...tail, ...keel], 0x4338ca));
    plane.scale.setScalar(1.2);
    scene.add(plane);

    // The flight path, like the cyan arc in the logo.
    const path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-2.4, -1.35, 0),
        new THREE.Vector3(-0.9, -1.55, 0.3),
        new THREE.Vector3(0.9, -0.85, 0.1),
        new THREE.Vector3(1.7, 0.45, -0.3)
    ]);
    scene.add(new THREE.Mesh(
        new THREE.TubeGeometry(path, 80, 0.034, 8, false),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8 })
    ));

    // The guidance star.
    const star = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.24, 0),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.9, flatShading: true })
    );
    star.position.set(1.95, 1.05, -0.4);
    scene.add(star);

    return { renderer, scene, camera, plane, star };
}

/** Mounts the 3D plane in a [data-plane-3d] element. Resolves true if it did. */
export async function mountPlane(container, env = environment()) {
    if (!container || container.dataset.plane3dMounted || !canRender3d(env)) return false;
    container.dataset.plane3dMounted = 'true';
    const THREE = await loadThree();

    const canvas = document.createElement('canvas');
    canvas.className = 'ip-plane3d__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    const { renderer, scene, camera, plane, star } = buildScene(THREE, canvas);

    const resize = () => {
        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };
    resize();

    const clock = new THREE.Clock();
    let frame = 0;
    let visible = true;
    // 30 frames a second is plenty for a gentle float and halves the work.
    let lastDrawn = 0;
    const render = now => {
        frame = requestAnimationFrame(render);
        if (now - lastDrawn < 32) return;
        lastDrawn = now;
        const t = clock.getElapsedTime();
        plane.position.set(Math.sin(t * 0.5) * 0.12, Math.sin(t * 1.3) * 0.16, 0);
        // Tilted toward the viewer so the wings read, banking gently in flight.
        plane.rotation.set(0.95 + Math.sin(t * 1.3) * 0.08, -0.55 + Math.sin(t * 0.6) * 0.2, 0.35 + Math.sin(t * 1.3) * 0.1);
        star.rotation.y = t * 0.9;
        star.scale.setScalar(1 + Math.sin(t * 2.4) * 0.12);
        renderer.render(scene, camera);
    };
    const play = () => { if (!frame && visible && !document.hidden) { clock.getDelta(); frame = requestAnimationFrame(render); } };
    const pause = () => { cancelAnimationFrame(frame); frame = 0; };

    new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting);
        if (visible) play(); else pause();
    }).observe(container);
    document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
    if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(container);

    renderer.render(scene, camera);
    container.classList.add('is-3d');
    play();
    return true;
}

// Mount every [data-plane-3d] once it comes near the screen.
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof IntersectionObserver === 'function') {
    const targets = document.querySelectorAll('[data-plane-3d]');
    if (targets.length) {
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                observer.unobserve(entry.target);
                mountPlane(entry.target).catch(() => {
                    // The static logo simply stays.
                });
            });
        }, { rootMargin: '200px' });
        targets.forEach(target => observer.observe(target));
    }
}
