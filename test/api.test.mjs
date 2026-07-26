import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const port=3300+Math.floor(Math.random()*500);
let child,dataDir,cookie='';

async function request(path,options={}){
  const headers={'content-type':'application/json',...(cookie?{cookie}:{}),...(options.headers||{})};
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{...options,headers});
  const setCookie=response.headers.get('set-cookie');
  if(setCookie) cookie=setCookie.split(';')[0];
  const data=await response.json();
  return {response,data};
}

async function waitForServer(){
  for(let i=0;i<50;i++){
    try{const r=await fetch(`http://127.0.0.1:${port}/api/worlds`);if(r.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Server did not start');
}

test.before(async()=>{
  dataDir=await mkdtemp(join(tmpdir(),'pixelfront-test-'));
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DATA_DIR:dataDir},stdio:'ignore'});
  await waitForServer();
});

test.after(async()=>{child?.kill('SIGTERM');await rm(dataDir,{recursive:true,force:true})});

test('registration and official/community progression are isolated',async()=>{
  let r=await request('/api/auth/register',{method:'POST',body:JSON.stringify({nick:'Tester_01',password:'safe-password-123'})});
  assert.equal(r.response.status,201);
  assert.equal(r.data.user.officialPixels,0);

  r=await request('/api/worlds/official/pixel',{method:'POST',body:JSON.stringify({x:1,y:1,color:'#2783de'})});
  assert.equal(r.response.status,201);
  r=await request('/api/me');
  assert.equal(r.data.user.officialPixels,1);
  assert.equal(r.data.user.achievements.length,1);

  r=await request('/api/worlds',{method:'POST',body:JSON.stringify({name:'Тестовый мир',width:32,height:24,cooldownMs:250,maxEnergy:100})});
  assert.equal(r.response.status,201);
  const worldId=r.data.world.id;

  r=await request(`/api/worlds/${worldId}/pixel`,{method:'POST',body:JSON.stringify({x:2,y:2,color:'#46a171'})});
  assert.equal(r.response.status,201);
  r=await request('/api/me');
  assert.equal(r.data.user.officialPixels,1,'community pixel must not affect official rating');
  assert.equal(r.data.user.communityPixels,1);
});

test('community owner can protect art and use local chat',async()=>{
  let r=await request('/api/worlds');
  const world=r.data.worlds.find(w=>w.type==='community');
  assert.ok(world);

  r=await request(`/api/worlds/${world.id}/arts`,{method:'POST',body:JSON.stringify({name:'Логотип',x:0,y:0,width:8,height:8})});
  assert.equal(r.response.status,201);
  assert.equal(r.data.art.name,'Логотип');

  r=await request(`/api/worlds/${world.id}/chat`,{method:'POST',body:JSON.stringify({text:'Проверка локального чата'})});
  assert.equal(r.response.status,201);
  r=await request(`/api/worlds/${world.id}/chat`);
  assert.equal(r.data.messages.at(-1).text,'Проверка локального чата');
});
