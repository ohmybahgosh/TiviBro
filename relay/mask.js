/* Logins out of anything that ends up public: problem reports through the relay (worker.js), and every
   issue, comment and discussion on GitHub, whoever wrote it (scripts/mask-issues.mjs, the Mask logins
   workflow).  The TV masks its own log too (app/js/log.js redact), but an older TiviBro, a log pasted by
   hand or a link in a comment may not have been.  Issue #25 showed the gap: the short Xtream links many
   M3U lists use, http://server/user/pass/12345.ts, went out with the login in them.
   What goes: logins in query strings (username=, password=, token=, api_key= ...), user:pass@ in a link,
   the two login parts of Xtream stream links (/live/, /movie/, /series/, /timeshift/ and the short form)
   with the provider's server name, the helper's control key ("ctl" in the log), and server names in the
   helper's network errors.  Plain ES module. */
const QUERY = /([?&](?:username|user|password|pass|pwd|token|access_token|api_key|apikey|auth|sig|signature|key)=)[^&\s"'<>)\]]+/gi;
const USERINFO = /\/\/([^/\s:@"'<>]+):([^/\s@"'<>]+)@/g;
const XTREAM = /(\b[a-z][a-z0-9+.-]*:\/\/)(<[a-z]+>(?::\d+)?|[^/\s"'<>)\]]+)\/(live|movie|series|timeshift)\/[^/\s"'<>)\]]+\/[^/\s"'<>)\]]+\//gi;
const SHORT = /(\b[a-z][a-z0-9+.-]*:\/\/)(<[a-z]+>(?::\d+)?|[^/\s"'<>)\]]+)\/[^/\s"'<>?#)\]]+\/[^/\s"'<>?#)\]]+\/(\d+(?:\.[a-z0-9]{2,5})?)(?=[\s"'<>?#)\]]|$)/gim;
// (A server name can be one masked already: <provider>:80.)
const CTL = /("ctl"\s*:\s*")[0-9a-f]{8,}(")/gi;
/* Server names in network errors from the TV's helper (Node): "getaddrinfo ENOTFOUND line.example.top",
   "connect ECONNREFUSED 203.0.113.7:443", and certificate errors ("Host: x.example. is not in the cert's
   altnames: DNS:a.example").  A name typed on the first screen and never saved went out like this (issue #93). */
const NETERR = /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL)\s+([a-z0-9-]+(?:\.[a-z0-9-]+)+)(:\d+)?/gi;
const CERT = /(\b(?:Host|IP):\s*)([a-z0-9-]+(?:\.[a-z0-9-]+)+)(\.?\s+is not in the cert)/gi;
const ALT = /\b(DNS|IP Address):([a-z0-9*-]+(?:\.[a-z0-9-]+)+)/gi;
/* Any other public IPv4 address, wherever it is (a server typed as an address, a DNS server, the TV's own
   public address in an error).  Not a version number: "Chrome/87.0.4280.88" has a slash or letter in front. */
const IPV4 = /(^|[^\w./:-])((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})(?![\w.-])/g;
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
    .replace(CTL, '$1***$2')
    .replace(NETERR, (m, code, h, port) => KEEP.test(h) ? m : code + ' <server>' + (port || ''))
    .replace(CERT, (m, a, h, b) => KEEP.test(h) ? m : a + '<server>' + b)
    .replace(ALT, (m, a, h) => KEEP.test(h.replace(/^\*\./, '')) ? m : a + ':<server>')
    .replace(IPV4, (m, pre, ip) => KEEP.test(ip) || /^(0\.|169\.254\.|255\.)/.test(ip) ? m : pre + '<address>');
}
