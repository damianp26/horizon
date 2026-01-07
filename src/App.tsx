import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Checkbox } from "@/components/ui/checkbox"
import { Settings } from "lucide-react"

import { useLocalStorageState } from "@/lib/storage"
import { bestOffersByDays, fetchCauciones, type BymaCaucionRow } from "@/lib/byma"
import { fetchDolarOficial } from "@/lib/dolar"

import { mpProfitCompound, netCaucionProfit, breakevenTnaToBeatMp, type FeeConfig } from "@/lib/finance"

import { formatDateEsAR, formatDateTimeEsAR, parseDateYYYYMMDD } from "@/lib/format"
import { parseLocaleNumber, formatPctComma } from "@/lib/number"

import { fetchLecapsTable, type LecapsTableItem } from "@/lib/lecaps-table"

/** =========
 *  Types
 *  ========= */
type SettingsState = {
  capital: number
  mmTnaPct: number
  days: number
  caucionTnaPct: number
  extraMinProfit: number
  feeCfgCaucion: FeeConfig
  feeCfgLecaps: { brokerPct: number }
  showUSD: boolean
  lecapsFavs: string[]
}

type ConfigDraft = {
  feeCfgCaucion: FeeConfig
  feeCfgLecaps: { brokerPct: number }
  lecapsFavs: string[]
}

/** =========
 *  Helpers (money + font)
 *  ========= */
function formatARS(x: number) {
  return x.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  })
}
function formatUSD(x: number) {
  return x.toLocaleString("es-AR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })
}

function normalizeKey(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\wñáéíóúü %/.$()-]+/g, "")
    .trim()
}

function pickField(row: Record<string, string>, wanted: string[]) {
  const keys = Object.keys(row)
  const norm = keys.map((k) => ({ k, nk: normalizeKey(k) }))
  const targets = wanted.map(normalizeKey)

  for (const t of targets) {
    const exact = norm.find((x) => x.nk === t)
    if (exact) return row[exact.k]
  }
  for (const t of targets) {
    const partial = norm.find((x) => x.nk.includes(t) || t.includes(x.nk))
    if (partial) return row[partial.k]
  }
  return ""
}

/** =========
 *  App
 *  ========= */
export default function App() {
  const [settings, setSettings] = useLocalStorageState<SettingsState>("horizon.settings.v4", {
    capital: 1000000,
    mmTnaPct: 22.1,
    days: 14,
    caucionTnaPct: 40,
    extraMinProfit: 10000,
    feeCfgCaucion: { brokerCommissionPct: 0.15, ivaPct: 21, otherCostsPct: 0 },
    feeCfgLecaps: { brokerPct: 0.15 },
    showUSD: false,
    lecapsFavs: ["S16E6", "T30E6", "T13F6", "S27F6"],
  })

  // 🔧 Migración defensiva: si venís de versiones viejas donde lecapsFavs no era array
  useEffect(() => {
    const favAny: any = (settings as any).lecapsFavs
    if (Array.isArray(favAny)) return

    let migrated: string[] = []
    if (favAny && typeof favAny === "object") migrated = Object.keys(favAny)
    setSettings((s) => ({ ...s, lecapsFavs: migrated }))
  }, [settings, setSettings])

  // Inputs string para permitir 22,1 mientras tipeás
  const [mmInput, setMmInput] = useState(formatPctComma(settings.mmTnaPct, 2))
  const [caucInput, setCaucInput] = useState(formatPctComma(settings.caucionTnaPct, 2))

  useEffect(() => setMmInput(formatPctComma(settings.mmTnaPct, 2)), [settings.mmTnaPct])
  useEffect(() => setCaucInput(formatPctComma(settings.caucionTnaPct, 2)), [settings.caucionTnaPct])

  const [rows, setRows] = useState<BymaCaucionRow[] | null>(null)
  const [lecapsTable, setLecapsTable] = useState<LecapsTableItem[] | null>(null)

  const [error, setError] = useState<string>("")
  const [loading, setLoading] = useState(false)

  const [usdVenta, setUsdVenta] = useState<number | null>(null)
  const [usdUpdatedAt, setUsdUpdatedAt] = useState<Date | null>(null)

  const [lecapsUpdatedAt, setLecapsUpdatedAt] = useState<Date | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Config modal
  const [cfgOpen, setCfgOpen] = useState(false)
  const [cfgDraft, setCfgDraft] = useState<ConfigDraft>({
    feeCfgCaucion: settings.feeCfgCaucion,
    feeCfgLecaps: settings.feeCfgLecaps,
    lecapsFavs: settings.lecapsFavs,
  })

  const [lecapsSearch, setLecapsSearch] = useState("")

  useEffect(() => {
    if (cfgOpen) {
      setCfgDraft({
        feeCfgCaucion: settings.feeCfgCaucion,
        feeCfgLecaps: settings.feeCfgLecaps,
        lecapsFavs: Array.isArray(settings.lecapsFavs) ? settings.lecapsFavs : [],
      })
      setLecapsSearch("")
    }
  }, [cfgOpen, settings])

  async function refreshAll() {
    setLoading(true)
    setError("")
    try {
      const [cauc, usd, lecTable] = await Promise.allSettled([
        fetchCauciones(),
        fetchDolarOficial(),
        fetchLecapsTable(),
      ])

      if (import.meta.env.DEV) {
        console.log("[refreshAll] cauciones:", cauc.status)
        console.log("[refreshAll] dolar:", usd.status)
        console.log("[refreshAll] lecapsTable:", lecTable.status)
      }

      if (cauc.status === "fulfilled") setRows(cauc.value)
      else setError(cauc.reason?.message ?? "Error cauciones")

      if (usd.status === "fulfilled") {
        setUsdVenta(Number(usd.value.venta))
        setUsdUpdatedAt(new Date(usd.value.fechaActualizacion))
      } else {
        console.warn("Dolar fetch error", usd.reason)
      }

      if (lecTable.status === "fulfilled") {
        setLecapsTable(lecTable.value)
        setLecapsUpdatedAt(new Date())
        if (import.meta.env.DEV) console.log("[refreshAll] lecapsTable rows:", lecTable.value.length)
      } else {
        console.warn("LECAPs table fetch error", lecTable.reason)
      }

      setLastUpdated(new Date())
    } catch (e: any) {
      setError(e?.message ?? "Error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshAll()
    const id = window.setInterval(() => refreshAll(), 20 * 60 * 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const best = useMemo(() => (rows ? bestOffersByDays(rows, "ARS") : {}), [rows])

  function pickFromMarket(days: number, rate: number) {
    setSettings((s) => ({ ...s, days, caucionTnaPct: Math.max(0, rate) }))
  }

  const calc = useMemo(() => {
    const { capital, days, caucionTnaPct, mmTnaPct, feeCfgCaucion, extraMinProfit } = settings

    const cauc = netCaucionProfit(capital, days, caucionTnaPct, feeCfgCaucion, 365)
    const mm = mpProfitCompound(capital, days, mmTnaPct, 365)

    const diff = cauc.net - mm.gain
    const breakeven = breakevenTnaToBeatMp(capital, days, mmTnaPct, feeCfgCaucion, extraMinProfit, 365)
    const worthIt = diff >= extraMinProfit

    return { cauc, mm, diff, breakeven, worthIt }
  }, [settings])

  const fx = settings.showUSD && usdVenta ? usdVenta : null
  const money = (ars: number) => (fx ? formatUSD(ars / fx) : formatARS(ars))

  /** =========
   *  LECAPs (desde tabla scrapeada)
   *  ========= */
  const allLecapTickers = useMemo(() => {
    const tickers = new Set<string>()
    ;(lecapsTable ?? []).forEach((row) => {
      const t = row._ticker || pickField(row, ["Ticker"]) || ""
      if (t) tickers.add(t.trim())
    })
    return Array.from(tickers).sort()
  }, [lecapsTable])

  const filteredLecapTickers = useMemo(() => {
    const q = lecapsSearch.trim().toUpperCase()
    if (!q) return allLecapTickers
    return allLecapTickers.filter((t) => t.toUpperCase().includes(q))
  }, [lecapsSearch, allLecapTickers])

  const derivedLecaps = useMemo(() => {
    const favs = Array.isArray(settings.lecapsFavs) ? settings.lecapsFavs : []
    const table = lecapsTable ?? []

    const mapByTicker = new Map<string, LecapsTableItem>()
    for (const row of table) {
      const t = (row._ticker || pickField(row, ["Ticker"]) || "").trim()
      if (t) mapByTicker.set(t, row)
    }

    return favs
      .map((ticker) => {
        const row = mapByTicker.get(ticker)
        if (!row) return null

        const vtoStr = pickField(row, ["Vencimiento", "Vto"])
        const diasStr = pickField(row, ["Días", "Dias", "Días al vto", "Días a Vto"])
        const precioStr = pickField(row, ["Precio (1VN)", "Precio", "Precio 1VN"])
        const cambioStr = pickField(row, ["Cambio", "Var.", "Var"])
        const precioComStr = pickField(row, ["Precio con comisión", "Precio con comision"])
        const aRecibirStr = pickField(row, ["A recibir al vto. (1VN)", "A recibir al vto", "A recibir"])
        const ganStr = pickField(row, ["Ganancia directa"])
        const tnaStr = pickField(row, ["TNA"])
        const temStr = pickField(row, ["TEM"])

        const dias = parseLocaleNumber(diasStr) ?? null
        const precio = parseLocaleNumber(precioStr) ?? null
        const cambio = parseLocaleNumber(cambioStr) ?? null
        const precioConCom = parseLocaleNumber(precioComStr) ?? null
        const aRecibir = parseLocaleNumber(aRecibirStr) ?? null
        const ganPct = parseLocaleNumber(ganStr) ?? null
        const tnaPct = parseLocaleNumber(tnaStr) ?? null
        const temPct = parseLocaleNumber(temStr) ?? null

        return {
          ticker,
          vtoStr,
          dias,
          precio,
          cambio,
          precioConCom,
          aRecibir,
          ganPct,
          tnaPct,
          temPct,
        }
      })
      .filter(Boolean) as Array<{
      ticker: string
      vtoStr: string
      dias: number | null
      precio: number | null
      cambio: number | null
      precioConCom: number | null
      aRecibir: number | null
      ganPct: number | null
      tnaPct: number | null
      temPct: number | null
    }>
  }, [settings.lecapsFavs, lecapsTable])

  function toggleFav(ticker: string) {
    setCfgDraft((d) => {
      const set = new Set(d.lecapsFavs)
      if (set.has(ticker)) set.delete(ticker)
      else set.add(ticker)
      return { ...d, lecapsFavs: Array.from(set).sort() }
    })
  }

  return (
    <TooltipProvider>
      <div
        className="min-h-svh bg-gradient-to-b from-background to-muted/30"
        style={{
          fontFamily:
            '"Nunito", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Horizon</h1>
              <p className="text-sm text-muted-foreground">
                Radar de cauciones (BYMA) + comparación neta vs Money Market + LECAPs favoritas
              </p>
            </div>

            <div className="flex items-center gap-2">
              <ModeToggle />

              <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="icon" title="Configuración">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DialogTrigger>

                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Configuración</DialogTitle>
                    <DialogDescription>Comisiones y favoritos. Se guarda en tu navegador.</DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-6 py-2">
                    {/* Costos Caución */}
                    <div className="rounded-md border p-4">
                      <div className="text-sm font-medium mb-3">Costos (Caución)</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Comisión broker (%)</Label>
                          <Input
                            inputMode="decimal"
                            value={formatPctComma(cfgDraft.feeCfgCaucion.brokerCommissionPct, 3)}
                            onChange={(e) => {
                              const n = parseLocaleNumber(e.target.value)
                              if (n === null) return
                              setCfgDraft((d) => ({
                                ...d,
                                feeCfgCaucion: { ...d.feeCfgCaucion, brokerCommissionPct: n },
                              }))
                            }}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>IVA (%)</Label>
                          <Input
                            inputMode="decimal"
                            value={formatPctComma(cfgDraft.feeCfgCaucion.ivaPct, 2)}
                            onChange={(e) => {
                              const n = parseLocaleNumber(e.target.value)
                              if (n === null) return
                              setCfgDraft((d) => ({
                                ...d,
                                feeCfgCaucion: { ...d.feeCfgCaucion, ivaPct: n },
                              }))
                            }}
                          />
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        <Label>Otros costos (%)</Label>
                        <Input
                          inputMode="decimal"
                          value={formatPctComma(cfgDraft.feeCfgCaucion.otherCostsPct, 3)}
                          onChange={(e) => {
                            const n = parseLocaleNumber(e.target.value)
                            if (n === null) return
                            setCfgDraft((d) => ({
                              ...d,
                              feeCfgCaucion: { ...d.feeCfgCaucion, otherCostsPct: n },
                            }))
                          }}
                        />
                      </div>
                    </div>

                    {/* Costos LECAPs */}
                    <div className="rounded-md border p-4">
                      <div className="text-sm font-medium mb-3">Costos (LECAPs)</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Comisión broker (%)</Label>
                          <Input
                            inputMode="decimal"
                            value={formatPctComma(cfgDraft.feeCfgLecaps.brokerPct, 3)}
                            onChange={(e) => {
                              const n = parseLocaleNumber(e.target.value)
                              if (n === null) return
                              setCfgDraft((d) => ({
                                ...d,
                                feeCfgLecaps: { ...d.feeCfgLecaps, brokerPct: n },
                              }))
                            }}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground self-end pb-2">
                          Se aplica sobre el precio de compra.
                        </div>
                      </div>
                    </div>

                    {/* Favoritos */}
                    <div className="rounded-md border p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="text-sm font-medium">LECAPs favoritas</div>
                        <div className="text-xs text-muted-foreground">
                          {cfgDraft.lecapsFavs.length} seleccionadas
                        </div>
                      </div>

                      <div className="mb-3">
                        <Input
                          placeholder="Buscar ticker... (ej: S16E6, T30...)"
                          value={lecapsSearch}
                          onChange={(e) => setLecapsSearch(e.target.value)}
                        />
                      </div>

                      <ScrollArea className="h-64 rounded-md border">
                        <div className="p-3 space-y-2">
                          {filteredLecapTickers.length === 0 && (
                            <div className="text-sm text-muted-foreground">No hay resultados.</div>
                          )}

                          {filteredLecapTickers.map((t) => {
                            const checked = cfgDraft.lecapsFavs.includes(t)
                            return (
                              <div
                                key={t}
                                className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                              >
                                <div className="flex items-center gap-3">
                                  <Checkbox checked={checked} onCheckedChange={() => toggleFav(t)} />
                                  <div className="leading-tight">
                                    <div className="text-sm font-medium">{t}</div>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </ScrollArea>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="secondary" onClick={() => setCfgOpen(false)}>
                      Cancelar
                    </Button>
                    <Button
                      onClick={() => {
                        setSettings((s) => ({
                          ...s,
                          feeCfgCaucion: cfgDraft.feeCfgCaucion,
                          feeCfgLecaps: cfgDraft.feeCfgLecaps,
                          lecapsFavs: cfgDraft.lecapsFavs,
                        }))
                        setCfgOpen(false)
                      }}
                    >
                      Guardar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button variant="secondary" onClick={refreshAll} disabled={loading}>
                {loading ? "Actualizando..." : "Actualizar"}
              </Button>

              <div className="flex flex-col items-end leading-tight">
                {lastUpdated && (
                  <span className="text-xs text-muted-foreground">{formatDateTimeEsAR(lastUpdated)}</span>
                )}
                {usdVenta && usdUpdatedAt && (
                  <span className="text-[11px] text-muted-foreground">
                    USD venta: {usdVenta.toLocaleString("es-AR")} ({formatDateEsAR(usdUpdatedAt)})
                  </span>
                )}
                {lecapsUpdatedAt && (
                  <span className="text-[11px] text-muted-foreground">
                    LECAPs: {formatDateTimeEsAR(lecapsUpdatedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <Separator className="my-6" />

          {error && (
            <Card className="mb-6 border-destructive/40">
              <CardContent className="py-4 text-sm text-destructive">Error: {error}</CardContent>
            </Card>
          )}

          <div className="grid gap-6 md:grid-cols-5">
            {/* Left inputs */}
            <div className="md:col-span-2 space-y-6">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">Tu operación</CardTitle>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Liquidez (ARS)</Label>
                    <Input
                      inputMode="numeric"
                      value={String(settings.capital)}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "")
                        const n = Math.max(0, Number(raw || 0))
                        setSettings((s) => ({ ...s, capital: n }))
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Money Market (TNA %)</Label>
                    <Input
                      inputMode="decimal"
                      value={mmInput}
                      onChange={(e) => {
                        setMmInput(e.target.value)
                        const n = parseLocaleNumber(e.target.value)
                        if (n === null) return
                        setSettings((s) => ({ ...s, mmTnaPct: n }))
                      }}
                      onBlur={() => setMmInput(formatPctComma(settings.mmTnaPct, 2))}
                    />
                    <p className="text-xs text-muted-foreground">Se calcula como capitalización diaria (compuesto).</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Plazo (días)</Label>
                      <Input
                        inputMode="numeric"
                        value={String(settings.days)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^\d]/g, "")
                          const n = Math.max(0, Number(raw || 0))
                          setSettings((s) => ({ ...s, days: n }))
                        }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Caución (TNA %)</Label>
                      <Input
                        inputMode="decimal"
                        value={caucInput}
                        onChange={(e) => {
                          setCaucInput(e.target.value)
                          const n = parseLocaleNumber(e.target.value)
                          if (n === null) return
                          setSettings((s) => ({ ...s, caucionTnaPct: n }))
                        }}
                        onBlur={() => setCaucInput(formatPctComma(settings.caucionTnaPct, 2))}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Mínimo extra para “valer la pena”</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="cursor-help text-xs">
                            ¿qué es?
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          Es el extra mínimo (en dinero) que querés ganarle al Money Market para justificar mover la plata.
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    <Input
                      inputMode="numeric"
                      value={String(settings.extraMinProfit)}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, "")
                        const n = Math.max(0, Number(raw || 0))
                        setSettings((s) => ({ ...s, extraMinProfit: n }))
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <div className="text-sm font-medium">Mostrar resultados en USD</div>
                      <div className="text-xs text-muted-foreground">Usa dólar oficial venta (si está disponible).</div>
                    </div>
                    <Switch
                      checked={settings.showUSD}
                      onCheckedChange={(v) => setSettings((s) => ({ ...s, showUSD: v }))}
                      disabled={!usdVenta}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right */}
            <div className="md:col-span-3 space-y-6">
              {/* Resultado caución vs MM */}
              <Card className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Resultado</CardTitle>
                  {calc.worthIt ? (
                    <Badge className="text-xs">Interesante</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      Quedarse en Money Market
                    </Badge>
                  )}
                </CardHeader>

                <CardContent className="grid gap-6 md:grid-cols-3">
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">Caución</div>
                    <div className="text-sm">
                      Bruto: <span className="font-medium">{money(calc.cauc.gross)}</span>
                    </div>
                    <div className="text-sm">
                      Costos: <span className="font-medium">{money(calc.cauc.cost)}</span>
                    </div>
                    <div className="text-sm">
                      Neto: <span className="font-medium">{money(calc.cauc.net)}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">Money Market (mismos días)</div>
                    <div className="text-sm">
                      Ganancia (compuesta): <span className="font-medium">{money(calc.mm.gain)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Nota: se capitaliza diariamente.</div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">Comparación</div>
                    <div className="text-sm">
                      Diferencia neta:{" "}
                      <span className={`font-medium ${calc.diff >= 0 ? "text-foreground" : "text-destructive"}`}>
                        {money(calc.diff)}
                      </span>
                    </div>

                    <div className="text-sm">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted">Breakeven TNA</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          Es la TNA mínima de la caución para ganarle al Money Market por tu “mínimo extra”.
                        </TooltipContent>
                      </Tooltip>
                      : <span className="font-medium">{calc.breakeven.toFixed(2)}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Mejores cauciones */}
              <Card className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Mejores cauciones ARS (1–30 días)</CardTitle>
                  <Badge variant="outline" className="text-xs">
                    Fuente: open.bymadata
                  </Badge>
                </CardHeader>

                <CardContent>
                  <ScrollArea className="h-72 rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Días</TableHead>
                          <TableHead>Vto</TableHead>
                          <TableHead className="text-right">TNA</TableHead>
                          <TableHead className="text-center w-28">Estado</TableHead>
                          <TableHead className="text-right w-24">Acción</TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {Object.keys(best).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-sm text-muted-foreground">
                              Sin datos todavía (o BYMA no respondió).
                            </TableCell>
                          </TableRow>
                        )}

                        {Object.entries(best)
                          .sort(([a], [b]) => Number(a) - Number(b))
                          .map(([d, row]) => {
                            const days = Number(d)
                            const rate = Number(row.settlementPrice ?? 0)
                            const dt = parseDateYYYYMMDD(row.maturityDate ?? "")
                            const vto = dt ? formatDateEsAR(dt) : row.maturityDate ?? "-"

                            const tmpCauc = netCaucionProfit(
                              settings.capital,
                              days,
                              rate,
                              settings.feeCfgCaucion,
                              365
                            )
                            const tmpMM = mpProfitCompound(settings.capital, days, settings.mmTnaPct, 365)
                            const tmpDiff = tmpCauc.net - tmpMM.gain
                            const isHot = tmpDiff >= settings.extraMinProfit

                            return (
                              <TableRow key={d}>
                                <TableCell>{days}</TableCell>
                                <TableCell>{vto}</TableCell>
                                <TableCell className="text-right">{rate.toFixed(2)}%</TableCell>
                                <TableCell className="text-center">
                                  {isHot ? (
                                    <Badge className="text-xs">Interesante</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-xs">
                                      Normal
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button size="sm" variant="secondary" onClick={() => pickFromMarket(days, rate)}>
                                    Usar
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* LECAPs favoritas */}
              <Card className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">LECAPs favoritas</CardTitle>
                  <Badge variant="outline" className="text-xs">
                    scrape
                  </Badge>
                </CardHeader>

                <CardContent>
                  <ScrollArea className="h-72 rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-24">Ticker</TableHead>
                          <TableHead>Vto</TableHead>
                          <TableHead className="text-right w-16">Días</TableHead>
                          <TableHead className="text-right">Precio</TableHead>
                          <TableHead className="text-right">Cambio</TableHead>
                          <TableHead className="text-right">Precio c/ com</TableHead>
                          <TableHead className="text-right">A recibir</TableHead>
                          <TableHead className="text-right">Ganancia</TableHead>
                          <TableHead className="text-right">TNA</TableHead>
                          <TableHead className="text-right">TEM</TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {derivedLecaps.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={10} className="text-sm text-muted-foreground">
                              No hay favoritas seleccionadas (abrí Config y elegí algunas).
                            </TableCell>
                          </TableRow>
                        )}

                        {derivedLecaps.map((x) => (
                          <TableRow key={x.ticker}>
                            <TableCell className="font-medium">{x.ticker}</TableCell>
                            <TableCell>{x.vtoStr || "—"}</TableCell>
                            <TableCell className="text-right">{x.dias ?? "—"}</TableCell>
                            <TableCell className="text-right">{x.precio != null ? x.precio.toLocaleString("es-AR") : "—"}</TableCell>
                            <TableCell className="text-right">
                              {x.cambio != null ? (
                                <span className={x.cambio >= 0 ? "text-foreground" : "text-destructive"}>
                                  {x.cambio.toFixed(2)}%
                                </span>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="text-right">{x.precioConCom != null ? x.precioConCom.toLocaleString("es-AR") : "—"}</TableCell>
                            <TableCell className="text-right">{x.aRecibir != null ? x.aRecibir.toLocaleString("es-AR") : "—"}</TableCell>
                            <TableCell className="text-right">{x.ganPct != null ? `${x.ganPct.toFixed(2)}%` : "—"}</TableCell>
                            <TableCell className="text-right">{x.tnaPct != null ? `${x.tnaPct.toFixed(2)}%` : "—"}</TableCell>
                            <TableCell className="text-right">{x.temPct != null ? `${x.temPct.toFixed(2)}%` : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>

          <Separator className="my-8" />
          <div className="text-xs text-muted-foreground">
            Nota: estimaciones y datos de mercado. No incluye impuestos ni particularidades de tu cuenta.
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
