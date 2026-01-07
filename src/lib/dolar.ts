export type DolarApiResp = {
    moneda: string
    casa: string
    nombre: string
    compra: number
    venta: number
    fechaActualizacion: string
  }
  
  export async function fetchDolarOficial() {
    const r = await fetch("/api/dolar")
    if (!r.ok) throw new Error(`Dolar error: ${r.status}`)
    return (await r.json()) as DolarApiResp
  }
  