'use strict';
const assert=require('assert'),C=require('../../service/media-chapters');
function el(hex,bytes){const id=Buffer.from(hex,'hex');assert(bytes.length<127);return Buffer.concat([id,Buffer.from([128|bytes.length]),bytes]);}
function uint(n){let b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(n/4294967296),0);b.writeUInt32BE(n>>>0,4);return b;}
const atom=(n,title)=>el('b6',Buffer.concat([el('91',uint(n*1e9)),el('80',el('85',Buffer.from(title)))]));
const edition=(ordered)=>el('1043a770',el('45b9',Buffer.concat([el('45db',Buffer.from([1])),el('45dd',Buffer.from([ordered?1:0])),atom(0,'S01E01'),atom(120,'S01E02')])));
const parsed=C.mkv(edition(false));assert.equal(parsed.chapters[1].startSec,120);assert.equal(parsed.chapters[1].name,'S01E02');
assert.equal(C.mkv(edition(true)).status,'unsupportedTimeline');
const title=Buffer.from('Episode 2');const header=Buffer.alloc(9);header[0]=1;header.writeUInt32BE(1,5);
const mp4=C.chpl(Buffer.concat([header,uint(120*1e7),Buffer.from([title.length]),title]));assert.equal(mp4.chapters[0].startSec,120);
assert.throws(()=>C.mkv(edition(false).subarray(0,10)));assert.throws(()=>C.chpl(Buffer.from([1,0])));
assert.throws(()=>C.validate([{startSec:-1,endSec:20}],100));assert.throws(()=>C.validate([{startSec:0,endSec:40},{startSec:30,endSec:50}],100));
assert.equal(C.validate([{startSec:0,endSec:30},{startSec:30,endSec:60}],60).length,2);
function box(type,body){const head=Buffer.alloc(8);head.writeUInt32BE(body.length+8,0);head.write(type,4);return Buffer.concat([head,body]);}
const file=Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('mdat',Buffer.alloc(2000)),box('moov',box('udta',box('chpl',Buffer.concat([header,uint(120*1e7),Buffer.from([title.length]),title]))))]);
C.inspect((offset,length,cb)=>cb(null,file.subarray(offset,offset+length)),file.length,'mp4',(e,r)=>{assert.ifError(e);assert.equal(r.chapters[0].startSec,120);console.log('PASS chapter timing, physical/virtual distinction, malformed bounds, manual validation and MP4 tail index');});
// QuickTime chapters use a referenced text track and sample timing, rather than chpl timestamps.
function u32(n){const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;}
function fullTable(type,rows){return box(type,Buffer.concat([Buffer.alloc(4),u32(rows.length),...rows]));}
const sample1=Buffer.concat([Buffer.from([0,7]),Buffer.from('S01E01') ,Buffer.from([0])]);
const sample2=Buffer.concat([Buffer.from([0,6]),Buffer.from('S01E02')]);
const ftyp=box('ftyp',Buffer.from('isom0000')),textStart=ftyp.length+8;
const tkhd=id=>{const b=Buffer.alloc(20);b[3]=id===1?1:0;b.writeUInt32BE(id,12);return box('tkhd',b);};
const mdhd=Buffer.alloc(24);mdhd.writeUInt32BE(1000,12);const hdlr=Buffer.alloc(12);hdlr.write('text',8);
const tables=Buffer.concat([
fullTable('stts',[Buffer.concat([u32(2),u32(120000)])]),
fullTable('stsc',[Buffer.concat([u32(1),u32(2),u32(1)])]),
box('stsz',Buffer.concat([Buffer.alloc(4),u32(0),u32(2),u32(sample1.length),u32(sample2.length)])),
fullTable('stco',[u32(textStart)])]);
const textTrack=box('trak',Buffer.concat([tkhd(2),box('mdia',Buffer.concat([box('mdhd',mdhd),box('hdlr',hdlr),box('minf',box('stbl',tables))]))]));
const videoTrack=box('trak',Buffer.concat([tkhd(1),box('tref',box('chap',u32(2)))]));
const qtFile=Buffer.concat([ftyp,box('mdat',Buffer.concat([sample1,sample2])),box('moov',Buffer.concat([videoTrack,textTrack]))]);
C.inspect((offset,length,cb)=>cb(null,qtFile.subarray(offset,offset+length)),qtFile.length,'mp4',(e,r)=>{assert.ifError(e);assert.equal(r.chapters.length,2);assert.equal(r.chapters[1].name,'S01E02');assert.equal(r.chapters[1].startSec,120);console.log('PASS QuickTime referenced text track, sample sizes/chunks and physical presentation times');});
