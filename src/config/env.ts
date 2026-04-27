import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  DATABASE_URL: z.string().url(),
  META_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v21.0'),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_PAGE_ID: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),
  META_IG_BUSINESS_ID: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),
  TOKEN_VALIDATE_INTERVAL_MIN: z.coerce.number().int().positive().default(30),
  INSIGHT_SNAPSHOT_TTL_MIN: z.coerce.number().int().positive().default(60),
  KIE_API_BASE_URL: z.string().url().default('https://api.kie.ai'),
  KIE_API_KEY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),
  KIE_CALLBACK_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional(),
  ),
  KIE_ASSET_DEFAULT_TTL_DAYS: z.coerce.number().int().positive().default(14),
  KIE_POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(30),
  DASHBOARD_USERNAME: z.string().min(1).default('admin'),
  DASHBOARD_PASSWORD: z.string().min(8).optional(),
  DASHBOARD_SESSION_SECRET: z.string().min(32).optional(),
  DASHBOARD_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  TELEGRAM_BOT_TOKEN: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),
  TELEGRAM_CHAT_ID: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),
  TELEGRAM_GROUP_CHAT_ID: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),
  /** Comma-separated list of Telegram user IDs allowed to approve writes
   *  and execute write commands. Empty/missing → only the owner DM
   *  (TELEGRAM_CHAT_ID) is approver-eligible. */
  TELEGRAM_APPROVED_USER_IDS: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),
  OPTIMIZER_AUTO_PAUSE_CPR_IDR: z.coerce.number().nonnegative().default(75000),
  OPTIMIZER_AUTO_SCALE_CPR_IDR: z.coerce.number().nonnegative().default(20000),
  OPTIMIZER_AUTO_PAUSE_MIN_DAYS: z.coerce.number().int().nonnegative().default(2),
  OPTIMIZER_RESUME_NOTIFY_DAYS: z.coerce.number().int().positive().default(3),
  OPTIMIZER_AUDIT_WINDOW_DAYS: z.coerce.number().int().positive().default(7),
  OPTIMIZER_CURRENCY_MINOR_PER_UNIT: z.coerce.number().int().positive().default(1),
  ANTHROPIC_API_KEY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),
  AI_MODEL: z.string().default('claude-opus-4-5'),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(1500),
  GOOGLE_CREDENTIALS_PATH: z.string().min(1).default('./config/google-credentials.json'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    '[config] Invalid environment variables:',
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
  );
  process.exit(1);
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  host: env.HOST,
  logLevel: env.LOG_LEVEL,
  databaseUrl: env.DATABASE_URL,
  meta: {
    apiVersion: env.META_API_VERSION,
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    graphUrl: `https://graph.facebook.com/${env.META_API_VERSION}`,
    pageId: env.META_PAGE_ID,
    igBusinessId: env.META_IG_BUSINESS_ID,
  },
  tokenValidateIntervalMs: env.TOKEN_VALIDATE_INTERVAL_MIN * 60 * 1000,
  insightSnapshotTtlMs: env.INSIGHT_SNAPSHOT_TTL_MIN * 60 * 1000,
  kie: {
    baseUrl: env.KIE_API_BASE_URL.replace(/\/$/, ''),
    apiKey: env.KIE_API_KEY,
    callbackUrl: env.KIE_CALLBACK_URL,
    assetDefaultTtlMs: env.KIE_ASSET_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000,
    pollIntervalMs: env.KIE_POLL_INTERVAL_SEC * 1000,
    isConfigured: Boolean(env.KIE_API_KEY),
  },
  dashboard: {
    username: env.DASHBOARD_USERNAME,
    password: env.DASHBOARD_PASSWORD,
    sessionSecret: env.DASHBOARD_SESSION_SECRET,
    sessionTtlMs: env.DASHBOARD_SESSION_TTL_HOURS * 60 * 60 * 1000,
    isConfigured: Boolean(env.DASHBOARD_PASSWORD && env.DASHBOARD_SESSION_SECRET),
  },
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN,
    ownerChatId: env.TELEGRAM_CHAT_ID,
    groupChatId: env.TELEGRAM_GROUP_CHAT_ID,
    approvedUserIds: (env.TELEGRAM_APPROVED_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    isConfigured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  },
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.AI_MODEL,
    maxTokens: env.AI_MAX_TOKENS,
    isConfigured: Boolean(env.ANTHROPIC_API_KEY),
  },
  google: {
    credentialsPath: env.GOOGLE_CREDENTIALS_PATH,
  },
  optimizer: {
    autoPauseCprIdr: env.OPTIMIZER_AUTO_PAUSE_CPR_IDR,
    autoScaleCprIdr: env.OPTIMIZER_AUTO_SCALE_CPR_IDR,
    autoPauseMinDays: env.OPTIMIZER_AUTO_PAUSE_MIN_DAYS,
    resumeNotifyDays: env.OPTIMIZER_RESUME_NOTIFY_DAYS,
    auditWindowDays: env.OPTIMIZER_AUDIT_WINDOW_DAYS,
    /**
     * Smallest unit per currency unit, sesuai konvensi Meta API.
     * - IDR / JPY accounts: 1 (Meta returns whole rupiah/yen — NO sen/sub-yen)
     * - USD / EUR / SGD / etc.: 100 (Meta returns cents/sub-units)
     *
     * Default 1 karena deployment ini all-IDR. Override via env kalau pernah
     * onboard ad account currency lain (mis. USD test account).
     *
     * Verifikasi konvensi: hit Meta Graph dengan
     *   GET /<adset_id>?fields=daily_budget,account_currency
     * dan compare value vs apa yang di-set di Ads Manager. Equal = factor 1.
     */
    currencyMinorPerUnit: env.OPTIMIZER_CURRENCY_MINOR_PER_UNIT,
  },
} as const;

export type AppConfig = typeof config;
