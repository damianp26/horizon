// src/lib/lecaps-table.ts
export type LecapsTableItem = Record<string, string> & { _ticker: string }

export type LecapsTableResponse = {
  fetchedAt: string
  source: string
  headers: string[]
  items: LecapsTableItem[]
}

// Formato alternativo (acuantoesta /api/lecaps-prices):
// {
//   "S16E6": { "price": 118.05, "change": -1.53 },
//   ...
// }
type LecapsPricesMap = Record<
  string,
  {
    price?: number | string
    change?: number | string
  }
>

export async function fetchLecapsTable(): Promise<LecapsTableItem[]> {
  const r = await fetch("/api/lecaps-table", { method: "GET" })
  if (!r.ok) throw new Error(`LECAPs table error: ${r.status}`)

  const data = (await r.json()) as any

  // ✅ Caso 1 (prod): respuesta del scrape { items: [...] }
  if (data?.items && Array.isArray(data.items)) {
    return data.items as LecapsTableItem[]
  }

  // ✅ Caso 2 (dev/proxy): mapa ticker -> {price, change}
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const map = data as LecapsPricesMap
    const items: LecapsTableItem[] = Object.entries(map)
      .filter(([k]) => typeof k === "string" && k.trim().length > 0)
      .map(([ticker, v]) => {
        const price = v?.price != null ? String(v.price) : ""
        const change = v?.change != null ? String(v.change) : ""
        return {
          _ticker: ticker,
          // claves pensadas para que pickField() de App.tsx encuentre algo
          "Precio (1VN)": price,
          Cambio: change,
          Vto: "",
          "Días": "",
          TNA: "",
          TEM: "",
          "A recibir al Vto": "",
        }
      })
      .sort((a, b) => a._ticker.localeCompare(b._ticker))

    return items
  }

  throw new Error("LECAPs table inválida: formato inesperado")
}
