/* Explicit show merge/split, episode-order mappings and missing-file relinking.  History follows
   physical files; catalogue edits never guess a rename from equal names or sizes.  ES5. */
'use strict';
function clone(x){return JSON.parse(JSON.stringify(x));}
function err(message,code){var e=new Error(message);e.code=code||'INVALID_MAPPING';return e;}
function run(c,q,cb){
  c.serial(function(done){
    if(q.expectedRevision!==c.library.manifest.revision)return done(err('The library changed.  Reload before changing grouping.','CONFLICT'));
    c.records('files',function(e,files){if(e)return done(e);c.records('shows',function(e2,shows){if(e2)return done(e2);c.records('episodes',function(e3,episodes){if(e3)return done(e3);c.records('overrides',function(e4,journal){if(e4)return done(e4);
      var show=null;shows.some(function(s){if(s.id===q.handle){show=s;return true;}return false;});
      var byFile={};files.forEach(function(f){byFile[f.id]=f;});
      function memberFiles(id){var ids={};episodes.forEach(function(ep){if(!ep.orphaned&&ep.showId===id)ep.fileIds.forEach(function(fid){ids[fid]=true;});});return files.filter(function(f){return ids[f.id];});}
      if(q.operation==='mergeShows'){
        var target=null;shows.some(function(s){if(s.id===q.target){target=s;return true;}return false;});
        if(!show||!target||show.id===target.id)return done(err('Choose two different shows.'));
        if(show.order!==target.order)return done(err('Choose compatible episode orders before merging.'));
        var members=memberFiles(show.id),patches=members.map(function(f){return {id:f.id,before:f.showOverride||null};});
        if(q.preview)return done(null,{revision:c.library.manifest.revision,count:members.length,from:show.title,to:target.title});
        members.forEach(function(f){f.showOverride=target.id;});
        var sourceEpisodes=episodes.filter(function(ep){return !ep.orphaned&&ep.showId===show.id;}).map(clone);
        sourceEpisodes.forEach(function(ep){
          var coordinate=ep.order==='date'?ep.airDate:ep.order==='absolute'?String(ep.absoluteNumber)+(ep.absolutePart?'.'+ep.absolutePart:''):String(ep.season)+':'+ep.number;
          var canonical='ep_'+require('crypto').createHash('sha256').update(target.id+'|'+ep.order+'|'+coordinate).digest('hex').slice(0,32),existing=null;
          episodes.some(function(r){if(r.id===canonical){existing=r;return true;}return false;});
          if(!existing){existing=clone(ep);existing.id=canonical;existing.showId=target.id;episodes.push(existing);}
          else if((ep.watchRevision||0)>(existing.watchRevision||0)){existing.watchState=ep.watchState;existing.watchRevision=ep.watchRevision;existing.watchOrigin=ep.watchOrigin;existing.completedAt=ep.completedAt;}
        });
        var operation={type:'showMerge',id:'merge_'+require('crypto').randomBytes(16).toString('hex'),source:clone(show),episodeHistory:sourceEpisodes,revision:c.library.manifest.revision+1,target:target.id,files:patches,at:Date.now()};
        journal.push(operation);target.favourite=!!(target.favourite||show.favourite);target.mergedFrom=(target.mergedFrom||[]).concat([{id:show.id,title:show.title,operation:operation.id}]);
      }else if(q.operation==='unmergeShows'){
        var merge=null;journal.some(function(r){if(r.type==='showMerge'&&r.id===q.mergeHandle){merge=r;return true;}return false;});
        if(!merge)return done(err('This merge is not available.'));
        if(merge.files.some(function(p){return !byFile[p.id]||byFile[p.id].showOverride!==merge.target;}))return done(err('Some files were regrouped again.  Review them before splitting.','CONFLICT'));
        merge.files.forEach(function(p){if(p.before)byFile[p.id].showOverride=p.before;else delete byFile[p.id].showOverride;});
        (merge.episodeHistory||[]).forEach(function(original){
          var copy=clone(original);
          episodes.forEach(function(current){if(current.showId===merge.target&&current.season===copy.season&&current.number===copy.number&&current.airDate===copy.airDate&&current.absoluteNumber===copy.absoluteNumber&&current.watchOrigin==='manual'&&(current.watchRevision||0)>merge.revision){copy.watchState=current.watchState;copy.watchRevision=current.watchRevision;copy.watchOrigin=current.watchOrigin;copy.completedAt=current.completedAt;}});
          episodes.push(copy);
        });
        shows.push(merge.source);journal=journal.filter(function(r){return r!==merge;});
        shows.forEach(function(s){if(s.id===merge.target)s.mergedFrom=(s.mergedFrom||[]).filter(function(m){return m.operation!==merge.id;});});
      }else if(q.operation==='setEpisodeGroup'){
        if(!show||!show.metadata||!q.group||!Array.isArray(q.group.groups)||typeof q.group.id!=='string')return done(err('Match the show and choose a valid episode group.'));
        var ordered=[],coordinateMap={},dateMap={},owned=episodes.filter(function(ep){return !ep.orphaned&&ep.showId===show.id;});
        q.group.groups.slice().sort(function(a,b){return a.order-b.order;}).forEach(function(bucket){
          if(!Array.isArray(bucket.episodes))return;
          bucket.episodes.slice().sort(function(a,b){return a.order-b.order;}).forEach(function(remote){
            var position=ordered.length;ordered.push(remote);var key=remote.season_number+':'+remote.episode_number;
            if(coordinateMap[key]!=null)coordinateMap[key]=-1;else coordinateMap[key]=position;
            if(remote.air_date){if(dateMap[remote.air_date]!=null)dateMap[remote.air_date]=-1;else dateMap[remote.air_date]=position;}
          });
        });
        var positions={};
        for(var gi=0;gi<owned.length;gi++){
          var local=owned[gi],position=null;
          if(local.order==='aired')position=coordinateMap[local.season+':'+local.number];
          else if(local.order==='date')position=dateMap[local.airDate];
          else if(local.order==='absolute'&&q.group.type===2&&!local.absolutePart)position=local.absoluteNumber-1;
          if(position==null||position<0||position>=ordered.length||positions[position])return done(err('This group does not uniquely map every owned episode.  Correct the unmatched items first.'));
          positions[position]=true;local.orderPosition=position;local.canonicalSeason=ordered[position].season_number;local.canonicalNumber=ordered[position].episode_number;
        }
        show.displayOrder='group';show.orderMappingOrigin='tmdbGroup';show.episodeGroupId=q.group.id;
      }else if(q.operation==='setOrder'){
        if(!show||['aired','date','absolute','custom','group'].indexOf(q.order)<0)return done(err('Choose a valid show order.'));
        if(!Array.isArray(q.mapping)||q.mapping.length>10000)return done(err('Supply a valid episode mapping.'));
        var seen={},mapped={};
        for(var i=0;i<q.mapping.length;i++){
          var map=q.mapping[i],ep=null;episodes.some(function(r){if(r.id===map.episode&&r.showId===show.id){ep=r;return true;}return false;});
          if(!ep||seen[map.episode]||!isFinite(map.position)||map.position<0||Math.floor(map.position)!==map.position)return done(err('The mapping contains an unknown episode or duplicate.'));
          if(mapped[map.position])return done(err('Two episodes have the same order position.'));seen[map.episode]=true;mapped[map.position]=true;
        }
        if(q.mapping.length!==episodes.filter(function(ep){return !ep.orphaned&&ep.showId===show.id;}).length)return done(err('Map every owned episode before saving this order.'));
        q.mapping.forEach(function(map){episodes.forEach(function(ep){if(ep.id===map.episode)ep.orderPosition=map.position;});});
        show.displayOrder=q.order;show.orderMappingOrigin=q.groupId?'tmdbGroup':'user';if(q.groupId)show.episodeGroupId=q.groupId;
      }else if(q.operation==='relinkFile'){
        var missing=null,replacement=null;files.forEach(function(f){if(f.handle===q.handle)missing=f;if(f.handle===q.target)replacement=f;});
        if(!missing||!replacement||missing.id===replacement.id||missing.availability!=='missing'||replacement.availability!=='available')return done(err('Select a missing file and its available replacement.'));
        if(replacement.progress&&!q.replaceHistory)return done(err('The replacement already has progress.  Choose which history to keep.','CONFLICT'));
        if(q.preview)return done(null,{revision:c.library.manifest.revision,from:missing.file,to:replacement.file,historyConflict:!!replacement.progress});
        var replacementId=replacement.id;
        ['path','url','file','size','ext','info','ancestors','sourceId'].forEach(function(k){if(replacement[k]!==undefined)missing[k]=replacement[k];else delete missing[k];});
        if(missing.showId)missing.showOverride=missing.showId;
        missing.availability='available';missing.locatorAliases=(missing.locatorAliases||[]).concat([replacementId]);
        files=files.filter(function(f){return f!==replacement;});
        episodes.forEach(function(ep){ep.fileIds=ep.fileIds.map(function(id){return id===replacementId?missing.id:id;});});
        journal.push({type:'relink',id:'relink_'+Date.now(),fileId:missing.id,replacementId:replacementId,at:Date.now()});
      }else return done(err('Unknown grouping operation.'));
      var result=require('./media-catalog').derive(files,shows,episodes);
      c.write({files:files,shows:result.shows,episodes:result.episodes,overrides:journal},function(error,revision){done(error,{revision:revision});});
    });});});});
  },cb);
}
module.exports={run:run};
