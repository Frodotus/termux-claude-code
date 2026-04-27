#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execSync, execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const HOME = homedir();
const APPS_CACHE = join(HOME, '.apps');

function readAppsCache() {
    if (!existsSync(APPS_CACHE)) return [];
    return readFileSync(APPS_CACHE, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [name, component, packageName, isSystem] = line.split('|');
            return { name, component, packageName, isSystem: isSystem?.trim() === 'true' };
        })
        .filter(a => a.name && a.component);
}

function findApp(query) {
    const apps = readAppsCache();
    const q = query.toLowerCase();
    return (
        apps.find(a => a.packageName === query) ||
        apps.find(a => a.name.toLowerCase() === q) ||
        apps.find(a => a.name.toLowerCase().includes(q))
    );
}

function shell(command, timeout = 30000) {
    return execSync(command, { encoding: 'utf8', timeout, shell: '/data/data/com.termux/files/usr/bin/bash' }).trim();
}

function hasTermuxApi() {
    try { execFileSync('termux-clipboard-get', ['--help'], { timeout: 2000 }); return true; }
    catch { return false; }
}

const server = new Server(
    { name: 'termux-phone', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'list_apps',
            description: 'List installed Android apps that can be launched',
            inputSchema: {
                type: 'object',
                properties: {
                    filter: { type: 'string', description: 'Filter by name (case-insensitive, partial match)' },
                    include_system: { type: 'boolean', description: 'Include system apps (default false)' }
                }
            }
        },
        {
            name: 'launch_app',
            description: 'Launch an Android app by name or package name',
            inputSchema: {
                type: 'object',
                properties: {
                    app: { type: 'string', description: 'App name (e.g. "Spotify") or package name (e.g. "com.spotify.music")' }
                },
                required: ['app']
            }
        },
        {
            name: 'shell',
            description: 'Run a shell command in Termux and return output',
            inputSchema: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command to run' },
                    timeout: { type: 'number', description: 'Timeout in ms (default 30000)' }
                },
                required: ['command']
            }
        },
        {
            name: 'screenshot',
            description: 'Take a screenshot of the phone screen',
            inputSchema: { type: 'object', properties: {} }
        },
        {
            name: 'clipboard_get',
            description: 'Get the current clipboard text (requires Termux:API)',
            inputSchema: { type: 'object', properties: {} }
        },
        {
            name: 'clipboard_set',
            description: 'Set clipboard text (requires Termux:API)',
            inputSchema: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: 'Text to copy to clipboard' }
                },
                required: ['text']
            }
        },
        {
            name: 'open_url',
            description: 'Open a URL in the default browser',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to open' }
                },
                required: ['url']
            }
        },
        {
            name: 'send_notification',
            description: 'Send a notification on the phone (requires Termux:API)',
            inputSchema: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Notification title' },
                    content: { type: 'string', description: 'Notification body' }
                },
                required: ['title', 'content']
            }
        }
    ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'list_apps': {
                const apps = readAppsCache();
                const result = apps
                    .filter(a => args?.include_system || !a.isSystem)
                    .filter(a => !args?.filter || a.name.toLowerCase().includes(args.filter.toLowerCase()));
                if (result.length === 0)
                    return { content: [{ type: 'text', text: 'No apps found.' }] };
                return {
                    content: [{
                        type: 'text',
                        text: result.map(a => `${a.name}  (${a.packageName})`).join('\n')
                    }]
                };
            }

            case 'launch_app': {
                const app = findApp(args.app);
                if (!app)
                    return { content: [{ type: 'text', text: `App not found: ${args.app}` }], isError: true };
                shell(`termux-am start -n "${app.component}"`);
                return { content: [{ type: 'text', text: `Launched ${app.name}` }] };
            }

            case 'shell': {
                const output = shell(args.command, args.timeout ?? 30000);
                return { content: [{ type: 'text', text: output || '(no output)' }] };
            }

            case 'screenshot': {
                const path = `${HOME}/mcp-screenshot.png`;
                shell(`screencap -p ${path}`);
                const data = readFileSync(path);
                return {
                    content: [{
                        type: 'image',
                        data: data.toString('base64'),
                        mimeType: 'image/png'
                    }]
                };
            }

            case 'clipboard_get': {
                const text = shell('termux-clipboard-get');
                return { content: [{ type: 'text', text }] };
            }

            case 'clipboard_set': {
                execSync(`echo ${JSON.stringify(args.text)} | termux-clipboard-set`, { timeout: 5000 });
                return { content: [{ type: 'text', text: 'Clipboard set.' }] };
            }

            case 'open_url': {
                shell(`termux-open-url ${JSON.stringify(args.url)}`);
                return { content: [{ type: 'text', text: `Opened ${args.url}` }] };
            }

            case 'send_notification': {
                shell(`termux-notification --title ${JSON.stringify(args.title)} --content ${JSON.stringify(args.content)}`);
                return { content: [{ type: 'text', text: 'Notification sent.' }] };
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);
