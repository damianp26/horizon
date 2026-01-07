import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { RefreshCcw, Settings } from "lucide-react";

import { useLocalStorageState } from "@/lib/storage";
import {
  bestOffersByDays,
  fetchCauciones,
  type BymaCaucionRow,
} from "@/lib/byma";
import { fetchDolarOficial } from "@/lib/dolar";

import {
  mpProfitCompound,
  netCaucionProfit,
  breakevenTnaToBeatMp,
  type FeeConfig,
} from "@/lib/finance";

import {
  formatDateEsAR,
  formatDateTimeEsAR,
  parseDateYYYYMMDD,
} from "@/lib/format";
import { parseLocaleNumber, formatPctComma } from "@/lib/number";

import { fetchLecapsTable, type LecapsTableItem } from "@/lib/lecaps-table";

/** =========
 * Types
 * ========= */
type SettingsState = {
  capital: number;
  mmTnaPct: number;
  days: number;
  caucionTnaPct: number;
  extraMinProfit: number;
  feeCfgCaucion: FeeConfig;
  feeCfgLecaps: { brokerPct: number };
  showUSD: boolean;
  lecapsFavs: string[];
};

type ConfigDraft = {
  feeCfgCaucion: FeeConfig;
  feeCfgLecaps: { brokerPct: number };
  lecapsFavs: string[];
};

/** =========
 * Helpers
 * ========= */
function formatARS(x: number) {
  return x.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  });
}
function formatUSD(x: number) {
  return x.toLocaleString("es-AR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}
function formatVN(x: number, decimals = 4) {
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function normalizeKey(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\wñáéíóúü %/.$()-]+/g, "")
    .trim();
}

function pickField(row: Record<string, string>, wanted: string[]) {
  const keys = Object.keys(row);
  const norm = keys.map((k) => ({ k, nk: normalizeKey(k) }));
  const targets = wanted.map(normalizeKey);

  for (const t of targets) {
    const exact = norm.find((x) => x.nk === t);
    if (exact) return row[exact.k];
  }
  for (const t of targets) {
    const partial = norm.find((x) => x.nk.includes(t) || t.includes(x.nk));
    if (partial) return row[partial.k];
  }
  return "";
}

function safeDiv(a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return NaN;
  return a / b;
}

// Effective monthly rate from a factor over "days"
function calcTemPct(factor: number, days: number) {
  if (!Number.isFinite(factor) || !Number.isFinite(days) || days <= 0)
    return NaN;
  return (Math.pow(factor, 30 / days) - 1) * 100;
}

// Simple annualized rate from a factor over "days"
function calcTnaPct(factor: number, days: number) {
  if (!Number.isFinite(factor) || !Number.isFinite(days) || days <= 0)
    return NaN;
  return (factor - 1) * (365 / days) * 100;
}

function clampNonNeg(n: number) {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** =========
 * Debounce (para commitear inputs sin trabar)
 * ========= */
function useDebouncedCommit<T>(
  value: T,
  delayMs: number,
  commit: (v: T) => void
) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = window.setTimeout(() => commit(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs, commit]);
}

/** =========
 * Ganancia mínima auto (tabla por tramos)
 * ========= */
const MIN_PROFIT_TABLE: Array<{ days: number; pct: number }> = [
  { days: 7, pct: 0.4 },
  { days: 14, pct: 0.5 },
  { days: 30, pct: 0.7 },
  { days: 60, pct: 1.2 },
  { days: 90, pct: 1.8 },
  { days: 180, pct: 2.5 },
  { days: 365, pct: 4.0 },
];

function minProfitPctForDays(days: number) {
  if (!Number.isFinite(days) || days <= 0) return MIN_PROFIT_TABLE[0].pct;

  let pct = MIN_PROFIT_TABLE[0].pct;
  for (const row of MIN_PROFIT_TABLE) {
    if (days >= row.days) pct = row.pct;
    else break;
  }
  return pct;
}

function calcAutoExtraMinProfit(capital: number, days: number) {
  const cap = Number.isFinite(capital) ? Math.max(0, capital) : 0;
  const pct = minProfitPctForDays(days);
  return Math.round(cap * (pct / 100));
}

/** =========
 * App
 * ========= */
export default function App() {
  const [settings, setSettings] = useLocalStorageState<SettingsState>(
    "horizon.settings.v4",
    {
      capital: 1000000,
      mmTnaPct: 22.1,
      days: 14,
      caucionTnaPct: 40,
      extraMinProfit: 5000,
      feeCfgCaucion: {
        brokerCommissionPct: 0.15,
        ivaPct: 21,
        otherCostsPct: 0,
      },
      feeCfgLecaps: { brokerPct: 0.15 },
      showUSD: false,
      lecapsFavs: [
        "S16E6",
        "S17A6",
        "S27F6",
        "S29Y6",
        "S30A6",
        "S30O6",
        "S31G6",
      ],
    }
  );

  const [, startTransition] = useTransition();

  // IMPORTANTE: usamos valores "diferidos" para que, mientras tipeás, no se recalculen cosas pesadas.
  const deferredSettings = useDeferredValue(settings);

  // Si la usuaria toca manualmente Ganancia mínima, dejamos de auto-actualizar hasta que toque refresh.
  const [extraMinManual, setExtraMinManual] = useState(false);

  // Defensive migration if older versions stored lecapsFavs differently
  useEffect(() => {
    const favAny: any = (settings as any).lecapsFavs;
    if (Array.isArray(favAny)) return;
    let migrated: string[] = [];
    if (favAny && typeof favAny === "object") migrated = Object.keys(favAny);
    setSettings((s) => ({ ...s, lecapsFavs: migrated }));
  }, [settings, setSettings]);

  /** =========
   * Inputs “suaves”: no escribimos en settings (y localStorage) en cada tecla
   * ========= */
  const [capitalInput, setCapitalInput] = useState(String(settings.capital));
  const [daysInput, setDaysInput] = useState(String(settings.days));
  const [extraMinInput, setExtraMinInput] = useState(
    String(settings.extraMinProfit)
  );

  // MM/Caución ya eran string: pero ahora también commit en blur + debounce
  const [mmInput, setMmInput] = useState(formatPctComma(settings.mmTnaPct, 2));
  const [caucInput, setCaucInput] = useState(
    formatPctComma(settings.caucionTnaPct, 2)
  );

  // Sincronizo inputs si settings cambia “desde afuera” (botón Usar, refresh, etc.)
  useEffect(() => setCapitalInput(String(settings.capital)), [settings.capital]);
  useEffect(() => setDaysInput(String(settings.days)), [settings.days]);
  useEffect(
    () => setExtraMinInput(String(settings.extraMinProfit)),
    [settings.extraMinProfit]
  );
  useEffect(
    () => setMmInput(formatPctComma(settings.mmTnaPct, 2)),
    [settings.mmTnaPct]
  );
  useEffect(
    () => setCaucInput(formatPctComma(settings.caucionTnaPct, 2)),
    [settings.caucionTnaPct]
  );

  const commitCapital = (rawStr: string) => {
    const raw = (rawStr ?? "").replace(/[^\d]/g, "");
    const n = Math.max(0, Number(raw || 0));
    startTransition(() => setSettings((s) => ({ ...s, capital: n })));
  };

  const commitDays = (rawStr: string) => {
    const raw = (rawStr ?? "").replace(/[^\d]/g, "");
    const n = Math.max(0, Number(raw || 0));
    startTransition(() => setSettings((s) => ({ ...s, days: n })));
  };

  const commitExtraMin = (rawStr: string) => {
    const raw = (rawStr ?? "").replace(/[^\d]/g, "");
    const n = Math.max(0, Number(raw || 0));
    setExtraMinManual(true);
    startTransition(() => setSettings((s) => ({ ...s, extraMinProfit: n })));
  };

  const commitMm = (rawStr: string) => {
    const n = parseLocaleNumber(rawStr);
    if (n === null) return;
    startTransition(() => setSettings((s) => ({ ...s, mmTnaPct: n })));
  };

  const commitCauc = (rawStr: string) => {
    const n = parseLocaleNumber(rawStr);
    if (n === null) return;
    startTransition(() => setSettings((s) => ({ ...s, caucionTnaPct: n })));
  };

  // Debounce: mientras tipeás, “pre-commit” cada 250ms (si querés más suave, subilo a 350/500)
  useDebouncedCommit(capitalInput, 250, commitCapital);
  useDebouncedCommit(daysInput, 250, commitDays);

  // Ganancia mínima: solo debounced si está en modo manual
  useEffect(() => {
    if (!extraMinManual) return;
    const id = window.setTimeout(() => commitExtraMin(extraMinInput), 250);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraMinInput, extraMinManual]);

  // MM/Caución también pueden ir debounced (para ver resultados “casi en vivo” sin trabar)
  useDebouncedCommit(mmInput, 300, commitMm);
  useDebouncedCommit(caucInput, 300, commitCauc);

  /** =========
   * Auto-fill ganancia mínima (solo cuando NO es manual)
   * ========= */
  useEffect(() => {
    if (extraMinManual) return;
    const auto = calcAutoExtraMinProfit(settings.capital, settings.days);
    if (auto === settings.extraMinProfit) return;
    setSettings((s) => ({ ...s, extraMinProfit: auto }));
  }, [
    settings.capital,
    settings.days,
    settings.extraMinProfit,
    extraMinManual,
    setSettings,
  ]);

  /** =========
   * Data
   * ========= */
  const [rows, setRows] = useState<BymaCaucionRow[] | null>(null);
  const [lecapsTable, setLecapsTable] = useState<LecapsTableItem[] | null>(
    null
  );

  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [usdVenta, setUsdVenta] = useState<number | null>(null);
  const [usdUpdatedAt, setUsdUpdatedAt] = useState<Date | null>(null);

  const [lecapsUpdatedAt, setLecapsUpdatedAt] = useState<Date | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Config modal
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgDraft, setCfgDraft] = useState<ConfigDraft>({
    feeCfgCaucion: settings.feeCfgCaucion,
    feeCfgLecaps: settings.feeCfgLecaps,
    lecapsFavs: settings.lecapsFavs,
  });
  const [lecapsSearch, setLecapsSearch] = useState("");

  useEffect(() => {
    if (cfgOpen) {
      setCfgDraft({
        feeCfgCaucion: settings.feeCfgCaucion,
        feeCfgLecaps: settings.feeCfgLecaps,
        lecapsFavs: Array.isArray(settings.lecapsFavs)
          ? settings.lecapsFavs
          : [],
      });
      setLecapsSearch("");
    }
  }, [cfgOpen, settings]);

  async function refreshAll() {
    setLoading(true);
    setError("");
    try {
      const [cauc, usd, lecTable] = await Promise.allSettled([
        fetchCauciones(),
        fetchDolarOficial(),
        fetchLecapsTable(),
      ]);

      if (cauc.status === "fulfilled") setRows(cauc.value);
      else setError(cauc.reason?.message ?? "Error cauciones");

      if (usd.status === "fulfilled") {
        setUsdVenta(Number(usd.value.venta));
        setUsdUpdatedAt(new Date(usd.value.fechaActualizacion));
      }

      if (lecTable.status === "fulfilled") {
        setLecapsTable(lecTable.value);
        setLecapsUpdatedAt(new Date());
      }

      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    const id = window.setInterval(() => refreshAll(), 20 * 60 * 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const best = useMemo(
    () => (rows ? bestOffersByDays(rows, "ARS") : {}),
    [rows]
  );

  function pickFromMarket(days: number, rate: number) {
    startTransition(() => {
      setSettings((s) => ({ ...s, days, caucionTnaPct: Math.max(0, rate) }));
    });
    setDaysInput(String(days));
    setCaucInput(formatPctComma(Math.max(0, rate), 2));
  }

  const fx =
    deferredSettings.showUSD && usdVenta ? Number(usdVenta) : (null as null);
  const money = (ars: number) => (fx ? formatUSD(ars / fx) : formatARS(ars));

  /** =========
   * Core MM vs Caución calculation (con deferredSettings)
   * ========= */
  const calc = useMemo(() => {
    const {
      capital,
      days,
      caucionTnaPct,
      mmTnaPct,
      feeCfgCaucion,
      extraMinProfit,
    } = deferredSettings;

    const cauc = netCaucionProfit(
      capital,
      days,
      caucionTnaPct,
      feeCfgCaucion,
      365
    );
    const mm = mpProfitCompound(capital, days, mmTnaPct, 365);

    const diff = cauc.net - mm.gain;
    const breakeven = breakevenTnaToBeatMp(
      capital,
      days,
      mmTnaPct,
      feeCfgCaucion,
      extraMinProfit,
      365
    );
    const worthIt = diff >= extraMinProfit;

    return { cauc, mm, diff, breakeven, worthIt };
  }, [deferredSettings]);

  /** =========
   * Pre-cálculo tabla cauciones (con deferredSettings)
   * ========= */
  const bestTableRows = useMemo(() => {
    const entries = Object.entries(best).sort(
      ([a], [b]) => Number(a) - Number(b)
    );

    return entries.map(([d, row]) => {
      const days = Number(d);
      const rate = Number(row.settlementPrice ?? 0);
      const dt = parseDateYYYYMMDD(row.maturityDate ?? "");
      const vto = dt ? formatDateEsAR(dt) : row.maturityDate ?? "-";

      const tmpCauc = netCaucionProfit(
        deferredSettings.capital,
        days,
        rate,
        deferredSettings.feeCfgCaucion,
        365
      );
      const tmpMM = mpProfitCompound(
        deferredSettings.capital,
        days,
        deferredSettings.mmTnaPct,
        365
      );
      const tmpDiff = tmpCauc.net - tmpMM.gain;
      const isHot = tmpDiff >= deferredSettings.extraMinProfit;

      return { key: d, days, rate, vto, isHot };
    });
  }, [
    best,
    deferredSettings.capital,
    deferredSettings.mmTnaPct,
    deferredSettings.feeCfgCaucion,
    deferredSettings.extraMinProfit,
  ]);

  /** =========
   * LECAPs table helpers
   * ========= */
  const allLecapTickers = useMemo(() => {
    const tickers = new Set<string>();
    (lecapsTable ?? []).forEach((row) => {
      const t = row._ticker || pickField(row, ["Ticker"]) || "";
      if (t) tickers.add(t.trim());
    });
    return Array.from(tickers).sort();
  }, [lecapsTable]);

  const filteredLecapTickers = useMemo(() => {
    const q = lecapsSearch.trim().toUpperCase();
    if (!q) return allLecapTickers;
    return allLecapTickers.filter((t) => t.toUpperCase().includes(q));
  }, [lecapsSearch, allLecapTickers]);

  const derivedLecaps = useMemo(() => {
    const favs = Array.isArray(deferredSettings.lecapsFavs)
      ? deferredSettings.lecapsFavs
      : [];
    const table = lecapsTable ?? [];

    const mapByTicker = new Map<string, LecapsTableItem>();
    for (const row of table) {
      const t = (row._ticker || pickField(row, ["Ticker"]) || "").trim();
      if (t) mapByTicker.set(t, row);
    }

    const brokerPct = clampNonNeg(deferredSettings.feeCfgLecaps.brokerPct);
    const horizonDays = clampNonNeg(deferredSettings.days);

    const mmFinal = (principal: number, days: number) => {
      const mm = mpProfitCompound(principal, days, deferredSettings.mmTnaPct, 365);
      return { gain: mm.gain, final: principal + mm.gain };
    };

    return favs
      .map((ticker) => {
        const row = mapByTicker.get(ticker);
        if (!row) return null;

        const vtoStr = pickField(row, ["Vencimiento", "Vto"]);
        const diasStr = pickField(row, ["Días", "Dias"]);
        const precioStr = pickField(row, ["Precio (1VN)", "Precio"]);
        const cambioStr = pickField(row, ["Cambio", "Var.", "Var"]);
        const aRecibirStr = pickField(row, [
          "A recibir al vto. (1VN)",
          "A recibir al vto",
          "A recibir",
        ]);

        const dias = parseLocaleNumber(diasStr) ?? null;
        const precio = parseLocaleNumber(precioStr) ?? null;
        const cambio = parseLocaleNumber(cambioStr) ?? null;
        const aRecibir = parseLocaleNumber(aRecibirStr) ?? null;

        const precioConCom =
          precio != null ? precio * (1 + brokerPct / 100) : null;
        const factor =
          precioConCom != null && aRecibir != null
            ? safeDiv(aRecibir, precioConCom)
            : NaN;

        const ganPct = Number.isFinite(factor) ? (factor - 1) * 100 : null;
        const tnaPct =
          Number.isFinite(factor) && dias != null
            ? calcTnaPct(factor, dias)
            : null;
        const temPct =
          Number.isFinite(factor) && dias != null
            ? calcTemPct(factor, dias)
            : null;

        const qty =
          precioConCom != null && precioConCom > 0
            ? Math.floor(deferredSettings.capital / precioConCom)
            : 0;
        const invested =
          qty > 0 && precioConCom != null ? qty * precioConCom : 0;
        const leftover = Math.max(0, deferredSettings.capital - invested);

        const maturityFinal =
          qty > 0 && aRecibir != null ? qty * aRecibir + leftover : null;
        const gainARS =
          maturityFinal != null ? maturityFinal - deferredSettings.capital : null;

        let horizonGainARS: number | null = null;
        let horizonEligible = false;

        if (
          maturityFinal != null &&
          dias != null &&
          dias > 0 &&
          dias <= horizonDays
        ) {
          horizonEligible = true;
          const remaining = Math.max(0, horizonDays - dias);
          const mmAfter = mmFinal(maturityFinal, remaining);
          horizonGainARS = mmAfter.final - deferredSettings.capital;
        }

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
          gainARS,
          horizonEligible,
          horizonGainARS,
        };
      })
      .filter(Boolean) as Array<{
      ticker: string;
      vtoStr: string;
      dias: number | null;
      precio: number | null;
      cambio: number | null;
      precioConCom: number | null;
      aRecibir: number | null;
      ganPct: number | null;
      tnaPct: number | null;
      temPct: number | null;
      gainARS: number | null;
      horizonEligible: boolean;
      horizonGainARS: number | null;
    }>;
  }, [deferredSettings, lecapsTable]);

  const bestLecapForHorizon = useMemo(() => {
    const eligible = derivedLecaps
      .filter((x) => x.horizonEligible && x.horizonGainARS != null)
      .sort(
        (a, b) =>
          (b.horizonGainARS ?? -Infinity) - (a.horizonGainARS ?? -Infinity)
      );
    return eligible[0] ?? null;
  }, [derivedLecaps]);

  const recommendation = useMemo(() => {
    const mmGain = calc.mm.gain;
    const caucGain = calc.cauc.net;

    const bestL = bestLecapForHorizon;
    const lecGain = bestL?.horizonGainARS ?? null;

    const minExtra = clampNonNeg(deferredSettings.extraMinProfit);

    const caucExtra = caucGain - mmGain;
    const lecExtra = lecGain != null ? lecGain - mmGain : null;

    const caucWorth = caucExtra >= minExtra;
    const lecWorth = lecExtra != null && lecExtra >= minExtra;

    if (!caucWorth && !lecWorth) {
      return {
        type: "MM" as const,
        label: "Recomendación: Money Market",
        detail: null as null | string,
        caucExtra,
        lecExtra,
      };
    }

    if (caucWorth && !lecWorth) {
      return {
        type: "CAUCION" as const,
        label: "Recomendación: Caución",
        detail: null,
        caucExtra,
        lecExtra,
      };
    }
    if (!caucWorth && lecWorth) {
      return {
        type: "LECAP" as const,
        label: `Recomendación: LECAP ${bestL?.ticker ?? ""}`.trim(),
        detail: bestL?.dias != null ? `Vto en ${bestL.dias} días` : null,
        caucExtra,
        lecExtra,
      };
    }

    const bestIsLecap = (lecGain ?? -Infinity) > caucGain;
    if (bestIsLecap) {
      return {
        type: "LECAP" as const,
        label: `Recomendación: LECAP ${bestL?.ticker ?? ""}`.trim(),
        detail: bestL?.dias != null ? `Vto en ${bestL.dias} días` : null,
        caucExtra,
        lecExtra,
      };
    }

    return {
      type: "CAUCION" as const,
      label: "Recomendación: Caución",
      detail: null,
      caucExtra,
      lecExtra,
    };
  }, [calc.mm.gain, calc.cauc.net, bestLecapForHorizon, deferredSettings.extraMinProfit]);

  function toggleFav(ticker: string) {
    setCfgDraft((d) => {
      const set = new Set(d.lecapsFavs);
      if (set.has(ticker)) set.delete(ticker);
      else set.add(ticker);
      return { ...d, lecapsFavs: Array.from(set).sort() };
    });
  }

  return (
    <TooltipProvider>
      <div
        className="min-h-svh bg-[radial-gradient(1100px_circle_at_15%_0%,hsl(var(--muted))_0%,transparent_55%),radial-gradient(900px_circle_at_85%_10%,hsl(var(--accent))_0%,transparent_55%)]"
        style={{
          fontFamily:
            '"Nunito", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Horizon</h1>
              <p className="text-sm text-muted-foreground">
                Radar de cauciones + comparación vs Money Market + LECAPs
                favoritas
              </p>
            </div>

            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                value={settings.showUSD ? "USD" : "ARS"}
                onValueChange={(v) => {
                  if (!v) return;
                  startTransition(() => {
                    setSettings((s) => ({ ...s, showUSD: v === "USD" }));
                  });
                }}
              >
                <ToggleGroupItem
                  value="ARS"
                  aria-label="Mostrar ARS"
                  className="px-3"
                >
                  AR$
                </ToggleGroupItem>

                <ToggleGroupItem
                  value="USD"
                  aria-label="Mostrar USD"
                  className="px-3"
                  disabled={!usdVenta}
                  title={
                    !usdVenta
                      ? "USD no disponible"
                      : "Mostrar USD (dólar oficial venta)"
                  }
                >
                  US$
                </ToggleGroupItem>
              </ToggleGroup>

              <ModeToggle />

              <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="icon" title="Configuración">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DialogTrigger>

                <DialogContent className="sm:max-w-5xl max-h-[85svh] overflow-hidden">
                  <DialogHeader>
                    <DialogTitle>Configuración</DialogTitle>
                    <DialogDescription>
                      Comisiones y favoritos. Se guarda en tu navegador.
                    </DialogDescription>
                  </DialogHeader>

                  <ScrollArea className="h-[62svh] pr-3">
                    <div className="grid gap-6 py-2">
                      <div className="grid gap-6 md:grid-cols-2">
                        <div className="rounded-lg border bg-card/60 p-4 shadow-sm">
                          <div className="text-sm font-medium mb-3">
                            Costos (Caución)
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label>Comisión broker (%)</Label>
                              <Input
                                inputMode="decimal"
                                value={formatPctComma(
                                  cfgDraft.feeCfgCaucion.brokerCommissionPct,
                                  3
                                )}
                                onChange={(e) => {
                                  const n = parseLocaleNumber(e.target.value);
                                  if (n === null) return;
                                  setCfgDraft((d) => ({
                                    ...d,
                                    feeCfgCaucion: {
                                      ...d.feeCfgCaucion,
                                      brokerCommissionPct: n,
                                    },
                                  }));
                                }}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>IVA (%)</Label>
                              <Input
                                inputMode="decimal"
                                value={formatPctComma(
                                  cfgDraft.feeCfgCaucion.ivaPct,
                                  2
                                )}
                                onChange={(e) => {
                                  const n = parseLocaleNumber(e.target.value);
                                  if (n === null) return;
                                  setCfgDraft((d) => ({
                                    ...d,
                                    feeCfgCaucion: {
                                      ...d.feeCfgCaucion,
                                      ivaPct: n,
                                    },
                                  }));
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="rounded-lg border bg-card/60 p-4 shadow-sm">
                          <div className="text-sm font-medium mb-3">
                            Costos (LECAPs)
                          </div>
                          <div className="grid gap-3">
                            <div className="space-y-2">
                              <Label>Comisión broker (%)</Label>
                              <Input
                                inputMode="decimal"
                                value={formatPctComma(
                                  cfgDraft.feeCfgLecaps.brokerPct,
                                  3
                                )}
                                onChange={(e) => {
                                  const n = parseLocaleNumber(e.target.value);
                                  if (n === null) return;
                                  setCfgDraft((d) => ({
                                    ...d,
                                    feeCfgLecaps: {
                                      ...d.feeCfgLecaps,
                                      brokerPct: n,
                                    },
                                  }));
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border bg-card/60 p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div className="text-sm font-medium">
                            LECAPs favoritas
                          </div>
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

                        <ScrollArea className="h-64 rounded-md border bg-background/40">
                          <div className="p-3 space-y-2">
                            {filteredLecapTickers.length === 0 && (
                              <div className="text-sm text-muted-foreground">
                                No hay resultados.
                              </div>
                            )}

                            {filteredLecapTickers.map((t) => {
                              const checked = cfgDraft.lecapsFavs.includes(t);
                              return (
                                <div
                                  key={t}
                                  className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                                >
                                  <div className="flex items-center gap-3">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => toggleFav(t)}
                                    />
                                    <div className="leading-tight">
                                      <div className="text-sm font-medium">
                                        {t}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      </div>
                    </div>
                  </ScrollArea>

                  <DialogFooter>
                    <Button
                      variant="secondary"
                      onClick={() => setCfgOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={() => {
                        startTransition(() => {
                          setSettings((s) => ({
                            ...s,
                            feeCfgCaucion: cfgDraft.feeCfgCaucion,
                            feeCfgLecaps: cfgDraft.feeCfgLecaps,
                            lecapsFavs: cfgDraft.lecapsFavs,
                          }));
                        });
                        setCfgOpen(false);
                      }}
                    >
                      Guardar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button
                variant="secondary"
                onClick={refreshAll}
                disabled={loading}
              >
                {loading ? "Actualizando..." : "Actualizar"}
              </Button>

              <div className="flex flex-col items-end leading-tight">
                {lastUpdated && (
                  <span className="text-xs text-muted-foreground">
                    {formatDateTimeEsAR(lastUpdated)}
                  </span>
                )}
                {usdVenta && usdUpdatedAt && (
                  <span className="text-[11px] text-muted-foreground">
                    USD venta: {usdVenta.toLocaleString("es-AR")} (
                    {formatDateEsAR(usdUpdatedAt)})
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
            <Card className="mb-6 border-destructive/40 bg-card/60 shadow-sm">
              <CardContent className="py-4 text-sm text-destructive">
                Error: {error}
              </CardContent>
            </Card>
          )}

          {/* ROW 1 */}
          <div className="grid gap-6 lg:grid-cols-2 items-start">
            <Card className="shadow-sm bg-card/60 backdrop-blur flex flex-col">
              <CardHeader>
                <CardTitle className="text-base">Mi operación</CardTitle>
              </CardHeader>

              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label>Liquidez (ARS)</Label>
                      <Input
                        inputMode="numeric"
                        value={capitalInput}
                        onChange={(e) =>
                          setCapitalInput(e.target.value.replace(/[^\d]/g, ""))
                        }
                        onBlur={() => commitCapital(capitalInput)}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between -mt-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Label className="cursor-help underline decoration-dotted underline-offset-4 leading-none">
                              Ganancia mínima
                            </Label>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            Es la ganancia mínima adicional requerida frente a
                            las alternativas disponibles.
                          </TooltipContent>
                        </Tooltip>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="-my-1 h-6 w-6 rounded-full p-0"
                          title="Recalcular según plazo"
                          onClick={() => {
                            const auto = calcAutoExtraMinProfit(
                              settings.capital,
                              settings.days
                            );
                            setExtraMinManual(false);
                            startTransition(() => {
                              setSettings((s) => ({
                                ...s,
                                extraMinProfit: auto,
                              }));
                            });
                          }}
                        >
                          <RefreshCcw className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <Input
                        inputMode="numeric"
                        value={extraMinInput}
                        onChange={(e) => {
                          setExtraMinManual(true);
                          setExtraMinInput(e.target.value.replace(/[^\d]/g, ""));
                        }}
                        onBlur={() => commitExtraMin(extraMinInput)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Money Market (TNA %)</Label>
                      <Input
                        inputMode="decimal"
                        value={mmInput}
                        onChange={(e) => setMmInput(e.target.value)}
                        onBlur={() => commitMm(mmInput)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Plazo (días)</Label>
                      <Input
                        inputMode="numeric"
                        value={daysInput}
                        onChange={(e) =>
                          setDaysInput(e.target.value.replace(/[^\d]/g, ""))
                        }
                        onBlur={() => commitDays(daysInput)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Caución (TNA %)</Label>
                      <Input
                        inputMode="decimal"
                        value={caucInput}
                        onChange={(e) => setCaucInput(e.target.value)}
                        onBlur={() => commitCauc(caucInput)}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm bg-card/60 backdrop-blur flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Resultado</CardTitle>

                {recommendation.type === "MM" && (
                  <Badge variant="secondary" className="text-xs">
                    {recommendation.label}
                  </Badge>
                )}
                {recommendation.type === "CAUCION" && (
                  <Badge className="text-xs">{recommendation.label}</Badge>
                )}
                {recommendation.type === "LECAP" && (
                  <Badge className="text-xs">{recommendation.label}</Badge>
                )}
              </CardHeader>

              <CardContent className="flex-1">
                <div className="flex flex-col">
                  <div className="grid gap-6 md:grid-cols-3">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">
                        Caución
                      </div>
                      <div className="text-sm">
                        Bruto:{" "}
                        <span className="font-medium">
                          {money(calc.cauc.gross)}
                        </span>
                      </div>
                      <div className="text-sm">
                        Costos:{" "}
                        <span className="font-medium">
                          {money(calc.cauc.cost)}
                        </span>
                      </div>
                      <div className="text-sm">
                        Neto:{" "}
                        <span className="font-medium">
                          {money(calc.cauc.net)}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">
                        Money Market
                      </div>
                      <div className="text-sm">
                        Ganancia:{" "}
                        <span className="font-medium">
                          {money(calc.mm.gain)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Nota: genera interes compuesto.
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">
                        Ganancia Extra
                      </div>

                      <div className="text-sm">
                        Caución:{" "}
                        <span
                          className={`font-medium ${
                            recommendation.caucExtra >= 0
                              ? "text-foreground"
                              : "text-destructive"
                          }`}
                        >
                          {money(recommendation.caucExtra)}
                        </span>
                      </div>

                      <div className="text-sm">
                        {bestLecapForHorizon?.ticker ? (
                          <>
                            <span className="font-medium">
                              {bestLecapForHorizon.ticker}
                            </span>
                            {": "}
                            <span
                              className={`font-medium ${
                                (recommendation.lecExtra ?? 0) >= 0
                                  ? "text-foreground"
                                  : "text-destructive"
                              }`}
                            >
                              {recommendation.lecExtra != null
                                ? money(recommendation.lecExtra)
                                : "—"}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>

                      <div className="text-sm">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted">
                              TNA Min.
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            Es la TNA mínima de la caución para ganarle al Money
                            Market por tu “ganancia mínima”.
                          </TooltipContent>
                        </Tooltip>
                        :{" "}
                        <span className="font-medium">
                          {calc.breakeven.toFixed(2)}%
                        </span>
                      </div>

                      {recommendation.detail && (
                        <div className="text-xs text-muted-foreground">
                          {recommendation.detail}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ROW 2 */}
          <div className="grid gap-6 lg:grid-cols-2 items-stretch mt-6">
            <Card className="shadow-sm bg-card/60 backdrop-blur flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  Mejores cauciones ARS (1–30 días)
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  Fuente: BYMA
                </Badge>
              </CardHeader>

              <CardContent className="flex-1">
                <ScrollArea className="h-[360px] rounded-md border bg-background/40">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background/80 backdrop-blur">
                      <TableRow>
                        <TableHead className="w-16">Días</TableHead>
                        <TableHead>Vto</TableHead>
                        <TableHead className="text-right">TNA</TableHead>
                        <TableHead className="text-center w-28">
                          Estado
                        </TableHead>
                        <TableHead className="text-right w-24">
                          Acción
                        </TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {Object.keys(best).length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="text-sm text-muted-foreground"
                          >
                            Sin datos todavía (o BYMA no respondió).
                          </TableCell>
                        </TableRow>
                      )}

                      {bestTableRows.map((r) => (
                        <TableRow key={r.key}>
                          <TableCell>{r.days}</TableCell>
                          <TableCell>{r.vto}</TableCell>
                          <TableCell className="text-right">
                            {r.rate.toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-center">
                            {r.isHot ? (
                              <Badge className="text-xs">Interesante</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                Normal
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => pickFromMarket(r.days, r.rate)}
                            >
                              Usar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="shadow-sm bg-card/60 backdrop-blur flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">LECAPs favoritas</CardTitle>
                <Badge variant="outline" className="text-xs">
                  Fuente: Acuantoesta
                </Badge>
              </CardHeader>

              <CardContent className="flex-1">
                <ScrollArea className="h-[360px] rounded-md border bg-background/40">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background/80 backdrop-blur">
                      <TableRow>
                        <TableHead className="w-24">Ticker</TableHead>
                        <TableHead>Vto</TableHead>
                        <TableHead className="text-right w-16">Días</TableHead>
                        <TableHead className="text-right">Ganancia %</TableHead>
                        <TableHead className="text-right">
                          Ganancia $ (vto)
                        </TableHead>
                        <TableHead className="text-right">TNA</TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {derivedLecaps.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={8}
                            className="text-sm text-muted-foreground"
                          >
                            No hay favoritas seleccionadas (abrí Config y elegí
                            algunas).
                          </TableCell>
                        </TableRow>
                      )}

                      {derivedLecaps.map((x) => (
                        <TableRow key={x.ticker}>
                          <TableCell className="font-medium">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help underline decoration-dotted underline-offset-4">
                                  {x.ticker}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">
                                <div className="space-y-1">
                                  <div>
                                    <span className="text-muted-foreground">
                                      Precio (1VN):{" "}
                                    </span>
                                    <span className="font-medium">
                                      {x.precio != null
                                        ? formatVN(x.precio, 4)
                                        : "—"}
                                    </span>
                                  </div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>

                          <TableCell>{x.vtoStr || "—"}</TableCell>
                          <TableCell className="text-right">
                            {x.dias ?? "—"}
                          </TableCell>

                          <TableCell className="text-right">
                            {x.ganPct != null ? `${x.ganPct.toFixed(2)}%` : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {x.gainARS != null ? money(x.gainARS) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {x.tnaPct != null ? `${x.tnaPct.toFixed(2)}%` : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>

                <div className="mt-2 text-xs text-muted-foreground">
                  LECAP “compite” si vence en ≤ tu plazo. Si vence antes, se
                  asume reinversión en Money Market por los días restantes.
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator className="my-8" />
          <div className="text-xs text-muted-foreground">
            Nota: estimaciones y datos de mercado. No incluye impuestos ni
            particularidades de tu cuenta.
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
