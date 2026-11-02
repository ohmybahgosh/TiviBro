/* Pull one bounded page from the legacy JSON array.  UTF-8 decoding is delegated to the stream;
   braces inside strings do not delimit records.  Node 0.12-compatible backpressure. */
'use strict';
var fs=require('fs');
function Reader(file){
  var stream=fs.createReadStream(file,{encoding:'utf8',highWaterMark:65536}),chunk='',at=0,consumer=null,rows=[],started=false,closed=false,ended=false,record='',depth=0,quoted=false,escaped=false,value=true,mayClose=true,failure=null;
  stream.pause();
  function deliver(e,result){var f=consumer;consumer=null;stream.pause();if(f)f(e,result);}
  function fail(e){failure=e;stream.destroy();if(consumer)deliver(e);}
  function process(){
    if(!consumer)return;
    if(failure)return deliver(failure);
    try{
      while(at<chunk.length&&consumer){
        var c=chunk.charAt(at++);
        if(depth){
          record+=c;if(record.length>1048576)throw new Error('A legacy media record exceeds the migration limit.');
          if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
          else if(c==='"')quoted=true;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']')depth--;
          if(!depth){var parsed=JSON.parse(record);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid legacy media record.');rows.push(parsed);record='';value=false;if(rows.length===256){var batch=rows;rows=[];return deliver(null,batch);}}
          continue;
        }
        if(/\s/.test(c))continue;
        if(!started){if(c!=='[')throw new Error('Legacy library is not an array.');started=true;continue;}
        if(closed)throw new Error('Unexpected data after the legacy library.');
        if(value){if(c===']'&&mayClose){closed=true;continue;}if(c!=='{')throw new Error('Invalid legacy library entry.');record='{';depth=1;quoted=false;escaped=false;}
        else if(c===','){value=true;mayClose=false;}else if(c===']')closed=true;else throw new Error('Invalid legacy library separator.');
      }
      if(!consumer)return;
      chunk='';at=0;
      if(ended){if(!closed||depth)throw new Error('Legacy library was truncated.');if(rows.length){var last=rows;rows=[];return deliver(null,last);}return deliver(null,null);}
      stream.resume();
    }catch(e){fail(e);}
  }
  stream.on('data',function(data){stream.pause();chunk=data;at=0;process();});
  stream.on('end',function(){ended=true;process();});stream.on('error',fail);
  this.next=function(cb){if(consumer)return cb(new Error('A migration read is already pending.'));consumer=cb;process();};
  this.close=function(){stream.destroy();};
}
module.exports=Reader;
