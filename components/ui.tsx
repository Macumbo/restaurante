"use client";

import { useI18n, LANGUAGES, type Lang } from "@/lib/i18n";
import { formatMoney, formatTime } from "@/lib/format";
import type { Order, OrderStatus, Restaurant } from "@/lib/types";

export function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <select
      aria-label={t("lang.label")}
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold text-slate-700"
    >
      {Object.entries(LANGUAGES).map(([code, { label }]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </select>
  );
}

/** Aplica a marca do restaurante (cores e logo) a tudo o que está dentro. */
export function BrandShell({
  restaurant,
  subtitle,
  right,
  children,
}: {
  restaurant: Pick<Restaurant, "name" | "logo_url" | "primary_color" | "accent_color"> | null;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const style = restaurant
    ? ({ "--brand": restaurant.primary_color, "--accent": restaurant.accent_color } as React.CSSProperties)
    : undefined;
  const initial = restaurant?.name?.trim().charAt(0).toUpperCase() ?? "";
  return (
    <div style={style} className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          {restaurant?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={restaurant.logo_url} alt="" className="h-10 w-10 rounded-2xl object-cover" />
          ) : restaurant ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/10 text-lg font-extrabold text-brand">
              {initial}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="truncate font-extrabold text-slate-900">{restaurant?.name ?? ""}</div>
            {subtitle ? <div className="truncate text-xs font-semibold text-slate-500">{subtitle}</div> : null}
          </div>
          {right}
          <LangSwitch />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-32 pt-4">{children}</main>
    </div>
  );
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending_approval: "bg-amber-100 text-amber-900",
  approved: "bg-sky-100 text-sky-900",
  preparing: "bg-indigo-100 text-indigo-900",
  ready: "bg-emerald-100 text-emerald-900",
  delivered: "bg-slate-200 text-slate-700",
  rejected: "bg-red-100 text-red-900",
  cancelled: "bg-red-100 text-red-900",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${STATUS_STYLE[status]}`}>{t(`status.${status}`)}</span>;
}

/** Itens de um pedido, com os ajustes em destaque (usado pelo cliente, garçom e cozinha). */
export function OrderItems({ order, large = false, currency }: { order: Order; large?: boolean; currency?: string }) {
  const { tx, lang } = useI18n();
  return (
    <ul className={`space-y-2 ${large ? "text-lg" : ""}`}>
      {(order.order_items ?? []).map((it) => (
        <li key={it.id}>
          <div className="flex justify-between gap-2">
            <span className="font-semibold">
              {it.quantity}× {tx(it.dish_name)}
            </span>
            {currency ? <span className="text-slate-600">{formatMoney(it.line_total, currency, lang)}</span> : null}
          </div>
          {it.modifiers.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {it.modifiers.map((m) => (
                <span
                  key={m.id}
                  className={`badge ${m.kind === "remove" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"} ${large ? "text-sm" : ""}`}
                >
                  {m.kind === "remove" ? "− " : "+ "}
                  {tx(m.name)}
                </span>
              ))}
            </div>
          ) : null}
          {it.note ? <div className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-amber-900">“{it.note}”</div> : null}
        </li>
      ))}
      {order.note ? <li className="rounded-lg bg-amber-50 px-2 py-1 text-amber-900">📝 {order.note}</li> : null}
    </ul>
  );
}

export function TimeAgo({ iso }: { iso: string }) {
  const { lang } = useI18n();
  return <span className="text-sm text-slate-500">{formatTime(iso, lang)}</span>;
}

export function Spinner() {
  return <div className="mx-auto my-16 h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand" />;
}
