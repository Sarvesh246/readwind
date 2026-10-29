/** Cylinder-deformed paper, progressively enhanced over the CSS leaf. */
import { toCanvas } from "html-to-image";
export type CurlRenderer = {
  draw: (progress: number, pointerY: number) => void;
  dispose: () => void;
};
export async function paperCurl(
  box: HTMLElement,
  leaf: HTMLElement,
  options: {
    width: number;
    height: number;
    pageWidth: number;
    spread: boolean;
    backward: boolean;
  },
): Promise<CurlRenderer | null> {
  const canvas = document.createElement("canvas"),
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
  if (!gl) return null;
  try {
    const pages = leaf.querySelectorAll<HTMLElement>(".book-page");
    if (pages.length < 2) return null;
    const [front, back] = await Promise.all(
      [...pages].map((p) =>
        toCanvas(p, {
          pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
          cacheBust: false,
          skipAutoScale: true,
        }),
      ),
    );
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(options.width * dpr);
    canvas.height = Math.round(options.height * dpr);
    canvas.className = "webgl-curl";
    canvas.setAttribute("aria-hidden", "true");
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error("Paper shader unavailable");
      return s;
    };
    const vs = shader(
      gl.VERTEX_SHADER,
      `
 attribute vec2 a_uv; varying vec2 v_uv; varying float v_shade;
 uniform float u_p; uniform float u_ratio; uniform float u_backward; uniform float u_tilt;
 void main(){
  float pi=3.14159265;float s=sin(u_p*pi);float tilt=u_tilt*(a_uv.y-.5)*s;
  float axis=a_uv.x+tilt;float edge=1.-u_p;float radius=.001+.15*s;
  float dist=max(0.,axis-edge);float theta=min(pi,dist/radius);
  float x=min(axis,edge)+radius*sin(theta)-max(0.,dist-pi*radius)-tilt;
  float z=radius*(1.-cos(theta));float y=a_uv.y;
  float worldX=mix(1.+x,1.-x,u_backward);
  if(u_ratio<1.5)worldX=mix(x,1.-x,u_backward);
  float perspective=1./(1.-z*.2);float clipX=(worldX/u_ratio*2.-1.)*perspective;
  gl_Position=vec4(clipX,(1.-y*2.)*perspective,-z*.25,1.);
  v_uv=vec2(mix(a_uv.x,1.-a_uv.x,u_backward),a_uv.y);v_shade=abs(sin(theta))*.12;
 }`,
    );
    const fs = shader(
      gl.FRAGMENT_SHADER,
      `
 precision mediump float; varying vec2 v_uv; varying float v_shade;
 uniform sampler2D u_front;uniform sampler2D u_back;uniform float u_backward;
 void main(){vec4 color=(gl_FrontFacing != (u_backward>.5))?texture2D(u_front,v_uv):texture2D(u_back,vec2(1.-v_uv.x,v_uv.y));color.rgb=mix(color.rgb,vec3(.157,.110,.055),v_shade);gl_FragColor=color;}`,
    );
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    const positions: number[] = [],
      nx = 72,
      ny = 18;
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const a = [x / nx, y / ny],
          b = [(x + 1) / nx, y / ny],
          c = [x / nx, (y + 1) / ny],
          d = [(x + 1) / nx, (y + 1) / ny];
        positions.push(...a, ...c, ...b, ...b, ...c, ...d);
      }
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    const uv = gl.getAttribLocation(program, "a_uv");
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
    const textures = [front, back].map((image, i) => {
      const texture = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
      return texture;
    });
    gl.uniform1i(gl.getUniformLocation(program, "u_front"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "u_back"), 1);
    gl.uniform1f(
      gl.getUniformLocation(program, "u_ratio"),
      options.spread ? 2 : 1,
    );
    gl.uniform1f(
      gl.getUniformLocation(program, "u_backward"),
      options.backward ? 1 : 0,
    );
    const progress = gl.getUniformLocation(program, "u_p"),
      tilt = gl.getUniformLocation(program, "u_tilt");
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    box.appendChild(canvas);
    leaf.style.visibility = "hidden";
    let disposed = false;
    return {
      draw(p, pointerY) {
        if (disposed) return;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(progress, p);
        gl.uniform1f(tilt, Math.max(-0.5, Math.min(0.5, pointerY - 0.5)));
        gl.drawArrays(gl.TRIANGLES, 0, positions.length / 2);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        canvas.remove();
        leaf.style.visibility = "";
        for (const t of textures) gl.deleteTexture(t);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      },
    };
  } catch {
    canvas.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
}
