export function formatMoney(value: number, currency = "AOA", lang = "pt") {
  const locale = lang === "en" ? "en-GB" : "pt-AO";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

export function formatTime(iso: string, lang = "pt") {
  return new Date(iso).toLocaleTimeString(lang === "en" ? "en-GB" : "pt-AO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
