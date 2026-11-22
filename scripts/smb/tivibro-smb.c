/*
 * tivibro-smb: a tiny SMB2/3 reader for TiviBro's network helper on LG webOS TVs.
 *
 * My media can read Windows and Samba shares (SMB) with it.  webOS won't let an app mount a share, so the
 * helper runs this program for each thing it needs, and it answers on stdout:
 *
 *   tivibro-smb check  <server[:port]> <share>              one JSON line: dialect, signing, encryption
 *   tivibro-smb shares <server[:port]>                      one JSON line per disk share
 *   tivibro-smb ls     <server[:port]> <share> <folder>     one JSON line per entry (name, dir, size, mtime)
 *   tivibro-smb stat   <server[:port]> <share> <path>       one JSON line (dir, size, mtime)
 *   tivibro-smb cat    <server[:port]> <share> <path> <offset> <length|-1>
 *                                                          the file's bytes from offset (all of it with -1)
 *
 * The login comes on stdin, never on the command line (where other programs could read it): three lines,
 * user, password and domain, each of which may be empty.  An empty user signs in as a guest.
 *
 * A failure exits non-zero with one JSON line on stderr, {"error": kind, "status": "0x...", "detail": ...},
 * where kind is login, denied, noshare, notfound, unreachable, timeout, signing, smb1 or other.  The helper
 * turns those into words (service/smb.js).
 *
 * Built on libsmb2 (LGPL-2.1, https://github.com/sahlberg/libsmb2): SMB 2.0.2 to 3.1.1, NTLMv2, signing
 * and SMB3 encryption.  SMB1 is never offered.  Statically linked by scripts/smb/build.sh.
 *
 * Memory: a file is read in pieces of at most 512 KB with three in flight (1.5 MB at most), so TVs with
 * 1 GB of memory are not pushed, and the helper reads what it needs with Range-sized cat calls.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <inttypes.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>

#include <smb2/smb2.h>
#include <smb2/libsmb2.h>
#include <smb2/libsmb2-raw.h>
#if __has_include(<smb2/libsmb2-share-enum.h>)
#include <smb2/libsmb2-share-enum.h>          /* libsmb2 after 6.0: its own share list */
#define TB_SHARE_ENUM 2
#else
#include <smb2/libsmb2-dcerpc-srvsvc.h>       /* libsmb2 6.0: srvsvc over DCE/RPC */
#define TB_SHARE_ENUM 1
#endif

#define TB_VERSION "1"
#define PIECE_MAX (512 * 1024)
#define DEPTH 3
#define TIMEOUT_S 15

static char user[512], password[512], domain[256];

/* ---------- answers ---------- */

/* Writes s as a JSON string (UTF-8 passes through; quotes, backslashes and control characters are escaped). */
static void json_str(FILE *f, const char *s)
{
        fputc('"', f);
        for (; s && *s; s++) {
                unsigned char c = (unsigned char)*s;
                if (c == '"' || c == '\\') { fputc('\\', f); fputc(c, f); }
                else if (c < 0x20) fprintf(f, "\\u%04x", c);
                else fputc(c, f);
        }
        fputc('"', f);
}

/* The kind of failure the helper words for the viewer, from the NT status libsmb2 kept (or the errno). */
static const char *kind_of(uint32_t nt, int err)
{
        switch (nt) {
        case 0xC000006D: /* LOGON_FAILURE */
        case 0xC000006A: /* WRONG_PASSWORD */
        case 0xC0000064: /* NO_SUCH_USER */
        case 0xC0000072: /* ACCOUNT_DISABLED */
        case 0xC000006E: /* ACCOUNT_RESTRICTION (a blank password, or no guests) */
        case 0xC0000071: /* PASSWORD_EXPIRED */
        case 0xC0000224: /* PASSWORD_MUST_CHANGE */
        case 0xC0000234: /* ACCOUNT_LOCKED_OUT */
                return "login";
        case 0xC0000022: /* ACCESS_DENIED */
                return "denied";
        case 0xC00000CC: /* BAD_NETWORK_NAME: no such share */
                return "noshare";
        case 0xC0000034: /* OBJECT_NAME_NOT_FOUND */
        case 0xC000003A: /* OBJECT_PATH_NOT_FOUND */
        case 0xC0000033: /* OBJECT_NAME_INVALID */
        case 0xC0000103: /* NOT_A_DIRECTORY */
        case 0xC00000BA: /* FILE_IS_A_DIRECTORY */
                return "notfound";
        case 0xC00000BB: /* NOT_SUPPORTED: an SMB1-only server */
                return "smb1";
        }
        if (err == ECONNREFUSED || err == EHOSTUNREACH || err == ENETUNREACH || err == EADDRNOTAVAIL)
                return "unreachable";
        if (err == ETIMEDOUT) return "timeout";
        if (err == ENOENT || err == ENOTDIR) return "notfound";
        if (err == EACCES || err == EPERM) return "denied";
        return "other";
}

/* libsmb2 reports a failed connect, and a signature it couldn't check, only in its message: the errno is
   read back from "Socket connect failed with N", and a bad signature (a guest login on a server that
   insists on signing, which a guest can't do) is its own kind. */
static const char *kind_from(struct smb2_context *smb2, uint32_t nt, int err)
{
        const char *msg = smb2 ? smb2_get_error(smb2) : "", *at;
        if (!nt && msg) {
                if ((at = strstr(msg, "connect failed with ")) != NULL) err = atoi(at + 20);
                else if (strstr(msg, "Wrong signature")) return "signing";
                else if (strstr(msg, "getaddrinfo") || strstr(msg, "Invalid address")) return "unreachable";
        }
        return kind_of(nt, err);
}

/* Says why it failed on stderr and exits. */
static void fail(struct smb2_context *smb2, int ret, const char *what)
{
        uint32_t nt = smb2 ? (uint32_t)smb2_get_nterror(smb2) : 0;
        int err = ret < 0 ? -ret : ret;
        fprintf(stderr, "{\"error\":\"%s\",\"status\":\"0x%08" PRIx32 "\",\"step\":", kind_from(smb2, nt, err), nt);
        json_str(stderr, what);
        fputs(",\"detail\":", stderr);
        json_str(stderr, smb2 ? smb2_get_error(smb2) : strerror(err));
        fputs("}\n", stderr);
        exit(2);
}

/* ---------- the login ---------- */

/* One line of stdin without its line ending (empty when stdin ends). */
static void line(char *buf, size_t n)
{
        size_t l;
        if (!fgets(buf, (int)n, stdin)) { buf[0] = 0; return; }
        l = strlen(buf);
        while (l && (buf[l - 1] == '\n' || buf[l - 1] == '\r')) buf[--l] = 0;
}

/* The dialects to offer: all of SMB 2 and 3 (the server picks the newest it has), or one only when
   TIVIBRO_SMB_DIALECT says (2.1, 3.0, 3.0.2, 3.1.1), for tests and for a server that gets the newest wrong. */
static enum smb2_negotiate_version dialect_wanted(void)
{
        const char *d = getenv("TIVIBRO_SMB_DIALECT");
        if (!d) return SMB2_VERSION_ANY;
        if (!strcmp(d, "2.1")) return SMB2_VERSION_0210;
        if (!strcmp(d, "3.0")) return SMB2_VERSION_0300;
        if (!strcmp(d, "3.0.2")) return SMB2_VERSION_0302;
        if (!strcmp(d, "3.1.1")) return SMB2_VERSION_0311;
        return SMB2_VERSION_ANY;
}

/* A context with the login, SMB2 or 3 only, signing offered (and done when the server wants it), and a
   timeout so a server that goes quiet ends the call instead of hanging the helper. */
static struct smb2_context *context(void)
{
        struct smb2_context *smb2 = smb2_init_context();
        if (!smb2) { fprintf(stderr, "{\"error\":\"other\",\"detail\":\"no memory\"}\n"); exit(2); }
        smb2_set_version(smb2, dialect_wanted());
        smb2_set_security_mode(smb2, SMB2_NEGOTIATE_SIGNING_ENABLED);
        smb2_set_timeout(smb2, TIMEOUT_S);
        smb2_set_workstation(smb2, "TIVIBRO");
        if (domain[0]) smb2_set_domain(smb2, domain);
        smb2_set_user(smb2, user[0] ? user : "guest");
        smb2_set_password(smb2, user[0] ? password : "");
        return smb2;
}

static struct smb2_context *connect_to(const char *server, const char *share)
{
        struct smb2_context *smb2 = context();
        int ret = smb2_connect_share(smb2, server, share, user[0] ? user : "guest");
        if (ret < 0) fail(smb2, ret, "connect");
        return smb2;
}

/* ---------- commands ---------- */

/* A path inside the share as libsmb2 wants it: no leading or trailing slashes, "" for the top. */
static char *rel(char *p)
{
        size_t l;
        while (*p == '/' || *p == '\\') p++;
        l = strlen(p);
        while (l && (p[l - 1] == '/' || p[l - 1] == '\\')) p[--l] = 0;
        return p;
}

static const char *dialect_name(uint16_t d)
{
        switch (d) {
        case SMB2_VERSION_0202: return "2.0.2";
        case SMB2_VERSION_0210: return "2.1";
        case SMB2_VERSION_0300: return "3.0";
        case SMB2_VERSION_0302: return "3.0.2";
        case SMB2_VERSION_0311: return "3.1.1";
        }
        return "?";
}

static int cmd_check(const char *server, const char *share)
{
        struct smb2_context *smb2 = connect_to(server, share);
        printf("{\"ok\":true,\"dialect\":\"%s\",\"maxRead\":%" PRIu32 ",\"version\":\"" TB_VERSION "\"}\n",
               dialect_name(smb2_get_dialect(smb2)), smb2_get_max_read_size(smb2));
        smb2_disconnect_share(smb2);
        smb2_destroy_context(smb2);
        return 0;
}

/* Prints one entry: its name, whether it's a folder, its size and when it last changed (Unix seconds). */
static void entry(const char *name, const struct smb2_stat_64 *st)
{
        fputs("{\"name\":", stdout);
        json_str(stdout, name);
        printf(",\"dir\":%s,\"size\":%" PRIu64 ",\"mtime\":%" PRIu64 "}\n",
               st->smb2_type == SMB2_TYPE_DIRECTORY ? "true" : "false", st->smb2_size, st->smb2_mtime);
}

static int cmd_ls(const char *server, const char *share, const char *folder)
{
        struct smb2_context *smb2 = connect_to(server, share);
        struct smb2dir *dir = smb2_opendir(smb2, folder);
        struct smb2dirent *ent;
        if (!dir) fail(smb2, -ENOENT, "opendir");
        while ((ent = smb2_readdir(smb2, dir))) {
                if (!strcmp(ent->name, ".") || !strcmp(ent->name, "..")) continue;
                entry(ent->name, &ent->st);
        }
        smb2_closedir(smb2, dir);
        smb2_disconnect_share(smb2);
        smb2_destroy_context(smb2);
        return 0;
}

static int cmd_stat(const char *server, const char *share, const char *path)
{
        struct smb2_context *smb2 = connect_to(server, share);
        struct smb2_stat_64 st;
        int ret = smb2_stat(smb2, path, &st);
        if (ret < 0) fail(smb2, ret, "stat");
        entry(path, &st);
        smb2_disconnect_share(smb2);
        smb2_destroy_context(smb2);
        return 0;
}

/* ---------- reading a file: pieces in flight, written out in order ---------- */

struct piece {
        uint8_t *buf;
        uint64_t at;
        uint32_t want;
        int busy, done, status;
};
static struct piece pieces[DEPTH];

static void read_cb(struct smb2_context *smb2, int status, void *command_data, void *private_data)
{
        struct piece *p = private_data;
        (void)smb2; (void)command_data;
        p->status = status;
        p->done = 1;
}

/* Runs libsmb2 until piece p has its answer. */
static void wait_for(struct smb2_context *smb2, struct piece *p)
{
        struct pollfd pfd;
        while (!p->done) {
                pfd.fd = smb2_get_fd(smb2);
                pfd.events = smb2_which_events(smb2);
                if (poll(&pfd, 1, 1000) < 0) {
                        if (errno == EINTR) continue;
                        fail(smb2, -errno, "poll");
                }
                if (smb2_service(smb2, pfd.revents) < 0) fail(smb2, -EIO, "read");
        }
}

/* Writes all of buf to stdout; a reader that went away (the player seeked) ends the program quietly. */
static void out(const uint8_t *buf, size_t n)
{
        while (n) {
                ssize_t w = write(1, buf, n);
                if (w < 0) {
                        if (errno == EINTR) continue;
                        exit(errno == EPIPE ? 0 : 3);
                }
                buf += w; n -= (size_t)w;
        }
}

static int cmd_cat(const char *server, const char *share, const char *path, const char *from, const char *count)
{
        struct smb2_context *smb2 = connect_to(server, share);
        struct smb2fh *fh = smb2_open(smb2, path, O_RDONLY);
        struct smb2_stat_64 st;
        uint64_t at = strtoull(from, NULL, 10), end, next;
        long long len = strtoll(count, NULL, 10);
        uint32_t piece = smb2_get_max_read_size(smb2);
        int i, head = 0;

        if (!fh) fail(smb2, -ENOENT, "open");
        if (smb2_fstat(smb2, fh, &st) < 0) fail(smb2, -EIO, "fstat");
        end = len < 0 || at + (uint64_t)len > st.smb2_size ? st.smb2_size : at + (uint64_t)len;
        if (piece > PIECE_MAX || piece == 0) piece = piece ? PIECE_MAX : 65536;
        for (i = 0; i < DEPTH; i++) {
                pieces[i].buf = malloc(piece);
                if (!pieces[i].buf) fail(smb2, -ENOMEM, "malloc");
        }
        next = at;
        /* Keep DEPTH reads asked for; write the oldest as soon as it's back, then ask for the next. */
        for (;;) {
                for (i = 0; i < DEPTH; i++) {
                        struct piece *p = &pieces[(head + i) % DEPTH];
                        if (p->busy || next >= end) continue;
                        p->at = next;
                        p->want = (uint32_t)(end - next < piece ? end - next : piece);
                        p->busy = 1; p->done = 0;
                        if (smb2_pread_async(smb2, fh, p->buf, p->want, p->at, read_cb, p) < 0)
                                fail(smb2, -EIO, "pread");
                        next += p->want;
                }
                if (!pieces[head].busy) break;              /* nothing left asked for: all written */
                wait_for(smb2, &pieces[head]);
                if (pieces[head].status < 0) fail(smb2, pieces[head].status, "read");
                if (pieces[head].status == 0) break;        /* the file ended early (it shrank) */
                out(pieces[head].buf, (size_t)pieces[head].status);
                if ((uint32_t)pieces[head].status < pieces[head].want) break;
                pieces[head].busy = 0;
                head = (head + 1) % DEPTH;
        }
        smb2_close(smb2, fh);
        smb2_disconnect_share(smb2);
        smb2_destroy_context(smb2);
        return 0;
}

/* ---------- the shares on a server (NetShareEnum over IPC$) ---------- */

/* Prints one share, if it's a disk share that isn't hidden (C$, ADMIN$ and the like are left out). */
static void share(const char *name, const char *remark, uint32_t type)
{
        if ((type & 3) != 0 || (type & 0x80000000u)) return;      /* 0: a disk; 0x80000000: hidden */
        fputs("{\"name\":", stdout);
        json_str(stdout, name);
        fputs(",\"comment\":", stdout);
        json_str(stdout, remark ? remark : "");
        fputs("}\n", stdout);
}

#if TB_SHARE_ENUM == 2
static int cmd_shares(const char *server)
{
        struct smb2_context *smb2 = connect_to(server, "IPC$");
        struct smb2_share_enum_reply *rep = smb2_share_enum_sync(smb2, SMB2_SHARE_INFO_1);
        uint32_t i;
        if (!rep) fail(smb2, -EIO, "share list");
        for (i = 0; i < rep->entries_read; i++)
                share(rep->share_info.info_1[i].netname, rep->share_info.info_1[i].remark, rep->share_info.info_1[i].type);
        smb2_free_data(smb2, rep);
        smb2_disconnect_share(smb2);
        smb2_destroy_context(smb2);
        return 0;
}
#else
static int shares_done, shares_status;

static void shares_cb(struct smb2_context *smb2, int status, void *command_data, void *private_data)
{
        struct srvsvc_NetrShareEnum_rep *rep = command_data;
        uint32_t i;
        (void)private_data;
        shares_status = status;
        shares_done = 1;
        if (status) return;
        for (i = 0; i < rep->ses.ShareInfo.Level1.EntriesRead; i++) {
                struct srvsvc_SHARE_INFO_1 *s = &rep->ses.ShareInfo.Level1.Buffer->share_info_1[i];
                share(s->netname.utf8, s->remark.utf8, s->type);
        }
        smb2_free_data(smb2, rep);
}

static int cmd_shares(const char *server)
{
        struct smb2_context *smb2 = connect_to(server, "IPC$");
        struct pollfd pfd;
        if (smb2_share_enum_async(smb2, SHARE_INFO_1, shares_cb, NULL) != 0) fail(smb2, -EIO, "share list");
        while (!shares_done) {
                pfd.fd = smb2_get_fd(smb2);
                pfd.events = smb2_which_events(smb2);
                if (poll(&pfd, 1, 1000) < 0) { if (errno == EINTR) continue; fail(smb2, -errno, "poll"); }
                if (smb2_service(smb2, pfd.revents) < 0) fail(smb2, -EIO, "share list");
        }
        if (shares_status) fail(smb2, shares_status, "share list");
        smb2_disconnect_share(smb2);
        smb2_destroy_context(smb2);
        return 0;
}
#endif

static int usage(void)
{
        fputs("tivibro-smb " TB_VERSION " (libsmb2)\n"
              "usage: tivibro-smb check|shares|ls|stat|cat <server[:port]> [share] [path] [offset length]\n"
              "login on stdin: user, password, domain (one per line)\n", stderr);
        return 1;
}

int main(int argc, char **argv)
{
        signal(SIGPIPE, SIG_IGN);
        if (argc >= 2 && !strcmp(argv[1], "-version")) { puts("tivibro-smb " TB_VERSION); return 0; }
        if (argc < 3) return usage();
        line(user, sizeof user);
        line(password, sizeof password);
        line(domain, sizeof domain);
        if (!strcmp(argv[1], "check") && argc == 4) return cmd_check(argv[2], argv[3]);
        if (!strcmp(argv[1], "shares") && argc == 3) return cmd_shares(argv[2]);
        if (!strcmp(argv[1], "ls") && argc == 5) return cmd_ls(argv[2], argv[3], rel(argv[4]));
        if (!strcmp(argv[1], "stat") && argc == 5) return cmd_stat(argv[2], argv[3], rel(argv[4]));
        if (!strcmp(argv[1], "cat") && argc == 7) return cmd_cat(argv[2], argv[3], rel(argv[4]), argv[5], argv[6]);
        return usage();
}
