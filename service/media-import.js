/* Streaming source reconciliation.  Only observations, compact membership indexes and one old
   record page are live; old file/episode catalogues are never collected into another large array.
   Publication remains one atomic files/episodes/shows generation.  ES5 / Node 0.12. */
'use strict';
var crypto=require('crypto'),Classifier=require('./media-classify'),Corrections=require('./media-corrections');
function hash(s){return crypto.createHash('sha256').update(String(s),'utf8').digest('hex').slice(0,32);}
function coords(c){if(c.order==='date')return [c.airDate];if(c.order==='absolute')return [String(c.absoluteNumber)+(c.absolutePart?'.'+c.absolutePart:'')];return (c.numbers||[]).map(function(n){return String(c.season)+':'+n;});}
function group(file){var c=file.classification||{},ancestry=file.ancestors||[],anchor='';ancestry.some(function(name,i){if(String(name).toLowerCase()===String(c.showTitle).toLowerCase()){anchor=JSON.stringify(ancestry.slice(0,i+1));return true;}return false;});return file.sourceId+'|'+(anchor||c.showTitle||'').toLowerCase();}
function episodeCoordinate(ep){return ep.order==='date'?ep.airDate:ep.order==='absolute'?String(ep.absoluteNumber)+(ep.absolutePart?'.'+ep.absolutePart:''):String(ep.season)+':'+ep.number;}
function run(c,sourceId,scan,cb){
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(sourceId||'')||!scan||!Array.isArray(scan.files))return cb(new Error('Invalid source scan.'));
  c.serial(function(done){
    if(scan.expectedRevision!=null&&scan.expectedRevision!==c.library.manifest.revision){var conflict=new Error('The library changed.  Refresh this item.');conflict.code='CONFLICT';return done(conflict);}
    var snapshot=c.library.manifest,input={},inputKeys=[],count=scan.files.length,rules=[],oldShows={},sources=[],oldCoordinates={},multi={},anchors={},cohorts={},persistent={},newShows={},members={},memberKeys=[],now=Date.now();
    scan.files.forEach(function(f,i){var id=scan.idsAreFull?f.id:sourceId+'|'+f.id;if(!input[id]){input[id]={file:scan.consume?f:JSON.parse(JSON.stringify(f)),id:id,groupKey:null,previous:null};inputKeys.push(id);}if(scan.consume)scan.files[i]=null;});
    c.records('sources',function(e,list){if(e)return done(e);sources=list;if(sources.some(function(s){return s.id===sourceId&&s.active===false;}))return done(new Error('This source was removed.'));if(scan.contentMode&&sources.some(function(s){return s.id===sourceId&&s.contentMode&&s.contentMode!==scan.contentMode;})){var scopeError=new Error('Source settings changed.  Rescan using the new settings.');scopeError.code='STALE_SCOPE';return done(scopeError);}
      c.library.each('overrides',function(rows,next){rows.forEach(function(r){if(r.type==='folderRule')rules.push(r);});next();},function(e2){if(e2)return done(e2);
        c.library.each('shows',function(rows,next){rows.forEach(function(s){oldShows[s.id]=s;});next();},function(e3){if(e3)return done(e3);
          c.library.each('episodes',function(rows,next){rows.forEach(function(ep){var identity=ep.showId+'|'+ep.order+'|'+episodeCoordinate(ep),normal='ep_'+hash(identity);if(ep.id!==normal)oldCoordinates[normal]=ep.id;if(ep.fileIds.length>1)multi[ep.id]=true;});next();},function(e4){if(e4)return done(e4);prepass();},snapshot);
        },snapshot);
      },snapshot);
    },snapshot);
    function incoming(old){var entry=input[old.id];if(entry)return entry;(old.locatorAliases||[]).some(function(alias){if(input[alias]){entry=input[alias];return true;}return false;});return entry;}
    function prepare(entry,old){
      var f=entry.file;
      if(old){entry.previous={id:old.id,showId:old.showId,episodeIds:old.episodeIds||[]};if(old.override&&!(scan.edits&&scan.edits[old.id]))f.override=old.override;}
      if(scan.edits&&scan.edits[entry.id])f.override=scan.edits[entry.id].override;
      f.sourceId=sourceId;
      if(f.override||rules.length){f.classification=Corrections.classify(f,rules);f.kind=f.classification.kind;}
      entry.groupKey=group(f);
    }
    function recordGroup(file,key,oldSid,unchanged){
      var cls=file.classification||{};if(file.kind!=='episode'||!cls.showTitle||(cls.review||[]).length)return;
      var titleKey=file.sourceId+'|'+cls.showTitle.toLowerCase();
      if(key.indexOf('|[')>=0){if(!anchors[titleKey])anchors[titleKey]=[];if(anchors[titleKey].indexOf(key)<0)anchors[titleKey].push(key);}
      if(oldSid&&!file.showOverride){if(!cohorts[oldSid])cohorts[oldSid]={keys:{},unchanged:false};cohorts[oldSid].keys[key]={titleKey:titleKey,key:key};if(unchanged)cohorts[oldSid].unchanged=true;}
    }
    function prepass(){
      c.library.each('files',function(rows,next){rows.forEach(function(old){var entry=incoming(old);if(entry){prepare(entry,old);var f=entry.file;f.showOverride=old.showOverride;recordGroup(f,entry.groupKey,old.showId,old.groupKey===entry.groupKey);}else recordGroup(old,old.groupKey||group(old),old.showId,true);});next();},function(error){
        if(error)return done(error);
        inputKeys.forEach(function(id){var entry=input[id];if(!entry.previous){prepare(entry,null);recordGroup(entry.file,entry.groupKey,null,false);}});
        function resolve(key,titleKey){var candidates=anchors[titleKey]||[];return key.indexOf('|[')<0&&candidates.length===1?candidates[0]:key;}
        inputKeys.forEach(function(id){var entry=input[id],f=entry.file;entry.groupKey=resolve(entry.groupKey,f.sourceId+'|'+String((f.classification||{}).showTitle).toLowerCase());});
        var ids=Object.keys(cohorts).sort(function(a,b){return (cohorts[b].unchanged?1:0)-(cohorts[a].unchanged?1:0);});
        ids.forEach(function(sid){var cohort=cohorts[sid],resolved={};Object.keys(cohort.keys).forEach(function(k){var key=cohort.keys[k];resolved[resolve(key.key,key.titleKey)]=true;});var keys=Object.keys(resolved);if(keys.length===1&&!persistent[keys[0]])persistent[keys[0]]=sid;});
        publish();
      },snapshot);
    }
    function compose(entry,old){
      var observation=entry.file,out=old||observation,oldKind=old&&old.kind,oldSize=old&&old.size,oldEtag=old&&old.etag,oldModified=old&&old.modified;
      // Preserve only protected user/history overlays from the old file, not stale scan fields.
      if(old){['file','title','year','size','ext','info','path','url','etag','modified','ancestors','server','classification','kind'].forEach(function(k){out[k]=observation[k];});}
      if(scan.edits&&scan.edits[entry.id])out.override=scan.edits[entry.id].override;
      out.id=old?old.id:entry.id;out.handle=old&&old.handle||'file_'+hash(out.id);out.sourceId=sourceId;out.availability='available';out.addedAt=old?old.addedAt:now;
      if(oldKind&&oldKind!==out.kind&&out.metadata){out.legacyMetadata=out.metadata;out.metadata=null;}
      if((oldSize&&out.size&&oldSize!==out.size)||(oldEtag&&out.etag&&oldEtag!==out.etag)||(oldModified&&out.modified&&oldModified!==out.modified))out.boundaries=null;
      if(out.classification&&out.classification.evidence&&!(out.classification.review||[]).length)out.classification.evidence=out.classification.evidence.map(function(e){return {origin:e.origin};});
      out.groupKey=entry.groupKey;
      entry.file=null;return out;
    }
    function membership(file){
      var cls=file.classification||{};if(file.kind!=='episode'||!cls.showTitle||(cls.review||[]).length)return;
      var key=file.groupKey||group(file),sid=file.showOverride||persistent[key]||'show_'+hash(key),show=newShows[sid];
      if(!show){show=newShows[sid]=oldShows[sid]||{id:sid,kind:'show',title:cls.showTitle,order:cls.order,createdAt:now};show.orphaned=false;show.sourceIds=[];}
      if(!file.showOverride)show.title=cls.showTitle;
      if(show.sourceIds.indexOf(file.sourceId)<0)show.sourceIds.push(file.sourceId);
      var previousIds=file.episodeIds||[];file.episodeIds=[];var previousShow=file.showId;file.showId=sid;
      coords(cls).forEach(function(coordinate,index){
        var normal='ep_'+hash(sid+'|'+cls.order+'|'+coordinate),id=oldCoordinates[normal]||normal,candidate=previousIds[index];
        if(!members[id]&&candidate&&previousShow===sid&&!multi[candidate]){id=candidate;if(id!==normal)oldCoordinates[normal]=id;}
        var ep=members[id];if(!ep){ep=members[id]={id:id,kind:'episode',showId:sid,season:cls.season,number:cls.numbers&&cls.numbers[index]||null,airDate:cls.airDate||null,absoluteNumber:cls.absoluteNumber||null,absolutePart:cls.absolutePart||null,order:cls.order,title:cls.title||file.title,fileIds:[],watchState:'unwatched',orphaned:false};memberKeys.push(id);}
        if(ep.fileIds.indexOf(file.id)<0)ep.fileIds.push(file.id);file.episodeIds.push(id);
      });
    }
    function publish(){
      var filePages=snapshot.pages.files||[],episodePages=snapshot.pages.episodes||[],filePage=0,inputAt=0,episodePage=0,memberAt=0,showAt=0,showRows=null,phase='oldFiles',pending=[];
      function page(rows,family,give){
        if(!rows.length)return produce(give);
        var output=[],bytes=2;
        while(rows.length&&output.length<256){var row=rows[0],size=Buffer.byteLength(JSON.stringify(row),'utf8')+1;if(size+2>1048576)return give(new Error('A media record exceeds the storage page limit.'));if(output.length&&bytes+size>1048576)break;output.push(rows.shift());bytes+=size;}
        pending=rows;give(null,family,output);
      }
      function produce(give){
        if(pending.length)return page(pending,phase==='oldEpisodes'||phase==='newEpisodes'?'episodes':phase==='shows'?'shows':'files',give);
        if(phase==='oldFiles'){
          if(filePage<filePages.length)return c.library.readPage(filePages[filePage++],function(e,rows){if(e)return give(e);rows.forEach(function(old,i){var entry=incoming(old),out=old;if(entry){out=compose(entry,old);delete input[entry.id];}else if(old.sourceId===sourceId&&!scan.partial&&count)out.availability='missing';membership(out);rows[i]=out;});page(rows,'files',give);});
          phase='newFiles';
        }
        if(phase==='newFiles'){
          var added=[];while(inputAt<inputKeys.length&&added.length<256){var id=inputKeys[inputAt++],entry=input[id];if(!entry)continue;var out=compose(entry,null);membership(out);added.push(out);delete input[id];}
          if(added.length)return page(added,'files',give);phase='oldEpisodes';
        }
        if(phase==='oldEpisodes'){
          if(episodePage<episodePages.length)return c.library.readPage(episodePages[episodePage++],function(e,rows){if(e)return give(e);rows.forEach(function(old){var fresh=members[old.id];if(fresh){['showId','season','number','airDate','absoluteNumber','absolutePart','order','title','fileIds'].forEach(function(k){old[k]=fresh[k];});old.orphaned=false;delete members[old.id];}else old.orphaned=true;});page(rows,'episodes',give);});phase='newEpisodes';
        }
        if(phase==='newEpisodes'){
          var addedEpisodes=[];while(memberAt<memberKeys.length&&addedEpisodes.length<256){var eid=memberKeys[memberAt++];if(!members[eid])continue;addedEpisodes.push(members[eid]);delete members[eid];}
          if(addedEpisodes.length)return page(addedEpisodes,'episodes',give);phase='shows';
        }
        if(phase==='shows'){
          if(!showRows){Object.keys(oldShows).forEach(function(id){if(!newShows[id]){oldShows[id].orphaned=true;newShows[id]=oldShows[id];}});showRows=Object.keys(newShows).map(function(id){return newShows[id];});}
          var batch=showRows.slice(showAt,showAt+256);showAt+=batch.length;if(batch.length)return page(batch,'shows',give);return give(null,null);
        }
      }
      c.library.replace(['files','episodes','shows'],produce,snapshot.revision,function(error,revision){done(error,{revision:revision,files:count,shows:Object.keys(newShows).filter(function(id){return !newShows[id].orphaned;}).length});});
    }
  },cb);
}
module.exports={run:run};
