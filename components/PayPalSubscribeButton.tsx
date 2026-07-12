import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getPayPalPublicConfig, preloadPayPalSdk } from '../lib/publicRuntimeConfig.ts';
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

const logCheckoutStep = (step: string, startedAt: number) => {
  if (import.meta.env.DEV) {
    console.info(`[paypal] ${step}: ${Math.round(performance.now() - startedAt)}ms`);
  }
};

const resolveBillingConfig = async (): Promise<PayPalBillingConfig> => {
  const cached = getPayPalPublicConfig();
  if (cached) {
    return cached;
  }

  const response = await apiFetch('/api/billing/config');
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const config = (await response.json()) as PayPalBillingConfig;
  if (!config.configured || !config.clientId || !config.planId) {
    throw new Error('PayPal billing is not configured');
  }
  return config;
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
  const [loadingStep, setLoadingStep] = useState<string | null>(null);
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
    const startedAt = performance.now();

    const setup = async () => {
      try {
        setLoadingStep('config');
        const config = await resolveBillingConfig();
        logCheckoutStep('config ready', startedAt);
        if (cancelled) return;

        setLoadingStep('sdk');
        const sdkPromise = preloadPayPalSdk(config.clientId);
        if (!sdkPromise) {
          throw new Error('Failed to start PayPal SDK load');
        }
        await sdkPromise;
        logCheckoutStep('sdk ready', startedAt);
        if (cancelled || !containerRef.current || !window.paypal) return;

        setLoadingStep('button');
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
        logCheckoutStep('button rendered', startedAt);
      } catch (error) {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : 'Failed to load PayPal checkout');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setLoadingStep(null);
        }
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
        <p className="text-sm text-gray-400">
          {loadingStep === 'sdk'
            ? 'Loading PayPal checkout (SDK)...'
            : loadingStep === 'button'
              ? 'Rendering PayPal button...'
              : 'Loading PayPal checkout...'}
        </p>
      )}
      {isActivating && (
        <p className="text-sm text-blue-300">Activating your subscription...</p>
      )}
      <div ref={containerRef} id={containerIdRef.current} />
    </div>
  );
};
