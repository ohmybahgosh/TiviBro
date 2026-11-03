/* Bounded physical chapter readers.  MKV simple editions and MP4 Nero chpl markers are independent
   of subtitle extraction.  Unknown virtual timelines never become invented episode boundaries.
   ES5 / Node 0.12; readers consume bounded buffers provided by an authenticated Range session. */
'use strict';
function uint(b,a,z) { var v=0; for (var i=a;i<z;i++) { v=v*256+b[i]; if (v>9007199254740991) throw new Error('Chapter integer is too large.'); } return v; }
function number(b,p,keep) {
  if (p>=b.length || !b[p]) throw new Error('Invalid EBML integer.');
  var len=1,mask=128; while (!(b[p]&mask)) {len++;mask>>=1;}
  if (len>8 || p+len>b.length) throw new Error('Truncated EBML integer.');
  var v=keep?b[p]:b[p]&(mask-1), unknown=!keep && v===mask-1;
  for(var i=1;i<len;i++) { v=v*256+b[p+i]; unknown=unknown && b[p+i]===255; }
  if (!unknown && v>9007199254740991) throw new Error('EBML size is too large.');
  return {value:v,next:p+len,unknown:unknown};
}
function element(b,p) { var id=number(b,p,true),size=number(b,id.next,false); return {id:id.value,start:size.next,end:size.unknown?b.length:size.next+size.value,unknown:size.unknown}; }
function children(b,a,z,visit,depth) {
  if (depth>16 || z>b.length) throw new Error('Invalid chapter nesting or bounds.');
  while(a<z) { var e=element(b,a); if(e.end>z || e.end<=a) throw new Error('Truncated chapter element.'); visit(e,depth); a=e.end; }
}
function mkv(b) {
  var editions=[], count=0;
  function edition(e) {
    var out={ordered:false,defaultEdition:false,linked:false,chapters:[]};
    function atom(el,depth) {
      var chapter={startSec:null,endSec:null,name:'',language:''}, nested=[];
      children(b,el.start,el.end,function(c) {
        if(c.id===0x91) chapter.startSec=uint(b,c.start,c.end)/1e9;
        if(c.id===0x92) chapter.endSec=uint(b,c.start,c.end)/1e9;
        if(c.id===0x6e67 || c.id===0x6ebc) out.linked=true;
        if(c.id===0x80) children(b,c.start,c.end,function(d) {
          if(d.id===0x85 && !chapter.name) chapter.name=b.toString('utf8',d.start,d.end).slice(0,512);
          if(d.id===0x437c) chapter.language=b.toString('ascii',d.start,d.end).slice(0,32);
        },depth+1);
        if(c.id===0xb6) nested.push(c);
      },depth);
      if(chapter.startSec!=null) { count++; if(count>2000) throw new Error('Too many chapters.'); out.chapters.push(chapter); }
      nested.forEach(function(c) {atom(c,depth+1);});
    }
    children(b,e.start,e.end,function(c) {
      if(c.id===0x45db) out.defaultEdition=!!uint(b,c.start,c.end);
      if(c.id===0x45dd) out.ordered=!!uint(b,c.start,c.end);
      if(c.id===0xb6) atom(c,1);
    },0); editions.push(out);
  }
  var top=element(b,0);
  if(top.id!==0x1043a770) throw new Error('Expected Matroska Chapters.');
  children(b,top.start,top.end,function(e) {if(e.id===0x45b9) edition(e);},0);
  var selected=null; editions.some(function(e) {if(e.defaultEdition) {selected=e;return true;}return false;}); selected=selected||editions[0];
  if(!selected) return {status:'unavailable',chapters:[]};
  if(selected.ordered || selected.linked) return {status:'unsupportedTimeline',physicalTimeline:false,chapters:[],message:'This edition uses a virtual timeline.  Set episode times manually.'};
  return {status:'available',physicalTimeline:true,chapters:selected.chapters};
}
function chpl(b) {
  if(b.length<9) throw new Error('Truncated MP4 chapter list.');
  var version=b[0],count,p;
  if(version===1) {count=uint(b,5,9);p=9;}
  else if(version===0) {count=b[4];p=5;}
  else throw new Error('Unsupported MP4 chapter version.');
  if(count>2000) throw new Error('Too many chapters.');
  var chapters=[];
  for(var i=0;i<count;i++) {
    if(p+9>b.length) throw new Error('Truncated MP4 chapter.');
    var start=uint(b,p,p+8)/1e7,len=b[p+8];p+=9;
    if(p+len>b.length) throw new Error('Truncated MP4 chapter title.');
    chapters.push({startSec:start,endSec:null,name:b.toString('utf8',p,p+len),language:''});p+=len;
  }
  return {status:'available',physicalTimeline:true,chapters:chapters};
}
function validate(r,duration) {
  var previous=-1;
  r.forEach(function(c) {
    if(!isFinite(c.startSec) || c.startSec<0 || c.startSec<=previous || (duration>0 && c.startSec>=duration)) throw new Error('Episode starts must increase within the file.');
    if(c.endSec!=null && (!isFinite(c.endSec) || c.endSec<=c.startSec || (duration>0 && c.endSec>duration))) throw new Error('Invalid episode end.');
    previous=c.startSec;
  });
  r.forEach(function(c,i) { if(i+1<r.length && c.endSec!=null && c.endSec>r[i+1].startSec) throw new Error('Episode ranges overlap.'); });
  return r;
}
// read(offset,length,callback) is supplied by the source resolver, never by a public caller.
function inspect(read,size,ext,cb) {
  var bytes=0,requests=0,deadline=Date.now()+10000,done=false;
  function finish(e,r) {if(done)return;done=true;cb(e,r);}
  function range(offset,length,next) {
    length=Math.min(length,size-offset);
    if(done)return;
    if(offset<0 || length<=0 || length>1048576 || ++requests>32 || (bytes+=length)>8388608 || Date.now()>deadline) return finish(new Error('Chapter inspection limit reached.'));
    read(offset,length,function(e,b) {if(done)return;if(e)return finish(e);if(!b || b.length!==length)return finish(new Error('Invalid chapter Range response.'));next(b);});
  }
  function block(offset,length,next){
    if(length<=1048576)return range(offset,length,next);
    if(length>8388608)return finish(new Error('Chapter metadata exceeds the inspection budget.'));
    var chunks=[],readBytes=0;
    function part(){if(readBytes===length)return next(Buffer.concat(chunks));var n=Math.min(1048576,length-readBytes);range(offset+readBytes,n,function(b){chunks.push(b);readBytes+=b.length;part();});}part();
  }
  function mkvAt(offset) {
    range(offset,Math.min(16,size-offset),function(header) {
      var e;try {e=element(header,0);}catch(err){return finish(err);}
      var total=e.end;
      if(e.id!==0x1043a770 || e.unknown || total>1048576)return finish(new Error('Invalid Matroska chapter index.'));
      range(offset,total,function(b){try{finish(null,mkv(b));}catch(err){finish(err);}});
    });
  }
  if(ext==='mkv') return range(0,Math.min(262144,size),function(head) {
    try {
      var p=0,segment=null;
      while(p<head.length) {var e=element(head,p);if(e.id===0x18538067){segment=e;break;}if(e.end>head.length)break;p=e.end;}
      if(!segment)return finish(null,{status:'unavailable',chapters:[]});
      p=segment.start;
      while(p<head.length) {
        var child=element(head,p);
        if(child.id===0x1043a770)return mkvAt(p);
        if(child.id===0x114d9b74 && child.end<=head.length) {
          var chapterOffset=null;
          children(head,child.start,child.end,function(seek) {
            if(seek.id!==0x4dbb)return;var id=null,offset=null;
            children(head,seek.start,seek.end,function(field){if(field.id===0x53ab)id=uint(head,field.start,field.end);if(field.id===0x53ac)offset=uint(head,field.start,field.end);},0);
            if(id===0x1043a770)chapterOffset=offset;
          },0);
          if(chapterOffset!=null)return mkvAt(segment.start+chapterOffset);
        }
        if(child.end>head.length || child.end<=p)break;p=child.end;
      }
      finish(null,{status:'unavailable',chapters:[]});
    }catch(err){finish(err);}
  });
  if(ext!=='mp4' && ext!=='m4v') return finish(null,{status:'unavailable',chapters:[]});
  var found=false;
  function atoms(offset,end,depth,next) {
    if(depth>16)return finish(new Error('MP4 chapter nesting limit reached.'));
    if(offset>=end)return next();
    range(offset,Math.min(16,end-offset),function(header) {
      try {
        if(header.length<8)throw new Error('Truncated MP4 atom.');
        var length=uint(header,0,4),type=header.toString('ascii',4,8),start=offset+8;
        if(length===1){if(header.length<16)throw new Error('Truncated extended MP4 atom.');length=uint(header,8,16);start=offset+16;}
        if(!length)length=end-offset;
        if(length<start-offset || offset+length>end)throw new Error('Invalid MP4 atom size.');
        var advance=function(){if(!found)atoms(offset+length,end,depth,next);};
        if(type==='chpl') return range(start,offset+length-start,function(b){try{found=true;finish(null,chpl(b));}catch(e){finish(e);}});
        if(type==='moov')return block(start,offset+length-start,function(body){require('./media-quicktime-chapters').inspect(body,range,function(error,result){if(error)return finish(error);if(result.nero){try{return finish(null,chpl(result.nero));}catch(parseError){return finish(parseError);}}finish(null,result);});});
        if(type==='udta')return atoms(start,offset+length,depth+1,advance);
        advance();
      }catch(e){finish(e);}
    });
  }
  atoms(0,size,0,function(){finish(null,{status:'unavailable',chapters:[]});});
}
module.exports={mkv:mkv,chpl:chpl,inspect:inspect,validate:validate};
