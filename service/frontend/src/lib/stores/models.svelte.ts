import type { ModelOption } from '$lib/types';

let models = $state<ModelOption[]>([]);

function normalizeId(value: string | null | undefined) {
  return value?.trim() ?? '';
}

export const modelsStore = {
  get items(): ModelOption[] {
    return models;
  },
  replace(nextModels: ModelOption[]) {
    models = Array.isArray(nextModels) ? nextModels : [];
  },
  modelSupportsVision(modelId: string) {
    const normalizedId = normalizeId(modelId);
    if (!normalizedId) {
      return false;
    }

    const match = models.find((model) => {
      const ids = [model.id, model.model, ...(model.aliases ?? [])]
        .map((candidate) => normalizeId(candidate))
        .filter(Boolean);

      return ids.includes(normalizedId);
    });

    return Boolean(match?.modalities?.vision);
  }
};