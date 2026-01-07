// api/_shared/lecapsScrape.ts
import type { Browser } from "puppeteer-core"

export type LecapsTableItem = Record<string, string> & { _ticker: string }

export type LecapsScrapeResult = {
  fetchedAt: string
  source: string
  headers: string[]
  items: LecapsTableItem[]
}

const PAGE_URL = "https://www.acuantoesta.com.ar/lecaps"
const PRICES_URL = "https://www.acuantoesta.com.ar/api/lecaps-prices"

// Solo lo que querés conservar del scrape (lo demás se calcula en tu app)
const KEEP_HEADERS = [
  "Ticker",
  "Vencimiento",
  "Días",
  "Precio (1VN)", // se completa con la API lecaps-prices
  "Cambio", // se completa con la API lecaps-prices
  "A recibir al vto. (1VN)",
] as const

type LecapsPricesMap = Record<
  string,
  {
    price?: number
    change?: number
  }
>

function norm(s: unknown): string {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanTicker(input: string): string {
  // mayúsculas, sin espacios
  let t = norm(input).toUpperCase().replace(/\s+/g, "")
  // limpia sufijos “pegados”
  t = t.replace(/(LECAP|BONCAP|BONODUAL|BONODUALES)$/i, "")
  return t
}

// Convierte el price de /api/lecaps-prices a “precio (1VN)” como lo muestra la tabla (1,1805)
// Para LECAP/BONCAP suele venir 118.05 => 1.1805 (divide por 100).
function priceTo1VN(raw: number): number {
  if (!Number.isFinite(raw)) return NaN

  // Heurística segura: para instrumentos tipo S16E6/T30E6 suele venir entre 10 y 500
  // y representa centésimos de VN (=> /100).
  if (raw >= 10 && raw < 1000) return raw / 100

  // Para valores chicos tipo 0.078 (dólar linked, etc) ya está en escala “VN”
  return raw
}

function fmtVN(x: number, decimals = 4): string {
  if (!Number.isFinite(x)) return ""
  // coma argentina
  return x.toFixed(decimals).replace(".", ",")
}

function fmtChangePct(x: number): string {
  if (!Number.isFinite(x)) return ""
  return `${x.toFixed(2)}%`
}

async function getBrowser(): Promise<{ browser: Browser; close: () => Promise<void> }> {
  // Vercel: chromium serverless
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default
    const puppeteer = await import("puppeteer-core")

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })

    return {
      browser,
      close: async () => {
        try {
          await browser.close()
        } catch {}
      },
    }
  }

  // Local: puppeteer (trae Chromium)
  try {
    const puppeteer = await import("puppeteer")
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })

    return {
      browser: browser as unknown as Browser,
      close: async () => {
        try {
          await (browser as any).close()
        } catch {}
      },
    }
  } catch {
    // Local fallback: puppeteer-core + Chrome instalado
    const puppeteerCore = await import("puppeteer-core")
    const executablePath =
      process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || ""

    if (!executablePath) {
      throw new Error(
        "No encuentro Chrome para puppeteer-core. Instalá 'puppeteer' o seteá CHROME_PATH."
      )
    }

    const browser = await puppeteerCore.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })

    return {
      browser,
      close: async () => {
        try {
          await browser.close()
        } catch {}
      },
    }
  }
}

async function fetchPricesMap(): Promise<LecapsPricesMap> {
  const r = await fetch(PRICES_URL, {
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*" },
  })
  if (!r.ok) throw new Error(`lecaps-prices HTTP ${r.status}`)
  return (await r.json()) as LecapsPricesMap
}

export async function scrapeLecapsTable(): Promise<LecapsScrapeResult> {
  const { browser, close } = await getBrowser()

  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(45_000)

    await page.goto(PAGE_URL, { waitUntil: "networkidle2" })
    await page.waitForSelector("table", { timeout: 45_000 })

    const raw = await page.evaluate(() => {
      const normInPage = (s: unknown) =>
        String(s ?? "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()

      const tables = Array.from(document.querySelectorAll("table"))
      const table =
        tables.find((t) => {
          const text = normInPage(t.textContent || "")
          return text.includes("Ticker") && (text.includes("Vencimiento") || text.includes("Vto"))
        }) || tables[0]

      if (!table) return { headers: [] as string[], rows: [] as string[][] }

      const headerCells =
        table.querySelectorAll("thead th").length > 0
          ? Array.from(table.querySelectorAll("thead th"))
          : Array.from(table.querySelectorAll("tr th"))

      const headers = headerCells.map((th) => normInPage(th.textContent || ""))

      const bodyRows = Array.from(table.querySelectorAll("tbody tr"))
      const rows = bodyRows.map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => normInPage(td.textContent || ""))
      )

      return { headers, rows }
    })

    const headersAll = (raw.headers || []).map(norm)

    const idxByHeader = new Map<string, number>()
    headersAll.forEach((h, i) => idxByHeader.set(h, i))

    // Solo los headers que nos interesan y existan
    const keptHeaders = KEEP_HEADERS.filter((h) => idxByHeader.has(h)) as unknown as string[]
    if (keptHeaders.length === 0) {
      throw new Error("No se encontraron headers esperados en la tabla.")
    }

    // 1) armamos items básicos desde la tabla
    const baseItems: LecapsTableItem[] = (raw.rows || [])
      .filter((cells) => Array.isArray(cells) && cells.length > 0)
      .map((cells) => {
        const row: Record<string, string> = {}

        for (const h of keptHeaders) {
          const i = idxByHeader.get(h)!
          row[h] = norm(cells[i] ?? "")
        }

        const rawTicker = row["Ticker"] ?? ""
        const tickerClean = cleanTicker(rawTicker)

        row["Ticker"] = tickerClean

        return {
          _ticker: tickerClean,
          ...row,
        }
      })
      .filter((x) => {
        const t = cleanTicker(x._ticker)
        if (!t) return false
        if (t === "BONOSDUALES") return false
        return true
      })

    // 2) traemos mapa de precios y completamos Precio (1VN) + Cambio si hay match
    const prices = await fetchPricesMap()

    const items = baseItems.map((it) => {
      const t = it._ticker
      const p = prices?.[t]
      if (!p) return it

      const p1vn = p.price != null ? priceTo1VN(Number(p.price)) : NaN
      const ch = p.change != null ? Number(p.change) : NaN

      return {
        ...it,
        "Precio (1VN)": Number.isFinite(p1vn) ? fmtVN(p1vn, 4) : it["Precio (1VN)"] ?? "",
        "Cambio": Number.isFinite(ch) ? fmtChangePct(ch) : it["Cambio"] ?? "",
      }
    })

    return {
      fetchedAt: new Date().toISOString(),
      source: PAGE_URL,
      headers: keptHeaders,
      items,
    }
  } finally {
    await close()
  }
}
