-- The allocator is only ever reached through the column default on
-- client_proposals. Exposed as a PostgREST RPC it is a volatile function any
-- signed-in user could call in a loop, burning sequence values and leaving
-- visible gaps in the client-facing reference numbers. Nothing calls it over
-- the API, so take the grant away.
revoke execute on function public.next_client_proposal_number() from anon, authenticated;