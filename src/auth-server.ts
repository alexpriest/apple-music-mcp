import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import "dotenv/config";
import { getDeveloperToken, loadConfig } from "./token.js";

const PORT = 7788;

const HTML = (devToken: string) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Apple Music MCP — Sign In</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 64px auto; padding: 0 24px; line-height: 1.5; }
    button { background: #fa243c; color: white; border: 0; padding: 14px 24px; border-radius: 10px; font-size: 16px; cursor: pointer; }
    button:disabled { opacity: 0.4; cursor: default; }
    pre { background: #f4f4f4; padding: 12px; border-radius: 8px; font-size: 12px; overflow-x: auto; }
    .ok { color: #137333; }
    .err { color: #c5221f; }
  </style>
</head>
<body>
  <h1>Apple Music MCP — Sign In</h1>
  <p>Click below to authorize the MCP to access your Apple Music library. Your Music User Token will be saved to <code>.env</code>.</p>
  <p><button id="go">Sign in with Apple Music</button></p>
  <p id="status"></p>
  <script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" async></script>
  <script>
    const status = document.getElementById('status');
    const go = document.getElementById('go');

    document.addEventListener('musickitloaded', async () => {
      try {
        await MusicKit.configure({
          developerToken: ${JSON.stringify(devToken)},
          app: { name: 'Apple Music MCP', build: '0.1.0' }
        });
        status.textContent = 'MusicKit ready. Click "Sign in".';
      } catch (e) {
        status.innerHTML = '<span class="err">Configure failed: ' + e.message + '</span>';
      }
    });

    go.addEventListener('click', async () => {
      go.disabled = true;
      status.textContent = 'Authorizing…';
      try {
        const music = MusicKit.getInstance();
        // MusicKit persists authorization in localStorage. Without this,
        // authorize() short-circuits and hands back the CACHED token — so a
        // dead token stays dead no matter how many times you click, and the
        // Apple sign-in sheet never appears. Force a real re-auth.
        try { await music.unauthorize(); } catch (_) {}
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith('music.'))
            .forEach((k) => localStorage.removeItem(k));
        } catch (_) {}
        const userToken = await music.authorize();
        status.innerHTML = '<span class="ok">Got user token. Saving…</span>';
        const r = await fetch('/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userToken }) });
        if (r.ok) {
          status.innerHTML = '<span class="ok">Saved to .env. You can close this tab.</span>';
        } else {
          status.innerHTML = '<span class="err">Save failed: ' + await r.text() + '</span>';
        }
      } catch (e) {
        status.innerHTML = '<span class="err">Auth failed: ' + e.message + '</span>';
        go.disabled = false;
      }
    });
  </script>
</body>
</html>`;

async function saveUserToken(token: string) {
  const envPath = resolve(".env");
  const text = await readFile(envPath, "utf8");
  const updated = text.match(/^APPLE_MUSIC_USER_TOKEN=.*$/m)
    ? text.replace(/^APPLE_MUSIC_USER_TOKEN=.*$/m, `APPLE_MUSIC_USER_TOKEN=${token}`)
    : text + (text.endsWith("\n") ? "" : "\n") + `APPLE_MUSIC_USER_TOKEN=${token}\n`;
  await writeFile(envPath, updated);
}

const config = loadConfig();
const devToken = await getDeveloperToken(config);

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML(devToken));
      return;
    }
    if (req.method === "POST" && req.url === "/save") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body.userToken) throw new Error("missing userToken");
      await saveUserToken(body.userToken);
      res.writeHead(200).end("ok");
      console.log("\n✓ Music User Token saved to .env — shutting down auth server.");
      setTimeout(() => process.exit(0), 250);
      return;
    }
    res.writeHead(404).end();
  } catch (e: any) {
    res.writeHead(500).end(e.message);
  }
});

server.listen(PORT, () => {
  console.log(`\nOpen http://localhost:${PORT} in your browser and click "Sign in with Apple Music".`);
});
