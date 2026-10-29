/** Decimal-safe comparison for explicit user-entered route quotes. Values are never fetched. */
const RATE_SCALE = 100_000_000n;

function parseDecimal(value: string, scaleDigits: number, label: string): bigint {
  const re = new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${scaleDigits}})?$`);
  if (typeof value !== 'string' || value.length > 48 || !re.test(value)) throw new Error(`${label} must be a non-negative decimal with at most ${scaleDigits} decimal places.`);
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 10n ** BigInt(scaleDigits) + BigInt(fraction.padEnd(scaleDigits, '0') || '0');
}

export interface CostQuoteInput { label: string; sourceAmount: string; destinationAmount: string; sourceFee: string }
export interface ComparedCostQuote { label: string; destinationAmount: string; sourceFee: string; effectiveCostDestination: string }

/**
 * Compares quotes for one source amount using a user-supplied reference rate (destination/source).
 * Effective cost = (source amount + source-denominated fees) × reference rate − net destination received.
 * This is a planning estimate; quote freshness, execution, and omitted fees remain the user's responsibility.
 */
export function compareTreasuryCosts(input: {
  sourceAmount: string; referenceRate: string; quotes: CostQuoteInput[];
}): ComparedCostQuote[] {
  const source = parseDecimal(input.sourceAmount, 6, 'Source amount');
  const rate = parseDecimal(input.referenceRate, 8, 'Reference rate');
  if (source <= 0n || rate <= 0n) throw new Error('Source amount and reference rate must be greater than zero.');
  if (!Array.isArray(input.quotes) || input.quotes.length < 2 || input.quotes.length > 8) throw new Error('Enter between two and eight quotes to compare.');
  const seen = new Set<string>();
  return input.quotes.map((quote, index) => {
    const label = quote.label.trim();
    if (!label || label.length > 40 || seen.has(label.toLowerCase())) throw new Error(`Quote ${index + 1} needs a unique label of 1–40 characters.`);
    seen.add(label.toLowerCase());
    if (parseDecimal(quote.sourceAmount, 6, `Quote ${index + 1} source amount`) !== source) throw new Error('All quotes must use the same source amount.');
    const received = parseDecimal(quote.destinationAmount, 6, `Quote ${index + 1} destination amount`);
    const fee = parseDecimal(quote.sourceFee, 6, `Quote ${index + 1} source fee`);
    const cost = ((source + fee) * rate) / RATE_SCALE - received;
    return { label, destinationAmount: quote.destinationAmount, sourceFee: quote.sourceFee, effectiveCostDestination: formatScaled(cost, 6) };
  }).sort((a, b) => {
    const costUnits = (value: string) => {
      const negative = value.startsWith('-');
      return parseDecimal(negative ? value.slice(1) : value, 6, 'Cost') * (negative ? -1n : 1n);
    };
    const left = costUnits(a.effectiveCostDestination); const right = costUnits(b.effectiveCostDestination);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function formatScaled(value: bigint, digits: number): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const base = 10n ** BigInt(digits);
  const fraction = (abs % base).toString().padStart(digits, '0').replace(/0+$/, '');
  return `${sign}${abs / base}${fraction ? `.${fraction}` : ''}`;
}
