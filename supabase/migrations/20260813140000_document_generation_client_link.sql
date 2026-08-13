-- Links a generated SOP/Policy back to the client it was drafted for.
--
-- The document builder had no client_id at all: industry, jurisdiction and
-- standards were retyped on every run, and the output was findable only by
-- whoever remembered running it. With the client recorded, a generation can be
-- listed on the client's record alongside its proposals and files, and the AI
-- can be handed what the platform already knows (see lib/ai/client-context.ts).
--
-- Additive and reversible: the column is nullable, every existing row keeps a
-- null, and rolling back is
--   alter table public.document_builder_generations drop column client_id;

alter table public.document_builder_generations
  add column if not exists client_id uuid
    references public.company_clients(id) on delete set null;

create index if not exists document_builder_generations_client_idx
  on public.document_builder_generations(client_id)
  where client_id is not null;
