insert into storage.buckets (id, name, public)
values ('store-item-images', 'store-item-images', true)
on conflict (id) do nothing;

create policy "store_item_images_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'store-item-images');