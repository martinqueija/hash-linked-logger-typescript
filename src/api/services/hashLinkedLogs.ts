import getLineRepository from '~api/repositories/lines';

import Mutex from '~libs/mutex';
import { NONCE_AMOUNT_ZEROS } from '~config/constants';
import { HashLinkedLog, buildInitialMessage } from '~api/models/HashLinkedLog';
import { hashString, zeros, getUTCStringDate, getAllIndexesOf, unscapeCommas, escapeCommas } from '~libs/utils';
import { entryWasOutPacedByAnotherOne, corruptedLogFileError, invalidLogMessageError } from '~api/errors';
import { createContainer, AwilixContainer, asValue } from 'awilix';
import logger from '~libs/logger';

const buildHashableString = (prevLog: HashLinkedLog, currentLog: HashLinkedLog): string => 
  `${prevLog.prevHash},${prevLog.message},${currentLog.message},${currentLog.date},${currentLog.nonce}`;

const hashCompareEntries = (prevLog: HashLinkedLog, currentLog: HashLinkedLog): boolean => {
  return hashString(buildHashableString(prevLog, currentLog)) === currentLog.prevHash;
};

const parseLine = (l: string): HashLinkedLog => {
  const escapedCommaIndexes = getAllIndexesOf(l, '\\,');
  const separatorIndexes = getAllIndexesOf(l, ',').filter((n: number) => !escapedCommaIndexes.includes(n - 1));
  if (separatorIndexes.length !== 3) {
    throw corruptedLogFileError();
  }
  const prevHash = l.substring(0, separatorIndexes[0]);
  const message = unscapeCommas(l.substring(separatorIndexes[0] + 1, separatorIndexes[1]));
  const date = l.substring(separatorIndexes[1] + 1, separatorIndexes[2]);
  const nonce = l.substring(separatorIndexes[2] + 1);
  return { prevHash, message, date, nonce: Number(nonce) };
};

async function validateLogs(logs: HashLinkedLog[]): Promise<void> {
  logger.info('Validating logs');
  for (let i = 1; i < logs.length; i++) {
    if (!hashCompareEntries(logs[i - 1], logs[i])) {
      throw corruptedLogFileError({
        messages: [{
          message: `Invalid chain, hashes from entries at lines ${i - 1} & ${i} do not match`
        }]
      });
    }
  }
  logger.info('Log database is ok!');
};

const stringifyHashLinkedLog = (log: HashLinkedLog): string =>
  `${log.prevHash},${escapeCommas(log.message)},${log.date},${log.nonce}`;

async function buildLogEntry(message: string): Promise<HashLinkedLog> {
  const lines: string[] = await getLineRepository().getLines();
  const logs: HashLinkedLog[] = lines.map(parseLine);
  const lastLog = logs[logs.length - 1];
  if (!lastLog) {
    logger.info('Database is emtpy! creating the first log with random hash');
    return buildInitialMessage(message);
  }
  await validateLogs(logs);
  const logDraft: HashLinkedLog = {
    nonce: -1,
    message,
    date: getUTCStringDate(),
    prevHash: ''
  };
  while (logDraft.prevHash.substring(0, NONCE_AMOUNT_ZEROS) !== zeros(NONCE_AMOUNT_ZEROS)) {
    logDraft.nonce++;
    logDraft.prevHash = hashString(buildHashableString(lastLog, logDraft));
  }
  logger.info(`Found ${logDraft.nonce} to generate hash ${logDraft.prevHash}`);
  return logDraft;
}

const mutex = new Mutex();

async function log(message: string): Promise<void> {
  if (!message || message === '' || typeof message !== 'string') {
    throw invalidLogMessageError();
  }

  const entry: HashLinkedLog = await buildLogEntry(message);
  mutex.lock(async () => {
    try {
      const lastLine = await getLineRepository().getLastLine();
      logger.info('Comparing the line to the previous line');
      if (lastLine && !hashCompareEntries(parseLine(lastLine), entry)) {
        throw entryWasOutPacedByAnotherOne();
      }
      logger.info('Comparation OK!: saving log');
      await getLineRepository().appendLine(stringifyHashLinkedLog(entry));
    } catch (e) {
      console.log(e);
    }
    mutex.unlock();
  });
}

export async function getLogs(): Promise<HashLinkedLog[]> {
  const lines: string[] = await getLineRepository().getLines();
  const logs: HashLinkedLog[] = lines.map(parseLine);
  await validateLogs(logs);
  return logs;
}

interface IHashLinkedLogService {
  log: (message: string) => Promise<void>;
  getLogs: () => Promise<HashLinkedLog[]>;
}

const REGISTRY_NAME = 'hashLinkedLogService';
const container = createContainer();
container.register(REGISTRY_NAME, asValue({ log, getLogs }));

export default (): IHashLinkedLogService => container.cradle[REGISTRY_NAME];

export const register = (impl: IHashLinkedLogService): AwilixContainer =>
  container.register(REGISTRY_NAME, asValue(impl));

