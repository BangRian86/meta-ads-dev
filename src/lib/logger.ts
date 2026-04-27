import pino, { type LoggerOptions } from 'pino';
import { config } from '../config/env.js';

const options: LoggerOptions = {
  level: config.logLevel,
  base: { service: 'meta-ads' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'access_token',
      '*.access_token',
      'accessToken',
      '*.accessToken',
      'request.headers.authorization',
      'req.headers.authorization',
    ],
    remove: true,
  },
};

if (config.isDev) {
  options.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname,service',
    },
  };
}

export const logger = pino(options);
export type Logger = typeof logger;
