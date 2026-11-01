import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env or .env.codespace if available
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8000),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  WORK_ROOT: z.string().default('sessions'),
  MAX_APK_BYTES: z.coerce.number().default(1073741824), // 1 GiB
  MAX_CHUNK_BYTES: z.coerce.number().default(16777216), // 16 MiB
  MAX_TEXT_BYTES: z.coerce.number().default(2097152), // 2 MiB
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  APKTOOL_BIN: z.string().default('apktool'),
  JADX_BIN: z.string().default('jadx'),
  ZIPALIGN_BIN: z.string().default('zipalign'),
  APKSIGNER_BIN: z.string().default('apksigner'),
  COMMAND_TIMEOUT_MS: z.coerce.number().default(900000), // 15 min
  COMMAND_OUTPUT_LIMIT: z.coerce.number().default(100000),
  TEST_KEYSTORE: z.string().default('testkey.jks'),
  TEST_KEY_ALIAS: z.string().default('androidtestkey'),
  TEST_KEY_PASSWORD: z.string().default('androiddevtestkey123'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid server environment configuration:', parsed.error.format());
  throw new Error('Environment configuration validation failed');
}

export const env = parsed.data;

// Resolve absolute WORK_ROOT directory safely
export const ABSOLUTE_WORK_ROOT = path.isAbsolute(env.WORK_ROOT)
  ? env.WORK_ROOT
  : path.resolve(process.cwd(), env.WORK_ROOT);

// Resolve test keystore path safely
export const ABSOLUTE_TEST_KEYSTORE = path.isAbsolute(env.TEST_KEYSTORE)
  ? env.TEST_KEYSTORE
  : path.resolve(process.cwd(), env.TEST_KEYSTORE);
