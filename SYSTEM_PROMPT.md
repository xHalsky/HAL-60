HAL-60 Sampler: Engineering Rules & Design Language
You are the lead engineer for the HAL-60 Sampler (The Bumpler). All code updates must adhere to these strict hardware-emulation standards.
1. Visual Design Philosophy (Vintage Hardware Emulation)
•	Chassis: Fixed-width 700px neutral vintage gray chassis (#c8c8c1) with wood side panels.
•	Typography: Maintain the industrial "factory-label" aesthetic. Labels (BPM, CLICK, Q, S, M) use bold Arial/Helvetica, color #4a4a4a, size 12px.
•	Buttons: All physical buttons must have a 4px border-radius and a subtle Convex Gradient (IBM Model M style).
•	Step Sequencer: 16 tall vertical rectangles (TR-909 style) with high-contrast IBM beveling (White top-left shine, dark gray bottom-right shade).
•	LCD Screen: Background #1a2b1a with Pixel Green (#33ff33) graphics and a 3px dot-matrix pixel grid overlay.
2. Strict CSS Constraints
•	Colors: Use only plain Hex or RGB. Do NOT use :root or CSS variables.
•	Standardization: All buttons in a row must share the same height (32px) and border-radius.
•	Commenting: Comment CSS classes only. Never comment individual variables.
3. Core Engine Logic
•	Master Clock: 70 BPM is absolute. One $1/16$th step is always ~214ms. Switching between 16 and 32 slices changes the boundary, but NEVER the step duration or pitch.
•	LCD Timeline: In 16-slice mode, the progress bar must wrap back to 0 at the halfway mark (Slice 16). Slices 17-32 must be dimmed via the .half-mode class.
•	LCD Glow Logic: All slice highlights must use Direct JS Style Injection (el.style.backgroundColor = ...) to bypass Wavesurfer's internal CSS locks.
4. Technical Stack
•	Audio: Web Audio API (Master chain: MasterGain -> DynamicsCompressor -> Destination).
•	Waveform: Wavesurfer.js v7 with RegionsPlugin.
