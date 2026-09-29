import { editInBrowser } from './browser.js'
import { dims, type Dims } from './files.js'
import { editedImage, DEFAULT_EDITS, noiseSeed, parseEditSettings, shadowMetrics, type ImageEdits } from './image-edit.js'

export type EditAction = 'edit' | 'resize' | 'optimize' | 'compress'
export interface EditSelection { settings: ImageEdits; action: EditAction }

function parseSelection(value: unknown): EditSelection | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const settings = parseEditSettings('settings' in v ? v.settings : value)
  const action = 'action' in v ? v.action : 'edit'
  return settings && ['edit', 'resize', 'optimize', 'compress'].includes(String(action)) ? { settings, action: action as EditAction } : null
}

// 슬라이더가 메인, 옆 숫자 칸은 px 직접 입력용
const rangeRow = (id: string, label: string, min: number, max: number, step: number, value: number, numeric = false): string =>
  `<div class="row${numeric ? ' num' : ''}"><label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">${numeric ? `<input id="${id}-n" type="number" min="${min}" max="${max}" step="${step}" aria-label="${label}">` : '<output></output>'}<button class="reset" type="button" data-reset="${id}" aria-label="Reset ${label}" title="Reset">↻</button></div>`

const shapeRow = (id: string, label: string, max: number, value: number): string => rangeRow(id, label, 0, max, 1, Math.min(value, max), true)

const PAGE = (initial: ImageEdits, d: Dims): string => {
  const shortSide = Math.min(d.width, d.height)
  const shadows = Object.fromEntries((['none', 'small', 'medium', 'large'] as const).map((size) => [size, shadowMetrics(shortSide, size)]))
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Subayai - Edit image&#x20;</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
[hidden] { display: none !important; }
:root {
  --bg-app: #0d0e12;
  --bg-surface: #14161b;
  --bg-card: #1b1d24;
  --bg-card-hover: #232630;
  --border: rgba(255, 255, 255, 0.08);
  --border-focus: rgba(255, 255, 255, 0.28);
  --text-main: #f3f4f6;
  --text-muted: #949ca9;
  --text-dim: #5a6270;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
}
body {
  margin: 0;
  background: var(--bg-app);
  color: var(--text-main);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
main {
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100vh;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.brand-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.04);
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  margin-bottom: 5px;
}
.brand-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3b82f6;
  box-shadow: 0 0 8px #3b82f6;
}
h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #fff;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dim-badge {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-variant-numeric: tabular-nums;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 16px;
  flex: 1;
}
.stage, .panel-container {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}
.stage {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 480px;
}
.stage-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.2);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.stage-bar .badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #3b82f6;
}
.stage-bar .badge::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.preview {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
  background-color: #0c0d11;
  background-image:
    linear-gradient(45deg, #13151c 25%, transparent 25%),
    linear-gradient(-45deg, #13151c 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #13151c 75%),
    linear-gradient(-45deg, transparent 75%, #13151c 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  overflow: hidden;
}
.preview svg {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 64vh;
  object-fit: contain;
}
.panel-container {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}
.tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--bg-card);
  padding: 3px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  gap: 2px;
}
.tabs button {
  background: transparent;
  color: var(--text-muted);
  border: 0;
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.15s ease;
}
.tabs button:hover {
  color: #fff;
}
.tabs button[aria-selected=true] {
  background: var(--bg-surface);
  color: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: grid;
  grid-template-columns: 110px minmax(80px, 1fr) 58px 28px;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: border-color 0.15s;
}
.row:focus-within {
  border-color: var(--border-focus);
}
.row.num { grid-template-columns: 100px minmax(40px, 1fr) 64px 28px; }
.row.rot { grid-template-columns: 100px minmax(40px, 1fr) auto 28px; }
.row label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  user-select: none;
}
input[type=range] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 20px;
  background: transparent;
  cursor: pointer;
  margin: 0;
}
input[type=range]:focus {
  outline: none;
}
input[type=range]::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.2);
  margin-top: -5px;
  transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.12s ease;
}
input[type=range]:hover::-webkit-slider-thumb {
  transform: scale(1.15);
  box-shadow: 0 2px 8px rgba(0,0,0,0.7), 0 0 0 2px rgba(255,255,255,0.4);
}
.row output {
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text-main);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
  padding: 4px 6px;
  border-radius: 5px;
  font-variant-numeric: tabular-nums;
}
.row input[type=number] {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  text-align: right;
  outline: none;
}
.reset { min-width: 28px; height: 28px; padding: 0 6px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 6px; background: rgba(255, 255, 255, 0.04); color: var(--text-muted); cursor: pointer; font-size: 15px; line-height: 1; }
.reset:hover { color: #fff; border-color: var(--border-focus); }
.reset.text { font-size: 11px; font-weight: 600; }
.row input[type=number]:focus {
  border-color: var(--border-focus);
}
.row select {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-surface);
  color: var(--text-main);
  font-size: 12px;
  outline: none;
  cursor: pointer;
}
.row select:focus {
  border-color: var(--border-focus);
}
.check {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-main);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, border-color 0.15s;
}
.check:hover {
  background: var(--bg-card-hover);
}
.check input[type=checkbox] {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border: 1.5px solid rgba(255, 255, 255, 0.3);
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  display: grid;
  place-content: center;
  transition: all 0.15s ease;
}
.check input[type=checkbox]:checked {
  background: #ffffff;
  border-color: #ffffff;
}
.check input[type=checkbox]:checked::before {
  content: "";
  width: 10px;
  height: 6px;
  border-left: 2px solid #0d0e12;
  border-bottom: 2px solid #0d0e12;
  transform: rotate(-45deg) translate(1px, -1px);
}
.switch label { flex: 1; cursor: pointer; }
.check.switch input[type=checkbox] { display: block; flex-shrink: 0; width: 34px; height: 19px; border: 0; border-radius: 99px; background: #454954; position: relative; }
.check.switch input[type=checkbox]::before, .check.switch input[type=checkbox]:checked::before { content: ''; position: absolute; width: 15px; height: 15px; left: 2px; top: 2px; border: 0; border-radius: 50%; background: #fff; transform: none; transition: transform .15s; }
.check.switch input[type=checkbox]:checked { background: #3b82f6; }
.check.switch input[type=checkbox]:checked::before { transform: translateX(15px); }
.picker { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); }
.sv { height: 150px; border-radius: 8px; position: relative; touch-action: none; cursor: crosshair; background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1); }
.sv:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.knob { position: absolute; width: 16px; height: 16px; border: 2.5px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.8); transform: translate(-50%, -50%); pointer-events: none; }
.picker-row { display: flex; align-items: center; gap: 10px; }
.swatch { width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; border: 1px solid var(--border-focus); }
input[type=range].hue::-webkit-slider-runnable-track { height: 10px; background: linear-gradient(90deg, red 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, red 100%); }
input[type=range].hue::-webkit-slider-thumb { margin-top: -4px; }
.fields { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr; gap: 6px; }
.fields label { display: flex; flex-direction: column; gap: 3px; color: var(--text-dim); font-size: 10px; font-weight: 600; text-transform: uppercase; text-align: center; }
.fields input { width: 100%; min-width: 0; padding: 5px 6px; border: 1px solid var(--border); border-radius: 5px; background: rgba(255, 255, 255, 0.05); color: #fff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; text-align: center; outline: none; }
.fields input:focus { border-color: var(--border-focus); }
dialog { margin: auto; padding: 20px; color: var(--text-main); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: 0 16px 48px rgba(0,0,0,.6); }
dialog::backdrop { background: rgba(0,0,0,.65); }
.action-options { display: grid; gap: 10px; margin: 16px 0 20px; }
.action-options label { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 4px;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 14px;
  color: var(--text-muted);
  font-size: 12px;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
  animation: pulse-dot 2s infinite;
}
@keyframes pulse-dot {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
}
.footer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.18);
}
.button.primary {
  background: #ffffff;
  color: #0b0c0e;
  border-color: #ffffff;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
.button.primary:hover:not(:disabled) {
  background: #f3f4f6;
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(255, 255, 255, 0.25);
}
.button:disabled {
  opacity: 0.45;
  cursor: wait;
}
@media(max-width: 860px) {
  main { padding: 16px; }
  .layout { grid-template-columns: 1fr; }
  .stage { min-height: 280px; }
  .preview svg { max-height: 40vh; }
  .panel-container { padding: 16px; }
}
</style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="brand-badge"><span class="brand-dot"></span>SUBAYAI / IMAGE STUDIO</div>
      <h1>Edit image</h1>
    </div>
    <div class="header-actions">
      <span class="dim-badge">${d.width} × ${d.height} px</span>
    </div>
  </header>
  <div class="layout">
    <section class="stage">
      <div class="stage-bar">
        <span>Preview Canvas</span>
        <span class="badge">Live</span>
      </div>
      <div class="preview">
        <svg id="svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Live image preview">
          <defs>
            <clipPath id="clip"><rect id="clip-rect" width="${d.width}" height="${d.height}"/></clipPath>
            <filter id="shadow-filter" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
              <feDropShadow id="shadow-effect" dx="0" dy="0" stdDeviation="0" flood-color="#000" flood-opacity=".35"/>
            </filter>
          </defs>
          <rect id="bg-frame"/>
          <g id="shadow-group"><image id="preview" href="/preview" width="${d.width}" height="${d.height}" clip-path="url(#clip)"/></g>
          <rect id="frame" fill="none" stroke="rgba(255,255,255,0.25)" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>
        </svg>
      </div>
    </section>
    <section class="panel-container">
      <div class="tabs" role="tablist" aria-label="Edit menu">
        <button role="tab" id="color-tab" aria-selected="true" aria-controls="color-panel">Color</button>
        <button role="tab" id="effects-tab" aria-selected="false" aria-controls="effects-panel">Effects</button>
        <button role="tab" id="shape-tab" aria-selected="false" aria-controls="shape-panel">Shape</button>
      </div>
      <section class="panel" id="color-panel" role="tabpanel" aria-labelledby="color-tab">
        ${rangeRow('brightness', 'Brightness', 0, 2, .01, initial.brightness)}
        ${rangeRow('saturation', 'Saturation', 0, 3, .01, initial.saturation)}
        ${rangeRow('hue', 'Color tone', -180, 180, 1, initial.hue)}
        <div class="check switch"><label for="grayscale">Black and white</label><input id="grayscale" type="checkbox" ${initial.grayscale ? 'checked' : ''}><button class="reset" type="button" data-reset="grayscale" aria-label="Reset black and white" title="Reset">↻</button></div>
      </section>
      <section class="panel" id="effects-panel" role="tabpanel" aria-labelledby="effects-tab" hidden>
        ${rangeRow('pixelate', 'Pixelation', 1, 40, 1, initial.pixelate)}
        ${rangeRow('blur', 'Blur', 0, 30, .5, initial.blur)}
        ${rangeRow('noise', 'Noise', 0, .5, .01, initial.noise)}
        ${rangeRow('sharpen', 'Sharpen', 0, 5, .1, initial.sharpen)}
      </section>
      <section class="panel" id="shape-panel" role="tabpanel" aria-labelledby="shape-tab" hidden>
        ${shapeRow('radius', 'Corner radius', Math.floor(Math.min(d.width, d.height) / 2), initial.radius)}
        ${shapeRow('px', 'Padding', Math.max(1, Math.round(Math.max(d.width, d.height) / 2)), initial.px)}
        <div class="row"><label for="shadow">Shadow</label><select id="shadow"><option value="none">None</option><option value="small" ${initial.shadow === 'small' ? 'selected' : ''}>Small</option><option value="medium" ${initial.shadow === 'medium' ? 'selected' : ''}>Medium</option><option value="large" ${initial.shadow === 'large' ? 'selected' : ''}>Large</option></select><output id="shadow-out">${initial.shadow === 'none' ? 'Off' : initial.shadow}</output><button class="reset" type="button" data-reset="shadow" aria-label="Reset Shadow" title="Reset">↻</button></div>
        <div class="row rot"><label for="rotate">Rotation</label><input id="rotate" type="number" min="0" max="359" step="1" value="${initial.rotate}" aria-label="Rotation in degrees"><button class="reset text" type="button" id="rotate-90" aria-label="Rotate 90 degrees clockwise" title="Rotate 90°">+90°</button><button class="reset" type="button" data-reset="rotate" aria-label="Reset rotation" title="Reset">↻</button></div>
        <div class="check switch"><label for="inset">Keep original canvas size</label><input id="inset" type="checkbox" ${initial.inset ? 'checked' : ''}><button class="reset" type="button" data-reset="inset" aria-label="Reset canvas size" title="Reset">↻</button></div>
        <div class="check switch"><label for="background-on">Solid padding background</label><input id="background-on" type="checkbox" ${initial.background ? 'checked' : ''}><button class="reset" type="button" data-reset="background-on" aria-label="Reset padding background" title="Reset">↻</button></div>
        <div class="picker" id="palette" ${initial.background ? '' : 'hidden'}>
          <div id="sv" class="sv" role="slider" aria-label="Saturation and brightness" tabindex="0"><i class="knob" id="knob"></i></div>
          <div class="picker-row"><span class="swatch" id="swatch"></span><input class="hue" id="bg-hue" type="range" min="0" max="360" step="1" aria-label="Hue"><button class="reset" type="button" data-reset="background-color" aria-label="Reset background color" title="Reset">↻</button></div>
          <div class="fields"><label>Hex<input id="background-color" value="${initial.background ?? '#ffffff'}" spellcheck="false" aria-label="Hex color"></label><label>R<input id="bg-r" type="number" min="0" max="255"></label><label>G<input id="bg-g" type="number" min="0" max="255"></label><label>B<input id="bg-b" type="number" min="0" max="255"></label></div>
        </div>
      </section>
    </section>
  </div>
  <footer class="footer">
    <div class="status-pill"><span class="status-dot"></span><span id="status" role="status" aria-live="polite">Preview ready</span></div>
    <div class="footer-actions">
      <button class="button" id="cancel">Cancel</button>
      <button class="button primary" id="apply">OK</button>
    </div>
  </footer>
</main>
<dialog id="action-dialog" aria-labelledby="action-title">
  <form method="dialog">
    <h2 id="action-title">Choose what to do after editing</h2>
    <div class="action-options">
      <label><input type="radio" name="action" value="edit" checked> Edit only</label>
      <label><input type="radio" name="action" value="resize"> Resize</label>
      <label><input type="radio" name="action" value="optimize"> Optimize</label>
      <label><input type="radio" name="action" value="compress"> Compress</label>
    </div>
    <div class="dialog-actions">
      <button class="button" type="button" id="action-cancel">Cancel</button>
      <button class="button primary" value="confirm">Apply</button>
    </div>
  </form>
</dialog>
<script>
const defaults=${JSON.stringify(DEFAULT_EDITS)},shadows=${JSON.stringify(shadows)},ids=['brightness','saturation','hue','pixelate','blur','noise','sharpen','grayscale','radius','px','shadow','inset'],shape=['radius','px'],W0=${d.width},H0=${d.height};
const controls=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)])),preview=document.querySelector('#preview'),status=document.querySelector('#status'),rotateInput=document.querySelector('#rotate'),rot=()=>((Math.round(Number(rotateInput.value))||0)%360+360)%360;let timer,request,shownRotate=${initial.rotate};
function settings(){return {...Object.fromEntries(ids.map(id=>[id,id==='grayscale'||id==='inset'?controls[id].checked:id==='shadow'?controls[id].value:Number(controls[id].value)])),background:document.querySelector('#background-on').checked?document.querySelector('#background-color').value:null,rotate:rot()}}
function render(){const a=shownRotate*Math.PI/180,c=Math.abs(Math.cos(a)),sn=Math.abs(Math.sin(a)),W=Math.round(W0*c+H0*sn),H=Math.round(W0*sn+H0*c),r=Number(controls.radius.value),p=Number(controls.px.value),s=shadows[controls.shadow.value],inset=controls.inset.checked,m=inset?p+s.padding:0,w=inset?Math.max(1,W-2*m):W,h=inset?Math.max(1,H-2*m):H,set=(el,a)=>{for(const k in a)el.setAttribute(k,a[k])},bg=document.querySelector('#background-on').checked?document.querySelector('#background-color').value:'none';set(document.querySelector('#svg'),{viewBox:'0 0 '+(inset?W:W+2*(p+s.padding))+' '+(inset?H:H+2*(p+s.padding))});set(preview,{x:inset?m:p+s.padding,y:inset?m:p+s.padding,width:w,height:h});set(document.querySelector('#clip-rect'),{x:inset?m:p+s.padding,y:inset?m:p+s.padding,width:w,height:h,rx:r,ry:r});set(document.querySelector('#shadow-effect'),{dx:0,dy:s.offset,stdDeviation:s.blur});if(s.blur)set(document.querySelector('#shadow-group'),{filter:'url(#shadow-filter)'});else document.querySelector('#shadow-group').removeAttribute('filter');set(document.querySelector('#frame'),{x:inset?0:s.padding,y:inset?0:s.padding,width:inset?W:W+2*p,height:inset?H:H+2*p});set(document.querySelector('#bg-frame'),{x:0,y:0,width:inset?W:W+2*(p+s.padding),height:inset?H:H+2*(p+s.padding),fill:bg});document.querySelector('#shadow-out').value=controls.shadow.value==='none'?'Off':controls.shadow.value;document.querySelector('#palette').hidden=!document.querySelector('#background-on').checked}
function format(id,value){if(id==='grayscale'||id==='shadow'||id==='inset')return;if(shape.includes(id)){document.getElementById(id+'-n').value=value;render();return}const output=controls[id].parentElement.querySelector('output');output.value=id==='hue'?value+'°':id==='pixelate'?value+' px':Number(value).toFixed(2)}
async function refresh(){clearTimeout(timer);timer=setTimeout(async()=>{if(request)request.abort();request=new AbortController();const sent=settings();status.textContent='Updating preview…';try{const response=await fetch('/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sent),signal:request.signal});if(!response.ok)throw new Error(await response.text());const blob=await response.blob(),url=URL.createObjectURL(blob),old=preview.getAttribute('href');preview.setAttribute('href',url);shownRotate=sent.rotate;render();if(old.startsWith('blob:'))URL.revokeObjectURL(old);status.textContent='Preview ready'}catch(error){if(error.name!=='AbortError')status.textContent='Preview failed: '+error.message}},180)}
for(const id of ids){format(id,controls[id].type==='checkbox'?controls[id].checked:controls[id].value);controls[id].addEventListener('input',()=>{format(id,controls[id].type==='checkbox'?controls[id].checked:controls[id].value);if(!shape.includes(id))refresh()})}
for(const id of shape){const num=document.getElementById(id+'-n');num.addEventListener('input',()=>{if(num.value==='')return;controls[id].value=Math.max(0,Math.min(Number(controls[id].max),Math.round(Number(num.value))));render()});num.addEventListener('change',()=>{num.value=controls[id].value})}
controls.shadow.addEventListener('change',()=>{render();refresh()});controls.inset.addEventListener('change',()=>{render();refresh()});
const bgOn=document.querySelector('#background-on'),bgColor=document.querySelector('#background-color'),sv=document.querySelector('#sv'),bgHue=document.querySelector('#bg-hue'),rgbInputs=['r','g','b'].map(c=>document.getElementById('bg-'+c));let hsv=[0,0,1];
function toHsv(hex){const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(r,g,b),d=max-Math.min(r,g,b),h=d===0?0:max===r?60*(((g-b)/d)%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4);return [h<0?h+360:h,max===0?0:d/max,max]}
function toHex([h,s,v]){const f=n=>{const k=(n+h/60)%6;return Math.round((v-v*s*Math.max(0,Math.min(k,4-k,1)))*255).toString(16).padStart(2,'0')};return '#'+f(5)+f(3)+f(1)}
// 배경색은 SVG로만 그려짐 → 서버 미리보기 요청 없이 render()만
function setBg(hex,next){bgColor.value=hex;hsv=next||toHsv(hex);sv.style.backgroundColor='hsl('+hsv[0]+',100%,50%)';document.querySelector('#knob').style.left=hsv[1]*100+'%';document.querySelector('#knob').style.top=(1-hsv[2])*100+'%';bgHue.value=hsv[0];rgbInputs.forEach((el,i)=>el.value=parseInt(hex.slice(1+2*i,3+2*i),16));document.querySelector('#swatch').style.background=hex;render()}
const setHsv=next=>setBg(toHex(next),next),clamp01=n=>Math.min(1,Math.max(0,n));
function point(e){const b=sv.getBoundingClientRect();setHsv([hsv[0],clamp01((e.clientX-b.left)/b.width),1-clamp01((e.clientY-b.top)/b.height)])}
sv.addEventListener('pointerdown',e=>{sv.setPointerCapture(e.pointerId);point(e)});sv.addEventListener('pointermove',e=>{if(sv.hasPointerCapture(e.pointerId))point(e)});
sv.addEventListener('keydown',e=>{const d=e.shiftKey?.1:.01,k={ArrowLeft:[-d,0],ArrowRight:[d,0],ArrowUp:[0,d],ArrowDown:[0,-d]}[e.key];if(!k)return;e.preventDefault();setHsv([hsv[0],clamp01(hsv[1]+k[0]),clamp01(hsv[2]+k[1])])});
bgHue.addEventListener('input',()=>setHsv([Number(bgHue.value),hsv[1],hsv[2]]));
rgbInputs.forEach(el=>el.addEventListener('input',()=>setBg('#'+rgbInputs.map(x=>Math.min(255,Math.max(0,Math.round(Number(x.value))||0)).toString(16).padStart(2,'0')).join(''))));
bgColor.addEventListener('change',()=>{const m=bgColor.value.trim().replace(/^#/,'');setBg(/^[0-9a-f]{6}$/i.test(m)?'#'+m.toLowerCase():toHex(hsv))});
bgOn.addEventListener('change',render);setBg(bgColor.value);
rotateInput.addEventListener('input',()=>{if(rotateInput.value!=='')refresh()});rotateInput.addEventListener('change',()=>{rotateInput.value=rot()});document.querySelector('#rotate-90').addEventListener('click',()=>{rotateInput.value=(rot()+90)%360;refresh()});
document.querySelectorAll('[role=tab]').forEach(tab=>tab.addEventListener('click',()=>{for(const item of document.querySelectorAll('[role=tab]'))item.setAttribute('aria-selected',String(item===tab));for(const panel of document.querySelectorAll('[role=tabpanel]'))panel.hidden=panel.id!==tab.getAttribute('aria-controls')}));
document.querySelectorAll('[data-reset]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.reset;if(id==='background-color'||id==='background-on'){if(id==='background-on')bgOn.checked=false;setBg('#ffffff');return}if(id==='rotate'){rotateInput.value=0;refresh();return}if(id==='grayscale'||id==='inset')controls[id].checked=defaults[id];else controls[id].value=defaults[id];format(id,controls[id].value);render();refresh()}));
document.querySelector('#grayscale').addEventListener('change',refresh);
async function submit(path){clearTimeout(timer);document.querySelectorAll('button').forEach(button=>button.disabled=true);status.textContent=path==='/apply'?'Applying…':'Cancelling…';try{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:path==='/apply'?JSON.stringify({settings:settings(),action:document.querySelector('input[name="action"]:checked').value}):'{}'});if(!response.ok)throw new Error(await response.text());status.textContent=path==='/apply'?'Done. You can close this tab.':'Cancelled. You can close this tab.';window.close()}catch(error){document.querySelectorAll('button').forEach(button=>button.disabled=false);status.textContent=String(error)}}
const actionDialog=document.querySelector('#action-dialog');
document.querySelector('#apply').addEventListener('click',()=>actionDialog.showModal());
actionDialog.addEventListener('close',()=>{if(actionDialog.returnValue==='confirm')submit('/apply')});
document.querySelector('#action-cancel').addEventListener('click',()=>actionDialog.close());
document.querySelector('#cancel').addEventListener('click',()=>submit('/cancel'));
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!actionDialog.open)submit('/cancel')}else if(e.key==='Enter'&&!actionDialog.open&&e.target.tagName!=='INPUT'&&e.target.tagName!=='SELECT')actionDialog.showModal()});
</script></body></html>`
}

export async function editImageInBrowser(file: string, initial: ImageEdits): Promise<{ settings: ImageEdits; seed: number; action: EditAction } | null> {
  const seed = noiseSeed()
  const png = async (s: ImageEdits) => ({ type: 'image/png', data: await (await editedImage(file, s, seed, true)).png().toBuffer() })
  const selection = await editInBrowser(PAGE(initial, await dims(file)), parseSelection, {
    'GET /preview': () => png(initial),
    'POST /preview': (s) => png(s?.settings ?? initial),
  })
  return selection && { ...selection, seed }
}
