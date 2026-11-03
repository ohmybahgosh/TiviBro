/* Classification contracts: physical observations remain independent of metadata and playback. */
'use strict';
var assert = require('assert'), C = require('../../service/media-classify'), count = 0;
function check(name, run) { run(); count++; console.log('PASS ' + name); }
function classify(file, ancestors, options, overrides) { return C.classify({ basename: file, ancestors: ancestors || [] }, options, overrides); }
check('C01 root movie', function () { assert.equal(classify('Amber.Road.2021.mkv').kind, 'movie'); });
['Harbour.S01E02.mkv', 'Harbour S1 E2.mp4', 'Harbour 1x02.mkv'].forEach(function (file) { check('C04/C05 ' + file, function () { var r = classify(file); assert.equal(r.showTitle, 'Harbour'); assert.equal(r.season, 1); assert.deepEqual(r.numbers, [2]); assert.deepEqual(r.review, []); }); });
check('C06 ancestor season and show', function () { var r = classify('Episode 02.mkv', ['Library', 'Harbour', 'Season 1']); assert.equal(r.showTitle, 'Harbour'); assert.equal(r.season, 1); assert.deepEqual(r.numbers, [2]); });
check('C07 unknown season never defaults to one', function () { var r = classify('Episode 02.mkv'); assert.equal(r.season, null); assert(r.review.indexOf('missingSeason') >= 0); assert(r.review.indexOf('missingShow') >= 0); });
check('C08 numbered file needs context', function () { assert.deepEqual(classify('02 - Return.mkv', ['Harbour', 'Season 1']).numbers, [2]); assert.equal(classify('02 - Return.mkv').kind, 'movie'); });
check('C09 conflicting season retained', function () { assert(classify('Harbour.S03E02.mkv', ['Harbour', 'Season 2']).review.indexOf('conflictingSeason') >= 0); });
check('C10 specials are season zero', function () { assert.equal(classify('S00E01.mkv', ['Harbour', 'Specials']).season, 0); });
['Harbour.S01E01E02.mkv', 'Harbour.S01E01-E02.mkv', 'Harbour.1x01-02.mkv'].forEach(function (file) { check('C12 coverage ' + file, function () { assert.deepEqual(classify(file).numbers, [1, 2]); }); });
check('C13 range work bounded', function () { assert(classify('Harbour.S01E01-E9999.mkv').review.indexOf('invalidEpisodeRange') >= 0); assert(classify('Harbour.S01E03-E01.mkv').review.indexOf('invalidEpisodeRange') >= 0); });
['Star.Wars.Episode.IV.1977.mkv', 'Film.57.mkv', 'Movie.2160p.x265.5.1.mkv'].forEach(function (file) { check('C14/C15 movie ' + file, function () { assert.equal(classify(file).kind, 'movie'); }); });
check('C16 small episode not rejected', function () { assert.equal(C.classify({ basename: 'Harbour.S01E02.mkv', size: 1024 }).kind, 'episode'); });
check('C17 explicit inclusion', function () { assert.equal(classify('sample.mkv', [], {}, [{ kind: 'movie' }]).kind, 'movie'); });
check('C18 structured absolute release', function () { var r = classify('[DemoGroup] Moon Courier - 057 [1080p].mkv'); assert.equal(r.kind, 'episode'); assert.equal(r.absoluteNumber, 57); assert.equal(r.season, null); assert.equal(r.showTitle, 'Moon Courier'); });
check('C19 absolute correction', function () { assert.equal(classify('Moon Courier - 057.mkv').kind, 'unclassified'); assert.equal(classify('Moon Courier - 057.mkv', [], {}, [{ order: 'absolute' }]).kind, 'episode'); });
check('C20 decimal special retained', function () { var r = classify('[Group] Moon Courier - 012.5.mkv'); assert.equal(r.absoluteNumber, 12); assert.equal(r.absolutePart, '5'); });
check('C21 date identity', function () { var r = classify('Daily.Window.2026-10-31.mkv', ['Daily Window']); assert.equal(r.airDate, '2026-10-31'); assert.equal(r.kind, 'episode'); assert.equal(r.season, null); });
check('C22/C23 calendar validation', function () { assert(!C.validDate(2026, 2, 30)); assert(C.validDate(2024, 2, 29)); assert(!C.validDate(2025, 2, 29)); });
check('C24 standalone footage uncertain', function () { assert.notEqual(classify('2026-10-31.mp4').kind, 'episode'); });
check('C26 structured server does not invent season', function () { var r = C.classify({ basename: 'video.mkv', server: { validated: true, showTitle: 'Harbour', number: 2 } }); assert.equal(r.kind, 'episode'); assert.equal(r.season, null); assert(r.review.indexOf('missingSeason') >= 0); });
check('C27 unvalidated server ignored', function () { assert.equal(C.classify({ basename: 'video.mkv', server: { showTitle: 'Harbour', number: 2 } }).kind, 'movie'); });
check('C28 unicode preserved', function () { assert.equal(classify('港.S01E02.mkv').showTitle, '港'); });
check('C29/C30 ordered overlays do not mutate input', function () { var a = [{ season: 2 }, { season: 3 }], r = classify('Harbour.S01E01.mkv', [], {}, a); assert.equal(r.season, 3); assert.equal(a[0].season, 2); });
check('C24 date-only footage folder remains uncertain', function () { assert.notEqual(classify('2026-10-31.mp4', ['Footage']).kind, 'episode'); });
check('invalid user coordinates remain reviewable', function () { var r = classify('Harbour.S01E01.mkv', [], {}, [{season: -1, numbers: [0, 1, 1]}]); assert(r.review.indexOf('invalidSeason') >= 0); assert(r.review.indexOf('invalidEpisodeNumber') >= 0); });
// A year after " - " is the movie's year, not absolute episode 2001 (Needs review would swallow movies).
["Title - 2001.mkv", "Ocean's Eleven - 2001.mkv", 'Up - 2009.mp4', 'Top Gun - Maverick - 2022.mkv', 'Back to the Future Part II - 1989.mkv'].forEach(function (file) { check('year is not an absolute number: ' + file, function () { var r = classify(file); assert.equal(r.kind, 'movie'); assert.equal(r.review.indexOf('uncertainAbsoluteOrder'), -1); assert.equal(r.absoluteNumber, undefined); }); });
check('a year still counts in an absolute-order source', function () { assert.equal(classify('Moon Courier - 2001.mkv', [], { order: 'absolute' }).absoluteNumber, 2001); });
check('absolute numbers that are not years still count', function () { assert.equal(classify('[Group] Moon Courier - 1850.mkv').absoluteNumber, 1850); });
// NxNN takes a one or two digit season: a resolution is not season 720.
['Film 720x480.avi', 'Film.1920x1080.mkv', 'Clip 640x360.mp4'].forEach(function (file) { check('resolution is not an episode: ' + file, function () { var r = classify(file); assert.equal(r.kind, 'movie'); assert.equal(r.season, null); }); });
check('12x05 is still an episode', function () { var r = classify('Harbour 12x05.mkv'); assert.equal(r.season, 12); assert.deepEqual(r.numbers, [5]); });
// "E01 - Pilot" inside a season folder.
['E01 - Pilot.mkv', 'E01.mkv', 'Harbour E01 Pilot.mkv'].forEach(function (file) { check('season folder episode: ' + file, function () { var r = classify(file, ['Harbour', 'Season 1']); assert.equal(r.kind, 'episode'); assert.equal(r.showTitle, 'Harbour'); assert.equal(r.season, 1); assert.deepEqual(r.numbers, [1]); assert.deepEqual(r.review, []); }); });
check('E01 outside a season folder is not guessed', function () { assert.notEqual(classify('E01 - Pilot.mkv').kind, 'episode'); });
// Ordinary movie names stay movies.
['Amber.Road.2021.mkv', 'Blade Runner 2049 (2017).mkv', '2001 A Space Odyssey (1968).mkv', '1917 (2019).mkv', 'Apollo 13 (1995).mkv', 'Se7en (1995).mkv', "Ocean's 8 (2018).mkv", 'The.Matrix.1999.1080p.BluRay.x264.mkv',
  'Zero Dark Thirty 2012 1080p.mkv', 'Kill Bill Vol 1 (2003).mkv', 'District 9 (2009).mkv', 'Fantastic 4 (2015).mkv', '21 Jump Street (2012).mkv', 'S.W.A.T. (2003).mkv', 'Spider-Man - No Way Home - 2021.mkv', 'Film 1280x720.mp4',
  'Mission - Impossible (1996).mkv', 'Rocky II 1979.mkv', 'Ep.mkv', 'Episodes of Life (2010).mkv'].forEach(function (file) { check('stays a movie: ' + file, function () { var r = classify(file, ['Movies']); assert.equal(r.kind, 'movie', JSON.stringify(r)); assert.deepEqual(r.review, []); }); });
check('a user correction clears what was missing', function () { var r = classify('Clip.mkv', ['Harbour', 'Season 2'], {}, [{ kind: 'episode', showTitle: 'Harbour', season: 2, numbers: [1], order: 'aired' }]); assert.equal(r.kind, 'episode'); assert.deepEqual(r.review, []); });
console.log(count + ' classification contracts passed');
