import Stripe from 'https://esm.sh/stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      payment_method_id,
      plan,
      price_id,
      email,
      name,
      agency_name,
      user_id,
    } = await req.json();

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email,
      name,
      payment_method: payment_method_id,
      invoice_settings: { default_payment_method: payment_method_id },
      metadata: { user_id, agency_name, plan },
    });

    // Create subscription with 7-day trial
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price_id }],
      trial_period_days: 7,
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
    });

    // Update Supabase profile with Stripe IDs and plan
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        stripe_customer_id: customer.id,
        stripe_subscription_id: subscription.id,
        plan,
        subscription_status: subscription.status,
      }),
    });

    const invoice = subscription.latest_invoice as any;
    const paymentIntent = invoice?.payment_intent as any;

    return new Response(
      JSON.stringify({
        subscription_id: subscription.id,
        requires_action: paymentIntent?.status === 'requires_action',
        client_secret: paymentIntent?.client_secret,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
