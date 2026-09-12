// Pure Node module — no vscode import. Shared by extension and MCP server.
// High-speed regex sweeps for secrets, access keys, private keys, and PII.

export const REDACTED_PLACEHOLDER = '<TOKEN_SHIELD_REDACTED>';

interface SecretPattern {
  name: string;
  regex: RegExp;
  replace: (match: string, ...args: any[]) => string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // Private keys (PEM / OpenSSH / PGP)
  {
    name: 'Private Key',
    regex: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    replace: () => REDACTED_PLACEHOLDER,
  },
  // AWS Access Key ID
  {
    name: 'AWS Access Key',
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
    replace: () => REDACTED_PLACEHOLDER,
  },
  // AWS Secret Access Key assignment
  {
    name: 'AWS Secret Key',
    regex: /(aws_secret_access_key\s*[:=]\s*['"]?)([A-Za-z0-9/+=]{40})(['"]?)/gi,
    replace: (_match, prefix, _key, suffix) => `${prefix}${REDACTED_PLACEHOLDER}${suffix}`,
  },
  // GitHub Personal Access Token / fine-grained tokens
  {
    name: 'GitHub Token',
    regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{82})\b/g,
    replace: () => REDACTED_PLACEHOLDER,
  },
  // OpenAI API Keys
  {
    name: 'OpenAI API Key',
    regex: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,
    replace: () => REDACTED_PLACEHOLDER,
  },
  // Anthropic API Keys
  {
    name: 'Anthropic API Key',
    regex: /\b(sk-ant-[A-Za-z0-9_-]{30,})\b/g,
    replace: () => REDACTED_PLACEHOLDER,
  },
  // Google / Gemini API Keys
  {
    name: 'Google API Key',
    regex: /\b(AIza[0-9A-Za-z\-_]{35})\b/g,
    replace: () => REDACTED_PLACEHOLDER,
  },
  // Slack Tokens
  {
    name: 'Slack Token',
    regex: /\b(xox[baprs]-[0-9A-Za-z]{10,48})\b/g,
    replace: () => REDACTED_PLACEHOLDER,
  },
  // JWT Tokens (3 base64url segments separated by dots)
  {
    name: 'JWT Token',
    regex: /\beyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]{20,}\b/g,
    replace: () => REDACTED_PLACEHOLDER,
  },
  // Bearer tokens in headers / strings
  {
    name: 'Bearer Token',
    regex: /(Bearer\s+)[A-Za-z0-9_\-\.]{25,}/gi,
    replace: (_match, prefix) => `${prefix}${REDACTED_PLACEHOLDER}`,
  },
  // Generic secrets in assignment expressions: password, secret, token, api_key
  {
    name: 'Generic Credential',
    regex: /((?:api[_-]?key|secret[_-]?key|client[_-]?secret|password|passwd|auth[_-]?token|access[_-]?token)\s*[:=]\s*['"])([^'"\r\n]{8,})(['"])/gi,
    replace: (_match, prefix, _val, suffix) => `${prefix}${REDACTED_PLACEHOLDER}${suffix}`,
  },
];

export class SecretSanitizer {
  /**
   * Check whether the input string contains any recognized secret or credential pattern.
   */
  static containsSecrets(text: string): boolean {
    if (!text || text.length === 0) {
      return false;
    }
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Redact all discovered secrets in text with `<TOKEN_SHIELD_REDACTED>`.
   */
  static sanitize(text: string): { sanitized: string; redactedCount: number } {
    if (!text || text.length === 0) {
      return { sanitized: text, redactedCount: 0 };
    }

    let sanitized = text;
    let redactedCount = 0;

    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let matches = 0;
      sanitized = sanitized.replace(pattern.regex, (...args) => {
        matches++;
        return pattern.replace(...args);
      });
      redactedCount += matches;
    }

    return { sanitized, redactedCount };
  }

  /**
   * Helper that directly returns the sanitized string.
   */
  static redact(text: string): string {
    return SecretSanitizer.sanitize(text).sanitized;
  }
}
