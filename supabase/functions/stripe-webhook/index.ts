import Stripe from 'https://esm.sh/stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const supabaseUrl = Deno.env.get('SB_URL')!;
const supabaseServiceKey = Deno.env.get('SB_SERVICE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

async function updateProfile(customerId: string, data: object) {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?stripe_customer_id=eq.${customerId}&select=id`, {
    headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}` }
  });
  const users = await res.json();
  if (!users?.length) return;
  await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${users[0].id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });
  return users[0].id;
}

async function logActivity(userId: string, type: string, description: string) {
  await fetch(`${supabaseUrl}/rest/v1/activity_log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ user_id: userId, type, description }),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const signature = req.headers.get('stripe-signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature!, webhookSecret);
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const plan = (sub.items.data[0]?.price?.metadata?.plan || 'starter') as string;
        const userId = await updateProfile(sub.customer as string, {
          subscription_status: sub.status,
          plan: plan,
          stripe_subscription_id: sub.id,
        });
        if (userId) await logActivity(userId, 'upgrade', `Subscription updated: ${sub.status} — ${plan} plan`);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await updateProfile(sub.customer as string, {
          subscription_status: 'canceled',
        });
        if (userId) await logActivity(userId, 'cancel', 'Subscription cancelled');
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const userId = await updateProfile(inv.customer as string, {
          subscription_status: 'past_due',
        });
        if (userId) await logActivity(userId, 'payment_failed', 'Payment failed — subscription past due');
        break;
      }
      case 'invoice.payment_succeeded': {
        const inv = event.data.object as Stripe.Invoice;
        const userId = await updateProfile(inv.customer as string, {
          subscription_status: 'active',
        });
        if (userId) await logActivity(userId, 'payment', `Payment succeeded: $${((inv.amount_paid || 0) / 100).toFixed(2)}`);
        break;
      }
      case 'customer.subscription.trial_will_end': {
        // Trial ends in 3 days — send reminder (future: trigger email)
        const sub = event.data.object as Stripe.Subscription;
        const userId = await updateProfile(sub.customer as string, {});
        if (userId) await logActivity(userId, 'trial_ending', 'Trial ends in 3 days');
        break;
      }
    }
  } catch (err: any) {
    console.error('Webhook handler error:', err);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
