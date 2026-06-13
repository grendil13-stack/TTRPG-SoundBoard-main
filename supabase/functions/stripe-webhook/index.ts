import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.deleted',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.text()
    const event = JSON.parse(body)

    console.log('Webhook event type:', event.type)
    console.log('Webhook event data:', JSON.stringify(event.data.object))

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const userId = session.client_reference_id
      const subscriptionId = session.subscription
      const customerEmail = session.customer_details?.email

      console.log('userId:', userId)
      console.log('subscriptionId:', subscriptionId)
      console.log('customerEmail:', customerEmail)

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      if (userId) {
        const { error } = await supabase
          .from('profiles')
          .update({
            tier: 'pro',
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: session.customer,
          })
          .eq('id', userId)

        if (error) {
          console.error('Supabase update error:', error)
          throw error
        }
        console.log('Successfully updated profile for userId:', userId)
      } else if (customerEmail) {
        // Fallback: match by email if no userId
        const { data: authUsers } = await supabase.auth.admin.listUsers()
        const matchedUser = authUsers?.users?.find(u => u.email === customerEmail)
        if (matchedUser) {
          const { error } = await supabase
            .from('profiles')
            .update({
              tier: 'pro',
              stripe_subscription_id: subscriptionId,
              stripe_customer_id: session.customer,
            })
            .eq('id', matchedUser.id)
          if (error) {
            console.error('Supabase fallback update error:', error)
            throw error
          }
          console.log('Successfully updated profile via email match:', customerEmail)
        } else {
          console.log('No matching user found for email:', customerEmail)
        }
      } else {
        console.log('No userId or email found in session')
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object
      const customer = subscription.customer

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      const { error } = await supabase
        .from('profiles')
        .update({
          tier: 'free',
          stripe_subscription_id: null,
        })
        .eq('stripe_customer_id', customer)

      if (error) {
        console.error('Supabase downgrade error:', error)
        throw error
      }
      console.log('Downgraded user to free for customer:', customer)
    } else if (!HANDLED_EVENT_TYPES.includes(event.type)) {
      console.log('Ignoring unhandled event type:', event.type)
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
