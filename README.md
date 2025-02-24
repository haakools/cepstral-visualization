# Cepstral demonstration


Hacked together WASM+react+webGL rendering of Cepstral coefficients to better help visualize and understand.
Uses the microphone in the browser and renders 13 cepstral coefficients in a spectrogram-ish way.


Disclaimer: this was written 80% by LLM, 15% debugging and 5% boredom.




## Prerequisites


### Emscripten
Needed for wasm compilation

```
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
```

Source the emscripten env variables / or add to ~/.bash_profile as prompted by running activate latest.

```
cd emsdk
source emsdk_env.sh
```

**Note**: emscripten repo tag/commit used: 4.0.3-2-g85390ce

### NPM

```
npm install
```

## Building and run

First compile the wasm with emscripten by running
```
./build-wasm.sh
```

then run 

```
npm run dev
```



