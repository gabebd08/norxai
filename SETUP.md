# Norx AI — Supabase Setup Guide

## Step 1: Create your Supabase project
1. Go to supabase.com and sign up free
2. Click "New project"
3. Name it "norxai"
4. Choose a region close to you (US East or US West)
5. Set a strong database password — save it somewhere
6. Wait ~2 minutes for it to provision

## Step 2: Run the database schema
Go to your Supabase project → SQL Editor → paste and run this:

```sql
-- User profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  agency_name TEXT,
  plan TEXT DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'agency')),
  subscription_status TEXT DEFAULT 'trialing',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usage tracking per user
CREATE TABLE usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  month TEXT, -- format: "2026-04"
  sms_sent INTEGER DEFAULT 0,
  contacts_count INTEGER DEFAULT 0,
  finder_searches INTEGER DEFAULT 0,
  campaigns_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month)
);

-- Activity log
CREATE TABLE activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT, -- 'signup', 'upgrade', 'cancel', 'login', 'campaign_sent'
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, first_name, last_name, agency_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'agency_name'
  );
  -- Log signup activity
  INSERT INTO activity_log (user_id, type, description)
  VALUES (NEW.id, 'signup', 'New user signed up: ' || NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- RLS (Row Level Security) — users can only see their own data
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can view own usage" ON usage FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own usage" ON usage FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view own activity" ON activity_log FOR SELECT USING (auth.uid() = user_id);

-- Admin can see all (replace with your actual user ID after first login)
-- Run this after you create your admin account:
-- CREATE POLICY "Admin can see all profiles" ON profiles FOR ALL USING (auth.uid() = 'YOUR_ADMIN_USER_ID');
-- CREATE POLICY "Admin can see all activity" ON activity_log FOR ALL USING (auth.uid() = 'YOUR_ADMIN_USER_ID');
```

## Step 3: Get your API keys
1. In Supabase → Settings → API
2. Copy "Project URL" → this is your SUPABASE_URL
3. Copy "anon public" key → this is your SUPABASE_ANON_KEY
4. Copy "service_role" key → keep this SECRET, only for server-side use

## Step 4: Create Stripe products
1. Go to stripe.com → Products → Add product
2. Create three products:
   - "Norx AI Starter" → $49/month recurring → copy the Price ID
   - "Norx AI Pro" → $97/month recurring → copy the Price ID
   - "Norx AI Agency" → $197/month recurring → copy the Price ID
3. Enable 7-day trial on each product in Stripe

## Step 5: Create the Stripe webhook Edge Function
In Supabase → Edge Functions → New function → name it "create-subscription"

Paste this code:
```typescript
import Stripe from 'https://esm.sh/stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const { payment_method_id, plan, price_id, email, name, agency_name, user_id } = await req.json();

  try {
    // Create Stripe customer
    const customer = await stripe.customers.create({
      email,
      name,
      payment_method: payment_method_id,
      invoice_settings: { default_payment_method: payment_method_id },
      metadata: { user_id, agency_name, plan },
    });

    // Create subscription with trial
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

    // Update Supabase profile with Stripe IDs
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

    const invoice = subscription.latest_invoice as Stripe.Invoice;
    const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent;

    return new Response(JSON.stringify({
      subscription_id: subscription.id,
      requires_action: paymentIntent?.status === 'requires_action',
      client_secret: paymentIntent?.client_secret,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
```

Set these environment variables in Supabase → Edge Functions → Secrets:
- STRIPE_SECRET_KEY = your Stripe secret key (sk_live_...)
- SUPABASE_SERVICE_ROLE_KEY = your service role key

## Step 6: Set up Stripe webhook (for subscription updates)
1. Stripe → Developers → Webhooks → Add endpoint
2. URL: https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook
3. Events to listen for:
   - customer.subscription.updated
   - customer.subscription.deleted
   - invoice.payment_failed

## Step 7: Update the config variables in all HTML files
Replace these placeholders in signup.html, login.html, admin.html, and app.html:
- YOUR_PROJECT.supabase.co → your actual Supabase project URL
- YOUR_SUPABASE_ANON_KEY → your anon key
- pk_live_YOUR_STRIPE_PUBLISHABLE_KEY → your Stripe publishable key
- price_YOUR_STARTER_PRICE_ID → Stripe price ID for $49 plan
- price_YOUR_PRO_PRICE_ID → Stripe price ID for $97 plan
- price_YOUR_AGENCY_PRICE_ID → Stripe price ID for $197 plan
- YOUR_ADMIN_EMAIL@example.com → your email address

## Step 8: Deploy to Vercel
1. Go to vercel.com → New project
2. Import from GitHub OR drag your norxai folder
3. No build settings needed — it's static HTML
4. Your site goes live at norxai.vercel.app or your custom domain

## Step 9: Connect a custom domain (optional)
1. Buy norxai.com or similar at namecheap.com (~$12/year)
2. In Vercel → your project → Settings → Domains → Add domain
3. Follow the DNS instructions — takes about 5 minutes

---
That's everything. Total cost to run: $0/month until you have paying customers.
Stripe only charges 2.9% + $0.30 per successful transaction.
