// ============================================================
// SlicePad – 16-Pad Audio Sampler with Sequencer (app.js)
// Wavesurfer.js v7 (ES module) + Web Audio API
// Features: 16-pad sampler, mute-group, 4-bar loop recorder,
//           quantize (1/32), MPC-style swing, visual metronome,
//           note repeat (Shift = momentary),
//           4-track TR-style step sequencer with drum synthesis.
// Visual: MPC 60 vintage aesthetic with dot-matrix LCD.
// ============================================================

import WaveSurfer from "https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js";
import RegionsPlugin from "https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.esm.js";

// ============================================================
// CONSTANTS
// ============================================================

const NUM_PADS = 16;
const BARS = 4;
const BEATS_PER_BAR = 4;
const THIRTYSECONDS_PER_BEAT = 8;    // 1/32-note resolution per beat
const SIXTEENTHS_PER_BEAT = 4;       // Used for swing grouping (16th-note level)
const STEPS_PER_SIXTEENTH = 2;       // Two 32nds make one 16th
const TOTAL_STEPS = BARS * BEATS_PER_BAR * THIRTYSECONDS_PER_BEAT; // 128

// TR Step Sequencer constants
const DRUM_TRACKS = 4;
const SEQ_STEPS = 16;
const TRACK_NAMES = ["KICK", "SNARE", "HIHAT", "CYMBAL"];
const BANK_NAMES = ["A", "B", "C", "D"];

// Per-pad region colours – pixel-green shades for the LCD display
const PAD_COLORS = [
  "rgba(51, 255, 51, 0.12)",
  "rgba(51, 255, 51, 0.14)",
  "rgba(51, 255, 51, 0.10)",
  "rgba(51, 255, 51, 0.13)",
  "rgba(51, 255, 51, 0.11)",
  "rgba(51, 255, 51, 0.15)",
  "rgba(51, 255, 51, 0.12)",
  "rgba(51, 255, 51, 0.14)",
  "rgba(51, 255, 51, 0.10)",
  "rgba(51, 255, 51, 0.13)",
  "rgba(51, 255, 51, 0.11)",
  "rgba(51, 255, 51, 0.15)",
  "rgba(51, 255, 51, 0.12)",
  "rgba(51, 255, 51, 0.14)",
  "rgba(51, 255, 51, 0.10)",
  "rgba(51, 255, 51, 0.13)",
];

// ============================================================
// DRUM BANK DEFINITIONS
// Four internal banks (A–D) with different synthesis parameters
// for each of the four drum voices.
// ============================================================

const DRUM_BANKS = [
  {
    name: "A",
    kick:   { freq: 150, endFreq: 40, decay: 0.3, tone: 0.8 },
    snare:  { toneFreq: 180, noiseDecay: 0.15, filterFreq: 3000, tone: 0.5 },
    hihat:  { filterFreq: 8000, decay: 0.05, q: 1 },
    cymbal: { filterFreq: 5000, decay: 0.4, q: 1 },
  },
  {
    name: "B",
    kick:   { freq: 180, endFreq: 35, decay: 0.4, tone: 0.9 },
    snare:  { toneFreq: 200, noiseDecay: 0.2, filterFreq: 4000, tone: 0.6 },
    hihat:  { filterFreq: 9000, decay: 0.04, q: 1.5 },
    cymbal: { filterFreq: 6000, decay: 0.5, q: 1.5 },
  },
  {
    name: "C",
    kick:   { freq: 120, endFreq: 50, decay: 0.25, tone: 0.7 },
    snare:  { toneFreq: 160, noiseDecay: 0.12, filterFreq: 2500, tone: 0.4 },
    hihat:  { filterFreq: 10000, decay: 0.03, q: 2 },
    cymbal: { filterFreq: 7000, decay: 0.35, q: 0.8 },
  },
  {
    name: "D",
    kick:   { freq: 200, endFreq: 30, decay: 0.5, tone: 1.0 },
    snare:  { toneFreq: 220, noiseDecay: 0.25, filterFreq: 3500, tone: 0.7 },
    hihat:  { filterFreq: 7000, decay: 0.06, q: 0.8 },
    cymbal: { filterFreq: 4500, decay: 0.6, q: 1.2 },
  },
];

// ============================================================
// DOM REFERENCES
// ============================================================

// Waveform / file
const loadBtn = document.getElementById("load-btn");
const fileInput = document.getElementById("file-input");
const fileNameEl = document.getElementById("file-name");
const dropZone = document.getElementById("drop-zone");

// LCD BPM display
const lcdBpmDisplay = document.getElementById("lcd-bpm-display");

// Pitch (digital +/- inside LCD)
const pitchDec = document.getElementById("pitch-dec");
const pitchInc = document.getElementById("pitch-inc");
const pitchValueEl = document.getElementById("pitch-value");

// Bump / master compressor (digital +/- inside LCD)
const bumpDec = document.getElementById("bump-dec");
const bumpInc = document.getElementById("bump-inc");
const bumpValueEl = document.getElementById("bump-value");

// Pad grid container
const padGrid = document.getElementById("pad-grid");

// Transport
const bpmInput = document.getElementById("bpm-input");
const bpmDecBtn = document.getElementById("bpm-dec");
const bpmIncBtn = document.getElementById("bpm-inc");
const metroBtn = document.getElementById("metro-btn");
const metronomeLed = document.getElementById("metronome-led");
const quantizeBtn = document.getElementById("quantize-btn");
const swingSwitch = document.getElementById("swing-switch");
const swingLabels = swingSwitch.querySelectorAll(".swing-label");
const recBtn = document.getElementById("rec-btn");
const playBtn = document.getElementById("play-btn");
const stopBtn = document.getElementById("stop-btn");
const clearBtn = document.getElementById("clear-btn");

// Progress bar
const progressFill = document.getElementById("loop-progress-fill");
const progressTicksContainer = document.getElementById("loop-progress-ticks");

// Count-in overlay
const countInDisplay = document.getElementById("count-in-display");

// Mode switch (pad ↔ step sequencer)
const modeSwitch = document.getElementById("mode-switch");
const padsSection = document.getElementById("pads-section");
const stepSeqContainer = document.getElementById("step-sequencer");

// Bank selector (LCD)
const bankDecBtn = document.getElementById("bank-dec");
const bankIncBtn = document.getElementById("bank-inc");
const bankValueEl = document.getElementById("bank-value");

// ============================================================
// STATE
// ============================================================

// Audio
let audioCtx = null;
let decodedBuffer = null;
let currentSource = null;
let currentGain = null;
let activePadIndex = -1;
let semitones = 0;

// Master output chain: MasterGainNode → DynamicsCompressorNode → destination
let masterGainNode = null;
let compressorNode = null;
let bumpAmount = 24; // Compressor threshold = -(bumpAmount) dB; 0 = off, 60 = max

// Metronome gain node: routed directly to destination (bypasses the compressor)
let metronomeGainNode = null;

// Wavesurfer
let wavesurfer = null;
let wsRegions = null;
let regions = []; // { id, start, end, wsRegion }

// Sequencer
let bpm = 70;
let isPlaying = false;
let isRecording = false;
let quantizeRes = 32; // Quantize resolution: 32 = 1/32, 16 = 1/16
let swingPercent = 50; // 50 = no swing, up to 75

// Metronome click (audio tick on every beat during playback / recording)
let metronomeEnabled = false;

// Count-in (4-beat pre-roll before recording)
let isCountingIn = false;
let countInStep = 0;                 // 0-3 (four beats)
let countInNextTime = 0.0;
let countInTimerID = null;

// Note Repeat (Shift key = momentary; no toggle button — switch is used for mode)
let shiftHeld = false;
const mousePressedPads = new Set();  // Pads held via mouse / touch
const keyPressedPads = new Set();    // Pads held via keyboard

// Sequence buffer: 128 slots (one per 32nd note across 4 bars), each null or a sliceId (0-15)
let sequence = new Array(TOTAL_STEPS).fill(null);

// Look-ahead scheduler state
const lookahead = 25.0;           // ms – scheduler call interval
const scheduleAheadTime = 0.1;    // seconds – how far ahead to schedule
let nextNoteTime = 0.0;
let currentStep = 0;
let timerID = null;
let loopStartTime = 0.0;

// Visual animation
let animFrameID = null;

// Tick elements (for grid flash)
let tickElements = [];

// Step Sequencer / Drum Machine
let seqMode = false;
let drumPattern = Array.from({ length: DRUM_TRACKS }, () => new Array(SEQ_STEPS).fill(false));
let drumTrackVol = [80, 80, 80, 80];
let drumTrackPitch = [0, 0, 0, 0];
let currentDrumBank = 0;
let noiseBuffer = null;
let drumGainNodes = [null, null, null, null];

// ============================================================
// BUILD 16-PAD GRID
// ============================================================

const padElements = [];
for (let i = 0; i < NUM_PADS; i++) {
  const pad = document.createElement("button");
  pad.className = "pad disabled";
  pad.dataset.index = i;
  pad.innerHTML = `<span class="pad-number">${i + 1}</span>`;

  // Mouse events: trigger + track press state for Note Repeat
  pad.addEventListener("mousedown", () => {
    triggerPad(i);
    mousePressedPads.add(i);
  });
  pad.addEventListener("mouseup", () => mousePressedPads.delete(i));
  pad.addEventListener("mouseleave", () => mousePressedPads.delete(i));

  // Touch events: trigger + track press state for Note Repeat
  pad.addEventListener("touchstart", (e) => {
    e.preventDefault();
    triggerPad(i);
    mousePressedPads.add(i);
  });
  pad.addEventListener("touchend", (e) => {
    e.preventDefault();
    mousePressedPads.delete(i);
  });
  pad.addEventListener("touchcancel", () => mousePressedPads.delete(i));

  padGrid.appendChild(pad);
  padElements.push(pad);
}

// ============================================================
// BUILD STEP SEQUENCER DOM
// 4 tracks × 16 steps per track.
// ============================================================

const seqStepElements = []; // [track][step] for quick playhead access

function buildStepSequencer() {
  stepSeqContainer.innerHTML = "";
  seqStepElements.length = 0;

  for (let tr = 0; tr < DRUM_TRACKS; tr++) {
    seqStepElements.push([]);
    const row = document.createElement("div");
    row.className = "seq-track";

    // ---- Track label ----
    const label = document.createElement("span");
    label.className = "seq-track-name";
    label.textContent = TRACK_NAMES[tr];
    row.appendChild(label);

    // ---- 16 step buttons ----
    const steps = document.createElement("div");
    steps.className = "seq-steps";

    for (let s = 0; s < SEQ_STEPS; s++) {
      const stepEl = document.createElement("div");
      stepEl.className = "seq-step";
      stepEl.dataset.step = s;
      stepEl.dataset.track = tr;

      // Color grouping: alternate blocks of 4
      stepEl.classList.add(Math.floor(s / 4) % 2 === 0 ? "seq-step-a" : "seq-step-b");

      const led = document.createElement("div");
      led.className = "seq-step-led";
      stepEl.appendChild(led);

      // Click handler: toggle step on/off + preview sound
      stepEl.addEventListener("click", () => {
        ensureAudioContext();
        drumPattern[tr][s] = !drumPattern[tr][s];
        stepEl.classList.toggle("active", drumPattern[tr][s]);
        if (drumPattern[tr][s]) {
          playDrumSound(tr, audioCtx.currentTime);
        }
      });

      steps.appendChild(stepEl);
      seqStepElements[tr].push(stepEl);
    }

    row.appendChild(steps);
    stepSeqContainer.appendChild(row);
  }
}

buildStepSequencer();

// ============================================================
// BUILD PROGRESS BAR TICK MARKS (128 × 1/32nd note grid, 4 bars)
// Four-level hierarchy: bar → beat → 16th → 32nd micro-tick
// ============================================================

function buildProgressTicks() {
  progressTicksContainer.innerHTML = "";
  tickElements = [];

  const stepsPerBar = THIRTYSECONDS_PER_BEAT * BEATS_PER_BAR; // 32
  const stepsPerBeat = THIRTYSECONDS_PER_BEAT;                 // 8

  for (let i = 0; i < TOTAL_STEPS; i++) {
    const tick = document.createElement("div");
    tick.className = "progress-tick";

    // Classify tick by musical weight (highest match wins)
    if (i % stepsPerBar === 0) {
      // Bar boundary (every 32 steps)
      tick.classList.add("bar-tick");
    } else if (i % stepsPerBeat === 0) {
      // Beat boundary (every 8 steps)
      tick.classList.add("beat-tick");
    } else if (i % STEPS_PER_SIXTEENTH === 0) {
      // 16th-note boundary (every 2 steps)
      tick.classList.add("sixteenth-tick");
    } else {
      // 32nd-note micro-tick (every odd step)
      tick.classList.add("thirtysecond-tick");
    }

    tick.style.left = ((i / TOTAL_STEPS) * 100) + "%";
    progressTicksContainer.appendChild(tick);
    tickElements.push(tick);
  }
}

buildProgressTicks();

// ============================================================
// WAVESURFER INITIALISATION
// Configured for blocky "bar" style waveform to match the
// dot-matrix LCD aesthetic of the MPC 60.
// ============================================================

function initWavesurfer() {
  wsRegions = RegionsPlugin.create();

  wavesurfer = WaveSurfer.create({
    container: "#waveform",
    // Pixel-green waveform on dark olive-green LCD background
    waveColor: "#33ff33",
    progressColor: "#22aa22",
    cursorColor: "#66ff66",
    cursorWidth: 1,
    height: 160,
    // Blocky bar style to simulate dot-matrix / LED grid display
    barWidth: 2,
    barGap: 1,
    barRadius: 0,
    normalize: true,
    interact: false,
    plugins: [wsRegions],
  });

  wavesurfer.on("decode", () => {
    decodedBuffer = wavesurfer.getDecodedData();
    autoSlice();
    enablePads();
  });

  wsRegions.on("region-updated", (region) => {
    handleRegionUpdate(region);
  });
}

initWavesurfer();

// ============================================================
// FILE LOADING
// ============================================================

loadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadFile(file);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("audio")) {
    loadFile(file);
  }
});

function loadFile(file) {
  fileNameEl.textContent = file.name.toUpperCase();
  dropZone.classList.add("loaded");

  // Stop sequencer and audio
  stopPlayback();
  stopCurrent();

  const objectUrl = URL.createObjectURL(file);
  wavesurfer.load(objectUrl);
}

// ============================================================
// AUTO-SLICE INTO 16 EQUAL REGIONS
// ============================================================

function autoSlice() {
  if (!decodedBuffer) return;

  wsRegions.clearRegions();
  regions = [];

  const duration = decodedBuffer.duration;
  const sliceLen = duration / NUM_PADS;

  for (let i = 0; i < NUM_PADS; i++) {
    const start = i * sliceLen;
    const end = (i + 1) * sliceLen;

    const regionObj = wsRegions.addRegion({
      id: `slice-${i}`,
      start,
      end,
      color: PAD_COLORS[i],
      drag: false,
      resize: true,
    });

    regions.push({ id: `slice-${i}`, start, end, wsRegion: regionObj });
  }
}

// ============================================================
// CONTIGUOUS REGION UPDATE
// ============================================================

function handleRegionUpdate(region) {
  const idx = regions.findIndex((r) => r.id === region.id);
  if (idx === -1) return;

  regions[idx].start = region.start;
  regions[idx].end = region.end;

  if (idx < NUM_PADS - 1) {
    const next = regions[idx + 1];
    if (next.wsRegion && Math.abs(next.start - region.end) > 0.001) {
      next.start = region.end;
      next.wsRegion.setOptions({ start: region.end });
    }
  }

  if (idx > 0) {
    const prev = regions[idx - 1];
    if (prev.wsRegion && Math.abs(prev.end - region.start) > 0.001) {
      prev.end = region.start;
      prev.wsRegion.setOptions({ end: region.start });
    }
  }
}

// ============================================================
// ENABLE / DISABLE PADS
// ============================================================

function enablePads() {
  padElements.forEach((p) => p.classList.remove("disabled"));
}

// ============================================================
// ENSURE AUDIO CONTEXT
// ============================================================

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // ---- Build Master Output Chain ----
    // All slice outputs → masterGainNode → compressorNode → destination
    // The compressor acts as a limiter / "glue" to give the 90s boom-bap punch.
    masterGainNode = audioCtx.createGain();
    masterGainNode.gain.value = 1.0;

    compressorNode = audioCtx.createDynamicsCompressor();
    compressorNode.threshold.value = -bumpAmount;  // -24 dB default
    compressorNode.knee.value = 30;                 // Soft knee for musical feel
    compressorNode.ratio.value = 12;                // Aggressive squash for punch
    compressorNode.attack.value = 0.003;            // Fast; lets the click through
    compressorNode.release.value = 0.25;            // Slow pump for boom-bap groove

    masterGainNode.connect(compressorNode);
    compressorNode.connect(audioCtx.destination);

    // ---- Metronome Output (separate path, bypasses compressor) ----
    metronomeGainNode = audioCtx.createGain();
    metronomeGainNode.gain.value = 1.0;
    metronomeGainNode.connect(audioCtx.destination);

    // ---- Drum Track Gain Nodes (per-track volume → master compressor) ----
    for (let i = 0; i < DRUM_TRACKS; i++) {
      drumGainNodes[i] = audioCtx.createGain();
      drumGainNodes[i].gain.value = drumTrackVol[i] / 100;
      drumGainNodes[i].connect(masterGainNode);
    }
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

// ============================================================
// CENTRALIZED playSlice() — AUDIO ONLY + MUTE GROUP
// Both manual pad clicks and sequencer triggers call this.
// @param {number} index      – pad / slice index (0-15)
// @param {number} [atTime]   – Web Audio scheduled time (omit for "now")
// ============================================================

function playSlice(index, atTime) {
  if (!decodedBuffer || index < 0 || index >= NUM_PADS) return;
  ensureAudioContext();

  const slice = regions[index];
  if (!slice) return;

  const t = atTime || audioCtx.currentTime;

  // ---- Mute-group: stop whatever is playing ----
  stopCurrent(t);

  // ---- Create new source & gain ----
  const source = audioCtx.createBufferSource();
  source.buffer = decodedBuffer;

  const gainNode = audioCtx.createGain();
  gainNode.gain.setValueAtTime(1, t);

  source.connect(gainNode).connect(masterGainNode);
  source.playbackRate.value = Math.pow(2, semitones / 12);

  const offset = slice.start;
  const duration = slice.end - slice.start;
  source.start(t, offset, duration);

  // Track current source
  currentSource = source;
  currentGain = gainNode;
  activePadIndex = index;

  source.onended = () => {
    if (currentSource === source) {
      currentSource = null;
      currentGain = null;
      activePadIndex = -1;
      padElements[index].classList.remove("active");
    }
  };
}

// ============================================================
// STOP CURRENT SOURCE (with tiny fade for de-click)
// ============================================================

function stopCurrent(atTime) {
  if (currentSource && currentGain && audioCtx) {
    try {
      const t = atTime || audioCtx.currentTime;
      currentGain.gain.cancelScheduledValues(t);
      currentGain.gain.setValueAtTime(1, t);
      currentGain.gain.linearRampToValueAtTime(0, t + 0.005);
      currentSource.stop(t + 0.006);
    } catch (_) {
      // source may already have stopped
    }
  }
  currentSource = null;
  currentGain = null;

  if (activePadIndex >= 0 && activePadIndex < NUM_PADS) {
    padElements[activePadIndex].classList.remove("active");
  }
  activePadIndex = -1;
}

// ============================================================
// DIGITAL "TICK" SYNTHESIZER (Count-In Metronome)
// Uses an OscillatorNode so it's always "ready" with zero latency.
// 2400 Hz = the "One" (downbeat), 1800 Hz = regular tick.
// Routed through metronomeGainNode (bypasses compressor).
// ============================================================

function playMetronomeTick(time, isDownbeat) {
  ensureAudioContext();

  const freq = isDownbeat ? 2400 : 1800;

  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;

  // Sharp digital blip with 0.05s decay envelope
  const envGain = audioCtx.createGain();
  envGain.gain.setValueAtTime(0.6, time);
  envGain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

  osc.connect(envGain).connect(metronomeGainNode);
  osc.start(time);
  osc.stop(time + 0.06);
}

// ============================================================
// DRUM SYNTHESIS — TR-808 Style
// Web Audio API oscillators and noise for kick, snare, hihat,
// and cymbal.  Routed through per-track gain nodes so each
// track has independent volume.
// ============================================================

function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const size = audioCtx.sampleRate * 2;
  noiseBuffer = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function synthKick(time, params, vol, pitchMult) {
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(params.freq * pitchMult, time);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(10, params.endFreq * pitchMult), time + 0.08
  );
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(vol * params.tone, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + params.decay);
  osc.connect(gain).connect(drumGainNodes[0]);
  osc.start(time);
  osc.stop(time + params.decay + 0.01);
}

function synthSnare(time, params, vol, pitchMult) {
  // Tone body
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = params.toneFreq * pitchMult;
  const oscGain = audioCtx.createGain();
  oscGain.gain.setValueAtTime(vol * params.tone, time);
  oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
  osc.connect(oscGain).connect(drumGainNodes[1]);
  osc.start(time);
  osc.stop(time + 0.11);

  // Noise snap
  const noise = audioCtx.createBufferSource();
  noise.buffer = getNoiseBuffer();
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = params.filterFreq * pitchMult;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(vol, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + params.noiseDecay);
  noise.connect(filter).connect(noiseGain).connect(drumGainNodes[1]);
  noise.start(time);
  noise.stop(time + params.noiseDecay + 0.01);
}

function synthHiHat(time, params, vol, pitchMult) {
  const noise = audioCtx.createBufferSource();
  noise.buffer = getNoiseBuffer();
  const filter = audioCtx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = params.filterFreq * pitchMult;
  filter.Q.value = params.q;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(vol * 0.5, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + params.decay);
  noise.connect(filter).connect(gain).connect(drumGainNodes[2]);
  noise.start(time);
  noise.stop(time + params.decay + 0.01);
}

function synthCymbal(time, params, vol, pitchMult) {
  const noise = audioCtx.createBufferSource();
  noise.buffer = getNoiseBuffer();
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = params.filterFreq * pitchMult;
  filter.Q.value = params.q;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(vol * 0.4, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + params.decay);
  noise.connect(filter).connect(gain).connect(drumGainNodes[3]);
  noise.start(time);
  noise.stop(time + params.decay + 0.01);
}

function playDrumSound(trackIndex, time) {
  ensureAudioContext();
  const bank = DRUM_BANKS[currentDrumBank];
  const vol = drumTrackVol[trackIndex] / 100;
  const pitchMult = Math.pow(2, drumTrackPitch[trackIndex] / 12);
  switch (trackIndex) {
    case 0: synthKick(time, bank.kick, vol, pitchMult); break;
    case 1: synthSnare(time, bank.snare, vol, pitchMult); break;
    case 2: synthHiHat(time, bank.hihat, vol, pitchMult); break;
    case 3: synthCymbal(time, bank.cymbal, vol, pitchMult); break;
  }
}

// ============================================================
// PAD HIGHLIGHT (visual only)
// ============================================================

function highlightPad(index) {
  padElements.forEach((p) => p.classList.remove("active"));
  if (index >= 0 && index < NUM_PADS) {
    padElements[index].classList.add("active");
  }
}

// ============================================================
// TRIGGER PAD — called by user interaction (click / keyboard)
// Plays the slice + records if recording.
// ============================================================

function triggerPad(index) {
  if (!decodedBuffer || index < 0 || index >= NUM_PADS) return;

  playSlice(index);
  highlightPad(index);

  // If recording + playing, capture event
  if (isRecording && isPlaying) {
    recordEvent(index);
  }
}

// ============================================================
// PITCH — Digital +/- Buttons (inside LCD)
// Range: -12 to +12 semitones, step 1
// ============================================================

function updatePitch(newVal) {
  semitones = Math.max(-12, Math.min(12, newVal));
  const sign = semitones > 0 ? "+" : "";
  pitchValueEl.textContent = `PITCH: ${sign}${semitones} ST`;

  if (currentSource) {
    try {
      currentSource.playbackRate.value = Math.pow(2, semitones / 12);
    } catch (_) {}
  }
}

pitchDec.addEventListener("click", () => updatePitch(semitones - 1));
pitchInc.addEventListener("click", () => updatePitch(semitones + 1));

// ============================================================
// BUMP — Digital +/- Buttons (inside LCD)
// Controls the DynamicsCompressorNode threshold.
// Range: 0 (off) to 60 (max squeeze), step 3 dB.
// ============================================================

function updateBump(newVal) {
  bumpAmount = Math.max(0, Math.min(60, newVal));
  bumpValueEl.textContent = bumpAmount === 0 ? "BUMP: OFF" : `BUMP: -${bumpAmount} dB`;

  if (compressorNode) {
    compressorNode.threshold.setValueAtTime(-bumpAmount, audioCtx.currentTime);
  }
}

bumpDec.addEventListener("click", () => updateBump(bumpAmount - 3));
bumpInc.addEventListener("click", () => updateBump(bumpAmount + 3));

// ============================================================
// BPM CONTROLS
// ============================================================

function setBpm(val) {
  bpm = Math.max(60, Math.min(90, Math.round(Number(val) || 70)));
  bpmInput.value = bpm;
  if (lcdBpmDisplay) {
    lcdBpmDisplay.textContent = bpm + " BPM";
  }
}

bpmInput.addEventListener("change", () => setBpm(bpmInput.value));
bpmDecBtn.addEventListener("click", () => setBpm(bpm - 1));
bpmIncBtn.addEventListener("click", () => setBpm(bpm + 1));

// ============================================================
// QUANTIZE 2-POSITION TOGGLE (1/16 ↔ 1/32)
// Always quantized — cycles between two grid resolutions.
// ============================================================

const quantizeLabelEl = document.getElementById("quantize-label");

function setQuantizeRes(res) {
  quantizeRes = res;
  quantizeBtn.classList.remove("q-16", "q-32");
  quantizeBtn.classList.add(res === 32 ? "q-32" : "q-16");
  quantizeLabelEl.textContent = "1/" + res;
}

quantizeBtn.addEventListener("click", () => {
  setQuantizeRes(quantizeRes === 32 ? 16 : 32);
});

// ============================================================
// SWING 3-POSITION TOGGLE SWITCH
// Three fixed values: 50% (straight), 60% (shuffle), 70% (heavy)
// ============================================================

const SWING_VALUES = [50, 60, 70];

function setSwingPosition(posIndex) {
  const clamped = Math.max(0, Math.min(2, posIndex));
  swingSwitch.dataset.position = clamped;
  swingPercent = SWING_VALUES[clamped];
}

// Click on track cycles to next position
swingSwitch.querySelector(".swing-track").addEventListener("click", () => {
  const cur = parseInt(swingSwitch.dataset.position, 10);
  setSwingPosition((cur + 1) % 3);
});

// Click on individual labels snaps to that position
swingLabels.forEach((lbl) => {
  lbl.addEventListener("click", (e) => {
    e.stopPropagation();
    const val = parseInt(lbl.dataset.val, 10);
    const idx = SWING_VALUES.indexOf(val);
    if (idx !== -1) setSwingPosition(idx);
  });
});

// ============================================================
// METRONOME CLICK TOGGLE
// Toggles the audio metronome (digital tick on every beat).
// The metronome works during both Play and Record modes as
// a standalone timing tool — no sequence data required.
// ============================================================

metroBtn.addEventListener("click", () => {
  metronomeEnabled = !metronomeEnabled;
  metroBtn.classList.toggle("active", metronomeEnabled);
});

// ============================================================
// NOTE REPEAT — MPC-Style Auto-Retrigger
// Momentary via holding Shift key. Active only in Pad mode.
// ============================================================

function isNoteRepeatActive() {
  if (seqMode) return false;
  return shiftHeld;
}

function getPressedPads() {
  const union = new Set(mousePressedPads);
  for (const p of keyPressedPads) union.add(p);
  return union;
}

// Clear all pressed pads when the window loses focus (prevent stuck repeats)
window.addEventListener("blur", () => {
  mousePressedPads.clear();
  keyPressedPads.clear();
  shiftHeld = false;
});

// ============================================================
// MODE SWITCH — Pad Grid ↔ Step Sequencer
// ============================================================

modeSwitch.addEventListener("click", () => {
  ensureAudioContext();
  seqMode = !seqMode;
  modeSwitch.classList.toggle("seq-mode", seqMode);
  padsSection.style.display = seqMode ? "none" : "";
  stepSeqContainer.style.display = seqMode ? "" : "none";
});

// ============================================================
// BANK SWITCHING — Cycle through drum banks A–D
// ============================================================

function setDrumBank(index) {
  currentDrumBank = ((index % DRUM_BANKS.length) + DRUM_BANKS.length) % DRUM_BANKS.length;
  bankValueEl.textContent = "BANK: " + BANK_NAMES[currentDrumBank];
}

bankDecBtn.addEventListener("click", () => setDrumBank(currentDrumBank - 1));
bankIncBtn.addEventListener("click", () => setDrumBank(currentDrumBank + 1));

// ============================================================
// COUNT-IN ENGINE — 4-Beat Pre-Roll Before Recording
// Uses the same look-ahead scheduler pattern for precise timing.
// Plays 4 digital ticks, displays a countdown (4→3→2→1),
// then hands off to the main sequencer to begin recording.
// ============================================================

function startCountIn() {
  ensureAudioContext();

  isCountingIn = true;
  countInStep = 0;
  countInNextTime = audioCtx.currentTime;

  // Show the count-in overlay on the LCD
  countInDisplay.textContent = "";
  countInDisplay.style.display = "flex";

  // Ensure progress bar stays at 0 during count-in
  progressFill.style.width = "0%";

  countInScheduler();
}

function countInScheduler() {
  while (countInNextTime < audioCtx.currentTime + scheduleAheadTime) {
    if (countInStep >= 4) {
      // All 4 count-in beats have been scheduled.
      // Transition to the main recording loop exactly on the next downbeat.
      isCountingIn = false;

      // Hide the count-in overlay at the exact moment recording starts
      const hideDelay = Math.max(0, (countInNextTime - audioCtx.currentTime) * 1000);
      setTimeout(() => {
        countInDisplay.style.display = "none";
      }, hideDelay);

      // Start recording + playback precisely at the next beat boundary
      isPlaying = true;
      isRecording = true;
      playBtn.classList.add("active");

      currentStep = 0;
      nextNoteTime = countInNextTime;
      loopStartTime = countInNextTime;

      // Switch from count-in timer to main scheduler
      if (countInTimerID !== null) {
        clearTimeout(countInTimerID);
        countInTimerID = null;
      }

      scheduler();
      startVisualLoop();
      return;
    }

    // Schedule the tick sound (beat 0 = accented "One" at 2400 Hz)
    const isDownbeat = (countInStep === 0);
    playMetronomeTick(countInNextTime, isDownbeat);

    // Schedule visual update: countdown number + metronome flash
    const displayNum = 4 - countInStep;
    const visualDelay = Math.max(0, (countInNextTime - audioCtx.currentTime) * 1000);
    setTimeout(() => {
      countInDisplay.textContent = displayNum.toString();
      flashMetronome();
    }, visualDelay);

    // Advance to the next beat
    const secondsPerBeat = 60.0 / bpm;
    countInNextTime += secondsPerBeat;
    countInStep++;
  }

  countInTimerID = window.setTimeout(countInScheduler, lookahead);
}

function stopCountIn() {
  isCountingIn = false;
  countInStep = 0;
  if (countInTimerID !== null) {
    clearTimeout(countInTimerID);
    countInTimerID = null;
  }
  countInDisplay.style.display = "none";
}

// ============================================================
// SEQUENCER ENGINE — "Golden Standard" Look-Ahead Scheduler
// ============================================================

// ---- Get loop duration at current BPM (seconds) ----
function getLoopDuration() {
  return (60.0 / bpm) * BEATS_PER_BAR * BARS;
}

// ---- Advance to next 1/32-note step (with swing at the 16th-note level) ----
// Swing only offsets the "even" 16th-note positions (odd-indexed 16ths)
// so the traditional MPC groove is preserved even at 1/32 resolution.
function nextNote() {
  const secondsPerBeat = 60.0 / bpm;
  const thirtySecondDur = secondsPerBeat / THIRTYSECONDS_PER_BEAT;
  const sixteenthDur = secondsPerBeat / SIXTEENTHS_PER_BEAT;
  const swingDelay = ((swingPercent / 100) - 0.5) * 2.0 * sixteenthDur;

  const sub = currentStep % STEPS_PER_SIXTEENTH; // 0 or 1 within a 16th

  if (sub === 0) {
    // First 32nd → second 32nd inside the same 16th: straight interval
    nextNoteTime += thirtySecondDur;
  } else {
    // Crossing a 16th-note boundary: account for swing offset
    const currentSixteenth = Math.floor(currentStep / STEPS_PER_SIXTEENTH);
    const nextSixteenth = currentSixteenth + 1;
    const leavingSwung = currentSixteenth % 2 === 1;
    const enteringSwung = nextSixteenth % 2 === 1;

    let interval = thirtySecondDur;
    if (leavingSwung) interval -= swingDelay;
    if (enteringSwung) interval += swingDelay;

    nextNoteTime += interval;
  }

  currentStep++;
  if (currentStep >= TOTAL_STEPS) {
    currentStep = 0;
    // Pin loop-start to prevent cumulative drift
    loopStartTime = nextNoteTime;
  }
}

// ---- Schedule a note (audio + deferred visual + note repeat + drum pattern) ----
function scheduleNote(step, time) {
  const stepsPerBar = THIRTYSECONDS_PER_BEAT * BEATS_PER_BAR;
  const barStep = step % stepsPerBar;

  // Every quarter-note beat (every 8 thirty-seconds)
  if (step % THIRTYSECONDS_PER_BEAT === 0) {
    if (metronomeEnabled) {
      // Determine if this is the first beat of a bar (downbeat = 2400 Hz)
      const isDownbeat = (step % stepsPerBar === 0);
      playMetronomeTick(time, isDownbeat);

      // Flash the metronome LED in sync with the audio tick
      const delay = Math.max(0, (time - audioCtx.currentTime) * 1000);
      setTimeout(() => flashMetronome(), delay);
    }
  }

  // ---- Drum Pattern: trigger TR steps at 16th-note boundaries ----
  if (barStep % STEPS_PER_SIXTEENTH === 0) {
    const sixteenthInBar = barStep / STEPS_PER_SIXTEENTH;
    for (let tr = 0; tr < DRUM_TRACKS; tr++) {
      if (drumPattern[tr][sixteenthInBar]) {
        playDrumSound(tr, time);
      }
    }
    // Defer playhead visual update to match audio timing
    const phDelay = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => updateSeqPlayhead(sixteenthInBar), phDelay);
  }

  // Play the sequenced slice if one exists at this step
  if (sequence[step] !== null) {
    const sliceId = sequence[step];
    playSlice(sliceId, time);

    // Defer visual highlight to match audio timing
    const delay = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => highlightPad(sliceId), delay);
  }

  // ---- Note Repeat: re-trigger held pads at every 1/32 step ----
  // Respects mute-group: each playSlice call cuts the previous source.
  if (isNoteRepeatActive()) {
    const pressed = getPressedPads();
    if (pressed.size > 0) {
      for (const padIdx of pressed) {
        playSlice(padIdx, time);

        const delay = Math.max(0, (time - audioCtx.currentTime) * 1000);
        setTimeout(() => highlightPad(padIdx), delay);

        // Record note-repeat hits into the sequence while recording
        if (isRecording) {
          const s = step % TOTAL_STEPS;
          if (s >= 0 && s < TOTAL_STEPS) {
            sequence[s] = padIdx;
          }
        }
      }
      // Batch-update event markers once per step (avoid heavy DOM churn)
      if (isRecording && pressed.size > 0) {
        setTimeout(() => renderEventMarkers(), 0);
      }
    }
  }
}

// ---- The main scheduler loop ----
function scheduler() {
  while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
    scheduleNote(currentStep, nextNoteTime);
    nextNote();
  }
  timerID = window.setTimeout(scheduler, lookahead);
}

// ---- Start playback ----
function startPlayback() {
  if (isPlaying) return;
  ensureAudioContext();

  isPlaying = true;
  playBtn.classList.add("active");

  currentStep = 0;
  nextNoteTime = audioCtx.currentTime;
  loopStartTime = nextNoteTime;

  scheduler();
  startVisualLoop();
}

// ---- Stop playback ----
function stopPlayback() {
  isPlaying = false;
  isRecording = false;

  // Cancel any active count-in
  stopCountIn();

  playBtn.classList.remove("active");
  recBtn.classList.remove("active");

  if (timerID !== null) {
    clearTimeout(timerID);
    timerID = null;
  }

  stopCurrent();
  stopVisualLoop();
  progressFill.style.width = "0%";
  clearSeqPlayhead();
}

// ---- Toggle recording (with 4-beat count-in pre-roll) ----
function toggleRecord() {
  if (!isRecording && !isCountingIn) {
    if (isPlaying) {
      // Already playing → engage recording immediately (overdub, no count-in)
      isRecording = true;
      recBtn.classList.add("active");
    } else {
      // Not playing → start a 4-beat count-in, then begin recording
      recBtn.classList.add("active");
      startCountIn();
    }
  } else {
    // Stop recording or cancel an in-progress count-in
    if (isCountingIn) {
      stopCountIn();
    }
    isRecording = false;
    recBtn.classList.remove("active");
  }
}

// ---- Clear the sequence ----
function clearSequence() {
  sequence.fill(null);
  renderEventMarkers();
}

// ---- Record an event (pad hit → sequence at 1/32 resolution) ----
// index = round( currentTimeInLoop / durationOfOne32ndNote )
function recordEvent(sliceId) {
  if (!audioCtx) return;

  const elapsed = audioCtx.currentTime - loopStartTime;
  const secondsPerBeat = 60.0 / bpm;
  const thirtySecondDur = secondsPerBeat / THIRTYSECONDS_PER_BEAT;
  const rawStep = elapsed / thirtySecondDur;

  let step;
  if (quantizeRes === 16) {
    // Snap to nearest 1/16 note (every 2nd 1/32 step)
    step = (Math.round(rawStep / 2) * 2) % TOTAL_STEPS;
  } else {
    // Snap to nearest 1/32 note
    step = Math.round(rawStep) % TOTAL_STEPS;
  }

  // Clamp to valid range
  if (step < 0) step = 0;
  if (step >= TOTAL_STEPS) step = TOTAL_STEPS - 1;

  sequence[step] = sliceId;
  renderEventMarkers();

  // Visual blip on the specific 1/32 tick where the note was placed
  flashTick(step);
}

// ---- Transport button listeners ----
recBtn.addEventListener("click", () => toggleRecord());
playBtn.addEventListener("click", () => {
  if (isPlaying) {
    // Restart from beginning
    stopPlayback();
    startPlayback();
  } else {
    startPlayback();
  }
});
stopBtn.addEventListener("click", () => stopPlayback());
clearBtn.addEventListener("click", () => clearSequence());

// ============================================================
// VISUAL UPDATES (progress bar, metronome LED, seq playhead)
// ============================================================

// ---- Start the requestAnimationFrame loop ----
function startVisualLoop() {
  if (animFrameID) return;
  updateVisuals();
}

// ---- Stop the animation loop ----
function stopVisualLoop() {
  if (animFrameID) {
    cancelAnimationFrame(animFrameID);
    animFrameID = null;
  }
}

// ---- Per-frame visual update ----
function updateVisuals() {
  if (isPlaying && audioCtx) {
    const elapsed = audioCtx.currentTime - loopStartTime;
    const loopDur = getLoopDuration();
    const progress = Math.min(1, Math.max(0, elapsed / loopDur));
    progressFill.style.width = (progress * 100) + "%";
  }
  animFrameID = requestAnimationFrame(updateVisuals);
}

// ---- Flash the metronome LED briefly ----
function flashMetronome() {
  metronomeLed.classList.add("flash");
  setTimeout(() => metronomeLed.classList.remove("flash"), 100);
}

// ---- Flash a grid tick (quantize snap visual) ----
function flashTick(step) {
  if (step < 0 || step >= tickElements.length) return;
  const tick = tickElements[step];
  tick.classList.add("tick-flash");
  setTimeout(() => tick.classList.remove("tick-flash"), 200);
}

// ---- Render event markers on the progress bar ----
function renderEventMarkers() {
  // Remove existing markers
  progressTicksContainer.querySelectorAll(".event-marker").forEach((el) => el.remove());

  for (let i = 0; i < TOTAL_STEPS; i++) {
    if (sequence[i] !== null) {
      const marker = document.createElement("div");
      marker.className = "event-marker";
      marker.style.left = ((i / TOTAL_STEPS) * 100) + "%";
      progressTicksContainer.appendChild(marker);
    }
  }
}

// ---- Update step sequencer running playhead (column highlight) ----
function updateSeqPlayhead(stepIdx) {
  for (let tr = 0; tr < seqStepElements.length; tr++) {
    for (let s = 0; s < seqStepElements[tr].length; s++) {
      seqStepElements[tr][s].classList.toggle("current", s === stepIdx);
    }
  }
}

// ---- Clear step sequencer playhead ----
function clearSeqPlayhead() {
  for (let tr = 0; tr < seqStepElements.length; tr++) {
    for (let s = 0; s < seqStepElements[tr].length; s++) {
      seqStepElements[tr][s].classList.remove("current");
    }
  }
}

// ============================================================
// KEYBOARD SHORTCUTS
// Shift = momentary Note Repeat (pad mode only).
// Pad keys tracked for press/release so Note Repeat knows
// which pads are held.
// ============================================================

// Pad mapping: 1234 / QWER / ASDF / ZXCV → pads 1-16
const keyMap = {
  "1": 0,  "2": 1,  "3": 2,  "4": 3,
  "q": 4,  "w": 5,  "e": 6,  "r": 7,
  "a": 8,  "s": 9,  "d": 10, "f": 11,
  "z": 12, "x": 13, "c": 14, "v": 15,
};

document.addEventListener("keydown", (e) => {
  // Ignore if typing in an input field
  if (e.target.tagName === "INPUT") return;

  // Shift key = momentary Note Repeat (activate on press)
  if (e.key === "Shift" && !e.repeat) {
    shiftHeld = true;
    return;
  }

  const key = e.key.toLowerCase();

  // Pad triggers + track pressed state for Note Repeat
  const padIdx = keyMap[key];
  if (padIdx !== undefined && decodedBuffer) {
    if (!e.repeat) {
      triggerPad(padIdx);
      keyPressedPads.add(padIdx);
    }
    return;
  }

  // Space → toggle play/stop
  if (e.code === "Space") {
    e.preventDefault();
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
    return;
  }
});

// Key-up: release pad tracking + Shift momentary off
document.addEventListener("keyup", (e) => {
  // Shift release = deactivate momentary Note Repeat
  if (e.key === "Shift") {
    shiftHeld = false;
    return;
  }

  const key = e.key.toLowerCase();
  const padIdx = keyMap[key];
  if (padIdx !== undefined) {
    keyPressedPads.delete(padIdx);
  }
});

// ============================================================
// HARDWARE BOOT SEQUENCE
// Simulates a vintage CRT startup on page load:
//   Stage 1 — LCD flickers on (hardware-on CSS animation).
//   Stage 2 — Diagnostic text appears line-by-line.
//   Stage 3 — After ~1.5 s the boot text clears and the main
//             UI is revealed with a brief phosphor flash.
// Total duration ≈ 2 seconds.  Non-blocking; the app is fully
// interactive (pads, transport, etc.) throughout.
// ============================================================

(function runBootSequence() {
  const lcdScreen = document.getElementById("lcd-screen");
  const bootOverlay = document.getElementById("boot-overlay");

  const bootLines = [
    "HAL-60 SYSTEM V1.0",
    "COPYRIGHT (C) 1988 HALSKY",
    "CHECKING RAM... 1024K OK",
    "MOUNTING BUMPLER OS...",
  ];

  // Stage 1: Power on — add .booting to trigger the hardware-on animation,
  // hide the normal UI content, and show the boot overlay + scan bar.
  lcdScreen.classList.add("booting");
  bootOverlay.textContent = "";

  // Stage 2: Diagnostic text appears line-by-line on the LCD
  bootLines.forEach((line, i) => {
    setTimeout(() => {
      bootOverlay.textContent += (i > 0 ? "\n" : "") + line;
    }, 300 + i * 280);
  });

  // Stage 3: Boot complete — flash and reveal the main Bumpler interface
  const revealTime = 300 + (bootLines.length - 1) * 280 + 500; // ≈ 1640 ms
  setTimeout(() => {
    // Remove boot state (re-shows splash, progress bar, waveform, etc.)
    lcdScreen.classList.remove("booting");

    // Brief brightness flash to simulate the final CRT "lock-in"
    lcdScreen.classList.add("boot-reveal");
    setTimeout(() => {
      lcdScreen.classList.remove("boot-reveal");
    }, 200);
  }, revealTime);
})();
