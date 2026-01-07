export type LecapMeta = {
    maturity: string        // "2026-01-16"
    redemption: number      // ej 119.06 (si scale=100) o 1.1906 (si scale=1)
    scale: 1 | 100          // cómo viene el precio y redemption
  }
  
  export function lecapCalc(params: {
    capital: number
    price: number
    meta: LecapMeta
    brokerFeePct: number
    baseDays: 360 | 365
    daysToMaturity: number
  }) {
    const { capital, price, meta, brokerFeePct, baseDays, daysToMaturity } = params
  
    const priceWithFee = price * (1 + brokerFeePct / 100)
    const directReturn = (meta.redemption - priceWithFee) / priceWithFee
  
    const profit = capital * directReturn
    const tna = directReturn * (baseDays / Math.max(1, daysToMaturity))
    const tem = Math.pow(1 + directReturn, 30 / Math.max(1, daysToMaturity)) - 1
  
    return { priceWithFee, directReturn, profit, tna, tem }
  }
  