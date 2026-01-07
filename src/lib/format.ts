export function capitalizeEs(s: string) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
  }
  
  export function formatDateEsAR(date: Date) {
    const fmt = new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
    return capitalizeEs(fmt.format(date))
  }
  
  export function formatDateTimeEsAR(date: Date) {
    const fmt = new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    return `${capitalizeEs(fmt.format(date))}hs`
  }
  
  export function parseDateYYYYMMDD(s?: string) {
    // "2026-01-06" => Date local (evita corrimientos por TZ)
    if (!s) return null
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    if (!m) return null
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3])
    return new Date(y, mo, d)
  }
  