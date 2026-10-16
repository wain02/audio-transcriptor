export type Segment = { start: number; end: number; text: string };
export type Transcript = { provider: "openai" | "gemini"; segments: Segment[] };
export type Difference = {
  id: string;
  start: number;
  end: number;
  openai: string;
  gemini: string;
  different: boolean;
};
export type Job = {
  id: string;
  name: string;
  size: number;
  duration: number;
  status: "processing" | "complete" | "failed";
  progress: number;
  stage: string;
  error?: string;
  audioSha256?: string;
  originals?: OriginalResponse[];
  openai?: Transcript;
  gemini?: Transcript;
  differences?: Difference[];
};
export type Resolution = {
  choice: "openai" | "gemini" | "manual";
  text: string;
};
export type OriginalResponse = {
  provider: "openai" | "gemini";
  index: number;
  offset: number;
  response: unknown;
};
