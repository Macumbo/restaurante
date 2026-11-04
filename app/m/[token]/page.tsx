"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ensureAnonymousSession, errorKey, supabase } from "@/lib/supabase";
import { formatMoney } from "@/lib/format";
import { BrandShell, OrderItems, Spinner, StatusBadge, TimeAgo } from "@/components/ui";
import type { Category, Dish, Modifier, Order, Participant, Restaurant, SessionStatus } from "@/lib/types";

type Joined = {
  session_id: string;
  session_status: SessionStatus;
  participant_id: string;
  restaurant_id: string;
  table_label: string;
};

type CartLine = {
  key: string;
  dish: Dish;
  quantity: number;
  modifiers: Modifier[];
  note: string;
};

const NAME_KEY = "guest_name";

export default function TablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { t, tx, lang } = useI18n();

  const [phase, setPhase] = useState<"loading" | "name" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState<Joined | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("pending");

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);

  const [tab, setTab] = useState<"menu" | "orders">("menu");
  const [openDish, setOpenDish] = useState<Dish | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const currency = restaurant?.currency ?? "AOA";
  const money = useCallback((v: number) => formatMoney(v, currency, lang), [currency, lang]);

  // 1. Sessão anónima + nome guardado
  useEffect(() => {
    (async () => {
      try {
        await ensureAnonymousSession();
      } catch (e) {
        setError((e as Error).message.includes("NEXT_PUBLIC") ? "config" : errorKey(e));
        setPhase("error");
        return;
      }
      let saved = "";
      try {
        saved = localStorage.getItem(NAME_KEY) ?? "";
      } catch {}
      if (saved) {
        setName(saved);
        void join(saved);
      } else {
        setPhase("name");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const join = useCallback(
    async (displayName: string) => {
      setPhase("loading");
      const { data, error } = await supabase().rpc("join_table", { p_token: token, p_display_name: displayName });
      if (error) {
        setError(errorKey(error));
        setPhase(errorKey(error) === "invalid_name" ? "name" : "error");
        return;
      }
      try {
        localStorage.setItem(NAME_KEY, displayName);
      } catch {}
      setJoined(data as Joined);
      setSessionStatus((data as Joined).session_status);
      setPhase("ready");
    },
    [token],
  );

  // 2. Menu do restaurante
  useEffect(() => {
    if (!joined) return;
    const sb = supabase();
    const rid = joined.restaurant_id;
    (async () => {
      const [r, c, d, m] = await Promise.all([
        sb.from("restaurants").select("*").eq("id", rid).single(),
        sb.from("categories").select("*").eq("restaurant_id", rid).eq("active", true).order("position"),
        sb
          .from("dishes")
          .select("*")
          .eq("restaurant_id", rid)
          .eq("active", true)
          .eq("available_today", true)
          .order("position"),
        sb.from("dish_modifiers").select("*").eq("restaurant_id", rid).eq("active", true).order("position"),
      ]);
      setRestaurant(r.data as Restaurant);
      setCategories((c.data ?? []) as Category[]);
      setDishes((d.data ?? []) as Dish[]);
      setModifiers((m.data ?? []) as Modifier[]);
    })();
  }, [joined]);

  // 3. Pedidos da mesa, em tempo real
  const loadOrders = useCallback(async () => {
    if (!joined) return;
    const sb = supabase();
    const [o, p, s] = await Promise.all([
      sb
        .from("orders")
        .select("*, order_items(*)")
        .eq("session_id", joined.session_id)
        .order("created_at", { ascending: false }),
      sb.from("session_participants").select("*").eq("session_id", joined.session_id),
      sb.from("table_sessions").select("status").eq("id", joined.session_id).single(),
    ]);
    setOrders((o.data ?? []) as Order[]);
    setParticipants((p.data ?? []) as Participant[]);
    if (s.data) setSessionStatus(s.data.status as SessionStatus);
  }, [joined]);

  useEffect(() => {
    if (!joined) return;
    void loadOrders();
    const sb = supabase();
    const channel = sb
      .channel(`session-${joined.session_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `session_id=eq.${joined.session_id}` },
        () => void loadOrders(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "table_sessions", filter: `id=eq.${joined.session_id}` },
        () => void loadOrders(),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [joined, loadOrders]);

  const cartTotal = useMemo(
    () =>
      cart.reduce(
        (sum, l) => sum + l.quantity * (l.dish.price + l.modifiers.reduce((s, m) => s + Number(m.extra_price), 0)),
        0,
      ),
    [cart],
  );
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const tableTotal = orders
    .filter((o) => !["rejected", "cancelled"].includes(o.status))
    .reduce((s, o) => s + Number(o.total), 0);
  const sessionOpen = sessionStatus === "pending" || sessionStatus === "confirmed";

  async function sendOrder(orderNote: string) {
    if (!joined || cart.length === 0) return;
    setSending(true);
    const items = cart.map((l) => ({
      dish_id: l.dish.id,
      quantity: l.quantity,
      modifier_ids: l.modifiers.map((m) => m.id),
      note: l.note,
    }));
    const { error } = await supabase().rpc("place_order", {
      p_session_id: joined.session_id,
      p_items: items,
      p_note: orderNote,
    });
    setSending(false);
    if (error) {
      setToast(t(`error.${errorKey(error)}` as never));
      return;
    }
    setCart([]);
    setCartOpen(false);
    setTab("orders");
    setToast(t("cart.sent"));
    void loadOrders();
  }

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  // ---------------------------------------------------------------------------

  if (phase === "loading") return <BrandShell restaurant={restaurant}><Spinner /></BrandShell>;

  if (phase === "error")
    return (
      <BrandShell restaurant={restaurant}>
        <div className="card mt-10 text-center text-lg">{t(`error.${error ?? "generic"}` as never)}</div>
      </BrandShell>
    );

  if (phase === "name")
    return (
      <BrandShell restaurant={null}>
        <form
          className="card mx-auto mt-10 max-w-sm space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void join(name.trim());
          }}
        >
          <h1 className="text-xl font-bold">{t("join.name")}</h1>
          <input
            autoFocus
            className="input"
            maxLength={40}
            placeholder={t("join.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-sm text-stone-600">{t("join.hint")}</p>
          {error === "invalid_name" ? <p className="text-sm text-red-700">{t("error.invalid_name")}</p> : null}
          <button className="btn w-full" disabled={!name.trim()}>
            {t("join.submit")}
          </button>
        </form>
      </BrandShell>
    );

  const participantName = (id: string) => {
    if (id === joined?.participant_id) return t("orders.you");
    return participants.find((p) => p.id === id)?.display_name ?? "?";
  };

  return (
    <BrandShell restaurant={restaurant} subtitle={joined?.table_label}>
      <SessionBanner status={sessionStatus} />

      <div className="sticky top-[60px] z-10 -mx-4 mb-4 flex gap-2 bg-[#faf8f5] px-4 py-2">
        <button className={tab === "menu" ? "btn flex-1" : "btn-ghost flex-1"} onClick={() => setTab("menu")}>
          {t("menu.tab")}
        </button>
        <button className={tab === "orders" ? "btn flex-1" : "btn-ghost flex-1"} onClick={() => setTab("orders")}>
          {t("menu.ordersTab")} {orders.length ? `(${orders.length})` : ""}
        </button>
      </div>

      {tab === "menu" ? (
        dishes.length === 0 ? (
          <p className="card text-center">{t("menu.empty")}</p>
        ) : (
          <div className="space-y-6">
            {[...categories, null].map((cat) => {
              const list = dishes.filter((d) => (cat ? d.category_id === cat.id : !d.category_id));
              if (list.length === 0) return null;
              return (
                <section key={cat?.id ?? "other"}>
                  {cat ? <h2 className="mb-2 text-lg font-bold">{tx(cat.name)}</h2> : null}
                  <div className="space-y-2">
                    {list.map((d) => (
                      <button
                        key={d.id}
                        disabled={!sessionOpen}
                        onClick={() => setOpenDish(d)}
                        className="card flex w-full items-center gap-3 text-left active:bg-stone-50 disabled:opacity-50"
                      >
                        {d.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={d.photo_url} alt="" className="h-16 w-16 rounded-xl object-cover" />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{tx(d.name)}</div>
                          {tx(d.description) ? (
                            <div className="line-clamp-2 text-sm text-stone-600">{tx(d.description)}</div>
                          ) : null}
                        </div>
                        <div className="font-semibold text-brand">{money(d.price)}</div>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )
      ) : orders.length === 0 ? (
        <p className="card text-center">{t("orders.none")}</p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="card space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">{t("orders.by", { name: participantName(o.participant_id) })}</div>
                <StatusBadge status={o.status} />
              </div>
              <OrderItems order={o} currency={currency} />
              <div className="flex justify-between text-sm text-stone-600">
                <TimeAgo iso={o.created_at} />
                <span className="font-semibold">{money(o.total)}</span>
              </div>
            </div>
          ))}
          <div className="card flex justify-between text-lg font-bold">
            <span>{t("orders.total")}</span>
            <span>{money(tableTotal)}</span>
          </div>
        </div>
      )}

      {cartCount > 0 && !cartOpen && !openDish ? (
        <div className="fixed inset-x-0 bottom-0 z-20 p-4">
          <button className="btn mx-auto flex w-full max-w-3xl shadow-lg" onClick={() => setCartOpen(true)}>
            {t("cart.view", { count: cartCount })} · {money(cartTotal)}
          </button>
        </div>
      ) : null}

      {openDish ? (
        <DishSheet
          dish={openDish}
          modifiers={modifiers.filter((m) => m.dish_id === openDish.id)}
          money={money}
          onClose={() => setOpenDish(null)}
          onAdd={(line) => {
            setCart((c) => [...c, line]);
            setOpenDish(null);
          }}
        />
      ) : null}

      {cartOpen ? (
        <CartSheet
          cart={cart}
          total={cartTotal}
          money={money}
          sending={sending}
          onRemove={(key) => setCart((c) => c.filter((l) => l.key !== key))}
          onClose={() => setCartOpen(false)}
          onSend={sendOrder}
        />
      ) : null}

      {toast ? (
        <div className="fixed inset-x-0 top-20 z-40 mx-auto w-fit rounded-xl bg-stone-900 px-4 py-2 text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </BrandShell>
  );
}

function SessionBanner({ status }: { status: SessionStatus }) {
  const { t } = useI18n();
  const style =
    status === "pending"
      ? "bg-amber-50 border-amber-300 text-amber-900"
      : status === "confirmed"
        ? "bg-emerald-50 border-emerald-300 text-emerald-900"
        : "bg-stone-100 border-stone-300 text-stone-700";
  return <div className={`mb-3 rounded-xl border px-3 py-2 text-sm ${style}`}>{t(`session.${status}`)}</div>;
}

function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="mx-auto max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function DishSheet({
  dish,
  modifiers,
  money,
  onClose,
  onAdd,
}: {
  dish: Dish;
  modifiers: Modifier[];
  money: (v: number) => string;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const { t, tx } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const chosen = modifiers.filter((m) => selected.includes(m.id));
  const unit = dish.price + chosen.reduce((s, m) => s + Number(m.extra_price), 0);
  const removes = modifiers.filter((m) => m.kind === "remove");
  const adds = modifiers.filter((m) => m.kind === "add");

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const group = (title: string, list: Modifier[]) =>
    list.length ? (
      <div>
        <h3 className="mb-2 font-semibold">{title}</h3>
        <div className="space-y-2">
          {list.map((m) => (
            <label key={m.id} className="flex items-center gap-3 rounded-xl border border-stone-200 px-3 py-3">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--brand)]"
                checked={selected.includes(m.id)}
                onChange={() => toggle(m.id)}
              />
              <span className="flex-1">{tx(m.name)}</span>
              <span className="text-sm text-stone-600">
                {Number(m.extra_price) > 0 ? `+${money(m.extra_price)}` : t("menu.free")}
              </span>
            </label>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <Sheet onClose={onClose}>
      <div className="space-y-5">
        {dish.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dish.photo_url} alt="" className="h-48 w-full rounded-2xl object-cover" />
        ) : null}
        <div>
          <h2 className="text-2xl font-bold">{tx(dish.name)}</h2>
          {tx(dish.description) ? <p className="mt-1 text-stone-700">{tx(dish.description)}</p> : null}
          {tx(dish.ingredients) ? (
            <p className="mt-2 text-sm text-stone-600">
              <span className="font-semibold">{t("menu.ingredients")}: </span>
              {tx(dish.ingredients)}
            </p>
          ) : null}
        </div>
        {group(t("menu.remove"), removes)}
        {group(t("menu.add"), adds)}
        <div>
          <h3 className="mb-2 font-semibold">{t("menu.note")}</h3>
          <input
            className="input"
            maxLength={200}
            placeholder={t("menu.notePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t("menu.quantity")}</span>
          <div className="flex items-center gap-3">
            <button className="btn-ghost h-11 w-11 !p-0" onClick={() => setQty((q) => Math.max(1, q - 1))}>
              −
            </button>
            <span className="w-6 text-center text-lg font-bold">{qty}</span>
            <button className="btn-ghost h-11 w-11 !p-0" onClick={() => setQty((q) => Math.min(50, q + 1))}>
              +
            </button>
          </div>
        </div>
        <button
          className="btn w-full"
          onClick={() =>
            onAdd({ key: crypto.randomUUID(), dish, quantity: qty, modifiers: chosen, note: note.trim() })
          }
        >
          {t("menu.addToCart", { price: money(unit * qty) })}
        </button>
      </div>
    </Sheet>
  );
}

function CartSheet({
  cart,
  total,
  money,
  sending,
  onRemove,
  onClose,
  onSend,
}: {
  cart: CartLine[];
  total: number;
  money: (v: number) => string;
  sending: boolean;
  onRemove: (key: string) => void;
  onClose: () => void;
  onSend: (note: string) => void;
}) {
  const { t, tx } = useI18n();
  const [note, setNote] = useState("");
  return (
    <Sheet onClose={onClose}>
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">{t("cart.title")}</h2>
        {cart.length === 0 ? <p>{t("cart.empty")}</p> : null}
        <ul className="space-y-3">
          {cart.map((l) => (
            <li key={l.key} className="flex items-start gap-3 border-b border-stone-100 pb-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {l.quantity}× {tx(l.dish.name)}
                </div>
                {l.modifiers.length ? (
                  <div className="text-sm text-stone-600">
                    {l.modifiers.map((m) => `${m.kind === "remove" ? "−" : "+"} ${tx(m.name)}`).join(", ")}
                  </div>
                ) : null}
                {l.note ? <div className="text-sm italic text-stone-600">“{l.note}”</div> : null}
              </div>
              <div className="text-right">
                <div className="font-semibold">
                  {money(l.quantity * (l.dish.price + l.modifiers.reduce((s, m) => s + Number(m.extra_price), 0)))}
                </div>
                <button className="text-sm text-red-700" onClick={() => onRemove(l.key)}>
                  {t("cart.remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <input
          className="input"
          maxLength={200}
          placeholder={t("cart.orderNote")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="btn w-full" disabled={sending || cart.length === 0} onClick={() => onSend(note)}>
          {t("cart.send", { total: money(total) })}
        </button>
      </div>
    </Sheet>
  );
}
