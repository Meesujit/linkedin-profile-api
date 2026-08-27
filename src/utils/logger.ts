/**
 * Structured logging configuration for Fastify/pino.
 *
 * We export a *configuration object* (not a pino instance) because Fastify 5
 * accepts `logger` as a config object and builds the pino instance itself. The
 * same config is reused for the standalone logger used by scripts/server logs.
 *
 * Security: `redact` scrubs cookies, authorization headers, tokens, and session
 * fields from every log line so secrets never reach stdout.
 */

import pino, { type LoggerOptions } from 'pino';
import { config } from '../config.js';

const REDACT_PATHS = [
  '*.cookie',
  '*.cookies',
  '*.set-cookie',
  '*.authorization',
  '*.session',
  '*.token',
  '*.password',
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers.set-cookie',
];

export function buildLoggerOptions(): LoggerOptions {
  const options: LoggerOptions = {
    level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  };

  // Pretty-print for humans in development; plain JSON in production.
  if (config.nodeEnv !== 'production' && config.nodeEnv !== 'test') {
    options.transport = {
      targets: [
        {
          target: 'pino-pretty',
          level: config.logLevel,
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      ],
    };
  }

  return options;
}

/** Standalone logger for scripts and non-Fastify contexts. */
export const logger = pino(buildLoggerOptions());
