/* eslint-disable @typescript-eslint/no-explicit-any */
const URL = "https://www.acuantoesta.com.ar/api/lecaps-prices"

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  try {
    const r = await fetch(URL, {
      method: "GET",
      headers: {
        "User-Agent": "horizon/1.0",
        Accept: "application/json",
      },
    })

    if (!r.ok) {
      const text = await r.text().catch(() => "")
      return res.status(502).json({
        error: `LECAPs upstream error: ${r.status}`,
        details: text.slice(0, 300),
      })
    }

    const data = await r.json()
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Unknown error" })
  }
}
