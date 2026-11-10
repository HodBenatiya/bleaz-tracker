export interface CurrencyAmount {
  currency: string
  amount: number
}

export interface MoneyTotals {
  byCurrency: CurrencyAmount[]
  ils: number | null
  usesRate: boolean
}

export interface CostFigure {
  amount: number | null
  currency: string | null
  converted: boolean
}

export function canonicalCurrency(currency: string): string {
  const text = String(currency || '').trim().toUpperCase()
  if (text === 'NIS' || text === '₪' || text === 'SHEKEL') return 'ILS'
  if (text === '$') return 'USD'
  return text || 'USD'
}

export function spendToIls(amount: number, currency: string, usdToIls: number | null): number | null {
  const code = canonicalCurrency(currency)
  if (code === 'ILS') return amount
  if (code === 'USD' && usdToIls && usdToIls > 0) return amount * usdToIls
  return null
}

export function emptyMoney(): MoneyTotals {
  return { byCurrency: [], ils: 0, usesRate: false }
}

export function addMoney(bag: MoneyTotals, amount: number, currency: string, usdToIls: number | null): MoneyTotals {
  if (!amount) return bag
  const code = canonicalCurrency(currency)
  const byCurrency = bag.byCurrency.map(row => ({ ...row }))
  const found = byCurrency.find(row => row.currency === code)
  if (found) found.amount += amount
  else byCurrency.push({ currency: code, amount })
  const ilsPart = spendToIls(amount, code, usdToIls)
  const ils = bag.ils == null || ilsPart == null ? null : bag.ils + ilsPart
  const usesRate = bag.usesRate || (code === 'USD' && ilsPart != null)
  return { byCurrency, ils, usesRate }
}

export function costOf(money: MoneyTotals, count: number): CostFigure {
  if (count <= 0) return { amount: null, currency: null, converted: false }
  if (money.byCurrency.length === 1) {
    const row = money.byCurrency[0]
    return { amount: row.amount / count, currency: row.currency, converted: false }
  }
  if (money.byCurrency.length > 1 && money.ils != null) {
    return { amount: money.ils / count, currency: 'ILS', converted: true }
  }
  return { amount: null, currency: null, converted: false }
}

function trimNumber(amount: number): string {
  const digits = Math.abs(amount) >= 100 ? 0 : 2
  const fixed = amount.toFixed(digits)
  const [whole, frac] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (!frac || Number(frac) === 0) return grouped
  return `${grouped}.${frac.replace(/0+$/, '')}`
}

export function formatMoney(amount: number, currency: string): string {
  const code = canonicalCurrency(currency)
  const text = trimNumber(amount)
  if (code === 'ILS') return `₪${text}`
  if (code === 'USD') return `$${text}`
  return `${text} ${code}`
}

export function formatMoneyBag(rows: CurrencyAmount[]): string {
  if (!rows.length) return '—'
  return rows.map(row => formatMoney(row.amount, row.currency)).join(' + ')
}

export function formatCost(figure: CostFigure, usdToIls: number | null): { primary: string; note: string } {
  if (figure.amount == null || !figure.currency) {
    return { primary: '—', note: 'אין עדיין מספר לחלק בו' }
  }
  const primary = formatMoney(figure.amount, figure.currency)
  if (figure.converted && usdToIls) return { primary, note: `לפי שער ${trimNumber(usdToIls)} ₪ לדולר` }
  if (figure.currency === 'USD' && usdToIls && usdToIls > 0) {
    return { primary, note: `כ־${formatMoney(figure.amount * usdToIls, 'ILS')} לפי שער ${trimNumber(usdToIls)}` }
  }
  if (figure.currency === 'USD') return { primary, note: 'דולר, בלי המרה לשקל' }
  return { primary, note: 'שקלים' }
}
