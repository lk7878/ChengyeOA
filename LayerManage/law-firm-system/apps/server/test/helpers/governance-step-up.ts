import { GovernanceStepUpAuthorization, GovernanceStepUpConsumer } from '../../app/application/admin-governance/governance-step-up';

export const allowTestGovernanceStepUp: GovernanceStepUpConsumer = {
  async consume() {},
};

export function testGovernanceStepUp(userId: string): GovernanceStepUpAuthorization {
  return {
    claims: {
      userId,
      sessionId: `test-session-${userId}`,
      credentialVersion: 1,
      assuranceLevel: 'MFA',
    },
    token: 'test-step-up-token',
  };
}
