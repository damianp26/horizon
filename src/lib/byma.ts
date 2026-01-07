export type BymaCaucionRow = {
  denominationCcy?: string
  daysToMaturity?: number
  maturityDate?: string
  settlementPrice?: number // tasa (TNA)
  tradedQty?: number
}

export type BestByDays = Record<number, BymaCaucionRow>

export async function fetchCauciones(): Promise<BymaCaucionRow[]> {
  const r = await fetch("/api/cauciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ excludeZeroPxAndQty: true }),
  })

  if (!r.ok) throw new Error(`BYMA error: ${r.status}`)

  const data = await r.json()

  // BYMA puede devolver array directo o envuelto (según gateway)
  if (Array.isArray(data)) return data as BymaCaucionRow[]
  if (Array.isArray((data as any)?.data)) return (data as any).data as BymaCaucionRow[]
  if (Array.isArray((data as any)?.results))
    return (data as any).results as BymaCaucionRow[]

  throw new Error("BYMA: formato inesperado")
}

export function bestOffersByDays(
  rows: BymaCaucionRow[],
  ccy: "ARS" | "USD" = "ARS"
): BestByDays {
  const filtered = rows.filter((x) => x.denominationCcy === ccy)
  const best: BestByDays = {}

  for (const x of filtered) {
    const d = Number(x.daysToMaturity)
    if (!Number.isFinite(d) || d < 1 || d > 30) continue
    const rate = Number(x.settlementPrice ?? 0)
    if (!best[d] || rate > Number(best[d].settlementPrice ?? 0)) best[d] = x
  }
  return best
}
