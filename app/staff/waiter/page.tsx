"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { errorKey, supabase } from "@/lib/supabase";
import { StaffGate } from "@/lib/useStaff";
import { beep, useLiveRestaurant } from "@/lib/useLiveRestaurant";
import { formatMoney, formatTime } from "@/lib/format";
import { OrderItems, StatusBadge, TimeAgo } from "@/components/ui";
import type { Restaurant } from "@/lib/types";

export default function WaiterPage() {
  const { t } = useI18n();
  return <StaffGate screen="waiter" title={t("staff.waiter")}>{({ restaurant }) => <Waiter restaurant={restaurant} />}</StaffGate>;
}

function Waiter({ restaurant }: { restaurant: Restaurant }) {
  const { t, lang } = useI18n();
  const live = useLiveRestaurant(restaurant.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = live.sessions.filter((s) => s.status === "pending");
  const confirmed = live.sessions.filter((s) => s.status === "confirmed");
  const ready = live.orders.filter((o) => o.status === "ready");

  // Aviso sonoro quando aparece uma mesa nova ou um pedido pronto
  const lastCount = useRef(0);
  useEffect(() => {
    const n = pending.length + ready.length;
    if (n > lastCount.current) beep();
    lastCount.current = n;
  }, [pending.length, ready.length]);

  async function run(id: string, fn: string, args: Record<string, string>) {
    setBusy(id);
    setError(null);
    const { error } = await supabase().rpc(fn, args);
    setBusy(null);
    if (error) setError(t(`error.${errorKey(error)}` as never));
    void live.reload();
  }

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-xl bg-red-50 px-3 py-2 text-red-800">{error}</div> : null}

      <section>
        <h2 className="mb-2 text-lg font-bold">
          {t("waiter.toApprove")} {pending.length ? `(${pending.length})` : ""}
        </h2>
        {pending.length === 0 ? <p className="text-stone-500">{t("waiter.noneToApprove")}</p> : null}
        <div className="space-y-3">
          {pending.map((s) => {
            const orders = live.orders.filter((o) => o.session_id === s.id);
            const people = live.participants.filter((p) => p.session_id === s.id);
            return (
              <div key={s.id} className="card space-y-3 border-amber-300">
                <div className="flex items-baseline justify-between">
                  <div className="text-xl font-bold">{live.tableLabel(s)}</div>
                  <div className="text-sm text-stone-500">
                    {t("waiter.people", { count: people.length })} · {t("waiter.openedAt", { time: formatTime(s.opened_at, lang) })}
                  </div>
                </div>
                <div className="text-sm text-stone-600">{people.map((p) => p.display_name).join(", ")}</div>
                {orders.map((o) => (
                  <div key={o.id} className="rounded-xl bg-stone-50 p-3">
                    <div className="mb-1 text-sm font-semibold">{live.personName(o.participant_id)}</div>
                    <OrderItems order={o} currency={restaurant.currency} />
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    className="btn-ghost"
                    disabled={busy === s.id}
                    onClick={() => run(s.id, "reject_session", { p_session_id: s.id })}
                  >
                    {t("waiter.reject")}
                  </button>
                  <button
                    className="btn col-span-2"
                    disabled={busy === s.id}
                    onClick={() => run(s.id, "approve_session", { p_session_id: s.id })}
                  >
                    {t("waiter.approve")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">
          {t("waiter.ready")} {ready.length ? `(${ready.length})` : ""}
        </h2>
        {ready.length === 0 ? <p className="text-stone-500">{t("waiter.noneReady")}</p> : null}
        <div className="space-y-3">
          {ready.map((o) => (
            <div key={o.id} className="card space-y-3 border-emerald-300">
              <div className="flex items-baseline justify-between">
                <div className="text-xl font-bold">{live.tableLabel(live.sessionOf(o))}</div>
                <div className="text-sm text-stone-600">{live.personName(o.participant_id)}</div>
              </div>
              <OrderItems order={o} />
              <button
                className="btn w-full"
                disabled={busy === o.id}
                onClick={() => run(o.id, "set_order_status", { p_order_id: o.id, p_status: "delivered" })}
              >
                {t("waiter.deliver")}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">{t("waiter.active")}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {confirmed.map((s) => {
            const orders = live.orders.filter((o) => o.session_id === s.id);
            const people = live.participants.filter((p) => p.session_id === s.id);
            const total = orders.reduce((sum, o) => sum + Number(o.total), 0);
            return (
              <div key={s.id} className="card space-y-1">
                <div className="text-lg font-bold">{live.tableLabel(s)}</div>
                <div className="text-sm text-stone-600">{t("waiter.people", { count: people.length })}</div>
                <div className="flex flex-wrap gap-1">
                  {orders.map((o) => (
                    <StatusBadge key={o.id} status={o.status} />
                  ))}
                </div>
                <div className="flex justify-between text-sm">
                  <TimeAgo iso={s.opened_at} />
                  {total ? <span>{formatMoney(total, restaurant.currency, lang)}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
