import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readReplay, runResult, replayData } from './run-result.ts';
import { stations, recipes } from '../game.ts';
export function renderKitchenReplay(receipt: any, rows: any[], issue?: string) {
  const meta = {
    id: receipt.id,
    sources: receipt.sources,
    mode: receipt.mode,
    dispatch: receipt.dispatch,
    style: receipt.style,
    execution: receipt.execution,
    status: receipt.status,
    duration: receipt.duration,
    error: receipt.error,
    cleanupConfirmed: receipt.cleanupConfirmed,
    validForComparison: receipt.validForComparison,
    modelMode: receipt.modelMode,
    tickLateP95Ms: receipt.tickLateP95Ms,
  };
  const data = JSON.stringify({
    rows: rows.filter((r) => r.type === 'decision'),
    meta,
    result: runResult(receipt, rows, issue),
    ...replayData(rows),
    stations,
    recipes,
  }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Block Kitchen · Practice replay</title>
<style>*{box-sizing:border-box}body{margin:0;background:#080808;color:#f5f5f5;font:15px/1.5 Arial,sans-serif;font-variant-numeric:tabular-nums}main{max-width:1080px;margin:auto;padding:20px}header{display:flex;justify-content:space-between;align-items:center;gap:16px}h1{font-size:24px;margin:0}h2{font-size:16px;margin:0 0 8px}p{margin:6px 0;color:#b4b4b4}.brand{font-size:13px;color:#b4b4b4}a{color:inherit}.score{font-size:30px;white-space:nowrap}.score small{font-size:12px;color:#b4b4b4;display:block}.score{text-align:right}.result{background:#191919;margin:16px 0;padding:12px 16px}.result h2{margin:0}.result p{margin:4px 0}.result a{font-size:14px}.result[data-warning="true"] h2{color:#e7b85f}.diagnostic{padding:12px 0;border-bottom:1px solid #333}.diagnostic p{overflow-wrap:anywhere}.empty{padding:24px 0}.empty h2{margin:0}[hidden]{display:none!important}#scope,#tested-code{font-size:13px}#tested-code{overflow-wrap:anywhere}.source-detail{overflow-wrap:anywhere;font-size:13px}.source-detail code{display:block;margin:4px 0}button:disabled{color:#b4b4b4;cursor:default}.orders{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0 12px}.ticket{background:#191919;padding:12px}.ticket b{font-size:16px}.ticket span{display:block;color:#b4b4b4}.ticket progress{width:100%;height:4px;accent-color:#e7b85f;display:block;margin-top:8px}canvas{display:block;width:100%;background:#111;height:min(38vh,360px)}.transport{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 0}button,select{font:inherit;min-height:44px;border:1px solid #4a4a4a;border-radius:6px;background:#191919;color:white;padding:8px 14px;cursor:pointer}button.primary{background:#fff;color:#111;border-color:#fff}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #e7b85f;outline-offset:3px}#seek{width:100%;accent-color:white;min-height:28px}time{margin-left:auto}.chefs{display:grid;grid-template-columns:1fr 1fr;gap:12px}.chef{background:#191919;padding:12px;min-width:0}.chef b{display:block}.chef:first-child b{color:#f0bb79}.chef:nth-child(2) b{color:#7dd3c0}.chef p{overflow-wrap:anywhere}.event{min-height:48px;background:#222;padding:12px;margin-bottom:12px}details{margin-top:20px;border-top:1px solid #333;padding-top:16px}summary{cursor:pointer}code{font-size:13px}#run{font-size:12px;overflow-wrap:anywhere}@media(max-width:600px){main{padding:16px}h1{font-size:21px}.orders{gap:6px;margin-top:12px}.ticket{padding:8px}.ticket b{font-size:13px}.ticket span{font-size:12px}canvas{height:220px}.result{padding:12px}.result p{font-size:14px}.orders{align-items:stretch}.ticket{height:100%}.score small{max-width:100px;white-space:normal}.chefs{gap:8px}.chef{padding:8px;font-size:13px}.transport{gap:6px}button,select{padding:6px 10px}.score{font-size:26px}.brand{font-size:12px}}
</style><main><header><div><a class="brand" href="https://mcpanel.blockwarriors.ai/dreamweaver/#Kitchen">BlockWarriors / Block Kitchen</a><h1>Practice replay</h1></div><div class="score"><span id="score">0</span> <small id="score-label">Replay points</small></div></header>
<section class="result" id="result" aria-labelledby="result-heading"><h2 id="result-heading"></h2><p id="run-status"></p><p id="next-step"></p><p id="tested-code"></p><a id="details-link" href="#diagnostics">Run details</a></section><section id="no-recording" class="empty" hidden><h2>No replay available</h2><p>No game states were saved. Run details are retained below.</p></section><section id="playback"><div id="orders" class="orders" aria-label="Current orders"></div><canvas id="arena" aria-label="Kitchen map showing two chefs, ingredients, handoff counters and stoves"></canvas>
<div class="transport"><button id="play" class="primary">Play replay</button><button id="back" aria-label="Back five seconds">−5s</button><button id="next">Next delivery</button><select id="speed" aria-label="Replay speed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select><time id="time"></time><input id="seek" type="range" min="0" value="0" step="1" aria-label="Replay time"></div>
<div id="event" class="event" aria-live="polite"></div><div id="chefs" class="chefs"></div></section><details id="diagnostics"><summary>Run details</summary><p id="scope"></p><div id="sources"></div><div id="issues"></div><p id="run"></p></details>
<details><summary>Rules and what you are watching</summary><p>Fetch → chop → combine two ingredients in a stove → collect cooked soup → serve the matching order. The middle counters hold handoffs.</p><p>Tomato soup: two tomatoes. Mushroom soup: two mushrooms. Garden soup: one of each. Chop for 1.5 seconds; cook for 4 seconds; collect within 6 seconds or the soup burns. Delivery earns 60 points, up to 20 for speed and up to 30 for consecutive orders. An expired order costs 10 points. Burns and missed orders reset the combo.</p><p>This is a rules-engine replay, not a Minecraft recording. Chefs may overlap while walking. Model replies are advice; the task below each chef is its current in-game command. A received bot response is not proof that the game accepted it. Local code handles movement and continues through model delays. Each chef decides independently. A slow reply does not pause the other chef or the kitchen clock in independent-dispatch runs. Replay time is game time; recorded tick delays are listed below.</p></details></main>
<script>const DATA=${data};
const {states,events,responses}=DATA,decisions=DATA.rows.filter(r=>r.type==='decision'),last=states.at(-1);let tick=states[0]?.tick??0,playing=false,previous=performance.now();
const $=id=>document.getElementById(id),canvas=$('arena'),ctx=canvas.getContext('2d');
const fmt=t=>Number.isFinite(t)?Math.floor(t/600)+':'+String(Math.floor(t/10)%60).padStart(2,'0'):'—';
const result=DATA.result;
$('result-heading').textContent=result.heading;
$('result').dataset.warning=String(!result.complete||result.issues.length>0);
$('run-status').textContent='Recorded '+fmt(result.ticks)+(result.duration?' of '+fmt(result.duration):'')+(Number.isFinite(result.score)?' · '+result.score.toLocaleString()+' points at end of run':'');
$('next-step').textContent=result.next;
$('score-label').textContent='Points at replay time';
$('scope').textContent=DATA.meta.execution==='local-process'?'Local practice · no sandbox · models disabled':DATA.meta.execution==='gvisor'?'Hosted rules simulation · not Minecraft physics':'Rules simulation · not Minecraft physics';
$('details-link').onclick=()=>{$('diagnostics').open=true;};
if(!last){$('playback').hidden=true;$('no-recording').hidden=false;$('score').textContent='—';$('score-label').textContent='No replay';$('diagnostics').open=true;}
else {$('seek').min=states[0].tick;$('seek').max=last.tick;}
const colors=['#f0bb79','#7dd3c0'];
const task=c=>c.busyUntil?'Chopping':({tomato:'Fetching a tomato',mushroom:'Fetching a mushroom',chop:'Heading to a chopping board',put:'Leaving an item for the other chef',take:'Collecting from '+c.command.target.replace('stove','stove ').replace('pass','handoff '),cook:'Loading a stove',serve:'Delivering soup',discard:'Clearing waste',wait:'Ready for the next task'}[c.command.task]||c.command.task);
const item=i=>!i?'Empty hands':i.kind==='soup'?i.recipe+' soup':i.kind+' '+i.ingredient;
const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
const sources=Array.isArray(DATA.meta.sources)?DATA.meta.sources.slice(0,2).map(s=>s&&typeof s==='object'?s:{}):[];
const sourceLabel=s=>['git-archive','imported-archive'].includes(s?.kind)&&typeof s.sha==='string'?'Commit '+s.sha.slice(0,8):s?.kind==='working-tree'?'Working files':s?.kind==='loose-file'?'Loose file':'Revision not recorded';
const sameCommit=sources.length===2&&sources.every(s=>['git-archive','imported-archive'].includes(s.kind))&&typeof sources[0].sha==='string'&&sources[0].sha===sources[1].sha&&sources[0].archiveSha256===sources[1].archiveSha256&&sources[0].digest===sources[1].digest;
const codeLabel=sources.some(s=>s.kind==='imported-archive')?'Submitted code':'Tested code';
$('tested-code').textContent=codeLabel+' · '+(sameCommit?'Both chefs: '+sourceLabel(sources[0]):sources.length===2?sources.map((s,i)=>'Chef '+(i+1)+': '+sourceLabel(s)).join(' · '):'revision not recorded');
for(const [i,s] of sources.entries()){const e=document.createElement('div');e.className='source-detail';e.append(text('b','Chef '+(i+1)+' · '+sourceLabel(s)),text('p',(s.name||'Unnamed agent')+' · '+(s.runtime||'runtime not recorded')+' · '+(s.entrypoint||'entrypoint not recorded')));if(s.sha)e.append(text('code','Commit: '+s.sha));if(s.digest)e.append(text('code','Imported archive SHA-256: '+s.digest));if(s.archiveSha256)e.append(text('code','Local Git archive SHA-256: '+s.archiveSha256));e.append(text('p',s.kind==='imported-archive'?'Frozen GitHub archive assigned to this attempt.':s.kind==='git-archive'?'Ran an exported commit. Uncommitted edits were excluded.':s.kind==='working-tree'?'Ran current files, including uncommitted edits.':s.kind==='loose-file'?'Ran one Node entrypoint with its folder as the working directory.':'Source details unavailable.'));$('sources').append(e);}
for(const issue of result.issues){const e=document.createElement('div');e.className='diagnostic';e.append(text('b',issue.label),text('p',issue.detail));$('issues').append(e);}
function draw(){if(!last)return;const s=states.findLast(s=>s.tick<=tick)||states[0];$('score').textContent=s.score.toLocaleString();$('time').textContent=fmt(s.tick)+' / '+fmt(last.tick);$('seek').value=s.tick;$('seek').setAttribute('aria-valuetext',fmt(s.tick));
$('orders').replaceChildren(...s.orders.map(o=>{const e=document.createElement('div');e.className='ticket';e.append(text('b',o.recipe[0].toUpperCase()+o.recipe.slice(1)+' soup'),text('span',DATA.recipes[o.recipe].join(' + ')),text('span',Math.max(0,Math.ceil((o.expiresAt-s.tick)/10))+'s left'));const p=document.createElement('progress');p.max=650;p.value=o.expiresAt-s.tick;p.setAttribute('aria-label','Order time remaining');e.append(p);return e;}));
const event=events.filter(e=>e.tick<=s.tick&&['delivered','burn','miss','finished'].includes(e.kind)).at(-1);$('event').textContent=event?'Last event · '+fmt(event.tick)+' · '+event.text+(event.points?' ('+(event.points>0?'+':'')+event.points+')':''):'Collect and chop ingredients. Serve matching soup at the right-hand counter.';
$('chefs').replaceChildren(...s.chefs.map(c=>{const e=document.createElement('div');e.className='chef';const d=decisions.filter(d=>d.tick<=s.tick&&d.seat===c.seat&&d.kind==='log').at(-1);let trace;try{trace=JSON.parse(d?.payload?.text||'{}')}catch{}const dispatch=responses.filter(r=>r.tick<=s.tick&&r.seat===c.seat).at(-1);const model=decisions.filter(d=>d.tick<=s.tick&&d.seat===c.seat&&d.kind==='model'&&d.payload.phase==='returned').at(-1);e.append(text('b',(c.seat===0?'Apricot':'Teal')+' · Chef '+(c.seat+1)+' · '+(DATA.meta.modelMode==='disabled'?'Local agent':DATA.meta.mode==='scripted'?'Code':DATA.meta.mode==='submission-config'?'Submitted agent':'Jev'+(DATA.meta.mode==='hybrid'?' + LLM':''))),text('p',task(c)+' · '+item(c.item)),text('p',trace?.source?'Controller: '+trace.source:'Waiting for first task'),text('p',DATA.meta.modelMode==='disabled'?'Models disabled':model?'Last advice '+fmt(model.tick)+': '+model.payload.summary:'No model advice yet'));if(dispatch)e.append(text('p',dispatch.payload.kind==='unavailable'?('Bot unavailable · '+(dispatch.payload.error||'No reason recorded')):('Received response '+fmt(dispatch.tick)+' · observation '+fmt(dispatch.payload.observedTick))));return e;}));
const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height,dpr=devicePixelRatio;canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);const sx=w/10,sy=(h-45)/6,px=x=>(x+1)*sx,pz=z=>(z+1)*sy+10;
ctx.fillStyle='#b4b4b4';ctx.font='12px Arial';ctx.textAlign='center';['Prep','Handoff','Cook & serve'].forEach((v,i)=>ctx.fillText(v,w*(i*2+1)/6,h-10));
for(let x=0;x<9;x++)for(let z=0;z<5;z++){ctx.fillStyle=(x+z)%2?'#202020':'#252525';ctx.fillRect(px(x)-sx*.46,pz(z)-sy*.43,sx*.92,sy*.86);}
for(const [id,st] of Object.entries(DATA.stations)){const x=px(st.x),y=pz(st.z);ctx.fillStyle=st.kind==='stove'?'#595959':st.kind==='board'?'#665e4b':'#434343';ctx.fillRect(x-sx*.4,y-sy*.36,sx*.8,sy*.72);ctx.fillStyle='#fff';ctx.font='12px Arial';const label=st.kind==='supply'?(w>600?id:id==='tomato'?'Tom.':'Mush.'):st.kind==='board'?'Chop':st.kind==='stove'?'Pot '+(Number(id.slice(-1))+1):st.kind==='pass'?'Pass':id==='serve'?'Serve':'Bin';ctx.fillText(label,x,y+4);
const p=s.pots[id];if(p){let caption=p.ingredients.length+'/2';if(p.burned)caption='Burned';else if(p.readyAt)caption=s.tick<p.readyAt?'Cook '+Math.ceil((p.readyAt-s.tick)/10)+'s':'Ready '+Math.ceil((p.burnAt-s.tick)/10)+'s';ctx.fillStyle=p.burned?'#ff9e9e':p.readyAt&&s.tick>=p.readyAt?'#7dd3c0':'#fff';ctx.fillText(caption,x,y-sy*.4);}
const hand=s.pass[id];if(hand){ctx.fillStyle=hand.kind==='soup'?'#7dd3c0':hand.ingredient==='tomato'?'#d97068':'#d6c7ac';ctx.beginPath();ctx.arc(x,y-sy*.3,5,0,7);ctx.fill();}}
for(const c of s.chefs){let x=px(c.x),y=pz(c.z);if(s.chefs[1-c.seat].x===c.x&&s.chefs[1-c.seat].z===c.z)x+=(c.seat?1:-1)*sx*.2;ctx.strokeStyle=colors[c.seat];const dest=DATA.stations[c.command.target];if(dest){ctx.setLineDash([4,5]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(px(dest.x),pz(dest.z));ctx.stroke();ctx.setLineDash([]);}ctx.fillStyle=colors[c.seat];ctx.beginPath();ctx.arc(x,y,Math.max(9,Math.min(16,sx*.24)),0,7);ctx.fill();ctx.fillStyle='#111';ctx.font='bold 13px Arial';ctx.fillText(c.seat+1,x,y+4);if(c.item){ctx.fillStyle=c.item.kind==='soup'?'#7dd3c0':c.item.ingredient==='tomato'?'#d97068':'#d6c7ac';ctx.fillRect(x+8,y-14,8,8);}}
}
$('play').onclick=()=>{if(!last)return;if(tick>=last.tick)tick=states[0].tick;playing=!playing;$('play').textContent=playing?'Pause':'Play replay';};$('seek').oninput=()=>{tick=Number($('seek').value);draw();};$('back').onclick=()=>{tick=Math.max(states[0]?.tick??0,tick-50);draw();};$('next').onclick=()=>{if(!last)return;const e=events.find(e=>e.kind==='delivered'&&e.tick>tick);tick=e?e.tick:last.tick;draw();};$('run').textContent='Run '+(DATA.meta.id||'unknown')+' · '+(DATA.meta.execution||'execution not recorded')+' · '+(DATA.meta.style||'style not recorded')+' · '+(DATA.meta.status||'status not recorded')+' · '+(DATA.meta.dispatch||'dispatch not recorded')+' · '+(DATA.meta.modelMode==='disabled'?'models disabled':result.modelsRecorded?result.modelCalls+' model calls, '+result.modelErrors+' errors':'model calls not recorded')+' · p95 tick lateness '+(Number.isFinite(DATA.meta.tickLateP95Ms)?Math.round(DATA.meta.tickLateP95Ms)+' ms':'not recorded');
function frame(now){if(playing&&last){tick=Math.min(last.tick,tick+(now-previous)/100*Number($('speed').value));if(tick>=last.tick){playing=false;$('play').textContent='Play replay';}draw();}previous=now;requestAnimationFrame(frame);}window.addEventListener('resize',draw);draw();if(last)requestAnimationFrame(frame);
</script></html>`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, output] = process.argv.slice(2);
  if (!directory || !output) throw Error('Usage: kitchen-replay.ts RUN_DIRECTORY OUTPUT.html');
  const receipt = JSON.parse(await readFile(directory + '/summary.json', 'utf8'));
  const { rows, issue } = await readReplay(directory);
  await writeFile(output, renderKitchenReplay(receipt, rows, issue), { flag: 'wx', mode: 0o600 });
  console.log(output);
}
