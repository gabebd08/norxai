# Norx AI — SaaS Platform

## Project Structure
```
norxai/
├── pages/
│   ├── index.html        ← Landing page (marketing site + pricing)
│   ├── signup.html       ← Signup with Stripe payment
│   ├── login.html        ← Login page
│   ├── app.html          ← Main dashboard (copy your NorxAI.html here)
│   └── admin.html        ← Admin panel (you only)
├── SETUP.md              ← Complete setup instructions
└── README.md             ← This file
```

## What's built
- ✅ Landing page with pricing, features, testimonials, FAQ
- ✅ Signup flow with plan selection + Stripe card collection
- ✅ Login page with Supabase auth
- ✅ Admin dashboard with MRR, user list, revenue tracking
- ✅ Supabase database schema
- ✅ Stripe subscription Edge Function
- ✅ Full setup guide

## What you need to do
1. Follow SETUP.md step by step — takes about 1 hour
2. Copy your NorxAI.html into pages/app.html
3. Add auth check to app.html (check localStorage for norx-auth-token)
4. Replace all YOUR_* placeholders with real API keys
5. Deploy to Vercel

## Revenue projection
At 10 users average $97/mo = $970 MRR
At 50 users average $97/mo = $4,850 MRR
At 100 users average $97/mo = $9,700 MRR = $116,400 ARR

## Tech Stack
- Frontend: Pure HTML/CSS/JS (no framework needed)
- Auth: Supabase Auth
- Database: Supabase PostgreSQL
- Payments: Stripe
- Hosting: Vercel
- SMS: Twilio (each user's own account)
- Lead data: Google Places API (each user's own key)

## Monthly running costs at scale
- Supabase: Free up to 500MB, $25/mo after
- Vercel: Free up to 100GB bandwidth
- Stripe: 2.9% + $0.30 per transaction (no monthly fee)
- Domain: ~$1/month
Total: ~$0-25/month regardless of user count
