import process from 'node:process';
import { createFileAttachmentFromPath, postAssistantMessage } from '../src/lib/server/hermes-webui-client';

interface CliOptions {
  baseUrl: string;
  serviceToken: string;
  conversationId: string;
  content: string;
  files: string[];
}

function printHelp() {
  console.log(`Usage: npm run post-assistant-message -- --conversation <id> [options]

Options:
  --conversation, -c   Conversation ID to reply to
  --content, -m        Assistant message text
  --file, -f           File path to attach (repeatable)
  --base-url           WebUI base URL (default: WEBUI_BASE_URL or http://127.0.0.1:${process.env.WEBUI_PORT || '3000'})
  --help, -h           Show this help

Environment:
  HERMES_WEBCHAT_SERVICE_TOKEN   Required bearer token for internal Hermes endpoints
  WEBUI_BASE_URL                 Override the WebUI base URL, for example http://webui:3000 in Docker
`);
}

function readValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: process.env.WEBUI_BASE_URL || `http://127.0.0.1:${process.env.WEBUI_PORT || '3000'}`,
    serviceToken: process.env.HERMES_WEBCHAT_SERVICE_TOKEN || '',
    conversationId: '',
    content: '',
    files: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--conversation':
      case '-c':
        options.conversationId = readValue(argv, index, arg);
        index += 1;
        break;
      case '--content':
      case '-m':
        options.content = readValue(argv, index, arg);
        index += 1;
        break;
      case '--file':
      case '-f':
        options.files.push(readValue(argv, index, arg));
        index += 1;
        break;
      case '--base-url':
        options.baseUrl = readValue(argv, index, arg);
        index += 1;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.conversationId.trim()) {
    throw new Error('--conversation is required.');
  }

  if (!options.serviceToken.trim()) {
    throw new Error('HERMES_WEBCHAT_SERVICE_TOKEN is required.');
  }

  if (!options.content.trim() && options.files.length === 0) {
    throw new Error('Provide --content, --file, or both.');
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const attachments = await Promise.all(
    options.files.map((filePath) => createFileAttachmentFromPath(filePath))
  );

  const result = await postAssistantMessage(
    {
      baseUrl: options.baseUrl,
      serviceToken: options.serviceToken
    },
    {
      conversationId: options.conversationId,
      content: options.content,
      attachments
    }
  );

  console.log(
    `Posted assistant message ${result.messageId} to conversation ${options.conversationId} with ${attachments.length} attachment(s).`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unable to post assistant message.');
  process.exit(1);
});