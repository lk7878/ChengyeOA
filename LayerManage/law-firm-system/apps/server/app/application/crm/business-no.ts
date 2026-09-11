// SPEC-009 Task 8: 可读业务编号共享生成器（决策 1）。
// 自 lead-service 私有 generateBusinessNo 原样提取（行为不变）：前缀 + yyMMdd(UTC) + '-' +
// 6 位随机字母数字，如 L260728-8F3K2Q / AP260728-9QW7XZ / CU260728-3K8F2Q。
// 纯函数；unique 碰撞（P2002）由调用方按既有重试纪律处理（重试上限 2，见 lead-service）。

import { randomInt } from 'node:crypto';

const BUSINESS_NO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * 生成可读业务编号。now 可注入以便确定性测试；默认取当前 UTC 时间。
 * 编号不构成安全边界，碰撞概率极低，调用方捕获 P2002 后重试一次即可。
 */
export function makeBusinessNo(prefix: string, now: Date = new Date()): string {
  const yy = String(now.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  let suffix = '';
  for (let index = 0; index < 6; index += 1) {
    suffix += BUSINESS_NO_ALPHABET[randomInt(BUSINESS_NO_ALPHABET.length)];
  }
  return `${prefix}${yy}${mm}${dd}-${suffix}`;
}
