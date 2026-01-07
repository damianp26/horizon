export type FeeConfig = {
    brokerCommissionPct: number // ej 0.15 (%)
    ivaPct: number              // ej 21 (%)
    otherCostsPct: number       // ej 0.00 (%) opcional
  }
  
  export function effectiveCostRate(cfg: FeeConfig): number {
    // Devuelve tasa en formato decimal sobre capital (ej 0.001815)
    const broker = (cfg.brokerCommissionPct / 100) * (1 + cfg.ivaPct / 100)
    const other = (cfg.otherCostsPct / 100)
    return broker + other
  }
  
  export function grossInterest(capital: number, days: number, tnaPct: number, baseDays = 365): number {
    return capital * (tnaPct / 100) * (days / baseDays)
  }
  
  export function netCaucionProfit(
    capital: number,
    days: number,
    tnaPct: number,
    feeCfg: FeeConfig,
    baseDays = 365
  ) {
    const gross = grossInterest(capital, days, tnaPct, baseDays)
    const cost = capital * effectiveCostRate(feeCfg)
    const net = gross - cost
    return { gross, cost, net }
  }
  
  export function mpProfitCompound(capital: number, days: number, mpTnaPct: number, baseDays = 365) {
    const rDaily = (mpTnaPct / 100) / baseDays
    const final = capital * Math.pow(1 + rDaily, Math.max(0, days))
    const gain = final - capital
    return { gain, final }
  }
  
  
  export function breakevenTnaToBeatMp(
    capital: number,
    days: number,
    mpTnaPct: number,
    feeCfg: FeeConfig,
    extraMinProfit: number,
    baseDays = 365
  ) {
    // Queremos: netCaucion >= mpGain + extra
    // capital*(tna/100)*(days/baseDays) - capital*costRate >= capital*(mp/100)*(days/baseDays) + extra
    const costRate = effectiveCostRate(feeCfg)
    const frac = days / baseDays
    if (frac <= 0) return Infinity
  
    const tna = mpTnaPct + (100 * costRate) / frac + (100 * extraMinProfit) / (capital * frac)
    return tna
  }
  