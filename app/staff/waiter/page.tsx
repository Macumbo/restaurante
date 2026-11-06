"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, CheckCircle2, ChefHat, ShieldCheck, Users, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { errorKey, supabase } from "@/lib/supabase";
import { StaffGate } from "@/lib/useStaff";
import { beep, useLiveRestaurant } from "@/lib/useLiveRestaurant";
import { formatMoney, formatTime } from "@/lib/format";
import { OrderItems, StatusBadge, TimeAgo } from "@/components/ui";
import type { Restaurant } from "@/lib/types";

export default function WaiterPage() {
  const { t } = useI18n();
  return (
    <StaffGate screen="waiter" title={t("staff.waiter")}>
      {({ restaurant, user }) => <Waiter restaurant={restaurant} userId={user.id} />}
    </StaffGate>
  );
}

function Waiter({ restaurant, userId }: { restaurant: Restaurant; userId: string }) {
  const { t, lang } = useI18n();
  const live = useLiveRestaurant(restaurant.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"mine" | "all">("mine");

  const pending = live.sessions.filter((s) => s.status === "pending");
  const confirmed = live.sessions.filter((s) => s.status === "confirmed");
  const mine = confirmed.filter((s) => s.confirmed_by === userId);
  const shown = scope === "mine" ? mine : confirmed;
  const shownIds = new Set(shown.map((s) => s.id));
  const ready = live.orders.filter((o) => o.status === "ready" && (scope === "all" || shownIds.has(o.session_id)));
  const calls = live.calls.filter((c) => {
    const s = live.sessions.find((x) => x.id === c.session_id);
    return scope === "all" || !s || s.status === "pending" || s.confirmed_by === userId;
  });
  const inKitchen = live.orders.filter((o) => ["approved", "preparing"].includes(o.status)).length;

  // Aviso sonoro quando aparece uma mesa nova, uma chamada ou um pedido pronto
  const lastCount = useRef(0);
  useEffect(() => {
    const n = pending.length + ready.length + calls.length;
    if (n > lastCount.current) beep();
    lastCount.current = n;
  }, [pending.length, ready.length, calls.length]);

  async function run(id: string, fn: string, args: Record<string, string>) {
    setBusy(id);
    setError(null);
    const { error } = await supabase().rpc(fn, args);
    setBusy(null);
    if (error) setError(t(`error.${errorKey(error)}` as never));
    void live.reload();
  }

  const stat = (label: string, value: string | number, color: string) => (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-red-800">{error}</div> : null}

      <section className="rounded-3xl bg-slate-950 p-5 text-white shadow-lg">
        <div className="grid grid-cols-3 gap-2">
          {stat(t("waiter.mine"), mine.length, "text-amber-400")}
          {stat(t("waiter.statPending"), pending.length, "text-emerald-400")}
          {stat(t("staff.kitchen"), inKitchen, "text-sky-400")}
        </div>
      </section>

      <div className="flex gap-2">
        <button className={scope === "mine" ? "chip-active" : "chip"} onClick={() => setScope("mine")}>
          {t("waiter.mine")} ({mine.length})
        </button>
        <button className={scope === "all" ? "chip-active" : "chip"} onClick={() => setScope("all")}>
          {t("waiter.all")} ({confirmed.length})
        </button>
      </div>

      {calls.length ? (
        <section className="space-y-2">
          <h2 className="section-title flex items-center gap-2">
            <BellRing className="h-5 w-5 text-brand" /> {t("waiter.calls")} ({calls.length})
          </h2>
          {calls.map((c) => {
            const s = live.sessions.find((x) => x.id === c.session_id);
            return (
              <div key={c.id} className="card flex items-center gap-3 border-2 border-brand/40">
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-extrabold">{live.tableLabel(s)}</div>
                  <div className="text-sm text-slate-600">
                    <span className="font-bold text-brand">{t(`call.${c.reason}`)}</span> · {live.personName(c.participant_id)} ·{" "}
                    {formatTime(c.created_at, lang)}
                  </div>
                </div>
                <button className="btn-dark !py-2.5" disabled={busy === c.id} onClick={() => run(c.id, "resolve_waiter_call", { p_call_id: c.id })}>
                  <CheckCircle2 className="h-4 w-4" /> {t("waiter.resolve")}
                </button>
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="section-title flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-amber-500" /> {t("waiter.toApprove")} ({pending.length})
        </h2>
        <p className="text-sm text-slate-500">{t("waiter.assignHint")}</p>
        {pending.length === 0 ? <p className="text-slate-400">{t("waiter.noneToApprove")}</p> : null}
        {pending.map((s) => {
          const orders = live.orders.filter((o) => o.session_id === s.id);
          const people = live.participants.filter((p) => p.session_id === s.id);
          const total = orders.reduce((sum, o) => sum + Number(o.total), 0);
          return (
            <div key={s.id} className="space-y-4 rounded-3xl border-2 border-amber-300 bg-amber-50/60 p-5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="rounded-xl bg-amber-200 px-3 py-1 text-lg font-extrabold text-amber-950">{live.tableLabel(s)}</span>
                  <div className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
                    <Users className="h-4 w-4" /> {people.map((p) => p.display_name).join(", ")} ·{" "}
                    {t("waiter.openedAt", { time: formatTime(s.opened_at, lang) })}
                  </div>
                </div>
                {total ? <div className="text-xl font-extrabold text-amber-900">{formatMoney(total, restaurant.currency, lang)}</div> : null}
              </div>
              {orders.map((o) => (
                <div key={o.id} className="rounded-2xl border border-amber-200 bg-white p-4">
                  <div className="mb-2 text-sm font-bold text-slate-500">{live.personName(o.participant_id)}</div>
                  <OrderItems order={o} currency={restaurant.currency} />
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  className="btn-success flex-1 !py-4"
                  disabled={busy === s.id}
                  onClick={() => run(s.id, "approve_session", { p_session_id: s.id })}
                >
                  <ShieldCheck className="h-5 w-5" /> {t("waiter.approve")}
                </button>
                <button
                  className="btn-ghost !px-4 text-red-600"
                  aria-label={t("waiter.reject")}
                  disabled={busy === s.id}
                  onClick={() => run(s.id, "reject_session", { p_session_id: s.id })}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="section-title flex items-center gap-2">
          <ChefHat className="h-5 w-5 text-emerald-600" /> {t("waiter.ready")} ({ready.length})
        </h2>
        {ready.length === 0 ? <p className="text-slate-400">{t("waiter.noneReady")}</p> : null}
        {ready.map((o) => (
          <div key={o.id} className="space-y-3 rounded-3xl border-2 border-emerald-300 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="rounded-xl bg-slate-100 px-3 py-1 text-lg font-extrabold">{live.tableLabel(live.sessionOf(o))}</span>
              <span className="text-sm text-slate-500">{live.personName(o.participant_id)}</span>
            </div>
            <OrderItems order={o} />
            <button
              className="btn-success w-full !py-4"
              disabled={busy === o.id}
              onClick={() => run(o.id, "set_order_status", { p_order_id: o.id, p_status: "delivered" })}
            >
              <CheckCircle2 className="h-5 w-5" /> {t("waiter.deliver")}
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="section-title">{t("waiter.active")}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shown.map((s) => {
            const orders = live.orders.filter((o) => o.session_id === s.id);
            const people = live.participants.filter((p) => p.session_id === s.id);
            const total = orders.reduce((sum, o) => sum + Number(o.total), 0);
            return (
              <div key={s.id} className={`card space-y-2 ${s.confirmed_by === userId ? "border-amber-300" : ""}`}>
                <div className="flex items-center justify-between gap-1">
                  <div className="text-lg font-extrabold">{live.tableLabel(s)}</div>
                  {s.confirmed_by === userId ? <span className="badge bg-amber-100 text-amber-800">{t("waiter.yours")}</span> : null}
                </div>
                <div className="text-sm text-slate-500">{t("waiter.people", { count: people.length })}</div>
                <div className="flex flex-wrap gap-1">
                  {orders.map((o) => (
                    <StatusBadge key={o.id} status={o.status} />
                  ))}
                </div>
                <div className="flex justify-between text-sm">
                  <TimeAgo iso={s.opened_at} />
                  {total ? <span className="font-bold">{formatMoney(total, restaurant.currency, lang)}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
