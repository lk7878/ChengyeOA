import { AgentPresets } from '../../../third_party/deepseek-harness/packages/preset/agent-presets/lib/index.js';

const retired = new Set(['standard', 'ptc', 'minimal', 'cordis']);

/** One deployment preset; native mounting, history and tool permissions remain upstream-owned. */
export default class LawyerPresets extends AgentPresets {
  get defaultId() { return 'lawyer'; }

  async resolve(id) {
    // Old session records retain their provenance. Resuming an old built-in
    // uses the sole current composition, without rewriting a session log.
    return super.resolve(id === undefined || retired.has(id) ? 'lawyer' : id);
  }
}
