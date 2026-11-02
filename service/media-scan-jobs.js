/* Resumable scan checkpoints belong to private persistent storage, never public API responses.
   Only a hash of connection configuration is kept; source credentials stay in the app.  ES5. */
'use strict';
var fs=require('fs'),path=require('path'),crypto=require('crypto'),Library=require('./media-library');
function fingerprint(source){var clean={};['type','address','control','user','pass','contentMode','maxDepth'].forEach(function(k){clean[k]=source[k]||'';});return crypto.createHash('sha256').update(JSON.stringify(clean)).digest('hex');}
function root(){return require('./kv').sub('media-scan-jobs');}
function name(id){return 'scan_'+crypto.createHash('sha256').update(String(id)).digest('hex')+'.json';}
function prepare(source,restart,cb){
  if(!source||!source.id)return cb(null,source);
  var file;try{file=path.join(root(),name(source.id));}catch(e){return cb(e);}
  if(restart)return fs.unlink(file,function(){cb(null,source);});
  fs.readFile(file,'utf8',function(e,body){
    if(e&&e.code!=='ENOENT')return cb(e);
    if(e)return cb(null,source);
    var job;try{job=JSON.parse(body);}catch(error){return cb(new Error('The saved scan checkpoint is unreadable.  Restart this scan.'));}
    if(job.version!==2||job.fingerprint!==fingerprint(source))return cb(null,source);
    var next={};Object.keys(source).forEach(function(k){next[k]=source[k];});next._continuation=job.state;cb(null,next);
  });
}
function save(source,state,cb){
  if(!source||!source.id)return cb(null);
  var directory;try{directory=root();}catch(e){return cb(e);}
  if(!state)return fs.unlink(path.join(directory,name(source.id)),function(e){cb(e&&e.code!=='ENOENT'?e:null);});
  Library.atomic(directory,name(source.id),JSON.stringify({version:2,fingerprint:fingerprint(source),state:state,at:Date.now()}),cb);
}
module.exports={prepare:prepare,save:save};
