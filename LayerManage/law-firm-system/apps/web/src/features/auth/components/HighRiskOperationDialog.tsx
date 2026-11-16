import { useEffect } from 'react';
import { registerHighRiskHandler } from '../high-risk-request';
import { useStepUp } from '../useStepUp';
import StepUpDialog from './StepUpDialog';
export default function HighRiskOperationDialog() {
  const { run, dialogProps } = useStepUp();
  useEffect(() => registerHighRiskHandler(challenge => run({ ...challenge, mutate: async token => token })), [run]);
  return <StepUpDialog {...dialogProps} />;
}
