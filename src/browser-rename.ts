import sharp from 'sharp';
import { editInBrowser, type Asset } from './browser.js';
export interface RenamePlan { names: string[]; middles: string[]; optimize: boolean }
export interface RenameItem { name: string; ext: string; time: number }
const BAD_CHARS = /[/\\\0<>:"|?*]/;
// 새 이름은 브라우저가 계산, 서버는 검증만: 파일마다 1개, 경로/금지 문자 X, 확장자 포함 중복 X (대소문자 무시 FS 대비)
export function parsePlan(exts: readonly string[]): (value: unknown) => RenamePlan | null {
    return (value) => {
        if (typeof value !== 'object' || value === null)
            return null;
        const { names, middles, optimize } = value as Record<string, unknown>;
        if (typeof optimize !== 'boolean' || !Array.isArray(names) || names.length !== exts.length)
            return null;
        if (!Array.isArray(middles) || middles.length > exts.length || !middles.every((m) => typeof m === 'string' && m.length <= 200))
            return null;
        const seen = new Set<string>();
        for (const [i, name] of names.entries()) {
            if (typeof name !== 'string' || !name || name.length > 200 || name.startsWith('.') || BAD_CHARS.test(name))
                return null;
            const key = `${name}${exts[i] ?? ''}`.toLowerCase();
            if (seen.has(key))
                return null;
            seen.add(key);
        }
        return { names: names as string[], middles: middles as string[], optimize };
    };
}
const PAGE = (base: string, folder: string, items: RenameItem[], history: string[]): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Subayai - Rename files&#x20;</title>
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
  --accent: #3b82f6;
  --danger: #f87171;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
}
body {
  background: var(--bg-app);
  color: var(--text-main);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
main {
  max-width: 1240px;
  margin: 0 auto;
  padding: 24px 28px 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100vh;
}
header, .toolbar, .footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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
.brand-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); }
h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; color: #fff; }
.header-actions, .tools, .footer-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dim-badge {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
}
.tabs {
  display: grid;
  grid-template-columns: repeat(2, 96px);
  background: var(--bg-card);
  padding: 3px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  gap: 2px;
}
.tabs button {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.tabs button:hover { color: #fff; }
.tabs button[aria-selected=true] { background: var(--bg-surface); color: #fff; border-color: rgba(255, 255, 255, 0.12); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4); }
.hint { color: var(--text-dim); font-size: 12px; }
#selection { color: var(--accent); font-size: 12px; font-weight: 600; }
select, input[type=number], .gname, .text, .middle {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-main);
  font: inherit;
  font-size: 12px;
  outline: none;
}
select { cursor: pointer; }
select:focus, input:focus { border-color: var(--border-focus); }
input[type=number] { width: 80px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.order { width: 64px !important; }
.board { display: flex; flex-direction: column; gap: 12px; flex: 1; }
.board.detail .order { display: none; }
.group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
}
.group.locked { border-color: var(--accent); }
.group-head { display: flex; align-items: center; gap: 10px; }
.gname { width: min(320px, 100%); font-size: 14px; font-weight: 600; color: #fff; }
.naming .text { width: 140px; }
.board.mid .gname { display: none; }
.gcount { color: var(--text-muted); font-size: 12px; }
.link { margin-left: auto; background: none; border: 0; color: var(--text-muted); font: inherit; font-size: 12px; cursor: pointer; }
.link:hover { color: #fff; text-decoration: underline; }
#breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
#breadcrumb .link { margin-left: 0; }
#detail-title::before { content: '>'; margin-right: 6px; color: var(--text-dim); }
.items { min-height: 56px; padding-bottom: 8px; border-radius: var(--radius-md); }
.items.end { outline: 1px dashed var(--accent); outline-offset: 2px; }
.list .items { display: flex; flex-direction: column; gap: 4px; }
.album .items { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 12px; }
.item {
  display: flex;
  gap: 12px;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}
.item:hover { background: var(--bg-card-hover); }
.item.selected { border-color: var(--accent); background: rgba(59, 130, 246, 0.14); }
.item.dragging { opacity: 0.35; }
.list .item { align-items: center; padding: 6px 10px; }
.album .item { flex-direction: column; gap: 8px; padding: 8px; }
.list .item.before { box-shadow: 0 -2px 0 var(--accent); }
.list .item.after { box-shadow: 0 2px 0 var(--accent); }
.album .item.before { box-shadow: -4px 0 0 var(--accent); }
.album .item.after { box-shadow: 4px 0 0 var(--accent); }
.thumb {
  flex: none;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background-color: #0c0d11;
  background-image:
    linear-gradient(45deg, #13151c 25%, transparent 25%),
    linear-gradient(-45deg, #13151c 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #13151c 75%),
    linear-gradient(-45deg, transparent 75%, #13151c 75%);
  background-size: 12px 12px;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
}
.list .thumb { width: 44px; height: 44px; }
.album .thumb { width: 100%; aspect-ratio: 1; }
.thumb img { width: 100%; height: 100%; pointer-events: none; }
.list .thumb img { object-fit: cover; }
.album .thumb img { object-fit: contain; }
.thumb .ext { display: none; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; color: var(--text-muted); }
.thumb.noimg img { display: none; }
.thumb.noimg .ext { display: block; }
.meta { display: flex; flex-direction: column; min-width: 0; }
.list .meta { flex: 1; }
.middle { display: none; margin-top: 6px; width: 100%; max-width: 360px; }
.board.mid .middle { display: block; }
.meta b, .meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta b { font-size: 13px; font-weight: 600; color: #fff; }
.meta span { font-size: 11px; color: var(--text-dim); }
.item.same .meta b { color: var(--text-muted); font-weight: 500; }
.item.bad .meta b { color: var(--danger); }
.newgroup {
  padding: 18px;
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-lg);
  color: var(--text-dim);
  text-align: center;
}
.newgroup.over { border-color: var(--accent); color: #fff; background: rgba(59, 130, 246, 0.08); }
footer {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-block: 14px 20px;
  border-top: 1px solid var(--border);
  background: var(--bg-app);
}
.naming { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.naming label { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 12px; font-weight: 500; }
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
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px #10b981; }
.status-dot.warn { background: var(--danger); box-shadow: 0 0 6px var(--danger); }
.button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
  padding: 8px 18px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); color: #fff; border-color: rgba(255, 255, 255, 0.18); }
.button.primary { background: #fff; color: #0b0c0e; border-color: #fff; font-weight: 600; }
.button.primary:hover:not(:disabled) { background: #f3f4f6; color: #0b0c0e; }
.button:disabled { opacity: 0.45; cursor: not-allowed; }
dialog { margin: auto; padding: 24px; max-width: 360px; border: 1px solid var(--border-focus); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-main); }
dialog::backdrop { background: rgba(0, 0, 0, .7); }
dialog form { display: grid; gap: 14px; }
dialog p { color: var(--text-muted); }
@media(max-width: 860px) {
  main { padding: 16px 16px 0; }
  .album .items { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
}
</style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="brand-badge"><span class="brand-dot"></span>SUBAYAI / RENAME</div>
      <h1>Rename files</h1>
      <nav id="breadcrumb" aria-label="Navigation"><button class="link" id="back" hidden>All files</button><span id="detail-title" hidden></span></nav>
    </div>
    <div class="header-actions">
      <span class="dim-badge" id="count"></span>
      <button class="button" id="reset">Reset all</button>
    </div>
  </header>
  <div class="toolbar">
    <div class="tabs" role="tablist" aria-label="View">
      <button role="tab" id="list-tab" aria-selected="true">List</button>
      <button role="tab" id="album-tab" aria-selected="false">Album</button>
    </div>
    <div class="tools">
      <span class="hint">Select files and press Enter to edit as a group. Click a locked file to edit again.</span>
      <span id="selection" aria-live="polite"></span>
      <button class="button" id="group" disabled>Group selected</button>
      <select id="sort" aria-label="Sort every group">
        <option value="">Sort…</option>
        <option value="name">Name (A → Z)</option>
        <option value="date">Date created (newest first)</option>
      </select>
    </div>
  </div>
  <div id="board" class="board list"></div>
  <footer>
    <div class="naming">
      <label>Pattern
        <select id="pos">
          <option value="suffix">Suffix (name-1)</option>
          <option value="prefix">Prefix (1-name)</option>
          <option value="none" selected>None</option>
          <option value="prefix-middle">Prefix + middle (prefix-middle)</option>
          <option value="middle-suffix">Middle + suffix (middle-suffix)</option>
          <option value="prefix-middle-suffix">Prefix + middle + suffix</option>
        </select>
      </label>
      <label data-part="prefix" hidden>Prefix <input id="prefix" class="text" spellcheck="false"></label>
      <label data-part="suffix" hidden>Suffix <input id="suffix" class="text" placeholder="thumbnail" spellcheck="false"></label>
      <datalist id="middles"></datalist>
      <label data-part="number">Start at <input id="start" type="number" min="0" max="99999" step="1" value="1"></label>
      <label data-part="number">Digits
        <select id="digits">
          <option value="1">1</option>
          <option value="2">01</option>
          <option value="3">001</option>
          <option value="4">0001</option>
        </select>
      </label>
    </div>
    <div class="footer-row">
      <div class="status-pill"><span class="status-dot"></span><span id="status" role="status" aria-live="polite"></span></div>
      <div class="footer-actions">
        <button class="button" id="cancel">Cancel</button>
        <button class="button" id="apply">Rename</button>
        <button class="button primary" id="optimize" title="Rename, then optimize: images to WebP, SVGs minified, videos compressed. Originals are removed from the folder (a backup is kept in .subayai/).">Rename + optimize</button>
      </div>
    </div>
  </footer>
</main>
<script>
const D=${JSON.stringify({ base, folder, items, history }).replace(/</g, '\\u003c')},files=D.items,$=s=>document.querySelector(s),board=$('#board'),status=$('#status');
const BAD=/[\\/\\\\\\0<>:"|?*]/g,cmp=new Intl.Collator(undefined,{numeric:true}).compare;
const initial=()=>[{name:D.base,items:files.map((_,i)=>i)}];
const stem=i=>files[i].name.slice(0,files[i].name.length-files[i].ext.length);
const clean=input=>{const v=input.value.replace(BAD,'').replace(/^\\.+/,'');if(v!==input.value)input.value=v;return v};
// 패턴 설정. 상세 모드 동안 메인 설정은 mainCfg에 보관, 잠긴 그룹은 자기 설정(cfg)을 가짐
const CFG=['pos','start','digits','prefix','suffix'],DEFAULT_CFG={pos:'none',start:'1',digits:'1',prefix:D.base,suffix:''};
const readCfg=()=>Object.fromEntries(CFG.map(k=>[k,$('#'+k).value])),writeCfg=c=>CFG.forEach(k=>$('#'+k).value=c[k]);
let groups=initial(),mids=files.map((_,i)=>stem(i)),fixed=new Map(),detail=null,mainCfg=null,selected=new Set(),anchor=null,dragging=null,marker=null;
$('#prefix').value=D.base;$('#middles').append(...D.history.map(v=>new Option(v)));
$('#count').textContent=files.length+(files.length>1?' files':' file')+' in '+D.folder;
if(!localStorage.getItem('subayai-rename-help')){
  const dialog=document.createElement('dialog');dialog.innerHTML='<form method="dialog"><h2>Quick guide</h2><p>Select files and press Enter to edit them as an independent group. Confirm to lock their names; click a locked file to edit it again.</p><button class="button primary">Got it</button></form>';
  document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',e=>e.preventDefault());dialog.addEventListener('close',()=>{localStorage.setItem('subayai-rename-help','1');dialog.remove()},{once:true});
}

// 파일 카드는 한 번만 만들고 재배치 (썸네일 다시 안 불러옴)
const els=files.map((f,i)=>{
  const el=document.createElement('div');el.className='item';el.draggable=true;el.dataset.i=i;
  el.innerHTML='<div class="thumb"><img alt="" draggable="false" loading="lazy"><span class="ext"></span></div><div class="meta"><b></b><span></span><input class="middle" list="middles" aria-label="Middle name" spellcheck="false"></div><label>Index <input class="order" type="number" min="1" step="1" aria-label="Index (starting at 1)"></label>';
  const img=el.querySelector('img');img.onerror=()=>el.querySelector('.thumb').classList.add('noimg');img.src='/t/'+i;
  el.querySelector('.ext').textContent=f.ext.slice(1).toUpperCase()||'FILE';
  el.querySelector('.meta span').textContent=f.name;
  // 중간 이름: 기본값 = 원래 파일명. 포커스하면 기본값 비우고, 그대로 나가면 복원. 입력 중엔 카드 드래그 끔
  const mid=el.querySelector('.middle');mid.value=mids[i];
  mid.addEventListener('pointerdown',()=>el.draggable=false);
  mid.addEventListener('focus',()=>{el.draggable=false;if(mid.value===stem(i))mid.value=''});
  mid.addEventListener('blur',()=>{el.draggable=true;if(!mid.value){mid.value=mids[i]=stem(i);label()}});
  mid.addEventListener('input',()=>{mids[i]=clean(mid);label()});
  const order=el.querySelector('.order');
  order.addEventListener('pointerdown',()=>el.draggable=false);
  order.addEventListener('focus',()=>el.draggable=false);
  order.addEventListener('blur',()=>{el.draggable=true});
  order.addEventListener('change',()=>{
    if(detail)return;
    const ordered=flat().filter(x=>x!==i),at=Math.max(0,Math.min(ordered.length,Math.floor(Number(order.value)-1)));
    const target=ordered[at],group=target===undefined?groups.at(-1):groups.find(g=>g.items.includes(target));
    if(!group)return;
    for(const g of groups)g.items=g.items.filter(x=>x!==i);
    group.items.splice(target===undefined?group.items.length:group.items.indexOf(target),0,i);layout();
  });
  return el;
});
const flat=()=>groups.flatMap(g=>g.items);

function nameOf(c,g,i,k){
  const p=c.pos.split('-');
  if(p.includes('middle'))return p.map(x=>x==='middle'?mids[i]:c[x]).filter(Boolean).join('-');
  if(c.pos==='none')return stem(i);
  const n=String(Math.max(0,Math.floor(Number(c.start)||0))+k).padStart(Number(c.digits),'0');
  return (c.pos==='prefix'?[n,g.name]:[g.name,n]).filter(Boolean).join('-');
}
const parts=()=>$('#pos').value.split('-');
// 항상 전체 파일 이름 계산: 나머지는 메인 설정 + 잠긴 이름, 상세 파일만 현재 설정으로 덮어씀
function names(){
  const cur=readCfg(),out=[];
  const skip=new Set(detail?.items);
  for(const g of groups)g.items.filter(i=>!skip.has(i)).forEach((i,k)=>out[i]=nameOf(mainCfg??cur,g,i,k));
  fixed.forEach((name,i)=>out[i]=name);
  detail?.items.forEach((i,k)=>out[i]=nameOf(cur,detail,i,k));
  return out}

// 새 이름 표시 + 중복/빈 이름 검사
function label(){
  const out=names(),key=i=>(out[i]+files[i].ext).toLowerCase(),count=new Map(),shown=new Set(detail?detail.items:files.keys());
  files.forEach((_,i)=>count.set(key(i),(count.get(key(i))||0)+1));
  let bad=0,changed=0;
  els.forEach((el,i)=>{
    const full=out[i]+files[i].ext,wrong=!out[i]||count.get(key(i))>1;
    el.querySelector('b').textContent=out[i]?full:'(no name)';
    el.classList.toggle('bad',wrong);el.classList.toggle('same',full===files[i].name);
    if(!shown.has(i))return;if(wrong)bad++;if(full!==files[i].name)changed++;
  });
  $('#apply').disabled=$('#optimize').disabled=bad>0;
  $('.status-dot').classList.toggle('warn',bad>0);
  status.textContent=bad?bad+' file'+(bad>1?'s have':' has')+' a duplicate or empty name':changed?changed+' of '+shown.size+' files will be renamed':'Names are already up to date';
}
function mode(){
  const p=parts(),mid=p.includes('middle'),none=$('#pos').value==='none';
  // prefix/suffix 입력은 middle 패턴에서만 (숫자 패턴은 그룹 이름을 씀), 번호 설정은 숫자 패턴에서만
  document.querySelectorAll('[data-part]').forEach(l=>l.hidden=l.dataset.part==='number'?mid||none:!(mid&&p.includes(l.dataset.part)));
  board.classList.toggle('mid',mid);label();
}
function paint(){
  els.forEach((el,i)=>el.classList.toggle('selected',selected.has(i)));
  $('#selection').textContent=selected.size?selected.size+' selected':'';
  $('#group').disabled=!selected.size;
}
function layout(){
  groups=groups.filter(g=>g.items.length);
  const positions=new Map(flat().map((i,index)=>[i,index+1]));
  const visible=detail?[detail]:groups;
  const sections=visible.map((g,gi)=>{
    const s=document.createElement('section');s.className='group';
    if(g.locked||(!detail&&g.items.every(i=>fixed.has(i))))s.classList.add('locked');
    s.innerHTML='<div class="group-head"><input class="gname" aria-label="Group name" placeholder="Name" spellcheck="false"><span class="gcount"></span></div><div class="items"></div>';
    const input=s.querySelector('input');input.value=g.name;input.readOnly=s.classList.contains('locked');if(input.readOnly)input.title='Click Edit group to rename';
    input.addEventListener('input',()=>{g.name=clean(input);label()});
    s.querySelector('.gcount').textContent=g.items.length+(g.items.length>1?' files':' file');
    if(!detail&&g.items.some(i=>fixed.has(i))){const b=document.createElement('button');b.className='link';b.textContent='Edit group';b.onclick=()=>enterDetail(g.items);s.querySelector('.group-head').append(b)}
    else if(!detail&&gi>0){const b=document.createElement('button');b.className='link';b.textContent='Ungroup';b.onclick=()=>{groups[0].items.push(...g.items);g.items=[];layout()};s.querySelector('.group-head').append(b)}
    const box=s.querySelector('.items');box.dataset.g=gi;box.append(...g.items.map(i=>els[i]));
    g.items.forEach(i=>{els[i].querySelector('.order').value=String(positions.get(i))});
    return s;
  });
  const zone=document.createElement('div');zone.className='newgroup';zone.textContent='Drop here to make a new group';
  board.replaceChildren(...sections,zone);
  paint();label();
}
function take(ids){const set=new Set(ids);for(const g of groups)g.items=g.items.filter(i=>!set.has(i))}
function newGroup(ids){
  take(ids);
  let n=groups.filter(g=>g.items.length).length+1;while(groups.some(g=>g.name==='group-'+n))n++;
  groups.push({name:'group-'+n,items:ids});layout();
  const input=[...document.querySelectorAll('.gname')].pop();input.focus();input.select();
}
function enterDetail(ids){
  const src=groups.find(g=>g.items.includes(ids[0]));
  mainCfg=readCfg();detail={name:src?.name??D.base,items:[...ids],src};selected.clear();writeCfg(src?.cfg??DEFAULT_CFG);
  board.classList.add('detail');els.forEach(el=>el.draggable=false);
  $('#back').hidden=false;$('#detail-title').hidden=false;$('#detail-title').textContent='Detail · '+ids.length+(ids.length>1?' files':' file');$('#group').hidden=$('#sort').hidden=true;$('#apply').textContent='Confirm group';$('#optimize').hidden=true;$('#cancel').textContent='Back';layout();mode();
}
function leaveDetail(save){
  if(save){
    const out=names(),{name,items,src}=detail;for(const i of items)fixed.set(i,out[i]);
    // 잠긴 그룹 다시 편집 → 제자리 갱신, 아니면 새 잠긴 그룹
    if(src?.locked&&src.items.length===items.length)Object.assign(src,{name,cfg:readCfg()});
    else{take(items);groups.push({name,items,locked:true,cfg:readCfg()})}
  }
  writeCfg(mainCfg);mainCfg=null;detail=null;board.classList.remove('detail');els.forEach(el=>el.draggable=true);$('#back').hidden=true;$('#detail-title').hidden=true;$('#group').hidden=$('#sort').hidden=false;$('#apply').textContent='Rename';$('#optimize').hidden=false;$('#cancel').textContent='Cancel';layout();mode();
}

// 선택: 클릭 = 하나, ⌘/Ctrl = 토글, Shift = 범위
board.addEventListener('click',e=>{
  if(e.target.closest('input'))return;
  const t=e.target.closest('.item');
  if(!t){if(!e.target.closest('input,button')){selected.clear();paint()}return}
  const i=Number(t.dataset.i),multi=e.metaKey||e.ctrlKey;
  if(!detail&&!multi&&fixed.has(i)){enterDetail(groups.find(g=>g.items.includes(i))?.items.filter(x=>fixed.has(x))??[i]);return}
  if(e.shiftKey&&anchor!==null){const f=flat(),a=f.indexOf(anchor),b=f.indexOf(i);if(!multi)selected.clear();for(const x of f.slice(Math.min(a,b),Math.max(a,b)+1))selected.add(x)}
  else if(multi){if(selected.has(i))selected.delete(i);else selected.add(i);anchor=i}
  else{selected=new Set([i]);anchor=i}
  paint();
});

// 드래그: 선택된 파일 전부 이동. 카드 앞/뒤, 그룹 끝, 새 그룹 영역에 놓기
function mark(m){
  if(marker)marker.el.classList.remove(marker.kind);
  marker=m;if(m)m.el.classList.add(m.kind);
}
board.addEventListener('dragstart',e=>{
  if(detail){e.preventDefault();return}
  const t=e.target.closest('.item');if(!t)return;
  const i=Number(t.dataset.i);
  if(!selected.has(i)){selected=new Set([i]);anchor=i;paint()}
  dragging=flat().filter(x=>selected.has(x));
  for(const x of dragging)els[x].classList.add('dragging');
  e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','');
});
board.addEventListener('dragover',e=>{
  if(!dragging)return;
  const zone=e.target.closest('.newgroup'),box=e.target.closest('.items'),t=e.target.closest('.item');
  if(!zone&&!box)return mark(null);
  e.preventDefault();
  if(zone)return mark({el:zone,kind:'over'});
  if(!t)return mark({el:box,kind:'end'});
  if(dragging.includes(Number(t.dataset.i)))return mark(null);
  const r=t.getBoundingClientRect(),after=board.classList.contains('album')?e.clientX>r.left+r.width/2:e.clientY>r.top+r.height/2;
  mark({el:t,kind:after?'after':'before'});
});
board.addEventListener('drop',e=>{
  e.preventDefault();
  const m=marker,ids=dragging;mark(null);
  if(!m||!ids)return;
  if(m.kind==='over')return newGroup(ids);
  const g=groups[Number(m.el.closest('.items').dataset.g)];
  take(ids);
  const at=m.kind==='end'?g.items.length:g.items.indexOf(Number(m.el.dataset.i))+(m.kind==='after'?1:0);
  g.items.splice(at,0,...ids);layout();
});
board.addEventListener('dragend',()=>{for(const el of els)el.classList.remove('dragging');dragging=null;mark(null)});

$('#group').addEventListener('click',()=>newGroup(flat().filter(x=>selected.has(x))));
$('#sort').addEventListener('change',e=>{
  const by=e.target.value;if(!by)return;
  for(const g of groups)g.items.sort(by==='name'?(a,b)=>cmp(files[a].name,files[b].name):(a,b)=>files[b].time-files[a].time);
  e.target.value='';layout();
});
for(const id of ['start','digits'])$('#'+id).addEventListener('input',label);
for(const id of ['prefix','suffix'])$('#'+id).addEventListener('input',e=>{clean(e.target);label()});
$('#pos').addEventListener('input',mode);
document.querySelectorAll('[role=tab]').forEach(tab=>tab.addEventListener('click',()=>{
  for(const t of document.querySelectorAll('[role=tab]'))t.setAttribute('aria-selected',String(t===tab));
  const album=tab.id==='album-tab';board.classList.toggle('album',album);board.classList.toggle('list',!album);
}));
$('#reset').addEventListener('click',()=>{groups=initial();fixed.clear();detail=null;mainCfg=null;board.classList.remove('detail');els.forEach(el=>el.draggable=true);$('#back').hidden=true;$('#detail-title').hidden=true;$('#group').hidden=$('#sort').hidden=false;selected.clear();anchor=null;writeCfg(DEFAULT_CFG);
  mids=files.map((_,i)=>stem(i));els.forEach((el,i)=>el.querySelector('.middle').value=mids[i]);layout();mode()});
window.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT')return;
  if(e.key==='Escape'){selected.clear();paint()}
  else if(e.key==='Enter'&&!detail&&selected.size){e.preventDefault();enterDetail(flat().filter(x=>selected.has(x)))}
  else if(e.key==='a'&&(e.metaKey||e.ctrlKey)){e.preventDefault();selected=new Set(flat());paint()}
});
$('#back').addEventListener('click',()=>leaveDetail(false));
$('#apply').addEventListener('click',()=>detail?leaveDetail(true):submit('/apply',plan(false)));
$('#optimize').addEventListener('click',()=>detail?leaveDetail(true):submit('/apply',plan(true)));

async function submit(path,body){
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  status.textContent=path==='/cancel'?'Cancelling…':body.optimize?'Renaming and optimizing…':'Renaming…';
  try{
    const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok)throw new Error(await r.text());
    status.textContent=(path==='/cancel'?'Cancelled.':'Sent. Check the terminal for results.')+' You can close this tab.';window.close();
  }catch(error){document.querySelectorAll('button').forEach(b=>b.disabled=false);label();status.textContent=String(error)}
}
// 기본값(원래 파일명) 아닌 중간 이름만 자동완성 기록으로 보냄
const plan=optimize=>({names:names(),middles:[...new Set(mids.filter((m,i)=>m&&m!==stem(i)))],optimize});
$('#cancel').addEventListener('click',()=>detail?leaveDetail(false):submit('/cancel',{}));
layout();
</script></body></html>`;
// 썸네일. 이미지가 아니면 sharp 에러 → 400 → 페이지가 확장자 배지로 대체
async function thumb(file: string): Promise<Asset> {
    const data = await sharp(file).rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
    return { type: 'image/webp', data };
}
export async function renameInBrowser(files: string[], items: RenameItem[], base: string, folder: string, history: string[]): Promise<RenamePlan | null> {
    const routes = Object.fromEntries(files.map((file, i) => [`GET /t/${i}`, () => thumb(file)]));
    return editInBrowser(PAGE(base, folder, items, history), parsePlan(items.map((item) => item.ext)), routes);
}
