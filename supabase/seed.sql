-- Dados de demonstração: um restaurante, duas categorias, pratos com ajustes e três mesas.
-- A equipa é ligada depois de criar as contas (ver README, "Criar a equipa").

insert into public.restaurants (id, slug, name, primary_color, accent_color)
values ('00000000-0000-0000-0000-000000000001', 'demo', 'Restaurante Demo', '#EA580C', '#0F172A')
on conflict (id) do nothing;

insert into public.categories (id, restaurant_id, name, position) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001',
   '{"pt": "Pratos", "en": "Mains"}', 1),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001',
   '{"pt": "Bebidas", "en": "Drinks"}', 2)
on conflict (id) do nothing;

insert into public.dishes (id, restaurant_id, category_id, name, description, ingredients, price, position) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000c1',
   '{"pt": "Grelhada mista", "en": "Mixed grill"}',
   '{"pt": "Frango, entrecosto e chouriço grelhados", "en": "Grilled chicken, ribs and chorizo"}',
   '{"pt": "Frango, entrecosto, chouriço, cebola, batata frita", "en": "Chicken, ribs, chorizo, onion, fries"}',
   12500, 1),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000c1',
   '{"pt": "Muamba de galinha", "en": "Chicken muamba"}',
   '{"pt": "Com funge e quiabos", "en": "With funge and okra"}',
   '{"pt": "Galinha, óleo de palma, quiabos, abóbora, funge", "en": "Chicken, palm oil, okra, pumpkin, funge"}',
   9800, 2),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000c2',
   '{"pt": "Gasosa", "en": "Soft drink"}', '{}', '{}', 1000, 1),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000c2',
   '{"pt": "Água 0,5 L", "en": "Water 0.5 L"}', '{}', '{}', 500, 2)
on conflict (id) do nothing;

insert into public.dish_modifiers (restaurant_id, dish_id, kind, name, extra_price, position) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1',
   'remove', '{"pt": "Sem cebola", "en": "No onion"}', 0, 1),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1',
   'add', '{"pt": "Ovo estrelado", "en": "Fried egg"}', 500, 2),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2',
   'remove', '{"pt": "Sem quiabos", "en": "No okra"}', 0, 1),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d3',
   'add', '{"pt": "Com limão", "en": "With lemon"}', 0, 1),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d3',
   'add', '{"pt": "Com gelo", "en": "With ice"}', 0, 2);

insert into public.dining_tables (restaurant_id, label, seats, qr_token) values
  ('00000000-0000-0000-0000-000000000001', 'Mesa 1', 4, 'demo-mesa-1'),
  ('00000000-0000-0000-0000-000000000001', 'Mesa 2', 4, 'demo-mesa-2'),
  ('00000000-0000-0000-0000-000000000001', 'Varanda', 8, 'demo-varanda')
on conflict do nothing;

-- Destaque do dia, alergénios, tempo de preparação e fotos (exemplo)
update public.restaurants
   set tagline = '{"pt": "Sabores na brasa e tradição angolana", "en": "Grilled flavours and Angolan tradition"}'
 where id = '00000000-0000-0000-0000-000000000001';

update public.dishes set is_special = true, prep_minutes = 25,
  allergens = '{"pt": "Glúten (batata frita)", "en": "Gluten (fries)"}',
  photo_url = 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80'
 where id = '00000000-0000-0000-0000-0000000000d1';
update public.dishes set prep_minutes = 30 where id = '00000000-0000-0000-0000-0000000000d2';
update public.dishes set prep_minutes = 2 where id in ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d4');
