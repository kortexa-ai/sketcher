import * as THREE from 'three';
import type { SketchPlan } from '../types';
import { buildStrokeGeometry } from './strokeGeometry';

const STROKE_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aAlpha;
  attribute float aSide;
  varying float vT;
  varying float vAlpha;
  varying float vSide;
  varying vec2 vPos;
  void main() {
    vT = aT;
    vAlpha = aAlpha;
    vSide = aSide;
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STROKE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uProgress;
  varying float vT;
  varying float vAlpha;
  varying float vSide;
  varying vec2 vPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    if (vT > uProgress) discard;
    // Soft ribbon edges — graphite is darker in the middle of a stroke.
    float across = 1.0 - abs(vSide * 2.0 - 1.0);
    float edge = smoothstep(0.0, 0.55, across);
    // Graphite grain: paper tooth breaks the stroke up at pixel scale.
    float grain = 0.72 + 0.28 * hash(floor(vPos * 2.4));
    // Freshly drawn bit is a touch darker, like graphite before it settles.
    float fresh = 1.0 + 0.25 * (1.0 - smoothstep(0.0, 0.035, uProgress - vT));
    float alpha = vAlpha * edge * grain * fresh;
    vec3 graphite = vec3(0.16, 0.17, 0.20);
    gl_FragColor = vec4(graphite, alpha);
  }
`;

const PAPER_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PAPER_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uSize;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vec2 px = vUv * uSize;
    // Warm paper with fine tooth and a few larger fibers.
    float tooth = noise(px * 0.9) * 0.5 + noise(px * 0.23) * 0.5;
    vec3 paper = vec3(0.976, 0.964, 0.937);
    paper -= tooth * 0.028;
    // Gentle vignette so the page doesn't feel flat.
    vec2 c = vUv - 0.5;
    paper -= dot(c, c) * 0.10;
    gl_FragColor = vec4(paper, 1.0);
  }
`;

/**
 * Owns the three.js scene: paper plane + merged stroke mesh, an orthographic
 * camera fitted to the sketch, and the animation clock that advances
 * uProgress from 0 to 1 over the configured duration.
 */
export class SketchRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  private strokeMaterial: THREE.ShaderMaterial;
  private paperMaterial: THREE.ShaderMaterial;
  private strokeMesh: THREE.Mesh | null = null;
  private paperMesh: THREE.Mesh;
  private plan: SketchPlan | null = null;

  private raf = 0;
  private lastTime = 0;
  private playing = false;
  private progress = 0;
  durationSec = 12;
  onProgress: ((p: number) => void) | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';

    this.strokeMaterial = new THREE.ShaderMaterial({
      vertexShader: STROKE_VERTEX,
      fragmentShader: STROKE_FRAGMENT,
      uniforms: { uProgress: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // The camera is y-flipped (image coords), which inverts winding order.
      side: THREE.DoubleSide,
    });
    this.paperMaterial = new THREE.ShaderMaterial({
      vertexShader: PAPER_VERTEX,
      fragmentShader: PAPER_FRAGMENT,
      uniforms: { uSize: { value: new THREE.Vector2(1, 1) } },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.paperMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.paperMaterial);
    this.paperMesh.renderOrder = 0;
    this.scene.add(this.paperMesh);

    this.resize();
    this.resizeObserver.observe(container);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private resizeObserver = new ResizeObserver(() => this.resize());

  setPlan(plan: SketchPlan): void {
    this.plan = plan;
    if (this.strokeMesh) {
      this.strokeMesh.geometry.dispose();
      this.scene.remove(this.strokeMesh);
    }
    const geo = buildStrokeGeometry(plan);
    this.strokeMesh = new THREE.Mesh(geo, this.strokeMaterial);
    this.strokeMesh.renderOrder = 1;
    this.strokeMesh.frustumCulled = false;
    this.scene.add(this.strokeMesh);

    // Paper covers the sketch area with a small margin.
    const margin = Math.max(plan.width, plan.height) * 0.04;
    this.paperMesh.scale.set(plan.width + margin * 2, plan.height + margin * 2, 1);
    this.paperMesh.position.set(plan.width / 2, plan.height / 2, 0);
    this.paperMaterial.uniforms.uSize.value.set(plan.width, plan.height);

    this.fitCamera();
    this.restart();
  }

  play(): void {
    if (this.progress >= 1) this.progress = 0;
    this.playing = true;
    this.lastTime = 0;
  }

  pause(): void {
    this.playing = false;
  }

  restart(): void {
    this.progress = 0;
    this.playing = true;
    this.lastTime = 0;
  }

  seek(p: number): void {
    this.progress = Math.min(1, Math.max(0, p));
    this.playing = false;
    this.onProgress?.(this.progress);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private loop(time: number): void {
    this.raf = requestAnimationFrame(this.loop);
    if (this.playing && this.plan) {
      if (this.lastTime === 0) this.lastTime = time;
      const dt = (time - this.lastTime) / 1000;
      this.lastTime = time;
      this.progress = Math.min(1, this.progress + dt / this.durationSec);
      if (this.progress >= 1) this.playing = false;
      this.onProgress?.(this.progress);
    } else {
      this.lastTime = 0;
    }
    this.strokeMaterial.uniforms.uProgress.value = this.progress;
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.fitCamera();
  }

  /** Letterbox the sketch into the container, y-down like image coords. */
  private fitCamera(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const planW = this.plan?.width ?? 1;
    const planH = this.plan?.height ?? 1;
    const pad = 1.06;
    const scale = Math.max((planW * pad) / w, (planH * pad) / h);
    const viewW = w * scale;
    const viewH = h * scale;
    const cx = planW / 2;
    const cy = planH / 2;
    this.camera.left = cx - viewW / 2;
    this.camera.right = cx + viewW / 2;
    // Image y grows downward; flip the camera so the sketch isn't mirrored.
    this.camera.top = cy - viewH / 2;
    this.camera.bottom = cy + viewH / 2;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.strokeMesh?.geometry.dispose();
    this.paperMesh.geometry.dispose();
    this.strokeMaterial.dispose();
    this.paperMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
