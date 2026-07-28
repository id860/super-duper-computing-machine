// Runtime fixes for resize-safe pointing, visible OWOP chunks and chunk protection.
import { PixelEngine } from './engine.js';
import { Tools } from './ui.js';
import { api } from './api.js';
import { toast } from './ui.js';

const CHUNK_SIZE = 86;
const originalBind = PixelEngine.prototype._bind;
PixelEngine.prototype._bind = function (...args) {
  originalBind.apply(this, args);
  if (typeof ResizeObserver === 'function') {
    this._canvasResizeObserver = new ResizeObserver(() => this.resize());
    this._canvasResizeObserver.observe(this.canvas);
  }
  window.visualViewport?.addEventListener('resize', () => this.resize(), { passive:true });
};

function drawChunkGuides(ctx, engine) {
  if (!engine.world?.infinite || engine.showChunkGrid === false) return;
  const span = CHUNK_SIZE * engine.scale;
  if (span < 14) return;
  const cx0 = Math.floor(-engine.offsetX / span), cy0 = Math.floor(-engine.offsetY / span);
  const cx1 = Math.floor((engine.viewW - engine.offsetX) / span), cy1 = Math.floor((engine.viewH - engine.offsetY) / span);
  ctx.save();
  ctx.strokeStyle = 'rgba(79,109,245,.30)'; ctx.lineWidth = 1; ctx.setLineDash([5,4]); ctx.beginPath();
  for (let cx=cx0; cx<=cx1+1; cx++) { const x=Math.floor(engine.offsetX+cx*span)+.5; ctx.moveTo(x,0); ctx.lineTo(x,engine.viewH); }
  for (let cy=cy0; cy<=cy1+1; cy++) { const y=Math.floor(engine.offsetY+cy*span)+.5; ctx.moveTo(0,y); ctx.lineTo(engine.viewW,y); }
  ctx.stroke(); ctx.setLineDash([]);
  if (span >= 90) {
    ctx.font='600 10px system-ui'; ctx.fillStyle='rgba(54,70,130,.52)';
    for (let cy=cy0;cy<=cy1;cy++) for (let cx=cx0;cx<=cx1;cx++) ctx.fillText(`${cx}:${cy}`,engine.offsetX+cx*span+6,engine.offsetY+cy*span+14);
  }
  const selected = engine._protectChunk || (engine.hover ? { cx:Math.floor(engine.hover.x/CHUNK_SIZE), cy:Math.floor(engine.hover.y/CHUNK_SIZE) } : null);
  if (selected) {
    ctx.strokeStyle = engine._protectChunk ? 'rgba(16,185,129,.95)' : 'rgba(79,109,245,.62)';
    ctx.lineWidth = engine._protectChunk ? 3 : 2;
    ctx.strokeRect(engine.offsetX+selected.cx*span+.5,engine.offsetY+selected.cy*span+.5,span,span);
  }
  ctx.restore();
}

const originalSetWorld = PixelEngine.prototype.setWorld;
PixelEngine.prototype.setWorld = function (...args) {
  const toolOverlay = this.onOverlay;
  originalSetWorld.apply(this,args);
  const loadingOverlay = this.onOverlay;
  this.showChunkGrid = localStorage.getItem('pf.hideChunkGrid') !== '1';
  this.onOverlay = (ctx) => { loadingOverlay?.(ctx); toolOverlay?.(ctx); drawChunkGuides(ctx,this); };
};

const originalWire = Tools.prototype._wire;
Tools.prototype._wire = function (...args) {
  originalWire.apply(this,args);
  const engine=this.engine, down=engine.onCellDown, drag=engine.onCellDrag, up=engine.onCellUp;
  const select=(x,y)=>{ this._protectChunk={cx:Math.floor(x/CHUNK_SIZE),cy:Math.floor(y/CHUNK_SIZE)}; engine._protectChunk=this._protectChunk; engine.draw(); };
  engine.onCellDown=(x,y,event)=>{ if(this.tool!=='protect') return down?.(x,y,event); select(x,y); };
  engine.onCellDrag=(x,y,event)=>{ if(this.tool!=='protect') return drag?.(x,y,event); select(x,y); };
  engine.onCellUp=async(x,y,event)=>{
    if(this.tool!=='protect') return up?.(x,y,event);
    select(x,y); const chosen=this._protectChunk;
    try { const result=await api.post(`/api/worlds/${encodeURIComponent(this.world.id)}/protections`,{chunkX:chosen.cx,chunkY:chosen.cy}); toast(`Чанк ${chosen.cx}:${chosen.cy} защищён`, 'success'); if(result.art) engine.draw(); }
    catch(error){ toast(error.message||'Не удалось защитить чанк','error'); }
    finally { this._protectChunk=null; engine._protectChunk=null; engine.draw(); }
  };
};

function prepareSidebar() {
  const sidebar=document.getElementById('sidebar'), toggle=document.getElementById('sidebarToggle');
  if(!sidebar||!toggle) return false;
  if(matchMedia('(max-width:860px)').matches && !sidebar.dataset.mobileInitialised){
    sidebar.dataset.mobileInitialised='1';
    if(!sidebar.classList.contains('sidebar--collapsed')) toggle.click();
  }
  return true;
}
let attempts=0; const sidebarTimer=setInterval(()=>{ if(prepareSidebar()||++attempts>80) clearInterval(sidebarTimer); },50);
