/* Revisioned correction previews, durable folder rules and field-scoped undo.
   All mutations run through the catalogue's single writer.  ES5 / Node 0.12. */
'use strict';
var crypto=require('crypto'),Classifier=require('./media-classify');
function clone(v){return JSON.parse(JSON.stringify(v));}
function error(message,code){var e=new Error(message);e.code=code||'INVALID_EDIT';return e;}
function matches(rule,file){return rule.type==='folderRule' && rule.sourceId===file.sourceId && rule.ancestors.every(function(name,i){return (file.ancestors||[])[i]===name;});}
function classify(file,rules){
  var applicable=rules.filter(function(r){return matches(r,file);}).sort(function(a,b){return a.ancestors.length-b.ancestors.length || a.sequence-b.sequence;}).map(function(r){return r.fields;});
  if(file.override)applicable.push(file.override);
  return Classifier.classify({basename:file.file,ancestors:file.ancestors,server:file.server},{order:file.classification && file.classification.order},applicable);
}
function fields(input){
  var out={};['kind','showTitle','season','numbers','order','airDate','absoluteNumber','absolutePart','title'].forEach(function(k){if(Object.prototype.hasOwnProperty.call(input||{},k))out[k]=clone(input[k]);});return out;
}
function run(catalog,q,cb){
  catalog.previews=catalog.previews||{};
  catalog.serial(function(done){
    var revision=catalog.library.manifest.revision;
    if(q.expectedRevision!==revision)return done(error('The library changed.  Refresh the preview.','CONFLICT'));
    catalog.records('files',function(e,files){if(e)return done(e);
      catalog.records('shows',function(e2,shows){if(e2)return done(e2);
        catalog.records('episodes',function(e3,episodes){if(e3)return done(e3);
          catalog.records('overrides',function(e4,journal){if(e4)return done(e4);
            var now=Date.now(),patches=[],rule=null,removedRules=[];
            Object.keys(catalog.previews).forEach(function(k){if(catalog.previews[k].expires<now)delete catalog.previews[k];});
            if(q.operation==='previewCorrection'){
              var selected=(q.handles||[]),normalized=fields(q.fields),anchor=null;
              if(!Array.isArray(selected)||selected.length>1000)return done(error('Select at most 1,000 files at a time.'));
              if(q.folderOf)files.some(function(f){if(f.handle===q.folderOf){anchor=f;return true;}return false;});
              if(q.folderOf&&!anchor)return done(error('That folder is no longer available.'));
              if(anchor){rule={type:'folderRule',id:'rule_'+crypto.randomBytes(16).toString('hex'),sourceId:anchor.sourceId,ancestors:clone(anchor.ancestors||[]),fields:normalized,sequence:now};if(q.resetFolder){removedRules=journal.filter(function(r){return r.type==='folderRule'&&r.sourceId===anchor.sourceId&&JSON.stringify(r.ancestors)===JSON.stringify(anchor.ancestors||[]);});if(!removedRules.length)return done(error('This folder has no saved correction.'));}}
              var invalid=null;
              files.forEach(function(f){
                if(anchor?!matches(rule,f):selected.indexOf(f.handle)<0)return;
                // Folder rules must not overwrite more-specific manual file corrections.
                if(anchor&&f.override)return;
                var before=clone(f),after=clone(f);
                if(!anchor)after.override=normalized;
                var applicable=journal.filter(function(r){return removedRules.indexOf(r)<0;});after.classification=classify(after,rule&&!q.resetFolder?applicable.concat([rule]):applicable);after.kind=after.classification.kind;
                if(after.classification.review.some(function(r){return /^invalid/.test(r);}))invalid=error('One or more files would have invalid coordinates.');
                patches.push({handle:f.handle,before:{override:before.override||null,classification:before.classification,kind:before.kind},after:{override:after.override||null,classification:after.classification,kind:after.kind}});
              });
              if(invalid)return done(invalid);
              if(!patches.length)return done(error('No files match this selection.'));
              var token=crypto.randomBytes(16).toString('hex');catalog.previews[token]={revision:revision,patches:patches,rule:q.resetFolder?null:rule,removedRules:removedRules,expires:now+900000};
              var keys=Object.keys(catalog.previews);if(keys.length>20)delete catalog.previews[keys[0]];
              return done(null,{revision:revision,previewToken:token,count:patches.length,examples:patches.slice(0,10).map(function(p){return {handle:p.handle,before:p.before.classification,after:p.after.classification};})});
            }
            if(q.operation==='commitPreview'){
              var preview=catalog.previews[q.previewToken];
              if(!preview||preview.expires<now||preview.revision!==revision)return done(error('This preview expired.  Refresh it.','CONFLICT'));
              patches=preview.patches;rule=preview.rule;removedRules=preview.removedRules||[];journal=journal.filter(function(r){return !removedRules.some(function(removed){return removed.id===r.id;});});
            }else if(q.operation==='undoEdit'){
              var undo=null;journal.some(function(r){if(r.type==='undo'&&r.id===q.undoHandle){undo=r;return true;}return false;});
              if(!undo||undo.expires<now)return done(error('This undo is no longer available.'));
              var undoPatches=[];journal.forEach(function(r){if(r.type==='undoPart'&&r.undoId===undo.id)undoPatches=undoPatches.concat(r.patches);});
              for(var i=0;i<undoPatches.length;i++){
                var p=undoPatches[i],current=null;files.some(function(f){if(f.handle===p.handle){current=f;return true;}return false;});
                if(!current||JSON.stringify({override:current.override||null,classification:current.classification,kind:current.kind})!==JSON.stringify(p.after))return done(error('These fields changed again.  Review before undoing.','CONFLICT'));
                patches.push({handle:p.handle,before:p.after,after:p.before});
              }
              (undo.removedRules||[]).forEach(function(r){journal.push(r);});
              if(undo.ruleId)journal=journal.filter(function(r){return r.id!==undo.ruleId;});
            }else return done(error('Unknown correction operation.'));
            var patchById={};patches.forEach(function(p){patchById[p.handle]=p;});
            files.forEach(function(f){var p=patchById[f.handle];if(!p)return;if(p.after.override)f.override=p.after.override;else delete f.override;f.classification=p.after.classification;f.kind=p.after.kind;});
            if(rule)journal.push(rule);
            var undoId='undo_'+crypto.randomBytes(16).toString('hex');
            journal=journal.filter(function(r){return r.type!=='undo'||r.expires>now;});
            var oldUndos=journal.filter(function(r){return r.type==='undo';});
            if(oldUndos.length>=50){var remove=oldUndos.slice(0,oldUndos.length-49);journal=journal.filter(function(r){return remove.indexOf(r)<0;});}
            var liveUndo={};journal.forEach(function(r){if(r.type==='undo')liveUndo[r.id]=true;});journal=journal.filter(function(r){return r.type!=='undoPart'||liveUndo[r.undoId];});
            journal.push({type:'undo',id:undoId,ruleId:rule&&rule.id,removedRules:removedRules,expires:now+30*86400000});
            for(var part=0;part<patches.length;part+=50)journal.push({type:'undoPart',undoId:undoId,patches:patches.slice(part,part+50)});
            if(catalog.library.command)catalog.library.command.extra={undoHandle:undoId,changed:patches.length};
            var derived=require('./media-catalog').derive(files,shows,episodes);
            catalog.write({files:files,shows:derived.shows,episodes:derived.episodes,overrides:journal},function(err,newRevision){if(!err&&q.previewToken)delete catalog.previews[q.previewToken];done(err,{revision:newRevision,undoHandle:undoId,changed:patches.length});});
          });
        });
      });
    });
  },cb);
}
module.exports={run:run,classify:classify,matches:matches};
