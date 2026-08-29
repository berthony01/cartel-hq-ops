import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(() => new Response(JSON.stringify({ ok: false, disabled: true }), { status: 410, headers: { "Content-Type": "application/json" } }));
