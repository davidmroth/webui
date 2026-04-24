import { json } from '@sveltejs/kit';
import { ServerRole } from '$lib/enums';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants';
import { requireSession } from '$server/auth';

const DEFAULT_N_CTX = 0;
const DEFAULT_MAX_TOKENS = -1;

export async function GET(event) {
  await requireSession(event);

  return json(
    {
      default_generation_settings: {
        n_ctx: DEFAULT_N_CTX,
        params: {
          max_tokens: DEFAULT_MAX_TOKENS
        }
      },
      total_slots: 1,
      model_path: '',
      role: ServerRole.MODEL,
      modalities: {
        vision: false,
        audio: false
      },
      chat_template: '',
      bos_token: '',
      eos_token: '',
      build_info: 'webui',
      webui_settings: SETTING_CONFIG_DEFAULT
    },
    {
      headers: {
        'cache-control': 'no-store'
      }
    }
  );
}