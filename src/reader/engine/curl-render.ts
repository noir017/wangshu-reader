// 仿真翻页渲染器：WebGL（首选）与 Canvas2D（降级）共用同一份网格（curl.ts）。
// 两者的绘制顺序一致（§4.3 drawiBook）：底页 → 投影 → 正面 → 背面（先纸色再镜像页图）→ 自阴影。
import type { CurlMesh, GoogleMesh, Rect, ShadowV, Vtx } from './curl';

export interface CurlScene {
  rect: Rect;
  /** 被卷的页（正面）与它下面的页 */
  texF: HTMLCanvasElement;
  texU: HTMLCanvasElement;
  /** 背面纸色（0..255）与镜像页图的透明度 */
  tint: [number, number, number];
  backAlpha: number;
  mesh: CurlMesh | null;
  google?: GoogleMesh;
}

export interface CurlRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly kind: 'webgl' | 'canvas2d';
  setPages(f: HTMLCanvasElement, u: HTMLCanvasElement): void;
  draw(scene: CurlScene): void;
  dispose(): void;
}

const SHADOW_INNER = 0.5;

function shadowVerts(list: ShadowV[]): Array<{ x: number; y: number; a: number }> {
  const out: Array<{ x: number; y: number; a: number }> = [];
  for (const s of list) {
    out.push({ x: s.x, y: s.y, a: SHADOW_INNER * s.k }, { x: s.x + s.px, y: s.y + s.py, a: 0 });
  }
  return out;
}

// ───────────── WebGL ─────────────
const VS = `attribute vec2 aPos;attribute vec2 aTex;attribute vec4 aCol;uniform vec2 uRes;varying vec2 vTex;varying vec4 vCol;
void main(){vec2 p=aPos/uRes*2.0-1.0;gl_Position=vec4(p.x,-p.y,0.0,1.0);vTex=aTex;vCol=aCol;}`;
const FS = `precision mediump float;uniform sampler2D uTex;uniform float uSolid;varying vec2 vTex;varying vec4 vCol;
void main(){if(uSolid>0.5){gl_FragColor=vCol;}else{vec4 t=texture2D(uTex,vTex);gl_FragColor=vec4(t.rgb*vCol.rgb,t.a*vCol.a);}}`;

class GLRenderer implements CurlRenderer {
  readonly kind = 'webgl' as const;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private buf: WebGLBuffer;
  private texF: WebGLTexture;
  private texU: WebGLTexture;
  private loc: { pos: number; tex: number; col: number; res: WebGLUniformLocation; solid: WebGLUniformLocation; sampler: WebGLUniformLocation };

  constructor(readonly canvas: HTMLCanvasElement, private w: number, private h: number) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false }) as WebGLRenderingContext | null;
    if (!gl) throw new Error('no webgl');
    this.gl = gl;
    const mk = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    this.prog = prog;
    gl.useProgram(prog);
    this.loc = {
      pos: gl.getAttribLocation(prog, 'aPos'),
      tex: gl.getAttribLocation(prog, 'aTex'),
      col: gl.getAttribLocation(prog, 'aCol'),
      res: gl.getUniformLocation(prog, 'uRes')!,
      solid: gl.getUniformLocation(prog, 'uSolid')!,
      sampler: gl.getUniformLocation(prog, 'uTex')!,
    };
    this.buf = gl.createBuffer()!;
    this.texF = this.makeTex();
    this.texU = this.makeTex();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private makeTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  setPages(f: HTMLCanvasElement, u: HTMLCanvasElement): void {
    const gl = this.gl;
    for (const [t, src] of [[this.texF, f], [this.texU, u]] as const) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); // 被污染的 canvas 会在这里抛 SecurityError，由调用方降级
    }
  }

  /** 画一条三角带：每个顶点 [x,y,u,v,r,g,b,a] */
  private strip(data: number[], tex: WebGLTexture | null, solid: boolean): void {
    if (data.length < 8 * 3) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    const stride = 8 * 4;
    gl.enableVertexAttribArray(this.loc.pos);
    gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.loc.tex);
    gl.vertexAttribPointer(this.loc.tex, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(this.loc.col);
    gl.vertexAttribPointer(this.loc.col, 4, gl.FLOAT, false, stride, 16);
    gl.uniform1f(this.loc.solid, solid ? 1 : 0);
    if (tex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.loc.sampler, 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, data.length / 8);
  }

  private quad(r: Rect): number[] {
    return [r.left, r.top, 0, 0, 1, 1, 1, 1, r.left, r.bottom, 0, 1, 1, 1, 1, 1, r.right, r.top, 1, 0, 1, 1, 1, 1, r.right, r.bottom, 1, 1, 1, 1, 1, 1];
  }

  private vs(vs: Vtx[], from: number, to: number, rgba: (v: Vtx) => [number, number, number, number]): number[] {
    const out: number[] = [];
    for (let i = from; i < to; i++) {
      const v = vs[i];
      const c = rgba(v);
      out.push(v.x, v.y, v.u, v.v, c[0], c[1], c[2], c[3]);
    }
    return out;
  }

  private shadow(list: ShadowV[]): void {
    const sv = shadowVerts(list);
    this.strip(sv.flatMap((s) => [s.x, s.y, 0, 0, 0, 0, 0, s.a]), null, true);
  }

  draw(sc: CurlScene): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.loc.res, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    this.strip(this.quad(sc.rect), this.texU, false);
    gl.enable(gl.BLEND);
    const m = sc.mesh;
    if (sc.google) {
      const g = sc.google;
      if (g.shadow > 0) {
        const last = g.verts.slice(-8);
        // 右端一小条阴影：贴在页面右端附近（简化为 3 段渐变）
        const x = last[last.length - 1].x;
        const top = last[0].y;
        const bottom = last[last.length - 1].y;
        this.strip([x - 24, top, 0, 0, 0, 0, 0, 0, x - 24, bottom, 0, 0, 0, 0, 0, 0, x, top, 0, 0, 0, 0, 0, g.shadow, x, bottom, 0, 0, 0, 0, 0, g.shadow], null, true);
      }
      this.googleStrips(g, sc);
      return;
    }
    if (!m) {
      this.strip(this.quad(sc.rect), this.texF, false);
      return;
    }
    this.shadow(m.dropShadow);
    this.strip(this.vs(m.verts, 0, m.front, (v) => [v.shade, v.shade, v.shade, 1]), this.texF, false);
    const b0 = Math.max(0, m.front - 2);
    const [tr, tg, tb] = sc.tint;
    this.strip(this.vs(m.verts, b0, m.verts.length, (v) => [(tr / 255) * v.shade, (tg / 255) * v.shade, (tb / 255) * v.shade, 1]), null, true);
    this.strip(this.vs(m.verts, b0, m.verts.length, (v) => [v.shade, v.shade, v.shade, sc.backAlpha]), this.texF, false);
    this.shadow(m.selfShadow);
  }

  private googleStrips(g: GoogleMesh, sc: CurlScene): void {
    // 把每段按正反面拆成连续的带：正面 = 页图，背面 = 纸色
    const N = g.facing.length;
    let i = 0;
    while (i < N) {
      let j = i;
      while (j + 1 < N && g.facing[j + 1] === g.facing[i]) j++;
      const a = Math.max(0, i - 1) * 2;
      const b = Math.min(N - 1, j) * 2 + 2;
      if (g.facing[i]) this.strip(this.vs(g.verts, a, b, () => [1, 1, 1, 1]), this.texF, false);
      else {
        const [tr, tg, tb] = sc.tint;
        this.strip(this.vs(g.verts, a, b, () => [tr / 255, tg / 255, tb / 255, 1]), null, true);
      }
      i = j + 1;
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.texF);
    gl.deleteTexture(this.texU);
    gl.deleteBuffer(this.buf);
    gl.deleteProgram(this.prog);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// ───────────── Canvas2D 降级 ─────────────
class Canvas2DRenderer implements CurlRenderer {
  readonly kind = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D;
  private f?: HTMLCanvasElement;
  private u?: HTMLCanvasElement;

  constructor(readonly canvas: HTMLCanvasElement, private w: number, private h: number, private dpr: number) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  setPages(f: HTMLCanvasElement, u: HTMLCanvasElement): void {
    this.f = f;
    this.u = u;
  }

  /** 三角形仿射贴图：把纹理里 (u,v) 三点映射到屏幕三点 */
  private tri(img: HTMLCanvasElement, a: Vtx, b: Vtx, c: Vtx, alpha: number): void {
    const ctx = this.ctx;
    const iw = img.width;
    const ih = img.height;
    const x0 = a.u * iw, y0 = a.v * ih, x1 = b.u * iw, y1 = b.v * ih, x2 = c.u * iw, y2 = c.v * ih;
    const det = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
    if (Math.abs(det) < 1e-6) return;
    const A = (a.x * (y1 - y2) + b.x * (y2 - y0) + c.x * (y0 - y1)) / det;
    const B = (a.y * (y1 - y2) + b.y * (y2 - y0) + c.y * (y0 - y1)) / det;
    const C = (a.x * (x2 - x1) + b.x * (x0 - x2) + c.x * (x1 - x0)) / det;
    const D = (a.y * (x2 - x1) + b.y * (x0 - x2) + c.y * (x1 - x0)) / det;
    const E = (a.x * (x1 * y2 - x2 * y1) + b.x * (x2 * y0 - x0 * y2) + c.x * (x0 * y1 - x1 * y0)) / det;
    const F = (a.y * (x1 * y2 - x2 * y1) + b.y * (x2 * y0 - x0 * y2) + c.y * (x0 * y1 - x1 * y0)) / det;
    ctx.save();
    ctx.beginPath();
    // 稍微外扩 0.5px，避免相邻三角形之间露缝
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const ex = (p: Vtx) => p.x + Math.sign(p.x - cx) * 0.5;
    const ey = (p: Vtx) => p.y + Math.sign(p.y - cy) * 0.5;
    ctx.moveTo(ex(a), ey(a));
    ctx.lineTo(ex(b), ey(b));
    ctx.lineTo(ex(c), ey(c));
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.transform(A, B, C, D, E, F);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    // 明暗
    const shade = (a.shade + b.shade + c.shade) / 3;
    if (shade < 0.999) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.6, 1 - shade) * alpha;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.fill();
      ctx.restore();
    }
  }

  private stripTris(img: HTMLCanvasElement, vs: Vtx[], from: number, to: number, alpha = 1): void {
    for (let i = from; i + 2 < to; i++) this.tri(img, vs[i], vs[i + 1], vs[i + 2], alpha);
  }

  private solidStrip(vs: Vtx[], from: number, to: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    for (let i = from; i + 2 < to; i++) {
      const a = vs[i], b = vs[i + 1], c = vs[i + 2];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  private shadow(list: ShadowV[]): void {
    const ctx = this.ctx;
    const sv = shadowVerts(list);
    for (let i = 0; i + 2 < sv.length; i++) {
      const a = sv[i], b = sv[i + 1], c = sv[i + 2];
      const inner = a.a >= b.a ? a : b;
      const outer = a.a >= b.a ? b : a;
      const g = ctx.createLinearGradient(inner.x, inner.y, outer.x, outer.y);
      g.addColorStop(0, `rgba(0,0,0,${Math.max(a.a, b.a, c.a)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  draw(sc: CurlScene): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.drawImage(this.u!, 0, 0, this.w, this.h);
    const m = sc.mesh;
    if (sc.google) {
      const g = sc.google;
      let i = 0;
      const N = g.facing.length;
      while (i < N) {
        let j = i;
        while (j + 1 < N && g.facing[j + 1] === g.facing[i]) j++;
        const a = Math.max(0, i - 1) * 2;
        const b = Math.min(N - 1, j) * 2 + 2;
        if (g.facing[i]) this.stripTris(this.f!, g.verts, a, b);
        else this.solidStrip(g.verts, a, b, `rgb(${sc.tint.map((x) => Math.round(x)).join(',')})`);
        i = j + 1;
      }
      return;
    }
    if (!m) {
      ctx.drawImage(this.f!, 0, 0, this.w, this.h);
      return;
    }
    this.shadow(m.dropShadow);
    this.stripTris(this.f!, m.verts, 0, m.front);
    const b0 = Math.max(0, m.front - 2);
    this.solidStrip(m.verts, b0, m.verts.length, `rgb(${sc.tint.map((x) => Math.round(x)).join(',')})`);
    this.stripTris(this.f!, m.verts, b0, m.verts.length, sc.backAlpha);
    // 背面的明暗
    this.shadow(m.selfShadow);
  }

  dispose(): void {
    this.f = undefined;
    this.u = undefined;
  }
}

/** 创建渲染器：WebGL 优先，失败（不支持/上下文丢失/纹理被污染）降级 Canvas2D。force 用于测试 */
export function createCurlRenderer(w: number, h: number, dpr: number, force?: 'canvas2d'): CurlRenderer {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;z-index:50;pointer-events:none`;
  if (force !== 'canvas2d') {
    try {
      return new GLRenderer(canvas, w, h);
    } catch {
      /* 降级 */
    }
    // 上下文已经被 getContext('webgl') 占用，再取 2d 需要新 canvas
    const c2 = document.createElement('canvas');
    c2.width = canvas.width;
    c2.height = canvas.height;
    c2.style.cssText = canvas.style.cssText;
    return new Canvas2DRenderer(c2, w, h, dpr);
  }
  return new Canvas2DRenderer(canvas, w, h, dpr);
}
