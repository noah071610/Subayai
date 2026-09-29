import sharp from 'sharp'
import { editInBrowser, type Asset } from './browser.js'
import type { Fill, Gradient } from './gradient.js'
import { parseColor, toHex, type Rgba } from './ui.js'

const PAGE = (title: string, initial: Rgba, canPreparePreview: boolean): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Subayai - ${title}&#x20;</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg-app: #0d0e12;
  --bg-surface: #14161b;
  --bg-card: #1b1d24;
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
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
}
h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #fff;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
  flex: 1;
}
.stage, .panel {
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
  color: #10b981;
}
.stage-bar .badge::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.stage-canvas {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 32px;
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
.stage-canvas img {
  display: block;
  max-width: 100%;
  max-height: 62vh;
  object-fit: contain;
  filter: drop-shadow(0 12px 32px rgba(0, 0, 0, 0.5));
}
.panel {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}
.section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.swatches {
  display: grid;
  grid-template-columns: repeat(11, 1fr);
  gap: 6px;
}
.swatch {
  aspect-ratio: 1;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.12s ease;
  position: relative;
}
.swatch:hover {
  transform: scale(1.18);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
  z-index: 2;
}
.swatch:focus-visible,
.swatch.active {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.gradient-preview {
  width: 100%;
  height: 42px;
  border: 1px solid var(--border-focus);
  border-radius: var(--radius-sm);
  color: var(--text-main);
  background: var(--bg-card);
  cursor: pointer;
  text-align: left;
  padding: 0 12px;
}
.gradient-preview.has-gradient { color: transparent; }
#gradient-popover {
  width: 280px;
  padding: 14px;
  border: 1px solid var(--border-focus);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-main);
  box-shadow: 0 12px 40px rgba(0,0,0,.6);
  margin: auto;
}
.gradient-popover-preview { height: 64px; border-radius: var(--radius-sm); margin-bottom: 12px; }
.gradient-options { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
.gradient-options label { flex: 1; display: flex; flex-direction: column; gap: 5px; color: var(--text-muted); font-size: 11px; }
.gradient-options input[type=color] { width: 100%; height: 34px; padding: 2px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); }
#gradient-direction { width: 100%; padding: 8px; color: var(--text-main); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.gradient-popover-actions { display: flex; justify-content: space-between; gap: 8px; }
.gradient-popover-actions button { padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-main); background: var(--bg-card); cursor: pointer; }
.gradient-popover-actions .primary { color: #0b0c0e; background: #fff; }
.recent-gradients { display: flex; gap: 6px; margin-top: 8px; }
.recent-gradient { width: 34px; height: 28px; border: 1px solid var(--border-focus); border-radius: 5px; cursor: pointer; }
.sv {
  height: 165px;
  border-radius: 8px;
  position: relative;
  touch-action: none;
  cursor: crosshair;
  background-color: hsl(${initial.r},100%,50%);
  background-image:
    linear-gradient(to top, #000, transparent),
    linear-gradient(to right, #fff, transparent);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1), 0 2px 8px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
.sv:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.knob {
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2.5px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.8);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.control-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}
.control-top label {
  color: var(--text-muted);
  font-weight: 500;
}
.control-top output {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text-main);
  background: var(--bg-card);
  padding: 1px 7px;
  border-radius: 4px;
  border: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
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
  height: 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.2);
  margin-top: -5.5px;
  transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.12s ease;
}
input[type=range]:hover::-webkit-slider-thumb {
  transform: scale(1.15);
  box-shadow: 0 2px 8px rgba(0,0,0,0.7), 0 0 0 2px rgba(255,255,255,0.4);
}
.hue::-webkit-slider-runnable-track {
  background: linear-gradient(90deg, red 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, red 100%);
}
.opacity::-webkit-slider-runnable-track {
  background:
    linear-gradient(90deg, transparent, #ffffff),
    linear-gradient(45deg, #2a2d34 25%, transparent 25%),
    linear-gradient(-45deg, #2a2d34 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a2d34 75%),
    linear-gradient(-45deg, transparent 75%, #2a2d34 75%);
  background-size: 100% 100%, 8px 8px, 8px 8px, 8px 8px, 8px 8px;
  background-position: 0 0, 0 0, 0 4px, 4px -4px, -4px 0;
}
.fields {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-top: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.field:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 2px rgba(255,255,255,0.06);
}
.field label {
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.field input {
  background: none;
  border: 0;
  color: #fff;
  min-width: 0;
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  outline: none;
}
.field.hex {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
}
.hex-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.hex-inner label {
  margin: 0;
}
.native-wrap {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border);
  position: relative;
  flex-shrink: 0;
}
.native-wrap input[type=color] {
  position: absolute;
  top: -6px;
  left: -6px;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.prepare-box {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.prepare {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.prepare:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
}
.prepare:disabled {
  opacity: 0.5;
  cursor: wait;
}
.note {
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.45;
}
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
.status {
  font-variant-numeric: tabular-nums;
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
  .stage-canvas img { max-height: 45vh; }
  .panel { padding: 16px; }
}
</style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="brand-badge"><span class="brand-dot"></span>SUBAYAI / COLOR STUDIO</div>
      <h1>${title}</h1>
    </div>
  </header>
  <div class="layout">
    <section class="stage">
      <div class="stage-bar">
        <span>Preview Canvas</span>
        <span class="badge">Live</span>
      </div>
      <div class="stage-canvas">
        <img id="preview" alt="Live preview" src="/preview">
      </div>
    </section>
    <section class="panel">
      <div>
        <div class="section-title">Color presets</div>
        <div class="swatches" aria-label="Color presets">${['#ffffff','#d9d9d9','#808080','#222222','#f04438','#f79009','#fdb022','#12b76a','#2e90fa','#7a5af8','#ee46bc'].map((color) => `<button class="swatch" type="button" aria-label="${color}" data-color="${color}" style="background:${color}"></button>`).join('')}</div>
      </div>
      <div>
        <div class="section-title">Gradient</div>
        <button class="gradient-preview" id="gradient-button" type="button" popovertarget="gradient-popover">None</button>
        <div id="recent-gradients" class="recent-gradients" aria-label="Recent gradients" hidden></div>
      </div>
      <div>
        <div class="section-title">Picker</div>
        <div id="sv" class="sv" role="slider" aria-label="Saturation and brightness" tabindex="0"><i class="knob" id="knob"></i></div>
      </div>
      <div>
        <div class="control">
          <div class="control-top"><label for="hue">Hue</label><output id="hue-out">0°</output></div>
          <input class="hue" id="hue" type="range" min="0" max="360" value="0">
        </div>
        <div class="control">
          <div class="control-top"><label for="alpha">Opacity</label><output id="alpha-out">100%</output></div>
          <input class="opacity" id="alpha" type="range" min="0" max="100" value="100">
        </div>
      </div>
      <div>
        <div class="section-title">Values</div>
        <div class="fields">
          <div class="field hex">
            <div class="hex-inner"><label for="hex">HEX</label><input id="hex" value="${toHex(initial)}" spellcheck="false" aria-label="Hex color"></div>
            <div class="native-wrap"><input id="native" type="color" value="${toHex(initial).slice(0, 7)}" aria-label="Open system color picker"></div>
          </div>
          <div class="field"><label for="red">R</label><input id="red" type="number" min="0" max="255" value="${initial.r}"></div>
          <div class="field"><label for="green">G</label><input id="green" type="number" min="0" max="255" value="${initial.g}"></div>
          <div class="field"><label for="blue">B</label><input id="blue" type="number" min="0" max="255" value="${initial.b}"></div>
          <div class="field"><label for="alpha-n">A</label><input id="alpha-n" type="number" min="0" max="1" step="0.01" value="${initial.alpha}"></div>
        </div>
      </div>
      ${canPreparePreview ? '<div class="prepare-box"><button class="prepare" id="prepare">Generate background preview</button><p class="note">Preview generation uses one iLoveAPI credit. You can choose a color and apply without generating a preview.</p></div>' : ''}
    </section>
  </div>
  <div id="gradient-popover" popover="auto">
    <div class="gradient-popover-preview" id="gradient-draft-preview"></div>
    <div class="gradient-options">
      <label>Start color<input id="gradient-start" type="color" value="#ffffff"></label>
      <label>End color<input id="gradient-end" type="color" value="#000000"></label>
    </div>
    <label class="section-title" for="gradient-direction">Direction</label>
    <select id="gradient-direction"><option value="bottom right">To bottom right</option><option value="right">To right</option></select>
    <div class="gradient-popover-actions" style="margin-top:12px"><button id="gradient-clear" type="button">Clear</button><span><button id="gradient-cancel" type="button">Cancel</button> <button id="gradient-confirm" class="primary" type="button">Confirm</button></span></div>
  </div>
  <footer>
    <div class="status-pill"><span class="status-dot"></span><span class="status" id="status" role="status" aria-live="polite">Preview ready</span></div>
    <div class="footer-actions">
      <button class="button" id="cancel">Cancel</button>
      <button class="button primary" id="apply">OK</button>
    </div>
  </footer>
</main>
<script>
let rgb={r:${initial.r},g:${initial.g},b:${initial.b}},alpha=${initial.alpha},h=0,s=0,v=0,gradient=null,gradientBeforeEdit=null,colorBeforeEdit,gradientPopoverConfirmed=false,timer,request;const $=id=>document.getElementById(id),sv=$('sv'),preview=$('preview'),status=$('status'),hex=$('hex'),alphaSlider=$('alpha'),gradientPopover=$('gradient-popover');
function clamp(n,min,max){return Math.min(max,Math.max(min,n))}function hsvToRgb(){const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let a=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return{r:Math.round((a[0]+m)*255),g:Math.round((a[1]+m)*255),b:Math.round((a[2]+m)*255)}}function rgbToHsv(){const r=rgb.r/255,g=rgb.g/255,b=rgb.b/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;v=max;s=max===0?0:d/max;if(d===0)h=0;else if(max===r)h=60*(((g-b)/d)%6);else if(max===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4);if(h<0)h+=360}
function hexOf(){return '#'+[rgb.r,rgb.g,rgb.b,...(alpha<1?[Math.round(alpha*255)]:[])].map(n=>n.toString(16).padStart(2,'0')).join('')}function parseHex(text){let x=text.trim().replace(/^#/,'');if(/^[0-9a-f]{3,4}$/i.test(x))x=[...x].map(c=>c+c).join('');if(!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(x))return false;rgb={r:parseInt(x.slice(0,2),16),g:parseInt(x.slice(2,4),16),b:parseInt(x.slice(4,6),16)};alpha=x.length===8?parseInt(x.slice(6,8),16)/255:1;rgbToHsv();return true}
function selection(){return gradient?{gradient}:{color:hexOf()}}function paintGradient(g){return 'linear-gradient(to '+g.to+', '+g.stops.join(', ')+')'}function updateGradientButton(){const b=$('gradient-button');b.textContent=gradient?'':'None';b.setAttribute('aria-label',gradient?'Gradient preview: '+gradient.stops.join(' to '):'Gradient: none');b.style.background=gradient?paintGradient(gradient):'';b.classList.toggle('has-gradient',Boolean(gradient))}function recentGradients(){try{const value=JSON.parse(localStorage.getItem('subayai.recent-gradients')||'[]');return Array.isArray(value)?value.filter(g=>g&&['right','bottom right'].includes(g.to)&&Array.isArray(g.stops)&&g.stops.length===2&&g.stops.every(c=>/^#[0-9a-f]{6}$/i.test(c))):[]}catch{return []}}function renderRecentGradients(){const list=$('recent-gradients');list.replaceChildren();for(const g of recentGradients()){const b=document.createElement('button');b.type='button';b.className='recent-gradient';b.title='Recent gradient';b.setAttribute('aria-label','Recent gradient');b.style.background=paintGradient(g);b.addEventListener('click',()=>{gradient=g;updateGradientButton();refresh()});list.append(b)}list.hidden=!list.childElementCount}function saveRecentGradient(){if(!gradient)return;const recent=[gradient,...recentGradients().filter(g=>g.to!==gradient.to||g.stops.join()!==gradient.stops.join())].slice(0,5);try{localStorage.setItem('subayai.recent-gradients',JSON.stringify(recent))}catch{}renderRecentGradients()}
function updateGradientDraft(){const g={to:$('gradient-direction').value,stops:[$('gradient-start').value,$('gradient-end').value]};$('gradient-draft-preview').style.background=paintGradient(g);gradient=g;updateGradientButton();refresh()}function render(updateHex=true,refreshPreview=true){gradient=null;updateGradientButton();rgb=hsvToRgb();sv.style.backgroundColor='hsl('+h+',100%,50%)';$('knob').style.left=(s*100)+'%';$('knob').style.top=((1-v)*100)+'%';$('hue').value=h;$('hue-out').value=Math.round(h)+'°';alphaSlider.value=Math.round(alpha*100);$('alpha-out').value=Math.round(alpha*100)+'%';for(const key of ['red','green','blue'])$(key).value=rgb[key==='red'?'r':key==='green'?'g':'b'];$('alpha-n').value=alpha.toFixed(2);$('native').value=hexOf().slice(0,7);if(updateHex){hex.value=hexOf();hex.setCustomValidity('')}if(refreshPreview)refresh()}
function refresh(){clearTimeout(timer);timer=setTimeout(async()=>{if(request)request.abort();request=new AbortController();status.textContent='Updating preview…';try{const response=await fetch('/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection()),signal:request.signal});if(!response.ok)throw new Error(await response.text());const blob=await response.blob(),url=URL.createObjectURL(blob),old=preview.src;preview.src=url;if(old.startsWith('blob:'))URL.revokeObjectURL(old);status.textContent='Preview ready'}catch(e){if(e.name!=='AbortError')status.textContent='Preview failed: '+e.message}},140)}
function useHex(){if(!parseHex(hex.value)){hex.setCustomValidity('Enter #RGB, #RRGGBB or #RRGGBBAA');hex.reportValidity();return}render()}
hex.addEventListener('change',useHex);$('native').addEventListener('input',()=>{parseHex($('native').value);render()});$('hue').addEventListener('input',()=>{h=Number($('hue').value);render()});alphaSlider.addEventListener('input',()=>{alpha=Number(alphaSlider.value)/100;render()});$('alpha-n').addEventListener('change',()=>{alpha=clamp(Number($('alpha-n').value)||0,0,1);render()});for(const [id,key] of [['red','r'],['green','g'],['blue','b']])$(id).addEventListener('change',()=>{rgb[key]=clamp(Number($(id).value)||0,0,255);rgbToHsv();render()});for(const button of document.querySelectorAll('[data-color]'))button.addEventListener('click',()=>{parseHex(button.dataset.color);alpha=1;render()});
gradientPopover.addEventListener('toggle',e=>{if(e.newState==='open'){gradientPopoverConfirmed=false;gradientBeforeEdit=gradient;colorBeforeEdit=hexOf();const g=gradient||{to:'bottom right',stops:['#ffffff','#000000']};$('gradient-direction').value=g.to;$('gradient-start').value=g.stops[0];$('gradient-end').value=g.stops[1];$('gradient-draft-preview').style.background=paintGradient(g);gradient=g;updateGradientButton();refresh()}else if(!gradientPopoverConfirmed){gradient=gradientBeforeEdit;if(!gradient)parseHex(colorBeforeEdit);updateGradientButton();refresh()}});for(const id of ['gradient-direction','gradient-start','gradient-end']){const control=$(id);control.addEventListener('input',updateGradientDraft);control.addEventListener('change',updateGradientDraft)}$('gradient-confirm').addEventListener('click',()=>{gradientPopoverConfirmed=true;gradientPopover.hidePopover()});$('gradient-cancel').addEventListener('click',()=>gradientPopover.hidePopover());$('gradient-clear').addEventListener('click',()=>{gradientPopoverConfirmed=true;gradient=null;updateGradientButton();gradientPopover.hidePopover();refresh()});renderRecentGradients();
function point(e){const r=sv.getBoundingClientRect();s=clamp((e.clientX-r.left)/r.width,0,1);v=1-clamp((e.clientY-r.top)/r.height,0,1);render()}sv.addEventListener('pointerdown',e=>{sv.setPointerCapture(e.pointerId);point(e)});sv.addEventListener('pointermove',e=>{if(sv.hasPointerCapture(e.pointerId))point(e)});sv.addEventListener('keydown',e=>{const step=e.shiftKey ? 0.1 : 0.01;if(e.key==='ArrowLeft')s=clamp(s-step,0,1);else if(e.key==='ArrowRight')s=clamp(s+step,0,1);else if(e.key==='ArrowUp')v=clamp(v+step,0,1);else if(e.key==='ArrowDown')v=clamp(v-step,0,1);else return;e.preventDefault();render()});
${canPreparePreview ? "$('prepare').addEventListener('click',async()=>{const button=$('prepare');button.disabled=true;status.textContent='Preparing preview…';try{const response=await fetch('/prepare-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection())});if(!response.ok)throw new Error(await response.text());const blob=await response.blob(),url=URL.createObjectURL(blob),old=preview.src;preview.src=url;if(old.startsWith('blob:'))URL.revokeObjectURL(old);status.textContent='Background preview ready'}catch(e){status.textContent='Preview failed: '+e.message;button.disabled=false}});" : ''}
async function submit(path){clearTimeout(timer);document.querySelectorAll('button').forEach(button=>button.disabled=true);status.textContent=path==='/apply'?'Applying…':'Cancelling…';try{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:path==='/apply'?JSON.stringify(selection()):'{}'});if(!response.ok)throw new Error(await response.text());if(path==='/apply')saveRecentGradient();status.textContent=path==='/apply'?'Done. You can close this tab.':'Cancelled. You can close this tab.';window.close()}catch(e){document.querySelectorAll('button').forEach(button=>button.disabled=false);status.textContent=String(e)}}
$('apply').addEventListener('click',()=>submit('/apply'));$('cancel').addEventListener('click',()=>submit('/cancel'));
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(gradientPopover.matches(':popover-open'))gradientPopover.hidePopover();else submit('/cancel')}else if(e.key==='Enter'&&!['INPUT','SELECT','BUTTON'].includes(e.target.tagName))submit('/apply')});
rgbToHsv();render(false,false);
</script></body></html>`

function parseSelection(value: unknown): Fill | null {
  if (typeof value !== 'object' || value === null) return null
  if ('gradient' in value && typeof value.gradient === 'object' && value.gradient !== null) {
    const gradient = value.gradient
    if ('to' in gradient && (gradient.to === 'right' || gradient.to === 'bottom right') && 'stops' in gradient && Array.isArray(gradient.stops) && gradient.stops.length === 2 && gradient.stops.every((stop): stop is string => typeof stop === 'string' && parseColor(stop) !== null)) {
      return { to: gradient.to, stops: gradient.stops } satisfies Gradient
    }
    return null
  }
  if (!('color' in value) || typeof value.color !== 'string') return null
  return parseColor(value.color)
}

export async function editColorInBrowser(
  title: string,
  initial: Rgba,
  initialPreview: Asset,
  preview: (fill: Fill) => Promise<Asset>,
  preparePreview?: () => Promise<void>,
): Promise<Fill | null> {
  const routes: Record<string, (fill: Fill | null) => Promise<Asset>> = {
    'GET /preview': async () => initialPreview,
    'POST /preview': (fill) => preview(fill ?? initial),
  }
  if (preparePreview) {
    routes['POST /prepare-preview'] = async (fill) => {
      await preparePreview()
      return preview(fill ?? initial)
    }
  }
  return editInBrowser(PAGE(title, initial, Boolean(preparePreview)), parseSelection, routes)
}
