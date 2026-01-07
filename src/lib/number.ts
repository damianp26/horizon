export function parseLocaleNumber(raw: string) {
    // permite "22,1" o "22.1", ignora letras, deja 1 separador
    const cleaned = raw.replace(/[^\d.,]/g, "")
    const normalized = cleaned.replace(",", ".")
    const n = Number(normalized)
    if (!Number.isFinite(n)) return null
    return Math.max(0, n)
  }
  
  export function formatPctComma(n: number, decimals = 2) {
    const s = n.toFixed(decimals).replace(".", ",")
    return s
  }
  