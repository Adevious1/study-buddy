import Stripe from 'stripe';

let client: Stripe | null = null;
export function stripeClient(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is required');
    client = new Stripe(key);
  }
  return client;
}

const PRICE_ID = () => {
  const id = process.env.STRIPE_PRICE_ID;
  if (!id) throw new Error('STRIPE_PRICE_ID is required');
  return id;
};
// Fail at boot: with the localhost fallback, a prod deploy missing
// PUBLIC_APP_URL would send Stripe checkout/portal redirects to localhost.
// (`||` not `??` — docker-compose passes `${PUBLIC_APP_URL:-}`, an empty
// string when unset, which `??` would keep.)
if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_APP_URL) {
  throw new Error('PUBLIC_APP_URL is required in production (Stripe redirect URLs)');
}
const APP_URL = () => process.env.PUBLIC_APP_URL || 'http://localhost:5173';

export async function createCheckoutSession(opts: {
  customerId: string; quantity: number; trialEnd?: Date | null;
}): Promise<string> {
  const session = await stripeClient().checkout.sessions.create({
    mode: 'subscription',
    customer: opts.customerId,
    line_items: [{ price: PRICE_ID(), quantity: Math.max(1, opts.quantity) }],
    subscription_data: opts.trialEnd && opts.trialEnd.getTime() > Date.now()
      ? { trial_end: Math.floor(opts.trialEnd.getTime() / 1000) }
      : undefined,
    success_url: `${APP_URL()}/dashboard?billing=success`,
    cancel_url: `${APP_URL()}/dashboard?billing=cancel`,
  });
  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return session.url;
}

export async function createPortalSession(customerId: string): Promise<string> {
  const session = await stripeClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL()}/dashboard`,
  });
  return session.url;
}

export async function createCustomer(opts: { email: string; guardianId: string }): Promise<string> {
  const customer = await stripeClient().customers.create({
    email: opts.email,
    metadata: { guardianId: opts.guardianId },
  });
  return customer.id;
}

export async function setSubscriptionQuantity(subscriptionId: string, quantity: number): Promise<void> {
  const stripe = stripeClient();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) throw new Error('subscription has no items');
  await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, quantity: Math.max(1, quantity) }],
    proration_behavior: 'create_prorations',
  });
}

export async function constructWebhookEvent(rawBody: string, signature: string): Promise<Stripe.Event> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is required');
  return stripeClient().webhooks.constructEventAsync(rawBody, signature, secret);
}
