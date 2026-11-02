/* Logins out of anything that ends up public: problem reports through the relay (worker.js), and every
   issue, comment and discussion on GitHub, whoever wrote it (scripts/mask-issues.mjs, the Mask logins
   workflow).  The TV masks its own log too (app/js/log.js redact), but an older TiviBro, a log pasted by
   hand or a link in a comment may not have been.  Issue #25 showed the gap: the short Xtream links many
   M3U lists use, http://server/user/pass/12345.ts, went out with the login in them.
   What goes: logins in query strings (username=, password=, token=, api_key= ...), user:pass@ in a link,
   the two login parts of Xtream stream links (/live/, /movie/, /series/, /timeshift/ and the short form)
   with the provider's server name, and the helper's control key ("ctl" in the log).  Plain ES module. */
const QUERY = /([?&](?:username|user|password|pass|pwd|token|access_token|api_key|apikey|auth|sig|signature|key)=)[^&\s"'<>)\]]+/gi;
const USERINFO = /\/\/([^/\s:@"'<>]+):([^/\s@"'<>]+)@/g;
const XTREAM = /(\b[a-z][a-z0-9+.-]*:\/\/)(<[a-z]+>(?::\d+)?|[^/\s"'<>)\]]+)\/(live|movie|series|timeshift)\/[^/\s"'<>)\]]+\/[^/\s"'<>)\]]+\//gi;
const SHORT = /(\b[a-z][a-z0-9+.-]*:\/\/)(<[a-z]+>(?::\d+)?|[^/\s"'<>)\]]+)\/[^/\s"'<>?#)\]]+\/[^/\s"'<>?#)\]]+\/(\d+(?:\.[a-z0-9]{2,5})?)(?=[\s"'<>?#)\]]|$)/gim;
// (A server name can be one masked already: <provider>:80.)
const CTL = /("ctl"\s*:\s*")[0-9a-f]{8,}(")/gi;
// Our own sites and well-known places keep their name: a link to them is never a login.
const KEEP = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|(.*\.)?(tivibro\.app|ohmybahgosh\.dev|github\.com|githubusercontent\.com|jsdelivr\.net|iptv-org\.github\.io)(:\d+)?$)/i;
// A name already masked keeps its port, so masking again changes nothing.
function host(h) { return KEEP.test(h) || h.charAt(0) === '<' ? h : '<provider>'; }

export function maskSecrets(s) {
  return String(s == null ? '' : s)
    .replace(QUERY, '$1***')
    .replace(USERINFO, '//***:***@')
    .replace(XTREAM, (m, scheme, h, kind) => scheme + host(h) + '/' + kind + '/***/***/')
    // The short form looks like plenty of ordinary links, so only one that looks like a stream: a port
    // on the server (IPTV panels nearly always have one) or a stream file at the end.
    .replace(SHORT, (m, scheme, h, id) => KEEP.test(h) || !(/:\d+$/.test(h) || /\.(ts|m3u8|mp4|mkv|avi)$/i.test(id)) ? m : scheme + host(h) + '/***/***/' + id)
    .replace(CTL, '$1***$2');
}
