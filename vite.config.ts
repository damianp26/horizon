import path from "path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // NOTA DEV:
    // En este repo existe /api (funciones de Vercel). En dev (Vite) NO queremos
    // que el navegador reciba el código TS de esas funciones cuando hace fetch,
    // sino JSON desde los upstreams.
    // Por eso:
    // - usamos reglas EXACTAS con regex (evita que /api/lecaps “pise” /api/lecaps-table)
    // - proxy explícito para /api/lecaps-table
    proxy: {
      "^/api/cauciones$": {
        target: "https://open.bymadata.com.ar",
        changeOrigin: true,
        secure: false,
        headers: {
          // BYMA a veces se pone quisquilloso si no ve un origin/referer razonables
          Origin: "https://open.bymadata.com.ar",
          Referer: "https://open.bymadata.com.ar/",
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        },
        rewrite: () => "/vanoms-be-core/rest/api/bymadata/free/cauciones",
      },

      "^/api/dolar$": {
        target: "https://dolarapi.com",
        changeOrigin: true,
        secure: true,
        rewrite: () => "/v1/dolares/oficial",
      },

      // En prod esto lo resuelve la función /api/lecaps-table (scrape con puppeteer).
      // En dev proxyamos a un endpoint liviano y lo adaptamos en src/lib/lecaps-table.ts
      "^/api/lecaps-table$": {
        target: "https://www.acuantoesta.com.ar",
        changeOrigin: true,
        secure: true,
        rewrite: () => "/api/lecaps-prices",
      },

      // Por compat: si en algún lugar llamás /api/lecaps
      "^/api/lecaps$": {
        target: "https://www.acuantoesta.com.ar",
        changeOrigin: true,
        secure: true,
        rewrite: () => "/api/lecaps-prices",
      },
    },
  },
})
