/** Shared, locale-owned notices for answers that cannot be published as grounded conclusions. */
export const answerCopy = {
  en: {
    answerFailed: 'The model could not produce a validated answer. Please retry. Retrieved passages are available under source evidence; they are not a synthesized answer.',
    answerInsufficient: 'The retrieved evidence does not establish the requested conclusion. Please check the paper or model version, or add relevant sources. This is not evidence that the conclusion is false.',
  },
  zh: {
    answerFailed: '本次模型未能生成通过校验的回答，请重试。检索原文保留在“来源证据”中，不作为综合回答。',
    answerInsufficient: '当前检索证据不足以确认您所问的结论。请核对论文或模型版本，或补充相关资料；这不代表该结论不成立。',
  },
} as const
