/**
 * WebGL-based renderer for cepstral coefficients
 * High-performance solution for rendering live spectrograms
 */
export class WebGLSpectrogramRenderer {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    
    // Try to get WebGL context with various options for better compatibility
    try {
      this.gl = canvasElement.getContext('webgl', { 
        alpha: false,
        antialias: false,
        powerPreference: 'high-performance'
      }) || canvasElement.getContext('experimental-webgl');
      
      if (!this.gl) {
        throw new Error('WebGL not supported');
      }
    } catch (e) {
      console.error('WebGL initialization failed:', e);
      throw new Error('Failed to initialize WebGL: ' + e.message);
    }
    
    // Default options
    this.options = {
      coefficientCount: 13,          // Default MFCCs count
      historyLength: 100,            // Number of frames to show
      colorLow: [0, 0, 1, 1],        // Blue for low values (RGBA)
      colorMid: [0, 1, 0, 1],        // Green for mid values (RGBA)
      colorHigh: [1, 0, 0, 1],       // Red for high values (RGBA)
      minValue: -100,                // Min expected coefficient value
      maxValue: 100,                 // Max expected coefficient value
      normalizeFunction: null,       // Optional custom normalization function
      ...options
    };
    
    // Flag for texture type (set in initTexture)
    this.useUint8 = false;
    
    // Initialize data storage
    this.data = new Float32Array(this.options.coefficientCount * this.options.historyLength);
    
    // Initialize with zeros (important for the column-based approach)
    for (let i = 0; i < this.data.length; i++) {
      this.data[i] = 0;
    }
    this.dataTexture = null;
    
    // Initialize WebGL
    this.initShaders();
    this.initBuffers();
    this.initTexture();
    
    // Set initial viewport
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    
    // Animation frame tracking
    this.animationFrameId = null;
    this.lastFrameTime = 0;
    this.frameInterval = 1000 / 30; // Default to 30fps
  }
  
  /**
   * Initialize WebGL shaders
   */
  initShaders() {
    // Vertex shader - positions the quad for rendering
    const vsSource = `
      attribute vec4 aVertexPosition;
      attribute vec2 aTextureCoord;
      varying highp vec2 vTextureCoord;
      void main(void) {
        gl_Position = aVertexPosition;
        vTextureCoord = aTextureCoord;
      }
    `;

    // Fragment shader - colors pixels based on data values
    const fsSource = `
      precision mediump float;
      varying highp vec2 vTextureCoord;
      uniform sampler2D uSampler;
      uniform vec4 uColorLow;
      uniform vec4 uColorMid;
      uniform vec4 uColorHigh;
      uniform float uMinValue;
      uniform float uMaxValue;
      
      void main(void) {
        float value = texture2D(uSampler, vTextureCoord).r;
        
        // Normalize the value
        float normalizedValue = (value - uMinValue) / (uMaxValue - uMinValue);
        normalizedValue = clamp(normalizedValue, 0.0, 1.0);
        
        // Calculate color using gradient between low, mid, and high colors
        vec4 color;
        if (normalizedValue < 0.5) {
          // Blend from low to mid
          color = mix(uColorLow, uColorMid, normalizedValue * 2.0);
        } else {
          // Blend from mid to high
          color = mix(uColorMid, uColorHigh, (normalizedValue - 0.5) * 2.0);
        }
        
        gl_FragColor = color;
      }
    `;

    // Compile shaders
    const vertexShader = this.compileShader(vsSource, this.gl.VERTEX_SHADER);
    const fragmentShader = this.compileShader(fsSource, this.gl.FRAGMENT_SHADER);
    
    // Create shader program
    this.shaderProgram = this.gl.createProgram();
    this.gl.attachShader(this.shaderProgram, vertexShader);
    this.gl.attachShader(this.shaderProgram, fragmentShader);
    this.gl.linkProgram(this.shaderProgram);
    
    if (!this.gl.getProgramParameter(this.shaderProgram, this.gl.LINK_STATUS)) {
      throw new Error(`Unable to initialize the shader program: ${this.gl.getProgramInfoLog(this.shaderProgram)}`);
    }
    
    // Get attribute and uniform locations
    this.programInfo = {
      program: this.shaderProgram,
      attribLocations: {
        vertexPosition: this.gl.getAttribLocation(this.shaderProgram, 'aVertexPosition'),
        textureCoord: this.gl.getAttribLocation(this.shaderProgram, 'aTextureCoord'),
      },
      uniformLocations: {
        uSampler: this.gl.getUniformLocation(this.shaderProgram, 'uSampler'),
        uColorLow: this.gl.getUniformLocation(this.shaderProgram, 'uColorLow'),
        uColorMid: this.gl.getUniformLocation(this.shaderProgram, 'uColorMid'),
        uColorHigh: this.gl.getUniformLocation(this.shaderProgram, 'uColorHigh'),
        uMinValue: this.gl.getUniformLocation(this.shaderProgram, 'uMinValue'),
        uMaxValue: this.gl.getUniformLocation(this.shaderProgram, 'uMaxValue'),
      },
    };
  }
  
  /**
   * Helper method to compile a shader
   */
  compileShader(source, type) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`Error compiling shader: ${info}`);
    }
    
    return shader;
  }
  
  /**
   * Initialize vertex and texture coordinate buffers
   */
  initBuffers() {
    // Create buffers for a full-screen quad
    const positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    
    // Positions for a quad covering the entire viewport (-1 to 1 in clip space)
    const positions = [
      -1.0,  1.0,
       1.0,  1.0,
      -1.0, -1.0,
       1.0, -1.0,
    ];
    
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(positions), this.gl.STATIC_DRAW);
    
    // Create buffer for texture coordinates
    const textureCoordBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, textureCoordBuffer);
    
    // Texture coordinates for the quad - flipped horizontally to show newer data on the right
    const textureCoordinates = [
      1.0, 0.0, // Top right (was top left)
      0.0, 0.0, // Top left (was top right) 
      1.0, 1.0, // Bottom right (was bottom left)
      0.0, 1.0, // Bottom left (was bottom right)
    ];
    
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(textureCoordinates), this.gl.STATIC_DRAW);
    
    // Store buffers for later use
    this.buffers = {
      position: positionBuffer,
      textureCoord: textureCoordBuffer,
    };
  }
  
  /**
   * Initialize the texture for holding coefficient data
   */
  initTexture() {
    this.dataTexture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.dataTexture);
    
    // Set texture parameters
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    
    // Check for floating point texture support
    const ext = this.gl.getExtension('OES_texture_float');
    if (!ext) {
      console.warn('OES_texture_float extension not supported. Falling back to UNSIGNED_BYTE.');
      
      // Convert Float32Array to Uint8Array (normalized to 0-255)
      const uint8Data = new Uint8Array(this.data.length);
      for (let i = 0; i < this.data.length; i++) {
        // Map 0-100 range to 0-255
        uint8Data[i] = Math.min(255, Math.max(0, Math.floor(this.data[i] * 2.55)));
      }
      
      // Initialize with UNSIGNED_BYTE type
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.LUMINANCE,
        this.options.historyLength,
        this.options.coefficientCount,
        0,
        this.gl.LUMINANCE,
        this.gl.UNSIGNED_BYTE,
        uint8Data
      );
      
      // Flag that we're using UNSIGNED_BYTE
      this.useUint8 = true;
    } else {
      // Use floating point textures
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.LUMINANCE,
        this.options.historyLength,
        this.options.coefficientCount,
        0,
        this.gl.LUMINANCE,
        this.gl.FLOAT,
        this.data
      );
      this.useUint8 = false;
    }
  }
  
  /**
   * Update the data with new coefficients
   * @param {Array|Float32Array} newCoefficients - Array of cepstral coefficients
   */
  updateData(newCoefficients) {
    if (newCoefficients.length !== this.options.coefficientCount) {
      console.warn(`Expected ${this.options.coefficientCount} coefficients, got ${newCoefficients.length}`);
      return;
    }
    
    // Completely restructure data handling for column-based progression
    
    // Create a 2D structure for easier manipulation
    const dataArray = [];
    for (let y = 0; y < this.options.coefficientCount; y++) {
      dataArray[y] = [];
      for (let x = 0; x < this.options.historyLength; x++) {
        dataArray[y][x] = this.data[y * this.options.historyLength + x];
      }
    }
    
    // Shift all columns to the left
    for (let y = 0; y < this.options.coefficientCount; y++) {
      for (let x = 0; x < this.options.historyLength - 1; x++) {
        dataArray[y][x] = dataArray[y][x + 1];
      }
    }
    
    // Add new coefficient values to the rightmost column
    for (let y = 0; y < this.options.coefficientCount; y++) {
      // Use reversed index to position C0 at the bottom
      const coeffIndex = this.options.coefficientCount - 1 - y;
      let value = newCoefficients[coeffIndex];
      
      // Apply custom normalization if provided
      if (this.options.normalizeFunction) {
        value = this.options.normalizeFunction(value, coeffIndex);
      }
      
      // Set the value in the rightmost column
      dataArray[y][this.options.historyLength - 1] = value;
    }
    
    // Flatten the 2D array back to 1D for WebGL
    for (let y = 0; y < this.options.coefficientCount; y++) {
      for (let x = 0; x < this.options.historyLength; x++) {
        this.data[y * this.options.historyLength + x] = dataArray[y][x];
      }
    }
    
    // Update the texture with new data
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.dataTexture);
    
    if (this.useUint8) {
      // Convert Float32Array to Uint8Array for compatibility
      const uint8Data = new Uint8Array(this.data.length);
      for (let i = 0; i < this.data.length; i++) {
        // Map normalized range to 0-255
        uint8Data[i] = Math.min(255, Math.max(0, Math.floor(this.data[i] * 2.55)));
      }
      
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.LUMINANCE,
        this.options.historyLength,
        this.options.coefficientCount,
        0,
        this.gl.LUMINANCE,
        this.gl.UNSIGNED_BYTE,
        uint8Data
      );
    } else {
      // Use floating point format if supported
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.LUMINANCE,
        this.options.historyLength,
        this.options.coefficientCount,
        0,
        this.gl.LUMINANCE,
        this.gl.FLOAT,
        this.data
      );
    }
  }
  
  /**
   * Render the spectrogram
   */
  render() {
    this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    
    // Use the shader program
    this.gl.useProgram(this.programInfo.program);
    
    // Set up vertex position attribute
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffers.position);
    this.gl.vertexAttribPointer(
      this.programInfo.attribLocations.vertexPosition,
      2, // 2 components per vertex
      this.gl.FLOAT,
      false,
      0,
      0
    );
    this.gl.enableVertexAttribArray(this.programInfo.attribLocations.vertexPosition);
    
    // Set up texture coordinate attribute
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffers.textureCoord);
    this.gl.vertexAttribPointer(
      this.programInfo.attribLocations.textureCoord,
      2, // 2 components per texture coord
      this.gl.FLOAT,
      false,
      0,
      0
    );
    this.gl.enableVertexAttribArray(this.programInfo.attribLocations.textureCoord);
    
    // Set uniforms for colors and value range
    this.gl.uniform4fv(this.programInfo.uniformLocations.uColorLow, this.options.colorLow);
    this.gl.uniform4fv(this.programInfo.uniformLocations.uColorMid, this.options.colorMid);
    this.gl.uniform4fv(this.programInfo.uniformLocations.uColorHigh, this.options.colorHigh);
    this.gl.uniform1f(this.programInfo.uniformLocations.uMinValue, this.options.minValue);
    this.gl.uniform1f(this.programInfo.uniformLocations.uMaxValue, this.options.maxValue);
    
    // Bind the texture
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.dataTexture);
    this.gl.uniform1i(this.programInfo.uniformLocations.uSampler, 0);
    
    // Draw the quad
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }
  
  /**
   * Start continuous rendering (will call updateData with the same data)
   */
  startRenderLoop() {
    if (this.animationFrameId) return;
    
    const renderLoop = (timestamp) => {
      this.animationFrameId = requestAnimationFrame(renderLoop);
      
      // Throttle to target frame rate
      const elapsed = timestamp - this.lastFrameTime;
      if (elapsed < this.frameInterval) return;
      
      this.lastFrameTime = timestamp - (elapsed % this.frameInterval);
      
      // Render the current state
      this.render();
    };
    
    this.lastFrameTime = performance.now();
    this.animationFrameId = requestAnimationFrame(renderLoop);
  }
  
  /**
   * Stop the continuous rendering loop
   */
  stopRenderLoop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
  
  /**
   * Update the renderer when canvas size changes
   */
  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
    this.render();
  }
  
  /**
   * Clean up WebGL resources
   */
  destroy() {
    this.stopRenderLoop();
    
    // Delete WebGL resources
    this.gl.deleteProgram(this.shaderProgram);
    this.gl.deleteBuffer(this.buffers.position);
    this.gl.deleteBuffer(this.buffers.textureCoord);
    this.gl.deleteTexture(this.dataTexture);
  }
}
