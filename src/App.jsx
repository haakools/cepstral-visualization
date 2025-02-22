import { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [wasmModule, setWasmModule] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [coefficients, setCoefficients] = useState(Array(13).fill(0));
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const analyzerRef = useRef(null);
  const sourceRef = useRef(null);

  async function loadWasm() {
    try {
      console.log('Starting WASM load...');
      const moduleFactory = await import('./wasm/signal_processor.js');
      console.log('Module factory imported');
      
      const Module = await moduleFactory.default();
      console.log('Module loaded successfully', Module);

      processorRef.current = new Module.SignalProcessor();
      console.log('SignalProcessor created');
      
      setWasmModule(Module);
      console.log('WASM module set in state');
    } catch (err) {
      console.error('FULL WASM loading error:', err);
      setError(`Failed to initialize audio processor: ${err.message}
        Stack: ${err.stack}`);
    }
  }

  useEffect(() => {
    console.log('Initial useEffect running');
    loadWasm();
    
    // Setup canvas contexts
    const canvas = canvasRef.current;
    if (!canvas) {
      console.error('Canvas ref is null');
      return;
    }
    
    const ctx = canvas.getContext('2d');
    // Initialize canvas with a background
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    return () => {
      if (processorRef.current) {
        processorRef.current.delete();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Color generation similar to original script
  const generateColors = (steps = 275) => {
    const colors = [];
    const frequency = Math.PI / steps;
    const amplitude = 127;
    const center = 128;
    const slice = (Math.PI / 2) * 3.1;

    const toRGBString = (v) => `rgba(${v},${v},${v},1)`;

    for (let i = 0; i < steps; i++) {
      const v = Math.floor((Math.sin((frequency * i) + slice) * amplitude + center));
      colors.push(toRGBString(v));
    }

    return colors;
  };

  const colors = generateColors();

  const getColor = (value) => {
    const index = Math.min(Math.max(Math.floor(value), 0), colors.length - 1);
    return colors[index];
  };

  const drawSpectrogram = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Create temporary canvas for scrolling
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');

    // Store current canvas state in temp canvas
    tempCtx.drawImage(canvas, 0, 0);

    // Draw new column of data
    for (let i = 0; i < coefficients.length; i++) {
      // Scale coefficient to 0-255 range
      const scaledValue = Math.min(Math.max(
        Math.abs(coefficients[i]) / 500 * 255, 
        0
      ), 255);
      
      ctx.fillStyle = getColor(scaledValue);
      ctx.fillRect(width - 1, height - i, 1, 1);
    }

    // Scroll canvas to the left
    ctx.translate(-1, 0);
    ctx.drawImage(tempCanvas, 0, 0);
    
    // Reset transformation
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  const startProcessing = async () => {
    console.log('Start processing called');
    if (!wasmModule) {
      console.error('No WASM module available');
      setError('WASM module not loaded');
      return;
    }

    try {
      console.log('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Microphone stream obtained');

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyzer = audioContext.createAnalyser();
      analyzerRef.current = analyzer;
      analyzer.fftSize = 2048;
      source.connect(analyzer);

      setIsProcessing(true);

      const processLoop = () => {
        const buffer = new Float32Array(analyzer.frequencyBinCount);
        analyzer.getFloatTimeDomainData(buffer);

        try {
          const inputVector = new wasmModule.FloatVector();
          buffer.forEach(sample => inputVector.push_back(sample));

          const results = processorRef.current.processSamples(inputVector);

          // Convert to regular array
          const resultsArray = [];
          for (let i = 0; i < results.size(); i++) {
            resultsArray.push(results.get(i));
          }

          if (resultsArray.length > 0) {
            setCoefficients(resultsArray);
            drawSpectrogram();
          }

          inputVector.delete();
          results.delete();

          if (isProcessing) {
            requestAnimationFrame(processLoop);
          }
        } catch (err) {
          console.error('Processing error:', err);
          setError('Processing error occurred: ' + err.message);
        }
      };

      // Start the processing loop
      processLoop();

    } catch (err) {
      console.error('Error starting audio processing:', err);
      setError('Failed to access microphone: ' + err.message);
    }
  };

  const stopProcessing = () => {
    setIsProcessing(false);
    if (sourceRef.current) {
      sourceRef.current.disconnect();
    }
  };

  return (
    <div className="container">
      <h1>Cepstral Coefficients Spectrogram</h1>
      
      <button 
        onClick={isProcessing ? stopProcessing : startProcessing}
        className="control-button"
      >
        {isProcessing ? 'Stop' : 'Start'}
      </button>

      <canvas 
        ref={canvasRef}
        width={800}
        height={300}
        style={{ border: '1px solid #000', backgroundColor: 'black' }}
      />

      {error && <div className="error-message" style={{color: 'red'}}>{error}</div>}
    </div>
  );
}

export default App;
