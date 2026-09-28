import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { fmtShort } from "../time";

const EARTH = `${import.meta.env.BASE_URL}earth/`;

/** One globe texture (see scripts/paleomaps.py). Snapshots have `ma`; placeholders cover a range. */
export interface GlobeEntry {
  ma?: number;
  from?: number;
  to?: number;
  src: "paleodem" | "gplates" | "precambrian" | "hadean";
  tex: string;
  bump: string;
  label?: string;
  /** [lon, lat] of the land's centre of mass; the globe turns to face it. */
  center?: [number, number];
}

let indexPromise: Promise<GlobeEntry[]> | null = null;
const loadIndex = () => (indexPromise ??= fetch(`${EARTH}index.json`).then(r => r.json()));

/** The snapshot to show for time T (Ma): nearest reconstruction, or a placeholder beyond 1 Ga. */
export function pickGlobe(index: GlobeEntry[], T: number): GlobeEntry | undefined {
  const range = index.find(e => e.from != null && T > e.from && T <= (e.to ?? Infinity));
  if (range) return range;
  let best: GlobeEntry | undefined;
  for (const e of index) {
    if (e.ma == null) continue;
    if (!best || Math.abs(e.ma - T) < Math.abs(best.ma! - T)) best = e;
  }
  return best;
}

const texCache = new Map<string, Promise<THREE.Texture>>();
function loadTexture(file: string, color: boolean, anisotropy: number): Promise<THREE.Texture> {
  let p = texCache.get(file);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(EARTH + file).then(t => {
      if (color) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = anisotropy;
      return t;
    });
    p.catch(() => texCache.delete(file));
    texCache.set(file, p);
  }
  return p;
}

// Soft blue rim around the planet.
const ATMOSPHERE_VERT = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const ATMOSPHERE_FRAG = `
  varying vec3 vNormal;
  void main() {
    float i = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
    gl_FragColor = vec4(0.45, 0.75, 1.0, 1.0) * i;
  }`;

interface Stage {
  renderer: THREE.WebGLRenderer;
  material: THREE.MeshStandardMaterial;
  controls: OrbitControls;
  /** Smoothly turn the camera to look at [lon, lat]. */
  faceLonLat: (lon: number, lat: number) => void;
  dispose: () => void;
}

/** Point on the unit sphere for a lon/lat, matching SphereGeometry's UV layout. */
function lonLatToVector(lon: number, lat: number): THREE.Vector3 {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const la = THREE.MathUtils.degToRad(lat);
  return new THREE.Vector3(-Math.cos(phi) * Math.cos(la), Math.sin(la), Math.sin(phi) * Math.cos(la));
}

function Attribution({ entry }: { entry: GlobeEntry }) {
  switch (entry.src) {
    case "paleodem":
      return (
        <>
          Paleogeography: <a href="https://www.earthbyte.org/paleodem-resource-scotese-and-wright-2018/" target="_blank" rel="noopener">PALEOMAP PaleoDEM</a>{" "}
          (Scotese &amp; Wright 2018, CC BY 4.0), elevation and ocean depth.
        </>
      );
    case "gplates":
      return (
        <>
          Continents: <a href="https://www.earthbyte.org/gplates-web-service/" target="_blank" rel="noopener">GPlates</a> plate model
          of Merdith et al. (2021). Coastlines only; relief and ocean depth are illustrative.
        </>
      );
    case "precambrian":
      return <>No reliable global reconstruction exists this far back; continents are not drawn.</>;
    case "hadean":
      return <>Artist&apos;s impression: a young Earth of cooling crust and magma. No rocks survive to map it.</>;
  }
}

/** Interactive paleogeographic globe for time T (Ma). */
export function Globe({ T }: { T: number }) {
  const mount = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [index, setIndex] = useState<GlobeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadIndex().then(setIndex).catch(() => setIndex([])); }, []);
  const entry = useMemo(() => (index ? pickGlobe(index, T) : undefined), [index, T]);

  // Scene setup (once).
  useEffect(() => {
    const el = mount.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.6, 3.6);
    scene.add(camera);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-3, 2, 4);
    camera.add(sun); // light follows the viewer, so the visible side is always lit

    const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, bumpScale: 3 });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), material);
    earth.rotation.y = -Math.PI / 2; // put 0° longitude towards the viewer
    scene.add(earth);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.12, 64, 32),
      new THREE.ShaderMaterial({
        vertexShader: ATMOSPHERE_VERT, fragmentShader: ATMOSPHERE_FRAG,
        blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false,
      }),
    );
    scene.add(atmosphere);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minDistance = 1.6;
    controls.maxDistance = 6;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.addEventListener("start", () => { controls.autoRotate = false; });

    const resize = () => {
      const max = renderer.capabilities.maxTextureSize / renderer.getPixelRatio();
      const w = Math.min(el.clientWidth, max), h = Math.min(el.clientHeight, max);
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // camera tween towards a target direction (keeps the current distance)
    // (slerp via quaternion, which also copes with a target on the opposite side)
    let tween: { from: THREE.Vector3; rot: THREE.Quaternion; t0: number } | null = null;
    const faceLonLat = (lon: number, lat: number) => {
      const to = lonLatToVector(lon, THREE.MathUtils.clamp(lat, -60, 60)).applyEuler(earth.rotation).normalize();
      const from = camera.position.clone().normalize();
      tween = { from, rot: new THREE.Quaternion().setFromUnitVectors(from, to), t0: performance.now() };
    };

    // only animate while the globe is on screen
    let visible = true, frame = 0;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(el);
    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      if (tween) {
        const k = Math.min(1, (performance.now() - tween.t0) / 1200);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
        const dir = tween.from.clone().applyQuaternion(new THREE.Quaternion().slerp(tween.rot, e));
        camera.position.copy(dir.multiplyScalar(camera.position.length()));
        camera.lookAt(0, 0, 0);
        if (k >= 1) tween = null;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    stage.current = {
      renderer, material, controls, faceLonLat,
      dispose: () => {
        cancelAnimationFrame(frame);
        ro.disconnect();
        io.disconnect();
        controls.dispose();
        scene.traverse(o => {
          if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
        });
        renderer.dispose();
        el.removeChild(renderer.domElement);
      },
    };
    return () => { stage.current?.dispose(); stage.current = null; };
  }, []);

  // Swap textures when the snapshot changes; preload the neighbouring snapshots for smooth scrubbing.
  useEffect(() => {
    const s = stage.current;
    if (!s || !entry || !index) return;
    let live = true;
    const aniso = s.renderer.capabilities.getMaxAnisotropy();
    setLoading(true);
    Promise.all([loadTexture(entry.tex, true, aniso), loadTexture(entry.bump, false, aniso)])
      .then(([map, bump]) => {
        if (!live) return;
        s.material.map = map;
        s.material.bumpMap = bump;
        s.material.emissive.set(entry.src === "hadean" ? 0x1a0600 : 0x000000);
        s.material.needsUpdate = true;
        if (entry.center) s.faceLonLat(entry.center[0], entry.center[1]);
        setLoading(false);
      })
      .catch(() => live && setLoading(false));
    const i = index.indexOf(entry);
    for (const n of [index[i - 1], index[i + 1]]) {
      if (n) { loadTexture(n.tex, true, aniso); loadTexture(n.bump, false, aniso); }
    }
    return () => { live = false; };
  }, [entry, index]);

  return (
    <figure className="globe">
      <div ref={mount} className={`globe-canvas${loading ? " loading" : ""}`} title="Drag to rotate · scroll to zoom" />
      {entry && (
        <figcaption>
          <b>
            {entry.ma != null
              ? `Earth ${entry.ma === 0 ? "today" : `${fmtShort(entry.ma)} ago`}${entry.label ? ` · ${entry.label}` : ""}`
              : entry.src === "hadean" ? "Hadean Earth" : "Earth before 1 billion years ago"}
          </b>
          {entry.ma != null && Math.abs(entry.ma - T) >= 1 && <span className="muted"> (nearest reconstruction to {fmtShort(T)})</span>}
          <br />
          <span className="muted"><Attribution entry={entry} /> Drag to rotate.</span>
        </figcaption>
      )}
    </figure>
  );
}
