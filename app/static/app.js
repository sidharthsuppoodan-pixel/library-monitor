'use strict';
const $ = id => document.getElementById(id);
let token = '', timer = null, currentRows = [], cursor = null, busy = false, generation = 0, paused = false, lastChartData = null;
const fmt = new Intl.NumberFormat();
const date = value => new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
async function api(path) {
  const response = await fetch(path, {headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(10000)});
  if (response.status === 401) throw new Error('Dashboard key was not accepted. Lock and reconnect with the current key.');
  if (!response.ok) throw new Error(`Server unavailable (${response.status}). Retrying automatically.`);
  return response.json();
}
function connection(label, online) { $('connection').textContent=label; $('connection').classList.toggle('online',online); }
function lock() {
  generation++; token=''; clearTimeout(timer); timer=null;
  $('dashboard').hidden=true; $('login').hidden=false; $('signout').hidden=true;
  $('dashboard-key').value=''; currentRows=[];cursor=null;connection('Not signed in',false);$('poll-controls').hidden=true;
}
$('signout').addEventListener('click',lock);
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault(); if(busy) return;
  token=$('dashboard-key').value.trim(); $('login-error').textContent='';
  try { await refresh(true); $('dashboard-key').value=''; }
  catch(error) { token='';$('login-error').textContent=error.message; }
});
async function refresh(first=false) {
  if(busy || !token) return;
  busy=true; const run=generation; clearTimeout(timer); $('refresh').disabled=true;
  try {
    const [summary,history]=await Promise.all([api(`/summary?minutes=${$('window').value}`),api('/readings?limit=30')]);
    if(run!==generation)return;
    $('poll-controls').hidden=false;$('dashboard').hidden=false;$('login').hidden=true;$('signout').hidden=false;$('error').hidden=true;
    currentRows=history.items;cursor=history.next_cursor;renderRows(); renderSummary(summary);
  } catch(error) {
    if(run!==generation)return;
    connection('Connection interrupted',false);
    if(first) throw error;
    $('error').textContent=error.message + ' Displayed readings may be outdated.';$('error').hidden=false;
    $('status').textContent='Connection lost';$('status').className='status neutral';
  } finally {
    busy=false;$('refresh').disabled=false;
    if(token && !paused && run===generation) timer=setTimeout(()=>refresh(),1000);
  }
}
$('refresh').addEventListener('click',()=>refresh());
$('window').addEventListener('change',()=>refresh());
function renderSummary(data) {
  const latest=data.latest, stale=!latest || (new Date(data.server_time)-new Date(latest.created_at))/1000>data.stale_after_seconds;
  connection(!latest?'Waiting for device':stale?'Device offline':'Device online',!stale);
  $('device-name').textContent=data.device_id;
  const recentNoisy=currentRows.find(r=>r.noisy&&(new Date(data.server_time)-new Date(r.created_at))/1000<25);
  if(recentNoisy){
    const ago=Math.max(0,Math.round((new Date(data.server_time)-new Date(recentNoisy.created_at))/1000));
    $('score').textContent=fmt.format(recentNoisy.noise_score);
    $('score-bar').setAttribute('width',(recentNoisy.noise_score/4095)*100);
    $('status').textContent=`High noise detected (${ago}s ago)`;
    $('status').className='status noisy';
  }else{
    $('score').textContent=latest?fmt.format(latest.noise_score):'—';
    $('score-bar').setAttribute('width',latest?(latest.noise_score/4095)*100:0);
    $('status').textContent=!latest?'Waiting for device':stale?'Device offline':'Normal noise level';
    $('status').className=`status ${stale?'neutral':'normal'}`;
  }
  $('average').textContent=data.average===null?'—':fmt.format(data.average);
  $('peak').textContent=data.peak===null?'—':fmt.format(data.peak);
  $('noisy-count').textContent=data.count?fmt.format(data.noisy_count):'0';
  $('reading-count').textContent=`${fmt.format(data.count)} readings in this period`;
  $('received').textContent=latest?`Received ${date(latest.created_at)}`:'No readings received yet';
  $('updated').textContent=`Updated ${new Date(data.server_time).toLocaleTimeString()}`;
  chart(data);
}
function renderRows() {
  $('rows').replaceChildren();
  $('export').disabled=currentRows.length===0;
  $('log-count').textContent=currentRows.length;
  if(!currentRows.length) {
    const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;cell.className='empty-cell';cell.textContent='No library readings recorded yet. Readings appear automatically when the sensor connects.';row.append(cell);$('rows').append(row);
  }
  currentRows.forEach(reading=>{
    const row=document.createElement('tr');
    if(reading.noisy) row.className='noisy-row';
    [date(reading.created_at),reading.device_id,fmt.format(reading.noise_score),reading.noisy?'⚠️ High noise':'Normal',`#${reading.id}`].forEach((value,index)=>{
      const cell=document.createElement('td');
      if(index===3){const badge=document.createElement('span');badge.className=`status ${reading.noisy?'noisy':'normal'}`;badge.textContent=value;cell.append(badge);}else cell.textContent=value;
      row.append(cell);
    });$('rows').append(row);
  });
  $('history-count').textContent=`${currentRows.length} readings displayed · received time in your timezone`;
  $('older').hidden=!cursor || currentRows.length>=500;
}
$('older').addEventListener('click',async()=>{
  if(busy||!cursor)return;
  busy=true;clearTimeout(timer);$('older').disabled=true;const run=generation;
  try {const data=await api(`/readings?limit=30&before_id=${cursor}`);if(run!==generation)return;currentRows.push(...data.items);cursor=data.next_cursor;renderRows();}
  catch(error){$('error').textContent=error.message;$('error').hidden=false;}
  finally {busy=false;$('older').disabled=false;if(token&&!paused&&run===generation)timer=setTimeout(()=>refresh(),30000);}
});
$('export').addEventListener('click',()=>{
  const lines=['id,device_id,noise_score,noisy,received_at_utc',...currentRows.map(r=>[r.id,r.device_id,r.noise_score,r.noisy,r.created_at].join(','))];
  const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='noise-readings.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
function svgElement(tag,attrs={},text='') {
  const element=document.createElementNS('http://www.w3.org/2000/svg',tag);
  Object.entries(attrs).forEach(([key,value])=>element.setAttribute(key,String(value)));if(text)element.textContent=text;return element;
}
function chart(data) {
  lastChartData=data;
  const svg=$('chart');svg.replaceChildren(svgElement('title',{},'Average and peak relative noise scores over time'));
  const W=Math.max(280,Math.round(svg.getBoundingClientRect().width)),H=250,left=44,right=16,top=10,bottom=32,max=4095,end=Date.parse(data.server_time),start=end-data.minutes*60000;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const x=t=>left+(Date.parse(t)-start)/(end-start)*(W-left-right), y=n=>H-bottom-n/max*(H-top-bottom);
  [0,1024,2048,3072,4095].forEach(value=>{
    svg.append(svgElement('line',{x1:left,y1:y(value),x2:W-right,y2:y(value),stroke:'#edf0f4','stroke-dasharray':'3 5'}));
    svg.append(svgElement('text',{x:left-9,y:y(value)+3,'text-anchor':'end'},String(value)));
  });
  const ticks=W<500?3:4;
  for(let n=0;n<=ticks;n++) svg.append(svgElement('text',{x:left+n*(W-left-right)/ticks,y:H-5,'text-anchor':n===0?'start':n===ticks?'end':'middle'},new Date(start+n*(end-start)/ticks).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));
  const points=data.series.filter(p=>Date.parse(p.timestamp)>=start);
  $('chart-empty').hidden=points.length>0;
  if(!points.length){
    $('chart-empty').querySelector('strong').textContent=data.latest?'No readings in this period':'No readings yet';
    $('chart-empty').querySelector('p').textContent=data.latest?'Choose a longer time range or wait for new readings.':'Readings will appear when the library sensor sends data.';
    return;
  }
  const groups=[];let group=[];const maxGap=Math.max(30,data.minutes*60/120)*1500;
  points.forEach(p=>{if(group.length&&Date.parse(p.timestamp)-Date.parse(group.at(-1).timestamp)>maxGap){groups.push(group);group=[];}group.push(p);});if(group.length)groups.push(group);
  groups.forEach(series=>{
    ['peak','average'].forEach(key=>{
      const path=series.map((p,i)=>`${i?'L':'M'} ${x(p.timestamp).toFixed(2)} ${y(p[key]).toFixed(2)}`).join(' ');
      svg.append(svgElement('path',{d:path,fill:'none',stroke:key==='average'?'#3b6fd8':'#a8b5ca','stroke-width':key==='average'?2:1.5,'stroke-dasharray':key==='peak'?'4 4':'none'}));
      if(series.length===1)svg.append(svgElement('circle',{cx:x(series[0].timestamp),cy:y(series[0][key]),r:3,fill:key==='average'?'#3b6fd8':'#a8b5ca'}));
    });
  });
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token&&!paused)refresh();});
$('pause').addEventListener('click',()=>{
  paused=!paused; $('pause').setAttribute('aria-pressed',String(paused));
  $('pause').textContent=paused?'Resume':'Pause';
  $('poll-label').textContent=paused?'Updates paused':'Live (Updates every 1s)';
  $('pause').closest('.poll-state').classList.toggle('paused',paused);
  clearTimeout(timer); if(!paused&&token)refresh();
});
$('setup-open').addEventListener('click',()=>$('setup-dialog').showModal());
$('setup-close').addEventListener('click',()=>$('setup-dialog').close());
$('setup-dialog').addEventListener('click',event=>{if(event.target===$('setup-dialog')){const rect=$('setup-dialog').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('setup-dialog').close();}});
document.querySelectorAll('.view-link').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.view-link').forEach(item=>item.classList.toggle('active',item===link));}));

window.addEventListener('resize',()=>{if(lastChartData)chart(lastChartData);});

$('device-setup').addEventListener('click',()=>$('setup-dialog').showModal());
