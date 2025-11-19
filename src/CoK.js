// CoK.js
export class CoK {
    /**
     * @param {HTMLCanvasElement} canvas2dElm - Existing 2D canvas element.
     */
    constructor(canvas2dElm) {
        if (!(canvas2dElm instanceof HTMLCanvasElement)) {
            throw new Error("CoK constructor expects an HTMLCanvasElement.");
        }

        this.canvas2d = canvas2dElm;
        this.ctx2d = this.canvas2d.getContext("2d");
        if (!this.ctx2d) {
            throw new Error("Failed to get 2D context from the provided canvas.");
        }

        this._setupWrapper();
        this._createWebGLCanvas();
        this._initWebGL();
        this.render();
    }

    _setupWrapper() {
        const canvas = this.canvas2d;
        const parent = canvas.parentNode;

        const wrapper = document.createElement("div");
        wrapper.style.position = "relative";
        wrapper.style.display = "inline-block";
        wrapper.style.width = canvas.style.width || canvas.width + "px";
        wrapper.style.height = canvas.style.height || canvas.height + "px";

        if (parent) parent.insertBefore(wrapper, canvas);
        wrapper.appendChild(canvas);

        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.pointerEvents = "auto"; // receives clicks

        this.wrapper = wrapper;
    }

    _createWebGLCanvas() {
        const glCanvas = document.createElement("canvas");
        glCanvas.width = this.canvas2d.width;
        glCanvas.height = this.canvas2d.height;

        glCanvas.style.position = "absolute";
        glCanvas.style.left = "0";
        glCanvas.style.top = "0";
        glCanvas.style.width = "100%";
        glCanvas.style.height = "100%";
        glCanvas.style.pointerEvents = "none"; // let clicks go through to 2D canvas

        this.wrapper.appendChild(glCanvas);
        this.glCanvas = glCanvas;

        const gl =
            glCanvas.getContext("webgl", { alpha: true, antialias: true}) ||
            glCanvas.getContext("experimental-webgl", { alpha: true, antialias: true });

        if (!gl) throw new Error("WebGL is not supported on this browser.");

        this.gl = gl;
    }

    _initWebGL() {
        const gl = this.gl;

        // Save default shaders so we can reuse the vertex shader when swapping fragment shaders.
        this._defaultVertexSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main(void) {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        this._defaultFragmentSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_texture;
            void main(void) {
                gl_FragColor = texture2D(u_texture, v_texCoord);
            }
        `;

        // Build initial program.
        this._buildAndUseProgram(
            this._defaultVertexSource,
            this._defaultFragmentSource
        );

        // Fullscreen quad positions in clip space.
        const positions = new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0,
        ]);

        const texCoords = new Float32Array([
            0.0, 0.0,
            1.0, 0.0,
            0.0, 1.0,
            0.0, 1.0,
            1.0, 0.0,
            1.0, 1.0,
        ]);

        // Position buffer
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        this.positionBuffer = positionBuffer;

        // Texcoord buffer
        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
        this.texCoordBuffer = texCoordBuffer;

        // Texture from 2D canvas.
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            this.canvas2d
        );

        this.texture = texture;

        this._resizeGLViewport();
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error("Failed to compile shader: " + info);
        }
        return shader;
    }

    _buildAndUseProgram(vsSource, fsSource) {
        const gl = this.gl;

        const vertexShader = this._compileShader(gl.VERTEX_SHADER, vsSource);
        const fragmentShader = this._compileShader(gl.FRAGMENT_SHADER, fsSource);

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error("Failed to link WebGL program: " + info);
        }

        // If we already had a program, nuke it.
        if (this.program) {
            gl.deleteProgram(this.program);
        }

        this.program = program;
        this.a_position = gl.getAttribLocation(program, "a_position");
        this.a_texCoord = gl.getAttribLocation(program, "a_texCoord");
        this.u_texture = gl.getUniformLocation(program, "u_texture");
    }

    _resizeGLViewport() {
        const gl = this.gl;

        if (this.glCanvas.width !== this.canvas2d.width ||
            this.glCanvas.height !== this.canvas2d.height) {
            this.glCanvas.width = this.canvas2d.width;
            this.glCanvas.height = this.canvas2d.height;
        }

        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }

    /**
     * Public API: set a custom fragment shader.
     *
     * @param {string} fragmentSource - GLSL fragment shader source.
     *        Must declare:
     *          varying vec2 v_texCoord;
     *          uniform sampler2D u_texture;
     *        And output gl_FragColor.
     *
     * @param {string} [vertexSource] - Optional vertex shader source.
     *        If omitted, the built-in fullscreen quad vertex shader is used.
     */
    setFragmentShader(fragmentSource, vertexSource) {
        const vs = vertexSource || this._defaultVertexSource;
        this._buildAndUseProgram(vs, fragmentSource);
    }

    /**
     * Upload current 2D canvas pixels into the WebGL texture.
     */
    updateTexture() {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            this.canvas2d
        );
    }

    /**
     * Draw the fullscreen textured quad.
     */
    draw() {
        const gl = this.gl;
        this._resizeGLViewport();

        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        // Positions
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.a_position);
        gl.vertexAttribPointer(this.a_position, 2, gl.FLOAT, false, 0, 0);

        // Texcoords
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(this.a_texCoord);
        gl.vertexAttribPointer(this.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        // Texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(this.u_texture, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    /**
     * Convenience: update texture from 2D canvas and draw it.
     */
    render() {
        this.updateTexture();
        this.draw();
    }

    destroy() {
        const gl = this.gl;
        if (gl) {
            if (this.texture) gl.deleteTexture(this.texture);
            if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
            if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
            if (this.program) gl.deleteProgram(this.program);
        }

        if (this.glCanvas && this.glCanvas.parentNode === this.wrapper) {
            this.wrapper.removeChild(this.glCanvas);
        }

        if (this.wrapper && this.wrapper.parentNode) {
            const parent = this.wrapper.parentNode;
            parent.insertBefore(this.canvas2d, this.wrapper);
            parent.removeChild(this.wrapper);
        }

        this.gl = null;
        this.glCanvas = null;
        this.wrapper = null;
    }
}
