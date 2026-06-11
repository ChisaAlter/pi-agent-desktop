export interface PiAgentModel {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: string[];
}

export interface PiAgentProvider {
  id: string;
  name: string;
  baseUrl?: string;
  models: PiAgentModel[];
}

export interface PiAgentConfig {
  defaultProvider: string;
  defaultModel: string;
  providers: PiAgentProvider[];
}
