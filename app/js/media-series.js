/* My media show navigation.  Pages stay in the helper; menus retain parent callbacks for Back.
   Movie-only phone endpoints remain separate.  Chromium 53-compatible. */
var MediaSeries = (function () {
  'use strict';
  // A name, never translated (app/js/i18n.js); plain text where there's no I18n (unit tests).
  var RAW = function (s) { return typeof I18n !== 'undefined' ? I18n.raw(s) : s; };
  var generation = 0, nextTimer = null, pageFocus = {};
  var fetchingMetadata = false, metadataToken = '', metadataLanguage = '', queuedMetadata = false;
  // Background work has its own lifetime: browsing seasons must not cancel it.
  function fetchDetails(force) {
    var token=MediaStore.tmdbToken(),language=MediaStore.preferences().language,started=Date.now(),updated=0,missed=0,lastHandle=null,streak=0;
    if(!token)return Promise.resolve({skipped:true});
    if(fetchingMetadata){
      if(token!==metadataToken||language!==metadataLanguage)queuedMetadata=true;
      if(force)U.toast('Show details are already being fetched.');
      return Promise.resolve({skipped:true});
    }
    fetchingMetadata=true;metadataToken=token;metadataLanguage=language;
    function finish(){fetchingMetadata=false;metadataToken='';Media.refreshShows();if(queuedMetadata){queuedMetadata=false;setTimeout(function(){fetchDetails(false);},350);}}
    function active(){if(MediaStore.tmdbToken()!==token||MediaStore.preferences().language!==language)throw new Error('Show details stopped because the token or language changed.');}
    function call(route,q){
      try{active();}catch(e){return Promise.reject(e);}
      return Media.request(route,q,30000).then(function(r){active();if(r.error)throw new Error(r.message||'Could not fetch show details.');return r;});
    }
    function lookup(q){q.credential=token;q.language=language;return call('metadata',q);}
    function detail(handle){return call('library/detail',{kind:'show',handle:handle});}
    function save(handle,operation,fields,expectedId){
      return detail(handle).then(function(current){
        if((current.metadata&&current.metadata.id)!==expectedId)throw new Error('A show match changed.  Saved matches are kept; fetch details again.');
        var q={handle:handle,operation:operation,expectedRevision:current.revision};Object.keys(fields).forEach(function(k){q[k]=fields[k];});return call('library/edit',q);
      });
    }
    function process(item){
      return detail(item.handle).then(function(show){
        var id=show.metadata&&show.metadata.id,handle=show.handle;
        var q=id?{id:id}:{kind:'tv',title:show.title,auto:true};
        return lookup(q).then(function(result){
          if(!result.metadata){missed++;return save(handle,'markMetadataChecked',{language:language,startedAt:started,missed:true},id);}
          return save(handle,'setMetadata',{metadata:result.metadata},id).then(function(saved){
            handle=saved.mergedInto||handle;id=result.metadata.id;
            return detail(handle);
          }).then(function(current){
            var at=0;
            function season(){
              if(current.order!=='aired'||at>=current.buckets.length)return Promise.resolve();
              var number=+current.buckets[at++].key;
              return lookup({id:id,season:number}).then(function(r){
                if(!r.metadata)throw new Error('Season details were unavailable.  Saved matches are kept.');
                return save(handle,'setSeasonMetadata',{metadata:r.metadata},id);
              }).then(season);
            }
            return season();
          }).then(function(){return save(handle,'markMetadataChecked',{language:language,startedAt:started,missed:false},id);}).then(function(){updated++;});
        });
      });
    }
    function next(){
      var q={kind:'show',metadataPending:true,language:language,limit:1};if(force)q.metadataSince=started;
      return call('library/query',q).then(function(r){
        if(!r.items.length)return;
        if(r.items[0].handle===lastHandle)throw new Error('The media library changed while fetching details.  Try again after scanning finishes.');
        lastHandle=r.items[0].handle;
        var item=r.items[0];
        // One show that fails (no season details, a network error, a changed match) is marked checked as
        // missed and the run goes on, so it can't stop every show after it from getting details.
        return process(item).then(function(){streak=0;},function(e){
          active();                                  // the token or language changed: stop, as before
          // Two shows in a row failing looks like TMDB or the network being down: stop and leave them
          // pending for next time instead of putting every show on a week's wait.
          if(++streak>=2)throw e;
          missed++;
          if(typeof Log!=='undefined'&&Log.warn)Log.warn('media','Show details for one show failed: '+(e&&e.message));
          return detail(item.handle).then(function(show){return save(show.handle,'markMetadataChecked',{language:language,startedAt:started,missed:true},show.metadata&&show.metadata.id);});
        }).then(function(){return new Promise(function(resolve){setTimeout(resolve,350);});}).then(next);
      });
    }
    return next().then(function(){
      finish();
      var n=function(k,one,many){return k+' '+(k===1?one:many);};
      if(updated||missed)U.toast(n(updated,'show','shows')+' updated'+(missed?'.  '+n(missed,'needs','need')+' a manual match.':'.'),6000);
      else if(force)U.toast('All show details are up to date.',4000);
      return {updated:updated,missed:missed};
    },function(e){finish();if(force)U.toast(e.message,6000);else if(typeof Log!=='undefined'&&Log.warn)Log.warn('media','Automatic show details: '+e.message);return {updated:updated,error:e.message};});
  }
  function request(route, q, done) {
    var expected = ++generation;
    Media.request('library/' + route, q, 30000).then(function (r) {
      if (expected !== generation) return;
      if (r.error) { U.toast(r.message || 'Could not read the media library.',6000); return; }
      done(r);
    },function (e) { if (expected === generation) U.toast(e.message,6000); });
  }
  function page(title, q, select, back) {
    var pageKey=title+'|'+JSON.stringify(q);
    request('query',q,function (r) {
      var entries = r.items.map(function (item) { return {current:pageFocus[pageKey]===item.handle,label:episodeLabel(item),sub:item.metadata && item.metadata.plot || '',action:function () { pageFocus[pageKey]=item.handle;item.originPage=function(){page(title,q,select,back);};select(item,item.originPage); }}; });
      if (!entries.length) entries.push({label:'No items in this view'});
      if (r.nextCursor) entries.push({label:'Next page',action:function () { var next = {}; Object.keys(q).forEach(function (k) { next[k] = q[k]; }); next.cursor = r.nextCursor; page(title,next,select,function () { page(title,q,select,back); }); }});
      entries.push({label:'Back',action:back}); UI.menu(title,entries,back);
    });
  }
  function edit(item, operation, fields, back) {
    var q = {handle:item.handle,expectedRevision:item.revision,operation:operation};
    Object.keys(fields).forEach(function (k) { q[k] = fields[k]; });
    request('edit',q,function (result) { if(operation==='setWatched'&&!fields.watched&&Media.watchedReset)Media.watchedReset(item.handle,result.revision);back(result); });
  }
  function match(item, back) {
    var token = MediaStore.tmdbToken();
    if (!token) { U.toast('Add your TMDB token in Settings > My media.'); return; }
    UI.confirm('Search TMDB for this show?  Its title is sent to TMDB using your saved token.', 'Search',function () {
      UI.prompt('Show title',item.title,function (title) {
        var lookupVersion=++generation;
        Media.request('metadata',{kind:'tv',title:title,credential:token,language:MediaStore.preferences().language},30000).then(function (r) {
          if(lookupVersion!==generation)return;
          if (r.error) return U.toast(r.message,6000);
          UI.menu('Choose matching show',(r.matches || []).map(function (candidate) { return {label:candidate.title+' '+candidate.year,action:function () {
            var detailVersion=++generation;
            Media.request('metadata',{id:candidate.id,credential:token,language:MediaStore.preferences().language},30000).then(function (details) {
              if(detailVersion!==generation)return;
              if (details.error) return U.toast(details.message,6000);
              edit(item,'setMetadata',{metadata:details.metadata},function (saved) { if(saved.mergedInto)item.handle=saved.mergedInto;enrich(item.handle,details.metadata.id,back); });
            },function (e) { U.toast(e.message,6000); });
          }}; }),back);
        },function (e) { U.toast(e.message,6000); });
      });
    });
  }
  function enrich(handle, id, back) {
    request('detail',{kind:'show',handle:handle},function (show) {
      var at = 0;
      function next() {
        if (at === show.buckets.length || show.order !== 'aired') return back();
        var season = +show.buckets[at++].key;
        var lookupVersion=generation;
        Media.request('metadata',{id:id,season:season,credential:MediaStore.tmdbToken(),language:MediaStore.preferences().language},30000).then(function (r) {
          if(lookupVersion!==generation)return;
          if (r.error) { U.toast(r.message,6000); return back(); }
          request('detail',{kind:'show',handle:handle},function (current) {
            edit(current,'setSeasonMetadata',{metadata:r.metadata},next);
          });
        },function (e) { U.toast(e.message,6000); back(); });
      }
      next();
    });
  }
  function preferredVersion(ep,source){
    var versions=ep.versions||[],selected=null;
    versions.some(function(v){if(v.handle===ep.preferredVersion){selected=v;return true;}return false;});if(selected)return selected;
    var local=versions.filter(function(v){return v.sourceId===source;});if(local.length===1)return local[0];
    var preferred=MediaStore.preferredSource&&MediaStore.preferredSource();var ranked=versions.filter(function(v){return v.sourceId===preferred;});if(ranked.length===1)return ranked[0];
    return versions.length===1?versions[0]:null;
  }
  function completed(file,handoff) {
    if (!file || !file.episodeHandle) return false;
    function finish(){if(handoff)return handoff.cancel();if(file.returnTo)return file.returnTo();open();}
    function launch(detail){
      var version=preferredVersion(detail,file.src);
      if(!version){detail.beforePlay=handoff&&function(chosen,ep){var range=(chosen.boundaries||[]).filter(function(r){return r.episode===ep.handle;})[0];if(chosen.handle===file.id&&range&&Math.abs(range.startSec-file.endSec)<0.1){ep.originPage=origin(ep);handoff.continue(ep,range);return false;}handoff.stop();return true;};detail.originPage=finish;return showEpisode(detail,finish);}
      var range=(version.boundaries||[]).filter(function(r){return r.episode===detail.handle;})[0];
      if(handoff&&version.handle===file.id&&range&&Math.abs(range.startSec-file.endSec)<0.1){detail.originPage=origin(detail);return handoff.continue(detail,range);}
      if(handoff)handoff.stop();detail.originPage=origin(detail);playVersion(version,detail);
    }
    request('detail',{kind:'episode',handle:file.episodeHandle},function (current) {
      edit(file.segmented ? current : {handle:file.id,revision:current.revision},file.segmented ? 'setWatched' : 'completeFile',{watched:true,playback:true,baseWatchRevision:file.libraryRevision,playStartedAt:file.playStartedAt},function () {
        request('query',{kind:'episode',show:file.showId,after:file.episodeHandle,excludeFile:file.segmented ? null : file.id,skipWatched:file.sequenceIntent!=='sequential',limit:1},function (r) {
          var next = r.items[0];
          if (!next || (file.season === 0 && next.season !== 0) || (file.season !== 0 && next.season === 0)) return finish();
          var gap = next.gapBefore === true;
          var expected = generation, start = function () { clearTimeout(nextTimer); nextTimer = null; next.originPage=finish;showEpisode(next,finish); };
          UI.menu(gap ? 'An episode is missing' : 'Next episode',[
            {label:'Play '+episodeLabel(next),action:function () { clearTimeout(nextTimer); request('detail',{kind:'episode',handle:next.handle},function (detail) { launch(detail); }); }},
            {label:'Return to episodes',action:function () { clearTimeout(nextTimer); nextTimer = null; finish(); }}
          ],function () { clearTimeout(nextTimer); nextTimer = null; finish(); });
          if (!gap && Store.settings.autoNext !== false) {
            U.toast('Next episode in 5 seconds.  Back cancels.',5000);
            nextTimer = setTimeout(function () {
              nextTimer = null; if (expected !== generation) return;
              UI.close(); request('detail',{kind:'episode',handle:next.handle},function (detail) { launch(detail); });
            },5000);
          }
        });
      });
    });
    return true;
  }
  function episodeLabel(item) {
    if (item.kind !== 'episode') return item.metadata && item.metadata.title || item.title || item.label;
    var number = item.airDate || (item.absoluteNumber != null ? String(item.absoluteNumber) + (item.absolutePart ? '.' + item.absolutePart : '') : 'S' + item.season + 'E' + item.number);
    return number + '  ' + (item.metadata && item.metadata.title || item.title || '') + (item.watchState === 'watched' ? '  ✓' : '');
  }
  function origin(ep){return function(){request('detail',{kind:'show',handle:ep.showId},function(showRecord){var bucket=showRecord.displayOrder&&showRecord.displayOrder!=='aired'?'Episodes':ep.order==='date'?ep.airDate.slice(0,4):ep.order==='absolute'?'Episodes':String(ep.season);var q={kind:'episode',show:ep.showId,bucket:bucket,limit:60};pageFocus[showRecord.title+'|'+JSON.stringify(q)]=ep.handle;page(showRecord.title,q,showEpisode,function(){show({handle:ep.showId},open);});});};}
  function playVersion(v, episode, acceptCombined) {
    if(v.availability==='missing')return U.toast('This file is no longer on the server.  Rescan once it is back.',6000);
    if(episode.beforePlay){var before=episode.beforePlay;episode.beforePlay=null;if(before(v,episode)===false)return;}
    clearTimeout(nextTimer); nextTimer = null;
    var selectedRange = (v.boundaries || []).filter(function (range) { return range.episode === episode.handle; })[0];
    if(!selectedRange&&!v.chapterChecked&&v.detected&&(v.detected.numbers||[]).length>1){
      var source=MediaStore.source(v.sourceId);if(!source)return U.toast('This source was removed.');
      v.chapterChecked=true;var expected=++generation;U.toast('Checking episode chapters…');
      Media.request('library/chapters',{handle:v.handle,source:source},15000).then(function(result){
        if(expected!==generation)return;
        var numbers=v.detected.numbers,chapterRows=result.chapters||[],ranges=[],valid=!result.error&&numbers.length===(v.coveredEpisodes||[]).length;
        numbers.forEach(function(number,index){
          var marker=new RegExp('(?:^|[ ._-])(?:s0*'+v.detected.season+'[ ._-]*e0*'+number+'|(?:episode|ep)[ ._-]*0*'+number+')(?:$|[ ._-])','i');
          var matches=chapterRows.filter(function(chapter){return marker.test(chapter.name||'');});
          if(matches.length!==1||!isFinite(matches[0].startSec)||(ranges.length&&matches[0].startSec<=ranges[ranges.length-1].startSec)){valid=false;return;}
          ranges.push({episode:v.coveredEpisodes[index],startSec:matches[0].startSec,endSec:null});
        });
        if(!valid||ranges.length!==numbers.length)return playVersion(v,episode,acceptCombined);
        ranges.forEach(function(range,index){if(index+1<ranges.length)range.endSec=ranges[index+1].startSec;});
        request('detail',{kind:'episode',handle:episode.handle},function(current){request('edit',{operation:'setBoundaries',handle:v.handle,expectedRevision:current.revision,ranges:ranges},function(saved){v.boundaries=ranges;episode.revision=saved.revision;playVersion(v,episode,acceptCombined);});});
      },function(){if(expected===generation)playVersion(v,episode,acceptCombined);});return;
    }
    if (!acceptCombined && !selectedRange && v.detected && (v.detected.numbers || []).length > 1) {
      UI.menu('Episodes share one file', [{label:'Play combined file',sub:'The start of this episode is not known.',action:function () { playVersion(v,episode,true); }},{label:'Set episode start',action:function () { boundaries(v,episode,function () { showEpisode(episode,open); }); }}],open); return;
    }
    var src = MediaStore.source(v.sourceId);
    if(episode.preferredVersion!==v.handle)Media.request('library/edit',{operation:'setPreferredVersion',handle:episode.handle,version:v.handle,expectedRevision:episode.revision},30000).catch(function(){});
    if (!src) { U.toast('This source was removed.'); return; }
    request('resolve',{handle:v.handle,source:src},function (r) {
      Media.playFile({id:v.handle,resumeKey:r.resumeKey,returnTo:episode.originPage||origin(episode),title:episodeLabel(episode),file:v.label || v.title,src:v.sourceId,url:r.url,kind:'episode',episodeHandle:episode.handle,showId:episode.showId,season:episode.season,number:episode.number,order:episode.order,sequenceIntent:episode.watchState==='watched'?'sequential':'unwatched',libraryRevision:episode.revision,startSec:selectedRange ? selectedRange.startSec : 0,endSec:selectedRange ? selectedRange.endSec : null,segmented:!!selectedRange},false);
    });
  }
  function boundaries(version, ep, back) {
    function save(start) {
      start = +start;
      if (!isFinite(start) || start < 0) return U.toast('Enter a time in seconds, starting at zero.');
      var ranges = (version.boundaries || []).filter(function (r) { return r.episode !== ep.handle; });
      ranges.push({episode:ep.handle,startSec:start,endSec:null}); ranges.sort(function (a,b) { return a.startSec-b.startSec; });
      ranges.forEach(function (r,i) { if (i+1<ranges.length) r.endSec=ranges[i+1].startSec; });
      edit({handle:version.handle,revision:ep.revision},'setBoundaries',{ranges:ranges},back);
    }
    var options = [
      {label:'Enter episode start',sub:'Seconds from the beginning of the file',action:function () { UI.prompt('Episode start in seconds','0',save); }},
      {label:'Choose chapter',action:function () {
        var source = MediaStore.source(version.sourceId); if (!source) return U.toast('Source removed.');
        request('chapters',{handle:version.handle,source:source},function (r) {
          if (!r.chapters || !r.chapters.length) { U.toast(r.message || 'No usable chapters.  Enter the start manually.',6000); return boundaries(version,ep,back); }
          UI.menu('Choose episode start',r.chapters.map(function (chapter) { return {label:chapter.name || 'Chapter',sub:chapter.startSec+' seconds',action:function () { save(chapter.startSec); }}; }),function () { boundaries(version,ep,back); });
        });
      }},
      {label:'Back',action:back}
    ];
    if (Media.currentFile && Media.currentFile() === version.handle) options.unshift({label:'Use current playback position',action:function () { save(Player.position); }});
    UI.menu('Episode boundaries',options,back);
  }
  function showEpisode(item, back) {
    request('detail',{kind:'episode',handle:item.handle},function (r) {
      r.originPage=item.originPage||back;r.beforePlay=item.beforePlay;
      var options = r.versions.map(function (v) { return {label:'Play: ' + ((MediaStore.source(v.sourceId) || {}).name || 'Source'),sub:v.label,action:function () { playVersion(v,r); }}; });
      r.versions.forEach(function (v) { options.push({label:'Episode start: '+((MediaStore.source(v.sourceId) || {}).name || 'Version'),action:function () { boundaries(v,r,function () { showEpisode(item,back); }); }}); });
      options.push({label:r.watchState === 'watched' ? 'Mark unwatched' : 'Mark watched',action:function () { edit(r,'setWatched',{watched:r.watchState !== 'watched'},function () { showEpisode(item,back); }); }});
      options.push({label:'Back',action:back}); UI.menu(RAW(episodeLabel(r)),options,back);
    });
  }
  function mergeShow(item, back) {
    page('Merge with show',{kind:'show',limit:60},function (target) {
      if(target.handle===item.handle)return U.toast('Choose a different show.');
      request('edit',{operation:'mergeShows',handle:item.handle,target:target.handle,expectedRevision:item.revision,preview:true},function (preview) {
        UI.confirm('Merge '+preview.from+' into '+preview.to+'?  '+preview.count+' files will be grouped together.','Merge',function () {
          request('edit',{operation:'mergeShows',handle:item.handle,target:target.handle,expectedRevision:preview.revision},open);
        });
      });
    },back);
  }
  function groupOrder(item, back) {
    if(!item.metadata)return U.toast('Match this show with TMDB first.');
    Media.request('metadata',{id:item.metadata.id,groups:true,credential:MediaStore.tmdbToken()},30000).then(function (r) {
      if(r.error)return U.toast(r.message,6000);
      UI.menu('Episode order',(r.groups||[]).map(function(group){return {label:group.name,sub:group.description,action:function(){
        Media.request('metadata',{id:item.metadata.id,groupId:group.id,credential:MediaStore.tmdbToken()},30000).then(function(result){
          if(result.error)return U.toast(result.message,6000);
          request('edit',{operation:'setEpisodeGroup',handle:item.handle,expectedRevision:item.revision,group:result.group},back);
        },function(e){U.toast(e.message,6000);});
      }};}),back);
    },function(e){U.toast(e.message,6000);});
  }
  function show(item, back) {
    request('detail',{kind:'show',handle:item.handle},function (r) {
      var options = r.buckets.map(function (bucket) { return {label:bucket.title || (r.order === 'aired' && (!r.displayOrder || r.displayOrder === 'aired') ? bucket.key === '0' ? 'Specials' : 'Season ' + bucket.key : bucket.key),sub:bucket.count + ' episodes',action:function () { page(r.title,{kind:'episode',show:r.handle,bucket:bucket.key,limit:60},showEpisode,function () { show(item,back); }); }}; });
      options.push({label:r.favourite ? 'Remove favourite' : 'Add favourite',action:function () { edit(r,'setFavourite',{favourite:!r.favourite},function () { show(item,back); }); }});
      options.push({label:'Merge with another show',action:function(){mergeShow(r,function(){show(item,back);});}});
      options.push({label:'Preferred source for every show',action:function(){UI.menu('Preferred source for every show',MediaStore.sources().map(function(source){return {label:source.name,action:function(){MediaStore.sourcePreference(source.id);show(item,back);}};}),function(){show(item,back);});}});
      options.push({label:'Episode order',action:function(){groupOrder(r,function(){show(item,back);});}});
      (r.mergedFrom||[]).forEach(function(m){options.push({label:'Separate '+m.title,action:function(){request('edit',{operation:'unmergeShows',handle:r.handle,mergeHandle:m.operation,expectedRevision:r.revision},open);}});});
      options.push({label:'Find show details',action:function () { match(r,function () { show({handle:r.handle},back); }); }});
      if (r.metadata) options.push({label:'Remove show details',action:function () { edit(r,'setMetadata',{metadata:null},function () { show(item,back); }); }});
      // The same screen-wide shortcut a movie's options have: files that need a look, when there are any.
      if (Media.reviewCount && Media.reviewCount() > 0) options.push({label:'Needs review',action:function(){review();}});
      options.push({label:'Back',action:back}); UI.menu(RAW(r.metadata && r.metadata.title || r.title),options,back);
    });
  }
  function open() { page('TV shows',MediaStore.preferences().favoritesInLists===false?{kind:'show',favourite:false,limit:60}:{kind:'show',limit:60},show,Media.restore); }
  function locate(item,back){
    page('Choose replacement file',{kind:'files',availableOnly:true,limit:60},function(replacement){
      request('edit',{operation:'relinkFile',handle:item.handle,target:replacement.handle,expectedRevision:item.revision,preview:true},function(preview){
        UI.confirm('Use '+preview.to+' for '+preview.from+'?  The original file identity and history are retained.','Relink',function(){request('edit',{operation:'relinkFile',handle:item.handle,target:replacement.handle,expectedRevision:preview.revision},back);});
      });
    },back);
  }
  function excluded(){page('Excluded files',{kind:'extra',limit:60},correct,Media.restore);}
  function correct(item, back) {
    var detected = item.detected || {};
    function folder(fields,reset){
      request('edit',{operation:'previewCorrection',folderOf:item.handle,fields:fields,resetFolder:!!reset,expectedRevision:item.revision},function(preview){
        UI.confirm(preview.count+' files will be updated.  Explicit file corrections stay in place.','Save',function(){request('edit',{operation:'commitPreview',previewToken:preview.previewToken,expectedRevision:preview.revision},function(saved){UI.menu('Correction saved',[{label:'Undo',action:function(){request('edit',{operation:'undoEdit',undoHandle:saved.undoHandle,expectedRevision:saved.revision},back);}},{label:'Done',action:back}],back);});});
      });
    }
    function save(fields) { UI.menu('Apply correction',[{label:'This file',action:function(){edit(item,'classifyFile',{fields:fields},back);}},{label:'This folder',action:function(){folder(fields,false);}}],back); }
    UI.menu('Correct '+(item.label || item.title),[
      {label:'Movie',action:function () { save({kind:'movie'}); }},
      {label:'TV episode',action:function () {
        UI.prompt('Show title',detected.showTitle || '',function (name) {
          if (!name.trim()) return U.toast('Enter a show title.');
          UI.menu('Episode numbering',[
            {label:'Season and episode',action:function () {
              UI.prompt('Season number (0 for Specials)',detected.season == null ? '' : String(detected.season),function (season) {
                if (!/^\d{1,3}$/.test(season)) return U.toast('Enter a valid season.');
                UI.prompt('Episode numbers, separated by commas',(detected.numbers || []).join(','),function (numbers) {
                  if (!/^[1-9]\d*(?:\s*,\s*[1-9]\d*)*$/.test(numbers)) return U.toast('Enter episode numbers such as 1,2.');
                  save({kind:'episode',showTitle:name.trim(),order:'aired',season:+season,numbers:numbers.split(',').map(function (n) { return +n; })});
                });
              });
            }},
            {label:'Absolute number',action:function () { UI.prompt('Absolute episode number',String(detected.absoluteNumber || ''),function (number) { if (!/^[1-9]\d*$/.test(number)) return U.toast('Enter a valid episode number.'); save({kind:'episode',showTitle:name.trim(),order:'absolute',absoluteNumber:+number,season:null,numbers:[]}); }); }},
            {label:'Air date',action:function () { UI.prompt('Air date YYYY-MM-DD',detected.airDate || '',function (date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return U.toast('Enter a valid air date.'); save({kind:'episode',showTitle:name.trim(),order:'date',airDate:date,season:null,numbers:[]}); }); }}
          ],back);
        });
      }},
      {label:'Extra / hide',action:function () { save({kind:'extra'}); }},
      {label:'Reset folder correction',action:function(){folder({},true);}},
      {label:'Reset correction',action:function () { edit(item,'resetOverride',{},back); }},
      {label:'Back',action:back}
    ],back);
  }
  function review() { page('Needs review',{kind:'review',limit:60},function (item,back) { UI.menu(RAW(item.label || item.title),[{label:(item.review || []).join(', ')},item.availability==='missing'&&{label:'Locate file',action:function(){locate(item,back);}},{label:'Correct details',action:function () { correct(item,back); }},{label:'Back',action:back}],back); },Media.restore); }
  function phoneRequest(route,q) { return Media.request('library/'+route,q,30000).then(function (r) { if (r.error) throw new Error(r.message); return r; }); }
  function recordCompletion(file) {
    function commit(retry) {
      return phoneRequest('detail',{kind:'episode',handle:file.episodeHandle}).then(function (ep) {
        if(ep.watchOrigin==='manual'&&(ep.watchRevision||0)>(file.libraryRevision||0)&&(ep.watchManualAt||0)>=(file.playStartedAt||0))return {ignored:true};
        return phoneRequest('edit',{handle:file.segmented ? ep.handle : file.id,expectedRevision:ep.revision,operation:file.segmented ? 'setWatched' : 'completeFile',watched:true,playback:true,baseWatchRevision:file.libraryRevision,playStartedAt:file.playStartedAt});
      }).catch(function (e) { if (retry) return commit(false); U.toast('Could not save watched state.  Your resume position is kept.',6000); });
    }
    return commit(true);
  }
  var phone = {
    query:function (a) { var q = {}; ['kind','show','bucket','q','cursor'].forEach(function (k) { if (a[k] !== undefined) q[k] = a[k]; }); q.limit = Math.max(1,Math.min(100,+a.limit || 60)); return phoneRequest('query',q); },
    detail:function (kind,handle) { return phoneRequest('detail',{kind:kind,handle:handle}); },
    edit:function (a) { if (a.operation !== 'setWatched' && a.operation !== 'setFavourite') return Promise.reject(new Error('Use the TV or web editor for that correction.')); return phoneRequest('edit',{handle:a.handle,expectedRevision:a.expectedRevision,operation:a.operation,watched:a.watched,favourite:a.favourite}).then(function(r){if(a.operation==='setWatched'&&!a.watched&&Media.watchedReset)Media.watchedReset(a.handle,r.revision);return r;}); },
    play:function (a) {
      MediaSeries.leave(); var expected = generation;
      return phoneRequest('detail',{kind:'episode',handle:a.handle}).then(function (ep) {
        if (expected !== generation) throw new Error('Playback was cancelled.');
        var versions = ep.versions.filter(function (v) { return !a.version || v.handle === a.version; });
        if (versions.length !== 1) throw new Error('Choose a version before playing.');
        var v = versions[0], src = MediaStore.source(v.sourceId);
        if (!src) throw new Error('That source was removed.');
        return phoneRequest('resolve',{handle:v.handle,source:src}).then(function (resolved) {
          if (expected !== generation) throw new Error('Playback was cancelled.');
          if (Views.tab !== 'media') Views.switchTab('media');
          if (Views.closeNav) Views.closeNav(); UI.close(); Media.open(true);
          Media.playFile({id:v.handle,resumeKey:resolved.resumeKey,returnTo:origin(ep),title:episodeLabel(ep),file:v.label,src:v.sourceId,url:resolved.url,kind:'episode',episodeHandle:ep.handle,showId:ep.showId,season:ep.season,number:ep.number,order:ep.order,sequenceIntent:ep.watchState==='watched'?'sequential':'unwatched',libraryRevision:ep.revision},!!a.fromStart);
          return {title:episodeLabel(ep)};
        });
      });
    }
  };
  return {fetchDetails:fetchDetails,excluded:excluded,resume:function(card){request('detail',{kind:'episode',handle:card.continueEpisode},function(ep){var v=ep.versions.filter(function(version){return version.handle===card.continueFile;})[0];if(v)playVersion(v,ep);else showEpisode(ep,open);});},showItem:show,correct:correct,recordCompletion:recordCompletion,phone:phone,open:open,review:review,completed:completed,leave:function () { generation++; if (Media.cancelPending) Media.cancelPending(); clearTimeout(nextTimer); nextTimer = null; }};
})();
