// A guide channel picked by hand that has nothing from now on: the public fill-in may still cover the channel.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),acorn=require('acorn');
const src=fs.readFileSync('app/js/epg.js','utf8');
const ast=acorn.parse(src,{ecmaVersion:2016});
const init=ast.body.find(n=>n.type==='VariableDeclaration').declarations[0].init.callee.body.body;
const names=['handId','missing','epgId','own'];
const code=init.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)).map(n=>src.slice(n.start,n.end)).join('\n');
let fails=0;
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){fails++;console.error('FAIL '+name+': '+e.message);}}
function world(map){
  const chans=[{k:'cw',n:'CW | DETROIT 50 WKBD',epg:'CWWKBD.us'},{k:'abc',n:'ABC | DETROIT',epg:'abc.us'},{k:'pl',n:'Pluto US | Crime',epg:''}];
  const c={PUB_ID:/^\w+:[A-Z]{2}\//,pubMatched:{},matched:{},alias:{},votes:{},
    live:id=>id==='abc.us'||id==='good.us',shortAllowed:()=>false,
    Store:{edits:{epgMap:map}},P:()=>({}),PL:()=>({}),
    PubEpg:{conf:()=>({on:true}),appId:()=>''},
    Library:{data:{channels:chans},noGuide:()=>false}};
  vm.createContext(c);vm.runInContext(code,c);return c;
}
check('a hand-picked id with nothing scheduled is looked for in the public guides',()=>{
  const c=world({cw:'CWWKBD.us'});
  assert.deepStrictEqual(c.missing().map(x=>x.k),['cw','pl']);
});
check('a hand-picked id with programmes is left alone',()=>{
  const c=world({cw:'good.us'});
  assert.deepStrictEqual(c.missing().map(x=>x.k),['pl']);
});
check('the public guide stands in for an empty hand pick, not for a live one',()=>{
  const c=world({cw:'CWWKBD.us',abc:'abc.us'});
  c.pubMatched={cw:'iptvepg:US/CWWKBD.us',abc:'iptvepg:US/x'};
  assert.strictEqual(c.epgId({k:'cw',epg:'CWWKBD.us'}),'iptvepg:US/CWWKBD.us');
  assert.strictEqual(c.epgId({k:'abc',epg:'abc.us'}),'abc.us');
});
check('a public guide channel picked by hand stays as picked',()=>{
  const c=world({cw:'epgpw:US/1'});
  c.pubMatched={cw:'iptvepg:US/CWWKBD.us'};
  assert.strictEqual(c.epgId({k:'cw'}),'epgpw:US/1');
  assert.strictEqual(c.handId({k:'cw'}),'');
});
check('with no public match the hand pick is kept',()=>{
  const c=world({cw:'CWWKBD.us'});
  assert.strictEqual(c.epgId({k:'cw',epg:'CWWKBD.us'}),'CWWKBD.us');
});
if(fails){console.error(fails+' failed');process.exit(1);}
