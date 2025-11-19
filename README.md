# CoK – Canvas on Kanvas

`CoK` is a tiny JS helper that lets you keep drawing on a normal 2D `<canvas>` while a WebGL canvas sits on top and treats your 2D content as a texture.  
You still click and interact with the 2D canvas; the WebGL layer is purely visual.

---

## 1. Usage

### 1.1. Setup

```html
<!-- Your base 2D canvas -->
<canvas id="base2d" width="800" height="600"></canvas>

<script type="module">
  import { CoK } from "./CoK.js";

  const canvas2d = document.getElementById("base2d");
  const cok = new CoK(canvas2d);

  // Draw as usual on 2D
  const ctx = cok.ctx2d;
  ctx.fillStyle = "red";
  ctx.fillRect(50, 50, 200, 200);
  ctx.fillStyle = "white";
  ctx.font = "30px sans-serif";
  ctx.fillText("Hello 2D", 70, 120);

  // Push current 2D pixels to WebGL and render
  cok.render();

  // Pointer events still land on the 2D canvas
  canvas2d.addEventListener("click", (e) => {
    console.log("2D canvas clicked:", e.offsetX, e.offsetY);
  });
</script>
```

What this gives you:

- You draw into `cok.ctx2d` exactly like a regular 2D canvas.
- A WebGL canvas of the same size is created and positioned *on top*.
- That WebGL canvas shows a textured quad using the 2D canvas as its texture.
- Pointer/mouse events still go to the original 2D canvas underneath.

### 1.2. Updating the WebGL view

Any time you change the 2D canvas and want the WebGL view to reflect it:

```js
// After drawing to cok.ctx2d:
cok.render(); // = updateTexture() + draw()
```

If you need finer control:

```js
cok.updateTexture(); // copy 2D canvas -> WebGL texture
cok.draw();          // draw the textured quad
```

### 1.3. Applying a custom fragment shader

You can plug in your own fragment shader using `setFragmentShader`.  
Your shader must use:

- `varying vec2 v_texCoord;`
- `uniform sampler2D u_texture;`

Example: pixelation shader (with block size + resolution uniforms):

```js
const pixelationFs = `
precision mediump float;

varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform float u_blockSize;   // e.g. 4.0, 8.0, 16.0...
uniform vec2  u_resolution;  // canvas width / height in pixels

void main(void) {
    vec2 pixelPos = v_texCoord * u_resolution;
    vec2 blockPos = floor(pixelPos / u_blockSize) * u_blockSize;
    vec2 snappedUV = blockPos / u_resolution;
    gl_FragColor = texture2D(u_texture, snappedUV);
}
`;

// Install shader
cok.setFragmentShader(pixelationFs);

// Set uniforms
const gl  = cok.gl;
const prog = cok.program;
gl.useProgram(prog);

const uBlockSizeLoc = gl.getUniformLocation(prog, "u_blockSize");
const uResolutionLoc = gl.getUniformLocation(prog, "u_resolution");

gl.uniform1f(uBlockSizeLoc, 8.0);
gl.uniform2f(uResolutionLoc, cok.canvas2d.width, cok.canvas2d.height);

// Re-render
cok.render();
```

You can also pass a custom vertex shader as the second argument if you need more control:

```js
cok.setFragmentShader(fragmentSource, vertexSource);
```

If you omit `vertexSource`, CoK uses its default fullscreen-quad vertex shader.

### 1.4. Cleaning up

If you want to tear everything down and restore the original DOM layout:

```js
cok.destroy();
```

This removes the WebGL overlay and unwraps the 2D canvas from the wrapper element.

---

## 2. Technical Background / Internals

This section explains what happens under the hood and what each important piece does.

### 2.1. High-level architecture

1. **Wrapping the original 2D canvas**  
   The constructor wraps your `<canvas>` in a `div` with `position: relative` and `display: inline-block`.  
   This wrapper becomes the stacking context for the WebGL overlay.

2. **Creating the WebGL overlay**  
   A new `<canvas>` is created:
   - Same *internal* resolution (`width`/`height`) as the 2D canvas.
   - Absolutely positioned (`position: absolute; top: 0; left: 0; width: 100%; height: 100%`).
   - `pointer-events: none`, so all mouse/touch input still goes to the underlying 2D canvas.

3. **WebGL texture from 2D canvas**  
   The 2D canvas is bound as a texture (`TEXTURE_2D`) and uploaded using `texImage2D`.  
   Whenever you call `updateTexture()` or `render()`, CoK reuploads the current pixels.

4. **Fullscreen quad**  
   CoK draws a full-screen triangle strip/quad in clip space from `(-1,-1)` to `(1,1)` and samples the 2D texture at interpolated UVs.  
   By default the fragment shader just draws the texture unchanged, but you can replace it with your own shader.

### 2.2. Public API

These are the main things you use directly:

- `new CoK(canvas2dElm)`  
  - `canvas2dElm`: an existing `HTMLCanvasElement` with a 2D context.  
  - Side effects:
    - Wraps the canvas in a positioned `div`.
    - Creates an overlay WebGL canvas (same size).
    - Builds the WebGL program and buffers.
    - Uploads the current 2D pixels and does an initial render.

- `cok.ctx2d`  
  - The underlying `CanvasRenderingContext2D` from the original canvas.  
  - You draw into this like a normal 2D canvas; CoK never interferes with the 2D API itself.

- `cok.gl`  
  - The `WebGLRenderingContext` of the overlay canvas.  
  - Available if you want to do more advanced uniform setup, custom buffers, etc.

- `cok.program`  
  - The currently active WebGL program used for the fullscreen quad.  
  - Updated whenever `setFragmentShader` is called.

- `cok.setFragmentShader(fragmentSource, vertexSource?)`  
  - Compiles and links a new program from the given sources.
  - If `vertexSource` is omitted, CoK uses a built-in full-screen vertex shader:
    - Exposes `a_position` and `a_texCoord` attributes.
    - Outputs `v_texCoord` for the fragment shader.
  - After linking:
    - Deletes the old program (if any).
    - Looks up `a_position`, `a_texCoord`, and `u_texture` locations and stores them.

- `cok.updateTexture()`  
  - Calls `gl.texImage2D` on the existing texture with the current 2D canvas.
  - You typically call this after drawing to `ctx2d`.

- `cok.draw()`  
  - Sets the viewport to match the WebGL canvas size.
  - Clears the color buffer (transparent black).
  - Binds position and texcoord buffers, enables attributes, binds the texture, sets `u_texture`, and draws the fullscreen quad with `drawArrays(TRIANGLES, 0, 6)`.

- `cok.render()`  
  - Convenience wrapper: `updateTexture()` followed by `draw()`.

- `cok.destroy()`  
  - Deletes GL resources (texture, buffers, program).
  - Removes the WebGL canvas from the DOM.
  - Moves the original 2D canvas out of the wrapper and removes the wrapper, restoring a simpler DOM structure.

### 2.3. Important internal helpers

These are internal, but understanding them helps if you want to extend CoK.

- `_setupWrapper()`  
  - Creates a `div` wrapper around the 2D canvas.
  - Sets `position: relative` and dimensions based on the canvas.
  - Ensures the 2D canvas fills the wrapper and is clickable (`pointer-events: auto`).

- `_createWebGLCanvas()`  
  - Creates the overlay canvas and appends it to the wrapper.
  - Requests a WebGL context with `{ alpha: true }` (you can change this to `{ antialias: false }` etc. if needed).
  - Stores `this.glCanvas` and `this.gl`.

- `_initWebGL()`  
  - Stores default shader sources (vertex + fragment).
  - Calls `_buildAndUseProgram` to compile and link them.
  - Sets up position and texcoord buffers for a fullscreen quad:
    - `a_position` covers clip space.
    - `a_texCoord` covers `[0,1]` UV space.
  - Creates a texture and uploads the initial 2D canvas content.
  - Calls `_resizeGLViewport` to sync viewport with the canvas size.

- `_compileShader(type, source)`  
  - Compiles a shader and throws a JS `Error` on failure with the compile log.

- `_buildAndUseProgram(vsSource, fsSource)`  
  - Compiles the vertex and fragment shaders.
  - Links a program, deletes the shaders, and swaps it into `this.program`.
  - Looks up attribute/uniform locations:
    - `a_position`
    - `a_texCoord`
    - `u_texture`

- `_resizeGLViewport()`  
  - Keeps `glCanvas.width/height` in sync with `canvas2d.width/height`.
  - Calls `gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)`.

### 2.4. Pointer event behavior

The overlay WebGL canvas uses:

```css
pointer-events: none;
```

So:

- Mouse / touch events go straight through to the 2D canvas.
- You can attach listeners to the original canvas and treat it like a normal interactive surface.
- The WebGL layer is purely visual and does not intercept input.

If you ever want WebGL to intercept events instead, you can flip the flags:

- Set `glCanvas.style.pointerEvents = "auto"`.
- Set `canvas2d.style.pointerEvents = "none"`.

---

That’s the core of CoK: draw in 2D, see it as a texture in WebGL, and plug in whatever fragment shader magic you want on top.
