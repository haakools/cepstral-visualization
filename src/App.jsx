import { useState, useEffect, useRef } from 'react';
import { WebGLSpectrogramRenderer } from './webglRenderer';
import './App.css';

function App() {
  const [wasmModule, setWasmModule] = useState(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState(null);
  const [coefficients, setCoefficients] = useState(Array(13).fill(0));
  
  // Scaling thresholds for color transitions
  const [lowMidThreshold, setLowMidThreshold] = useState(35); // threshold between low (blue) and mid (green)
  const [midHighThreshold, setMidHighThreshold] = useState(65); // threshold between mid (green) and high (red)
  
  // Sensitivity controls for different coefficient bands
  const [sensitivityC0, setSensitivityC0] = useState(500);
  const [sensitivityC1, setSensitivityC1] = useState(150);
  const [sensitivityOthers, setSensitivityOthers] = useState(50);
  
  // Global scaling factor to adjust overall sensitivity
  const [globalScaling, setGlobalScaling] = useState(1.0);

  // Refs for audio processing
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const analyzerRef = useRef(null);
  const sourceRef = useRef(null);

  // Refs for WebGL rendering
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const processingLoopRef = useRef(null);

  async function loadWasm() {
    try {
      console.log('Starting WASM load...');
      const moduleFactory = await import('./wasm/signal_processor.js');
      const Module = await moduleFactory.default();

      processorRef.current = new Module.SignalProcessor();
      setWasmModule(Module);
      console.log('SignalProcessor created successfully');
    } catch (err) {
      console.error('WASM loading error:', err);
      setError('Failed to initialize audio processor: ' + err.message);
    }
  }

  // Initialize WASM module
  useEffect(() => {
    loadWasm();

    return () => {
      if (processorRef.current) {
        processorRef.current.delete();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (rendererRef.current) {
        rendererRef.current.destroy();
      }
      if (processingLoopRef.current) {
        cancelAnimationFrame(processingLoopRef.current);
      }
    };
  }, []);

  // Function to update the renderer with current visualization settings
  const updateRenderer = () => {
    if (!canvasRef.current) return;
    
    // Destroy existing renderer if it exists
    if (rendererRef.current) {
      rendererRef.current.destroy();
    }
    
    // Fixed colors for low, mid, high
    const colorLow = [0, 0, 0.8, 1]; // Blue
    const colorMid = [0, 0.8, 0, 1]; // Green
    const colorHigh = [0.8, 0, 0, 1]; // Red
    
    // Create new renderer with current settings
    rendererRef.current = new WebGLSpectrogramRenderer(canvasRef.current, {
      coefficientCount: 13,
      historyLength: 300,
      colorLow,
      colorMid,
      colorHigh,
      minValue: 0,
      maxValue: 100,
      // Threshold values used in the renderer
      thresholdLowMid: lowMidThreshold,
      thresholdMidHigh: midHighThreshold,
      normalizeFunction: (value, index) => {
        // Apply global scaling to all values
        value = value * globalScaling;
        
        if (index === 0) {
          // C0 (energy) with adjustable sensitivity
          return Math.min(Math.max((value / sensitivityC0 + 1) * 50, 0), 100);
        } else if (index === 1) {
          // C1 with adjustable sensitivity
          return Math.min(Math.max((value / sensitivityC1 + 1) * 50, 0), 100);
        } else {
          // Other coefficients with adjustable sensitivity
          return Math.min(Math.max((value / sensitivityOthers + 1) * 50, 0), 100);
        }
      }
    });
    
    // Start the render loop
    rendererRef.current.startRenderLoop();
    
    // Resize to fit container
    const container = canvasRef.current.parentElement;
    if (container) {
      const { width } = container.getBoundingClientRect();
      rendererRef.current.resize(width, canvasRef.current.height);
    }
  };

  // Initialize WebGL renderer once the canvas is available
  useEffect(() => {
    if (!canvasRef.current) return;

    try {
      console.log("Creating WebGL renderer...");
      // Create the WebGL renderer
      updateRenderer();
      console.log("WebGL Created.");

      // Handle window resize
      const handleResize = () => {
        if (rendererRef.current && canvasRef.current) {
          // Make it fill the container width
          const container = canvasRef.current.parentElement;
          if (container) {
            const { width } = container.getBoundingClientRect();
            rendererRef.current.resize(width, canvasRef.current.height);
          }
        }
      };

      window.addEventListener('resize', handleResize);

      // Initial size adjustment (after a short delay to ensure container is sized)
      setTimeout(handleResize, 100);

      return () => {
        window.removeEventListener('resize', handleResize);
      };
    } catch (err) {
      console.error('Failed to initialize WebGL renderer:', err);
      setError('WebGL initialization failed: ' + err.message);
    }
  }, [canvasRef]);

  // Effect to update renderer when visualization settings change
  useEffect(() => {
    if (rendererRef.current) {
      updateRenderer();
    }
  }, [lowMidThreshold, midHighThreshold, sensitivityC0, sensitivityC1, sensitivityOthers, globalScaling]);

  // Effect to handle the audio processing loop separately from the state
  useEffect(() => {
    // Start audio processing when component mounts
    if (isProcessing && !processingLoopRef.current) {
      startProcessing();
    }

    // Clean up processing loop when component unmounts
    return () => {
      if (processingLoopRef.current) {
        cancelAnimationFrame(processingLoopRef.current);
        processingLoopRef.current = null;
      }
    };
  }, [isProcessing]);

  const startProcessing = async () => {
    if (!wasmModule || !rendererRef.current) {
      console.log('No WASM module or renderer available');
      return;
    }

    try {
      // Only set up audio context if not already set up
      if (!audioContextRef.current) {
        console.log('Requesting microphone access...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Got microphone stream');

        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        console.log('Created audio context');

        sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
        console.log('Created media stream source');

        analyzerRef.current = audioContextRef.current.createAnalyser();
        console.log('Created analyzer');

        analyzerRef.current.fftSize = 2048;
        sourceRef.current.connect(analyzerRef.current);
        console.log('Connected source to analyzer');
      }

      // Set processing state
      setIsProcessing(true);
      console.log('Starting audio processing');

      // Define the processing loop outside of React state updates
      const processLoop = () => {
        // Always continue the loop unless component is unmounted
        processingLoopRef.current = requestAnimationFrame(processLoop);

        // Skip processing if we're not supposed to be processing
        if (!isProcessing) return;

        try {
          const buffer = new Float32Array(analyzerRef.current.frequencyBinCount);
          analyzerRef.current.getFloatTimeDomainData(buffer);

          const inputVector = new wasmModule.FloatVector();
          buffer.forEach(sample => inputVector.push_back(sample));

          const results = processorRef.current.processSamples(inputVector);

          // Convert to regular array
          // WASM HARDCODED TO RETURN 13 COEFFICIENTS; STANDARD FOR CEPSTRAL
          const resultsArray = [];
          for (let i = 0; i < results.size(); i++) {
            resultsArray.push(results.get(i));
          }

          if (resultsArray.length > 0) {
            // Update both local state for bar display and WebGL renderer
            setCoefficients(resultsArray);

            // Update WebGL renderer with new data
            if (rendererRef.current) {
              rendererRef.current.updateData(resultsArray);
            }
          }

          // Clean up WASM vectors
          inputVector.delete();
          results.delete();
        } catch (err) {
          console.error('Processing error:', err);
          setError('Processing error occurred: ' + err.message);
          cancelAnimationFrame(processingLoopRef.current);
          processingLoopRef.current = null;
          setIsProcessing(false);
        }
      };

      // Start the processing loop
      console.log("Starting processing loop");
      processLoop();

    } catch (err) {
      console.error('Error starting audio processing:', err);
      setError('Failed to access microphone: ' + err.message);
      setIsProcessing(false);
    }
  };

  const stopProcessing = () => {
    setIsProcessing(false);

    // Don't disconnect the source, just stop the loop
    if (processingLoopRef.current) {
      cancelAnimationFrame(processingLoopRef.current);
      processingLoopRef.current = null;
    }
  };

  const toggleProcessing = () => {
    if (isProcessing) {
      stopProcessing();
    } else {
      setIsProcessing(true);
      if (!processingLoopRef.current) {
        startProcessing();
      }
    }
  };

  // Preset configurations
  const applyPreset = (preset) => {
    if (preset === 'default') {
      setLowMidThreshold(35);
      setMidHighThreshold(65);
      setSensitivityC0(500);
      setSensitivityC1(150);
      setSensitivityOthers(50);
      setGlobalScaling(1.0);
    } else if (preset === 'highSensitivity') {
      setLowMidThreshold(25);
      setMidHighThreshold(60);
      setSensitivityC0(400);
      setSensitivityC1(120);
      setSensitivityOthers(40);
      setGlobalScaling(1.2);
    } else if (preset === 'lowSensitivity') {
      setLowMidThreshold(40);
      setMidHighThreshold(75);
      setSensitivityC0(600);
      setSensitivityC1(180);
      setSensitivityOthers(60);
      setGlobalScaling(0.8);
    } else if (preset === 'lowerThresholds') {
      setLowMidThreshold(20);
      setMidHighThreshold(50);
      setSensitivityC0(500);
      setSensitivityC1(150);
      setSensitivityOthers(50);
      setGlobalScaling(1.0);
    }
  };

  // Reset parameter values to default after microphone changes
  const resetParameters = () => {
    applyPreset('default');
  };

  return (
    <div className="app-container">
      <div className="content-container">
        <h1>Cepstral Coefficients</h1>

        <div className="controls-row">
          <button
            onClick={toggleProcessing}
            className="control-button"
          >
            {isProcessing ? 'Stop' : 'Start'}
          </button>

          {/* Presets dropdown */}
          <div className="control-group">
            <label>Presets:</label>
            <select 
              onChange={(e) => applyPreset(e.target.value)}
              className="preset-select"
            >
              <option value="">Select a preset...</option>
              <option value="default">Default</option>
              <option value="highSensitivity">High Sensitivity</option>
              <option value="lowSensitivity">Low Sensitivity</option>
              <option value="lowerThresholds">Lower Thresholds</option>
            </select>
          </div>
          
          <button 
            onClick={resetParameters}
            className="control-button reset-button"
          >
            Reset
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}

        {/* Color Legend */}
        <div className="color-legend">
          <div className="legend-item">
            <div className="color-swatch blue"></div>
            <div className="legend-text">
              <span className="legend-label">Low</span>
              <span className="legend-value">0-{lowMidThreshold}%</span>
            </div>
          </div>
          <div className="legend-item">
            <div className="color-swatch green"></div>
            <div className="legend-text">
              <span className="legend-label">Mid</span>
              <span className="legend-value">{lowMidThreshold}-{midHighThreshold}%</span>
            </div>
          </div>
          <div className="legend-item">
            <div className="color-swatch red"></div>
            <div className="legend-text">
              <span className="legend-label">High</span>
              <span className="legend-value">{midHighThreshold}-100%</span>
            </div>
          </div>
        </div>

        {/* Visualization Controls */}
        <div className="visualization-controls">
          <div className="control-section">
            <h3>Color Thresholds</h3>
            <div className="threshold-controls">
              <div className="control-group">
                <label>Blue → Green:</label>
                <input 
                  type="range" 
                  min="10" 
                  max="90" 
                  value={lowMidThreshold} 
                  onChange={(e) => setLowMidThreshold(Number(e.target.value))} 
                />
                <span>{lowMidThreshold}%</span>
              </div>
              <div className="control-group">
                <label>Green → Red:</label>
                <input 
                  type="range" 
                  min="10" 
                  max="90" 
                  value={midHighThreshold} 
                  onChange={(e) => setMidHighThreshold(Number(e.target.value))} 
                />
                <span>{midHighThreshold}%</span>
              </div>
            </div>
          </div>

          <div className="control-section">
            <h3>Sensitivity Controls</h3>
            <div className="sensitivity-controls">
              <div className="control-group">
                <label>Global Scaling:</label>
                <input 
                  type="range" 
                  min="0.5" 
                  max="2" 
                  step="0.1"
                  value={globalScaling} 
                  onChange={(e) => setGlobalScaling(Number(e.target.value))} 
                />
                <span>{globalScaling.toFixed(1)}x</span>
              </div>
              <div className="control-group">
                <label>C0 Sensitivity:</label>
                <input 
                  type="range" 
                  min="100" 
                  max="1000" 
                  value={sensitivityC0} 
                  onChange={(e) => setSensitivityC0(Number(e.target.value))} 
                />
                <span>{sensitivityC0}</span>
              </div>
              <div className="control-group">
                <label>C1 Sensitivity:</label>
                <input 
                  type="range" 
                  min="50" 
                  max="300" 
                  value={sensitivityC1} 
                  onChange={(e) => setSensitivityC1(Number(e.target.value))} 
                />
                <span>{sensitivityC1}</span>
              </div>
              <div className="control-group">
                <label>C2-C12 Sensitivity:</label>
                <input 
                  type="range" 
                  min="10" 
                  max="150" 
                  value={sensitivityOthers} 
                  onChange={(e) => setSensitivityOthers(Number(e.target.value))} 
                />
                <span>{sensitivityOthers}</span>
              </div>
            </div>
          </div>
        </div>

        {/* WebGL spectrogram canvas */}
        <div className="spectrogram-container">
          <canvas
            ref={canvasRef}
            className="spectrogram-canvas"
            width={1200}
            height={260}
          />
        </div>

        {/* Channel labels */}
        <div className="channel-labels">
          {Array.from({ length: 13 }, (_, i) => (
            <div key={i} className="channel-label">C{i}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
