/**
 * Sandbox Configuration UI Properties
 *
 * n8n node property definitions for the SDK sandbox feature.
 * Provides granular control over command sandboxing and network restrictions.
 */

import type { INodeProperties } from 'n8n-workflow';

/**
 * Sandbox Configuration - Command sandboxing and network restrictions
 *
 * Field visibility:
 * - Enable Sandbox: Top-level toggle, always visible for executeTask
 * - All other settings: Show when enableSandbox=true
 */
export const sandboxProperties: INodeProperties[] = [
	// Top-level toggle (NOT inside collection - fixes n8n displayOptions bug)
	{
		displayName: 'Enable Sandbox',
		name: 'enableSandbox',
		type: 'boolean',
		default: false,
		description:
			'Whether to enable sandbox mode for command execution. When enabled, commands run in an isolated environment with restricted filesystem and network access.',
	},
	// Collection for sandbox options (only shown when enableSandbox=true)
	{
		displayName: 'Sandbox Configuration',
		name: 'sandboxConfig',
		type: 'collection',
		placeholder: 'Add Sandbox Option',
		default: {},
		displayOptions: {
			show: {
				enableSandbox: [true],
			},
		},
		options: [
			{
				displayName: 'Command Options',
				name: 'commandOptions',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description: 'Configure sandbox command execution behavior',
				options: [
					{
						displayName: 'Settings',
						name: 'settings',
						values: [
							{
								displayName: 'Allow Apple Events',
								name: 'sandboxAllowAppleEvents',
								type: 'boolean',
								default: false,
								description: 'Whether to allow sandboxed commands to send Apple Events for open, osascript, and browser auth flows (macOS only). This reduces code-execution isolation.',
							},
							{
								displayName: 'Allow Unsandboxed Commands',
								name: 'sandboxAllowUnsandboxed',
								type: 'boolean',
								default: false,
								description: 'Whether to allow the model to request running commands outside the sandbox. When true, the model can set dangerouslyDisableSandbox in tool input, which falls back to the permissions system.',
							},
							{
								displayName: 'Auto-Allow Bash When Sandboxed',
								name: 'sandboxAutoAllowBash',
								type: 'boolean',
								default: false,
								description: 'Whether to automatically approve bash commands when sandbox is enabled. This is safe because the sandbox restricts what commands can do.',
							},
							{
								displayName: 'Enable Weaker Nested Sandbox',
								name: 'sandboxWeakerNested',
								type: 'boolean',
								default: false,
								description: 'Whether to enable a weaker nested sandbox for compatibility with some tools that don\'t work well with strict sandboxing',
							},
							{
								displayName: 'Excluded Commands',
								name: 'sandboxExcludedCommands',
								type: 'string',
								default: '',
								placeholder: 'docker, kubectl, npm',
								description: 'Comma-separated list of commands that always bypass sandbox restrictions. These run unsandboxed automatically without model involvement.',
							},
							{
								displayName: 'Fail If Unavailable',
								name: 'sandboxFailIfUnavailable',
								type: 'boolean',
								default: true,
								description: 'Whether to fail the execution when OS-level sandboxing is unavailable on the host. Disable to fall back to running unsandboxed (SDK failIfUnavailable).',
							},
						],
					},
				],
			},
			{
				displayName: 'Credential Denials',
				name: 'credentialDenials',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description: 'Deny sandboxed commands access to credential files and secret environment variables',
				options: [
					{
						displayName: 'Settings',
						name: 'settings',
						values: [
							{
								displayName: 'Denied Credential Environment Variables',
								name: 'sandboxDeniedCredentialEnvVars',
								type: 'string',
								default: '',
								placeholder: 'AWS_SECRET_ACCESS_KEY, GITHUB_TOKEN',
								description: 'Comma-separated environment variable names to unset for sandboxed commands',
							},
							{
								displayName: 'Denied Credential Files',
								name: 'sandboxDeniedCredentialFiles',
								type: 'string',
								default: '',
								placeholder: '~/.aws/credentials, .env',
								description: 'Comma-separated credential file or directory paths to block reads for inside the sandbox',
							},
						],
					},
				],
			},
			{
				displayName: 'Network Options',
				name: 'networkOptions',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description: 'Configure network access restrictions in sandbox mode',
				options: [
					{
						displayName: 'Settings',
						name: 'settings',
						values: [
							{
								displayName: 'Allow All Unix Sockets',
								name: 'sandboxAllowAllUnixSockets',
								type: 'boolean',
								default: false,
								description: 'Whether to allow access to all Unix sockets (use with caution)',
							},
							{
								displayName: 'Allow Local Binding',
								name: 'sandboxAllowLocalBinding',
								type: 'boolean',
								default: false,
								description: 'Whether to allow processes to bind to local ports (e.g., for dev servers)',
							},
							{
								displayName: 'Allow Unix Sockets',
								name: 'sandboxAllowUnixSockets',
								type: 'string',
								default: '',
								placeholder: '/var/run/docker.sock, /tmp/app.sock',
								description: 'Comma-separated list of Unix socket paths that processes can access',
							},
							{
								displayName: 'Allowed Domains',
								name: 'sandboxAllowedDomains',
								type: 'string',
								default: '',
								placeholder: 'api.github.com, *.npmjs.org',
								description: 'Comma-separated list of domains sandboxed processes may reach. Empty means no domain allowlist (SDK network.allowedDomains).',
							},
							{
								displayName: 'Denied Domains',
								name: 'sandboxDeniedDomains',
								type: 'string',
								default: '',
								placeholder: 'internal.corp, 169.254.169.254',
								description: 'Comma-separated list of domains sandboxed processes must NOT reach (SDK network.deniedDomains)',
							},
							{
								displayName: 'HTTP Proxy Port',
								name: 'sandboxHttpProxyPort',
								type: 'number',
								default: 0,
								description: 'HTTP proxy port for network requests (0 to disable)',
							},
							{
								displayName: 'SOCKS Proxy Port',
								name: 'sandboxSocksProxyPort',
								type: 'number',
								default: 0,
								description: 'SOCKS proxy port for network requests (0 to disable)',
							},
						],
					},
				],
			},
			{
				displayName: 'Violation Ignores',
				name: 'violationIgnores',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description: 'Ignore specific sandbox violation patterns',
				options: [
					{
						displayName: 'Settings',
						name: 'settings',
						values: [
							{
								displayName: 'Ignore File Violation Patterns',
								name: 'sandboxIgnoreFilePatterns',
								type: 'string',
								default: '',
								placeholder: '/tmp/*, /var/cache/*',
								description: 'Comma-separated file path patterns to ignore sandbox violations for',
							},
							{
								displayName: 'Ignore Network Violation Patterns',
								name: 'sandboxIgnoreNetworkPatterns',
								type: 'string',
								default: '',
								placeholder: 'localhost:*, 127.0.0.1:8080',
								description: 'Comma-separated network patterns to ignore sandbox violations for',
							},
						],
					},
				],
			},
		],
	},
];
