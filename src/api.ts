import type { AppleConfig } from "./token.js";
import { getDeveloperToken } from "./token.js";

const BASE = "https://api.music.apple.com/v1";

export class AppleMusicApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AppleMusicApiError";
  }
}

export interface AddTracksResult {
  added: number;
  playlist_id: string;
}

export interface PlaylistTracksResult {
  playlist_id: string;
  count: number;
  tracks: { id: string; name: string; artist?: string; album?: string }[];
}

export class AppleMusicClient {
  constructor(private config: AppleConfig) {}

  private async headers(requireUser = false): Promise<Record<string, string>> {
    const dev = await getDeveloperToken(this.config);
    const h: Record<string, string> = { Authorization: `Bearer ${dev}` };
    if (requireUser) {
      if (!this.config.userToken) {
        throw new Error(
          "Music User Token missing. Run `npm run auth` to sign in and populate APPLE_MUSIC_USER_TOKEN in .env.",
        );
      }
      h["Music-User-Token"] = this.config.userToken;
    }
    return h;
  }

  private async request<T>(
    path: string,
    opts: { method?: string; body?: unknown; requireUser?: boolean; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const url = new URL(BASE + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    const headers = await this.headers(opts.requireUser);
    if (opts.body) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new AppleMusicApiError(`Apple Music API ${res.status} ${res.statusText}: ${text}`, res.status);
    }
    // 204 No Content is the documented success response for playlist writes.
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  searchCatalog(params: { term: string; types?: string[]; limit?: number; storefront?: string }) {
    const sf = params.storefront ?? this.config.storefront;
    return this.request<any>(`/catalog/${sf}/search`, {
      query: {
        term: params.term,
        types: (params.types ?? ["songs", "albums", "artists", "playlists"]).join(","),
        limit: params.limit ?? 25,
      },
    });
  }

  getCatalogResource(params: { type: string; id: string; storefront?: string }) {
    const sf = params.storefront ?? this.config.storefront;
    return this.request<any>(`/catalog/${sf}/${params.type}/${params.id}`);
  }

  searchLibrary(params: { term: string; types?: string[]; limit?: number }) {
    return this.request<any>(`/me/library/search`, {
      requireUser: true,
      query: {
        term: params.term,
        types: (params.types ?? ["library-songs", "library-albums", "library-artists", "library-playlists"]).join(","),
        limit: params.limit ?? 25,
      },
    });
  }

  listPlaylists(params: { limit?: number; offset?: number } = {}) {
    return this.request<any>(`/me/library/playlists`, {
      requireUser: true,
      query: { limit: params.limit ?? 100, offset: params.offset },
    });
  }

  getPlaylist(id: string) {
    return this.request<any>(`/me/library/playlists/${id}`, { requireUser: true });
  }

  async createPlaylist(params: { name: string; description?: string; trackIds?: string[] }) {
    const tracks = (params.trackIds ?? []).map((id) => ({ id, type: "songs" }));
    const body: any = {
      attributes: { name: params.name, description: params.description },
    };
    if (tracks.length) body.relationships = { tracks: { data: tracks } };
    return this.request<any>(`/me/library/playlists`, { method: "POST", body, requireUser: true });
  }

  async addTracksToPlaylist(params: {
    playlistId: string;
    trackIds: string[];
    catalog?: boolean;
  }): Promise<AddTracksResult> {
    const type = params.catalog !== false ? "songs" : "library-songs";
    // Apple returns 204 No Content on success — no body to parse, so synthesize the result.
    await this.request<void>(`/me/library/playlists/${params.playlistId}/tracks`, {
      method: "POST",
      requireUser: true,
      body: { data: params.trackIds.map((id) => ({ id, type })) },
    });
    return { added: params.trackIds.length, playlist_id: params.playlistId };
  }

  /** Fetch every track in a library playlist, paging through Apple's 100-per-page limit. */
  async getPlaylistTracks(playlistId: string): Promise<PlaylistTracksResult> {
    const tracks: PlaylistTracksResult["tracks"] = [];
    let offset = 0;

    for (;;) {
      let page: any;
      try {
        page = await this.request<any>(`/me/library/playlists/${playlistId}/tracks`, {
          requireUser: true,
          query: { limit: 100, offset },
        });
      } catch (e) {
        // Apple returns 404 (not an empty collection) when a library playlist has no tracks.
        if (e instanceof AppleMusicApiError && e.status === 404 && offset === 0) break;
        throw e;
      }

      const data: any[] = page?.data ?? [];
      for (const t of data) {
        tracks.push({
          id: t.id,
          name: t.attributes?.name ?? "(unknown)",
          artist: t.attributes?.artistName,
          album: t.attributes?.albumName,
        });
      }
      if (!page?.next || data.length === 0) break;
      offset += data.length;
    }

    return { playlist_id: playlistId, count: tracks.length, tracks };
  }

  getRecentlyPlayed(limit = 25) {
    return this.request<any>(`/me/recent/played/tracks`, {
      requireUser: true,
      query: { limit },
    });
  }

  getHeavyRotation(limit = 25) {
    return this.request<any>(`/me/history/heavy-rotation`, {
      requireUser: true,
      query: { limit },
    });
  }
}
