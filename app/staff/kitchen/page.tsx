"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { errorKey, supabase } from "@/lib/supabase";
import { StaffGate } from "@/lib/useStaff";
import { beep, useLiveRestaurant } from "@/lib/useLiveRestaurant";
import { OrderItems, TimeAgo } from "@/components/ui";
import type { Order, OrderStatus, Restaurant } from "@/lib/types";

export default function KitchenPage() {
  const { t } = useI18n();
  return <StaffGate screen="kitchen" title={t("staff.kitchen")}>{({ restaurant }) => <Kitchen restaurant={restaurant} />}</StaffGate>;
}

function Kitchen({ restaurant }: { restaurant: Restaurant }) {
  const { t } = useI18n();
  const live = useLiveRestaurant(restaurant.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [col, setCol] = useState<OrderStatus>("approved");

  const columns: { status: OrderStatus; title: string; action?: { label: string; next: OrderStatus } }[] = [
    { status: "approved", title: t("kitchen.new"), action: { label: t("kitchen.start"), next: "preparing" } },
    { status: "preparing", title: t("kitchen.preparing"), action: { label: t("kitchen.done"), next: "ready" } },
    { status: "ready", title: t("kitchen.ready") },
  ];

  const newCount = live.orders.filter((o) => o.status === "approved").length;
  const last = useRef(0);
  useEffect(() => {
    if (newCount > last.current) beep();
    last.current = newCount;
  }, [newCount]);

  async function advance(o: Order, next: OrderStatus) {
    setBusy(o.id);
    setError(null);
    const { error } = await supabase().rpc("set_order_status", { p_order_id: o.id, p_status: next });
    setBusy(null);
    if (error) setError(t(`error.${errorKey(error)}` as never));
    void live.reload();
  }

  const renderColumn = (c: (typeof columns)[number]) => {
    const list = live.orders.filter((o) => o.status === c.status);
    return (
      <section key={c.status} className="space-y-3">
        <h2 className="hidden text-lg font-bold md:block">
          {c.title} ({list.length})
        </h2>
        {list.length === 0 ? <p className="text-stone-500">{t("kitchen.empty")}</p> : null}
        {list.map((o) => (
          <div key={o.id} className="card space-y-3">
            <div className="flex items-baseline justify-between">
              <div className="text-xl font-bold">{live.tableLabel(live.sessionOf(o))}</div>
              <TimeAgo iso={o.created_at} />
            </div>
            <OrderItems order={o} large />
            {c.action ? (
              <button className="btn w-full !py-4 text-lg" disabled={busy === o.id} onClick={() => advance(o, c.action!.next)}>
                {c.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </section>
    );
  };

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-xl bg-red-50 px-3 py-2 text-red-800">{error}</div> : null}
      {/* No telemóvel: um separador por coluna; em ecrãs grandes: três colunas */}
      <div className="flex gap-2 md:hidden">
        {columns.map((c) => (
          <button
            key={c.status}
            className={col === c.status ? "btn flex-1 !px-2" : "btn-ghost flex-1 !px-2"}
            onClick={() => setCol(c.status)}
          >
            {c.title} ({live.orders.filter((o) => o.status === c.status).length})
          </button>
        ))}
      </div>
      <div className="md:hidden">{renderColumn(columns.find((c) => c.status === col)!)}</div>
      <div className="hidden gap-4 md:grid md:grid-cols-3">{columns.map(renderColumn)}</div>
    </div>
  );
}
