"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  ChevronRight,
  Clock,
  Flame,
  Minus,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Hourglass,
  Users,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ensureAnonymousSession, errorKey, supabase } from "@/lib/supabase";
import { formatMoney } from "@/lib/format";
import { BrandShell, OrderItems, Spinner, StatusBadge, TimeAgo } from "@/components/ui";
import type {
  CallReason,
  Category,
  Dish,
  Modifier,
  Order,
  Participant,
  Restaurant,
  SessionStatus,
  WaiterCall,
} from "@/lib/types";

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
const CALL_REASONS: CallReason[] = ["assist", "bill", "water", "cutlery"];

const lineUnit = (l: { dish: Dish; modifiers: Modifier[] }) =>
  Number(l.dish.price) + l.modifiers.reduce((s, m) => s + Number(m.extra_price), 0);

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
  const [calls, setCalls] = useState<WaiterCall[]>([]);

  const [tab, setTab] = useState<"menu" | "orders">("menu");
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [openDish, setOpenDish] = useState<Dish | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
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

  // 3. Pedidos, pessoas e chamadas da mesa, em tempo real
  const loadTable = useCallback(async () => {
    if (!joined) return;
    const sb = supabase();
    const [o, p, s, c] = await Promise.all([
      sb
        .from("orders")
        .select("*, order_items(*)")
        .eq("session_id", joined.session_id)
        .order("created_at", { ascending: false }),
      sb.from("session_participants").select("*").eq("session_id", joined.session_id).order("joined_at"),
      sb.from("table_sessions").select("status").eq("id", joined.session_id).single(),
      sb.from("waiter_calls").select("*").eq("session_id", joined.session_id).is("resolved_at", null),
    ]);
    setOrders((o.data ?? []) as Order[]);
    setParticipants((p.data ?? []) as Participant[]);
    setCalls((c.data ?? []) as WaiterCall[]);
    if (s.data) setSessionStatus(s.data.status as SessionStatus);
  }, [joined]);

  useEffect(() => {
    if (!joined) return;
    void loadTable();
    const sb = supabase();
    const sid = joined.session_id;
    const channel = sb
      .channel(`session-${sid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `session_id=eq.${sid}` }, () =>
        loadTable(),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "table_sessions", filter: `id=eq.${sid}` }, () =>
        loadTable(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "waiter_calls", filter: `session_id=eq.${sid}` }, () =>
        loadTable(),
      )
      .subscribe();
    const poll = setInterval(() => void loadTable(), 30000);
    return () => {
      clearInterval(poll);
      void sb.removeChannel(channel);
    };
  }, [joined, loadTable]);

  const cartTotal = useMemo(() => cart.reduce((sum, l) => sum + l.quantity * lineUnit(l), 0), [cart]);
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const tableTotal = orders
    .filter((o) => !["rejected", "cancelled"].includes(o.status))
    .reduce((s, o) => s + Number(o.total), 0);
  const sessionOpen = sessionStatus === "pending" || sessionStatus === "confirmed";
  const specials = dishes.filter((d) => d.is_special);

  const visibleDishes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dishes.filter((d) => {
      if (filter === "specials" && !d.is_special) return false;
      if (filter !== "all" && filter !== "specials" && d.category_id !== filter) return false;
      if (!q) return true;
      const hay = [...Object.values(d.name), ...Object.values(d.description), ...Object.values(d.ingredients)]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [dishes, filter, query]);

  function addLine(line: Omit<CartLine, "key">) {
    setCart((c) => [...c, { ...line, key: crypto.randomUUID() }]);
    setToast(t("menu.added", { name: tx(line.dish.name) }));
  }

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
    void loadTable();
  }

  async function callWaiter(reason: CallReason) {
    if (!joined) return;
    setCallOpen(false);
    const { error } = await supabase().rpc("call_waiter", { p_session_id: joined.session_id, p_reason: reason });
    setToast(error ? t(`error.${errorKey(error)}` as never) : t("table.called"));
    void loadTable();
  }

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  // ---------------------------------------------------------------------------

  if (phase === "loading")
    return (
      <BrandShell restaurant={restaurant}>
        <Spinner />
      </BrandShell>
    );

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
          className="card mx-auto mt-10 max-w-sm space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void join(name.trim());
          }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <Users className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">{t("join.name")}</h1>
          <input
            autoFocus
            className="input"
            maxLength={40}
            placeholder={t("join.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-sm text-slate-500">{t("join.hint")}</p>
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

  const tableChip = (
    <span className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm font-bold text-slate-700 sm:inline-flex">
      <span className={`h-2 w-2 rounded-full ${sessionStatus === "confirmed" ? "bg-emerald-500" : "bg-amber-500"}`} />
      {joined?.table_label}
    </span>
  );

  return (
    <BrandShell restaurant={restaurant} subtitle={joined?.table_label} right={tableChip}>
      {/* Cartão da mesa */}
      <section className="card mb-5 space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-950 px-3 py-1 text-sm font-extrabold uppercase tracking-wide text-white">
            {joined?.table_label}
          </span>
          {sessionStatus === "confirmed" ? (
            <span className="badge border border-emerald-200 bg-emerald-50 py-1 text-emerald-700">
              <ShieldCheck className="h-4 w-4" /> {t("table.confirmed")}
            </span>
          ) : sessionStatus === "pending" ? (
            <span className="badge border border-amber-200 bg-amber-50 py-1 text-amber-800">
              <Hourglass className="h-4 w-4" /> {t("table.pending")}
            </span>
          ) : null}
        </div>

        {!sessionOpen || sessionStatus === "pending" ? (
          <p className="text-sm text-slate-600">{t(`session.${sessionStatus}`)}</p>
        ) : null}

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700">
            <Users className="h-4 w-4 text-slate-400" /> {t("table.atTable", { count: participants.length })}
          </div>
          <div className="flex flex-wrap gap-2">
            {participants.map((p) => (
              <span
                key={p.id}
                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-sm font-semibold ${
                  p.id === joined?.participant_id ? "border-brand/30 bg-brand/5 text-slate-900" : "border-slate-200 bg-white"
                }`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                  {p.display_name.charAt(0).toUpperCase()}
                </span>
                {p.display_name}
              </span>
            ))}
          </div>
        </div>

        {sessionOpen ? (
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-soft !py-3.5" onClick={() => setCallOpen(true)}>
              <BellRing className="h-5 w-5 text-brand" /> {t("table.callWaiter")}
            </button>
            <button className="btn !py-3.5" onClick={() => callWaiter("bill")} disabled={orders.length === 0}>
              <Receipt className="h-5 w-5" /> {t("table.askBill")}
            </button>
          </div>
        ) : null}
        {calls.length ? (
          <p className="text-xs font-semibold text-slate-500">
            {t("table.alreadyCalled", { reasons: calls.map((c) => t(`call.${c.reason}`)).join(", ") })}
          </p>
        ) : null}
      </section>

      {/* Separadores */}
      <div className="sticky top-16 z-10 -mx-4 mb-4 flex gap-2 bg-slate-100 px-4 py-2">
        <button className={tab === "menu" ? "btn-dark flex-1" : "btn-ghost flex-1"} onClick={() => setTab("menu")}>
          <Sparkles className="h-4 w-4" /> {t("menu.tab")}
        </button>
        <button className={tab === "orders" ? "btn-dark flex-1" : "btn-ghost flex-1"} onClick={() => setTab("orders")}>
          <Clock className="h-4 w-4" /> {t("menu.ordersTab")}
          {orders.length ? (
            <span className="ml-1 rounded-full bg-amber-400 px-2 text-xs text-slate-950">{orders.length}</span>
          ) : null}
        </button>
      </div>

      {tab === "menu" ? (
        <div className="space-y-4">
          {specials.length > 0 && filter === "all" && !query ? (
            <section className="overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-lg">
              <span className="badge bg-amber-400 px-3 py-1 uppercase tracking-wide text-slate-950">
                <Flame className="h-4 w-4" /> {t("menu.highlight")}
              </span>
              <h2 className="mt-4 text-2xl font-extrabold leading-tight">
                {tx(restaurant?.tagline) || specials.map((d) => tx(d.name)).join(" · ")}
              </h2>
              {tx(restaurant?.tagline) ? (
                <p className="mt-2 text-slate-300">{specials.map((d) => tx(d.name)).join(" · ")}</p>
              ) : null}
              <button
                className="mt-5 rounded-2xl bg-white px-4 py-2.5 font-bold text-slate-950"
                onClick={() => setFilter("specials")}
              >
                {t("menu.seeSpecials")}
              </button>
            </section>
          ) : null}

          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              className="input !pl-12"
              placeholder={t("menu.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button className={filter === "all" ? "chip-active" : "chip"} onClick={() => setFilter("all")}>
              {t("menu.all")}
            </button>
            {specials.length ? (
              <button className={filter === "specials" ? "chip-active" : "chip"} onClick={() => setFilter("specials")}>
                <Flame className="h-4 w-4" /> {t("menu.specials")}
              </button>
            ) : null}
            {categories
              .filter((c) => dishes.some((d) => d.category_id === c.id))
              .map((c) => (
                <button key={c.id} className={filter === c.id ? "chip-active" : "chip"} onClick={() => setFilter(c.id)}>
                  {tx(c.name)}
                </button>
              ))}
          </div>

          {dishes.length === 0 ? (
            <p className="card text-center">{t("menu.empty")}</p>
          ) : visibleDishes.length === 0 ? (
            <p className="card text-center text-slate-500">{t("menu.noResults")}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {visibleDishes.map((d) => (
                <DishCard
                  key={d.id}
                  dish={d}
                  category={categories.find((c) => c.id === d.category_id)}
                  hasModifiers={modifiers.some((m) => m.dish_id === d.id)}
                  disabled={!sessionOpen}
                  money={money}
                  onOpen={() => setOpenDish(d)}
                  onQuickAdd={() => addLine({ dish: d, quantity: 1, modifiers: [], note: "" })}
                />
              ))}
            </div>
          )}
        </div>
      ) : orders.length === 0 ? (
        <p className="card py-12 text-center text-slate-500">{t("orders.none")}</p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="card space-y-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-slate-900">{t("orders.by", { name: participantName(o.participant_id) })}</div>
                <StatusBadge status={o.status} />
              </div>
              <OrderItems order={o} currency={currency} />
              <div className="flex justify-between border-t border-slate-100 pt-3 text-sm text-slate-600">
                <TimeAgo iso={o.created_at} />
                <span className="font-bold text-slate-900">{money(o.total)}</span>
              </div>
            </div>
          ))}
          <div className="flex justify-between rounded-3xl bg-slate-950 p-5 text-lg font-extrabold text-white">
            <span>{t("orders.total")}</span>
            <span>{money(tableTotal)}</span>
          </div>
        </div>
      )}

      {cartCount > 0 && !cartOpen && !openDish ? (
        <div className="fixed inset-x-0 bottom-0 z-20 p-4">
          <button
            className="mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl border-2 border-amber-400 bg-slate-950 p-3.5 text-white shadow-2xl"
            onClick={() => setCartOpen(true)}
          >
            <span className="flex items-center gap-3">
              <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-brand">
                <ShoppingBag className="h-5 w-5" />
                <span className="absolute -right-1.5 -top-1.5 rounded-full bg-amber-400 px-1.5 text-xs font-bold text-slate-950">
                  {cartCount}
                </span>
              </span>
              <span className="text-left">
                <span className="block text-xs text-slate-300">{t("cart.items", { count: cartCount })}</span>
                <span className="block font-extrabold">{money(cartTotal)}</span>
              </span>
            </span>
            <span className="flex items-center gap-1 font-bold text-amber-300">
              {t("cart.view", { count: cartCount })} <ChevronRight className="h-5 w-5" />
            </span>
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
            addLine(line);
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
          onQty={(key, q) =>
            setCart((c) => (q <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, quantity: q } : l))))
          }
          onClose={() => setCartOpen(false)}
          onSend={sendOrder}
        />
      ) : null}

      {callOpen ? (
        <Sheet onClose={() => setCallOpen(false)}>
          <h2 className="mb-4 text-xl font-extrabold">{t("table.callTitle")}</h2>
          <div className="grid grid-cols-2 gap-2">
            {CALL_REASONS.map((r) => (
              <button
                key={r}
                className="btn-soft !py-5"
                disabled={calls.some((c) => c.reason === r)}
                onClick={() => callWaiter(r)}
              >
                {t(`call.${r}`)}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-40 mx-auto w-fit max-w-[90vw] rounded-2xl bg-slate-900/95 px-4 py-3 text-sm font-semibold text-white shadow-2xl">
          {toast}
        </div>
      ) : null}
    </BrandShell>
  );
}

function DishCard({
  dish,
  category,
  hasModifiers,
  disabled,
  money,
  onOpen,
  onQuickAdd,
}: {
  dish: Dish;
  category?: Category;
  hasModifiers: boolean;
  disabled: boolean;
  money: (v: number) => string;
  onOpen: () => void;
  onQuickAdd: () => void;
}) {
  const { t, tx } = useI18n();
  return (
    <article className="flex flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
      <button className="relative h-40 w-full bg-gradient-to-br from-slate-200 to-slate-300 text-left" onClick={onOpen} disabled={disabled}>
        {dish.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dish.photo_url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-5xl font-extrabold text-white/70">
            {tx(dish.name).charAt(0)}
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent" />
        <span className="absolute left-3 top-3 flex gap-1.5">
          {dish.is_special ? (
            <span className="badge bg-amber-400 text-slate-950">
              <Flame className="h-3.5 w-3.5" /> {t("menu.specialBadge")}
            </span>
          ) : category ? (
            <span className="badge bg-slate-900/70 text-white">{tx(category.name)}</span>
          ) : null}
        </span>
        {dish.prep_minutes ? (
          <span className="absolute bottom-3 left-3 flex items-center gap-1 text-sm font-semibold text-white">
            <Clock className="h-4 w-4 text-amber-300" /> {t("menu.minutes", { n: dish.prep_minutes })}
          </span>
        ) : null}
      </button>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-lg font-extrabold leading-snug text-slate-900">{tx(dish.name)}</h3>
        {tx(dish.description) ? <p className="line-clamp-2 text-sm text-slate-500">{tx(dish.description)}</p> : null}
        {tx(dish.ingredients) ? (
          <p className="line-clamp-1 text-xs text-slate-400">
            <span className="font-bold text-slate-500">{t("menu.ingredients")}: </span>
            {tx(dish.ingredients)}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <span className="text-lg font-extrabold text-slate-900">{money(Number(dish.price))}</span>
          <span className="flex gap-2">
            {hasModifiers ? (
              <button className="btn-soft !px-3 !py-2 text-sm" onClick={onOpen} disabled={disabled}>
                {t("menu.customize")}
              </button>
            ) : null}
            <button className="btn !px-3 !py-2 text-sm" onClick={onQuickAdd} disabled={disabled}>
              <Plus className="h-4 w-4" /> {t("menu.quickAdd")}
            </button>
          </span>
        </div>
      </div>
    </article>
  );
}

function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-slate-950/50" onClick={onClose}>
      <div
        className="relative mx-auto max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute right-4 top-4 z-10 rounded-full bg-white/90 p-2 text-slate-600 shadow"
          onClick={onClose}
          aria-label="X"
        >
          <X className="h-5 w-5" />
        </button>
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
  onAdd: (line: Omit<CartLine, "key">) => void;
}) {
  const { t, tx } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const chosen = modifiers.filter((m) => selected.includes(m.id));
  const unit = lineUnit({ dish, modifiers: chosen });
  const removes = modifiers.filter((m) => m.kind === "remove");
  const adds = modifiers.filter((m) => m.kind === "add");

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const group = (title: string, list: Modifier[]) =>
    list.length ? (
      <div>
        <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-slate-500">{title}</h3>
        <div className="space-y-2">
          {list.map((m) => (
            <label
              key={m.id}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                selected.includes(m.id) ? "border-brand bg-brand/5" : "border-slate-200"
              }`}
            >
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--brand)]"
                checked={selected.includes(m.id)}
                onChange={() => toggle(m.id)}
              />
              <span className="flex-1 font-semibold">{tx(m.name)}</span>
              <span className="text-sm text-slate-500">
                {Number(m.extra_price) > 0 ? `+${money(Number(m.extra_price))}` : t("menu.free")}
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
          <img src={dish.photo_url} alt="" className="-mx-5 -mt-5 h-52 w-[calc(100%+2.5rem)] max-w-none object-cover" />
        ) : null}
        <div className="space-y-2 pr-10">
          <div className="flex flex-wrap gap-2">
            {dish.is_special ? (
              <span className="badge bg-amber-400 text-slate-950">
                <Flame className="h-3.5 w-3.5" /> {t("menu.specialBadge")}
              </span>
            ) : null}
            {dish.prep_minutes ? (
              <span className="badge bg-slate-100 text-slate-700">
                <Clock className="h-3.5 w-3.5" /> {t("menu.minutes", { n: dish.prep_minutes })}
              </span>
            ) : null}
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900">{tx(dish.name)}</h2>
          {tx(dish.description) ? <p className="text-slate-600">{tx(dish.description)}</p> : null}
          {tx(dish.ingredients) ? (
            <p className="text-sm text-slate-600">
              <span className="font-bold">{t("menu.ingredients")}: </span>
              {tx(dish.ingredients)}
            </p>
          ) : null}
          {tx(dish.allergens) ? (
            <p className="rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <span className="font-bold">{t("menu.allergens")}: </span>
              {tx(dish.allergens)}
            </p>
          ) : null}
        </div>
        {group(t("menu.remove"), removes)}
        {group(t("menu.add"), adds)}
        <div>
          <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-slate-500">{t("menu.note")}</h3>
          <input
            className="input"
            maxLength={200}
            placeholder={t("menu.notePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl bg-slate-100 p-1">
            <button className="rounded-xl bg-white p-2.5 shadow-sm" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="-">
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-6 text-center text-lg font-extrabold">{qty}</span>
            <button className="rounded-xl bg-white p-2.5 shadow-sm" onClick={() => setQty((q) => Math.min(50, q + 1))} aria-label="+">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <button
            className="btn flex-1"
            onClick={() => onAdd({ dish, quantity: qty, modifiers: chosen, note: note.trim() })}
          >
            {t("menu.addToCart", { price: money(unit * qty) })}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function CartSheet({
  cart,
  total,
  money,
  sending,
  onQty,
  onClose,
  onSend,
}: {
  cart: CartLine[];
  total: number;
  money: (v: number) => string;
  sending: boolean;
  onQty: (key: string, q: number) => void;
  onClose: () => void;
  onSend: (note: string) => void;
}) {
  const { t, tx } = useI18n();
  const [note, setNote] = useState("");
  return (
    <Sheet onClose={onClose}>
      <div className="space-y-4">
        <h2 className="text-2xl font-extrabold">{t("cart.title")}</h2>
        {cart.length === 0 ? <p>{t("cart.empty")}</p> : null}
        <ul className="space-y-3">
          {cart.map((l) => (
            <li key={l.key} className="flex items-start gap-3 rounded-2xl border border-slate-200 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-bold">{tx(l.dish.name)}</div>
                {l.modifiers.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {l.modifiers.map((m) => (
                      <span
                        key={m.id}
                        className={`badge ${m.kind === "remove" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}
                      >
                        {m.kind === "remove" ? "−" : "+"} {tx(m.name)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {l.note ? <div className="mt-1 text-sm italic text-slate-500">“{l.note}”</div> : null}
                <div className="mt-1 text-sm font-bold text-slate-900">{money(l.quantity * lineUnit(l))}</div>
              </div>
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                <button className="rounded-lg bg-white p-1.5" onClick={() => onQty(l.key, l.quantity - 1)} aria-label={t("cart.remove")}>
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-5 text-center font-bold">{l.quantity}</span>
                <button className="rounded-lg bg-white p-1.5" onClick={() => onQty(l.key, Math.min(50, l.quantity + 1))} aria-label="+">
                  <Plus className="h-4 w-4" />
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
        <button className="btn w-full !py-4 text-lg" disabled={sending || cart.length === 0} onClick={() => onSend(note)}>
          {t("cart.send", { total: money(total) })}
        </button>
      </div>
    </Sheet>
  );
}
