/* TV flow contracts with the real controller and a deterministic helper/player facade. */
'use strict';
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const menus=[],requests=[],plays=[];
let activeHandler=null,inLists=true;
const show={handle:'show_demo',title:'Harbour',order:'aired',buckets:[{key:'1',count:1}],revision:1};
const ep={handle:'ep_demo',kind:'episode',showId:'show_demo',season:1,number:2,title:'Return',watchState:'unwatched',revision:1,versions:[{handle:'file_demo',sourceId:'src_demo',label:'Episode.mkv'}]};
const ctx={console,Promise,setTimeout,clearTimeout,Store:{settings:{autoNext:false}},MediaStore:{source:id=>({id,name:'Demo source'}),tmdbToken:()=>'',preferences:()=>({language:'en',favoritesInLists:inLists})},U:{toast(){}},UI:{menu:(title,items,back)=>{menus.push({title,items,back});},close(){}},Media:{restore(){activeHandler='root';},playFile:m=>plays.push(m),request:(route,q)=>{requests.push({route,q});let r={};if(route==='library/query')r={items:q.kind==='show'?[show]:[ep],revision:1};if(route==='library/detail')r=q.kind==='show'?show:ep;if(route==='library/resolve')r={url:'http://127.0.0.1/mock'};return Promise.resolve(r);}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/js/media-series.js','utf8'),ctx);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
ctx.MediaSeries.open();await tick();assert.equal(menus.at(-1).title,'TV shows');
menus.at(-1).items[0].action();await tick();assert.equal(menus.at(-1).title,'Harbour');
menus.at(-1).items[0].action();await tick();assert.equal(menus.at(-1).items[0].label,'S1E2  Return');
menus.at(-1).items[0].action();await tick();assert.equal(menus.at(-1).title,'S1E2  Return');
menus.at(-1).items[0].action();await tick();assert.equal(plays.length,1);assert.equal(plays[0].episodeHandle,'ep_demo');
ctx.MediaSeries.open();ctx.MediaSeries.leave();const before=menus.length;await tick();assert.equal(menus.length,before,'leaving discards pending helper response');
ctx.MediaSeries.open();await tick();menus.at(-1).back();assert.equal(activeHandler,'root','remote Back restores parent');
assert.equal(requests.filter(r=>r.route==='library/query'&&r.q.kind==='show').at(-1).q.favourite,undefined,'TV shows lists favorites by default');
inLists=false;ctx.MediaSeries.open();await tick();assert.equal(requests.filter(r=>r.route==='library/query'&&r.q.kind==='show').at(-1).q.favourite,false,'with Favorites also in lists off, TV shows leaves favorites out');
console.log('PASS show/season/episode navigation, explicit playback, response cancellation Back and Favorites also in lists');
})().catch(e=>{console.error(e);process.exitCode=1;});
