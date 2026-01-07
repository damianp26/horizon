import path from "path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import type { Connect } from "vite"
import { scrapeLecapsTable } from "./api/_shared/lecapsScrape"

type CacheEntry = { ts: number; payload: any }
let cache: CacheEntry | null = null
const CACHE_MS = 3 * 60 * 1000

function sendJson(res: any, status: number, body: any) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.end(JSON.stringify(body))
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "lecaps-table-dev-endpoint",
      configureServer(server) {
        server.middlewares.use("/api/lecaps-table", (async (req, res) => {
          try {
            const url = new URL(req.originalUrl || req.url || "", "http://localhost")
            const refresh = url.searchParams.get("refresh") === "1"

            if (!refresh && cache && Date.now() - cache.ts < CACHE_MS) {
              return sendJson(res, 200, cache.payload)
            }

            const payload = await scrapeLecapsTable()
            cache = { ts: Date.now(), payload }

            return sendJson(res, 200, payload)
          } catch (err: any) {
            return sendJson(res, 500, {
              error: "LECAPS_SCRAPE_FAILED_DEV",
              message: err?.message ?? String(err),
            })
          }
        }) as unknown as Connect.NextHandleFunction)
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "^/api/cauciones$": {
        target: "https://open.bymadata.com.ar",
        changeOrigin: true,
        secure: false,
        headers: {
          Origin: "https://open.bymadata.com.ar",
          Referer: "https://open.bymadata.com.ar/",
          Accept: "application/json, text/plain, */*",
        },
        rewrite: () => "/vanoms-be-core/rest/api/bymadata/free/cauciones",
      },
      "^/api/dolar$": {
        target: "https://dolarapi.com",
        changeOrigin: true,
        secure: true,
        rewrite: () => "/v1/dolares/oficial",
      },
    },
  },
})
