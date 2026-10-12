// woometer.com/woo: a slow psychedelic "mind expanse" field to experiment on.
// One GPU shader paints a glowing kaleidoscopic mandala that you drift into,
// endlessly and slowly, with rainbow filigree, a breathing light at its heart
// and a third eye that opens near the top of the reveal. The header slider (or
// your real share of claims answered) sets how much of it is revealed. With
// reduced motion it holds one still frame.
(() => {
  const canvas = document.getElementById("field");
  if (!canvas) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  // How much of the field is revealed, 0 to 1: your real share of claims
  // answered, until the header slider pretends otherwise. The header's stars
  // follow the slider too.
  let reveal = 0;
  const slider = document.getElementById("reveal");
  const readout = document.getElementById("reveal-out");
  try {
    const saved = JSON.parse(localStorage.getItem("woometer.answers.v1")) || {};
    const ids = new Set(CLAIMS.map((c) => c.id));
    reveal = Object.keys(saved).filter((id) => ids.has(id)).length / CLAIMS.length;
  } catch {
    // No saved answers: start from nothing.
  }
  let render = () => {};
  function setReveal(pct, fromSlider) {
    reveal = pct / 100;
    readout.textContent = `${pct % 1 ? pct.toFixed(1) : pct}%`;
    if (!fromSlider) slider.value = pct;
    if (fromSlider) {
      const n = Math.round(reveal * CLAIMS.length);
      window.dispatchEvent(new CustomEvent("woometer:sky-preview", { detail: { ids: CLAIMS.slice(0, n).map((c) => c.id) } }));
    }
    if (still.matches) render();
  }
  setReveal(Math.round(reveal * 200) / 2, false);
  slider.addEventListener("input", () => setReveal(Number(slider.value), true));

  const gl = canvas.getContext("webgl", { antialias: false });
  if (!gl) return; // the dark field stays as it is

  const VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
  const FRAG = `
    precision highp float;
    uniform vec2 res;
    uniform float t;
    uniform float rev;
    const float TAU = 6.2831853;

    // A vivid neon rainbow, shifted by x.
    vec3 rainbow(float x) {
      vec3 c = 0.5 + 0.5 * cos(TAU * (x + vec3(0.0, 0.33, 0.67)));
      return pow(c, vec3(1.6)) * 1.3;
    }

    // The lace: a kaleidoscopic fold of the plane, repeated. Each pass leaves
    // a thin glowing line along its creases; more passes, finer lace.
    vec3 lace(vec2 q, float depth, float passes, float fw) {
      vec3 col = vec3(0.0);
      vec2 z = q;
      vec2 c = vec2(0.86 + 0.05 * sin(t * 0.011), 0.52 + 0.05 * cos(t * 0.009));
      for (int i = 0; i < 8; i++) {
        if (float(i) >= passes) break;
        // Each fold also stretches the pixel's footprint by the same amount.
        float k = clamp(dot(z, z), 0.12, 6.0);
        z = abs(z) / k - c;
        fw /= k;
        // Lines never get thinner than a pixel can show: where the pattern is
        // finer than the screen (towards the heart, and in the deepest
        // passes) they widen and dim into a soft haze instead of static.
        float w = max(0.03, fw * 1.5);
        float crease = min(abs(z.x), abs(z.y));
        float line = exp(-crease / w) * (0.03 / w);
        float ring = exp(-abs(length(z) - 0.7) / (w * 1.3)) * (0.03 / w);
        col += rainbow(float(i) * 0.13 + depth * 0.22 + t * 0.004) * (line * 0.7 + ring * 0.25) * (1.0 - float(i) * 0.1);
      }
      return col;
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy - 0.5 * res) / min(res.x, res.y);
      float r = length(uv);
      float a = atan(uv.y, uv.x);

      // Kaleidoscope: 6 mirrored segments at first, up to 12 at full reveal.
      float seg = 6.0 + 2.0 * floor(rev * 3.0 + 0.001);
      float s = TAU / seg;
      float fa = abs(mod(a + t * 0.003, s) - 0.5 * s);

      // Drift inward forever: the log of the radius slides slowly with time,
      // so the pattern keeps unfolding from the centre outward.
      float depth = log(r + 0.0001) - t * 0.012;
      vec2 q = vec2((fract(depth * 0.55) - 0.5) * 2.4, fa * 2.6);
      // How much of the lace one pixel covers: the closer to the heart, the
      // more the pattern is squeezed into each pixel.
      float fw = 1.4 / (max(r, 0.001) * min(res.x, res.y));
      float passes = 3.0 + floor(rev * 5.0 + 0.001);
      vec3 col = lace(q, depth, passes, fw) * (0.04 + 1.0 * pow(rev, 1.4));

      // A finer second veil turning the other way, only once things open up.
      float fb = abs(mod(a - t * 0.005, s) - 0.5 * s);
      vec2 q2 = vec2((fract(depth * 0.55 + 0.5) - 0.5) * 2.4, fb * 2.6) * 1.25;
      col += smoothstep(0.35, 1.0, rev) * 0.5 * lace(q2, depth + 0.5, passes - 1.0, fw * 1.25);

      // The lace fades into a calm, dark heart, and is a little softer in the
      // far corners.
      col *= smoothstep(0.03, 0.22, r) * (1.0 - 0.5 * smoothstep(0.7, 1.3, r));

      // At the heart: one small, breathing point of white light with a thin
      // halo, and fine rays reaching out between the mirrored segments.
      float breath = 0.5 + 0.5 * sin(t * TAU / 9.0);
      float rays = pow(abs(cos(fa * seg * 0.5 + 1.5708)), 40.0) * exp(-r * 6.0) * smoothstep(0.01, 0.06, r);
      col += rainbow(t * 0.01 + r * 2.0) * rays * 0.25 * rev;
      col += vec3(0.8, 0.7, 1.0) * exp(-abs(r - 0.035) * 140.0) * (0.1 + 0.15 * breath) * rev;
      col += vec3(1.0, 0.96, 1.0) * exp(-r * 140.0) * (0.35 + 0.25 * breath) * (0.4 + 0.6 * rev);

      // Near full reveal, a third eye glows open above the heart.
      float eyeOpen = smoothstep(0.8, 1.0, rev);
      vec2 e = uv - vec2(0.0, 0.32);
      float span = clamp(1.0 - pow(e.x / 0.24, 2.0), 0.0, 1.0);
      float lid = abs(abs(e.y) - 0.075 * span);
      col += vec3(0.8, 0.65, 1.0) * exp(-lid * 160.0) * step(abs(e.x), 0.24) * eyeOpen;
      col += rainbow(t * 0.02 + r) * exp(-length(e) * 28.0) * 1.2 * eyeOpen;

      col = 1.0 - exp(-col * 1.2);
      col += vec3(0.035, 0.02, 0.06) * (1.0 - r * 0.7); // the field's own dark violet
      gl_FragColor = vec4(col, 1.0);
    }`;

  function shader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(program, "res");
  const uT = gl.getUniformLocation(program, "t");
  const uRev = gl.getUniformLocation(program, "rev");

  // Start part-way in so the field is already unfolding.
  const t0 = performance.now() - 60000;
  render = () => {
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uT, still.matches ? 60 : (performance.now() - t0) / 1000);
    gl.uniform1f(uRev, reveal);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  function resize() {
    // Phones get a slightly softer resolution to stay cool and smooth.
    const dpr = Math.min(window.devicePixelRatio || 1, innerWidth < 700 ? 1.5 : 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    render();
  }

  let running = false;
  function frame() {
    render();
    if (!still.matches && !document.hidden) requestAnimationFrame(frame);
    else running = false;
  }
  function run() {
    if (running || still.matches || document.hidden) return;
    running = true;
    requestAnimationFrame(frame);
  }

  new ResizeObserver(resize).observe(canvas);
  document.addEventListener("visibilitychange", run);
  resize();
  run();
})();
