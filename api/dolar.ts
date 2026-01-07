import type { VercelRequest, VercelResponse } from "@vercel/node"

const URL = "https://dolarapi.com/v1/dolares/oficial"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")

  try {
    const r = await fetch(URL)
    const text = await r.text()
    res.status(r.status).send(text)
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Unknown error" })
  }
}
