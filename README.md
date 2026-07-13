# apple-music-mcp

MCP server for the Apple Music API. Search the full catalog, create playlists, manage your library.

## Status

- Built: 2026-04-20
- Dev token generation + catalog search: **verified working**
- Library writes (playlists): **require user token** — run `npm run auth` once

## Setup

Already done on Mac Mini:

1. Apple Developer portal → Identifiers → Media ID (`media.com.alexpriest.applemusicmcp`)
2. Keys → MusicKit enabled → downloaded `.p8` to `keys/AuthKey_68R3STY9CA.p8`
3. `.env` populated with Team ID, Key ID, Media ID, key path
4. `npm install && npm run build`
5. Registered in `~/.claude.json` as "Apple Music"

## Authorizing the user token

Writes to the library (creating playlists, etc.) require a Music User Token.

```bash
cd ~/Code/tools/apple-music-mcp
npm run auth
```

Open http://localhost:7788, click "Sign in with Apple Music", complete the Apple auth flow. The token is saved to `.env` automatically and the auth server shuts down.

Restart Claude Code after auth to pick up the new env var.

## Tools

| Tool | Auth | Notes |
|---|---|---|
| `search_catalog` | dev only | Full Apple Music catalog |
| `get_catalog_resource` | dev only | Fetch by type + ID |
| `search_library` | user | User's library |
| `list_playlists` | user | Library playlists |
| `get_playlist` | user | By ID — metadata only, **no tracks** |
| `get_playlist_tracks` | user | Every track in a playlist (auto-pages past Apple's 100/request cap) |
| `create_playlist` | user | Optional seed tracks |
| `add_to_playlist` | user | Append tracks; returns `{added, playlist_id}` |
| `recently_played` | user | Recent tracks |
| `heavy_rotation` | user | Most-played |

## Troubleshooting

- **401 on writes** → user token expired or missing; rerun `npm run auth`.
- **403 on reads** → dev token bad; check Team ID / Key ID / Media ID in `.env` match the Apple Developer portal.
- **Developer tokens** expire after 180 days but are auto-regenerated from the `.p8` on each server start.
- **Apple returns `204 No Content` on successful playlist writes.** Handlers must not feed that empty body to
  `JSON.stringify` — it yields `undefined`, not a string, and the MCP result schema then rejects a write that
  actually succeeded. `add_to_playlist` synthesizes its own success object for this reason.
- **A library playlist with zero tracks 404s** on `/tracks` rather than returning an empty collection.
  `get_playlist_tracks` treats that as empty.
