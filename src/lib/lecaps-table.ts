// src/lib/lecaps-table.ts
export type LecapsTableItem = Record<string, string> & { _ticker: string }

type LecapsScrapeResponse = {
  fetchedAt: string
  source: string
  headers: string[]
  items: LecapsTableItem[]
}

export async function fetchLecapsTable(refresh = false): Promise<LecapsTableItem[]> {
  const url = refresh ? "/api/lecaps-table?refresh=1" : "/api/lecaps-table"
  const r = await fetch(url)
  if (!r.ok) throw new Error(`LECAPs table error: ${r.status}`)
  const data = (await r.json()) as LecapsScrapeResponse

  if (!data?.items || !Array.isArray(data.items)) {
    throw new Error("LECAPs table inválida: no items[]")
  }

  return data.items
}
