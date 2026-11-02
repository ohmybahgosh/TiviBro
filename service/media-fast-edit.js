/* Field edits rewrite only affected immutable pages.  No catalogue-sized array for watched state,
   favourites or metadata.  Caller owns the catalogue writer for the whole operation.  ES5. */
'use strict';
var Library=require('./media-library'),crypto=require('crypto');
function hash(s){return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,32);}
function find(c,handle,cb){
  var family=String(handle).indexOf('show_')===0?'shows':String(handle).indexOf('ep_')===0?'episodes':'files',found=null;
  c.library.each(family,function(rows,next){rows.some(function(r){if(r.id===handle||r.handle===handle){found=r;return true;}return false;});next();},function(e){cb(e,found,family);},null,function(page){return Library.mayContain(page,handle);});
}
function run(c,q,cb){
  c.serial(function(done){
    if(q.expectedRevision!==c.library.manifest.revision){var conflict=new Error('The library changed.  Refresh this item.');conflict.code='CONFLICT';return done(conflict);}
    find(c,q.handle,function(e,target,family){
      if(e||!target)return done(e||new Error('This item is no longer in the library.'));
      var changes=[],revision=c.library.manifest.revision+1;
      function add(recordFamily,id,update){changes.push({family:recordFamily,id:id,update:update});}
      function publish(){if(!changes.length)return done(new Error('No matching records could be updated.'));c.library.patch(changes,c.library.manifest.revision,function(error,newRevision){done(error,{revision:newRevision});});}
      function watch(ep,watched){
        if(q.playback&&ep.watchOrigin==='manual'&&(ep.watchRevision||0)>(q.baseWatchRevision||0)&&(ep.watchManualAt||0)>=(q.playStartedAt||0))return;
        ep.watchState=watched?'watched':'unwatched';ep.watchOrigin=q.playback?'playback':'manual';ep.watchRevision=revision;ep.completedAt=watched?Date.now():null;if(!q.playback)ep.watchManualAt=Date.now();
      }
      if(q.operation==='setWatched'&&family==='episodes')add(family,target.id,function(ep){watch(ep,!!q.watched);});
      else if(q.operation==='setFavourite')add(family,target.id,function(r){r.favourite=!!q.favourite;});
      else if(q.operation==='markMetadataChecked'&&family==='shows'){
        if(!/^(en|nl|de|fr|es|it)$/.test(q.language||'')||typeof q.startedAt!=='number'||!isFinite(q.startedAt)||q.startedAt<=0||q.startedAt>Date.now())return done(new Error('Choose a valid metadata check.'));
        add(family,target.id,function(r){r.metadataCheckedAt=q.startedAt;r.metadataCheckLanguage=q.language;r.metadataMissAt=q.missed?Date.now():0;});
      }
      else if(q.operation==='setPreferredVersion'&&family==='episodes'){
        if(!target.fileIds.some(function(id){return 'file_'+hash(id)===q.version;}))return done(new Error('Choose a version belonging to this episode.'));add(family,target.id,function(ep){ep.preferredVersion=q.version;});
      }else if(q.operation==='setMetadata'){
        if(q.metadata!==null&&(!q.metadata||typeof q.metadata!=='object'||!/^tmdb:tv:[1-9][0-9]*(?::season:[0-9]+(?::episode:[1-9][0-9]*)?)?$/.test(q.metadata.id||'')))return done(new Error('Choose a valid metadata match.'));
        add(family,target.id,function(r){r.metadata=q.metadata;});
      }else if(q.operation==='completeFile'&&family==='files'){
        var wanted=target.episodeIds||[];
        if(wanted.length){wanted.forEach(function(id){add('episodes',id,function(ep){watch(ep,true);});});}
        else return c.library.each('episodes',function(rows,next){rows.forEach(function(ep){if(ep.fileIds.indexOf(target.id)>=0)add('episodes',ep.id,function(r){watch(r,true);});});next();},function(error){if(error)return done(error);publish();});
      }else if(q.operation==='setBoundaries'&&family==='files'){
        if(!Array.isArray(q.ranges)||q.ranges.length>50)return done(new Error('Choose valid episode ranges.'));
        try{require('./media-chapters').validate(q.ranges,q.durationSec);}catch(rangeError){return done(rangeError);}
        if(q.ranges.some(function(range){return (target.episodeIds||[]).indexOf(range.episode)<0;}))return done(new Error('Episode does not belong to this file.'));
        add('files',target.id,function(file){file.boundaries=q.ranges.map(function(range){return {episode:range.episode,startSec:range.startSec,endSec:range.endSec==null?null:range.endSec,origin:'user'};});});
      }else if(q.operation==='setSeasonMetadata'&&family==='shows'){
        var match=/^tmdb:tv:[0-9]+:season:([0-9]+)$/.exec(q.metadata&&q.metadata.id||'');
        if(!match||!target.metadata||q.metadata.id.indexOf(target.metadata.id+':season:')!==0||!Array.isArray(q.metadata.episodes))return done(new Error('Choose a season belonging to this show.'));
        var remote={};q.metadata.episodes.forEach(function(ep){remote[ep.season+':'+ep.number]=ep;});
        add('shows',target.id,function(show){show.seasonMetadata=show.seasonMetadata||{};var value={};['title','plot','poster','releaseDate','year'].forEach(function(k){if(q.metadata[k]!==undefined)value[k]=q.metadata[k];});show.seasonMetadata[match[1]]=value;});
        return c.library.each('episodes',function(rows,next){rows.forEach(function(ep){var metadata=remote[ep.season+':'+ep.number];if(ep.showId===target.id&&metadata)add('episodes',ep.id,function(r){r.metadata=metadata;});});next();},function(error){if(error)return done(error);publish();},null,function(page){return !page.index||page.index.shows.indexOf(target.id)>=0;});
      }else return done(new Error('That change is not valid for this item.'));
      publish();
    });
  },cb);
}
function reclassify(c,q,cb){
  find(c,q.handle,function(e,file,family){
    if(e||!file||family!=='files')return cb(e||new Error('Choose a file to correct.'));
    var normalized=null;
    if(q.operation==='classifyFile'){
      normalized={};['kind','showTitle','season','numbers','order','airDate','absoluteNumber','absolutePart','title'].forEach(function(k){if(Object.prototype.hasOwnProperty.call(q.fields||{},k))normalized[k]=q.fields[k];});
      var result=require('./media-classify').classify({basename:file.file,ancestors:file.ancestors,server:file.server},{},[normalized]);
      if(result.review.some(function(reason){return /^invalid/.test(reason);}))return cb(new Error('Choose valid episode coordinates.'));
    }
    var edits={};edits[file.id]={override:normalized};file.override=normalized;
    require('./media-import').run(c,file.sourceId,{files:[file],partial:true,consume:true,idsAreFull:true,edits:edits,expectedRevision:q.expectedRevision},cb);
  });
}
module.exports={run:run,reclassify:reclassify};
