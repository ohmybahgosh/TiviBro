/* Pending playback is observed at the player boundary, including callbacks firing after cancellation.  Up next
   (upnext.js) is stood in for: its card is kept, and its countdown is a timer that plays unless the card was
   cancelled or stopped. */
'use strict';
const assert=require('assert'),vm=require('vm'),fs=require('fs');
const source=fs.readFileSync('app/js/media-series.js','utf8');
function world(options={}){
 const menus=[],plays=[],timers=[],pending=[],edits=[];
 const first={handle:'ep1',kind:'episode',showId:'show',season:1,number:1,order:'aired',title:'One',revision:1,versions:[{handle:'file1',sourceId:'demo'}]};
 const second={handle:'ep2',kind:'episode',showId:'show',season:1,number:2,order:'aired',title:'Two',revision:2,gapBefore:!!options.gap,versions:[{handle:'file2',sourceId:'demo'}]};
 if(options.shared){second.versions[0].handle='file1';second.versions[0].boundaries=[{episode:'ep2',startSec:100,endSec:200}];}
 const cards=[];let live=null;
 const ctx={Promise,console,setTimeout:(f,ms)=>{const t={f,ms,cleared:false};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;},Store:{settings:{autoNext:options.autoNext!==false}},MediaStore:{source:id=>({id,name:'Demo'}),preferredSource:()=>null,preferences:()=>({language:'en',favoritesInLists:true})},U:{toast(){}},UpNext:{show(o){const card={o,off:false};cards.push(card);live=card;if(o.auto!==false&&ctx.Store.settings.autoNext!==false)timers.push({ms:10000,f(){if(!card.off&&live===card)o.play();}});},stop(){if(live)live.off=true;live=null;}},UI:{menu:(title,items,back)=>menus.push({title,items,back}),close(){}},Media:{cancelPending(){},restore(){},playFile:m=>plays.push(m),request:(route,q)=>{
   if(route==='library/edit'){edits.push(q);return Promise.resolve({revision:2});}
   if(route==='library/query')return Promise.resolve({items:q.kind==='show'?[]:[second],revision:2});
   if(route==='library/detail')return Promise.resolve(q.handle==='ep1'?first:second);
   if(route==='library/resolve')return options.deferResolve?new Promise(resolve=>pending.push(resolve)):Promise.resolve({url:'http://127.0.0.1/mock',resumeKey:'demo|two'});
   throw Error('Unexpected route '+route);
 }}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {S:ctx.MediaSeries,menus,cards,plays,timers,pending,edits,file:{id:'file1',src:'demo',episodeHandle:'ep1',showId:'show',number:1,season:1,order:'aired',libraryRevision:1,playStartedAt:1}};
}
async function settle(){for(let i=0;i<8;i++)await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));}
(async()=>{
 let w=world();w.S.completed(w.file);await settle();assert.equal(w.timers.length,1);const c=w.cards[0].o;assert.equal(c.kicker,'Up next');assert.equal(c.title,'Two');assert.equal(c.line,'Season 1, episode 2');w.timers[0].f();await settle();assert.equal(w.plays.length,1);assert.equal(w.plays[0].episodeHandle,'ep2');
 w=world();w.S.completed(w.file);await settle();w.cards[0].o.play();await settle();assert.equal(w.plays.length,1,'Play now starts it at once');
 w=world({autoNext:false});w.S.completed(w.file,null,true);await settle();assert.equal(w.cards.length,0);assert.equal(w.plays.length,1,'Next episode at the credits plays it at once, with no card');
 w=world({autoNext:false});w.S.completed(w.file);await settle();assert.equal(w.timers.length,0);assert.equal(w.plays.length,0);assert.equal(w.cards.length,1,'the card still comes, waiting for OK');
 // Skipped to the end (not eligible): Up next still comes, and nothing is marked watched.
w=world();w.S.completed(w.file,null,false,true);await settle();assert.equal(w.cards.length,1,'Up next after a skip to the end');assert.equal(w.edits.length,0,'not marked watched');
w=world();w.S.completed(w.file);await settle();assert.ok(w.edits.length>=1,'watched to the end: marked');
w=world({gap:true});w.S.completed(w.file);await settle();assert.equal(w.timers.length,0);assert.equal(w.cards.at(-1).o.kicker,'An episode is missing');
 w=world();w.S.completed(w.file);await settle();const stale=w.timers[0];w.cards[0].off=true;w.cards[0].o.cancel();await settle();stale.f();await settle();assert.equal(w.plays.length,0,'a cancelled countdown cannot start playback even if its callback fires');
 w=world({deferResolve:true});w.S.completed(w.file);await settle();w.timers[0].f();await settle();assert.equal(w.pending.length,1);w.S.leave();w.pending[0]({url:'http://127.0.0.1/late'});await settle();assert.equal(w.plays.length,0,'late resolution after leaving cannot start playback');
 w=world({shared:true});w.file.segmented=true;w.file.endSec=100;let reused=0,stops=0;w.S.completed(w.file,{continue:(ep,range)=>{assert.equal(ep.handle,'ep2');assert.equal(range.startSec,100);reused++;},stop:()=>stops++,cancel:()=>stops++});await settle();w.timers[0].f();await settle();assert.equal(reused,1);assert.equal(stops,0);assert.equal(w.plays.length,0,'adjacent ranges reuse the authorised player session');
 console.log('PASS Up next card and countdown, Play now, disabled setting, missing-episode prompt, stale timer and late resolver cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
