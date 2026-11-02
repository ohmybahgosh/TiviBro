/* Strict binary Range transport for already-authorised media sessions.  Never follows redirects
   with source credentials and never accepts a full video body as a chapter response.  ES5. */
'use strict';
var http=require('http'),https=require('https'),URL_=require('url'),Chapters=require('./media-chapters');
function inspect(url,size,ext,cb) {
  var end=Date.now()+10000;
  function read(offset,length,next) {
    var u=URL_.parse(url),finished=false,request;
    function done(e,b) {if(finished)return;finished=true;next(e,b);}
    if(u.protocol!=='http:' && u.protocol!=='https:')return done(new Error('Unsupported media address.'));
    request=(u.protocol==='https:'?https:http).get({hostname:u.hostname,port:u.port,path:u.path,headers:{Range:'bytes='+offset+'-'+(offset+length-1)},agent:false},function(res){
      var match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers['content-range'] || '');
      if(res.statusCode!==206 || !match || +match[1]!==offset || +match[2]!==offset+length-1){res.destroy();return done(new Error('This server cannot provide bounded chapter ranges.'));}
      var chunks=[],bytes=0;
      res.on('data',function(b){bytes+=b.length;if(bytes>length){res.destroy();done(new Error('Chapter response exceeded its range.'));}else chunks.push(b);});
      res.on('end',function(){if(bytes!==length)return done(new Error('Truncated chapter range.'));done(null,Buffer.concat(chunks));});
      res.on('error',done);
    });
    request.on('error',function(){done(new Error('Could not read chapters from this source.'));});
    request.setTimeout(Math.max(1,Math.min(8000,end-Date.now())),function(){done(new Error('Chapter request timed out.'));request.abort();});
  }
  if(!(size>0))return cb(new Error('File size is not known.  Set episode starts manually.'));
  Chapters.inspect(read,size,ext,cb);
}
module.exports={inspect:inspect};
