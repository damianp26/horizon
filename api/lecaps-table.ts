// api/lecaps-table.ts
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { scrapeLecapsTable } from "./_shared/lecapsScrape"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const data = await scrapeLecapsTable()
    res.status(200).json(data)
  } catch (err: any) {
    res.status(500).json({
      error: "LECAPS_SCRAPE_FAILED",
      message: err?.message ?? String(err),
    })
  }
}
