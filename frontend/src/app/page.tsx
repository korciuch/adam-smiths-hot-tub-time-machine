import { Dashboard } from '@/components/Dashboard'
import { getCompanies, getLatestQuotes, getNotes, getPrices } from '@/lib/api/queries'
import type { Price } from '@/lib/api/types'
import { parseDashboardParams } from '@/lib/url-state'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = parseDashboardParams(await searchParams)
  const errors: string[] = []

  const companiesResult = await getCompanies()
  const companies = companiesResult.ok ? companiesResult.data : []
  if (!companiesResult.ok) errors.push(companiesResult.error)

  // Only ask for what is on screen: quotes for every listed company (one request),
  // and daily bars for the charted ones.
  const [quotesResult, notesResult, priceResults] = await Promise.all([
    getLatestQuotes(companies.map((company) => company.ticker)),
    getNotes(),
    Promise.all(
      params.tickers.map(async (ticker) => [ticker, await getPrices(ticker, params)] as const),
    ),
  ])

  if (!quotesResult.ok) errors.push(quotesResult.error)
  if (!notesResult.ok) errors.push(notesResult.error)

  const prices: Record<string, Price[]> = {}
  for (const [ticker, result] of priceResults) {
    if (result.ok) prices[ticker] = result.data
    else errors.push(result.error)
  }

  return (
    <Dashboard
      params={params}
      companies={companies}
      quotes={quotesResult.ok ? quotesResult.data : []}
      notes={notesResult.ok ? notesResult.data : []}
      prices={prices}
      errors={errors}
    />
  )
}
