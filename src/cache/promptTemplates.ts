import * as fs from 'fs';
import * as path from 'path';
import { SecretSanitizer } from './sanitizer';

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export const TEMPLATES_FILE = 'prompt-templates.json';

const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'unit-tests',
    name: 'Targeted Unit Tests',
    description: 'Generate concise, edge-case-focused unit tests with minimal boilerplate',
    prompt: 'Write unit tests for the target functions. Focus on boundary conditions and edge cases. Mock I/O dependencies. Provide only test code without conversational preamble.',
    tags: ['testing', 'quality'],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'ast-refactor',
    name: 'Diff-Only Refactor',
    description: 'Refactor code for performance and clarity, outputting unified diffs only',
    prompt: 'Refactor the target code for performance and maintainability while preserving exact external behavior. Output strictly as a unified diff with ±3 lines of context.',
    tags: ['refactoring', 'diff'],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'security-audit',
    name: 'Concise Security Audit',
    description: 'Scan code for vulnerabilities, injection flaws, and leaked credentials',
    prompt: 'Audit the target code for security vulnerabilities (injection, auth flaws, secret leaks, buffer limits). List findings with severity and exact line numbers. Zero conversational filler.',
    tags: ['security', 'audit'],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'bug-hunt',
    name: 'Root Cause & Patch',
    description: 'Diagnose failures and output a targeted patch',
    prompt: 'Analyze the error or failing test in the target code. Identify root cause and provide a targeted unified diff patch fixing the issue.',
    tags: ['debugging', 'patch'],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

export class PromptTemplateStore {
  private cacheDir: string;
  private filePath: string;

  constructor(private workspaceRoot: string) {
    this.cacheDir = path.join(workspaceRoot, '.aicache');
    this.filePath = path.join(this.cacheDir, TEMPLATES_FILE);
  }

  public list(): PromptTemplate[] {
    const data = this.load();
    return data;
  }

  public get(idOrName: string): PromptTemplate | undefined {
    const data = this.load();
    const query = idOrName.toLowerCase().trim();
    return data.find(t => t.id.toLowerCase() === query || t.name.toLowerCase() === query);
  }

  public save(template: Omit<PromptTemplate, 'createdAt' | 'updatedAt' | 'id'> & { id?: string }): PromptTemplate {
    const data = this.load();
    const cleanPrompt = SecretSanitizer.redact(template.prompt);
    const cleanName = SecretSanitizer.redact(template.name);
    const cleanDesc = SecretSanitizer.redact(template.description);
    const id = template.id || this.slugify(cleanName);

    const now = Date.now();
    const existingIndex = data.findIndex(t => t.id === id);

    let saved: PromptTemplate;
    if (existingIndex >= 0) {
      saved = {
        ...data[existingIndex],
        name: cleanName,
        description: cleanDesc,
        prompt: cleanPrompt,
        tags: template.tags || data[existingIndex].tags,
        updatedAt: now,
      };
      data[existingIndex] = saved;
    } else {
      saved = {
        id,
        name: cleanName,
        description: cleanDesc,
        prompt: cleanPrompt,
        tags: template.tags || [],
        createdAt: now,
        updatedAt: now,
      };
      data.push(saved);
    }

    this.persist(data);
    return saved;
  }

  public delete(idOrName: string): boolean {
    const data = this.load();
    const query = idOrName.toLowerCase().trim();
    const initialLen = data.length;
    const filtered = data.filter(t => t.id.toLowerCase() !== query && t.name.toLowerCase() !== query);
    if (filtered.length !== initialLen) {
      this.persist(filtered);
      return true;
    }
    return false;
  }

  private load(): PromptTemplate[] {
    if (!fs.existsSync(this.filePath)) {
      return [...DEFAULT_TEMPLATES];
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
      return [...DEFAULT_TEMPLATES];
    } catch {
      return [...DEFAULT_TEMPLATES];
    }
  }

  private persist(data: PromptTemplate[]): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Best-effort write
    }
  }

  private slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `template-${Date.now()}`;
  }
}
