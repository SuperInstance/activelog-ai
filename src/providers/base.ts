/**
 * Abstract Provider base class.
 * All LLM providers (OpenAI-compatible, Workers AI) extend this.
 * @see docs/api/API-DESIGN.md
 */
import type { RoutingAction } from '../types.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ProviderResponse {
  content: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface ProviderOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export abstract class BaseProvider {
  abstract readonly id: string;
  abstract readonly name: string;

  abstract chat(messages: ChatMessage[], options: ProviderOptions): Promise<ProviderResponse>;
  abstract supports(action: RoutingAction): boolean;
  abstract healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;
}
