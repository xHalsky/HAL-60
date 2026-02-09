// ============================================================
// SlicePad – 16-Pad Audio Sampler with Sequencer (app.js)
// Wavesurfer.js v7 (ES module) + Web Audio API
// Features: 16-pad sampler, mute-group, 8-bar loop recorder,
//           quantize (1/32), MPC-style swing, visual metronome,
//           MPC-style note repeat (Shift = momentary).
// Visual: MPC 60 vintage aesthetic with dot-matrix LCD.
// ============================================================

import WaveSurfer from "https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js";
import RegionsPlugin from "https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.esm.js";

// ============================================================
// CONSTANTS
// ============================================================

const NUM_PADS = 16;
const BARS = 8;
const BEATS_PER_BAR = 4;
const THIRTYSECONDS_PER_BEAT = 8;    // 1/32-note resolution per beat
const SIXTEENTHS_PER_BEAT = 4;       // Used for swing grouping (16th-note level)
const STEPS_PER_SIXTEENTH = 2;       // Two 32nds make one 16th
const TOTAL_STEPS = BARS * BEATS_PER_BAR * THIRTYSECONDS_PER_BEAT; // 256

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
// DOM REFERENCES
// ============================================================

// Waveform / file
const loadBtn = document.getElementById("load-btn");
const fileInput = document.getElementById("file-input");
const fileNameEl = document.getElementById("file-name");
const dropZone = document.getElementById("drop-zone");

// LCD BPM display
const lcdBpmDisplay = document.getElementById("lcd-bpm-display");

// Pitch
const pitchSlider = document.getElementById("pitch-slider");
const pitchValueEl = document.getElementById("pitch-value");

// Bump (master compressor)
const bumpSlider = document.getElementById("bump-slider");
const bumpValueEl = document.getElementById("bump-value");

// Pad grid container
const padGrid = document.getElementById("pad-grid");

// Transport
const bpmInput = document.getElementById("bpm-input");
const bpmSlider = document.getElementById("bpm-slider");
const metronomeLed = document.getElementById("metronome-led");
const quantizeBtn = document.getElementById("quantize-btn");
const swingSlider = document.getElementById("swing-slider");
const swingValueEl = document.getElementById("swing-value");
const noteRepeatBtn = document.getElementById("note-repeat-btn");
const recBtn = document.getElementById("rec-btn");
const playBtn = document.getElementById("play-btn");
const stopBtn = document.getElementById("stop-btn");
const clearBtn = document.getElementById("clear-btn");

// Progress bar
const progressFill = document.getElementById("loop-progress-fill");
const progressTicksContainer = document.getElementById("loop-progress-ticks");

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

// Wavesurfer
let wavesurfer = null;
let wsRegions = null;
let regions = []; // { id, start, end, wsRegion }

// Sequencer
let bpm = 120;
let isPlaying = false;
let isRecording = false;
let quantizeOn = true;
let swingPercent = 50; // 50 = no swing, up to 75

// Note Repeat
let noteRepeatToggled = false;       // Latching toggle via the NR button
let shiftHeld = false;               // Momentary via Shift key
const mousePressedPads = new Set();  // Pads held via mouse / touch
const keyPressedPads = new Set();    // Pads held via keyboard

// Sequence buffer: 256 slots (one per 32nd note), each null or a sliceId (0-15)
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
// BUILD PROGRESS BAR TICK MARKS (256 × 1/32nd note grid)
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
    // Blocky bar style to simulate dot-matrix / low-res display
    barWidth: 3,
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
// PITCH SLIDER
// ============================================================

pitchSlider.addEventListener("input", () => {
  semitones = parseInt(pitchSlider.value, 10);
  const sign = semitones > 0 ? "+" : "";
  pitchValueEl.textContent = `${sign}${semitones} ST`;

  if (currentSource) {
    try {
      currentSource.playbackRate.value = Math.pow(2, semitones / 12);
    } catch (_) {}
  }
});

// ============================================================
// BUMP SLIDER — Master Compressor Threshold
// Controls how hard the DynamicsCompressorNode "squashes" the
// output.  0 = no compression (threshold 0 dB),
// 60 = maximum squeeze (threshold -60 dB).
// ============================================================

bumpSlider.addEventListener("input", () => {
  bumpAmount = parseInt(bumpSlider.value, 10);
  bumpValueEl.textContent = bumpAmount === 0 ? "OFF" : `-${bumpAmount} dB`;

  if (compressorNode) {
    compressorNode.threshold.setValueAtTime(-bumpAmount, audioCtx.currentTime);
  }
});

// ============================================================
// BPM CONTROLS
// ============================================================

function setBpm(val) {
  bpm = Math.max(60, Math.min(200, Number(val) || 120));
  bpmInput.value = bpm;
  bpmSlider.value = bpm;
  // Update LCD BPM display
  if (lcdBpmDisplay) {
    lcdBpmDisplay.textContent = bpm + " BPM";
  }
}

bpmInput.addEventListener("change", () => setBpm(bpmInput.value));
bpmSlider.addEventListener("input", () => setBpm(bpmSlider.value));

// ============================================================
// QUANTIZE TOGGLE
// ============================================================

quantizeBtn.addEventListener("click", () => {
  quantizeOn = !quantizeOn;
  quantizeBtn.classList.toggle("active", quantizeOn);
});

// ============================================================
// SWING CONTROL
// ============================================================

swingSlider.addEventListener("input", () => {
  swingPercent = parseInt(swingSlider.value, 10);
  swingValueEl.textContent = swingPercent + "%";
});

// ============================================================
// NOTE REPEAT — MPC-Style Auto-Retrigger
// When active, held pads re-fire on every 1/32 step via the
// scheduler.  Toggle via button or hold Shift for momentary.
// ============================================================

function isNoteRepeatActive() {
  return noteRepeatToggled || shiftHeld;
}

function getPressedPads() {
  const union = new Set(mousePressedPads);
  for (const p of keyPressedPads) union.add(p);
  return union;
}

noteRepeatBtn.addEventListener("click", () => {
  noteRepeatToggled = !noteRepeatToggled;
  noteRepeatBtn.classList.toggle("active", noteRepeatToggled);
});

// Clear all pressed pads when the window loses focus (prevent stuck repeats)
window.addEventListener("blur", () => {
  mousePressedPads.clear();
  keyPressedPads.clear();
  shiftHeld = false;
  if (!noteRepeatToggled) {
    noteRepeatBtn.classList.remove("active");
  }
});

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

// ---- Schedule a note (audio + deferred visual + note repeat) ----
function scheduleNote(step, time) {
  // Flash metronome on every beat (every 8 thirty-seconds = 1 quarter note)
  if (step % THIRTYSECONDS_PER_BEAT === 0) {
    const delay = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => flashMetronome(), delay);
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

  playBtn.classList.remove("active");
  recBtn.classList.remove("active");

  if (timerID !== null) {
    clearTimeout(timerID);
    timerID = null;
  }

  stopCurrent();
  stopVisualLoop();
  progressFill.style.width = "0%";
}

// ---- Toggle recording ----
function toggleRecord() {
  if (!isRecording) {
    isRecording = true;
    recBtn.classList.add("active");
    // Auto-start playback when record is engaged
    if (!isPlaying) startPlayback();
  } else {
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
  if (quantizeOn) {
    step = Math.round(rawStep) % TOTAL_STEPS;
  } else {
    step = Math.floor(rawStep) % TOTAL_STEPS;
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
// VISUAL UPDATES (progress bar, metronome LED)
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

// ============================================================
// KEYBOARD SHORTCUTS
// Shift = momentary Note Repeat.  Pad keys tracked for
// press/release so Note Repeat knows which pads are held.
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
    noteRepeatBtn.classList.add("active");
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
    if (!noteRepeatToggled) {
      noteRepeatBtn.classList.remove("active");
    }
    return;
  }

  const key = e.key.toLowerCase();
  const padIdx = keyMap[key];
  if (padIdx !== undefined) {
    keyPressedPads.delete(padIdx);
  }
});
