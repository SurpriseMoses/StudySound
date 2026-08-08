create or replace function public.set_chunk_embeddings(_ids uuid[], _vecs text[], _model text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare _n integer;
begin
  update public.document_chunks c
  set embedding = v.vec::vector, embedding_model = _model
  from (select unnest(_ids) as id, unnest(_vecs) as vec) v
  where c.id = v.id;
  get diagnostics _n = row_count;
  return _n;
end;
$$;
revoke all on function public.set_chunk_embeddings(uuid[], text[], text) from public, anon, authenticated;
grant execute on function public.set_chunk_embeddings(uuid[], text[], text) to service_role;