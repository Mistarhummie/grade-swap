# GradeSwap

**Last year's books. This year's savings.**

GradeSwap helps Kenyan parents sell last year's school books and buy this year's book list for less, matched by school and grade, paid through M-Pesa.

## The site

A single static page (`index.html`): no build step, no dependencies.

- **Find my books** and **Sell my books** forms open WhatsApp with the parent's details pre-filled, sent to the GradeSwap WhatsApp Business number.
- Brand: Montserrat, navy `#1B2A4E`, amber `#F5B700`, coral `#FF5A3C` (see the GradeSwap brand guidelines).

## Setup

1. Open `index.html` and set `WHATSAPP_NUMBER` (country code, no `+`, e.g. `254712345678`).
2. Open `index.html` in a browser to preview.

## Deploy (free)

Import this repository on Vercel (or Netlify / GitHub Pages). No build command; the output directory is the repository root.

## Next

- Listings database and search by school + grade (e.g. Supabase free tier)
- M-Pesa payments (Daraja API) with payment held until pickup
- Seller verification (M-Pesa name check + ID selfie)
