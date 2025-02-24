import { useState, useEffect, useRef } from 'react';
import { WebGLSpectrogramRenderer } from './webglRenderer';
import './App.css';

function App() {
  const [wasmModule, setWasmModule] = useState(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState(null);
  const [coefficients, setCoefficients] = useState(Array(13).fill(0));

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

  // Initialize WebGL renderer once the canvas is available
  useEffect(() => {
    if (!canvasRef.current) return;

    try {
      console.log("Creating WebGL renderer...");
      // Create the WebGL renderer with wider history
      rendererRef.current = new WebGLSpectrogramRenderer(canvasRef.current, {
        coefficientCount: 13,        // Exactly 13 channels in height
        historyLength: 300,          // Much wider history (300 frames instead of 100)
        colorLow: [0, 0, 0.8, 1],    // Dark blue for low values
        colorMid: [0, 0.8, 0, 1],    // Green for mid values
        colorHigh: [0.8, 0, 0, 1],   // Red for high values
        minValue: 0,                 // Assuming normalized values range from 0-100
        maxValue: 100,
        // Use your existing normalization function
        normalizeFunction: (value, index) => {
          // This matches your existing normalizeValue function
          if (index === 0) {
            // C0 (energy) has much larger range
            return Math.min(Math.max((value / 500 + 1) * 50, 0), 100);
          } else if (index === 1) {
            // C1 has second largest range
            return Math.min(Math.max((value / 150 + 1) * 50, 0), 100);
          } else {
            // Other coefficients have smaller ranges
            return Math.min(Math.max((value / 50 + 1) * 50, 0), 100);
          }
        }
      });
      console.log("WebGL Created.");

      // Start the render loop
      rendererRef.current.startRenderLoop();

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

  return (
    <div className="app-container">
      <div className="content-container">
        <h1>Cepstral Coefficients</h1>

        <button
          onClick={toggleProcessing}
          className="control-button"
        >
          {isProcessing ? 'Stop' : 'Start'}
        </button>

        {error && <div className="error-message">{error}</div>}

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
