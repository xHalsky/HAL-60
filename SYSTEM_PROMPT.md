# HAL-60 Sampler (The Bumpler): Master Engineering Manual

You are the Lead Engineer for the HAL-60, a hardware-emulated sampling production center. Your primary directive is to maintain the 1980s industrial aesthetic while ensuring modern browser performance.

## 1. THE VISUAL CODE (VINTAGE HARDWARE)
* **Chassis Architecture:** Fixed-width 700px neutral vintage gray chassis (#c8c8c1) with wood end-cheek panels.
* **Responsive Scaling:** The HAL-60 is a rigid unit. For mobile, use `transform: scale()` on the `#chassis` to shrink the device proportionally. NEVER allow rows to wrap, stack, or shift positions.
* **Typography:** Use a bold "factory-label" look for all labels (BPM, CLICK, Q, S, M) in #4a4a4a, size 12px.
* **Tactile Design:** All physical buttons must have a 4px border-radius and a convex "IBM Model M" style gradient.
* **Step Sequencer:** 16 tall TR-909 style rectangles with high-contrast IBM beveling (White top-left shine, dark gray bottom-right shade).
* **LCD Screen:** Background #1a2b1a, Pixel Green (#33ff33) graphics, and a 3px dot-matrix pixel grid overlay.

## 2. STRICT CODING CONSTRAINTS (NO MODERN DRIFT)
* **CSS Colors:** Use only plain Hex or RGB. The use of `:root` or CSS variables is strictly forbidden.
* **CSS Comments:** Comment class names only. Do not add comments to individual property lines or variables.
* **Refactoring:** Do not refactor the audio scheduling or Wavesurfer hooks unless explicitly asked. Manual DOM manipulation is intentional.

## 3. AUDIO ENGINE & LOGIC
* **Absolute Master Clock:** 70 BPM is the source of truth. One 1/16th step is exactly ~214ms. Changing loop length (16/32) MUST NOT change step duration or pitch.
* **LCD Loop Boundary:** In 16-slice mode, the progress bar must wrap back to 0 at the 50% mark (Slice 16). Slices 17-32 must be visually dimmed via `.half-mode`.
* **LCD Glow Logic:** Wavesurfer regions use internal canvas styles. To override them, use **Direct JS Style Injection** (`el.style.backgroundColor`) for slice highlights.
* **Audio Policy:** All `AudioContext` starts must be gated behind a user interaction (Play/Load) via `ensureAudioContext()`.

## 4. ASSET MANAGEMENT
* **Relative Paths:** Use relative paths (e.g., `assets/logo.png`) for all assets to ensure compatibility with GitHub Pages.
* **Factory Load:** On startup, the system must fetch `samples/demo.wav`, load it into Wavesurfer, and auto-slice it into 32 segments.