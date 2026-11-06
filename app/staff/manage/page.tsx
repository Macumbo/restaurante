"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { useI18n } from "@/lib/i18n";
import { errorKey, supabase } from "@/lib/supabase";
import { StaffGate } from "@/lib/useStaff";
import { formatMoney } from "@/lib/format";
import type { Category, DiningTable, Dish, Modifier, Restaurant } from "@/lib/types";

export default function ManagePage() {
  const { t } = useI18n();
  return (
    <StaffGate screen="manage" title={t("staff.manage")}>
      {({ restaurant }) => <Manage restaurant={restaurant} />}
    </StaffGate>
  );
}

function Manage({ restaurant }: { restaurant: Restaurant }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"dishes" | "tables" | "brand">("dishes");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["dishes", "tables", "brand"] as const).map((k) => (
          <button key={k} className={tab === k ? "btn flex-1 !px-2" : "btn-ghost flex-1 !px-2"} onClick={() => setTab(k)}>
            {t(`manage.${k}`)}
          </button>
        ))}
      </div>
      {tab === "dishes" ? <Dishes restaurant={restaurant} /> : null}
      {tab === "tables" ? <Tables restaurant={restaurant} /> : null}
      {tab === "brand" ? <Brand restaurant={restaurant} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pratos e ajustes
// ---------------------------------------------------------------------------

type DraftModifier = { id?: string; kind: "remove" | "add"; pt: string; en: string; extra_price: number };
type DraftDish = {
  id?: string;
  category_id: string | null;
  pt: string;
  en: string;
  descPt: string;
  descEn: string;
  ingPt: string;
  ingEn: string;
  allPt: string;
  allEn: string;
  photo: string;
  prep: number | "";
  special: boolean;
  price: number;
  available_today: boolean;
  modifiers: DraftModifier[];
};

const emptyDish = (categoryId: string | null): DraftDish => ({
  category_id: categoryId,
  pt: "",
  en: "",
  descPt: "",
  descEn: "",
  ingPt: "",
  ingEn: "",
  allPt: "",
  allEn: "",
  photo: "",
  prep: "",
  special: false,
  price: 0,
  available_today: true,
  modifiers: [],
});

const i18n = (pt: string, en: string) => {
  const v: Record<string, string> = {};
  if (pt.trim()) v.pt = pt.trim();
  if (en.trim()) v.en = en.trim();
  return v;
};

function Dishes({ restaurant }: { restaurant: Restaurant }) {
  const { t, tx, lang } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [draft, setDraft] = useState<DraftDish | null>(null);
  const [newCat, setNewCat] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const [c, d, m] = await Promise.all([
      sb.from("categories").select("*").eq("restaurant_id", restaurant.id).eq("active", true).order("position"),
      sb.from("dishes").select("*").eq("restaurant_id", restaurant.id).eq("active", true).order("position"),
      sb.from("dish_modifiers").select("*").eq("restaurant_id", restaurant.id).eq("active", true).order("position"),
    ]);
    setCategories((c.data ?? []) as Category[]);
    setDishes((d.data ?? []) as Dish[]);
    setModifiers((m.data ?? []) as Modifier[]);
  }, [restaurant.id]);

  useEffect(() => void load(), [load]);

  const edit = (d: Dish) =>
    setDraft({
      id: d.id,
      category_id: d.category_id,
      pt: d.name.pt ?? "",
      en: d.name.en ?? "",
      descPt: d.description.pt ?? "",
      descEn: d.description.en ?? "",
      ingPt: d.ingredients.pt ?? "",
      ingEn: d.ingredients.en ?? "",
      allPt: d.allergens?.pt ?? "",
      allEn: d.allergens?.en ?? "",
      photo: d.photo_url ?? "",
      prep: d.prep_minutes ?? "",
      special: d.is_special,
      price: Number(d.price),
      available_today: d.available_today,
      modifiers: modifiers
        .filter((m) => m.dish_id === d.id)
        .map((m) => ({ id: m.id, kind: m.kind, pt: m.name.pt ?? "", en: m.name.en ?? "", extra_price: Number(m.extra_price) })),
    });

  async function toggleToday(d: Dish) {
    await supabase().from("dishes").update({ available_today: !d.available_today }).eq("id", d.id);
    void load();
  }

  async function addCategory() {
    if (!newCat.trim()) return;
    await supabase()
      .from("categories")
      .insert({ restaurant_id: restaurant.id, name: { [lang]: newCat.trim() }, position: categories.length + 1 });
    setNewCat("");
    void load();
  }

  async function save(d: DraftDish) {
    setError(null);
    const sb = supabase();
    const row = {
      restaurant_id: restaurant.id,
      category_id: d.category_id,
      name: i18n(d.pt, d.en),
      description: i18n(d.descPt, d.descEn),
      ingredients: i18n(d.ingPt, d.ingEn),
      allergens: i18n(d.allPt, d.allEn),
      photo_url: d.photo.trim() || null,
      prep_minutes: d.prep === "" ? null : d.prep,
      is_special: d.special,
      price: d.price,
      available_today: d.available_today,
    };
    let dishId = d.id;
    if (dishId) {
      const { error } = await sb.from("dishes").update(row).eq("id", dishId);
      if (error) return setError(t(`error.${errorKey(error)}` as never));
    } else {
      const { data, error } = await sb
        .from("dishes")
        .insert({ ...row, position: dishes.length + 1 })
        .select("id")
        .single();
      if (error) return setError(t(`error.${errorKey(error)}` as never));
      dishId = data.id as string;
    }

    // Ajustes: apaga os removidos, atualiza os existentes, insere os novos.
    // (Os pedidos guardam uma cópia dos ajustes, por isso apagar não altera o histórico.)
    const keep = d.modifiers.filter((m) => m.id).map((m) => m.id!);
    const existing = modifiers.filter((m) => m.dish_id === dishId).map((m) => m.id);
    const removed = existing.filter((id) => !keep.includes(id));
    if (removed.length) await sb.from("dish_modifiers").delete().in("id", removed);
    for (const [i, m] of d.modifiers.entries()) {
      if (!m.pt.trim() && !m.en.trim()) continue;
      const mrow = {
        restaurant_id: restaurant.id,
        dish_id: dishId,
        kind: m.kind,
        name: i18n(m.pt, m.en),
        extra_price: m.extra_price || 0,
        position: i + 1,
      };
      if (m.id) await sb.from("dish_modifiers").update(mrow).eq("id", m.id);
      else await sb.from("dish_modifiers").insert(mrow);
    }
    setDraft(null);
    void load();
  }

  async function remove(id: string) {
    await supabase().from("dishes").update({ active: false }).eq("id", id);
    setDraft(null);
    void load();
  }

  if (draft)
    return (
      <DishForm
        draft={draft}
        categories={categories}
        error={error}
        onChange={setDraft}
        onCancel={() => setDraft(null)}
        onSave={() => save(draft)}
        onDelete={draft.id ? () => remove(draft.id!) : undefined}
      />
    );

  return (
    <div className="space-y-5">
      <button className="btn w-full" onClick={() => setDraft(emptyDish(categories[0]?.id ?? null))}>
        + {t("manage.newDish")}
      </button>
      {[...categories, null].map((cat) => {
        const list = dishes.filter((d) => (cat ? d.category_id === cat.id : !d.category_id));
        if (!cat && list.length === 0) return null;
        return (
          <section key={cat?.id ?? "none"} className="space-y-2">
            <h2 className="text-lg font-bold">{cat ? tx(cat.name) : "—"}</h2>
            {list.map((d) => {
              const mods = modifiers.filter((m) => m.dish_id === d.id);
              return (
                <div key={d.id} className="card flex items-center gap-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => edit(d)}>
                    <div className="font-semibold">
                      {d.is_special ? "🔥 " : ""}
                      {tx(d.name)}
                    </div>
                    <div className="text-sm text-slate-600">
                      {formatMoney(d.price, restaurant.currency, lang)}
                      {mods.length ? ` · ${mods.length} ${t("manage.modifiers").toLowerCase()}` : ""}
                    </div>
                  </button>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[var(--brand)]"
                      checked={d.available_today}
                      onChange={() => toggleToday(d)}
                    />
                    {t("manage.availableToday")}
                  </label>
                </div>
              );
            })}
          </section>
        );
      })}
      <div className="flex gap-2">
        <input
          className="input"
          placeholder={t("manage.newCategory")}
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
        />
        <button className="btn-ghost" onClick={addCategory} disabled={!newCat.trim()}>
          +
        </button>
      </div>
    </div>
  );
}

function DishForm({
  draft,
  categories,
  error,
  onChange,
  onCancel,
  onSave,
  onDelete,
}: {
  draft: DraftDish;
  categories: Category[];
  error: string | null;
  onChange: (d: DraftDish) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const { t, tx } = useI18n();
  const set = <K extends keyof DraftDish>(k: K, v: DraftDish[K]) => onChange({ ...draft, [k]: v });
  const setMod = (i: number, patch: Partial<DraftModifier>) =>
    set(
      "modifiers",
      draft.modifiers.map((m, j) => (j === i ? { ...m, ...patch } : m)),
    );

  const field = (
    label: string,
    key: "pt" | "en" | "descPt" | "descEn" | "ingPt" | "ingEn" | "allPt" | "allEn" | "photo",
    multiline = false,
  ) => (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">{label}</span>
      {multiline ? (
        <textarea className="input" rows={2} value={draft[key]} onChange={(e) => set(key, e.target.value)} />
      ) : (
        <input className="input" value={draft[key]} onChange={(e) => set(key, e.target.value)} />
      )}
    </label>
  );

  return (
    <div className="card space-y-4">
      <h2 className="text-xl font-bold">{draft.id ? t("manage.editDish") : t("manage.newDish")}</h2>
      {field(t("manage.namePt"), "pt")}
      {field(t("manage.nameEn"), "en")}
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-semibold">{t("manage.price")}</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.price}
            onChange={(e) => set("price", Number(e.target.value))}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">{t("manage.category")}</span>
          <select
            className="input"
            value={draft.category_id ?? ""}
            onChange={(e) => set("category_id", e.target.value || null)}
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {tx(c.name)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {field(t("manage.descPt"), "descPt", true)}
      {field(t("manage.descEn"), "descEn", true)}
      {field(t("manage.ingPt"), "ingPt", true)}
      {field(t("manage.ingEn"), "ingEn", true)}
      {field(t("manage.allergensPt"), "allPt")}
      {field(t("manage.allergensEn"), "allEn")}
      {field(t("manage.photoUrl"), "photo")}
      <label className="block space-y-1">
        <span className="text-sm font-semibold">{t("manage.prepMinutes")}</span>
        <input
          className="input"
          type="number"
          inputMode="numeric"
          min={0}
          max={240}
          value={draft.prep}
          onChange={(e) => set("prep", e.target.value === "" ? "" : Number(e.target.value))}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--brand)]"
          checked={draft.special}
          onChange={(e) => set("special", e.target.checked)}
        />
        {t("manage.special")}
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--brand)]"
          checked={draft.available_today}
          onChange={(e) => set("available_today", e.target.checked)}
        />
        {t("manage.availableToday")}
      </label>

      <div className="space-y-2">
        <h3 className="font-semibold">{t("manage.modifiers")}</h3>
        {draft.modifiers.map((m, i) => (
          <div key={m.id ?? i} className="space-y-2 rounded-xl border border-slate-200 p-3">
            <div className="flex gap-2">
              <select
                className="input !w-auto"
                value={m.kind}
                onChange={(e) => setMod(i, { kind: e.target.value as "remove" | "add" })}
              >
                <option value="remove">− {t("menu.remove")}</option>
                <option value="add">+ {t("menu.add")}</option>
              </select>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                min={0}
                placeholder={t("manage.extraPrice")}
                value={m.extra_price || ""}
                onChange={(e) => setMod(i, { extra_price: Number(e.target.value) })}
              />
              <button
                className="btn-ghost !px-3"
                aria-label={t("manage.delete")}
                onClick={() => set("modifiers", draft.modifiers.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
            <input
              className="input"
              placeholder={`PT · ${t("manage.modifierName")}`}
              value={m.pt}
              onChange={(e) => setMod(i, { pt: e.target.value })}
            />
            <input className="input" placeholder="EN" value={m.en} onChange={(e) => setMod(i, { en: e.target.value })} />
          </div>
        ))}
        <button
          className="btn-ghost w-full"
          onClick={() => set("modifiers", [...draft.modifiers, { kind: "remove", pt: "", en: "", extra_price: 0 }])}
        >
          + {t("manage.addModifier")}
        </button>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-ghost" onClick={onCancel}>
          {t("manage.cancel")}
        </button>
        <button className="btn" onClick={onSave} disabled={!draft.pt.trim() && !draft.en.trim()}>
          {t("manage.save")}
        </button>
      </div>
      {onDelete ? (
        <button className="w-full py-2 text-red-700" onClick={onDelete}>
          {t("manage.delete")}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mesas e códigos QR
// ---------------------------------------------------------------------------

function Tables({ restaurant }: { restaurant: Restaurant }) {
  const { t } = useI18n();
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [label, setLabel] = useState("");
  const [seats, setSeats] = useState<number | "">("");
  const [qr, setQr] = useState<{ table: DiningTable; url: string; image: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase()
      .from("dining_tables")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .eq("active", true)
      .order("label");
    setTables((data ?? []) as DiningTable[]);
  }, [restaurant.id]);

  useEffect(() => void load(), [load]);

  async function add() {
    setError(null);
    const { error } = await supabase()
      .from("dining_tables")
      .insert({ restaurant_id: restaurant.id, label: label.trim(), seats: seats || null });
    if (error) return setError(error.message);
    setLabel("");
    setSeats("");
    void load();
  }

  async function showQr(table: DiningTable) {
    const url = `${window.location.origin}/m/${table.qr_token}`;
    const image = await QRCode.toDataURL(url, { width: 600, margin: 2 });
    setQr({ table, url, image });
  }

  async function regenerate(table: DiningTable) {
    if (!window.confirm(t("manage.newQrConfirm"))) return;
    const { data, error } = await supabase().rpc("regenerate_table_token", { p_table_id: table.id });
    if (error) return setError(error.message);
    await load();
    void showQr({ ...table, qr_token: data as string });
  }

  async function remove(table: DiningTable) {
    await supabase().from("dining_tables").update({ active: false }).eq("id", table.id);
    setQr(null);
    void load();
  }

  if (qr)
    return (
      <div className="card space-y-4 text-center print:border-0 print:shadow-none">
        <div className="text-3xl font-bold">{qr.table.label}</div>
        <div className="text-lg">{restaurant.name}</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr.image} alt={qr.url} className="mx-auto w-72 max-w-full" />
        <div className="break-all text-xs text-slate-500">{qr.url}</div>
        <div className="grid grid-cols-2 gap-2 print:hidden">
          <button className="btn-ghost" onClick={() => setQr(null)}>
            ←
          </button>
          <button className="btn" onClick={() => window.print()}>
            {t("manage.print")}
          </button>
          <button className="btn-ghost" onClick={() => regenerate(qr.table)}>
            {t("manage.newQr")}
          </button>
          <button className="btn-ghost text-red-700" onClick={() => remove(qr.table)}>
            {t("manage.delete")}
          </button>
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-bold">{t("manage.newTable")}</h2>
        <input className="input" placeholder={t("manage.tableLabel")} value={label} onChange={(e) => setLabel(e.target.value)} />
        <input
          className="input"
          type="number"
          inputMode="numeric"
          min={1}
          placeholder={t("manage.seats")}
          value={seats}
          onChange={(e) => setSeats(e.target.value ? Number(e.target.value) : "")}
        />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className="btn w-full" onClick={add} disabled={!label.trim()}>
          + {t("manage.newTable")}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tables.map((tb) => (
          <button key={tb.id} className="card text-left active:bg-slate-50" onClick={() => showQr(tb)}>
            <div className="text-lg font-bold">{tb.label}</div>
            <div className="text-sm text-slate-600">
              {tb.seats ? `${tb.seats} ${t("manage.seats").toLowerCase()} · ` : ""}
              {t("manage.showQr")}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marca do restaurante
// ---------------------------------------------------------------------------

function Brand({ restaurant }: { restaurant: Restaurant }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: restaurant.name,
    primary_color: restaurant.primary_color,
    accent_color: restaurant.accent_color,
    logo_url: restaurant.logo_url ?? "",
    taglinePt: restaurant.tagline?.pt ?? "",
    taglineEn: restaurant.tagline?.en ?? "",
  });
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    const { error } = await supabase()
      .from("restaurants")
      .update({
        name: form.name,
        primary_color: form.primary_color,
        accent_color: form.accent_color,
        logo_url: form.logo_url || null,
        tagline: i18n(form.taglinePt, form.taglineEn),
      })
      .eq("id", restaurant.id);
    setMsg(error ? error.message : t("manage.saved"));
    if (!error) window.location.reload();
  }

  return (
    <div className="card space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-semibold">{t("app.name")}</span>
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-semibold">{t("manage.primaryColor")}</span>
          <input
            type="color"
            className="h-12 w-full rounded-xl"
            value={form.primary_color}
            onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">{t("manage.accentColor")}</span>
          <input
            type="color"
            className="h-12 w-full rounded-xl"
            value={form.accent_color}
            onChange={(e) => setForm({ ...form, accent_color: e.target.value })}
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-semibold">{t("manage.logoUrl")}</span>
        <input className="input" value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-semibold">{t("manage.taglinePt")}</span>
        <input className="input" value={form.taglinePt} onChange={(e) => setForm({ ...form, taglinePt: e.target.value })} />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-semibold">{t("manage.taglineEn")}</span>
        <input className="input" value={form.taglineEn} onChange={(e) => setForm({ ...form, taglineEn: e.target.value })} />
      </label>
      {msg ? <p className="text-sm">{msg}</p> : null}
      <button className="btn w-full" onClick={save}>
        {t("manage.save")}
      </button>
    </div>
  );
}
