import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/api/auth';
import type { StepUpPurpose } from './types';

export interface WithStepUpInput<T> {
  purpose: StepUpPurpose;
  target: unknown;
  verify: () => Promise<string>;
  mutate: (stepUpToken: string) => Promise<T>;
}

export async function withStepUp<T>(input: WithStepUpInput<T>): Promise<T> {
  void input.purpose;
  void input.target;
  const stepUpToken = await input.verify();
  return input.mutate(stepUpToken);
}

interface PendingStepUp {
  purpose: StepUpPurpose;
  target: unknown;
  impact: string;
  mutate: (stepUpToken: string) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export interface StepUpRequest<T> {
  purpose: StepUpPurpose;
  target: unknown;
  impact: string;
  mutate: (stepUpToken: string) => Promise<T>;
}

export function useStepUp() {
  const [pending, setPending] = useState<PendingStepUp | null>(null);
  const pendingRef = useRef<PendingStepUp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(<T,>(request: StepUpRequest<T>) => new Promise<T>((resolve, reject) => {
    pendingRef.current?.reject(new Error('STEP_UP_CANCELLED'));
    setError(null);
    const nextPending: PendingStepUp = {
      ...request,
      mutate: request.mutate as (stepUpToken: string) => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    };
    pendingRef.current = nextPending;
    setPending(nextPending);
  }), []);

  const cancel = useCallback(() => {
    if (loading) return;
    const active = pendingRef.current;
    pendingRef.current = null;
    active?.reject(new Error('STEP_UP_CANCELLED'));
    setPending(null);
    setLoading(false);
    setError(null);
  }, [loading]);

  const verify = useCallback(async (code: string) => {
    const active = pendingRef.current;
    if (!active) return;
    setLoading(true);
    setError(null);
    let stepUpToken: string;
    try {
      stepUpToken = (await authApi.stepUp(active.purpose, active.target, code)).data.stepUpToken;
    } catch (errorValue) {
      if (pendingRef.current !== active) return;
      const responseCode = (errorValue as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(responseCode === 'MFA_INVALID' ? '验证码无效，请重试' : '身份验证失败，请重试');
      setLoading(false);
      return;
    }
    if (pendingRef.current !== active) {
      setLoading(false);
      return;
    }
    try {
      const value = await active.mutate(stepUpToken);
      if (pendingRef.current !== active) return;
      pendingRef.current = null;
      active.resolve(value);
      setPending(null);
    } catch (mutationError) {
      if (pendingRef.current !== active) return;
      pendingRef.current = null;
      active.reject(mutationError);
      setPending(null);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    run,
    dialogProps: {
      open: Boolean(pending),
      purpose: pending?.purpose ?? 'SESSION_REVOKE',
      impact: pending?.impact ?? '',
      loading,
      error,
      onCancel: cancel,
      onVerify: verify,
    },
  };
}
