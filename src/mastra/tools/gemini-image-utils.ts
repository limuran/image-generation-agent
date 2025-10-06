import { GoogleGenAI } from '@google/genai';

export const GEMINI_IMAGE_MODEL_ID = 'models/gemini-2.5-flash-image' as const;
export const MAX_GEMINI_IMAGES_PER_REQUEST = 4;
export const GEMINI_IMAGE_SIZES = ['1024x1024', '1024x1792', '1792x1024'] as const;

export type GeminiImageSize = (typeof GEMINI_IMAGE_SIZES)[number];

const aspectRatioMap: Record<GeminiImageSize, string> = {
  '1024x1024': '1:1',
  '1024x1792': '9:16',
  '1792x1024': '16:9',
};

const GOOGLE_API_MISSING_ERROR =
  '图像生成失败: 未配置 Google Gemini API Key (GOOGLE_API_KEY 或 GOOGLE_GENAI_API_KEY)';

const googleApiKey =
  process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_VERTEX_API_KEY || '';

const geminiImageClient = new GoogleGenAI({
  apiKey: googleApiKey || undefined,
});

export const extractGeminiErrorMessage = (error: unknown): string => {
  if (!error) {
    return '';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
    return String((error as Record<string, unknown>).message);
  }

  return String(error);
};

export const ensureGeminiApiKey = (): string => {
  if (!googleApiKey) {
    throw new Error(GOOGLE_API_MISSING_ERROR);
  }

  return googleApiKey;
};

export interface GenerateGeminiImagesParams {
  prompt: string;
  count: number;
  size: GeminiImageSize;
}

export interface GeminiGeneratedImage {
  dataUrl: string;
  mimeType: string;
  revisedPrompt?: string;
}

export const generateGeminiImages = async ({
  prompt,
  count,
  size,
}: GenerateGeminiImagesParams): Promise<GeminiGeneratedImage[]> => {
  ensureGeminiApiKey();

  if (count < 1) {
    throw new Error('至少需要生成一张图片');
  }

  if (count > MAX_GEMINI_IMAGES_PER_REQUEST) {
    throw new Error(`单次最多只能生成 ${MAX_GEMINI_IMAGES_PER_REQUEST} 张图片`);
  }

  const aspectRatio = aspectRatioMap[size];

  try {
    const response = await geminiImageClient.models.generateImages({
      model: GEMINI_IMAGE_MODEL_ID,
      prompt,
      config: {
        numberOfImages: count,
        aspectRatio,
        outputMimeType: 'image/png',
      },
    });

    const images: GeminiGeneratedImage[] = [];

    for (const generatedImage of response.generatedImages ?? []) {
      const imagePayload = generatedImage.image;
      if (!imagePayload?.imageBytes) {
        continue;
      }

      const mimeType = imagePayload.mimeType || 'image/png';
      const revisedPromptCandidate =
        (generatedImage as unknown as { revisedPrompt?: string }).revisedPrompt ??
        (generatedImage as unknown as { prompt?: string }).prompt;

      images.push({
        dataUrl: `data:${mimeType};base64,${imagePayload.imageBytes}`,
        mimeType,
        revisedPrompt: revisedPromptCandidate,
      });
    }

    if (images.length === 0) {
      throw new Error('未从Google Gemini图像模型获得任何图像');
    }

    return images;
  } catch (error) {
    throw new Error(extractGeminiErrorMessage(error));
  }
};
