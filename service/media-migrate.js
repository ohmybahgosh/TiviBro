/* Legacy movie migration streams pages and keeps an original snapshot before publishing v2.
   Existing v2 files win on ID collisions; the untouched snapshot preserves ambiguous old matches.
   App credentials are never included in the small history payload.  ES5 / Node 0.12. */
'use strict';
var fs=require('fs'),path=require('path'),crypto=require('crypto'),Reader=require('./media-legacy-reader');
function hash(s){return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,32);}
function snapshot(file,destination,cb){
  fs.stat(destination,function(e){if(!e)return cb(null);if(e.code!=='ENOENT')return cb(e);
    var temporary=destination+'.'+crypto.randomBytes(8).toString('hex')+'.tmp',done=false,input=fs.createReadStream(file),output=fs.createWriteStream(temporary,{flags:'wx',mode:384});
    function fail(error){if(done)return;done=true;input.destroy();output.destroy();fs.unlink(temporary,function(){cb(error);});}
    input.on('error',fail);output.on('error',fail);output.on('finish',function(){if(done)return;fs.open(temporary,'r',function(error,fd){if(error)return fail(error);fs.fsync(fd,function(syncError){fs.close(fd,function(closeError){if(syncError||closeError)return fail(syncError||closeError);fs.rename(temporary,destination,function(renameError){if(renameError)return fail(renameError);done=true;cb(null);});});});});});input.pipe(output);
  });
}
function migrate(c,q,cb){
  c.serial(function(done){
    if(c.library.manifest.legacyMigrated)return done(null,{migrated:true,revision:c.library.manifest.revision});
    var legacy;try{legacy=require('./kv').fileOf('media:lib');}catch(e){return done(e);}
    fs.stat(legacy,function(error){
      if(error&&error.code==='ENOENT')return done(null,{migrated:false,revision:c.library.manifest.revision});if(error)return done(error);
      snapshot(legacy,path.join(c.library.root,'legacy-movies.snapshot.json'),function(snapshotError){if(snapshotError)return done(snapshotError);
        var reader=new Reader(path.join(c.library.root,'legacy-movies.snapshot.json')),pages=(c.library.manifest.pages.files||[]).slice(),page=0,seen={},count=0;
        c.library.replace(['files'],function(produce){
          if(page<pages.length)return c.library.readPage(pages[page++],function(e,rows){if(e)return produce(e);rows.forEach(function(r){seen[hash(r.id)]=true;});produce(null,'files',rows);});
          function nextLegacy(){reader.next(function(e,rows){
            if(e)return produce(e);if(!rows)return produce(null,null);
            var converted=[];
            for(var i=0;i<rows.length;i++){
              var m=rows[i];if(typeof m.id!=='string'||typeof m.src!=='string')return produce(new Error('Legacy media identity is invalid.  The original snapshot is kept.'));
              var key=hash(m.id);if(seen[key])continue;seen[key]=true;
              var file={id:m.id,handle:'file_'+key,sourceId:m.src,kind:'movie',file:m.file||m.title,title:m.title||m.file,year:m.year||'',size:m.size||0,ext:m.ext||'',info:m.info||[],ancestors:[],addedAt:m.addedAt||0,availability:'available',classification:{kind:'movie',title:m.title,review:[]}};
              if(m.path)file.path=m.path;if(m.url)file.url=m.url;
              if(m.metadata){file.metadata=JSON.parse(JSON.stringify(m.metadata));file.metadata.legacyId=file.metadata.id;if(/^tmdb:[0-9]+$/.test(file.metadata.id||''))file.metadata.id=file.metadata.id.replace('tmdb:','tmdb:movie:');file.metadata.matchOrigin='legacyUnknown';}
              converted.push(file);count++;
            }
            if(!converted.length)return nextLegacy();produce(null,'files',converted);
          });}
          nextLegacy();
        },c.library.manifest.revision,function(e){reader.close();if(e)return done(e);
          c.library.meta({legacyMigrated:true,legacyFileCount:count},c.library.manifest.revision,function(metaError,revision){done(metaError,{migrated:!metaError,revision:revision,count:count});});
        });
      });
    });
  },cb);
}
module.exports={migrate:migrate};
