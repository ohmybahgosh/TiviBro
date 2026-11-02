/* QuickTime chapter text tracks referenced by an enabled track's tref/chap.  Physical timing only:
   unsupported edit lists return a manual-timing fallback.  ES5 / Node 0.12. */
'use strict';
function uint(b,a,z){var n=0;for(var i=a;i<z;i++){if(i>=b.length)throw new Error('Truncated MP4 field.');n=n*256+b[i];if(n>9007199254740991)throw new Error('MP4 integer is too large.');}return n;}
function atoms(b,a,z){var out=[];while(a<z){if(a+8>z)throw new Error('Truncated MP4 atom.');var size=uint(b,a,a+4),head=8,type=b.toString('ascii',a+4,a+8);if(size===1){size=uint(b,a+8,a+16);head=16;}if(!size)size=z-a;if(size<head||a+size>z)throw new Error('Invalid MP4 atom.');out.push({type:type,start:a+head,end:a+size});a+=size;}return out;}
function child(b,parent,type){var list=atoms(b,parent.start,parent.end);for(var i=0;i<list.length;i++)if(list[i].type===type)return list[i];return null;}
function required(b,parent,type){var item=child(b,parent,type);if(!item)throw new Error('Missing MP4 '+type+' table.');return item;}
function table(b,box,width){var count=uint(b,box.start+4,box.start+8);if(count>2000||box.start+8+count*width>box.end)throw new Error('Invalid chapter table size.');var rows=[];for(var i=0;i<count;i++){var row=[];for(var offset=0;offset<width;offset+=4)row.push(uint(b,box.start+8+i*width+offset,box.start+12+i*width+offset));rows.push(row);}return rows;}
function decode(b){
  if(b.length<2)throw new Error('Truncated chapter text sample.');var length=uint(b,0,2);if(length>b.length-2)throw new Error('Invalid chapter text length.');
  var p=2,end=2+length,text='';
  if(length>=2&&b[p]===254&&b[p+1]===255){for(p+=2;p+1<end;p+=2)text+=String.fromCharCode(b[p]*256+b[p+1]);return text.slice(0,512);}
  if(length>=2&&b[p]===255&&b[p+1]===254)return b.toString('utf16le',p+2,end).slice(0,512);
  return b.toString('utf8',p,end).slice(0,512);
}
function inspect(b,read,cb){
  var selected=null,tracks=[],references=[],root={start:0,end:b.length},chpl=null;
  try{
    var top=atoms(b,0,b.length);
    top.forEach(function(item){
      if(item.type==='udta'){var itemList=atoms(b,item.start,item.end);itemList.forEach(function(c){if(c.type==='chpl')chpl=b.slice(c.start,c.end);});}
      if(item.type!=='trak')return;
      var tkhd=required(b,item,'tkhd'),version=b[tkhd.start],idOffset=tkhd.start+(version===1?20:12);
      if(idOffset+4>tkhd.end)throw new Error('Truncated chapter track identity.');
      var track={id:uint(b,idOffset,idOffset+4),box:item};tracks.push(track);
      var enabled=!!(uint(b,tkhd.start+1,tkhd.start+4)&1),tref=child(b,item,'tref');
      if(enabled&&tref){var chap=child(b,tref,'chap');if(chap){if((chap.end-chap.start)%4)throw new Error('Invalid chapter references.');for(var p=chap.start;p<chap.end;p+=4)references.push(uint(b,p,p+4));}}
    });
    if(chpl)return cb(null,{nero:chpl});
    for(var r=0;r<references.length&&!selected;r++)tracks.some(function(track){if(track.id===references[r]){selected=track;return true;}return false;});
    if(!selected)return cb(null,{status:'unavailable',chapters:[]});
    var edit=child(b,selected.box,'edts');
    if(edit){var elst=required(b,edit,'elst');if(b[elst.start]!==0||uint(b,elst.start+4,elst.start+8)!==1||uint(b,elst.start+12,elst.start+16)!==0||uint(b,elst.start+16,elst.start+20)!==65536)return cb(null,{status:'unsupportedTimeline',physicalTimeline:false,chapters:[],message:'The chapter track uses an unsupported edit timeline.  Set episode times manually.'});}
    var mdia=required(b,selected.box,'mdia'),mdhd=required(b,mdia,'mdhd'),timeOffset=mdhd.start+(b[mdhd.start]===1?20:12),scale=uint(b,timeOffset,timeOffset+4);
    if(!scale)throw new Error('Invalid chapter timescale.');
    var hdlr=required(b,mdia,'hdlr'),handler=b.toString('ascii',hdlr.start+8,hdlr.start+12);
    if(handler!=='text'&&handler!=='sbtl'&&handler!=='subt')throw new Error('Unsupported chapter text handler.');
    var minf=required(b,mdia,'minf'),stbl=required(b,minf,'stbl'),stts=table(b,required(b,stbl,'stts'),8),stsc=table(b,required(b,stbl,'stsc'),12),stsz=required(b,stbl,'stsz'),stco=child(b,stbl,'stco')||child(b,stbl,'co64');
    if(!stco)throw new Error('Missing chapter chunk offsets.');
    var uniform=uint(b,stsz.start+4,stsz.start+8),count=uint(b,stsz.start+8,stsz.start+12);
    if(count>2000||!count||(!uniform&&stsz.start+12+count*4>stsz.end))throw new Error('Invalid chapter sample count.');
    var chunkCount=uint(b,stco.start+4,stco.start+8),offsetWidth=stco.type==='co64'?8:4;
    if(chunkCount>2000||stco.start+8+chunkCount*offsetWidth>stco.end||!stsc.length||stsc[0][0]!==1)throw new Error('Invalid chapter chunk table.');
    var samples=[],sample=0,rule=0,time=0,timing=0,remaining=stts.length?stts[0][0]:0;
    for(var chunk=1;chunk<=chunkCount;chunk++){
      while(rule+1<stsc.length&&stsc[rule+1][0]<=chunk)rule++;
      var offset=uint(b,stco.start+8+(chunk-1)*offsetWidth,stco.start+8+chunk*offsetWidth),perChunk=stsc[rule][1];
      if(!perChunk||sample+perChunk>count)throw new Error('Invalid chapter sample layout.');
      for(var s=0;s<perChunk;s++){
        while(!remaining&&timing+1<stts.length){timing++;remaining=stts[timing][0];}
        if(!remaining)throw new Error('Chapter sample timing is incomplete.');
        var size=uniform||uint(b,stsz.start+12+sample*4,stsz.start+16+sample*4);
        if(size<2||size>65536)throw new Error('Invalid chapter text sample size.');
        samples.push({offset:offset,size:size,startSec:time/scale});offset+=size;time+=stts[timing][1];remaining--;sample++;
      }
    }
    if(sample!==count)throw new Error('Chapter samples are missing.');
    var groups=[];samples.forEach(function(sample){var last=groups[groups.length-1];if(last&&last.offset+last.size===sample.offset&&last.size+sample.size<=1048576){last.samples.push(sample);last.size+=sample.size;}else groups.push({offset:sample.offset,size:sample.size,samples:[sample]});});
    var at=0,chapters=[];
    function next(){
      if(at===groups.length)return cb(null,{status:'available',physicalTimeline:true,chapters:chapters});
      var group=groups[at++];read(group.offset,group.size,function(data){
        try{group.samples.forEach(function(sample){var start=sample.offset-group.offset;chapters.push({startSec:sample.startSec,endSec:null,name:decode(data.slice(start,start+sample.size)),language:''});});next();}catch(e){cb(e);}
      });
    }
    next();
  }catch(e){cb(e);}
}
module.exports={inspect:inspect};
