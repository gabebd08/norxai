import Stripe from 'https://esm.sh/stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')!;
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const headers = { 'Content-Type': 'application/json' };

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = sub.customer as string;

    // Find user by stripe_customer_id
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?stripe_customer_id=eq.${customerId}&select=id`, {
      headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}` }
    });
    const users = await res.json();
    if (users.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${users[0].id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ subscription_status: sub.status }),
      });
      // Log activity
      await fetch(`${supabaseUrl}/rest/v1/activity_log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          user_id: users[0].id,
          type: event.type === 'customer.subscription.deleted' ? 'cancel' : 'upgrade',
          description: `Subscription ${sub.status}`,
        }),
      });
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers });
});
