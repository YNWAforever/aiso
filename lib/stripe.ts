import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-03-31.basil',
})

export const STRIPE_PRICES = {
  pro: process.env.STRIPE_PRICE_PRO!,
} as const

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://fimmick-aeo.vercel.app'
