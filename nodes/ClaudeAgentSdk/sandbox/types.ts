/**
 * Sandbox Configuration Types
 *
 * Derived from the canonical SDK SandboxSettings so newer upstream fields
 * (failIfUnavailable, filesystem scoping, network domain allow/deny lists,
 * TLS termination, helper binary paths) are always expressible.
 */

import type { SandboxSettings } from '../sdk/types';

/**
 * Network-specific configuration for sandbox mode (canonical SDK shape:
 * allowedDomains/deniedDomains, local binding, unix sockets, proxy ports, …).
 */
export type SandboxNetworkConfig = NonNullable<SandboxSettings['network']>;

/**
 * Credential-denial configuration (canonical SDK shape: file/directory paths
 * and environment-variable names, each with mode: 'deny').
 */
export type SandboxCredentialsConfig = NonNullable<SandboxSettings['credentials']>;

/**
 * Violation-suppression map (canonical SDK shape: open record of pattern
 * lists keyed by violation category).
 */
export type SandboxIgnoreViolationsConfig = NonNullable<SandboxSettings['ignoreViolations']>;

/**
 * Configuration for sandbox behavior — canonical SDK SandboxSettings with
 * `enabled` required (the node only builds a config when the toggle is on).
 */
export type SandboxConfig = Omit<SandboxSettings, 'enabled'> & { enabled: boolean };
