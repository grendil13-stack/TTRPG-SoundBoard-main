import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw new Error("Method not allowed");
    }

    const rawBody = await req.text();
    const event = JSON.parse(rawBody);

    if (event.type === "checkout.session.completed") {
      const session = event.data?.object;
      const clientReferenceId = session?.client_reference_id;
      const subscription = session?.subscription;

      if (clientReferenceId) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseServiceRoleKey) {
          throw new Error("Supabase environment variables are not configured");
        }

        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

        const subscriptionId =
          typeof subscription === "string" ? subscription : subscription?.id ?? null;

        if (!subscriptionId) {
          console.warn(
            "checkout.session.completed: event.data.object.subscription is null or missing",
            { clientReferenceId, sessionId: session?.id },
          );
        }

        const updatePayload: { tier: "pro"; stripe_subscription_id?: string } = {
          tier: "pro",
        };
        if (subscriptionId) {
          updatePayload.stripe_subscription_id = subscriptionId;
        }

        const { error } = await supabase
          .from("profiles")
          .update(updatePayload)
          .eq("id", clientReferenceId);

        if (error) {
          throw new Error(error.message);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
