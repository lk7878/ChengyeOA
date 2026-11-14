/** Decimal(18,2) amounts stay decimal strings; no binary floating-point arithmetic. */
export function moneyMinor(value: string): bigint {
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) throw new Error('金额格式无效');
  const [whole, part = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(part.padEnd(2, '0'));
}
export function moneyBalance(amount: string, received: string): string {
  const difference = moneyMinor(amount) - moneyMinor(received);
  if (difference < 0n) throw new Error('金额余额异常，请核对原单据');
  return `${difference / 100n}.${String(difference % 100n).padStart(2, '0')}`;
}

export function currencyKey(value: unknown): string {
  const text = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  const [whole, decimals = ''] = text.replace(/^-/, '').split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const fraction = decimals.replace(/0+$/, '');
  const magnitude = integer + (fraction ? '.' + fraction : '');
  return text.startsWith('-') && magnitude !== '0' ? '-' + magnitude : magnitude;
}
