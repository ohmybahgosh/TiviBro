/* Durable v2 library pages.  Immutable pages become visible only after an atomic manifest commit.
   This storage primitive does not migrate legacy data or expose routes until those adapters exist.
   ES5 callbacks for Node 0.12.  Callers submit bounded batches; queries read one page at a time. */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto');
var FAMILIES = ['sources', 'files', 'shows', 'episodes', 'memberships', 'overrides', 'progress', 'metadata'];
function Library(root) { this.root = root; this.manifest = null; this.busy = false; this.cache = {}; this.cacheBytes = 0; this.readers = {}; this.cleanupTimer = null; }
function failure(code, message) { var e = new Error(message); e.code = code; return e; }
function commandMarker(library,next){
  var command=library.command;if(!command)return;
  next.commands=next.commands||{};next.commands['c_'+command.key]={hash:command.hash,revision:next.revision,at:Date.now(),extra:command.extra||null};
  var keys=Object.keys(next.commands).sort(function(a,b){return next.commands[a].at-next.commands[b].at;});while(keys.length>64)delete next.commands[keys.shift()];
}
function valid(m) { return m && m.schema === 2 && typeof m.revision === 'number' && m.pages && typeof m.pages === 'object'; }
Library.prototype.open = function (cb) {
  var self = this;
  fs.mkdir(self.root, function (e) {
    if (e && e.code !== 'EEXIST') return cb(e);
    function load(name, done) {
      fs.readFile(path.join(self.root, name), 'utf8', function (err, body) {
        var m;
        if (err) return done(err);
        try { m = JSON.parse(body); } catch (ex) { return done(ex); }
        if (!valid(m)) return done(failure('CORRUPT_LIBRARY', 'Invalid library manifest.'));
        var pages = [], family;
        for (family in m.pages) {
          if (FAMILIES.indexOf(family) < 0 || !Array.isArray(m.pages[family])) return done(failure('CORRUPT_LIBRARY', 'Invalid page family.'));
          pages = pages.concat(m.pages[family]);
        }
        var at = 0;
        function next(err2) {
          if (err2) return done(err2);
          if (at === pages.length) return done(null, m);
          self.readPage(pages[at++], function (err3) { next(err3); });
        }
        next();
      });
    }
    load('manifest.json', function (err, m) {
      if (!err) { self.manifest = m; return cb(null, self); }
      load('previous.json', function (oldErr, old) {
        if (!oldErr) { self.manifest = old; return cb(null, self); }
        // Only genuinely fresh storage may become an empty library.
        if (err.code !== 'ENOENT' || oldErr.code !== 'ENOENT') return cb(failure('CORRUPT_LIBRARY', 'No valid library generation could be recovered.'));
        self.manifest = { schema: 2, revision: 0, pages: {} }; cb(null, self);
      });
    });
  });
};
function pageIndex(rows){
  var sources={},shows={},kinds={},buckets={},fingerprints={},bloom=[];for(var bi=0;bi<8;bi++)bloom.push(0);
  function mark(id){if(typeof id!=='string')return;var hash=0;for(var i=0;i<id.length;i++)hash=(hash*31+id.charCodeAt(i))|0;fingerprints[String(hash&65535)]=true;var bit=(hash>>>0)%256;bloom[bit>>>5]=(bloom[bit>>>5]|(1<<(bit&31)))>>>0;}
  var review=false,missing=false;
  rows.forEach(function(r){if(r.availability==='missing')missing=true;if(r.sourceId)sources[r.sourceId]=true;(r.sourceIds||[]).forEach(function(id){sources[id]=true;});if(r.showId)shows[r.showId]=true;if(r.kind==='show')shows[r.id]=true;if(r.kind)kinds[r.kind]=true;if(r.season!=null)buckets[String(r.season)]=true;if(r.airDate)buckets[r.airDate.slice(0,4)]=true;if(r.order==='absolute')buckets.Episodes=true;if(r.classification&&r.classification.review.length)review=true;mark(r.id);mark(r.handle);});
  return {sources:Object.keys(sources),shows:Object.keys(shows),kinds:Object.keys(kinds),buckets:Object.keys(buckets),review:review,missing:missing,bloom:bloom,fingerprints:Object.keys(fingerprints).map(function(k){return +k;})};
}
function mayContain(descriptor,id){if(!descriptor.index||!descriptor.index.bloom)return true;var hash=0;for(var i=0;i<id.length;i++)hash=(hash*31+id.charCodeAt(i))|0;if(descriptor.index.fingerprints)return descriptor.index.fingerprints.indexOf(hash&65535)>=0;var bit=(hash>>>0)%256;return !!(descriptor.index.bloom[bit>>>5]&(1<<(bit&31)));}
Library.prototype.readPage = function (descriptor, cb) {
  var self=this;
  if (!descriptor || !/^[a-f0-9]{32}\.json$/.test(descriptor.name) || !/^[a-f0-9]{64}$/.test(descriptor.hash||'') || descriptor.count < 0 || descriptor.count > 256 || Math.floor(descriptor.count)!==descriptor.count) return cb(failure('CORRUPT_LIBRARY', 'Invalid page descriptor.'));
  function decode(data){var rows;try{rows=JSON.parse(data.toString('utf8'));}catch(e){return cb(e);}if(!Array.isArray(rows)||rows.length!==descriptor.count)return cb(failure('CORRUPT_LIBRARY','Invalid page row count.'));cb(null,rows);}
  var cached=self.cache[descriptor.name];
  if(cached&&cached.hash===descriptor.hash){cached.used=Date.now();return setImmediate(function(){decode(cached.data);});}
  var file=path.join(self.root,descriptor.name);
  fs.stat(file,function(statError,stat){
    if(statError)return cb(statError);if(stat.size>1048576)return cb(failure('CORRUPT_LIBRARY','Invalid library page size.'));
    fs.readFile(file,function(e,data){
      if(e)return cb(e);if(data.length>1048576||crypto.createHash('sha256').update(data).digest('hex')!==descriptor.hash)return cb(failure('CORRUPT_LIBRARY','Invalid library page.'));
      if(self.cache[descriptor.name])self.cacheBytes-=self.cache[descriptor.name].data.length;
      self.cache[descriptor.name]={hash:descriptor.hash,data:data,used:Date.now()};self.cacheBytes+=data.length;
      var keys=Object.keys(self.cache).sort(function(a,b){return self.cache[a].used-self.cache[b].used;});
      while(self.cacheBytes>8388608&&keys.length){var key=keys.shift();self.cacheBytes-=self.cache[key].data.length;delete self.cache[key];}
      decode(data);
    });
  });
};

function atomic(root, name, body, cb) {
  var temporary = path.join(root, crypto.randomBytes(16).toString('hex') + '.tmp');
  fs.open(temporary, 'wx', function (e, fd) {
    if (e) return cb(e);
    var data = new Buffer(body, 'utf8'), offset = 0;
    function finish(err) {
      fs.close(fd, function (closeErr) {
        if (err || closeErr) return fs.unlink(temporary, function () { cb(err || closeErr); });
        fs.rename(temporary, path.join(root, name), function (renameErr) {
          if (renameErr) return fs.unlink(temporary, function () { cb(renameErr); });
          cb(null);
        });
      });
    }
    function write() {
      fs.write(fd, data, offset, data.length - offset, offset, function (err, written) {
        if (err) return finish(err);
        if (!written) return finish(failure('WRITE_FAILED', 'Library write made no progress.'));
        offset += written;
        if (offset < data.length) return write();
        fs.fsync(fd, finish);
      });
    }
    write();
  });
}
// Append immutable pages to a family; replacement/overlay/index layers build on this primitive.
Library.prototype.append = function (family, rows, expectedRevision, cb) {
  var self = this;
  if (!self.manifest) return cb(failure('NOT_OPEN', 'Open the library first.'));
  if (self.busy || self.manifest.revision !== expectedRevision) return cb(failure('CONFLICT', 'The library changed.'));
  if (FAMILIES.indexOf(family) < 0 || !Array.isArray(rows) || !rows.length || rows.length > 256) return cb(failure('INVALID_BATCH', 'Use a supported family and 1 to 256 rows.'));
  var body;
  try { body = JSON.stringify(rows); } catch (e) { return cb(e); }
  if (Buffer.byteLength(body, 'utf8') > 1048576) return cb(failure('INVALID_BATCH', 'Library page is too large.'));
  var next = JSON.parse(JSON.stringify(self.manifest)), name = crypto.randomBytes(16).toString('hex') + '.json';
  var descriptor = { name: name, count: rows.length, hash: crypto.createHash('sha256').update(body, 'utf8').digest('hex'), index:pageIndex(rows) };
  if (!next.pages[family]) next.pages[family] = [];
  next.pages[family].push(descriptor); next.revision++;commandMarker(self,next);
  self.busy = true;
  function done(err) { self.busy = false; if (!err) {self.manifest = next;self.cleanupSoon();} cb(err, err ? null : next.revision); }
  atomic(self.root, name, body, function (err) {
    if (err) return done(err);
    atomic(self.root, 'previous.json', JSON.stringify(self.manifest), function (oldErr) {
      if (oldErr) return done(oldErr);
      atomic(self.root, 'manifest.json', JSON.stringify(next), done);
    });
  });
};
Library.prototype.query = function (family, options, cb) {
  var self = this, opts = options || {}, snapshot = self.manifest;
  if (!snapshot) return cb(failure('NOT_OPEN', 'Open the library first.'));
  if (FAMILIES.indexOf(family) < 0) return cb(failure('INVALID_QUERY', 'Unknown library family.'));
  var revision = snapshot.revision, cursor = opts.cursor || { page: 0, row: 0, revision: revision, family: family };
  if (cursor.revision !== revision || cursor.family !== family) return cb(failure('STALE_CURSOR', 'Reload this list.'));
  if (cursor.page < 0 || cursor.row < 0 || Math.floor(cursor.page) !== cursor.page || Math.floor(cursor.row) !== cursor.row) return cb(failure('INVALID_QUERY', 'Invalid cursor.'));
  var pages = snapshot.pages[family] || [], limit = Math.max(1, Math.min(200, Math.floor(+opts.limit || 60))), output = [], page = cursor.page, row = cursor.row;
  function next() {
    if (page >= pages.length) return cb(null, { items: output, nextCursor: null, revision: revision });
    self.readPage(pages[page], function (err, rows) {
      if (err) return cb(err);
      while (row < rows.length && output.length < limit) output.push(rows[row++]);
      if (row >= rows.length) { page++; row = 0; }
      if (output.length === limit) return cb(null, { items: output, revision: revision, nextCursor: page < pages.length ? { page: page, row: row, revision: revision, family: family } : null });
      next();
    });
  }
  next();
};
// Replace several families in one generation.  The producer supplies one bounded page per call,
// allowing migrations/scanners to stream records without building a browser-sized JSON catalogue.
Library.prototype.replace = function (families, producer, expectedRevision, cb) {
  var self = this;
  if (!self.manifest) return cb(failure('NOT_OPEN', 'Open the library first.'));
  if (self.busy || self.manifest.revision !== expectedRevision) return cb(failure('CONFLICT', 'The library changed.'));
  if (!Array.isArray(families) || !families.length || families.some(function (f) { return FAMILIES.indexOf(f) < 0; })) return cb(failure('INVALID_BATCH', 'Unknown record family.'));
  var next = JSON.parse(JSON.stringify(self.manifest)), ended = false;
  families.forEach(function (f) { next.pages[f] = []; });
  next.revision++;commandMarker(self,next); self.busy = true;
  function done(err) { if (ended) return; ended = true; self.busy = false; if (!err) {self.manifest = next;self.cleanupSoon();} cb(err, err ? null : next.revision); }
  function step() {
    try { producer(function (err, family, rows) {
      if (err) return done(err);
      if (!family) return atomic(self.root, 'previous.json', JSON.stringify(self.manifest), function (e) { if (e) return done(e); atomic(self.root, 'manifest.json', JSON.stringify(next), done); });
      if (families.indexOf(family) < 0 || !Array.isArray(rows) || !rows.length || rows.length > 256) return done(failure('INVALID_BATCH', 'Invalid replacement page.'));
      var body;
      try { body = JSON.stringify(rows); } catch (e2) { return done(e2); }
      if (Buffer.byteLength(body, 'utf8') > 1048576) return done(failure('INVALID_BATCH', 'Library page is too large.'));
      var name = crypto.randomBytes(16).toString('hex') + '.json';
      var descriptor = { name: name, count: rows.length, hash: crypto.createHash('sha256').update(body, 'utf8').digest('hex'), index:pageIndex(rows) };
      atomic(self.root, name, body, function (e3) { if (e3) return done(e3); next.pages[family].push(descriptor); step(); });
    }); } catch (err) { done(err); }
  }
  step();
};
Library.prototype.each = function (family, visit, cb, snapshot, filter) {
  var self = this, manifest = snapshot || self.manifest, pages = manifest && manifest.pages[family] || [], at = 0, release=self.retain(manifest),finished=false;
  function finish(error){if(finished)return;finished=true;release();cb(error);}
  function next(err) {
    if (err) return finish(err);
    if (at === pages.length) return finish(null);
    var descriptor=pages[at++];if(filter&&!filter(descriptor))return setImmediate(next);
    self.readPage(descriptor, function (e, rows) { if (e) return finish(e); visit(rows, next); });
  }
  next();
};
Library.prototype.patch=function(changes,expectedRevision,cb){
  var self=this;if(self.busy||!self.manifest||self.manifest.revision!==expectedRevision)return cb(failure('CONFLICT','The library changed.'));
  if(!Array.isArray(changes)||!changes.length||changes.length>2000)return cb(failure('INVALID_BATCH','Use 1 to 2,000 record changes.'));
  var next=JSON.parse(JSON.stringify(self.manifest)),byFamily={},families=[],familyAt=0;
  for(var ci=0;ci<changes.length;ci++){var change=changes[ci];if(FAMILIES.indexOf(change.family)<0||typeof change.id!=='string'||typeof change.update!=='function')return cb(failure('INVALID_BATCH','Invalid record change.'));if(!byFamily[change.family]){byFamily[change.family]={};families.push(change.family);}byFamily[change.family][change.id]=change;}
  self.busy=true;
  function finish(error){self.busy=false;if(!error){self.manifest=next;self.cleanupSoon();}cb(error,error?null:next.revision);}
  function writeRows(rows,descriptors,done){
    if(!rows.length)return done();var batch=[],bytes=2;
    while(rows.length&&batch.length<256){var row=rows[0],size=Buffer.byteLength(JSON.stringify(row),'utf8')+1;if(size+2>1048576)return done(failure('INVALID_BATCH','A record exceeds the storage page limit.'));if(batch.length&&bytes+size>1048576)break;batch.push(rows.shift());bytes+=size;}
    var body=JSON.stringify(batch),name=crypto.randomBytes(16).toString('hex')+'.json',descriptor={name:name,count:batch.length,hash:crypto.createHash('sha256').update(body,'utf8').digest('hex'),index:pageIndex(batch)};
    atomic(self.root,name,body,function(e){if(e)return done(e);descriptors.push(descriptor);writeRows(rows,descriptors,done);});
  }
  function family(){
    if(familyAt===families.length){next.revision++;commandMarker(self,next);return atomic(self.root,'previous.json',JSON.stringify(self.manifest),function(e){if(e)return finish(e);atomic(self.root,'manifest.json',JSON.stringify(next),finish);});}
    var name=families[familyAt++],pending=byFamily[name],ids=Object.keys(pending),pages=self.manifest.pages[name]||[],page=0,out=[];
    function step(){
      if(page===pages.length){if(Object.keys(pending).length)return finish(failure('MISSING_RECORD','A record no longer exists.'));next.pages[name]=out;return family();}
      var descriptor=pages[page++];if(!ids.some(function(id){return pending[id]&&mayContain(descriptor,id);})){out.push(descriptor);return setImmediate(step);}
      self.readPage(descriptor,function(e,rows){if(e)return finish(e);var changed=false;
        try{rows.forEach(function(row){var update=pending[row.id]||pending[row.handle];if(!update)return;update.update(row);delete pending[update.id];changed=true;});}catch(error){return finish(error);}
        if(!changed){out.push(descriptor);return step();}writeRows(rows,out,function(error){if(error)return finish(error);step();});
      });
    }
    step();
  }
  family();
};
Library.prototype.meta=function(patch,expectedRevision,cb){
  var self=this;if(self.busy||!self.manifest||self.manifest.revision!==expectedRevision)return cb(failure('CONFLICT','The library changed.'));
  var next=JSON.parse(JSON.stringify(self.manifest));Object.keys(patch).forEach(function(k){if(k!=='schema'&&k!=='pages'&&k!=='revision')next[k]=patch[k];});next.revision++;commandMarker(self,next);
  self.busy=true;atomic(self.root,'previous.json',JSON.stringify(self.manifest),function(e){if(e){self.busy=false;return cb(e);}atomic(self.root,'manifest.json',JSON.stringify(next),function(error){self.busy=false;if(!error){self.manifest=next;self.cleanupSoon();}cb(error,next.revision);});});
};
Library.prototype.retain=function(manifest){
  var self=this;if(!manifest)return function(){};var key=String(manifest.revision),entry=self.readers[key];if(!entry)entry=self.readers[key]={manifest:manifest,count:0};entry.count++;var done=false;return function(){if(done)return;done=true;entry.count--;if(!entry.count)delete self.readers[key];};
};
Library.prototype.cleanupSoon=function(){
  var self=this;if(self.cleanupTimer)return;self.cleanupTimer=setTimeout(function(){self.cleanupTimer=null;self.collect(function(){});},60000);if(self.cleanupTimer.unref)self.cleanupTimer.unref();
};
Library.prototype.collect=function(grace,cb){
  if(typeof grace==='function'){cb=grace;grace=null;}
  var self=this;if(self.busy||!self.manifest)return cb(null);var keep={},cutoff=Date.now()-(grace==null?120000:grace);
  function protect(manifest){Object.keys(manifest.pages||{}).forEach(function(family){manifest.pages[family].forEach(function(page){keep[page.name]=true;});});}
  protect(self.manifest);Object.keys(self.readers).forEach(function(key){protect(self.readers[key].manifest);});
  fs.readFile(path.join(self.root,'previous.json'),'utf8',function(e,body){
    if(e&&e.code!=='ENOENT')return cb(e);if(!e){var previous;try{previous=JSON.parse(body);}catch(parseError){return cb(parseError);}if(!valid(previous))return cb(new Error('Previous manifest is not valid.'));protect(previous);}
    fs.readdir(self.root,function(error,names){if(error)return cb(error);var at=0;
      function next(){
        if(self.busy)return cb(null);if(at===names.length)return cb(null);var name=names[at++];
        if(keep[name]||!(/^[a-f0-9]{32}\.json$/.test(name)||/\.tmp$/.test(name)))return setImmediate(next);
        fs.stat(path.join(self.root,name),function(statError,stat){if(statError)return statError.code==='ENOENT'?next():cb(statError);if(stat.mtime.getTime()>=cutoff)return next();fs.unlink(path.join(self.root,name),function(unlinkError){if(unlinkError&&unlinkError.code!=='ENOENT')return cb(unlinkError);if(self.cache[name]){self.cacheBytes-=self.cache[name].data.length;delete self.cache[name];}next();});});
      }
      next();
    });
  });
};
Library.atomic = atomic;
Library.mayContain = mayContain;
module.exports = Library;
