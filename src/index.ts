#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AppleMusicClient } from "./api.js";
import { loadConfig } from "./token.js";

const config = loadConfig();
const client = new AppleMusicClient(config);

const tools = [
  {
    name: "search_catalog",
    description:
      "Search the full Apple Music catalog (millions of tracks). Returns songs, albums, artists, and playlists by default.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string", description: "Search query" },
        types: {
          type: "array",
          items: { type: "string", enum: ["songs", "albums", "artists", "playlists", "music-videos", "stations"] },
          description: "Resource types to search (default: songs, albums, artists, playlists)",
        },
        limit: { type: "number", description: "Max results per type (default 25, max 25)" },
        storefront: { type: "string", description: "Two-letter storefront code (default from env)" },
      },
      required: ["term"],
    },
  },
  {
    name: "get_catalog_resource",
    description: "Fetch a specific catalog resource by type and ID (e.g. full album details with tracks).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "e.g. songs, albums, artists, playlists" },
        id: { type: "string", description: "Resource ID" },
        storefront: { type: "string" },
      },
      required: ["type", "id"],
    },
  },
  {
    name: "search_library",
    description: "Search only within the user's personal Apple Music library.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string" },
        types: {
          type: "array",
          items: { type: "string" },
          description: "Default: library-songs, library-albums, library-artists, library-playlists",
        },
        limit: { type: "number" },
      },
      required: ["term"],
    },
  },
  {
    name: "list_playlists",
    description: "List the user's library playlists.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 100" },
        offset: { type: "number" },
      },
    },
  },
  {
    name: "get_playlist",
    description: "Get a specific library playlist by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_playlist_tracks",
    description:
      "List every track in a library playlist (pages through Apple's 100-per-request limit). Use this to verify playlist contents — get_playlist does not return tracks.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Library playlist ID, e.g. p.xxxxxxxx" } },
      required: ["id"],
    },
  },
  {
    name: "create_playlist",
    description:
      "Create a new playlist in the user's library. Optionally seed with catalog song IDs (from search_catalog).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        track_ids: {
          type: "array",
          items: { type: "string" },
          description: "Apple Music catalog song IDs (not library IDs).",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "add_to_playlist",
    description: "Add tracks to an existing library playlist.",
    inputSchema: {
      type: "object",
      properties: {
        playlist_id: { type: "string" },
        track_ids: { type: "array", items: { type: "string" } },
        from_library: {
          type: "boolean",
          description: "If true, track_ids are library-songs IDs; otherwise catalog song IDs (default false).",
        },
      },
      required: ["playlist_id", "track_ids"],
    },
  },
  {
    name: "recently_played",
    description: "Get the user's recently played tracks.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "heavy_rotation",
    description: "Get the user's heavy rotation (most played).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
];

const server = new Server({ name: "apple-music-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const a = args as Record<string, any>;

  try {
    let result: unknown;
    switch (name) {
      case "search_catalog":
        result = await client.searchCatalog({ term: a.term, types: a.types, limit: a.limit, storefront: a.storefront });
        break;
      case "get_catalog_resource":
        result = await client.getCatalogResource({ type: a.type, id: a.id, storefront: a.storefront });
        break;
      case "search_library":
        result = await client.searchLibrary({ term: a.term, types: a.types, limit: a.limit });
        break;
      case "list_playlists":
        result = await client.listPlaylists({ limit: a.limit, offset: a.offset });
        break;
      case "get_playlist":
        result = await client.getPlaylist(a.id);
        break;
      case "get_playlist_tracks":
        result = await client.getPlaylistTracks(a.id);
        break;
      case "create_playlist":
        result = await client.createPlaylist({ name: a.name, description: a.description, trackIds: a.track_ids });
        break;
      case "add_to_playlist":
        result = await client.addTracksToPlaylist({
          playlistId: a.playlist_id,
          trackIds: a.track_ids,
          catalog: !a.from_library,
        });
        break;
      case "recently_played":
        result = await client.getRecentlyPlayed(a.limit);
        break;
      case "heavy_rotation":
        result = await client.getHeavyRotation(a.limit);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    // JSON.stringify(undefined) returns undefined, not a string, which fails the MCP
    // result schema. Any handler that got a 204 lands here with no body — that's success.
    const text = result === undefined ? JSON.stringify({ ok: true }) : JSON.stringify(result, null, 2);
    return { content: [{ type: "text", text }] };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
