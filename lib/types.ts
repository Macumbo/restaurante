/** Texto traduzido guardado em jsonb: {"pt": "...", "en": "..."} */
export type I18nText = Record<string, string>;

export type Restaurant = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  currency: string;
};

export type Category = {
  id: string;
  restaurant_id: string;
  name: I18nText;
  position: number;
  active: boolean;
};

export type Dish = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: I18nText;
  description: I18nText;
  ingredients: I18nText;
  price: number;
  photo_url: string | null;
  available_today: boolean;
  active: boolean;
  position: number;
};

export type Modifier = {
  id: string;
  restaurant_id: string;
  dish_id: string;
  kind: "remove" | "add";
  name: I18nText;
  extra_price: number;
  position: number;
  active: boolean;
};

export type DiningTable = {
  id: string;
  restaurant_id: string;
  label: string;
  seats: number | null;
  qr_token: string;
  active: boolean;
};

export type SessionStatus = "pending" | "confirmed" | "closed" | "cancelled";

export type TableSession = {
  id: string;
  restaurant_id: string;
  table_id: string;
  status: SessionStatus;
  opened_at: string;
};

export type Participant = {
  id: string;
  session_id: string;
  user_id: string;
  display_name: string;
};

export type OrderStatus =
  | "pending_approval"
  | "approved"
  | "preparing"
  | "ready"
  | "delivered"
  | "rejected"
  | "cancelled";

export type OrderItem = {
  id: string;
  order_id: string;
  dish_name: I18nText;
  quantity: number;
  unit_price: number;
  modifiers: { id: string; kind: "remove" | "add"; name: I18nText; extra_price: number }[];
  note: string | null;
  line_total: number;
};

export type Order = {
  id: string;
  restaurant_id: string;
  session_id: string;
  participant_id: string;
  status: OrderStatus;
  note: string | null;
  total: number;
  created_at: string;
  order_items?: OrderItem[];
};

export type Role = "owner" | "manager" | "waiter" | "kitchen";
