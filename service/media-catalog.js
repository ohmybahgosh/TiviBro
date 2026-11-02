/* Helper-owned My media catalogue.  Private file locators are never part of public projections.
   Source scans merge against existing records and immutable pages publish in one generation.
   ES5 / Node 0.12. */
'use strict';
var Library = require('./media-library'), crypto = require('crypto'), Classifier = require('./media-classify');
function hash(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 32); }
function Catalog(root) { this.library = new Library(root); this.jobs = []; this.working = false; }
Catalog.prototype.open = function (cb) { var self = this; self.library.open(function (e) { cb(e, self); }); };
Catalog.prototype.serial = function (run, cb) {
  var self = this; self.jobs.push({ run: run, cb: cb });
  function next() {
    if (self.working || !self.jobs.length) return;
    self.working = true; var job = self.jobs.shift();self.library.command=job.cb.command||null;
    job.run(function (e, result) { self.working = false;self.library.command=null; job.cb(e, result); next(); });
  }
  next();
};
Catalog.prototype.records = function (family, cb, snapshot) {
  var result = [];
  this.library.each(family, function (rows, next) { result = result.concat(rows); next(); }, function (e) { cb(e, result); },snapshot);
};
Catalog.prototype.write = function (families, cb) {
  var names = Object.keys(families), at = 0, row = 0, self = this;
  self.library.replace(names, function (give) {
    while (at < names.length && row >= families[names[at]].length) { at++; row = 0; }
    if (at === names.length) return give(null, null);
    var family = names[at], rows = [], bytes = 2;
    while(row<families[family].length && rows.length<256){var record=families[family][row],size=Buffer.byteLength(JSON.stringify(record),'utf8')+1;if(size+2>1048576)return give(new Error('A media record exceeds the storage page limit.'));if(rows.length && bytes+size>1048576)break;rows.push(record);bytes+=size;row++;}
    give(null, family, rows);
  }, self.library.manifest.revision, cb);
};
function showKey(file) {
  var c = file.classification || {}, ancestors = file.ancestors || [], anchor = '';
  // A show folder is stronger evidence than a normalised title; flat files use the parsed title.
  ancestors.some(function (name,index) { if (String(name).toLowerCase() === String(c.showTitle).toLowerCase()) { anchor = JSON.stringify(ancestors.slice(0,index+1)); return true; } return false; });
  return file.sourceId + '|' + (anchor || c.showTitle || '').toLowerCase();
}
function coordinates(c) {
  if (c.order === 'date') return [c.airDate];
  if (c.order === 'absolute') return [String(c.absoluteNumber) + (c.absolutePart ? '.' + c.absolutePart : '')];
  return (c.numbers || []).map(function (n) { return String(c.season) + ':' + n; });
}
function derive(files, previousShows, previousEpisodes) {
  var shows = {}, episodes = {}, oldShows = {}, oldEpisodes = {}, coordinateIds = {}, oldByFile = {};
  previousShows.forEach(function (s) { oldShows[s.id] = s; }); previousEpisodes.forEach(function (e) { oldEpisodes[e.id] = e;
    var coordinate=e.order==='date'?e.airDate:e.order==='absolute'?String(e.absoluteNumber)+(e.absolutePart?'.'+e.absolutePart:''):String(e.season)+':'+e.number;
    coordinateIds[e.showId+'|'+e.order+'|'+coordinate]=e.id;
    e.fileIds.forEach(function(id){if(!oldByFile[id])oldByFile[id]=[];oldByFile[id].push(e);});
  });
  oldByFile={};Object.keys(oldEpisodes).forEach(function(id){var ep=oldEpisodes[id];ep.fileIds.forEach(function(fid){if(!oldByFile[fid])oldByFile[fid]=[];oldByFile[fid].push(ep);});});
  var anchored={},cohorts={},persistent={};
  files.forEach(function(f){var c=f.classification||{};if(f.kind!=='episode'||!c.showTitle||(c.review||[]).length)return;var key=showKey(f);f.groupKey=key;if(key.indexOf('|[')>=0){var titleKey=f.sourceId+'|'+c.showTitle.toLowerCase();if(!anchored[titleKey])anchored[titleKey]=[];if(anchored[titleKey].indexOf(key)<0)anchored[titleKey].push(key);}});
  files.forEach(function(f){var c=f.classification||{},key=f.groupKey;if(!key)return;var candidates=anchored[f.sourceId+'|'+String(c.showTitle).toLowerCase()]||[];if(key.indexOf('|[')<0&&candidates.length===1)key=f.groupKey=candidates[0];var previous=oldByFile[f.id]&&oldByFile[f.id][0];if(previous&&!f.showOverride){if(!cohorts[previous.showId])cohorts[previous.showId]={};cohorts[previous.showId][key]=true;}});
  Object.keys(cohorts).forEach(function(sid){var keys=Object.keys(cohorts[sid]);if(keys.length===1&&!persistent[keys[0]])persistent[keys[0]]=sid;});
  files.forEach(function (f) {
    var c = f.classification || {};
    if (f.kind !== 'episode' || !c.showTitle || (c.review || []).length) return;
    var sid = f.showOverride || persistent[f.groupKey] || 'show_' + hash(f.groupKey || showKey(f)), show = shows[sid];
    if (!show) show = shows[sid] = oldShows[sid] || { id: sid, kind: 'show', title: c.showTitle, order: c.order, createdAt: Date.now() };
    show.orphaned=false; if(!f.showOverride)show.title=c.showTitle;
    var previousIds=(f.episodeIds||[]).slice();f.episodeIds=[];f.showId=sid;
    show.sourceIds = show.sourceIds || []; if (show.sourceIds.indexOf(f.sourceId) < 0) show.sourceIds.push(f.sourceId);
    coordinates(c).forEach(function (coordinate, i) {
      var identity=sid+'|'+c.order+'|'+coordinate, previous=oldEpisodes[previousIds[i]] || oldByFile[f.id]&&oldByFile[f.id][i];
      var id=coordinateIds[identity];
      if(!id && previous && previous.showId===sid && previous.fileIds.length===1 && !episodes[previous.id]){id=previous.id;coordinateIds[identity]=id;}
      if(!id)id='ep_'+hash(identity);
      var ep = episodes[id];
      if (!ep) { ep = episodes[id] = oldEpisodes[id] || { id: id, kind: 'episode', showId: sid, season: c.season, number: c.numbers[i] || null, airDate: c.airDate || null, absoluteNumber: c.absoluteNumber || null, absolutePart: c.absolutePart || null, order: c.order, title: c.title, watchState: 'unwatched' }; ep.fileIds = []; ep.showId=sid;ep.season=c.season;ep.number=c.numbers[i]||null;ep.airDate=c.airDate||null;ep.absoluteNumber=c.absoluteNumber||null;ep.absolutePart=c.absolutePart||null;ep.order=c.order; }
      ep.orphaned=false;
      if(previous&&previous.id!==id&&(previous.watchRevision||0)>(ep.watchRevision||0)){['watchState','watchRevision','watchOrigin','completedAt'].forEach(function(k){if(previous[k]!==undefined)ep[k]=previous[k];});}
      f.episodeIds.push(id);
      if (ep.fileIds.indexOf(f.id) < 0) ep.fileIds.push(f.id);
    });
  });
  Object.keys(oldShows).forEach(function(id){if(!shows[id]){oldShows[id].orphaned=true;shows[id]=oldShows[id];}});
  Object.keys(oldEpisodes).forEach(function(id){if(!episodes[id]){oldEpisodes[id].orphaned=true;episodes[id]=oldEpisodes[id];}});
  return { shows: Object.keys(shows).map(function (k) { return shows[k]; }), episodes: Object.keys(episodes).map(function (k) { return episodes[k]; }).sort(function (a,b) { if (a.showId !== b.showId) return a.showId < b.showId ? -1 : 1; if (a.orderPosition != null && b.orderPosition != null) return a.orderPosition - b.orderPosition; if (a.order === 'date') return String(a.airDate).localeCompare(String(b.airDate)); if (a.order === 'absolute') return a.absoluteNumber - b.absoluteNumber || String(a.absolutePart || '').localeCompare(String(b.absolutePart || '')); return a.season - b.season || a.number - b.number; }) };
}
Catalog.prototype.importScan = function(sourceId,scan,cb){return require('./media-import').run(this,sourceId,scan,cb);};

function project(r) {
  var out = {};
  ['sourceIds','displayOrder','mergedFrom','preferredVersion','orderPosition','watchRevision','watchOrigin','watchManualAt','boundaries','favourite','sourceId','kind','title','season','number','airDate','absoluteNumber','absolutePart','order','watchState','availability','metadata','addedAt','showId'].forEach(function (k) { if (r[k] !== undefined) out[k] = r[k]; });
  out.handle = r.handle || r.id;if(r.episodeIds)out.coveredEpisodes=r.episodeIds.slice();if(r.kind==='episode')out.label=r.airDate||(r.absoluteNumber!=null?String(r.absoluteNumber)+(r.absolutePart?'.'+r.absolutePart:''):'S'+r.season+'E'+r.number); if (r.fileIds) out.versionCount = r.fileIds.length;
  if (r.classification) { out.review = (r.classification.review||[]).slice();if(r.availability==='missing')out.review.push('missingFile'); out.label = r.file; out.detected = {}; ['kind','showTitle','season','numbers','order','airDate','absoluteNumber','absolutePart'].forEach(function (k) { if (r.classification[k] !== undefined) out.detected[k] = r.classification[k]; }); }
  return out;
}
Catalog.prototype.query = function (q, cb) {
  var self = this, family = q.kind === 'show' ? 'shows' : q.kind === 'episode' ? 'episodes' : 'files';
  var afterFound = !q.after, sortedEpisodes=[];
  var snapshot=self.library.manifest;
  var revision = snapshot.revision, offset = q.cursor ? +q.cursor.offset : 0, limit = Math.max(1, Math.min(200, +q.limit || 60)), rows = [], total = 0;
  if (q.cursor && q.cursor.revision !== revision) { var stale = new Error('Reload this list.'); stale.code = 'STALE_CURSOR'; return cb(stale); }
  if (!isFinite(offset) || offset < 0 || Math.floor(offset) !== offset) return cb(new Error('Invalid cursor.'));
  self.records('sources',function(sourceError,sources){
  if(sourceError)return cb(sourceError);
  var disabled={};sources.forEach(function(source){if(source.active===false||((q.kind==='show'||q.kind==='episode')&&source.contentMode==='movies')||(q.kind==='movie'&&source.contentMode==='shows'))disabled[source.id]=true;});
  self.library.each(family, function (page, next) {
    page.forEach(function (r) {
      if(r.orphaned)return;
      if(r.sourceId&&disabled[r.sourceId])return;
      if(r.sourceIds&&r.sourceIds.length&&r.sourceIds.every(function(id){return disabled[id];}))return;
      if(r.fileIds&&r.fileIds.length&&r.fileIds.every(function(id){return disabled[id.split('|')[0]];}))return;
      if (q.kind === 'review' && !(r.classification && r.classification.review.length) && r.availability!=='missing') return;
      if(q.kind==='extra'&&r.kind!=='extra')return;
      if(q.availableOnly&&r.availability!=='available')return;
      if(q.favourite&&!r.favourite)return;
      if (q.kind === 'movie' && r.kind !== 'movie') return;
      if (q.show && r.showId !== q.show) return;
      if (q.season != null && r.season !== q.season) return;
      if (q.bucket && q.bucket !== 'Episodes' && (r.order === 'date' ? r.airDate.slice(0,4) !== q.bucket : String(r.season) !== q.bucket)) return;
      if(q.kind!=='episode'&&!afterFound) { if (r.id === q.after) afterFound = true; return; }
      if (q.kind!=='episode' && q.excludeFile && r.fileIds && r.fileIds.some(function (id) { return 'file_' + hash(id) === q.excludeFile; })) return;
      if (q.q && String(r.title).toLowerCase().indexOf(String(q.q).toLowerCase()) < 0 && String(r.metadata&&r.metadata.title||'').toLowerCase().indexOf(String(q.q).toLowerCase()) < 0) return;
      if(q.kind==='episode'){
        var slim=project(r);if(slim.metadata){var brief={};['id','title','poster','still','year','runtime'].forEach(function(k){if(slim.metadata[k]!==undefined)brief[k]=slim.metadata[k];});slim.metadata=brief;}
        slim.revision=revision;slim._covered=!!(q.excludeFile&&r.fileIds&&r.fileIds.some(function(id){return 'file_'+hash(id)===q.excludeFile;}));if(sortedEpisodes.length<=50000)sortedEpisodes.push(slim);return;
      }
      if (total >= offset && rows.length < limit) { var item = project(r); item.revision = revision; rows.push(item); } total++;
    }); next();
  }, function (e) {
    if(q.kind==='episode'){
      if(sortedEpisodes.length>50000)return cb(new Error('Narrow this list to a show or season.'));
      sortedEpisodes.sort(function(a,b){if(a.showId!==b.showId)return a.showId<b.showId?-1:1;if(a.orderPosition!=null&&b.orderPosition!=null)return a.orderPosition-b.orderPosition;if(a.order==='date')return String(a.airDate).localeCompare(String(b.airDate));if(a.order==='absolute')return a.absoluteNumber-b.absoluteNumber||String(a.absolutePart||'').localeCompare(String(b.absolutePart||''));return a.season-b.season||a.number-b.number;});
      var start=0;if(q.after){start=sortedEpisodes.length;sortedEpisodes.some(function(item,i){if(item.handle===q.after){start=i+1;return true;}return false;});}
      var previous=start>0?sortedEpisodes[start-1]:null,gap=false;var selected=sortedEpisodes.slice(start).filter(function(item){if(previous&&item.order==='aired'&&previous.order==='aired'&&((item.season===previous.season&&item.number>previous.number+1)||(item.season===previous.season+1&&item.number>1)))gap=true;previous=item;if(item._covered||(q.skipWatched&&item.watchState==='watched'))return false;item.gapBefore=gap;gap=false;return true;});total=selected.length;rows=selected.slice(offset,offset+limit);rows.forEach(function(item){delete item._covered;});
    }
    cb(e, {items:rows,total:total,revision:revision,nextCursor:offset+rows.length < total ? {offset:offset+rows.length,revision:revision} : null}); },snapshot,function(page){var index=page.index;if(!index)return true;if(q.show&&index.shows.indexOf(q.show)<0)return false;if(q.kind==='movie'&&index.kinds.indexOf('movie')<0)return false;if(q.kind==='review'&&!index.review&&!index.missing)return false;if(q.bucket&&q.bucket!=='Episodes'&&index.buckets.indexOf(q.bucket)<0)return false;return true;});
  },snapshot);
};
Catalog.prototype.file = function (handle, cb) {
  var self=this,snapshot=self.library.manifest,found = null;
  self.records('sources',function(error,sources){
    if(error)return cb(error);
    var disabled={};sources.forEach(function(source){if(source.active===false)disabled[source.id]=true;});
    self.library.each('files', function (rows, next) { rows.some(function (r) { if (r.handle === handle&&!disabled[r.sourceId]) { found = r; return true; } return false; }); next(); }, function (e) { cb(e, found); },snapshot,function(page){return Library.mayContain(page,handle);});
  },snapshot);
};
Catalog.prototype.detail = function (q, cb) {
  var self = this, snapshot = this.library.manifest, family = q.kind === 'show' ? 'shows' : 'episodes', found = null;
  self.records('sources',function(sourceError,sources){if(sourceError)return cb(sourceError);var disabled={};sources.forEach(function(source){if(source.active===false||source.contentMode==='movies')disabled[source.id]=true;});
  self.library.each(family,function (rows,next) { rows.some(function (r) { if (r.id === q.handle) { found = r; return true; } return false; }); next(); },function (e) {
    if (e || !found || found.orphaned || (found.sourceIds&&found.sourceIds.length&&found.sourceIds.every(function(id){return disabled[id];}))) return cb(e || new Error('This item is no longer in the library.'));
    var result = project(found); result.revision = snapshot.revision;
    if (family === 'shows') {
      var buckets = {};
      return self.library.each('episodes',function (rows,next) {
        rows.forEach(function (r) { if (r.orphaned || r.showId !== found.id) return; var bucket = found.displayOrder && found.displayOrder !== 'aired' ? 'Episodes' : r.order === 'date' ? r.airDate.slice(0,4) : r.order === 'absolute' ? 'Episodes' : String(r.season); buckets[bucket] = (buckets[bucket] || 0) + 1; }); next();
      },function (err) { result.buckets = Object.keys(buckets).sort(function (a,b) { return +a - +b; }).map(function (k) { var metadata=found.seasonMetadata&&found.seasonMetadata[k]||{};return {key:k,count:buckets[k],title:metadata.title||null,plot:metadata.plot||null,poster:metadata.poster||null}; }); cb(err,result); },snapshot,function(page){return !page.index || page.index.shows.indexOf(found.id)>=0;});
    }
    result.versions = [];
    self.library.each('files',function (rows,next) { rows.forEach(function (f) { if (found.fileIds.indexOf(f.id) >= 0 && !disabled[f.sourceId]) result.versions.push(project(f)); }); next(); },function (err) { if(!err&&!result.versions.length)return cb(new Error('This episode has no active source.'));cb(err,result); },snapshot,function(page){return found.fileIds.some(function(id){return Library.mayContain(page,id);});});
  },snapshot,function(page){return Library.mayContain(page,q.handle);});
  },snapshot);
};
Catalog.prototype.edit = function (q, cb) {
  if(q.idempotencyKey&&!q._commandPrepared&&!q.preview&&q.operation!=='previewCorrection'){
    if(!/^[a-zA-Z0-9_.-]{1,100}$/.test(q.idempotencyKey))return cb(new Error('Invalid command identity.'));
    var canonical={};Object.keys(q).sort().forEach(function(k){if(k!=='idempotencyKey'&&k!=='expectedRevision'&&k.charAt(0)!=='_')canonical[k]=q[k];});
    var digest=crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),entry=(this.library.manifest.commands||{})['c_'+q.idempotencyKey];
    if(entry){if(entry.hash!==digest){var reused=new Error('This command identity was used for a different change.');reused.code='CONFLICT';return cb(reused);}var result={revision:entry.revision,duplicate:true};Object.keys(entry.extra||{}).forEach(function(k){result[k]=entry.extra[k];});return cb(null,result);}
    var original=cb;cb=function(e,r){original(e,r);};cb.command={key:q.idempotencyKey,hash:digest};var prepared={};Object.keys(q).forEach(function(k){prepared[k]=q[k];});q=prepared;q._commandPrepared=true;
  }

  if(q.operation==='setMetadata'&&q.metadata&&/^tmdb:tv:[1-9][0-9]*$/.test(q.metadata.id||'')&&!q._single){
    var catalog=this,request={};Object.keys(q).forEach(function(k){request[k]=q[k];});request._single=true;
    var metadataDone=function(error,saved){
      if(error)return cb(error);
      catalog.records('shows',function(readError,shows){
        if(readError)return cb(readError);var current=null;shows.some(function(s){if(s.id===q.handle&&!s.orphaned){current=s;return true;}return false;});
        if(!current)return cb(null,saved);
        var peers=shows.filter(function(s){return !s.orphaned&&s.id!==current.id&&s.metadata&&s.metadata.id===q.metadata.id&&(s.displayOrder||s.order)===(current.displayOrder||current.order)&&(!s.episodeGroupId||s.episodeGroupId===current.episodeGroupId);});
        if(!peers.length)return cb(null,saved);
        var candidates=peers.concat([current]).sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0)||(a.id<b.id?-1:1);}),survivor=candidates[0],other=survivor.id===current.id?peers[0]:current;
        catalog.edit({operation:'mergeShows',handle:other.id,target:survivor.id,expectedRevision:catalog.library.manifest.revision},function(mergeError,result){
          if(mergeError){saved.mergePending=true;return cb(null,saved);}result.mergedInto=survivor.id;cb(null,result);
        });
      });
    };metadataDone.command=cb.command;return catalog.edit(request,metadataDone);
  }
  if(/^(classifyFile|resetOverride)$/.test(q.operation))return require('./media-fast-edit').reclassify(this,q,cb);
  if(/^(setWatched|setFavourite|setPreferredVersion|setMetadata|completeFile|setSeasonMetadata|setBoundaries)$/.test(q.operation))return require('./media-fast-edit').run(this,q,cb);
  if (/^(mergeShows|unmergeShows|setOrder|setEpisodeGroup|relinkFile)$/.test(q.operation)) return require('./media-grouping').run(this,q,cb);
  if (/^(previewCorrection|commitPreview|undoEdit)$/.test(q.operation)) return require('./media-corrections').run(this,q,cb);
  return cb(new Error('Unknown library edit.'));
};
Catalog.prototype.source = function (q, cb) {
  var self=this;
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(q.sourceId||''))return cb(new Error('Invalid source.'));
  self.serial(function(done){self.records('sources',function(e,sources){
    if(e)return done(e);var target=null;sources.some(function(source){if(source.id===q.sourceId){target=source;return true;}return false;});
    if(!target){target={id:q.sourceId,active:true,revision:0};sources.push(target);}
    if(q.action==='configure'){if(target.active===false)return done(new Error('This source was removed.'));if(['automatic','movies','shows'].indexOf(q.contentMode)<0)return done(new Error('Choose a content mode.'));if(target.contentMode===q.contentMode)return done(null,{revision:self.library.manifest.revision});target.contentMode=q.contentMode;}
    else if(q.action==='remove')target.active=false;
    else if(q.action==='activate')target.active=true;
    else return done(new Error('Choose a source action.'));
    target.revision++;self.write({sources:sources},function(error,revision){done(error,{revision:revision});});
  });},cb);
};
Catalog.prototype.progress = function(q,cb){
  var self=this;
  if(!isFinite(q.position)||q.position<0||!isFinite(q.duration)||q.duration<=0||q.position>q.duration+5||typeof q.session!=='string'||q.session.length>100||!isFinite(q.sequence)||q.sequence<0||!isFinite(q.startedAt))return cb(new Error('Invalid progress event.'));
  self.serial(function(done){self.file(q.handle,function(e,file){if(e||!file)return done(e||new Error('File unavailable.'));self.records('progress',function(error,records){
    if(error)return done(error);var previous=null;records.some(function(p){if(p.id===file.id){previous=p;return true;}return false;});
    if(previous&&((previous.session===q.session&&previous.sequence>=q.sequence)||(previous.session!==q.session&&previous.startedAt>q.startedAt)))return done(null,{ignored:true,revision:self.library.manifest.revision});
    records=records.filter(function(p){return p.id!==file.id;});records.push({id:file.id,handle:file.handle,sourceId:file.sourceId,session:q.session,sequence:q.sequence,startedAt:q.startedAt,position:q.position,duration:q.duration,at:Date.now()});
    self.write({progress:records},function(err,revision){done(err,{revision:revision});});
  });});},cb);
};
Catalog.prototype.continuing = function(cb){
  var self=this,snapshot=self.library.manifest;
  self.records('progress',function(e,progress){if(e)return cb(e);self.records('shows',function(e2,shows){if(e2)return cb(e2);self.records('sources',function(e3,sources){if(e3)return cb(e3);
    var byFile={},byShow={},cards={},disabled={};sources.forEach(function(s){if(s.active===false||s.contentMode==='movies')disabled[s.id]=true;});
    progress.forEach(function(p){if(p.position>=5&&p.position<p.duration-1&&!disabled[p.sourceId||p.id.split('|')[0]])byFile[p.id]=p;});shows.forEach(function(s){byShow[s.id]=s;});
    self.library.each('episodes',function(rows,next){rows.forEach(function(ep){if(ep.orphaned||ep.watchState==='watched')return;ep.fileIds.forEach(function(id){var p=byFile[id],show=byShow[ep.showId];if(!p||!show)return;if(!cards[show.id]||cards[show.id].at<p.at){var card=project(show);card.at=p.at;card.continueEpisode=ep.id;card.continueFile=p.handle;card.progressPercent=Math.round(100*p.position/p.duration);cards[show.id]=card;}});});next();},function(error){
      cb(error,{items:Object.keys(cards).map(function(k){return cards[k];}).sort(function(a,b){return b.at-a.at;}).slice(0,60),revision:snapshot.revision});
    },snapshot);
  },snapshot);},snapshot);},snapshot);
};
module.exports = { Catalog: Catalog, derive: derive, project: project };
