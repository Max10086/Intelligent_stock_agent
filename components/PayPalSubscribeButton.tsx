import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, readApiError } from '../utils/authenticatedFetch.ts';

export type PayPalBillingConfig = {
  clientId: string;
  planId: string;
  mode: 'live' | 'sandbox';
  configured: boolean;
};

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: Record<string, unknown>) => {
        render: (selector: string) => Promise<void>;
        close: () => void;
      };
    };
  }
}

const loadPayPalSdk = (clientId: string): Promise<void> => {
  if (window.paypal) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>('script[data-paypal-sdk="true"]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load PayPal SDK')));
      if (window.paypal) resolve();
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&vault=true&intent=subscription`;
    script.async = true;
    script.dataset.paypalSdk = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PayPal SDK'));
    document.body.appendChild(script);
  });
};

interface PayPalSubscribeButtonProps {
  userId: string;
  userEmail: string;
  onActivated: () => void | Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
}

export const PayPalSubscribeButton: React.FC<PayPalSubscribeButtonProps> = ({
  userId,
  userEmail,
  onActivated,
  onError,
  disabled = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const containerIdRef = useRef(`paypal-button-${Math.random().toString(36).slice(2)}`);
  const [isLoading, setIsLoading] = useState(true);
  const [isActivating, setIsActivating] = useState(false);
  const renderedRef = useRef(false);

  const activateSubscription = useCallback(
    async (subscriptionId: string) => {
      setIsActivating(true);
      try {
        const response = await apiFetch('/api/billing/paypal/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscriptionId }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        await onActivated();
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Failed to activate subscription');
      } finally {
        setIsActivating(false);
      }
    },
    [onActivated, onError]
  );

  useEffect(() => {
    if (disabled || renderedRef.current) return;
    let cancelled = false;

    const setup = async () => {
      try {
        const response = await apiFetch('/api/billing/config');
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        const config = (await response.json()) as PayPalBillingConfig;
        if (!config.configured || !config.clientId || !config.planId) {
          throw new Error('PayPal billing is not configured');
        }

        await loadPayPalSdk(config.clientId);
        if (cancelled || !containerRef.current || !window.paypal) return;

        await window.paypal
          .Buttons({
            style: {
              shape: 'rect',
              color: 'gold',
              layout: 'vertical',
              label: 'subscribe',
            },
            createSubscription: (_data: unknown, actions: { subscription: { create: (payload: Record<string, unknown>) => Promise<string> } }) =>
              actions.subscription.create({
                plan_id: config.planId,
                custom_id: userId,
                subscriber: {
                  email_address: userEmail,
                },
              }),
            onApprove: async (data: { subscriptionID?: string }) => {
              if (!data.subscriptionID) {
                onError('PayPal did not return a subscription ID');
                return;
              }
              await activateSubscription(data.subscriptionID);
            },
            onError: (err: unknown) => {
              console.error('[paypal] button error:', err);
              onError('PayPal checkout failed. Please try again.');
            },
          })
          .render(`#${containerIdRef.current}`);

        renderedRef.current = true;
      } catch (error) {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : 'Failed to load PayPal checkout');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void setup();

    return () => {
      cancelled = true;
    };
  }, [activateSubscription, disabled, onError, userEmail, userId]);

  if (disabled) {
    return (
      <p className="text-sm text-green-300">
        Your subscription is active. Thank you for subscribing.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {isLoading && (
        <p className="text-sm text-gray-400">Loading PayPal checkout...</p>
      )}
      {isActivating && (
        <p className="text-sm text-blue-300">Activating your subscription...</p>
      )}
      <div ref={containerRef} id={containerIdRef.current} />
    </div>
  );
};
