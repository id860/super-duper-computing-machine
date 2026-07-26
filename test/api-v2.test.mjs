import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const port=3900+Math.floor(Math.random()*500),base=`http://127.0.0.1:${port}`;
let child,dataDir;
const owner={cookie:'',csrf:''},admin={cookie:'',csrf:''};
function start(){child=spawn(process.execPath,['server-v2.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DATA_DIR:dataDir,ADMIN_NICK:'V2Admin',ADMIN_PASSWORD:'test-admin-password-123',AUTO_ARCHIVE_DAYS:'90'},stdio:'ignore'})}
async function stop(){if(!child)return;child.kill('SIGTERM');await once(child,'exit');child=null}
async function wait(){for(let i=0;i<80;i++){try{if((await fetch(base+'/api/worlds')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error('server-v2 did not start')}
async function request(path,options={},client=owner){let method=options.method||'GET',headers={'content-type':'application/json',...(client.cookie?{cookie:client.cookie}:{}),...(options.headers||{})};if(!['GET','HEAD'].includes(method)&&options.origin!==false)headers.origin=base;if(options.csrf)headers['x-csrf-token']=client.csrf;let response=await fetch(base+path,{...options,method,headers});let setCookie=response.headers.get('set-cookie');if(setCookie)client.cookie=setCookie.split(';')[0];let data=await response.json();if(data.csrfToken)client.csrf=data.csrfToken;return{response,data}}

test.before(async()=>{dataDir=await mkdtemp(join(tmpdir(),'pixelfront-v2-'));start();await wait()});
test.after(async()=>{await stop();await rm(dataDir,{recursive:true,force:true})});

test('security headers, frontend-compatible origin checks and persistent sessions',async()=>{
  let r=await request('/api/worlds');
  assert.equal(r.response.headers.get('x-content-type-options'),'nosniff');
  assert.match(r.response.headers.get('content-security-policy'),/script-src 'self' 'unsafe-inline'/);
  r=await request('/api/auth/register',{method:'POST',body:JSON.stringify({nick:'OwnerV2',password:'owner-password-123'})});
  assert.equal(r.response.status,201);assert.ok(owner.cookie);assert.ok(owner.csrf);
  r=await request('/api/worlds',{method:'POST',body:JSON.stringify({name:'V2 world',width:32,height:24,cooldownMs:250,maxEnergy:100})});
  assert.equal(r.response.status,201);
  await stop();start();await wait();
  r=await request('/api/me');assert.equal(r.data.user.nick,'OwnerV2');
  r=await request('/api/worlds',{method:'POST',origin:false,body:JSON.stringify({name:'blocked'})});assert.equal(r.response.status,403);
  r=await request('/api/worlds',{method:'POST',origin:false,csrf:true,body:JSON.stringify({name:'CSRF world'})});assert.equal(r.response.status,201);
});

test('community settings, pixel history, rollback, quests alias and archive work',async()=>{
  let r=await request('/api/worlds',{method:'POST',body:JSON.stringify({name:'History world',width:32,height:24,cooldownMs:250,maxEnergy:100})}),wid=r.data.world.id;
  r=await request(`/api/worlds/${wid}`,{method:'PATCH',body:JSON.stringify({name:'Renamed world',description:'updated',public:true})});assert.equal(r.response.status,200);assert.equal(r.data.world.name,'Renamed world');
  await request(`/api/worlds/${wid}/pixel`,{method:'POST',body:JSON.stringify({x:2,y:3,color:'#2783de'})});
  r=await request(`/api/worlds/${wid}/pixel-history?x=2&y=3`);assert.equal(r.response.status,200);assert.equal(r.data.history[0].type,'place');
  r=await request(`/api/worlds/${wid}/rollback`,{method:'POST',body:JSON.stringify({historyId:r.data.history[0].id})});assert.equal(r.response.status,200);assert.equal(r.data.pixel,null);
  for(let i=0;i<5;i++)await request(`/api/worlds/${wid}/pixel`,{method:'POST',body:JSON.stringify({x:i,y:4,color:'#46a171'})});
  r=await request('/api/quests');assert.equal(r.response.status,200);assert.equal(r.data.daily.quests.find(q=>q.id==='pixels_5').progress,5);
  r=await request('/api/quests/daily/pixels_5/claim',{method:'POST',body:'{}'});assert.equal(r.response.status,200);assert.equal(r.data.inventory.coins,25);
  r=await request(`/api/worlds/${wid}/archive`,{method:'POST',body:JSON.stringify({reason:'test'})});assert.equal(r.response.status,200);assert.ok(r.data.world.archivedAt);
});

test('admin report queue, PATCH resolve alias and audit log work',async()=>{
  let worlds=await request('/api/worlds'),wid=worlds.data.worlds.find(w=>w.type==='community').id;
  let r=await request('/api/reports',{method:'POST',body:JSON.stringify({worldId:wid,reason:'integration test'})}),rid=r.data.report.id;assert.equal(r.response.status,201);
  r=await request('/api/auth/login',{method:'POST',body:JSON.stringify({nick:'V2Admin',password:'test-admin-password-123'})},admin);assert.equal(r.response.status,200);
  r=await request('/api/admin/reports',{},admin);assert.ok(r.data.reports.some(x=>x.id===rid));
  r=await request(`/api/admin/reports/${rid}`,{method:'PATCH',body:JSON.stringify({resolution:'checked',status:'resolved'})},admin);assert.equal(r.response.status,200);assert.equal(r.data.report.status,'resolved');
  r=await request('/api/admin/audit',{},admin);assert.ok(r.data.audit.some(x=>x.action==='report.resolve'));
});
