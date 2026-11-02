// The notice decisions from Epg, with controlled stored/public listing availability.
// Browser coverage drives the complete helper and in-app loading pipelines.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),acorn=require('acorn');
const src=fs.readFileSync('app/js/epg.js','utf8');
const ast=acorn.parse(src,{ecmaVersion:2016});
const init=ast.body.find(n=>n.type==='VariableDeclaration').declarations[0].init.callee.body.body;
const names=['mainGuideFailure','finishGuideNotice'];
const code=init.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)).map(n=>src.slice(n.start,n.end)).join('\n');
let fails=0;
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){fails++;console.error('FAIL '+name+': '+e.message);}}
function world(){
  const states=[],toasts=[];
  const c={pubMatched:{},pubStatus:null,pubGen:1,paused:null,hostOf:u=>u,live:id=>id==='fresh',setProgress:p=>states.push(p),U:{toast:m=>toasts.push(m)}};
  vm.createContext(c);vm.runInContext(code,c);return {c,states,toasts};
}
check('a provider failure waits neutrally for enabled public guides',()=>{
  const w=world(),n={provider:true,fallback:true};w.c.mainGuideFailure(n,'HTTP 404',[{host:'provider guide',ok:false,error:'HTTP 404'}]);
  assert.equal(w.states[0].phase,'fallback');assert.match(w.states[0].message,/checking public guides/);assert.equal(w.toasts.length,0);
  w.c.pubMatched={channel:'fresh'};w.c.pubStatus={filled:1,sources:[{ok:true,programmes:3}]};w.c.finishGuideNotice(n);
  const p=w.states[1];assert.equal(p.phase,'done');assert.equal(p.message,'Provider guide unavailable; using public guides.');assert.equal(p.error,'HTTP 404');assert.equal(p.report.length,2);
});
check('missing or expired public listings cannot produce a success notice',()=>{
  for(const match of [{},{channel:'expired'}]){
    const w=world(),n={provider:true,fallback:true};w.c.mainGuideFailure(n,'HTTP 404',[]);w.c.pubMatched=match;w.c.pubStatus={filled:1,sources:[{ok:true,programmes:3}]};w.c.finishGuideNotice(n);
    assert.equal(w.states[1].phase,'error');assert.match(w.states[1].message,/no matching listings/);
  }
});
check('public guides disabled retains the original error and toast',()=>{
  const w=world(),n={provider:true,fallback:false};w.c.mainGuideFailure(n,'HTTP 404',[]);w.c.finishGuideNotice(n);
  assert.equal(w.states.length,1);assert.equal(w.states[0].phase,'error');assert.equal(w.states[0].message,'');assert.match(w.toasts[0],/HTTP 404/);
});
check('extra guide failures are not mislabeled as a provider failure',()=>{
  const w=world(),n={provider:false,fallback:true};w.c.mainGuideFailure(n,'HTTP 500',[]);w.c.pubMatched={channel:'fresh'};w.c.finishGuideNotice(n);
  assert.equal(w.states[1].message,'Guide sources unavailable; using public guides.');
});
check('successful main guides do not get a fallback notice',()=>{
  const w=world();w.c.finishGuideNotice({provider:true,fallback:true});assert.equal(w.states.length,0);
});
check('the guide kept from before still works: no red notice',()=>{
  const w=world(),n={provider:true,fallback:true,kept:true};w.c.mainGuideFailure(n,'HTTP 404',[]);w.c.finishGuideNotice(n);
  assert.equal(w.states[1].phase,'done');assert.match(w.states[1].message,/using the saved guide\.$/);
});
check('public guides paused after closes: that message stays',()=>{
  const w=world(),n={provider:true,fallback:true};w.c.mainGuideFailure(n,'HTTP 404',[]);w.c.paused={kind:'pub'};w.c.finishGuideNotice(n);
  assert.equal(w.states.length,1);
});
check('an older load says nothing once a newer one started',()=>{
  const w=world(),n={gen:1,provider:true,fallback:true};w.c.pubGen=2;w.c.mainGuideFailure(n,'HTTP 404',[]);assert.equal(w.states.length,0);
});
if(fails)process.exitCode=1;
