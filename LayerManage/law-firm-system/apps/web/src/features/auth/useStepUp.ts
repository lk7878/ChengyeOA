import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/api/auth';
import { requestErrorMessage } from '@/api/errors';
import type { StepUpPurpose } from './types';

export type StepUpReadiness = 'CHECKING' | 'READY' | 'ENROLLMENT_REQUIRED' | 'LOGIN_REQUIRED' | 'ADMIN_REQUIRED' | 'ERROR';

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
  const [readiness, setReadiness] = useState<StepUpReadiness>('CHECKING');
  const readinessRef = useRef<StepUpReadiness>('CHECKING');
  const check = useCallback(async (active: PendingStepUp) => {
    readinessRef.current = 'CHECKING';
    setReadiness('CHECKING');
    setError(null);
    try {
      const status = await authApi.mfaStatus();
      if (pendingRef.current !== active) return;
      const personalMaintenance = ['MFA_DISABLE_SELF', 'MFA_RECOVERY_CODES_REGENERATE'].includes(active.purpose);
      const next = status.data.canManageHighRisk === false && !personalMaintenance
        ? 'ADMIN_REQUIRED' : !status.data.enabled ? 'ENROLLMENT_REQUIRED' : 'READY';
      readinessRef.current = next;
      setReadiness(next);
    } catch (e) {
      if (pendingRef.current !== active) return;
      readinessRef.current = 'ERROR';
      setReadiness('ERROR');
      setError(requestErrorMessage(e, '无法读取账号验证状态，请重试'));
    }
  }, []);

  const run = useCallback(
    <T,>(request: StepUpRequest<T>) =>
      new Promise<T>((resolve, reject) => {
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
        void check(nextPending);
      }),
    [check],
  );

  const cancel = useCallback(() => {
    if (loading) return;
    const active = pendingRef.current;
    pendingRef.current = null;
    active?.reject(new Error('STEP_UP_CANCELLED'));
    setPending(null);
    setLoading(false);
    setError(null);
  }, [loading]);

  const verify = useCallback(
    async (code: string) => {
      const active = pendingRef.current;
      if (!active || readinessRef.current !== 'READY' || loading) return;
      setLoading(true);
      setError(null);
      let stepUpToken: string;
      try {
        stepUpToken = (await authApi.stepUp(active.purpose, active.target, code)).data.stepUpToken;
      } catch (errorValue) {
        if (pendingRef.current !== active) return;
        const responseCode = (errorValue as { response?: { data?: { message?: string } } })?.response?.data
          ?.message;
        setError(
          responseCode === 'MFA_RATE_LIMITED'
            ? '验证失败次数过多，请 15 分钟后重试'
            : requestErrorMessage(errorValue, '身份验证失败，请重试'),
        );
        if (['STEP_UP_REQUIRED', 'MFA_REQUIRED', 'MFA_ENROLLMENT_REQUIRED'].includes(responseCode || '')) {
          readinessRef.current =
            responseCode === 'MFA_ENROLLMENT_REQUIRED' ? 'ENROLLMENT_REQUIRED' : 'ERROR';
          setReadiness(readinessRef.current);
        }
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
    },
    [loading],
  );

  return {
    run,
    dialogProps: {
      open: Boolean(pending),
      purpose: pending?.purpose ?? 'ADMIN_HIGH_RISK',
      impact: pending?.impact ?? '',
      loading,
      error,
      readiness,
      onRetry: () => {
        if (pendingRef.current) void check(pendingRef.current);
      },
      onCancel: cancel,
      onVerify: verify,
    },
  };
}
