# Windows and network shares (SMB) in My media

My media can read a shared folder on a Windows PC, a Mac, a NAS (Synology, QNAP, Unraid, TrueNAS) or a router
with a USB drive, over SMB 2 and 3.  This page is how it works and how the program behind it is built.

## Why a separate program

webOS doesn't let an app mount a network share, and the helper's Node (0.12 on webOS 4, 16 on webOS 24
and 25) has no SMB client that handles what servers ask for today:

- Windows 11 24H2 (Pro, Enterprise, Education) requires **signed** SMB connections by default.
- Large files need SMB 2.1 or newer, which reads in big pieces (SMB 2.0.2 is limited to 64 KB at a time).
- SMB1 is off everywhere, and TiviBro never offers it.

So the helper runs `tivibro-smb`, a small static program on [libsmb2](https://github.com/sahlberg/libsmb2)
(LGPL-2.1, the library VLC uses for SMB): SMB 2.0.2 to 3.1.1, NTLMv2, signing, and SMB 3 encryption for
shares that require it.  It is about 200 KB per architecture and runs on every webOS TV from webOS 4 on,
rooted or not, like the audio converter (docs/FFMPEG.md).  A TV with a 64-bit kernel under a 32-bit userland
(an LG C2) runs the 64-bit build, whose ARMv8 AES instructions make signing and encryption much cheaper;
if it doesn't start, the 32-bit one is used.

## How the helper uses it (service/smb.js)

One short run for each thing it needs, answering in JSON lines:

| Command | What it answers |
|---|---|
| `check <server> <share>` | the dialect it signed in with |
| `shares <server>` | the disk shares (hidden ones like `C$` left out) |
| `ls <server> <share> <folder>` | each entry: name, folder or not, size, time |
| `stat <server> <share> <path>` | one file |
| `cat <server> <share> <path> <offset> <length>` | the file's bytes |

- **The login** goes on the program's stdin (user, password, domain, a line each), never on its command
  line, where other programs on the TV could read it.  It is kept with the source like a WebDAV password:
  never logged, never sent back to the web editor or the phone, never in a backup.
- **Playing:** a movie gets a temporary localhost link (service/media-stream.js).  Each range the player
  asks for is one `cat` run, so seeking starts a new read and the old one is stopped at once.
- **Memory:** a read holds at most 1.5 MB (512 KB pieces, three in flight).  The helper runs at most two
  short runs and four reads at a time, so a big scan doesn't push a TV with 1 GB of memory.
- **Errors** come back as a kind (login, denied, noshare, notfound, unreachable, timeout, signing, smb1)
  and are put into words for the viewer.

## Adding a share

- **TV:** Settings > My media > Add media > Add a Windows or network share (SMB): the server's name or
  address, a user name (empty for a guest) and password, then pick a share and a folder.
- **Phone app:** the `smbshares`, `smbfolders` and `addsmb` asks (app/js/phone.js).
- **Web editor:** My media > Add a Windows or network share.

A whole path works as the server too: `\\NAS\Movies\Films` or `smb://NAS/Movies/Films`.

## Building and testing

```
scripts/smb/build.sh all            # armv7 and aarch64, static (Zig + musl), into $TMPDIR/tivibro-smb/out
scripts/smb/build.sh host           # this computer, for trying the helper against a real server
scripts/smb/build.sh test all       # a throwaway Samba server: signing required, an encrypted share,
                                    # wrong logins, a missing share; ARM builds run through qemu-user
```

The libsmb2 commit is pinned in build.sh and checked after checkout.  It is newer than libsmb2 6.0.0,
whose built-in SMB 3 encryption failed against Samba 4.19 and whose signing was about seven times slower.

Releases: run the **smb** workflow (Actions tab, manual).  It builds, tests against Samba and publishes a
pre-release (`smb-1-tbN`) with the two `.gz` programs, `SOURCE.txt` and the LGPL.  Then put the tag and
the SHA-256 of each `.gz` into `service/smb.js` (`TAG`, `SHA256`); `scripts/smb/bundle.sh` (run by
scripts/build.sh) puts them into the package, and the helper unpacks the right one onto the TV's storage
the first time it's needed, checking its hash and running it once first.

Tests: `tests/unit/smb.test.js` (the helper, with a stand-in program, tests/fixtures/fake-smb.js) and
`tests/soak/media-smb.js` (the app, the phone and the web editor).  `TIVIBRO_SMB=<path>` points the helper
at any build of the program.
