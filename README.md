# GradeSwap

**Last year's books. This year's savings.**

GradeSwap is a Kenyan marketplace for used school books, like Jiji but only for school books. Parents list last year's books with photos, buyers search by grade, school and area, and every payment goes through GradeSwap on M-Pesa so both sides are protected.

## What's in the app

| Page | What it does |
| --- | --- |
| **Browse** (`#/`) | Latest books, search by title or publisher, filter by grade, school and area |
| **Book** (`#/book/<id>`) | Photos, price, details, and a **Request to buy** form (name, M-Pesa number, area) |
| **Sell** (`#/sell`) | Google sign-in, then list a book with up to 4 photos (resized on the phone before upload) |
| **My listings** (`#/my`) | Mark books Available / Reserved / Sold, or delete them |
| **How it works** (`#/how`) | Buying, selling, fees and FAQs |

Buyers never see the seller's phone number. A buy request is saved in the database with an order number (e.g. `GS-7K2QX`), and the buyer sends it to you on WhatsApp. You confirm, collect payment by M-Pesa, and pay the seller 90% once the buyer has the book.

Until Supabase is connected, the site runs in **preview mode** with sample listings, so you can click through everything.

## Files

```
index.html           page shell, header, footer, logo
assets/style.css     GradeSwap brand styles (Montserrat, navy, amber, coral)
assets/app.js        the app: pages, search, sign-in, listings, buy requests
config.js            your Supabase keys, WhatsApp number and seller share
supabase/schema.sql  database tables, security rules and photo storage
favicon.svg          app icon
```

No build step and no packages to install: it's plain HTML, CSS and JavaScript.

## Go live (all free)

### 1. Create the database (Supabase)

1. Go to **supabase.com** → **Start your project** → sign in with GitHub.
2. **New project**: name it `gradeswap`, set a database password (save it), region **closest to Kenya** (e.g. Frankfurt or Cape Town if offered).
3. When it's ready, open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, and click **Run**.
4. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `config.js`.

### 2. Turn on Google sign-in

1. In Supabase: **Authentication → Sign In / Providers → Google** → turn it on. Copy the **Callback URL** shown there.
2. Go to **console.cloud.google.com** → create a project called `GradeSwap`.
3. **APIs & Services → OAuth consent screen**: External, app name GradeSwap, your email, then publish it.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type **Web application**. Under **Authorised redirect URIs** paste the Supabase Callback URL.
5. Copy the **Client ID** and **Client secret** back into Supabase's Google provider and save.
6. In Supabase: **Authentication → URL Configuration**: set **Site URL** to your live site address (e.g. `https://gradeswap.co.ke`) and add it under **Redirect URLs** too.

### 3. Put the site online (Vercel)

Import this repository at **vercel.com/new**. No build command; the output directory is the repository root. Every push to `main` updates the live site.

### 4. Set your WhatsApp number

In `config.js`, set `WHATSAPP_NUMBER` to your WhatsApp Business number (e.g. `254712345678`).

## Running orders day to day

In Supabase, open **Table Editor**:

- **orders_admin**: every buy request with the book, price, buyer's details, and the seller's name and payout number.
- **orders**: update `status` as an order moves: `new → confirmed → paid → collected → seller_paid` (or `cancelled` / `refunded`).
- **listings**: set a book to `reserved` while an order is in progress and `sold` when it's done (sellers can do this too).

## Next steps

- M-Pesa STK push (Daraja API) so buyers pay inside the site
- School book lists: upload a school's list once, and buyers see which books are available
- Seller verification (M-Pesa name check + ID selfie) and ratings after each sale
- Featured listings for sellers who want to sell faster
