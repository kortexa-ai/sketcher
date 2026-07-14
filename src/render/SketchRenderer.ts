import * as THREE from 'three';
import type { SketchPlan } from '../types';
import { buildStrokeGeometry } from './strokeGeometry';
import { pencilTipAt } from './tip';

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
  private lastFrameTs = 0;
  private playing = false;
  private progressValue = 0;
  private pencil: THREE.Group;
  private pencilPos: { x: number; y: number } | null = null;
  private lastTip: { x: number; y: number } | null = null;
  durationSec = 12;
  /** Show the animated pencil riding the ink front. */
  showPencil = true;
  onProgress: ((p: number) => void) | null = null;
  /**
   * Fires every frame with the pencil's normalized drawing speed (0..1);
   * 0 while paused, lifted between strokes, or finished. Drives audio.
   */
  onPencilMove: ((speed: number) => void) | null = null;

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

    this.pencil = buildPencil();
    this.scene.add(this.pencil);

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

    this.pencil.scale.setScalar(Math.max(plan.width, plan.height) * 0.16);
    this.pencilPos = null; // snap to the new sketch's first stroke

    this.fitCamera();
    this.restart();
  }

  play(): void {
    if (this.progressValue >= 1) this.progressValue = 0;
    this.playing = true;
    this.lastTime = 0;
  }

  pause(): void {
    this.playing = false;
  }

  restart(): void {
    this.progressValue = 0;
    this.playing = true;
    this.lastTime = 0;
  }

  seek(p: number): void {
    this.progressValue = Math.min(1, Math.max(0, p));
    this.playing = false;
    this.onProgress?.(this.progressValue);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Current timeline position, 0..1. */
  get progress(): number {
    return this.progressValue;
  }

  private loop(time: number): void {
    this.raf = requestAnimationFrame(this.loop);
    const frameDt = this.lastFrameTs ? (time - this.lastFrameTs) / 1000 : 0;
    this.lastFrameTs = time;
    if (this.playing && this.plan) {
      if (this.lastTime === 0) this.lastTime = time;
      const dt = (time - this.lastTime) / 1000;
      this.lastTime = time;
      this.progressValue = Math.min(1, this.progressValue + dt / this.durationSec);
      if (this.progressValue >= 1) this.playing = false;
      this.onProgress?.(this.progressValue);
    } else {
      this.lastTime = 0;
    }
    this.updatePencil(frameDt);
    this.strokeMaterial.uniforms.uProgress.value = this.progressValue;
    this.renderer.render(this.scene, this.camera);
  }

  /** Park the pencil sprite on the ink front, gliding + lifting between strokes. */
  private updatePencil(dt: number): void {
    const plan = this.plan;
    if (!plan || this.progressValue >= 1) {
      this.pencil.visible = false;
      if (this.progressValue >= 1) this.pencilPos = null;
      this.lastTip = null;
      this.onPencilMove?.(0);
      return;
    }
    const tip = pencilTipAt(plan, this.progressValue);
    if (!tip) {
      this.pencil.visible = false;
      this.lastTip = null;
      this.onPencilMove?.(0);
      return;
    }

    // Drawing speed from the raw ink-front motion (not the smoothed sprite).
    // A big jump means the pencil hopped to a new stroke — lifted, silent.
    if (this.onPencilMove) {
      const size = Math.max(plan.width, plan.height);
      let speed = 0;
      if (this.playing && this.lastTip && dt > 0) {
        const moved = Math.hypot(tip.x - this.lastTip.x, tip.y - this.lastTip.y);
        const hop = moved > size * 0.05;
        if (!hop) speed = Math.min(1, moved / dt / (size * 0.8));
      }
      this.onPencilMove(speed);
    }
    this.lastTip = { x: tip.x, y: tip.y };

    if (!this.showPencil) {
      this.pencil.visible = false;
      return;
    }
    if (!this.pencilPos) this.pencilPos = { x: tip.x, y: tip.y };
    // Frame-rate-independent chase: quick enough to ride the ink front,
    // soft enough that hops between strokes read as the hand travelling.
    const k = 1 - Math.exp(-dt * 16);
    this.pencilPos.x += (tip.x - this.pencilPos.x) * k;
    this.pencilPos.y += (tip.y - this.pencilPos.y) * k;
    const gap = Math.hypot(tip.x - this.pencilPos.x, tip.y - this.pencilPos.y);
    const size = Math.max(plan.width, plan.height);
    // Lift off the paper while travelling between strokes (screen-up = -y).
    const lift = Math.min(1, gap / (size * 0.04));
    this.pencil.position.set(this.pencilPos.x, this.pencilPos.y - lift * size * 0.02, 0);
    this.pencil.rotation.z = PENCIL_ANGLE + 0.05 * Math.sin(this.progressValue * 180);
    this.pencil.visible = true;
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
    this.pencil.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// Rotation from +x so the pencil points up-right on screen (world y is flipped).
const PENCIL_ANGLE = -0.96;

/**
 * A classic yellow pencil built from flat convex shapes, unit length along
 * +x with the graphite tip at the origin. Scaled to the sketch in setPlan.
 */
function buildPencil(): THREE.Group {
  const group = new THREE.Group();
  const part = (pts: Array<[number, number]>, color: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        // Same y-flipped camera caveat as the stroke/paper materials.
        side: THREE.DoubleSide,
      }),
    );
    mesh.renderOrder = 2;
    group.add(mesh);
  };
  part([[0, 0], [0.09, -0.022], [0.09, 0.022]], 0x2a2c30); // graphite
  part([[0.09, -0.022], [0.2, -0.06], [0.2, 0.06], [0.09, 0.022]], 0xe3cda4); // wood
  part([[0.2, -0.06], [0.84, -0.06], [0.84, 0.06], [0.2, 0.06]], 0xf5b83d); // body
  part([[0.2, 0.02], [0.84, 0.02], [0.84, 0.052], [0.2, 0.052]], 0xdd9f2f); // shading
  part([[0.84, -0.062], [0.89, -0.062], [0.89, 0.062], [0.84, 0.062]], 0xaeb6c2); // ferrule
  part([[0.89, -0.055], [1, -0.055], [1, 0.055], [0.89, 0.055]], 0xee9aa6); // eraser
  group.visible = false;
  return group;
}
