// ── Provider Constants ──
export const PROVIDER = { UCLOUD: 'ucloud', OPENAI: 'openai' };

// ── UCloud Model IDs（以 /v1/models 探测结果为准）──
export const UCLOUD_MODELS = {
  PRIMARY: 'qwen3-235b-a22b-instruct-2507',      // 全语种全层级
  VISION:  'gemini-2.5-flash',                    // 图片分析
};

// ── Legacy compatible ──
export const MODEL_NAMES = {
  GPT4O_MINI: UCLOUD_MODELS.PRIMARY,
  GPT4O:      UCLOUD_MODELS.PRIMARY,
  QWEN_25:    UCLOUD_MODELS.PRIMARY,
};

// 全语种统一走 Qwen3，不再分 th/vi/id 路由
export function routeModel() {
  return UCLOUD_MODELS.PRIMARY;
}

export function routeVisionModel() {
  return UCLOUD_MODELS.VISION;
}
